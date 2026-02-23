import { describe, expect, test, afterEach } from 'bun:test';
import {
  configureMockHarness,
  resetMockHarnessState,
  getMockCalls,
  getMockInstances,
  mockHarnessPool,
} from '../../__test-helpers__/mock-harness';

// Harness module mocks are established via preload (bunfig.toml + preload-harness-mock.ts).
// This prevents the real harness import chain (@mastra/core/harness, @mastra/pg, etc.)
// from being evaluated at all — the recommended Bun approach for preventing side effects.

import { WhatsAppBridge } from '../whatsapp-bridge';
import { createMockMastra } from '../../__test-helpers__/mock-mastra';
import { createMockSocket } from '../../__test-helpers__/mock-socket';
import { WhatsAppStore, type WhatsAppData } from '../whatsapp-store';

// -- Helpers --

const ALLOWED_JID = '1234567890@s.whatsapp.net';
const ALLOWED_PHONE = '+1234567890';
const GROUP_JID = '120363001234567890@g.us';
const PARTICIPANT_JID = '1234567890@s.whatsapp.net';
const BOT_JID = '1234567890:1@s.whatsapp.net';
const BOT_LID = '214542927831175:0@lid';

function makeAllowlistData(phone = ALLOWED_PHONE, rawJid = ALLOWED_JID): WhatsAppData {
  return {
    allowlist: [{ phoneNumber: phone, rawJid, label: null, createdAt: new Date().toISOString() }],
    pairings: [],
    config: {},
    groups: [],
  };
}

function makeEmptyData(): WhatsAppData {
  return { allowlist: [], pairings: [], config: {}, groups: [] };
}

function makeGroupData(mode: string | null = 'all'): WhatsAppData {
  return {
    allowlist: [{ phoneNumber: ALLOWED_PHONE, rawJid: ALLOWED_JID, label: null, createdAt: new Date().toISOString() }],
    pairings: [],
    config: {},
    groups: [{ groupJid: GROUP_JID, groupName: 'Test Group', mode: mode ?? 'mentions', enabled: true, createdAt: new Date().toISOString() }],
  };
}

function makeWAMessage(text: string, remoteJid = ALLOWED_JID) {
  return {
    key: { id: `msg-${Date.now()}-${Math.random()}`, remoteJid, fromMe: false },
    message: { conversation: text },
  };
}

function makeGroupMessage(text: string, opts?: { participant?: string; mentioned?: boolean; mentionLid?: boolean; quoted?: string }) {
  const mentionedJid = opts?.mentioned
    ? (opts?.mentionLid ? [BOT_LID] : [BOT_JID])
    : [];
  return {
    key: {
      id: `msg-${Date.now()}-${Math.random()}`,
      remoteJid: GROUP_JID,
      fromMe: false,
      participant: opts?.participant ?? PARTICIPANT_JID,
    },
    message: {
      extendedTextMessage: {
        text,
        contextInfo: {
          mentionedJid,
          ...(opts?.quoted ? { quotedMessage: { conversation: opts.quoted } } : {}),
        },
      },
    },
    pushName: 'Test User',
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
}

// Track bridges for cleanup -- prevents timer leaks between tests
const activeBridges: WhatsAppBridge[] = [];

afterEach(() => {
  for (const bridge of activeBridges) bridge.detach();
  activeBridges.length = 0;
  resetMockHarnessState();
});

function createBridge(opts: {
  generateResult?: { text?: string };
  generateDelay?: number;
  shouldHang?: boolean;
  shouldThrow?: Error;
  presenceHangs?: boolean;
  allowed?: boolean;
  groupAllowed?: boolean;
  groupMode?: string | null;
  storeData?: WhatsAppData;
} = {}) {
  configureMockHarness({
    responseText: opts.generateResult?.text ?? 'reply',
    delay: opts.generateDelay,
    shouldHang: opts.shouldHang,
    shouldThrow: opts.shouldThrow,
  });

  const mastra = createMockMastra({});
  const { socket, sentMessages, presenceUpdates } = createMockSocket({
    presenceHangs: opts.presenceHangs,
  });

  // Build store data from options
  let data: WhatsAppData;
  if (opts.storeData) {
    data = opts.storeData;
  } else if (opts.groupAllowed === true || opts.groupAllowed === false) {
    data = opts.groupAllowed
      ? makeGroupData('groupMode' in opts ? opts.groupMode : 'all')
      : (opts.allowed !== false ? makeAllowlistData() : makeEmptyData());
  } else {
    data = opts.allowed !== false ? makeAllowlistData() : makeEmptyData();
  }
  const store = new WhatsAppStore(data);

  const bridge = new WhatsAppBridge(mastra as any, socket as any, store);
  bridge.attach();
  activeBridges.push(bridge);

  return { bridge, socket, sentMessages, presenceUpdates, store };
}

/** Create + register a bridge from manual mocks (for custom store, etc.) */
function registerBridge(bridge: WhatsAppBridge) {
  activeBridges.push(bridge);
  return bridge;
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// -- Debounce: rapid messages combined --

describe('message debouncing', () => {
  test('single message processes after debounce window', async () => {
    const { socket } = createBridge();
    const msg = makeWAMessage('hello');

    socket.ev.emit('messages.upsert', { messages: [msg] });

    // Should NOT process immediately
    await wait(100);
    expect(getMockCalls().length).toBe(0);

    // Should process after debounce (2s)
    await wait(2100);
    expect(getMockCalls().length).toBe(1);
    expect(getMockCalls()[0].content).toContain('hello');
  });

  test('two rapid messages combined into single agent call', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('create folders')] });
    await wait(500);
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('each app can be a gh repo')] });

    await wait(2500);
    expect(getMockCalls().length).toBe(1);
    expect(getMockCalls()[0].content).toContain('create folders\neach app can be a gh repo');
  });

  test('three rapid messages all combined', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('msg1')] });
    await wait(200);
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('msg2')] });
    await wait(200);
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('msg3')] });

    await wait(2500);
    expect(getMockCalls().length).toBe(1);
    expect(getMockCalls()[0].content).toContain('msg1\nmsg2\nmsg3');
  });

  test('messages from different contacts are independent', async () => {
    const jid1 = '1111111111@s.whatsapp.net';
    const jid2 = '2222222222@s.whatsapp.net';
    const { socket } = createBridge({
      storeData: {
        allowlist: [
          { phoneNumber: '+1111111111', rawJid: jid1, label: null, createdAt: new Date().toISOString() },
          { phoneNumber: '+2222222222', rawJid: jid2, label: null, createdAt: new Date().toISOString() },
        ],
        pairings: [], config: {}, groups: [],
      },
    });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('from contact 1', jid1)] });
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('from contact 2', jid2)] });

    await wait(2500);
    expect(getMockCalls().length).toBe(2);
  });
});

// -- Abort: new message during processing --

describe('abort on new message during processing', () => {
  test('message during processing aborts and restarts with combined text', async () => {
    const { socket } = createBridge({ generateDelay: 3000 });

    // Message 1 arrives, debounce fires, processing starts
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('first message')] });
    await wait(2200);
    expect(getMockCalls().length).toBe(1);

    // Message 2 arrives while agent is processing
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('second message')] });
    await wait(100); // let async isAllowed() + bufferMessage() complete

    // The first call should have been aborted
    expect(getMockCalls()[0].aborted).toBe(true);

    // Wait for: abort completes + debounce (2s) + processing
    await wait(2500);

    // After abort + debounce, a new call with the second message
    expect(getMockCalls().length).toBe(2);
    expect(getMockCalls()[1].content).toContain('second message');
  });
});

// -- Fire-and-forget presence --

describe('presence updates are fire-and-forget', () => {
  test('hanging presence does NOT block message processing', async () => {
    const { socket } = createBridge({ presenceHangs: true });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('test')] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
  });
});

// -- Agent timeout --

describe('agent timeout', () => {
  test('hanging agent is abortable via harness', async () => {
    const { socket } = createBridge({ shouldHang: true });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('test')] });
    await wait(2200);

    // Harness was created and sendMessage was called
    expect(getMockCalls().length).toBe(1);
    // The harness instance exists (abort wired via controller signal)
    expect(getMockInstances().length).toBe(1);
  });
});

// -- Reply behavior --

describe('reply sending', () => {
  test('agent response is sent back via socket', async () => {
    const { sentMessages, socket } = createBridge({
      generateResult: { text: 'Hello from agent!' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hi')] });
    await wait(2500);

    expect(sentMessages.some((m) => m.content.text === 'Hello from agent!')).toBe(true);
  });

  test('empty agent response does not send message', async () => {
    const { sentMessages, socket } = createBridge({
      generateResult: { text: '' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hi')] });
    await wait(2500);

    expect(sentMessages.length).toBe(0);
  });

  test('long response is chunked', async () => {
    const longText = 'word '.repeat(1000); // ~5000 chars
    const { sentMessages, socket } = createBridge({
      generateResult: { text: longText },
    });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hi')] });
    await wait(2500);

    expect(sentMessages.length).toBeGreaterThanOrEqual(2);
    for (const msg of sentMessages) {
      expect((msg.content.text ?? '').length).toBeLessThanOrEqual(3800);
    }
  });
});

// -- Allowlist --

describe('allowlist enforcement', () => {
  test('non-allowed contact sending /pair gets pairing code', async () => {
    const { sentMessages, socket } = createBridge({ allowed: false });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('/pair')] });
    await wait(2500);

    expect(getMockCalls().length).toBe(0);
    expect(sentMessages.some((m) => (m.content.text ?? '').includes('pair'))).toBe(true);
  });

  test('non-allowed contact sending regular message gets no response', async () => {
    const { sentMessages, socket } = createBridge({ allowed: false });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hello')] });
    await wait(2500);

    expect(getMockCalls().length).toBe(0);
    expect(sentMessages.length).toBe(0);
  });
});

// -- Message filtering --

describe('message filtering', () => {
  test('skips fromMe messages', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', {
      messages: [{
        key: { id: 'msg-1', remoteJid: ALLOWED_JID, fromMe: true },
        message: { conversation: 'my own message' },
      }],
    });
    await wait(2500);
    expect(getMockCalls().length).toBe(0);
  });

  test('skips empty messages', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', {
      messages: [{
        key: { id: 'msg-1', remoteJid: ALLOWED_JID, fromMe: false },
        message: { conversation: '   ' },
      }],
    });
    await wait(2500);
    expect(getMockCalls().length).toBe(0);
  });

  test('skips messages with no content', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', {
      messages: [{
        key: { id: 'msg-1', remoteJid: ALLOWED_JID, fromMe: false },
        message: null,
      }],
    });
    await wait(2500);
    expect(getMockCalls().length).toBe(0);
  });
});

// -- detach cleanup --

describe('detach', () => {
  test('detach clears all state and stops processing', async () => {
    const { bridge, socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hello')] });
    await wait(500); // buffered but not yet flushed

    bridge.detach();

    await wait(2500); // would have flushed, but detached
    expect(getMockCalls().length).toBe(0);
  });
});

// -- Thread / harness creation --

describe('harness creation', () => {
  test('DM reuses same harness for second message from same contact', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('first')] });
    await wait(2500);
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('second')] });
    await wait(2500);

    // Same contact → same harness instance reused (not 2 separate ones)
    expect(getMockInstances().length).toBe(1);
    expect(getMockCalls().length).toBe(2);
  }, 10_000);

  test('DM thread title is WhatsApp: {phone}', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('test')] });
    await wait(2500);

    expect(getMockInstances()[0].threadTitles[0]).toBe(`WhatsApp: ${ALLOWED_PHONE}`);
  });

  test('different contacts get separate harnesses', async () => {
    const OTHER_JID = '9876543210@s.whatsapp.net';
    const OTHER_PHONE = '+9876543210';
    const { socket } = createBridge({
      storeData: {
        allowlist: [
          { phoneNumber: ALLOWED_PHONE, rawJid: ALLOWED_JID, label: null, createdAt: new Date().toISOString() },
          { phoneNumber: OTHER_PHONE, rawJid: OTHER_JID, label: null, createdAt: new Date().toISOString() },
        ],
        pairings: [], config: {}, groups: [],
      },
    });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hi', ALLOWED_JID)] });
    await wait(2500);
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hello', OTHER_JID)] });
    await wait(2500);

    expect(getMockInstances().length).toBe(2);
  }, 10_000);

  test('harness recreated after pool sweep removes stale entry', async () => {
    const { socket } = createBridge();
    // mockHarnessPool imported at top level

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('first')] });
    await wait(2500);
    expect(getMockInstances().length).toBe(1);

    // Simulate pool sweeping the idle entry
    const firstThreadId = getMockInstances()[0].channelId;
    await mockHarnessPool.remove(firstThreadId);

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('after sweep')] });
    await wait(2500);

    // Bridge detects stale mapping and creates a new harness
    expect(getMockInstances().length).toBe(2);
  }, 10_000);
});

// -- Agent error handling --

describe('agent errors', () => {
  test('harness sendMessage throwing non-abort error is caught and logged', async () => {
    const { sentMessages, socket } = createBridge({
      shouldThrow: new Error('LLM API rate limit'),
    });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('test')] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    expect(sentMessages.length).toBe(0);
  });

  test('agent returning no text content does not send reply', async () => {
    const { sentMessages, socket } = createBridge({
      generateResult: { text: '' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hi')] });
    await wait(2500);

    expect(sentMessages.length).toBe(0);
  });

  test('agent returning whitespace-only text does not send reply', async () => {
    const { sentMessages, socket } = createBridge({
      generateResult: { text: '   \n\n  ' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hi')] });
    await wait(2500);

    expect(sentMessages.length).toBe(0);
  });
});

// -- Presence updates --

describe('presence lifecycle', () => {
  test('composing sent before processing, paused sent after', async () => {
    const { presenceUpdates, socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('test')] });
    await wait(2500);

    const compIdx = presenceUpdates.findIndex((p) => p.type === 'composing');
    const pauseIdx = presenceUpdates.findIndex((p) => p.type === 'paused');
    expect(compIdx).toBeGreaterThanOrEqual(0);
    expect(pauseIdx).toBeGreaterThan(compIdx);
  });

  test('paused sent even when agent throws', async () => {
    const { presenceUpdates, socket } = createBridge({
      shouldThrow: new Error('kaboom'),
    });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('test')] });
    await wait(2500);

    expect(presenceUpdates.some((p) => p.type === 'paused')).toBe(true);
  });
});

// -- Sequential processing after abort --

describe('sequential message flows', () => {
  test('second batch processes after first completes normally', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('batch 1')] });
    await wait(2500);
    expect(getMockCalls().length).toBe(1);

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('batch 2')] });
    await wait(2500);
    expect(getMockCalls().length).toBe(2);
    expect(getMockCalls()[1].content).toContain('batch 2');
  }, 10_000);

  test('multiple abort cycles work correctly', async () => {
    const { socket } = createBridge({ generateDelay: 3000 });

    // First message starts processing
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('msg A')] });
    await wait(2200);
    expect(getMockCalls().length).toBe(1);

    // Abort with second message
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('msg B')] });
    await wait(200);

    // Wait for second debounce + processing start
    await wait(2200);
    expect(getMockCalls().length).toBe(2);

    // Abort again with third message
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('msg C')] });
    await wait(200);
    expect(getMockCalls()[1].aborted).toBe(true);

    // Wait for third debounce + processing
    await wait(2500);
    expect(getMockCalls().length).toBe(3);
    expect(getMockCalls()[2].content).toContain('msg C');
  }, 15_000);
});

// -- Group and special JID filtering --

describe('JID filtering', () => {
  test('skips group messages from non-allowlisted groups (@g.us)', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', {
      messages: [{
        key: { id: 'msg-1', remoteJid: '120363001234567890@g.us', fromMe: false },
        message: { conversation: 'group message' },
      }],
    });
    await wait(2500);
    expect(getMockCalls().length).toBe(0);
  });

  test('skips messages with no remoteJid', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', {
      messages: [{
        key: { id: 'msg-1', remoteJid: undefined, fromMe: false },
        message: { conversation: 'orphan message' },
      }],
    });
    await wait(2500);
    expect(getMockCalls().length).toBe(0);
  });
});

// -- Echo dedup via SentMessageTracker --

describe('sent message echo dedup', () => {
  test('reply messages are tracked and skipped on echo', async () => {
    const { sentMessages, socket } = createBridge({
      generateResult: { text: 'bot reply' },
    });

    // Real message -> agent -> reply
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('user msg')] });
    await wait(2500);
    expect(sentMessages.length).toBe(1);
    expect(getMockCalls().length).toBe(1);

    // Simulate the reply echoing back as a fromMe message
    const echoMsgId = `mock-msg-${sentMessages.length}`;
    socket.ev.emit('messages.upsert', {
      messages: [{
        key: { id: echoMsgId, remoteJid: ALLOWED_JID, fromMe: true },
        message: { conversation: 'bot reply' },
      }],
    });
    await wait(2500);

    // Echo was deduped -- still just 1 agent call
    expect(getMockCalls().length).toBe(1);
  }, 10_000);
});

// -- Store failure on allowlist --

describe('store failures', () => {
  test('allowlist store error rejects message (fail-closed)', async () => {
    configureMockHarness({ responseText: 'reply' });
    const mastra = createMockMastra({});
    const { socket, sentMessages } = createMockSocket();

    // Create a store where all methods throw (simulates corrupt config file)
    const store = new WhatsAppStore(makeEmptyData());
    const fail = () => { throw new Error('disk read failed'); };
    store.isAllowed = fail;
    store.findActivePairing = fail as any;
    store.createPairing = fail as any;
    store.cleanExpiredPairings = fail as any;

    const bridge = registerBridge(
      new WhatsAppBridge(mastra as any, socket as any, store),
    );
    bridge.attach();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hello')] });
    await wait(2500);

    expect(getMockCalls().length).toBe(0);
    expect(sentMessages.length).toBe(0);
  });
});

// -- Batch messages in single upsert event --

describe('batch upsert events', () => {
  test('multiple messages in single upsert event are all processed', async () => {
    const { socket } = createBridge();

    // Baileys can deliver multiple messages in a single upsert
    socket.ev.emit('messages.upsert', {
      messages: [
        makeWAMessage('batch msg 1'),
        makeWAMessage('batch msg 2'),
      ],
    });
    await wait(2500);

    // Both debounced into single call (same JID, within debounce window)
    expect(getMockCalls().length).toBe(1);
    expect(getMockCalls()[0].content).toContain('batch msg 1\nbatch msg 2');
  });
});

// -- Group message handling --

describe('group message handling', () => {
  test('group message from allowlisted group is processed', async () => {
    const { socket } = createBridge({ groupAllowed: true });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hello group')] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
  });

  test('group message from non-allowlisted group is ignored', async () => {
    const { sentMessages, socket } = createBridge({ groupAllowed: false });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hello group')] });
    await wait(2500);

    expect(getMockCalls().length).toBe(0);
    // No pairing code sent for groups
    expect(sentMessages.length).toBe(0);
  });

  test('group message with bot mention sends agent response to group JID', async () => {
    const { sentMessages, socket } = createBridge({
      groupAllowed: true,
      generateResult: { text: 'group reply' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hey @bot help', { mentioned: true })] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    expect(sentMessages.some((m) => m.jid === GROUP_JID && m.content.text === 'group reply')).toBe(true);
  });

  test('group message with LID-format mention is recognized as mention', async () => {
    const { sentMessages, socket } = createBridge({
      groupAllowed: true,
      groupMode: 'mentions',
      generateResult: { text: 'lid reply' },
    });

    // mentionLid: true → mentionedJid contains BOT_LID instead of BOT_JID
    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hey @bot', { mentioned: true, mentionLid: true })] });
    await wait(100);

    expect(getMockCalls().length).toBe(1);
    expect(sentMessages.some((m) => m.jid === GROUP_JID && m.content.text === 'lid reply')).toBe(true);
  });

  test('group message without mention — agent responds with <no-reply/> — suppresses send', async () => {
    const { sentMessages, socket } = createBridge({
      groupAllowed: true,
      generateResult: { text: '<no-reply/>' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('random chat')] });
    await wait(2500);

    expect(sentMessages.length).toBe(0);
  });

  test('group message without mention — agent responds with text (no <no-reply/>) — text IS sent', async () => {
    const { sentMessages, socket } = createBridge({
      groupAllowed: true,
      generateResult: { text: 'interesting point!' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('some discussion')] });
    await wait(2500);

    expect(sentMessages.some((m) => m.content.text === 'interesting point!')).toBe(true);
  });

  test('group debounce key uses groupJid:participant — different participants are independent', async () => {
    const { socket } = createBridge({ groupAllowed: true });
    const participant2 = '9999999999@s.whatsapp.net';

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('from user 1')] });
    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('from user 2', { participant: participant2 })] });

    await wait(2500);

    // Two independent debounce keys -> two separate agent calls
    expect(getMockCalls().length).toBe(2);
  });

  test('group reuses same harness for second message', async () => {
    const { socket } = createBridge({ groupAllowed: true });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('first', { mentioned: true })] });
    await wait(2500);
    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('second', { mentioned: true })] });
    await wait(2500);

    // Same group → same harness instance reused
    expect(getMockInstances().length).toBe(1);
    expect(getMockCalls().length).toBe(2);
  }, 10_000);
});

// -- Group modes --

describe('group modes', () => {
  test('mode=all: every message gets a response', async () => {
    const { sentMessages, socket } = createBridge({
      groupAllowed: true,
      groupMode: 'all',
      generateResult: { text: 'all mode reply' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hello')] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    expect(sentMessages.some((m) => m.content.text === 'all mode reply')).toBe(true);
  });

  test('mode=mentions + mentioned: response sent', async () => {
    const { sentMessages, socket } = createBridge({
      groupAllowed: true,
      groupMode: 'mentions',
      generateResult: { text: 'mention reply' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hey @bot', { mentioned: true })] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    expect(sentMessages.some((m) => m.content.text === 'mention reply')).toBe(true);
  });

  test('mode=mentions + not mentioned: agent called for memory, response suppressed', async () => {
    const { sentMessages, presenceUpdates, socket } = createBridge({
      groupAllowed: true,
      groupMode: 'mentions',
      generateResult: { text: 'should not be sent' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('just chatting')] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    // Agent IS called -- content includes observe-mode envelope
    expect(getMockCalls()[0].content).toContain('OBSERVATION ONLY');
    // Response NOT sent to group
    expect(sentMessages.length).toBe(0);
    // No typing indicator
    expect(presenceUpdates.filter((p) => p.type === 'composing').length).toBe(0);
  });

  test('mode=observe: agent called, response always suppressed', async () => {
    const { sentMessages, socket } = createBridge({
      groupAllowed: true,
      groupMode: 'observe',
      generateResult: { text: 'should not be sent' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('random chat')] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    expect(getMockCalls()[0].content).toContain('OBSERVATION ONLY');
    expect(sentMessages.length).toBe(0);
  });

  test('mode=observe + mentioned: still suppressed (observe means observe)', async () => {
    const { sentMessages, socket } = createBridge({
      groupAllowed: true,
      groupMode: 'observe',
      generateResult: { text: 'should not be sent' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hey @bot', { mentioned: true })] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    expect(getMockCalls()[0].content).toContain('OBSERVATION ONLY');
    expect(sentMessages.length).toBe(0);
  });

  test('default mode (no mode column) treated as mentions', async () => {
    const { sentMessages, socket } = createBridge({
      groupAllowed: true,
      groupMode: null,
      generateResult: { text: 'should not be sent' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hello')] });
    await wait(2500);

    // Not mentioned + mode defaults to mentions -> observe mode
    expect(getMockCalls().length).toBe(1);
    expect(sentMessages.length).toBe(0);
  });

  test('observe mode content includes msg CLI instructions with group JID', async () => {
    const { socket } = createBridge({
      groupAllowed: true,
      groupMode: 'observe',
      generateResult: { text: 'noted' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('test')] });
    await wait(2500);

    const content = getMockCalls()[0].content;
    expect(content).toContain(`msg send --channel whatsapp --to "${GROUP_JID}"`);
  });
});

// -- Mention immediate flush --

describe('mention immediate flush', () => {
  test('mentioned message processes faster than 2s debounce', async () => {
    const { socket } = createBridge({ groupAllowed: true });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hey @bot', { mentioned: true })] });

    // Should process before 2s debounce window
    await wait(500);
    expect(getMockCalls().length).toBe(1);
  });

  test('non-mentioned message still uses 2s debounce', async () => {
    const { socket } = createBridge({ groupAllowed: true });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('just chatting')] });

    // Should NOT process before debounce
    await wait(500);
    expect(getMockCalls().length).toBe(0);

    // Should process after debounce
    await wait(2200);
    expect(getMockCalls().length).toBe(1);
  });
});

// -- <no-reply/> directive --

describe('<no-reply/> directive', () => {
  test('<no-reply/> in DM response — not sent', async () => {
    const { sentMessages, socket } = createBridge({
      generateResult: { text: '<no-reply/>' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hi')] });
    await wait(2500);

    expect(sentMessages.length).toBe(0);
  });

  test('<no-reply/> in group response — not sent', async () => {
    const { sentMessages, socket } = createBridge({
      groupAllowed: true,
      generateResult: { text: '<no-reply/>' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('random')] });
    await wait(2500);

    expect(sentMessages.length).toBe(0);
  });

  test('text + <no-reply/> — nothing sent (directive takes precedence)', async () => {
    const { sentMessages, socket } = createBridge({
      generateResult: { text: 'Some text here <no-reply/>' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hi')] });
    await wait(2500);

    expect(sentMessages.length).toBe(0);
  });

  test('normal response without <no-reply/> — sent as usual', async () => {
    const { sentMessages, socket } = createBridge({
      generateResult: { text: 'Hello there!' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hi')] });
    await wait(2500);

    expect(sentMessages.some((m) => m.content.text === 'Hello there!')).toBe(true);
  });
});

// -- Message envelope --

describe('message envelope', () => {
  test('DM messages include <message-context> XML in agent input content', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hello')] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    expect(getMockCalls()[0].content).toContain('<message-context');
  });

  test('group messages include envelope with group info and mentioned flag', async () => {
    const { socket } = createBridge({ groupAllowed: true });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hey @bot', { mentioned: true })] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    const content = getMockCalls()[0].content;
    expect(content).toContain('<message-context');
    expect(content).toContain('group');
    expect(content).toContain('mentioned');
  });

  test('quoted/reply messages include <quoted> in envelope', async () => {
    const { socket } = createBridge({ groupAllowed: true });

    socket.ev.emit('messages.upsert', {
      messages: [makeGroupMessage('replying to this', { mentioned: true, quoted: 'original message text' })],
    });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    const content = getMockCalls()[0].content;
    expect(content).toContain('<quoted>');
    expect(content).toContain('original message text');
  });
});

// -- sendOutbound --

describe('sendOutbound', () => {
  test('sends message via socket and tracks sent ID', async () => {
    const { bridge, sentMessages } = createBridge();

    await bridge.sendOutbound(ALLOWED_JID, 'outbound test');

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].jid).toBe(ALLOWED_JID);
    expect(sentMessages[0].content.text).toBe('outbound test');
  });

  test('chunks long messages', async () => {
    const { bridge, sentMessages } = createBridge();
    const longText = 'word '.repeat(1000); // ~5000 chars

    await bridge.sendOutbound(ALLOWED_JID, longText);

    expect(sentMessages.length).toBeGreaterThanOrEqual(2);
    for (const msg of sentMessages) {
      expect((msg.content.text ?? '').length).toBeLessThanOrEqual(3800);
    }
  });

  test('returns message ID', async () => {
    const { bridge } = createBridge();

    const result = await bridge.sendOutbound(ALLOWED_JID, 'test');

    expect(result).toBeDefined();
  });
});

// -- Media message handling (incoming) --

describe('media message handling', () => {
  function makeImageMessage(caption?: string, remoteJid = ALLOWED_JID) {
    return {
      key: { id: `msg-${Date.now()}-${Math.random()}`, remoteJid, fromMe: false },
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          caption: caption || null,
          fileLength: 50000,
          width: 800,
          height: 600,
          mediaKey: new Uint8Array([1, 2, 3]),
          directPath: '/enc/test',
          url: 'https://mmg.whatsapp.net/test',
        },
      },
    };
  }

  function makeVoiceNoteMessage(remoteJid = ALLOWED_JID) {
    return {
      key: { id: `msg-${Date.now()}-${Math.random()}`, remoteJid, fromMe: false },
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
          seconds: 5,
          fileLength: 8000,
          mediaKey: new Uint8Array([4, 5, 6]),
          directPath: '/enc/audio',
          url: 'https://mmg.whatsapp.net/audio',
        },
      },
    };
  }

  function makeDocumentMessage(remoteJid = ALLOWED_JID) {
    return {
      key: { id: `msg-${Date.now()}-${Math.random()}`, remoteJid, fromMe: false },
      message: {
        documentMessage: {
          mimetype: 'application/pdf',
          fileName: 'report.pdf',
          fileLength: 100000,
          mediaKey: new Uint8Array([7, 8, 9]),
          directPath: '/enc/doc',
          url: 'https://mmg.whatsapp.net/doc',
        },
      },
    };
  }

  function makeLocationMessage(remoteJid = ALLOWED_JID) {
    return {
      key: { id: `msg-${Date.now()}-${Math.random()}`, remoteJid, fromMe: false },
      message: {
        locationMessage: {
          degreesLatitude: 37.7749,
          degreesLongitude: -122.4194,
          name: 'San Francisco',
        },
      },
    };
  }

  test('image without caption is NOT dropped — agent receives call with file path', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeImageMessage()] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    const content = getMockCalls()[0].content;
    expect(typeof content).toBe('string');
    // Media download fails in tests (no real WhatsApp) -- should get fallback text
    expect(content).toContain('[');
  });

  test('image with caption — agent receives string content with caption', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeImageMessage('Check this photo')] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    const content = getMockCalls()[0].content;
    expect(typeof content).toBe('string');
    expect(content).toContain('Check this photo');
  });

  test('voice note — agent receives text placeholder (transcription stub)', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeVoiceNoteMessage()] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    const content = getMockCalls()[0].content;
    expect(typeof content).toBe('string');
    expect(content).toContain('Voice message received');
  });

  test('location message — agent receives text description', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeLocationMessage()] });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    const content = getMockCalls()[0].content;
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
    expect(contentStr).toContain('37.7749');
    expect(contentStr).toContain('San Francisco');
  });
});

// -- Outbound media --

describe('outbound media', () => {
  test('sendOutbound with image media sends image payload', async () => {
    const { bridge, sentMessages } = createBridge();

    await bridge.sendOutbound(ALLOWED_JID, '', {
      media: [{
        type: 'image',
        data: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
        caption: 'Test image',
      }],
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].content.image).toBeDefined();
    expect(sentMessages[0].content.caption).toBe('Test image');
  });

  test('sendOutbound with document sends document payload with fileName', async () => {
    const { bridge, sentMessages } = createBridge();

    await bridge.sendOutbound(ALLOWED_JID, '', {
      media: [{
        type: 'document',
        data: Buffer.from('fake-pdf-data'),
        mimeType: 'application/pdf',
        fileName: 'report.pdf',
      }],
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].content.document).toBeDefined();
    expect(sentMessages[0].content.mimetype).toBe('application/pdf');
    expect(sentMessages[0].content.fileName).toBe('report.pdf');
  });

  test('sendOutbound with text + media sends both', async () => {
    const { bridge, sentMessages } = createBridge();

    await bridge.sendOutbound(ALLOWED_JID, 'Here is the file', {
      media: [{
        type: 'image',
        data: Buffer.from('fake-image'),
        mimeType: 'image/png',
      }],
    });

    // Should have 2 messages: 1 image + 1 text
    expect(sentMessages.length).toBe(2);
    expect(sentMessages[0].content.image).toBeDefined(); // media first
    expect(sentMessages[1].content.text).toBe('Here is the file'); // text second
  });
});

// -- View-once unwrapping --

describe('view-once unwrapping', () => {
  test('view-once image is unwrapped and processed (not dropped)', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', {
      messages: [{
        key: { id: `msg-${Date.now()}`, remoteJid: ALLOWED_JID, fromMe: false },
        message: {
          viewOnceMessage: {
            message: {
              imageMessage: {
                mimetype: 'image/jpeg',
                caption: 'view once test',
                mediaKey: new Uint8Array([1, 2, 3]),
                directPath: '/enc/viewonce',
                url: 'https://mmg.whatsapp.net/viewonce',
              },
            },
          },
        },
      }],
    });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    const content = getMockCalls()[0].content;
    expect(typeof content).toBe('string');
    expect(content).toContain('view once test');
  });

  test('ephemeral message is unwrapped and processed', async () => {
    const { socket } = createBridge();

    socket.ev.emit('messages.upsert', {
      messages: [{
        key: { id: `msg-${Date.now()}`, remoteJid: ALLOWED_JID, fromMe: false },
        message: {
          ephemeralMessage: {
            message: {
              extendedTextMessage: { text: 'ephemeral text' },
            },
          },
        },
      }],
    });
    await wait(2500);

    expect(getMockCalls().length).toBe(1);
    const content = getMockCalls()[0].content;
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
    expect(contentStr).toContain('ephemeral text');
  });
});
