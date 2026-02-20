import { describe, expect, test, beforeEach } from 'bun:test';
import {
  normalizeWhatsAppId,
  extractText,
  chunkText,
  SentMessageTracker,
  MAX_WHATSAPP_TEXT_LENGTH,
  isBotMentioned,
  getContextInfo,
  getQuotedText,
  formatMessageEnvelope,
  containsNoReply,
  stripDirectives,
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

// ── isBotMentioned ──

describe('isBotMentioned', () => {
  function makeMsg(message: any): WAMessage {
    return { key: { id: 'test', remoteJid: 'test@s.whatsapp.net' }, message } as WAMessage;
  }

  test('returns true when bot JID is in mentionedJid', () => {
    const msg = makeMsg({
      extendedTextMessage: {
        text: '@bot hello',
        contextInfo: { mentionedJid: ['1234567890@s.whatsapp.net'] },
      },
    });
    expect(isBotMentioned(msg, '1234567890@s.whatsapp.net')).toBe(true);
  });

  test('returns false when mentionedJid is empty array', () => {
    const msg = makeMsg({
      extendedTextMessage: {
        text: 'hello',
        contextInfo: { mentionedJid: [] },
      },
    });
    expect(isBotMentioned(msg, '1234567890@s.whatsapp.net')).toBe(false);
  });

  test('returns false when contextInfo is missing', () => {
    const msg = makeMsg({
      extendedTextMessage: { text: 'hello' },
    });
    expect(isBotMentioned(msg, '1234567890@s.whatsapp.net')).toBe(false);
  });

  test('handles bot JID with :device suffix — matches by number part only', () => {
    const msg = makeMsg({
      extendedTextMessage: {
        text: '@bot hello',
        contextInfo: { mentionedJid: ['1234567890@s.whatsapp.net'] },
      },
    });
    expect(isBotMentioned(msg, '1234567890:5@s.whatsapp.net')).toBe(true);
  });

  test('returns false for non-matching JIDs', () => {
    const msg = makeMsg({
      extendedTextMessage: {
        text: '@someone hello',
        contextInfo: { mentionedJid: ['9999999999@s.whatsapp.net'] },
      },
    });
    expect(isBotMentioned(msg, '1234567890@s.whatsapp.net')).toBe(false);
  });

  test('works with imageMessage.contextInfo', () => {
    const msg = makeMsg({
      imageMessage: {
        caption: '@bot look at this',
        contextInfo: { mentionedJid: ['1234567890@s.whatsapp.net'] },
      },
    });
    expect(isBotMentioned(msg, '1234567890@s.whatsapp.net')).toBe(true);
  });
});

// ── getContextInfo ──

describe('getContextInfo', () => {
  function makeMsg(message: any): WAMessage {
    return { key: { id: 'test', remoteJid: 'test@s.whatsapp.net' }, message } as WAMessage;
  }

  test('extracts from extendedTextMessage.contextInfo', () => {
    const contextInfo = { mentionedJid: ['someone@s.whatsapp.net'] };
    const msg = makeMsg({ extendedTextMessage: { text: 'hi', contextInfo } });
    expect(getContextInfo(msg)).toEqual(contextInfo);
  });

  test('extracts from imageMessage.contextInfo', () => {
    const contextInfo = { mentionedJid: ['someone@s.whatsapp.net'] };
    const msg = makeMsg({ imageMessage: { caption: 'photo', contextInfo } });
    expect(getContextInfo(msg)).toEqual(contextInfo);
  });

  test('extracts from videoMessage.contextInfo', () => {
    const contextInfo = { mentionedJid: ['someone@s.whatsapp.net'] };
    const msg = makeMsg({ videoMessage: { caption: 'video', contextInfo } });
    expect(getContextInfo(msg)).toEqual(contextInfo);
  });

  test('returns undefined when no contextInfo', () => {
    const msg = makeMsg({ conversation: 'hello' });
    expect(getContextInfo(msg)).toBeUndefined();
  });
});

// ── getQuotedText ──

describe('getQuotedText', () => {
  function makeMsg(message: any): WAMessage {
    return { key: { id: 'test', remoteJid: 'test@s.whatsapp.net' }, message } as WAMessage;
  }

  test('extracts quoted conversation text', () => {
    const msg = makeMsg({
      extendedTextMessage: {
        text: 'reply',
        contextInfo: {
          quotedMessage: { conversation: 'original message' },
        },
      },
    });
    expect(getQuotedText(msg)).toBe('original message');
  });

  test('extracts quoted extendedTextMessage text', () => {
    const msg = makeMsg({
      extendedTextMessage: {
        text: 'reply',
        contextInfo: {
          quotedMessage: { extendedTextMessage: { text: 'quoted extended' } },
        },
      },
    });
    expect(getQuotedText(msg)).toBe('quoted extended');
  });

  test('returns undefined when no quoted message', () => {
    const msg = makeMsg({ conversation: 'hello' });
    expect(getQuotedText(msg)).toBeUndefined();
  });
});

// ── formatMessageEnvelope ──

describe('formatMessageEnvelope', () => {
  interface MessageMetadata {
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

  test('DM envelope has channel, type, sender, timestamp', () => {
    const meta: MessageMetadata = {
      channel: 'whatsapp',
      type: 'dm',
      senderJid: '1234567890@s.whatsapp.net',
      senderName: 'Alice',
      timestamp: 1700000000,
    };
    const result = formatMessageEnvelope(meta as any);
    expect(result).toContain('whatsapp');
    expect(result).toContain('dm');
    expect(result).toContain('1234567890@s.whatsapp.net');
    expect(result).toContain('1700000000');
  });

  test('group envelope has group element with name and jid', () => {
    const meta: MessageMetadata = {
      channel: 'whatsapp',
      type: 'group',
      senderJid: '1234567890@s.whatsapp.net',
      timestamp: 1700000000,
      groupName: 'Test Group',
      groupJid: '120363000000@g.us',
    };
    const result = formatMessageEnvelope(meta as any);
    expect(result).toContain('Test Group');
    expect(result).toContain('120363000000@g.us');
  });

  test('group envelope has mentioned flag', () => {
    const meta: MessageMetadata = {
      channel: 'whatsapp',
      type: 'group',
      senderJid: '1234567890@s.whatsapp.net',
      timestamp: 1700000000,
      groupName: 'Test Group',
      groupJid: '120363000000@g.us',
      isMentioned: true,
    };
    const result = formatMessageEnvelope(meta as any);
    expect(result).toContain('mentioned');
  });

  test('includes quoted element when present', () => {
    const meta: MessageMetadata = {
      channel: 'whatsapp',
      type: 'dm',
      senderJid: '1234567890@s.whatsapp.net',
      timestamp: 1700000000,
      quotedText: 'the original message',
    };
    const result = formatMessageEnvelope(meta as any);
    expect(result).toContain('the original message');
    expect(result).toContain('quoted');
  });

  test('XML is well-formed', () => {
    const meta: MessageMetadata = {
      channel: 'whatsapp',
      type: 'dm',
      senderJid: '1234567890@s.whatsapp.net',
      timestamp: 1700000000,
    };
    const result = formatMessageEnvelope(meta as any);
    // Should start with an opening tag and end with a closing tag
    expect(result).toMatch(/^<\w+[\s>]/);
    expect(result).toMatch(/<\/\w+>\s*$/);
  });
});

// ── containsNoReply ──

describe('containsNoReply', () => {
  test('true for text with <no-reply/>', () => {
    expect(containsNoReply('<no-reply/>')).toBe(true);
  });

  test('true when surrounded by other text', () => {
    expect(containsNoReply('Some text <no-reply/> more text')).toBe(true);
  });

  test('false for regular text', () => {
    expect(containsNoReply('Hello, how are you?')).toBe(false);
  });

  test('false for empty string', () => {
    expect(containsNoReply('')).toBe(false);
  });
});

// ── stripDirectives ──

describe('stripDirectives', () => {
  test('removes <no-reply/>', () => {
    expect(stripDirectives('Hello <no-reply/> world')).toBe('Hello  world');
  });

  test('unchanged when no directives', () => {
    expect(stripDirectives('Hello world')).toBe('Hello world');
  });

  test('trims result', () => {
    expect(stripDirectives('  <no-reply/> Hello  ')).toBe('Hello');
  });
});
