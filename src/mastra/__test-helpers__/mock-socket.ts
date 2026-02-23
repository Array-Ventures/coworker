/**
 * Mock Baileys WhatsApp socket for unit tests.
 *
 * Usage:
 *   const { socket, sentMessages, presenceUpdates } = createMockSocket();
 */

import { EventEmitter } from 'node:events';
import { mock } from 'bun:test';

export interface SentMessage {
  jid: string;
  content: { text?: string; [key: string]: unknown };
}

export interface PresenceUpdate {
  type: string;
  jid: string;
}

export interface MockSocketOptions {
  /** Make sendPresenceUpdate hang forever (for testing fire-and-forget) */
  presenceHangs?: boolean;
}

let messageIdCounter = 0;

export function createMockSocket(opts: MockSocketOptions = {}) {
  const sentMessages: SentMessage[] = [];
  const presenceUpdates: PresenceUpdate[] = [];
  const ev = new EventEmitter();

  const socket = {
    ev,
    sendMessage: mock(async (jid: string, content: { text?: string; [key: string]: unknown }) => {
      sentMessages.push({ jid, content });
      return { key: { id: `mock-msg-${++messageIdCounter}` } };
    }),
    sendPresenceUpdate: mock(async (type: string, jid: string) => {
      presenceUpdates.push({ type, jid });
      if (opts.presenceHangs) {
        return new Promise<void>(() => {}); // never resolves
      }
    }),
    groupMetadata: mock(async (jid: string) => ({
      id: jid,
      subject: 'Test Group',
      participants: [{ id: '1234567890@s.whatsapp.net', admin: null }],
    })),
    user: { id: '1234567890:1@s.whatsapp.net', lid: '214542927831175:0@lid' },
  };

  return { socket, sentMessages, presenceUpdates, ev };
}
