import { registerApiRoute } from '@mastra/core/server';
import type { AgentConfigManager, McpServerConfig } from '../config/agent-config';
import {
  startMcpOAuth,
  handleMcpOAuthCallback,
  pollMcpOAuth,
  hasOAuthTokens,
  clearOAuthData,
  disconnectMcp,
} from '../mcp';

export function mcpRoutes(agentConfig: AgentConfigManager) {
  return [
    registerApiRoute('/mcp-servers', {
      method: 'GET',
      handler: async (c) => {
        const servers = await agentConfig.getMcpServers();
        const enriched = servers.map((s) => ({
          ...s,
          oauthStatus:
            s.type === 'http' && s.url
              ? hasOAuthTokens(s.id)
                ? 'authorized'
                : 'none'
              : 'none',
        }));
        return c.json({ servers: enriched });
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
        const body = (await c.req.json()) as McpServerConfig;
        try {
          const { MCPClient } = await import('@mastra/mcp');
          const serverDef: any =
            body.type === 'stdio'
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
          const msg = err.message || 'Connection failed';
          const isOAuth =
            msg.includes('Unauthorized') ||
            msg.includes('401') ||
            msg.includes('UnauthorizedError');
          return c.json({
            ok: false,
            error: isOAuth ? 'OAuth authorization required' : msg,
            oauthRequired: isOAuth,
          });
        }
      },
    }),

    // ── MCP OAuth routes ──

    registerApiRoute('/mcp-servers/oauth/start', {
      method: 'POST',
      handler: async (c) => {
        const { serverId, serverUrl } = await c.req.json();
        if (!serverId || !serverUrl) {
          return c.json({ error: 'serverId and serverUrl required' }, 400);
        }
        try {
          const { authUrl } = await startMcpOAuth(serverId, serverUrl);
          if (!authUrl) {
            return c.json({ ok: true, alreadyAuthorized: true });
          }
          return c.json({ ok: true, authUrl });
        } catch (err: any) {
          return c.json({ ok: false, error: err.message }, 500);
        }
      },
    }),

    registerApiRoute('/mcp-servers/oauth/poll', {
      method: 'POST',
      handler: async (c) => {
        const { serverId } = await c.req.json();
        if (!serverId) {
          return c.json({ error: 'serverId required' }, 400);
        }
        return c.json(pollMcpOAuth(serverId));
      },
    }),

    registerApiRoute('/mcp-oauth/callback', {
      method: 'GET',
      handler: async (c) => {
        const code = c.req.query('code');
        const state = c.req.query('state') || '';
        if (!code) {
          return c.html(
            '<html><body style="font-family:system-ui;padding:2rem"><h2>Authorization failed</h2><p>No authorization code received.</p></body></html>',
          );
        }
        const { serverId, error } = await handleMcpOAuthCallback(code, state);
        if (serverId) {
          await disconnectMcp();
          return c.html(
            '<html><body style="font-family:system-ui;padding:2rem;text-align:center"><h2>Authorization successful!</h2><p>You can close this window and return to Coworker.</p></body></html>',
          );
        }
        return c.html(
          `<html><body style="font-family:system-ui;padding:2rem"><h2>Authorization failed</h2><p>${error || 'Unknown error'}</p></body></html>`,
        );
      },
    }),

    registerApiRoute('/mcp-servers/oauth/revoke', {
      method: 'POST',
      handler: async (c) => {
        const { serverId } = await c.req.json();
        if (!serverId) {
          return c.json({ error: 'serverId required' }, 400);
        }
        clearOAuthData(serverId);
        await disconnectMcp();
        return c.json({ ok: true });
      },
    }),
  ];
}
