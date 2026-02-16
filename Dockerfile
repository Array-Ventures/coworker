FROM oven/bun:1-debian AS builder

WORKDIR /app

# Install build dependencies for native modules (fastembed, libsql)
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

# Install gog CLI for Google Workspace integration
ARG GOG_VERSION=0.9.0
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && \
    ARCH=$(dpkg --print-architecture | sed 's/arm64/arm64/' | sed 's/amd64/amd64/') && \
    wget -O /tmp/gog.tar.gz \
      "https://github.com/steipete/gogcli/releases/download/v${GOG_VERSION}/gogcli_${GOG_VERSION}_linux_${ARCH}.tar.gz" && \
    tar -xzf /tmp/gog.tar.gz -C /usr/local/bin gog && \
    chmod +x /usr/local/bin/gog && \
    rm /tmp/gog.tar.gz && \
    apt-get purge -y wget && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Copy the self-contained build output (includes its own node_modules)
COPY --from=builder /app/.mastra/output ./

# Create non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -m -u 1001 -g nodejs mastra

# Create workspace and data directories
RUN mkdir -p /data/whatsapp-auth /data/gog /workspaces/shared /workspaces/coworker /workspaces/skills && \
    chown -R mastra:nodejs /app /data /workspaces

USER mastra

ENV NODE_ENV=production
ENV PORT=4111
ENV MASTRA_STUDIO_PATH=./studio

EXPOSE 4111

CMD ["bun", "run", "index.mjs"]
