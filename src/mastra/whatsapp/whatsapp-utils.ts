import type { WAMessage, proto } from '@whiskeysockets/baileys';

export const MAX_WHATSAPP_TEXT_LENGTH = 3800;
const SENT_MESSAGE_TTL_MS = 10 * 60_000;

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
 * Extract text content from a WhatsApp message.
 * Handles plain text, extended text, and media captions.
 */
export function extractText(message: WAMessage): string {
  const content = message.message;
  if (!content) return '';
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ''
  );
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
 */
export function getContextInfo(msg: WAMessage) {
  return (
    msg.message?.extendedTextMessage?.contextInfo ??
    msg.message?.imageMessage?.contextInfo ??
    msg.message?.videoMessage?.contextInfo ??
    msg.message?.documentMessage?.contextInfo
  );
}

/**
 * Check if the bot is mentioned in the message's contextInfo.mentionedJid.
 * Compares by number part only (strips :device suffix and @domain).
 */
export function isBotMentioned(msg: WAMessage, botJid: string): boolean {
  const ctx = getContextInfo(msg);
  if (!ctx?.mentionedJid?.length) return false;
  const botNumber = botJid.split(':')[0].split('@')[0];
  return ctx.mentionedJid.some(
    (jid: string) => jid.split(':')[0].split('@')[0] === botNumber,
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
  lines.push('</context>');
  return lines.join('\n');
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
