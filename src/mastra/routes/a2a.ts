import { registerApiRoute } from '@mastra/core/server';
import { AGENT_ID } from '../config/agent-config';

export const a2aRoutes = [
  registerApiRoute('/a2a-info', {
    method: 'GET',
    handler: async (c) => {
      return c.json({
        agentId: AGENT_ID,
        endpoints: {
          a2a: `/api/a2a/${AGENT_ID}`,
          agentCard: `/api/.well-known/${AGENT_ID}/agent-card.json`,
        },
      });
    },
  }),
];
