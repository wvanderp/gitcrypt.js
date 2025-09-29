"use strict";
/*
 * TypeScript implementation of git-crypt cryptographic functions
 * Reference: git-crypt/crypto.cpp, git-crypt/crypto-openssl-11.cpp
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
exports.HmacSha1State = exports.AesCtrDecryptor = exports.AesCtrEncryptor = exports.AesEcbEncryptor = exports.CryptoError = exports.HMAC_KEY_LEN = exports.AES_KEY_LEN = void 0;
exports.randomBytes = randomBytes;
exports.initCrypto = initCrypto;
exports.computeHmacSha1 = computeHmacSha1;
const crypto = __importStar(require("crypto"));
const util_1 = require("./util");
exports.AES_KEY_LEN = 32;
exports.HMAC_KEY_LEN = 64;
/**
 * Cryptographic error for encryption/decryption operations
 */
class CryptoError extends Error {
    constructor(where, message) {
        super(`${where}: ${message}`);
        this.name = 'CryptoError';
        this.where = where;
    }
}
exports.CryptoError = CryptoError;
/**
 * AES ECB encryptor for generating encryption pads
 */
class AesEcbEncryptor {
    constructor(key) {
        if (key.length !== AesEcbEncryptor.KEY_LEN) {
            throw new CryptoError('AesEcbEncryptor', `Invalid key length: ${key.length}, expected ${AesEcbEncryptor.KEY_LEN}`);
        }
        this.key = Buffer.from(key);
    }
    /**
     * Encrypt a single block (16 bytes)
     */
    encrypt(plaintext, ciphertext) {
        if (plaintext.length !== AesEcbEncryptor.BLOCK_LEN) {
            throw new CryptoError('AesEcbEncryptor.encrypt', `Invalid plaintext length: ${plaintext.length}`);
        }
        if (ciphertext.length !== AesEcbEncryptor.BLOCK_LEN) {
            throw new CryptoError('AesEcbEncryptor.encrypt', `Invalid ciphertext length: ${ciphertext.length}`);
        }
        try {
            // Create a new cipher for each block to ensure ECB mode behavior
            const cipher = crypto.createCipher('aes-256-ecb', this.key);
            cipher.setAutoPadding(false);
            const plaintextBuffer = Buffer.from(plaintext);
            const encrypted = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
            if (encrypted.length !== AesEcbEncryptor.BLOCK_LEN) {
                throw new CryptoError('AesEcbEncryptor.encrypt', `Unexpected encrypted length: ${encrypted.length}`);
            }
            ciphertext.set(encrypted);
        }
        catch (error) {
            throw new CryptoError('AesEcbEncryptor.encrypt', `Encryption failed: ${error}`);
        }
    }
}
exports.AesEcbEncryptor = AesEcbEncryptor;
AesEcbEncryptor.KEY_LEN = exports.AES_KEY_LEN;
AesEcbEncryptor.BLOCK_LEN = 16;
/**
 * AES CTR mode encryptor/decryptor
 */
class AesCtrEncryptor {
    constructor(key, nonce) {
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
    destroy() {
        (0, util_1.explicitMemset)(this.pad, 0);
        (0, util_1.explicitMemset)(this.ctrValue, 0);
    }
    /**
     * Process (encrypt/decrypt) data in-place
     */
    process(input, output, length) {
        const len = length !== undefined ? length : Math.min(input.length, output.length);
        if (len > input.length || len > output.length) {
            throw new CryptoError('AesCtrEncryptor.process', 'Length exceeds buffer size');
        }
        for (let i = 0; i < len; i++) {
            if (this.byteCounter % AesCtrEncryptor.BLOCK_LEN === 0) {
                // Set last 4 bytes of CTR to the (big-endian) block number
                const blockNumber = Math.floor(this.byteCounter / AesCtrEncryptor.BLOCK_LEN);
                (0, util_1.storeBe32)(this.ctrValue, blockNumber, AesCtrEncryptor.NONCE_LEN);
                // Generate a new pad
                this.ecb.encrypt(this.ctrValue, this.pad);
            }
            // Encrypt/decrypt one byte
            output[i] = input[i] ^ this.pad[this.byteCounter % AesCtrEncryptor.BLOCK_LEN];
            this.byteCounter++;
            if (this.byteCounter === 0) {
                throw new CryptoError('AesCtrEncryptor.process', 'Too much data to encrypt securely');
            }
            if (this.byteCounter > AesCtrEncryptor.MAX_CRYPT_BYTES) {
                throw new CryptoError('AesCtrEncryptor.process', 'Exceeded maximum secure encryption length');
            }
        }
    }
    /**
     * Process an entire stream
     */
    static async processStream(input, output, key, nonce) {
        const encryptor = new AesCtrEncryptor(key, nonce);
        try {
            return new Promise((resolve, reject) => {
                const buffer = Buffer.alloc(1024);
                let processing = false;
                const processChunk = () => {
                    if (processing)
                        return;
                    processing = true;
                    const chunk = input.read();
                    if (chunk === null) {
                        if (input.readableEnded) {
                            encryptor.destroy();
                            resolve();
                        }
                        else {
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
                            }
                            else {
                                setImmediate(processChunk);
                            }
                        });
                    }
                    catch (error) {
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
        }
        catch (error) {
            encryptor.destroy();
            throw error;
        }
    }
}
exports.AesCtrEncryptor = AesCtrEncryptor;
AesCtrEncryptor.NONCE_LEN = 12;
AesCtrEncryptor.KEY_LEN = exports.AES_KEY_LEN;
AesCtrEncryptor.BLOCK_LEN = 16;
AesCtrEncryptor.MAX_CRYPT_BYTES = (1 << 32) * 16; // Don't encrypt more than this or the CTR value will repeat
/**
 * AES CTR decryptor (same as encryptor for CTR mode)
 */
class AesCtrDecryptor extends AesCtrEncryptor {
}
exports.AesCtrDecryptor = AesCtrDecryptor;
/**
 * HMAC-SHA1 implementation
 */
class HmacSha1State {
    constructor(key, keyLen) {
        const actualKeyLen = keyLen !== undefined ? keyLen : key.length;
        if (actualKeyLen > key.length) {
            throw new CryptoError('HmacSha1State', `Key length ${actualKeyLen} exceeds buffer size ${key.length}`);
        }
        try {
            const keyBuffer = Buffer.from(key.slice(0, actualKeyLen));
            this.hmac = crypto.createHmac('sha1', keyBuffer);
        }
        catch (error) {
            throw new CryptoError('HmacSha1State', `Failed to create HMAC: ${error}`);
        }
    }
    /**
     * Add data to the HMAC calculation
     */
    add(buffer, bufferLen) {
        const len = bufferLen !== undefined ? bufferLen : buffer.length;
        if (len > buffer.length) {
            throw new CryptoError('HmacSha1State.add', `Length ${len} exceeds buffer size ${buffer.length}`);
        }
        try {
            this.hmac.update(Buffer.from(buffer.slice(0, len)));
        }
        catch (error) {
            throw new CryptoError('HmacSha1State.add', `Failed to update HMAC: ${error}`);
        }
    }
    /**
     * Get the final HMAC digest
     */
    get(output) {
        if (output.length < HmacSha1State.LEN) {
            throw new CryptoError('HmacSha1State.get', `Output buffer too small: ${output.length}, need ${HmacSha1State.LEN}`);
        }
        try {
            const digest = this.hmac.digest();
            if (digest.length !== HmacSha1State.LEN) {
                throw new CryptoError('HmacSha1State.get', `Unexpected digest length: ${digest.length}`);
            }
            output.set(digest.slice(0, HmacSha1State.LEN));
        }
        catch (error) {
            throw new CryptoError('HmacSha1State.get', `Failed to get digest: ${error}`);
        }
    }
}
exports.HmacSha1State = HmacSha1State;
HmacSha1State.LEN = 20;
HmacSha1State.KEY_LEN = exports.HMAC_KEY_LEN;
/**
 * Generate cryptographically secure random bytes
 */
function randomBytes(buffer, length) {
    const len = length !== undefined ? length : buffer.length;
    if (len > buffer.length) {
        throw new CryptoError('randomBytes', `Length ${len} exceeds buffer size ${buffer.length}`);
    }
    try {
        const randomBuffer = crypto.randomBytes(len);
        buffer.set(randomBuffer.slice(0, len));
    }
    catch (error) {
        throw new CryptoError('randomBytes', `Failed to generate random bytes: ${error}`);
    }
}
/**
 * Initialize crypto subsystem
 */
function initCrypto() {
    // In Node.js, crypto is ready by default
    // This function exists for compatibility with the C++ version
}
/**
 * Compute HMAC-SHA1 of data
 */
function computeHmacSha1(key, data) {
    const hmac = new HmacSha1State(key);
    hmac.add(data);
    const result = new Uint8Array(HmacSha1State.LEN);
    hmac.get(result);
    return result;
}
//# sourceMappingURL=crypto.js.map