import { memo, useState, useMemo } from 'react'
import type {
  UIMessage,
  FileUIPart,
  ReasoningUIPart,
  DynamicToolUIPart,
  SourceUrlUIPart,
} from 'ai'
import { isToolUIPart, getToolName } from 'ai'
import { getToolDisplay, getPrimaryArgValue, getExecutionTime, formatToolOutput } from '../lib/tool-display'
import { AppRenderer } from '@mcp-ui/client'
import { Streamdown } from 'streamdown'
import { code } from '@streamdown/code'
import 'streamdown/styles.css'

const streamdownPlugins = { code }
const sandboxConfig = { url: new URL('/sandbox_proxy.html', window.location.origin) }

type MessageBubbleProps = {
  message: UIMessage
  isStreaming?: boolean
  isDark?: boolean
  onToolApprovalResponse?: (opts: { id: string; approved: boolean; reason?: string }) => void | PromiseLike<void>
}

export default memo(function MessageBubble({ message, isStreaming = false, isDark = true, onToolApprovalResponse }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  const fileParts = useMemo(() =>
    message.parts.filter((p): p is FileUIPart => p.type === 'file'),
    [message.parts]
  )

  const reasoningParts = useMemo(() =>
    message.parts.filter((p): p is ReasoningUIPart => p.type === 'reasoning'),
    [message.parts]
  )

  const toolParts = useMemo(() =>
    message.parts.filter(isToolUIPart) as DynamicToolUIPart[],
    [message.parts]
  )

  const sourceParts = useMemo(() =>
    message.parts.filter((p): p is SourceUrlUIPart => p.type === 'source-url'),
    [message.parts]
  )

  const markdownContent = useMemo(() => {
    return message.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
  }, [message.parts])

  return (
    <div className={`${isUser ? 'self-end' : 'self-start w-full'}`}>
      {isUser ? (
        <div className="flex justify-end">
          <div className="text-[15px] leading-relaxed whitespace-pre-wrap font-secondary bg-card border border-border rounded-[14px] py-3 px-[18px]">
            {fileParts.map((file, i) => (
              <FilePart key={i} file={file} />
            ))}
            {markdownContent}
          </div>
        </div>
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
            {/* File parts */}
            {fileParts.map((file, i) => (
              <FilePart key={i} file={file} />
            ))}

            {/* Reasoning blocks */}
            {reasoningParts.map((part, i) => (
              <ReasoningBlock key={i} part={part} />
            ))}

            {/* Main text via Streamdown */}
            <Streamdown
              plugins={streamdownPlugins}
              isAnimating={isStreaming}
              caret={isStreaming ? 'block' : undefined}
              shikiTheme={isDark ? ['github-dark', 'github-dark'] : ['github-light', 'github-light']}
              controls={{ code: true, table: true }}
              className="text-[15px] leading-relaxed font-secondary"
            >
              {markdownContent}
            </Streamdown>

            {/* Tool invocations */}
            {toolParts.map((part) => (
              <ToolInvocation
                key={part.toolCallId}
                part={part}
                onApprovalResponse={onToolApprovalResponse}
              />
            ))}

            {/* Source citations */}
            <SourceLinks sources={sourceParts} />
          </div>

          {/* Streaming indicator or action buttons */}
          {isStreaming ? (
            <div className="flex items-center gap-2 text-muted-dim text-[13px] font-secondary">
              <span className="material-icon animate-pulse" style={{ fontSize: 16 }}>more_horiz</span>
              Coworker is thinking...
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CopyButton text={markdownContent} />
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

function FilePart({ file }: { file: FileUIPart }) {
  if (file.mediaType?.startsWith('image/')) {
    return <img src={file.url} alt={file.filename || 'image'} className="max-w-[300px] rounded-lg mb-2" />
  }
  return (
    <div className="flex items-center gap-2 bg-secondary rounded-lg px-3 py-2 mb-2 text-[13px] text-muted font-secondary">
      <span className="material-icon" style={{ fontSize: 16 }}>description</span>
      {file.filename || 'file'}
    </div>
  )
}

function ReasoningBlock({ part }: { part: ReasoningUIPart }) {
  const [expanded, setExpanded] = useState(false)
  const isStreaming = part.state === 'streaming'

  return (
    <div className="bg-card border border-border rounded-lg p-3 mb-2 text-[13px]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 bg-transparent border-none cursor-pointer text-muted font-secondary font-medium text-xs p-0 w-full"
      >
        {isStreaming ? (
          <span className="material-icon animate-pulse" style={{ fontSize: 14 }}>psychology</span>
        ) : (
          <span className="material-icon" style={{ fontSize: 14 }}>
            {expanded ? 'expand_more' : 'chevron_right'}
          </span>
        )}
        {isStreaming ? 'Thinking...' : 'Thought process'}
      </button>
      {(expanded || isStreaming) && part.text && (
        <div className="mt-2 text-muted-dim font-secondary text-[12px] leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto">
          {part.text}
        </div>
      )}
    </div>
  )
}

function ToolArgPill({ value }: { value: string }) {
  return (
    <span className="bg-secondary rounded px-1.5 py-0.5 font-primary text-[11px] text-foreground">
      {value}
    </span>
  )
}

function ToolHeader({
  toolName,
  args,
  statusIcon,
  statusIconClass,
  duration,
  chevron,
  onToggle,
}: {
  toolName: string
  args: unknown
  statusIcon: string
  statusIconClass?: string
  duration?: number | null
  chevron?: 'up' | 'down'
  onToggle?: () => void
}) {
  const display = getToolDisplay(toolName)
  const argValue = getPrimaryArgValue(toolName, args)

  const content = (
    <>
      <span className={`material-icon ${statusIconClass || ''}`} style={{ fontSize: 16 }}>
        {statusIcon}
      </span>
      <span className="material-icon text-foreground" style={{ fontSize: 15 }}>
        {display.icon}
      </span>
      <span className="font-secondary text-[13px] font-semibold text-foreground">
        {display.displayName}
      </span>
      {argValue && <ToolArgPill value={argValue} />}
      {duration != null && (
        <>
          <span className="w-px h-3 bg-border" />
          <span className="font-primary text-[11px] text-muted">{duration}ms</span>
        </>
      )}
      {chevron && (
        <span className="material-icon text-muted ml-auto" style={{ fontSize: 16 }}>
          {chevron === 'up' ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
        </span>
      )}
    </>
  )

  if (onToggle) {
    return (
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full bg-transparent border-none cursor-pointer py-2 px-3"
      >
        {content}
      </button>
    )
  }

  return <div className="flex items-center gap-2 py-2 px-3">{content}</div>
}

function ToolInvocation({
  part,
  onApprovalResponse,
}: {
  part: DynamicToolUIPart
  onApprovalResponse?: (opts: { id: string; approved: boolean; reason?: string }) => void | PromiseLike<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const toolName = getToolName(part)

  // Running state
  if (part.state === 'input-streaming' || part.state === 'input-available') {
    return (
      <div className="bg-card border border-border rounded-lg mt-2 overflow-hidden">
        <ToolHeader
          toolName={toolName}
          args={part.input}
          statusIcon="progress_activity"
          statusIconClass="text-primary animate-spin"
        />
      </div>
    )
  }

  // Approval requested
  if (part.state === 'approval-requested') {
    return (
      <div className="bg-card border border-primary rounded-lg mt-2 overflow-hidden">
        <ToolHeader
          toolName={toolName}
          args={part.input}
          statusIcon="verified_user"
          statusIconClass="text-primary"
        />
        <div className="h-px w-full bg-primary/20" />
        <div className="flex items-center gap-2 p-3">
          <button
            onClick={() => onApprovalResponse?.({ id: part.approval.id, approved: true })}
            className="flex items-center gap-1 bg-primary text-primary-foreground rounded-lg font-secondary text-xs font-semibold hover:bg-primary-hover transition-colors"
            style={{ padding: '4px 12px' }}
          >
            <span className="material-icon" style={{ fontSize: 12 }}>check</span>
            Approve
          </button>
          <button
            onClick={() => onApprovalResponse?.({ id: part.approval.id, approved: false })}
            className="flex items-center gap-1 bg-secondary text-muted rounded-lg font-secondary text-xs font-semibold hover:bg-card transition-colors"
            style={{ padding: '4px 12px' }}
          >
            <span className="material-icon" style={{ fontSize: 12 }}>close</span>
            Reject
          </button>
        </div>
      </div>
    )
  }

  // Approval responded — show as running with badge
  if (part.state === 'approval-responded') {
    return (
      <div className="bg-card border border-border rounded-lg mt-2 overflow-hidden">
        <div className="flex items-center gap-2 py-2 px-3">
          <span className="material-icon text-primary animate-spin" style={{ fontSize: 16 }}>
            progress_activity
          </span>
          <span className="material-icon text-foreground" style={{ fontSize: 15 }}>
            {getToolDisplay(toolName).icon}
          </span>
          <span className="font-secondary text-[13px] font-semibold text-foreground">
            {getToolDisplay(toolName).displayName}
          </span>
          <span className={`font-secondary text-[11px] font-medium ${part.approval.approved ? 'text-success' : 'text-error'}`}>
            {part.approval.approved ? 'Approved' : 'Rejected'}
          </span>
        </div>
      </div>
    )
  }

  // Error state
  if (part.state === 'output-error') {
    return (
      <div className="bg-card border border-error rounded-lg mt-2 overflow-hidden">
        <ToolHeader
          toolName={toolName}
          args={part.input}
          statusIcon="error"
          statusIconClass="text-error"
        />
        <div className="h-px w-full bg-error/20" />
        <div className="px-2 pb-2">
          <pre className="bg-error-bg rounded-md p-3 font-primary text-[11px] text-error/80 whitespace-pre-wrap break-all max-h-[100px] overflow-y-auto">
            {part.errorText}
          </pre>
        </div>
      </div>
    )
  }

  // Output available — collapsible
  const duration = getExecutionTime(part.output)
  const formatted = expanded ? formatToolOutput(toolName, part.output) : null
  const outputObj = part.output as Record<string, unknown> | undefined

  // Search Memory — custom render
  if (toolName === 'searchMemory' && outputObj) {
    const resultCount = Array.isArray(outputObj.results) ? outputObj.results.length : 0
    return (
      <div className="bg-card border border-border rounded-lg mt-2 overflow-hidden">
        <ToolHeader
          toolName={toolName}
          args={part.input}
          statusIcon="check_circle"
          statusIconClass="text-success"
          duration={duration}
          chevron={expanded ? 'up' : 'down'}
          onToggle={() => setExpanded(!expanded)}
        />
        {expanded && <SearchMemoryOutput output={outputObj} />}
      </div>
    )
  }

  // Detect MCP UI resource in tool output
  const output = part.output as Record<string, unknown> | undefined
  const isUiResource =
    output?.type === 'resource' &&
    typeof (output?.resource as any)?.uri === 'string' &&
    (output?.resource as any)?.uri?.startsWith('ui://')

  if (isUiResource) {
    const resource = output!.resource as { uri: string; text: string }
    return (
      <div className="bg-card border border-border rounded-lg mt-2 overflow-hidden">
        <ToolHeader
          toolName={toolName}
          args={part.input}
          statusIcon="check_circle"
          statusIconClass="text-success"
          duration={duration}
        />
        <div className="h-px w-full bg-border" />
        <div className="p-2" style={{ minHeight: 200 }}>
          <AppRenderer
            toolName={toolName}
            sandbox={sandboxConfig}
            html={resource.text}
            toolInput={part.input as Record<string, unknown>}
            toolResult={output as any}
            onOpenLink={async ({ url }) => { window.open(url, '_blank'); return {}; }}
            onError={(err) => console.error('AppRenderer error:', err)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg mt-2 overflow-hidden">
      <ToolHeader
        toolName={toolName}
        args={part.input}
        statusIcon="check_circle"
        statusIconClass="text-success"
        duration={duration}
        chevron={expanded ? 'up' : 'down'}
        onToggle={() => setExpanded(!expanded)}
      />
      {expanded && formatted && (
        <>
          <div className="h-px w-full bg-border" />
          <div className="px-2 pb-2">
            <pre className="bg-background rounded-md p-3 font-primary text-[11px] text-muted leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto">
              {formatted.content}
            </pre>
          </div>
        </>
      )}
    </div>
  )
}

function extractMemoryText(content: string): string {
  try {
    const parsed = JSON.parse(content)
    if (parsed?.format === 2 && Array.isArray(parsed.parts)) {
      return parsed.parts
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join(' ')
    }
  } catch {
    // not JSON, use as-is
  }
  return content
}

function formatMemoryDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / 86_400_000)
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

function SearchMemoryOutput({ output }: { output: Record<string, unknown> }) {
  const results = (output.results as any[]) || []
  const message = output.message as string | undefined

  if (results.length === 0) {
    return (
      <>
        <div className="h-px w-full bg-border" />
        <div className="flex items-center gap-2 px-3 py-4 justify-center">
          <span className="material-icon text-muted" style={{ fontSize: 16 }}>search_off</span>
          <span className="font-secondary text-[12px] text-muted">
            {message || 'No memories found for this search'}
          </span>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="h-px w-full bg-border" />
      <div className="bg-background px-3 py-2.5 flex flex-col gap-2.5">
        {results.map((item: any, i: number) => {
          const text = extractMemoryText(item.content || '')
          if (!text.trim()) return null
          const date = item.createdAt ? formatMemoryDate(item.createdAt) : ''
          const source = item.threadTitle || 'another conversation'
          return (
            <div key={i}>
              {i > 0 && <div className="h-px w-full bg-border mb-2.5" />}
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="material-icon text-muted" style={{ fontSize: 12 }}>chat_bubble</span>
                  <span className="font-secondary text-[10px] text-muted">
                    {date}{date ? ' · ' : ''}{source}
                  </span>
                </div>
                <p className="font-secondary text-[12px] text-foreground leading-relaxed m-0 line-clamp-3">
                  {text}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function SourceLinks({ sources }: { sources: SourceUrlUIPart[] }) {
  if (sources.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {sources.map((s) => (
        <a
          key={s.sourceId}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline bg-card border border-border rounded-lg font-secondary"
          style={{ padding: '3px 8px' }}
        >
          <span className="material-icon" style={{ fontSize: 12 }}>link</span>
          {s.title || new URL(s.url).hostname}
        </a>
      ))}
    </div>
  )
}
