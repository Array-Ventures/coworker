import type { ScheduledTaskManager } from '../scheduled-tasks';
import type { WhatsAppManager } from '../whatsapp/whatsapp-manager';
import type { AgentConfigManager } from '../config/agent-config';
import { harnessRoutes } from './harness';
import { agentConfigRoutes } from './agent-config';
import { scheduledTaskRoutes } from './scheduled-tasks';
import { whatsappRoutes } from './whatsapp';
import { googleRoutes } from './google';
import { githubRoutes } from './github';
import { mcpRoutes } from './mcp';
import { messagingRoutes } from './messaging';
import { skillsRoutes } from './skills';
import { a2aRoutes } from './a2a';

export function createRoutes(deps: {
  taskManager: ScheduledTaskManager;
  whatsAppManager: WhatsAppManager;
  agentConfig: AgentConfigManager;
}) {
  return [
    ...harnessRoutes,
    ...agentConfigRoutes(deps.agentConfig),
    ...scheduledTaskRoutes(deps.taskManager),
    ...whatsappRoutes(deps.whatsAppManager),
    ...googleRoutes,
    ...githubRoutes,
    ...mcpRoutes(deps.agentConfig),
    ...messagingRoutes(deps.whatsAppManager),
    ...skillsRoutes,
    ...a2aRoutes,
  ];
}
