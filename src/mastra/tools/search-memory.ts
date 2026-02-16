import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { coworkerMemory } from '../agents/coworker-agent';

export const searchMemoryTool = createTool({
  id: 'search-memory',
  description:
    'Search your conversation memory for relevant past messages. Use this when you need to recall something from a previous conversation — a name, a decision, a preference, a project detail, etc.',
  inputSchema: z.object({
    query: z.string().describe('What to search for in memory. Be specific.'),
  }),
  execute: async ({ query }, context) => {
    const threadId = context?.agent?.threadId;
    const resourceId = context?.agent?.resourceId;

    if (!resourceId) {
      return { results: [], message: 'No resource context available' };
    }

    const { messages } = await coworkerMemory.recall({
      threadId: threadId || '__search__',
      resourceId,
      vectorSearchString: query,
      threadConfig: {
        semanticRecall: {
          topK: 5,
          messageRange: 1,
          scope: 'resource',
        },
        lastMessages: false,
      },
    });

    if (!messages.length) {
      return { results: [], message: 'No relevant memories found.' };
    }

    const results = messages.map((m: any) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      createdAt: m.createdAt,
      threadId: m.threadId,
    }));

    return { results, count: results.length };
  },
});
