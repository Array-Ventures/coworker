import { describe, expect, test, afterEach } from 'bun:test';
import { WhatsAppBridge } from '../whatsapp-bridge';
import { createMockAgent, createMockMastra } from '../../__test-helpers__/mock-mastra';
import { createMockSocket } from '../../__test-helpers__/mock-socket';
import { createMockPool, type QueryStub } from '../../__test-helpers__/mock-pool';

// ── Helpers ──

const ALLOWED_JID = '1234567890@s.whatsapp.net';
const ALLOWED_PHONE = '+1234567890';
const GROUP_JID = '120363001234567890@g.us';
const PARTICIPANT_JID = '1234567890@s.whatsapp.net';
const BOT_JID = '1234567890:1@s.whatsapp.net';

const allowlistStub: QueryStub = {
  match: /whatsapp_allowlist/,
  result: { rows: [{ phone_number: ALLOWED_PHONE }] },
};

const emptyAllowlistStub: QueryStub = {
  match: /whatsapp_allowlist/,
  result: { rows: [] },
};

const pairingStub: QueryStub = {
  match: /whatsapp_pairing/,
  result: { rows: [] },
};

function makeWAMessage(text: string, remoteJid = ALLOWED_JID) {
  return {
    key: { id: `msg-${Date.now()}-${Math.random()}`, remoteJid, fromMe: false },
    message: { conversation: text },
  };
}

function makeGroupMessage(text: string, opts?: { participant?: string; mentioned?: boolean; quoted?: string }) {
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
          mentionedJid: opts?.mentioned ? [BOT_JID] : [],
          ...(opts?.quoted ? { quotedMessage: { conversation: opts.quoted } } : {}),
        },
      },
    },
    pushName: 'Test User',
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
}

const groupAllowlistStub: QueryStub = {
  match: /whatsapp_groups/,
  result: { rows: [{ group_jid: GROUP_JID, enabled: true }] },
};

const emptyGroupAllowlistStub: QueryStub = {
  match: /whatsapp_groups/,
  result: { rows: [] },
};

// Track bridges for cleanup — prevents timer leaks between tests
const activeBridges: WhatsAppBridge[] = [];

afterEach(() => {
  for (const bridge of activeBridges) bridge.detach();
  activeBridges.length = 0;
});

function createBridge(opts: {
  generateResult?: { text?: string };
  generateDelay?: number;
  shouldHang?: boolean;
  shouldThrow?: Error;
  presenceHangs?: boolean;
  allowed?: boolean;
  groupAllowed?: boolean;
  extraStubs?: QueryStub[];
} = {}) {
  const { agent, generateCalls } = createMockAgent({
    generateResult: opts.generateResult ?? { text: 'reply' },
    generateDelay: opts.generateDelay,
    shouldHang: opts.shouldHang,
    shouldThrow: opts.shouldThrow,
  });
  const mastra = createMockMastra({ coworkerAgent: agent });
  const { socket, sentMessages, presenceUpdates } = createMockSocket({
    presenceHangs: opts.presenceHangs,
  });
  const stubs: QueryStub[] = [
    opts.allowed !== false ? allowlistStub : emptyAllowlistStub,
    pairingStub,
  ];
  if (opts.groupAllowed === true) stubs.push(groupAllowlistStub);
  if (opts.groupAllowed === false) stubs.push(emptyGroupAllowlistStub);
  if (opts.extraStubs) stubs.push(...opts.extraStubs);
  const { pool, queries } = createMockPool(stubs);

  const bridge = new WhatsAppBridge(mastra as any, socket as any, pool as any);
  bridge.attach();
  activeBridges.push(bridge);

  return { bridge, agent, generateCalls, socket, sentMessages, presenceUpdates, queries, pool };
}

/** Create + register a bridge from manual mocks (for custom pool, etc.) */
function registerBridge(bridge: WhatsAppBridge) {
  activeBridges.push(bridge);
  return bridge;
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Debounce: rapid messages combined ──

describe('message debouncing', () => {
  test('single message processes after debounce window', async () => {
    const { generateCalls, socket } = createBridge();
    const msg = makeWAMessage('hello');

    socket.ev.emit('messages.upsert', { messages: [msg] });

    // Should NOT process immediately
    await wait(100);
    expect(generateCalls.length).toBe(0);

    // Should process after debounce (2s)
    await wait(2100);
    expect(generateCalls.length).toBe(1);
    expect(generateCalls[0].messages[0].role).toBe('user');
    expect(generateCalls[0].messages[0].content).toContain('hello');
  });

  test('two rapid messages combined into single agent call', async () => {
    const { generateCalls, socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('create folders')] });
    await wait(500);
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('each app can be a gh repo')] });

    await wait(2500);
    expect(generateCalls.length).toBe(1);
    expect(generateCalls[0].messages[0].content).toContain('create folders\neach app can be a gh repo');
  });

  test('three rapid messages all combined', async () => {
    const { generateCalls, socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('msg1')] });
    await wait(200);
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('msg2')] });
    await wait(200);
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('msg3')] });

    await wait(2500);
    expect(generateCalls.length).toBe(1);
    expect(generateCalls[0].messages[0].content).toContain('msg1\nmsg2\nmsg3');
  });

  test('messages from different contacts are independent', async () => {
    const { generateCalls, socket } = createBridge();
    const jid1 = '1111111111@s.whatsapp.net';
    const jid2 = '2222222222@s.whatsapp.net';

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('from contact 1', jid1)] });
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('from contact 2', jid2)] });

    await wait(2500);
    expect(generateCalls.length).toBe(2);
  });
});

// ── Abort: new message during processing ──

describe('abort on new message during processing', () => {
  test('message during processing aborts and restarts with combined text', async () => {
    const { generateCalls, socket } = createBridge({ generateDelay: 3000 });

    // Message 1 arrives, debounce fires, processing starts
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('first message')] });
    await wait(2200);
    expect(generateCalls.length).toBe(1);

    // Message 2 arrives while agent is processing
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('second message')] });
    await wait(100); // let async isAllowed() + bufferMessage() complete

    // The first call's abortSignal should have been triggered
    expect(generateCalls[0].options?.abortSignal?.aborted).toBe(true);

    // Wait for: abort completes + debounce (2s) + processing
    await wait(2500);

    // After abort + debounce, a new generate call with the second message
    expect(generateCalls.length).toBe(2);
    expect(generateCalls[1].messages[0].content).toContain('second message');
  });
});

// ── Fire-and-forget presence ──

describe('presence updates are fire-and-forget', () => {
  test('hanging presence does NOT block message processing', async () => {
    const { generateCalls, socket } = createBridge({ presenceHangs: true });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('test')] });
    await wait(2500);

    expect(generateCalls.length).toBe(1);
  });
});

// ── Agent timeout ──

describe('agent timeout', () => {
  test('hanging agent has abortSignal for timeout', async () => {
    const { generateCalls, socket } = createBridge({ shouldHang: true });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('test')] });
    await wait(2200);

    expect(generateCalls.length).toBe(1);
    expect(generateCalls[0].options?.abortSignal).toBeDefined();
  });
});

// ── Reply behavior ──

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

// ── Allowlist ──

describe('allowlist enforcement', () => {
  test('non-allowed contact gets pairing code, not agent', async () => {
    const { generateCalls, sentMessages, socket } = createBridge({ allowed: false });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hi')] });
    await wait(2500);

    expect(generateCalls.length).toBe(0);
    expect(sentMessages.some((m) => (m.content.text ?? '').includes('pair'))).toBe(true);
  });
});

// ── Message filtering ──

describe('message filtering', () => {
  test('skips fromMe messages', async () => {
    const { generateCalls, socket } = createBridge();

    socket.ev.emit('messages.upsert', {
      messages: [{
        key: { id: 'msg-1', remoteJid: ALLOWED_JID, fromMe: true },
        message: { conversation: 'my own message' },
      }],
    });
    await wait(2500);
    expect(generateCalls.length).toBe(0);
  });

  test('skips empty messages', async () => {
    const { generateCalls, socket } = createBridge();

    socket.ev.emit('messages.upsert', {
      messages: [{
        key: { id: 'msg-1', remoteJid: ALLOWED_JID, fromMe: false },
        message: { conversation: '   ' },
      }],
    });
    await wait(2500);
    expect(generateCalls.length).toBe(0);
  });

  test('skips messages with no content', async () => {
    const { generateCalls, socket } = createBridge();

    socket.ev.emit('messages.upsert', {
      messages: [{
        key: { id: 'msg-1', remoteJid: ALLOWED_JID, fromMe: false },
        message: null,
      }],
    });
    await wait(2500);
    expect(generateCalls.length).toBe(0);
  });
});

// ── detach cleanup ──

describe('detach', () => {
  test('detach clears all state and stops processing', async () => {
    const { bridge, generateCalls, socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hello')] });
    await wait(500); // buffered but not yet flushed

    bridge.detach();

    await wait(2500); // would have flushed, but detached
    expect(generateCalls.length).toBe(0);
  });
});

// ── Thread ID format ──

describe('thread creation', () => {
  test('uses whatsapp-{phone} thread ID', async () => {
    const { generateCalls, socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('test')] });
    await wait(2500);

    expect(generateCalls.length).toBe(1);
    expect(generateCalls[0].options?.memory?.thread?.id).toBe(`whatsapp-${ALLOWED_PHONE}`);
  });

  test('passes correct memory structure to agent', async () => {
    const { generateCalls, socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('test')] });
    await wait(2500);

    const opts = generateCalls[0].options;
    expect(opts.memory.thread.title).toBe(`WhatsApp: ${ALLOWED_PHONE}`);
    expect(opts.memory.thread.metadata).toEqual({ type: 'whatsapp', phone: ALLOWED_PHONE });
    expect(opts.memory.resource).toBe('coworker');
    expect(opts.abortSignal).toBeDefined();
  });
});

// ── Agent error handling ──

describe('agent errors', () => {
  test('agent.generate() throwing non-abort error is caught and logged', async () => {
    const { generateCalls, sentMessages, socket } = createBridge({
      shouldThrow: new Error('LLM API rate limit'),
    });

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('test')] });
    await wait(2500);

    expect(generateCalls.length).toBe(1);
    expect(sentMessages.length).toBe(0);
  });

  test('missing agent does not crash', async () => {
    const mastra = createMockMastra({}); // empty — no agents
    const { socket, sentMessages } = createMockSocket();
    const { pool } = createMockPool([allowlistStub, pairingStub]);

    const bridge = registerBridge(
      new WhatsAppBridge(mastra as any, socket as any, pool as any),
    );
    bridge.attach();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hello')] });
    await wait(2500);

    expect(sentMessages.length).toBe(0);
  });

  test('agent returning undefined text does not send reply', async () => {
    const { sentMessages, socket } = createBridge({
      generateResult: { text: undefined as any },
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

// ── Presence updates ──

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

// ── Sequential processing after abort ──

describe('sequential message flows', () => {
  test('second batch processes after first completes normally', async () => {
    const { generateCalls, socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('batch 1')] });
    await wait(2500);
    expect(generateCalls.length).toBe(1);

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('batch 2')] });
    await wait(2500);
    expect(generateCalls.length).toBe(2);
    expect(generateCalls[1].messages[0].content).toContain('batch 2');
  }, 10_000);

  test('multiple abort cycles work correctly', async () => {
    const { generateCalls, socket } = createBridge({ generateDelay: 3000 });

    // First message starts processing
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('msg A')] });
    await wait(2200);
    expect(generateCalls.length).toBe(1);

    // Abort with second message
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('msg B')] });
    await wait(200);

    // Wait for second debounce + processing start
    await wait(2200);
    expect(generateCalls.length).toBe(2);

    // Abort again with third message
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('msg C')] });
    await wait(200);
    expect(generateCalls[1].options?.abortSignal?.aborted).toBe(true);

    // Wait for third debounce + processing
    await wait(2500);
    expect(generateCalls.length).toBe(3);
    expect(generateCalls[2].messages[0].content).toContain('msg C');
  }, 15_000);
});

// ── Group and special JID filtering ──

describe('JID filtering', () => {
  test('skips group messages from non-allowlisted groups (@g.us)', async () => {
    const { generateCalls, socket } = createBridge();

    socket.ev.emit('messages.upsert', {
      messages: [{
        key: { id: 'msg-1', remoteJid: '120363001234567890@g.us', fromMe: false },
        message: { conversation: 'group message' },
      }],
    });
    await wait(2500);
    expect(generateCalls.length).toBe(0);
  });

  test('skips messages with no remoteJid', async () => {
    const { generateCalls, socket } = createBridge();

    socket.ev.emit('messages.upsert', {
      messages: [{
        key: { id: 'msg-1', remoteJid: undefined, fromMe: false },
        message: { conversation: 'orphan message' },
      }],
    });
    await wait(2500);
    expect(generateCalls.length).toBe(0);
  });
});

// ── Echo dedup via SentMessageTracker ──

describe('sent message echo dedup', () => {
  test('reply messages are tracked and skipped on echo', async () => {
    const { generateCalls, sentMessages, socket } = createBridge({
      generateResult: { text: 'bot reply' },
    });

    // Real message → agent → reply
    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('user msg')] });
    await wait(2500);
    expect(sentMessages.length).toBe(1);
    expect(generateCalls.length).toBe(1);

    // Simulate the reply echoing back as a fromMe message
    const echoMsgId = `mock-msg-${sentMessages.length}`;
    socket.ev.emit('messages.upsert', {
      messages: [{
        key: { id: echoMsgId, remoteJid: ALLOWED_JID, fromMe: true },
        message: { conversation: 'bot reply' },
      }],
    });
    await wait(2500);

    // Echo was deduped — still just 1 agent call
    expect(generateCalls.length).toBe(1);
  }, 10_000);
});

// ── DB failure on allowlist ──

describe('DB failures', () => {
  test('allowlist DB error rejects message (fail-closed)', async () => {
    const { generateCalls } = createMockAgent({ generateResult: { text: 'reply' } });
    const mastra = createMockMastra({ coworkerAgent: { generate: async () => ({ text: 'reply' }) } });
    const { socket, sentMessages } = createMockSocket();
    const pool = { query: async () => { throw new Error('connection refused'); } };

    const bridge = registerBridge(
      new WhatsAppBridge(mastra as any, socket as any, pool as any),
    );
    bridge.attach();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hello')] });
    await wait(2500);

    expect(generateCalls.length).toBe(0);
    expect(sentMessages.length).toBe(0);
  });
});

// ── Batch messages in single upsert event ──

describe('batch upsert events', () => {
  test('multiple messages in single upsert event are all processed', async () => {
    const { generateCalls, socket } = createBridge();

    // Baileys can deliver multiple messages in a single upsert
    socket.ev.emit('messages.upsert', {
      messages: [
        makeWAMessage('batch msg 1'),
        makeWAMessage('batch msg 2'),
      ],
    });
    await wait(2500);

    // Both debounced into single call (same JID, within debounce window)
    expect(generateCalls.length).toBe(1);
    expect(generateCalls[0].messages[0].content).toContain('batch msg 1\nbatch msg 2');
  });
});

// ── Group message handling ──

describe('group message handling', () => {
  test('group message from allowlisted group is processed', async () => {
    const { generateCalls, socket } = createBridge({ groupAllowed: true });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hello group')] });
    await wait(2500);

    expect(generateCalls.length).toBe(1);
  });

  test('group message from non-allowlisted group is ignored', async () => {
    const { generateCalls, sentMessages, socket } = createBridge({ groupAllowed: false });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hello group')] });
    await wait(2500);

    expect(generateCalls.length).toBe(0);
    // No pairing code sent for groups
    expect(sentMessages.length).toBe(0);
  });

  test('group message with bot mention sends agent response to group JID', async () => {
    const { generateCalls, sentMessages, socket } = createBridge({
      groupAllowed: true,
      generateResult: { text: 'group reply' },
    });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hey @bot help', { mentioned: true })] });
    await wait(2500);

    expect(generateCalls.length).toBe(1);
    expect(sentMessages.some((m) => m.jid === GROUP_JID && m.content.text === 'group reply')).toBe(true);
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
    const { generateCalls, socket } = createBridge({ groupAllowed: true });
    const participant2 = '9999999999@s.whatsapp.net';

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('from user 1')] });
    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('from user 2', { participant: participant2 })] });

    await wait(2500);

    // Two independent debounce keys → two separate agent calls
    expect(generateCalls.length).toBe(2);
  });

  test('group thread ID = whatsapp-group-{groupJid} with correct metadata', async () => {
    const { generateCalls, socket } = createBridge({ groupAllowed: true });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('test', { mentioned: true })] });
    await wait(2500);

    expect(generateCalls.length).toBe(1);
    const opts = generateCalls[0].options;
    expect(opts.memory.thread.id).toBe(`whatsapp-group-${GROUP_JID}`);
    expect(opts.memory.thread.metadata.type).toBe('whatsapp-group');
  });
});

// ── Mention immediate flush ──

describe('mention immediate flush', () => {
  test('mentioned message processes faster than 2s debounce', async () => {
    const { generateCalls, socket } = createBridge({ groupAllowed: true });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hey @bot', { mentioned: true })] });

    // Should process before 2s debounce window
    await wait(500);
    expect(generateCalls.length).toBe(1);
  });

  test('non-mentioned message still uses 2s debounce', async () => {
    const { generateCalls, socket } = createBridge({ groupAllowed: true });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('just chatting')] });

    // Should NOT process before debounce
    await wait(500);
    expect(generateCalls.length).toBe(0);

    // Should process after debounce
    await wait(2200);
    expect(generateCalls.length).toBe(1);
  });
});

// ── <no-reply/> directive ──

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

// ── Message envelope ──

describe('message envelope', () => {
  test('DM messages include <message-context> XML in agent input content', async () => {
    const { generateCalls, socket } = createBridge();

    socket.ev.emit('messages.upsert', { messages: [makeWAMessage('hello')] });
    await wait(2500);

    expect(generateCalls.length).toBe(1);
    const content = generateCalls[0].messages[0].content;
    expect(content).toContain('<message-context');
  });

  test('group messages include envelope with group info and mentioned flag', async () => {
    const { generateCalls, socket } = createBridge({ groupAllowed: true });

    socket.ev.emit('messages.upsert', { messages: [makeGroupMessage('hey @bot', { mentioned: true })] });
    await wait(2500);

    expect(generateCalls.length).toBe(1);
    const content = generateCalls[0].messages[0].content;
    expect(content).toContain('<message-context');
    expect(content).toContain('group');
    expect(content).toContain('mentioned');
  });

  test('quoted/reply messages include <quoted> in envelope', async () => {
    const { generateCalls, socket } = createBridge({ groupAllowed: true });

    socket.ev.emit('messages.upsert', {
      messages: [makeGroupMessage('replying to this', { mentioned: true, quoted: 'original message text' })],
    });
    await wait(2500);

    expect(generateCalls.length).toBe(1);
    const content = generateCalls[0].messages[0].content;
    expect(content).toContain('<quoted>');
    expect(content).toContain('original message text');
  });
});

// ── sendOutbound ──

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
