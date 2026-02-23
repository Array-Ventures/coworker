import { agentConfig } from "../../config/agent-config";
import type { RequestContext } from "@mastra/core/request-context";
import type { HarnessRequestContext } from "@mastra/core/harness";
import type { MastraLanguageModel } from "@mastra/core/agent";
import { ModelRouterLanguageModel } from "@mastra/core/llm";

/**
 * Dynamic model selection for the coworker agent.
 * When called from Harness context, uses Harness state model.
 * Falls back to DB-backed config for non-Harness callers (scheduled tasks, WhatsApp).
 */
export async function getModel(params?: { requestContext?: RequestContext }): Promise<string> {
  // If called from Harness context, use Harness state model
  const harnessCtx = params?.requestContext?.get('harness') as HarnessRequestContext | undefined;
  if (harnessCtx?.state?.currentModelId) {
    return harnessCtx.state.currentModelId;
  }
  // Fallback to DB config
  return agentConfig.getModel();
}

/**
 * Resolve a model ID string to a language model instance.
 * Used by the Harness for subagents and OM model resolution.
 *
 * Routes through Mastra's ModelRouter which handles provider detection
 * and API key lookup via models.dev gateway. For local providers
 * (lmstudio, ollama) it passes the appropriate base URL.
 */
export function resolveModel(modelId: string): MastraLanguageModel {
  const url = getModelUrl(modelId);
  if (url) {
    return new ModelRouterLanguageModel({ id: modelId as `${string}/${string}`, url, apiKey: 'not-needed' });
  }
  return new ModelRouterLanguageModel(modelId);
}

/** Map known local/custom providers to their base URLs via env vars */
function getModelUrl(modelId: string): string | undefined {
  const provider = modelId.split('/')[0];
  switch (provider) {
    case 'lmstudio':
      return process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1';
    case 'ollama':
      return process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
    default:
      return process.env.MODEL_BASE_URL;
  }
}
