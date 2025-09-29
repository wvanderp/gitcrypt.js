import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AesCtrEncryptor,
  AesCtrDecryptor,
  HmacSha1State,
  randomBytes,
  CryptoError,
  AES_KEY_LEN,
  HMAC_KEY_LEN
} from '../../src/crypto';

describe('Crypto Functions', () => {
  describe('Random bytes generation', () => {
    it('should generate random bytes of correct length', () => {
      const buffer = new Uint8Array(32);
      randomBytes(buffer);
      
      // Check that the buffer is not all zeros (very unlikely with random data)
      const isAllZeros = buffer.every(byte => byte === 0);
      expect(isAllZeros).toBe(false);
    });

    it('should generate different random bytes on subsequent calls', () => {
      const buffer1 = new Uint8Array(16);
      const buffer2 = new Uint8Array(16);
      
      randomBytes(buffer1);
      randomBytes(buffer2);
      
      // Buffers should be different (extremely unlikely to be the same)
      const areSame = buffer1.every((byte, index) => byte === buffer2[index]);
      expect(areSame).toBe(false);
    });

    it('should throw error for invalid buffer length', () => {
      const buffer = new Uint8Array(10);
      
      expect(() => randomBytes(buffer, 20)).toThrow(CryptoError);
    });
  });

  describe('AES-CTR Encryption/Decryption', () => {
    let key: Uint8Array;
    let nonce: Uint8Array;

    beforeEach(() => {
      key = new Uint8Array(AES_KEY_LEN);
      nonce = new Uint8Array(AesCtrEncryptor.NONCE_LEN);
      randomBytes(key);
      randomBytes(nonce);
    });

    it('should encrypt and decrypt data correctly', () => {
      const plaintext = new TextEncoder().encode('Hello, World! This is a test message.');
      const encrypted = new Uint8Array(plaintext.length);
      const decrypted = new Uint8Array(plaintext.length);

      // Encrypt
      const encryptor = new AesCtrEncryptor(key, nonce);
      encryptor.process(plaintext, encrypted);
      encryptor.destroy();

      // Decrypt
      const decryptor = new AesCtrDecryptor(key, nonce);
      decryptor.process(encrypted, decrypted);
      decryptor.destroy();

      // Verify
      expect(new TextDecoder().decode(decrypted)).toBe('Hello, World! This is a test message.');
    });

    it('should produce different ciphertext with different nonces', () => {
      const plaintext = new TextEncoder().encode('Test message');
      const nonce1 = new Uint8Array(AesCtrEncryptor.NONCE_LEN);
      const nonce2 = new Uint8Array(AesCtrEncryptor.NONCE_LEN);
      randomBytes(nonce1);
      randomBytes(nonce2);

      const encrypted1 = new Uint8Array(plaintext.length);
      const encrypted2 = new Uint8Array(plaintext.length);

      // Encrypt with first nonce
      const encryptor1 = new AesCtrEncryptor(key, nonce1);
      encryptor1.process(plaintext, encrypted1);
      encryptor1.destroy();

      // Encrypt with second nonce
      const encryptor2 = new AesCtrEncryptor(key, nonce2);
      encryptor2.process(plaintext, encrypted2);
      encryptor2.destroy();

      // Results should be different
      const areSame = encrypted1.every((byte, index) => byte === encrypted2[index]);
      expect(areSame).toBe(false);
    });

    it('should handle empty data', () => {
      const plaintext = new Uint8Array(0);
      const encrypted = new Uint8Array(0);

      const encryptor = new AesCtrEncryptor(key, nonce);
      expect(() => encryptor.process(plaintext, encrypted)).not.toThrow();
      encryptor.destroy();
    });

    it('should throw error for invalid key length', () => {
      const invalidKey = new Uint8Array(16); // Wrong length
      expect(() => new AesCtrEncryptor(invalidKey, nonce)).toThrow(CryptoError);
    });

    it('should throw error for invalid nonce length', () => {
      const invalidNonce = new Uint8Array(8); // Wrong length
      expect(() => new AesCtrEncryptor(key, invalidNonce)).toThrow(CryptoError);
    });
  });

  describe('HMAC-SHA1', () => {
    let key: Uint8Array;

    beforeEach(() => {
      key = new Uint8Array(HMAC_KEY_LEN);
      randomBytes(key);
    });

    it('should compute HMAC-SHA1 correctly', () => {
      const message = new TextEncoder().encode('Hello, World!');
      const hmac = new HmacSha1State(key);
      
      hmac.add(message);
      
      const digest = new Uint8Array(HmacSha1State.LEN);
      hmac.get(digest);
      
      expect(digest.length).toBe(20); // SHA1 digest length
      
      // Digest should not be all zeros
      const isAllZeros = digest.every(byte => byte === 0);
      expect(isAllZeros).toBe(false);
    });

    it('should produce same digest for same input', () => {
      const message = new TextEncoder().encode('Test message');
      
      const hmac1 = new HmacSha1State(key);
      hmac1.add(message);
      const digest1 = new Uint8Array(HmacSha1State.LEN);
      hmac1.get(digest1);
      
      const hmac2 = new HmacSha1State(key);
      hmac2.add(message);
      const digest2 = new Uint8Array(HmacSha1State.LEN);
      hmac2.get(digest2);
      
      expect(digest1).toEqual(digest2);
    });

    it('should produce different digests for different messages', () => {
      const message1 = new TextEncoder().encode('Message 1');
      const message2 = new TextEncoder().encode('Message 2');
      
      const hmac1 = new HmacSha1State(key);
      hmac1.add(message1);
      const digest1 = new Uint8Array(HmacSha1State.LEN);
      hmac1.get(digest1);
      
      const hmac2 = new HmacSha1State(key);
      hmac2.add(message2);
      const digest2 = new Uint8Array(HmacSha1State.LEN);
      hmac2.get(digest2);
      
      const areSame = digest1.every((byte, index) => byte === digest2[index]);
      expect(areSame).toBe(false);
    });

    it('should handle incremental updates', () => {
      const part1 = new TextEncoder().encode('Hello, ');
      const part2 = new TextEncoder().encode('World!');
      const full = new TextEncoder().encode('Hello, World!');
      
      // Compute HMAC incrementally
      const hmac1 = new HmacSha1State(key);
      hmac1.add(part1);
      hmac1.add(part2);
      const digest1 = new Uint8Array(HmacSha1State.LEN);
      hmac1.get(digest1);
      
      // Compute HMAC all at once
      const hmac2 = new HmacSha1State(key);
      hmac2.add(full);
      const digest2 = new Uint8Array(HmacSha1State.LEN);
      hmac2.get(digest2);
      
      expect(digest1).toEqual(digest2);
    });
  });
});