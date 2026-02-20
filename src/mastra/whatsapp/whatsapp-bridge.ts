import crypto from 'node:crypto';
import type { Mastra } from '@mastra/core/mastra';
import { isJidGroup, type WAMessage } from '@whiskeysockets/baileys';
import type { WhatsAppSocket } from './whatsapp-session';
import {
  normalizeWhatsAppId,
  extractText,
  chunkText,
  MAX_WHATSAPP_TEXT_LENGTH,
  SentMessageTracker,
} from './whatsapp-utils';
import { pool as defaultPool } from '../db';

const PAIRING_TTL_MS = 60 * 60_000; // 1 hour
const DEBOUNCE_MS = 2000; // 2s window to collect rapid messages
const AGENT_TIMEOUT_MS = 5 * 60_000; // 5 min max per agent call

function generatePairingCode(): string {
  return String(100_000 + crypto.randomInt(900_000));
}

export class WhatsAppBridge {
  private mastra: Mastra;
  private socket: WhatsAppSocket;
  private pool: { query: (sql: string, params?: unknown[]) => Promise<any> };
  private sentTracker = new SentMessageTracker();
  private handler: ((arg: { messages: WAMessage[] }) => Promise<void>) | null = null;

  // Debounce + abort state (replaces old messageQueue)
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingTexts = new Map<string, { phone: string; texts: string[] }>();
  private activeAbort = new Map<string, AbortController>();
  private processing = new Set<string>();

  constructor(mastra: Mastra, socket: WhatsAppSocket, pool?: any) {
    this.mastra = mastra;
    this.socket = socket;
    this.pool = pool ?? defaultPool;
  }

  /** Attach to the Baileys socket's message events. */
  attach(): void {
    this.handler = async ({ messages }: { messages: WAMessage[] }) => {
      this.sentTracker.prune();
      for (const msg of messages) {
        try {
          await this.handleMessage(msg);
        } catch (error) {
          console.error('[whatsapp-bridge] message handler error:', error);
        }
      }
    };
    this.socket.ev.on('messages.upsert', this.handler);
  }

  /** Detach listeners and clear pending work. */
  detach(): void {
    if (this.handler) {
      this.socket.ev.off('messages.upsert', this.handler);
      this.handler = null;
    }
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    // Abort any active processing
    for (const controller of this.activeAbort.values()) controller.abort();
    this.activeAbort.clear();
    this.pendingTexts.clear();
    this.processing.clear();
  }

  private async handleMessage(msg: WAMessage): Promise<void> {
    if (!msg.message) return;

    const fromMe = Boolean(msg.key.fromMe);
    const messageId = msg.key.id;

    // Skip our own sent messages (echo dedup)
    if (fromMe && messageId && this.sentTracker.has(messageId)) {
      this.sentTracker.consume(messageId);
      return;
    }

    // Skip all fromMe messages (V1: no self-chat)
    if (fromMe) return;

    const remoteJid = msg.key.remoteJid;
    if (!remoteJid) return;

    // Skip group messages (V1: DMs only)
    if (isJidGroup(remoteJid)) return;

    const text = extractText(msg);
    if (!text.trim()) return;

    const phone = normalizeWhatsAppId(remoteJid);
    console.log(`[whatsapp-bridge] incoming from raw JID: ${remoteJid} → normalized: ${phone}`);

    // Check allowlist (match by raw JID or normalized phone)
    const allowed = await this.isAllowed(remoteJid, phone);
    if (!allowed) {
      console.log(`[whatsapp-bridge] not in allowlist — initiating pairing for ${remoteJid}`);
      try {
        await this.sendPairingCode(remoteJid);
      } catch (err) {
        console.error('[whatsapp-bridge] sendPairingCode failed:', err);
      }
      return;
    }

    console.log(`[whatsapp-bridge] allowed — ${phone}, text: "${text.slice(0, 80)}"`);

    // Buffer message for debounce + abort
    this.bufferMessage(remoteJid, phone, text);
  }

  /** Buffer a message and reset debounce timer. Aborts active processing if needed. */
  private bufferMessage(remoteJid: string, phone: string, text: string): void {
    // Accumulate text
    const pending = this.pendingTexts.get(remoteJid) ?? { phone, texts: [] };
    pending.texts.push(text);
    this.pendingTexts.set(remoteJid, pending);

    // If agent is actively processing for this contact, abort it
    const activeController = this.activeAbort.get(remoteJid);
    if (activeController) {
      console.log(`[whatsapp-bridge] aborting active processing for ${phone} — new message arrived`);
      activeController.abort();
    }

    // Reset debounce timer
    const existing = this.debounceTimers.get(remoteJid);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(remoteJid);
      void this.flushMessages(remoteJid);
    }, DEBOUNCE_MS);
    this.debounceTimers.set(remoteJid, timer);
  }

  /** Flush buffered messages into a single agent call. */
  private async flushMessages(remoteJid: string): Promise<void> {
    // If already processing, the abort will trigger a re-flush via bufferMessage
    if (this.processing.has(remoteJid)) return;

    const pending = this.pendingTexts.get(remoteJid);
    if (!pending?.texts.length) return;

    const { phone, texts } = pending;
    this.pendingTexts.delete(remoteJid);

    const combined = texts.join('\n');
    this.processing.add(remoteJid);

    try {
      await this.processMessage(phone, remoteJid, combined);
    } catch (err) {
      // Aborts are caught inside processMessage and never reach here
      console.error(`[whatsapp-bridge] task failed for ${remoteJid}:`, err);
    } finally {
      this.processing.delete(remoteJid);
      this.activeAbort.delete(remoteJid);
    }

    // Check if more messages arrived during processing
    if (this.pendingTexts.has(remoteJid) && this.pendingTexts.get(remoteJid)!.texts.length > 0) {
      void this.flushMessages(remoteJid);
    }
  }

  private async sendPairingCode(remoteJid: string): Promise<void> {
    // Check if there's already a pending pairing for this JID
    const existing = await this.pool.query(
      'SELECT code FROM whatsapp_pairing WHERE raw_jid = $1 AND expires_at > NOW()',
      [remoteJid],
    );

    let code: string;
    if (existing.rows.length > 0) {
      code = existing.rows[0].code as string;
    } else {
      // Clean up any expired entries for this JID
      await this.pool.query(
        'DELETE FROM whatsapp_pairing WHERE raw_jid = $1',
        [remoteJid],
      );

      code = generatePairingCode();
      const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
      await this.pool.query(
        'INSERT INTO whatsapp_pairing (code, raw_jid, expires_at) VALUES ($1, $2, $3)',
        [code, remoteJid, expiresAt],
      );
    }

    console.log(`[whatsapp-bridge] sent pairing code ${code} for JID ${remoteJid}`);

    const message = `To pair with Coworker, enter this code in the app:\n\n*${code}*\n\nThis code expires in 1 hour.`;
    const sent = await this.socket.sendMessage(remoteJid, { text: message });
    this.sentTracker.record(sent?.key?.id);
  }

  private async processMessage(phone: string, remoteJid: string, text: string): Promise<void> {
    const agent = this.mastra.getAgent('coworkerAgent');
    if (!agent) {
      console.error('[whatsapp-bridge] coworkerAgent not found');
      return;
    }

    const threadId = `whatsapp-${phone}`;
    const resourceId = 'coworker';

    // Create abort controller with timeout
    const controller = new AbortController();
    this.activeAbort.set(remoteJid, controller);
    const timeout = setTimeout(() => {
      console.warn(`[whatsapp-bridge] agent timed out for ${phone} after ${AGENT_TIMEOUT_MS / 1000}s`);
      controller.abort();
    }, AGENT_TIMEOUT_MS);

    try {
      // Show typing indicator (fire-and-forget — NEVER await)
      this.socket.sendPresenceUpdate('composing', remoteJid).catch(() => {});

      console.log(`[whatsapp-bridge] processing message from ${phone}: "${text.slice(0, 80)}..."`);

      const response = await agent.generate(
        [{ role: 'user' as const, content: text }],
        {
          abortSignal: controller.signal,
          memory: {
            thread: {
              id: threadId,
              title: `WhatsApp: ${phone}`,
              metadata: { type: 'whatsapp', phone },
            },
            resource: resourceId,
          },
        },
      );

      // If aborted (new message arrived), skip sending reply
      if (controller.signal.aborted) return;

      const reply = response.text?.trim();
      if (!reply) return;

      // Chunk and send
      const chunks = chunkText(reply, MAX_WHATSAPP_TEXT_LENGTH);
      for (const chunk of chunks) {
        const sent = await this.socket.sendMessage(remoteJid, { text: chunk });
        this.sentTracker.record(sent?.key?.id);
      }

      console.log(`[whatsapp-bridge] replied to ${phone} (${reply.length} chars, ${chunks.length} chunk(s))`);
    } catch (err) {
      if (controller.signal.aborted) {
        console.log(`[whatsapp-bridge] aborted for ${phone} (new message or timeout)`);
        return;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      // Clear typing indicator (fire-and-forget — NEVER await)
      this.socket.sendPresenceUpdate('paused', remoteJid).catch(() => {});
    }
  }

  /** Check allowlist by raw JID or normalized phone number. */
  private async isAllowed(rawJid: string, phone: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'SELECT phone_number FROM whatsapp_allowlist WHERE raw_jid = $1 OR phone_number = $2',
        [rawJid, phone],
      );
      return result.rows.length > 0;
    } catch (err) {
      console.error('[whatsapp-bridge] allowlist check failed:', err);
      return false; // fail-closed: reject if DB is down
    }
  }
}
