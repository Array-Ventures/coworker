import crypto from 'node:crypto';
import path from 'node:path';
import type { Mastra } from '@mastra/core/mastra';
import { LocalFilesystem } from '@mastra/core/workspace';
import { isJidGroup, type WAMessage } from '@whiskeysockets/baileys';
import type { WhatsAppSocket } from './whatsapp-session';
import type { SendOpts } from '../messaging/router';
import { harnessPool } from '../harness/pool';
import { harnessStorage, type CoworkerHarness } from '../harness';
import { sendAndCapture, sendAndCaptureInteractive } from '../harness/utils';
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
  wrapObserveMode,
  type GroupMode,
  type MessageMetadata,
  type MediaAttachment,
} from './whatsapp-utils';
import { WhatsAppStore, whatsappStore as defaultStore } from './whatsapp-store';

// Default extensions by media type -- used when Baileys doesn't provide a fileName
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
  private store: WhatsAppStore;
  private sentTracker = new SentMessageTracker();
  private handler: ((arg: { messages: WAMessage[] }) => Promise<void>) | null = null;

  // Debounce + abort state (replaces old messageQueue)
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingTexts = new Map<string, { phone: string; texts: string[]; media: MediaAttachment[]; replyJid: string; observeOnly?: boolean }>();
  private activeAbort = new Map<string, AbortController>();
  private processing = new Set<string>();

  // Group metadata cache
  private groupMetaCache = new Map<string, GroupMeta>();

  // Lazy workspace filesystem for saving media
  private workspaceFs: LocalFilesystem | null = null;

  // Per-message metadata for envelope building (keyed by debounce key)
  private pendingMeta = new Map<string, MessageMetadata>();

  // Conversation key → pool threadId (so we can find existing harnesses)
  private threadMap = new Map<string, string>();

  // Per-key lock to prevent duplicate thread creation from concurrent messages
  private threadLocks = new Map<string, Promise<any>>();

  // Pending interactive answers: threadKey → resolver (for ask_user/plan_approval forwarded to WhatsApp)
  private pendingAnswers = new Map<string, { resolve: (text: string) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(mastra: Mastra, socket: WhatsAppSocket, store?: WhatsAppStore) {
    this.mastra = mastra;
    this.socket = socket;
    this.store = store ?? defaultStore;
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
    this.threadMap.clear();
    this.threadLocks.clear();
    // Clear pending interactive answers
    for (const { timer } of this.pendingAnswers.values()) clearTimeout(timer);
    this.pendingAnswers.clear();
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
        lastMsgId = sent?.key?.id ?? undefined;
      }
    }

    // Send text if present
    if (text?.trim()) {
      const chunks = chunkText(text, MAX_WHATSAPP_TEXT_LENGTH);
      for (const chunk of chunks) {
        const sent = await this.socket.sendMessage(to, { text: chunk });
        this.sentTracker.record(sent?.key?.id);
        lastMsgId = sent?.key?.id ?? undefined;
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

    // Check if this is a reply to a pending interactive question (ask_user / plan_approval)
    const pendingThreadKey = isGroup
      ? `whatsapp-group-${remoteJid}`
      : `whatsapp-${normalizeWhatsAppId(remoteJid)}`;
    if (this.pendingAnswers.has(pendingThreadKey)) {
      const { resolve, timer } = this.pendingAnswers.get(pendingThreadKey)!;
      clearTimeout(timer);
      this.pendingAnswers.delete(pendingThreadKey);
      resolve(displayText);
      return; // Don't process as new message — this is an answer
    }

    if (isGroup) {
      // Group message flow
      const groupConfig = await this.getGroupConfig(remoteJid);
      if (!groupConfig.allowed) {
        console.log(`[whatsapp-bridge] group not configured — ignoring message from ${remoteJid} (add via Settings > WhatsApp > Groups)`);
        return;
      }

      const participant = msg.key.participant as string | undefined;
      if (!participant) return;

      const phone = normalizeWhatsAppId(participant);
      const debounceKey = `${remoteJid}:${participant}`;
      const botUser = (this.socket as any).user;
      const botLid = botUser?.lid || await this.store.getConfig('bot_lid') || undefined;
      const mentioned = isBotMentioned(msg, botUser?.id ?? '', botLid);
      const quotedText = getQuotedText(msg);
      const groupMeta = await this.getGroupMeta(remoteJid);

      // Determine whether to respond based on group mode
      const shouldRespond = groupConfig.mode === 'all'
        || (groupConfig.mode === 'mentions' && mentioned);
      const observeOnly = !shouldRespond;

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

      console.log(`[whatsapp-bridge] group msg from ${phone} in ${groupMeta.name} (mode=${groupConfig.mode}, mentioned=${mentioned}, observe=${observeOnly}${media ? `, media=${media.type}` : ''})`);

      this.bufferMessage(debounceKey, phone, displayText, remoteJid, meta, mentioned, media || undefined, observeOnly);
    } else {
      // DM flow
      const phone = normalizeWhatsAppId(remoteJid);
      console.log(`[whatsapp-bridge] incoming from raw JID: ${remoteJid} → normalized: ${phone}${media ? ` [media: ${media.type}]` : ''}`);

      const allowed = await this.isAllowed(remoteJid, phone);
      if (!allowed) {
        if (displayText.trim().toLowerCase() === '/pair') {
          console.log(`[whatsapp-bridge] /pair command from ${phone} — sending pairing code`);
          try {
            await this.sendPairingCode(remoteJid);
          } catch (err) {
            console.error('[whatsapp-bridge] sendPairingCode failed:', err);
          }
        } else {
          console.log(`[whatsapp-bridge] not in allowlist — ignoring ${phone} (send /pair to connect)`);
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
    observeOnly?: boolean,
  ): void {
    // Accumulate text and media
    const pending = this.pendingTexts.get(debounceKey) ?? { phone, texts: [], media: [], replyJid };
    if (text) pending.texts.push(text);
    if (media) pending.media.push(media);
    // observeOnly: false (respond) wins over true (observe) when messages merge
    if (observeOnly === false) pending.observeOnly = false;
    else if (pending.observeOnly === undefined) pending.observeOnly = observeOnly;
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

    const { phone, texts, media, replyJid, observeOnly } = pending;
    const meta = this.pendingMeta.get(debounceKey);
    this.pendingTexts.delete(debounceKey);
    this.pendingMeta.delete(debounceKey);

    const combined = texts.join('\n');
    this.processing.add(debounceKey);

    // Register AbortController immediately so new messages can abort us
    const controller = new AbortController();
    this.activeAbort.set(debounceKey, controller);

    try {
      await this.processMessage(phone, replyJid, combined, meta, controller, media, observeOnly);
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
    const existing = this.store.findActivePairing(remoteJid);

    let code: string;
    if (existing) {
      code = existing.code;
    } else {
      // Clean up any expired entries for this JID
      this.store.cleanExpiredPairings(remoteJid);

      code = generatePairingCode();
      this.store.createPairing(code, remoteJid, new Date(Date.now() + PAIRING_TTL_MS));
    }

    console.log(`[whatsapp-bridge] sent pairing code ${code} for JID ${remoteJid}`);

    const message = `To pair with Coworker, enter this code in the app:\n\n*${code}*\n\nThis code expires in 1 hour.`;
    const sent = await this.socket.sendMessage(remoteJid, { text: message });
    this.sentTracker.record(sent?.key?.id);
  }

  /**
   * Get or create a harness instance for a given conversation key.
   * Uses a per-key lock to prevent duplicate thread creation from concurrent messages.
   */
  private async getOrCreateHarness(key: string, title: string): Promise<CoworkerHarness> {
    const pending = this.threadLocks.get(key);
    if (pending) {
      await pending;
      return this.getOrCreateHarness(key, title);
    }
    const promise = this._getOrCreateHarness(key, title);
    this.threadLocks.set(key, promise);
    try {
      return await promise;
    } finally {
      this.threadLocks.delete(key);
    }
  }

  private async _getOrCreateHarness(key: string, title: string) {
    // Fast path: check in-memory map (works within a single server lifetime)
    const cachedThreadId = this.threadMap.get(key);
    if (cachedThreadId) {
      const entry = harnessPool.get(cachedThreadId);
      if (entry) {
        harnessPool.touch(cachedThreadId);
        return entry.harness;
      }
      // Pool swept the entry — remove stale mapping
      this.threadMap.delete(key);
    }

    // Slow path: query Postgres for an existing thread with this conversation key
    const existingThreadId = await this.findThreadByConversationKey(key);
    if (existingThreadId) {
      const entry = await harnessPool.getOrCreate(existingThreadId, 'whatsapp');
      this.threadMap.set(key, existingThreadId);
      return entry.harness;
    }

    // No existing thread — create a new one
    const { threadId, entry } = await harnessPool.createThread(title, 'whatsapp');
    this.threadMap.set(key, threadId);
    await entry.harness.setThreadSetting({ key: 'channel', value: 'whatsapp' });
    await entry.harness.setThreadSetting({ key: 'waConversationKey', value: key });
    return entry.harness;
  }

  /** Query the memory store directly for a thread with matching waConversationKey metadata.
   *  We bypass Harness.listThreads() because it strips the metadata filter (framework bug).
   *  PostgresStore itself has no listThreads — it's on the memory store via getStore('memory'). */
  private async findThreadByConversationKey(key: string): Promise<string | null> {
    try {
      const memoryStore = await harnessStorage.getStore('memory');
      if (!memoryStore) return null;
      const result = await memoryStore.listThreads({
        filter: {
          resourceId: 'coworker',
          metadata: { waConversationKey: key },
        },
        perPage: 1,
        orderBy: { field: 'updatedAt', direction: 'DESC' },
      });
      const threads = (result as any)?.threads ?? [];
      if (threads.length > 0) {
        return threads[0].id;
      }
      return null;
    } catch (err) {
      console.warn('[whatsapp-bridge] thread lookup failed, will create new:', err);
      return null;
    }
  }

  /** Park a Promise waiting for the user's next WhatsApp reply on this thread.
   *  Resolves when handleMessage() intercepts the reply; rejects on timeout. */
  private waitForReply(threadKey: string, timeoutMs = 120_000): Promise<string> {
    // Cancel any existing pending answer for this thread
    const existing = this.pendingAnswers.get(threadKey);
    if (existing) { clearTimeout(existing.timer); }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAnswers.delete(threadKey);
        reject(new Error('Reply timeout'));
      }, timeoutMs);
      this.pendingAnswers.set(threadKey, { resolve, timer });
    });
  }

  private async processMessage(
    phone: string,
    replyJid: string,
    text: string,
    meta?: MessageMetadata,
    controller?: AbortController,
    mediaItems?: MediaAttachment[],
    observeOnly?: boolean,
  ): Promise<void> {
    const isGroup = meta?.type === 'group';
    const threadKey = isGroup
      ? `whatsapp-group-${meta!.groupJid}`
      : `whatsapp-${phone}`;

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
        const savedPath = await this.saveMediaToWorkspace(attachment, threadKey);
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

    // Wrap content with observe envelope when in observe-only mode
    if (observeOnly && isGroup && meta?.groupJid) {
      content = wrapObserveMode(content, meta.groupJid);
    }

    const threadTitle = isGroup
      ? `WhatsApp Group: ${meta!.groupName}`
      : `WhatsApp: ${phone}`;

    // Get or create a harness for this conversation
    const harness = await this.getOrCreateHarness(threadKey, threadTitle);

    // Use provided controller for abort signalling (debounce + timeout)
    if (!controller) controller = new AbortController();
    const timeout = setTimeout(() => {
      console.warn(`[whatsapp-bridge] agent timed out for ${phone} after ${AGENT_TIMEOUT_MS / 1000}s`);
      harness.abort();
      controller.abort();
    }, AGENT_TIMEOUT_MS);

    // Wire external abort (debounce cancellation) to harness abort
    controller.signal.addEventListener('abort', () => harness.abort(), { once: true });

    // Also clear any pending answer when aborted (prevents leaked promises)
    controller.signal.addEventListener('abort', () => {
      const pending = this.pendingAnswers.get(threadKey);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingAnswers.delete(threadKey);
      }
    }, { once: true });

    try {
      // Show typing indicator only when we'll actually respond
      if (!observeOnly) {
        this.socket.sendPresenceUpdate('composing', replyJid).catch(() => {});
      }

      console.log(`[whatsapp-bridge] processing message from ${phone}: "${text.slice(0, 80)}..."${hasMedia ? ` (+ ${mediaItems.length} media)` : ''}${observeOnly ? ' [observe]' : ''}`);

      // Use interactive capture for non-observe runs to handle ask_user, tool_approval, plan_approval
      // Look up pool threadId for clearing pending states (keeps Electron UI in sync)
      const poolThreadId = this.threadMap.get(threadKey);

      const replyText = observeOnly
        ? await sendAndCapture(poolThreadId!, content)
        : await sendAndCaptureInteractive(poolThreadId!, content, {
            onQuestion: async ({ question, options }) => {
              let msg = question;
              if (options?.length) {
                msg += '\n\n' + options.map((o, i) => `${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ''}`).join('\n');
                msg += '\n\n_Reply with a number or type your answer._';
              }
              const sent = await this.socket.sendMessage(replyJid, { text: msg });
              this.sentTracker.record(sent?.key?.id);
              const reply = await this.waitForReply(threadKey, 120_000);
              // Clear pool pending state so Electron UI dismisses the card
              if (poolThreadId) harnessPool.clearQuestion(poolThreadId);
              // Resolve numbered option → label
              if (options?.length) {
                const num = parseInt(reply.trim(), 10);
                if (num >= 1 && num <= options.length) return options[num - 1].label;
              }
              return reply;
            },
            onPlanApproval: async ({ planId, title, plan }) => {
              const sent = await this.socket.sendMessage(replyJid, { text: `Plan: ${title}\n\nApprove? Reply *yes* or *no*.` });
              this.sentTracker.record(sent?.key?.id);
              let response: { action: 'approved' | 'rejected'; feedback?: string } = { action: 'approved' };
              try {
                const reply = await this.waitForReply(threadKey, 120_000);
                const lower = reply.trim().toLowerCase();
                if (lower === 'no' || lower === 'n' || lower === 'reject') {
                  response = { action: 'rejected', feedback: reply };
                }
              } catch { /* timeout → auto-approve */ }
              // Mirror Electron REST route: store activePlan before respondToPlanApproval
              if (response.action === 'approved') {
                await harness.setState({
                  activePlan: { title, plan, approvedAt: new Date().toISOString() },
                } as any);
              }
              // Clear pool pending state so Electron UI dismisses the card
              if (poolThreadId) harnessPool.clearPlanApproval(poolThreadId);
              return response;
            },
          });

      // If aborted (new message arrived), skip sending reply
      if (controller.signal.aborted) return;

      // Observe mode: agent processed for memory, suppress response delivery
      if (observeOnly) {
        console.log(`[whatsapp-bridge] observe mode — processed for memory, response suppressed`);
        return;
      }

      const reply = replyText?.trim();
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
      // Clear typing indicator only if we set it
      if (!observeOnly) {
        this.socket.sendPresenceUpdate('paused', replyJid).catch(() => {});
      }
    }
  }

  /** Get or create the workspace filesystem for saving media. */
  private async getWorkspaceFs(): Promise<LocalFilesystem> {
    if (!this.workspaceFs) {
      const { WORKSPACE_PATH } = await import('../config/paths');
      this.workspaceFs = new LocalFilesystem({ basePath: WORKSPACE_PATH });
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

      return `/${filePath}`;
    } catch (err) {
      console.warn(`[whatsapp-bridge] media save failed: ${err}`);
      return null;
    }
  }

  /** Check allowlist by raw JID or normalized phone number. */
  private async isAllowed(rawJid: string, phone: string): Promise<boolean> {
    try {
      return this.store.isAllowed(rawJid, phone);
    } catch (err) {
      console.error('[whatsapp-bridge] allowlist check failed:', err);
      return false; // fail-closed: reject on error
    }
  }

  /** Get group config: whether allowed and what mode. */
  private async getGroupConfig(groupJid: string): Promise<{ allowed: boolean; mode: GroupMode }> {
    try {
      return this.store.getGroupConfig(groupJid);
    } catch {
      return { allowed: false, mode: 'mentions' as GroupMode };
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
