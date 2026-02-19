import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'
import type { Provider } from '@mastra/client-js'
import type { WorkingMemory, ObservationalMemoryRecord } from '../../mastra-client'
import {
  fetchWorkingMemory,
  saveWorkingMemory,
  fetchAgentConfig,
  updateAgentConfig,
  fetchAIProviders,
  fetchObservationalMemory,
} from '../../mastra-client'

export type { Provider }

export interface AgentConfigState {
  model: string
  defaultModel: string
  isCustomModel: boolean
}

export interface BrainSlice {
  workingMemory: WorkingMemory
  agentConfig: AgentConfigState | null
  providers: Provider[]
  brainLoaded: boolean
  savingField: boolean
  observationalMemory: ObservationalMemoryRecord | null

  loadBrain: () => Promise<void>
  updateBrainField: (section: 'persona' | 'org', field: string, value: string) => Promise<void>
  updateModel: (model: string | null) => Promise<void>
  loadObservationalMemory: () => Promise<void>
}

let _loadBrain: Promise<void> | null = null

export const createBrainSlice: StateCreator<AppStore, [], [], BrainSlice> = (set, get) => ({
  workingMemory: {},
  agentConfig: null,
  providers: [],
  brainLoaded: false,
  savingField: false,
  observationalMemory: null,

  loadBrain: async () => {
    const fetcher = async () => {
      const [wm, config, providerList] = await Promise.all([
        fetchWorkingMemory(),
        fetchAgentConfig(),
        fetchAIProviders(),
      ])
      set({
        workingMemory: wm,
        agentConfig: {
          model: config.model,
          defaultModel: config.defaultModel,
          isCustomModel: config.isCustomModel,
        },
        providers: (providerList as Provider[]).sort((a, b) => {
          if (a.connected !== b.connected) return a.connected ? -1 : 1
          return a.name.localeCompare(b.name)
        }),
      })
    }

    if (get().brainLoaded) { fetcher().catch(() => {}); return }

    if (!_loadBrain) {
      _loadBrain = fetcher()
        .then(() => set({ brainLoaded: true }))
        .catch(() => set({ brainLoaded: true }))
        .finally(() => { _loadBrain = null })
    }
    return _loadBrain
  },

  updateBrainField: async (section, field, value) => {
    const prev = get().workingMemory
    // Optimistic update
    const updated: WorkingMemory = {
      ...prev,
      [section]: { ...(prev[section] as Record<string, string> | undefined), [field]: value },
    }
    set({ workingMemory: updated, savingField: true })
    try {
      await saveWorkingMemory(updated)
    } catch {
      set({ workingMemory: prev })
    } finally {
      set({ savingField: false })
    }
  },

  loadObservationalMemory: async () => {
    try {
      const record = await fetchObservationalMemory()
      set({ observationalMemory: record })
    } catch {
      // silently fail — subconscious tab will show empty state
    }
  },

  updateModel: async (model) => {
    const prev = get().agentConfig
    try {
      const config = await updateAgentConfig({ model })
      set({
        agentConfig: {
          model: config.model,
          defaultModel: config.defaultModel,
          isCustomModel: config.isCustomModel,
        },
      })
    } catch {
      if (prev) set({ agentConfig: prev })
    }
  },
})
