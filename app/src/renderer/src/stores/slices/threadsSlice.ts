import type { StateCreator } from 'zustand'
import type { StorageThreadType } from '@mastra/core/memory'
import type { AppStore } from '../useAppStore'
import { fetchThreads } from '../../mastra-client'

export interface ThreadsSlice {
  threads: StorageThreadType[]
  threadsLoaded: boolean

  loadThreads: () => Promise<void>
  removeThread: (id: string) => void
  updateThreadInList: (id: string, patch: Partial<StorageThreadType>) => void
}

function sortThreads(threads: StorageThreadType[]): StorageThreadType[] {
  return [...threads].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
}

let _loadThreads: Promise<void> | null = null

export const createThreadsSlice: StateCreator<AppStore, [], [], ThreadsSlice> = (set, get) => ({
  threads: [],
  threadsLoaded: false,

  loadThreads: async () => {
    const fetcher = async () => {
      const result = await fetchThreads()
      set({ threads: sortThreads(result as StorageThreadType[]) })
    }

    if (get().threadsLoaded) {
      fetcher().catch(() => {})
      return
    }

    if (!_loadThreads) {
      _loadThreads = fetcher()
        .then(() => set({ threadsLoaded: true }))
        .catch(() => set({ threadsLoaded: true }))
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
