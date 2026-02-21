import type { MessageChannel, SendOpts, SendResult, ChannelStatus } from '../messaging/router';
import type { WhatsAppBridge } from './whatsapp-bridge';
import { toWhatsAppJid } from './whatsapp-utils';

export class WhatsAppChannel implements MessageChannel {
  readonly id = 'whatsapp';

  constructor(
    private bridge: WhatsAppBridge,
    private statusFn: () => ChannelStatus,
  ) {}

  async send(to: string, text: string, opts?: SendOpts): Promise<SendResult> {
    const messageId = await this.bridge.sendOutbound(toWhatsAppJid(to), text, opts);
    return { ok: true, messageId };
  }

  getStatus(): ChannelStatus {
    return this.statusFn();
  }
}
