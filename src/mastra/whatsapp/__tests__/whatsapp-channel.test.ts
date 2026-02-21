import { describe, expect, test, mock } from 'bun:test';
import { WhatsAppChannel } from '../whatsapp-channel';
import type { ChannelStatus } from '../../messaging/router';

function createMockBridge() {
  return {
    sendOutbound: mock(async (_to: string, _text: string, _opts?: any) => 'msg-123'),
  };
}

function createMockPool(rows: any[] = []) {
  return {
    query: mock(async () => ({ rows })),
  };
}

describe('WhatsAppChannel', () => {
  // ── JID Resolution ──

  test('send() resolves phone to stored LID JID from allowlist', async () => {
    const bridge = createMockBridge();
    const pool = createMockPool([{ raw_jid: '54941422981120@lid' }]);
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), pool);

    const result = await channel.send('+54941422981120', 'Hello');

    expect(result).toEqual({ ok: true, messageId: 'msg-123' });
    expect(bridge.sendOutbound).toHaveBeenCalledWith('54941422981120@lid', 'Hello', undefined);
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT raw_jid FROM whatsapp_allowlist WHERE phone_number = $1',
      ['+54941422981120'],
    );
  });

  test('send() uses standard JID when allowlisted but no raw_jid stored', async () => {
    const bridge = createMockBridge();
    const pool = createMockPool([{ raw_jid: null }]);
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), pool);

    const result = await channel.send('+1234567890', 'Hi');

    expect(result).toEqual({ ok: true, messageId: 'msg-123' });
    expect(bridge.sendOutbound).toHaveBeenCalledWith('1234567890@s.whatsapp.net', 'Hi', undefined);
  });

  test('send() rejects phone not in allowlist', async () => {
    const bridge = createMockBridge();
    const pool = createMockPool([]);  // no rows = not in allowlist
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), pool);

    await expect(channel.send('+9999999999', 'Hi')).rejects.toThrow('Contact +9999999999 not in allowlist');
    expect(bridge.sendOutbound).not.toHaveBeenCalled();
  });

  test('send() passes through raw JID without DB lookup', async () => {
    const bridge = createMockBridge();
    const pool = createMockPool();
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), pool);

    await channel.send('54941422981120@lid', 'Direct');

    expect(bridge.sendOutbound).toHaveBeenCalledWith('54941422981120@lid', 'Direct', undefined);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('send() passes through standard JID without DB lookup', async () => {
    const bridge = createMockBridge();
    const pool = createMockPool();
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), pool);

    await channel.send('1234567890@s.whatsapp.net', 'Hi');

    expect(bridge.sendOutbound).toHaveBeenCalledWith('1234567890@s.whatsapp.net', 'Hi', undefined);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('send() passes through group JID without DB lookup', async () => {
    const bridge = createMockBridge();
    const pool = createMockPool();
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), pool);

    await channel.send('120363001234@g.us', 'Group msg');

    expect(bridge.sendOutbound).toHaveBeenCalledWith('120363001234@g.us', 'Group msg', undefined);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('send() propagates DB errors', async () => {
    const bridge = createMockBridge();
    const pool = { query: mock(async () => { throw new Error('connection refused'); }) };
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), pool);

    await expect(channel.send('+1234567890', 'Hi')).rejects.toThrow('connection refused');
    expect(bridge.sendOutbound).not.toHaveBeenCalled();
  });

  test('send() normalizes bare digits to +digits for lookup', async () => {
    const bridge = createMockBridge();
    const pool = createMockPool([{ raw_jid: '1234567890@s.whatsapp.net' }]);
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), pool);

    await channel.send('1234567890', 'Hi');

    expect(pool.query).toHaveBeenCalledWith(
      'SELECT raw_jid FROM whatsapp_allowlist WHERE phone_number = $1',
      ['+1234567890'],
    );
  });

  test('send() forwards opts to bridge', async () => {
    const bridge = createMockBridge();
    const pool = createMockPool([{ raw_jid: '1234567890@s.whatsapp.net' }]);
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), pool);
    const opts = { replyTo: 'msg-1' };

    await channel.send('+1234567890', 'Reply', opts);

    expect(bridge.sendOutbound).toHaveBeenCalledWith('1234567890@s.whatsapp.net', 'Reply', opts);
  });

  test('send() propagates bridge errors (router catches them)', async () => {
    const bridge = createMockBridge();
    bridge.sendOutbound = mock(async () => { throw new Error('Socket closed'); });
    const pool = createMockPool([{ raw_jid: '1234567890@s.whatsapp.net' }]);
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), pool);

    await expect(channel.send('+1234567890', 'Hi')).rejects.toThrow('Socket closed');
  });

  // ── Status ──

  test('getStatus() delegates to statusFn', () => {
    const bridge = createMockBridge();
    const pool = createMockPool();
    const status: ChannelStatus = { connected: true, account: '+1234567890' };
    const channel = new WhatsAppChannel(bridge as any, () => status, pool);

    expect(channel.getStatus()).toEqual(status);
  });

  test('getStatus() reflects dynamic state changes', () => {
    const bridge = createMockBridge();
    const pool = createMockPool();
    let connected = true;
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected }), pool);

    expect(channel.getStatus().connected).toBe(true);
    connected = false;
    expect(channel.getStatus().connected).toBe(false);
  });

  test('id is whatsapp', () => {
    const bridge = createMockBridge();
    const pool = createMockPool();
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }), pool);
    expect(channel.id).toBe('whatsapp');
  });
});
