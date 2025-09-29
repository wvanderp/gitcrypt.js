/*
 * Public API for git-crypt TypeScript library
 * This module provides a high-level API for using git-crypt functionality
 * in Node.js and browser environments
 */

// Re-export core functionality
export {
  // Crypto primitives
  AesCtrEncryptor,
  AesCtrDecryptor,
  HmacSha1State,
  randomBytes,
  initCrypto,
  CryptoError,
  AES_KEY_LEN,
  HMAC_KEY_LEN
} from './crypto';

export {
  // Key management
  KeyFile,
  KeyEntry,
  validateKeyName,
  MalformedKeyFileError,
  IncompatibleKeyFileError,
  FORMAT_VERSION,
  KEY_NAME_MAX_LEN
} from './key';

export {
  // Utilities
  SystemError,
  GitCryptError,
  explicitMemset,
  leaklessEquals,
  loadBe32,
  storeBe32
} from './util';

export {
  // File operations
  createReadStream,
  createWriteStream,
  copyStream,
  readFileToBuffer,
  writeBufferToFile,
  ChunkingStream,
  BlockAlignedStream,
  MemoryEfficientStream,
  createPipeline,
  DEFAULT_BUFFER_SIZE
} from './fileStream';

export {
  // Commands (for programmatic use)
  CommandError
} from './commands';

export {
  // Main CLI interface
  main,
  VERSION
} from './gitCrypt';

// High-level API functions

/**
 * Encrypt a file using AES-CTR with the provided key
 */
export async function encryptFile(
  inputPath: string,
  outputPath: string,
  aesKey: Uint8Array,
  hmacKey: Uint8Array,
  nonce?: Uint8Array
): Promise<void> {
  const { createReadStream, createWriteStream } = await import('./fileStream');
  const { AesCtrEncryptor, randomBytes } = await import('./crypto');
  
  if (!nonce) {
    nonce = new Uint8Array(AesCtrEncryptor.NONCE_LEN);
    randomBytes(nonce);
  }

  const inputStream = await createReadStream(inputPath);
  const outputStream = await createWriteStream(outputPath);

  try {
    await AesCtrEncryptor.processStream(inputStream, outputStream, aesKey, nonce);
  } finally {
    inputStream.destroy();
    outputStream.destroy();
  }
}

/**
 * Decrypt a file using AES-CTR with the provided key
 */
export async function decryptFile(
  inputPath: string,
  outputPath: string,
  aesKey: Uint8Array,
  hmacKey: Uint8Array,
  nonce: Uint8Array
): Promise<void> {
  const { createReadStream, createWriteStream } = await import('./fileStream');
  const { AesCtrDecryptor } = await import('./crypto');

  const inputStream = await createReadStream(inputPath);
  const outputStream = await createWriteStream(outputPath);

  try {
    await AesCtrDecryptor.processStream(inputStream, outputStream, aesKey, nonce);
  } finally {
    inputStream.destroy();
    outputStream.destroy();
  }
}

/**
 * Generate a new git-crypt key
 */
export function generateKey(): { aesKey: Uint8Array; hmacKey: Uint8Array } {
  const { randomBytes, AES_KEY_LEN, HMAC_KEY_LEN } = require('./crypto');
  
  const aesKey = new Uint8Array(AES_KEY_LEN);
  const hmacKey = new Uint8Array(HMAC_KEY_LEN);
  
  randomBytes(aesKey);
  randomBytes(hmacKey);
  
  return { aesKey, hmacKey };
}

/**
 * Load a key from a git-crypt key file
 */
export async function loadKey(keyPath: string): Promise<{ aesKey: Uint8Array; hmacKey: Uint8Array }> {
  const { KeyFile } = await import('./key');
  
  const keyFile = new KeyFile();
  const success = await keyFile.loadFromFile(keyPath);
  
  if (!success) {
    throw new Error(`Failed to load key from ${keyPath}`);
  }
  
  const entry = keyFile.getLatest();
  if (!entry) {
    throw new Error('No key entries found in key file');
  }
  
  const result = {
    aesKey: new Uint8Array(entry.aesKey),
    hmacKey: new Uint8Array(entry.hmacKey)
  };
  
  // Clean up sensitive data
  keyFile.destroy();
  
  return result;
}

/**
 * Save a key to a git-crypt key file
 */
export async function saveKey(
  aesKey: Uint8Array,
  hmacKey: Uint8Array,
  keyPath: string,
  keyName?: string
): Promise<void> {
  const { KeyFile, KeyEntry, FORMAT_VERSION } = await import('./key');
  
  const keyFile = new KeyFile();
  const entry = new KeyEntry();
  
  entry.version = FORMAT_VERSION;
  entry.aesKey.set(aesKey);
  entry.hmacKey.set(hmacKey);
  
  keyFile.add(entry);
  
  if (keyName) {
    keyFile.setKeyName(keyName);
  }
  
  const success = await keyFile.storeToFile(keyPath);
  
  // Clean up sensitive data
  keyFile.destroy();
  
  if (!success) {
    throw new Error(`Failed to save key to ${keyPath}`);
  }
}

/**
 * Initialize a git repository with git-crypt
 */
export async function initRepository(repoPath: string, keyName?: string): Promise<void> {
  const originalCwd = process.cwd();
  
  try {
    process.chdir(repoPath);
    const { init } = await import('./commands');
    
    const args = keyName ? ['-k', keyName] : [];
    const exitCode = await init(args);
    
    if (exitCode !== 0) {
      throw new Error(`git-crypt init failed with exit code ${exitCode}`);
    }
  } finally {
    process.chdir(originalCwd);
  }
}

/**
 * Unlock a git repository with a key file
 */
export async function unlockRepository(repoPath: string, keyPath: string): Promise<void> {
  const originalCwd = process.cwd();
  
  try {
    process.chdir(repoPath);
    const { unlock } = await import('./commands');
    
    const exitCode = await unlock([keyPath]);
    
    if (exitCode !== 0) {
      throw new Error(`git-crypt unlock failed with exit code ${exitCode}`);
    }
  } finally {
    process.chdir(originalCwd);
  }
}

/**
 * Lock a git repository (re-encrypt files)
 */
export async function lockRepository(repoPath: string, keyName?: string): Promise<void> {
  const originalCwd = process.cwd();
  
  try {
    process.chdir(repoPath);
    const { lock } = await import('./commands');
    
    const args = keyName ? ['-k', keyName] : [];
    const exitCode = await lock(args);
    
    if (exitCode !== 0) {
      throw new Error(`git-crypt lock failed with exit code ${exitCode}`);
    }
  } finally {
    process.chdir(originalCwd);
  }
}

/**
 * Get the status of encrypted files in a repository
 */
export async function getRepositoryStatus(repoPath: string): Promise<string[]> {
  const originalCwd = process.cwd();
  
  try {
    process.chdir(repoPath);
    // For now, return empty array - would need to implement getEncryptedFiles export
    return [];
  } catch (error) {
    return [];
  } finally {
    process.chdir(originalCwd);
  }
}

/**
 * Browser-compatible API (subset of functionality)
 */
export const browser = {
  // Crypto operations that work in browser
  generateKey,
  
  // File operations using Blob/ArrayBuffer
  async encryptBuffer(
    input: ArrayBuffer,
    aesKey: Uint8Array,
    hmacKey: Uint8Array,
    nonce?: Uint8Array
  ): Promise<ArrayBuffer> {
    const { AesCtrEncryptor, randomBytes } = await import('./crypto');
    
    if (!nonce) {
      nonce = new Uint8Array(AesCtrEncryptor.NONCE_LEN);
      randomBytes(nonce);
    }

    const inputArray = new Uint8Array(input);
    const outputArray = new Uint8Array(inputArray.length);
    
    const encryptor = new AesCtrEncryptor(aesKey, nonce);
    encryptor.process(inputArray, outputArray);
    encryptor.destroy();
    
    return outputArray.buffer;
  },

  async decryptBuffer(
    input: ArrayBuffer,
    aesKey: Uint8Array,
    hmacKey: Uint8Array,
    nonce: Uint8Array
  ): Promise<ArrayBuffer> {
    const { AesCtrDecryptor } = await import('./crypto');
    
    const inputArray = new Uint8Array(input);
    const outputArray = new Uint8Array(inputArray.length);
    
    const decryptor = new AesCtrDecryptor(aesKey, nonce);
    decryptor.process(inputArray, outputArray);
    decryptor.destroy();
    
    return outputArray.buffer;
  }
};