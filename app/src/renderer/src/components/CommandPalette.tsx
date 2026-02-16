import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { useAppStore } from '../stores/useAppStore'

type Command = {
  id: string
  icon: string
  label: string
  shortcut?: string
  action: string
}

const commands: Command[] = [
  { id: 'new-chat', icon: 'chat_bubble', label: 'New Chat', shortcut: '⌘ N', action: 'new-chat' },
  { id: 'create-note', icon: 'description', label: 'Create note', shortcut: '⌘ ⇧ N', action: 'files' },
  { id: 'create-app', icon: 'apps', label: 'Create app', shortcut: '⌘ ⇧ S', action: 'apps' },
  { id: 'upload-file', icon: 'upload_file', label: 'Upload file', shortcut: '⌘ U', action: 'files' },
  { id: 'upload-folder', icon: 'create_new_folder', label: 'Upload folder', action: 'files' },
  { id: 'create-skill', icon: 'auto_fix_high', label: 'Create Agent Skill', action: 'skills' },
  { id: 'create-folder', icon: 'folder', label: 'Create folder', action: 'files' },
  { id: 'import-gdrive', icon: 'cloud_upload', label: 'Import from Google Drive', action: 'files' },
  { id: 'import-dropbox', icon: 'cloud_upload', label: 'Import from Dropbox', action: 'files' },
  { id: 'import-notion', icon: 'cloud_upload', label: 'Import from Notion', action: 'files' },
]

export default memo(function CommandPalette() {
  const navigate = useAppStore((s) => s.navigate)
  const startNewChat = useAppStore((s) => s.startNewChat)
  const setShowCommandPalette = useAppStore((s) => s.setShowCommandPalette)

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const close = useCallback(() => {
    setShowCommandPalette(false)
  }, [setShowCommandPalette])

  const executeCommand = useCallback(
    (cmd: Command) => {
      if (cmd.action === 'new-chat') {
        startNewChat()
      } else {
        navigate(cmd.action)
      }
      close()
    },
    [close, navigate, startNewChat]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => (i + 1) % filtered.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length)
      } else if (e.key === 'Enter' && filtered[selectedIndex]) {
        executeCommand(filtered[selectedIndex])
      }
    },
    [filtered, selectedIndex, close, executeCommand]
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[14vh] z-50" onClick={close}>
      <div
        className="bg-card border border-border rounded-2xl w-[600px] max-h-[480px] overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center h-[52px] px-5 border-b border-border">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-foreground font-secondary text-[15px] outline-none placeholder:text-muted-dim"
          />
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="text-muted text-sm text-center py-8 font-secondary">No commands found</div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => executeCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`flex items-center gap-3 w-full h-[44px] px-4 bg-transparent border-none cursor-pointer text-left font-secondary text-sm transition-colors ${
                  i === selectedIndex ? 'bg-sidebar-accent text-foreground' : 'text-foreground'
                }`}
              >
                <span className={`material-icon ${i === selectedIndex || i === 0 ? 'text-foreground' : 'text-muted-dim'}`} style={{ fontSize: 18 }}>
                  {cmd.icon}
                </span>
                <span className={`flex-1 text-[14px] ${i === 0 && selectedIndex === 0 ? 'font-medium' : 'font-normal'}`}>
                  {cmd.label}
                </span>
                {cmd.shortcut && (
                  <span className="text-muted-dim font-primary text-[12px]">{cmd.shortcut}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
})
