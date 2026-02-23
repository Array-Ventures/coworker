import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DATA_PATH } from '../config/paths';

const execFileAsync = promisify(execFile);

/**
 * Controlled environment for all gog child processes.
 * - HOME: gog uses os.UserConfigDir() which needs $HOME
 * - GOG_KEYRING_BACKEND=file: works everywhere (macOS, Linux, Docker)
 * - GOG_KEYRING_PASSWORD: encrypts tokens at rest (empty = unencrypted for local dev)
 */
const GOG_HOME = join(DATA_PATH, 'gog');
const GOG_ENV: Record<string, string> = {
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
  HOME: GOG_HOME,
  GOG_KEYRING_BACKEND: 'file',
  GOG_KEYRING_PASSWORD: process.env.GOG_KEYRING_PASSWORD || '',
};

/** Path where gog expects credentials.json (mirrors os.UserConfigDir() + "gogcli"). */
const GOG_CREDENTIALS_PATH = join(GOG_HOME, '.config', 'gogcli', 'credentials.json');

/**
 * If GOG_GOOGLE_CLIENT_ID + GOG_GOOGLE_CLIENT_SECRET env vars are set,
 * write credentials.json so gog can use them. Idempotent — skips if file exists.
 */
function ensureGogCredentials(): void {
  const clientId = process.env.GOG_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOG_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return;
  if (existsSync(GOG_CREDENTIALS_PATH)) return;

  mkdirSync(join(GOG_HOME, '.config', 'gogcli'), { recursive: true });
  writeFileSync(
    GOG_CREDENTIALS_PATH,
    JSON.stringify({ client_id: clientId, client_secret: clientSecret }, null, 2) + '\n',
    { mode: 0o600 },
  );
}

/** Check if Google OAuth credentials are configured (env vars or credentials.json on disk). */
export function isGogConfigured(): boolean {
  ensureGogCredentials();
  return existsSync(GOG_CREDENTIALS_PATH);
}

export interface GogAccount {
  email: string;
  client: string;
  services: string[];
  scopes: string[];
  created_at: string;
  auth: string;
}

/**
 * Holds the running `gog auth add --manual` process between start and complete.
 * The same process must be used for both steps because the OAuth state is unique per invocation.
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

/** Check if `gog` CLI is installed and accessible. */
export async function isGogInstalled(): Promise<boolean> {
  try {
    await execFileAsync('gog', ['--version'], { env: GOG_ENV });
    return true;
  } catch {
    return false;
  }
}

/** List all authenticated Google accounts. */
export async function listGogAccounts(): Promise<GogAccount[]> {
  try {
    const { stdout } = await execFileAsync('gog', ['auth', 'list', '--json'], { env: GOG_ENV });
    const data = JSON.parse(stdout);
    return data.accounts ?? [];
  } catch {
    return [];
  }
}

/**
 * Start the manual OAuth flow for a Google account.
 * Returns the auth URL that the user must open in their browser.
 *
 * The spawned process is kept alive — call `completeGogAuth` to finish,
 * or the process auto-kills after 10 minutes.
 */
export function startGogAuth(
  email: string,
  services = 'gmail',
): Promise<{ authUrl: string }> {
  // Kill any previous pending auth
  cleanupPendingAuth();

  return new Promise((resolve, reject) => {
    const args = [
      'auth', 'add', email,
      '--manual',
      '--services', services,
      '--force-consent',
    ];

    const child = spawn('gog', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: GOG_ENV,
    });

    pendingAuthProcess = child;

    let output = '';
    let resolved = false;

    const checkForUrl = (chunk: Buffer) => {
      if (resolved) return;
      output += chunk.toString();

      const urlMatch = output.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth[^\s]+/);
      if (urlMatch) {
        resolved = true;
        // Do NOT kill the process — keep it alive for completeGogAuth
        resolve({ authUrl: urlMatch[0] });
      }
    };

    // gog writes prompts/URLs to stderr
    child.stdout.on('data', checkForUrl);
    child.stderr.on('data', checkForUrl);

    child.on('close', (code) => {
      pendingAuthProcess = null;
      if (resolved) return;
      reject(new Error(`gog auth failed (code ${code}): ${output}`));
    });

    // Auto-cleanup after 10 minutes (OAuth codes expire)
    pendingAuthTimeout = setTimeout(() => {
      pendingAuthTimeout = null;
      if (pendingAuthProcess === child) {
        child.kill();
        pendingAuthProcess = null;
      }
    }, 10 * 60_000);

    // Startup timeout — if no URL appears in 10 seconds, something is wrong
    setTimeout(() => {
      if (!resolved) {
        cleanupPendingAuth();
        reject(new Error('Timed out waiting for auth URL'));
      }
    }, 10_000);
  });
}

/**
 * Complete the OAuth flow by piping the redirect URL into the already-running process.
 */
export async function completeGogAuth(
  email: string,
  redirectUrl: string,
  _services = 'gmail',
): Promise<{ ok: boolean; error?: string }> {
  const child = pendingAuthProcess;
  if (!child || child.killed) {
    return { ok: false, error: 'No pending auth session. Please start authorization again.' };
  }

  // Clear the auto-cleanup timeout
  if (pendingAuthTimeout) {
    clearTimeout(pendingAuthTimeout);
    pendingAuthTimeout = null;
  }

  return new Promise((resolve) => {
    let output = '';

    const collectOutput = (chunk: Buffer) => {
      output += chunk.toString();
    };

    child.stdout?.on('data', collectOutput);
    child.stderr?.on('data', collectOutput);

    child.on('close', (code) => {
      pendingAuthProcess = null;
      if (code === 0) {
        resolve({ ok: true });
      } else {
        const errorMsg = output.trim() || `Exit code ${code}`;
        resolve({ ok: false, error: errorMsg });
      }
    });

    // Send the redirect URL to the waiting process
    child.stdin?.write(redirectUrl + '\n');
    child.stdin?.end();

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingAuthProcess === child) {
        child.kill();
        pendingAuthProcess = null;
      }
      resolve({ ok: false, error: 'Timed out completing auth' });
    }, 30_000);
  });
}

/** Remove a stored Google account. */
export async function removeGogAccount(email: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await execFileAsync('gog', ['auth', 'remove', email, '--force'], { env: GOG_ENV });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.stderr || err.message };
  }
}

/** Test that a Google account's auth is valid by listing Gmail labels. */
export async function testGogAccount(email: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await execFileAsync('gog', [
      'gmail', 'labels', 'list',
      '--account', email,
      '--json',
    ], { timeout: 15_000, env: GOG_ENV });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.stderr || err.message || 'Auth test failed' };
  }
}
