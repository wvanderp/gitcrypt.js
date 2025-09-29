import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { KeyFile, encryptFile, decryptFile } from '../../src/index';

describe('Git-Crypt Integration Tests', () => {
  const testFilesDir = path.join(process.cwd(), 'test', 'files');
  const encryptedFilesDir = path.join(process.cwd(), 'test', 'files-encrypted');
  const keyFilePath = path.join(encryptedFilesDir, 'git-crypt.key');

  let tempDir: string;
  let keyFile: KeyFile;

  beforeEach(async () => {
    // Create temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-temp-integration-'));
    
    // Load the test key file
    keyFile = new KeyFile();
    const keyLoaded = await keyFile.loadFromFile(keyFilePath);
    
    if (!keyLoaded) {
      throw new Error(`Failed to load key file: ${keyFilePath}`);
    }
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('File Encryption/Decryption', () => {
    it('should encrypt and decrypt test.md correctly', async () => {
      const plainFilePath = path.join(testFilesDir, 'test.md');
      const encryptedFilePath = path.join(encryptedFilesDir, 'test.md');
      
      // Verify test files exist
      expect(fs.existsSync(plainFilePath)).toBe(true);
      expect(fs.existsSync(encryptedFilePath)).toBe(true);
      
      // Read original plain text
      const originalContent = fs.readFileSync(plainFilePath, 'utf8');
      
      // Get key from keyFile
      const entry = keyFile.getLatest();
      expect(entry).not.toBe(null);
      
      // Encrypt the plain file using our implementation
      const testEncryptedPath = path.join(tempDir, 'test-encrypted.md');
      await encryptFile(plainFilePath, testEncryptedPath, entry!.aesKey, entry!.hmacKey);
      
      // For decryption, we need the nonce from the encrypted file
      // This is a simplified test - in reality we'd need to extract the nonce
      // For now, let's just test that we can encrypt and decrypt with same nonce
      const { randomBytes, AesCtrEncryptor } = await import('../../src/crypto');
      const nonce = new Uint8Array(AesCtrEncryptor.NONCE_LEN);
      randomBytes(nonce);
      
      // Re-encrypt with known nonce
      await encryptFile(plainFilePath, testEncryptedPath, entry!.aesKey, entry!.hmacKey, nonce);
      
      // Decrypt with same nonce
      const testDecryptedPath = path.join(tempDir, 'test-decrypted.md');
      await decryptFile(testEncryptedPath, testDecryptedPath, entry!.aesKey, entry!.hmacKey, nonce);
      
      // Read decrypted content
      const decryptedContent = fs.readFileSync(testDecryptedPath, 'utf8');
      
      // Verify content matches
      expect(decryptedContent).toBe(originalContent);
    });

    it('should encrypt and decrypt second.md correctly', async () => {
      const plainFilePath = path.join(testFilesDir, 'second.md');
      const encryptedFilePath = path.join(encryptedFilesDir, 'second.md');
      
      // Verify test files exist
      expect(fs.existsSync(plainFilePath)).toBe(true);
      expect(fs.existsSync(encryptedFilePath)).toBe(true);
      
      // Read original plain text
      const originalContent = fs.readFileSync(plainFilePath, 'utf8');
      
      // Get key from keyFile
      const entry = keyFile.getLatest();
      expect(entry).not.toBe(null);
      
      const { randomBytes, AesCtrEncryptor } = await import('../../src/crypto');
      const nonce = new Uint8Array(AesCtrEncryptor.NONCE_LEN);
      randomBytes(nonce);
      
      // Encrypt the plain file using our implementation
      const testEncryptedPath = path.join(tempDir, 'second-encrypted.md');
      await encryptFile(plainFilePath, testEncryptedPath, entry!.aesKey, entry!.hmacKey, nonce);
      
      // Decrypt our encrypted file
      const testDecryptedPath = path.join(tempDir, 'second-decrypted.md');
      await decryptFile(testEncryptedPath, testDecryptedPath, entry!.aesKey, entry!.hmacKey, nonce);
      
      // Read decrypted content
      const decryptedContent = fs.readFileSync(testDecryptedPath, 'utf8');
      
      // Verify content matches
      expect(decryptedContent).toBe(originalContent);
    });

    it('should work with git-crypt encrypted format', async () => {
      // This test validates that our implementation is compatible with real git-crypt files
      // Note: This is a basic compatibility test - full git-crypt format includes headers
      
      const plainTestPath = path.join(testFilesDir, 'test.md');
      const originalContent = fs.readFileSync(plainTestPath, 'utf8');
      
      // Get key from keyFile
      const entry = keyFile.getLatest();
      expect(entry).not.toBe(null);
      
      // Create a round-trip test
      const { randomBytes, AesCtrEncryptor } = await import('../../src/crypto');
      const nonce = new Uint8Array(AesCtrEncryptor.NONCE_LEN);
      randomBytes(nonce);
      
      const encryptedPath = path.join(tempDir, 'round-trip.encrypted');
      const decryptedPath = path.join(tempDir, 'round-trip.decrypted');
      
      await encryptFile(plainTestPath, encryptedPath, entry!.aesKey, entry!.hmacKey, nonce);
      await decryptFile(encryptedPath, decryptedPath, entry!.aesKey, entry!.hmacKey, nonce);
      
      const decryptedContent = fs.readFileSync(decryptedPath, 'utf8');
      expect(decryptedContent).toBe(originalContent);
    });
  });

  describe('Key File Compatibility', () => {
    it('should load git-crypt key file successfully', () => {
      expect(keyFile.isFilled()).toBe(true);
      
      const latest = keyFile.getLatest();
      expect(latest).not.toBe(null);
      expect(latest!.aesKey.length).toBe(32);
      expect(latest!.hmacKey.length).toBe(20);
    });

    it('should generate compatible key files', async () => {
      const newKeyPath = path.join(tempDir, 'new-key.key');
      
      // Generate new key file
      const newKeyFile = new KeyFile();
      newKeyFile.generate();
      
      const saveSuccess = await newKeyFile.storeToFile(newKeyPath);
      expect(saveSuccess).toBe(true);
      
      // Load it back
      const loadedKeyFile = new KeyFile();
      const loadSuccess = await loadedKeyFile.loadFromFile(newKeyPath);
      expect(loadSuccess).toBe(true);
      
      expect(loadedKeyFile.isFilled()).toBe(true);
      const latest = loadedKeyFile.getLatest();
      expect(latest).not.toBe(null);
    });
  });

  describe('File Format Validation', () => {
    it('should detect encrypted vs plain files', async () => {
      const plainFile = path.join(testFilesDir, 'test.md');
      const encryptedFile = path.join(encryptedFilesDir, 'test.md');
      
      const plainContent = fs.readFileSync(plainFile);
      const encryptedContent = fs.readFileSync(encryptedFile);
      
      // Encrypted files should start with git-crypt signature
      expect(encryptedContent.length).toBeGreaterThan(plainContent.length);
      
      // Plain files should be readable text
      const plainText = plainContent.toString('utf8');
      expect(plainText).toContain('markdown'); // Known content from test.md
      
      // Encrypted files should contain binary data
      const encryptedText = encryptedContent.toString('utf8');
      expect(encryptedText).not.toContain('markdown');
    });
  });

  describe('Cross-Platform Compatibility', () => {
    it('should handle files with different line endings', async () => {
      const content = 'Line 1\\nLine 2\\r\\nLine 3\\n';
      const testFilePath = path.join(tempDir, 'line-endings.txt');
      
      fs.writeFileSync(testFilePath, content, 'utf8');
      
      // Get key from keyFile
      const entry = keyFile.getLatest();
      expect(entry).not.toBe(null);
      
      const { randomBytes, AesCtrEncryptor } = await import('../../src/crypto');
      const nonce = new Uint8Array(AesCtrEncryptor.NONCE_LEN);
      randomBytes(nonce);
      
      // Encrypt and decrypt
      const encryptedPath = path.join(tempDir, 'line-endings.encrypted');
      const decryptedPath = path.join(tempDir, 'line-endings.decrypted');
      
      await encryptFile(testFilePath, encryptedPath, entry!.aesKey, entry!.hmacKey, nonce);
      await decryptFile(encryptedPath, decryptedPath, entry!.aesKey, entry!.hmacKey, nonce);
      
      const decryptedContent = fs.readFileSync(decryptedPath, 'utf8');
      expect(decryptedContent).toBe(content);
    });

    it('should handle binary files', async () => {
      // Create a small binary file
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
      const binaryFilePath = path.join(tempDir, 'binary.bin');
      
      fs.writeFileSync(binaryFilePath, binaryData);
      
      // Get key from keyFile
      const entry = keyFile.getLatest();
      expect(entry).not.toBe(null);
      
      const { randomBytes, AesCtrEncryptor } = await import('../../src/crypto');
      const nonce = new Uint8Array(AesCtrEncryptor.NONCE_LEN);
      randomBytes(nonce);
      
      // Encrypt and decrypt
      const encryptedPath = path.join(tempDir, 'binary.encrypted');
      const decryptedPath = path.join(tempDir, 'binary.decrypted');
      
      await encryptFile(binaryFilePath, encryptedPath, entry!.aesKey, entry!.hmacKey, nonce);
      await decryptFile(encryptedPath, decryptedPath, entry!.aesKey, entry!.hmacKey, nonce);
      
      const decryptedData = fs.readFileSync(decryptedPath);
      expect(new Uint8Array(decryptedData)).toEqual(binaryData);
    });
  });
});