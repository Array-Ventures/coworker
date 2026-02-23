import { useState, useMemo, useCallback, memo } from 'react'
import type { StorageThreadType } from '@mastra/core/memory'
import { useAppStore } from '../stores/useAppStore'
import { useSliceData } from '../hooks/useSliceData'
import PageShell from '../components/PageShell'
import FilterTabs from '../components/FilterTabs'
import NewChatButton from '../components/NewChatButton'

const filterOptions = [
  { label: 'All', icon: 'list' },
  { label: 'Chat', icon: 'chat_bubble' },
  { label: 'Scheduled', icon: 'schedule' },
  { label: 'Text', icon: 'sms' },
  { label: 'Email', icon: 'mail' },
  { label: 'API', icon: 'code' },
]

export default memo(function ChatsListPage() {
  const threads = useAppStore((s) => s.threads)
  const threadsLoaded = useAppStore((s) => s.threadsLoaded)
  const threadsFullyLoaded = useAppStore((s) => s.threadsFullyLoaded)
  const loadThreads = useAppStore((s) => s.loadThreads)
  const openThread = useAppStore((s) => s.openThread)
  const deleteThread = useAppStore((s) => s.deleteThread)

  useSliceData(loadThreads)

  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const channelMap: Record<string, string> = {
      Chat: 'app',
      Scheduled: 'scheduled',
      Text: 'whatsapp',
      Email: 'email',
      API: 'api',
    }

    return threads.filter((t) => {
      // Channel filter by thread metadata
      if (filter !== 'All') {
        const channel = (t.metadata as Record<string, unknown> | undefined)?.channel as string | undefined
        const expectedChannel = channelMap[filter]
        if (expectedChannel) {
          // Chat also includes threads without a channel (legacy/pre-migration)
          if (filter === 'Chat') {
            if (channel && channel !== 'app') return false
          } else {
            if (channel !== expectedChannel) return false
          }
        }
      }

      // Text search
      if (search) {
        const title = (t.title || 'Untitled').toLowerCase()
        if (!title.includes(search.toLowerCase())) return false
      }

      return true
    })
  }, [threads, filter, search])

  const grouped = useMemo(() => groupByDate(filtered), [filtered])

  const handleOpenChat = useCallback(
    (threadId: string) => openThread(threadId),
    [openThread],
  )

  return (
    <PageShell>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4">
          <FilterTabs tabs={filterOptions} activeTab={filter} onTabChange={setFilter} />
          <NewChatButton variant="compact" />
        </div>
        <div className="flex items-center gap-2 h-[44px] px-6">
          <span className="material-icon text-muted-dim" style={{ fontSize: 18 }}>search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats..."
            className="flex-1 bg-transparent text-foreground font-secondary text-sm outline-none placeholder:text-muted-dim"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {!threadsLoaded ? (
            <div className="text-muted text-sm text-center py-12">Loading conversations...</div>
          ) : filtered.length === 0 ? (
            <div className="text-muted text-sm text-center py-12">No conversations yet</div>
          ) : (
            Object.entries(grouped).map(([date, items]) => (
              <div key={date} className="mb-4">
                <div className="text-[11px] font-semibold uppercase text-muted-dim mb-2 px-1">
                  {date}
                </div>
                <div className="flex flex-col gap-0.5">
                  {items.map((thread) => (
                    <button
                      key={thread.id}
                      onClick={() => handleOpenChat(thread.id)}
                      className="group flex items-center justify-between w-full bg-transparent border-none rounded-md px-3 py-2.5 cursor-pointer text-left font-secondary transition-colors text-muted hover:bg-card hover:text-foreground"
                    >
                      <span className="text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap">
                        {thread.title || 'Untitled'}
                      </span>
                      <span className="flex items-center gap-2 shrink-0 ml-3">
                        <span className="text-[11px] text-muted-dim">
                          {new Date(thread.updatedAt).toLocaleDateString()}
                        </span>
                        <span
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteThread(thread.id)
                          }}
                          className="material-icon text-muted-dim hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ fontSize: 16 }}
                        >
                          delete
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
          {threadsLoaded && !threadsFullyLoaded && (
            <div className="text-muted-dim text-xs text-center py-4">Loading more conversations...</div>
          )}
        </div>
      </div>
    </PageShell>
  )
})

function groupByDate(threads: StorageThreadType[]): Record<string, StorageThreadType[]> {
  const groups: Record<string, StorageThreadType[]> = {}
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  for (const thread of threads) {
    const date = new Date(thread.updatedAt)
    let label: string
    if (date.toDateString() === today.toDateString()) {
      label = 'Today'
    } else if (date.toDateString() === yesterday.toDateString()) {
      label = 'Yesterday'
    } else {
      label = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    }
    if (!groups[label]) groups[label] = []
    groups[label].push(thread)
  }
  return groups
}
