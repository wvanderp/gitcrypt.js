#!/bin/bash

# Build and run the git-crypt Docker container
# This script will encrypt files in the test/files directory and export them

echo "Building git-crypt Docker container..."
docker build -t gitcrypt-test .

# Create output directory if it doesn't exist
mkdir -p ../test/files-encrypted

echo "Running git-crypt container to encrypt test files..."
docker run --rm \
    -v "$(dirname $(pwd))/test/files:/app/source-files:ro" \
    -v "$(dirname $(pwd))/test/files-encrypted:/app/output" \
    gitcrypt-test

echo ""
echo "Encrypted files have been saved to: ../test/files-encrypted/"
echo "Git-crypt key has been saved to: ../test/files-encrypted/git-crypt.key"

echo ""
echo "To run the container interactively:"
echo "docker run --rm -it -v \"$(dirname $(pwd))/test/files:/app/source-files:ro\" -v \"$(dirname $(pwd))/test/files-encrypted:/app/output\" gitcrypt-test interactive"

echo ""
echo "Or use docker-compose:"
echo "docker-compose run --rm gitcrypt-test"
echo "docker-compose run --rm gitcrypt-test interactive"