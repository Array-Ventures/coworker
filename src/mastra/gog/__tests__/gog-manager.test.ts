import { describe, test, expect, mock, beforeAll, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';

// ── Mock functions ──

const mockExistsSync = mock(() => false);
const mockMkdirSync = mock(() => undefined as any);
const mockWriteFileSync = mock(() => undefined as any);
const mockSpawn = mock();

// execFileAsync = promisify(execFile) in gog-manager. Node's real execFile
// has util.promisify.custom so promisify returns { stdout, stderr }.
// We attach the same symbol so promisify picks up our async mock.
const mockExecFilePromisified = mock(async () => ({ stdout: '', stderr: '' }));
const mockExecFile: any = mock();
mockExecFile[Symbol.for('nodejs.util.promisify.custom')] = mockExecFilePromisified;

// ── Module mocks (hoisted before imports by bun) ──

mock.module('node:child_process', () => ({
  ...require('node:child_process'),
  execFile: mockExecFile,
  spawn: mockSpawn,
}));

// Spread all real fs exports so other test files that need fs.promises etc.
// aren't broken. Only override the 3 functions gog-manager uses.
mock.module('node:fs', () => ({
  ...require('node:fs'),
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
}));

// ── Dynamic import so gog-manager loads with mocked modules ──
// Static import would evaluate the module before mock.module takes effect
// on promisify(execFile). Dynamic import ensures mocks are in place first.

let isGogConfigured: typeof import('../gog-manager').isGogConfigured;
let isGogInstalled: typeof import('../gog-manager').isGogInstalled;
let listGogAccounts: typeof import('../gog-manager').listGogAccounts;
let startGogAuth: typeof import('../gog-manager').startGogAuth;
let completeGogAuth: typeof import('../gog-manager').completeGogAuth;
let removeGogAccount: typeof import('../gog-manager').removeGogAccount;
let testGogAccount: typeof import('../gog-manager').testGogAccount;

beforeAll(async () => {
  const mod = await import('../gog-manager');
  isGogConfigured = mod.isGogConfigured;
  isGogInstalled = mod.isGogInstalled;
  listGogAccounts = mod.listGogAccounts;
  startGogAuth = mod.startGogAuth;
  completeGogAuth = mod.completeGogAuth;
  removeGogAccount = mod.removeGogAccount;
  testGogAccount = mod.testGogAccount;
});

// ── Helpers ──

function createMockChildProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child: any = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin: { write: mock(() => true), end: mock(() => {}) },
    killed: false,
    kill: mock(function (this: any) {
      this.killed = true;
    }),
    pid: 12345,
  });
  return child;
}

// ── Env var isolation ──

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv.GOG_GOOGLE_CLIENT_ID = process.env.GOG_GOOGLE_CLIENT_ID;
  savedEnv.GOG_GOOGLE_CLIENT_SECRET = process.env.GOG_GOOGLE_CLIENT_SECRET;
  delete process.env.GOG_GOOGLE_CLIENT_ID;
  delete process.env.GOG_GOOGLE_CLIENT_SECRET;
});

afterEach(() => {
  process.env.GOG_GOOGLE_CLIENT_ID = savedEnv.GOG_GOOGLE_CLIENT_ID;
  process.env.GOG_GOOGLE_CLIENT_SECRET = savedEnv.GOG_GOOGLE_CLIENT_SECRET;
  mock.clearAllMocks();
});

// ── isGogConfigured — credential provisioning ──

describe('isGogConfigured', () => {
  test('env vars set + no file on disk → writes credentials.json, returns true', () => {
    process.env.GOG_GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOG_GOOGLE_CLIENT_SECRET = 'test-client-secret';

    // First existsSync call (inside ensureGogCredentials): file doesn't exist
    // Second existsSync call (return statement): file now exists after write
    let callCount = 0;
    mockExistsSync.mockImplementation(() => {
      callCount++;
      return callCount > 1;
    });

    expect(isGogConfigured()).toBe(true);
    expect(mockMkdirSync).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);

    // Verify written content contains client credentials
    const writtenContent = (mockWriteFileSync.mock.calls[0] as any[])[1] as string;
    expect(writtenContent).toContain('test-client-id');
    expect(writtenContent).toContain('test-client-secret');
  });

  test('env vars set + file already exists → skips write, returns true', () => {
    process.env.GOG_GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOG_GOOGLE_CLIENT_SECRET = 'test-client-secret';
    mockExistsSync.mockReturnValue(true);

    expect(isGogConfigured()).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(0);
  });

  test('no env vars + no file → returns false', () => {
    mockExistsSync.mockReturnValue(false);

    expect(isGogConfigured()).toBe(false);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(0);
  });

  test('no env vars + file exists (local dev) → returns true', () => {
    mockExistsSync.mockReturnValue(true);

    expect(isGogConfigured()).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(0);
  });

  test('only client ID set (no secret) → does not write', () => {
    process.env.GOG_GOOGLE_CLIENT_ID = 'test-client-id';
    mockExistsSync.mockReturnValue(false);

    expect(isGogConfigured()).toBe(false);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(0);
  });
});

// ── isGogInstalled — CLI detection ──

describe('isGogInstalled', () => {
  test('gog --version succeeds → returns true', async () => {
    mockExecFilePromisified.mockResolvedValueOnce({ stdout: 'gog v1.0.0', stderr: '' });

    expect(await isGogInstalled()).toBe(true);
  });

  test('gog --version throws → returns false', async () => {
    mockExecFilePromisified.mockRejectedValueOnce(new Error('ENOENT'));

    expect(await isGogInstalled()).toBe(false);
  });
});

// ── listGogAccounts — account listing ──

describe('listGogAccounts', () => {
  test('valid JSON with accounts → returns parsed array', async () => {
    const accounts = [
      { email: 'user@gmail.com', client: 'gogcli', services: ['gmail'], scopes: [], created_at: '2024-01-01', auth: 'valid' },
    ];
    mockExecFilePromisified.mockResolvedValueOnce({
      stdout: JSON.stringify({ accounts }),
      stderr: '',
    });

    const result = await listGogAccounts();
    expect(result).toEqual(accounts);
  });

  test('command throws → returns []', async () => {
    mockExecFilePromisified.mockRejectedValueOnce(new Error('not installed'));

    expect(await listGogAccounts()).toEqual([]);
  });

  test('malformed JSON → returns []', async () => {
    mockExecFilePromisified.mockResolvedValueOnce({ stdout: '{invalid json', stderr: '' });

    expect(await listGogAccounts()).toEqual([]);
  });
});

// ── startGogAuth — OAuth flow start ──

describe('startGogAuth', () => {
  test('auth URL in stderr → resolves with { authUrl }', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValueOnce(child);

    const promise = startGogAuth('user@gmail.com');

    // Simulate gog printing the auth URL to stderr
    child.stderr.emit(
      'data',
      Buffer.from('Open this URL: https://accounts.google.com/o/oauth2/auth?client_id=xxx&scope=gmail\n'),
    );

    const result = await promise;
    expect(result.authUrl).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/auth/);
  });

  test('process exits before URL → rejects with error', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValueOnce(child);

    const promise = startGogAuth('user@gmail.com');

    child.emit('close', 1);

    await expect(promise).rejects.toThrow('gog auth failed');
  });

  test('passes correct args: email, --manual, --services, --force-consent', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValueOnce(child);

    const promise = startGogAuth('test@example.com', 'gmail,drive');

    child.stderr.emit(
      'data',
      Buffer.from('https://accounts.google.com/o/oauth2/auth?foo=bar\n'),
    );
    await promise;

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('gog');
    expect(args).toContain('auth');
    expect(args).toContain('add');
    expect(args).toContain('test@example.com');
    expect(args).toContain('--manual');
    expect(args).toContain('--services');
    expect(args).toContain('gmail,drive');
    expect(args).toContain('--force-consent');
  });
});

// ── completeGogAuth — OAuth flow complete ──

describe('completeGogAuth', () => {
  test('no pending process → returns { ok: false }', async () => {
    // Clear any pending auth by starting and immediately closing a process
    const child = createMockChildProcess();
    mockSpawn.mockReturnValueOnce(child);
    const startPromise = startGogAuth('user@gmail.com');
    child.emit('close', 1);
    try { await startPromise; } catch { /* expected rejection */ }

    const result = await completeGogAuth('user@gmail.com', 'https://redirect.url');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No pending');
  });

  test('process exits 0 after stdin write → returns { ok: true }', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValueOnce(child);

    // Start auth to set pendingAuthProcess
    const startPromise = startGogAuth('user@gmail.com');
    child.stderr.emit(
      'data',
      Buffer.from('https://accounts.google.com/o/oauth2/auth?client_id=xxx\n'),
    );
    await startPromise;

    // Now complete
    const completePromise = completeGogAuth('user@gmail.com', 'https://redirect.url?code=abc');

    // Simulate process exiting successfully
    child.emit('close', 0);

    const result = await completePromise;
    expect(result.ok).toBe(true);
    expect(child.stdin.write).toHaveBeenCalledWith('https://redirect.url?code=abc\n');
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
  });

  test('process exits non-zero → returns { ok: false, error }', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValueOnce(child);

    const startPromise = startGogAuth('user@gmail.com');
    child.stderr.emit(
      'data',
      Buffer.from('https://accounts.google.com/o/oauth2/auth?client_id=xxx\n'),
    );
    await startPromise;

    const completePromise = completeGogAuth('user@gmail.com', 'https://redirect.url?code=bad');

    // Simulate error output then non-zero exit
    child.stderr.emit('data', Buffer.from('invalid_grant: Token expired'));
    child.emit('close', 1);

    const result = await completePromise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid_grant');
  });
});

// ── removeGogAccount — account removal ──

describe('removeGogAccount', () => {
  test('success → returns { ok: true }', async () => {
    mockExecFilePromisified.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await removeGogAccount('user@gmail.com');
    expect(result).toEqual({ ok: true });
  });

  test('failure → returns { ok: false, error }', async () => {
    mockExecFilePromisified.mockRejectedValueOnce({ stderr: 'account not found', message: 'exit code 1' });

    const result = await removeGogAccount('user@gmail.com');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('account not found');
  });
});

// ── testGogAccount — auth validation ──

describe('testGogAccount', () => {
  test('success → returns { ok: true }', async () => {
    mockExecFilePromisified.mockResolvedValueOnce({ stdout: '[]', stderr: '' });

    const result = await testGogAccount('user@gmail.com');
    expect(result).toEqual({ ok: true });
  });

  test('failure → returns { ok: false, error }', async () => {
    mockExecFilePromisified.mockRejectedValueOnce({ stderr: 'token expired', message: 'auth failed' });

    const result = await testGogAccount('user@gmail.com');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('token expired');
  });
});
