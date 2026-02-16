import { MCPServer } from "@mastra/mcp";
import { createTool } from "@mastra/core/tools";
import { createUIResource } from "@mcp-ui/server";
import { z } from "zod";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const AGENT_ID = process.env.AGENT_ID || "coworker";
const BASE_PATH = process.env.WORKSPACE_PATH || path.resolve("./workspaces");
const APPS_DIR = path.join(BASE_PATH, AGENT_ID, "apps");

/** Scan the apps directory and return folder names that contain an index.html */
async function listAppDirs(): Promise<string[]> {
  try {
    const entries = await readdir(APPS_DIR, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const htmlPath = path.join(APPS_DIR, entry.name, "index.html");
        await stat(htmlPath);
        names.push(entry.name);
      } catch {
        // no index.html — skip
      }
    }
    return names;
  } catch {
    // apps directory doesn't exist yet
    return [];
  }
}

const viewAppTool = createTool({
  id: "view_app",
  description:
    "View an app built in the workspace. Returns interactive UI rendered inline.",
  inputSchema: z.object({
    name: z.string().describe("App folder name in /workspace/apps/"),
  }),
  execute: async ({ name }) => {
    const safeName = path.basename(name);
    const htmlPath = path.join(APPS_DIR, safeName, "index.html");
    const html = await readFile(htmlPath, "utf-8");
    const resource = createUIResource({
      uri: `ui://coworker/apps/${safeName}`,
      content: { type: "rawHtml", htmlString: html },
      encoding: "text",
    });
    return resource;
  },
});

export const coworkerMcpServer = new MCPServer({
  id: "coworker-mcp",
  name: "Coworker",
  version: "1.0.0",
  description:
    "An AI team member that helps with tasks, answers questions, and manages workflows.",
  tools: { view_app: viewAppTool },
  resources: {
    listResources: async () => {
      const names = await listAppDirs();
      return names.map((name) => ({
        uri: `ui://coworker/apps/${name}`,
        name,
        mimeType: "text/html" as const,
      }));
    },
    getResourceContent: async ({ uri }) => {
      const match = uri.match(/^ui:\/\/coworker\/apps\/(.+)$/);
      if (!match) return { text: "" };
      const name = path.basename(match[1]);
      const htmlPath = path.join(APPS_DIR, name, "index.html");
      const html = await readFile(htmlPath, "utf-8");
      return { text: html };
    },
  },
});
