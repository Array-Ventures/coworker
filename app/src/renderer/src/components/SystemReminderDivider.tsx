/** Centered divider with pill for system reminders (plan approved, etc.) */
export function SystemReminderDivider({ text }: { text: string }) {
  let icon = 'info'
  let label = text
  if (text.toLowerCase().includes('approved the plan')) {
    icon = 'check_circle'
    label = 'Plan approved — executing'
  } else if (text.toLowerCase().includes('rejected') || text.toLowerCase().includes('not approved')) {
    icon = 'cancel'
    label = 'Plan rejected — revising'
  }

  return (
    <div className="flex items-center gap-3 w-full py-1">
      <div className="flex-1 h-px bg-border" />
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-card border border-border">
        <span className="material-icon text-muted-foreground" style={{ fontSize: 14 }}>{icon}</span>
        <span className="font-secondary text-[12px] text-muted-foreground">{label}</span>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}
