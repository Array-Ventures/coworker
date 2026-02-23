import { memo } from 'react'
import type { McpRegistryItem } from '../../mastra-client'
import { titleCase } from './utils'

export function mcpDisplayName(item: McpRegistryItem): string {
  const s = item.server
  if (s.title) return s.title
  const last = s.name.split('/').pop() || s.name
  return titleCase(last)
}

export function mcpTransportType(item: McpRegistryItem): string {
  if (item.server.remotes && item.server.remotes.length > 0) return 'http'
  if (item.server.packages && item.server.packages.length > 0) {
    return item.server.packages[0].transport?.type || 'stdio'
  }
  return 'unknown'
}

export function isMcpAdded(item: McpRegistryItem, configuredServers: { name: string }[]): boolean {
  const display = mcpDisplayName(item)
  return configuredServers.some(
    (s) => s.name === display || s.name === item.server.name,
  )
}

const McpCard = memo(function McpCard({
  item,
  isAdded,
  isBusy,
  onAdd,
}: {
  item: McpRegistryItem
  isAdded: boolean
  isBusy: boolean
  onAdd: () => void
}) {
  const transport = mcpTransportType(item)

  return (
    <div className="flex items-center gap-3 border border-border rounded-xl px-4 py-3 bg-card">
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-background shrink-0">
        <span className="material-icon text-muted" style={{ fontSize: 20 }}>dns</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-secondary text-[13px] font-semibold text-foreground truncate">
            {mcpDisplayName(item)}
          </span>
          <span
            className="inline-flex items-center font-secondary text-[10px] font-medium rounded-md bg-sidebar text-muted shrink-0"
            style={{ padding: '1px 6px' }}
          >
            {transport}
          </span>
        </div>
        {item.server.description && (
          <div className="font-secondary text-[11px] text-muted-dim truncate mt-0.5">
            {item.server.description}
          </div>
        )}
      </div>
      {isAdded ? (
        <span className="shrink-0 bg-secondary border border-border rounded-md text-muted-dim px-3 py-1 font-secondary text-[12px]">
          Added
        </span>
      ) : (
        <button
          onClick={onAdd}
          disabled={isBusy}
          className="shrink-0 bg-transparent border border-border rounded-md text-muted px-3 py-1 font-secondary text-[12px] cursor-pointer hover:bg-sidebar-accent hover:text-foreground disabled:opacity-50 disabled:cursor-default"
        >
          {isBusy ? 'Adding...' : 'Add'}
        </button>
      )}
    </div>
  )
})

export default McpCard
