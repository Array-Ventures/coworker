import { memo } from 'react'
import ActivityCardShell from './ActivityCardShell'
import ActivityButton from './ActivityButton'

type ToolApprovalCardProps = {
  channel: string
  time: string
  threadTitle: string
  toolName: string
  toolArgs: unknown
  onApprove: () => void
  onAlwaysAllow: () => void
  onDecline: () => void
}

export default memo(function ToolApprovalCard({
  channel,
  time,
  threadTitle,
  toolName,
  toolArgs,
  onApprove,
  onAlwaysAllow,
  onDecline,
}: ToolApprovalCardProps) {
  const argsStr = typeof toolArgs === 'string'
    ? toolArgs
    : typeof toolArgs === 'object' && toolArgs
      ? JSON.stringify(toolArgs, null, 2).slice(0, 200)
      : ''

  return (
    <ActivityCardShell
      variant="tool"
      channel={channel}
      time={time}
      threadTitle={threadTitle}
      actions={
        <>
          <ActivityButton label="Approve" variant="primary" onClick={onApprove} />
          <ActivityButton label="Always Allow" onClick={onAlwaysAllow} />
          <ActivityButton label="Decline" variant="danger" onClick={onDecline} />
        </>
      }
    >
      <div className="w-full p-3 rounded-lg bg-background flex items-center gap-2.5">
        <span className="material-icon text-muted shrink-0" style={{ fontSize: 16 }}>terminal</span>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[13px] font-medium text-foreground font-mono">{toolName}</span>
          {argsStr && (
            <span className="text-xs text-muted font-mono truncate">{argsStr}</span>
          )}
        </div>
      </div>
    </ActivityCardShell>
  )
})
