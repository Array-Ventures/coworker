import type { StateCreator } from 'zustand'
import type { StorageThreadType } from '@mastra/core/memory'
import type { AppStore } from '../useAppStore'
import { fetchThreadsPage } from '../../mastra-client'

export interface ThreadsSlice {
  threads: StorageThreadType[]
  threadsLoaded: boolean
  threadsFullyLoaded: boolean

  loadThreads: () => Promise<void>
  removeThread: (id: string) => void
  updateThreadInList: (id: string, patch: Partial<StorageThreadType>) => void
}

let _loadThreads: Promise<void> | null = null

export const createThreadsSlice: StateCreator<AppStore, [], [], ThreadsSlice> = (set, get) => ({
  threads: [],
  threadsLoaded: false,
  threadsFullyLoaded: false,

  loadThreads: async () => {
    const fetcher = async () => {
      const first = await fetchThreadsPage(0)

      if (get().threadsLoaded) {
        // SWR revalidation: accumulate all pages, then atomic swap
        const allThreads = [...first.threads]
        let page = 1
        let hasMore = first.hasMore
        while (hasMore) {
          const result = await fetchThreadsPage(page)
          allThreads.push(...result.threads)
          hasMore = result.hasMore
          page++
        }
        set({ threads: allThreads, threadsFullyLoaded: true })
      } else {
        // First load: render page 0 immediately, fetch rest in background
        set({ threads: first.threads, threadsLoaded: true })

        if (first.hasMore) {
          let page = 1
          let hasMore = true
          while (hasMore) {
            const result = await fetchThreadsPage(page)
            set((s) => ({
              threads: [...s.threads, ...result.threads.filter((t) => !s.threads.some((e) => e.id === t.id))],
            }))
            hasMore = result.hasMore
            page++
          }
        }
        set({ threadsFullyLoaded: true })
      }
    }

    // SWR: if already loaded, revalidate silently in background
    if (get().threadsLoaded) {
      fetcher().catch(() => {})
      return
    }

    // Dedup: only one initial load in flight at a time
    if (!_loadThreads) {
      _loadThreads = fetcher()
        .then(() => set({ threadsLoaded: true }))
        .catch(() => set({ threadsLoaded: true, threadsFullyLoaded: true }))
        .finally(() => { _loadThreads = null })
    }
    return _loadThreads
  },

  removeThread: (id) => {
    set((s) => ({ threads: s.threads.filter((t) => t.id !== id) }))
  },

  updateThreadInList: (id, patch) => {
    set((s) => ({
      threads: s.threads.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }))
  },
})
