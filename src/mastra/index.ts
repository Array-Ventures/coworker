import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from '@mastra/observability';
import { Mastra } from '@mastra/core/mastra';
import { PostgresStore } from '@mastra/pg';
import { PinoLogger } from '@mastra/loggers';
import { chatRoute } from '@mastra/ai-sdk';
import { registerApiRoute } from '@mastra/core/server';
import { serve as inngestServe } from '@mastra/inngest';
import { coworkerAgent } from './agents/coworker-agent';
import { coworkerMemory, INITIAL_WORKING_MEMORY } from './memory';
import { inngest } from './inngest';
import { initCustomTables, DB_URL, pool } from './db';
import { ScheduledTaskManager } from './scheduled-tasks';
import { agentConfig, type McpServerConfig } from './agent-config';
import { WhatsAppManager } from './whatsapp/whatsapp-manager';
import { coworkerMcpServer } from './mcp/server';
import {
  isGogInstalled,
  isGogConfigured,
  listGogAccounts,
  startGogAuth,
  completeGogAuth,
  removeGogAccount,
  testGogAccount,
} from './gog/gog-manager';
import {
  getGhStatus,
  startGhAuth,
  pollGhAuth,
  ghLogout,
} from './gh/gh-manager';
import { compress } from 'hono/compress';
import { logger } from 'hono/logger';
import { timing } from 'hono/timing';
import { bearerAuth } from 'hono/bearer-auth';
import { createMiddleware } from 'hono/factory';
import { messageRouter } from './messaging/router';
import fs from 'fs';
import nodePath from 'path';

const taskManager = new ScheduledTaskManager();
const whatsAppManager = new WhatsAppManager();

// ── Auth middleware — protects ALL routes when COWORKER_API_TOKEN is set ──
// Using Hono bearerAuth instead of Mastra's SimpleAuth because Mastra's
// checkRouteAuth passes null as the request to authenticateToken() on
// built-in routes (/api/memory/*, /api/agents/*), crashing SimpleAuth.
const COWORKER_API_TOKEN = process.env.COWORKER_API_TOKEN;

const authMiddleware = COWORKER_API_TOKEN
  ? createMiddleware(async (c, next) => {
      // Skip auth for inngest (has its own signing key auth) and health check
      const path = c.req.path;
      if (path === '/api/inngest' || path === '/health' || path === '/inngest') return next();

      // Also check X-Playground-Access header (used by Mastra playground)
      const playgroundToken = c.req.header('X-Playground-Access');
      if (playgroundToken === COWORKER_API_TOKEN) return next();

      // Delegate to Hono's built-in bearerAuth for Authorization header
      return bearerAuth({ token: COWORKER_API_TOKEN })(c, next);
    })
  : createMiddleware(async (_c, next) => next()); // No token = no auth (local dev)

export const mastra = new Mastra({
  agents: { coworkerAgent },
  mcpServers: { coworkerMcpServer },
  server: {
    host: process.env.MASTRA_HOST || undefined,
    bodySizeLimit: 52_428_800, // 50 MB — needed for uploading large files (PPT, DOCX, etc.)
    middleware: [
      // Auth — must run before everything else
      authMiddleware,
      // Request logging — logs method, path, status, elapsed time to stdout (Railway logs)
      logger(),
      // Server-Timing header — visible in browser DevTools → Network → Timing
      timing(),
      // Gzip compression — skips text/event-stream (SSE) automatically since Hono v4.7+
      compress(),
    ],
    apiRoutes: [
      chatRoute({ path: '/chat/:agentId', sendReasoning: true, sendSources: true }),
      {
        path: '/api/inngest',
        method: 'ALL',
        handler: async (c: any) => {
          const m = c.get('mastra');
          return inngestServe({ mastra: m, inngest })(c);
        },
      },
      registerApiRoute('/agent-config', {
        method: 'GET',
        handler: async (c) => {
          const config = await agentConfig.getConfig();
          return c.json(config);
        },
      }),
      registerApiRoute('/agent-config', {
        method: 'PUT',
        handler: async (c) => {
          const body = await c.req.json();
          if (body.model !== undefined) {
            if (body.model === null || body.model === '') {
              await agentConfig.delete('model');
            } else {
              await agentConfig.set('model', body.model);
            }
          }
          if (body.instructions !== undefined) {
            if (body.instructions === null || body.instructions === '') {
              await agentConfig.delete('instructions');
            } else {
              await agentConfig.set('instructions', body.instructions);
            }
          }
          const config = await agentConfig.getConfig();
          return c.json(config);
        },
      }),
      registerApiRoute('/scheduled-tasks', {
        method: 'GET',
        handler: async (c) => {
          const tasks = await taskManager.list();
          return c.json({ items: tasks });
        },
      }),
      registerApiRoute('/scheduled-tasks', {
        method: 'POST',
        handler: async (c) => {
          const body = await c.req.json();
          if (!body.name || !body.scheduleConfig || !body.prompt) {
            return c.json({ error: 'name, scheduleConfig, and prompt are required' }, 400);
          }
          const task = await taskManager.create(body);
          return c.json(task);
        },
      }),
      registerApiRoute('/scheduled-tasks/:id', {
        method: 'PUT',
        handler: async (c) => {
          const id = c.req.param('id');
          const body = await c.req.json();
          const task = await taskManager.update(id, body);
          return c.json(task);
        },
      }),
      registerApiRoute('/scheduled-tasks/:id', {
        method: 'DELETE',
        handler: async (c) => {
          const id = c.req.param('id');
          await taskManager.delete(id);
          return c.json({ ok: true });
        },
      }),
      registerApiRoute('/scheduled-tasks/:id/toggle', {
        method: 'POST',
        handler: async (c) => {
          const id = c.req.param('id');
          const { enabled } = await c.req.json();
          await taskManager.toggle(id, enabled);
          return c.json({ ok: true });
        },
      }),
      // ── WhatsApp routes ──
      registerApiRoute('/whatsapp/status', {
        method: 'GET',
        handler: async (c) => c.json(whatsAppManager.getState()),
      }),
      registerApiRoute('/whatsapp/connect', {
        method: 'POST',
        handler: async (c) => {
          await whatsAppManager.connect();
          return c.json(whatsAppManager.getState());
        },
      }),
      registerApiRoute('/whatsapp/disconnect', {
        method: 'POST',
        handler: async (c) => {
          await whatsAppManager.disconnect();
          return c.json(whatsAppManager.getState());
        },
      }),
      registerApiRoute('/whatsapp/logout', {
        method: 'POST',
        handler: async (c) => {
          await whatsAppManager.logout();
          return c.json({ ok: true });
        },
      }),
      registerApiRoute('/whatsapp/pair', {
        method: 'POST',
        handler: async (c) => {
          const { code } = await c.req.json();
          if (!code) return c.json({ ok: false, error: 'code is required' }, 400);
          const result = await whatsAppManager.approvePairing(code);
          if (!result.ok) return c.json(result, 400);
          const items = await whatsAppManager.listAllowlist();
          return c.json({ ok: true, items });
        },
      }),
      registerApiRoute('/whatsapp/allowlist', {
        method: 'GET',
        handler: async (c) => {
          const items = await whatsAppManager.listAllowlist();
          return c.json({ items });
        },
      }),
      registerApiRoute('/whatsapp/allowlist', {
        method: 'POST',
        handler: async (c) => {
          const { phoneNumber, label } = await c.req.json();
          if (!phoneNumber) return c.json({ error: 'phoneNumber is required' }, 400);
          await whatsAppManager.addToAllowlist(phoneNumber, label);
          const items = await whatsAppManager.listAllowlist();
          return c.json({ items });
        },
      }),
      registerApiRoute('/whatsapp/allowlist/:phoneNumber', {
        method: 'DELETE',
        handler: async (c) => {
          const phoneNumber = decodeURIComponent(c.req.param('phoneNumber'));
          await whatsAppManager.removeFromAllowlist(phoneNumber);
          return c.json({ ok: true });
        },
      }),
      // ── Google (gog CLI) routes ──
      registerApiRoute('/gog/status', {
        method: 'GET',
        handler: async (c) => {
          const installed = await isGogInstalled();
          const configured = installed ? isGogConfigured() : false;
          const accounts = installed && configured ? await listGogAccounts() : [];
          return c.json({ installed, configured, accounts });
        },
      }),
      registerApiRoute('/gog/auth/start', {
        method: 'POST',
        handler: async (c) => {
          const { email, services } = await c.req.json();
          if (!email) return c.json({ error: 'email is required' }, 400);
          try {
            const result = await startGogAuth(email, services);
            return c.json(result);
          } catch (err: any) {
            return c.json({ error: err.message }, 500);
          }
        },
      }),
      registerApiRoute('/gog/auth/complete', {
        method: 'POST',
        handler: async (c) => {
          const { email, redirectUrl, services } = await c.req.json();
          if (!email || !redirectUrl) {
            return c.json({ error: 'email and redirectUrl are required' }, 400);
          }
          const result = await completeGogAuth(email, redirectUrl, services);
          return c.json(result);
        },
      }),
      registerApiRoute('/gog/auth/test', {
        method: 'POST',
        handler: async (c) => {
          const { email } = await c.req.json();
          if (!email) return c.json({ error: 'email is required' }, 400);
          const result = await testGogAccount(email);
          return c.json(result);
        },
      }),
      registerApiRoute('/gog/auth/remove', {
        method: 'POST',
        handler: async (c) => {
          const { email } = await c.req.json();
          if (!email) return c.json({ error: 'email is required' }, 400);
          const result = await removeGogAccount(email);
          return c.json(result);
        },
      }),
      // ── GitHub (gh CLI) routes ──
      registerApiRoute('/gh/status', {
        method: 'GET',
        handler: async (c) => {
          const status = await getGhStatus();
          return c.json(status);
        },
      }),
      registerApiRoute('/gh/auth/start', {
        method: 'POST',
        handler: async (c) => {
          try {
            const result = await startGhAuth();
            return c.json(result);
          } catch (err: any) {
            return c.json({ error: err.message }, 500);
          }
        },
      }),
      registerApiRoute('/gh/auth/poll', {
        method: 'POST',
        handler: async (c) => {
          const result = await pollGhAuth();
          return c.json(result);
        },
      }),
      registerApiRoute('/gh/auth/logout', {
        method: 'POST',
        handler: async (c) => {
          const result = await ghLogout();
          return c.json(result);
        },
      }),
      // ── MCP Server Config routes ──
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
      // ── MCP Registry proxy routes ──
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
      // ── A2A Info route ──
      // ── Messaging routes ──
      registerApiRoute('/messaging/send', {
        method: 'POST',
        handler: async (c) => {
          const { channel, to, text, replyTo, media } = await c.req.json();
          if (!channel || !to || (!text && !media?.length)) {
            return c.json({ ok: false, error: 'channel, to, and text (or media) are required' }, 400);
          }
          const opts: any = {};
          if (replyTo) opts.replyTo = replyTo;
          if (media?.length) {
            opts.media = media.map((m: any) => ({
              ...m,
              data: m.data ? Buffer.from(m.data, 'base64') : undefined,
            }));
          }
          const result = await messageRouter.send(channel, to, text || '', Object.keys(opts).length ? opts : undefined);
          return c.json(result, result.ok ? 200 : 502);
        },
      }),
      registerApiRoute('/messaging/channels', {
        method: 'GET',
        handler: async (c) => {
          const channels = messageRouter.listChannels();
          return c.json({ channels });
        },
      }),
      registerApiRoute('/messaging/groups', {
        method: 'GET',
        handler: async (c) => {
          try {
            const { rows } = await pool.query(
              'SELECT group_jid, group_name, enabled FROM whatsapp_groups ORDER BY group_name'
            );
            return c.json({ groups: rows });
          } catch {
            return c.json({ groups: [] });
          }
        },
      }),
      // ── Skills bin sync ──
      registerApiRoute('/sync-skills-bin', {
        method: 'POST',
        handler: async (c) => {
          const base = process.env.WORKSPACE_PATH || nodePath.resolve('./workspaces');
          const skillsDir = nodePath.join(base, 'skills');
          const binDir = nodePath.join(base, '.bin');
          try {
            fs.mkdirSync(binDir, { recursive: true });
            // Remove old symlinks
            for (const f of fs.readdirSync(binDir)) {
              const p = nodePath.join(binDir, f);
              try { if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p); } catch {}
            }
            // Create fresh symlinks
            let linked = 0;
            if (fs.existsSync(skillsDir)) {
              for (const skill of fs.readdirSync(skillsDir)) {
                const scriptsDir = nodePath.join(skillsDir, skill, 'scripts');
                if (!fs.existsSync(scriptsDir)) continue;
                for (const script of fs.readdirSync(scriptsDir)) {
                  const src = nodePath.join(scriptsDir, script);
                  if (!fs.statSync(src).isFile()) continue;
                  fs.symlinkSync(src, nodePath.join(binDir, script));
                  linked++;
                }
              }
            }
            return c.json({ ok: true, linked });
          } catch (err: any) {
            return c.json({ ok: false, error: err.message }, 500);
          }
        },
      }),
      registerApiRoute('/a2a-info', {
        method: 'GET',
        handler: async (c) => {
          const agentId = coworkerAgent.id;
          return c.json({
            agentId,
            endpoints: {
              a2a: `/api/a2a/${agentId}`,
              agentCard: `/api/.well-known/${agentId}/agent-card.json`,
            },
          });
        },
      }),
    ],
  },
  storage: new PostgresStore({ id: 'mastra-storage', connectionString: DB_URL }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new DefaultExporter(), // Persists traces to storage for Mastra Studio
          new CloudExporter(), // Sends traces to Mastra Cloud (if MASTRA_CLOUD_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});

// Seed working memory for every resourceId that might be used to chat.
// - 'local-user'  → Electron app
// - 'coworker'    → Mastra Studio playground (uses agent ID)
const SEED_RESOURCE_IDS = ['coworker'];

async function seedWorkingMemory() {
  const data = JSON.stringify(INITIAL_WORKING_MEMORY);
  for (const resourceId of SEED_RESOURCE_IDS) {
    const existing = await coworkerMemory.getWorkingMemory({
      threadId: '__seed__',
      resourceId,
    });
    if (!existing) {
      await coworkerMemory.updateWorkingMemory({
        threadId: '__seed__',
        resourceId,
        workingMemory: data,
      });
      console.log(`[working-memory] seeded initial persona + org blocks for ${resourceId}`);
    }
  }
}

// Initialize custom tables, scheduled tasks, WhatsApp, and working memory
taskManager.setMastra(mastra);
whatsAppManager.setMastra(mastra);
initCustomTables()
  .then(() => taskManager.init())
  .then(() => whatsAppManager.init())
  .then(() => seedWorkingMemory())
  .then(() => console.log('[init] complete'))
  .catch((err) => console.error('[init] failed:', err));
