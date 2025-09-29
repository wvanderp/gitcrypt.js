import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  SystemError,
  GitCryptError,
  loadBe32,
  storeBe32,
  explicitMemset,
  leaklessEquals,
  mkdirParent,
  fileExists,
  removeFile
} from '../../src/util';

describe('Utility Functions', () => {
  const testDir = path.join(__dirname, '../temp');

  beforeEach(async () => {
    // Create test directory
    if (!await fileExists(testDir)) {
      await fs.promises.mkdir(testDir, { recursive: true });
    }
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Big-endian 32-bit operations', () => {
    it('should store and load 32-bit big-endian values correctly', () => {
      const buffer = new Uint8Array(8);
      
      // Test various values
      const testValues = [0, 1, 255, 256, 65535, 65536, 0xFFFFFFFF >>> 0];
      
      for (let i = 0; i < testValues.length; i++) {
        const value = testValues[i];
        const offset = i < 4 ? i : i - 4;
        
        storeBe32(buffer, value, offset);
        const loaded = loadBe32(buffer, offset);
        
        expect(loaded).toBe(value);
      }
    });

    it('should handle edge cases for big-endian operations', () => {
      const buffer = new Uint8Array(4);
      
      // Test maximum 32-bit value
      storeBe32(buffer, 0xFFFFFFFF);
      expect(loadBe32(buffer)).toBe(0xFFFFFFFF);
      
      // Test zero
      storeBe32(buffer, 0);
      expect(loadBe32(buffer)).toBe(0);
    });
  });

  describe('Memory operations', () => {
    it('should clear memory explicitly', () => {
      const buffer = new Uint8Array(16);
      buffer.fill(0xAA);
      
      explicitMemset(buffer, 0);
      
      for (let i = 0; i < buffer.length; i++) {
        expect(buffer[i]).toBe(0);
      }
    });

    it('should compare memory arrays in constant time', () => {
      const a = new Uint8Array([1, 2, 3, 4]);
      const b = new Uint8Array([1, 2, 3, 4]);
      const c = new Uint8Array([1, 2, 3, 5]);
      const d = new Uint8Array([1, 2, 3]); // different length
      
      expect(leaklessEquals(a, b)).toBe(true);
      expect(leaklessEquals(a, c)).toBe(false);
      expect(leaklessEquals(a, d)).toBe(false);
    });
  });

  describe('File operations', () => {
    it('should create parent directories', async () => {
      const filePath = path.join(testDir, 'nested', 'deep', 'file.txt');
      
      await mkdirParent(filePath);
      
      const parentDir = path.dirname(filePath);
      expect(await fileExists(parentDir)).toBe(true);
    });

    it('should check file existence', async () => {
      const existingFile = path.join(testDir, 'exists.txt');
      const nonExistentFile = path.join(testDir, 'not-exists.txt');
      
      await fs.promises.writeFile(existingFile, 'test');
      
      expect(await fileExists(existingFile)).toBe(true);
      expect(await fileExists(nonExistentFile)).toBe(false);
    });

    it('should remove files safely', async () => {
      const filePath = path.join(testDir, 'to-remove.txt');
      const nonExistentFile = path.join(testDir, 'not-exists.txt');
      
      await fs.promises.writeFile(filePath, 'test');
      expect(await fileExists(filePath)).toBe(true);
      
      // Remove existing file
      await removeFile(filePath);
      expect(await fileExists(filePath)).toBe(false);
      
      // Remove non-existent file should not throw
      await expect(removeFile(nonExistentFile)).resolves.not.toThrow();
    });
  });

  describe('Error classes', () => {
    it('should create SystemError with correct properties', () => {
      const error = new SystemError('read', '/tmp/file', 2);
      
      expect(error.action).toBe('read');
      expect(error.target).toBe('/tmp/file');
      expect(error.errno).toBe(2);
      expect(error.name).toBe('SystemError');
      expect(error.message).toContain('read');
      expect(error.message).toContain('/tmp/file');
    });

    it('should create GitCryptError with correct properties', () => {
      const error = new GitCryptError('Test error message');
      
      expect(error.name).toBe('GitCryptError');
      expect(error.message).toBe('Test error message');
    });
  });
});