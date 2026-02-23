/**
 * MCP server configuration — read/write from filesystem.
 * Stored at $DATA_PATH/config/mcp.json
 */
import fs from 'fs';
import path from 'path';
import { CONFIG_PATH } from '../config/paths';
import type { McpServerConfig, McpFileConfig } from './types';

const MCP_CONFIG_FILE = path.join(CONFIG_PATH, 'mcp.json');

function ensureDir() {
  fs.mkdirSync(path.dirname(MCP_CONFIG_FILE), { recursive: true });
}

export function loadMcpServers(): McpServerConfig[] {
  try {
    const raw = fs.readFileSync(MCP_CONFIG_FILE, 'utf-8');
    const config: McpFileConfig = JSON.parse(raw);
    return config.servers ?? [];
  } catch { return []; }
}

export function saveMcpServers(servers: McpServerConfig[]): void {
  ensureDir();
  const config: McpFileConfig = { servers };
  fs.writeFileSync(MCP_CONFIG_FILE, JSON.stringify(config, null, 2));
}
