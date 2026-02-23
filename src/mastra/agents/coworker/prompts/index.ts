/**
 * Prompt system — exports the prompt builder and mode-specific prompts.
 */

export { buildBasePrompt } from './base';
export { buildModePrompt, buildModePromptFn } from './build';
export { planModePrompt } from './plan';
export { fastModePrompt } from './fast';

import { buildBasePrompt } from './base';
import type { PromptContext as BasePromptContext } from './base';
import { buildModePromptFn } from './build';
import { fastModePrompt } from './fast';
import { planModePrompt } from './plan';

// Extended prompt context that includes runtime information
export interface PromptContext extends BasePromptContext {
  modeId: string;
  state?: any;
}

const modePrompts: Record<string, string | ((ctx: PromptContext) => string)> = {
  build: buildModePromptFn,
  plan: planModePrompt,
  fast: fastModePrompt,
};

/**
 * Build the full system prompt for a given mode and context.
 * Combines the base prompt with mode-specific instructions.
 */
export function buildFullPrompt(ctx: PromptContext): string {
  // Map extended context to base context
  const baseCtx: BasePromptContext = {
    date: ctx.date,
    mode: ctx.modeId,
    platform: ctx.platform,
    activePlan: ctx.state?.activePlan,
  };

  const base = buildBasePrompt(baseCtx);
  const entry = modePrompts[ctx.modeId] || modePrompts.build;
  const modeSpecific = typeof entry === 'function' ? entry(ctx) : entry;

  // Inject current task state so agent doesn't lose track after OM truncation
  let taskSection = '';
  const tasks = ctx.state?.tasks as { content: string; status: string; activeForm: string }[] | undefined;
  if (tasks && tasks.length > 0) {
    const lines = tasks.map(t => {
      const icon = t.status === 'completed' ? '\u2713' : t.status === 'in_progress' ? '\u25B8' : '\u25CB';
      return `  ${icon} [${t.status}] ${t.content}`;
    });
    taskSection = `\n<current-task-list>\n${lines.join('\n')}\n</current-task-list>\n`;
  }

  return base + taskSection + '\n' + modeSpecific;
}
