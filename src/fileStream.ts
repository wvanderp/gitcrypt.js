/*
 * TypeScript implementation of git-crypt file stream utilities
 * Reference: git-crypt/fhstream.cpp, git-crypt/fhstream.hpp
 */

import * as fs from 'fs';
import { Readable, Writable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

/**
 * Default buffer size for file operations
 */
export const DEFAULT_BUFFER_SIZE = 8192;

/**
 * File handle stream for reading from file descriptors
 */
export class FileHandleReadStream extends Readable {
  private fileHandle: fs.promises.FileHandle;
  private position: number;
  private bufferSize: number;
  private _closed: boolean;

  constructor(fileHandle: fs.promises.FileHandle, options: { bufferSize?: number } = {}) {
    super({ objectMode: false });
    this.fileHandle = fileHandle;
    this.position = 0;
    this.bufferSize = options.bufferSize || DEFAULT_BUFFER_SIZE;
    this._closed = false;
  }

  async _read(size?: number): Promise<void> {
    if (this._closed) {
      this.push(null);
      return;
    }

    try {
      const readSize = size || this.bufferSize;
      const buffer = Buffer.alloc(readSize);
      const result = await this.fileHandle.read(buffer, 0, readSize, this.position);
      
      if (result.bytesRead === 0) {
        // EOF reached
        this.push(null);
        return;
      }

      this.position += result.bytesRead;
      this.push(buffer.slice(0, result.bytesRead));
    } catch (error) {
      this.destroy(error as Error);
    }
  }

  async _destroy(error: Error | null, callback: (error?: Error | null) => void): Promise<void> {
    this._closed = true;
    try {
      await this.fileHandle.close();
    } catch (closeError) {
      // Ignore close errors if there was already an error
      if (!error) {
        error = closeError as Error;
      }
    }
    callback(error);
  }
}

/**
 * File handle stream for writing to file descriptors
 */
export class FileHandleWriteStream extends Writable {
  private fileHandle: fs.promises.FileHandle;
  private position: number;
  private bufferSize: number;
  private _closed: boolean;

  constructor(fileHandle: fs.promises.FileHandle, options: { bufferSize?: number } = {}) {
    super({ objectMode: false });
    this.fileHandle = fileHandle;
    this.position = 0;
    this.bufferSize = options.bufferSize || DEFAULT_BUFFER_SIZE;
    this._closed = false;
  }

  async _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): Promise<void> {
    if (this._closed) {
      callback(new Error('Stream is closed'));
      return;
    }

    try {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      let written = 0;
      
      while (written < buffer.length) {
        const result = await this.fileHandle.write(buffer, written, buffer.length - written, this.position);
        written += result.bytesWritten;
        this.position += result.bytesWritten;
      }
      
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  async _destroy(error: Error | null, callback: (error?: Error | null) => void): Promise<void> {
    this._closed = true;
    try {
      await this.fileHandle.sync();
      await this.fileHandle.close();
    } catch (closeError) {
      // Ignore close errors if there was already an error
      if (!error) {
        error = closeError as Error;
      }
    }
    callback(error);
  }
}

/**
 * Create a readable stream from a file path
 */
export async function createReadStream(filePath: string, options: { bufferSize?: number } = {}): Promise<FileHandleReadStream> {
  const fileHandle = await fs.promises.open(filePath, 'r');
  return new FileHandleReadStream(fileHandle, options);
}

/**
 * Create a writable stream to a file path
 */
export async function createWriteStream(filePath: string, options: { bufferSize?: number; mode?: number } = {}): Promise<FileHandleWriteStream> {
  const fileHandle = await fs.promises.open(filePath, 'w', options.mode || 0o644);
  return new FileHandleWriteStream(fileHandle, options);
}

/**
 * Copy data from one stream to another with progress tracking
 */
export async function copyStream(
  source: Readable,
  destination: Writable,
  options: {
    bufferSize?: number;
    onProgress?: (bytesWritten: number) => void;
  } = {}
): Promise<number> {
  let totalBytes = 0;
  const bufferSize = options.bufferSize || DEFAULT_BUFFER_SIZE;

  const transform = new Transform({
    transform(chunk: any, encoding: BufferEncoding, callback: Function) {
      totalBytes += chunk.length;
      if (options.onProgress) {
        options.onProgress(totalBytes);
      }
      callback(null, chunk);
    }
  });

  await pipeline(source, transform, destination);
  return totalBytes;
}

/**
 * Read entire file content into a buffer
 */
export async function readFileToBuffer(filePath: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const stream = await createReadStream(filePath);
  
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    
    stream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    
    stream.on('error', reject);
  });
}

/**
 * Write buffer content to a file
 */
export async function writeBufferToFile(buffer: Buffer, filePath: string, options: { mode?: number } = {}): Promise<void> {
  const stream = await createWriteStream(filePath, { mode: options.mode });
  
  return new Promise((resolve, reject) => {
    stream.write(buffer, (error) => {
      if (error) {
        reject(error);
      } else {
        stream.end(() => resolve());
      }
    });
    
    stream.on('error', reject);
  });
}

/**
 * Stream that splits data into fixed-size chunks
 */
export class ChunkingStream extends Transform {
  private chunkSize: number;
  private buffer: Buffer;

  constructor(chunkSize: number) {
    super({ objectMode: false });
    this.chunkSize = chunkSize;
    this.buffer = Buffer.alloc(0);
  }

  _transform(chunk: any, encoding: BufferEncoding, callback: Function): void {
    this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)]);
    
    while (this.buffer.length >= this.chunkSize) {
      const outputChunk = this.buffer.slice(0, this.chunkSize);
      this.buffer = this.buffer.slice(this.chunkSize);
      this.push(outputChunk);
    }
    
    callback();
  }

  _flush(callback: Function): void {
    if (this.buffer.length > 0) {
      this.push(this.buffer);
      this.buffer = Buffer.alloc(0);
    }
    callback();
  }
}

/**
 * Stream that processes data in aligned blocks
 */
export class BlockAlignedStream extends Transform {
  private blockSize: number;
  private buffer: Buffer;

  constructor(blockSize: number) {
    super({ objectMode: false });
    this.blockSize = blockSize;
    this.buffer = Buffer.alloc(0);
  }

  _transform(chunk: any, encoding: BufferEncoding, callback: Function): void {
    this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)]);
    
    // Process complete blocks
    while (this.buffer.length >= this.blockSize) {
      const block = this.buffer.slice(0, this.blockSize);
      this.buffer = this.buffer.slice(this.blockSize);
      this.push(block);
    }
    
    callback();
  }

  _flush(callback: Function): void {
    // Handle remaining partial block
    if (this.buffer.length > 0) {
      const paddedBlock = Buffer.alloc(this.blockSize);
      this.buffer.copy(paddedBlock);
      this.push(paddedBlock);
      this.buffer = Buffer.alloc(0);
    }
    callback();
  }
}

/**
 * Memory-efficient stream for processing large files
 */
export class MemoryEfficientStream extends Transform {
  private maxBufferSize: number;
  private currentBufferSize: number;

  constructor(maxBufferSize: number = 64 * 1024) { // 64KB default
    super({
      objectMode: false,
      highWaterMark: Math.min(maxBufferSize, 16 * 1024) // Smaller high water mark
    });
    this.maxBufferSize = maxBufferSize;
    this.currentBufferSize = 0;
  }

  _transform(chunk: any, encoding: BufferEncoding, callback: Function): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.currentBufferSize += buffer.length;
    
    // If we're approaching memory limits, apply backpressure
    if (this.currentBufferSize > this.maxBufferSize) {
      setImmediate(() => {
        this.currentBufferSize -= buffer.length;
        this.push(buffer);
        callback();
      });
    } else {
      this.push(buffer);
      callback();
    }
  }

  _flush(callback: Function): void {
    this.currentBufferSize = 0;
    callback();
  }
}

/**
 * Utility to create a pipeline with proper error handling
 */
export async function createPipeline(streams: (Readable | Writable | Transform)[]): Promise<void> {
  if (streams.length < 2) {
    throw new Error('Pipeline requires at least 2 streams');
  }

  try {
    await pipeline(streams[0] as any, ...streams.slice(1) as any[]);
  } catch (error) {
    // Ensure all streams are properly cleaned up
    for (const stream of streams) {
      if (!stream.destroyed) {
        stream.destroy();
      }
    }
    throw error;
  }
}

/**
 * Create a null stream (discards all data)
 */
export function createNullWriteStream(): Writable {
  return new Writable({
    write(chunk: any, encoding: BufferEncoding, callback: Function) {
      callback();
    }
  });
}

/**
 * Create an empty readable stream
 */
export function createEmptyReadStream(): Readable {
  return new Readable({
    read() {
      this.push(null); // EOF
    }
  });
}