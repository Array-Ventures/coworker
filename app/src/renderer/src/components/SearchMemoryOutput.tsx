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

export function SearchMemoryOutput({ output }: { output: Record<string, unknown> }) {
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
