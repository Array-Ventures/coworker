import { MCPServer } from "@mastra/mcp";
import { coworkerAgent } from "../agents/coworker-agent";

export const coworkerMcpServer = new MCPServer({
  id: "coworker-mcp",
  name: "Coworker",
  version: "1.0.0",
  description:
    "An AI team member that helps with tasks, answers questions, and manages workflows.",
  tools: {},
});
