import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  KeyFile, 
  KeyEntry, 
  MalformedKeyFileError, 
  IncompatibleKeyFileError,
  AES_KEY_LEN,
  HMAC_KEY_LEN
} from '../../src/key';
import * as fs from 'fs';
import * as path from 'path';
import { Readable, Writable } from 'stream';

describe('Key Management', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-temp-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('KeyEntry', () => {
    it('should create empty key entry', () => {
      const entry = new KeyEntry();
      
      expect(entry.version).toBe(0);
      expect(entry.aesKey.length).toBe(AES_KEY_LEN);
      expect(entry.hmacKey.length).toBe(HMAC_KEY_LEN);
    });

    it('should generate random key entry', () => {
      const entry = new KeyEntry();
      entry.generate(2);
      
      expect(entry.version).toBe(2);
      
      // Keys should not be all zeros
      const aesAllZeros = entry.aesKey.every(byte => byte === 0);
      const hmacAllZeros = entry.hmacKey.every(byte => byte === 0);
      
      expect(aesAllZeros).toBe(false);
      expect(hmacAllZeros).toBe(false);
    });

    it('should store and load key entry', async () => {
      const entry = new KeyEntry();
      entry.generate(1);
      
      // Use file-based test instead of in-memory streams to avoid complexity
      const testFilePath = path.join(tempDir, 'entry-test.key');
      
      // Create a minimal KeyFile to test entry storage
      const keyFile = new KeyFile();
      keyFile.add(entry);
      
      const storeSuccess = await keyFile.storeToFile(testFilePath);
      expect(storeSuccess).toBe(true);
      
      // Check if file exists and has content
      expect(fs.existsSync(testFilePath)).toBe(true);
      const fileStats = fs.statSync(testFilePath);
      expect(fileStats.size).toBeGreaterThan(0);
      
      // Debug: examine file content
      const fileContent = fs.readFileSync(testFilePath);
      console.log('File size:', fileStats.size, 'bytes');
      console.log('File content (hex):', fileContent.toString('hex').slice(0, 64), '...');
      console.log('Expected header:', Buffer.from('\0GITCRYPTKEY', 'utf8').toString('hex'));
      
      // Load it back
      const loadedKeyFile = new KeyFile();
      const loadSuccess = await loadedKeyFile.loadFromFile(testFilePath);
      
      if (!loadSuccess) {
        // Debug: try to load with error details
        try {
          const debugStream = fs.createReadStream(testFilePath);
          await loadedKeyFile.load(debugStream);
        } catch (debugError) {
          console.error('Debug load error:', debugError);
        }
      }
      
      expect(loadSuccess).toBe(true);
      
      const loadedEntry = loadedKeyFile.get(1);
      expect(loadedEntry).not.toBe(null);
      expect(loadedEntry!.version).toBe(entry.version);
      expect(loadedEntry!.aesKey).toEqual(entry.aesKey);
      expect(loadedEntry!.hmacKey).toEqual(entry.hmacKey);
    });
  });

  describe('KeyFile', () => {
    let keyFile: KeyFile;

    beforeEach(() => {
      keyFile = new KeyFile();
    });

    it('should create empty key file', () => {
      expect(keyFile.isEmpty()).toBe(true);
      expect(keyFile.isFilled()).toBe(false);
    });

    it('should add key entries', () => {
      const entry1 = new KeyEntry();
      entry1.generate(1);
      
      const entry2 = new KeyEntry();
      entry2.generate(2);

      keyFile.add(entry1);
      keyFile.add(entry2);

      expect(keyFile.isEmpty()).toBe(false);
      expect(keyFile.isFilled()).toBe(true);
      expect(keyFile.getLatestVersion()).toBe(2);
      
      const latest = keyFile.getLatest();
      expect(latest?.version).toBe(2);
      
      const entry1Retrieved = keyFile.get(1);
      expect(entry1Retrieved?.version).toBe(1);
    });

    it('should save and load key file', async () => {
      const keyFilePath = path.join(tempDir, 'test.key');
      
      // Create key file with entries
      const entry1 = new KeyEntry();
      entry1.generate(1);
      const entry2 = new KeyEntry();
      entry2.generate(2);
      
      keyFile.add(entry1);
      keyFile.add(entry2);
      keyFile.setKeyName('test-key');

      // Save to file
      const success = await keyFile.storeToFile(keyFilePath);
      expect(success).toBe(true);

      // Load into new key file
      const loadedKeyFile = new KeyFile();
      const loadSuccess = await loadedKeyFile.loadFromFile(keyFilePath);
      expect(loadSuccess).toBe(true);

      expect(loadedKeyFile.getLatestVersion()).toBe(2);
      expect(loadedKeyFile.get(1)?.version).toBe(1);
      expect(loadedKeyFile.get(2)?.version).toBe(2);
    });

    it('should handle empty key file save/load', async () => {
      const keyFilePath = path.join(tempDir, 'empty.key');

      const success = await keyFile.storeToFile(keyFilePath);
      expect(success).toBe(true);

      const loadedKeyFile = new KeyFile();
      const loadSuccess = await loadedKeyFile.loadFromFile(keyFilePath);
      expect(loadSuccess).toBe(true);

      expect(loadedKeyFile.isEmpty()).toBe(true);
    });

    it('should generate new key file', () => {
      keyFile.generate();
      
      expect(keyFile.isFilled()).toBe(true);
      
      const latest = keyFile.getLatest();
      expect(latest?.version).toBe(2); // FORMAT_VERSION
      expect(latest?.aesKey.length).toBe(AES_KEY_LEN);
      expect(latest?.hmacKey.length).toBe(HMAC_KEY_LEN);
    });

    it('should convert to string', async () => {
      keyFile.generate();
      
      const keyString = await keyFile.storeToString();
      expect(typeof keyString).toBe('string');
      expect(keyString.length).toBeGreaterThan(0);
    });
  });

  describe('KeyFile Error Handling', () => {
    it('should handle non-existent file gracefully', async () => {
      const keyFile = new KeyFile();
      const nonExistentFile = path.join(tempDir, 'does-not-exist.key');

      const success = await keyFile.loadFromFile(nonExistentFile);
      expect(success).toBe(false);
    });

    it('should throw error for invalid key file format', async () => {
      const keyFile = new KeyFile();
      const invalidFilePath = path.join(tempDir, 'invalid.key');
      
      // Create invalid file
      fs.writeFileSync(invalidFilePath, 'invalid key file content');

      const success = await keyFile.loadFromFile(invalidFilePath);
      expect(success).toBe(false);
    });

    it('should throw error when getting latest from empty file', () => {
      const keyFile = new KeyFile();

      expect(() => keyFile.getLatestVersion()).toThrow();
      expect(keyFile.getLatest()).toBe(null);
    });

    it('should return null for non-existent version', () => {
      const keyFile = new KeyFile();
      const entry = keyFile.get(999);
      expect(entry).toBe(null);
    });
  });

  describe('Error Classes', () => {
    it('should create MalformedKeyFileError', () => {
      const error = new MalformedKeyFileError('Test error');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('MalformedKeyFileError');
      expect(error.message).toBe('Test error');
    });

    it('should create IncompatibleKeyFileError', () => {
      const error = new IncompatibleKeyFileError('Version error');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('IncompatibleKeyFileError');
      expect(error.message).toBe('Version error');
    });
  });
});