import {
  Workspace,
  LocalFilesystem,
  LocalSandbox,
} from "@mastra/core/workspace";
import type { RequestContext } from "@mastra/core/request-context";
import path from "path";
import fs from "fs";
import os from "os";
import { WORKSPACE_PATH } from '../../config/paths';
import { agentConfig } from '../../config/agent-config';

// Auto-create essential directories (Docker entrypoint does this too, but needed for local dev)
fs.mkdirSync(path.join(WORKSPACE_PATH, '.agents', 'skills'), { recursive: true });
fs.mkdirSync(path.join(WORKSPACE_PATH, '.bin'), { recursive: true });

/**
 * Collect skill directories from multiple locations.
 * Deduplicates via realpathSync to handle symlinks from `npx skills add`.
 */
function collectSkillPaths(): string[] {
  const candidates = [
    path.join(WORKSPACE_PATH, '.agents', 'skills'),    // Mastra marketplace installs here
    path.join(WORKSPACE_PATH, '.coworker', 'skills'),  // project-local
    path.join(WORKSPACE_PATH, '.claude', 'skills'),    // Claude Code compatible
    path.join(os.homedir(), '.coworker', 'skills'),    // user-global
    path.join(os.homedir(), '.claude', 'skills'),      // user-global
  ];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const p of candidates) {
    try {
      const real = fs.realpathSync(p);
      if (!seen.has(real) && fs.statSync(real).isDirectory()) {
        seen.add(real);
        paths.push(real);
      }
    } catch { /* doesn't exist yet — skip */ }
  }
  return paths;
}

/** Pre-computed at startup; exported for sync-skills-bin route */
export const skillPaths = collectSkillPaths();

export function getDynamicWorkspace({ requestContext }: { requestContext: RequestContext }) {
  const detection = LocalSandbox.detectIsolation();
  const userEnv = agentConfig.getSandboxEnv();

  return new Workspace({
    id: 'coworker-workspace',
    name: 'Coworker Workspace',
    filesystem: new LocalFilesystem({
      basePath: WORKSPACE_PATH,
      allowedPaths: skillPaths,
    }),
    sandbox: new LocalSandbox({
      workingDirectory: WORKSPACE_PATH,
      env: {
        PATH: `${WORKSPACE_PATH}/.bin:${process.env.PATH}`,
        HOME: WORKSPACE_PATH,
        PORT: process.env.PORT || '4111',
        ...(process.env.PLAYWRIGHT_BROWSERS_PATH && {
          PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
        }),
        ...userEnv,
      },
      isolation: detection.available ? detection.backend : "none",
      nativeSandbox: {
        allowNetwork: true,
        allowSystemBinaries: true,
        readWritePaths: [WORKSPACE_PATH, ...skillPaths],
      },
    }),
    ...(skillPaths.length > 0 ? { skills: skillPaths } : {}),
    bm25: true,
  });
}
