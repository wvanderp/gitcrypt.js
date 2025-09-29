/*
 * TypeScript implementation of git-crypt utility functions
 * Reference: git-crypt/util.cpp, git-crypt/util-unix.cpp, git-crypt/util-win32.cpp
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, SpawnOptions } from 'child_process';
import { Readable, Writable } from 'stream';

/**
 * System error for file operations and process execution
 */
export class SystemError extends Error {
  public readonly action: string;
  public readonly target: string;
  public readonly errno: number;

  constructor(action: string, target: string, errno: number, message?: string) {
    const errorMessage = message || `${action} failed on ${target}: ${errno}`;
    super(errorMessage);
    this.name = 'SystemError';
    this.action = action;
    this.target = target;
    this.errno = errno;
  }
}

/**
 * General error class for git-crypt operations
 */
export class GitCryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitCryptError';
  }
}

/**
 * Temporary file stream that auto-deletes on close
 */
export class TempFileStream {
  private filename: string | null = null;
  private fileHandle: fs.promises.FileHandle | null = null;

  constructor() {}

  /**
   * Open a temporary file for writing
   */
  async open(mode: 'r' | 'w' | 'r+' = 'w'): Promise<fs.promises.FileHandle> {
    const tmpDir = process.env.TMPDIR || process.env.TMP || '/tmp';
    this.filename = path.join(tmpDir, `git-crypt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    
    try {
      this.fileHandle = await fs.promises.open(this.filename, mode, 0o600);
      return this.fileHandle;
    } catch (error: any) {
      throw new SystemError('open', this.filename, error.errno || -1);
    }
  }

  /**
   * Close and delete the temporary file
   */
  async close(): Promise<void> {
    if (this.fileHandle) {
      try {
        await this.fileHandle.close();
      } catch (error) {
        // Ignore close errors
      }
      this.fileHandle = null;
    }

    if (this.filename) {
      try {
        await fs.promises.unlink(this.filename);
      } catch (error) {
        // Ignore deletion errors
      }
      this.filename = null;
    }
  }

  getFilename(): string | null {
    return this.filename;
  }
}

/**
 * Create parent directories of a path (but not the path itself)
 */
export async function mkdirParent(filePath: string): Promise<void> {
  const parentDir = path.dirname(filePath);
  if (parentDir && parentDir !== '.' && parentDir !== '/') {
    try {
      await fs.promises.mkdir(parentDir, { recursive: true });
    } catch (error) {
      throw new SystemError('mkdir', parentDir, (error as any).errno || -1);
    }
  }
}

/**
 * Get the path of the current executable
 */
export function getExecutablePath(): string {
  return process.execPath;
}

/**
 * Execute a command and return the exit code
 */
export async function execCommand(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    if (args.length === 0) {
      reject(new GitCryptError('No command specified'));
      return;
    }

    const [command, ...commandArgs] = args;
    const options: SpawnOptions = {
      stdio: 'inherit',
      shell: false
    };

    const child = spawn(command, commandArgs, options);

    child.on('error', (error: Error) => {
      reject(new SystemError('exec', command, (error as any).errno || -1));
    });

    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (signal) {
        resolve(128 + (process.platform === 'win32' ? 0 : 1)); // Signal termination
      } else {
        resolve(code || 0);
      }
    });
  });
}

/**
 * Execute a command and capture its output
 */
export async function execCommandWithOutput(args: string[]): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    if (args.length === 0) {
      reject(new GitCryptError('No command specified'));
      return;
    }

    const [command, ...commandArgs] = args;
    const options: SpawnOptions = {
      stdio: ['pipe', 'pipe', 'inherit'],
      shell: false
    };

    const child = spawn(command, commandArgs, options);
    let output = '';

    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
    }

    child.on('error', (error: Error) => {
      reject(new SystemError('exec', command, (error as any).errno || -1));
    });

    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      const exitCode = signal ? (128 + (process.platform === 'win32' ? 0 : 1)) : (code || 0);
      resolve({ exitCode, output });
    });
  });
}

/**
 * Execute a command with input data
 */
export async function execCommandWithInput(args: string[], input: Buffer | string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (args.length === 0) {
      reject(new GitCryptError('No command specified'));
      return;
    }

    const [command, ...commandArgs] = args;
    const options: SpawnOptions = {
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: false
    };

    const child = spawn(command, commandArgs, options);

    child.on('error', (error: Error) => {
      reject(new SystemError('exec', command, (error as any).errno || -1));
    });

    if (child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }

    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (signal) {
        resolve(128 + (process.platform === 'win32' ? 0 : 1));
      } else {
        resolve(code || 0);
      }
    });
  });
}

/**
 * Touch a file (create if doesn't exist, update timestamp if exists)
 */
export async function touchFile(filePath: string): Promise<void> {
  try {
    const now = new Date();
    await fs.promises.utimes(filePath, now, now);
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      // File doesn't exist, create it
      try {
        await fs.promises.writeFile(filePath, '', { flag: 'w' });
      } catch (createError) {
        throw new SystemError('touch', filePath, (createError as any).errno || -1);
      }
    } else {
      throw new SystemError('touch', filePath, (error as any).errno || -1);
    }
  }
}

/**
 * Remove a file (ignore if doesn't exist)
 */
export async function removeFile(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if ((error as any).code !== 'ENOENT') {
      throw new SystemError('unlink', filePath, (error as any).errno || -1);
    }
    // Ignore ENOENT errors
  }
}

/**
 * Escape shell argument for safe command execution
 */
export function escapeShellArg(str: string): string {
  if (process.platform === 'win32') {
    // Windows shell escaping
    return `"${str.replace(/([\\"])/g, '\\$1')}"`;
  } else {
    // Unix shell escaping
    return `"${str.replace(/([\\"])/g, '\\$1').replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`;
  }
}

/**
 * Load a 32-bit big-endian integer from bytes
 */
export function loadBe32(buffer: Uint8Array, offset = 0): number {
  return ((buffer[offset] << 24) | 
          (buffer[offset + 1] << 16) | 
          (buffer[offset + 2] << 8) | 
          buffer[offset + 3]) >>> 0; // Convert to unsigned 32-bit
}

/**
 * Store a 32-bit big-endian integer to bytes
 */
export function storeBe32(buffer: Uint8Array, value: number, offset = 0): void {
  buffer[offset] = (value >>> 24) & 0xff;
  buffer[offset + 1] = (value >>> 16) & 0xff;
  buffer[offset + 2] = (value >>> 8) & 0xff;
  buffer[offset + 3] = value & 0xff;
}

/**
 * Read a 32-bit big-endian integer from a readable stream
 */
export async function readBe32(stream: Readable): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const buffer = Buffer.alloc(4);
    let bytesRead = 0;

    const onData = (chunk: Buffer) => {
      const toCopy = Math.min(chunk.length, 4 - bytesRead);
      chunk.copy(buffer, bytesRead, 0, toCopy);
      bytesRead += toCopy;

      if (bytesRead === 4) {
        stream.removeListener('data', onData);
        stream.removeListener('end', onEnd);
        stream.removeListener('error', onError);
        resolve(loadBe32(buffer));
      }
    };

    const onEnd = () => {
      stream.removeListener('data', onData);
      stream.removeListener('error', onError);
      resolve(null);
    };

    const onError = (error: Error) => {
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      reject(error);
    };

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}

/**
 * Write a 32-bit big-endian integer to a writable stream
 */
export async function writeBe32(stream: Writable, value: number): Promise<void> {
  const buffer = Buffer.alloc(4);
  storeBe32(buffer, value);
  
  return new Promise((resolve, reject) => {
    stream.write(buffer, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Explicit memory clear that won't be optimized away
 */
export function explicitMemset(buffer: Uint8Array, value: number): void {
  // Use a volatile-like approach to prevent optimization
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = value;
  }
  // Additional measures to prevent optimization
  if (buffer.length > 0) {
    buffer[0] = buffer[0] | 0;
  }
}

/**
 * Constant-time memory comparison to prevent timing attacks
 */
export function leaklessEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
}

/**
 * Create a file accessible only by the current user
 */
export async function createProtectedFile(filePath: string): Promise<void> {
  try {
    await mkdirParent(filePath);
    await fs.promises.writeFile(filePath, '', { mode: 0o600 });
  } catch (error) {
    throw new SystemError('create_protected_file', filePath, (error as any).errno || -1);
  }
}

/**
 * Rename a file atomically
 */
export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  try {
    await fs.promises.rename(oldPath, newPath);
  } catch (error) {
    throw new SystemError('rename', `${oldPath} -> ${newPath}`, (error as any).errno || -1);
  }
}

/**
 * Get directory contents
 */
export async function getDirectoryContents(dirPath: string): Promise<string[]> {
  try {
    return await fs.promises.readdir(dirPath);
  } catch (error) {
    throw new SystemError('readdir', dirPath, (error as any).errno || -1);
  }
}

/**
 * Check if a file or directory exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if path is a directory
 */
export async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get file size
 */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.size;
  } catch (error) {
    throw new SystemError('stat', filePath, (error as any).errno || -1);
  }
}

/**
 * Initialize standard streams for performance
 */
export function initStdStreams(): void {
  // In Node.js, streams are already optimized
  // This is mainly for compatibility with the C++ version
  if (process.stdin.setEncoding) {
    process.stdin.setEncoding('binary');
  }
  if (process.stdout.setEncoding) {
    process.stdout.setEncoding('binary');
  }
}