import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'
import type { ApiKeyEntry, A2aInfo } from '../../mastra-client'
import {
  fetchApiKeys,
  generateApiKey,
  deleteApiKey,
  fetchA2aInfo,
} from '../../mastra-client'

export interface A2aSlice {
  apiKeys: ApiKeyEntry[]
  a2aInfo: A2aInfo | null
  a2aLoaded: boolean

  loadA2aData: () => Promise<void>
  addApiKey: (label: string) => Promise<ApiKeyEntry>
  removeApiKey: (id: string) => Promise<void>
}

export const createA2aSlice: StateCreator<AppStore, [], [], A2aSlice> = (set, get) => ({
  apiKeys: [],
  a2aInfo: null,
  a2aLoaded: false,

  loadA2aData: async () => {
    try {
      const [keys, info] = await Promise.all([fetchApiKeys(), fetchA2aInfo()])
      set({ apiKeys: keys, a2aInfo: info, a2aLoaded: true })
    } catch {
      set({ a2aLoaded: true })
    }
  },

  addApiKey: async (label) => {
    const entry = await generateApiKey(label)
    // Re-fetch to get truncated list
    const keys = await fetchApiKeys()
    set({ apiKeys: keys })
    return entry // Returns full key for one-time display
  },

  removeApiKey: async (id) => {
    const prev = get().apiKeys
    const updated = prev.filter((k) => k.id !== id)
    set({ apiKeys: updated }) // optimistic
    try {
      await deleteApiKey(id)
    } catch {
      set({ apiKeys: prev }) // rollback
    }
  },
})
