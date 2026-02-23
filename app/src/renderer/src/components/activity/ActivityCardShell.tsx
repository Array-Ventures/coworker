import { memo, type ReactNode } from 'react'

type BadgeVariant = 'question' | 'plan' | 'tool' | 'running'

const badgeConfig: Record<BadgeVariant, { dot: string; bg: string; text: string; label: string }> = {
  question: { dot: '#F59E0B', bg: 'bg-amber-50 dark:bg-amber-950', text: 'text-amber-800 dark:text-amber-200', label: 'Needs Input' },
  plan: { dot: '#3B82F6', bg: 'bg-blue-50 dark:bg-blue-950', text: 'text-blue-800 dark:text-blue-200', label: 'Plan Review' },
  tool: { dot: '#EF4444', bg: 'bg-red-50 dark:bg-red-950', text: 'text-red-800 dark:text-red-200', label: 'Tool Approval' },
  running: { dot: '#22C55E', bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-800 dark:text-green-200', label: 'Active' },
}

type ActivityCardShellProps = {
  variant: BadgeVariant
  channel: string
  time: string
  threadTitle: string
  children: ReactNode
  actions: ReactNode
}

export default memo(function ActivityCardShell({
  variant,
  channel,
  time,
  threadTitle,
  children,
  actions,
}: ActivityCardShellProps) {
  const badge = badgeConfig[variant]

  return (
    <div className="flex flex-col gap-3 w-full p-4 rounded-xl bg-card border border-border">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: badge.dot }}
        />
        <span className="text-[11px] font-medium text-muted tracking-wide font-secondary">
          {channel}
        </span>
        <span className="text-[11px] text-muted font-secondary">·</span>
        <span className={`text-[11px] font-secondary ${variant === 'running' ? 'text-green-500 font-medium' : 'text-muted'}`}>
          {time}
        </span>
        <span className="flex-1" />
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${badge.bg} ${badge.text} font-secondary`}>
          {badge.label}
        </span>
      </div>

      {/* Thread title */}
      <p className="text-sm font-medium text-foreground font-secondary leading-snug">
        {threadTitle}
      </p>

      {/* Card-specific content */}
      {children}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {actions}
      </div>
    </div>
  )
})
