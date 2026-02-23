import { describe, expect, test, mock } from 'bun:test';
import { WhatsAppChannel } from '../whatsapp-channel';
import type { ChannelStatus } from '../../messaging/router';
import { WhatsAppStore, type AllowlistEntry, type WhatsAppData } from '../whatsapp-store';

function makeStoreData(allowlist: AllowlistEntry[] = []): WhatsAppData {
  return { allowlist, pairings: [], config: {}, groups: [] };
}

function createMockBridge() {
  return {
    sendOutbound: mock(async (_to: string, _text: string, _opts?: any) => 'msg-123'),
  };
}

function createChannel(bridge: ReturnType<typeof createMockBridge>, opts: { allowlist?: AllowlistEntry[] } = {}) {
  const store = new WhatsAppStore(makeStoreData(opts.allowlist ?? []));
  const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), store);
  return { channel, store };
}

describe('WhatsAppChannel', () => {
  // -- JID Resolution --

  test('send() resolves phone to stored LID JID from allowlist', async () => {
    const bridge = createMockBridge();
    const { channel } = createChannel(bridge, {
      allowlist: [{ phoneNumber: '+54941422981120', rawJid: '54941422981120@lid', label: null, createdAt: new Date().toISOString() }],
    });

    const result = await channel.send('+54941422981120', 'Hello');

    expect(result).toEqual({ ok: true, messageId: 'msg-123' });
    expect(bridge.sendOutbound).toHaveBeenCalledWith('54941422981120@lid', 'Hello', undefined);
  });

  test('send() uses standard JID when allowlisted but no raw_jid stored', async () => {
    const bridge = createMockBridge();
    const { channel } = createChannel(bridge, {
      allowlist: [{ phoneNumber: '+1234567890', rawJid: null, label: null, createdAt: new Date().toISOString() }],
    });

    const result = await channel.send('+1234567890', 'Hi');

    expect(result).toEqual({ ok: true, messageId: 'msg-123' });
    expect(bridge.sendOutbound).toHaveBeenCalledWith('1234567890@s.whatsapp.net', 'Hi', undefined);
  });

  test('send() rejects phone not in allowlist', async () => {
    const bridge = createMockBridge();
    const { channel } = createChannel(bridge);

    await expect(channel.send('+9999999999', 'Hi')).rejects.toThrow('Contact +9999999999 not in allowlist');
    expect(bridge.sendOutbound).not.toHaveBeenCalled();
  });

  test('send() passes through raw JID without store lookup', async () => {
    const bridge = createMockBridge();
    const store = new WhatsAppStore(makeStoreData());
    const spy = mock(() => store.getAllowlistEntry.call(store));
    store.getAllowlistEntry = spy as any;
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), store);

    await channel.send('54941422981120@lid', 'Direct');

    expect(bridge.sendOutbound).toHaveBeenCalledWith('54941422981120@lid', 'Direct', undefined);
    expect(spy).not.toHaveBeenCalled();
  });

  test('send() passes through standard JID without store lookup', async () => {
    const bridge = createMockBridge();
    const store = new WhatsAppStore(makeStoreData());
    const spy = mock(() => store.getAllowlistEntry.call(store));
    store.getAllowlistEntry = spy as any;
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), store);

    await channel.send('1234567890@s.whatsapp.net', 'Hi');

    expect(bridge.sendOutbound).toHaveBeenCalledWith('1234567890@s.whatsapp.net', 'Hi', undefined);
    expect(spy).not.toHaveBeenCalled();
  });

  test('send() passes through group JID without store lookup', async () => {
    const bridge = createMockBridge();
    const store = new WhatsAppStore(makeStoreData());
    const spy = mock(() => store.getAllowlistEntry.call(store));
    store.getAllowlistEntry = spy as any;
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), store);

    await channel.send('120363001234@g.us', 'Group msg');

    expect(bridge.sendOutbound).toHaveBeenCalledWith('120363001234@g.us', 'Group msg', undefined);
    expect(spy).not.toHaveBeenCalled();
  });

  test('send() propagates store errors', async () => {
    const bridge = createMockBridge();
    const store = new WhatsAppStore(makeStoreData());
    store.getAllowlistEntry = () => { throw new Error('disk error'); };
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), store);

    await expect(channel.send('+1234567890', 'Hi')).rejects.toThrow('disk error');
    expect(bridge.sendOutbound).not.toHaveBeenCalled();
  });

  test('send() normalizes bare digits to +digits for lookup', async () => {
    const bridge = createMockBridge();
    const { channel } = createChannel(bridge, {
      allowlist: [{ phoneNumber: '+1234567890', rawJid: '1234567890@s.whatsapp.net', label: null, createdAt: new Date().toISOString() }],
    });

    await channel.send('1234567890', 'Hi');

    // Verify the bridge received the correct JID resolved from allowlist
    expect(bridge.sendOutbound).toHaveBeenCalledWith('1234567890@s.whatsapp.net', 'Hi', undefined);
  });

  test('send() forwards opts to bridge', async () => {
    const bridge = createMockBridge();
    const { channel } = createChannel(bridge, {
      allowlist: [{ phoneNumber: '+1234567890', rawJid: '1234567890@s.whatsapp.net', label: null, createdAt: new Date().toISOString() }],
    });
    const opts = { replyTo: 'msg-1' };

    await channel.send('+1234567890', 'Reply', opts);

    expect(bridge.sendOutbound).toHaveBeenCalledWith('1234567890@s.whatsapp.net', 'Reply', opts);
  });

  test('send() propagates bridge errors (router catches them)', async () => {
    const bridge = createMockBridge();
    bridge.sendOutbound = mock(async () => { throw new Error('Socket closed'); });
    const { channel } = createChannel(bridge, {
      allowlist: [{ phoneNumber: '+1234567890', rawJid: '1234567890@s.whatsapp.net', label: null, createdAt: new Date().toISOString() }],
    });

    await expect(channel.send('+1234567890', 'Hi')).rejects.toThrow('Socket closed');
  });

  // -- Status --

  test('getStatus() delegates to statusFn', () => {
    const bridge = createMockBridge();
    const store = new WhatsAppStore(makeStoreData());
    const status: ChannelStatus = { connected: true, account: '+1234567890' };
    const channel = new WhatsAppChannel(bridge as any, () => status, store);

    expect(channel.getStatus()).toEqual(status);
  });

  test('getStatus() reflects dynamic state changes', () => {
    const bridge = createMockBridge();
    const store = new WhatsAppStore(makeStoreData());
    let connected = true;
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected }), store);

    expect(channel.getStatus().connected).toBe(true);
    connected = false;
    expect(channel.getStatus().connected).toBe(false);
  });

  test('id is whatsapp', () => {
    const bridge = createMockBridge();
    const store = new WhatsAppStore(makeStoreData());
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), store);
    expect(channel.id).toBe('whatsapp');
  });
});
