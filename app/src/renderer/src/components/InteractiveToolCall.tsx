import type { HarnessMessageContent } from '../types/harness'

type ToolCallContent = Extract<HarnessMessageContent, { type: 'tool_call' }>
type ToolResultContent = Extract<HarnessMessageContent, { type: 'tool_result' }>

/** Extract the content string from a tool result (handles string or { content: string } shapes) */
function getResultContent(result: unknown): string {
  if (typeof result === 'string') return result
  if (typeof result === 'object' && result) {
    const obj = result as Record<string, unknown>
    if (typeof obj.content === 'string') return obj.content
    return JSON.stringify(result)
  }
  return ''
}

export function InteractiveToolCall({ toolCall, result }: { toolCall: ToolCallContent; result?: ToolResultContent }) {
  const content = result ? getResultContent(result.result) : ''

  if (toolCall.name === 'ask_user') {
    return <AskUserResult toolCall={toolCall} result={result} content={content} />
  }

  if (toolCall.name === 'submit_plan') {
    return <SubmitPlanResult content={content} />
  }

  return null
}

function AskUserResult({ toolCall, result, content }: { toolCall: ToolCallContent; result?: ToolResultContent; content: string }) {
  const args = toolCall.args as { question?: string; options?: { label: string; description?: string }[] }
  const question = args?.question ?? ''
  const options = args?.options

  // Answered
  if (result && !result.isError) {
    const rawAnswer = content.replace(/^User answered:\s*/i, '')
    const matched = options?.find(o => o.label === rawAnswer)
    const displayAnswer = matched?.description || rawAnswer

    // Multi-line card when options were provided (question + divider + resolved answer)
    if (options?.length) {
      return (
        <div className="flex flex-col bg-card border border-border rounded-lg mt-2 overflow-hidden">
          <div className="flex items-center gap-2 py-2.5 px-3.5">
            <span className="material-icon text-primary shrink-0" style={{ fontSize: 16 }}>chat_bubble</span>
            <span className="font-secondary text-[13px] text-foreground font-medium">{question}</span>
          </div>
          <div className="h-px w-full bg-border" />
          <div className="flex items-start gap-2 py-2.5 px-3.5">
            <span className="material-icon text-success shrink-0 mt-px" style={{ fontSize: 16 }}>check_circle</span>
            <span className="font-secondary text-[13px] text-foreground font-semibold leading-relaxed">{displayAnswer}</span>
          </div>
        </div>
      )
    }

    // Single-line compact row for simple answers (no options)
    return (
      <div className="flex items-center gap-2 bg-card border border-border rounded-lg mt-2 py-2.5 px-3.5">
        <span className="material-icon text-primary shrink-0" style={{ fontSize: 16 }}>chat_bubble</span>
        <span className="font-secondary text-[13px] text-muted-foreground truncate">{question}</span>
        <span className="text-muted-dim font-secondary text-[13px]">·</span>
        <span className="font-secondary text-[13px] text-foreground font-semibold shrink-0">{displayAnswer}</span>
      </div>
    )
  }

  // Error
  if (result?.isError) {
    return (
      <div className="flex items-center gap-2 bg-card border border-error rounded-lg mt-2 py-2.5 px-3.5">
        <span className="material-icon text-error shrink-0" style={{ fontSize: 16 }}>error</span>
        <span className="font-secondary text-[13px] text-error/80 truncate">{content}</span>
      </div>
    )
  }

  // Pending (no result yet)
  return (
    <div className="flex items-center gap-2 bg-card border border-primary rounded-lg mt-2 py-2.5 px-3.5">
      <span className="material-icon text-primary animate-spin shrink-0" style={{ fontSize: 16 }}>progress_activity</span>
      <span className="font-secondary text-[13px] text-foreground">{question}</span>
    </div>
  )
}

function SubmitPlanResult({ content }: { content: string }) {
  const isApproved = content.startsWith('Plan approved')
  const isRejected = content.includes('not approved')

  if (isApproved) {
    const message = content.replace(/^Plan approved\.?\s*/i, '').trim()
    return (
      <div className="flex items-center gap-2 bg-card border border-border rounded-lg mt-2 py-2.5 px-3.5">
        <span className="material-icon text-success shrink-0" style={{ fontSize: 16 }}>check_circle</span>
        <span className="font-secondary text-[13px] text-foreground font-medium">Plan approved</span>
        {message && (
          <>
            <span className="text-muted-dim font-secondary text-[13px]">—</span>
            <span className="font-secondary text-[13px] text-muted-foreground truncate">{message}</span>
          </>
        )}
      </div>
    )
  }

  if (isRejected) {
    const feedbackMatch = content.match(/User feedback:\s*(.+?)(?:\n|$)/)
    const feedback = feedbackMatch?.[1]?.trim() ?? ''
    return (
      <div className="flex items-center gap-2 bg-card border border-border rounded-lg mt-2 py-2.5 px-3.5">
        <span className="material-icon text-error shrink-0" style={{ fontSize: 16 }}>cancel</span>
        <span className="font-secondary text-[13px] text-foreground font-medium">Plan rejected</span>
        {feedback && (
          <>
            <span className="text-muted-dim font-secondary text-[13px]">—</span>
            <span className="font-secondary text-[13px] text-muted-foreground truncate">{feedback}</span>
          </>
        )}
      </div>
    )
  }

  // Pending or unknown state
  return (
    <div className="flex items-center gap-2 bg-card border border-primary rounded-lg mt-2 py-2.5 px-3.5">
      <span className="material-icon text-primary animate-spin shrink-0" style={{ fontSize: 16 }}>progress_activity</span>
      <span className="font-secondary text-[13px] text-foreground font-medium">Reviewing plan...</span>
    </div>
  )
}
