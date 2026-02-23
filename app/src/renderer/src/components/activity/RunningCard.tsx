import { memo } from 'react'
import ActivityCardShell from './ActivityCardShell'
import ActivityButton from './ActivityButton'

type RunningCardProps = {
  channel: string
  threadTitle: string
  onOpen: () => void
}

export default memo(function RunningCard({
  channel,
  threadTitle,
  onOpen,
}: RunningCardProps) {
  return (
    <ActivityCardShell
      variant="running"
      channel={channel}
      time="Running"
      threadTitle={threadTitle}
      actions={
        <ActivityButton label="Open Thread" onClick={onOpen} />
      }
    >
      <div className="flex items-center gap-2">
        <span className="w-4 h-4 rounded-full bg-green-500/60 animate-pulse shrink-0" />
        <span className="text-[13px] text-muted font-secondary">Processing...</span>
      </div>
    </ActivityCardShell>
  )
})
