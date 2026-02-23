import { useState, useEffect, useRef, useCallback, memo } from 'react'
import PageShell from '../components/PageShell'
import FileViewer from '../components/FileViewer'
import {
  listWorkspaceFiles,
  uploadWorkspaceFile,
  deleteWorkspaceFile,
  createWorkspaceDir,
} from '../mastra-client'

type FileEntry = {
  name: string
  type: 'file' | 'directory'
  size?: number
}

const MOUNTS = [
  { name: 'workspace', path: '/', icon: 'folder', color: '#FF8400', description: 'Agent working directory' },
  { name: 'skills', path: '/.agents/skills', icon: 'construction', color: '#9C27B0', description: 'Installed agent skills' },
] as const

function getFileIcon(name: string, type: 'file' | 'directory') {
  if (type === 'directory') return { icon: 'folder', color: '#FF8400' }
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'xlsx': case 'csv': case 'xls':
      return { icon: 'description', color: '#4CAF50' }
    case 'md': case 'txt': case 'doc': case 'docx': case 'pdf':
      return { icon: 'article', color: '#2196F3' }
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp':
      return { icon: 'image', color: '#9C27B0' }
    case 'json': case 'ts': case 'js': case 'tsx': case 'jsx': case 'py': case 'html': case 'css':
      return { icon: 'code', color: '#FF9800' }
    default:
      return { icon: 'insert_drive_file', color: '#999999' }
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip data URL prefix (e.g. "data:text/plain;base64,")
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default memo(function FilesPage() {
  // null = root view showing mounts, string = inside a mount path
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [sortAsc, setSortAsc] = useState(true)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [openFile, setOpenFile] = useState<{ path: string; name: string } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const isRoot = currentPath === null

  const loadFiles = useCallback(async (path: string) => {
    setLoading(true)
    setError('')
    setSelectedPaths(new Set())
    try {
      const result = await listWorkspaceFiles(path)
      setEntries(result.entries ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (currentPath !== null) loadFiles(currentPath)
  }, [currentPath, loadFiles])

  const filteredEntries = searchQuery
    ? entries.filter((e) => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : entries

  const sortedEntries = [...filteredEntries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    const cmp = a.name.localeCompare(b.name)
    return sortAsc ? cmp : -cmp
  })

  const navigateTo = useCallback((path: string | null) => {
    setCurrentPath(path)
    if (path === null) {
      setEntries([])
      setSelectedPaths(new Set())
      setCreatingFolder(false)
      setNewFolderName('')
    }
  }, [])

  const handleRowClick = useCallback((entry: FileEntry) => {
    if (entry.type === 'directory') {
      navigateTo(`${currentPath}/${entry.name}`)
    } else {
      setOpenFile({ path: `${currentPath}/${entry.name}`, name: entry.name })
    }
  }, [currentPath, navigateTo])

  const handleSelectToggle = useCallback((entry: FileEntry) => {
    const fullPath = `${currentPath}/${entry.name}`
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(fullPath)) next.delete(fullPath)
      else next.add(fullPath)
      return next
    })
  }, [currentPath])

  const handleCloseFile = useCallback(() => {
    setOpenFile(null)
  }, [])

  const [uploading, setUploading] = useState(false)

  const handleUpload = useCallback(async (files: FileList) => {
    if (!currentPath) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const base64 = await readFileAsBase64(file)
        await uploadWorkspaceFile(currentPath, file.name, base64, 'base64')
      }
      loadFiles(currentPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [currentPath, loadFiles])

  const handleDelete = useCallback(async () => {
    if (selectedPaths.size === 0 || !currentPath) return
    for (const path of selectedPaths) {
      await deleteWorkspaceFile(path)
    }
    loadFiles(currentPath)
  }, [selectedPaths, currentPath, loadFiles])

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim() || !currentPath) return
    await createWorkspaceDir(`${currentPath}/${newFolderName.trim()}`)
    setCreatingFolder(false)
    setNewFolderName('')
    loadFiles(currentPath)
  }, [currentPath, newFolderName, loadFiles])

  // Breadcrumb segments (only when inside a mount)
  const pathSegments = currentPath?.split('/').filter(Boolean) ?? []

  if (openFile) {
    return (
      <PageShell>
        <FileViewer
          filePath={openFile.path}
          filename={openFile.name}
          currentPath={currentPath!}
          onClose={handleCloseFile}
        />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="flex flex-col h-full">
        {/* File Toolbar */}
        <div className="flex items-center justify-between h-[52px] px-6 border-b border-border">
          <div className="flex items-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isRoot || uploading}
              className="flex items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2 font-secondary text-[13px] font-semibold text-primary-foreground disabled:opacity-40"
            >
              {uploading ? (
                <span className="material-icon animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
              ) : (
                <span className="material-icon" style={{ fontSize: 16 }}>upload</span>
              )}
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) handleUpload(e.target.files)
                e.target.value = ''
              }}
            />
            <span className="material-icon text-muted cursor-pointer" style={{ fontSize: 20 }}>help</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="material-icon text-muted cursor-pointer" style={{ fontSize: 20 }}>filter_list</span>
            {searchOpen ? (
              <div className="flex items-center gap-2">
                <input
                  ref={searchInputRef}
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery('') }
                  }}
                  placeholder="Search files..."
                  className="w-[160px] bg-secondary rounded-md px-2.5 py-1 text-foreground font-secondary text-[12px] outline-none placeholder:text-muted-dim"
                />
                <button onClick={() => { setSearchOpen(false); setSearchQuery('') }}>
                  <span className="material-icon text-muted cursor-pointer" style={{ fontSize: 18 }}>close</span>
                </button>
              </div>
            ) : (
              <button onClick={() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0) }}>
                <span className="material-icon text-muted cursor-pointer" style={{ fontSize: 20 }}>search</span>
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={selectedPaths.size === 0}
              className="disabled:opacity-30"
            >
              <span
                className={`material-icon cursor-pointer ${selectedPaths.size > 0 ? 'text-red-400' : 'text-muted'}`}
                style={{ fontSize: 20 }}
              >
                delete
              </span>
            </button>
            <button onClick={() => setCreatingFolder(true)} disabled={isRoot}>
              <span className={`material-icon cursor-pointer ${isRoot ? 'text-muted/30' : 'text-muted'}`} style={{ fontSize: 20 }}>add</span>
            </button>
          </div>
        </div>

        {/* Path Bar */}
        <div className="flex items-center gap-1.5 px-6 h-[36px] font-secondary text-[12px]">
          <button
            onClick={() => navigateTo(null)}
            className={`material-icon ${isRoot ? 'text-primary' : 'text-muted hover:text-foreground'}`}
            style={{ fontSize: 18 }}
          >
            home
          </button>
          {isRoot ? (
            <span className="text-foreground font-medium ml-1">All Files</span>
          ) : (
            pathSegments.map((seg, i) => {
              const path = '/' + pathSegments.slice(0, i + 1).join('/')
              const isLast = i === pathSegments.length - 1
              return (
                <span key={path} className="flex items-center gap-1.5">
                  <span className="material-icon text-muted-dim" style={{ fontSize: 14 }}>chevron_right</span>
                  <button
                    onClick={() => navigateTo(path)}
                    className={`hover:text-foreground ${isLast ? 'text-foreground font-medium' : 'text-muted'}`}
                  >
                    {seg}
                  </button>
                </span>
              )
            })
          )}
        </div>

        {/* File Header */}
        <div className="flex items-center h-[40px] px-6 border-b border-border">
          <button
            onClick={() => setSortAsc((v) => !v)}
            className="flex items-center gap-1 cursor-pointer"
          >
            <span className="font-secondary text-[12px] font-semibold text-muted">Name</span>
            <span className="material-icon text-muted" style={{ fontSize: 14 }}>{sortAsc ? 'arrow_upward' : 'arrow_downward'}</span>
          </button>
        </div>

        {/* New folder inline input */}
        {creatingFolder && !isRoot && (
          <div className="flex items-center gap-3 h-[48px] px-6 border-b border-border bg-card">
            <span className="material-icon" style={{ fontSize: 20, color: '#FF8400' }}>create_new_folder</span>
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder()
                if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('') }
              }}
              placeholder="Folder name..."
              className="flex-1 bg-transparent text-foreground font-secondary text-[14px] outline-none placeholder:text-muted-dim"
            />
            <button
              onClick={handleCreateFolder}
              className="font-secondary text-[12px] font-medium text-primary"
            >
              Create
            </button>
            <button
              onClick={() => { setCreatingFolder(false); setNewFolderName('') }}
              className="font-secondary text-[12px] text-muted"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isRoot ? (
            /* Root View — Mount folders */
            MOUNTS.map((mount) => (
              <button
                key={mount.name}
                onClick={() => navigateTo(mount.path)}
                className="flex items-center gap-3 w-full h-[56px] px-6 border-b border-border text-left hover:bg-card transition-colors"
              >
                <span className="material-icon" style={{ fontSize: 22, color: mount.color }}>{mount.icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-secondary text-[14px] text-foreground font-medium">{mount.name}</span>
                  <span className="font-secondary text-[12px] text-muted-dim ml-3">{mount.description}</span>
                </div>
                <span className="material-icon text-muted-dim" style={{ fontSize: 16 }}>chevron_right</span>
              </button>
            ))
          ) : loading ? (
            <div className="flex items-center justify-center py-16">
              <span className="material-icon text-muted-dim animate-spin" style={{ fontSize: 24 }}>progress_activity</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <span className="material-icon text-muted-dim mb-2" style={{ fontSize: 32 }}>cloud_off</span>
              <p className="font-secondary text-[13px] text-muted-dim">{error}</p>
            </div>
          ) : sortedEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <span className="material-icon text-muted-dim mb-2" style={{ fontSize: 32 }}>folder_open</span>
              <p className="font-secondary text-[13px] text-muted-dim">This folder is empty</p>
            </div>
          ) : (
            sortedEntries.map((entry) => {
              const { icon, color } = getFileIcon(entry.name, entry.type)
              const fullPath = `${currentPath}/${entry.name}`
              const isSelected = selectedPaths.has(fullPath)

              return (
                <button
                  key={entry.name}
                  onClick={() => handleRowClick(entry)}
                  className={`flex items-center gap-3 w-full h-[48px] px-6 border-b border-border text-left transition-colors ${
                    isSelected ? 'bg-primary/5' : 'hover:bg-card'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => { e.stopPropagation(); handleSelectToggle(entry) }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 accent-primary rounded"
                  />
                  <span className="material-icon" style={{ fontSize: 20, color }}>{icon}</span>
                  <span className="font-secondary text-[14px] text-foreground">{entry.name}</span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </PageShell>
  )
})
