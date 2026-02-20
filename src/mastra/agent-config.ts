import { pool } from './db';
import { MCPClient } from '@mastra/mcp';
import crypto from 'crypto';

export interface McpServerConfig {
  id: string;
  name: string;
  type: 'stdio' | 'http';
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

let _mcpClient: MCPClient | null = null;
let _mcpConfigHash = '';

export const DEFAULT_MODEL = process.env.MODEL || 'nvidia/moonshotai/kimi-k2.5';

export const DEFAULT_INSTRUCTIONS = `You are Coworker, an AI team member.

# Task Execution

When given a task:
- Break it into steps and work through them one by one
- Use tools iteratively — read, plan, execute, verify
- Don't stop after a partial result. Keep going until the task is fully complete
- If a tool call fails, try a different approach rather than giving up
- For complex tasks, outline your plan first, then execute each step

When the task is done, summarize what you did.`;

export class AgentConfigManager {
  async get(key: string): Promise<string | null> {
    const result = await pool.query(
      'SELECT value FROM agent_config WHERE key = $1',
      [key],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].value as string;
  }

  async set(key: string, value: string): Promise<void> {
    await pool.query(
      `INSERT INTO agent_config (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT(key) DO UPDATE SET value = $3, updated_at = NOW()`,
      [key, value, value],
    );
  }

  async delete(key: string): Promise<void> {
    await pool.query(
      'DELETE FROM agent_config WHERE key = $1',
      [key],
    );
  }

  async getModel(): Promise<string> {
    return (await this.get('model')) ?? DEFAULT_MODEL;
  }

  async getInstructions(): Promise<string> {
    return (await this.get('instructions')) ?? DEFAULT_INSTRUCTIONS;
  }

  async getConfig() {
    const model = await this.get('model');
    const instructions = await this.get('instructions');
    return {
      model: model ?? DEFAULT_MODEL,
      instructions: instructions ?? DEFAULT_INSTRUCTIONS,
      defaultModel: DEFAULT_MODEL,
      defaultInstructions: DEFAULT_INSTRUCTIONS,
      isCustomModel: model !== null,
      isCustomInstructions: instructions !== null,
    };
  }

  // ── MCP Server Config ──

  async getMcpServers(): Promise<McpServerConfig[]> {
    const raw = await this.get('mcp_servers');
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  async setMcpServers(servers: McpServerConfig[]): Promise<void> {
    await this.set('mcp_servers', JSON.stringify(servers));
    await this.disconnectMcp();
  }

  async disconnectMcp(): Promise<void> {
    if (_mcpClient) {
      await _mcpClient.disconnect();
      _mcpClient = null;
      _mcpConfigHash = '';
    }
  }

  private buildServerDefs(configs: McpServerConfig[]): Record<string, any> {
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

  async getMcpToolsets(): Promise<Record<string, Record<string, any>>> {
    const configs = await this.getMcpServers();
    const enabled = configs.filter((c) => c.enabled);
    if (enabled.length === 0) {
      await this.disconnectMcp();
      return {};
    }

    const hash = JSON.stringify(enabled);
    if (_mcpClient && _mcpConfigHash === hash) {
      try {
        return await _mcpClient.listToolsets();
      } catch (err) {
        console.error('[mcp] listToolsets failed, recreating client:', err);
        await this.disconnectMcp();
      }
    }

    const serverDefs = this.buildServerDefs(configs);
    if (Object.keys(serverDefs).length === 0) return {};

    _mcpClient = new MCPClient({
      id: 'coworker-mcp',
      servers: serverDefs,
      timeout: 30_000,
    });
    _mcpConfigHash = hash;

    try {
      return await _mcpClient.listToolsets();
    } catch (err) {
      console.error('[mcp] Failed to get toolsets from new client:', err);
      return {};
    }
  }
  // ── API Keys ──

  async getApiKeys(): Promise<ApiKeyEntry[]> {
    const raw = await this.get('api_keys');
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  async addApiKey(label: string): Promise<ApiKeyEntry> {
    const keys = await this.getApiKeys();
    const entry: ApiKeyEntry = {
      id: crypto.randomUUID(),
      label,
      key: 'sk-cw-' + crypto.randomBytes(24).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    keys.push(entry);
    await this.set('api_keys', JSON.stringify(keys));
    return entry;
  }

  async deleteApiKey(id: string): Promise<void> {
    const keys = await this.getApiKeys();
    const filtered = keys.filter((k) => k.id !== id);
    await this.set('api_keys', JSON.stringify(filtered));
  }

  async validateApiKey(key: string): Promise<boolean> {
    const keys = await this.getApiKeys();
    return keys.some((k) => k.key === key);
  }
}

export interface ApiKeyEntry {
  id: string;
  label: string;
  key: string;
  createdAt: string;
}

export const agentConfig = new AgentConfigManager();
