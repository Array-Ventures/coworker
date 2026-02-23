FROM oven/bun:1-debian AS builder

WORKDIR /app

# Install build dependencies for native modules (fastembed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ nodejs npm && \
    rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src ./src
COPY tsconfig.json ./
RUN npx mastra build --studio && \
    cd .mastra/output && bun pm trust --all 2>/dev/null; bun install || true

# ── Production (Debian for glibc native module compatibility) ──
FROM oven/bun:1-debian

WORKDIR /app

# Install runtimes, CLIs, and tools for agent sandbox
ARG GOG_VERSION=0.9.0
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates gosu python3 python3-pip python3-venv && \
    # Node.js 22 LTS via NodeSource
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    # gh CLI via official apt repo
    mkdir -p -m 755 /etc/apt/keyrings && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y gh && \
    # gog CLI for Google Workspace
    ARCH=$(dpkg --print-architecture | sed 's/arm64/arm64/' | sed 's/amd64/amd64/') && \
    curl -fsSL -o /tmp/gog.tar.gz \
      "https://github.com/steipete/gogcli/releases/download/v${GOG_VERSION}/gogcli_${GOG_VERSION}_linux_${ARCH}.tar.gz" && \
    tar -xzf /tmp/gog.tar.gz -C /usr/local/bin gog && \
    chmod +x /usr/local/bin/gog && \
    # Cleanup
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/* /tmp/gog.tar.gz

# Copy the self-contained build output (includes its own node_modules)
COPY --from=builder /app/.mastra/output ./
# Create non-root user with home on persistent volume
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -d /data/home -s /bin/bash mastra

# Create data directories
RUN mkdir -p /data/home /data/whatsapp-auth /data/gog /data/config /data/workspace && \
    chown -R mastra:nodejs /app /data

# Copy built-in skills for seeding into workspace
COPY src/mastra/skills /app/builtin-skills

# Entrypoint: fix volume ownership (mounted as root), then drop to mastra user
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_PATH=/data
ENV MASTRA_STUDIO_PATH=./studio

EXPOSE 8080

ENTRYPOINT ["entrypoint.sh"]
CMD ["bun", "run", "index.mjs"]
