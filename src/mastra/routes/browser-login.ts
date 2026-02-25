import { registerApiRoute } from '@mastra/core/server';
import fs from 'fs';
import path from 'path';
import { agentConfig } from '../config/agent-config';
import { WORKSPACE_PATH } from '../config/paths';

/**
 * Browser Login — programmatic screencasting for interactive login sessions.
 *
 * Uses BrowserManager API directly (no CLI daemon). Session state is saved to
 * the same location the agent's sandbox uses: $WORKSPACE/.agent-browser/sessions/
 *
 * Flow:
 *   1. POST /browser-login/start   → launch browser + start screencast
 *   2. GET  /browser-login/frames  → SSE stream of JPEG frames
 *   3. POST /browser-login/input   → inject mouse/keyboard events
 *   4. POST /browser-login/navigate → change URL
 *   5. POST /browser-login/save-close → save session state + close
 */

// Singleton login session — only one active at a time
// BrowserManager is dynamically imported so PLAYWRIGHT_BROWSERS_PATH can be
// set in process.env *before* playwright-core caches its registry directory.
let manager: any = null;
let frameCallback: ((frame: any) => void) | null = null;
let frameListeners = new Set<(frame: any) => void>();

/**
 * Build the session state file path using WORKSPACE_PATH directly.
 * The agent's sandbox runs with HOME=$WORKSPACE, so agent-browser CLI
 * saves sessions to $WORKSPACE/.agent-browser/sessions/{name}-{id}.json.
 * We match that path exactly so both server and agent share the same state.
 */
function getSessionStatePath(): string | null {
  const env = agentConfig.getSandboxEnv();
  const sessionName = env.AGENT_BROWSER_SESSION_NAME || process.env.AGENT_BROWSER_SESSION_NAME;
  if (!sessionName || !/^[a-zA-Z0-9_-]+$/.test(sessionName)) return null;
  const sessionsDir = path.join(WORKSPACE_PATH, '.agent-browser', 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
  return path.join(sessionsDir, `${sessionName}-default.json`);
}

function loadExistingState(): object | null {
  const statePath = getSessionStatePath();
  if (!statePath || !fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveState(statePath: string, state: object): void {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  fs.chmodSync(statePath, 0o600);
}

export const browserLoginRoutes = [
  /** Start a browser login session — launch browser + start screencast */
  registerApiRoute('/browser-login/start', {
    method: 'POST',
    handler: async (c) => {
      if (manager) {
        return c.json({ ok: false, error: 'Login session already active. Close it first.' }, 409);
      }

      const { url } = await c.req.json<{ url: string }>();
      if (!url) return c.json({ ok: false, error: 'Missing url' }, 400);

      try {
        // Playwright reads PLAYWRIGHT_BROWSERS_PATH at *import time* (module-level
        // IIFE in registry/index.js). We must set the env var BEFORE the first
        // dynamic import so playwright-core caches the correct path.
        const env = agentConfig.getSandboxEnv();
        if (env.PLAYWRIGHT_BROWSERS_PATH) {
          process.env.PLAYWRIGHT_BROWSERS_PATH = env.PLAYWRIGHT_BROWSERS_PATH;
        }

        const { BrowserManager } = await import('agent-browser/dist/browser.js');
        manager = new BrowserManager();

        // Load existing session state if available
        const existingState = loadExistingState();

        await manager.launch({
          id: 'login-launch',
          action: 'launch',
          headless: true,
          viewport: { width: 1280, height: 720 },
          ...(existingState ? { storageState: existingState } : {}),
        });

        // Navigate to the requested URL
        const page = manager.getPage();
        await page.goto(url, { waitUntil: 'load', timeout: 30_000 });

        // Start screencasting — push frames to all SSE listeners
        frameCallback = (frame: any) => {
          for (const listener of frameListeners) {
            try { listener(frame); } catch { /* listener disconnected */ }
          }
        };

        await manager.startScreencast(frameCallback, {
          format: 'jpeg',
          quality: 70,
          maxWidth: 1280,
          maxHeight: 720,
          everyNthFrame: 2, // every other frame to reduce load
        });

        return c.json({ ok: true, url: page.url(), title: await page.title() });
      } catch (err: any) {
        // Cleanup on failure
        if (manager) {
          try { await manager.close(); } catch {}
          manager = null;
        }
        frameCallback = null;
        return c.json({ ok: false, error: err.message }, 500);
      }
    },
  }),

  /** SSE stream of screencast frames */
  registerApiRoute('/browser-login/frames', {
    method: 'GET',
    handler: async (c) => {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const send = (event: string, data: string) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
          };

          // Initial ping
          send('connected', '');

          const listener = (frame: any) => {
            try {
              send('frame', JSON.stringify({
                data: frame.data,
                metadata: frame.metadata,
              }));
            } catch {
              frameListeners.delete(listener);
            }
          };

          frameListeners.add(listener);

          // Heartbeat
          const heartbeat = setInterval(() => {
            try { send('heartbeat', ''); } catch { clearInterval(heartbeat); }
          }, 10_000);

          // Cleanup on disconnect
          c.req.raw.signal.addEventListener('abort', () => {
            clearInterval(heartbeat);
            frameListeners.delete(listener);
            try { controller.close(); } catch {}
          });
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    },
  }),

  /** Inject mouse/keyboard input events */
  registerApiRoute('/browser-login/input', {
    method: 'POST',
    handler: async (c) => {
      if (!manager) return c.json({ ok: false, error: 'No active login session' }, 404);

      const event = await c.req.json();

      try {
        if (event.type === 'mouse') {
          await manager.injectMouseEvent(event.params);
        } else if (event.type === 'keyboard') {
          await manager.injectKeyboardEvent(event.params);
        } else if (event.type === 'touch') {
          await manager.injectTouchEvent(event.params);
        } else {
          return c.json({ ok: false, error: `Unknown event type: ${event.type}` }, 400);
        }
        return c.json({ ok: true });
      } catch (err: any) {
        return c.json({ ok: false, error: err.message }, 500);
      }
    },
  }),

  /** Navigate to a new URL */
  registerApiRoute('/browser-login/navigate', {
    method: 'POST',
    handler: async (c) => {
      if (!manager) return c.json({ ok: false, error: 'No active login session' }, 404);

      const { url } = await c.req.json<{ url: string }>();
      if (!url) return c.json({ ok: false, error: 'Missing url' }, 400);

      try {
        const page = manager.getPage();
        await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
        return c.json({ ok: true, url: page.url(), title: await page.title() });
      } catch (err: any) {
        return c.json({ ok: false, error: err.message }, 500);
      }
    },
  }),

  /** Save session state and close the browser */
  registerApiRoute('/browser-login/save-close', {
    method: 'POST',
    handler: async (c) => {
      if (!manager) return c.json({ ok: false, error: 'No active login session' }, 404);

      try {
        // Save session state
        const statePath = getSessionStatePath();
        let saved = false;

        if (statePath) {
          const context = manager.getContext();
          if (context) {
            const state = await context.storageState();
            saveState(statePath, state);
            saved = true;
            console.log(`[browser-login] Session saved: ${statePath}`);
          }
        }

        // Stop screencast and close
        await manager.stopScreencast();
        await manager.close();
        manager = null;
        frameCallback = null;
        frameListeners.clear();

        return c.json({ ok: true, saved, statePath });
      } catch (err: any) {
        // Force cleanup
        if (manager) {
          try { await manager.close(); } catch {}
          manager = null;
        }
        frameCallback = null;
        frameListeners.clear();
        return c.json({ ok: false, error: err.message }, 500);
      }
    },
  }),

  /** Check if a login session is active */
  registerApiRoute('/browser-login/status', {
    method: 'GET',
    handler: async (c) => {
      return c.json({
        active: !!manager,
        screencasting: manager?.isScreencasting() ?? false,
      });
    },
  }),
];
