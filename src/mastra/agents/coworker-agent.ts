import { Agent } from "@mastra/core/agent";
import {
  Workspace,
  LocalFilesystem,
  LocalSandbox,
} from "@mastra/core/workspace";
import path from "path";
import { agentConfig } from "../agent-config";
import { coworkerMemory } from "../memory";
import { noOpSemanticRecall } from "../processors/no-op-semantic-recall";
import { searchMemoryTool } from "../tools/search-memory";

const AGENT_ID = process.env.AGENT_ID || "coworker";
const BASE_PATH = process.env.WORKSPACE_PATH || path.resolve("./workspaces");
const SHARED_PATH = path.join(BASE_PATH, "shared");
const AGENT_PATH = path.join(BASE_PATH, AGENT_ID);
const SKILLS_PATH = path.join(BASE_PATH, "skills");
const GOG_HOME = process.env.GOG_HOME || process.env.HOME || "/data";

function buildWorkspace() {
  const detection = LocalSandbox.detectIsolation();

  return new Workspace({
    mounts: {
      "/shared": new LocalFilesystem({ basePath: SHARED_PATH }),
      "/workspace": new LocalFilesystem({ basePath: AGENT_PATH }),
      "/.agents/skills": new LocalFilesystem({ basePath: SKILLS_PATH }),
    },
    skills: ['.agents/skills'],
    sandbox: new LocalSandbox({
      workingDirectory: AGENT_PATH,
      env: {
        PATH: process.env.PATH!,
        HOME: GOG_HOME,
        GOG_KEYRING_BACKEND: 'file',
        GOG_KEYRING_PASSWORD: process.env.GOG_KEYRING_PASSWORD || '',
      },
      isolation: detection.available ? detection.backend : "none",
      nativeSandbox: {
        allowNetwork: true,
        allowSystemBinaries: true,
        readWritePaths: [SHARED_PATH, SKILLS_PATH],
      },
    }),
  });
}

export const coworkerAgent = new Agent({
  id: AGENT_ID,
  name: "Coworker",
  description: "An AI team member that helps with tasks, answers questions, and manages workflows.",
  instructions: async () => agentConfig.getInstructions(),
  model: async () => agentConfig.getModel(),
  tools: { searchMemory: searchMemoryTool },
  workspace: buildWorkspace,
  memory: coworkerMemory,
  // Block auto-recall injection while keeping output indexing active.
  // The agent uses the searchMemory tool to recall messages agentically.
  inputProcessors: [noOpSemanticRecall],
  defaultOptions: async () => ({
    maxSteps: 20,
    toolsets: await agentConfig.getMcpToolsets(),
  }),
});
