#!/bin/bash
set -e

echo "Initializing git repository..."
git init

echo "Setting up git-crypt..."
git-crypt init

echo "Creating .gitattributes file..."
cat > .gitattributes << 'EOF'
# Encrypt all markdown files in the files directory
test/files/*.md filter=git-crypt diff=git-crypt
EOF

echo "Adding .gitattributes to git..."
git add .gitattributes
git commit -m "Add git-crypt configuration"

echo "Copying test files..."
mkdir -p test/files
cp -r /app/source-files/* test/files/ 2>/dev/null || true

echo "Adding and committing files (this will encrypt them)..."
git add test/files/
git commit -m "Add test files (encrypted)"

echo "Showing git-crypt status..."
git-crypt status

echo "Exporting git-crypt key (before locking)..."
if [ -d "/app/output" ]; then
    git-crypt export-key /app/output/git-crypt.key
    echo "Git-crypt key exported to /app/output/git-crypt.key"
fi

echo "Listing encrypted files..."
find test/files -name "*.md" -exec file {} \;

echo "Getting encrypted files from git storage..."
if [ -d "/app/output" ]; then
    # Lock the repository to force encryption in working directory
    git-crypt lock
    
    # Now the working directory files should be encrypted
    echo "Copying encrypted files from locked repository..."
    cp test/files/* /app/output/
    
    echo "Encrypted files copied to output directory:"
    ls -la /app/output/
    
    # Show file types to confirm encryption
    echo "File types of exported encrypted files:"
    file /app/output/*.md
    
    # Also show hex dump to verify encryption
    echo "Hex dump of first encrypted file (first 32 bytes):"
    if command -v hexdump >/dev/null 2>&1; then
        hexdump -C /app/output/test.md | head -2
    else
        od -t x1 /app/output/test.md | head -2
    fi
else
    echo "No output directory mounted, files remain in container only"
fi

echo "Done! Files have been encrypted with git-crypt."
echo "To decrypt files, use: git-crypt unlock /path/to/key"

# Keep container running if requested
if [ "$1" = "interactive" ]; then
    echo "Starting interactive shell..."
    exec /bin/bash
fi