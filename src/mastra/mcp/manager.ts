/**
 * MCP manager — connects to external MCP servers and provides their tools.
 * Wraps MCPClient with config-file-backed server definitions and hash-based caching.
 */
import { MCPClient } from '@mastra/mcp';
import { loadMcpServers, saveMcpServers } from './config';
import type { McpServerConfig } from './types';

let _client: MCPClient | null = null;
let _configHash = '';

function buildServerDefs(configs: McpServerConfig[]): Record<string, any> {
  const servers: Record<string, any> = {};
  for (const cfg of configs) {
    if (!cfg.enabled) continue;
    if (cfg.type === 'stdio' && cfg.command) {
      servers[cfg.name] = {
        command: cfg.command,
        args: cfg.args || [],
        env: cfg.env || {},
      };
    } else if (cfg.type === 'http' && cfg.url) {
      servers[cfg.name] = {
        url: new URL(cfg.url),
        ...(cfg.headers && Object.keys(cfg.headers).length > 0
          ? { requestInit: { headers: cfg.headers } }
          : {}),
      };
    }
  }
  return servers;
}

export async function disconnectMcp(): Promise<void> {
  if (_client) {
    await _client.disconnect();
    _client = null;
    _configHash = '';
  }
}

export function getMcpServers(): McpServerConfig[] {
  return loadMcpServers();
}

export async function setMcpServers(servers: McpServerConfig[]): Promise<void> {
  saveMcpServers(servers);
  await disconnectMcp();
}

export async function getMcpToolsets(): Promise<Record<string, Record<string, any>>> {
  console.time('[perf] getMcpToolsets');
  const configs = loadMcpServers();
  const enabled = configs.filter((c) => c.enabled);
  if (enabled.length === 0) {
    await disconnectMcp();
    console.timeEnd('[perf] getMcpToolsets');
    return {};
  }

  const hash = JSON.stringify(enabled);
  if (_client && _configHash === hash) {
    try {
      const toolsets = await _client.listToolsets();
      console.timeEnd('[perf] getMcpToolsets');
      return toolsets;
    } catch (err) {
      console.error('[mcp] listToolsets failed, recreating client:', err);
      await disconnectMcp();
    }
  }

  const serverDefs = buildServerDefs(configs);
  if (Object.keys(serverDefs).length === 0) {
    console.timeEnd('[perf] getMcpToolsets');
    return {};
  }

  console.time('[perf] getMcpToolsets:newClient');
  _client = new MCPClient({
    id: 'coworker-mcp',
    servers: serverDefs,
    timeout: 30_000,
  });
  _configHash = hash;
  console.timeEnd('[perf] getMcpToolsets:newClient');

  try {
    const toolsets = await _client.listToolsets();
    console.timeEnd('[perf] getMcpToolsets');
    return toolsets;
  } catch (err) {
    console.error('[mcp] Failed to get toolsets from new client:', err);
    console.timeEnd('[perf] getMcpToolsets');
    return {};
  }
}
