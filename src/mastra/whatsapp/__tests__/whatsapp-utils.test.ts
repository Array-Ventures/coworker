import { describe, expect, test, beforeEach } from 'bun:test';
import {
  normalizeWhatsAppId,
  extractText,
  chunkText,
  SentMessageTracker,
  MAX_WHATSAPP_TEXT_LENGTH,
} from '../whatsapp-utils';
import type { WAMessage } from '@whiskeysockets/baileys';

// ── normalizeWhatsAppId ──

describe('normalizeWhatsAppId', () => {
  test('standard JID → +digits', () => {
    expect(normalizeWhatsAppId('1234567890@s.whatsapp.net')).toBe('+1234567890');
  });

  test('device JID strips device portion', () => {
    expect(normalizeWhatsAppId('1234567890:5@s.whatsapp.net')).toBe('+1234567890');
  });

  test('LID JID', () => {
    expect(normalizeWhatsAppId('54941422981120@lid')).toBe('+54941422981120');
  });

  test('raw digits get + prefix', () => {
    expect(normalizeWhatsAppId('1234567890')).toBe('+1234567890');
  });

  test('already has + prefix', () => {
    expect(normalizeWhatsAppId('+1234567890')).toBe('+1234567890');
  });

  test('+ prefix with @suffix', () => {
    expect(normalizeWhatsAppId('+1234567890@s.whatsapp.net')).toBe('+1234567890');
  });

  test('group JID preserved as-is', () => {
    expect(normalizeWhatsAppId('123456789-987654321@g.us')).toBe('123456789-987654321@g.us');
  });

  test('empty string returns empty', () => {
    expect(normalizeWhatsAppId('')).toBe('');
  });

  test('whitespace trimmed', () => {
    expect(normalizeWhatsAppId('  1234567890@s.whatsapp.net  ')).toBe('+1234567890');
  });
});

// ── extractText ──

describe('extractText', () => {
  function makeMsg(message: any): WAMessage {
    return { key: { id: 'test', remoteJid: 'test@s.whatsapp.net' }, message } as WAMessage;
  }

  test('plain conversation', () => {
    expect(extractText(makeMsg({ conversation: 'hello' }))).toBe('hello');
  });

  test('extended text message', () => {
    expect(extractText(makeMsg({ extendedTextMessage: { text: 'extended' } }))).toBe('extended');
  });

  test('image caption', () => {
    expect(extractText(makeMsg({ imageMessage: { caption: 'photo caption' } }))).toBe('photo caption');
  });

  test('video caption', () => {
    expect(extractText(makeMsg({ videoMessage: { caption: 'video caption' } }))).toBe('video caption');
  });

  test('document caption', () => {
    expect(extractText(makeMsg({ documentMessage: { caption: 'doc caption' } }))).toBe('doc caption');
  });

  test('no content returns empty', () => {
    expect(extractText(makeMsg(null))).toBe('');
  });

  test('empty message object returns empty', () => {
    expect(extractText(makeMsg({}))).toBe('');
  });

  test('priority: conversation wins over extended', () => {
    expect(extractText(makeMsg({ conversation: 'first', extendedTextMessage: { text: 'second' } }))).toBe('first');
  });
});

// ── chunkText ──

describe('chunkText', () => {
  test('short text returns single chunk', () => {
    expect(chunkText('hello', 100)).toEqual(['hello']);
  });

  test('exact limit returns single chunk', () => {
    const text = 'a'.repeat(100);
    expect(chunkText(text, 100)).toEqual([text]);
  });

  test('splits on newline boundaries', () => {
    const text = 'line1\nline2\nline3';
    const chunks = chunkText(text, 12);
    // 'line1\nline2' = 11 chars fits, 'line1\nline2\n' + 'line3' = 17 > 12
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.join('\n')).toBe(text);
  });

  test('hard-splits lines longer than limit', () => {
    const longLine = 'a'.repeat(25);
    const chunks = chunkText(longLine, 10);
    expect(chunks).toEqual(['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)]);
  });

  test('real-world limit keeps all content', () => {
    const text = 'word '.repeat(1000); // ~5000 chars
    const chunks = chunkText(text, MAX_WHATSAPP_TEXT_LENGTH);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_WHATSAPP_TEXT_LENGTH);
    }
    // All words present across chunks
    const allContent = chunks.join(' ');
    expect(allContent).toContain('word');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  test('empty string', () => {
    expect(chunkText('', 100)).toEqual(['']);
  });
});

// ── SentMessageTracker ──

describe('SentMessageTracker', () => {
  let tracker: SentMessageTracker;

  beforeEach(() => {
    tracker = new SentMessageTracker();
  });

  test('record and has', () => {
    tracker.record('msg-1');
    expect(tracker.has('msg-1')).toBe(true);
    expect(tracker.has('msg-2')).toBe(false);
  });

  test('record null/undefined is no-op', () => {
    tracker.record(null);
    tracker.record(undefined);
    expect(tracker.has('null')).toBe(false);
  });

  test('consume removes and returns true', () => {
    tracker.record('msg-1');
    expect(tracker.consume('msg-1')).toBe(true);
    expect(tracker.has('msg-1')).toBe(false);
  });

  test('consume non-existent returns false', () => {
    expect(tracker.consume('nope')).toBe(false);
  });

  test('prune removes old entries', () => {
    // Manually set an old timestamp
    tracker.record('old-msg');
    // Access internal map to backdate the timestamp
    (tracker as any).ids.set('old-msg', Date.now() - 11 * 60_000); // 11 min ago (TTL is 10 min)
    tracker.record('new-msg');

    tracker.prune();
    expect(tracker.has('old-msg')).toBe(false);
    expect(tracker.has('new-msg')).toBe(true);
  });
});
