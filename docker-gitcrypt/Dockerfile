FROM ubuntu:22.04

# Accept build arguments for user/group IDs
ARG USER_ID=1000
ARG GROUP_ID=1000

# Install build dependencies and git
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    libssl-dev \
    wget \
    file \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Create a user with the same UID/GID as the host user
RUN groupadd -g ${GROUP_ID} appuser && \
    useradd -m -u ${USER_ID} -g ${GROUP_ID} -s /bin/bash appuser && \
    echo "appuser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Create a working directory
WORKDIR /app

# Download and build git-crypt from source
RUN git clone https://www.agwa.name/git/git-crypt.git && \
    cd git-crypt && \
    make && \
    make install

# Set up git user (required for git operations)
RUN mkdir -p /app/test-repo && chown appuser:appuser /app/test-repo

USER appuser
RUN git config --global user.email "test@example.com" && \
    git config --global user.name "Test User"

# Copy entrypoint script and fix ownership
COPY docker-entrypoint.sh /app/entrypoint.sh
USER root
RUN chown appuser:appuser /app/entrypoint.sh && chmod +x /app/entrypoint.sh
USER appuser

# Set working directory to test repo
WORKDIR /app/test-repo

ENTRYPOINT ["/app/entrypoint.sh"]