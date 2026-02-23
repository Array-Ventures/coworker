import { z } from 'zod';

const DEFAULT_OM_MODEL = 'nvidia/moonshotai/kimi-k2.5';

export const stateSchema = z.object({
  // Model
  currentModelId: z.string().default(''),
  // Observational Memory model settings
  observerModelId: z.string().default(DEFAULT_OM_MODEL),
  reflectorModelId: z.string().default(DEFAULT_OM_MODEL),
  // Observational Memory threshold settings
  observationThreshold: z.number().default(30_000),
  reflectionThreshold: z.number().default(40_000),
  // YOLO mode — auto-approve all tool calls
  yolo: z.boolean().default(true),
  // Permission rules — per-category and per-tool approval policies
  permissionRules: z
    .object({
      categories: z.record(z.string(), z.enum(['allow', 'ask', 'deny'])).default({}),
      tools: z.record(z.string(), z.enum(['allow', 'ask', 'deny'])).default({}),
    })
    .default({ categories: {}, tools: {} }),
  // Task list (persisted per-thread)
  tasks: z
    .array(
      z.object({
        content: z.string(),
        status: z.enum(['pending', 'in_progress', 'completed']),
        activeForm: z.string(),
      }),
    )
    .default([]),
  // Active plan (set when a plan is approved in Plan mode)
  activePlan: z
    .object({
      title: z.string(),
      plan: z.string(),
      approvedAt: z.string(),
    })
    .nullable()
    .default(null),
});
