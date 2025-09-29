"use strict";
/*
 * TypeScript implementation of git-crypt key management
 * Reference: git-crypt/key.cpp, git-crypt/key.hpp
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
exports.KeyFile = exports.KeyEntry = exports.IncompatibleKeyFileError = exports.MalformedKeyFileError = exports.MAX_FIELD_LEN = exports.KeyField = exports.HeaderField = exports.KEY_NAME_MAX_LEN = exports.FORMAT_VERSION = exports.HMAC_KEY_LEN = exports.AES_KEY_LEN = void 0;
exports.validateKeyName = validateKeyName;
const fs = __importStar(require("fs"));
const stream_1 = require("stream");
const util_1 = require("./util");
const crypto_1 = require("./crypto");
Object.defineProperty(exports, "AES_KEY_LEN", { enumerable: true, get: function () { return crypto_1.AES_KEY_LEN; } });
Object.defineProperty(exports, "HMAC_KEY_LEN", { enumerable: true, get: function () { return crypto_1.HMAC_KEY_LEN; } });
/**
 * Key file format version
 */
exports.FORMAT_VERSION = 2;
/**
 * Maximum key name length
 */
exports.KEY_NAME_MAX_LEN = 128;
/**
 * Field IDs for header fields
 */
var HeaderField;
(function (HeaderField) {
    HeaderField[HeaderField["END"] = 0] = "END";
    HeaderField[HeaderField["KEY_NAME"] = 1] = "KEY_NAME";
})(HeaderField || (exports.HeaderField = HeaderField = {}));
/**
 * Field IDs for key entry fields
 */
var KeyField;
(function (KeyField) {
    KeyField[KeyField["END"] = 0] = "END";
    KeyField[KeyField["VERSION"] = 1] = "VERSION";
    KeyField[KeyField["AES_KEY"] = 3] = "AES_KEY";
    KeyField[KeyField["HMAC_KEY"] = 5] = "HMAC_KEY";
})(KeyField || (exports.KeyField = KeyField = {}));
/**
 * Maximum field length to prevent malicious files
 */
exports.MAX_FIELD_LEN = 1 << 20; // 1MB
/**
 * Exception for malformed key files
 */
class MalformedKeyFileError extends Error {
    constructor(message = 'Malformed key file') {
        super(message);
        this.name = 'MalformedKeyFileError';
    }
}
exports.MalformedKeyFileError = MalformedKeyFileError;
/**
 * Exception for incompatible key file versions
 */
class IncompatibleKeyFileError extends Error {
    constructor(message = 'Incompatible key file version') {
        super(message);
        this.name = 'IncompatibleKeyFileError';
    }
}
exports.IncompatibleKeyFileError = IncompatibleKeyFileError;
/**
 * A single key entry containing AES and HMAC keys
 */
class KeyEntry {
    constructor() {
        this.version = 0;
        this.aesKey = new Uint8Array(crypto_1.AES_KEY_LEN);
        this.hmacKey = new Uint8Array(crypto_1.HMAC_KEY_LEN);
    }
    /**
     * Load key entry from stream
     */
    async load(stream) {
        while (true) {
            const fieldId = await (0, util_1.readBe32)(stream);
            if (fieldId === null) {
                throw new MalformedKeyFileError('Unexpected end of stream while reading field ID');
            }
            if (fieldId === KeyField.END) {
                break;
            }
            const fieldLen = await (0, util_1.readBe32)(stream);
            if (fieldLen === null) {
                throw new MalformedKeyFileError('Unexpected end of stream while reading field length');
            }
            if (fieldId === KeyField.VERSION) {
                if (fieldLen !== 4) {
                    throw new MalformedKeyFileError(`Invalid version field length: ${fieldLen}`);
                }
                const version = await (0, util_1.readBe32)(stream);
                if (version === null) {
                    throw new MalformedKeyFileError('Failed to read version');
                }
                this.version = version;
            }
            else if (fieldId === KeyField.AES_KEY) {
                if (fieldLen !== crypto_1.AES_KEY_LEN) {
                    throw new MalformedKeyFileError(`Invalid AES key field length: ${fieldLen}`);
                }
                await this.readBytes(stream, this.aesKey, crypto_1.AES_KEY_LEN);
            }
            else if (fieldId === KeyField.HMAC_KEY) {
                if (fieldLen !== crypto_1.HMAC_KEY_LEN) {
                    throw new MalformedKeyFileError(`Invalid HMAC key field length: ${fieldLen}`);
                }
                await this.readBytes(stream, this.hmacKey, crypto_1.HMAC_KEY_LEN);
            }
            else if (fieldId & 1) {
                // Unknown critical field
                throw new IncompatibleKeyFileError(`Unknown critical field: ${fieldId}`);
            }
            else {
                // Unknown non-critical field - safe to ignore
                if (fieldLen > exports.MAX_FIELD_LEN) {
                    throw new MalformedKeyFileError(`Field length too large: ${fieldLen}`);
                }
                await this.skipBytes(stream, fieldLen);
            }
        }
    }
    /**
     * Load legacy key entry format
     */
    async loadLegacy(version, stream) {
        this.version = version;
        // Read AES key
        await this.readBytes(stream, this.aesKey, crypto_1.AES_KEY_LEN);
        // Read HMAC key
        await this.readBytes(stream, this.hmacKey, crypto_1.HMAC_KEY_LEN);
        // Check for trailing data
        const nextByte = stream.read(1);
        if (nextByte !== null) {
            throw new MalformedKeyFileError('Unexpected trailing data in legacy key file');
        }
    }
    /**
     * Store key entry to stream
     */
    async store(stream) {
        // Version field
        await (0, util_1.writeBe32)(stream, KeyField.VERSION);
        await (0, util_1.writeBe32)(stream, 4);
        await (0, util_1.writeBe32)(stream, this.version);
        // AES key field
        await (0, util_1.writeBe32)(stream, KeyField.AES_KEY);
        await (0, util_1.writeBe32)(stream, crypto_1.AES_KEY_LEN);
        await this.writeBytes(stream, this.aesKey);
        // HMAC key field
        await (0, util_1.writeBe32)(stream, KeyField.HMAC_KEY);
        await (0, util_1.writeBe32)(stream, crypto_1.HMAC_KEY_LEN);
        await this.writeBytes(stream, this.hmacKey);
        // End field
        await (0, util_1.writeBe32)(stream, KeyField.END);
    }
    /**
     * Generate new random keys
     */
    generate(version) {
        this.version = version;
        (0, crypto_1.randomBytes)(this.aesKey);
        (0, crypto_1.randomBytes)(this.hmacKey);
    }
    /**
     * Clear sensitive key data
     */
    destroy() {
        (0, util_1.explicitMemset)(this.aesKey, 0);
        (0, util_1.explicitMemset)(this.hmacKey, 0);
    }
    /**
     * Helper to read exact number of bytes
     */
    async readBytes(stream, buffer, length) {
        return new Promise((resolve, reject) => {
            let bytesRead = 0;
            const tempBuffer = Buffer.alloc(length);
            const onData = (chunk) => {
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
     * Helper to skip bytes in stream
     */
    async skipBytes(stream, length) {
        return new Promise((resolve, reject) => {
            let bytesSkipped = 0;
            const onData = (chunk) => {
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
     * Helper to write bytes to stream
     */
    async writeBytes(stream, buffer) {
        return new Promise((resolve, reject) => {
            stream.write(Buffer.from(buffer), (error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
    }
}
exports.KeyEntry = KeyEntry;
/**
 * Git-crypt key file containing multiple key entries
 */
class KeyFile {
    constructor() {
        this.entries = new Map();
        this.keyName = '';
    }
    /**
     * Get the latest (highest version) key entry
     */
    getLatest() {
        if (this.isEmpty()) {
            return null;
        }
        const latestVersion = this.getLatestVersion();
        return this.get(latestVersion);
    }
    /**
     * Get key entry by version
     */
    get(version) {
        return this.entries.get(version) || null;
    }
    /**
     * Add a key entry
     */
    add(entry) {
        this.entries.set(entry.version, entry);
    }
    /**
     * Load key file from legacy format
     */
    async loadLegacy(stream) {
        const entry = new KeyEntry();
        await entry.loadLegacy(0, stream);
        this.add(entry);
    }
    /**
     * Load key file from new format
     */
    async load(stream) {
        // Read preamble
        const preamble = await this.readExactBytes(stream, 16);
        // Check magic bytes
        const expectedMagic = Buffer.from('\0GITCRYPTKEY', 'utf8');
        if (!preamble.slice(0, 12).equals(expectedMagic)) {
            throw new MalformedKeyFileError('Invalid magic bytes');
        }
        // Check format version
        const formatVersion = (0, util_1.loadBe32)(preamble, 12);
        if (formatVersion !== exports.FORMAT_VERSION) {
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
    async store(stream) {
        // Write preamble
        const preamble = Buffer.alloc(16);
        Buffer.from('\0GITCRYPTKEY', 'utf8').copy(preamble, 0);
        (0, util_1.storeBe32)(preamble, exports.FORMAT_VERSION, 12);
        await this.writeBuffer(stream, preamble);
        // Store header
        await this.storeHeader(stream);
        // Store key entries (sorted by version descending)
        const sortedVersions = Array.from(this.entries.keys()).sort((a, b) => b - a);
        for (const version of sortedVersions) {
            const entry = this.entries.get(version);
            await entry.store(stream);
        }
    }
    /**
     * Load key file from file
     */
    async loadFromFile(filename) {
        try {
            const stream = fs.createReadStream(filename);
            // Try new format first
            try {
                await this.load(stream);
                return true;
            }
            catch (error) {
                if (error instanceof MalformedKeyFileError) {
                    // Try legacy format
                    stream.destroy();
                    const legacyStream = fs.createReadStream(filename);
                    try {
                        await this.loadLegacy(legacyStream);
                        return true;
                    }
                    catch (legacyError) {
                        throw error; // Throw original error
                    }
                    finally {
                        legacyStream.destroy();
                    }
                }
                throw error;
            }
            finally {
                stream.destroy();
            }
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Store key file to file
     */
    async storeToFile(filename) {
        try {
            const stream = fs.createWriteStream(filename, { mode: 0o600 });
            await this.store(stream);
            stream.end();
            return true;
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Convert key file to string
     */
    async storeToString() {
        return new Promise(async (resolve, reject) => {
            const chunks = [];
            const stream = new stream_1.Writable({
                write(chunk, encoding, callback) {
                    chunks.push(chunk);
                    callback();
                }
            });
            try {
                await this.store(stream);
                stream.end();
                resolve(Buffer.concat(chunks).toString('binary'));
            }
            catch (error) {
                reject(error);
            }
        });
    }
    /**
     * Generate new key file with single entry
     */
    generate() {
        this.entries.clear();
        const entry = new KeyEntry();
        entry.generate(exports.FORMAT_VERSION);
        this.add(entry);
    }
    /**
     * Check if key file is empty
     */
    isEmpty() {
        return this.entries.size === 0;
    }
    /**
     * Check if key file has entries
     */
    isFilled() {
        return !this.isEmpty();
    }
    /**
     * Get latest version number
     */
    getLatestVersion() {
        if (this.isEmpty()) {
            throw new Error('No key entries available');
        }
        return Math.max(...this.entries.keys());
    }
    /**
     * Set key name
     */
    setKeyName(keyName) {
        this.keyName = keyName || '';
    }
    /**
     * Get key name
     */
    getKeyName() {
        return this.keyName || null;
    }
    /**
     * Destroy all sensitive data
     */
    destroy() {
        for (const entry of this.entries.values()) {
            entry.destroy();
        }
        this.entries.clear();
    }
    /**
     * Load header from stream
     */
    async loadHeader(stream) {
        while (true) {
            const fieldId = await (0, util_1.readBe32)(stream);
            if (fieldId === null) {
                throw new MalformedKeyFileError('Unexpected end of stream while reading header field ID');
            }
            if (fieldId === HeaderField.END) {
                break;
            }
            const fieldLen = await (0, util_1.readBe32)(stream);
            if (fieldLen === null) {
                throw new MalformedKeyFileError('Unexpected end of stream while reading header field length');
            }
            if (fieldId === HeaderField.KEY_NAME) {
                if (fieldLen > exports.KEY_NAME_MAX_LEN) {
                    throw new MalformedKeyFileError(`Key name too long: ${fieldLen}`);
                }
                const keyNameBuffer = await this.readExactBytes(stream, fieldLen);
                this.keyName = keyNameBuffer.toString('utf8');
            }
            else if (fieldId & 1) {
                // Unknown critical field
                throw new IncompatibleKeyFileError(`Unknown critical header field: ${fieldId}`);
            }
            else {
                // Unknown non-critical field - safe to ignore
                if (fieldLen > exports.MAX_FIELD_LEN) {
                    throw new MalformedKeyFileError(`Header field length too large: ${fieldLen}`);
                }
                await this.skipExactBytes(stream, fieldLen);
            }
        }
    }
    /**
     * Store header to stream
     */
    async storeHeader(stream) {
        if (this.keyName) {
            await (0, util_1.writeBe32)(stream, HeaderField.KEY_NAME);
            const keyNameBuffer = Buffer.from(this.keyName, 'utf8');
            await (0, util_1.writeBe32)(stream, keyNameBuffer.length);
            await this.writeBuffer(stream, keyNameBuffer);
        }
        await (0, util_1.writeBe32)(stream, HeaderField.END);
    }
    /**
     * Read exact number of bytes from stream
     */
    async readExactBytes(stream, length) {
        return new Promise((resolve, reject) => {
            let bytesRead = 0;
            const buffer = Buffer.alloc(length);
            const onData = (chunk) => {
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
     * Skip exact number of bytes in stream
     */
    async skipExactBytes(stream, length) {
        return new Promise((resolve, reject) => {
            let bytesSkipped = 0;
            const onData = (chunk) => {
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
     * Write buffer to stream
     */
    async writeBuffer(stream, buffer) {
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
}
exports.KeyFile = KeyFile;
/**
 * Validate key name
 */
function validateKeyName(keyName) {
    if (!keyName) {
        return { valid: false, reason: 'Key name cannot be empty' };
    }
    if (keyName.length > exports.KEY_NAME_MAX_LEN) {
        return { valid: false, reason: `Key name too long (max ${exports.KEY_NAME_MAX_LEN} characters)` };
    }
    // Check for invalid characters (control characters, path separators, etc.)
    if (/[\x00-\x1f\x7f\\\/\:]/.test(keyName)) {
        return { valid: false, reason: 'Key name contains invalid characters' };
    }
    return { valid: true };
}
//# sourceMappingURL=key.js.map