import type { WAMessage } from '@whiskeysockets/baileys';

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
