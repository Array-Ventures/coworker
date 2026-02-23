twhy import { registerApiRoute } from '@mastra/core/server';
import { streamSSE } from 'hono/streaming';
import { coworkerHarness } from '../harness';

export const harnessRoutes = [
  // ─── SSE events stream ───────────────────────────────────────────────
  registerApiRoute('/harness/events', {
    method: 'GET',
    handler: async (c) => {
      return streamSSE(c, async (stream) => {
        const unsubscribe = coworkerHarness.subscribe(async (event) => {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
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

  // ─── Initialize session ──────────────────────────────────────────────
  registerApiRoute('/harness/init', {
    method: 'POST',
    handler: async (c) => {
      const thread = await coworkerHarness.selectOrCreateThread();
      const session = await coworkerHarness.getSession();
      return c.json({ thread, session });
    },
  }),

  // ─── Send message (fire-and-forget — response arrives via SSE) ──────
  registerApiRoute('/harness/send', {
    method: 'POST',
    handler: async (c) => {
      const { content, images } = await c.req.json();
      coworkerHarness.sendMessage({ content, images }).catch((err) => {
        console.error('[harness] sendMessage error:', err);
      });
      return c.json({ ok: true });
    },
  }),

  // ─── Abort current operation ─────────────────────────────────────────
  registerApiRoute('/harness/abort', {
    method: 'POST',
    handler: async (c) => {
      coworkerHarness.abort();
      return c.json({ ok: true });
    },
  }),

  // ─── Steer (abort + resend) ──────────────────────────────────────────
  registerApiRoute('/harness/steer', {
    method: 'POST',
    handler: async (c) => {
      const { content } = await c.req.json();
      coworkerHarness.steer({ content }).catch((err) => {
        console.error('[harness] steer error:', err);
      });
      return c.json({ ok: true });
    },
  }),

  // ─── Follow-up (queue if running, send if idle) ──────────────────────
  registerApiRoute('/harness/follow-up', {
    method: 'POST',
    handler: async (c) => {
      const { content } = await c.req.json();
      coworkerHarness.followUp({ content }).catch((err) => {
        console.error('[harness] followUp error:', err);
      });
      return c.json({ ok: true });
    },
  }),

  // ─── Switch mode ─────────────────────────────────────────────────────
  registerApiRoute('/harness/switch-mode', {
    method: 'POST',
    handler: async (c) => {
      const { modeId } = await c.req.json();
      await coworkerHarness.switchMode({ modeId });
      return c.json({ ok: true });
    },
  }),

  // ─── Switch model ────────────────────────────────────────────────────
  registerApiRoute('/harness/switch-model', {
    method: 'POST',
    handler: async (c) => {
      const { modelId, scope } = await c.req.json();
      await coworkerHarness.switchModel({ modelId, scope });
      return c.json({ ok: true });
    },
  }),

  // ─── Tool approval response ──────────────────────────────────────────
  registerApiRoute('/harness/tool-approval', {
    method: 'POST',
    handler: async (c) => {
      const { decision } = await c.req.json();
      coworkerHarness.respondToToolApproval({ decision });
      return c.json({ ok: true });
    },
  }),

  // ─── Answer question (from ask_user tool) ────────────────────────────
  registerApiRoute('/harness/answer', {
    method: 'POST',
    handler: async (c) => {
      const { questionId, answer } = await c.req.json();
      coworkerHarness.respondToQuestion({ questionId, answer });
      return c.json({ ok: true });
    },
  }),

  // ─── Plan approval response ──────────────────────────────────────────
  registerApiRoute('/harness/plan-approval', {
    method: 'POST',
    handler: async (c) => {
      const { planId, response } = await c.req.json();
      await coworkerHarness.respondToPlanApproval({ planId, response });
      return c.json({ ok: true });
    },
  }),

  // ─── Thread management ───────────────────────────────────────────────
  registerApiRoute('/harness/thread/create', {
    method: 'POST',
    handler: async (c) => {
      const { title } = await c.req.json();
      const thread = await coworkerHarness.createThread({ title });
      return c.json(thread);
    },
  }),

  registerApiRoute('/harness/thread/switch', {
    method: 'POST',
    handler: async (c) => {
      const { threadId } = await c.req.json();
      await coworkerHarness.switchThread({ threadId });
      return c.json({ ok: true });
    },
  }),

  registerApiRoute('/harness/thread/list', {
    method: 'GET',
    handler: async (c) => {
      const threads = await coworkerHarness.listThreads();
      return c.json({ threads });
    },
  }),

  registerApiRoute('/harness/thread/rename', {
    method: 'POST',
    handler: async (c) => {
      const { title } = await c.req.json();
      await coworkerHarness.renameThread({ title });
      return c.json({ ok: true });
    },
  }),

  registerApiRoute('/harness/thread/messages', {
    method: 'GET',
    handler: async (c) => {
      const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined;
      const messages = await coworkerHarness.listMessages({ limit });
      return c.json({ messages });
    },
  }),

  // ─── State & session ─────────────────────────────────────────────────
  registerApiRoute('/harness/session', {
    method: 'GET',
    handler: async (c) => {
      const session = await coworkerHarness.getSession();
      return c.json(session);
    },
  }),

  registerApiRoute('/harness/state', {
    method: 'GET',
    handler: async (c) => {
      return c.json(coworkerHarness.getState());
    },
  }),

  registerApiRoute('/harness/modes', {
    method: 'GET',
    handler: async (c) => {
      const modes = coworkerHarness.listModes();
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

  // ─── Permissions ─────────────────────────────────────────────────────
  registerApiRoute('/harness/permissions', {
    method: 'GET',
    handler: async (c) => {
      return c.json(coworkerHarness.getPermissionRules());
    },
  }),

  registerApiRoute('/harness/permissions/update', {
    method: 'POST',
    handler: async (c) => {
      const { category, toolName, policy } = await c.req.json();
      if (category) {
        coworkerHarness.setPermissionForCategory({ category, policy });
      } else if (toolName) {
        coworkerHarness.setPermissionForTool({ toolName, policy });
      }
      return c.json({ ok: true });
    },
  }),

  registerApiRoute('/harness/grants', {
    method: 'POST',
    handler: async (c) => {
      const { category, toolName } = await c.req.json();
      if (category) coworkerHarness.grantSessionCategory({ category });
      if (toolName) coworkerHarness.grantSessionTool({ toolName });
      return c.json({ ok: true });
    },
  }),
];
