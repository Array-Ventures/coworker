import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'
import type { A2aInfo } from '../../mastra-client'
import { fetchA2aInfo } from '../../mastra-client'

export interface A2aSlice {
  a2aInfo: A2aInfo | null
  a2aLoaded: boolean

  loadA2aData: () => Promise<void>
}

let _loadA2a: Promise<void> | null = null

export const createA2aSlice: StateCreator<AppStore, [], [], A2aSlice> = (set, get) => ({
  a2aInfo: null,
  a2aLoaded: false,

  loadA2aData: async () => {
    const fetcher = async () => {
      const info = await fetchA2aInfo()
      set({ a2aInfo: info })
    }

    if (get().a2aLoaded) { fetcher().catch(() => {}); return }

    if (!_loadA2a) {
      _loadA2a = fetcher()
        .then(() => set({ a2aLoaded: true }))
        .catch(() => set({ a2aLoaded: true }))
        .finally(() => { _loadA2a = null })
    }
    return _loadA2a
  },
})
