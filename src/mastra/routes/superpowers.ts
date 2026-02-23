import { registerApiRoute } from '@mastra/core/server';
import { LocalSandbox } from '@mastra/core/workspace';
import { WORKSPACE_PATH } from '../config/paths';
import { agentConfig } from '../config/agent-config';

/** Create a sandbox matching the agent's environment for runtime commands. */
function createSandbox() {
  const userEnv = agentConfig.getSandboxEnv();
  return new LocalSandbox({
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
    timeout: 300_000, // 5 min for installs
  });
}

export const superpowersRoutes = [
  /** Check if a runtime command exists and return its version output. */
  registerApiRoute('/superpowers/check-runtime', {
    method: 'POST',
    handler: async (c) => {
      const { check } = await c.req.json<{ check: string }>();
      if (!check) return c.json({ ok: false, error: 'Missing check command' }, 400);

      const sandbox = createSandbox();
      try {
        await sandbox.start();
        const result = await sandbox.executeCommand('bash', ['-c', check], { timeout: 15_000 });
        return c.json({
          ok: result.exitCode === 0,
          output: result.stdout.trim(),
          exitCode: result.exitCode,
        });
      } catch (err: any) {
        return c.json({ ok: false, error: err.message });
      } finally {
        await sandbox.stop().catch(() => {});
      }
    },
  }),

  /** Run a runtime install command. Returns output when complete. */
  registerApiRoute('/superpowers/install-runtime', {
    method: 'POST',
    handler: async (c) => {
      const { install } = await c.req.json<{ install: string }>();
      if (!install) return c.json({ ok: false, error: 'Missing install command' }, 400);

      const sandbox = createSandbox();
      try {
        await sandbox.start();
        const result = await sandbox.executeCommand('bash', ['-c', install], { timeout: 300_000 });
        return c.json({
          ok: result.exitCode === 0,
          output: (result.stdout + '\n' + result.stderr).trim(),
          exitCode: result.exitCode,
        });
      } catch (err: any) {
        return c.json({ ok: false, error: err.message });
      } finally {
        await sandbox.stop().catch(() => {});
      }
    },
  }),
];
