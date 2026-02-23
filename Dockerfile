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

# Install git, gh CLI, gog CLI, and gosu (for entrypoint user switching)
ARG GOG_VERSION=0.9.0
RUN apt-get update && apt-get install -y --no-install-recommends \
      git wget ca-certificates gosu && \
    # gh CLI via official apt repo
    mkdir -p -m 755 /etc/apt/keyrings && \
    wget -nv -O /tmp/gh-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg && \
    cp /tmp/gh-keyring.gpg /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y gh && \
    # gog CLI for Google Workspace
    ARCH=$(dpkg --print-architecture | sed 's/arm64/arm64/' | sed 's/amd64/amd64/') && \
    wget -O /tmp/gog.tar.gz \
      "https://github.com/steipete/gogcli/releases/download/v${GOG_VERSION}/gogcli_${GOG_VERSION}_linux_${ARCH}.tar.gz" && \
    tar -xzf /tmp/gog.tar.gz -C /usr/local/bin gog && \
    chmod +x /usr/local/bin/gog && \
    # Cleanup
    apt-get purge -y wget && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/* /tmp/gh-keyring.gpg /tmp/gog.tar.gz

# Copy the self-contained build output (includes its own node_modules)
COPY --from=builder /app/.mastra/output ./

# Copy Drizzle migrations (runMigrations() reads from ./drizzle at runtime)
COPY drizzle ./drizzle

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
