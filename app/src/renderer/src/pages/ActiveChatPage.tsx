import { useState, useEffect, useRef, useCallback, memo } from 'react'
import type { UIMessage } from 'ai'
import { useAppStore } from '../stores/useAppStore'
import PageShell from '../components/PageShell'
import MessageBubble from '../components/MessageBubble'
import ChatInput from '../components/ChatInput'
import NewChatButton from '../components/NewChatButton'
import ThreadSwitcher from '../components/ThreadSwitcher'

type ActiveChatPageProps = {
  messages: UIMessage[]
  setMessages: (messages: UIMessage[]) => void
  onSend: () => void
  onStop: () => void
  error?: Error
  onClearError: () => void
  isLoading: boolean
  isDark?: boolean
  onToolApprovalResponse: (opts: { id: string; approved: boolean; reason?: string }) => void | PromiseLike<void>
}

export default memo(function ActiveChatPage({
  messages,
  setMessages,
  onSend,
  onStop,
  error,
  onClearError,
  isLoading,
  isDark = true,
  onToolApprovalResponse,
}: ActiveChatPageProps) {
  const threadTitle = useAppStore((s) => s.threadTitle)
  const switchingThread = useAppStore((s) => s.switchingThread)
  const input = useAppStore((s) => s.input)
  const setInput = useAppStore((s) => s.setInput)
  const updateTitle = useAppStore((s) => s.updateTitle)
  const deleteThread = useAppStore((s) => s.deleteThread)
  const threadId = useAppStore((s) => s.threadId)
  const messagesHasMore = useAppStore((s) => s.messagesHasMore)
  const loadingOlderMessages = useAppStore((s) => s.loadingOlderMessages)
  const loadOlderMessages = useAppStore((s) => s.loadOlderMessages)

  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [showSwitcher, setShowSwitcher] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const prevMessagesLenRef = useRef(0)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  // Auto-scroll to bottom on new messages (but not when loading older)
  useEffect(() => {
    if (messages.length > prevMessagesLenRef.current || prevMessagesLenRef.current === 0) {
      const container = scrollContainerRef.current
      if (container) {
        const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150
        if (nearBottom || prevMessagesLenRef.current === 0) {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
      }
    }
    prevMessagesLenRef.current = messages.length
  }, [messages])

  // Scroll-up loading — fetch older messages when top sentinel is visible
  useEffect(() => {
    const el = topSentinelRef.current
    const container = scrollContainerRef.current
    if (!el || !container || !messagesHasMore) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        const prevScrollHeight = container.scrollHeight
        loadOlderMessages().then((olderMessages) => {
          if (olderMessages && olderMessages.length > 0) {
            setMessages([...olderMessages, ...messagesRef.current])
            // Preserve scroll position after prepending
            requestAnimationFrame(() => {
              container.scrollTop = container.scrollHeight - prevScrollHeight
            })
          }
        })
      },
      { root: container, rootMargin: '100px 0px 0px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [messagesHasMore, loadOlderMessages, setMessages])

  const startEditing = useCallback(() => {
    setEditValue(threadTitle || '')
    setEditing(true)
    setShowSwitcher(false)
  }, [threadTitle])

  const commitEdit = useCallback(() => {
    setEditing(false)
    if (editValue.trim() && editValue.trim() !== threadTitle) {
      updateTitle(editValue.trim())
    }
  }, [editValue, threadTitle, updateTitle])

  const cancelEdit = useCallback(() => {
    setEditing(false)
  }, [])

  return (
    <PageShell>
      <div className="flex flex-col h-full">
        {/* Chat header */}
        <div className="flex items-center justify-between px-6 h-[52px] border-b border-border shrink-0 relative">
          <div className="flex items-center gap-2">
            {editing ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit()
                  if (e.key === 'Escape') cancelEdit()
                }}
                className="font-secondary text-[15px] font-medium text-foreground bg-card border border-border rounded-lg px-2 py-1 outline-none focus:border-primary"
                style={{ minWidth: 120, maxWidth: 320 }}
              />
            ) : (
              <button
                onClick={() => setShowSwitcher(!showSwitcher)}
                className="flex items-center gap-1 hover:bg-card rounded-lg px-2 py-1 -ml-2 transition-colors"
              >
                <span className="font-secondary text-[15px] font-medium text-foreground truncate max-w-[300px]">
                  {threadTitle || 'New Chat'}
                </span>
                <span className="material-icon text-muted-dim" style={{ fontSize: 16 }}>
                  expand_more
                </span>
              </button>
            )}
            <button
              onClick={startEditing}
              className="flex items-center text-muted-dim hover:text-foreground transition-colors"
            >
              <span className="material-icon" style={{ fontSize: 16 }}>edit</span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <NewChatButton />
            <button
              onClick={() => threadId && deleteThread(threadId)}
              className="flex items-center justify-center border border-border rounded-[10px] text-muted-dim hover:bg-card hover:text-foreground transition-colors"
              style={{ width: 36, height: 36 }}
            >
              <span className="material-icon" style={{ fontSize: 16 }}>delete</span>
            </button>
            <button
              className="flex items-center gap-1.5 border border-border rounded-[10px] text-muted font-secondary text-[13px] font-medium hover:bg-card hover:text-foreground"
              style={{ padding: '8px 14px' }}
            >
              <span className="material-icon" style={{ fontSize: 16 }}>ios_share</span>
              Share
            </button>
          </div>

          {/* Thread switcher dropdown */}
          {showSwitcher && <ThreadSwitcher onClose={() => setShowSwitcher(false)} />}
        </div>

        {/* Error bar */}
        {error && (
          <div className="flex items-center gap-2 px-12 py-2 bg-error-bg shrink-0">
            <span className="material-icon text-error" style={{ fontSize: 16 }}>error</span>
            <span className="text-error text-[13px] font-secondary flex-1">{error.message}</span>
            <button
              onClick={onClearError}
              className="text-muted-dim hover:text-foreground text-[13px] font-secondary"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Messages area */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-12 py-8 flex flex-col gap-6 min-h-0">
          {messagesHasMore && (
            <div ref={topSentinelRef} className="flex justify-center py-2">
              {loadingOlderMessages && (
                <span className="text-muted-dim text-sm font-secondary">Loading older messages...</span>
              )}
            </div>
          )}
          {messages.length === 0 && !switchingThread && (
            <div className="text-muted text-center text-sm font-secondary flex-1 flex items-center justify-center">
              Send a message to start coding with your agent.
            </div>
          )}
          {switchingThread && (
            <div className="text-muted text-center text-sm font-secondary flex-1 flex items-center justify-center">
              Loading conversation...
            </div>
          )}
          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              isStreaming={isLoading && index === messages.length - 1 && message.role === 'assistant'}
              isDark={isDark}
              onToolApprovalResponse={onToolApprovalResponse}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Reply input */}
        <div className="px-12 py-4 pb-6 shrink-0">
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={onSend}
            onStop={onStop}
            isLoading={isLoading}
            disabled={isLoading || switchingThread}
            variant="reply"
            placeholder="Reply..."
          />
        </div>
      </div>
    </PageShell>
  )
})
