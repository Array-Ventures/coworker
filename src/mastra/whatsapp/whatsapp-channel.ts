import type { MessageChannel, SendOpts, SendResult, ChannelStatus } from '../messaging/router';
import type { WhatsAppBridge } from './whatsapp-bridge';
import { toWhatsAppJid } from './whatsapp-utils';

type Pool = { query: (sql: string, params?: unknown[]) => Promise<any> };

export class WhatsAppChannel implements MessageChannel {
  readonly id = 'whatsapp';

  constructor(
    private bridge: WhatsAppBridge,
    private statusFn: () => ChannelStatus,
    private pool: Pool,
  ) {}

  async send(to: string, text: string, opts?: SendOpts): Promise<SendResult> {
    const jid = await this.resolveJid(to);
    const messageId = await this.bridge.sendOutbound(jid, text, opts);
    return { ok: true, messageId };
  }

  getStatus(): ChannelStatus {
    return this.statusFn();
  }

  /** Resolve a phone number or JID to the correct Baileys JID. */
  private async resolveJid(to: string): Promise<string> {
    // Already a full JID — pass through
    if (to.includes('@')) return to;

    // Normalize to +digits for DB lookup
    const phone = to.startsWith('+') ? to : `+${to.replace(/[^0-9]/g, '')}`;

    // Look up stored raw_jid from allowlist (handles LID contacts)
    const result = await this.pool.query(
      'SELECT raw_jid FROM whatsapp_allowlist WHERE phone_number = $1',
      [phone],
    );
    if (result.rows.length === 0) {
      throw new Error(`Contact ${phone} not in allowlist`);
    }
    const rawJid = result.rows[0].raw_jid as string | null;
    if (rawJid) return rawJid;

    // Allowlisted but no raw_jid stored — use standard format
    return toWhatsAppJid(to);
  }
}
