import { init } from '@mastra/inngest';
import { z } from 'zod';
import { inngest } from '../inngest';
import { pool } from '../db';

const { createWorkflow, createStep } = init(inngest);

const executeStep = createStep({
  id: 'execute-task',
  inputSchema: z.object({ prompt: z.string(), taskId: z.string(), taskName: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async ({ inputData, mastra }) => {
    // Check if task is still enabled before running
    const check = await pool.query(
      'SELECT enabled FROM scheduled_tasks WHERE id = $1',
      [inputData.taskId],
    );
    if (!check.rows[0] || check.rows[0].enabled === false) {
      return { result: '[skipped — task disabled]' };
    }

    const agent = mastra?.getAgent('coworkerAgent');
    if (!agent) throw new Error('coworkerAgent not found');

    const threadId = `scheduled-${inputData.taskId}-${Date.now()}`;

    const response = await agent.generate(
      [{ role: 'user', content: inputData.prompt }],
      {
        memory: {
          thread: {
            id: threadId,
            title: `[Scheduled] ${inputData.taskName}`,
            metadata: { type: 'scheduled', taskId: inputData.taskId },
          },
          resource: 'coworker',
        },
      },
    );

    // Update last_run_at
    await pool.query(
      'UPDATE scheduled_tasks SET last_run_at = NOW() WHERE id = $1',
      [inputData.taskId],
    );

    return { result: response.text ?? '' };
  },
});

export function createTaskWorkflow(taskId: string, cron: string, prompt: string, taskName: string) {
  const workflow = createWorkflow({
    id: `scheduled-task-${taskId}`,
    inputSchema: z.object({ prompt: z.string(), taskId: z.string(), taskName: z.string() }),
    outputSchema: z.object({ result: z.string() }),
    cron,
    inputData: { prompt, taskId, taskName },
  }).then(executeStep);

  workflow.commit();
  return workflow;
}
