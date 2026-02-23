import { useRef, useEffect, useCallback, memo } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { useBrowserStream, type MouseInput } from '../hooks/useBrowserStream'

export default memo(function BrowserPreview() {
  const connected = useAppStore((s) => s.browserPreviewConnected)
  const frame = useAppStore((s) => s.browserPreviewFrame)
  const meta = useAppStore((s) => s.browserPreviewMeta)
  const togglePreview = useAppStore((s) => s.toggleBrowserPreview)

  const { injectMouse, injectKeyboard } = useBrowserStream()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  // Draw frame to canvas
  useEffect(() => {
    if (!frame || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (!imgRef.current) imgRef.current = new Image()
    const img = imgRef.current
    img.onload = () => {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.drawImage(img, 0, 0)
    }
    img.src = `data:image/jpeg;base64,${frame}`
  }, [frame])

  // Translate DOM coords to viewport coords
  const toViewportCoords = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current
      if (!canvas || !meta) return null
      const rect = canvas.getBoundingClientRect()
      const scaleX = meta.deviceWidth / rect.width
      const scaleY = meta.deviceHeight / rect.height
      return {
        x: Math.round((clientX - rect.left) * scaleX),
        y: Math.round((clientY - rect.top) * scaleY),
      }
    },
    [meta],
  )

  const handleMouseEvent = useCallback(
    (e: React.MouseEvent, type: MouseInput['type']) => {
      const coords = toViewportCoords(e.clientX, e.clientY)
      if (!coords) return
      injectMouse({ type, ...coords, button: 'left' })
    },
    [toViewportCoords, injectMouse],
  )

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      const coords = toViewportCoords(e.clientX, e.clientY)
      if (!coords) return
      injectMouse({ type: 'mouseWheel', ...coords, deltaX: e.deltaX, deltaY: e.deltaY })
    },
    [toViewportCoords, injectMouse],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault()
      let modifiers = 0
      if (e.altKey) modifiers |= 1
      if (e.ctrlKey) modifiers |= 2
      if (e.metaKey) modifiers |= 4
      if (e.shiftKey) modifiers |= 8
      injectKeyboard({ type: 'keyDown', key: e.key, modifiers })
      if (e.key.length === 1) {
        injectKeyboard({ type: 'char', key: e.key, text: e.key })
      }
    },
    [injectKeyboard],
  )

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault()
      let modifiers = 0
      if (e.altKey) modifiers |= 1
      if (e.ctrlKey) modifiers |= 2
      if (e.metaKey) modifiers |= 4
      if (e.shiftKey) modifiers |= 8
      injectKeyboard({ type: 'keyUp', key: e.key, modifiers })
    },
    [injectKeyboard],
  )

  return (
    <div className="flex flex-col h-full border-l border-border bg-card" style={{ width: 520 }}>
      {/* Header */}
      <div className="flex items-center justify-between h-[44px] px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="material-icon text-primary" style={{ fontSize: 18 }}>language</span>
          <span className="font-secondary text-[13px] font-semibold text-foreground">
            Browser Preview
          </span>
          {connected && (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="font-secondary text-[10px] font-bold text-green-400">LIVE</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={togglePreview}
            className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <span className="material-icon" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>
      </div>

      {/* URL bar */}
      <div className="flex items-center gap-2 h-[36px] px-3 bg-background shrink-0">
        <span className="material-icon text-color-success-foreground" style={{ fontSize: 14 }}>lock</span>
        <span className="font-secondary text-[12px] text-muted-foreground truncate">
          {connected ? 'https://...' : 'Not connected'}
        </span>
      </div>

      {/* Viewport */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 bg-white overflow-hidden relative"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      >
        {connected && frame ? (
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain cursor-pointer"
            style={{ imageRendering: 'auto' }}
            onMouseDown={(e) => handleMouseEvent(e, 'mousePressed')}
            onMouseUp={(e) => handleMouseEvent(e, 'mouseReleased')}
            onMouseMove={(e) => handleMouseEvent(e, 'mouseMoved')}
            onWheel={handleWheel}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <span className="material-icon text-muted-dim" style={{ fontSize: 48 }}>language</span>
            <p className="font-secondary text-[13px] text-muted-dim text-center">
              {connected ? 'Waiting for frames...' : 'No browser session active'}
            </p>
            <p className="font-secondary text-[11px] text-muted-dim text-center max-w-[280px]">
              The preview will appear when the agent starts browsing
            </p>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between h-[28px] px-3 bg-background border-t border-border shrink-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-muted-dim'}`}
          />
          <span className="font-secondary text-[10px] text-muted-foreground">
            {connected ? `Connected to ws://localhost:${useAppStore.getState().browserPreviewPort}` : 'Disconnected'}
          </span>
        </div>
        {meta && (
          <div className="flex items-center gap-2">
            <span className="font-secondary text-[10px] text-muted-dim">
              {meta.deviceWidth} &times; {meta.deviceHeight}
            </span>
            <span className="material-icon text-muted-dim" style={{ fontSize: 14 }}>mouse</span>
            <span className="font-secondary text-[10px] text-muted-dim">Interactive</span>
          </div>
        )}
      </div>
    </div>
  )
})
