import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'
import type { McpServerConfig } from '../../mastra-client'
import { fetchMcpServers, saveMcpServers, testMcpServer } from '../../mastra-client'

export interface McpSlice {
  mcpServers: McpServerConfig[]
  mcpLoaded: boolean

  loadMcpServers: () => Promise<void>
  addMcpServer: (server: McpServerConfig) => Promise<void>
  updateMcpServer: (server: McpServerConfig) => Promise<void>
  deleteMcpServer: (id: string) => Promise<void>
  toggleMcpServer: (id: string) => Promise<void>
  testMcpConnection: (
    server: McpServerConfig,
  ) => Promise<{ ok: boolean; tools?: string[]; error?: string }>
}

export const createMcpSlice: StateCreator<AppStore, [], [], McpSlice> = (set, get) => ({
  mcpServers: [],
  mcpLoaded: false,

  loadMcpServers: async () => {
    try {
      const servers = await fetchMcpServers()
      set({ mcpServers: servers, mcpLoaded: true })
    } catch {
      set({ mcpLoaded: true })
    }
  },

  addMcpServer: async (server) => {
    const updated = [...get().mcpServers, server]
    const result = await saveMcpServers(updated)
    set({ mcpServers: result })
  },

  updateMcpServer: async (server) => {
    const updated = get().mcpServers.map((s) => (s.id === server.id ? server : s))
    const result = await saveMcpServers(updated)
    set({ mcpServers: result })
  },

  deleteMcpServer: async (id) => {
    const prev = get().mcpServers
    const updated = prev.filter((s) => s.id !== id)
    set({ mcpServers: updated })
    try {
      await saveMcpServers(updated)
    } catch {
      set({ mcpServers: prev })
    }
  },

  toggleMcpServer: async (id) => {
    const prev = get().mcpServers
    const updated = prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    set({ mcpServers: updated })
    try {
      await saveMcpServers(updated)
    } catch {
      set({ mcpServers: prev })
    }
  },

  testMcpConnection: async (server) => {
    return testMcpServer(server)
  },
})
