import { memo, useRef, useCallback, useState } from 'react'
import { convertFilesToStagedFiles } from '../types/harness'
import { useAppStore } from '../stores/useAppStore'
import StagedFiles from './StagedFiles'
import ModeSwitcher from './ModeSwitcher'

const MODE_STYLES: Record<string, { bg: string; label: string }> = {
  build: { bg: 'bg-primary text-primary-foreground', label: 'Build' },
  plan: { bg: 'bg-blue-500 text-white', label: 'Plan' },
  fast: { bg: 'bg-green-500 text-white', label: 'Fast' },
}

type ChatInputProps = {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  disabled?: boolean
  isLoading?: boolean
  variant?: 'home' | 'reply'
  placeholder?: string
  currentModeId?: string
  onModeSwitch?: (modeId: string) => void
}

export default memo(function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  disabled = false,
  isLoading = false,
  variant = 'reply',
  placeholder,
  currentModeId,
  onModeSwitch,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [showModeSwitcher, setShowModeSwitcher] = useState(false)

  const stagedFiles = useAppStore((s) => s.stagedFiles)
  const addFiles = useAppStore((s) => s.addFiles)
  const removeFile = useAppStore((s) => s.removeFile)

  const canSend = !disabled && (value.trim() || stagedFiles.length > 0)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (canSend) onSend()
      }
    },
    [canSend, onSend]
  )

  const handleFilesSelected = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      const parts = await convertFilesToStagedFiles(files)
      addFiles(parts)
    },
    [addFiles]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      handleFilesSelected(e.dataTransfer.files)
    },
    [handleFilesSelected]
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = e.clipboardData.files
      if (files.length > 0) {
        e.preventDefault()
        handleFilesSelected(files)
      }
    },
    [handleFilesSelected]
  )

  const defaultPlaceholder =
    variant === 'home' ? 'What can I do for you?' : 'Reply...'

  const modeStyle = MODE_STYLES[currentModeId || 'build'] || MODE_STYLES.build

  return (
    <div
      className={`flex flex-col gap-3 border rounded-[16px] bg-card p-4 transition-colors ${
        isDragOver ? 'border-primary' : 'border-border'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder || defaultPlaceholder}
        disabled={disabled}
        rows={variant === 'home' ? 3 : 1}
        className={`w-full bg-transparent text-foreground font-secondary text-[16px] outline-none placeholder:text-muted-dim resize-none ${
          variant === 'home' ? 'min-h-[72px]' : 'min-h-[24px]'
        }`}
      />

      {/* Staged files row */}
      <StagedFiles files={stagedFiles} onRemove={removeFile} />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFilesSelected(e.target.files)
          e.target.value = ''
        }}
      />

      {/* Bottom row — h-9 (36px), space-between */}
      <div className="flex items-center justify-between h-9">
        {/* Left: mode pill + separator + model label */}
        <div className="flex items-center gap-2 relative">
          {currentModeId && onModeSwitch ? (
            <>
              <button
                onClick={() => setShowModeSwitcher(v => !v)}
                className={`inline-flex items-center gap-1 rounded-lg font-secondary text-[12px] font-semibold transition-colors ${modeStyle.bg}`}
                style={{ padding: '4px 8px' }}
              >
                {modeStyle.label}
                <span className="material-icon" style={{ fontSize: 14 }}>keyboard_arrow_down</span>
              </button>
              <span className="text-muted-dim text-[12px]">·</span>
              {showModeSwitcher && (
                <ModeSwitcher
                  currentModeId={currentModeId}
                  onSelect={onModeSwitch}
                  onClose={() => setShowModeSwitcher(false)}
                />
              )}
            </>
          ) : (
            <span
              className="material-icon text-muted-dim"
              style={{ fontSize: 20 }}
            >
              smart_toy
            </span>
          )}
          <span className="inline-flex items-center gap-1 border border-border rounded-lg text-muted-dim font-primary text-xs font-medium"
            style={{ padding: '4px 10px' }}
          >
            Coworker v1
          </span>
        </div>

        {/* Right: attach btn + send btn */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-muted-dim hover:text-muted hover:bg-sidebar-accent transition-colors"
          >
            <span className="material-icon" style={{ fontSize: 20 }}>add</span>
          </button>
          {isLoading ? (
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 bg-destructive text-white rounded-xl font-secondary text-[13px] font-semibold hover:opacity-90 transition-colors"
              style={{ padding: '8px 16px' }}
            >
              <span className="material-icon" style={{ fontSize: 16 }}>stop</span>
              Stop
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!canSend}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-xl font-secondary text-[13px] font-semibold hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ padding: '8px 16px' }}
            >
              <span className="material-icon" style={{ fontSize: 16 }}>arrow_upward</span>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
