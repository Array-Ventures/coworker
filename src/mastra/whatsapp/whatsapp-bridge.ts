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
import { db } from '../db';

const PAIRING_TTL_MS = 60 * 60_000; // 1 hour

function generatePairingCode(): string {
  return String(100_000 + crypto.randomInt(900_000));
}

export class WhatsAppBridge {
  private mastra: Mastra;
  private socket: WhatsAppSocket;
  private messageQueue = new Map<string, Promise<void>>();
  private sentTracker = new SentMessageTracker();
  private handler: ((arg: { messages: WAMessage[] }) => Promise<void>) | null = null;

  constructor(mastra: Mastra, socket: WhatsAppSocket) {
    this.mastra = mastra;
    this.socket = socket;
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
    this.messageQueue.clear();
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

    // Enqueue per-contact to avoid concurrent agent calls
    this.enqueue(remoteJid, () => this.processMessage(phone, remoteJid, text));
  }

  private async sendPairingCode(remoteJid: string): Promise<void> {
    // Check if there's already a pending pairing for this JID
    const existing = await db.execute({
      sql: `SELECT code FROM whatsapp_pairing WHERE raw_jid = ? AND expires_at > datetime('now')`,
      args: [remoteJid],
    });

    let code: string;
    if (existing.rows.length > 0) {
      code = existing.rows[0].code as string;
    } else {
      // Clean up any expired entries for this JID
      await db.execute({
        sql: 'DELETE FROM whatsapp_pairing WHERE raw_jid = ?',
        args: [remoteJid],
      });

      code = generatePairingCode();
      const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
      await db.execute({
        sql: `INSERT INTO whatsapp_pairing (code, raw_jid, expires_at) VALUES (?, ?, ?)`,
        args: [code, remoteJid, expiresAt],
      });
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

    try {
      // Show typing indicator
      try {
        await this.socket.sendPresenceUpdate('composing', remoteJid);
      } catch {
        // ignore typing errors
      }

      console.log(`[whatsapp-bridge] processing message from ${phone}: "${text.slice(0, 80)}..."`);

      const response = await agent.generate(
        [{ role: 'user' as const, content: text }],
        {
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

      const reply = response.text?.trim();
      if (!reply) return;

      // Chunk and send
      const chunks = chunkText(reply, MAX_WHATSAPP_TEXT_LENGTH);
      for (const chunk of chunks) {
        const sent = await this.socket.sendMessage(remoteJid, { text: chunk });
        this.sentTracker.record(sent?.key?.id);
      }

      console.log(`[whatsapp-bridge] replied to ${phone} (${reply.length} chars, ${chunks.length} chunk(s))`);
    } finally {
      // Clear typing indicator
      try {
        await this.socket.sendPresenceUpdate('paused', remoteJid);
      } catch {
        // ignore
      }
    }
  }

  /** Check allowlist by raw JID or normalized phone number. */
  private async isAllowed(rawJid: string, phone: string): Promise<boolean> {
    try {
      const result = await db.execute({
        sql: 'SELECT phone_number FROM whatsapp_allowlist WHERE raw_jid = ? OR phone_number = ?',
        args: [rawJid, phone],
      });
      return result.rows.length > 0;
    } catch (err) {
      console.error('[whatsapp-bridge] allowlist check failed:', err);
      return false; // fail-closed: reject if DB is down
    }
  }

  private enqueue(contactId: string, task: () => Promise<void>): void {
    const previous = this.messageQueue.get(contactId) ?? Promise.resolve();
    const next = previous
      .then(task)
      .catch((error) => {
        console.error(`[whatsapp-bridge] task failed for ${contactId}:`, error);
      })
      .finally(() => {
        if (this.messageQueue.get(contactId) === next) {
          this.messageQueue.delete(contactId);
        }
      });
    this.messageQueue.set(contactId, next);
  }
}
