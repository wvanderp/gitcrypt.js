# Git-Crypt Docker Test Setup

This Docker setup allows you to test the original git-crypt tool by encrypting files in the `/workspaces/gitcrypt.js/test/files` directory.

**Note**: This Docker setup is located in the `docker-gitcrypt/` folder to keep the project organized.

## What it does

1. **Builds git-crypt from source** - Downloads and compiles the official git-crypt tool from https://www.agwa.name/projects/git-crypt/
2. **Sets up encryption** - Creates a git repository with git-crypt initialized
3. **Encrypts test files** - Configures `.gitattributes` to encrypt all `.md` files in the test directory
4. **Exports encrypted files** - Uses `git-crypt lock` to force encryption in working directory and copies them to host
5. **Exports encryption key** - Saves the git-crypt key for later decryption
6. **Shows status** - Displays which files are encrypted and their binary signatures

## How it works

The key insight is that git-crypt only shows encrypted content when the repository is "locked". The process:

1. Files are added and committed to git (git-crypt encrypts them in git's object store)
2. In working directory, files remain decrypted for normal editing
3. `git-crypt lock` removes the key and shows encrypted versions in working directory
4. Encrypted files are then copied to the output directory for use in tests

## Files Created

- `Dockerfile` - Docker image with git-crypt installed
- `docker-entrypoint.sh` - Script that sets up git-crypt and encrypts files
- `docker-compose.yml` - Easy way to run the container
- `run-gitcrypt.sh` - Convenience script to build and run everything

## Usage

**Important**: Run these commands from the `docker-gitcrypt/` directory:

```bash
cd docker-gitcrypt
```

### Option 1: Use the convenience script
```bash
./run-gitcrypt.sh
```

### Option 2: Use Docker Compose
```bash
# Run once and exit
docker-compose run --rm gitcrypt-test

# Run interactively (to explore the encrypted repository)
docker-compose run --rm gitcrypt-test interactive
```

### Option 3: Use Docker directly
```bash
# Build the image
docker build -t gitcrypt-test .

# Run once and exit
docker run --rm -v "$(dirname $(pwd))/test/files:/app/source-files:ro" -v "$(dirname $(pwd))/test/files-encrypted:/app/output" gitcrypt-test

# Run interactively
docker run --rm -it -v "$(dirname $(pwd))/test/files:/app/source-files:ro" -v "$(dirname $(pwd))/test/files-encrypted:/app/output" gitcrypt-test interactive
```

## What happens inside the container

1. Initializes a new git repository
2. Runs `git-crypt init` to set up encryption
3. Creates `.gitattributes` file that specifies `test/files/*.md` should be encrypted
4. Copies your test files from the mounted volume
5. Commits the files (which triggers encryption)
6. Shows the git-crypt status and file types

## Expected Output

You should see output like:
```
Initializing git repository...
Setting up git-crypt...
Generating key...
Creating .gitattributes file...
Adding .gitattributes to git...
Copying test files...
Adding and committing files (this will encrypt them)...
Showing git-crypt status...
not encrypted: .gitattributes
    encrypted: test/files/second.md
    encrypted: test/files/test.md
Exporting git-crypt key (before locking)...
Getting encrypted files from git storage...
Copying encrypted files from locked repository...
File types of exported encrypted files:
/app/output/second.md: data
/app/output/test.md:   data
Hex dump of first encrypted file (first 32 bytes):
0000000 00 47 49 54 43 52 59 50 54 00 2b fe 23 04 ba 90
Done! Files have been encrypted with git-crypt.
```

The key indicators of success:
- Files show type "data" (not "ASCII text")  
- Hex dump shows "GITCRYPT" header (bytes 47 49 54 43 52 59 50 54)
- Files are copied to `test/files-encrypted/` directory

## Interactive Mode

When running in interactive mode, you can:
- Examine the encrypted files: `cat test/files/test.md` (will show binary data)
- Check git-crypt status: `git-crypt status`
- Export the key: `git-crypt export-key /tmp/key.key`
- Lock the repository: `git-crypt lock`
- Unlock with key: `git-crypt unlock /tmp/key.key`

## Test Files

The container will encrypt all `.md` files from your `test/files` directory:
- `test.md` - Plain text markdown file
- `second.md` - Another test file (if present)

## Encrypted Output

The encrypted files are saved to `../test/files-encrypted/` with:
- **Encrypted content** - Binary files with "GITCRYPT" signature
- **Encryption key** - `git-crypt.key` file for decryption
- **Proper git-crypt format** - Ready for use in your test suite

## Volume Mounting

The container uses two volume mounts:
- **Input**: `../test/files` → `/app/source-files` (read-only source files)
- **Output**: `../test/files-encrypted` → `/app/output` (encrypted files destination)

This ensures:
- Your original files are never modified (read-only mount)
- Encrypted files are accessible from your host system
- You can use the encrypted files in your test suite
- You can safely run this multiple times

## Troubleshooting

If you get permission errors, make sure the script is executable:
```bash
chmod +x run-gitcrypt.sh
```

If Docker build fails, ensure you have internet connectivity as it needs to:
- Download Ubuntu packages
- Clone git-crypt from the official repository