import { memo } from 'react'

type SuggestionCardProps = {
  text: string
  onClick: (text: string) => void
  animationDelay?: number
}

export default memo(function SuggestionCard({ text, onClick, animationDelay }: SuggestionCardProps) {
  return (
    <button
      onClick={() => onClick(text)}
      className="h-[44px] w-full border-t border-border px-4 flex items-center text-left text-foreground font-secondary text-[14px] hover:bg-card-hover transition-colors animate-fadeSlideIn"
      style={animationDelay ? { animationDelay: `${animationDelay}ms` } : undefined}
    >
      {text}
    </button>
  )
})
