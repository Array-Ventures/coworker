export interface SendOpts {
  replyTo?: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface ChannelStatus {
  connected: boolean;
  account?: string;
}

export interface ChannelInfo {
  id: string;
  status: ChannelStatus;
}

export interface MessageChannel {
  id: string;
  send(to: string, text: string, opts?: SendOpts): Promise<SendResult>;
  getStatus(): ChannelStatus;
}

export class MessageRouter {
  private channels = new Map<string, MessageChannel>();

  register(id: string, channel: MessageChannel): void {
    this.channels.set(id, channel);
  }

  unregister(id: string): void {
    this.channels.delete(id);
  }

  async send(channel: string, to: string, text: string, opts?: SendOpts): Promise<SendResult> {
    const ch = this.channels.get(channel);
    if (!ch) return { ok: false, error: `Unknown channel: ${channel}` };
    try {
      return await ch.send(to, text, opts);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  listChannels(): ChannelInfo[] {
    return [...this.channels.values()].map(ch => ({
      id: ch.id,
      status: ch.getStatus(),
    }));
  }
}

/** Shared singleton used by API routes and channel adapters */
export const messageRouter = new MessageRouter();
