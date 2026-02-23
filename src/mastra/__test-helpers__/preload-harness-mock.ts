/**
 * Preload file for bun test — establishes harness module mocks BEFORE
 * any test modules are evaluated. This prevents the real harness import
 * chain (which pulls in @mastra/core/harness, @mastra/libsql, fs-config, etc.)
 * from being evaluated at all.
 *
 * Referenced from bunfig.toml: [test] preload = ["./src/mastra/__test-helpers__/preload-harness-mock.ts"]
 */
import { mock } from 'bun:test';
import { createMockChannelHarness, mockHarnessPool } from './mock-harness';

// Mock the harness barrel export — prevents real harness/index.ts from loading
mock.module('../harness', () => ({
  createChannelHarness: (channelId: string) => createMockChannelHarness(channelId),
  harnessStorage: {
    // getStore('memory') returns the actual storage with listThreads
    getStore: async () => ({
      listThreads: async () => ({ threads: [] }),
    }),
  },
}));

// Mock the harness pool — prevents real pool from loading
mock.module('../harness/pool', () => ({
  harnessPool: mockHarnessPool,
}));

// Mock harness/utils — sendAndCapture reimplemented with threadId-based signature
const mockSendAndCapture = async (threadId: string, msgContent: string) => {
  const entry = mockHarnessPool.get(threadId);
  if (!entry) throw new Error(`No mock pool entry for ${threadId}`);
  const harness = entry.harness;
  const textParts: string[] = [];
  const unsub = harness.subscribe((event: Record<string, unknown>) => {
    if (event.type === 'message_end') {
      const msg = event.message as { content: { type: string; text: string }[] };
      for (const part of msg.content) {
        if (part.type === 'text') textParts.push(part.text);
      }
    }
  });
  try {
    await harness.sendMessage(msgContent);
    return textParts.join('\n').trim();
  } finally {
    (unsub as Function)();
  }
};

mock.module('../harness/utils', () => ({
  sendAndCapture: mockSendAndCapture,
  // Interactive version: same as sendAndCapture in tests (handlers are not exercised here)
  sendAndCaptureInteractive: async (threadId: string, msgContent: string, _handlers: unknown) => {
    return mockSendAndCapture(threadId, msgContent);
  },
}));
