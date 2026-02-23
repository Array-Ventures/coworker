import fs from 'fs';
import path from 'path';
import { WORKSPACE_PATH } from './paths';

/**
 * Copy built-in skills into the workspace and symlink their scripts.
 *
 * Looks for builtin-skills in two locations (first match wins):
 *   1. /app/builtin-skills  — Docker image (copied via Dockerfile COPY)
 *   2. src/mastra/skills    — local dev (relative to seed-skills.ts via import.meta)
 */
export async function seedBuiltinSkills() {
  const candidates = [
    '/app/builtin-skills',
    path.resolve(import.meta.dirname, '../skills'),
  ];

  const builtinDir = candidates.find((p) => {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  });

  if (!builtinDir) return;

  const skillsDir = path.join(WORKSPACE_PATH, '.agents', 'skills');
  const binDir = path.join(WORKSPACE_PATH, '.bin');
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  let seeded = 0;
  for (const name of fs.readdirSync(builtinDir)) {
    const src = path.join(builtinDir, name);
    if (!fs.statSync(src).isDirectory()) continue;

    const dest = path.join(skillsDir, name);
    // Clean copy — pick up updates on every restart
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    seeded++;
  }

  // Symlink all skill scripts into .bin for PATH access
  for (const skill of fs.readdirSync(skillsDir)) {
    const scriptsDir = path.join(skillsDir, skill, 'scripts');
    if (!fs.existsSync(scriptsDir)) continue;
    for (const script of fs.readdirSync(scriptsDir)) {
      const scriptPath = path.join(scriptsDir, script);
      if (!fs.statSync(scriptPath).isFile()) continue;
      const link = path.join(binDir, script);
      try { fs.unlinkSync(link); } catch {}
      fs.symlinkSync(scriptPath, link);
    }
  }

  if (seeded > 0) {
    console.log(`[skills] seeded ${seeded} built-in skill(s) from ${builtinDir}`);
  }
}
