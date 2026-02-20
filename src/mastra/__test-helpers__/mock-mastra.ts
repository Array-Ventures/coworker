/**
 * Mock Mastra instance and agent for unit tests.
 *
 * Usage:
 *   const { agent, generateCalls } = createMockAgent({ generateResult: { text: 'Hello' } });
 *   const mastra = createMockMastra({ coworkerAgent: agent });
 */

import { mock } from 'bun:test';

export interface MockAgentOptions {
  /** What agent.generate() resolves with. Defaults to { text: '' } */
  generateResult?: { text?: string; [key: string]: unknown };
  /** Artificial delay in ms before resolving */
  generateDelay?: number;
  /** Make generate() reject with this error */
  shouldThrow?: Error;
  /** Make generate() never resolve (for timeout tests). Respects abortSignal. */
  shouldHang?: boolean;
}

export interface GenerateCall {
  messages: unknown[];
  options: any;
}

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export function createMockAgent(opts: MockAgentOptions = {}) {
  const generateCalls: GenerateCall[] = [];

  const generate = mock(async (messages: unknown[], options?: any) => {
    generateCalls.push({ messages, options });
    const signal = options?.abortSignal as AbortSignal | undefined;

    if (opts.shouldHang) {
      return new Promise((_, reject) => {
        if (signal?.aborted) { reject(abortError()); return; }
        signal?.addEventListener('abort', () => reject(abortError()));
        // Never resolves otherwise
      });
    }

    if (opts.generateDelay) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, opts.generateDelay);
        if (signal?.aborted) {
          clearTimeout(timer);
          reject(abortError());
          return;
        }
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(abortError());
        });
      });
    }

    if (opts.shouldThrow) throw opts.shouldThrow;

    return { text: '', ...opts.generateResult };
  });

  const agent = { generate };
  return { agent, generateCalls };
}

export function createMockMastra(agents: Record<string, unknown> = {}) {
  return {
    getAgent: mock((name: string) => agents[name] ?? null),
  };
}
