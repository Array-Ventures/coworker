#!/bin/bash
set -e

WORKSPACE="${WORKSPACE_PATH:-/workspaces}"

# Ensure workspace directories exist on the persistent volume
mkdir -p "$WORKSPACE/shared" "$WORKSPACE/coworker" "$WORKSPACE/skills"

# Fix ownership on top-level dirs only (volume mounts start as root)
chown mastra:nodejs /data /data/home /data/whatsapp-auth /data/gog \
  "$WORKSPACE" "$WORKSPACE/shared" "$WORKSPACE/coworker" "$WORKSPACE/skills"

# Seed built-in skills (only if not already present)
for skill in /app/builtin-skills/*/; do
  name=$(basename "$skill")
  [ -d "$WORKSPACE/skills/$name" ] || cp -r "$skill" "$WORKSPACE/skills/$name"
done

# Drop to non-root user and exec the CMD
exec gosu mastra "$@"
