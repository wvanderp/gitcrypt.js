/*
 * TypeScript implementation of git-crypt key management
 * Reference: git-crypt/key.cpp, git-crypt/key.hpp
 */

import * as fs from 'fs';
import { Readable, Writable } from 'stream';
import { loadBe32, storeBe32, readBe32, writeBe32, explicitMemset } from './util';
import { randomBytes, AES_KEY_LEN, HMAC_KEY_LEN } from './crypto';

export { AES_KEY_LEN, HMAC_KEY_LEN };

/**
 * Key file format version
 */
export const FORMAT_VERSION = 2;

/**
 * Maximum key name length
 */
export const KEY_NAME_MAX_LEN = 128;

/**
 * Field IDs for header fields
 */
export enum HeaderField {
  END = 0,
  KEY_NAME = 1
}

/**
 * Field IDs for key entry fields
 */
export enum KeyField {
  END = 0,
  VERSION = 1,
  AES_KEY = 3,
  HMAC_KEY = 5
}

/**
 * Maximum field length to prevent malicious files
 */
export const MAX_FIELD_LEN = 1 << 20; // 1MB

/**
 * Exception for malformed key files
 */
export class MalformedKeyFileError extends Error {
  constructor(message = 'Malformed key file') {
    super(message);
    this.name = 'MalformedKeyFileError';
  }
}

/**
 * Exception for incompatible key file versions
 */
export class IncompatibleKeyFileError extends Error {
  constructor(message = 'Incompatible key file version') {
    super(message);
    this.name = 'IncompatibleKeyFileError';
  }
}

/**
 * A single key entry containing AES and HMAC keys
 */
export class KeyEntry {
  public version: number;
  public aesKey: Uint8Array;
  public hmacKey: Uint8Array;

  constructor() {
    this.version = 0;
    this.aesKey = new Uint8Array(AES_KEY_LEN);
    this.hmacKey = new Uint8Array(HMAC_KEY_LEN);
  }

  /**
   * Load key entry from stream
   */
  async load(stream: Readable): Promise<void> {
    while (true) {
      const fieldId = await readBe32(stream);
      if (fieldId === null) {
        throw new MalformedKeyFileError('Unexpected end of stream while reading field ID');
      }

      if (fieldId === KeyField.END) {
        break;
      }

      const fieldLen = await readBe32(stream);
      if (fieldLen === null) {
        throw new MalformedKeyFileError('Unexpected end of stream while reading field length');
      }

      if (fieldId === KeyField.VERSION) {
        if (fieldLen !== 4) {
          throw new MalformedKeyFileError(`Invalid version field length: ${fieldLen}`);
        }
        const version = await readBe32(stream);
        if (version === null) {
          throw new MalformedKeyFileError('Failed to read version');
        }
        this.version = version;
      } else if (fieldId === KeyField.AES_KEY) {
        if (fieldLen !== AES_KEY_LEN) {
          throw new MalformedKeyFileError(`Invalid AES key field length: ${fieldLen}`);
        }
        await this.readBytes(stream, this.aesKey, AES_KEY_LEN);
      } else if (fieldId === KeyField.HMAC_KEY) {
        if (fieldLen !== HMAC_KEY_LEN) {
          throw new MalformedKeyFileError(`Invalid HMAC key field length: ${fieldLen}`);
        }
        await this.readBytes(stream, this.hmacKey, HMAC_KEY_LEN);
      } else if (fieldId & 1) {
        // Unknown critical field
        throw new IncompatibleKeyFileError(`Unknown critical field: ${fieldId}`);
      } else {
        // Unknown non-critical field - safe to ignore
        if (fieldLen > MAX_FIELD_LEN) {
          throw new MalformedKeyFileError(`Field length too large: ${fieldLen}`);
        }
        await this.skipBytes(stream, fieldLen);
      }
    }
  }

  /**
   * Load legacy key entry format
   */
  async loadLegacy(version: number, stream: Readable): Promise<void> {
    this.version = version;

    // Read AES key
    await this.readBytes(stream, this.aesKey, AES_KEY_LEN);

    // Read HMAC key
    await this.readBytes(stream, this.hmacKey, HMAC_KEY_LEN);

    // Check for trailing data
    const nextByte = stream.read(1);
    if (nextByte !== null) {
      throw new MalformedKeyFileError('Unexpected trailing data in legacy key file');
    }
  }

  /**
   * Store key entry to stream
   */
  async store(stream: Writable): Promise<void> {
    // Version field
    await writeBe32(stream, KeyField.VERSION);
    await writeBe32(stream, 4);
    await writeBe32(stream, this.version);

    // AES key field
    await writeBe32(stream, KeyField.AES_KEY);
    await writeBe32(stream, AES_KEY_LEN);
    await this.writeBytes(stream, this.aesKey);

    // HMAC key field
    await writeBe32(stream, KeyField.HMAC_KEY);
    await writeBe32(stream, HMAC_KEY_LEN);
    await this.writeBytes(stream, this.hmacKey);

    // End field
    await writeBe32(stream, KeyField.END);
  }

  /**
   * Generate new random keys
   */
  generate(version: number): void {
    this.version = version;
    randomBytes(this.aesKey);
    randomBytes(this.hmacKey);
  }

  /**
   * Clear sensitive key data
   */
  destroy(): void {
    explicitMemset(this.aesKey, 0);
    explicitMemset(this.hmacKey, 0);
  }

  /**
   * Helper to read exact number of bytes
   */
  private async readBytes(stream: Readable, buffer: Uint8Array, length: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let bytesRead = 0;
      const tempBuffer = Buffer.alloc(length);

      const onData = (chunk: Buffer) => {
        const toCopy = Math.min(chunk.length, length - bytesRead);
        chunk.copy(tempBuffer, bytesRead, 0, toCopy);
        bytesRead += toCopy;

        if (bytesRead === length) {
          stream.removeListener('data', onData);
          stream.removeListener('end', onEnd);
          stream.removeListener('error', onError);
          buffer.set(tempBuffer);
          resolve();
        }
      };

      const onEnd = () => {
        stream.removeListener('data', onData);
        stream.removeListener('error', onError);
        reject(new MalformedKeyFileError(`Unexpected end of stream, read ${bytesRead}/${length} bytes`));
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
   * Helper to skip bytes in stream
   */
  private async skipBytes(stream: Readable, length: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let bytesSkipped = 0;

      const onData = (chunk: Buffer) => {
        const toSkip = Math.min(chunk.length, length - bytesSkipped);
        bytesSkipped += toSkip;

        if (bytesSkipped === length) {
          stream.removeListener('data', onData);
          stream.removeListener('end', onEnd);
          stream.removeListener('error', onError);
          resolve();
        }
      };

      const onEnd = () => {
        stream.removeListener('data', onData);
        stream.removeListener('error', onError);
        reject(new MalformedKeyFileError(`Unexpected end of stream while skipping ${bytesSkipped}/${length} bytes`));
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
   * Helper to write bytes to stream
   */
  private async writeBytes(stream: Writable, buffer: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      stream.write(Buffer.from(buffer), (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

/**
 * Git-crypt key file containing multiple key entries
 */
export class KeyFile {
  private entries: Map<number, KeyEntry>;
  private keyName: string;

  constructor() {
    this.entries = new Map();
    this.keyName = '';
  }

  /**
   * Get the latest (highest version) key entry
   */
  getLatest(): KeyEntry | null {
    if (this.isEmpty()) {
      return null;
    }
    const latestVersion = this.getLatestVersion();
    return this.get(latestVersion);
  }

  /**
   * Get key entry by version
   */
  get(version: number): KeyEntry | null {
    return this.entries.get(version) || null;
  }

  /**
   * Add a key entry
   */
  add(entry: KeyEntry): void {
    this.entries.set(entry.version, entry);
  }

  /**
   * Load key file from legacy format
   */
  async loadLegacy(stream: Readable): Promise<void> {
    const entry = new KeyEntry();
    await entry.loadLegacy(0, stream);
    this.add(entry);
  }

  /**
   * Load key file from new format
   */
  async load(stream: Readable): Promise<void> {
    // Read preamble
    const preamble = await this.readExactBytes(stream, 16);
    
    // Check magic bytes
    const expectedMagic = Buffer.from('\0GITCRYPTKEY', 'utf8');
    if (!preamble.slice(0, 12).equals(expectedMagic)) {
      throw new MalformedKeyFileError('Invalid magic bytes');
    }

    // Check format version
    const formatVersion = loadBe32(preamble, 12);
    if (formatVersion !== FORMAT_VERSION) {
      throw new IncompatibleKeyFileError(`Unsupported format version: ${formatVersion}`);
    }

    // Load header
    await this.loadHeader(stream);

    // Load key entries
    while (true) {
      // Check if there's more data
      const nextByte = stream.read(1);
      if (nextByte === null) {
        break;
      }
      
      // Put the byte back and read the entry
      stream.unshift(nextByte);
      const entry = new KeyEntry();
      await entry.load(stream);
      this.add(entry);
    }
  }

  /**
   * Store key file to stream
   */
  async store(stream: Writable): Promise<void> {
    // Write preamble
    const preamble = Buffer.alloc(16);
    Buffer.from('\0GITCRYPTKEY', 'utf8').copy(preamble, 0);
    storeBe32(preamble, FORMAT_VERSION, 12);
    await this.writeBuffer(stream, preamble);

    // Store header
    await this.storeHeader(stream);

    // Store key entries (sorted by version descending)
    const sortedVersions = Array.from(this.entries.keys()).sort((a, b) => b - a);
    for (const version of sortedVersions) {
      const entry = this.entries.get(version)!;
      await entry.store(stream);
    }
  }

  /**
   * Load key file from file
   */
  async loadFromFile(filename: string): Promise<boolean> {
    try {
      // Read entire file into buffer for easier parsing
      const fileBuffer = fs.readFileSync(filename);
      
      // Try new format first
      try {
        await this.loadFromBuffer(fileBuffer);
        return true;
      } catch (error) {
        if (error instanceof MalformedKeyFileError || error instanceof IncompatibleKeyFileError) {
          // Try legacy format
          try {
            await this.loadLegacyFromBuffer(fileBuffer);
            return true;
          } catch (legacyError) {
            throw error; // Throw original error
          }
        }
        throw error;
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * Store key file to file
   */
  async storeToFile(filename: string): Promise<boolean> {
    try {
      const stream = fs.createWriteStream(filename, { mode: 0o600 });
      await this.store(stream);
      
      // Wait for stream to finish writing
      return new Promise((resolve, reject) => {
        stream.end((error?: Error | null) => {
          if (error) {
            reject(error);
          } else {
            resolve(true);
          }
        });
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * Convert key file to string
   */
  async storeToString(): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = new Writable({
        write(chunk: any, encoding: any, callback: any) {
          chunks.push(chunk);
          callback();
        }
      });

      try {
        await this.store(stream);
        stream.end();
        resolve(Buffer.concat(chunks).toString('binary'));
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Generate new key file with single entry
   */
  generate(): void {
    this.entries.clear();
    const entry = new KeyEntry();
    entry.generate(FORMAT_VERSION);
    this.add(entry);
  }

  /**
   * Check if key file is empty
   */
  isEmpty(): boolean {
    return this.entries.size === 0;
  }

  /**
   * Check if key file has entries
   */
  isFilled(): boolean {
    return !this.isEmpty();
  }

  /**
   * Get latest version number
   */
  getLatestVersion(): number {
    if (this.isEmpty()) {
      throw new Error('No key entries available');
    }
    return Math.max(...this.entries.keys());
  }

  /**
   * Set key name
   */
  setKeyName(keyName: string | null): void {
    this.keyName = keyName || '';
  }

  /**
   * Get key name
   */
  getKeyName(): string | null {
    return this.keyName || null;
  }

  /**
   * Destroy all sensitive data
   */
  destroy(): void {
    for (const entry of this.entries.values()) {
      entry.destroy();
    }
    this.entries.clear();
  }

  /**
   * Load header from stream
   */
  private async loadHeader(stream: Readable): Promise<void> {
    while (true) {
      const fieldId = await readBe32(stream);
      if (fieldId === null) {
        throw new MalformedKeyFileError('Unexpected end of stream while reading header field ID');
      }

      if (fieldId === HeaderField.END) {
        break;
      }

      const fieldLen = await readBe32(stream);
      if (fieldLen === null) {
        throw new MalformedKeyFileError('Unexpected end of stream while reading header field length');
      }

      if (fieldId === HeaderField.KEY_NAME) {
        if (fieldLen > KEY_NAME_MAX_LEN) {
          throw new MalformedKeyFileError(`Key name too long: ${fieldLen}`);
        }
        const keyNameBuffer = await this.readExactBytes(stream, fieldLen);
        this.keyName = keyNameBuffer.toString('utf8');
      } else if (fieldId & 1) {
        // Unknown critical field
        throw new IncompatibleKeyFileError(`Unknown critical header field: ${fieldId}`);
      } else {
        // Unknown non-critical field - safe to ignore
        if (fieldLen > MAX_FIELD_LEN) {
          throw new MalformedKeyFileError(`Header field length too large: ${fieldLen}`);
        }
        await this.skipExactBytes(stream, fieldLen);
      }
    }
  }

  /**
   * Store header to stream
   */
  private async storeHeader(stream: Writable): Promise<void> {
    if (this.keyName) {
      await writeBe32(stream, HeaderField.KEY_NAME);
      const keyNameBuffer = Buffer.from(this.keyName, 'utf8');
      await writeBe32(stream, keyNameBuffer.length);
      await this.writeBuffer(stream, keyNameBuffer);
    }
    await writeBe32(stream, HeaderField.END);
  }

  /**
   * Read exact number of bytes from stream
   */
  private async readExactBytes(stream: Readable, length: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let bytesRead = 0;
      const buffer = Buffer.alloc(length);

      const onData = (chunk: Buffer) => {
        const toCopy = Math.min(chunk.length, length - bytesRead);
        chunk.copy(buffer, bytesRead, 0, toCopy);
        bytesRead += toCopy;

        if (bytesRead === length) {
          stream.removeListener('data', onData);
          stream.removeListener('end', onEnd);
          stream.removeListener('error', onError);
          resolve(buffer);
        }
      };

      const onEnd = () => {
        stream.removeListener('data', onData);
        stream.removeListener('error', onError);
        reject(new MalformedKeyFileError(`Unexpected end of stream, read ${bytesRead}/${length} bytes`));
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
   * Skip exact number of bytes in stream
   */
  private async skipExactBytes(stream: Readable, length: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let bytesSkipped = 0;

      const onData = (chunk: Buffer) => {
        const toSkip = Math.min(chunk.length, length - bytesSkipped);
        bytesSkipped += toSkip;

        if (bytesSkipped === length) {
          stream.removeListener('data', onData);
          stream.removeListener('end', onEnd);
          stream.removeListener('error', onError);
          resolve();
        }
      };

      const onEnd = () => {
        stream.removeListener('data', onData);
        stream.removeListener('error', onError);
        reject(new MalformedKeyFileError(`Unexpected end of stream while skipping ${bytesSkipped}/${length} bytes`));
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
   * Write buffer to stream
   */
  private async writeBuffer(stream: Writable, buffer: Buffer): Promise<void> {
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
}

/**
 * Validate key name
 */
export function validateKeyName(keyName: string): { valid: boolean; reason?: string } {
  if (!keyName) {
    return { valid: false, reason: 'Key name cannot be empty' };
  }

  if (keyName.length > KEY_NAME_MAX_LEN) {
    return { valid: false, reason: `Key name too long (max ${KEY_NAME_MAX_LEN} characters)` };
  }

  // Check for invalid characters (control characters, path separators, etc.)
  if (/[\x00-\x1f\x7f\\\/\:]/.test(keyName)) {
    return { valid: false, reason: 'Key name contains invalid characters' };
  }

  return { valid: true };
}