import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'
import { SUPERPOWERS, type SuperpowerDef, type SuperpowerState } from '../../data/superpowers'
import {
  checkSuperpowerRuntime,
  installSuperpowerRuntime,
  updateAgentConfig,
} from '../../mastra-client'

export interface SuperpowersSlice {
  superpowerStates: Record<string, SuperpowerState>
  superpowerInstalling: string | null

  checkSuperpowerStatus: (id: string) => Promise<void>
  checkAllSuperpowers: () => Promise<void>
  installSuperpower: (id: string, envOverrides?: Record<string, string>) => Promise<boolean>
}

function emptyState(def: SuperpowerDef): SuperpowerState {
  return {
    id: def.id,
    installed: false,
    components: {
      skills: Object.fromEntries((def.components.skills ?? []).map((s) => [s.name, false])),
      runtimes: Object.fromEntries((def.components.runtimes ?? []).map((r) => [r.label, false])),
      envVars: Object.fromEntries(Object.keys(def.components.envVars ?? {}).map((k) => [k, false])),
      mcpServers: Object.fromEntries((def.components.mcpServers ?? []).map((m) => [m.name, false])),
    },
    installing: false,
    installStep: null,
    error: null,
  }
}

function isFullyInstalled(state: SuperpowerState): boolean {
  const all = [
    ...Object.values(state.components.skills),
    ...Object.values(state.components.runtimes),
    ...Object.values(state.components.envVars),
    ...Object.values(state.components.mcpServers),
  ]
  return all.length > 0 && all.every(Boolean)
}

export const createSuperpowersSlice: StateCreator<AppStore, [], [], SuperpowersSlice> = (set, get) => ({
  superpowerStates: Object.fromEntries(SUPERPOWERS.map((d) => [d.id, emptyState(d)])),
  superpowerInstalling: null,

  checkSuperpowerStatus: async (id) => {
    const def = SUPERPOWERS.find((d) => d.id === id)
    if (!def) return

    const state = get().superpowerStates[id] ?? emptyState(def)
    const components = { ...state.components }

    // Check skills
    const installedSkills = get().installedSkills
    const skills: Record<string, boolean> = {}
    for (const skill of def.components.skills ?? []) {
      skills[skill.name] = !!installedSkills[skill.name]
    }
    components.skills = skills

    // Check runtimes
    const runtimes: Record<string, boolean> = {}
    for (const rt of def.components.runtimes ?? []) {
      try {
        const res = await checkSuperpowerRuntime(rt.check)
        runtimes[rt.label] = res.ok
      } catch {
        runtimes[rt.label] = false
      }
    }
    components.runtimes = runtimes

    // Check env vars
    const agentCfg = get().agentConfig
    const sandboxEnv = agentCfg?.sandboxEnv ?? {}
    const envVars: Record<string, boolean> = {}
    for (const key of Object.keys(def.components.envVars ?? {})) {
      envVars[key] = key in sandboxEnv
    }
    components.envVars = envVars

    // Check MCP servers
    const mcpServers = get().mcpServers
    const mcps: Record<string, boolean> = {}
    for (const srv of def.components.mcpServers ?? []) {
      mcps[srv.name] = mcpServers.some((s) => s.name === srv.name)
    }
    components.mcpServers = mcps

    const updated: SuperpowerState = { ...state, components }
    updated.installed = isFullyInstalled(updated)

    set((s) => ({
      superpowerStates: { ...s.superpowerStates, [id]: updated },
    }))
  },

  checkAllSuperpowers: async () => {
    for (const def of SUPERPOWERS) {
      await get().checkSuperpowerStatus(def.id)
    }
  },

  installSuperpower: async (id, envOverrides) => {
    const def = SUPERPOWERS.find((d) => d.id === id)
    if (!def) return false

    const patch = (partial: Partial<SuperpowerState>) => {
      set((s) => ({
        superpowerStates: {
          ...s.superpowerStates,
          [id]: { ...s.superpowerStates[id], ...partial },
        },
      }))
    }

    patch({ installing: true, error: null, installStep: null })
    set({ superpowerInstalling: id })

    try {
      // 1. Install skills
      for (const skill of def.components.skills ?? []) {
        patch({ installStep: `Installing ${skill.name} skill...` })
        const [owner, repo] = skill.source.split('/')
        const installed = get().installedSkills[skill.name]
        if (!installed) {
          const ok = await get().installSkill({
            id: skill.name,
            name: skill.name,
            installs: 0,
            topSource: skill.source,
          })
          if (!ok) {
            patch({ error: `Failed to install skill: ${skill.name}`, installing: false, installStep: null })
            set({ superpowerInstalling: null })
            return false
          }
        }
      }

      // 2. Install runtimes
      for (const rt of def.components.runtimes ?? []) {
        patch({ installStep: `Installing ${rt.label}...` })
        // Check first
        const check = await checkSuperpowerRuntime(rt.check).catch(() => ({ ok: false }))
        if (!check.ok) {
          const res = await installSuperpowerRuntime(rt.install)
          if (!res.ok) {
            patch({ error: `Runtime install failed: ${res.error || res.output}`, installing: false, installStep: null })
            set({ superpowerInstalling: null })
            return false
          }
        }
      }

      // 3. Set env vars
      const envVarDefs = def.components.envVars ?? {}
      if (Object.keys(envVarDefs).length > 0) {
        patch({ installStep: 'Configuring environment...' })
        const currentEnv = get().agentConfig?.sandboxEnv ?? {}
        const newEnv = { ...currentEnv }
        for (const [key, envDef] of Object.entries(envVarDefs)) {
          if (!(key in newEnv)) {
            newEnv[key] = envOverrides?.[key] ?? envDef.value
          }
        }
        await updateAgentConfig({ sandboxEnv: newEnv })
        await get().loadAgentConfig()
      }

      // 4. Add MCP servers
      for (const srv of def.components.mcpServers ?? []) {
        patch({ installStep: `Adding ${srv.name} MCP server...` })
        const exists = get().mcpServers.some((s) => s.name === srv.name)
        if (!exists) {
          await get().addMcpServer(srv)
        }
      }

      // Recheck status
      patch({ installStep: 'Verifying...' })
      await get().checkSuperpowerStatus(id)

      patch({ installing: false, installStep: null })
      set({ superpowerInstalling: null })
      return true
    } catch (err: any) {
      patch({ error: err.message, installing: false, installStep: null })
      set({ superpowerInstalling: null })
      return false
    }
  },
})
