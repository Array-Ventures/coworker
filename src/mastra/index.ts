import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from '@mastra/observability';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';
import { chatRoute } from '@mastra/ai-sdk';
import { registerApiRoute } from '@mastra/core/server';
import { serve as inngestServe } from '@mastra/inngest';
import { coworkerAgent, coworkerMemory, INITIAL_WORKING_MEMORY } from './agents/coworker-agent';
import { inngest } from './inngest';
import { initCustomTables } from './db';
import { ScheduledTaskManager } from './scheduled-tasks';
import { agentConfig } from './agent-config';
import { WhatsAppManager } from './whatsapp/whatsapp-manager';

const taskManager = new ScheduledTaskManager();
const whatsAppManager = new WhatsAppManager();

export const mastra = new Mastra({
  agents: { coworkerAgent },
  server: {
    bodySizeLimit: 52_428_800, // 50 MB — needed for uploading large files (PPT, DOCX, etc.)
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
    ],
  },
  storage: new LibSQLStore({ id: 'mastra-storage', url: 'file:../../mastra.db' }),
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
const SEED_RESOURCE_IDS = ['local-user', 'coworker'];

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
