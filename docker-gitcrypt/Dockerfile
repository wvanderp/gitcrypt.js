FROM ubuntu:22.04

# Install build dependencies and git
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    libssl-dev \
    wget \
    file \
    && rm -rf /var/lib/apt/lists/*

# Create a working directory
WORKDIR /app

# Download and build git-crypt from source
RUN git clone https://www.agwa.name/git/git-crypt.git && \
    cd git-crypt && \
    make && \
    make install

# Set up git user (required for git operations)
RUN git config --global user.email "test@example.com" && \
    git config --global user.name "Test User"

# Create directory for test files
RUN mkdir -p /app/test-repo

# Copy entrypoint script
COPY docker-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Set working directory to test repo
WORKDIR /app/test-repo

ENTRYPOINT ["/app/entrypoint.sh"]