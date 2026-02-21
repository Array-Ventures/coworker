import type { StateCreator } from 'zustand'
import type { UIMessage, FileUIPart } from 'ai'
import type { StorageThreadType } from '@mastra/core/memory'
import type { AppStore } from '../useAppStore'
import {
  fetchThread,
  fetchThreadMessages,
  updateThreadTitle,
  deleteThread as deleteThreadApi,
} from '../../mastra-client'
import { serverMessagesToUIMessages } from '../../convert-messages'

export function generateThreadId() {
  return `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const MESSAGES_PER_PAGE = 40

/** Shared fetch: load first page of messages + thread metadata */
async function loadThread(threadId: string) {
  const [msgResult, threadData]: [
    Awaited<ReturnType<typeof fetchThreadMessages>>,
    StorageThreadType,
  ] = await Promise.all([
    fetchThreadMessages(threadId, 0, MESSAGES_PER_PAGE),
    fetchThread(threadId),
  ])
  // Messages fetched DESC (newest first) — reverse for display (oldest first)
  const messages = serverMessagesToUIMessages([...msgResult.messages].reverse())
  return {
    messages,
    title: threadData.title || 'New Chat',
    messagesHasMore: msgResult.hasMore,
  }
}

export interface ChatSlice {
  // State
  threadId: string | null
  threadTitle: string | undefined
  switchingThread: boolean
  input: string
  stagedFiles: FileUIPart[]
  pendingLoad: { messages: UIMessage[]; title: string } | null
  messagesPage: number
  messagesHasMore: boolean
  loadingOlderMessages: boolean

  // Setters
  setInput: (value: string) => void
  setThreadTitle: (title: string | undefined) => void
  addFiles: (files: FileUIPart[]) => void
  removeFile: (index: number) => void
  clearFiles: () => void

  // Actions
  openThread: (threadId: string) => Promise<void>
  startNewChat: () => void
  refreshThreadTitle: () => void
  updateTitle: (title: string) => Promise<void>
  deleteThread: (threadId: string) => Promise<void>
  loadOlderMessages: () => Promise<UIMessage[] | null>
}

export const createChatSlice: StateCreator<AppStore, [], [], ChatSlice> = (set, get) => ({
  // App always starts fresh — no persisted thread
  threadId: null,
  threadTitle: undefined,
  switchingThread: false,
  input: '',
  stagedFiles: [],
  pendingLoad: null,
  messagesPage: 0,
  messagesHasMore: false,
  loadingOlderMessages: false,

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
      pendingLoad: null,
      messagesPage: 0,
      messagesHasMore: false,
      loadingOlderMessages: false,
    })
    try {
      const data = await loadThread(openThreadId)
      set({
        threadTitle: data.title,
        pendingLoad: data,
        messagesHasMore: data.messagesHasMore,
      })
    } catch (err) {
      console.error('Failed to load thread:', err)
      set({ switchingThread: false })
    }
  },

  startNewChat: () => set({
    threadId: generateThreadId(),
    threadTitle: undefined,
    currentPage: 'active-chat',
    pendingLoad: null,
    messagesPage: 0,
    messagesHasMore: false,
    loadingOlderMessages: false,
  }),

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
      set({ threadId: null, threadTitle: undefined, currentPage: 'home', pendingLoad: null })
    }
    try {
      await deleteThreadApi(deleteThreadId)
    } catch (err) {
      console.error('Failed to delete thread:', err)
      set({ threads: prevThreads })
    }
  },

  loadOlderMessages: async () => {
    const { threadId, messagesHasMore, loadingOlderMessages } = get()
    if (!threadId || !messagesHasMore || loadingOlderMessages) return null

    set({ loadingOlderMessages: true })
    try {
      const nextPage = get().messagesPage + 1
      const result = await fetchThreadMessages(threadId, nextPage, MESSAGES_PER_PAGE)
      // Messages fetched DESC — reverse for display (oldest first)
      const olderMessages = serverMessagesToUIMessages([...result.messages].reverse())
      set({
        messagesPage: nextPage,
        messagesHasMore: result.hasMore,
      })
      return olderMessages
    } catch (err) {
      console.error('Failed to load older messages:', err)
      return null
    } finally {
      set({ loadingOlderMessages: false })
    }
  },
})
