import { memo } from 'react'

const InstalledItem = memo(function InstalledItem({
  type,
  name,
  description,
  isBusy,
  onRemove,
}: {
  type: 'skill' | 'mcp'
  name: string
  description: string
  isBusy: boolean
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-3 border border-border rounded-xl px-4 py-3 bg-card">
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-background shrink-0">
        <span className="material-icon text-muted" style={{ fontSize: 20 }}>
          {type === 'skill' ? 'extension' : 'dns'}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-secondary text-[13px] font-semibold text-foreground">{name}</span>
          <span
            className={`inline-flex items-center font-secondary text-[10px] font-medium rounded-md shrink-0 ${
              type === 'skill'
                ? 'bg-blue-500/10 text-blue-500'
                : 'bg-orange-500/10 text-orange-500'
            }`}
            style={{ padding: '1px 6px' }}
          >
            {type === 'skill' ? 'Skill' : 'MCP'}
          </span>
        </div>
        {description && (
          <div className="font-secondary text-[11px] text-muted-dim truncate mt-0.5">
            {description}
          </div>
        )}
      </div>
      <button
        onClick={onRemove}
        disabled={isBusy}
        className="shrink-0 bg-red-500/8 border border-red-500/25 rounded-md text-red-400 px-3 py-1 font-secondary text-[12px] cursor-pointer hover:bg-red-500/15 hover:border-red-500/40 disabled:opacity-50 disabled:cursor-default"
      >
        {isBusy ? 'Removing...' : type === 'skill' ? 'Uninstall' : 'Remove'}
      </button>
    </div>
  )
})

export default InstalledItem
