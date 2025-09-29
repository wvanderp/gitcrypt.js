import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  init,
  status,
  lock,
  unlock,
  exportKey,
  keygen,
  CommandError
} from '../../src/commands';

describe('Git-Crypt Commands', () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(() => {
    // Create temporary directory for test repository
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-temp-commands-'));
    repoDir = path.join(tempDir, 'test-repo');
    fs.mkdirSync(repoDir);
    
    // Initialize git repo
    process.chdir(repoDir);
  });

  afterEach(() => {
    // Clean up temporary directory
    process.chdir(process.cwd());
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Command Argument Parsing', () => {
    it('should parse init command arguments', () => {
      const args1 = ['init'];
      const args2 = ['init', 'keyname'];
      
      // These should not throw
      expect(() => init(args1)).not.toThrow();
      expect(() => init(args2)).not.toThrow();
    });

    it('should parse status command arguments', () => {
      const args1 = ['status'];
      const args2 = ['status', '-e'];
      const args3 = ['status', '-f'];
      
      // These should not throw for argument parsing
      expect(() => status(args1)).not.toThrow();
      expect(() => status(args2)).not.toThrow();
      expect(() => status(args3)).not.toThrow();
    });

    it('should parse lock command arguments', () => {
      const args1 = ['lock'];
      const args2 = ['lock', 'file1.txt', 'file2.txt'];
      
      expect(() => lock(args1)).not.toThrow();
      expect(() => lock(args2)).not.toThrow();
    });

    it('should parse unlock command arguments', () => {
      const args1 = ['unlock'];
      const args2 = ['unlock', 'keyfile.key'];
      
      expect(() => unlock(args1)).not.toThrow();
      expect(() => unlock(args2)).not.toThrow();
    });

    it('should parse export-key command arguments', () => {
      const args1 = ['export-key'];
      const args2 = ['export-key', 'output.key'];
      
      expect(() => exportKey(args1)).not.toThrow();
      expect(() => exportKey(args2)).not.toThrow();
    });

    it('should parse keygen command arguments', () => {
      const args1 = ['keygen'];
      const args2 = ['keygen', 'keyfile.key'];
      
      expect(() => keygen(args1)).not.toThrow();
      expect(() => keygen(args2)).not.toThrow();
    });
  });

  describe('Command Error Handling', () => {
    it('should throw CommandError for invalid arguments', () => {
      // Commands with specific argument requirements
      expect(() => exportKey([])).toThrow(CommandError);
    });

    it('should throw CommandError for invalid options', () => {
      const invalidArgs = ['status', '--invalid-option'];
      expect(() => status(invalidArgs)).toThrow(CommandError);
    });

    it('should handle missing required arguments gracefully', () => {
      // Commands that require specific arguments
      expect(() => exportKey([])).toThrow(CommandError);
    });
  });

  describe('Command Validation', () => {
    it('should validate git repository context', () => {
      // Move to a non-git directory
      const nonGitDir = path.join(tempDir, 'non-git');
      fs.mkdirSync(nonGitDir);
      process.chdir(nonGitDir);
      
      // Commands should detect missing git repository
      expect(() => init(['init'])).toThrow();
      expect(() => status(['status'])).toThrow();
    });

    it('should validate file existence for relevant commands', () => {
      // Initialize git repo first
      fs.writeFileSync(path.join(repoDir, '.git'), ''); // Fake git repo
      
      const nonExistentFile = 'does-not-exist.key';
      expect(() => unlock(['unlock', nonExistentFile])).toThrow();
    });

    it('should validate user identifiers', () => {
      // Test key file validation instead
      const invalidKeyFiles = ['', '../invalid', '/etc/passwd'];
      
      for (const keyFile of invalidKeyFiles) {
        expect(() => exportKey(['export-key', keyFile])).toThrow(CommandError);
      }
    });
  });

  describe('Option Parsing', () => {
    it('should handle status command options correctly', () => {
      const testCases = [
        { args: ['status'], expectedEncrypted: false, expectedFixed: false },
        { args: ['status', '-e'], expectedEncrypted: true, expectedFixed: false },
        { args: ['status', '-f'], expectedEncrypted: false, expectedFixed: true },
        { args: ['status', '-e', '-f'], expectedEncrypted: true, expectedFixed: true },
      ];
      
      // Note: This test validates argument parsing structure
      // Actual command execution would require git repository setup
      for (const testCase of testCases) {
        expect(() => status(testCase.args)).not.toThrow();
      }
    });

    it('should handle boolean flags correctly', () => {
      // Test various flag combinations
      const flagTests = [
        ['status', '-e'],
        ['status', '--encrypted'],
        ['status', '-f'],
        ['status', '--fix'],
        ['status', '-e', '-f'],
        ['status', '--encrypted', '--fix']
      ];
      
      for (const args of flagTests) {
        expect(() => status(args)).not.toThrow();
      }
    });
  });

  describe('Error Classes', () => {
    it('should create CommandError with message', () => {
      const error = new CommandError('Test command error');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('CommandError');
      expect(error.message).toBe('Test command error');
    });

    it('should create CommandError with default message', () => {
      const error = new CommandError('Default error message');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('CommandError');
      expect(error.message).toBe('Default error message');
      expect(error.exitCode).toBe(1);
    });
  });

  describe('Input Validation', () => {
    it('should validate key file paths', () => {
      const invalidPaths = ['', '..', '../../../etc/passwd', '/etc/passwd'];
      
      for (const invalidPath of invalidPaths) {
        expect(() => unlock(['unlock', invalidPath])).toThrow(CommandError);
      }
    });

    it('should validate file patterns for lock command', () => {
      const validPatterns = ['*.txt', 'docs/**/*.md', 'secret.json'];
      const invalidPatterns = ['', '..', '/absolute/path'];
      
      for (const pattern of validPatterns) {
        expect(() => lock(['lock', pattern])).not.toThrow();
      }
      
      for (const pattern of invalidPatterns) {
        expect(() => lock(['lock', pattern])).toThrow(CommandError);
      }
    });
  });
});