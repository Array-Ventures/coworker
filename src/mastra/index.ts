import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from '@mastra/observability';
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { compress } from 'hono/compress';
import { logger } from 'hono/logger';
import { timing } from 'hono/timing';
import { coworkerAgent } from './agents/coworker/agent';
import { coworkerMemory, INITIAL_WORKING_MEMORY } from './memory';
import { storage } from './db';
import { seedBuiltinSkills } from './config/seed-skills';
import { ScheduledTaskManager } from './scheduled-tasks';
import { agentConfig } from './config/agent-config';
import { WhatsAppManager } from './whatsapp/whatsapp-manager';
import { coworkerMcpServer } from './mcp/server';
import { harnessPool } from './harness/pool';
import { createAuthMiddleware } from './middleware/auth';
import { createRoutes } from './routes';

const taskManager = new ScheduledTaskManager();
const whatsAppManager = new WhatsAppManager();

export const mastra = new Mastra({
  agents: { coworkerAgent },
  memory: coworkerMemory,
  mcpServers: { coworkerMcpServer },
  server: {
    bodySizeLimit: 52_428_800, // 50 MB — needed for uploading large files (PPT, DOCX, etc.)
    middleware: [
      createAuthMiddleware(),
      logger(),
      timing(),
      compress(),
    ],
    apiRoutes: createRoutes({ taskManager, whatsAppManager, agentConfig }),
  },
  storage,
  logger: new PinoLogger({
    name: 'Mastra',
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new DefaultExporter(),
          new CloudExporter(),
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(),
        ],
      },
    },
  }),
});

// Seed working memory for every resourceId that might be used to chat.
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
seedBuiltinSkills()
  .then(() => harnessPool.startSweeper())
  .then(() => taskManager.init())
  .then(() => whatsAppManager.init())
  .then(() => seedWorkingMemory())
  .then(() => console.log('[init] complete'))
  .catch((err) => console.error('[init] failed:', err));
