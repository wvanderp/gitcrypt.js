# Design Document: TypeScript Library for Encoding and Decoding git-crypt Files

## Overview
This document describes the design of a TypeScript library that can encode (encrypt) and decode (decrypt) files compatible with git-crypt. The library aims to provide programmatic access to git-crypt's file encryption format, enabling integration with Node.js applications and other TypeScript projects.

## Goals
- Encode files using the git-crypt format (compatible with git-crypt's encryption).
- Decode files encrypted by git-crypt.
- Support key management (import/export keys, use GPG or raw keys).
- Provide a simple, well-documented API.
- Ensure cross-platform compatibility (Node.js, browser if possible).

## Architecture
### Modules
1. **Core**
   - Main entry point, exposes encode/decode APIs.
2. **Crypto**
   - Handles encryption/decryption using AES (OpenSSL-compatible).
   - Key derivation and management.
3. **Key Management**
   - Import/export keys.
   - Support for GPG keys (optional, if feasible in JS).
4. **File Format**
   - Parse and generate git-crypt file headers and metadata.
5. **Utils**
   - Helper functions (buffer handling, encoding, etc).

### Dependencies
- `crypto` (Node.js built-in or WebCrypto API)
- Optional: `openpgp` for GPG support

## File Format
- git-crypt uses AES encryption (CBC mode, 256-bit key).
- Each file has a header with metadata (magic bytes, version, IV, etc).
- Encrypted data follows the header.

### Example Header Structure
| Field         | Size      | Description                |
|---------------|-----------|----------------------------|
| Magic Bytes   | 8 bytes   | Identifies git-crypt file  |
| Version       | 1 byte    | Format version             |
| IV            | 16 bytes  | AES Initialization Vector  |
| ...           | ...       | Other metadata             |

## API Design
```typescript
// Encrypt a file
async function encodeFile(input: Buffer, key: Buffer): Promise<Buffer>

// Decrypt a file
async function decodeFile(input: Buffer, key: Buffer): Promise<Buffer>

// Key management
function importKey(raw: Buffer): Key
function exportKey(key: Key): Buffer
```

## Workflow
### Encoding
1. Generate IV.
2. Create header (magic bytes, version, IV).
3. Encrypt file data using AES-CBC with the key and IV.
4. Concatenate header and encrypted data.

### Decoding
1. Parse header, extract IV and metadata.
2. Decrypt data using AES-CBC with the key and IV.
3. Return plaintext.

## Error Handling
- Invalid header/magic bytes: throw descriptive error.
- Unsupported version: throw error.
- Decryption failure: throw error.

## Security Considerations
- Use secure random for IV generation.
- Never expose raw keys in logs/errors.
- Validate all inputs.

## Testing
- Unit tests for all modules.
- Test vectors from git-crypt for compatibility.
- Fuzz testing for robustness.

## Future Extensions
- GPG key support (if feasible).
- Browser compatibility.
- Streaming API for large files.

## References
- [git-crypt source code](https://github.com/AGWA/git-crypt)
- [OpenSSL documentation](https://www.openssl.org/docs/)
- [Node.js crypto](https://nodejs.org/api/crypto.html)
- [WebCrypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)

---
This document provides a foundation for implementing a TypeScript library compatible with git-crypt file encryption and decryption.
