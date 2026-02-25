import { useState, useEffect, useRef, useCallback } from 'react'
import {
  startBrowserLogin,
  getBrowserLoginFramesUrl,
  sendBrowserLoginInput,
  navigateBrowserLogin,
  saveBrowserLoginAndClose,
  getBrowserLoginStatus,
  authHeaders,
} from '../../mastra-client'

type Status = 'idle' | 'connecting' | 'streaming' | 'saving' | 'saved' | 'error'

const PRESETS = [
  { label: 'Google', url: 'https://accounts.google.com', icon: 'search' },
  { label: 'GitHub', url: 'https://github.com/login', icon: 'code' },
  { label: 'X / Twitter', url: 'https://x.com/i/flow/login', icon: 'alternate_email' },
  { label: 'LinkedIn', url: 'https://www.linkedin.com/login', icon: 'work' },
]

export default function AdvancedBrowser() {
  const [status, setStatus] = useState<Status>('idle')
  const [url, setUrl] = useState('https://')
  const [currentUrl, setCurrentUrl] = useState('')
  const [error, setError] = useState('')
  const [frame, setFrame] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<{ deviceWidth: number; deviceHeight: number } | null>(null)

  const imgRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Check for existing session on mount
  useEffect(() => {
    getBrowserLoginStatus().then((s) => {
      if (s.active) {
        setStatus('streaming')
        connectFrameStream()
      }
    }).catch(() => {})
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close()
    }
  }, [])

  const connectFrameStream = useCallback(() => {
    eventSourceRef.current?.close()

    const framesUrl = getBrowserLoginFramesUrl()
    const headers = authHeaders()
    // Use fetch-based SSE since EventSource doesn't support custom headers
    const abortController = new AbortController()

    fetch(framesUrl, {
      headers,
      signal: abortController.signal,
    }).then(async (response) => {
      const reader = response.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events from buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let eventType = ''
        let eventData = ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7)
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6)
          } else if (line === '') {
            // End of event
            if (eventType === 'frame' && eventData) {
              try {
                const parsed = JSON.parse(eventData)
                setFrame(parsed.data)
                if (parsed.metadata) setMetadata(parsed.metadata)
              } catch {}
            }
            eventType = ''
            eventData = ''
          }
        }
      }
    }).catch(() => {
      // Stream ended or errored
    })

    // Store abort controller for cleanup
    eventSourceRef.current = { close: () => abortController.abort() } as EventSource
  }, [])

  const handleStart = async (targetUrl: string) => {
    setStatus('connecting')
    setError('')
    try {
      const result = await startBrowserLogin(targetUrl)
      if (!result.ok) {
        setError(result.error || 'Failed to start browser')
        setStatus('error')
        return
      }
      setCurrentUrl(result.url || targetUrl)
      setStatus('streaming')
      connectFrameStream()
    } catch (err: any) {
      setError(err.message)
      setStatus('error')
    }
  }

  const handleNavigate = async () => {
    if (!url.trim() || status !== 'streaming') return
    try {
      const result = await navigateBrowserLogin(url.trim())
      if (result.ok && result.url) setCurrentUrl(result.url)
    } catch {}
  }

  const handleSaveClose = async () => {
    setStatus('saving')
    try {
      const result = await saveBrowserLoginAndClose()
      if (result.ok) {
        setStatus('saved')
        setFrame(null)
        setMetadata(null)
        eventSourceRef.current?.close()
        // Reset after showing success
        setTimeout(() => setStatus('idle'), 3000)
      } else {
        setError(result.error || 'Failed to save session')
        setStatus('error')
      }
    } catch (err: any) {
      setError(err.message)
      setStatus('error')
    }
  }

  // Map mouse events on the frame image to browser coordinates
  const handleMouseEvent = useCallback(async (
    e: React.MouseEvent<HTMLDivElement>,
    type: 'mousePressed' | 'mouseReleased' | 'mouseMoved',
  ) => {
    if (status !== 'streaming' || !metadata || !imgRef.current) return

    const rect = imgRef.current.getBoundingClientRect()
    const scaleX = metadata.deviceWidth / rect.width
    const scaleY = metadata.deviceHeight / rect.height
    const x = Math.round((e.clientX - rect.left) * scaleX)
    const y = Math.round((e.clientY - rect.top) * scaleY)

    await sendBrowserLoginInput({
      type: 'mouse',
      params: {
        type,
        x,
        y,
        button: 'left',
        clickCount: type === 'mousePressed' ? 1 : 0,
      },
    }).catch(() => {})
  }, [status, metadata])

  // Map keyboard events
  const handleKeyEvent = useCallback(async (
    e: React.KeyboardEvent<HTMLDivElement>,
    type: 'keyDown' | 'keyUp',
  ) => {
    if (status !== 'streaming') return
    e.preventDefault()

    let modifiers = 0
    if (e.altKey) modifiers |= 1
    if (e.ctrlKey) modifiers |= 2
    if (e.metaKey) modifiers |= 4
    if (e.shiftKey) modifiers |= 8

    await sendBrowserLoginInput({
      type: 'keyboard',
      params: {
        type,
        key: e.key,
        code: e.code,
        modifiers: modifiers || undefined,
      },
    }).catch(() => {})

    // Also send 'char' event for printable characters on keyDown
    if (type === 'keyDown' && e.key.length === 1) {
      await sendBrowserLoginInput({
        type: 'keyboard',
        params: { type: 'char', text: e.key },
      }).catch(() => {})
    }
  }, [status])

  const isActive = status === 'streaming' || status === 'saving'

  return (
    <div className="max-w-[800px] mx-auto flex flex-col gap-5">
      {/* Header */}
      <div>
        <h3 className="font-secondary text-[18px] font-semibold text-foreground">Browser Sessions</h3>
        <p className="font-secondary text-[14px] text-muted mt-1" style={{ maxWidth: 600 }}>
          Log into websites so your agent can access them. Sessions are saved automatically — log in once and the agent stays logged in across restarts.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-error-bg rounded-xl">
          <span className="material-icon text-error" style={{ fontSize: 16 }}>error</span>
          <span className="text-error text-[13px] font-secondary flex-1">{error}</span>
          <button onClick={() => { setError(''); setStatus('idle'); }} className="text-error hover:text-foreground transition-colors">
            <span className="material-icon" style={{ fontSize: 14 }}>close</span>
          </button>
        </div>
      )}

      {/* Saved success */}
      {status === 'saved' && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/10 rounded-xl">
          <span className="material-icon text-primary" style={{ fontSize: 16 }}>check_circle</span>
          <span className="text-primary text-[13px] font-secondary">Session saved. Your agent can now access these accounts.</span>
        </div>
      )}

      {/* URL bar + controls */}
      {!isActive && status !== 'saved' && (
        <div className="flex flex-col gap-3">
          {/* Presets */}
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.url}
                onClick={() => handleStart(p.url)}
                disabled={status === 'connecting'}
                className="flex items-center gap-1.5 h-9 px-3.5 bg-card border border-border rounded-xl font-secondary text-[13px] text-foreground hover:bg-sidebar transition-colors disabled:opacity-50"
              >
                <span className="material-icon text-muted" style={{ fontSize: 16 }}>{p.icon}</span>
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom URL */}
          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleStart(url) }}
              placeholder="https://example.com/login"
              className="flex-1 h-10 px-3 bg-card border border-border rounded-xl font-secondary text-[13px] text-foreground outline-none focus:border-primary"
            />
            <button
              onClick={() => handleStart(url)}
              disabled={!url.startsWith('http') || status === 'connecting'}
              className="flex items-center gap-1.5 h-10 px-4 bg-primary text-primary-foreground rounded-xl font-secondary text-[13px] font-semibold disabled:opacity-50 hover:bg-primary-hover transition-colors"
            >
              {status === 'connecting' ? (
                <>
                  <span className="material-icon animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
                  Launching...
                </>
              ) : (
                <>
                  <span className="material-icon" style={{ fontSize: 16 }}>launch</span>
                  Launch Browser
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Active session: browser frame + controls */}
      {isActive && (
        <div className="flex flex-col gap-3">
          {/* Navigation bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 h-9 px-3 bg-card border border-border rounded-xl">
              <span className="material-icon text-muted" style={{ fontSize: 14 }}>language</span>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleNavigate() }}
                className="flex-1 bg-transparent font-secondary text-[12px] text-foreground outline-none"
              />
              <button onClick={handleNavigate} className="text-muted hover:text-foreground transition-colors">
                <span className="material-icon" style={{ fontSize: 14 }}>arrow_forward</span>
              </button>
            </div>
            <button
              onClick={handleSaveClose}
              disabled={status === 'saving'}
              className="flex items-center gap-1.5 h-9 px-4 bg-primary text-primary-foreground rounded-xl font-secondary text-[13px] font-semibold disabled:opacity-50 hover:bg-primary-hover transition-colors"
            >
              {status === 'saving' ? (
                <>
                  <span className="material-icon animate-spin" style={{ fontSize: 14 }}>progress_activity</span>
                  Saving...
                </>
              ) : (
                <>
                  <span className="material-icon" style={{ fontSize: 14 }}>save</span>
                  Save & Close
                </>
              )}
            </button>
          </div>

          {/* Browser frame */}
          <div
            ref={imgRef}
            tabIndex={0}
            className="relative bg-black rounded-xl overflow-hidden border border-border cursor-crosshair outline-none focus:border-primary"
            style={{ aspectRatio: metadata ? `${metadata.deviceWidth}/${metadata.deviceHeight}` : '16/9' }}
            onMouseDown={(e) => handleMouseEvent(e, 'mousePressed')}
            onMouseUp={(e) => handleMouseEvent(e, 'mouseReleased')}
            onMouseMove={(e) => {
              // Throttle mousemove — only send every 50ms
              if ((e as any)._lastMove && Date.now() - (e as any)._lastMove < 50) return
              ;(e as any)._lastMove = Date.now()
              handleMouseEvent(e, 'mouseMoved')
            }}
            onKeyDown={(e) => handleKeyEvent(e, 'keyDown')}
            onKeyUp={(e) => handleKeyEvent(e, 'keyUp')}
          >
            {frame ? (
              <img
                src={`data:image/jpeg;base64,${frame}`}
                alt="Browser"
                className="w-full h-full object-contain pointer-events-none"
                draggable={false}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="font-secondary text-[13px] text-muted">Waiting for frames...</span>
              </div>
            )}
          </div>

          {/* Help text */}
          <div className="flex items-start gap-2">
            <span className="material-icon text-muted shrink-0" style={{ fontSize: 14, marginTop: 1 }}>info</span>
            <p className="font-secondary text-[12px] text-muted m-0">
              Click and type in the browser view to interact. Log into your accounts, then click "Save & Close" to persist the session.
            </p>
          </div>
        </div>
      )}

      {/* Info section */}
      {status === 'idle' && (
        <div className="flex items-start gap-2 mt-2">
          <span className="material-icon text-muted shrink-0" style={{ fontSize: 14, marginTop: 1 }}>info</span>
          <p className="font-secondary text-[12px] text-muted m-0">
            Sessions save cookies and localStorage. The agent automatically loads saved sessions when browsing. Requires Browser Automation superpower to be installed.
          </p>
        </div>
      )}
    </div>
  )
}
