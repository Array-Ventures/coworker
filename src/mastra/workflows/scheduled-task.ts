import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { harnessPool } from '../harness/pool';
import { sendAndCapture } from '../harness/utils';

const executeStep = createStep({
  id: 'execute-task',
  inputSchema: z.object({ prompt: z.string(), taskId: z.string(), taskName: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async ({ inputData }) => {
    // Create a thread and harness via the pool
    const { entry } = await harnessPool.createThread(
      `[Scheduled] ${inputData.taskName}`,
      'scheduled',
    );
    await entry.harness.setThreadSetting({ key: 'channel', value: 'scheduled' });

    // No timeout — pool sweeper handles lifecycle.
    // ask_user questions reach the UI via multiplexed SSE.
    try {
      const result = await sendAndCapture(entry.harness, inputData.prompt);
      return { result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scheduled-task] ${inputData.taskId} failed:`, msg);
      return { result: `[error] ${msg}` };
    }
  },
});

export function createTaskWorkflow(taskId: string) {
  const workflow = createWorkflow({
    id: `scheduled-task-${taskId}`,
    inputSchema: z.object({ prompt: z.string(), taskId: z.string(), taskName: z.string() }),
    outputSchema: z.object({ result: z.string() }),
  }).then(executeStep);

  workflow.commit();
  return workflow;
}
