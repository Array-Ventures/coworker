import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../stores/useAppStore'

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 8000

export interface MouseInput {
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel'
  x: number
  y: number
  button?: 'left' | 'right' | 'middle'
  deltaX?: number
  deltaY?: number
}

export interface KeyboardInput {
  type: 'keyDown' | 'keyUp' | 'char'
  key: string
  modifiers?: number
  text?: string
}

export function useBrowserStream() {
  const open = useAppStore((s) => s.browserPreviewOpen)
  const port = useAppStore((s) => s.browserPreviewPort)
  const setConnected = useAppStore((s) => s.setBrowserPreviewConnected)
  const setFrame = useAppStore((s) => s.setBrowserPreviewFrame)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retriesRef = useRef(0)
  const openRef = useRef(open)
  openRef.current = open

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }
    if (wsRef.current) {
      wsRef.current.onopen = null
      wsRef.current.onmessage = null
      wsRef.current.onclose = null
      wsRef.current.onerror = null
      wsRef.current.close()
      wsRef.current = null
    }
    setConnected(false)
    retriesRef.current = 0
  }, [setConnected])

  const connect = useCallback(() => {
    if (!openRef.current) return
    cleanup()

    const ws = new WebSocket(`ws://localhost:${port}`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      retriesRef.current = 0
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'frame' && msg.data) {
          setFrame(msg.data, {
            deviceWidth: msg.metadata?.deviceWidth ?? 1280,
            deviceHeight: msg.metadata?.deviceHeight ?? 720,
            scrollOffsetX: msg.metadata?.scrollOffsetX ?? 0,
            scrollOffsetY: msg.metadata?.scrollOffsetY ?? 0,
          })
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
      if (!openRef.current) return
      // Reconnect with exponential backoff
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** retriesRef.current, RECONNECT_MAX_MS)
      retriesRef.current++
      reconnectTimer.current = setTimeout(connect, delay)
    }

    ws.onerror = () => {
      // onclose will fire after onerror
    }
  }, [port, cleanup, setConnected, setFrame])

  // Connect/disconnect based on open state
  useEffect(() => {
    if (open) {
      connect()
    } else {
      cleanup()
    }
    return cleanup
  }, [open, connect, cleanup])

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const injectMouse = useCallback((input: MouseInput) => {
    const { type: eventType, ...rest } = input
    send({ type: 'input', inputType: 'mouse', eventType, ...rest })
  }, [send])

  const injectKeyboard = useCallback((input: KeyboardInput) => {
    const { type: eventType, ...rest } = input
    send({ type: 'input', inputType: 'keyboard', eventType, ...rest })
  }, [send])

  return { injectMouse, injectKeyboard }
}
