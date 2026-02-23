import type { HarnessRequestContext } from '@mastra/core/harness';
import type { RequestContext } from '@mastra/core/request-context';
import type { MastraCompositeStore } from '@mastra/core/storage';
import { Memory } from '@mastra/memory';
import { fastembed } from '@mastra/fastembed';
import { LibSQLVector } from '@mastra/libsql';
import { workingMemorySchema } from '../memory';
import { DB_URL } from '../db';
import type { stateSchema } from './schema';

const DEFAULT_OBS_THRESHOLD = 30_000;
const DEFAULT_REF_THRESHOLD = 40_000;
const DEFAULT_OM_MODEL = 'nvidia/moonshotai/kimi-k2.5';

let cachedMemory: Memory | null = null;
let cachedMemoryKey: string | null = null;

/**
 * Read harness state from requestContext.
 * Used by both the memory factory and the OM model functions.
 */
function getHarnessState(requestContext: RequestContext) {
  return (requestContext.get('harness') as HarnessRequestContext<typeof stateSchema> | undefined)?.getState?.();
}

/**
 * Dynamic memory factory function.
 * Reads OM thresholds from harness state via requestContext.
 * Working memory (persona + org) is always enabled.
 */
export function getDynamicMemory(storage: MastraCompositeStore) {
  const vector = new LibSQLVector({ id: 'harness-vector', url: DB_URL });

  return ({ requestContext }: { requestContext: RequestContext }) => {
    const state = getHarnessState(requestContext);

    const obsThreshold = state?.observationThreshold ?? DEFAULT_OBS_THRESHOLD;
    const refThreshold = state?.reflectionThreshold ?? DEFAULT_REF_THRESHOLD;
    const omScope = (process.env.MASTRA_OM_SCOPE === 'thread' ? 'thread' : 'resource') as 'thread' | 'resource';

    const cacheKey = `${obsThreshold}:${refThreshold}:${omScope}`;
    if (cachedMemory && cachedMemoryKey === cacheKey) {
      return cachedMemory;
    }

    cachedMemory = new Memory({
      storage,
      options: {
        generateTitle: true,
        semanticRecall: true,
        workingMemory: {
          enabled: true,
          schema: workingMemorySchema,
        },
        observationalMemory: {
          model: DEFAULT_OM_MODEL,
          scope: omScope,
          observation: {
            messageTokens: obsThreshold,
          },
          reflection: {
            observationTokens: refThreshold,
          },
        },
      },
      embedder: fastembed,
      vector,
    });
    cachedMemoryKey = cacheKey;

    return cachedMemory;
  };
}
