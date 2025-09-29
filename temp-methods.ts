  /**
   * Load key file from buffer (new format)
   */
  async loadFromBuffer(buffer: Buffer): Promise<void> {
    if (buffer.length < 16) {
      throw new MalformedKeyFileError('File too short for header');
    }

    // Check magic bytes
    const expectedMagic = Buffer.from('\0GITCRYPTKEY', 'utf8');
    if (!buffer.slice(0, 12).equals(expectedMagic)) {
      throw new MalformedKeyFileError('Invalid magic bytes');
    }

    // Check format version
    const formatVersion = loadBe32(buffer, 12);
    if (formatVersion !== FORMAT_VERSION) {
      throw new IncompatibleKeyFileError(`Unsupported format version: ${formatVersion}`);
    }

    let offset = 16;

    // Load header
    offset = await this.loadHeaderFromBuffer(buffer, offset);

    // Load key entries
    while (offset < buffer.length) {
      const entry = new KeyEntry();
      offset = await this.loadEntryFromBuffer(entry, buffer, offset);
      this.add(entry);
    }
  }

  /**
   * Load key file from buffer (legacy format)
   */
  async loadLegacyFromBuffer(buffer: Buffer): Promise<void> {
    if (buffer.length < AES_KEY_LEN + HMAC_KEY_LEN) {
      throw new MalformedKeyFileError('File too short for legacy format');
    }

    const entry = new KeyEntry();
    entry.version = 0;
    
    // Read AES key
    buffer.copy(entry.aesKey, 0, 0, AES_KEY_LEN);
    
    // Read HMAC key  
    buffer.copy(entry.hmacKey, 0, AES_KEY_LEN, AES_KEY_LEN + HMAC_KEY_LEN);
    
    // Check for trailing data
    if (buffer.length !== AES_KEY_LEN + HMAC_KEY_LEN) {
      throw new MalformedKeyFileError('Unexpected trailing data in legacy key file');
    }
    
    this.add(entry);
  }

  /**
   * Load header from buffer
   */
  private async loadHeaderFromBuffer(buffer: Buffer, offset: number): Promise<number> {
    while (offset + 4 <= buffer.length) {
      const fieldId = loadBe32(buffer, offset);
      offset += 4;

      if (fieldId === HeaderField.END) {
        break;
      }

      if (offset + 4 > buffer.length) {
        throw new MalformedKeyFileError('Unexpected end of buffer while reading header field length');
      }

      const fieldLen = loadBe32(buffer, offset);
      offset += 4;

      if (fieldLen > MAX_FIELD_LEN) {
        throw new MalformedKeyFileError(`Header field length too large: ${fieldLen}`);
      }

      if (offset + fieldLen > buffer.length) {
        throw new MalformedKeyFileError('Unexpected end of buffer while reading header field data');
      }

      if (fieldId === HeaderField.KEY_NAME) {
        const keyNameBuffer = buffer.slice(offset, offset + fieldLen);
        this.keyName = keyNameBuffer.toString('utf8');
        offset += fieldLen;
      } else if (fieldId & 1) {
        // Unknown critical field
        throw new IncompatibleKeyFileError(`Unknown critical header field: ${fieldId}`);
      } else {
        // Unknown non-critical field - safe to ignore
        offset += fieldLen;
      }
    }

    return offset;
  }

  /**
   * Load key entry from buffer
   */
  private async loadEntryFromBuffer(entry: KeyEntry, buffer: Buffer, offset: number): Promise<number> {
    while (offset + 4 <= buffer.length) {
      const fieldId = loadBe32(buffer, offset);
      offset += 4;

      if (fieldId === KeyField.END) {
        break;
      }

      if (offset + 4 > buffer.length) {
        throw new MalformedKeyFileError('Unexpected end of buffer while reading entry field length');
      }

      const fieldLen = loadBe32(buffer, offset);
      offset += 4;

      if (fieldLen > MAX_FIELD_LEN) {
        throw new MalformedKeyFileError(`Entry field length too large: ${fieldLen}`);
      }

      if (offset + fieldLen > buffer.length) {
        throw new MalformedKeyFileError('Unexpected end of buffer while reading entry field data');
      }

      if (fieldId === KeyField.VERSION) {
        if (fieldLen !== 4) {
          throw new MalformedKeyFileError(`Invalid version field length: ${fieldLen}`);
        }
        entry.version = loadBe32(buffer, offset);
        offset += 4;
      } else if (fieldId === KeyField.AES_KEY) {
        if (fieldLen !== AES_KEY_LEN) {
          throw new MalformedKeyFileError(`Invalid AES key field length: ${fieldLen}`);
        }
        buffer.copy(entry.aesKey, 0, offset, offset + AES_KEY_LEN);
        offset += AES_KEY_LEN;
      } else if (fieldId === KeyField.HMAC_KEY) {
        if (fieldLen !== HMAC_KEY_LEN) {
          throw new MalformedKeyFileError(`Invalid HMAC key field length: ${fieldLen}`);
        }
        buffer.copy(entry.hmacKey, 0, offset, offset + HMAC_KEY_LEN);
        offset += HMAC_KEY_LEN;
      } else if (fieldId & 1) {
        // Unknown critical field
        throw new IncompatibleKeyFileError(`Unknown critical entry field: ${fieldId}`);
      } else {
        // Unknown non-critical field - safe to ignore
        offset += fieldLen;
      }
    }

    return offset;
  }
