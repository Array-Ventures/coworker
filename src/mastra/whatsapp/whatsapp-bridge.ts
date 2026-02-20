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
  isBotMentioned,
  getContextInfo,
  getQuotedText,
  formatMessageEnvelope,
  containsNoReply,
  stripDirectives,
  type MessageMetadata,
} from './whatsapp-utils';
import { pool as defaultPool } from '../db';

const PAIRING_TTL_MS = 60 * 60_000; // 1 hour
const DEBOUNCE_MS = 2000; // 2s window to collect rapid messages
const AGENT_TIMEOUT_MS = 5 * 60_000; // 5 min max per agent call
const GROUP_META_TTL_MS = 5 * 60_000; // 5 min cache for group metadata

function generatePairingCode(): string {
  return String(100_000 + crypto.randomInt(900_000));
}

interface GroupMeta {
  name: string;
  fetchedAt: number;
}

export class WhatsAppBridge {
  private mastra: Mastra;
  private socket: WhatsAppSocket;
  private pool: { query: (sql: string, params?: unknown[]) => Promise<any> };
  private sentTracker = new SentMessageTracker();
  private handler: ((arg: { messages: WAMessage[] }) => Promise<void>) | null = null;

  // Debounce + abort state (replaces old messageQueue)
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingTexts = new Map<string, { phone: string; texts: string[]; replyJid: string }>();
  private activeAbort = new Map<string, AbortController>();
  private processing = new Set<string>();

  // Group metadata cache
  private groupMetaCache = new Map<string, GroupMeta>();

  // Per-message metadata for envelope building (keyed by debounce key)
  private pendingMeta = new Map<string, MessageMetadata>();

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
    this.pendingMeta.clear();
    this.processing.clear();
  }

  /** Send a message outbound (for message router). */
  async sendOutbound(to: string, text: string): Promise<string | undefined> {
    const chunks = chunkText(text, MAX_WHATSAPP_TEXT_LENGTH);
    let lastMsgId: string | undefined;
    for (const chunk of chunks) {
      const sent = await this.socket.sendMessage(to, { text: chunk });
      this.sentTracker.record(sent?.key?.id);
      lastMsgId = sent?.key?.id;
    }
    return lastMsgId;
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

    const text = extractText(msg);
    if (!text.trim()) return;

    const isGroup = isJidGroup(remoteJid);

    if (isGroup) {
      // Group message flow
      const groupAllowed = await this.isGroupAllowed(remoteJid);
      if (!groupAllowed) return; // silently ignore

      const participant = msg.key.participant as string | undefined;
      if (!participant) return;

      const phone = normalizeWhatsAppId(participant);
      const debounceKey = `${remoteJid}:${participant}`;
      const mentioned = isBotMentioned(msg, (this.socket as any).user?.id ?? '');
      const quotedText = getQuotedText(msg);
      const groupMeta = await this.getGroupMeta(remoteJid);

      const meta: MessageMetadata = {
        channel: 'whatsapp',
        type: 'group',
        senderJid: participant,
        senderName: (msg as any).pushName,
        timestamp: typeof (msg as any).messageTimestamp === 'number'
          ? (msg as any).messageTimestamp
          : Math.floor(Date.now() / 1000),
        groupName: groupMeta.name,
        groupJid: remoteJid,
        isMentioned: mentioned,
        quotedText,
      };

      console.log(`[whatsapp-bridge] group msg from ${phone} in ${groupMeta.name} (mentioned=${mentioned})`);

      this.bufferMessage(debounceKey, phone, text, remoteJid, meta, mentioned);
    } else {
      // DM flow
      const phone = normalizeWhatsAppId(remoteJid);
      console.log(`[whatsapp-bridge] incoming from raw JID: ${remoteJid} → normalized: ${phone}`);

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

      const quotedText = getQuotedText(msg);
      const meta: MessageMetadata = {
        channel: 'whatsapp',
        type: 'dm',
        senderJid: remoteJid,
        senderName: (msg as any).pushName,
        timestamp: typeof (msg as any).messageTimestamp === 'number'
          ? (msg as any).messageTimestamp
          : Math.floor(Date.now() / 1000),
        quotedText,
      };

      this.bufferMessage(remoteJid, phone, text, remoteJid, meta, false);
    }
  }

  /** Buffer a message and reset debounce timer. Aborts active processing if needed. */
  private bufferMessage(
    debounceKey: string,
    phone: string,
    text: string,
    replyJid: string,
    meta: MessageMetadata,
    immediateFlush: boolean,
  ): void {
    // Accumulate text
    const pending = this.pendingTexts.get(debounceKey) ?? { phone, texts: [], replyJid };
    pending.texts.push(text);
    this.pendingTexts.set(debounceKey, pending);

    // Store latest metadata (last message wins for envelope)
    this.pendingMeta.set(debounceKey, meta);

    // If agent is actively processing for this contact, abort it
    const activeController = this.activeAbort.get(debounceKey);
    if (activeController) {
      console.log(`[whatsapp-bridge] aborting active processing for ${phone} — new message arrived`);
      activeController.abort();
    }

    // Clear existing debounce timer
    const existing = this.debounceTimers.get(debounceKey);
    if (existing) clearTimeout(existing);

    if (immediateFlush) {
      // Mention: skip debounce, flush immediately
      this.debounceTimers.delete(debounceKey);
      void this.flushMessages(debounceKey);
    } else {
      // Normal debounce
      const timer = setTimeout(() => {
        this.debounceTimers.delete(debounceKey);
        void this.flushMessages(debounceKey);
      }, DEBOUNCE_MS);
      this.debounceTimers.set(debounceKey, timer);
    }
  }

  /** Flush buffered messages into a single agent call. */
  private async flushMessages(debounceKey: string): Promise<void> {
    // If already processing, the abort will trigger a re-flush via bufferMessage
    if (this.processing.has(debounceKey)) return;

    const pending = this.pendingTexts.get(debounceKey);
    if (!pending?.texts.length) return;

    const { phone, texts, replyJid } = pending;
    const meta = this.pendingMeta.get(debounceKey);
    this.pendingTexts.delete(debounceKey);
    this.pendingMeta.delete(debounceKey);

    const combined = texts.join('\n');
    this.processing.add(debounceKey);

    // Register AbortController immediately so new messages can abort us
    const controller = new AbortController();
    this.activeAbort.set(debounceKey, controller);

    try {
      await this.processMessage(phone, replyJid, combined, meta, controller);
    } catch (err) {
      console.error(`[whatsapp-bridge] task failed for ${debounceKey}:`, err);
    } finally {
      this.processing.delete(debounceKey);
      this.activeAbort.delete(debounceKey);
    }

    // Check if more messages arrived during processing
    if (this.pendingTexts.has(debounceKey) && this.pendingTexts.get(debounceKey)!.texts.length > 0) {
      void this.flushMessages(debounceKey);
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

  private async processMessage(
    phone: string,
    replyJid: string,
    text: string,
    meta?: MessageMetadata,
    controller?: AbortController,
  ): Promise<void> {
    const agent = this.mastra.getAgent('coworkerAgent');
    if (!agent) {
      console.error('[whatsapp-bridge] coworkerAgent not found');
      return;
    }

    const isGroup = meta?.type === 'group';
    const threadId = isGroup
      ? `whatsapp-group-${meta!.groupJid}`
      : `whatsapp-${phone}`;
    const resourceId = 'coworker';

    // Build envelope
    let content = text;
    if (meta) {
      const envelope = formatMessageEnvelope(meta);
      content = `<message-context>\n${envelope}\n</message-context>\n${text}`;
    }

    // Thread metadata
    const threadTitle = isGroup
      ? `WhatsApp Group: ${meta!.groupName}`
      : `WhatsApp: ${phone}`;
    const threadMetadata = isGroup
      ? { type: 'whatsapp-group', groupJid: meta!.groupJid, groupName: meta!.groupName }
      : { type: 'whatsapp', phone };

    // Use provided controller or create one (backward compat)
    if (!controller) controller = new AbortController();
    const timeout = setTimeout(() => {
      console.warn(`[whatsapp-bridge] agent timed out for ${phone} after ${AGENT_TIMEOUT_MS / 1000}s`);
      controller.abort();
    }, AGENT_TIMEOUT_MS);

    try {
      // Show typing indicator (fire-and-forget — NEVER await)
      this.socket.sendPresenceUpdate('composing', replyJid).catch(() => {});

      console.log(`[whatsapp-bridge] processing message from ${phone}: "${text.slice(0, 80)}..."`);

      const response = await agent.generate(
        [{ role: 'user' as const, content }],
        {
          abortSignal: controller.signal,
          memory: {
            thread: {
              id: threadId,
              title: threadTitle,
              metadata: threadMetadata,
            },
            resource: resourceId,
          },
        },
      );

      // If aborted (new message arrived), skip sending reply
      if (controller.signal.aborted) return;

      const reply = response.text?.trim();
      if (!reply) return;

      // Check <no-reply/> directive
      if (containsNoReply(reply)) {
        console.log(`[whatsapp-bridge] <no-reply/> directive — suppressing send to ${replyJid}`);
        return;
      }

      // Strip directives and send
      const cleanReply = stripDirectives(reply);
      if (!cleanReply) return;

      const chunks = chunkText(cleanReply, MAX_WHATSAPP_TEXT_LENGTH);
      for (const chunk of chunks) {
        const sent = await this.socket.sendMessage(replyJid, { text: chunk });
        this.sentTracker.record(sent?.key?.id);
      }

      console.log(`[whatsapp-bridge] replied to ${phone} (${cleanReply.length} chars, ${chunks.length} chunk(s))`);
    } catch (err) {
      if (controller.signal.aborted) {
        console.log(`[whatsapp-bridge] aborted for ${phone} (new message or timeout)`);
        return;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      // Clear typing indicator (fire-and-forget — NEVER await)
      this.socket.sendPresenceUpdate('paused', replyJid).catch(() => {});
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

  /** Check if a group is in the allowlist. */
  private async isGroupAllowed(groupJid: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'SELECT group_jid FROM whatsapp_groups WHERE group_jid = $1 AND enabled = true',
        [groupJid],
      );
      return result.rows.length > 0;
    } catch {
      return false;
    }
  }

  /** Fetch group metadata with 5-min TTL cache. */
  private async getGroupMeta(groupJid: string): Promise<GroupMeta> {
    const cached = this.groupMetaCache.get(groupJid);
    if (cached) {
      if (Date.now() - cached.fetchedAt < GROUP_META_TTL_MS) return cached;
      this.groupMetaCache.delete(groupJid); // evict stale entry
    }

    try {
      const metadata = await (this.socket as any).groupMetadata(groupJid);
      const meta: GroupMeta = {
        name: metadata?.subject ?? groupJid,
        fetchedAt: Date.now(),
      };
      this.groupMetaCache.set(groupJid, meta);
      return meta;
    } catch {
      return { name: groupJid, fetchedAt: Date.now() };
    }
  }
}
