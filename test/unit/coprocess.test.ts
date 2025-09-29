import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'stream';
import { Coprocess } from '../../src/coprocess';
import { SystemError } from '../../src/util';

async function collectStream(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const onData = (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };

    const cleanup = () => {
      stream.removeListener('data', onData);
      stream.removeListener('error', onError);
      stream.removeListener('end', onEnd);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };

    stream.on('data', onData);
    stream.once('error', onError);
    stream.once('end', onEnd);
  });
}

function writeToStream(stream: Writable, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(data, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

describe('Coprocess', () => {
  it('captures stdout from a spawned process', async () => {
    const coprocess = new Coprocess();
    const stdout = coprocess.stdoutPipe();

    coprocess.spawn([process.execPath, '-e', "process.stdout.write('hello')"]);

    const outputPromise = collectStream(stdout);
    const exitCode = await coprocess.wait();
    coprocess.closeStdout();

    const output = await outputPromise;
    expect(exitCode).toBe(0);
    expect(output).toBe('hello');
  });

  it('writes to stdin and reads transformed stdout', async () => {
    const coprocess = new Coprocess();
    const stdin = coprocess.stdinPipe();
    const stdout = coprocess.stdoutPipe();

    // Write before spawning to ensure buffered data is delivered once the
    // child process is running.
    await writeToStream(stdin, 'hello world\n');

    coprocess.spawn([
      process.execPath,
      '-e',
      "process.stdin.on('data', chunk => process.stdout.write(chunk.toString().toUpperCase()))"
    ]);

    coprocess.closeStdin();
    const outputPromise = collectStream(stdout);
    const exitCode = await coprocess.wait();
    coprocess.closeStdout();

    const output = await outputPromise;
    expect(exitCode).toBe(0);
    expect(output).toBe('HELLO WORLD\n');
  });

  it('propagates spawn errors via wait()', async () => {
    const coprocess = new Coprocess();

    coprocess.spawn(['git-crypt-nonexistent-command']);

    await expect(coprocess.wait()).rejects.toBeInstanceOf(SystemError);
  });
});
