import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { useSliceData } from '../hooks/useSliceData'
import type { McpRegistryItem, McpServerConfig, SkillShBrowseItem } from '../mastra-client'
import { useAppStore } from '../stores/useAppStore'
import { skillKey } from '../stores/slices/skillsSlice'
import { registryKey } from '../stores/slices/mcpRegistrySlice'
import { SUPERPOWERS } from '../data/superpowers'
import PageShell from '../components/PageShell'
import SkillCard from '../components/superpowers/SkillCard'
import McpCard, { isMcpAdded } from '../components/superpowers/McpCard'
import InstalledItem from '../components/superpowers/InstalledItem'
import McpConfigDialog from '../components/superpowers/McpConfigDialog'
import SuperpowerCard from '../components/superpowers/SuperpowerCard'
import SuperpowerSetupDialog from '../components/superpowers/SuperpowerSetupDialog'
import { titleCase } from '../components/superpowers/utils'

type TabMode = 'featured' | 'skills' | 'mcp' | 'installed'

export default memo(function SuperpowersPage() {
  const [tab, setTab] = useState<TabMode>('featured')
  const [search, setSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // ── Superpowers store ──
  const superpowerStates = useAppStore((s) => s.superpowerStates)
  const checkAllSuperpowers = useAppStore((s) => s.checkAllSuperpowers)
  const installSuperpower = useAppStore((s) => s.installSuperpower)
  const [setupId, setSetupId] = useState<string | null>(null)

  // ── Skills store ──
  const installedSkills = useAppStore((s) => s.installedSkills)
  const installingKey = useAppStore((s) => s.installingKey)
  const loadInstalledSkills = useAppStore((s) => s.loadInstalledSkills)
  const installSkill = useAppStore((s) => s.installSkill)
  const uninstallSkill = useAppStore((s) => s.uninstallSkill)

  // ── Skills browse store ──
  const browseSkills = useAppStore((s) => s.browseSkills)
  const browseLoading = useAppStore((s) => s.browseLoading)
  const browseLoadingMore = useAppStore((s) => s.browseLoadingMore)
  const loadBrowseSkills = useAppStore((s) => s.loadBrowseSkills)
  const loadMoreBrowseSkills = useAppStore((s) => s.loadMoreBrowseSkills)
  const searchBrowseSkillsFn = useAppStore((s) => s.searchBrowseSkills)

  // ── MCP Registry store ──
  const registryMcps = useAppStore((s) => s.registryMcps)
  const registryLoading = useAppStore((s) => s.registryLoading)
  const registryLoadingMore = useAppStore((s) => s.registryLoadingMore)
  const registryAddingKey = useAppStore((s) => s.registryAddingKey)
  const loadRegistryMcps = useAppStore((s) => s.loadRegistryMcps)
  const loadMoreRegistryMcps = useAppStore((s) => s.loadMoreRegistryMcps)
  const searchRegistryMcpsFn = useAppStore((s) => s.searchRegistryMcps)
  const addRegistryMcp = useAppStore((s) => s.addRegistryMcp)

  // ── MCP config store (for "Added" check) ──
  const mcpServers = useAppStore((s) => s.mcpServers)
  const loadMcpServers = useAppStore((s) => s.loadMcpServers)
  const deleteMcpServer = useAppStore((s) => s.deleteMcpServer)

  // ── Config dialog state ──
  const [configItem, setConfigItem] = useState<McpRegistryItem | null>(null)

  const installedCount =
    Object.keys(installedSkills).length + mcpServers.length

  // ── Load on mount ──
  useSliceData(loadInstalledSkills)
  useSliceData(loadMcpServers)

  // ── Check superpowers status on mount ──
  useEffect(() => {
    checkAllSuperpowers()
  }, [checkAllSuperpowers])

  // ── Load skills browse ──
  useEffect(() => {
    if (tab !== 'skills' || search.trim()) return
    loadBrowseSkills()
  }, [tab, search, loadBrowseSkills])

  // ── Load MCP registry browse ──
  useEffect(() => {
    if (tab !== 'mcp' || search.trim()) return
    loadRegistryMcps()
  }, [tab, search, loadRegistryMcps])

  // ── Infinite scroll ──
  useEffect(() => {
    if (tab === 'featured' || tab === 'installed' || search.trim()) return
    const el = sentinelRef.current
    const root = scrollRef.current
    if (!el || !root) return

    const loading = tab === 'skills' ? browseLoading : registryLoading
    if (loading) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (tab === 'skills') loadMoreBrowseSkills()
          else loadMoreRegistryMcps()
        }
      },
      { root, rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [tab, search, browseLoading, registryLoading, loadMoreBrowseSkills, loadMoreRegistryMcps])

  // ── Debounced search ──
  const handleSearch = useCallback(
    (value: string) => {
      setSearch(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (!value.trim()) return

      debounceRef.current = setTimeout(() => {
        if (tab === 'skills') {
          searchBrowseSkillsFn(value.trim())
        } else if (tab === 'mcp') {
          searchRegistryMcpsFn(value.trim())
        }
      }, 300)
    },
    [tab, searchBrowseSkillsFn, searchRegistryMcpsFn],
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
      if (hasRequiredEnv || (item.server.remotes && item.server.remotes.length > 0)) {
        setConfigItem(item)
      } else {
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
    tab === 'featured'
      ? 'Curated Integrations'
      : tab === 'installed'
        ? 'Installed'
        : search.trim()
          ? 'Search Results'
          : tab === 'skills'
            ? 'Popular Skills'
            : 'Popular MCP Servers'

  const isLoading =
    (tab === 'skills' && browseLoading) || (tab === 'mcp' && registryLoading)

  const isLoadingMore =
    (tab === 'skills' && browseLoadingMore) || (tab === 'mcp' && registryLoadingMore)

  return (
    <PageShell>
      <div className="flex flex-col h-full">
        {/* ── Header: tabs + search ── */}
        <div className="flex items-center justify-between h-[56px] px-6">
          <div className="flex items-center gap-1">
            {(['featured', 'skills', 'mcp', 'installed'] as const).map((t) => {
              const labels: Record<TabMode, string> = {
                featured: 'Featured',
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
          {tab !== 'featured' && tab !== 'installed' && (
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
          {tab === 'featured' ? (
            /* ── Featured superpowers ── */
            <div className="grid grid-cols-2 gap-4">
              {SUPERPOWERS.map((def) => (
                <SuperpowerCard
                  key={def.id}
                  def={def}
                  state={superpowerStates[def.id]}
                  onSetup={() => setSetupId(def.id)}
                />
              ))}
            </div>
          ) : isLoading && tab !== 'installed' ? (
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
            browseSkills.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <span className="material-icon text-muted-dim mb-2" style={{ fontSize: 32 }}>search_off</span>
                <p className="font-secondary text-[13px] text-muted-dim">No skills found</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {browseSkills.map((skill) => {
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
          {tab !== 'featured' && tab !== 'installed' && !search.trim() && (
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

      {/* ── Superpower Setup Dialog ── */}
      {setupId && superpowerStates[setupId] && (
        <SuperpowerSetupDialog
          def={SUPERPOWERS.find((d) => d.id === setupId)!}
          state={superpowerStates[setupId]}
          onInstall={async (envOverrides) => {
            const ok = await installSuperpower(setupId, envOverrides)
            if (ok) setSetupId(null)
          }}
          onCancel={() => setSetupId(null)}
        />
      )}
    </PageShell>
  )
})
