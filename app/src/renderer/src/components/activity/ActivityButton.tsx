import { memo } from 'react'

type ActivityButtonProps = {
  label: string
  variant?: 'primary' | 'success' | 'danger' | 'ghost'
  onClick: () => void
}

const variantStyles: Record<string, string> = {
  primary: 'bg-foreground text-background',
  success: 'bg-green-600 text-white',
  danger: 'bg-transparent border border-border text-red-500',
  ghost: 'bg-transparent border border-border text-muted',
}

export default memo(function ActivityButton({ label, variant = 'ghost', onClick }: ActivityButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-xs font-medium font-secondary cursor-pointer transition-opacity hover:opacity-80 ${variantStyles[variant]}`}
    >
      {label}
    </button>
  )
})
