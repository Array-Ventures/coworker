import { useState, useEffect, useCallback, memo } from 'react'
import PageShell from '../components/PageShell'
import { AppRenderer } from '@mcp-ui/client'
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  deleteWorkspaceFile,
} from '../mastra-client'
import { useAppStore } from '../stores/useAppStore'

type AppEntry = {
  name: string
}

export default memo(function AppsPage() {
  const [apps, setApps] = useState<AppEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [previewApp, setPreviewApp] = useState<{ name: string; html: string } | null>(null)
  const navigate = useAppStore((s) => s.navigate)

  const loadApps = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await listWorkspaceFiles('/workspace/apps')
      const dirs = (result.entries ?? []).filter(
        (e: { name: string; type: string }) => e.type === 'directory',
      )
      setApps(dirs.map((d: { name: string }) => ({ name: d.name })))
    } catch {
      // Directory may not exist yet
      setApps([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadApps()
  }, [loadApps])

  const handleOpen = useCallback(async (name: string) => {
    try {
      const result = await readWorkspaceFile(`/workspace/apps/${name}/index.html`, 'utf-8')
      const html = typeof result === 'string' ? result : (result as any).content ?? ''
      setPreviewApp({ name, html })
    } catch {
      setError(`Failed to load ${name}`)
    }
  }, [])

  const handleDelete = useCallback(async (name: string) => {
    try {
      await deleteWorkspaceFile(`/workspace/apps/${name}`)
      loadApps()
    } catch {
      setError(`Failed to delete ${name}`)
    }
  }, [loadApps])

  const handleSuggest = useCallback(() => {
    useAppStore.setState({
      input: 'Build me an app',
      currentPage: 'home',
    })
  }, [])

  // Preview modal
  if (previewApp) {
    return (
      <PageShell>
        <div className="flex flex-col h-full">
          {/* Modal overlay */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          >
            <div className="flex flex-col bg-card border border-border rounded-2xl overflow-hidden"
              style={{ width: 1000, height: 700, maxWidth: '90vw', maxHeight: '85vh' }}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between h-14 px-5 border-b border-border shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="flex items-center justify-center w-8 h-8 bg-secondary rounded-lg">
                    <span className="material-icon text-muted" style={{ fontSize: 18 }}>web</span>
                  </div>
                  <span className="font-secondary text-[15px] font-semibold text-foreground">
                    {previewApp.name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const blob = new Blob([previewApp.html], { type: 'text/html' })
                      window.open(URL.createObjectURL(blob), '_blank')
                    }}
                    className="flex items-center gap-1.5 border border-border rounded-lg px-3 py-1.5 font-secondary text-[13px] text-muted hover:text-foreground hover:bg-secondary transition-colors"
                  >
                    <span className="material-icon" style={{ fontSize: 14 }}>open_in_new</span>
                    Open in Browser
                  </button>
                  <button
                    onClick={() => setPreviewApp(null)}
                    className="flex items-center justify-center w-8 h-8 rounded-lg text-muted hover:text-foreground hover:bg-secondary transition-colors"
                  >
                    <span className="material-icon" style={{ fontSize: 18 }}>close</span>
                  </button>
                </div>
              </div>
              {/* iframe area */}
              <div className="flex-1 bg-background overflow-hidden">
                <AppRenderer
                  toolName="view_app"
                  sandbox={{ url: new URL('/sandbox_proxy.html', window.location.origin) }}
                  html={previewApp.html}
                  toolInput={{ name: previewApp.name }}
                  onOpenLink={async ({ url }) => { window.open(url, '_blank'); return {} }}
                  onError={(err) => console.error('AppRenderer error:', err)}
                />
              </div>
            </div>
          </div>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 h-14 px-6">
          <span className="material-icon text-foreground" style={{ fontSize: 22 }}>apps</span>
          <span className="font-secondary text-[16px] font-semibold text-foreground">Your Apps</span>
          {apps.length > 0 && (
            <span className="bg-secondary rounded-lg px-2 py-0.5 font-secondary text-[12px] font-medium text-muted">
              {apps.length}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <span className="material-icon text-muted-dim animate-spin" style={{ fontSize: 24 }}>
                progress_activity
              </span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <span className="material-icon text-muted-dim mb-2" style={{ fontSize: 32 }}>cloud_off</span>
              <p className="font-secondary text-[13px] text-muted-dim">{error}</p>
              <button
                onClick={() => { setError(''); loadApps() }}
                className="mt-3 font-secondary text-[13px] text-primary hover:underline"
              >
                Retry
              </button>
            </div>
          ) : apps.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="flex items-center justify-center w-16 h-16 bg-secondary rounded-2xl mb-4">
                <span className="material-icon text-muted" style={{ fontSize: 32 }}>apps</span>
              </div>
              <h2 className="font-secondary text-[20px] font-semibold text-foreground mb-4">
                No Apps Yet
              </h2>
              <p className="font-secondary text-[14px] text-muted mb-6">
                Ask the agent to build you an app — it'll appear here
              </p>
              <button
                onClick={handleSuggest}
                className="flex items-center gap-2 border border-border rounded-[10px] px-5 py-2.5 font-secondary text-[14px] font-medium text-foreground hover:bg-secondary transition-colors"
              >
                <span className="material-icon" style={{ fontSize: 16 }}>chat_bubble</span>
                Build me an app
              </button>
            </div>
          ) : (
            /* Apps grid */
            <div className="flex flex-wrap gap-4 pt-4">
              {apps.map((app) => (
                <div
                  key={app.name}
                  className="flex flex-col gap-3 bg-card border border-border rounded-[14px] p-4"
                  style={{ width: 280 }}
                >
                  {/* Preview area */}
                  <div className="flex items-center justify-center bg-secondary rounded-[10px]" style={{ height: 140 }}>
                    <span className="material-icon text-muted" style={{ fontSize: 32 }}>web</span>
                  </div>
                  {/* Info */}
                  <div className="flex flex-col gap-1">
                    <span className="font-secondary text-[14px] font-semibold text-foreground">
                      {app.name}
                    </span>
                  </div>
                  {/* Actions */}
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => handleOpen(app.name)}
                      className="flex items-center gap-1.5 bg-primary rounded-lg px-3.5 py-1.5 font-secondary text-[13px] font-semibold text-primary-foreground hover:bg-primary-hover transition-colors"
                    >
                      <span className="material-icon" style={{ fontSize: 14 }}>open_in_new</span>
                      Open
                    </button>
                    <button
                      onClick={() => handleDelete(app.name)}
                      className="text-muted hover:text-red-400 transition-colors"
                    >
                      <span className="material-icon" style={{ fontSize: 18 }}>delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
})
