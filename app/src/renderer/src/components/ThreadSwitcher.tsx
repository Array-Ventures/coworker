import { useState, useEffect, useCallback, useMemo, memo } from 'react'
import type { StorageThreadType } from '@mastra/core/memory'
import { useAppStore } from '../stores/useAppStore'
import { fetchThreads } from '../mastra-client'

type ThreadSwitcherProps = {
  onClose: () => void
}

export default memo(function ThreadSwitcher({ onClose }: ThreadSwitcherProps) {
  const threadId = useAppStore((s) => s.threadId)
  const openThread = useAppStore((s) => s.openThread)
  const navigate = useAppStore((s) => s.navigate)
  const deleteThread = useAppStore((s) => s.deleteThread)

  const [threads, setThreads] = useState<StorageThreadType[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await fetchThreads()
        if (cancelled) return
        const sorted = [...result].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
        setThreads(sorted as StorageThreadType[])
      } catch (err) {
        console.error('Failed to load threads:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () =>
      threads.filter((t) => {
        if (!search) return true
        const title = (t.title || 'Untitled').toLowerCase()
        return title.includes(search.toLowerCase())
      }),
    [threads, search],
  )

  const handleSelect = useCallback(
    (id: string) => {
      openThread(id)
      onClose()
    },
    [openThread, onClose],
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      setThreads((prev) => prev.filter((t) => t.id !== id))
      deleteThread(id)
    },
    [deleteThread],
  )

  const handleViewAll = useCallback(() => {
    navigate('chats')
    onClose()
  }, [navigate, onClose])

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Dropdown */}
      <div className="absolute top-full left-0 mt-1 z-50 w-[360px] bg-card border border-border rounded-xl shadow-lg overflow-hidden flex flex-col max-h-[360px]">
        {/* Search */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <span className="material-icon text-muted-dim" style={{ fontSize: 16 }}>
            search
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search threads..."
            className="flex-1 bg-transparent text-foreground font-secondary text-[13px] outline-none placeholder:text-muted-dim"
            autoFocus
          />
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto py-1">
          {loading ? (
            <div className="text-muted text-[13px] text-center py-6 font-secondary">
              Loading...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-muted text-[13px] text-center py-6 font-secondary">
              No threads found
            </div>
          ) : (
            filtered.map((thread) => (
              <button
                key={thread.id}
                onClick={() => handleSelect(thread.id)}
                className={`group flex items-center justify-between w-full px-4 h-[44px] text-left font-secondary text-[13px] transition-colors ${
                  thread.id === threadId
                    ? 'bg-sidebar-accent text-foreground font-medium'
                    : 'text-foreground hover:bg-card-hover'
                }`}
              >
                <span className="truncate">{thread.title || 'Untitled'}</span>
                <span
                  role="button"
                  onClick={(e) => handleDelete(e, thread.id)}
                  className="material-icon text-muted-dim hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2"
                  style={{ fontSize: 16 }}
                >
                  delete
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <button
          onClick={handleViewAll}
          className="flex items-center justify-center h-[44px] border-t border-border text-primary font-secondary text-[13px] font-medium hover:bg-card-hover shrink-0"
        >
          View all chats
        </button>
      </div>
    </>
  )
})
