import crypto from 'node:crypto';
import path from 'node:path';
import type { Mastra } from '@mastra/core/mastra';
import { LocalFilesystem } from '@mastra/core/workspace';
import { isJidGroup, type WAMessage } from '@whiskeysockets/baileys';
import type { WhatsAppSocket } from './whatsapp-session';
import type { SendOpts } from '../messaging/router';
import {
  normalizeWhatsAppId,
  extractText,
  extractMedia,
  downloadMedia,
  describeNonTextMessage,
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
  type MediaAttachment,
} from './whatsapp-utils';
import { pool as defaultPool } from '../db';

// Default extensions by media type — used when Baileys doesn't provide a fileName
const TYPE_EXT: Record<string, string> = {
  image: 'jpg', video: 'mp4', audio: 'ogg', document: 'bin', sticker: 'webp',
};

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
  private pendingTexts = new Map<string, { phone: string; texts: string[]; media: MediaAttachment[]; replyJid: string }>();
  private activeAbort = new Map<string, AbortController>();
  private processing = new Set<string>();

  // Group metadata cache
  private groupMetaCache = new Map<string, GroupMeta>();

  // Lazy workspace filesystem for saving media
  private workspaceFs: LocalFilesystem | null = null;

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
  async sendOutbound(to: string, text: string, opts?: SendOpts): Promise<string | undefined> {
    let lastMsgId: string | undefined;

    // Send media first if present
    if (opts?.media?.length) {
      for (const item of opts.media) {
        const source = item.data ? Buffer.from(item.data) : { url: item.url! };
        let payload: any;
        switch (item.type) {
          case 'image': payload = { image: source, caption: item.caption }; break;
          case 'video': payload = { video: source, caption: item.caption }; break;
          case 'audio': payload = { audio: source, ptt: item.ptt ?? false }; break;
          case 'document': payload = { document: source, mimetype: item.mimeType || 'application/octet-stream', fileName: item.fileName, caption: item.caption }; break;
          case 'sticker': payload = { sticker: source }; break;
        }
        const sent = await this.socket.sendMessage(to, payload);
        this.sentTracker.record(sent?.key?.id);
        lastMsgId = sent?.key?.id;
      }
    }

    // Send text if present
    if (text?.trim()) {
      const chunks = chunkText(text, MAX_WHATSAPP_TEXT_LENGTH);
      for (const chunk of chunks) {
        const sent = await this.socket.sendMessage(to, { text: chunk });
        this.sentTracker.record(sent?.key?.id);
        lastMsgId = sent?.key?.id;
      }
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

    // Extract all content types from the (possibly wrapped) message
    const text = extractText(msg);
    const media = extractMedia(msg);
    const nonTextDesc = describeNonTextMessage(msg);

    // Skip if there's nothing to process
    if (!text.trim() && !media && !nonTextDesc) return;

    // Build the display text: combine extracted text with non-text descriptions
    const displayText = text.trim() || nonTextDesc || '';

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
        media: media || undefined,
      };

      console.log(`[whatsapp-bridge] group msg from ${phone} in ${groupMeta.name} (mentioned=${mentioned}${media ? `, media=${media.type}` : ''})`);

      this.bufferMessage(debounceKey, phone, displayText, remoteJid, meta, mentioned, media || undefined);
    } else {
      // DM flow
      const phone = normalizeWhatsAppId(remoteJid);
      console.log(`[whatsapp-bridge] incoming from raw JID: ${remoteJid} → normalized: ${phone}${media ? ` [media: ${media.type}]` : ''}`);

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

      console.log(`[whatsapp-bridge] allowed — ${phone}, text: "${displayText.slice(0, 80)}"`);

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
        media: media || undefined,
      };

      this.bufferMessage(remoteJid, phone, displayText, remoteJid, meta, false, media || undefined);
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
    media?: MediaAttachment,
  ): void {
    // Accumulate text and media
    const pending = this.pendingTexts.get(debounceKey) ?? { phone, texts: [], media: [], replyJid };
    if (text) pending.texts.push(text);
    if (media) pending.media.push(media);
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
    if (!pending || (!pending.texts.length && !pending.media.length)) return;

    const { phone, texts, media, replyJid } = pending;
    const meta = this.pendingMeta.get(debounceKey);
    this.pendingTexts.delete(debounceKey);
    this.pendingMeta.delete(debounceKey);

    const combined = texts.join('\n');
    this.processing.add(debounceKey);

    // Register AbortController immediately so new messages can abort us
    const controller = new AbortController();
    this.activeAbort.set(debounceKey, controller);

    try {
      await this.processMessage(phone, replyJid, combined, meta, controller, media);
    } catch (err) {
      console.error(`[whatsapp-bridge] task failed for ${debounceKey}:`, err);
    } finally {
      this.processing.delete(debounceKey);
      this.activeAbort.delete(debounceKey);
    }

    // Check if more messages arrived during processing
    const next = this.pendingTexts.get(debounceKey);
    if (next && (next.texts.length > 0 || next.media.length > 0)) {
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
    mediaItems?: MediaAttachment[],
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
    let envelopeText = text;
    if (meta) {
      const envelope = formatMessageEnvelope(meta);
      envelopeText = `<message-context>\n${envelope}\n</message-context>\n${text}`;
    }

    // Save media to workspace and build text-only content
    let content = envelopeText;
    const hasMedia = mediaItems && mediaItems.length > 0;

    if (hasMedia) {
      for (const attachment of mediaItems) {
        if (attachment.type === 'audio' && attachment.isVoiceNote) {
          console.log('[whatsapp-bridge] voice note received — transcription stub');
          content += '\n[Voice message received — transcription not yet available]';
          continue;
        }
        const savedPath = await this.saveMediaToWorkspace(attachment, threadId);
        if (savedPath) {
          const parts = [attachment.type, attachment.mimeType];
          if (attachment.fileName) parts.push(attachment.fileName);
          if (attachment.fileSize) parts.push(`${Math.round(attachment.fileSize / 1024)} KB`);
          content += `\n[Attachment: ${parts.join(', ')} saved to ${savedPath}]`;
        } else {
          content += `\n[Media: ${attachment.type} — download failed]`;
        }
      }
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

      console.log(`[whatsapp-bridge] processing message from ${phone}: "${text.slice(0, 80)}..."${hasMedia ? ` (+ ${mediaItems.length} media)` : ''}`);

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

  /** Get or create the workspace filesystem for saving media. */
  private async getWorkspaceFs(): Promise<LocalFilesystem> {
    if (!this.workspaceFs) {
      const base = process.env.WORKSPACE_PATH || path.resolve('./workspaces');
      const agentId = process.env.AGENT_ID || 'coworker';
      this.workspaceFs = new LocalFilesystem({ basePath: path.join(base, agentId) });
      await this.workspaceFs.init();
    }
    return this.workspaceFs;
  }

  /** Save a media attachment to the workspace and return the virtual path, or null on failure. */
  private async saveMediaToWorkspace(
    attachment: MediaAttachment,
    threadId: string,
  ): Promise<string | null> {
    try {
      const buffer = await downloadMedia(attachment);
      const shortId = crypto.randomBytes(4).toString('hex');
      // Sanitize fileName to prevent path traversal
      const safeName = attachment.fileName
        ? path.basename(attachment.fileName).replace(/[^a-zA-Z0-9._-]/g, '_')
        : null;
      const name = safeName
        || `${attachment.type}-${Date.now()}-${shortId}.${TYPE_EXT[attachment.type] || 'bin'}`;
      const filePath = `whatsapp-attachments/${threadId}/${name}`;

      const fs = await this.getWorkspaceFs();
      await fs.writeFile(filePath, buffer, { recursive: true });

      return `/workspace/${filePath}`;
    } catch (err) {
      console.warn(`[whatsapp-bridge] media save failed: ${err}`);
      return null;
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
