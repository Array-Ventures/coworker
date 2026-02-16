import type { InputProcessor } from '@mastra/core/processors';

/**
 * No-op input processor that claims the "semantic-recall" id.
 * This prevents Memory from auto-injecting recalled messages on input
 * (dedup check in Memory.getInputProcessors), while the output processor
 * (message indexing into the vector store) remains active.
 */
export const noOpSemanticRecall: InputProcessor = {
  id: 'semantic-recall',
  name: 'NoOpSemanticRecall',
  async processInput({ messageList }) {
    return messageList;
  },
};
