import { registerApiRoute } from '@mastra/core/server';
import {
  getGhStatus,
  startGhAuth,
  pollGhAuth,
  ghLogout,
} from '../gh/gh-manager';

export const githubRoutes = [
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
];
