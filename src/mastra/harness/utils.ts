import type { Harness, HarnessEvent, HarnessStateSchema } from '@mastra/core/harness';

/**
 * Send a message via harness and capture the assistant's reply text.
 * Works because sendMessage() awaits the full stream, and subscribe()
 * fires synchronously during processing — by the time sendMessage()
 * resolves, message_end has already fired.
 */
export async function sendAndCapture<T extends HarnessStateSchema>(harness: Harness<T>, content: string): Promise<string> {
  const textParts: string[] = [];
  const unsub = harness.subscribe((event: HarnessEvent) => {
    if (event.type === 'message_end') {
      for (const part of event.message.content) {
        if (part.type === 'text') textParts.push(part.text);
      }
    }
  });
  try {
    await harness.sendMessage({ content });
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
export async function sendAndCaptureInteractive<T extends HarnessStateSchema>(
  harness: Harness<T>,
  content: string,
  handlers: InteractionHandlers,
): Promise<string> {
  const textParts: string[] = [];
  const unsub = harness.subscribe((event: HarnessEvent) => {
    if (event.type === 'message_end') {
      for (const part of event.message.content) {
        if (part.type === 'text') textParts.push(part.text);
      }
    }
    // ask_user → forward to handler
    if (event.type === 'ask_question' && handlers.onQuestion) {
      handlers.onQuestion({ questionId: event.questionId, question: event.question, options: event.options })
        .then(answer => harness.respondToQuestion({ questionId: event.questionId, answer }))
        .catch(() => {}); // timeout — agent will be aborted by outer timeout
    }
    // tool_approval → auto-approve (yolo semantics)
    if (event.type === 'tool_approval_required') {
      harness.respondToToolApproval({ decision: 'approve' });
    }
    // plan_approval → forward to handler or auto-approve
    if (event.type === 'plan_approval_required' && handlers.onPlanApproval) {
      handlers.onPlanApproval({ planId: event.planId, title: event.title, plan: event.plan })
        .then(response => harness.respondToPlanApproval({ planId: event.planId, response }))
        .catch(() => harness.respondToPlanApproval({ planId: event.planId, response: { action: 'approved' } }));
    } else if (event.type === 'plan_approval_required') {
      harness.respondToPlanApproval({ planId: event.planId, response: { action: 'approved' } });
    }
  });
  try {
    await harness.sendMessage({ content });
    return textParts.join('\n').trim();
  } finally {
    unsub();
  }
}
