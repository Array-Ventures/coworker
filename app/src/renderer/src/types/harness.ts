// Re-export canonical types from @mastra/core/harness (type-only, zero runtime cost)
export type {
  HarnessEvent,
  HarnessMessage,
  HarnessMessageContent,
  HarnessSession,
  HarnessThread,
  TokenUsage,
  AvailableModel,
  PermissionPolicy,
  PermissionRules,
  ToolCategory,
  TaskItem,
} from '@mastra/core/harness'

// Extract specific event types for consumers
import type { HarnessEvent } from '@mastra/core/harness'
export type ToolStartEvent = Extract<HarnessEvent, { type: 'tool_start' }>
export type ToolEndEvent = Extract<HarnessEvent, { type: 'tool_end' }>
export type ToolApprovalEvent = Extract<HarnessEvent, { type: 'tool_approval_required' }>
export type ShellOutputEvent = Extract<HarnessEvent, { type: 'shell_output' }>
export type AskQuestionEvent = Extract<HarnessEvent, { type: 'ask_question' }>
export type PlanApprovalEvent = Extract<HarnessEvent, { type: 'plan_approval_required' }>

// UI state types (not in @mastra/core — these track live rendering state)
export type ToolStatus = 'running' | 'approval_required' | 'approval_responded' | 'completed' | 'error'

export interface ToolState {
  toolCallId: string
  toolName: string
  args: unknown
  status: ToolStatus
  result?: unknown
  partialResult?: unknown
  isError?: boolean
  shellOutput?: string
}

export interface SubagentState {
  toolCallId: string
  agentType: string
  task: string
  modelId: string
  status: 'running' | 'completed' | 'error'
  text: string
  result?: string
  isError?: boolean
  durationMs?: number
  nestedTools: SubagentToolState[]
}

export interface SubagentToolState {
  toolName: string
  args: unknown
  result?: unknown
  isError?: boolean
  status: 'running' | 'completed' | 'error'
}

// File staging type (replaces AI SDK's FileUIPart)
export interface StagedFile {
  type: 'file'
  url: string // data URL for preview
  mediaType: string
  filename?: string
}

/** Convert a FileList to StagedFile array (replaces AI SDK's convertFileListToFileUIParts) */
export async function convertFilesToStagedFiles(files: FileList): Promise<StagedFile[]> {
  const results: StagedFile[] = []
  for (const file of Array.from(files)) {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    results.push({ type: 'file', url, mediaType: file.type || 'application/octet-stream', filename: file.name })
  }
  return results
}
