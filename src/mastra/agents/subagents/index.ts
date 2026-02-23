/**
 * Subagent registry — exports subagent definitions for Harness configuration.
 *
 * Workspace tools are provided via `allowedHarnessTools` which pulls from the
 * harness's shared `tools` config (includes workspace tools alongside MCP tools).
 * This uses the framework's intended mechanism — no workaround needed.
 */
import type { HarnessSubagent } from '@mastra/core/harness';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { searchMemoryTool } from '../../tools/search-memory';
import { exploreSubagent } from './explore';
import { executeSubagent } from './execute';
import { planSubagent } from './plan';

const { FILESYSTEM, SANDBOX, SEARCH } = WORKSPACE_TOOLS;

/** Read-only workspace tools for explore/plan subagents */
const READ_ONLY_WS_TOOLS = [
  FILESYSTEM.READ_FILE,
  FILESYSTEM.LIST_FILES,
  FILESYSTEM.FILE_STAT,
  FILESYSTEM.GREP,
  SEARCH.SEARCH,
];

/** All workspace tools for execute subagent */
const ALL_WS_TOOLS = [
  ...Object.values(FILESYSTEM),
  ...Object.values(SANDBOX),
  ...Object.values(SEARCH),
];

/**
 * Convert our SubagentDefinition to HarnessSubagent format.
 * The Harness auto-creates a `subagent` built-in tool from these definitions.
 */
export const subagents: HarnessSubagent[] = [
  {
    id: exploreSubagent.id,
    name: exploreSubagent.name,
    description: 'Read-only codebase exploration and research. Use for finding files, understanding patterns, and answering questions about the codebase.',
    instructions: exploreSubagent.instructions,
    tools: { searchMemory: searchMemoryTool },
    allowedHarnessTools: READ_ONLY_WS_TOOLS,
  },
  {
    id: planSubagent.id,
    name: planSubagent.name,
    description: 'Read-only analysis and planning. Use for producing detailed implementation plans after exploring the codebase.',
    instructions: planSubagent.instructions,
    tools: { searchMemory: searchMemoryTool },
    allowedHarnessTools: READ_ONLY_WS_TOOLS,
  },
  {
    id: executeSubagent.id,
    name: executeSubagent.name,
    description: 'Focused task execution with full tool access. Use for implementing specific, well-defined changes.',
    instructions: executeSubagent.instructions,
    tools: { searchMemory: searchMemoryTool },
    allowedHarnessTools: ALL_WS_TOOLS,
  },
];
