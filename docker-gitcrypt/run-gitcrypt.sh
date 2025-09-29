#!/bin/bash

# Build and run the git-crypt Docker container
# This script will encrypt files in the test/files directory and export them

# Get current user and group IDs to avoid permission issues
USER_ID=$(id -u)
GROUP_ID=$(id -g)

echo "Building git-crypt Docker container with USER_ID=$USER_ID and GROUP_ID=$GROUP_ID..."
docker build --build-arg USER_ID=$USER_ID --build-arg GROUP_ID=$GROUP_ID -t gitcrypt-test .

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
echo "Or use docker-compose (will use default UID/GID 1000):"
echo "docker-compose run --rm gitcrypt-test"
echo "docker-compose run --rm gitcrypt-test interactive"