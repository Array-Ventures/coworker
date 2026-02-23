import type { HarnessEvent } from '@mastra/core/harness';
import { harnessPool } from './pool';

/**
 * Send a message via the pool and capture the assistant's reply text.
 * Uses pool.sendAsync() which emits user_message event before calling
 * harness.sendMessage(). The subscribe fires synchronously during
 * processing — by the time sendAsync() resolves, message_end has
 * already fired.
 */
export async function sendAndCapture(threadId: string, content: string): Promise<string> {
  const entry = harnessPool.get(threadId);
  if (!entry) throw new Error(`No pool entry for ${threadId}`);

  const textParts: string[] = [];
  const unsub = entry.harness.subscribe((event: HarnessEvent) => {
    if (event.type === 'message_end') {
      for (const part of event.message.content) {
        if (part.type === 'text') textParts.push(part.text);
      }
    }
  });
  try {
    await harnessPool.sendAsync(threadId, content);
    return textParts.join('\n').trim();
  } finally {
    unsub();
  }
}

/**
 * Handlers for interactive events during a harness run.
 * Used by sendAndCaptureInteractive to forward ask_user, tool_approval,
 * and plan_approval events to an external channel (e.g. WhatsApp).
 */
export type InteractionHandlers = {
  onQuestion?: (q: { questionId: string; question: string; options?: Array<{ label: string; description?: string }> }) => Promise<string>;
  onPlanApproval?: (p: { planId: string; title: string; plan: string }) => Promise<{ action: 'approved' | 'rejected'; feedback?: string }>;
};

/**
 * Like sendAndCapture, but also handles interactive events:
 * - ask_question → forwarded to onQuestion handler
 * - tool_approval_required → auto-approved (yolo semantics)
 * - plan_approval_required → forwarded to onPlanApproval handler, or auto-approved
 */
export async function sendAndCaptureInteractive(
  threadId: string,
  content: string,
  handlers: InteractionHandlers,
): Promise<string> {
  const entry = harnessPool.get(threadId);
  if (!entry) throw new Error(`No pool entry for ${threadId}`);

  const textParts: string[] = [];
  const unsub = entry.harness.subscribe((event: HarnessEvent) => {
    if (event.type === 'message_end') {
      for (const part of event.message.content) {
        if (part.type === 'text') textParts.push(part.text);
      }
    }
    // ask_user → forward to handler
    if (event.type === 'ask_question' && handlers.onQuestion) {
      handlers.onQuestion({ questionId: event.questionId, question: event.question, options: event.options })
        .then(answer => entry.harness.respondToQuestion({ questionId: event.questionId, answer }))
        .catch(() => {}); // timeout — agent will be aborted by outer timeout
    }
    // tool_approval → auto-approve (yolo semantics)
    if (event.type === 'tool_approval_required') {
      entry.harness.respondToToolApproval({ decision: 'approve' });
    }
    // plan_approval → forward to handler or auto-approve
    if (event.type === 'plan_approval_required' && handlers.onPlanApproval) {
      handlers.onPlanApproval({ planId: event.planId, title: event.title, plan: event.plan })
        .then(response => entry.harness.respondToPlanApproval({ planId: event.planId, response }))
        .catch(() => entry.harness.respondToPlanApproval({ planId: event.planId, response: { action: 'approved' } }));
    } else if (event.type === 'plan_approval_required') {
      entry.harness.respondToPlanApproval({ planId: event.planId, response: { action: 'approved' } });
    }
  });
  try {
    await harnessPool.sendAsync(threadId, content);
    return textParts.join('\n').trim();
  } finally {
    unsub();
  }
}
