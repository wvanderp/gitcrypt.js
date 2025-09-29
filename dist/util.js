"use strict";
/*
 * TypeScript implementation of git-crypt utility functions
 * Reference: git-crypt/util.cpp, git-crypt/util-unix.cpp, git-crypt/util-win32.cpp
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TempFileStream = exports.GitCryptError = exports.SystemError = void 0;
exports.mkdirParent = mkdirParent;
exports.getExecutablePath = getExecutablePath;
exports.execCommand = execCommand;
exports.execCommandWithOutput = execCommandWithOutput;
exports.execCommandWithInput = execCommandWithInput;
exports.touchFile = touchFile;
exports.removeFile = removeFile;
exports.escapeShellArg = escapeShellArg;
exports.loadBe32 = loadBe32;
exports.storeBe32 = storeBe32;
exports.readBe32 = readBe32;
exports.writeBe32 = writeBe32;
exports.explicitMemset = explicitMemset;
exports.leaklessEquals = leaklessEquals;
exports.createProtectedFile = createProtectedFile;
exports.renameFile = renameFile;
exports.getDirectoryContents = getDirectoryContents;
exports.fileExists = fileExists;
exports.isDirectory = isDirectory;
exports.getFileSize = getFileSize;
exports.initStdStreams = initStdStreams;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
/**
 * System error for file operations and process execution
 */
class SystemError extends Error {
    constructor(action, target, errno, message) {
        const errorMessage = message || `${action} failed on ${target}: ${errno}`;
        super(errorMessage);
        this.name = 'SystemError';
        this.action = action;
        this.target = target;
        this.errno = errno;
    }
}
exports.SystemError = SystemError;
/**
 * General error class for git-crypt operations
 */
class GitCryptError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GitCryptError';
    }
}
exports.GitCryptError = GitCryptError;
/**
 * Temporary file stream that auto-deletes on close
 */
class TempFileStream {
    constructor() {
        this.filename = null;
        this.fileHandle = null;
    }
    /**
     * Open a temporary file for writing
     */
    async open(mode = 'w') {
        const tmpDir = process.env.TMPDIR || process.env.TMP || '/tmp';
        this.filename = path.join(tmpDir, `git-crypt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
        try {
            this.fileHandle = await fs.promises.open(this.filename, mode, 0o600);
            return this.fileHandle;
        }
        catch (error) {
            throw new SystemError('open', this.filename, error.errno || -1);
        }
    }
    /**
     * Close and delete the temporary file
     */
    async close() {
        if (this.fileHandle) {
            try {
                await this.fileHandle.close();
            }
            catch (error) {
                // Ignore close errors
            }
            this.fileHandle = null;
        }
        if (this.filename) {
            try {
                await fs.promises.unlink(this.filename);
            }
            catch (error) {
                // Ignore deletion errors
            }
            this.filename = null;
        }
    }
    getFilename() {
        return this.filename;
    }
}
exports.TempFileStream = TempFileStream;
/**
 * Create parent directories of a path (but not the path itself)
 */
async function mkdirParent(filePath) {
    const parentDir = path.dirname(filePath);
    if (parentDir && parentDir !== '.' && parentDir !== '/') {
        try {
            await fs.promises.mkdir(parentDir, { recursive: true });
        }
        catch (error) {
            throw new SystemError('mkdir', parentDir, error.errno || -1);
        }
    }
}
/**
 * Get the path of the current executable
 */
function getExecutablePath() {
    return process.execPath;
}
/**
 * Execute a command and return the exit code
 */
async function execCommand(args) {
    return new Promise((resolve, reject) => {
        if (args.length === 0) {
            reject(new GitCryptError('No command specified'));
            return;
        }
        const [command, ...commandArgs] = args;
        const options = {
            stdio: 'inherit',
            shell: false
        };
        const child = (0, child_process_1.spawn)(command, commandArgs, options);
        child.on('error', (error) => {
            reject(new SystemError('exec', command, error.errno || -1));
        });
        child.on('exit', (code, signal) => {
            if (signal) {
                resolve(128 + (process.platform === 'win32' ? 0 : 1)); // Signal termination
            }
            else {
                resolve(code || 0);
            }
        });
    });
}
/**
 * Execute a command and capture its output
 */
async function execCommandWithOutput(args) {
    return new Promise((resolve, reject) => {
        if (args.length === 0) {
            reject(new GitCryptError('No command specified'));
            return;
        }
        const [command, ...commandArgs] = args;
        const options = {
            stdio: ['pipe', 'pipe', 'inherit'],
            shell: false
        };
        const child = (0, child_process_1.spawn)(command, commandArgs, options);
        let output = '';
        if (child.stdout) {
            child.stdout.on('data', (data) => {
                output += data.toString();
            });
        }
        child.on('error', (error) => {
            reject(new SystemError('exec', command, error.errno || -1));
        });
        child.on('exit', (code, signal) => {
            const exitCode = signal ? (128 + (process.platform === 'win32' ? 0 : 1)) : (code || 0);
            resolve({ exitCode, output });
        });
    });
}
/**
 * Execute a command with input data
 */
async function execCommandWithInput(args, input) {
    return new Promise((resolve, reject) => {
        if (args.length === 0) {
            reject(new GitCryptError('No command specified'));
            return;
        }
        const [command, ...commandArgs] = args;
        const options = {
            stdio: ['pipe', 'inherit', 'inherit'],
            shell: false
        };
        const child = (0, child_process_1.spawn)(command, commandArgs, options);
        child.on('error', (error) => {
            reject(new SystemError('exec', command, error.errno || -1));
        });
        if (child.stdin) {
            child.stdin.write(input);
            child.stdin.end();
        }
        child.on('exit', (code, signal) => {
            if (signal) {
                resolve(128 + (process.platform === 'win32' ? 0 : 1));
            }
            else {
                resolve(code || 0);
            }
        });
    });
}
/**
 * Touch a file (create if doesn't exist, update timestamp if exists)
 */
async function touchFile(filePath) {
    try {
        const now = new Date();
        await fs.promises.utimes(filePath, now, now);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            // File doesn't exist, create it
            try {
                await fs.promises.writeFile(filePath, '', { flag: 'w' });
            }
            catch (createError) {
                throw new SystemError('touch', filePath, createError.errno || -1);
            }
        }
        else {
            throw new SystemError('touch', filePath, error.errno || -1);
        }
    }
}
/**
 * Remove a file (ignore if doesn't exist)
 */
async function removeFile(filePath) {
    try {
        await fs.promises.unlink(filePath);
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw new SystemError('unlink', filePath, error.errno || -1);
        }
        // Ignore ENOENT errors
    }
}
/**
 * Escape shell argument for safe command execution
 */
function escapeShellArg(str) {
    if (process.platform === 'win32') {
        // Windows shell escaping
        return `"${str.replace(/([\\"])/g, '\\$1')}"`;
    }
    else {
        // Unix shell escaping
        return `"${str.replace(/([\\"])/g, '\\$1').replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`;
    }
}
/**
 * Load a 32-bit big-endian integer from bytes
 */
function loadBe32(buffer, offset = 0) {
    return (buffer[offset] << 24) |
        (buffer[offset + 1] << 16) |
        (buffer[offset + 2] << 8) |
        buffer[offset + 3];
}
/**
 * Store a 32-bit big-endian integer to bytes
 */
function storeBe32(buffer, value, offset = 0) {
    buffer[offset] = (value >>> 24) & 0xff;
    buffer[offset + 1] = (value >>> 16) & 0xff;
    buffer[offset + 2] = (value >>> 8) & 0xff;
    buffer[offset + 3] = value & 0xff;
}
/**
 * Read a 32-bit big-endian integer from a readable stream
 */
async function readBe32(stream) {
    return new Promise((resolve, reject) => {
        const buffer = Buffer.alloc(4);
        let bytesRead = 0;
        const onData = (chunk) => {
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
        const onError = (error) => {
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
async function writeBe32(stream, value) {
    const buffer = Buffer.alloc(4);
    storeBe32(buffer, value);
    return new Promise((resolve, reject) => {
        stream.write(buffer, (error) => {
            if (error) {
                reject(error);
            }
            else {
                resolve();
            }
        });
    });
}
/**
 * Explicit memory clear that won't be optimized away
 */
function explicitMemset(buffer, value) {
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
function leaklessEquals(a, b) {
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
async function createProtectedFile(filePath) {
    try {
        await mkdirParent(filePath);
        await fs.promises.writeFile(filePath, '', { mode: 0o600 });
    }
    catch (error) {
        throw new SystemError('create_protected_file', filePath, error.errno || -1);
    }
}
/**
 * Rename a file atomically
 */
async function renameFile(oldPath, newPath) {
    try {
        await fs.promises.rename(oldPath, newPath);
    }
    catch (error) {
        throw new SystemError('rename', `${oldPath} -> ${newPath}`, error.errno || -1);
    }
}
/**
 * Get directory contents
 */
async function getDirectoryContents(dirPath) {
    try {
        return await fs.promises.readdir(dirPath);
    }
    catch (error) {
        throw new SystemError('readdir', dirPath, error.errno || -1);
    }
}
/**
 * Check if a file or directory exists
 */
async function fileExists(filePath) {
    try {
        await fs.promises.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Check if path is a directory
 */
async function isDirectory(filePath) {
    try {
        const stats = await fs.promises.stat(filePath);
        return stats.isDirectory();
    }
    catch {
        return false;
    }
}
/**
 * Get file size
 */
async function getFileSize(filePath) {
    try {
        const stats = await fs.promises.stat(filePath);
        return stats.size;
    }
    catch (error) {
        throw new SystemError('stat', filePath, error.errno || -1);
    }
}
/**
 * Initialize standard streams for performance
 */
function initStdStreams() {
    // In Node.js, streams are already optimized
    // This is mainly for compatibility with the C++ version
    if (process.stdin.setEncoding) {
        process.stdin.setEncoding('binary');
    }
    if (process.stdout.setEncoding) {
        process.stdout.setEncoding('binary');
    }
}
//# sourceMappingURL=util.js.map