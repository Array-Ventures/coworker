import { useEffect, useMemo, useCallback, useRef } from 'react'
import type { FileUIPart } from 'ai'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useTheme } from './hooks/useTheme'
import { useAppStore } from './stores/useAppStore'
import { generateThreadId } from './stores/slices/chatSlice'
import { AGENT_ID, RESOURCE_ID, MASTRA_BASE_URL, authHeaders } from './mastra-client'
import Sidebar from './Sidebar'
import CommandPalette from './components/CommandPalette'
import HomePage from './pages/HomePage'
import ChatsListPage from './pages/ChatsListPage'
import ActiveChatPage from './pages/ActiveChatPage'
import FilesPage from './pages/FilesPage'
import SuperpowersPage from './pages/SuperpowersPage'
import SettingsPage from './pages/SettingsPage'
import ScheduledTasksPage from './pages/ScheduledTasksPage'
import AppsPage from './pages/AppsPage'

export default function App() {
  const theme = useTheme()

  // ── Store state ──
  const currentPage = useAppStore((s) => s.currentPage)
  const showCommandPalette = useAppStore((s) => s.showCommandPalette)
  const threadId = useAppStore((s) => s.threadId)
  const pendingLoad = useAppStore((s) => s.pendingLoad)
  // ── Store actions ──
  const toggleCommandPalette = useAppStore((s) => s.toggleCommandPalette)

  // ── Transport — reads threadId from store via getState() ──
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${MASTRA_BASE_URL}/chat/${AGENT_ID}`,
        headers: () => authHeaders(),
        prepareSendMessagesRequest({ messages }) {
          const state = useAppStore.getState()
          return {
            body: {
              messages,
              memory: { thread: state.threadId, resource: RESOURCE_ID },
            },
          }
        },
      }),
    [],
  )

  // ── On finish: refresh title (propagates to threads list via updateThreadInList) ──
  const handleFinish = useCallback(() => {
    useAppStore.getState().refreshThreadTitle()
  }, [])

  // ── AI SDK chat hook — id prop gives each thread its own Chat instance ──
  const { messages, sendMessage, setMessages, status, stop, error, clearError, addToolApprovalResponse } =
    useChat({
      transport,
      ...(threadId != null ? { id: threadId } : {}),
      onFinish: handleFinish,
    })

  const isLoading = status === 'streaming' || status === 'submitted'

  // ── Deferred send from Home (Chat must be recreated before sending) ──
  const pendingSendRef = useRef<{ text?: string; files?: FileUIPart[] } | null>(null)

  useEffect(() => {
    if (pendingSendRef.current) {
      const msg = pendingSendRef.current
      pendingSendRef.current = null
      sendMessage(msg)
    }
  }, [threadId, sendMessage])

  // ── Load historical messages after Chat recreation (from openThread) ──
  useEffect(() => {
    if (pendingLoad) {
      setMessages(pendingLoad.messages)
      useAppStore.setState({ switchingThread: false, pendingLoad: null })
    }
  }, [pendingLoad, setMessages])

  // ── Cmd+K ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggleCommandPalette()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleCommandPalette])

  // ── Send from Home — deferred: store message, generate threadId, useEffect sends after Chat recreation ──
  const handleSendFromHome = useCallback(() => {
    const state = useAppStore.getState()
    const trimmed = state.input.trim()
    if (!trimmed && state.stagedFiles.length === 0) return

    const msg: { text?: string; files?: FileUIPart[] } = {}
    if (trimmed) msg.text = trimmed
    if (state.stagedFiles.length > 0) msg.files = state.stagedFiles

    pendingSendRef.current = msg
    useAppStore.setState({
      threadId: generateThreadId(),
      threadTitle: undefined,
      input: '',
      stagedFiles: [],
      currentPage: 'active-chat',
    })
  }, [])

  // ── Send in active chat — direct, no Chat recreation needed ──
  const handleSendInChat = useCallback(() => {
    const state = useAppStore.getState()
    const trimmed = state.input.trim()
    if ((!trimmed && state.stagedFiles.length === 0) || state.switchingThread) return

    const msg: { text?: string; files?: FileUIPart[] } = {}
    if (trimmed) msg.text = trimmed
    if (state.stagedFiles.length > 0) msg.files = state.stagedFiles
    sendMessage(msg)
    useAppStore.setState({ input: '', stagedFiles: [] })
  }, [sendMessage])

  return (
    <div className="flex h-screen overflow-hidden bg-background [background-size:24px_24px] [background-image:radial-gradient(#CBCCC9_1px,transparent_1px)] dark:[background-image:radial-gradient(#333333_1px,transparent_1px)]">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        {currentPage === 'home' && (
          <HomePage onSend={handleSendFromHome} disabled={isLoading} />
        )}
        {currentPage === 'chats' && <ChatsListPage />}
        {currentPage === 'active-chat' && (
          <ActiveChatPage
            messages={messages}
            onSend={handleSendInChat}
            onStop={stop}
            error={error}
            onClearError={clearError}
            isLoading={isLoading}
            isDark={theme.isDark}
            onToolApprovalResponse={addToolApprovalResponse}
          />
        )}
        {currentPage === 'files' && <FilesPage />}
        {currentPage === 'superpowers' && <SuperpowersPage />}
        {currentPage === 'settings' && (
          <SettingsPage themeMode={theme.mode} onThemeChange={theme.setMode} />
        )}
        {currentPage === 'scheduled-tasks' && <ScheduledTasksPage />}
        {currentPage === 'apps' && <AppsPage />}
      </div>

{showCommandPalette && <CommandPalette />}
    </div>
  )
}
