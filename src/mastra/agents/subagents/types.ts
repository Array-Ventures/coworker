/**
 * Subagent type definitions.
 *
 * A subagent is a lightweight Agent instance with a constrained tool set,
 * spawned by the parent agent via the built-in `subagent` tool. Each subagent
 * runs in its own conversation thread and returns a single text result.
 */

export interface SubagentDefinition {
  /** Unique identifier for this subagent type (e.g., "explore", "plan") */
  id: string;

  /** Human-readable name shown in tool output */
  name: string;

  /** System prompt for this subagent */
  instructions: string;

  /**
   * Which harness-level tool IDs this subagent may use.
   * These are keys from the harness's shared `tools` config
   * (e.g., MCP toolsets).
   */
  allowedHarnessTools?: string[];
}
