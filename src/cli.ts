#!/usr/bin/env node

/*
 * CLI entry point for git-crypt TypeScript implementation
 */

import { main } from './gitCrypt';

// Run the main function with command line arguments
main(process.argv).then(exitCode => {
  process.exit(exitCode);
}).catch(error => {
  console.error(`Unexpected error: ${error}`);
  process.exit(1);
});