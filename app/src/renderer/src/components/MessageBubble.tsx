import { memo, useState, useMemo } from 'react'
import type { HarnessMessage, HarnessMessageContent } from '../types/harness'
import type { ToolState, SubagentState, SubagentToolState } from '../types/harness'
import { parseSystemReminder, parseMessageContext } from '../lib/message-parsers'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolInvocation } from './ToolInvocation'
import { SubagentInvocation } from './SubagentInvocation'
import { InteractiveToolCall } from './InteractiveToolCall'
import { SystemReminderDivider } from './SystemReminderDivider'
import { ChannelMessage } from './ChannelMessage'
import { isHiddenTool } from '../lib/tool-display'
import { Streamdown } from 'streamdown'
import { code } from '@streamdown/code'
import 'streamdown/styles.css'

const streamdownPlugins = { code }

// Content type narrowing helpers
type TextContent = Extract<HarnessMessageContent, { type: 'text' }>
type ThinkingContent = Extract<HarnessMessageContent, { type: 'thinking' }>
type ImageContent = Extract<HarnessMessageContent, { type: 'image' }>
type ToolCallContent = Extract<HarnessMessageContent, { type: 'tool_call' }>
type ToolResultContent = Extract<HarnessMessageContent, { type: 'tool_result' }>

const INTERACTIVE_TOOLS = new Set(['ask_user', 'submit_plan'])

/** Reconstruct SubagentState from persisted tool_call args + tool_result for historical messages */
function reconstructSubagentState(
  toolCallId: string,
  args: { agentType?: string; task?: string; modelId?: string },
  resultContent?: ToolResultContent
): SubagentState | null {
  if (!args?.agentType) return null

  const raw = resultContent?.result
  const resultStr = typeof raw === 'string'
    ? raw
    : typeof raw === 'object' && raw
      ? (raw as Record<string, unknown>).content as string ?? JSON.stringify(raw)
      : ''

  const metaMatch = resultStr.match(/<subagent-meta\s+([^>]*)\/?>/)
  let durationMs: number | undefined
  let modelId = args.modelId ?? ''
  const nestedTools: SubagentToolState[] = []

  if (metaMatch) {
    const attrs = metaMatch[1]
    const dur = attrs.match(/durationMs="(\d+)"/)
    if (dur) durationMs = parseInt(dur[1], 10)
    const mid = attrs.match(/modelId="([^"]*)"/)
    if (mid) modelId = mid[1]
    const tools = attrs.match(/tools="([^"]*)"/)
    if (tools?.[1]) {
      for (const entry of tools[1].split(',')) {
        const [name, status] = entry.split(':')
        if (name) {
          nestedTools.push({
            toolName: name, args: {},
            status: 'completed', isError: status === 'err',
          })
        }
      }
    }
  }

  const resultText = resultStr.replace(/<subagent-meta[^>]*\/?>/, '').trim()

  return {
    toolCallId,
    agentType: args.agentType,
    task: args.task ?? '',
    modelId,
    status: resultContent ? (resultContent.isError ? 'error' : 'completed') : 'running',
    text: '',
    result: resultText || undefined,
    isError: resultContent?.isError,
    durationMs,
    nestedTools,
  }
}

type MessageBubbleProps = {
  message: HarnessMessage
  isStreaming?: boolean
  isDark?: boolean
  toolStates: Map<string, ToolState>
  subagentStates: Map<string, SubagentState>
  onResolveToolApproval?: (decision: 'approve' | 'decline' | 'always_allow_category') => void
}

export default memo(function MessageBubble({
  message,
  isStreaming = false,
  isDark = true,
  toolStates,
  subagentStates,
  onResolveToolApproval,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'

  const textContent = useMemo(() =>
    message.content
      .filter((c): c is TextContent => c.type === 'text')
      .map(c => c.text)
      .join('\n'),
    [message.content]
  )

  const thinkingParts = useMemo(() =>
    message.content.filter((c): c is ThinkingContent => c.type === 'thinking'),
    [message.content]
  )

  const imageParts = useMemo(() =>
    message.content.filter((c): c is ImageContent => c.type === 'image'),
    [message.content]
  )

  const toolCallParts = useMemo(() =>
    message.content.filter((c): c is ToolCallContent => c.type === 'tool_call' && !isHiddenTool(c.name)),
    [message.content]
  )

  const toolResultMap = useMemo(() => {
    const map = new Map<string, ToolResultContent>()
    message.content
      .filter((c): c is ToolResultContent => c.type === 'tool_result')
      .forEach(r => map.set(r.id, r))
    return map
  }, [message.content])

  const subagentInvocations = useMemo(() => {
    return toolCallParts
      .filter(tc => tc.name === 'subagent')
      .map(tc => {
        const live = subagentStates.get(tc.id)
        if (live) return live
        const args = tc.args as { agentType?: string; task?: string; modelId?: string }
        return reconstructSubagentState(tc.id, args, toolResultMap.get(tc.id))
      })
      .filter((s): s is SubagentState => s != null)
  }, [toolCallParts, subagentStates, toolResultMap])

  const renderedSubagentIds = useMemo(() =>
    new Set(subagentInvocations.map(sa => sa.toolCallId)),
    [subagentInvocations]
  )

  const interactiveToolCalls = useMemo(() => {
    return toolCallParts
      .filter(tc => INTERACTIVE_TOOLS.has(tc.name))
      .map(tc => {
        const result = toolResultMap.get(tc.id)
        return { toolCall: tc, result }
      })
  }, [toolCallParts, toolResultMap])

  const toolInvocations = useMemo(() => {
    return toolCallParts
      .filter(tc => !INTERACTIVE_TOOLS.has(tc.name) && (tc.name !== 'subagent' || !renderedSubagentIds.has(tc.id)))
      .map(tc => {
        const live = toolStates.get(tc.id)
        if (live) return live
        const result = toolResultMap.get(tc.id)
        return {
          toolCallId: tc.id,
          toolName: tc.name,
          args: tc.args,
          status: result ? (result.isError ? 'error' as const : 'completed' as const) : 'running' as const,
          result: result?.result,
          isError: result?.isError,
        } as ToolState
      })
  }, [toolCallParts, toolResultMap, toolStates, renderedSubagentIds])

  // Detect special user message types
  const systemReminder = isUser ? parseSystemReminder(textContent) : null
  const messageContext = isUser && !systemReminder ? parseMessageContext(textContent) : null

  return (
    <div className={`${isUser ? (systemReminder ? 'self-center' : 'self-end') : 'self-start w-full'}`}>
      {isUser ? (
        systemReminder ? (
          <SystemReminderDivider text={systemReminder} />
        ) : messageContext ? (
          <ChannelMessage ctx={messageContext} images={imageParts} />
        ) : (
          <div className="flex justify-end">
            <div className="text-[15px] leading-relaxed whitespace-pre-wrap font-secondary bg-card border border-border rounded-[14px] py-3 px-[18px]">
              {imageParts.map((img, i) => (
                <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="upload" className="max-w-[300px] rounded-lg mb-2" />
              ))}
              {textContent}
            </div>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-2">
          {/* Agent meta row */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
              <span className="material-icon text-primary-foreground" style={{ fontSize: 14 }}>
                pets
              </span>
            </div>
            <span className="text-[13px] font-medium text-foreground font-secondary">Coworker</span>
            <span className="material-icon text-primary" style={{ fontSize: 14 }}>verified</span>
          </div>

          {/* Agent content */}
          <div className="streamdown-content max-w-[600px]">
            {thinkingParts.map((part, i) => (
              <ThinkingBlock key={i} text={part.thinking} isStreaming={isStreaming} />
            ))}

            <Streamdown
              plugins={streamdownPlugins}
              isAnimating={isStreaming}
              caret={isStreaming ? 'block' : undefined}
              shikiTheme={isDark ? ['github-dark', 'github-dark'] : ['github-light', 'github-light']}
              controls={{ code: true, table: true }}
              className="text-[15px] leading-relaxed font-secondary"
            >
              {textContent}
            </Streamdown>

            {toolInvocations.map((ts) => (
              <ToolInvocation
                key={ts.toolCallId}
                toolState={ts}
                onResolveApproval={onResolveToolApproval}
              />
            ))}

            {subagentInvocations.map((sa) => (
              <SubagentInvocation key={sa.toolCallId} state={sa} />
            ))}

            {interactiveToolCalls.map(({ toolCall, result }) => (
              <InteractiveToolCall key={toolCall.id} toolCall={toolCall} result={result} />
            ))}

            {imageParts.map((img, i) => (
              <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="generated" className="max-w-[400px] rounded-lg mt-2" />
            ))}
          </div>

          {/* Streaming indicator or action buttons */}
          {isStreaming ? (
            <div className="flex items-center gap-2 text-muted-dim text-[13px] font-secondary">
              <span className="material-icon animate-pulse" style={{ fontSize: 16 }}>more_horiz</span>
              Coworker is thinking...
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CopyButton text={textContent} />
              <ActionButton icon="thumb_up" tooltip="Good" onClick={() => {}} />
            </div>
          )}
        </div>
      )}
    </div>
  )
})

function ActionButton({ icon, tooltip, onClick }: { icon: string; tooltip: string; onClick: () => void }) {
  return (
    <button
      title={tooltip}
      onClick={onClick}
      className="bg-transparent border-none text-muted-dim cursor-pointer p-1 rounded-md hover:bg-card hover:text-foreground transition-colors"
    >
      <span className="material-icon" style={{ fontSize: 16 }}>{icon}</span>
    </button>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      title={copied ? 'Copied!' : 'Copy'}
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className={`bg-transparent border-none cursor-pointer p-1 rounded-md transition-colors ${
        copied ? 'text-success' : 'text-muted-dim hover:bg-card hover:text-foreground'
      }`}
    >
      <span className="material-icon" style={{ fontSize: 16 }}>
        {copied ? 'check' : 'content_copy'}
      </span>
    </button>
  )
}
