import { memo } from 'react'
import type { SuperpowerDef, SuperpowerState } from '../../data/superpowers'

const SuperpowerCard = memo(function SuperpowerCard({
  def,
  state,
  onSetup,
}: {
  def: SuperpowerDef
  state: SuperpowerState
  onSetup: () => void
}) {
  const allComponents = [
    ...(def.components.skills ?? []).map((s) => ({
      label: `${s.name} skill`,
      done: state.components.skills[s.name] ?? false,
    })),
    ...(def.components.runtimes ?? []).map((r) => ({
      label: r.label,
      done: state.components.runtimes[r.label] ?? false,
    })),
    ...Object.entries(def.components.envVars ?? {}).length > 0
      ? [{
          label: `${Object.keys(def.components.envVars!).length} environment variable${Object.keys(def.components.envVars!).length > 1 ? 's' : ''}`,
          done: Object.values(state.components.envVars).length > 0 && Object.values(state.components.envVars).every(Boolean),
        }]
      : [],
    ...(def.components.mcpServers ?? []).map((m) => ({
      label: `${m.name} MCP server`,
      done: state.components.mcpServers[m.name] ?? false,
    })),
  ]

  return (
    <div className="flex flex-col gap-4 border border-border rounded-2xl p-5 bg-card">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-primary shrink-0">
          <span className="material-icon text-primary-foreground" style={{ fontSize: 24 }}>
            {def.icon}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-secondary text-[16px] font-semibold text-foreground">
            {def.name}
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="font-secondary text-[13px] text-muted leading-[1.5]">
        {def.description}
      </p>

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Checklist */}
      <div className="flex flex-col gap-2">
        {allComponents.map((c) => (
          <div key={c.label} className="flex items-center gap-2">
            <span
              className="material-icon shrink-0"
              style={{ fontSize: 18, color: c.done ? 'var(--color-success-foreground)' : 'var(--muted-dim)' }}
            >
              {c.done ? 'check_circle' : 'radio_button_unchecked'}
            </span>
            <span
              className={`font-secondary text-[13px] ${c.done ? 'text-foreground' : 'text-muted'}`}
            >
              {c.label}
            </span>
          </div>
        ))}
      </div>

      {/* Action button */}
      {state.installed ? (
        <div className="flex items-center justify-center gap-1.5 w-full h-10 rounded-[10px] bg-color-success border border-color-success-foreground/25">
          <span className="material-icon text-color-success-foreground" style={{ fontSize: 18 }}>
            check_circle
          </span>
          <span className="font-secondary text-[14px] font-semibold text-color-success-foreground">
            Installed
          </span>
        </div>
      ) : state.installing ? (
        <div className="flex items-center justify-center gap-2 w-full h-10 rounded-[10px] bg-primary/10 border border-primary/25">
          <span className="material-icon text-primary animate-spin" style={{ fontSize: 18 }}>
            progress_activity
          </span>
          <span className="font-secondary text-[13px] font-medium text-primary truncate">
            {state.installStep || 'Installing...'}
          </span>
        </div>
      ) : (
        <button
          onClick={onSetup}
          className="flex items-center justify-center gap-1.5 w-full h-10 rounded-[10px] bg-primary hover:bg-primary-hover transition-colors cursor-pointer"
        >
          <span className="material-icon text-primary-foreground" style={{ fontSize: 18 }}>
            download
          </span>
          <span className="font-secondary text-[14px] font-semibold text-primary-foreground">
            Setup
          </span>
        </button>
      )}

      {/* Error */}
      {state.error && (
        <p className="font-secondary text-[12px] text-destructive">{state.error}</p>
      )}
    </div>
  )
})

export default SuperpowerCard
