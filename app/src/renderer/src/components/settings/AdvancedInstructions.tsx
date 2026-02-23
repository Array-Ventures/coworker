import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../../stores/useAppStore'

const STARTER_TEMPLATE = `# AGENTS.md

## Role
You are a helpful AI assistant.

## Rules
- Be concise and direct
- Ask for clarification when needed
`

export default function AdvancedInstructions() {
  const agentConfig = useAppStore((s) => s.agentConfig)
  const updateInstructions = useAppStore((s) => s.updateInstructions)
  const [localInstructions, setLocalInstructions] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const initRef = useRef(false)

  useEffect(() => {
    if (agentConfig && !initRef.current) {
      setLocalInstructions(agentConfig.instructions)
      initRef.current = true
    }
  }, [agentConfig])

  const dirty = agentConfig ? localInstructions !== agentConfig.instructions : false
  const isEmpty = !agentConfig?.isCustomInstructions && !localInstructions.trim()

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateInstructions(localInstructions)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setSaving(true)
    try {
      await updateInstructions(null)
      setLocalInstructions(agentConfig?.defaultInstructions ?? '')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const handleCreate = () => {
    setLocalInstructions(STARTER_TEMPLATE)
    setSaved(false)
  }

  if (!agentConfig) return null

  // Empty state
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 min-h-[400px] gap-5">
        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
          <span className="material-icon text-muted" style={{ fontSize: 28 }}>description</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <h3 className="font-secondary text-[16px] font-semibold text-foreground">
            No agent instructions yet
          </h3>
          <p className="font-secondary text-[13px] text-muted text-center leading-relaxed max-w-[360px]">
            AGENTS.md defines how your agent behaves — its personality, rules, and capabilities. Create one to get started.
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="h-10 px-5 bg-primary text-primary-foreground border-none rounded-xl font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover flex items-center gap-1.5"
        >
          <span className="material-icon" style={{ fontSize: 16 }}>add</span>
          Create AGENTS.md
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-[640px] mx-auto flex flex-col gap-5">
      <div>
        <h3 className="font-secondary text-[18px] font-semibold text-foreground">Agent Instructions</h3>
        <p className="font-secondary text-[14px] text-muted mt-1">
          Custom system instructions that define your agent's behavior. Written in Markdown format (AGENTS.md).
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <textarea
          value={localInstructions}
          onChange={(e) => { setLocalInstructions(e.target.value); setSaved(false) }}
          rows={14}
          className="w-full px-4 py-3 bg-transparent font-mono text-[13px] text-foreground outline-none resize-y border-none"
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        {agentConfig.isCustomInstructions && (
          <button
            onClick={handleReset}
            disabled={saving}
            className="h-10 px-4 bg-transparent border border-border rounded-xl font-secondary text-[13px] font-medium text-muted cursor-pointer hover:border-foreground/20 disabled:opacity-40 disabled:cursor-default"
          >
            Reset to Default
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="h-10 px-4 bg-primary text-primary-foreground border-none rounded-xl font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover disabled:opacity-40 disabled:cursor-default"
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}
