import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'
import type { McpRegistryItem, McpServerConfig } from '../../mastra-client'
import { fetchRegistryMcps, searchRegistryMcps, saveMcpServers } from '../../mastra-client'

/** Derive a stable key for a registry server (name + version). */
export function registryKey(item: McpRegistryItem): string {
  return `${item.server.name}@${item.server.version}`
}

/** Build an McpServerConfig from a registry item. */
export function registryItemToConfig(item: McpRegistryItem): McpServerConfig {
  const s = item.server
  const displayName = s.title || s.name.split('/').pop() || s.name

  // Prefer remotes (streamable-http) first, then fall back to packages (stdio)
  if (s.remotes && s.remotes.length > 0) {
    const remote = s.remotes[0]
    return {
      id: crypto.randomUUID(),
      name: displayName,
      type: 'http',
      enabled: true,
      url: remote.url,
    }
  }

  // Stdio via package
  if (s.packages && s.packages.length > 0) {
    const pkg = s.packages[0]
    const isNpm = pkg.registryType === 'npm'
    return {
      id: crypto.randomUUID(),
      name: displayName,
      type: 'stdio',
      enabled: true,
      command: isNpm ? 'npx' : pkg.identifier,
      args: isNpm ? ['-y', pkg.identifier] : [],
      env: buildEnvDefaults(pkg.environmentVariables),
    }
  }

  // Fallback — empty http config user must fill in
  return {
    id: crypto.randomUUID(),
    name: displayName,
    type: 'http',
    enabled: true,
    url: '',
  }
}

function buildEnvDefaults(
  vars?: { name: string; isRequired?: boolean }[],
): Record<string, string> | undefined {
  if (!vars || vars.length === 0) return undefined
  const env: Record<string, string> = {}
  for (const v of vars) env[v.name] = ''
  return env
}

export interface McpRegistrySlice {
  registryMcps: McpRegistryItem[]
  registryLoaded: boolean
  registryLoading: boolean
  registryNextCursor: string | null
  registryLoadingMore: boolean
  registryAddingKey: string | null

  loadRegistryMcps: () => Promise<void>
  loadMoreRegistryMcps: () => Promise<void>
  searchRegistryMcps: (q: string) => Promise<void>
  addRegistryMcp: (item: McpRegistryItem, configOverrides?: Partial<McpServerConfig>) => Promise<boolean>
}

let _loadRegistry: Promise<void> | null = null

export const createMcpRegistrySlice: StateCreator<AppStore, [], [], McpRegistrySlice> = (
  set,
  get,
) => ({
  registryMcps: [],
  registryLoaded: false,
  registryLoading: false,
  registryNextCursor: null,
  registryLoadingMore: false,
  registryAddingKey: null,

  loadRegistryMcps: async () => {
    const fetcher = async () => {
      const res = await fetchRegistryMcps(20)
      set({
        registryMcps: res.servers,
        registryNextCursor: res.metadata.nextCursor || null,
      })
    }

    if (get().registryLoaded) { fetcher().catch(() => {}); return }

    if (!_loadRegistry) {
      set({ registryLoading: true })
      _loadRegistry = fetcher()
        .then(() => set({ registryLoaded: true }))
        .catch(() => set({ registryLoaded: true }))
        .finally(() => {
          set({ registryLoading: false })
          _loadRegistry = null
        })
    }
    return _loadRegistry
  },

  loadMoreRegistryMcps: async () => {
    const { registryNextCursor, registryLoadingMore } = get()
    if (!registryNextCursor || registryLoadingMore) return
    set({ registryLoadingMore: true })
    try {
      const res = await fetchRegistryMcps(20, registryNextCursor)
      set((s) => ({
        registryMcps: [...s.registryMcps, ...res.servers],
        registryNextCursor: res.metadata.nextCursor || null,
      }))
    } finally {
      set({ registryLoadingMore: false })
    }
  },

  searchRegistryMcps: async (q) => {
    set({ registryLoading: true })
    try {
      const res = await searchRegistryMcps(q, 30)
      set({
        registryMcps: res.servers,
        registryNextCursor: res.metadata.nextCursor || null,
      })
    } finally {
      set({ registryLoading: false })
    }
  },

  addRegistryMcp: async (item, configOverrides) => {
    const key = registryKey(item)
    set({ registryAddingKey: key })
    try {
      const config = { ...registryItemToConfig(item), ...configOverrides }
      const updated = [...get().mcpServers, config]
      const result = await saveMcpServers(updated)
      set({ mcpServers: result })
      return true
    } catch {
      return false
    } finally {
      set({ registryAddingKey: null })
    }
  },
})
