/*
 * TypeScript implementation of git-crypt coprocess handling
 * Reference: git-crypt/coprocess.cpp, coprocess-unix.cpp, coprocess-win32.cpp
 */

import { spawn, SpawnOptions } from 'child_process';
import { PassThrough, Readable, Writable } from 'stream';
import { constants as osConstants } from 'os';
import { GitCryptError, SystemError } from './util';

export type CoprocessStderrMode = 'inherit' | 'pipe' | 'ignore';

export interface CoprocessSpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stderr?: CoprocessStderrMode;
}

function signalToExitCode(signal: NodeJS.Signals | null): number {
  if (!signal) {
    return 0;
  }

  const signals = (osConstants as unknown as { signals?: Record<string, number> }).signals;
  const signalNumber = signals && signals[signal];

  if (typeof signalNumber === 'number') {
    return 128 + signalNumber;
  }

  return 128;
}

export class Coprocess {
  private child: import('child_process').ChildProcess | null = null;
  private stdinProxy: PassThrough | null = null;
  private stdoutProxy: PassThrough | null = null;
  private stderrProxy: PassThrough | null = null;
  private waitPromise: Promise<number> | null = null;
  private stdinClosed = false;
  private stdoutClosed = false;
  private stderrClosed = false;
  private readonly defaultOptions: CoprocessSpawnOptions;
  private spawned = false;
  private currentStderrMode: CoprocessStderrMode;

  constructor(options: CoprocessSpawnOptions = {}) {
    this.defaultOptions = { ...options };
    this.currentStderrMode = this.defaultOptions.stderr ?? 'inherit';
  }

  /**
   * Get writable stream connected to the child process stdin.
   * May be called before or after spawn().
   */
  public stdinPipe(): Writable {
    if (this.stdinClosed) {
      throw new GitCryptError('stdin pipe has been closed');
    }

    if (!this.stdinProxy) {
      this.stdinProxy = new PassThrough();
      this.connectStdinIfNeeded();
    }

    return this.stdinProxy;
  }

  /**
   * Close stdin pipe, signalling EOF to the child process.
   */
  public closeStdin(): void {
    this.stdinClosed = true;

    if (this.stdinProxy && !this.stdinProxy.destroyed) {
      this.stdinProxy.end();
    }

    if (this.child && this.child.stdin && !this.child.stdin.destroyed) {
      this.child.stdin.end();
    }

    this.stdinProxy = null;
  }

  /**
   * Get readable stream connected to the child process stdout.
   * May be called before or after spawn().
   */
  public stdoutPipe(): Readable {
    if (this.stdoutClosed) {
      throw new GitCryptError('stdout pipe has been closed');
    }

    if (!this.stdoutProxy) {
      this.stdoutProxy = new PassThrough();
      this.connectStdoutIfNeeded();
    }

    return this.stdoutProxy;
  }

  /**
   * Close stdout pipe, stopping further reads.
   */
  public closeStdout(): void {
    this.stdoutClosed = true;

    if (this.child && this.child.stdout && this.stdoutProxy) {
      this.child.stdout.unpipe(this.stdoutProxy);
    }

    if (this.stdoutProxy && !this.stdoutProxy.destroyed) {
      this.stdoutProxy.destroy();
    }

    this.stdoutProxy = null;
  }

  /**
   * Get readable stream connected to the child stderr (if configured for piping).
   */
  public stderrPipe(): Readable {
    if (this.stderrClosed) {
      throw new GitCryptError('stderr pipe has been closed');
    }

    if (!this.stderrProxy) {
      if (this.spawned && this.currentStderrMode !== 'pipe') {
        throw new GitCryptError('stderr was not configured for piping before spawn');
      }

      this.stderrProxy = new PassThrough();
      this.currentStderrMode = 'pipe';
      this.connectStderrIfNeeded();
    }

    return this.stderrProxy;
  }

  /**
   * Close stderr pipe when piping is enabled.
   */
  public closeStderr(): void {
    this.stderrClosed = true;

    if (this.child && this.child.stderr && this.stderrProxy) {
      this.child.stderr.unpipe(this.stderrProxy);
    }

    if (this.stderrProxy && !this.stderrProxy.destroyed) {
      this.stderrProxy.destroy();
    }

    this.stderrProxy = null;
    if (!this.spawned) {
      this.currentStderrMode = this.defaultOptions.stderr ?? 'inherit';
    }
  }

  /**
   * Spawn the child process with the provided arguments.
   */
  public spawn(args: string[], options: CoprocessSpawnOptions = {}): void {
    if (this.spawned) {
      throw new GitCryptError('coprocess already spawned');
    }

    if (!Array.isArray(args) || args.length === 0) {
      throw new GitCryptError('no command specified for coprocess');
    }

    const [command, ...commandArgs] = args;
    const mergedOptions: CoprocessSpawnOptions = {
      ...this.defaultOptions,
      ...options
    };

    let stderrMode: CoprocessStderrMode;
    if (this.stderrProxy) {
      stderrMode = 'pipe';
    } else if (typeof mergedOptions.stderr !== 'undefined') {
      stderrMode = mergedOptions.stderr;
    } else {
      stderrMode = 'inherit';
    }
    this.currentStderrMode = stderrMode;

    const stdio: SpawnOptions['stdio'] = [
      'pipe',
      'pipe',
      stderrMode
    ];

    const spawnOptions: SpawnOptions = {
      cwd: mergedOptions.cwd,
      env: mergedOptions.env,
      stdio,
      windowsHide: true,
      shell: false
    };

    try {
      this.child = spawn(command, commandArgs, spawnOptions);
    } catch (error: any) {
      throw new SystemError('spawn', command, error?.errno ?? -1, error?.message);
    }

    this.spawned = true;

    this.connectStdinIfNeeded();
    this.connectStdoutIfNeeded();
    this.connectStderrIfNeeded();

    if (this.child.stdout && !this.stdoutProxy) {
      this.child.stdout.resume();
    }

    this.waitPromise = new Promise<number>((resolve, reject) => {
      if (!this.child) {
        reject(new GitCryptError('coprocess not spawned'));
        return;
      }

      let settled = false;
      const childProcess = this.child;

      const handleError = (error: Error & { errno?: number }): void => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new SystemError('spawn', command, error?.errno ?? -1, error.message));
      };

      childProcess.once('error', handleError);

      childProcess.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) {
          return;
        }
        settled = true;

        if (this.stdoutProxy && !this.stdoutProxy.destroyed) {
          this.stdoutProxy.end();
        }
        if (this.stderrProxy && !this.stderrProxy.destroyed) {
          this.stderrProxy.end();
        }
        if (this.stdinProxy && !this.stdinProxy.destroyed) {
          this.stdinProxy.end();
        }

        if (signal) {
          resolve(signalToExitCode(signal));
        } else {
          resolve(code ?? 0);
        }
      });
    });
  }

  /**
   * Wait for the child process to exit and return its exit code.
   */
  public async wait(): Promise<number> {
    if (!this.waitPromise) {
      throw new GitCryptError('coprocess not spawned');
    }

    return this.waitPromise;
  }

  /**
   * Kill the child process if it is still running.
   */
  public terminate(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.child && !this.child.killed) {
      this.child.kill(signal);
    }
  }

  private connectStdinIfNeeded(): void {
    if (!this.child || !this.child.stdin || !this.stdinProxy) {
      return;
    }

    if (this.stdinProxy.readableEnded || this.stdinProxy.destroyed) {
      return;
    }

    if (!this.stdinProxy.listeners('finish').some(listener => listener === this.handleStdinFinish)) {
      this.stdinProxy.once('finish', this.handleStdinFinish);
    }

    if (!(this.stdinProxy as any)._coprocessPiped) {
      this.stdinProxy.pipe(this.child.stdin!);
      (this.stdinProxy as any)._coprocessPiped = true;
    }

    if (!(this.child.stdin as any)._coprocessErrorHandlerAdded) {
      this.child.stdin.on('error', () => {
        // Suppress EPIPE and similar errors when the child exits early
      });
      (this.child.stdin as any)._coprocessErrorHandlerAdded = true;
    }
  }

  private connectStdoutIfNeeded(): void {
    if (!this.child || !this.child.stdout) {
      return;
    }

    if (!this.stdoutProxy) {
      this.child.stdout.resume();
      return;
    }

    if (!(this.stdoutProxy as any)._coprocessPiped) {
      this.child.stdout.pipe(this.stdoutProxy);
      (this.stdoutProxy as any)._coprocessPiped = true;
    }
  }

  private connectStderrIfNeeded(): void {
    if (!this.child || !this.child.stderr) {
      return;
    }

    if (this.currentStderrMode !== 'pipe' && !this.stderrProxy) {
      return;
    }

    if (!this.stderrProxy && this.currentStderrMode === 'pipe') {
      // If stderr was explicitly configured as pipe but no consumer was created,
      // drain it to avoid deadlocks.
      this.child.stderr.resume();
      return;
    }

    if (!this.stderrProxy) {
      return;
    }

    if (!(this.stderrProxy as any)._coprocessPiped) {
      this.child.stderr.pipe(this.stderrProxy);
      (this.stderrProxy as any)._coprocessPiped = true;
    }
  }

  private handleStdinFinish = (): void => {
    if (this.child && this.child.stdin && !this.child.stdin.destroyed) {
      this.child.stdin.end();
    }
  };
}
