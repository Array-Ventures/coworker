import { registerApiRoute } from '@mastra/core/server';
import { messageRouter } from '../messaging/router';
import type { WhatsAppManager } from '../whatsapp/whatsapp-manager';

export function messagingRoutes(whatsAppManager: WhatsAppManager) {
  return [
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
          const groups = await whatsAppManager.listGroups();
          return c.json({ groups });
        } catch {
          return c.json({ groups: [] });
        }
      },
    }),
    registerApiRoute('/messaging/groups', {
      method: 'POST',
      handler: async (c) => {
        try {
          const body = await c.req.json() as { groupJid: string; groupName?: string; mode?: string };
          if (!body.groupJid) return c.json({ ok: false, error: 'groupJid required' }, 400);
          if (body.mode && !['all', 'mentions', 'observe'].includes(body.mode)) {
            return c.json({ ok: false, error: 'mode must be all, mentions, or observe' }, 400);
          }
          await whatsAppManager.addGroup(body.groupJid, body.groupName, body.mode);
          return c.json({ ok: true });
        } catch (err: any) {
          return c.json({ ok: false, error: err.message }, 500);
        }
      },
    }),
    registerApiRoute('/messaging/groups/:groupJid', {
      method: 'PUT',
      handler: async (c) => {
        try {
          const groupJid = c.req.param('groupJid');
          const body = await c.req.json() as { enabled?: boolean; mode?: string; groupName?: string };
          if (body.mode && !['all', 'mentions', 'observe'].includes(body.mode)) {
            return c.json({ ok: false, error: 'mode must be all, mentions, or observe' }, 400);
          }
          await whatsAppManager.updateGroup(groupJid, body);
          return c.json({ ok: true });
        } catch (err: any) {
          return c.json({ ok: false, error: err.message }, 500);
        }
      },
    }),
    registerApiRoute('/messaging/groups/:groupJid', {
      method: 'DELETE',
      handler: async (c) => {
        try {
          const groupJid = c.req.param('groupJid');
          await whatsAppManager.removeGroup(groupJid);
          return c.json({ ok: true });
        } catch (err: any) {
          return c.json({ ok: false, error: err.message }, 500);
        }
      },
    }),
  ];
}
