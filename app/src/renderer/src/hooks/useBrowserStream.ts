import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { MASTRA_BASE_URL, authHeaders } from '../mastra-client'

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
  const setConnected = useAppStore((s) => s.setBrowserPreviewConnected)
  const setFrame = useAppStore((s) => s.setBrowserPreviewFrame)

  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retriesRef = useRef(0)
  const openRef = useRef(open)
  const clientIdRef = useRef<number | null>(null)
  openRef.current = open

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    clientIdRef.current = null
    setConnected(false)
    retriesRef.current = 0
  }, [setConnected])

  const connect = useCallback(() => {
    if (!openRef.current) return
    cleanup()

    const es = new EventSource(`${MASTRA_BASE_URL}/browser-stream`)
    eventSourceRef.current = es

    es.addEventListener('connected', (e) => {
      try {
        const data = JSON.parse(e.data)
        clientIdRef.current = data.clientId ?? null
      } catch {
        // ignore
      }
      setConnected(true)
      retriesRef.current = 0
    })

    es.addEventListener('frame', (e) => {
      try {
        const msg = JSON.parse(e.data)
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
    })

    es.addEventListener('closed', () => {
      setConnected(false)
      eventSourceRef.current = null
      clientIdRef.current = null
    })

    es.addEventListener('error', () => {
      setConnected(false)
      eventSourceRef.current = null
      clientIdRef.current = null
    })

    es.onerror = () => {
      setConnected(false)
      es.close()
      eventSourceRef.current = null
      clientIdRef.current = null
      if (!openRef.current) return
      // Reconnect with exponential backoff
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** retriesRef.current, RECONNECT_MAX_MS)
      retriesRef.current++
      reconnectTimer.current = setTimeout(connect, delay)
    }
  }, [cleanup, setConnected, setFrame])

  // Connect/disconnect based on open state
  useEffect(() => {
    if (open) {
      connect()
    } else {
      cleanup()
    }
    return cleanup
  }, [open, connect, cleanup])

  const sendInput = useCallback(async (msg: object) => {
    try {
      await fetch(`${MASTRA_BASE_URL}/browser-stream/input`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...msg, clientId: clientIdRef.current }),
      })
    } catch {
      // ignore send failures
    }
  }, [])

  const injectMouse = useCallback((input: MouseInput) => {
    const { type: eventType, ...rest } = input
    sendInput({ type: 'input', inputType: 'mouse', eventType, ...rest })
  }, [sendInput])

  const injectKeyboard = useCallback((input: KeyboardInput) => {
    const { type: eventType, ...rest } = input
    sendInput({ type: 'input', inputType: 'keyboard', eventType, ...rest })
  }, [sendInput])

  return { injectMouse, injectKeyboard }
}
