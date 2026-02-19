import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { useSliceData } from '../hooks/useSliceData'
import type { SkillShBrowseItem, McpRegistryItem, McpServerConfig } from '../mastra-client'
import { fetchPopularSkills, searchSkillsSh } from '../mastra-client'
import { useAppStore } from '../stores/useAppStore'
import { skillKey } from '../stores/slices/skillsSlice'
import { registryKey, registryItemToConfig } from '../stores/slices/mcpRegistrySlice'
import PageShell from '../components/PageShell'

type TabMode = 'skills' | 'mcp' | 'installed'

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ')
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

/** Extract a human-readable display name from an MCP registry server name. */
function mcpDisplayName(item: McpRegistryItem): string {
  const s = item.server
  if (s.title) return s.title
  // name is like "io.github.owner/server-name" — take the last segment and title-case it
  const last = s.name.split('/').pop() || s.name
  return titleCase(last)
}

/** Determine the transport type label for an MCP registry item. */
function mcpTransportType(item: McpRegistryItem): string {
  if (item.server.remotes && item.server.remotes.length > 0) return 'http'
  if (item.server.packages && item.server.packages.length > 0) {
    return item.server.packages[0].transport?.type || 'stdio'
  }
  return 'unknown'
}

/** Check if an MCP registry item is already added to local config by matching name. */
function isMcpAdded(item: McpRegistryItem, configuredServers: McpServerConfig[]): boolean {
  const display = mcpDisplayName(item)
  return configuredServers.some(
    (s) => s.name === display || s.name === item.server.name,
  )
}

/* ─────────────────────────── MCP Config Dialog ─────────────────────────── */

function McpConfigDialog({
  item,
  onSave,
  onCancel,
}: {
  item: McpRegistryItem
  onSave: (overrides: Partial<McpServerConfig>) => void
  onCancel: () => void
}) {
  const base = registryItemToConfig(item)
  const [name, setName] = useState(base.name)
  const [env, setEnv] = useState(
    base.env ? Object.entries(base.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
  )
  const [url, setUrl] = useState(base.url || '')
  const [headers, setHeaders] = useState('')

  const envVars = item.server.packages?.[0]?.environmentVariables || []
  const hasRequiredEnv = envVars.some((v) => v.isRequired)
  const isHttp = base.type === 'http'

  const handleSave = () => {
    const envObj: Record<string, string> = {}
    for (const line of env.split('\n').filter(Boolean)) {
      const idx = line.indexOf('=')
      if (idx > 0) envObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
    const headersObj: Record<string, string> = {}
    for (const line of headers.split('\n').filter(Boolean)) {
      const idx = line.indexOf('=')
      if (idx > 0) headersObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }

    const overrides: Partial<McpServerConfig> = { name: name.trim() }
    if (isHttp) {
      overrides.url = url.trim()
      if (Object.keys(headersObj).length > 0) overrides.headers = headersObj
    } else {
      if (Object.keys(envObj).length > 0) overrides.env = envObj
    }
    onSave(overrides)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-[480px]"
        style={{ padding: 24 }}
      >
        <h3 className="font-secondary text-[16px] font-semibold text-foreground mb-1">
          Configure MCP Server
        </h3>
        <p className="font-secondary text-[13px] text-muted mb-5">
          {item.server.description || `Set up ${mcpDisplayName(item)} before adding.`}
        </p>

        {/* Name */}
        <div className="mb-4">
          <label className="font-secondary text-[12px] font-medium text-muted block mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-primary text-[14px] text-foreground outline-none focus:border-primary"
          />
        </div>

        {/* HTTP: URL + Headers */}
        {isHttp && (
          <>
            <div className="mb-4">
              <label className="font-secondary text-[12px] font-medium text-muted block mb-1">URL</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
              />
            </div>
            <div className="mb-4">
              <label className="font-secondary text-[12px] font-medium text-muted block mb-1">
                Headers <span className="text-muted-dim font-normal">(optional)</span>
              </label>
              <textarea
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
                placeholder={'Authorization=Bearer xxx'}
                rows={2}
                className="w-full px-3 py-2 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary resize-y"
              />
            </div>
          </>
        )}

        {/* Stdio: Environment Variables */}
        {!isHttp && envVars.length > 0 && (
          <div className="mb-4">
            <label className="font-secondary text-[12px] font-medium text-muted block mb-1">
              Environment Variables
              {hasRequiredEnv && <span className="text-red-400 ml-1">*</span>}
            </label>
            <div className="mb-2">
              {envVars.map((v) => (
                <p key={v.name} className="font-secondary text-[11px] text-muted-dim">
                  <span className="font-mono text-muted">{v.name}</span>
                  {v.description && ` — ${v.description}`}
                  {v.isRequired && <span className="text-red-400 ml-1">(required)</span>}
                </p>
              ))}
            </div>
            <textarea
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              placeholder={envVars.map((v) => `${v.name}=`).join('\n')}
              rows={Math.min(envVars.length + 1, 5)}
              className="w-full px-3 py-2 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary resize-y"
            />
          </div>
        )}

        {/* Stdio info when no env vars */}
        {!isHttp && envVars.length === 0 && (
          <div className="mb-4 rounded-lg bg-sidebar px-3 py-2">
            <p className="font-secondary text-[12px] text-muted">
              Will run: <span className="font-mono text-foreground">{base.command} {(base.args || []).join(' ')}</span>
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 mt-2">
          <button
            onClick={onCancel}
            className="font-secondary text-[13px] font-medium text-muted hover:text-foreground transition-colors"
            style={{ height: 36, padding: '0 14px' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
            style={{ height: 36, padding: '0 16px' }}
          >
            Add Server
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── Skill Card ─────────────────────────── */

const SkillCard = memo(function SkillCard({
  skill,
  installed,
  isBusy,
  onInstall,
  onUninstall,
}: {
  skill: SkillShBrowseItem
  installed: boolean
  isBusy: boolean
  onInstall: () => void
  onUninstall: () => void
}) {
  return (
    <div className="flex items-center gap-3 border border-border rounded-xl px-4 py-3 bg-card">
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-background shrink-0">
        <span className="material-icon text-muted" style={{ fontSize: 20 }}>extension</span>
      </div>
      <div className="flex-1 min-w-0">
        <span className="font-secondary text-[13px] font-semibold text-foreground">
          {titleCase(skill.name)}
        </span>
        {skill.topSource && (
          <div className="font-secondary text-[11px] text-muted-dim truncate">{skill.topSource}</div>
        )}
        {skill.installs > 0 && (
          <div className="flex items-center gap-1 mt-0.5">
            <span className="material-icon text-muted-dim" style={{ fontSize: 13 }}>download</span>
            <span className="font-secondary text-[11px] font-medium text-muted-dim">
              {formatCount(skill.installs)}
            </span>
          </div>
        )}
      </div>
      {installed ? (
        <button
          onClick={onUninstall}
          disabled={isBusy}
          className="shrink-0 bg-red-500/8 border border-red-500/25 rounded-md text-red-400 px-3 py-1 font-secondary text-[12px] cursor-pointer hover:bg-red-500/15 hover:border-red-500/40 disabled:opacity-50 disabled:cursor-default"
        >
          {isBusy ? 'Removing...' : 'Uninstall'}
        </button>
      ) : (
        <button
          onClick={onInstall}
          disabled={isBusy}
          className="shrink-0 bg-transparent border border-border rounded-md text-muted px-3 py-1 font-secondary text-[12px] cursor-pointer hover:bg-sidebar-accent hover:text-foreground disabled:opacity-50 disabled:cursor-default"
        >
          {isBusy ? 'Installing...' : 'Install'}
        </button>
      )}
    </div>
  )
})

/* ─────────────────────────── MCP Card ─────────────────────────── */

const McpCard = memo(function McpCard({
  item,
  isAdded,
  isBusy,
  onAdd,
}: {
  item: McpRegistryItem
  isAdded: boolean
  isBusy: boolean
  onAdd: () => void
}) {
  const transport = mcpTransportType(item)

  return (
    <div className="flex items-center gap-3 border border-border rounded-xl px-4 py-3 bg-card">
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-background shrink-0">
        <span className="material-icon text-muted" style={{ fontSize: 20 }}>dns</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-secondary text-[13px] font-semibold text-foreground truncate">
            {mcpDisplayName(item)}
          </span>
          <span
            className="inline-flex items-center font-secondary text-[10px] font-medium rounded-md bg-sidebar text-muted shrink-0"
            style={{ padding: '1px 6px' }}
          >
            {transport}
          </span>
        </div>
        {item.server.description && (
          <div className="font-secondary text-[11px] text-muted-dim truncate mt-0.5">
            {item.server.description}
          </div>
        )}
      </div>
      {isAdded ? (
        <span className="shrink-0 bg-secondary border border-border rounded-md text-muted-dim px-3 py-1 font-secondary text-[12px]">
          Added
        </span>
      ) : (
        <button
          onClick={onAdd}
          disabled={isBusy}
          className="shrink-0 bg-transparent border border-border rounded-md text-muted px-3 py-1 font-secondary text-[12px] cursor-pointer hover:bg-sidebar-accent hover:text-foreground disabled:opacity-50 disabled:cursor-default"
        >
          {isBusy ? 'Adding...' : 'Add'}
        </button>
      )}
    </div>
  )
})

/* ─────────────────────────── Installed Item ─────────────────────────── */

const InstalledItem = memo(function InstalledItem({
  type,
  name,
  description,
  isBusy,
  onRemove,
}: {
  type: 'skill' | 'mcp'
  name: string
  description: string
  isBusy: boolean
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-3 border border-border rounded-xl px-4 py-3 bg-card">
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-background shrink-0">
        <span className="material-icon text-muted" style={{ fontSize: 20 }}>
          {type === 'skill' ? 'extension' : 'dns'}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-secondary text-[13px] font-semibold text-foreground">{name}</span>
          <span
            className={`inline-flex items-center font-secondary text-[10px] font-medium rounded-md shrink-0 ${
              type === 'skill'
                ? 'bg-blue-500/10 text-blue-500'
                : 'bg-orange-500/10 text-orange-500'
            }`}
            style={{ padding: '1px 6px' }}
          >
            {type === 'skill' ? 'Skill' : 'MCP'}
          </span>
        </div>
        {description && (
          <div className="font-secondary text-[11px] text-muted-dim truncate mt-0.5">
            {description}
          </div>
        )}
      </div>
      <button
        onClick={onRemove}
        disabled={isBusy}
        className="shrink-0 bg-red-500/8 border border-red-500/25 rounded-md text-red-400 px-3 py-1 font-secondary text-[12px] cursor-pointer hover:bg-red-500/15 hover:border-red-500/40 disabled:opacity-50 disabled:cursor-default"
      >
        {isBusy ? 'Removing...' : type === 'skill' ? 'Uninstall' : 'Remove'}
      </button>
    </div>
  )
})

/* ─────────────────────────── Main Page ─────────────────────────── */

export default memo(function SuperpowersPage() {
  const [tab, setTab] = useState<TabMode>('skills')
  const [search, setSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // ── Skills state ──
  const [skills, setSkills] = useState<SkillShBrowseItem[]>([])
  const [skillsLoading, setSkillsLoading] = useState(true)
  const [skillsLoadingMore, setSkillsLoadingMore] = useState(false)
  const skillsOffsetRef = useRef(0)
  const skillsTotalRef = useRef(0)
  const skillsLoadingMoreRef = useRef(false)

  // ── Skills store ──
  const installedSkills = useAppStore((s) => s.installedSkills)
  const installingKey = useAppStore((s) => s.installingKey)
  const loadInstalledSkills = useAppStore((s) => s.loadInstalledSkills)
  const installSkill = useAppStore((s) => s.installSkill)
  const uninstallSkill = useAppStore((s) => s.uninstallSkill)

  // ── MCP Registry store ──
  const registryMcps = useAppStore((s) => s.registryMcps)
  const registryLoading = useAppStore((s) => s.registryLoading)
  const registryLoaded = useAppStore((s) => s.registryLoaded)
  const registryLoadingMore = useAppStore((s) => s.registryLoadingMore)
  const registryAddingKey = useAppStore((s) => s.registryAddingKey)
  const loadRegistryMcps = useAppStore((s) => s.loadRegistryMcps)
  const loadMoreRegistryMcps = useAppStore((s) => s.loadMoreRegistryMcps)
  const searchRegistryMcpsFn = useAppStore((s) => s.searchRegistryMcps)
  const addRegistryMcp = useAppStore((s) => s.addRegistryMcp)

  // ── MCP config store (for "Added" check) ──
  const mcpServers = useAppStore((s) => s.mcpServers)
  const mcpLoaded = useAppStore((s) => s.mcpLoaded)
  const loadMcpServers = useAppStore((s) => s.loadMcpServers)
  const deleteMcpServer = useAppStore((s) => s.deleteMcpServer)

  // ── Config dialog state ──
  const [configItem, setConfigItem] = useState<McpRegistryItem | null>(null)

  const installedCount =
    Object.keys(installedSkills).length + mcpServers.length

  // ── Load on mount ──
  useSliceData(loadInstalledSkills)
  useSliceData(loadMcpServers)

  // ── Load skills browse ──
  useEffect(() => {
    if (tab !== 'skills' || search.trim()) return
    let cancelled = false
    setSkillsLoading(true)
    skillsOffsetRef.current = 0
    fetchPopularSkills(20, 0)
      .then(({ skills: items, count }) => {
        if (!cancelled) {
          setSkills(items)
          skillsTotalRef.current = count
          skillsOffsetRef.current = items.length
        }
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false)
      })
    return () => { cancelled = true }
  }, [tab, search])

  // ── Load MCP registry browse ──
  useEffect(() => {
    if (tab !== 'mcp' || search.trim()) return
    if (!registryLoaded) loadRegistryMcps()
  }, [tab, search, registryLoaded, loadRegistryMcps])

  // ── Infinite scroll ──
  const loadMoreSkills = useCallback(() => {
    if (skillsLoadingMoreRef.current || skillsOffsetRef.current >= skillsTotalRef.current) return
    skillsLoadingMoreRef.current = true
    setSkillsLoadingMore(true)
    fetchPopularSkills(20, skillsOffsetRef.current)
      .then(({ skills: items }) => {
        setSkills((prev) => [...prev, ...items])
        skillsOffsetRef.current += items.length
      })
      .finally(() => {
        skillsLoadingMoreRef.current = false
        setSkillsLoadingMore(false)
      })
  }, [])

  useEffect(() => {
    if (tab === 'installed' || search.trim()) return
    const el = sentinelRef.current
    const root = scrollRef.current
    if (!el || !root) return

    const loading = tab === 'skills' ? skillsLoading : registryLoading
    if (loading) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (tab === 'skills') loadMoreSkills()
          else loadMoreRegistryMcps()
        }
      },
      { root, rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [tab, search, skillsLoading, registryLoading, loadMoreSkills, loadMoreRegistryMcps])

  // ── Debounced search ──
  const handleSearch = useCallback(
    (value: string) => {
      setSearch(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (!value.trim()) return

      debounceRef.current = setTimeout(() => {
        if (tab === 'skills') {
          setSkillsLoading(true)
          searchSkillsSh(value.trim())
            .then(({ skills: items }) => setSkills(items))
            .finally(() => setSkillsLoading(false))
        } else if (tab === 'mcp') {
          searchRegistryMcpsFn(value.trim())
        }
      }, 300)
    },
    [tab, searchRegistryMcpsFn],
  )

  // ── Install handlers ──
  const handleInstallSkill = useCallback(
    async (skill: SkillShBrowseItem) => {
      await installSkill(skill)
    },
    [installSkill],
  )

  const handleUninstallSkill = useCallback(
    async (skill: SkillShBrowseItem) => {
      await uninstallSkill(skill)
    },
    [uninstallSkill],
  )

  const handleAddMcp = useCallback(
    (item: McpRegistryItem) => {
      const envVars = item.server.packages?.[0]?.environmentVariables || []
      const hasRequiredEnv = envVars.some((v) => v.isRequired)
      // Show config dialog if there are env vars to fill or if it's http (user may need to add headers)
      if (hasRequiredEnv || (item.server.remotes && item.server.remotes.length > 0)) {
        setConfigItem(item)
      } else {
        // Direct add for simple stdio packages with no required env
        addRegistryMcp(item)
      }
    },
    [addRegistryMcp],
  )

  const handleConfigSave = useCallback(
    (overrides: Partial<McpServerConfig>) => {
      if (configItem) {
        addRegistryMcp(configItem, overrides)
        setConfigItem(null)
      }
    },
    [configItem, addRegistryMcp],
  )

  // ── Section label ──
  const sectionLabel =
    tab === 'installed'
      ? 'Installed'
      : search.trim()
        ? 'Search Results'
        : tab === 'skills'
          ? 'Popular Skills'
          : 'Popular MCP Servers'

  const isLoading =
    (tab === 'skills' && skillsLoading) || (tab === 'mcp' && registryLoading)

  const isLoadingMore =
    (tab === 'skills' && skillsLoadingMore) || (tab === 'mcp' && registryLoadingMore)

  return (
    <PageShell>
      <div className="flex flex-col h-full">
        {/* ── Header: tabs + search ── */}
        <div className="flex items-center justify-between h-[56px] px-6">
          <div className="flex items-center gap-1">
            {(['skills', 'mcp', 'installed'] as const).map((t) => {
              const labels: Record<TabMode, string> = {
                skills: 'Skills',
                mcp: 'MCP Servers',
                installed: 'Installed',
              }
              const isActive = tab === t
              return (
                <button
                  key={t}
                  onClick={() => {
                    setTab(t)
                    setSearch('')
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-secondary text-[13px] font-medium transition-colors ${
                    isActive
                      ? 'bg-card border border-border text-foreground font-semibold'
                      : 'text-muted-dim hover:text-foreground'
                  }`}
                >
                  {labels[t]}
                  {t === 'installed' && installedCount > 0 && (
                    <span
                      className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-[20px] h-[18px] text-[11px] font-semibold ${
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-muted'
                      }`}
                    >
                      {installedCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Search */}
          {tab !== 'installed' && (
            <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2 w-[320px]">
              <span className="material-icon text-muted-dim" style={{ fontSize: 18 }}>search</span>
              <input
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder={tab === 'skills' ? 'Search skills...' : 'Search MCP servers...'}
                className="flex-1 bg-transparent text-foreground font-secondary text-[14px] outline-none placeholder:text-muted-dim"
              />
              {search && (
                <button
                  onClick={() => handleSearch('')}
                  className="text-muted-dim hover:text-muted"
                >
                  <span className="material-icon" style={{ fontSize: 16 }}>close</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Section label ── */}
        <div className="flex items-center justify-between px-6 pb-2">
          <h3 className="font-secondary text-[16px] font-semibold text-foreground">
            {sectionLabel}
          </h3>
        </div>

        {/* ── Content ── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 pb-6">
          {isLoading && tab !== 'installed' ? (
            <div className="flex items-center justify-center py-16">
              <span className="material-icon text-muted-dim animate-spin" style={{ fontSize: 24 }}>
                progress_activity
              </span>
            </div>
          ) : tab === 'installed' ? (
            /* ── Installed tab ── */
            installedCount === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <span className="material-icon text-muted-dim mb-2" style={{ fontSize: 32 }}>
                  extension_off
                </span>
                <p className="font-secondary text-[13px] text-muted-dim">
                  No superpowers installed yet
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Installed Skills */}
                {Object.values(installedSkills).map((s) => (
                  <InstalledItem
                    key={`skill-${s.name}`}
                    type="skill"
                    name={titleCase(s.name)}
                    description={s.description || ''}
                    isBusy={installingKey === `${s.skillsShSource ? `${s.skillsShSource.owner}/${s.skillsShSource.repo}` : ''}/${s.name}`}
                    onRemove={() =>
                      uninstallSkill({
                        id: s.name,
                        name: s.name,
                        installs: 0,
                        topSource: s.skillsShSource
                          ? `${s.skillsShSource.owner}/${s.skillsShSource.repo}`
                          : '',
                      })
                    }
                  />
                ))}
                {/* Installed MCP Servers */}
                {mcpServers.map((s) => (
                  <InstalledItem
                    key={`mcp-${s.id}`}
                    type="mcp"
                    name={s.name}
                    description={
                      s.type === 'stdio'
                        ? [s.command, ...(s.args || [])].join(' ')
                        : s.url || ''
                    }
                    isBusy={false}
                    onRemove={() => deleteMcpServer(s.id)}
                  />
                ))}
              </div>
            )
          ) : tab === 'skills' ? (
            /* ── Skills browse ── */
            skills.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <span className="material-icon text-muted-dim mb-2" style={{ fontSize: 32 }}>search_off</span>
                <p className="font-secondary text-[13px] text-muted-dim">No skills found</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {skills.map((skill) => {
                  const installed = installedSkills[skill.id]
                  const installedSource = installed?.skillsShSource
                    ? `${installed.skillsShSource.owner}/${installed.skillsShSource.repo}`
                    : null
                  const isExactMatch = !!installed && installedSource === skill.topSource
                  return (
                    <SkillCard
                      key={skillKey(skill)}
                      skill={skill}
                      installed={isExactMatch}
                      isBusy={installingKey === skillKey(skill)}
                      onInstall={() => handleInstallSkill(skill)}
                      onUninstall={() => handleUninstallSkill(skill)}
                    />
                  )
                })}
              </div>
            )
          ) : (
            /* ── MCP browse ── */
            registryMcps.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <span className="material-icon text-muted-dim mb-2" style={{ fontSize: 32 }}>search_off</span>
                <p className="font-secondary text-[13px] text-muted-dim">No MCP servers found</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {registryMcps.map((item) => (
                  <McpCard
                    key={registryKey(item)}
                    item={item}
                    isAdded={isMcpAdded(item, mcpServers)}
                    isBusy={registryAddingKey === registryKey(item)}
                    onAdd={() => handleAddMcp(item)}
                  />
                ))}
              </div>
            )
          )}

          {/* ── Infinite scroll sentinel ── */}
          {tab !== 'installed' && !search.trim() && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              {isLoadingMore && (
                <span className="material-icon text-muted-dim animate-spin" style={{ fontSize: 20 }}>
                  progress_activity
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── MCP Config Dialog ── */}
      {configItem && (
        <McpConfigDialog
          item={configItem}
          onSave={handleConfigSave}
          onCancel={() => setConfigItem(null)}
        />
      )}
    </PageShell>
  )
})
