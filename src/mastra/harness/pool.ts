import { Harness } from '@mastra/core/harness';
import type { HarnessEvent } from '@mastra/core/harness';
import { sharedConfig, type CoworkerHarness } from './index';

interface PendingState {
  question: Extract<HarnessEvent, { type: 'ask_question' }> | null;
  toolApproval: Extract<HarnessEvent, { type: 'tool_approval_required' }> | null;
  planApproval: Extract<HarnessEvent, { type: 'plan_approval_required' }> | null;
}

const EMPTY_PENDING: PendingState = { question: null, toolApproval: null, planApproval: null };

interface PoolEntry {
  harness: CoworkerHarness;
  threadId: string;
  channel: string;
  lastActivityAt: number;
  unsub: () => void;
  pending: PendingState;
  runBuffer: HarnessEvent[];
}

function updatePending(entry: PoolEntry, event: HarnessEvent): void {
  switch (event.type) {
    case 'ask_question':
      entry.pending.question = event;
      break;
    case 'tool_approval_required':
      entry.pending.toolApproval = event;
      break;
    case 'plan_approval_required':
      entry.pending.planApproval = event;
      break;
    case 'tool_end':
      if (entry.pending.toolApproval?.toolCallId === event.toolCallId)
        entry.pending.toolApproval = null;
      break;
    case 'plan_approved':
      entry.pending.planApproval = null;
      break;
    case 'agent_end':
      entry.pending = { ...EMPTY_PENDING };
      break;
  }
}

/** Buffer all events during an active run (user_message → agent_start → ... → agent_end). */
function bufferEvent(entry: PoolEntry, event: HarnessEvent): void {
  if ((event as any).type === 'user_message') {
    // User message starts the buffer — before agent_start
    entry.runBuffer = [event];
  } else if (event.type === 'agent_start') {
    // If buffer already has user_message, append; otherwise start fresh
    if (entry.runBuffer.length === 0) entry.runBuffer = [event];
    else entry.runBuffer.push(event);
  } else if (entry.runBuffer.length > 0) {
    entry.runBuffer.push(event);
    if (event.type === 'agent_end') {
      // Run finished — messages now persisted by Mastra, clear buffer
      entry.runBuffer = [];
    }
  }
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
const SWEEP_INTERVAL_MS = 60 * 1000;

type PoolListener = (threadId: string, event: HarnessEvent) => void;

class HarnessPool {
  private pool = new Map<string, PoolEntry>();
  private listeners: PoolListener[] = [];
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  /** Get or create a harness for a thread */
  async getOrCreate(threadId: string, channel = 'app'): Promise<PoolEntry> {
    const existing = this.pool.get(threadId);
    if (existing) {
      existing.lastActivityAt = Date.now();
      return existing;
    }

    const harness = new Harness({ id: `harness-${threadId}`, ...sharedConfig }) as CoworkerHarness;
    await harness.init();

    // Point the harness at this thread
    await harness.switchThread({ threadId });

    const entry: PoolEntry = {
      harness,
      threadId,
      channel,
      lastActivityAt: Date.now(),
      unsub: () => {},
      pending: { ...EMPTY_PENDING },
      runBuffer: [],
    };

    // Subscribe to all events — track pending state, buffer run events, then forward
    const unsub = harness.subscribe((event: HarnessEvent) => {
      updatePending(entry, event);
      bufferEvent(entry, event);
      for (const listener of this.listeners) {
        listener(threadId, event);
      }
    });
    entry.unsub = unsub;

    this.pool.set(threadId, entry);
    return entry;
  }

  /** Get existing harness (returns undefined if not in pool) */
  get(threadId: string): PoolEntry | undefined {
    return this.pool.get(threadId);
  }

  /** Touch activity timestamp */
  touch(threadId: string): void {
    const entry = this.pool.get(threadId);
    if (entry) entry.lastActivityAt = Date.now();
  }

  /** Send a message — emits user_message event, then delegates to harness (fire-and-forget) */
  send(threadId: string, content: string, images?: { data: string; mimeType: string }[]): void {
    const entry = this.pool.get(threadId);
    if (!entry) return;
    entry.lastActivityAt = Date.now();

    const userEvent = { type: 'user_message', content, createdAt: new Date().toISOString() } as any;
    bufferEvent(entry, userEvent);
    for (const listener of this.listeners) {
      listener(threadId, userEvent);
    }

    entry.harness.sendMessage({ content, images }).catch((err) => {
      console.error('[harness] sendMessage error:', err);
    });
  }

  /** Send a message and await completion — used by sendAndCapture utils */
  async sendAsync(threadId: string, content: string, images?: { data: string; mimeType: string }[]): Promise<void> {
    const entry = this.pool.get(threadId);
    if (!entry) throw new Error(`No pool entry for ${threadId}`);
    entry.lastActivityAt = Date.now();

    const userEvent = { type: 'user_message', content, createdAt: new Date().toISOString() } as any;
    bufferEvent(entry, userEvent);
    for (const listener of this.listeners) {
      listener(threadId, userEvent);
    }

    await entry.harness.sendMessage({ content, images });
  }

  /** Subscribe to events from ALL harnesses */
  subscribe(listener: PoolListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  /** Remove and clean up a harness */
  async remove(threadId: string): Promise<void> {
    const entry = this.pool.get(threadId);
    if (!entry) return;

    entry.unsub();
    try {
      await entry.harness.stopHeartbeats();
    } catch { /* ignore */ }
    try {
      await entry.harness.destroyWorkspace();
    } catch { /* ignore */ }
    this.pool.delete(threadId);
  }

  /** Start the idle sweeper */
  startSweeper(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
  }

  /** Stop the sweeper */
  stopSweeper(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** Create a new thread and add its harness to the pool */
  async createThread(title?: string, channel = 'app'): Promise<{ threadId: string; entry: PoolEntry }> {
    const harness = new Harness({ id: `harness-tmp-${Date.now()}`, ...sharedConfig }) as CoworkerHarness;
    await harness.init();
    const thread = await harness.createThread({ title });
    const threadId = thread.id;

    const entry: PoolEntry = {
      harness,
      threadId,
      channel,
      lastActivityAt: Date.now(),
      unsub: () => {},
      pending: { ...EMPTY_PENDING },
      runBuffer: [],
    };

    const unsub = harness.subscribe((event: HarnessEvent) => {
      updatePending(entry, event);
      bufferEvent(entry, event);
      for (const listener of this.listeners) {
        listener(threadId, event);
      }
    });
    entry.unsub = unsub;

    this.pool.set(threadId, entry);
    return { threadId, entry };
  }

  /** Get a harness for read-only operations (threads listing, etc.) — reuses first available or creates ephemeral */
  async getAnyHarness(): Promise<CoworkerHarness> {
    const first = this.pool.values().next();
    if (!first.done) return first.value.harness;
    // No active harnesses — create a temporary one
    const harness = new Harness({ id: 'harness-ephemeral', ...sharedConfig }) as CoworkerHarness;
    await harness.init();
    return harness;
  }

  /** Get thread status including pending interactive state and buffered run events */
  getStatus(threadId: string): { running: boolean; pending: PendingState; runBuffer: HarnessEvent[] } {
    const entry = this.pool.get(threadId);
    if (!entry) return { running: false, pending: { ...EMPTY_PENDING }, runBuffer: [] };
    return { running: entry.harness.isRunning(), pending: { ...entry.pending }, runBuffer: [...entry.runBuffer] };
  }

  /** Clear pending question (called when answer is submitted via route) */
  clearQuestion(threadId: string): void {
    const entry = this.pool.get(threadId);
    if (entry) entry.pending.question = null;
  }

  /** Clear pending tool approval */
  clearToolApproval(threadId: string): void {
    const entry = this.pool.get(threadId);
    if (entry) entry.pending.toolApproval = null;
  }

  /** Clear pending plan approval */
  clearPlanApproval(threadId: string): void {
    const entry = this.pool.get(threadId);
    if (entry) entry.pending.planApproval = null;
  }

  /** List all active entries */
  list(): { threadId: string; channel: string; running: boolean; lastActivityAt: number }[] {
    return Array.from(this.pool.values()).map((e) => ({
      threadId: e.threadId,
      channel: e.channel,
      running: e.harness.isRunning(),
      lastActivityAt: e.lastActivityAt,
    }));
  }

  private hasPending(entry: PoolEntry): boolean {
    return !!(entry.pending.question || entry.pending.toolApproval || entry.pending.planApproval);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [threadId, entry] of this.pool) {
      if (entry.harness.isRunning()) continue;
      if (this.hasPending(entry)) continue;
      if (now - entry.lastActivityAt < IDLE_TIMEOUT_MS) continue;
      console.log(`[harness-pool] sweeping idle harness for thread ${threadId}`);
      this.remove(threadId).catch((err) => {
        console.error(`[harness-pool] sweep error for ${threadId}:`, err);
      });
    }
  }
}

export const harnessPool = new HarnessPool();
