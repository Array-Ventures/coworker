import { registerApiRoute } from '@mastra/core/server';
import type { AgentConfigManager, McpServerConfig } from '../config/agent-config';

export function mcpRoutes(agentConfig: AgentConfigManager) {
  return [
    registerApiRoute('/mcp-servers', {
      method: 'GET',
      handler: async (c) => {
        const servers = await agentConfig.getMcpServers();
        return c.json({ servers });
      },
    }),
    registerApiRoute('/mcp-servers', {
      method: 'PUT',
      handler: async (c) => {
        const body = await c.req.json();
        if (!Array.isArray(body.servers)) {
          return c.json({ error: 'servers must be an array' }, 400);
        }
        await agentConfig.setMcpServers(body.servers);
        const servers = await agentConfig.getMcpServers();
        return c.json({ servers });
      },
    }),
    registerApiRoute('/mcp-registry/servers', {
      method: 'GET',
      handler: async (c) => {
        const url = new URL('https://registry.modelcontextprotocol.io/v0/servers');
        const limit = c.req.query('limit') || '20';
        const cursor = c.req.query('cursor');
        const search = c.req.query('search');
        url.searchParams.set('limit', limit);
        url.searchParams.set('version', 'latest');
        if (cursor) url.searchParams.set('cursor', cursor);
        if (search) url.searchParams.set('search', search);
        try {
          const res = await fetch(url.toString());
          const data = await res.json();
          return c.json(data);
        } catch (err: any) {
          return c.json({ error: err.message || 'Registry fetch failed', servers: [], metadata: {} }, 502);
        }
      },
    }),
    registerApiRoute('/mcp-servers/test', {
      method: 'POST',
      handler: async (c) => {
        const body = await c.req.json() as McpServerConfig;
        try {
          const { MCPClient } = await import('@mastra/mcp');
          const serverDef: any = body.type === 'stdio'
            ? { command: body.command, args: body.args || [], env: body.env || {} }
            : {
                url: new URL(body.url!),
                ...(body.headers && Object.keys(body.headers).length > 0
                  ? { requestInit: { headers: body.headers } }
                  : {}),
              };

          const testClient = new MCPClient({
            id: `test-${Date.now()}`,
            servers: { test: serverDef },
            timeout: 15_000,
          });

          try {
            const tools = await testClient.listTools();
            const toolNames = Object.keys(tools);
            return c.json({ ok: true, tools: toolNames });
          } finally {
            await testClient.disconnect();
          }
        } catch (err: any) {
          return c.json({ ok: false, error: err.message || 'Connection failed' });
        }
      },
    }),
  ];
}
