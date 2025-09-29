/*
 * TypeScript implementation of git-crypt commands
 * Reference: git-crypt/commands.cpp, git-crypt/commands.hpp
 */

import * as fs from 'fs';
import * as path from 'path';
import { Readable, Writable } from 'stream';
import {
  SystemError,
  GitCryptError,
  execCommand,
  execCommandWithOutput,
  mkdirParent,
  touchFile,
  removeFile,
  fileExists,
  isDirectory,
  getDirectoryContents,
  escapeShellArg,
  getExecutablePath
} from './util';
import { Coprocess } from './coprocess';
import {
  KeyFile,
  KeyEntry,
  validateKeyName,
  MalformedKeyFileError,
  IncompatibleKeyFileError
} from './key';
import {
  AesCtrEncryptor,
  AesCtrDecryptor,
  randomBytes,
  initCrypto,
  CryptoError
} from './crypto';

/**
 * Git checkout batch size for efficiency
 */
const GIT_CHECKOUT_BATCH_SIZE = 100;

/**
 * Command error with exit code
 */
export class CommandError extends Error {
  public readonly exitCode: number;

  constructor(message: string, exitCode: number = 1) {
    super(message);
    this.name = 'CommandError';
    this.exitCode = exitCode;
  }
}

/**
 * Get attribute name for key
 */
function getAttributeName(keyName?: string): string {
  if (keyName) {
    return `git-crypt-${keyName}`;
  } else {
    return 'git-crypt';
  }
}

/**
 * Get git version string
 */
async function getGitVersionString(): Promise<string> {
  try {
    const result = await execCommandWithOutput(['git', 'version']);
    if (result.exitCode !== 0) {
      throw new CommandError("'git version' failed - is Git installed?");
    }
    
    const parts = result.output.trim().split(/\s+/);
    if (parts.length >= 3) {
      return parts[2]; // "git version 2.x.x" -> "2.x.x"
    }
    throw new CommandError('Invalid git version output');
  } catch (error) {
    throw new CommandError("'git version' failed - is Git installed?");
  }
}

/**
 * Parse version string into array of numbers
 */
function parseVersion(versionStr: string): number[] {
  return versionStr.split('.').map(part => parseInt(part, 10) || 0);
}

/**
 * Get git version as array of numbers
 */
let cachedGitVersion: number[] | null = null;
async function getGitVersion(): Promise<number[]> {
  if (!cachedGitVersion) {
    const versionStr = await getGitVersionString();
    cachedGitVersion = parseVersion(versionStr);
  }
  return cachedGitVersion;
}

/**
 * Set git config value
 */
async function gitConfig(name: string, value: string): Promise<void> {
  const result = await execCommand(['git', 'config', name, value]);
  if (result !== 0) {
    throw new CommandError("'git config' failed");
  }
}

/**
 * Check if git config exists
 */
async function gitHasConfig(name: string): Promise<boolean> {
  const result = await execCommandWithOutput(['git', 'config', '--get-all', name]);
  switch (result.exitCode) {
    case 0: return true;
    case 1: return false;
    default: throw new CommandError("'git config' failed");
  }
}

/**
 * Remove git config section
 */
async function gitDeconfig(name: string): Promise<void> {
  const result = await execCommand(['git', 'config', '--remove-section', name]);
  if (result !== 0) {
    throw new CommandError("'git config' failed");
  }
}

/**
 * Configure git filters for encryption/decryption
 */
async function configureGitFilters(keyName?: string): Promise<void> {
  const escapedGitCryptPath = escapeShellArg(getExecutablePath());
  
  if (keyName) {
    const filterName = `git-crypt-${keyName}`;
    const diffName = `git-crypt-${keyName}`;
    
    await gitConfig(`filter.${filterName}.smudge`, `${escapedGitCryptPath} smudge --key-name=${keyName}`);
    await gitConfig(`filter.${filterName}.clean`, `${escapedGitCryptPath} clean --key-name=${keyName}`);
    await gitConfig(`filter.${filterName}.required`, 'true');
    await gitConfig(`diff.${diffName}.textconv`, `${escapedGitCryptPath} diff --key-name=${keyName}`);
  } else {
    await gitConfig('filter.git-crypt.smudge', `${escapedGitCryptPath} smudge`);
    await gitConfig('filter.git-crypt.clean', `${escapedGitCryptPath} clean`);
    await gitConfig('filter.git-crypt.required', 'true');
    await gitConfig('diff.git-crypt.textconv', `${escapedGitCryptPath} diff`);
  }
}

/**
 * Deconfigure git filters
 */
async function deconfigureGitFilters(keyName?: string): Promise<void> {
  const attributeName = getAttributeName(keyName);
  
  if (await gitHasConfig(`filter.${attributeName}.smudge`) ||
      await gitHasConfig(`filter.${attributeName}.clean`) ||
      await gitHasConfig(`filter.${attributeName}.required`)) {
    await gitDeconfig(`filter.${attributeName}`);
  }

  if (await gitHasConfig(`diff.${attributeName}.textconv`)) {
    await gitDeconfig(`diff.${attributeName}`);
  }
}

/**
 * Get git status output
 */
async function getGitStatus(): Promise<string> {
  const result = await execCommandWithOutput(['git', 'status', '--porcelain']);
  if (result.exitCode !== 0) {
    throw new CommandError('Failed to get git status');
  }
  return result.output;
}

/**
 * Check if working directory is clean
 */
async function isWorkingDirectoryClean(): Promise<boolean> {
  const status = await getGitStatus();
  return status.trim().length === 0;
}

/**
 * Get internal key path for a key name
 */
function getInternalKeyPath(keyName?: string): string {
  const gitDir = '.git';
  if (keyName) {
    return path.join(gitDir, 'git-crypt', 'keys', keyName);
  } else {
    return path.join(gitDir, 'git-crypt', 'keys', 'default');
  }
}

/**
 * Get repo keys path for GPG encrypted keys
 */
function getRepoKeysPath(): string {
  return '.git-crypt';
}

/**
 * Validate key name or throw error
 */
function validateKeyNameOrThrow(keyName: string): void {
  const validation = validateKeyName(keyName);
  if (!validation.valid) {
    throw new CommandError(`Invalid key name: ${validation.reason}`);
  }
}

const IGNORED_ATTRIBUTE_VALUES = new Set(['unspecified', 'unset', 'set']);

interface LsFilesEntry {
  mode: string;
  objectId: string;
  stage: string;
  filename: string;
}

function versionAtLeast(current: number[], target: number[]): boolean {
  const length = Math.max(current.length, target.length);
  for (let i = 0; i < length; i++) {
    const currentPart = current[i] ?? 0;
    const targetPart = target[i] ?? 0;
    if (currentPart > targetPart) {
      return true;
    }
    if (currentPart < targetPart) {
      return false;
    }
  }
  return true;
}

async function collectStream(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const onData = (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };

    const cleanup = () => {
      stream.removeListener('data', onData);
      stream.removeListener('error', onError);
      stream.removeListener('end', onEnd);
    };

    stream.on('data', onData);
    stream.once('error', onError);
    stream.once('end', onEnd);
  });
}

function parseLsFilesOutput(buffer: Buffer): LsFilesEntry[] {
  const entries: LsFilesEntry[] = [];
  if (buffer.length === 0) {
    return entries;
  }

  const records = buffer.toString('utf8').split('\0').filter(record => record.length > 0);
  for (const record of records) {
    const firstSpace = record.indexOf(' ');
    const secondSpace = firstSpace === -1 ? -1 : record.indexOf(' ', firstSpace + 1);
    const thirdSpace = secondSpace === -1 ? -1 : record.indexOf(' ', secondSpace + 1);

    if (firstSpace === -1 || secondSpace === -1 || thirdSpace === -1) {
      continue;
    }

    const mode = record.slice(0, firstSpace);
    const objectId = record.slice(firstSpace + 1, secondSpace);
    const stage = record.slice(secondSpace + 1, thirdSpace);
    const filename = record.slice(thirdSpace + 1);
    entries.push({ mode, objectId, stage, filename });
  }

  return entries;
}

function isSignificantAttrValue(value: string): boolean {
  return value.length > 0 && !IGNORED_ATTRIBUTE_VALUES.has(value);
}

function isGitFileMode(mode: string): boolean {
  const parsed = parseInt(mode, 8);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return (parsed & 0o170000) === 0o100000;
}

function writeBuffer(stream: Writable, buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      stream.removeListener('error', onError);
      reject(error);
    };

    stream.once('error', onError);
    stream.write(buffer, (error) => {
      stream.removeListener('error', onError);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function getFileAttributesSingle(filename: string): Promise<{ filter: string; diff: string }> {
  const result = await execCommandWithOutput(['git', 'check-attr', 'filter', 'diff', '--', filename]);
  if (result.exitCode !== 0) {
    throw new CommandError("'git check-attr' failed - is this a Git repository?");
  }

  let filterAttr = '';
  let diffAttr = '';

  for (const rawLine of result.output.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    const valuePos = line.lastIndexOf(': ');
    if (valuePos <= 0) {
      continue;
    }

    const namePos = line.lastIndexOf(': ', valuePos - 1);
    if (namePos < 0) {
      continue;
    }

    const attrName = line.slice(namePos + 2, valuePos);
    const attrValue = line.slice(valuePos + 2).trim();

    if (!isSignificantAttrValue(attrValue)) {
      continue;
    }

    if (attrName === 'filter') {
      filterAttr = attrValue;
    } else if (attrName === 'diff') {
      diffAttr = attrValue;
    }
  }

  return { filter: filterAttr, diff: diffAttr };
}

async function getFileAttributesBatch(filenames: string[]): Promise<Map<string, { filter: string; diff: string }>> {
  const attrMap = new Map<string, { filter: string; diff: string }>();

  if (filenames.length === 0) {
    return attrMap;
  }

  for (const name of filenames) {
    attrMap.set(name, { filter: '', diff: '' });
  }

  const checkAttr = new Coprocess();
  const stdin = checkAttr.stdinPipe();
  const stdout = checkAttr.stdoutPipe();

  checkAttr.spawn(['git', 'check-attr', '--stdin', '-z', 'filter', 'diff']);

  try {
    const payload: Buffer[] = [];
    for (const filename of filenames) {
      payload.push(Buffer.from(filename, 'utf8'));
      payload.push(Buffer.from([0]));
    }

    await writeBuffer(stdin, Buffer.concat(payload));
    checkAttr.closeStdin();

    const outputBuffer = await collectStream(stdout);
    const exitCode = await checkAttr.wait();
    if (exitCode !== 0) {
      throw new CommandError("'git check-attr' failed - is this a Git repository?");
    }

    const tokens = outputBuffer.toString('utf8').split('\0');
    for (let i = 0; i + 2 < tokens.length; i += 3) {
      const file = tokens[i];
      const attrName = tokens[i + 1];
      const attrValue = tokens[i + 2];

      if (!attrMap.has(file)) {
        continue;
      }

      if (!isSignificantAttrValue(attrValue)) {
        continue;
      }

      const entry = attrMap.get(file)!;
      if (attrName === 'filter') {
        entry.filter = attrValue;
      } else if (attrName === 'diff') {
        entry.diff = attrValue;
      }
    }

    return attrMap;
  } catch (error) {
    checkAttr.terminate('SIGKILL');
    try {
      await checkAttr.wait();
    } catch {
      // ignore secondary errors during cleanup
    }
    throw error;
  } finally {
    checkAttr.closeStdout();
    checkAttr.closeStdin();
  }
}

/**
 * Get list of encrypted files for a key
 */
async function getEncryptedFiles(keyName?: string): Promise<string[]> {
  const attributeName = getAttributeName(keyName);

  const lsProcess = new Coprocess();
  const lsStdout = lsProcess.stdoutPipe();
  lsProcess.spawn(['git', 'ls-files', '-csz', '--']);

  let lsOutput: Buffer;
  let lsExitCode = 0;

  try {
    lsOutput = await collectStream(lsStdout);
    lsExitCode = await lsProcess.wait();
  } catch (error) {
    lsProcess.terminate('SIGKILL');
    lsProcess.closeStdout();
    try {
      await lsProcess.wait();
    } catch {
      // ignore secondary errors while terminating
    }
    throw error;
  }

  lsProcess.closeStdout();

  if (lsExitCode !== 0) {
    throw new CommandError("'git ls-files' failed - is this a Git repository?");
  }

  const entries = parseLsFilesOutput(lsOutput);
  if (entries.length === 0) {
    return [];
  }

  const gitVersion = await getGitVersion();
  const batchSupported = versionAtLeast(gitVersion, [1, 8, 5]);

  let batchAttributes: Map<string, { filter: string; diff: string }> | null = null;
  if (batchSupported) {
    try {
      batchAttributes = await getFileAttributesBatch(entries.map(entry => entry.filename));
    } catch {
      batchAttributes = null;
    }
  }

  const encryptedFiles: string[] = [];

  for (const entry of entries) {
    if (!isGitFileMode(entry.mode)) {
      continue;
    }

    let filterAttr = '';

    if (batchAttributes) {
      const attrs = batchAttributes.get(entry.filename);
      if (attrs) {
        filterAttr = attrs.filter;
      } else {
        const fallbackAttrs = await getFileAttributesSingle(entry.filename);
        filterAttr = fallbackAttrs.filter;
      }
    } else {
      const attrs = await getFileAttributesSingle(entry.filename);
      filterAttr = attrs.filter;
    }

    if (filterAttr === attributeName) {
      encryptedFiles.push(entry.filename);
    }
  }

  return encryptedFiles;
}

/**
 * Git checkout files
 */
async function gitCheckout(files: string[]): Promise<boolean> {
  if (files.length === 0) {
    return true;
  }

  // Process files in batches to avoid command line length limits
  for (let i = 0; i < files.length; i += GIT_CHECKOUT_BATCH_SIZE) {
    const batch = files.slice(i, i + GIT_CHECKOUT_BATCH_SIZE);
    const result = await execCommand(['git', 'checkout', 'HEAD', '--', ...batch]);
    if (result !== 0) {
      return false;
    }
  }
  
  return true;
}

/**
 * Initialize repository with git-crypt
 */
export async function init(args: string[]): Promise<number> {
  let keyName: string | undefined;
  
  // Simple argument parsing
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-k' || args[i] === '--key-name') {
      keyName = args[i + 1];
      i++; // skip next argument
    } else {
      throw new CommandError('Error: git-crypt init takes no arguments');
    }
  }

  if (keyName) {
    validateKeyNameOrThrow(keyName);
  }

  const internalKeyPath = getInternalKeyPath(keyName);
  
  if (await fileExists(internalKeyPath)) {
    throw new CommandError('Error: this repository has already been initialized with git-crypt.');
  }

  // Generate a key and install it
  console.log('Generating key...');
  const keyFile = new KeyFile();
  keyFile.setKeyName(keyName || null);
  keyFile.generate();

  await mkdirParent(internalKeyPath);
  const success = await keyFile.storeToFile(internalKeyPath);
  if (!success) {
    throw new CommandError(`Error: ${internalKeyPath}: unable to write key file`);
  }

  // Configure git
  await configureGitFilters(keyName);

  console.log('git-crypt is now configured to use your key.');
  console.log('');
  console.log('You can now edit your .gitattributes file to specify which files should');
  console.log('be encrypted. See `git-crypt help` for more information.');

  return 0;
}

/**
 * Unlock repository with key file(s)
 */
export async function unlock(args: string[]): Promise<number> {
  // Check if working directory is clean
  if (!await isWorkingDirectoryClean()) {
    throw new CommandError(
      'Error: Working directory not clean.\n' +
      'Please commit your changes or \'git stash\' them before running \'git-crypt unlock\'.'
    );
  }

  // Load key files
  const keyFiles: KeyFile[] = [];
  
  if (args.length > 0) {
    // Read from symmetric key file(s)
    for (const keyFilePath of args) {
      const keyFile = new KeyFile();
      
      try {
        let success: boolean;
        if (keyFilePath === '-') {
          // Read from stdin (not implemented in this simplified version)
          throw new CommandError('Reading from stdin not supported in this implementation');
        } else {
          success = await keyFile.loadFromFile(keyFilePath);
        }
        
        if (!success) {
          throw new CommandError(`Error: ${keyFilePath}: unable to read key file`);
        }
        
        keyFiles.push(keyFile);
      } catch (error) {
        if (error instanceof IncompatibleKeyFileError) {
          throw new CommandError(
            `Error: ${keyFilePath} is in an incompatible format\n` +
            'Please upgrade to a newer version of git-crypt.'
          );
        } else if (error instanceof MalformedKeyFileError) {
          throw new CommandError(
            `Error: ${keyFilePath}: not a valid git-crypt key file\n` +
            'If this key was created prior to git-crypt 0.4, you need to migrate it\n' +
            'by running \'git-crypt migrate-key /path/to/old_key /path/to/migrated_key\'.'
          );
        }
        throw error;
      }
    }
  } else {
    // GPG decryption not implemented in this simplified version
    throw new CommandError(
      'Error: GPG key decryption not supported in this implementation.\n' +
      'Please specify the path to a symmetric key file.'
    );
  }

  // Install the key(s) and configure git filters
  const allEncryptedFiles: string[] = [];
  
  for (const keyFile of keyFiles) {
    const internalKeyPath = getInternalKeyPath(keyFile.getKeyName() || undefined);
    
    await mkdirParent(internalKeyPath);
    const success = await keyFile.storeToFile(internalKeyPath);
    if (!success) {
      throw new CommandError(`Error: ${internalKeyPath}: unable to write key file`);
    }

    await configureGitFilters(keyFile.getKeyName() || undefined);
    const encryptedFiles = await getEncryptedFiles(keyFile.getKeyName() || undefined);
    allEncryptedFiles.push(...encryptedFiles);
  }

  // Touch and checkout encrypted files
  for (const file of allEncryptedFiles) {
    await touchFile(file);
  }
  
  if (!await gitCheckout(allEncryptedFiles)) {
    throw new CommandError("Error: 'git checkout' failed");
  }

  console.log('git-crypt has been unlocked');
  
  // Clean up sensitive data
  keyFiles.forEach(keyFile => keyFile.destroy());
  
  return 0;
}

/**
 * Lock repository (re-encrypt files)
 */
export async function lock(args: string[]): Promise<number> {
  let keyName: string | undefined;
  
  // Simple argument parsing
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-k' || args[i] === '--key-name') {
      keyName = args[i + 1];
      i++; // skip next argument
    } else {
      throw new CommandError('Error: unexpected argument to git-crypt lock');
    }
  }

  if (keyName) {
    validateKeyNameOrThrow(keyName);
  }

  // Check if working directory is clean
  if (!await isWorkingDirectoryClean()) {
    throw new CommandError(
      'Error: Working directory not clean.\n' +
      'Please commit your changes or \'git stash\' them before running \'git-crypt lock\'.'
    );
  }

  const internalKeyPath = getInternalKeyPath(keyName);
  
  if (!await fileExists(internalKeyPath)) {
    throw new CommandError('Error: this repository is not configured with git-crypt');
  }

  // Get list of encrypted files
  const encryptedFiles = await getEncryptedFiles(keyName);

  // Remove the key from .git
  await removeFile(internalKeyPath);

  // Deconfigure git filters
  await deconfigureGitFilters(keyName);

  // Touch and checkout files to re-encrypt them
  for (const file of encryptedFiles) {
    await touchFile(file);
  }
  
  if (!await gitCheckout(encryptedFiles)) {
    throw new CommandError("Error: 'git checkout' failed");
  }

  console.log('git-crypt has been locked');
  
  return 0;
}

/**
 * Export symmetric key to file
 */
export async function exportKey(args: string[]): Promise<number> {
  if (args.length !== 1) {
    throw new CommandError('Error: git-crypt export-key takes exactly one argument (the key file)');
  }

  const keyFilePath = args[0];
  let keyName: string | undefined;

  // For now, assume default key. In full implementation, would parse --key-name option
  const internalKeyPath = getInternalKeyPath(keyName);
  
  if (!await fileExists(internalKeyPath)) {
    throw new CommandError('Error: this repository is not configured with git-crypt');
  }

  // Load the key
  const keyFile = new KeyFile();
  const success = await keyFile.loadFromFile(internalKeyPath);
  if (!success) {
    throw new CommandError(`Error: unable to read key from ${internalKeyPath}`);
  }

  // Save to output file
  const outputSuccess = await keyFile.storeToFile(keyFilePath);
  if (!outputSuccess) {
    throw new CommandError(`Error: unable to write key to ${keyFilePath}`);
  }

  console.log(`Key exported to ${keyFilePath}`);
  
  // Clean up sensitive data
  keyFile.destroy();
  
  return 0;
}

/**
 * Generate a new key file
 */
export async function keygen(args: string[]): Promise<number> {
  if (args.length !== 1) {
    throw new CommandError('Error: git-crypt keygen takes exactly one argument (the key file)');
  }

  const keyFilePath = args[0];

  // Generate new key
  const keyFile = new KeyFile();
  keyFile.generate();

  // Save to file
  const success = await keyFile.storeToFile(keyFilePath);
  if (!success) {
    throw new CommandError(`Error: unable to write key to ${keyFilePath}`);
  }

  console.log(`Key generated and saved to ${keyFilePath}`);
  
  // Clean up sensitive data
  keyFile.destroy();
  
  return 0;
}

/**
 * Show status of encrypted files
 */
export async function status(args: string[]): Promise<number> {
  let keyName: string | undefined;

  // Simple argument parsing (in full implementation would be more comprehensive)
  if (args.length > 0) {
    // For now, ignore arguments
  }

  try {
    const encryptedFiles = await getEncryptedFiles(keyName);
    
    if (encryptedFiles.length === 0) {
      console.log('No encrypted files found.');
    } else {
      console.log('Encrypted files:');
      for (const file of encryptedFiles) {
        console.log(`  ${file}`);
      }
    }
    
    return 0;
  } catch (error) {
    console.error('Error getting encrypted file status');
    return 1;
  }
}

/**
 * Print help for init command
 */
export function helpInit(): void {
  console.log('Usage: git-crypt init [OPTIONS]');
  console.log('');
  console.log('    -k, --key-name KEYNAME      Initialize the given key, instead of the default');
  console.log('');
}

/**
 * Print help for unlock command
 */
export function helpUnlock(): void {
  console.log('Usage: git-crypt unlock [KEYFILE]');
  console.log('');
  console.log('Unlock the repository using the specified key file, or using GPG if no key file is specified.');
  console.log('');
}

/**
 * Print help for lock command
 */
export function helpLock(): void {
  console.log('Usage: git-crypt lock [OPTIONS]');
  console.log('');
  console.log('    -k, --key-name KEYNAME      Lock the given key, instead of the default');
  console.log('');
}

/**
 * Print help for export-key command
 */
export function helpExportKey(): void {
  console.log('Usage: git-crypt export-key [OPTIONS] KEYFILE');
  console.log('');
  console.log('Export the repository\'s symmetric key to the specified file.');
  console.log('');
}

/**
 * Print help for keygen command
 */
export function helpKeygen(): void {
  console.log('Usage: git-crypt keygen KEYFILE');
  console.log('');
  console.log('Generate a new git-crypt key and save it to the specified file.');
  console.log('');
}

/**
 * Print help for status command
 */
export function helpStatus(): void {
  console.log('Usage: git-crypt status [OPTIONS]');
  console.log('');
  console.log('Display which files are encrypted.');
  console.log('');
}