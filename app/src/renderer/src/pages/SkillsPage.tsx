import { useState, useEffect, useRef, useCallback, memo } from 'react'
import type { SkillShBrowseItem } from '../mastra-client'
import { fetchPopularSkills, searchSkillsSh } from '../mastra-client'
import { useAppStore } from '../stores/useAppStore'
import { skillKey } from '../stores/slices/skillsSlice'
import PageShell from '../components/PageShell'

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

type TabMode = 'browse' | 'installed'

export default memo(function SkillsPage() {
  const [tab, setTab] = useState<TabMode>('browse')
  const [skills, setSkills] = useState<SkillShBrowseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const offsetRef = useRef(0)
  const totalRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Store selectors
  const installedSkills = useAppStore((s) => s.installedSkills)
  const installingKey = useAppStore((s) => s.installingKey)
  const loadInstalledSkills = useAppStore((s) => s.loadInstalledSkills)
  const installSkill = useAppStore((s) => s.installSkill)
  const uninstallSkill = useAppStore((s) => s.uninstallSkill)

  const installedCount = Object.keys(installedSkills).length

  // Fetch installed skills on mount
  useEffect(() => {
    loadInstalledSkills()
  }, [loadInstalledSkills])

  // Fetch browse list on mount
  useEffect(() => {
    if (tab !== 'browse' || search.trim()) return
    let cancelled = false
    setLoading(true)
    setError('')
    offsetRef.current = 0
    fetchPopularSkills(20, 0)
      .then(({ skills: items, count }) => {
        if (!cancelled) {
          setSkills(items)
          totalRef.current = count
          offsetRef.current = items.length
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [search, tab])

  // Load more (infinite scroll)
  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || offsetRef.current >= totalRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)

    fetchPopularSkills(20, offsetRef.current)
      .then(({ skills: items }) => {
        setSkills((prev) => [...prev, ...items])
        offsetRef.current += items.length
      })
      .finally(() => {
        loadingMoreRef.current = false
        setLoadingMore(false)
      })
  }, [])

  // IntersectionObserver for sentinel element
  useEffect(() => {
    if (tab !== 'browse' || search.trim() || loading) return
    const el = sentinelRef.current
    const root = scrollRef.current
    if (!el || !root) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore()
      },
      { root, rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [tab, search, loading, loadMore])

  // Debounced search
  const handleSearch = useCallback((value: string) => {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!value.trim()) return

    debounceRef.current = setTimeout(() => {
      setLoading(true)
      setError('')
      searchSkillsSh(value.trim())
        .then(({ skills: items }) => setSkills(items))
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false))
    }, 300)
  }, [])

  const handleInstall = useCallback(
    async (skill: SkillShBrowseItem) => {
      const ok = await installSkill(skill)
      if (!ok) setError('Install failed')
    },
    [installSkill],
  )

  const handleUninstall = useCallback(
    async (skill: SkillShBrowseItem) => {
      const ok = await uninstallSkill(skill)
      if (!ok) setError('Uninstall failed')
    },
    [uninstallSkill],
  )

  // Installed tab renders from store
  const displaySkills: SkillShBrowseItem[] =
    tab === 'installed'
      ? Object.values(installedSkills).map(
          (s): SkillShBrowseItem => ({
            id: s.name,
            name: s.name,
            installs: 0,
            topSource: s.skillsShSource
              ? `${s.skillsShSource.owner}/${s.skillsShSource.repo}`
              : '',
          }),
        )
      : skills

  return (
    <PageShell>
      <div className="flex flex-col h-full">
        {/* Header: tabs + search */}
        <div className="flex items-center justify-between h-[56px] px-6">
          {/* Tab pills */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setTab('browse')
                setSearch('')
              }}
              className={`rounded-lg px-3.5 py-1.5 font-secondary text-[13px] font-medium transition-colors ${
                tab === 'browse'
                  ? 'bg-card border border-border text-foreground font-semibold'
                  : 'text-muted-dim hover:text-foreground'
              }`}
            >
              Browse
            </button>
            <button
              onClick={() => setTab('installed')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-secondary text-[13px] font-medium transition-colors ${
                tab === 'installed'
                  ? 'bg-card border border-border text-foreground font-semibold'
                  : 'text-muted-dim hover:text-foreground'
              }`}
            >
              Installed
              {installedCount > 0 && (
                <span
                  className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-[20px] h-[18px] text-[11px] font-semibold ${
                    tab === 'installed'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted'
                  }`}
                >
                  {installedCount}
                </span>
              )}
            </button>
          </div>

          {/* Search + help */}
          <div className="flex items-center gap-3">
            {tab === 'browse' && (
              <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2 w-[320px]">
                <span className="material-icon text-muted-dim" style={{ fontSize: 18 }}>
                  search
                </span>
                <input
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search skills..."
                  className="flex-1 bg-transparent text-foreground font-secondary text-[14px] outline-none placeholder:text-muted-dim"
                />
              </div>
            )}
            <span className="material-icon text-muted-dim cursor-pointer" style={{ fontSize: 20 }}>
              help_outline
            </span>
          </div>
        </div>

        {/* Section label */}
        <div className="flex items-center justify-between px-6 pb-2">
          <h3 className="font-secondary text-[16px] font-semibold text-foreground">
            {tab === 'installed'
              ? 'Installed Skills'
              : search.trim()
                ? 'Search Results'
                : 'Popular Skills'}
          </h3>
        </div>

        {/* Content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 pb-6">
          {tab === 'browse' && loading ? (
            <div className="flex items-center justify-center py-16">
              <span
                className="material-icon text-muted-dim animate-spin"
                style={{ fontSize: 24 }}
              >
                progress_activity
              </span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <span className="material-icon text-muted-dim mb-2" style={{ fontSize: 32 }}>
                cloud_off
              </span>
              <p className="font-secondary text-[13px] text-muted-dim">{error}</p>
              <button
                onClick={() => setError('')}
                className="mt-2 font-secondary text-[12px] text-primary hover:underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          ) : displaySkills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <span className="material-icon text-muted-dim mb-2" style={{ fontSize: 32 }}>
                {tab === 'installed' ? 'extension_off' : 'search_off'}
              </span>
              <p className="font-secondary text-[13px] text-muted-dim">
                {tab === 'installed' ? 'No skills installed yet' : 'No skills found'}
              </p>
            </div>
          ) : (
            <div
              className={tab === 'installed' ? 'flex flex-col gap-3' : 'grid grid-cols-2 gap-3'}
            >
              {displaySkills.map((skill) => {
                const installed = installedSkills[skill.id]
                const installedSource = installed?.skillsShSource
                  ? `${installed.skillsShSource.owner}/${installed.skillsShSource.repo}`
                  : null
                const isExactMatch = !!installed && installedSource === skill.topSource
                const isBusy = installingKey === skillKey(skill)

                return (
                  <div
                    key={skillKey(skill)}
                    className="skill-card flex items-center gap-3 border border-border rounded-xl px-4 py-3 bg-card"
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-background shrink-0">
                      <span className="material-icon text-muted" style={{ fontSize: 20 }}>
                        extension
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-secondary text-[13px] font-semibold text-foreground">
                          {titleCase(skill.name)}
                        </span>
                      </div>
                      {skill.topSource && (
                        <div className="font-secondary text-[11px] text-muted-dim truncate">
                          {skill.topSource}
                        </div>
                      )}
                      {skill.installs > 0 && (
                        <div className="flex items-center gap-2.5 mt-1">
                          <span className="flex items-center gap-1 font-secondary text-[11px] font-medium text-muted-dim">
                            <span className="material-icon" style={{ fontSize: 13 }}>
                              download
                            </span>
                            {formatCount(skill.installs)}
                          </span>
                        </div>
                      )}
                    </div>
                    {isExactMatch ? (
                      <button
                        onClick={() => handleUninstall(skill)}
                        disabled={isBusy}
                        className="shrink-0 bg-red-500/8 border border-red-500/25 rounded-md text-red-400 px-3 py-1 font-secondary text-[12px] cursor-pointer hover:bg-red-500/15 hover:border-red-500/40 disabled:opacity-50 disabled:cursor-default"
                      >
                        {isBusy ? 'Removing...' : 'Uninstall'}
                      </button>
                    ) : installed && !isExactMatch ? (
                      <span className="shrink-0 bg-secondary border border-border rounded-md text-muted-dim px-3 py-1 font-secondary text-[12px]">
                        Installed
                      </span>
                    ) : (
                      <button
                        onClick={() => handleInstall(skill)}
                        disabled={isBusy}
                        className="shrink-0 bg-transparent border border-border rounded-md text-muted px-3 py-1 font-secondary text-[12px] cursor-pointer hover:bg-sidebar-accent hover:text-foreground disabled:opacity-50 disabled:cursor-default"
                      >
                        {isBusy ? 'Installing...' : 'Install'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {tab === 'browse' && !search.trim() && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              {loadingMore && (
                <span
                  className="material-icon text-muted-dim animate-spin"
                  style={{ fontSize: 20 }}
                >
                  progress_activity
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
})
