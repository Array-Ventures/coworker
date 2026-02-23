import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../../stores/useAppStore'

function maskValue(value: string): string {
  if (value.length <= 8) return '••••••••'
  const prefix = value.slice(0, 4)
  const suffix = value.slice(-4)
  return `${prefix}${'••••••••••••'}${suffix}`
}

export default function AdvancedEnvVars() {
  const sandboxEnv = useAppStore((s) => s.agentConfig?.sandboxEnv ?? {})
  const updateSandboxEnv = useAppStore((s) => s.updateSandboxEnv)

  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')
  const [editValue, setEditValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding && nameInputRef.current) nameInputRef.current.focus()
  }, [adding])

  useEffect(() => {
    if (editingKey && editInputRef.current) editInputRef.current.focus()
  }, [editingKey])

  const toggleVisibility = (key: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleAdd = async () => {
    const name = newName.trim()
    const value = newValue.trim()
    if (!name || !value) return
    await updateSandboxEnv({ ...sandboxEnv, [name]: value })
    setNewName('')
    setNewValue('')
    setAdding(false)
  }

  const handleDelete = async (key: string) => {
    const next = { ...sandboxEnv }
    delete next[key]
    await updateSandboxEnv(next)
  }

  const handleEditStart = (key: string) => {
    setEditingKey(key)
    setEditValue(sandboxEnv[key] ?? '')
  }

  const handleEditSave = async () => {
    if (!editingKey) return
    await updateSandboxEnv({ ...sandboxEnv, [editingKey]: editValue })
    setEditingKey(null)
    setEditValue('')
  }

  const entries = Object.entries(sandboxEnv)

  return (
    <div className="max-w-[640px] mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-secondary text-[18px] font-semibold text-foreground">Environment Variables</h3>
          <p className="font-secondary text-[14px] text-muted mt-1" style={{ maxWidth: 480 }}>
            Set environment variables available to the agent's sandbox. Used by skills and tools that need API keys.
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 h-9 px-3.5 bg-primary text-primary-foreground border-none rounded-xl font-secondary text-[13px] font-medium cursor-pointer hover:bg-primary-hover shrink-0"
        >
          <span className="material-icon" style={{ fontSize: 16 }}>add</span>
          Add Variable
        </button>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-sidebar border-b border-border">
          <span className="flex-1 font-secondary text-[11px] font-semibold text-muted uppercase tracking-wider">Name</span>
          <span className="flex-1 font-secondary text-[11px] font-semibold text-muted uppercase tracking-wider">Value</span>
          <span className="w-[60px] font-secondary text-[11px] font-semibold text-muted uppercase tracking-wider text-right">Actions</span>
        </div>

        {/* Rows */}
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-center gap-3 px-4 py-3.5 border-b border-border last:border-b-0">
            <span className="flex-1 font-mono text-[13px] font-medium text-foreground truncate">{key}</span>
            <div className="flex-1 flex items-center gap-2">
              {editingKey === key ? (
                <input
                  ref={editInputRef}
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleEditSave(); if (e.key === 'Escape') setEditingKey(null) }}
                  onBlur={handleEditSave}
                  className="flex-1 h-8 px-2 bg-background border border-border rounded-lg font-mono text-[13px] text-foreground outline-none focus:border-primary"
                />
              ) : (
                <>
                  <span className="font-mono text-[13px] text-muted truncate">
                    {visibleKeys.has(key) ? value : maskValue(value)}
                  </span>
                  <button
                    onClick={() => toggleVisibility(key)}
                    className="flex items-center justify-center text-muted hover:text-foreground transition-colors shrink-0"
                    title={visibleKeys.has(key) ? 'Hide value' : 'Show value'}
                  >
                    <span className="material-icon" style={{ fontSize: 16 }}>
                      {visibleKeys.has(key) ? 'visibility' : 'visibility_off'}
                    </span>
                  </button>
                </>
              )}
            </div>
            <div className="w-[60px] flex items-center justify-end gap-2">
              <button
                onClick={() => handleEditStart(key)}
                className="flex items-center justify-center text-muted hover:text-foreground transition-colors"
                title="Edit"
              >
                <span className="material-icon" style={{ fontSize: 16 }}>edit</span>
              </button>
              <button
                onClick={() => handleDelete(key)}
                className="flex items-center justify-center text-muted hover:text-red-500 transition-colors"
                title="Delete"
              >
                <span className="material-icon" style={{ fontSize: 16 }}>delete</span>
              </button>
            </div>
          </div>
        ))}

        {/* Add row */}
        {adding && (
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/50">
            <input
              ref={nameInputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
              placeholder="VARIABLE_NAME"
              className="flex-1 h-8 px-2 bg-background border border-border rounded-lg font-mono text-[13px] text-foreground outline-none focus:border-primary"
            />
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="value"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
              className="flex-1 h-8 px-2 bg-background border border-border rounded-lg font-mono text-[13px] text-foreground outline-none focus:border-primary"
            />
            <div className="w-[60px] flex items-center justify-end gap-2">
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || !newValue.trim()}
                className="flex items-center justify-center text-primary hover:text-primary-hover transition-colors disabled:opacity-40"
                title="Save"
              >
                <span className="material-icon" style={{ fontSize: 16 }}>check</span>
              </button>
              <button
                onClick={() => { setAdding(false); setNewName(''); setNewValue('') }}
                className="flex items-center justify-center text-muted hover:text-foreground transition-colors"
                title="Cancel"
              >
                <span className="material-icon" style={{ fontSize: 16 }}>close</span>
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {entries.length === 0 && !adding && (
          <div className="px-4 py-8 text-center">
            <p className="font-secondary text-[13px] text-muted">No environment variables configured.</p>
            <p className="font-secondary text-[12px] text-muted mt-1">Click "Add Variable" to get started.</p>
          </div>
        )}
      </div>

      {/* Hint */}
      <div className="flex items-start gap-2">
        <span className="material-icon text-muted shrink-0" style={{ fontSize: 14, marginTop: 1 }}>info</span>
        <p className="font-secondary text-[12px] text-muted m-0">
          Variables are injected into the agent's sandbox environment. Values are stored on disk and persist across restarts.
        </p>
      </div>
    </div>
  )
}
