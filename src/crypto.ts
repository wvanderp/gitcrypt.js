/*
 * TypeScript implementation of git-crypt cryptographic functions
 * Reference: git-crypt/crypto.cpp, git-crypt/crypto-openssl-11.cpp
 */

import * as crypto from 'crypto';
import { Readable, Writable } from 'stream';
import { explicitMemset, storeBe32 } from './util';

export const AES_KEY_LEN = 32;
export const HMAC_KEY_LEN = 64;

/**
 * Cryptographic error for encryption/decryption operations
 */
export class CryptoError extends Error {
  public readonly where: string;

  constructor(where: string, message: string) {
    super(`${where}: ${message}`);
    this.name = 'CryptoError';
    this.where = where;
  }
}

/**
 * AES ECB encryptor for generating encryption pads
 */
export class AesEcbEncryptor {
  public static readonly KEY_LEN = AES_KEY_LEN;
  public static readonly BLOCK_LEN = 16;

  private key: Buffer;

  constructor(key: Uint8Array) {
    if (key.length !== AesEcbEncryptor.KEY_LEN) {
      throw new CryptoError('AesEcbEncryptor', `Invalid key length: ${key.length}, expected ${AesEcbEncryptor.KEY_LEN}`);
    }

    this.key = Buffer.from(key);
  }

  /**
   * Encrypt a single block (16 bytes)
   */
  encrypt(plaintext: Uint8Array, ciphertext: Uint8Array): void {
    if (plaintext.length !== AesEcbEncryptor.BLOCK_LEN) {
      throw new CryptoError('AesEcbEncryptor.encrypt', `Invalid plaintext length: ${plaintext.length}`);
    }
    if (ciphertext.length !== AesEcbEncryptor.BLOCK_LEN) {
      throw new CryptoError('AesEcbEncryptor.encrypt', `Invalid ciphertext length: ${ciphertext.length}`);
    }

    try {
      // Use createCipheriv for ECB mode with specific key
      const cipher = crypto.createCipheriv('aes-256-ecb', this.key, null);
      cipher.setAutoPadding(false);
      
      const plaintextBuffer = Buffer.from(plaintext);
      const encrypted = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
      
      if (encrypted.length !== AesEcbEncryptor.BLOCK_LEN) {
        throw new CryptoError('AesEcbEncryptor.encrypt', `Unexpected encrypted length: ${encrypted.length}`);
      }
      
      ciphertext.set(encrypted);
    } catch (error) {
      throw new CryptoError('AesEcbEncryptor.encrypt', `Encryption failed: ${error}`);
    }
  }
}

/**
 * AES CTR mode encryptor/decryptor
 */
export class AesCtrEncryptor {
  public static readonly NONCE_LEN = 12;
  public static readonly KEY_LEN = AES_KEY_LEN;
  public static readonly BLOCK_LEN = 16;
  public static readonly MAX_CRYPT_BYTES = 0x100000000 * 16; // Don't encrypt more than this or the CTR value will repeat (2^32 * 16)

  private ecb: AesEcbEncryptor;
  private ctrValue: Uint8Array;
  private pad: Uint8Array;
  private byteCounter: number;

  constructor(key: Uint8Array, nonce: Uint8Array) {
    if (key.length !== AesCtrEncryptor.KEY_LEN) {
      throw new CryptoError('AesCtrEncryptor', `Invalid key length: ${key.length}, expected ${AesCtrEncryptor.KEY_LEN}`);
    }
    if (nonce.length !== AesCtrEncryptor.NONCE_LEN) {
      throw new CryptoError('AesCtrEncryptor', `Invalid nonce length: ${nonce.length}, expected ${AesCtrEncryptor.NONCE_LEN}`);
    }

    this.ecb = new AesEcbEncryptor(key);
    this.ctrValue = new Uint8Array(AesCtrEncryptor.BLOCK_LEN);
    this.pad = new Uint8Array(AesCtrEncryptor.BLOCK_LEN);
    this.byteCounter = 0;

    // Set first 12 bytes of the CTR value to the nonce
    this.ctrValue.set(nonce, 0);
  }

  /**
   * Clean up sensitive data
   */
  destroy(): void {
    explicitMemset(this.pad, 0);
    explicitMemset(this.ctrValue, 0);
  }

  /**
   * Process (encrypt/decrypt) data in-place
   */
  process(input: Uint8Array, output: Uint8Array, length?: number): void {
    const len = length !== undefined ? length : Math.min(input.length, output.length);
    
    if (len > input.length || len > output.length) {
      throw new CryptoError('AesCtrEncryptor.process', 'Length exceeds buffer size');
    }

    for (let i = 0; i < len; i++) {
      if (this.byteCounter % AesCtrEncryptor.BLOCK_LEN === 0) {
        // Set last 4 bytes of CTR to the (big-endian) block number
        const blockNumber = Math.floor(this.byteCounter / AesCtrEncryptor.BLOCK_LEN);
        storeBe32(this.ctrValue, blockNumber, AesCtrEncryptor.NONCE_LEN);

        // Generate a new pad
        this.ecb.encrypt(this.ctrValue, this.pad);
      }

      // Encrypt/decrypt one byte
      output[i] = input[i] ^ this.pad[this.byteCounter % AesCtrEncryptor.BLOCK_LEN];
      this.byteCounter++;

      // Check for wrap-around (only after a huge amount of data)
      if (this.byteCounter >= AesCtrEncryptor.MAX_CRYPT_BYTES) {
        throw new CryptoError('AesCtrEncryptor.process', 'Exceeded maximum secure encryption length');
      }
    }
  }

  /**
   * Process an entire stream
   */
  static async processStream(
    input: Readable,
    output: Writable,
    key: Uint8Array,
    nonce: Uint8Array
  ): Promise<void> {
    const encryptor = new AesCtrEncryptor(key, nonce);
    
    try {
      return new Promise((resolve, reject) => {
        const buffer = Buffer.alloc(1024);
        let processing = false;

        const processChunk = () => {
          if (processing) return;
          processing = true;

          const chunk = input.read();
          if (chunk === null) {
            if (input.readableEnded) {
              encryptor.destroy();
              resolve();
            } else {
              processing = false;
            }
            return;
          }

          try {
            const chunkSize = Math.min(chunk.length, buffer.length);
            const inputChunk = new Uint8Array(chunk.buffer, chunk.byteOffset, chunkSize);
            const outputChunk = new Uint8Array(chunkSize);
            
            encryptor.process(inputChunk, outputChunk, chunkSize);
            
            output.write(Buffer.from(outputChunk), (error) => {
              processing = false;
              if (error) {
                encryptor.destroy();
                reject(error);
              } else {
                setImmediate(processChunk);
              }
            });
          } catch (error) {
            encryptor.destroy();
            reject(error);
          }
        };

        input.on('readable', processChunk);
        input.on('end', processChunk);
        input.on('error', (error) => {
          encryptor.destroy();
          reject(error);
        });

        processChunk();
      });
    } catch (error) {
      encryptor.destroy();
      throw error;
    }
  }
}

/**
 * AES CTR decryptor (same as encryptor for CTR mode)
 */
export class AesCtrDecryptor extends AesCtrEncryptor {}

/**
 * HMAC-SHA1 implementation
 */
export class HmacSha1State {
  public static readonly LEN = 20;
  public static readonly KEY_LEN = HMAC_KEY_LEN;

  private hmac: crypto.Hmac;

  constructor(key: Uint8Array, keyLen?: number) {
    const actualKeyLen = keyLen !== undefined ? keyLen : key.length;
    if (actualKeyLen > key.length) {
      throw new CryptoError('HmacSha1State', `Key length ${actualKeyLen} exceeds buffer size ${key.length}`);
    }

    try {
      const keyBuffer = Buffer.from(key.slice(0, actualKeyLen));
      this.hmac = crypto.createHmac('sha1', keyBuffer);
    } catch (error) {
      throw new CryptoError('HmacSha1State', `Failed to create HMAC: ${error}`);
    }
  }

  /**
   * Add data to the HMAC calculation
   */
  add(buffer: Uint8Array, bufferLen?: number): void {
    const len = bufferLen !== undefined ? bufferLen : buffer.length;
    if (len > buffer.length) {
      throw new CryptoError('HmacSha1State.add', `Length ${len} exceeds buffer size ${buffer.length}`);
    }

    try {
      this.hmac.update(Buffer.from(buffer.slice(0, len)));
    } catch (error) {
      throw new CryptoError('HmacSha1State.add', `Failed to update HMAC: ${error}`);
    }
  }

  /**
   * Get the final HMAC digest
   */
  get(output: Uint8Array): void {
    if (output.length < HmacSha1State.LEN) {
      throw new CryptoError('HmacSha1State.get', `Output buffer too small: ${output.length}, need ${HmacSha1State.LEN}`);
    }

    try {
      const digest = this.hmac.digest();
      if (digest.length !== HmacSha1State.LEN) {
        throw new CryptoError('HmacSha1State.get', `Unexpected digest length: ${digest.length}`);
      }
      output.set(digest.slice(0, HmacSha1State.LEN));
    } catch (error) {
      throw new CryptoError('HmacSha1State.get', `Failed to get digest: ${error}`);
    }
  }
}

/**
 * Generate cryptographically secure random bytes
 */
export function randomBytes(buffer: Uint8Array, length?: number): void {
  const len = length !== undefined ? length : buffer.length;
  if (len > buffer.length) {
    throw new CryptoError('randomBytes', `Length ${len} exceeds buffer size ${buffer.length}`);
  }

  try {
    const randomBuffer = crypto.randomBytes(len);
    buffer.set(randomBuffer.slice(0, len));
  } catch (error) {
    throw new CryptoError('randomBytes', `Failed to generate random bytes: ${error}`);
  }
}

/**
 * Initialize crypto subsystem
 */
export function initCrypto(): void {
  // In Node.js, crypto is ready by default
  // This function exists for compatibility with the C++ version
}

/**
 * Compute HMAC-SHA1 of data
 */
export function computeHmacSha1(key: Uint8Array, data: Uint8Array): Uint8Array {
  const hmac = new HmacSha1State(key);
  hmac.add(data);
  const result = new Uint8Array(HmacSha1State.LEN);
  hmac.get(result);
  return result;
}