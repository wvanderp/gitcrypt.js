/*
 * TypeScript implementation of git-crypt main CLI
 * Reference: git-crypt/git-crypt.cpp, git-crypt/git-crypt.hpp
 */

import {
  init,
  unlock,
  lock,
  exportKey,
  keygen,
  status,
  helpInit,
  helpUnlock,
  helpLock,
  helpExportKey,
  helpKeygen,
  helpStatus,
  CommandError
} from './commands';
import { initCrypto } from './crypto';
import { initStdStreams } from './util';

/**
 * Git-crypt version
 */
export const VERSION = '0.8.0-ts';

/**
 * Program name (set from argv[0])
 */
let argv0: string;

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`Usage: ${argv0} COMMAND [ARGS ...]`);
  console.log('');
  console.log('Common commands:');
  console.log('  init                 generate a key and prepare repo to use git-crypt');
  console.log('  status               display which files are encrypted');
  console.log('  lock                 de-configure git-crypt and re-encrypt files in work tree');
  console.log('');
  console.log('GPG commands:');
  console.log('  add-gpg-user USERID  add the user with the given GPG user ID as a collaborator');
  console.log('  unlock               decrypt this repo using the in-repo GPG-encrypted key');
  console.log('');
  console.log('Symmetric key commands:');
  console.log('  export-key FILE      export this repo\'s symmetric key to the given file');
  console.log('  unlock KEYFILE       decrypt this repo using the given symmetric key');
  console.log('');
  console.log('Legacy commands:');
  console.log('  init KEYFILE         alias for \'unlock KEYFILE\'');
  console.log('  keygen KEYFILE       generate a git-crypt key in the given file');
  console.log('  migrate-key OLD NEW  migrate the legacy key file OLD to the new format in NEW');
  console.log('');
  console.log(`See '${argv0} help COMMAND' for more information on a specific command.`);
}

/**
 * Print version information
 */
function printVersion(): void {
  console.log(`git-crypt ${VERSION}`);
}

/**
 * Print help for a specific command
 */
function helpForCommand(command: string): boolean {
  switch (command) {
    case 'init':
      helpInit();
      return true;
    case 'unlock':
      helpUnlock();
      return true;
    case 'lock':
      helpLock();
      return true;
    case 'export-key':
      helpExportKey();
      return true;
    case 'keygen':
      helpKeygen();
      return true;
    case 'status':
      helpStatus();
      return true;
    default:
      return false;
  }
}

/**
 * Main CLI function
 */
export async function main(argv: string[]): Promise<number> {
  argv0 = argv[0] || 'git-crypt';
  
  // Initialize subsystems
  initStdStreams();
  initCrypto();

  // Parse command line arguments
  const args = argv.slice(1);
  
  if (args.length === 0) {
    printUsage();
    return 2;
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  try {
    // Handle help and version commands
    if (command === 'help' || command === '--help' || command === '-h') {
      if (commandArgs.length === 1) {
        if (!helpForCommand(commandArgs[0])) {
          console.error(`Error: unknown command '${commandArgs[0]}'`);
          return 2;
        }
      } else {
        printUsage();
      }
      return 0;
    }

    if (command === 'version' || command === '--version' || command === '-v') {
      printVersion();
      return 0;
    }

    // Handle main commands
    switch (command) {
      case 'init':
        return await init(commandArgs);
      
      case 'unlock':
        return await unlock(commandArgs);
      
      case 'lock':
        return await lock(commandArgs);
      
      case 'export-key':
        return await exportKey(commandArgs);
      
      case 'keygen':
        return await keygen(commandArgs);
      
      case 'status':
        return await status(commandArgs);

      // Plumbing commands (simplified implementations)
      case 'clean':
        console.error('Error: clean command not implemented in this version');
        return 1;
      
      case 'smudge':
        console.error('Error: smudge command not implemented in this version');
        return 1;
      
      case 'diff':
        console.error('Error: diff command not implemented in this version');
        return 1;

      // GPG commands (not implemented in simplified version)
      case 'add-gpg-user':
        console.error('Error: GPG commands not implemented in this version');
        return 1;
      
      case 'rm-gpg-user':
        console.error('Error: GPG commands not implemented in this version');
        return 1;
      
      case 'ls-gpg-users':
        console.error('Error: GPG commands not implemented in this version');
        return 1;

      // Migration command (not implemented in simplified version)
      case 'migrate-key':
        console.error('Error: migrate-key command not implemented in this version');
        return 1;

      default:
        console.error(`Error: unknown command '${command}'`);
        printUsage();
        return 2;
    }
  } catch (error) {
    if (error instanceof CommandError) {
      console.error(error.message);
      return error.exitCode;
    } else {
      console.error(`Error: ${error}`);
      return 1;
    }
  }
}

/**
 * CLI entry point for Node.js
 */
if (require.main === module) {
  main(process.argv.slice(1)).then(exitCode => {
    process.exit(exitCode);
  }).catch(error => {
    console.error(`Unexpected error: ${error}`);
    process.exit(1);
  });
}
