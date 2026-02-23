import { useState, memo } from 'react'
import type { SuperpowerDef, SuperpowerState } from '../../data/superpowers'

interface ComponentItem {
  type: 'skill' | 'runtime' | 'env' | 'mcp'
  label: string
  description: string
  done: boolean
}

const SuperpowerSetupDialog = memo(function SuperpowerSetupDialog({
  def,
  state,
  onInstall,
  onCancel,
}: {
  def: SuperpowerDef
  state: SuperpowerState
  onInstall: (envOverrides: Record<string, string>) => void
  onCancel: () => void
}) {
  const envVarDefs = def.components.envVars ?? {}
  const [envValues, setEnvValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(envVarDefs).map(([k, v]) => [k, v.value])),
  )

  const items: ComponentItem[] = [
    ...(def.components.skills ?? []).map((s) => ({
      type: 'skill' as const,
      label: `${s.name} skill`,
      description: state.components.skills[s.name]
        ? 'Already installed from marketplace'
        : `Will be installed from ${s.source}`,
      done: state.components.skills[s.name] ?? false,
    })),
    ...(def.components.runtimes ?? []).map((r) => ({
      type: 'runtime' as const,
      label: r.label,
      description: state.components.runtimes[r.label]
        ? 'Already installed'
        : 'Will be installed via npm',
      done: state.components.runtimes[r.label] ?? false,
    })),
    ...Object.keys(envVarDefs).length > 0
      ? [{
          type: 'env' as const,
          label: `${Object.keys(envVarDefs).length} environment variable${Object.keys(envVarDefs).length > 1 ? 's' : ''}`,
          description: Object.values(state.components.envVars).every(Boolean)
            ? 'Already configured'
            : 'Will be configured below',
          done: Object.values(state.components.envVars).length > 0 && Object.values(state.components.envVars).every(Boolean),
        }]
      : [],
    ...(def.components.mcpServers ?? []).map((m) => ({
      type: 'mcp' as const,
      label: `${m.name} MCP server`,
      description: state.components.mcpServers[m.name]
        ? 'Already configured'
        : 'Will be added to MCP config',
      done: state.components.mcpServers[m.name] ?? false,
    })),
  ]

  const allDone = items.every((i) => i.done)
  const installing = state.installing

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-[480px] max-h-[90vh] overflow-y-auto"
        style={{ padding: 24 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-[10px] bg-primary shrink-0">
              <span className="material-icon text-primary-foreground" style={{ fontSize: 22 }}>
                {def.icon}
              </span>
            </div>
            <h3 className="font-secondary text-[18px] font-bold text-foreground">
              Setup {def.name}
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-border hover:bg-sidebar-accent transition-colors"
          >
            <span className="material-icon text-muted" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>

        <p className="font-secondary text-[13px] text-muted leading-[1.5] mb-5">
          This will install all required components for {def.name.toLowerCase()}.
          Review the components below and configure environment variables.
        </p>

        {/* Components */}
        <div className="mb-5">
          <div className="font-secondary text-[11px] font-bold text-muted tracking-wider mb-3">
            COMPONENTS
          </div>
          <div className="border border-border rounded-xl overflow-hidden">
            {items.map((item, i) => (
              <div
                key={item.label}
                className={`flex items-center gap-2.5 px-3.5 py-3 ${
                  i < items.length - 1 ? 'border-b border-border' : ''
                }`}
              >
                <span
                  className="material-icon shrink-0"
                  style={{
                    fontSize: 18,
                    color: item.done
                      ? 'var(--color-success-foreground)'
                      : 'var(--muted-dim)',
                  }}
                >
                  {item.done ? 'check_circle' : 'radio_button_unchecked'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-secondary text-[13px] font-medium text-foreground">
                    {item.label}
                  </div>
                  <div
                    className={`font-secondary text-[11px] ${
                      item.done ? 'text-color-success-foreground' : 'text-muted'
                    }`}
                  >
                    {item.description}
                  </div>
                </div>
                <span
                  className={`shrink-0 font-secondary text-[11px] font-semibold rounded-md ${
                    item.done
                      ? 'bg-color-success text-color-success-foreground'
                      : 'bg-color-warning text-color-warning-foreground'
                  }`}
                  style={{ padding: '3px 8px' }}
                >
                  {item.done ? 'Installed' : 'Pending'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Environment Variables */}
        {Object.keys(envVarDefs).length > 0 && (
          <div className="mb-5">
            <div className="font-secondary text-[11px] font-bold text-muted tracking-wider mb-3">
              ENVIRONMENT VARIABLES
            </div>
            <div className="flex flex-col gap-4">
              {Object.entries(envVarDefs).map(([key, envDef]) => (
                <div key={key} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="font-primary text-[12px] font-medium text-foreground">
                      {key}
                    </label>
                    {!envDef.required && (
                      <span className="font-secondary text-[11px] text-muted-dim">optional</span>
                    )}
                  </div>
                  <input
                    value={envValues[key] ?? ''}
                    onChange={(e) =>
                      setEnvValues((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="w-full h-[38px] px-3 bg-transparent border border-border rounded-lg font-primary text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
                  />
                  <span className="font-secondary text-[11px] text-muted-dim">
                    {envDef.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Install progress */}
        {installing && state.installStep && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-sidebar">
            <span className="material-icon text-primary animate-spin" style={{ fontSize: 16 }}>
              progress_activity
            </span>
            <span className="font-secondary text-[12px] text-foreground">
              {state.installStep}
            </span>
          </div>
        )}

        {/* Error */}
        {state.error && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-color-error">
            <span className="material-icon text-color-error-foreground" style={{ fontSize: 16 }}>
              error
            </span>
            <span className="font-secondary text-[12px] text-color-error-foreground">
              {state.error}
            </span>
          </div>
        )}

        {/* Divider */}
        <div className="h-px bg-border mb-4" />

        {/* Actions */}
        <div className="flex items-center justify-end gap-2.5">
          <button
            onClick={onCancel}
            disabled={installing}
            className="font-secondary text-[13px] font-medium text-muted hover:text-foreground transition-colors disabled:opacity-50"
            style={{ height: 36, padding: '0 14px' }}
          >
            Cancel
          </button>
          {allDone ? (
            <span
              className="inline-flex items-center gap-1.5 font-secondary text-[14px] font-semibold text-color-success-foreground rounded-[10px] bg-color-success"
              style={{ height: 40, padding: '0 20px' }}
            >
              <span className="material-icon" style={{ fontSize: 18 }}>check_circle</span>
              All Installed
            </span>
          ) : (
            <button
              onClick={() => onInstall(envValues)}
              disabled={installing}
              className="inline-flex items-center gap-1.5 font-secondary text-[14px] font-semibold bg-primary text-primary-foreground rounded-[10px] hover:bg-primary-hover disabled:opacity-50 transition-colors cursor-pointer"
              style={{ height: 40, padding: '0 20px' }}
            >
              {installing ? (
                <>
                  <span className="material-icon animate-spin" style={{ fontSize: 18 }}>
                    progress_activity
                  </span>
                  Installing...
                </>
              ) : (
                <>
                  <span className="material-icon" style={{ fontSize: 18 }}>download</span>
                  Install All
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
})

export default SuperpowerSetupDialog
