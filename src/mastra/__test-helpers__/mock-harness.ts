/**
 * Mock harness for unit tests.
 *
 * Replaces createChannelHarness from ../harness with a mock that tracks
 * all sendMessage calls, thread creation, and abort signals.
 *
 * Usage:
 *   configureMockHarness({ responseText: 'Hello' });
 *   // ... trigger messages ...
 *   expect(getMockCalls()[0].content).toContain('user text');
 */

export interface MockHarnessConfig {
  responseText: string;
  delay: number;
  shouldHang: boolean;
  shouldThrow: Error | null;
}

export interface MockHarnessCall {
  content: string;
  aborted: boolean;
}

const DEFAULT_CONFIG: MockHarnessConfig = {
  responseText: 'reply',
  delay: 0,
  shouldHang: false,
  shouldThrow: null,
};

// Module-level state shared between mock factory and tests
let _config: MockHarnessConfig = { ...DEFAULT_CONFIG };
const _calls: MockHarnessCall[] = [];
const _instances: MockHarnessInstance[] = [];

/** Set config that new mock harness sendMessage calls will use. */
export function configureMockHarness(config: Partial<MockHarnessConfig>): void {
  _config = { ...DEFAULT_CONFIG, ...config };
}

/** Clear all tracked calls and instances. Call in afterEach or before each test. */
export function resetMockHarnessState(): void {
  _config = { ...DEFAULT_CONFIG };
  _calls.length = 0;
  _instances.length = 0;
  _poolMap.clear();
  _getCalls.length = 0;
}

/** Get all sendMessage calls across all mock harness instances. */
export function getMockCalls(): readonly MockHarnessCall[] {
  return _calls;
}

/** Get all created mock harness instances. */
export function getMockInstances(): readonly MockHarnessInstance[] {
  return _instances;
}

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export class MockHarnessInstance {
  readonly channelId: string;
  readonly threadTitles: string[] = [];
  private listeners: ((event: Record<string, unknown>) => void)[] = [];
  private _rejectPending: (() => void) | null = null;

  constructor(channelId: string) {
    this.channelId = channelId;
  }

  async init(): Promise<void> {}

  async createThread(opts?: { title?: string }): Promise<{ id: string }> {
    this.threadTitles.push(opts?.title ?? '');
    return { id: `mock-thread-${Date.now()}` };
  }

  async setThreadSetting(_opts: { key: string; value: unknown }): Promise<void> {}

  async listThreads(_opts?: any): Promise<{ threads: any[] }> {
    return { threads: [] };
  }

  async switchThread(_opts?: { threadId?: string }): Promise<void> {}

  subscribe(listener: (event: Record<string, unknown>) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  async sendMessage(content: string): Promise<void> {
    const call: MockHarnessCall = { content, aborted: false };
    _calls.push(call);

    // Snapshot config at call time so per-test config works
    const config = { ..._config };

    if (config.shouldHang) {
      return new Promise<void>((_, reject) => {
        this._rejectPending = () => {
          call.aborted = true;
          reject(abortError());
        };
      });
    }

    if (config.delay) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, config.delay);
        this._rejectPending = () => {
          clearTimeout(timer);
          call.aborted = true;
          reject(abortError());
        };
      });
    }

    this._rejectPending = null;

    if (config.shouldThrow) throw config.shouldThrow;

    // Fire message_end to subscribers (before resolving, matching real harness behavior)
    // If responseText is undefined/null, send empty content (mimics agent returning no text)
    const messageParts = config.responseText != null
      ? [{ type: 'text' as const, text: config.responseText }]
      : [];
    const event = {
      type: 'message_end' as const,
      message: {
        id: `mock-${Date.now()}`,
        role: 'assistant' as const,
        content: messageParts,
      },
    };
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  abort(): void {
    if (this._rejectPending) {
      this._rejectPending();
      this._rejectPending = null;
    }
  }
}

/** Factory function — used as the mock for createChannelHarness. */
export function createMockChannelHarness(channelId: string): MockHarnessInstance {
  const instance = new MockHarnessInstance(channelId);
  _instances.push(instance);
  return instance;
}

/** Mock harness pool — mimics harnessPool from ../harness/pool */
const _poolMap = new Map<string, { harness: MockHarnessInstance; threadId: string; channel: string; lastActivityAt: number; unsub: () => void }>();
const _getCalls: string[] = [];

/** Get all keys passed to mockHarnessPool.get() — useful for verifying lookup keys. */
export function getMockPoolGetCalls(): readonly string[] {
  return _getCalls;
}

export const mockHarnessPool = {
  async getOrCreate(threadId: string, channel = 'app') {
    const existing = _poolMap.get(threadId);
    if (existing) {
      existing.lastActivityAt = Date.now();
      return existing;
    }
    const instance = createMockChannelHarness(threadId);
    const entry = { harness: instance, threadId, channel, lastActivityAt: Date.now(), unsub: () => {} };
    _poolMap.set(threadId, entry);
    return entry;
  },
  get(threadId: string) {
    _getCalls.push(threadId);
    return _poolMap.get(threadId);
  },
  touch(_threadId: string) {},
  subscribe(_listener: Function) { return () => {}; },
  async remove(_threadId: string) { _poolMap.delete(_threadId); },
  startSweeper() {},
  stopSweeper() {},
  list() { return []; },
  async createThread(title?: string, channel = 'app') {
    const threadId = `mock-thread-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const instance = createMockChannelHarness(threadId);
    // Forward title to instance.createThread — matches real HarnessPool behavior
    await instance.createThread({ title });
    const entry = { harness: instance, threadId, channel, lastActivityAt: Date.now(), unsub: () => {} };
    _poolMap.set(threadId, entry);
    return { threadId, entry };
  },
  async getAnyHarness() {
    // Don't register in _instances — ephemeral harnesses are for read-only ops (listThreads, etc.)
    return new MockHarnessInstance('ephemeral');
  },
};
