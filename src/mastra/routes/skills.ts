import { registerApiRoute } from '@mastra/core/server';
import fs from 'fs';
import nodePath from 'path';
import { WORKSPACE_PATH } from '../config/paths';
import { skillPaths } from '../agents/coworker/workspace';

export const skillsRoutes = [
  registerApiRoute('/sync-skills-bin', {
    method: 'POST',
    handler: async (c) => {
      const binDir = nodePath.join(WORKSPACE_PATH, '.bin');
      try {
        fs.mkdirSync(binDir, { recursive: true });
        // Remove old symlinks
        for (const f of fs.readdirSync(binDir)) {
          const p = nodePath.join(binDir, f);
          try { if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p); } catch {}
        }
        // Create fresh symlinks from all skill directories
        let linked = 0;
        for (const skillsDir of skillPaths) {
          if (!fs.existsSync(skillsDir)) continue;
          for (const skill of fs.readdirSync(skillsDir)) {
            const scriptsDir = nodePath.join(skillsDir, skill, 'scripts');
            if (!fs.existsSync(scriptsDir)) continue;
            for (const script of fs.readdirSync(scriptsDir)) {
              const src = nodePath.join(scriptsDir, script);
              const dest = nodePath.join(binDir, script);
              if (!fs.statSync(src).isFile()) continue;
              // Skip if already linked (first-found wins for name collisions)
              if (fs.existsSync(dest)) continue;
              fs.symlinkSync(src, dest);
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
];
