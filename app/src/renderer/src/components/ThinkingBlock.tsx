import { useState } from 'react'

export function ThinkingBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [expanded, setExpanded] = useState(false)

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
      {(expanded || isStreaming) && text && (
        <div className="mt-2 text-muted-dim font-secondary text-[12px] leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto">
          {text}
        </div>
      )}
    </div>
  )
}
