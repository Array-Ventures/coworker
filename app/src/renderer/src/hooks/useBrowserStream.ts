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

  const abortRef = useRef<AbortController | null>(null)
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
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    clientIdRef.current = null
    setConnected(false)
    retriesRef.current = 0
  }, [setConnected])

  const connect = useCallback(() => {
    if (!openRef.current) return
    cleanup()

    const controller = new AbortController()
    abortRef.current = controller

    ;(async () => {
      try {
        const res = await fetch(`${MASTRA_BASE_URL}/browser-stream`, {
          headers: { ...authHeaders(), Accept: 'text/event-stream' },
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          throw new Error(`Stream failed: ${res.status}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // Parse SSE events from buffer
          const parts = buffer.split('\n\n')
          // Last part is incomplete — keep it in buffer
          buffer = parts.pop() ?? ''

          for (const part of parts) {
            let event = 'message'
            let data = ''
            for (const line of part.split('\n')) {
              if (line.startsWith('event: ')) event = line.slice(7)
              else if (line.startsWith('data: ')) data = line.slice(6)
            }

            if (event === 'connected') {
              try {
                const parsed = JSON.parse(data)
                clientIdRef.current = parsed.clientId ?? null
              } catch { /* ignore */ }
              setConnected(true)
              retriesRef.current = 0
            } else if (event === 'frame') {
              try {
                const msg = JSON.parse(data)
                if (msg.type === 'frame' && msg.data) {
                  setFrame(msg.data, {
                    deviceWidth: msg.metadata?.deviceWidth ?? 1280,
                    deviceHeight: msg.metadata?.deviceHeight ?? 720,
                    scrollOffsetX: msg.metadata?.scrollOffsetX ?? 0,
                    scrollOffsetY: msg.metadata?.scrollOffsetY ?? 0,
                  })
                }
              } catch { /* ignore malformed */ }
            } else if (event === 'closed' || event === 'error') {
              setConnected(false)
              clientIdRef.current = null
            }
          }
        }

        // Stream ended naturally — reconnect
        throw new Error('Stream ended')
      } catch (err: any) {
        if (err?.name === 'AbortError') return // intentional cleanup
        setConnected(false)
        clientIdRef.current = null
        if (!openRef.current) return
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** retriesRef.current, RECONNECT_MAX_MS)
        retriesRef.current++
        reconnectTimer.current = setTimeout(connect, delay)
      }
    })()
  }, [cleanup, setConnected, setFrame])

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
    } catch { /* ignore */ }
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
