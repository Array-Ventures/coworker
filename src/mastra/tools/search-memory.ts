import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getSemanticRecall, coworkerMemory } from '../memory';

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

    try {
      const semanticRecall = await getSemanticRecall();

      // Use the same performSemanticSearch that the built-in processors use.
      // This ensures consistent vector index naming (no dimension mismatch).
      const messages = await (semanticRecall as any).performSemanticSearch({
        query,
        threadId: threadId || '__search__',
        resourceId,
      });

      if (!messages || messages.length === 0) {
        return { results: [], message: 'No relevant memories found.' };
      }

      // Look up thread titles for context
      const uniqueThreadIds = [...new Set(messages.map((m: any) => m.threadId).filter(Boolean))];
      const titleMap: Record<string, string> = {};
      await Promise.all(
        uniqueThreadIds.map(async (tid: string) => {
          try {
            const thread = await coworkerMemory.getThreadById({ threadId: tid });
            if (thread?.title) titleMap[tid] = thread.title;
          } catch { /* skip */ }
        }),
      );

      const results = messages.map((m: any) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        createdAt: m.createdAt,
        threadId: m.threadId,
        threadTitle: titleMap[m.threadId] || undefined,
      }));

      return { results, count: results.length };
    } catch (err: any) {
      return { results: [], message: `Memory search failed: ${err.message}` };
    }
  },
});
