import { useState } from 'react'
import type { ToolState } from '../types/harness'
import { getToolDisplay, getPrimaryArgValue, getExecutionTime, formatToolOutput } from '../lib/tool-display'
import { SearchMemoryOutput } from './SearchMemoryOutput'
import { AppRenderer } from '@mcp-ui/client'

const sandboxConfig = { url: new URL('./sandbox_proxy.html', window.location.href) }

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

function ViewImageHeader({
  toolName,
  args,
  sizeLabel,
  chevron,
  onToggle,
}: {
  toolName: string
  args: unknown
  sizeLabel: string
  chevron: 'up' | 'down'
  onToggle: () => void
}) {
  const display = getToolDisplay(toolName)
  const argValue = getPrimaryArgValue(toolName, args)

  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 w-full bg-transparent border-none cursor-pointer py-2 px-3"
    >
      <span className="material-icon text-success" style={{ fontSize: 16 }}>
        check_circle
      </span>
      <span className="material-icon text-foreground" style={{ fontSize: 15 }}>
        {display.icon}
      </span>
      <span className="font-secondary text-[13px] font-semibold text-foreground">
        {display.displayName}
      </span>
      {argValue && <ToolArgPill value={argValue} />}
      <span className="w-px h-3 bg-border" />
      <span className="font-primary text-[11px] text-muted">{sizeLabel}</span>
      <span className="material-icon text-muted" style={{ fontSize: 16 }}>
        {chevron === 'up' ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
      </span>
    </button>
  )
}

export function ToolInvocation({
  toolState,
  onResolveApproval,
}: {
  toolState: ToolState
  onResolveApproval?: (decision: 'approve' | 'decline' | 'always_allow_category') => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { toolName, args, status, result, isError, shellOutput } = toolState

  // Running state
  if (status === 'running') {
    return (
      <div className="bg-card border border-border rounded-lg mt-2 overflow-hidden">
        <ToolHeader
          toolName={toolName}
          args={args}
          statusIcon="progress_activity"
          statusIconClass="text-primary animate-spin"
        />
        {shellOutput && (
          <>
            <div className="h-px w-full bg-border" />
            <pre className="bg-background rounded-md mx-2 mb-2 p-3 font-primary text-[11px] text-muted leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto">
              {shellOutput}
            </pre>
          </>
        )}
      </div>
    )
  }

  // Approval required
  if (status === 'approval_required') {
    return (
      <div className="bg-card border border-primary rounded-lg mt-2 overflow-hidden">
        <ToolHeader
          toolName={toolName}
          args={args}
          statusIcon="verified_user"
          statusIconClass="text-primary"
        />
        <div className="h-px w-full bg-primary/20" />
        <div className="flex items-center gap-2 p-3">
          <button
            onClick={() => onResolveApproval?.('approve')}
            className="flex items-center gap-1 bg-primary text-primary-foreground rounded-lg font-secondary text-xs font-semibold hover:bg-primary-hover transition-colors"
            style={{ padding: '4px 12px' }}
          >
            <span className="material-icon" style={{ fontSize: 12 }}>check</span>
            Approve
          </button>
          <button
            onClick={() => onResolveApproval?.('always_allow_category')}
            className="flex items-center gap-1 bg-secondary text-foreground rounded-lg font-secondary text-xs font-semibold hover:bg-card transition-colors"
            style={{ padding: '4px 12px' }}
          >
            <span className="material-icon" style={{ fontSize: 12 }}>done_all</span>
            Always Allow
          </button>
          <button
            onClick={() => onResolveApproval?.('decline')}
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
  if (status === 'approval_responded') {
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
          <span className="font-secondary text-[11px] font-medium text-success">
            Approved
          </span>
        </div>
      </div>
    )
  }

  // Error state
  if (status === 'error') {
    const errorText = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    return (
      <div className="bg-card border border-error rounded-lg mt-2 overflow-hidden">
        <ToolHeader
          toolName={toolName}
          args={args}
          statusIcon="error"
          statusIconClass="text-error"
        />
        <div className="h-px w-full bg-error/20" />
        <div className="px-2 pb-2">
          <pre className="bg-error-bg rounded-md p-3 font-primary text-[11px] text-error/80 whitespace-pre-wrap break-all max-h-[100px] overflow-y-auto">
            {errorText}
          </pre>
        </div>
      </div>
    )
  }

  // Completed — collapsible output
  const duration = getExecutionTime(result)
  const formatted = expanded ? formatToolOutput(toolName, result) : null
  const outputObj = result as Record<string, unknown> | undefined

  // Search Memory — custom render
  if (toolName === 'searchMemory' && outputObj) {
    return (
      <div className="bg-card border border-border rounded-lg mt-2 overflow-hidden">
        <ToolHeader
          toolName={toolName}
          args={args}
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

  // view_image — render the actual image
  if (toolName === 'view_image' && typeof result === 'string') {
    const imgMatch = (result as string).match(/^(.+?)\s+\((\d+) bytes, (image\/\w+)\)\n(.+)$/s)
    if (imgMatch) {
      const [, , size, mimeType, base64] = imgMatch
      const sizeKB = Math.round(Number(size) / 1024)
      return (
        <div className="bg-card border border-border rounded-lg mt-2 overflow-hidden">
          <ViewImageHeader
            toolName={toolName}
            args={args}
            sizeLabel={`${sizeKB} KB`}
            chevron={expanded ? 'up' : 'down'}
            onToggle={() => setExpanded(!expanded)}
          />
          {expanded && (
            <>
              <div className="h-px w-full bg-border" />
              <div className="bg-background p-2">
                <img
                  src={`data:${mimeType};base64,${base64}`}
                  alt={getPrimaryArgValue(toolName, args) || 'image'}
                  className="rounded-md max-w-full max-h-[400px] object-contain"
                />
              </div>
            </>
          )}
        </div>
      )
    }
  }

  // Detect MCP UI resource in tool output
  const isUiResource =
    outputObj?.type === 'resource' &&
    typeof (outputObj?.resource as any)?.uri === 'string' &&
    (outputObj?.resource as any)?.uri?.startsWith('ui://')

  if (isUiResource) {
    const resource = outputObj!.resource as { uri: string; text: string }
    return (
      <div className="bg-card border border-border rounded-lg mt-2 overflow-hidden">
        <ToolHeader
          toolName={toolName}
          args={args}
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
            toolInput={args as Record<string, unknown>}
            toolResult={outputObj as any}
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
        args={args}
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
