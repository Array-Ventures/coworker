#!/bin/bash
set -e

# Fix ownership on mounted volumes (they start as root)
chown -R mastra:nodejs /data /workspaces

# Seed built-in skills (only if not already present)
for skill in /app/builtin-skills/*/; do
  name=$(basename "$skill")
  [ -d "/workspaces/skills/$name" ] || cp -r "$skill" "/workspaces/skills/$name"
done

# Drop to non-root user and exec the CMD
exec gosu mastra "$@"
