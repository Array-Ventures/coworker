interface ScheduledTask {
  name: string
  id: string
  cron: string
  enabled: boolean
  lastRun: string
  prompt: string
}

function parseListOutput(output: string): ScheduledTask[] {
  const tasks: ScheduledTask[] = []
  // Each task block: - **Name** (id)\n  Cron: `expr` | Enabled: bool | Last run: val\n  Prompt: text
  const blocks = output.split(/\n\n/)
  for (const block of blocks) {
    const headerMatch = block.match(/^- \*\*(.+?)\*\* \((.+?)\)/)
    if (!headerMatch) continue
    const [, name, id] = headerMatch
    const cronMatch = block.match(/Cron: `(.+?)`/)
    const enabledMatch = block.match(/Enabled: (true|false)/)
    const lastRunMatch = block.match(/Last run: (.+?)(?:\n|$)/)
    const promptMatch = block.match(/Prompt: (.+)$/s)
    tasks.push({
      name,
      id,
      cron: cronMatch?.[1] ?? '',
      enabled: enabledMatch?.[1] === 'true',
      lastRun: lastRunMatch?.[1] ?? 'never',
      prompt: promptMatch?.[1]?.trim() ?? '',
    })
  }
  return tasks
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr || dateStr === 'never') return 'never'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    const diffMs = Date.now() - d.getTime()
    const mins = Math.floor(diffMs / 60_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

function TaskRow({ task }: { task: ScheduledTask }) {
  return (
    <div className="flex flex-col gap-1.5 bg-card rounded-lg px-3 py-2.5">
      {/* Top: name, id, badge */}
      <div className="flex items-center gap-2">
        <span className="font-secondary text-[13px] font-semibold text-foreground">
          {task.name}
        </span>
        <span className="font-primary text-[11px] text-muted-foreground">
          {task.id}
        </span>
        <span className="flex-1" />
        <EnabledBadge enabled={task.enabled} />
      </div>
      {/* Meta: cron, last run */}
      <div className="flex items-center gap-3">
        <span className="material-icon text-muted-foreground" style={{ fontSize: 13 }}>timer</span>
        <span className="font-primary text-[11px] text-muted-foreground">{task.cron}</span>
        <span className="text-[11px] text-muted-dim">·</span>
        <span className="font-secondary text-[11px] text-muted-foreground">
          Last run: {formatRelativeTime(task.lastRun)}
        </span>
      </div>
      {/* Prompt preview */}
      <p className="font-secondary text-[11px] text-muted-dim leading-relaxed m-0 line-clamp-1">
        {task.prompt}
      </p>
    </div>
  )
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className="flex items-center gap-1 bg-success-bg rounded-full px-2 py-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-success" />
      <span className="font-secondary text-[10px] font-medium text-success">Enabled</span>
    </span>
  ) : (
    <span className="border border-border rounded-full px-2 py-0.5">
      <span className="font-secondary text-[10px] font-medium text-muted-foreground">Disabled</span>
    </span>
  )
}

interface MutationInfo {
  action: 'created' | 'updated' | 'deleted'
  name: string
  id: string
  cron?: string
  enabled?: boolean
  nextRun?: string
}

function parseMutationOutput(output: string): MutationInfo | null {
  // Created scheduled task "Name" (id)\nCron: `expr`\nNext run: datetime
  const createMatch = output.match(/^Created scheduled task "(.+?)" \((.+?)\)/)
  if (createMatch) {
    const cronMatch = output.match(/Cron: `(.+?)`/)
    const nextRunMatch = output.match(/Next run: (.+)$/)
    return {
      action: 'created',
      name: createMatch[1],
      id: createMatch[2],
      cron: cronMatch?.[1],
      nextRun: nextRunMatch?.[1],
    }
  }

  // Updated task "Name" (id)\nCron: `expr` | Enabled: bool
  const updateMatch = output.match(/^Updated task "(.+?)" \((.+?)\)/)
  if (updateMatch) {
    const cronMatch = output.match(/Cron: `(.+?)`/)
    const enabledMatch = output.match(/Enabled: (true|false)/)
    return {
      action: 'updated',
      name: updateMatch[1],
      id: updateMatch[2],
      cron: cronMatch?.[1],
      enabled: enabledMatch ? enabledMatch[1] === 'true' : undefined,
    }
  }

  // Deleted scheduled task "Name" (id).
  const deleteMatch = output.match(/^Deleted scheduled task "(.+?)" \((.+?)\)/)
  if (deleteMatch) {
    return { action: 'deleted', name: deleteMatch[1], id: deleteMatch[2] }
  }

  return null
}

const ACTION_CONFIG = {
  created: { icon: 'add_circle', color: 'text-success', label: 'Created' },
  updated: { icon: 'edit', color: 'text-primary', label: 'Updated' },
  deleted: { icon: 'delete', color: 'text-destructive', label: 'Deleted' },
} as const

/** Renders create/update/delete confirmation */
function MutationOutput({ output }: { output: string }) {
  // Error output
  if (output.startsWith('Error:')) {
    return (
      <>
        <div className="h-px w-full bg-border" />
        <div className="flex items-center gap-2 bg-error-bg px-3 py-2.5">
          <span className="material-icon text-error" style={{ fontSize: 14 }}>error</span>
          <span className="font-secondary text-[12px] text-error">{output}</span>
        </div>
      </>
    )
  }

  const info = parseMutationOutput(output)
  if (!info) {
    // Fallback for unparseable output
    return (
      <>
        <div className="h-px w-full bg-border" />
        <div className="bg-background px-3 py-2.5">
          <p className="font-secondary text-[12px] text-foreground leading-relaxed m-0 whitespace-pre-wrap">
            {output}
          </p>
        </div>
      </>
    )
  }

  const config = ACTION_CONFIG[info.action]

  return (
    <>
      <div className="h-px w-full bg-border" />
      <div className="bg-background px-3 py-2.5 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className={`material-icon ${config.color}`} style={{ fontSize: 14 }}>
            {config.icon}
          </span>
          <span className={`font-secondary text-[11px] font-medium ${config.color}`}>
            {config.label}
          </span>
          <span className="font-secondary text-[13px] font-semibold text-foreground">
            {info.name}
          </span>
          <span className="font-primary text-[11px] text-muted-foreground">{info.id}</span>
          {info.enabled !== undefined && (
            <>
              <span className="flex-1" />
              <EnabledBadge enabled={info.enabled} />
            </>
          )}
        </div>
        {info.cron && (
          <div className="flex items-center gap-3">
            <span className="material-icon text-muted-foreground" style={{ fontSize: 13 }}>timer</span>
            <span className="font-primary text-[11px] text-muted-foreground">{info.cron}</span>
            {info.nextRun && (
              <>
                <span className="text-[11px] text-muted-dim">·</span>
                <span className="font-secondary text-[11px] text-muted-foreground">
                  Next run: {info.nextRun}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}

export function ScheduledTasksOutput({
  action,
  output,
}: {
  action: string
  output: string
}) {
  // List action — parse and render task cards
  if (action === 'list') {
    const tasks = parseListOutput(output)

    if (tasks.length === 0) {
      return (
        <>
          <div className="h-px w-full bg-border" />
          <div className="flex items-center gap-2 px-3 py-4 justify-center">
            <span className="material-icon text-muted" style={{ fontSize: 16 }}>event_busy</span>
            <span className="font-secondary text-[12px] text-muted">
              No scheduled tasks found
            </span>
          </div>
        </>
      )
    }

    return (
      <>
        <div className="h-px w-full bg-border" />
        <div className="bg-background px-3 py-2.5 flex flex-col gap-1.5">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      </>
    )
  }

  // Create/update/delete — simple confirmation text
  return <MutationOutput output={output} />
}
