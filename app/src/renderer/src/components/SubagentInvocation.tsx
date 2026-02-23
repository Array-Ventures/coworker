import { useState } from 'react'
import type { SubagentState, SubagentToolState } from '../types/harness'
import { getToolDisplay } from '../lib/tool-display'

function summarizeToolArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const obj = args as Record<string, unknown>
  if (obj.path && typeof obj.path === 'string') {
    return obj.path.length > 50 ? '...' + obj.path.slice(-47) : obj.path
  }
  if (obj.pattern && typeof obj.pattern === 'string') {
    return obj.pattern.length > 40 ? obj.pattern.slice(0, 37) + '...' : obj.pattern
  }
  if (obj.query && typeof obj.query === 'string') {
    return obj.query.length > 40 ? obj.query.slice(0, 37) + '...' : obj.query
  }
  if (obj.command && typeof obj.command === 'string') {
    return obj.command.length > 40 ? obj.command.slice(0, 37) + '...' : obj.command
  }
  for (const val of Object.values(obj)) {
    if (typeof val === 'string' && val.length > 0) {
      return val.length > 40 ? val.slice(0, 37) + '...' : val
    }
  }
  return ''
}

function SectionLabel({ children }: { children: string }) {
  return (
    <span className="text-[10px] font-secondary font-bold text-muted-dim tracking-[1.5px] uppercase">
      {children}
    </span>
  )
}

function ToolRow({ tool }: { tool: SubagentToolState }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span
        className={`material-icon ${tool.status === 'running' ? 'text-primary animate-spin' : tool.isError ? 'text-error' : 'text-success'}`}
        style={{ fontSize: 12 }}
      >
        {tool.status === 'running' ? 'progress_activity' : tool.isError ? 'error' : 'check_circle'}
      </span>
      <span className="font-secondary font-medium text-foreground">
        {getToolDisplay(tool.toolName).displayName}
      </span>
      <span className="font-primary text-muted-foreground truncate">
        {summarizeToolArgs(tool.toolName, tool.args)}
      </span>
    </div>
  )
}

export function SubagentInvocation({ state }: { state: SubagentState }) {
  const [expanded, setExpanded] = useState(false)
  const isRunning = state.status === 'running'
  const isError = state.status === 'error'

  return (
    <div className={`bg-card border ${isError ? 'border-error' : 'border-border'} rounded-lg mt-2 overflow-hidden`}>
      {/* Header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full bg-transparent border-none cursor-pointer py-2 px-3"
      >
        <span
          className={`material-icon ${isRunning ? 'text-primary animate-spin' : isError ? 'text-error' : 'text-success'}`}
          style={{ fontSize: 16 }}
        >
          {isRunning ? 'progress_activity' : isError ? 'error' : 'check_circle'}
        </span>
        <span className="material-icon text-foreground" style={{ fontSize: 15 }}>smart_toy</span>
        <span className="font-secondary text-[13px] font-semibold text-foreground">
          {state.agentType}
        </span>
        <span className="bg-secondary rounded px-1.5 py-0.5 font-primary text-[11px] text-foreground truncate max-w-[200px]">
          {state.task}
        </span>
        {state.durationMs != null && (
          <>
            <span className="w-px h-3 bg-border" />
            <span className="font-primary text-[11px] text-muted-foreground">
              {state.durationMs > 1000 ? `${(state.durationMs / 1000).toFixed(1)}s` : `${state.durationMs}ms`}
            </span>
          </>
        )}
        <span className="material-icon text-muted-foreground ml-auto" style={{ fontSize: 16 }}>
          {expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
        </span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <>
          <div className="h-px w-full bg-border" />
          <div className="px-3 py-2 flex flex-col gap-3">
            {/* Tool Calls section */}
            {state.nestedTools.length > 0 && (
              <div className="flex flex-col gap-1">
                <SectionLabel>Tool Calls</SectionLabel>
                {state.nestedTools.map((tool, i) => (
                  <ToolRow key={i} tool={tool} />
                ))}
              </div>
            )}

            {/* Thinking section — only while running */}
            {isRunning && state.text && (
              <>
                {state.nestedTools.length > 0 && <div className="h-px w-full bg-border" />}
                <div className="flex flex-col gap-1">
                  <SectionLabel>Thinking</SectionLabel>
                  <pre className="bg-background rounded-md p-3 font-primary text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto m-0">
                    {state.text}
                  </pre>
                </div>
              </>
            )}

            {/* Result section — only after completion */}
            {!isRunning && state.result && (
              <>
                {state.nestedTools.length > 0 && <div className="h-px w-full bg-border" />}
                <div className="flex flex-col gap-1">
                  <SectionLabel>Result</SectionLabel>
                  <pre className="bg-background rounded-md p-3 font-primary text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto m-0">
                    {state.result}
                  </pre>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
