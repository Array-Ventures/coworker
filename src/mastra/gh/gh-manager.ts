import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DATA_PATH } from '../config/paths';

const execFileAsync = promisify(execFile);

/**
 * Controlled environment for all gh child processes.
 * HOME is shared with gog so both CLIs persist config under the same data dir.
 */
const GH_HOME = join(DATA_PATH, 'gog');
const GH_ENV: Record<string, string> = {
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
  HOME: GH_HOME,
};

export interface GhStatus {
  installed: boolean;
  loggedIn: boolean;
  username: string | null;
}

/**
 * Holds the running `gh auth login` process during device-flow auth.
 * The process is spawned by startGhAuth and polled/cleaned up by pollGhAuth.
 */
let pendingAuthProcess: ChildProcess | null = null;
let pendingAuthTimeout: ReturnType<typeof setTimeout> | null = null;

function cleanupPendingAuth() {
  if (pendingAuthTimeout) {
    clearTimeout(pendingAuthTimeout);
    pendingAuthTimeout = null;
  }
  if (pendingAuthProcess) {
    pendingAuthProcess.kill();
    pendingAuthProcess = null;
  }
}

/** Check if `gh` CLI is installed and accessible. */
export async function isGhInstalled(): Promise<boolean> {
  try {
    await execFileAsync('gh', ['--version'], { env: GH_ENV });
    return true;
  } catch {
    return false;
  }
}

/** Get current GitHub auth status. */
export async function getGhStatus(): Promise<GhStatus> {
  const installed = await isGhInstalled();
  if (!installed) return { installed: false, loggedIn: false, username: null };

  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'status'], {
      env: GH_ENV,
      timeout: 10_000,
    });
    // gh auth status outputs: "Logged in to github.com account <username> ..."
    const usernameMatch = stdout.match(/account\s+(\S+)/);
    return {
      installed: true,
      loggedIn: true,
      username: usernameMatch?.[1] || null,
    };
  } catch (err: any) {
    // gh auth status exits non-zero when not logged in
    // but also prints to stderr
    const combined = (err.stdout || '') + (err.stderr || '');
    if (combined.includes('account')) {
      const usernameMatch = combined.match(/account\s+(\S+)/);
      return {
        installed: true,
        loggedIn: true,
        username: usernameMatch?.[1] || null,
      };
    }
    return { installed: true, loggedIn: false, username: null };
  }
}

/**
 * Start the GitHub device-flow auth.
 * Spawns `gh auth login --web` which outputs a one-time code and URL.
 * The process stays alive until the user completes auth in the browser.
 */
export function startGhAuth(): Promise<{ userCode: string; authUrl: string }> {
  cleanupPendingAuth();

  return new Promise((resolve, reject) => {
    const child = spawn('gh', ['auth', 'login', '--web', '--git-protocol', 'https'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: GH_ENV,
    });

    pendingAuthProcess = child;

    let output = '';
    let resolved = false;

    const checkForCode = (chunk: Buffer) => {
      if (resolved) return;
      output += chunk.toString();

      // gh outputs: "First copy your one-time code: XXXX-XXXX"
      // and then "Open ... https://github.com/login/device"
      const codeMatch = output.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/);
      const urlMatch = output.match(/(https:\/\/github\.com\/login\/device)/);

      if (codeMatch) {
        resolved = true;
        resolve({
          userCode: codeMatch[1],
          authUrl: urlMatch?.[1] || 'https://github.com/login/device',
        });
      }
    };

    child.stdout.on('data', checkForCode);
    child.stderr.on('data', checkForCode);

    // Also try pressing Enter after we get the code, since gh waits for Enter
    // to open browser (which we don't want in headless mode)
    const enterInterval = setInterval(() => {
      if (resolved && pendingAuthProcess === child) {
        child.stdin?.write('\n');
        clearInterval(enterInterval);
      }
    }, 500);

    child.on('close', (code) => {
      clearInterval(enterInterval);
      pendingAuthProcess = null;
      if (resolved) return;
      reject(new Error(`gh auth login exited (code ${code}): ${output}`));
    });

    // Auto-cleanup after 10 minutes (device codes expire)
    pendingAuthTimeout = setTimeout(() => {
      pendingAuthTimeout = null;
      clearInterval(enterInterval);
      if (pendingAuthProcess === child) {
        child.kill();
        pendingAuthProcess = null;
      }
    }, 10 * 60_000);

    // Startup timeout — if no code appears in 15 seconds, something is wrong
    setTimeout(() => {
      if (!resolved) {
        clearInterval(enterInterval);
        cleanupPendingAuth();
        reject(new Error(`Timed out waiting for device code. Output: ${output}`));
      }
    }, 15_000);
  });
}

/**
 * Poll whether the user has completed GitHub auth in the browser.
 * Returns { ok: true, username } when auth is complete.
 */
export async function pollGhAuth(): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const status = await getGhStatus();
    if (status.loggedIn) {
      // Auth completed — cleanup the pending process
      cleanupPendingAuth();
      return { ok: true, username: status.username || undefined };
    }
    return { ok: false };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/** Logout from GitHub. */
export async function ghLogout(): Promise<{ ok: boolean; error?: string }> {
  try {
    await execFileAsync('gh', ['auth', 'logout', '--hostname', 'github.com'], {
      env: GH_ENV,
      timeout: 10_000,
    });
    return { ok: true };
  } catch (err: any) {
    // gh may prompt for confirmation — use yes pipe
    try {
      const child = spawn('gh', ['auth', 'logout', '--hostname', 'github.com'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: GH_ENV,
      });
      child.stdin?.write('Y\n');
      child.stdin?.end();
      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`gh auth logout exited with code ${code}`));
        });
      });
      return { ok: true };
    } catch (retryErr: any) {
      return { ok: false, error: retryErr.stderr || retryErr.message };
    }
  }
}

/** Test that GitHub auth is valid by querying the API. */
export async function testGhAuth(): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const { stdout } = await execFileAsync('gh', ['api', 'user', '--jq', '.login'], {
      timeout: 15_000,
      env: GH_ENV,
    });
    return { ok: true, username: stdout.trim() };
  } catch (err: any) {
    return { ok: false, error: err.stderr || err.message || 'Auth test failed' };
  }
}
