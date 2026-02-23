import {
  extractMessageContent,
  downloadContentFromMessage,
} from '@whiskeysockets/baileys';
import type { WAMessage, proto } from '@whiskeysockets/baileys';
import type { MediaType } from '@whiskeysockets/baileys';

export const MAX_WHATSAPP_TEXT_LENGTH = 3800;
const SENT_MESSAGE_TTL_MS = 10 * 60_000;
const MAX_MEDIA_SIZE = 20 * 1024 * 1024; // 20 MB

/**
 * Convert a phone number ("+1234567890", "1234567890") to a WhatsApp JID.
 * Already-formed JIDs (containing '@') are returned as-is.
 */
export function toWhatsAppJid(value: string): string {
  if (value.includes('@')) return value;
  return value.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
}

/**
 * Normalize a WhatsApp JID or raw phone string to "+{digits}" format.
 * Group JIDs (ending in @g.us) are returned as-is.
 */
export function normalizeWhatsAppId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed.endsWith('@g.us')) return trimmed;
  // Strip any @suffix (@s.whatsapp.net, @lid, etc.) and device-id colon portion
  const base = trimmed.replace(/@.*$/, '').replace(/:.*$/, '');
  if (base.startsWith('+')) return base;
  if (/^\d+$/.test(base)) return `+${base}`;
  return base;
}

/**
 * Unwrap view-once, ephemeral, and edited message wrappers using Baileys' extractMessageContent.
 */
function unwrapMessageContent(msg: WAMessage) {
  return extractMessageContent(msg.message);
}

/**
 * Extract text content from a WhatsApp message.
 * Handles plain text, extended text, media captions, and locations.
 * Unwraps view-once/ephemeral wrappers first.
 */
export function extractText(message: WAMessage): string {
  const content = unwrapMessageContent(message);
  if (!content) return '';

  // Text messages
  const text =
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    '';
  if (text) return text;

  // Location as text
  const loc = content.locationMessage;
  if (loc) {
    const parts = [`[Location: ${loc.degreesLatitude}, ${loc.degreesLongitude}`];
    if (loc.name) parts[0] += ` — ${loc.name}`;
    return parts[0] + ']';
  }

  return '';
}

/**
 * Split text into chunks that fit within WhatsApp's character limit.
 * Splits on newline boundaries when possible.
 */
export function chunkText(input: string, limit: number): string[] {
  if (input.length <= limit) return [input];
  const chunks: string[] = [];
  let current = '';

  for (const line of input.split(/\n/)) {
    if ((current + line).length + 1 > limit) {
      if (current) chunks.push(current.trimEnd());
      current = '';
    }
    if (line.length > limit) {
      for (let i = 0; i < line.length; i += limit) {
        const slice = line.slice(i, i + limit);
        if (slice.length) chunks.push(slice);
      }
      continue;
    }
    current += current ? `\n${line}` : line;
  }

  if (current.trim().length) chunks.push(current.trimEnd());
  return chunks.length ? chunks : [input];
}

/**
 * Tracks sent message IDs to avoid processing our own outbound messages
 * when they echo back via the messages.upsert event.
 */
export class SentMessageTracker {
  private ids = new Map<string, number>();

  record(messageId: string | null | undefined): void {
    if (!messageId) return;
    this.ids.set(messageId, Date.now());
  }

  has(messageId: string): boolean {
    return this.ids.has(messageId);
  }

  consume(messageId: string): boolean {
    return this.ids.delete(messageId);
  }

  prune(): void {
    const now = Date.now();
    for (const [id, timestamp] of this.ids) {
      if (now - timestamp > SENT_MESSAGE_TTL_MS) {
        this.ids.delete(id);
      }
    }
  }
}

/**
 * Extract contextInfo from any message type that may carry it.
 * Unwraps view-once/ephemeral wrappers first.
 */
export function getContextInfo(msg: WAMessage) {
  const content = unwrapMessageContent(msg);
  if (!content) return undefined;
  return (
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    content.documentMessage?.contextInfo ??
    content.audioMessage?.contextInfo ??
    content.stickerMessage?.contextInfo ??
    content.locationMessage?.contextInfo ??
    (content as any).contactMessage?.contextInfo ??
    (content as any).contactsArrayMessage?.contextInfo
  );
}

/**
 * Check if the bot is mentioned in the message's contextInfo.mentionedJid.
 * Compares by number part only (strips :device suffix and @domain).
 * Accepts an optional botLid for matching LID-format mentions (@lid JIDs).
 */
export function isBotMentioned(msg: WAMessage, botJid: string, botLid?: string): boolean {
  const ctx = getContextInfo(msg);
  if (!ctx?.mentionedJid?.length) return false;
  const botNumbers = new Set<string>();
  botNumbers.add(botJid.split(':')[0].split('@')[0]);
  if (botLid) botNumbers.add(botLid.split(':')[0].split('@')[0]);
  return ctx.mentionedJid.some(
    (jid: string) => botNumbers.has(jid.split(':')[0].split('@')[0]),
  );
}

/**
 * Extract the text of a quoted (replied-to) message, if any.
 */
export function getQuotedText(msg: WAMessage): string | undefined {
  const quoted = getContextInfo(msg)?.quotedMessage;
  if (!quoted) return undefined;
  return quoted.conversation || quoted.extendedTextMessage?.text || undefined;
}

/** Escape a string for use in an XML attribute value (double-quoted). */
function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape a string for use as XML text content. */
function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface MediaAttachment {
  type: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  mimeType: string;
  caption?: string;
  fileName?: string;
  fileSize?: number;
  isVoiceNote?: boolean;
  seconds?: number;
  width?: number;
  height?: number;
  /** Baileys download fields (passed to downloadContentFromMessage) */
  mediaKey?: Uint8Array | null;
  directPath?: string | null;
  url?: string | null;
}

export interface MessageMetadata {
  channel: string;
  type: 'dm' | 'group';
  senderJid: string;
  senderName?: string;
  timestamp: number;
  groupName?: string;
  groupJid?: string;
  isMentioned?: boolean;
  quotedText?: string;
  media?: MediaAttachment;
}

/**
 * Extract media metadata from a WhatsApp message. Does NOT download — just describes what media is present.
 * Unwraps view-once/ephemeral wrappers first.
 */
export function extractMedia(msg: WAMessage): MediaAttachment | null {
  const content = unwrapMessageContent(msg);
  if (!content) return null;

  if (content.imageMessage) {
    const m = content.imageMessage;
    return {
      type: 'image',
      mimeType: m.mimetype || 'image/jpeg',
      caption: m.caption || undefined,
      fileSize: typeof m.fileLength === 'number' ? m.fileLength : Number(m.fileLength) || undefined,
      width: m.width || undefined,
      height: m.height || undefined,
      mediaKey: m.mediaKey || null,
      directPath: m.directPath || null,
      url: m.url || null,
    };
  }

  if (content.videoMessage) {
    const m = content.videoMessage;
    return {
      type: 'video',
      mimeType: m.mimetype || 'video/mp4',
      caption: m.caption || undefined,
      fileSize: typeof m.fileLength === 'number' ? m.fileLength : Number(m.fileLength) || undefined,
      seconds: m.seconds || undefined,
      width: m.width || undefined,
      height: m.height || undefined,
      mediaKey: m.mediaKey || null,
      directPath: m.directPath || null,
      url: m.url || null,
    };
  }

  if (content.audioMessage) {
    const m = content.audioMessage;
    return {
      type: 'audio',
      mimeType: m.mimetype || 'audio/ogg',
      fileSize: typeof m.fileLength === 'number' ? m.fileLength : Number(m.fileLength) || undefined,
      isVoiceNote: m.ptt === true,
      seconds: m.seconds || undefined,
      mediaKey: m.mediaKey || null,
      directPath: m.directPath || null,
      url: m.url || null,
    };
  }

  if (content.documentMessage) {
    const m = content.documentMessage;
    return {
      type: 'document',
      mimeType: m.mimetype || 'application/octet-stream',
      caption: m.caption || undefined,
      fileName: m.fileName || undefined,
      fileSize: typeof m.fileLength === 'number' ? m.fileLength : Number(m.fileLength) || undefined,
      mediaKey: m.mediaKey || null,
      directPath: m.directPath || null,
      url: m.url || null,
    };
  }

  if (content.stickerMessage) {
    const m = content.stickerMessage;
    return {
      type: 'sticker',
      mimeType: m.mimetype || 'image/webp',
      fileSize: typeof m.fileLength === 'number' ? m.fileLength : Number(m.fileLength) || undefined,
      width: m.width || undefined,
      height: m.height || undefined,
      mediaKey: m.mediaKey || null,
      directPath: m.directPath || null,
      url: m.url || null,
    };
  }

  return null;
}

/** Map our attachment type to Baileys MediaType for download */
const MEDIA_TYPE_MAP: Record<MediaAttachment['type'], MediaType> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'document',
  sticker: 'sticker',
};

/**
 * Download media bytes using Baileys' downloadContentFromMessage().
 * Returns a Buffer with size limit enforcement.
 */
export async function downloadMedia(
  attachment: MediaAttachment,
  maxBytes: number = MAX_MEDIA_SIZE,
): Promise<Buffer> {
  const stream = await downloadContentFromMessage(
    {
      mediaKey: attachment.mediaKey,
      directPath: attachment.directPath,
      url: attachment.url,
    } as any,
    MEDIA_TYPE_MAP[attachment.type],
  );

  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of stream) {
    totalSize += chunk.length;
    if (totalSize > maxBytes) {
      stream.destroy();
      throw new Error(`Media exceeds size limit (${maxBytes} bytes)`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Describe non-text, non-media message types (contacts, locations, reactions)
 * that should be acknowledged but don't produce downloadable media.
 */
export function describeNonTextMessage(msg: WAMessage): string | null {
  const content = unwrapMessageContent(msg);
  if (!content) return null;

  // Location
  const loc = content.locationMessage;
  if (loc) {
    const desc = loc.name ? ` — ${loc.name}` : '';
    return `[Location: ${loc.degreesLatitude}, ${loc.degreesLongitude}${desc}]`;
  }

  // Single contact
  const contact = (content as any).contactMessage;
  if (contact) {
    return `[Contact: ${contact.displayName || 'Unknown'}]`;
  }

  // Contacts array
  const contacts = (content as any).contactsArrayMessage;
  if (contacts?.contacts?.length) {
    const names = contacts.contacts.map((c: any) => c.displayName || 'Unknown').join(', ');
    return `[Contacts: ${names}]`;
  }

  return null;
}

/**
 * Build an XML envelope string from message metadata.
 */
export function formatMessageEnvelope(meta: MessageMetadata): string {
  const lines: string[] = ['<context>'];
  lines.push(`  <channel>${meta.channel}</channel>`);
  lines.push(`  <type>${meta.type}</type>`);
  if (meta.senderName) {
    lines.push(`  <sender name="${escapeXmlAttr(meta.senderName)}" jid="${escapeXmlAttr(meta.senderJid)}" />`);
  } else {
    lines.push(`  <sender jid="${escapeXmlAttr(meta.senderJid)}" />`);
  }
  lines.push(`  <timestamp>${meta.timestamp}</timestamp>`);
  if (meta.type === 'group') {
    if (meta.groupName || meta.groupJid) {
      lines.push(`  <group name="${escapeXmlAttr(meta.groupName ?? '')}" jid="${escapeXmlAttr(meta.groupJid ?? '')}" />`);
    }
    if (meta.isMentioned) {
      lines.push(`  <mentioned>true</mentioned>`);
    }
  }
  if (meta.quotedText) {
    lines.push(`  <quoted>${escapeXmlText(meta.quotedText)}</quoted>`);
  }
  if (meta.media) {
    const attrs = [`type="${escapeXmlAttr(meta.media.type)}"`, `mimeType="${escapeXmlAttr(meta.media.mimeType)}"`];
    if (meta.media.fileSize) attrs.push(`size="${meta.media.fileSize}"`);
    if (meta.media.fileName) attrs.push(`fileName="${escapeXmlAttr(meta.media.fileName)}"`);
    lines.push(`  <attachment ${attrs.join(' ')} />`);
  }
  lines.push('</context>');
  return lines.join('\n');
}

/**
 * Valid group response modes.
 * - 'all': respond to every message
 * - 'mentions': respond only when @mentioned, observe otherwise
 * - 'observe': never auto-respond, only build context
 */
export type GroupMode = 'all' | 'mentions' | 'observe';

/**
 * Wrap message content with an observe-mode envelope telling the agent
 * its response will NOT be delivered to the group.
 */
export function wrapObserveMode(content: string, groupJid: string): string {
  return `<observe-mode>
[OBSERVATION ONLY] Your response will NOT be sent to the group.
To proactively message this group, use the msg CLI:
  msg send --channel whatsapp --to "${groupJid}" "your message"
</observe-mode>
${content}`;
}

/**
 * Check if text contains the <no-reply/> directive.
 */
export function containsNoReply(text: string): boolean {
  return text.includes('<no-reply/>');
}

/**
 * Remove directive tags and trim whitespace.
 */
export function stripDirectives(text: string): string {
  return text.replace(/<no-reply\/>/g, '').trim();
}
