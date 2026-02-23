import { useEffect, useRef } from 'react'

const MODES = [
  { id: 'build', name: 'Build', description: 'Execute tasks and write code', dotClass: 'bg-primary', icon: 'build' },
  { id: 'plan', name: 'Plan', description: 'Research and create plans', dotClass: 'bg-blue-500', icon: 'draft' },
  { id: 'fast', name: 'Fast', description: 'Quick responses', dotClass: 'bg-green-500', icon: 'bolt' },
] as const

type ModeSwitcherProps = {
  currentModeId: string
  onSelect: (modeId: string) => void
  onClose: () => void
}

export default function ModeSwitcher({ currentModeId, onSelect, onClose }: ModeSwitcherProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 w-[240px] bg-card border border-border rounded-lg shadow-lg overflow-hidden z-50"
    >
      {MODES.map((mode) => {
        const isSelected = mode.id === currentModeId
        return (
          <button
            key={mode.id}
            onClick={() => {
              onSelect(mode.id)
              onClose()
            }}
            className={`flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors ${
              isSelected ? 'bg-secondary' : 'hover:bg-secondary/50'
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${mode.dotClass}`} />
            <div className="flex-1 min-w-0">
              <div className="font-secondary text-[13px] font-medium text-foreground">{mode.name}</div>
              <div className="font-secondary text-[11px] text-muted-dim">{mode.description}</div>
            </div>
            {isSelected && (
              <span className="material-icon text-primary shrink-0" style={{ fontSize: 16 }}>check</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
