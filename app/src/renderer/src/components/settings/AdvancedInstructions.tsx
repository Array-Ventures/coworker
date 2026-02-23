import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../../stores/useAppStore'

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

  if (!agentConfig) return null

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
