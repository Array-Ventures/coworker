import { memo } from 'react'
import ActivityCardShell from './ActivityCardShell'
import ActivityButton from './ActivityButton'

type QuestionCardProps = {
  channel: string
  time: string
  threadTitle: string
  question: string
  options?: { label: string; description?: string }[]
  onOpen: () => void
  onDismiss: () => void
}

export default memo(function QuestionCard({
  channel,
  time,
  threadTitle,
  question,
  options,
  onOpen,
  onDismiss,
}: QuestionCardProps) {
  return (
    <ActivityCardShell
      variant="question"
      channel={channel}
      time={time}
      threadTitle={threadTitle}
      actions={
        <>
          <ActivityButton label="Open Thread" variant="primary" onClick={onOpen} />
          <ActivityButton label="Dismiss" onClick={onDismiss} />
        </>
      }
    >
      <div className="w-full p-3 rounded-lg bg-background">
        <p className="text-[13px] text-foreground font-secondary">{question}</p>
      </div>
      {options && options.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted font-secondary">{i + 1}.</span>
              <span className="text-[13px] text-foreground font-secondary">{opt.label}</span>
              {opt.description && (
                <span className="text-[12px] text-muted font-secondary">— {opt.description}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </ActivityCardShell>
  )
})
