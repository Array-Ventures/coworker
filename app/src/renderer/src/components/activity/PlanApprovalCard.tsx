import { memo } from 'react'
import ActivityCardShell from './ActivityCardShell'
import ActivityButton from './ActivityButton'

type PlanApprovalCardProps = {
  channel: string
  time: string
  threadTitle: string
  planTitle: string
  planSummary: string
  onApprove: () => void
  onReject: () => void
  onOpen: () => void
}

export default memo(function PlanApprovalCard({
  channel,
  time,
  threadTitle,
  planTitle,
  planSummary,
  onApprove,
  onReject,
  onOpen,
}: PlanApprovalCardProps) {
  return (
    <ActivityCardShell
      variant="plan"
      channel={channel}
      time={time}
      threadTitle={threadTitle}
      actions={
        <>
          <ActivityButton label="Approve Plan" variant="success" onClick={onApprove} />
          <ActivityButton label="Reject" onClick={onReject} />
          <ActivityButton label="Open Thread" onClick={onOpen} />
        </>
      }
    >
      <div className="w-full p-3 rounded-lg bg-background flex flex-col gap-1.5">
        <p className="text-[13px] font-medium text-foreground font-secondary">{planTitle}</p>
        <p className="text-xs text-muted font-secondary leading-relaxed whitespace-pre-wrap">{planSummary}</p>
      </div>
    </ActivityCardShell>
  )
})
