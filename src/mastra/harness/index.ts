import { Harness } from '@mastra/core/harness';
import { createWorkspaceTools } from '@mastra/core/workspace';
import { coworkerAgent } from '../agents/coworker/agent';
import { DEFAULT_MODEL } from '../config/agent-config';
import { getDynamicWorkspace } from '../agents/coworker/workspace';
import { subagents } from '../agents/subagents';
import { resolveModel } from '../agents/coworker/model';
import { stateSchema } from './schema';
import { getToolCategory } from './permissions';
import { getDynamicMemory } from './memory';
import { getMcpToolsets } from '../mcp';
import { viewImageTool } from './tools/view-image';
import { storage } from '../db';

const AGENT_ID = process.env.AGENT_ID || 'coworker';

/** Concrete harness type used across the app (parameterized with our stateSchema) */
export type CoworkerHarness = Harness<typeof stateSchema>;

// Re-export so whatsapp-bridge and other consumers can still import from here
export const harnessStorage = storage;

export const sharedConfig = {
  resourceId: AGENT_ID,
  storage: harnessStorage,
  stateSchema,
  initialState: {
    yolo: true,
  },
  memory: getDynamicMemory(harnessStorage) as any, // Dynamic factory — Harness resolves at runtime
  workspace: getDynamicWorkspace,
  toolCategoryResolver: getToolCategory,
  modes: [
    { id: 'build' as const, name: 'Build', default: true as const, agent: coworkerAgent, defaultModelId: DEFAULT_MODEL },
    { id: 'plan' as const, name: 'Plan', agent: coworkerAgent, defaultModelId: DEFAULT_MODEL },
    { id: 'fast' as const, name: 'Fast', agent: coworkerAgent, defaultModelId: DEFAULT_MODEL },
  ],
  tools: async ({ requestContext }: { requestContext: any }) => {
    const mcpTools = await getMcpToolsets();
    const wsTools = createWorkspaceTools(getDynamicWorkspace({ requestContext }));
    return { ...mcpTools, ...wsTools, view_image: viewImageTool };
  },
  subagents,
  resolveModel,
};

/** Create a channel-specific harness (same resourceId, isolated session state) */
export function createChannelHarness(channelId: string) {
  return new Harness({ id: `harness-${channelId}`, ...sharedConfig });
}
