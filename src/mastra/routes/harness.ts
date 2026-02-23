import { registerApiRoute } from '@mastra/core/server';
import { streamSSE } from 'hono/streaming';
import { harnessPool } from '../harness/pool';

/** Helper: get threadId from query or body, return 400 if missing */
function getThreadId(c: any): string | null {
  return c.req.query('threadId') ?? null;
}

export const harnessRoutes = [
  // ─── SSE events stream (multiplexed — all threads on one connection) ──
  registerApiRoute('/harness/events', {
    method: 'GET',
    handler: async (c) => {
      return streamSSE(c, async (stream) => {
        const unsubscribe = harnessPool.subscribe(async (threadId, event) => {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify({ ...event, threadId }),
          });
        });

        // Heartbeat every 15s to keep connection alive
        const heartbeat = setInterval(async () => {
          try {
            await stream.writeSSE({ event: 'heartbeat', data: '' });
          } catch {
            clearInterval(heartbeat);
          }
        }, 15_000);

        // Cleanup on disconnect
        stream.onAbort(() => {
          clearInterval(heartbeat);
          unsubscribe();
        });

        // Keep stream open
        await new Promise(() => {});
      });
    },
  }),

  // ─── Send message (fire-and-forget — response arrives via SSE) ──────
  registerApiRoute('/harness/send', {
    method: 'POST',
    handler: async (c) => {
      const { threadId, content, images } = await c.req.json();
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      await harnessPool.getOrCreate(threadId);
      harnessPool.send(threadId, content, images);
      return c.json({ ok: true });
    },
  }),

  // ─── Abort current operation ─────────────────────────────────────────
  registerApiRoute('/harness/abort', {
    method: 'POST',
    handler: async (c) => {
      const { threadId } = await c.req.json();
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const entry = harnessPool.get(threadId);
      if (entry) entry.harness.abort();
      return c.json({ ok: true });
    },
  }),

  // ─── Steer (abort + resend) ──────────────────────────────────────────
  registerApiRoute('/harness/steer', {
    method: 'POST',
    handler: async (c) => {
      const { threadId, content } = await c.req.json();
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const { harness } = await harnessPool.getOrCreate(threadId);
      harness.steer({ content }).catch((err) => {
        console.error('[harness] steer error:', err);
      });
      return c.json({ ok: true });
    },
  }),

  // ─── Follow-up (queue if running, send if idle) ──────────────────────
  registerApiRoute('/harness/follow-up', {
    method: 'POST',
    handler: async (c) => {
      const { threadId, content } = await c.req.json();
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const { harness } = await harnessPool.getOrCreate(threadId);
      harness.followUp({ content }).catch((err) => {
        console.error('[harness] followUp error:', err);
      });
      return c.json({ ok: true });
    },
  }),

  // ─── Switch mode ─────────────────────────────────────────────────────
  registerApiRoute('/harness/switch-mode', {
    method: 'POST',
    handler: async (c) => {
      const { threadId, modeId } = await c.req.json();
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const { harness } = await harnessPool.getOrCreate(threadId);
      await harness.switchMode({ modeId });
      return c.json({ ok: true });
    },
  }),

  // ─── Switch model ────────────────────────────────────────────────────
  registerApiRoute('/harness/switch-model', {
    method: 'POST',
    handler: async (c) => {
      const { threadId, modelId, scope } = await c.req.json();
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const { harness } = await harnessPool.getOrCreate(threadId);
      await harness.switchModel({ modelId, scope });
      return c.json({ ok: true });
    },
  }),

  // ─── Tool approval response ──────────────────────────────────────────
  registerApiRoute('/harness/tool-approval', {
    method: 'POST',
    handler: async (c) => {
      const { threadId, decision } = await c.req.json();
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const entry = harnessPool.get(threadId);
      if (entry) {
        entry.harness.respondToToolApproval({ decision });
        harnessPool.clearToolApproval(threadId);
      }
      return c.json({ ok: true });
    },
  }),

  // ─── Answer question (from ask_user tool) ────────────────────────────
  registerApiRoute('/harness/answer', {
    method: 'POST',
    handler: async (c) => {
      const { threadId, questionId, answer } = await c.req.json();
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const entry = harnessPool.get(threadId);
      if (entry) {
        entry.harness.respondToQuestion({ questionId, answer });
        harnessPool.clearQuestion(threadId);
      }
      return c.json({ ok: true });
    },
  }),

  // ─── Plan approval response ──────────────────────────────────────────
  registerApiRoute('/harness/plan-approval', {
    method: 'POST',
    handler: async (c) => {
      const { threadId, planId, response } = await c.req.json();
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const entry = harnessPool.get(threadId);
      if (entry) {
        await entry.harness.respondToPlanApproval({ planId, response });
        harnessPool.clearPlanApproval(threadId);
      }
      return c.json({ ok: true });
    },
  }),

  // ─── Thread management ───────────────────────────────────────────────
  registerApiRoute('/harness/thread/create', {
    method: 'POST',
    handler: async (c) => {
      const { title, channel } = await c.req.json();
      const { threadId, entry } = await harnessPool.createThread(title, channel);
      return c.json({ threadId });
    },
  }),

  registerApiRoute('/harness/thread/switch', {
    method: 'POST',
    handler: async (c) => {
      const { threadId } = await c.req.json();
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const { harness } = await harnessPool.getOrCreate(threadId);
      return c.json({ ok: true });
    },
  }),

  registerApiRoute('/harness/thread/list', {
    method: 'GET',
    handler: async (c) => {
      const harness = await harnessPool.getAnyHarness();
      const threads = await harness.listThreads();
      return c.json({ threads });
    },
  }),

  registerApiRoute('/harness/thread/rename', {
    method: 'POST',
    handler: async (c) => {
      const { threadId, title } = await c.req.json();
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const { harness } = await harnessPool.getOrCreate(threadId);
      await harness.renameThread({ title });
      return c.json({ ok: true });
    },
  }),

  registerApiRoute('/harness/thread/messages', {
    method: 'GET',
    handler: async (c) => {
      const threadId = getThreadId(c);
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const { harness } = await harnessPool.getOrCreate(threadId);
      const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined;
      const messages = await harness.listMessages({ limit });
      return c.json({ messages });
    },
  }),

  // ─── State & session ─────────────────────────────────────────────────
  registerApiRoute('/harness/session', {
    method: 'GET',
    handler: async (c) => {
      const threadId = getThreadId(c);
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const { harness } = await harnessPool.getOrCreate(threadId);
      const session = await harness.getSession();
      return c.json(session);
    },
  }),

  registerApiRoute('/harness/state', {
    method: 'GET',
    handler: async (c) => {
      const threadId = getThreadId(c);
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const entry = harnessPool.get(threadId);
      if (!entry) return c.json({});
      return c.json(entry.harness.getState());
    },
  }),

  registerApiRoute('/harness/modes', {
    method: 'GET',
    handler: async (c) => {
      const harness = await harnessPool.getAnyHarness();
      const modes = harness.listModes();
      return c.json({
        modes: modes.map((m) => ({
          id: m.id,
          name: m.name,
          color: m.color,
          default: m.default,
        })),
      });
    },
  }),

  // ─── Status (pending state + run buffer for thread) ───────────────────
  registerApiRoute('/harness/status', {
    method: 'GET',
    handler: async (c) => {
      const threadId = getThreadId(c);
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      return c.json(harnessPool.getStatus(threadId));
    },
  }),

  // ─── Permissions ─────────────────────────────────────────────────────
  registerApiRoute('/harness/permissions', {
    method: 'GET',
    handler: async (c) => {
      const threadId = getThreadId(c);
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const { harness } = await harnessPool.getOrCreate(threadId);
      return c.json(harness.getPermissionRules());
    },
  }),

  registerApiRoute('/harness/permissions/update', {
    method: 'POST',
    handler: async (c) => {
      const { threadId, category, toolName, policy } = await c.req.json();
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const { harness } = await harnessPool.getOrCreate(threadId);
      if (category) {
        harness.setPermissionForCategory({ category, policy });
      } else if (toolName) {
        harness.setPermissionForTool({ toolName, policy });
      }
      return c.json({ ok: true });
    },
  }),

  registerApiRoute('/harness/grants', {
    method: 'POST',
    handler: async (c) => {
      const { threadId, category, toolName } = await c.req.json();
      if (!threadId) return c.json({ error: 'threadId required' }, 400);
      const { harness } = await harnessPool.getOrCreate(threadId);
      if (category) harness.grantSessionCategory({ category });
      if (toolName) harness.grantSessionTool({ toolName });
      return c.json({ ok: true });
    },
  }),
];
