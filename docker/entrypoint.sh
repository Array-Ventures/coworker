#!/bin/bash
set -e

DP="${DATA_PATH:-/data}"
WS="$DP/workspace"

# Ensure directories exist on the persistent volume
mkdir -p "$WS/.agents/skills" "$WS/.bin" "$DP/config"

# Fix ownership on top-level dirs only (volume mounts start as root)
chown mastra:nodejs "$DP" "$DP/home" "$DP/whatsapp-auth" "$DP/gog" "$DP/config" \
  "$WS" "$WS/.agents" "$WS/.agents/skills" "$WS/.bin"

# Built-in skills are seeded by the app on startup (src/mastra/config/seed-skills.ts)
# No need to copy them here — works for both Docker and local dev.

# Drop to non-root user and exec the CMD
exec gosu mastra "$@"
