import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'
import type { StagedFile } from '../../types/harness'
import {
  fetchThread,
  updateThreadTitle,
  deleteThread as deleteThreadApi,
  MASTRA_BASE_URL,
  authHeaders,
} from '../../mastra-client'

export function generateThreadId() {
  return `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export interface ChatSlice {
  // State
  threadId: string | null
  threadTitle: string | undefined
  switchingThread: boolean
  input: string
  stagedFiles: StagedFile[]

  // Setters
  setInput: (value: string) => void
  setThreadTitle: (title: string | undefined) => void
  addFiles: (files: StagedFile[]) => void
  removeFile: (index: number) => void
  clearFiles: () => void

  // Actions
  openThread: (threadId: string) => Promise<void>
  startNewChat: () => Promise<void>
  refreshThreadTitle: () => void
  updateTitle: (title: string) => Promise<void>
  deleteThread: (threadId: string) => Promise<void>
}

export const createChatSlice: StateCreator<AppStore, [], [], ChatSlice> = (set, get) => ({
  // App always starts fresh — no persisted thread
  threadId: null,
  threadTitle: undefined,
  switchingThread: false,
  input: '',
  stagedFiles: [],

  setInput: (value) => set({ input: value }),
  setThreadTitle: (title) => set({ threadTitle: title }),
  addFiles: (files) => set((s) => ({ stagedFiles: [...s.stagedFiles, ...files] })),
  removeFile: (index) => set((s) => ({ stagedFiles: s.stagedFiles.filter((_, i) => i !== index) })),
  clearFiles: () => set({ stagedFiles: [] }),

  openThread: async (openThreadId) => {
    const { threadId, currentPage } = get()
    if (openThreadId === threadId && currentPage === 'active-chat') return

    set({
      switchingThread: true,
      threadId: openThreadId,
      currentPage: 'active-chat',
    })

    // Thread switching is now UI-only — harness.switchThread() in useHarness
    // handles message loading via the sync effect in App.tsx
    try {
      const threadData = await fetchThread(openThreadId)
      set({
        threadTitle: threadData.title || 'New Chat',
        switchingThread: false,
      })
    } catch (err) {
      console.error('Failed to load thread:', err)
      set({ switchingThread: false })
    }
  },

  startNewChat: async () => {
    try {
      const res = await fetch(`${MASTRA_BASE_URL}/harness/thread/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      set({
        threadId: data.threadId,
        threadTitle: undefined,
        currentPage: 'active-chat',
      })
    } catch (err) {
      console.error('Failed to create thread:', err)
      // Fallback: generate client-side ID
      set({
        threadId: generateThreadId(),
        threadTitle: undefined,
        currentPage: 'active-chat',
      })
    }
  },

  refreshThreadTitle: async () => {
    const { threadId } = get()
    if (!threadId) return

    try {
      const t = await fetchThread(threadId)
      if (t.title) {
        set({ threadTitle: t.title })
        get().updateThreadInList(threadId, { title: t.title } as any)
      }
    } catch {
      // Thread may not exist yet on first message — title will appear on next refresh
    }
  },

  updateTitle: async (title) => {
    const { threadId } = get()
    if (!threadId || !title.trim()) return
    const trimmed = title.trim()
    set({ threadTitle: trimmed })
    try {
      await updateThreadTitle(threadId, trimmed)
      get().updateThreadInList(threadId, { title: trimmed } as any)
    } catch (err) {
      console.error('Failed to update thread title:', err)
    }
  },

  deleteThread: async (deleteThreadId) => {
    const { threadId, threads } = get()
    const prevThreads = threads
    get().removeThread(deleteThreadId)
    if (deleteThreadId === threadId) {
      set({ threadId: null, threadTitle: undefined, currentPage: 'home' })
    }
    try {
      await deleteThreadApi(deleteThreadId)
    } catch (err) {
      console.error('Failed to delete thread:', err)
      set({ threads: prevThreads })
    }
  },
})
