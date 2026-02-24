import { registerApiRoute } from '@mastra/core/server';
import { syncSkillsBin } from '../agents/coworker/workspace';

export const skillsRoutes = [
  registerApiRoute('/sync-skills-bin', {
    method: 'POST',
    handler: async (c) => {
      try {
        const linked = syncSkillsBin();
        return c.json({ ok: true, linked });
      } catch (err: any) {
        return c.json({ ok: false, error: err.message }, 500);
      }
    },
  }),
];
