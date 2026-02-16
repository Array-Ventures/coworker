import { memo } from 'react'
import { useAppStore } from '../stores/useAppStore'

type NewChatButtonProps = {
  variant?: 'primary' | 'compact'
}

export default memo(function NewChatButton({ variant = 'primary' }: NewChatButtonProps) {
  const startNewChat = useAppStore((s) => s.startNewChat)

  if (variant === 'compact') {
    return (
      <button
        onClick={startNewChat}
        className="flex items-center gap-1.5 bg-primary text-primary-foreground border-none rounded-md px-3.5 py-1.5 font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover"
      >
        <span className="material-icon" style={{ fontSize: 16 }}>add</span>
        New Chat
      </button>
    )
  }

  return (
    <button
      onClick={startNewChat}
      className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-xl font-secondary text-[13px] font-semibold hover:bg-primary-hover transition-colors shrink-0"
      style={{ padding: '8px 16px' }}
    >
      <span className="material-icon" style={{ fontSize: 16 }}>add</span>
      New Chat
    </button>
  )
})
