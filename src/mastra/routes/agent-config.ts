import { registerApiRoute } from '@mastra/core/server';
import type { AgentConfigManager } from '../config/agent-config';

export function agentConfigRoutes(agentConfig: AgentConfigManager) {
  return [
    registerApiRoute('/agent-config', {
      method: 'GET',
      handler: async (c) => {
        const config = await agentConfig.getConfig();
        return c.json(config);
      },
    }),
    registerApiRoute('/agent-config', {
      method: 'PUT',
      handler: async (c) => {
        const body = await c.req.json();
        if (body.model !== undefined) {
          if (body.model === null || body.model === '') {
            await agentConfig.delete('model');
          } else {
            await agentConfig.set('model', body.model);
          }
        }
        if (body.instructions !== undefined) {
          if (body.instructions === null || body.instructions === '') {
            await agentConfig.delete('instructions');
          } else {
            await agentConfig.set('instructions', body.instructions);
          }
        }
        if (body.sandboxEnv !== undefined) {
          if (body.sandboxEnv === null) {
            agentConfig.delete('sandbox_env');
          } else {
            agentConfig.set('sandbox_env', JSON.stringify(body.sandboxEnv));
          }
        }
        const config = await agentConfig.getConfig();
        return c.json(config);
      },
    }),
  ];
}
