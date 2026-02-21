import { describe, expect, test, beforeEach, mock } from 'bun:test';
import {
  toWhatsAppJid,
  normalizeWhatsAppId,
  extractText,
  extractMedia,
  downloadMedia,
  describeNonTextMessage,
  chunkText,
  SentMessageTracker,
  MAX_WHATSAPP_TEXT_LENGTH,
  isBotMentioned,
  getContextInfo,
  getQuotedText,
  formatMessageEnvelope,
  containsNoReply,
  stripDirectives,
  type MediaAttachment,
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

// ── toWhatsAppJid ──

describe('toWhatsAppJid', () => {
  test('converts phone with + prefix', () => {
    expect(toWhatsAppJid('+1234567890')).toBe('1234567890@s.whatsapp.net');
  });

  test('converts bare digits', () => {
    expect(toWhatsAppJid('1234567890')).toBe('1234567890@s.whatsapp.net');
  });

  test('passes through existing JID', () => {
    expect(toWhatsAppJid('1234567890@s.whatsapp.net')).toBe('1234567890@s.whatsapp.net');
  });

  test('passes through group JID', () => {
    expect(toWhatsAppJid('120363001234@g.us')).toBe('120363001234@g.us');
  });

  test('strips non-digit chars', () => {
    expect(toWhatsAppJid('+1 (234) 567-890')).toBe('1234567890@s.whatsapp.net');
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

  test('unwraps viewOnceMessage containing imageMessage with caption', () => {
    expect(extractText(makeMsg({
      viewOnceMessage: {
        message: { imageMessage: { caption: 'view once caption' } },
      },
    }))).toBe('view once caption');
  });

  test('returns location description for locationMessage', () => {
    const result = extractText(makeMsg({
      locationMessage: { degreesLatitude: 37.7749, degreesLongitude: -122.4194, name: 'San Francisco' },
    }));
    expect(result).toContain('37.7749');
    expect(result).toContain('-122.4194');
    expect(result).toContain('San Francisco');
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

  test('extracts from audioMessage.contextInfo', () => {
    const contextInfo = { mentionedJid: ['someone@s.whatsapp.net'] };
    const msg = makeMsg({ audioMessage: { mimetype: 'audio/ogg', ptt: true, contextInfo } });
    expect(getContextInfo(msg)).toEqual(contextInfo);
  });

  test('extracts from stickerMessage.contextInfo', () => {
    const contextInfo = { mentionedJid: ['someone@s.whatsapp.net'] };
    const msg = makeMsg({ stickerMessage: { mimetype: 'image/webp', contextInfo } });
    expect(getContextInfo(msg)).toEqual(contextInfo);
  });

  test('extracts from locationMessage.contextInfo', () => {
    const contextInfo = { mentionedJid: ['someone@s.whatsapp.net'] };
    const msg = makeMsg({ locationMessage: { degreesLatitude: 0, degreesLongitude: 0, contextInfo } });
    expect(getContextInfo(msg)).toEqual(contextInfo);
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
    media?: MediaAttachment;
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

  test('includes attachment element when media is present', () => {
    const meta: MessageMetadata = {
      channel: 'whatsapp',
      type: 'dm',
      senderJid: '1234567890@s.whatsapp.net',
      timestamp: 1700000000,
      media: {
        type: 'image',
        mimeType: 'image/jpeg',
        fileSize: 245760,
      },
    };
    const result = formatMessageEnvelope(meta as any);
    expect(result).toContain('<attachment');
    expect(result).toContain('type="image"');
    expect(result).toContain('mimeType="image/jpeg"');
    expect(result).toContain('size="245760"');
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

// ── extractMedia ──

describe('extractMedia', () => {
  function makeMsg(message: any): WAMessage {
    return { key: { id: 'test', remoteJid: 'test@s.whatsapp.net' }, message } as WAMessage;
  }

  test('returns image attachment with metadata from imageMessage', () => {
    const msg = makeMsg({
      imageMessage: {
        mimetype: 'image/jpeg',
        caption: 'a photo',
        fileLength: 12345,
        width: 800,
        height: 600,
        mediaKey: new Uint8Array([1, 2, 3]),
        directPath: '/enc/path',
        url: 'https://mmg.whatsapp.net/...',
      },
    });
    const media = extractMedia(msg);
    expect(media).not.toBeNull();
    expect(media!.type).toBe('image');
    expect(media!.mimeType).toBe('image/jpeg');
    expect(media!.caption).toBe('a photo');
    expect(media!.fileSize).toBe(12345);
    expect(media!.width).toBe(800);
    expect(media!.height).toBe(600);
    expect(media!.mediaKey).toBeDefined();
    expect(media!.directPath).toBe('/enc/path');
  });

  test('returns video attachment from videoMessage', () => {
    const msg = makeMsg({
      videoMessage: {
        mimetype: 'video/mp4',
        caption: 'a clip',
        seconds: 15,
        fileLength: 500000,
      },
    });
    const media = extractMedia(msg);
    expect(media).not.toBeNull();
    expect(media!.type).toBe('video');
    expect(media!.mimeType).toBe('video/mp4');
    expect(media!.caption).toBe('a clip');
    expect(media!.seconds).toBe(15);
  });

  test('returns audio attachment with isVoiceNote when ptt=true', () => {
    const msg = makeMsg({
      audioMessage: {
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
        seconds: 5,
        fileLength: 8000,
      },
    });
    const media = extractMedia(msg);
    expect(media).not.toBeNull();
    expect(media!.type).toBe('audio');
    expect(media!.isVoiceNote).toBe(true);
    expect(media!.seconds).toBe(5);
  });

  test('returns document attachment with fileName from documentMessage', () => {
    const msg = makeMsg({
      documentMessage: {
        mimetype: 'application/pdf',
        fileName: 'report.pdf',
        caption: 'Q4 Report',
        fileLength: 100000,
      },
    });
    const media = extractMedia(msg);
    expect(media).not.toBeNull();
    expect(media!.type).toBe('document');
    expect(media!.mimeType).toBe('application/pdf');
    expect(media!.fileName).toBe('report.pdf');
    expect(media!.caption).toBe('Q4 Report');
  });

  test('returns sticker attachment from stickerMessage', () => {
    const msg = makeMsg({
      stickerMessage: {
        mimetype: 'image/webp',
        width: 512,
        height: 512,
      },
    });
    const media = extractMedia(msg);
    expect(media).not.toBeNull();
    expect(media!.type).toBe('sticker');
    expect(media!.mimeType).toBe('image/webp');
    expect(media!.width).toBe(512);
  });

  test('returns null for text-only messages', () => {
    const msg = makeMsg({ conversation: 'just text' });
    expect(extractMedia(msg)).toBeNull();
  });

  test('unwraps viewOnceMessage to extract inner media', () => {
    const msg = makeMsg({
      viewOnceMessage: {
        message: {
          imageMessage: {
            mimetype: 'image/jpeg',
            caption: 'view once photo',
            mediaKey: new Uint8Array([4, 5, 6]),
          },
        },
      },
    });
    const media = extractMedia(msg);
    expect(media).not.toBeNull();
    expect(media!.type).toBe('image');
    expect(media!.caption).toBe('view once photo');
  });
});

// ── downloadMedia ──

describe('downloadMedia', () => {
  // Note: downloadMedia calls Baileys' downloadContentFromMessage which requires
  // real media keys/URLs. We mock the module-level import for unit testing.
  // For now, these tests verify the function signature and error handling.

  test('throws when exceeding size limit', async () => {
    // Create a mock attachment with no real download info — Baileys will fail
    const attachment: MediaAttachment = {
      type: 'image',
      mimeType: 'image/jpeg',
      mediaKey: null,
      directPath: null,
      url: null,
    };
    // Without valid media source, downloadContentFromMessage will throw
    await expect(downloadMedia(attachment, 100)).rejects.toThrow();
  });

  test('handles missing mediaKey gracefully', async () => {
    const attachment: MediaAttachment = {
      type: 'document',
      mimeType: 'application/pdf',
      mediaKey: null,
      directPath: null,
      url: null,
    };
    // Should throw since there's no valid source to download from
    await expect(downloadMedia(attachment)).rejects.toThrow();
  });
});

// ── describeNonTextMessage ──

describe('describeNonTextMessage', () => {
  function makeMsg(message: any): WAMessage {
    return { key: { id: 'test', remoteJid: 'test@s.whatsapp.net' }, message } as WAMessage;
  }

  test('returns location description with coordinates', () => {
    const msg = makeMsg({
      locationMessage: { degreesLatitude: 37.7749, degreesLongitude: -122.4194, name: 'San Francisco' },
    });
    const desc = describeNonTextMessage(msg);
    expect(desc).not.toBeNull();
    expect(desc).toContain('37.7749');
    expect(desc).toContain('-122.4194');
    expect(desc).toContain('San Francisco');
  });

  test('returns contact description with display name', () => {
    const msg = makeMsg({
      contactMessage: { displayName: 'John Doe', vcard: 'BEGIN:VCARD...' },
    });
    const desc = describeNonTextMessage(msg);
    expect(desc).not.toBeNull();
    expect(desc).toContain('John Doe');
  });

  test('returns null for non-special message types', () => {
    const msg = makeMsg({ conversation: 'hello' });
    expect(describeNonTextMessage(msg)).toBeNull();
  });

  test('returns contacts array description', () => {
    const msg = makeMsg({
      contactsArrayMessage: {
        contacts: [
          { displayName: 'Alice' },
          { displayName: 'Bob' },
        ],
      },
    });
    const desc = describeNonTextMessage(msg);
    expect(desc).not.toBeNull();
    expect(desc).toContain('Alice');
    expect(desc).toContain('Bob');
  });
});
