import { describe, expect, test, mock } from 'bun:test';
import { WhatsAppChannel } from '../whatsapp-channel';
import type { ChannelStatus } from '../../messaging/router';

function createMockBridge() {
  return {
    sendOutbound: mock(async (_to: string, _text: string, _opts?: any) => 'msg-123'),
  };
}

describe('WhatsAppChannel', () => {
  test('send() normalizes phone to JID and delegates to bridge', async () => {
    const bridge = createMockBridge();
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }));

    const result = await channel.send('+1234567890', 'Hello');

    expect(result).toEqual({ ok: true, messageId: 'msg-123' });
    expect(bridge.sendOutbound).toHaveBeenCalledWith('1234567890@s.whatsapp.net', 'Hello', undefined);
  });

  test('send() passes through existing JID', async () => {
    const bridge = createMockBridge();
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }));

    await channel.send('1234567890@s.whatsapp.net', 'Hi');

    expect(bridge.sendOutbound).toHaveBeenCalledWith('1234567890@s.whatsapp.net', 'Hi', undefined);
  });

  test('send() forwards opts to bridge', async () => {
    const bridge = createMockBridge();
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }));
    const opts = { replyTo: 'msg-1' };

    await channel.send('+1234567890', 'Reply', opts);

    expect(bridge.sendOutbound).toHaveBeenCalledWith('1234567890@s.whatsapp.net', 'Reply', opts);
  });

  test('send() propagates bridge errors (router catches them)', async () => {
    const bridge = createMockBridge();
    bridge.sendOutbound = mock(async () => { throw new Error('Socket closed'); });
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }));

    await expect(channel.send('+1234567890', 'Hi')).rejects.toThrow('Socket closed');
  });

  test('getStatus() delegates to statusFn', () => {
    const bridge = createMockBridge();
    const status: ChannelStatus = { connected: true, account: '+1234567890' };
    const channel = new WhatsAppChannel(bridge as any, () => status);

    expect(channel.getStatus()).toEqual(status);
  });

  test('getStatus() reflects dynamic state changes', () => {
    const bridge = createMockBridge();
    let connected = true;
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected }));

    expect(channel.getStatus().connected).toBe(true);
    connected = false;
    expect(channel.getStatus().connected).toBe(false);
  });

  test('id is whatsapp', () => {
    const bridge = createMockBridge();
    const channel = new WhatsAppChannel(bridge as any, () => ({ connected: true }));
    expect(channel.id).toBe('whatsapp');
  });
});
