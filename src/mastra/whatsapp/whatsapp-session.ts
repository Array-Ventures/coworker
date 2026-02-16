import fs from 'node:fs';
import path from 'node:path';
import {
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
  type ConnectionState,
} from '@whiskeysockets/baileys';
import pino from 'pino';

export type WhatsAppSocket = ReturnType<typeof makeWASocket>;

export type WhatsAppConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'qr_ready'
  | 'connected'
  | 'logged_out';

export interface CreateSocketOptions {
  authDir: string;
  onQr?: (qr: string) => void;
  onConnectionUpdate?: (update: Partial<ConnectionState>) => void;
}

const CREDS_FILE = 'creds.json';
const CREDS_BACKUP = 'creds.json.bak';

let credsSaveQueue: Promise<void> = Promise.resolve();

// ── Credential backup/restore (ported from owpenbot) ──

function readCredsRaw(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size <= 1) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function isValidJson(raw: string): boolean {
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

function backupCreds(authDir: string): void {
  try {
    const credsPath = path.join(authDir, CREDS_FILE);
    const backupPath = path.join(authDir, CREDS_BACKUP);
    const raw = readCredsRaw(credsPath);
    if (!raw || !isValidJson(raw)) return;
    fs.copyFileSync(credsPath, backupPath);
  } catch {
    // ignore backup failures
  }
}

function maybeRestoreCreds(authDir: string): void {
  try {
    const credsPath = path.join(authDir, CREDS_FILE);
    const backupPath = path.join(authDir, CREDS_BACKUP);
    const raw = readCredsRaw(credsPath);
    if (raw && isValidJson(raw)) return;
    const backupRaw = readCredsRaw(backupPath);
    if (!backupRaw || !isValidJson(backupRaw)) return;
    fs.copyFileSync(backupPath, credsPath);
    console.log('[whatsapp] restored creds from backup');
  } catch {
    // ignore restore failures
  }
}

function enqueueSaveCreds(authDir: string, saveCreds: () => Promise<void> | void): void {
  credsSaveQueue = credsSaveQueue
    .then(async () => {
      backupCreds(authDir);
      await Promise.resolve(saveCreds());
    })
    .catch((error) => {
      console.error('[whatsapp] creds save failed:', error);
    });
}

export function hasWhatsAppCreds(authDir: string): boolean {
  const raw = readCredsRaw(path.join(authDir, CREDS_FILE));
  if (!raw) return false;
  return isValidJson(raw);
}

export function getStatusCode(error: unknown): number | undefined {
  return (
    (error as { output?: { statusCode?: number } })?.output?.statusCode ??
    (error as { error?: { output?: { statusCode?: number } } })?.error?.output?.statusCode ??
    (error as { status?: number })?.status
  );
}

/**
 * Create a Baileys WhatsApp socket with multi-file auth state persistence.
 * Callers listen to connection events via onConnectionUpdate callback.
 */
export async function createWhatsAppSocket(options: CreateSocketOptions): Promise<WhatsAppSocket> {
  const { authDir, onQr, onConnectionUpdate } = options;

  fs.mkdirSync(authDir, { recursive: true });
  maybeRestoreCreds(authDir);

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  // Baileys requires a pino logger — silence it to avoid noise
  const logger = pino({ level: 'silent' }) as any;

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    version,
    logger,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: ['coworker', 'electron', '1.0.0'],
  });

  sock.ev.on('creds.update', () => enqueueSaveCreds(authDir, saveCreds));

  sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
    if (update.qr) {
      onQr?.(update.qr);
    }
    onConnectionUpdate?.(update);
  });

  sock.ws?.on?.('error', (error: Error) => {
    console.error('[whatsapp] websocket error:', error.message);
  });

  return sock;
}

export function closeWhatsAppSocket(sock: WhatsAppSocket): void {
  try {
    sock.ws?.close();
  } catch {
    // ignore
  }
  try {
    sock.end?.(undefined);
  } catch {
    // ignore
  }
}
