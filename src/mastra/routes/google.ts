import { registerApiRoute } from '@mastra/core/server';
import {
  isGogInstalled,
  isGogConfigured,
  listGogAccounts,
  startGogAuth,
  completeGogAuth,
  removeGogAccount,
  testGogAccount,
} from '../gog/gog-manager';

export const googleRoutes = [
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
];
