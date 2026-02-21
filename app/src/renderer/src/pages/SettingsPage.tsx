import { useState, useEffect, useCallback, memo, useRef } from 'react'
import type { ThemeMode } from '../hooks/useTheme'
import { useAppStore } from '../stores/useAppStore'
import { useSliceData } from '../hooks/useSliceData'
import PageShell from '../components/PageShell'
import FilterTabs from '../components/FilterTabs'
import type { McpServerConfig, ExposedMcpServerInfo, WorkingMemory, ObservationalMemoryRecord } from '../mastra-client'
import { MASTRA_BASE_URL, setMastraBaseUrl, setMastraApiToken, authHeaders } from '../mastra-client'

import type { AgentConfigState, Provider } from '../stores/slices/brainSlice'

const settingsTabs = ['AI', 'UX', 'Channels', 'Integrations', 'Developer', 'Advanced']

const themeModes: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'system', label: 'System', icon: 'desktop_windows' },
  { value: 'light', label: 'Light', icon: 'light_mode' },
  { value: 'dark', label: 'Dark', icon: 'dark_mode' },
]

/* ── Brain Designer (AI tab) ── */

const BRAIN_REGIONS = [
  { section: 'persona' as const, field: 'soul', title: 'Soul', icon: 'favorite', color: '#F43F5E', sub: 'Core identity and values' },
  { section: 'persona' as const, field: 'expression', title: 'Voice', icon: 'record_voice_over', color: '#A855F7', sub: 'How they express themselves' },
  { section: 'persona' as const, field: 'interests', title: 'Interests', icon: 'lightbulb', color: '#F59E0B', sub: 'What genuinely fascinates them' },
  { section: 'persona' as const, field: 'learnedBehaviors', title: 'Learned Behaviors', icon: 'psychology', color: '#14B8A6', sub: 'Patterns picked up over time' },
  { section: 'org' as const, field: 'overview', title: 'Overview', icon: 'domain', color: '#3B82F6', sub: 'Company, industry, and mission' },
  { section: 'org' as const, field: 'team', title: 'Team', icon: 'group', color: '#22C55E', sub: "Who's who and how they work" },
  { section: 'org' as const, field: 'stack', title: 'Tech Stack', icon: 'code', color: '#F97316', sub: 'Languages, frameworks, and tools' },
  { section: 'org' as const, field: 'projects', title: 'Projects', icon: 'rocket_launch', color: '#6366F1', sub: "What's being built and priorities" },
  { section: 'org' as const, field: 'preferences', title: 'Preferences', icon: 'tune', color: '#64748B', sub: 'Code review, PRs, and conventions' },
] as const

function isRegionActive(content?: string): boolean {
  return !!content?.trim()
}

function getFieldValue(wm: WorkingMemory, section: 'persona' | 'org', field: string): string | undefined {
  const sec = wm[section]
  if (!sec) return undefined
  return (sec as Record<string, string | undefined>)[field]
}

/* ── Observation parser ── */

interface ParsedObservation {
  emoji: string
  time: string
  text: string
  threadId: string
}

const EMOJI_COLOR_MAP: Record<string, { border: string; time: string }> = {
  '\u{1F534}': { border: '#EF4444', time: '#DC2626' },
  '\u{1F7E1}': { border: '#F59E0B', time: '#D97706' },
  '\u{1F7E2}': { border: '#22C55E', time: '#16A34A' },
}

function parseObservations(raw: string): ParsedObservation[] {
  const results: ParsedObservation[] = []
  const threadRegex = /<thread\s+id="([^"]*)">([\s\S]*?)<\/thread>/g
  let threadMatch: RegExpExecArray | null
  while ((threadMatch = threadRegex.exec(raw)) !== null) {
    const threadId = threadMatch[1]
    const body = threadMatch[2]
    const lineRegex = /^\*\s+([\u{1F534}\u{1F7E1}\u{1F7E2}])\s+\((\d{2}:\d{2})\)\s+(.+)$/gmu
    let lineMatch: RegExpExecArray | null
    while ((lineMatch = lineRegex.exec(body)) !== null) {
      results.push({ emoji: lineMatch[1], time: lineMatch[2], text: lineMatch[3], threadId })
    }
  }
  return results.reverse()
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return 'never'
  const ms = Date.now() - new Date(date).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

/* ── Subconscious View ── */

function CapacityRing({ percentage }: { percentage: number }) {
  const r = 42
  const circumference = 2 * Math.PI * r
  const offset = circumference - (Math.min(percentage, 100) / 100) * circumference
  return (
    <div className="relative" style={{ width: 96, height: 96 }}>
      <svg width={96} height={96} viewBox="0 0 96 96" className="rotate-[-90deg]">
        <circle cx={48} cy={48} r={r} fill="none" className="stroke-border" strokeWidth={6} />
        <circle
          cx={48} cy={48} r={r} fill="none"
          stroke="#8B5CF6" strokeWidth={6}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className="font-mono text-[20px] font-bold" style={{ color: '#8B5CF6' }}>{Math.round(percentage)}%</span>
        <span className="font-secondary text-[8px] font-semibold text-muted" style={{ letterSpacing: 1.5 }}>CAPACITY</span>
      </div>
    </div>
  )
}

function SubconsciousView({ data }: { data: ObservationalMemoryRecord | null }) {
  if (!data) {
    return (
      <div className="max-w-[680px] mx-auto flex flex-col items-center justify-center py-20 gap-3">
        <span className="material-icon text-muted-dim" style={{ fontSize: 40 }}>psychology</span>
        <p className="font-secondary text-[13px] text-muted text-center m-0">
          No observations yet — conversations will build the subconscious over time.
        </p>
      </div>
    )
  }

  const maxTokens = (data as any).config?.maxObservationTokens ?? 8000
  const percentage = (data.observationTokenCount / maxTokens) * 100
  const observations = parseObservations(data.activeObservations || '')

  const status = data.isReflecting ? 'Reflecting' : data.isObserving ? 'Observing' : 'Idle'
  const statusColor = data.isReflecting ? '#A855F7' : data.isObserving ? '#22C55E' : undefined

  const dateStr = data.lastObservedAt
    ? new Date(data.lastObservedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'No observations yet'

  return (
    <div className="max-w-[680px] mx-auto flex flex-col gap-6">
      {/* Memory Status hero card */}
      <div
        className="flex items-center gap-8 rounded-2xl bg-card border border-border"
        style={{ padding: '28px 32px' }}
      >
        <CapacityRing percentage={percentage} />
        <div className="flex-1 flex flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-icon" style={{ fontSize: 16, color: '#8B5CF6' }}>visibility</span>
              <span className="font-secondary text-[12px] font-medium text-muted">Observations</span>
            </div>
            <span className="font-mono text-[12px] font-semibold text-foreground">{formatTokens(data.observationTokenCount)} tokens</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-icon" style={{ fontSize: 16, color: '#F59E0B' }}>schedule</span>
              <span className="font-secondary text-[12px] font-medium text-muted">Pending messages</span>
            </div>
            <span className="font-mono text-[12px] font-semibold text-foreground">{formatTokens(data.pendingMessageTokens)} tokens</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-icon" style={{ fontSize: 16, color: '#14B8A6' }}>autorenew</span>
              <span className="font-secondary text-[12px] font-medium text-muted">Reflections</span>
            </div>
            <span className="font-mono text-[12px] font-semibold text-foreground">{data.generationCount} cycles</span>
          </div>
          <div className="w-full h-px bg-border" />
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusColor ? '' : 'bg-muted'}`} style={statusColor ? { backgroundColor: statusColor } : undefined} />
            <span className="font-secondary text-[11px] font-medium text-muted">
              {status} — last processed {timeAgo(data.lastObservedAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Thought Stream header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-icon" style={{ fontSize: 16, color: '#8B5CF6' }}>psychology</span>
          <span className="font-secondary text-[11px] font-bold uppercase text-muted" style={{ letterSpacing: 1.2 }}>Thought Stream</span>
        </div>
        <span className="font-secondary text-[11px] font-medium text-muted-dim">{dateStr}</span>
      </div>

      {/* Observation cards */}
      {observations.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {observations.map((obs, i) => {
            const colors = EMOJI_COLOR_MAP[obs.emoji] || { border: '#6B7280', time: '#6B7280' }
            return (
              <div
                key={i}
                className="bg-card rounded-[10px] flex flex-col gap-1.5"
                style={{ padding: '12px 14px', borderLeft: `3px solid ${colors.border}` }}
              >
                <span className="font-mono text-[10px] font-semibold" style={{ color: colors.time }}>{obs.time}</span>
                <p className="font-secondary text-[13px] text-foreground m-0" style={{ lineHeight: 1.55 }}>{obs.text}</p>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="font-secondary text-[13px] text-muted italic text-center py-8 m-0">No thought stream entries yet.</p>
      )}

      {/* Priority Legend */}
      <div className="flex items-center gap-5 bg-sidebar rounded-xl" style={{ padding: '14px 20px' }}>
        {[
          { color: '#EF4444', label: 'Core identity' },
          { color: '#F59E0B', label: 'Context' },
          { color: '#22C55E', label: 'Action' },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded" style={{ backgroundColor: item.color }} />
            <span className="font-secondary text-[11px] font-medium text-muted">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BrainCard({
  title,
  icon,
  color,
  content,
  dormant,
  onEdit,
}: {
  title: string
  icon: string
  color: string
  content?: string
  dormant: boolean
  onEdit: () => void
}) {
  return (
    <button
      onClick={onEdit}
      className="text-left w-full bg-card border border-border rounded-2xl overflow-hidden transition-opacity cursor-pointer hover:border-foreground/20"
      style={{ opacity: dormant ? 0.55 : 1 }}
    >
      <div className="w-full h-1" style={{ backgroundColor: color }} />
      <div className="flex flex-col gap-2.5 p-4 pb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="material-icon" style={{ fontSize: 20, color }}>{icon}</span>
            <span className="font-secondary text-[15px] font-semibold text-foreground">{title}</span>
          </div>
          <span className="material-icon text-muted" style={{ fontSize: 14 }}>edit</span>
        </div>
        <p className={`font-secondary text-[13px] leading-relaxed line-clamp-3 m-0 ${dormant ? 'text-muted italic' : 'text-foreground'}`}>
          {dormant
            ? "This region hasn't formed yet"
            : (content || '').slice(0, 200)}
        </p>
      </div>
    </button>
  )
}

function BrainEditModal({
  title,
  icon,
  color,
  value,
  onSave,
  onClose,
}: {
  title: string
  icon: string
  color: string
  value: string
  onSave: (v: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-background border border-border rounded-2xl w-full max-w-[600px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full h-1" style={{ backgroundColor: color }} />
        <div className="flex items-center gap-3 px-6 pt-5 pb-3">
          <span className="material-icon" style={{ fontSize: 22, color }}>{icon}</span>
          <h2 className="font-secondary text-[17px] font-semibold text-foreground m-0">{title}</h2>
        </div>
        <div className="flex-1 px-6 pb-2 overflow-y-auto">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            className="w-full px-0 py-2 bg-transparent border-none font-secondary text-[13px] text-foreground leading-relaxed outline-none resize-none"
          />
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="h-9 px-4 bg-transparent border border-border rounded-lg font-secondary text-[13px] font-medium text-foreground cursor-pointer hover:bg-card"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(text)}
            className="h-9 px-4 bg-primary text-primary-foreground border-none rounded-lg font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function BrainDesigner({
  workingMemory,
  agentConfig,
  providers,
  loaded,
  onUpdateField,
  onUpdateModel,
  observationalMemory,
  onLoadObservationalMemory,
}: {
  workingMemory: WorkingMemory
  agentConfig: AgentConfigState | null
  providers: Provider[]
  loaded: boolean
  onUpdateField: (section: 'persona' | 'org', field: string, value: string) => Promise<void>
  onUpdateModel: (model: string | null) => Promise<void>
  observationalMemory: ObservationalMemoryRecord | null
  onLoadObservationalMemory: () => Promise<void>
}) {
  const [editing, setEditing] = useState<(typeof BRAIN_REGIONS)[number] | null>(null)
  const [modelOpen, setModelOpen] = useState(false)
  const [activeView, setActiveView] = useState<'identity' | 'subconscious'>('identity')

  if (!loaded) {
    return (
      <div className="max-w-[720px] mx-auto flex items-center justify-center py-20">
        <span className="font-secondary text-[13px] text-muted">Loading...</span>
      </div>
    )
  }

  const personaRegions = BRAIN_REGIONS.filter((r) => r.section === 'persona')
  const orgRegions = BRAIN_REGIONS.filter((r) => r.section === 'org')
  const activeCount = BRAIN_REGIONS.filter((r) => isRegionActive(getFieldValue(workingMemory, r.section, r.field))).length

  const modelDisplay = agentConfig?.model?.split('/').pop() || 'unknown'

  return (
    <div className="max-w-[720px] mx-auto flex flex-col gap-7">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-secondary text-[22px] font-bold text-foreground m-0">Coworker's Mind</h1>
          <p className="font-secondary text-[13px] text-muted m-0">Shape how they think, speak, and understand your world</p>
        </div>
        <div className="relative">
          <button
            onClick={() => setModelOpen(!modelOpen)}
            className="flex items-center gap-2 px-3.5 py-2 bg-card border border-border rounded-xl font-secondary cursor-pointer hover:border-foreground/20"
          >
            <span className="material-icon text-muted" style={{ fontSize: 16 }}>neurology</span>
            <span className="font-mono text-[12px] font-medium text-foreground">{modelDisplay}</span>
            <span className="material-icon text-muted" style={{ fontSize: 14 }}>unfold_more</span>
          </button>
          {modelOpen && (
            <div className="absolute right-0 top-full mt-1 w-[280px] max-h-[300px] overflow-y-auto bg-card border border-border rounded-xl shadow-lg z-50">
              {providers.map((provider) => (
                <div key={provider.id}>
                  <div className="px-3 py-1.5 font-secondary text-[11px] font-semibold text-muted uppercase tracking-wide">
                    {provider.name}{!provider.connected && ' (no key)'}
                  </div>
                  {provider.models.map((m) => {
                    const val = `${provider.id}/${m}`
                    const active = val === agentConfig?.model
                    return (
                      <button
                        key={val}
                        onClick={() => { onUpdateModel(val); setModelOpen(false) }}
                        className={`w-full text-left px-3 py-2 font-secondary text-[12px] border-none cursor-pointer ${active ? 'bg-primary/10 text-primary font-medium' : 'bg-transparent text-foreground hover:bg-sidebar'}`}
                      >
                        {m}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex gap-0.5 bg-sidebar rounded-xl h-10" style={{ width: 360 }}>
        {(['identity', 'subconscious'] as const).map((view) => {
          const isActive = activeView === view
          const icon = view === 'identity' ? 'person' : 'psychology'
          const label = view === 'identity' ? 'Identity' : 'Subconscious'
          return (
            <button
              key={view}
              onClick={() => {
                setActiveView(view)
                if (view === 'subconscious') onLoadObservationalMemory()
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-[9px] border font-secondary text-[13px] cursor-pointer transition-colors ${
                isActive
                  ? 'bg-background border-border font-semibold text-foreground'
                  : 'bg-transparent border-transparent font-medium text-muted'
              }`}
            >
              <span
                className="material-icon"
                style={{ fontSize: 16, color: isActive && view === 'subconscious' ? '#8B5CF6' : undefined }}
              >
                {icon}
              </span>
              {label}
            </button>
          )
        })}
      </div>

      {activeView === 'identity' ? (
        <>
          {/* Brain activity strip */}
          <div className="flex items-center gap-4 px-5 py-4 bg-card border border-border rounded-xl">
            <span className="font-secondary text-[11px] font-semibold text-muted uppercase tracking-wide">Brain activity</span>
            <div className="flex items-center gap-2">
              {BRAIN_REGIONS.map((r) => {
                const active = isRegionActive(getFieldValue(workingMemory, r.section, r.field))
                return (
                  <div
                    key={r.field}
                    className="w-2.5 h-2.5 rounded-full"
                    style={{
                      backgroundColor: r.color,
                      opacity: active ? 1 : 0.25,
                    }}
                  />
                )
              })}
            </div>
            <span className="font-secondary text-[11px] text-muted">{activeCount} of {BRAIN_REGIONS.length} regions active</span>
          </div>

          {/* WHO THEY ARE */}
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center gap-2">
              <span className="material-icon text-muted" style={{ fontSize: 16 }}>person</span>
              <span className="font-secondary text-[11px] font-bold text-muted uppercase tracking-wider">Who they are</span>
            </div>
            <BrainCard
              title={personaRegions[0].title}
              icon={personaRegions[0].icon}
              color={personaRegions[0].color}
              content={getFieldValue(workingMemory, 'persona', personaRegions[0].field)}
              dormant={!isRegionActive(getFieldValue(workingMemory, 'persona', personaRegions[0].field))}
              onEdit={() => setEditing(personaRegions[0])}
            />
            <div className="flex gap-3.5">
              {personaRegions.slice(1, 3).map((r) => (
                <BrainCard
                  key={r.field}
                  title={r.title}
                  icon={r.icon}
                  color={r.color}
                  content={getFieldValue(workingMemory, 'persona', r.field)}
                  dormant={!isRegionActive(getFieldValue(workingMemory, 'persona', r.field))}
                  onEdit={() => setEditing(r)}
                />
              ))}
            </div>
            <BrainCard
              title={personaRegions[3].title}
              icon={personaRegions[3].icon}
              color={personaRegions[3].color}
              content={getFieldValue(workingMemory, 'persona', personaRegions[3].field)}
              dormant={!isRegionActive(getFieldValue(workingMemory, 'persona', personaRegions[3].field))}
              onEdit={() => setEditing(personaRegions[3])}
            />
          </div>

          {/* WHAT THEY KNOW */}
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center gap-2">
              <span className="material-icon text-muted" style={{ fontSize: 16 }}>apartment</span>
              <span className="font-secondary text-[11px] font-bold text-muted uppercase tracking-wider">What they know</span>
            </div>
            <div className="flex gap-3.5">
              {orgRegions.slice(0, 2).map((r) => (
                <BrainCard
                  key={r.field}
                  title={r.title}
                  icon={r.icon}
                  color={r.color}
                  content={getFieldValue(workingMemory, 'org', r.field)}
                  dormant={!isRegionActive(getFieldValue(workingMemory, 'org', r.field))}
                  onEdit={() => setEditing(r)}
                />
              ))}
            </div>
            <div className="flex gap-3.5">
              {orgRegions.slice(2, 4).map((r) => (
                <BrainCard
                  key={r.field}
                  title={r.title}
                  icon={r.icon}
                  color={r.color}
                  content={getFieldValue(workingMemory, 'org', r.field)}
                  dormant={!isRegionActive(getFieldValue(workingMemory, 'org', r.field))}
                  onEdit={() => setEditing(r)}
                />
              ))}
            </div>
            <BrainCard
              title={orgRegions[4].title}
              icon={orgRegions[4].icon}
              color={orgRegions[4].color}
              content={getFieldValue(workingMemory, 'org', orgRegions[4].field)}
              dormant={!isRegionActive(getFieldValue(workingMemory, 'org', orgRegions[4].field))}
              onEdit={() => setEditing(orgRegions[4])}
            />
          </div>

          {/* Edit modal */}
          {editing && (
            <BrainEditModal
              title={editing.title}
              icon={editing.icon}
              color={editing.color}
              value={getFieldValue(workingMemory, editing.section, editing.field) || ''}
              onSave={(v) => {
                onUpdateField(editing.section, editing.field, v)
                setEditing(null)
              }}
              onClose={() => setEditing(null)}
            />
          )}
        </>
      ) : (
        <SubconsciousView data={observationalMemory} />
      )}
    </div>
  )
}

/* ── Channels ── */

function StatusBadge({ label, variant }: { label: string; variant: 'success' | 'warning' | 'muted' }) {
  const styles = {
    success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400',
    warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400',
    muted: 'bg-sidebar text-muted',
  }
  return (
    <span
      className={`inline-flex items-center font-secondary text-[12px] font-medium rounded-md ${styles[variant]}`}
      style={{ padding: '2px 8px' }}
    >
      {label}
    </span>
  )
}

function WhatsAppSection() {
  const waStatus = useAppStore((s) => s.waStatus)
  const waAllowlist = useAppStore((s) => s.waAllowlist)
  const waLoaded = useAppStore((s) => s.waLoaded)
  const loadWhatsAppStatus = useAppStore((s) => s.loadWhatsAppStatus)
  const startWaPolling = useAppStore((s) => s.startWaPolling)
  const stopWaPolling = useAppStore((s) => s.stopWaPolling)
  const waConnect = useAppStore((s) => s.waConnect)
  const waDisconnect = useAppStore((s) => s.waDisconnect)
  const waLogout = useAppStore((s) => s.waLogout)
  const loadWaAllowlist = useAppStore((s) => s.loadWaAllowlist)
  const waAddAllowlist = useAppStore((s) => s.waAddAllowlist)
  const waRemoveAllowlist = useAppStore((s) => s.waRemoveAllowlist)
  const waPair = useAppStore((s) => s.waPair)

  const [newPhone, setNewPhone] = useState('')
  const [adding, setAdding] = useState(false)
  const [pairingCode, setPairingCode] = useState('')
  const [pairing, setPairing] = useState(false)
  const [pairingError, setPairingError] = useState('')
  const prevStatusRef = useRef(waStatus.status)

  useSliceData(loadWhatsAppStatus)
  useSliceData(loadWaAllowlist)

  // Manage polling: stop when connected, start for transient states (connecting, qr_ready, logged_out)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = waStatus.status
    if (prev !== 'connected' && waStatus.status === 'connected') {
      stopWaPolling()
    } else if (waStatus.status !== 'connected' && waStatus.status !== 'disconnected') {
      startWaPolling()
    }
    return () => stopWaPolling()
  }, [waStatus.status, stopWaPolling, startWaPolling])

  const handleConnect = async () => {
    await waConnect()
  }

  const handleDisconnect = async () => {
    await waDisconnect()
  }

  const handleLogout = async () => {
    await waLogout()
  }

  const handleAddPhone = async () => {
    if (!newPhone.trim()) return
    setAdding(true)
    try {
      await waAddAllowlist(newPhone.trim())
      setNewPhone('')
    } finally {
      setAdding(false)
    }
  }

  const handlePair = async () => {
    if (!pairingCode.trim()) return
    setPairing(true)
    setPairingError('')
    try {
      const result = await waPair(pairingCode.trim())
      if (result.ok) {
        setPairingCode('')
      } else {
        setPairingError(result.error || 'Pairing failed')
      }
    } finally {
      setPairing(false)
    }
  }

  const { status, qrDataUrl, connectedPhone } = waStatus

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <div>
        <h3 className="font-secondary text-[18px] font-semibold text-foreground mb-1">
          Ask Coworker over WhatsApp
        </h3>
        <p className="font-secondary text-[14px] text-muted" style={{ maxWidth: 600 }}>
          Send a WhatsApp message to Coworker from your phone. Replies are sent back in the chat.
        </p>
      </div>

      {/* Connection card */}
      <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
        <div className="flex items-center justify-between mb-3">
          <span className="font-secondary text-[13px] font-medium text-muted">Connection</span>
          {status === 'connected' && <StatusBadge label="Connected" variant="success" />}
          {status === 'connecting' && <StatusBadge label="Connecting..." variant="warning" />}
          {status === 'qr_ready' && <StatusBadge label="Scan QR" variant="warning" />}
          {status === 'logged_out' && <StatusBadge label="Logged out" variant="muted" />}
          {status === 'disconnected' && <StatusBadge label="Disconnected" variant="muted" />}
        </div>

        {/* QR code display */}
        {status === 'qr_ready' && qrDataUrl && (
          <div className="flex flex-col items-center gap-3 py-4">
            <img
              src={qrDataUrl}
              alt="WhatsApp QR Code"
              style={{ width: 200, height: 200, borderRadius: 12 }}
            />
            <span className="font-secondary text-[13px] text-muted">
              Open WhatsApp on your phone and scan this code
            </span>
            <button
              onClick={handleDisconnect}
              className="font-secondary text-[13px] text-muted-dim hover:text-muted"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Connected state */}
        {status === 'connected' && (
          <div className="flex items-center justify-between" style={{ padding: '12px 0' }}>
            <span className="font-primary text-[14px] text-foreground">
              {connectedPhone || 'Connected'}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDisconnect}
                className="font-secondary text-[13px] font-medium text-foreground border border-border rounded-lg hover:bg-sidebar-accent transition-colors"
                style={{ height: 32, padding: '0 12px' }}
              >
                Disconnect
              </button>
              <button
                onClick={handleLogout}
                className="font-secondary text-[13px] font-medium text-red-500 border border-border rounded-lg hover:bg-sidebar-accent transition-colors"
                style={{ height: 32, padding: '0 12px' }}
              >
                Logout
              </button>
            </div>
          </div>
        )}

        {/* Disconnected / logged out state */}
        {(status === 'disconnected' || status === 'logged_out') && (
          <div style={{ padding: '12px 0' }}>
            <button
              onClick={handleConnect}
              className="flex items-center gap-2 font-secondary text-[13px] font-medium text-foreground bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors"
              style={{ height: 36, padding: '0 16px' }}
            >
              <span className="material-icon" style={{ fontSize: 16 }}>qr_code_2</span>
              Connect WhatsApp
            </button>
          </div>
        )}

        {/* Connecting state */}
        {status === 'connecting' && (
          <div className="flex items-center gap-2" style={{ padding: '12px 0' }}>
            <span className="font-secondary text-[13px] text-muted">Initializing connection...</span>
          </div>
        )}
      </div>

      {/* Pairing card */}
      <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
        <div className="flex items-center justify-between mb-1">
          <span className="font-secondary text-[13px] font-medium text-muted">Pair a Contact</span>
        </div>
        <p className="font-secondary text-[12px] text-muted-dim mb-3">
          When someone messages Coworker on WhatsApp, they receive a pairing code. Enter it here to allow them.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={pairingCode}
            onChange={(e) => { setPairingCode(e.target.value); setPairingError('') }}
            onKeyDown={(e) => e.key === 'Enter' && handlePair()}
            placeholder="Enter 6-digit code"
            className="flex-1 h-9 px-3 bg-transparent border border-border rounded-lg font-primary text-[14px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
            maxLength={6}
          />
          <button
            onClick={handlePair}
            disabled={pairing || !pairingCode.trim()}
            className="flex items-center gap-1.5 font-secondary text-[13px] font-medium text-foreground bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50"
            style={{ height: 36, padding: '0 14px' }}
          >
            {pairing ? 'Pairing...' : 'Pair'}
          </button>
        </div>
        {pairingError && (
          <p className="font-secondary text-[12px] text-red-500 mt-2">{pairingError}</p>
        )}
      </div>

      {/* Allowlist card */}
      <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
        <div className="flex items-center justify-between mb-3">
          <span className="font-secondary text-[13px] font-medium text-muted">Allowed Numbers</span>
        </div>

        {/* Add phone form (manual fallback) */}
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddPhone()}
            placeholder="+1 555 012 3456"
            className="flex-1 h-9 px-3 bg-transparent border border-border rounded-lg font-primary text-[14px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
          />
          <button
            onClick={handleAddPhone}
            disabled={adding || !newPhone.trim()}
            className="flex items-center gap-1.5 font-secondary text-[13px] font-medium text-foreground border border-border rounded-lg hover:bg-sidebar-accent transition-colors disabled:opacity-50"
            style={{ height: 36, padding: '0 12px' }}
          >
            <span className="material-icon" style={{ fontSize: 16 }}>add</span>
            Add
          </button>
        </div>

        {/* Allowlist items */}
        {waAllowlist.map((entry, i) => (
          <div
            key={entry.phoneNumber}
            className={`flex items-center justify-between ${i > 0 || true ? 'border-t border-border' : ''}`}
            style={{ padding: '12px 0' }}
          >
            <span className="font-primary text-[14px] text-foreground">{entry.phoneNumber}</span>
            <button
              onClick={() => waRemoveAllowlist(entry.phoneNumber)}
              className="text-muted-dim hover:text-red-500 transition-colors"
              title="Remove"
            >
              <span className="material-icon" style={{ fontSize: 18 }}>close</span>
            </button>
          </div>
        ))}

        {waAllowlist.length === 0 && (
          <p className="font-secondary text-[13px] text-muted-dim py-2">
            No numbers added yet. Add phone numbers that can message Coworker.
          </p>
        )}
      </div>
    </div>
  )
}

/* ── Email (Google) ── */

function EmailSection() {
  const gogInstalled = useAppStore((s) => s.gogInstalled)
  const gogConfigured = useAppStore((s) => s.gogConfigured)
  const gogAccounts = useAppStore((s) => s.gogAccounts)
  const gogLoaded = useAppStore((s) => s.gogLoaded)
  const gogAuthUrl = useAppStore((s) => s.gogAuthUrl)
  const gogAuthEmail = useAppStore((s) => s.gogAuthEmail)
  const gogAuthError = useAppStore((s) => s.gogAuthError)
  const loadGogStatus = useAppStore((s) => s.loadGogStatus)
  const gogStartAuth = useAppStore((s) => s.gogStartAuth)
  const gogCompleteAuth = useAppStore((s) => s.gogCompleteAuth)
  const gogTestAccount = useAppStore((s) => s.gogTestAccount)
  const gogRemoveAccount = useAppStore((s) => s.gogRemoveAccount)
  const gogClearAuth = useAppStore((s) => s.gogClearAuth)

  const [newEmail, setNewEmail] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [completing, setCompleting] = useState(false)
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string }>>({})
  const [removing, setRemoving] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set(['gmail']))

  const GOG_SERVICES = [
    { id: 'gmail', label: 'Gmail', icon: 'mail' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar_today' },
    { id: 'drive', label: 'Drive', icon: 'folder' },
    { id: 'docs', label: 'Docs', icon: 'description' },
    { id: 'sheets', label: 'Sheets', icon: 'table_chart' },
    { id: 'contacts', label: 'Contacts', icon: 'contacts' },
    { id: 'tasks', label: 'Tasks', icon: 'task_alt' },
    { id: 'chat', label: 'Chat', icon: 'chat' },
  ] as const

  const toggleService = (id: string) => {
    setSelectedServices((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useSliceData(loadGogStatus)

  const handleStartAuth = async () => {
    const email = newEmail.trim()
    if (!email || selectedServices.size === 0) return
    const services = Array.from(selectedServices).join(',')
    await gogStartAuth(email, services)
    setNewEmail('')
  }

  const handleCompleteAuth = async () => {
    if (!redirectUrl.trim() || !gogAuthEmail) return
    setCompleting(true)
    try {
      const services = Array.from(selectedServices).join(',')
      await gogCompleteAuth(gogAuthEmail, redirectUrl.trim(), services)
      setRedirectUrl('')
      setSelectedServices(new Set(['gmail']))
    } finally {
      setCompleting(false)
    }
  }

  const handleTest = async (email: string) => {
    setTesting((t) => ({ ...t, [email]: true }))
    setTestResults((r) => { const copy = { ...r }; delete copy[email]; return copy })
    try {
      const result = await gogTestAccount(email)
      setTestResults((r) => ({ ...r, [email]: result }))
    } finally {
      setTesting((t) => ({ ...t, [email]: false }))
    }
  }

  const handleRemove = async (email: string) => {
    setRemoving(email)
    try {
      await gogRemoveAccount(email)
    } finally {
      setRemoving(null)
    }
  }

  const handleCancel = () => {
    gogClearAuth()
    setRedirectUrl('')
  }

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <div>
        <h3 className="font-secondary text-[18px] font-semibold text-foreground mb-1">
          Email (Google)
        </h3>
        <p className="font-secondary text-[14px] text-muted" style={{ maxWidth: 600 }}>
          Connect your Google account to send and receive emails through Gmail. Supports Gmail,
          Calendar, and other Google services.
        </p>
      </div>

      {/* Not installed */}
      {gogLoaded && !gogInstalled && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl" style={{ padding: 20 }}>
          <div className="flex items-start gap-3">
            <span className="material-icon text-amber-600 dark:text-amber-400 shrink-0" style={{ fontSize: 20 }}>warning</span>
            <div>
              <p className="font-secondary text-[14px] font-medium text-foreground mb-1">
                gog CLI not found
              </p>
              <p className="font-secondary text-[13px] text-muted mb-3">
                The gog CLI is required to enable Google services. Install it to connect your Gmail and other Google accounts.
              </p>
              <code className="font-mono text-[13px] text-foreground bg-sidebar rounded-md inline-block" style={{ padding: '6px 12px' }}>
                brew install steipete/tap/gogcli
              </code>
            </div>
          </div>
        </div>
      )}

      {/* Installed but not configured */}
      {gogLoaded && gogInstalled && !gogConfigured && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl" style={{ padding: 20 }}>
          <div className="flex items-start gap-3">
            <span className="material-icon text-amber-600 dark:text-amber-400 shrink-0" style={{ fontSize: 20 }}>key_off</span>
            <div>
              <p className="font-secondary text-[14px] font-medium text-foreground mb-1">
                Google OAuth not configured
              </p>
              <p className="font-secondary text-[13px] text-muted mb-3">
                Set up Google OAuth credentials to connect your Google account. Add these environment variables and restart:
              </p>
              <div className="flex flex-col gap-1">
                <code className="font-mono text-[13px] text-foreground bg-sidebar rounded-md inline-block" style={{ padding: '6px 12px' }}>
                  GOG_GOOGLE_CLIENT_ID=your-client-id
                </code>
                <code className="font-mono text-[13px] text-foreground bg-sidebar rounded-md inline-block" style={{ padding: '6px 12px' }}>
                  GOG_GOOGLE_CLIENT_SECRET=your-client-secret
                </code>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Auth in progress */}
      {gogConfigured && gogAuthUrl && gogAuthEmail && (
        <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
          <div className="flex items-center gap-2 mb-4">
            <span className="material-icon text-amber-500" style={{ fontSize: 18 }}>pending</span>
            <span className="font-secondary text-[14px] font-medium text-foreground">
              Authorization in progress for {gogAuthEmail}
            </span>
          </div>

          {/* Step 1 */}
          <p className="font-secondary text-[13px] font-medium text-muted mb-2">
            Step 1: Open the authorization link in your browser
          </p>
          <div
            className="flex items-center gap-2 bg-sidebar rounded-lg cursor-pointer hover:bg-sidebar/80 transition-colors mb-4"
            style={{ padding: '8px 12px' }}
            onClick={() => window.open(gogAuthUrl, '_blank')}
          >
            <code className="font-mono text-[12px] text-primary truncate flex-1">{gogAuthUrl}</code>
            <span className="material-icon text-muted shrink-0" style={{ fontSize: 16 }}>open_in_new</span>
          </div>

          {/* Step 2 */}
          <p className="font-secondary text-[13px] font-medium text-muted mb-2">
            Step 2: After authorizing, paste the redirect URL below
          </p>
          <textarea
            value={redirectUrl}
            onChange={(e) => setRedirectUrl(e.target.value)}
            placeholder="Paste the redirect URL here..."
            rows={2}
            className="w-full px-3 py-2 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary resize-none mb-3"
          />

          {gogAuthError && (
            <p className="font-secondary text-[13px] text-red-500 mb-3">{gogAuthError}</p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleCancel}
              className="font-secondary text-[13px] font-medium text-muted hover:text-foreground transition-colors"
              style={{ height: 36, padding: '0 12px' }}
            >
              Cancel
            </button>
            <button
              onClick={handleCompleteAuth}
              disabled={completing || !redirectUrl.trim()}
              className="flex items-center gap-1.5 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
              style={{ height: 36, padding: '0 16px' }}
            >
              {completing ? (
                <span className="material-icon animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
              ) : (
                <span className="material-icon" style={{ fontSize: 16 }}>check_circle</span>
              )}
              Complete Authorization
            </button>
          </div>
        </div>
      )}

      {/* Connected accounts */}
      {gogConfigured && gogAccounts.length > 0 && !gogAuthUrl && (
        <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
          <div className="flex items-center justify-between mb-3">
            <span className="font-secondary text-[14px] font-medium text-foreground">Google Accounts</span>
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1 font-secondary text-[13px] font-medium text-primary hover:text-primary-hover transition-colors"
            >
              <span className="material-icon" style={{ fontSize: 16 }}>add</span>
              Add account
            </button>
          </div>

          <div className="flex flex-col" style={{ gap: 8 }}>
            {gogAccounts.map((account) => (
              <div key={account.email} className="bg-sidebar rounded-lg" style={{ padding: '12px 14px' }}>
                <div className="flex items-center gap-3">
                  <span className="material-icon text-muted" style={{ fontSize: 20 }}>mail</span>
                  <p className="font-secondary text-[14px] font-medium text-foreground truncate flex-1 min-w-0">{account.email}</p>
                  <StatusBadge label="Connected" variant="success" />
                </div>

                {account.services.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2" style={{ marginLeft: 32 }}>
                    {account.services.map((svc) => (
                      <span
                        key={svc}
                        className="inline-flex items-center font-secondary text-[11px] font-medium rounded-md bg-primary/10 text-primary capitalize"
                        style={{ padding: '2px 8px' }}
                      >
                        {svc}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 mt-2" style={{ marginLeft: 32 }}>
                  <button
                    onClick={() => handleTest(account.email)}
                    disabled={testing[account.email]}
                    className="flex items-center gap-1 font-secondary text-[12px] font-medium text-muted hover:text-foreground transition-colors disabled:opacity-50"
                    style={{ padding: '4px 8px' }}
                  >
                    {testing[account.email] ? (
                      <span className="material-icon animate-spin" style={{ fontSize: 14 }}>progress_activity</span>
                    ) : (
                      <span className="material-icon" style={{ fontSize: 14 }}>science</span>
                    )}
                    Test
                  </button>

                  <button
                    onClick={() => handleRemove(account.email)}
                    disabled={removing === account.email}
                    className="flex items-center gap-1 font-secondary text-[12px] font-medium text-red-500 hover:text-red-600 transition-colors disabled:opacity-50"
                    style={{ padding: '4px 8px' }}
                  >
                    <span className="material-icon" style={{ fontSize: 14 }}>delete</span>
                    Remove
                  </button>

                  {testResults[account.email] && (
                    <span className={`font-secondary text-[12px] ${testResults[account.email].ok ? 'text-green-600' : 'text-red-500'}`}>
                      {testResults[account.email].ok ? 'OK' : testResults[account.email].error || 'Failed'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Inline add form (shown when "Add account" is clicked) */}
          {showAddForm && (
            <div className="mt-3 border-t border-border" style={{ paddingTop: 12 }}>
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { handleStartAuth(); setShowAddForm(false) }
                  if (e.key === 'Escape') { setShowAddForm(false); setNewEmail('') }
                }}
                placeholder="you@gmail.com"
                autoFocus
                className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-primary text-[14px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary mb-3"
              />
              <p className="font-secondary text-[12px] font-medium text-muted mb-2">Services</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {GOG_SERVICES.map((svc) => (
                  <button
                    key={svc.id}
                    onClick={() => toggleService(svc.id)}
                    className={`flex items-center gap-1.5 font-secondary text-[12px] font-medium rounded-lg border transition-colors ${
                      selectedServices.has(svc.id)
                        ? 'bg-primary/10 border-primary/30 text-primary'
                        : 'bg-transparent border-border text-muted hover:text-foreground hover:border-foreground/20'
                    }`}
                    style={{ padding: '5px 10px' }}
                  >
                    <span className="material-icon" style={{ fontSize: 14 }}>{svc.icon}</span>
                    {svc.label}
                    {selectedServices.has(svc.id) && (
                      <span className="material-icon" style={{ fontSize: 12 }}>check</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { handleStartAuth(); setShowAddForm(false) }}
                  disabled={!newEmail.trim() || selectedServices.size === 0}
                  className="flex items-center gap-1.5 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors shrink-0"
                  style={{ height: 36, padding: '0 16px' }}
                >
                  <span className="material-icon" style={{ fontSize: 16 }}>login</span>
                  Authorize
                </button>
                <button
                  onClick={() => { setShowAddForm(false); setNewEmail(''); setSelectedServices(new Set(['gmail'])) }}
                  className="font-secondary text-[13px] font-medium text-muted hover:text-foreground transition-colors shrink-0"
                  style={{ height: 36, padding: '0 8px' }}
                >
                  Cancel
                </button>
              </div>
              {gogAuthError && !gogAuthUrl && (
                <p className="font-secondary text-[13px] text-red-500 mt-2">{gogAuthError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add account (when configured but no accounts and no auth in progress) */}
      {gogConfigured && gogAccounts.length === 0 && !gogAuthUrl && (
        <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
          <p className="font-secondary text-[14px] font-medium text-foreground mb-1">Add Google Account</p>
          <p className="font-secondary text-[13px] text-muted mb-3">
            Enter your Google email and select the services you want to authorize.
          </p>
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleStartAuth()}
            placeholder="you@gmail.com"
            className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-primary text-[14px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary mb-3"
          />
          <p className="font-secondary text-[12px] font-medium text-muted mb-2">Services</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {GOG_SERVICES.map((svc) => (
              <button
                key={svc.id}
                onClick={() => toggleService(svc.id)}
                className={`flex items-center gap-1.5 font-secondary text-[12px] font-medium rounded-lg border transition-colors ${
                  selectedServices.has(svc.id)
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'bg-transparent border-border text-muted hover:text-foreground hover:border-foreground/20'
                }`}
                style={{ padding: '5px 10px' }}
              >
                <span className="material-icon" style={{ fontSize: 14 }}>{svc.icon}</span>
                {svc.label}
                {selectedServices.has(svc.id) && (
                  <span className="material-icon" style={{ fontSize: 12 }}>check</span>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={handleStartAuth}
            disabled={!newEmail.trim() || selectedServices.size === 0}
            className="flex items-center gap-1.5 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
            style={{ height: 36, padding: '0 16px' }}
          >
            <span className="material-icon" style={{ fontSize: 16 }}>login</span>
            Authorize
          </button>
          {gogAuthError && !gogAuthUrl && (
            <p className="font-secondary text-[13px] text-red-500 mt-2">{gogAuthError}</p>
          )}
        </div>
      )}
    </div>
  )
}

/* ── GitHub (gh CLI) ── */

function GitHubSection() {
  const ghInstalled = useAppStore((s) => s.ghInstalled)
  const ghLoggedIn = useAppStore((s) => s.ghLoggedIn)
  const ghUsername = useAppStore((s) => s.ghUsername)
  const ghLoaded = useAppStore((s) => s.ghLoaded)
  const ghAuthInProgress = useAppStore((s) => s.ghAuthInProgress)
  const ghUserCode = useAppStore((s) => s.ghUserCode)
  const ghAuthUrl = useAppStore((s) => s.ghAuthUrl)
  const ghAuthError = useAppStore((s) => s.ghAuthError)
  const loadGhStatus = useAppStore((s) => s.loadGhStatus)
  const ghStartLogin = useAppStore((s) => s.ghStartLogin)
  const ghPollAuthStatus = useAppStore((s) => s.ghPollAuthStatus)
  const ghDoLogout = useAppStore((s) => s.ghDoLogout)
  const ghClearAuth = useAppStore((s) => s.ghClearAuth)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; username?: string; error?: string } | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useSliceData(loadGhStatus)

  // Poll for auth completion when auth is in progress
  useEffect(() => {
    if (ghAuthInProgress && ghUserCode && !pollingRef.current) {
      pollingRef.current = setInterval(async () => {
        const done = await ghPollAuthStatus()
        if (done && pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
      }, 3000)
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [ghAuthInProgress, ghUserCode, ghPollAuthStatus])

  const handleConnect = async () => {
    setTestResult(null)
    await ghStartLogin()
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      await loadGhStatus()
      const state = useAppStore.getState()
      if (state.ghLoggedIn) {
        setTestResult({ ok: true, username: state.ghUsername || undefined })
      } else {
        setTestResult({ ok: false, error: 'Not authenticated' })
      }
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message })
    } finally {
      setTesting(false)
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await ghDoLogout()
      setTestResult(null)
    } finally {
      setDisconnecting(false)
    }
  }

  const handleCancel = () => {
    ghClearAuth()
  }

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <div>
        <h3 className="font-secondary text-[18px] font-semibold text-foreground mb-1">
          GitHub
        </h3>
        <p className="font-secondary text-[14px] text-muted" style={{ maxWidth: 600 }}>
          Connect your GitHub account to enable git operations and repository access in the workspace.
        </p>
      </div>

      {/* Not installed */}
      {ghLoaded && !ghInstalled && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl" style={{ padding: 20 }}>
          <div className="flex items-start gap-3">
            <span className="material-icon text-amber-600 dark:text-amber-400 shrink-0" style={{ fontSize: 20 }}>warning</span>
            <div>
              <p className="font-secondary text-[14px] font-medium text-foreground mb-1">
                GitHub CLI not found
              </p>
              <p className="font-secondary text-[13px] text-muted mb-3">
                The GitHub CLI is required to enable repository access. Install it to connect your GitHub account.
              </p>
              <code className="font-mono text-[13px] text-foreground bg-sidebar rounded-md inline-block" style={{ padding: '6px 12px' }}>
                brew install gh
              </code>
            </div>
          </div>
        </div>
      )}

      {/* Auth in progress — device flow */}
      {ghInstalled && ghAuthInProgress && ghUserCode && (
        <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
          <div className="flex items-center gap-2 mb-4">
            <span className="material-icon text-amber-500" style={{ fontSize: 18 }}>pending</span>
            <span className="font-secondary text-[14px] font-medium text-foreground">
              Authorization in progress
            </span>
          </div>

          {/* Step 1: Copy code */}
          <p className="font-secondary text-[13px] font-medium text-muted mb-2">
            Step 1: Copy your one-time code
          </p>
          <div
            className="flex items-center justify-center gap-3 bg-sidebar rounded-lg cursor-pointer hover:bg-sidebar/80 transition-colors mb-4"
            style={{ padding: '14px 16px' }}
            onClick={() => navigator.clipboard.writeText(ghUserCode)}
          >
            <code className="font-mono text-[24px] font-bold text-foreground tracking-[0.2em]">{ghUserCode}</code>
            <span className="material-icon text-muted shrink-0" style={{ fontSize: 18 }}>content_copy</span>
          </div>

          {/* Step 2: Open GitHub */}
          <p className="font-secondary text-[13px] font-medium text-muted mb-2">
            Step 2: Open GitHub and paste the code
          </p>
          <button
            onClick={() => window.open(ghAuthUrl || 'https://github.com/login/device', '_blank')}
            className="flex items-center gap-2 font-secondary text-[13px] font-medium text-primary hover:text-primary-hover transition-colors mb-4"
          >
            <span className="material-icon" style={{ fontSize: 16 }}>open_in_new</span>
            Open github.com/login/device
          </button>

          {/* Waiting */}
          <div className="flex items-center gap-2 mb-3">
            <span className="material-icon animate-spin text-muted" style={{ fontSize: 16 }}>progress_activity</span>
            <span className="font-secondary text-[13px] text-muted">Waiting for authorization...</span>
          </div>

          {ghAuthError && (
            <p className="font-secondary text-[13px] text-red-500 mb-3">{ghAuthError}</p>
          )}

          <button
            onClick={handleCancel}
            className="font-secondary text-[13px] font-medium text-muted hover:text-foreground transition-colors"
            style={{ height: 36, padding: '0 12px' }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Connected */}
      {ghInstalled && ghLoggedIn && !ghAuthInProgress && (
        <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
          <div className="flex items-center justify-between mb-3">
            <span className="font-secondary text-[14px] font-medium text-foreground">GitHub Account</span>
            <StatusBadge label="Connected" variant="success" />
          </div>

          <div className="bg-sidebar rounded-lg" style={{ padding: '12px 14px' }}>
            <div className="flex items-center gap-3">
              <span className="material-icon text-muted" style={{ fontSize: 20 }}>person</span>
              <p className="font-secondary text-[14px] font-medium text-foreground flex-1">
                {ghUsername || 'Authenticated'}
              </p>
            </div>

            <div className="flex items-center gap-2 mt-2" style={{ marginLeft: 32 }}>
              <button
                onClick={handleTest}
                disabled={testing}
                className="flex items-center gap-1 font-secondary text-[12px] font-medium text-muted hover:text-foreground transition-colors disabled:opacity-50"
                style={{ padding: '4px 8px' }}
              >
                {testing ? (
                  <span className="material-icon animate-spin" style={{ fontSize: 14 }}>progress_activity</span>
                ) : (
                  <span className="material-icon" style={{ fontSize: 14 }}>science</span>
                )}
                Test
              </button>

              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="flex items-center gap-1 font-secondary text-[12px] font-medium text-red-500 hover:text-red-600 transition-colors disabled:opacity-50"
                style={{ padding: '4px 8px' }}
              >
                <span className="material-icon" style={{ fontSize: 14 }}>logout</span>
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>

              {testResult && (
                <span className={`font-secondary text-[12px] ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {testResult.ok ? `OK (${testResult.username})` : testResult.error || 'Failed'}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Not connected — connect button */}
      {ghInstalled && !ghLoggedIn && !ghAuthInProgress && (
        <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
          <p className="font-secondary text-[14px] font-medium text-foreground mb-1">Connect GitHub</p>
          <p className="font-secondary text-[13px] text-muted mb-3">
            Authenticate with GitHub to enable git operations and private repository access.
          </p>
          <button
            onClick={handleConnect}
            className="flex items-center gap-2 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors"
            style={{ height: 36, padding: '0 16px' }}
          >
            <span className="material-icon" style={{ fontSize: 16 }}>login</span>
            Connect GitHub
          </button>
          {ghAuthError && (
            <p className="font-secondary text-[13px] text-red-500 mt-2">{ghAuthError}</p>
          )}
        </div>
      )}
    </div>
  )
}

/* ── A2A / API Access ── */

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center justify-center text-muted hover:text-foreground transition-colors shrink-0"
      style={{ width: 28, height: 28 }}
      title="Copy"
    >
      <span className="material-icon" style={{ fontSize: 15 }}>
        {copied ? 'check' : 'content_copy'}
      </span>
    </button>
  )
}

function TestButton({ url, method = 'GET', body }: { url: string; method?: 'GET' | 'POST'; body?: object }) {
  const [state, setState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleTest = async () => {
    setState('testing')
    setErrorMsg('')
    try {
      const opts: RequestInit = { method, headers: authHeaders() }
      if (method === 'POST' && body) {
        opts.headers = { ...authHeaders(), 'Content-Type': 'application/json' }
        opts.body = JSON.stringify(body)
      }
      const res = await fetch(url, opts)
      await res.json()
      // Any JSON response (including 401) means the endpoint is reachable
      setState('success')
    } catch (err: any) {
      setState('error')
      setErrorMsg(err?.message || 'Connection failed')
    }
    setTimeout(() => setState('idle'), 3000)
  }

  const icon = { idle: 'network_check', testing: 'progress_activity', success: 'check_circle', error: 'error' }[state]
  const color = { idle: undefined, testing: undefined, success: 'var(--color-success, #22c55e)', error: 'var(--color-error, #ef4444)' }[state]
  const title = { idle: 'Test endpoint', testing: 'Testing...', success: 'Connected', error: errorMsg || 'Connection failed' }[state]

  return (
    <button
      onClick={handleTest}
      disabled={state === 'testing'}
      className="flex items-center justify-center text-muted hover:text-foreground transition-colors shrink-0"
      style={{ width: 28, height: 28 }}
      title={title}
    >
      <span
        className={`material-icon${state === 'testing' ? ' animate-spin' : ''}`}
        style={{ fontSize: 15, color }}
      >
        {icon}
      </span>
    </button>
  )
}

function A2aEndpointCard() {
  const a2aInfo = useAppStore((s) => s.a2aInfo)
  const agentCardPath = a2aInfo?.endpoints?.agentCard || '/api/.well-known/coworker/agent-card.json'
  const a2aPath = a2aInfo?.endpoints?.a2a || '/api/a2a/coworker'
  const rows = [
    { label: 'Agent Card', url: `${MASTRA_BASE_URL}${agentCardPath}` },
    {
      label: 'Agent Endpoint',
      url: `${MASTRA_BASE_URL}${a2aPath}`,
      method: 'POST' as const,
      body: { jsonrpc: '2.0', method: 'tasks/get', id: 'test', params: { id: 'test' } },
    },
  ]
  return (
    <div className="bg-card border border-border rounded-xl" style={{ padding: '16px 20px' }}>
      <div className="flex flex-col" style={{ gap: 12 }}>
        {rows.map((r) => (
          <div key={r.label}>
            <p className="font-secondary text-[12px] text-muted mb-1">{r.label}</p>
            <div className="flex items-center gap-2">
              <code className="font-mono text-[13px] text-foreground bg-sidebar rounded-md flex-1 truncate" style={{ padding: '6px 10px' }}>
                {r.url}
              </code>
              <TestButton url={r.url} method={r.method} body={r.body} />
              <CopyButton value={r.url} />
            </div>
          </div>
        ))}
      </div>
      <p className="font-secondary text-[12px] text-muted-dim mt-3">
        These endpoints are automatically available while the server is running.
      </p>
    </div>
  )
}

function A2aSection() {
  return (
    <div className="max-w-[640px] mx-auto flex flex-col" style={{ gap: 12 }}>
      <div>
        <h3 className="font-secondary text-[18px] font-semibold text-foreground mb-1">
          API Access
        </h3>
        <p className="font-secondary text-[14px] text-muted" style={{ maxWidth: 500 }}>
          Expose your agent via A2A protocol for external apps and agents to connect.
        </p>
      </div>
      <A2aEndpointCard />
    </div>
  )
}

/* ── API & MCP Container ── */

const devSubTabs = [
  { label: 'API', icon: 'api' },
  { label: 'MCP', icon: 'dns' },
  { label: 'MCP Server', icon: 'hub' },
]

function DeveloperContent() {
  const [subTab, setSubTab] = useState('API')
  return (
    <div className="flex flex-col" style={{ gap: 20 }}>
      <FilterTabs tabs={devSubTabs} activeTab={subTab} onTabChange={setSubTab} />
      {subTab === 'API' && <A2aSection />}
      {subTab === 'MCP' && <McpServersSection />}
      {subTab === 'MCP Server' && <ExposedMcpSection />}
    </div>
  )
}

/* ── MCP Servers ── */

function McpServerForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: McpServerConfig
  onSave: (server: McpServerConfig) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<'stdio' | 'http'>(initial?.type ?? 'stdio')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [args, setArgs] = useState(initial?.args?.join(' ') ?? '')
  const [env, setEnv] = useState(
    initial?.env ? Object.entries(initial.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
  )
  const [url, setUrl] = useState(initial?.url ?? '')
  const [headers, setHeaders] = useState(
    initial?.headers ? Object.entries(initial.headers).map(([k, v]) => `${k}=${v}`).join('\n') : '',
  )
  const [saving, setSaving] = useState(false)

  const testMcpConnection = useAppStore((s) => s.testMcpConnection)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; tools?: string[]; error?: string } | null>(null)

  const buildConfig = (): McpServerConfig => {
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
    return {
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      type,
      enabled: initial?.enabled ?? true,
      command: type === 'stdio' ? command.trim() : undefined,
      args: type === 'stdio' ? args.trim().split(/\s+/).filter(Boolean) : undefined,
      env: type === 'stdio' && Object.keys(envObj).length > 0 ? envObj : undefined,
      url: type === 'http' ? url.trim() : undefined,
      headers: type === 'http' && Object.keys(headersObj).length > 0 ? headersObj : undefined,
    }
  }

  const handleSave = async () => {
    if (!name.trim()) return
    if (type === 'stdio' && !command.trim()) return
    if (type === 'http' && !url.trim()) return
    setSaving(true)
    try {
      await onSave(buildConfig())
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testMcpConnection(buildConfig())
      setTestResult(result)
    } catch {
      setTestResult({ ok: false, error: 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="bg-card border-2 border-primary/30 rounded-xl" style={{ padding: 20 }}>
      {/* Name */}
      <div className="mb-4">
        <label className="font-secondary text-[13px] font-medium text-muted block mb-1.5">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My MCP Server"
          className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-primary text-[14px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
        />
      </div>

      {/* Type toggle */}
      <div className="mb-4">
        <label className="font-secondary text-[13px] font-medium text-muted block mb-1.5">Type</label>
        <div className="flex gap-1">
          {(['stdio', 'http'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`font-secondary text-[13px] font-medium rounded-lg transition-colors ${
                type === t
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-sidebar text-muted hover:text-foreground'
              }`}
              style={{ height: 32, padding: '0 14px' }}
            >
              {t === 'stdio' ? 'Stdio' : 'URL'}
            </button>
          ))}
        </div>
      </div>

      {/* Stdio fields */}
      {type === 'stdio' && (
        <>
          <div className="mb-4">
            <label className="font-secondary text-[13px] font-medium text-muted block mb-1.5">Command</label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp"
              className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
            />
          </div>
          <div className="mb-4">
            <label className="font-secondary text-[13px] font-medium text-muted block mb-1.5">Arguments</label>
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="arg1 arg2"
              className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
            />
          </div>
          <div className="mb-4">
            <label className="font-secondary text-[13px] font-medium text-muted block mb-1.5">Environment Variables</label>
            <textarea
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              placeholder={'KEY=value\nANOTHER_KEY=value'}
              rows={3}
              className="w-full px-3 py-2 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary resize-y"
            />
          </div>
        </>
      )}

      {/* HTTP fields */}
      {type === 'http' && (
        <>
          <div className="mb-4">
            <label className="font-secondary text-[13px] font-medium text-muted block mb-1.5">URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-server.com/mcp"
              className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
            />
          </div>
          <div className="mb-4">
            <label className="font-secondary text-[13px] font-medium text-muted block mb-1.5">Headers</label>
            <textarea
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              placeholder={'Authorization=Bearer xxx\nX-Api-Key=your-key'}
              rows={3}
              className="w-full px-3 py-2 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary resize-y"
            />
          </div>
        </>
      )}

      {/* Test result */}
      {testResult && (
        <div className={`mb-4 rounded-lg px-3 py-2 font-secondary text-[13px] ${
          testResult.ok ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400' : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
        }`}>
          {testResult.ok ? (
            <span>Connected — {testResult.tools?.length ?? 0} tool{testResult.tools?.length === 1 ? '' : 's'} available</span>
          ) : (
            <span>{testResult.error || 'Connection failed'}</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleTest}
          disabled={testing || (!command.trim() && type === 'stdio') || (!url.trim() && type === 'http')}
          className="flex items-center gap-1.5 font-secondary text-[13px] font-medium text-muted hover:text-foreground disabled:opacity-40 transition-colors"
        >
          {testing ? (
            <span className="material-icon animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
          ) : (
            <span className="material-icon" style={{ fontSize: 16 }}>play_arrow</span>
          )}
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="font-secondary text-[13px] font-medium text-muted hover:text-foreground transition-colors"
            style={{ height: 36, padding: '0 12px' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex items-center gap-1.5 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
            style={{ height: 36, padding: '0 16px' }}
          >
            {saving ? 'Saving...' : 'Save Server'}
          </button>
        </div>
      </div>
    </div>
  )
}

function McpServerCard({
  server,
  onEdit,
  onDelete,
}: {
  server: McpServerConfig
  onEdit: () => void
  onDelete: () => void
}) {
  const testMcpConnection = useAppStore((s) => s.testMcpConnection)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; tools?: string[]; error?: string } | null>(null)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testMcpConnection(server)
      setTestResult(result)
    } catch {
      setTestResult({ ok: false, error: 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  const preview = server.type === 'stdio'
    ? [server.command, ...(server.args || [])].join(' ')
    : server.url || ''

  return (
    <div className={`bg-card border border-border rounded-xl transition-opacity ${!server.enabled ? 'opacity-50' : ''}`} style={{ padding: '16px 20px' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-secondary text-[15px] font-medium text-foreground">{server.name}</span>
          <span
            className="inline-flex items-center font-secondary text-[11px] font-medium rounded-md bg-sidebar text-muted"
            style={{ padding: '1px 8px' }}
          >
            {server.type === 'stdio' ? 'Stdio' : 'URL'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleTest}
            disabled={testing}
            title="Test connection"
            className="text-muted hover:text-foreground transition-colors disabled:opacity-40"
          >
            {testing ? (
              <span className="material-icon animate-spin" style={{ fontSize: 18 }}>progress_activity</span>
            ) : (
              <span className="material-icon" style={{ fontSize: 18 }}>play_arrow</span>
            )}
          </button>
          <button onClick={onEdit} title="Edit" className="text-muted hover:text-foreground transition-colors">
            <span className="material-icon" style={{ fontSize: 18 }}>edit</span>
          </button>
          <button onClick={onDelete} title="Delete" className="text-muted hover:text-red-500 transition-colors">
            <span className="material-icon" style={{ fontSize: 18 }}>delete</span>
          </button>
        </div>
      </div>
      <p className="font-mono text-[12px] text-muted-dim truncate">{preview}</p>
      {testResult && (
        <p className={`mt-2 font-secondary text-[12px] ${testResult.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
          {testResult.ok
            ? `${testResult.tools?.length ?? 0} tool${testResult.tools?.length === 1 ? '' : 's'} available`
            : testResult.error || 'Connection failed'}
        </p>
      )}
    </div>
  )
}

function ExposedMcpSection() {
  const servers = useAppStore((s) => s.exposedMcpServers)
  const loaded = useAppStore((s) => s.exposedMcpLoaded)
  const loadExposedMcpServers = useAppStore((s) => s.loadExposedMcpServers)
  useSliceData(loadExposedMcpServers)

  const [copied, setCopied] = useState(false)

  if (!loaded || servers.length === 0) return null

  const srv = servers[0]
  const sseEndpoint = `${MASTRA_BASE_URL}/api/mcp/${srv.id}/sse`
  const configSnippet = JSON.stringify(
    { mcpServers: { [srv.name.toLowerCase()]: { url: sseEndpoint } } },
    null,
    2,
  )

  return (
    <div className="max-w-[640px] mx-auto flex flex-col" style={{ gap: 12 }}>
      <div>
        <h3 className="font-secondary text-[18px] font-semibold text-foreground mb-1">
          Expose as MCP Server
        </h3>
        <p className="font-secondary text-[14px] text-muted" style={{ maxWidth: 500 }}>
          Your agent is exposed as an MCP server. External clients like Cursor, Claude Desktop, or
          Windsurf can connect to it.
        </p>
      </div>

      {/* Endpoint */}
      <div className="bg-card border border-border rounded-xl" style={{ padding: '16px 20px' }}>
        <p className="font-secondary text-[12px] text-muted mb-1">MCP Endpoint (SSE)</p>
        <div className="flex items-center gap-2">
          <code className="font-mono text-[13px] text-foreground bg-sidebar rounded-md flex-1 truncate" style={{ padding: '6px 10px' }}>
            {sseEndpoint}
          </code>
          <TestButton url={`${MASTRA_BASE_URL}/api/mcp/v0/servers`} />
          <CopyButton value={sseEndpoint} />
        </div>
        <p className="font-secondary text-[12px] text-muted-dim mt-3">
          This endpoint is automatically available while the server is running.
        </p>
      </div>

      {/* Exposed tools */}
      {srv.tools.length > 0 && (
        <div className="bg-card border border-border rounded-xl" style={{ padding: '16px 20px' }}>
          <p className="font-secondary text-[12px] text-muted mb-2">Exposed Tools</p>
          <div className="flex flex-col" style={{ gap: 6 }}>
            {srv.tools.map((t) => (
              <div key={t.name} className="flex items-start gap-2">
                <span className="material-icon text-muted shrink-0" style={{ fontSize: 14, marginTop: 2 }}>build</span>
                <div>
                  <span className="font-mono text-[13px] text-foreground">{t.name}</span>
                  {t.description && (
                    <p className="font-secondary text-[12px] text-muted-dim">{t.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Config snippet */}
      <div className="bg-card border border-border rounded-xl" style={{ padding: '16px 20px' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="font-secondary text-[12px] text-muted">Connection Config</p>
          <button
            onClick={() => { navigator.clipboard.writeText(configSnippet); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            className="flex items-center gap-1 font-secondary text-[12px] text-muted hover:text-foreground transition-colors"
          >
            <span className="material-icon" style={{ fontSize: 14 }}>{copied ? 'check' : 'content_copy'}</span>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="font-mono text-[12px] text-foreground bg-sidebar rounded-md overflow-x-auto" style={{ padding: '10px 12px' }}>
          {configSnippet}
        </pre>
        <p className="font-secondary text-[11px] text-muted-dim mt-2">
          Add this to your MCP client configuration (Cursor, Claude Desktop, etc.)
        </p>
      </div>

      <ApiKeysSection />
    </div>
  )
}

function McpServersSection() {
  const mcpServers = useAppStore((s) => s.mcpServers)
  const mcpLoaded = useAppStore((s) => s.mcpLoaded)
  const loadMcpServers = useAppStore((s) => s.loadMcpServers)
  const addMcpServer = useAppStore((s) => s.addMcpServer)
  const updateMcpServer = useAppStore((s) => s.updateMcpServer)
  const deleteMcpServer = useAppStore((s) => s.deleteMcpServer)

  const [editing, setEditing] = useState<string | 'new' | null>(null)

  useSliceData(loadMcpServers)

  const handleSave = async (server: McpServerConfig) => {
    const existing = mcpServers.find((s) => s.id === server.id)
    if (existing) {
      await updateMcpServer(server)
    } else {
      await addMcpServer(server)
    }
    setEditing(null)
  }

  const editingServer = editing && editing !== 'new'
    ? mcpServers.find((s) => s.id === editing)
    : undefined

  return (
    <div className="max-w-[640px] mx-auto flex flex-col" style={{ gap: 12 }}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-secondary text-[18px] font-semibold text-foreground mb-1">
            MCP Servers
          </h3>
          <p className="font-secondary text-[14px] text-muted" style={{ maxWidth: 500 }}>
            Connect external tools and services to your agent via Model Context Protocol.
          </p>
        </div>
        {mcpServers.length > 0 && !editing && (
          <button
            onClick={() => setEditing('new')}
            className="flex items-center gap-1.5 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors shrink-0"
            style={{ height: 36, padding: '0 16px' }}
          >
            <span className="material-icon" style={{ fontSize: 16 }}>add</span>
            Add Server
          </button>
        )}
      </div>

      {/* Add/Edit form */}
      {editing && (
        <McpServerForm
          initial={editingServer}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Server list */}
      {mcpServers.length > 0 ? (
        <div className="flex flex-col" style={{ gap: 8 }}>
          {mcpServers.map((server) => (
            editing === server.id ? null : (
              <McpServerCard
                key={server.id}
                server={server}
                onEdit={() => setEditing(server.id)}
                onDelete={() => deleteMcpServer(server.id)}
              />
            )
          ))}
        </div>
      ) : !editing ? (
        /* Empty state */
        <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center text-center" style={{ padding: '40px 20px' }}>
          <span className="material-icon text-muted-dim mb-3" style={{ fontSize: 36 }}>dns</span>
          <p className="font-secondary text-[14px] font-medium text-foreground mb-1">No servers configured</p>
          <p className="font-secondary text-[13px] text-muted-dim mb-4" style={{ maxWidth: 320 }}>
            Add an MCP server to give your agent access to external tools and services.
          </p>
          <button
            onClick={() => setEditing('new')}
            className="flex items-center gap-1.5 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors"
            style={{ height: 36, padding: '0 16px' }}
          >
            Add Server
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ChannelsContent() {
  return (
    <div className="max-w-[640px] mx-auto flex flex-col" style={{ gap: 32 }}>
      <WhatsAppSection />

      <EmailSection />

      {/* Telegram — placeholder */}
      <div className="flex flex-col" style={{ gap: 12 }}>
        <div>
          <h3 className="font-secondary text-[18px] font-semibold text-foreground mb-1">
            Ask Coworker over Telegram
          </h3>
          <p className="font-secondary text-[14px] text-muted" style={{ maxWidth: 600 }}>
            Message Coworker on Telegram. Connect your bot token to enable this channel.
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl flex items-center justify-center" style={{ padding: 20, minHeight: 80 }}>
          <span className="font-secondary text-[13px] text-muted-dim">Coming soon</span>
        </div>
      </div>
    </div>
  )
}

/* ── Advanced ── */

type UpdateStatus = {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

function AdvancedContent() {
  const agentConfig = useAppStore((s) => s.agentConfig)
  const updateInstructions = useAppStore((s) => s.updateInstructions)
  const [localInstructions, setLocalInstructions] = useState('')
  const [savingInstructions, setSavingInstructions] = useState(false)
  const [savedInstructions, setSavedInstructions] = useState(false)
  const instructionsInitRef = useRef(false)

  useEffect(() => {
    if (agentConfig && !instructionsInitRef.current) {
      setLocalInstructions(agentConfig.instructions)
      instructionsInitRef.current = true
    }
  }, [agentConfig])

  const instructionsDirty = agentConfig ? localInstructions !== agentConfig.instructions : false

  const handleSaveInstructions = async () => {
    setSavingInstructions(true)
    try {
      await updateInstructions(localInstructions)
      setSavedInstructions(true)
      setTimeout(() => setSavedInstructions(false), 2000)
    } finally {
      setSavingInstructions(false)
    }
  }

  const handleResetInstructions = async () => {
    setSavingInstructions(true)
    try {
      await updateInstructions(null)
      setLocalInstructions(agentConfig?.defaultInstructions ?? '')
      setSavedInstructions(true)
      setTimeout(() => setSavedInstructions(false), 2000)
    } finally {
      setSavingInstructions(false)
    }
  }

  const [serverUrl, setServerUrl] = useState(MASTRA_BASE_URL)
  const [apiToken, setApiToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [savingToken, setSavingToken] = useState(false)
  const [savedToken, setSavedToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' })
  const [appVersion, setAppVersion] = useState('dev')

  useEffect(() => {
    ;(window as any).settings?.get('mastraApiToken')?.then((v: string) => v && setApiToken(v))
    ;(window as any).updater?.getAppVersion?.().then((v: string) => v && setAppVersion(v))
    const unsub = (window as any).updater?.onUpdateStatus?.((data: any) => {
      setUpdateStatus(data)
    })
    return () => unsub?.()
  }, [])

  const handleSaveUrl = async () => {
    const trimmed = serverUrl.replace(/\/+$/, '')
    setSaving(true)
    try {
      await setMastraBaseUrl(trimmed)
      setServerUrl(trimmed)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveToken = async () => {
    setSavingToken(true)
    try {
      await setMastraApiToken(apiToken.trim())
      setSavedToken(true)
      setTimeout(() => setSavedToken(false), 2000)
    } finally {
      setSavingToken(false)
    }
  }

  const handleCheckUpdates = () => {
    setUpdateStatus({ status: 'checking' })
    ;(window as any).updater?.checkForUpdates()
  }

  const handleDownload = () => {
    ;(window as any).updater?.downloadUpdate()
  }

  const handleInstall = () => {
    ;(window as any).updater?.installUpdate()
  }

  return (
    <div className="max-w-[480px] mx-auto flex flex-col gap-10">
      {/* Base Instructions */}
      {agentConfig && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-secondary text-[15px] font-medium text-foreground">Base Instructions</h3>
            {agentConfig.isCustomInstructions && (
              <button
                onClick={handleResetInstructions}
                disabled={savingInstructions}
                className="font-secondary text-[12px] text-muted hover:text-foreground cursor-pointer bg-transparent border-none p-0"
              >
                Reset to default
              </button>
            )}
          </div>
          <p className="font-secondary text-[13px] text-muted mb-4">
            System prompt that guides the agent's behavior. Changes take effect on the next message.
          </p>
          <textarea
            value={localInstructions}
            onChange={(e) => { setLocalInstructions(e.target.value); setSavedInstructions(false) }}
            rows={8}
            className="w-full px-3 py-2 bg-card border border-border rounded-xl font-mono text-[13px] text-foreground outline-none focus:border-primary resize-y"
          />
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={handleSaveInstructions}
              disabled={savingInstructions || !instructionsDirty}
              className="h-10 px-4 bg-primary text-primary-foreground border-none rounded-xl font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover disabled:opacity-40 disabled:cursor-default"
            >
              {savingInstructions ? 'Saving...' : savedInstructions ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Server Connection */}
      <div>
        <h3 className="font-secondary text-[15px] font-medium text-foreground mb-1">Server Connection</h3>
        <p className="font-secondary text-[13px] text-muted mb-4">
          Connect to a remote Mastra server or use the default local instance.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => { setServerUrl(e.target.value); setSaved(false) }}
            placeholder="http://localhost:4111"
            className="flex-1 h-10 px-3 bg-card border border-border rounded-xl font-mono text-[13px] text-foreground outline-none focus:border-primary"
          />
          <button
            onClick={handleSaveUrl}
            disabled={saving || serverUrl === MASTRA_BASE_URL}
            className="h-10 px-4 bg-primary text-primary-foreground border-none rounded-xl font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover disabled:opacity-40 disabled:cursor-default"
          >
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
          </button>
        </div>
        {saved && (
          <p className="font-secondary text-[12px] text-green-500 mt-2 m-0">
            Server URL updated. Reload the app for all connections to use the new URL.
          </p>
        )}
        <div className="mt-4">
          <p className="font-secondary text-[13px] text-muted mb-2">
            API Token (for authenticated remote servers)
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showToken ? 'text' : 'password'}
                value={apiToken}
                onChange={(e) => { setApiToken(e.target.value); setSavedToken(false) }}
                placeholder="Paste your COWORKER_API_TOKEN here"
                className="w-full h-10 px-3 pr-10 bg-card border border-border rounded-xl font-mono text-[13px] text-foreground outline-none focus:border-primary"
              />
              <button
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center text-muted hover:text-foreground transition-colors"
                style={{ width: 28, height: 28 }}
                title={showToken ? 'Hide token' : 'Show token'}
              >
                <span className="material-icon" style={{ fontSize: 16 }}>
                  {showToken ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
            <button
              onClick={handleSaveToken}
              disabled={savingToken}
              className="h-10 px-4 bg-primary text-primary-foreground border-none rounded-xl font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover disabled:opacity-40 disabled:cursor-default"
            >
              {savingToken ? 'Saving...' : savedToken ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* App Updates */}
      <div>
        <h3 className="font-secondary text-[15px] font-medium text-foreground mb-1">App Updates</h3>
        <p className="font-secondary text-[13px] text-muted mb-4">
          Check for new versions and install updates.
        </p>
        <div className="flex items-center gap-3">
          {updateStatus.status === 'idle' || updateStatus.status === 'not-available' || updateStatus.status === 'error' ? (
            <button
              onClick={handleCheckUpdates}
              className="h-10 px-4 bg-card border border-border rounded-xl font-secondary text-[13px] font-medium text-foreground cursor-pointer hover:border-foreground/20"
            >
              Check for updates
            </button>
          ) : updateStatus.status === 'checking' ? (
            <span className="font-secondary text-[13px] text-muted">Checking for updates...</span>
          ) : updateStatus.status === 'available' ? (
            <button
              onClick={handleDownload}
              className="h-10 px-4 bg-primary text-primary-foreground border-none rounded-xl font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover"
            >
              Download v{updateStatus.version}
            </button>
          ) : updateStatus.status === 'downloading' ? (
            <div className="flex items-center gap-3">
              <div className="w-32 h-2 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${updateStatus.percent ?? 0}%` }} />
              </div>
              <span className="font-secondary text-[12px] text-muted">{Math.round(updateStatus.percent ?? 0)}%</span>
            </div>
          ) : updateStatus.status === 'downloaded' ? (
            <button
              onClick={handleInstall}
              className="h-10 px-4 bg-primary text-primary-foreground border-none rounded-xl font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover"
            >
              Restart & install v{updateStatus.version}
            </button>
          ) : null}
        </div>
        {updateStatus.status === 'not-available' && (
          <p className="font-secondary text-[12px] text-muted mt-2 m-0">You're on the latest version.</p>
        )}
        {updateStatus.status === 'error' && (
          <p className="font-secondary text-[12px] text-red-500 mt-2 m-0">Update error: {updateStatus.message}</p>
        )}
        <p className="font-secondary text-[11px] text-muted-dim mt-3 m-0">
          Current version: {appVersion}
        </p>
      </div>
    </div>
  )
}

type SettingsPageProps = {
  themeMode: ThemeMode
  onThemeChange: (mode: ThemeMode) => void
}

export default memo(function SettingsPage({
  themeMode,
  onThemeChange,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState('AI')

  // Brain (AI) state from Zustand — individual selectors to avoid full-store re-renders
  const workingMemory = useAppStore((s) => s.workingMemory)
  const agentConfig = useAppStore((s) => s.agentConfig)
  const providers = useAppStore((s) => s.providers)
  const brainLoaded = useAppStore((s) => s.brainLoaded)
  const loadBrain = useAppStore((s) => s.loadBrain)
  const updateBrainField = useAppStore((s) => s.updateBrainField)
  const updateModel = useAppStore((s) => s.updateModel)
  const observationalMemory = useAppStore((s) => s.observationalMemory)
  const loadObservationalMemory = useAppStore((s) => s.loadObservationalMemory)

  useSliceData(loadBrain)

  return (
    <PageShell>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 h-[56px] border-b border-border">
          <FilterTabs tabs={settingsTabs} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-8">
          {activeTab === 'AI' && (
            <BrainDesigner
              workingMemory={workingMemory}
              agentConfig={agentConfig}
              providers={providers}
              loaded={brainLoaded}
              onUpdateField={updateBrainField}
              onUpdateModel={updateModel}
              observationalMemory={observationalMemory}
              onLoadObservationalMemory={loadObservationalMemory}
            />
          )}

          {activeTab === 'UX' && (
            <div className="max-w-[480px] mx-auto">
              {/* Theme selector */}
              <div className="mb-8">
                <h3 className="font-secondary text-[15px] font-medium text-foreground mb-1">Appearance</h3>
                <p className="font-secondary text-[13px] text-muted mb-4">
                  Choose your preferred color theme.
                </p>
                <div className="flex gap-2">
                  {themeModes.map((tm) => (
                    <button
                      key={tm.value}
                      onClick={() => onThemeChange(tm.value)}
                      className={`flex items-center gap-2 rounded-xl font-secondary text-[13px] font-medium transition-colors ${
                        themeMode === tm.value
                          ? 'bg-card border border-border text-foreground'
                          : 'text-muted-dim hover:text-foreground hover:bg-card'
                      }`}
                      style={{ padding: '8px 16px' }}
                    >
                      <span className="material-icon" style={{ fontSize: 16 }}>{tm.icon}</span>
                      {tm.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Channels' && <ChannelsContent />}

          {activeTab === 'Developer' && <DeveloperContent />}

          {activeTab === 'Integrations' && (
            <div className="max-w-[640px] mx-auto flex flex-col" style={{ gap: 32 }}>
              <GitHubSection />
            </div>
          )}

          {activeTab === 'Advanced' && <AdvancedContent />}

          {activeTab !== 'AI' && activeTab !== 'UX' && activeTab !== 'Channels' && activeTab !== 'Developer' && activeTab !== 'Integrations' && activeTab !== 'Advanced' && (
            <div className="flex flex-col items-center justify-center text-center flex-1 min-h-[300px]">
              <span className="material-icon text-muted-dim mb-4" style={{ fontSize: 48 }}>settings</span>
              <h2 className="font-primary text-lg font-semibold text-foreground mb-2">{activeTab}</h2>
              <p className="font-secondary text-sm text-muted max-w-[360px]">
                {activeTab} settings will be available soon.
              </p>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
})
