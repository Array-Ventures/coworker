import { describe, expect, test, mock } from 'bun:test';
import { MessageRouter } from '../router';
import type { MessageChannel, SendOpts, SendResult, ChannelStatus } from '../router';

function createMockChannel(id: string, opts?: { connected?: boolean; account?: string }) {
  const sentMessages: { to: string; text: string; opts?: SendOpts }[] = [];
  return {
    channel: {
      id,
      send: mock(async (to: string, text: string, sendOpts?: SendOpts): Promise<SendResult> => {
        sentMessages.push({ to, text, opts: sendOpts });
        return { ok: true, messageId: `${id}-msg-${sentMessages.length}` };
      }),
      getStatus: mock((): ChannelStatus => ({
        connected: opts?.connected ?? true,
        account: opts && 'account' in opts ? opts.account : '+1234567890',
      })),
    } satisfies MessageChannel,
    sentMessages,
  };
}

describe('MessageRouter', () => {
  test('register() adds channel and listChannels() returns it with status', () => {
    const router = new MessageRouter();
    const { channel } = createMockChannel('whatsapp', { connected: true, account: '+1234567890' });

    router.register(channel.id, channel);

    const channels = router.listChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0]).toEqual({
      id: 'whatsapp',
      status: { connected: true, account: '+1234567890' },
    });
  });

  test('unregister() removes channel from listChannels()', () => {
    const router = new MessageRouter();
    const { channel } = createMockChannel('whatsapp');

    router.register(channel.id, channel);
    router.unregister('whatsapp');

    expect(router.listChannels()).toHaveLength(0);
  });

  test('send() delegates to correct channel with all args', async () => {
    const router = new MessageRouter();
    const { channel, sentMessages } = createMockChannel('whatsapp');

    router.register(channel.id, channel);

    const result = await router.send('whatsapp', '+9876543210', 'Hello!', { replyTo: 'msg-1' });

    expect(result).toEqual({ ok: true, messageId: 'whatsapp-msg-1' });
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(sentMessages).toEqual([
      { to: '+9876543210', text: 'Hello!', opts: { replyTo: 'msg-1' } },
    ]);
  });

  test('send() to unknown channel returns error result', async () => {
    const router = new MessageRouter();

    const result = await router.send('telegram', '+1111111111', 'Hi');

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
  });

  test('send() propagates channel errors gracefully without throwing', async () => {
    const router = new MessageRouter();
    const { channel } = createMockChannel('whatsapp');
    channel.send = mock(async () => {
      throw new Error('Network timeout');
    });

    router.register(channel.id, channel);

    const result = await router.send('whatsapp', '+1234567890', 'Hello');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Network timeout');
  });

  test('multiple channels registered simultaneously are each independently callable', async () => {
    const router = new MessageRouter();
    const wa = createMockChannel('whatsapp');
    const sms = createMockChannel('sms');

    router.register(wa.channel.id, wa.channel);
    router.register(sms.channel.id, sms.channel);

    const waResult = await router.send('whatsapp', '+1111', 'WA message');
    const smsResult = await router.send('sms', '+2222', 'SMS message');

    expect(waResult).toEqual({ ok: true, messageId: 'whatsapp-msg-1' });
    expect(smsResult).toEqual({ ok: true, messageId: 'sms-msg-1' });
    expect(wa.sentMessages).toHaveLength(1);
    expect(sms.sentMessages).toHaveLength(1);
    expect(wa.sentMessages[0].to).toBe('+1111');
    expect(sms.sentMessages[0].to).toBe('+2222');
  });

  test('listChannels() returns status from each channel getStatus()', () => {
    const router = new MessageRouter();
    const wa = createMockChannel('whatsapp', { connected: true, account: '+1111' });
    const sms = createMockChannel('sms', { connected: false, account: undefined });

    router.register(wa.channel.id, wa.channel);
    router.register(sms.channel.id, sms.channel);

    const channels = router.listChannels();
    expect(channels).toHaveLength(2);

    const waInfo = channels.find(c => c.id === 'whatsapp');
    const smsInfo = channels.find(c => c.id === 'sms');

    expect(waInfo?.status).toEqual({ connected: true, account: '+1111' });
    expect(smsInfo?.status).toEqual({ connected: false, account: undefined });
    expect(wa.channel.getStatus).toHaveBeenCalled();
    expect(sms.channel.getStatus).toHaveBeenCalled();
  });

  test('registering same channel ID twice overwrites the first', async () => {
    const router = new MessageRouter();
    const first = createMockChannel('whatsapp', { account: '+1111' });
    const second = createMockChannel('whatsapp', { account: '+2222' });

    router.register(first.channel.id, first.channel);
    router.register(second.channel.id, second.channel);

    expect(router.listChannels()).toHaveLength(1);

    await router.send('whatsapp', '+9999', 'Test');

    expect(first.sentMessages).toHaveLength(0);
    expect(second.sentMessages).toHaveLength(1);
  });

  test('send() passes opts.media to channel', async () => {
    const router = new MessageRouter();
    const { channel, sentMessages } = createMockChannel('whatsapp');

    router.register(channel.id, channel);

    const media = [{ type: 'image' as const, data: Buffer.from('test'), mimeType: 'image/jpeg' }];
    const result = await router.send('whatsapp', '+1234567890', 'caption', { media });

    expect(result.ok).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].opts?.media).toBeDefined();
    expect(sentMessages[0].opts!.media![0].type).toBe('image');
  });

  test('channel receives media payload correctly', async () => {
    const router = new MessageRouter();
    const { channel, sentMessages } = createMockChannel('whatsapp');

    router.register(channel.id, channel);

    const media = [
      { type: 'document' as const, data: Buffer.from('pdf-data'), mimeType: 'application/pdf', fileName: 'test.pdf' },
    ];
    await router.send('whatsapp', '+1234567890', '', { media });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].opts?.media![0].mimeType).toBe('application/pdf');
    expect(sentMessages[0].opts?.media![0].fileName).toBe('test.pdf');
  });
});
