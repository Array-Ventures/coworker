#!/bin/bash
set -e

# Fix ownership on mounted volumes (they start as root)
chown -R mastra:nodejs /data /workspaces

# Drop to non-root user and exec the CMD
exec gosu mastra "$@"
