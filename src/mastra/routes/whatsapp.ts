import { registerApiRoute } from '@mastra/core/server';
import type { WhatsAppManager } from '../whatsapp/whatsapp-manager';

export function whatsappRoutes(whatsAppManager: WhatsAppManager) {
  return [
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
  ];
}
