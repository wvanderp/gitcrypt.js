## Docker Git-Crypt Test Setup

For testing with the original git-crypt tool, see the Docker setup in the `docker-gitcrypt/` directory.

```bash
cd docker-gitcrypt
./run-gitcrypt.sh
```

This will create encrypted test files in `test/files-encrypted/` using the real git-crypt implementation for comparison testing.