import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchEventSource, EventStreamContentType } from '@microsoft/fetch-event-source'
import { MASTRA_BASE_URL, authHeaders } from '../mastra-client'
import type {
  HarnessEvent,
  HarnessMessage,
  HarnessSession,
  HarnessThread,
  TokenUsage,
  AvailableModel,
  PermissionPolicy,
  PermissionRules,
  TaskItem,
} from '../types/harness'
import type { ToolState, SubagentState, SubagentToolState } from '../types/harness'

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface BackgroundNotification {
  threadId: string
  type: 'ask_question' | 'tool_approval' | 'plan_approval'
  data: unknown
}

export interface HarnessState {
  connected: boolean
  messages: HarnessMessage[]
  currentStreamingMessage: HarnessMessage | null
  status: 'idle' | 'streaming'
  toolStates: Map<string, ToolState>
  subagentStates: Map<string, SubagentState>
  pendingQuestion: { questionId: string; question: string; options?: { label: string; description?: string }[] } | null
  pendingToolApproval: { toolCallId: string; toolName: string; args: unknown } | null
  pendingPlanApproval: { planId: string; title: string; plan: string } | null
  currentModeId: string
  currentModelId: string
  currentThreadId: string | null
  tokenUsage: TokenUsage | null
  followUpCount: number
  error: Error | null
  infoMessage: string | null
  omStatus: HarnessEvent & { type: 'om_status' } | null
  // Task progress (from task_write tool)
  tasks: TaskItem[]
  // Background state for cross-thread notifications
  backgroundNotifications: BackgroundNotification[]
  activeThreads: Map<string, { running: boolean; channel: string }>
}

const initialState: HarnessState = {
  connected: false,
  messages: [],
  currentStreamingMessage: null,
  status: 'idle',
  toolStates: new Map(),
  subagentStates: new Map(),
  pendingQuestion: null,
  pendingToolApproval: null,
  pendingPlanApproval: null,
  currentModeId: '',
  currentModelId: '',
  currentThreadId: null,
  tokenUsage: null,
  followUpCount: 0,
  error: null,
  infoMessage: null,
  omStatus: null,
  tasks: [],
  backgroundNotifications: [],
  activeThreads: new Map(),
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function harnessUrl(path: string): string {
  return `${MASTRA_BASE_URL}/harness/${path}`
}

async function harnessPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(harnessUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`POST /harness/${path} failed (${res.status}): ${text}`)
  }
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json() as Promise<T>
  return undefined as unknown as T
}

async function harnessGet<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
  let url = harnessUrl(path)
  if (params) {
    const qs = new URLSearchParams(params).toString()
    if (qs) url += `?${qs}`
  }
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`GET /harness/${path} failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useHarness() {
  const [state, setState] = useState<HarnessState>(initialState)
  const stateRef = useRef(state)
  stateRef.current = state

  // Abort controller for SSE connection
  const abortRef = useRef<AbortController | null>(null)

  // Patch helper — merges partial state and keeps ref in sync
  const patch = useCallback((updates: Partial<HarnessState>) => {
    setState(prev => {
      const next = { ...prev, ...updates }
      stateRef.current = next
      return next
    })
  }, [])

  // ---------------------------------------------------------------------------
  // SSE Event Handlers — events now include threadId
  // ---------------------------------------------------------------------------

  const handleEvent = useCallback((event: HarnessEvent & { threadId?: string }, isReplay = false) => {
    const s = stateRef.current
    const eventThreadId = event.threadId
    const isCurrentThread = !eventThreadId || eventThreadId === s.currentThreadId

    // Track active threads for any thread
    if (eventThreadId) {
      if (event.type === 'agent_start') {
        const at = new Map(s.activeThreads)
        at.set(eventThreadId, { running: true, channel: '' })
        patch({ activeThreads: at })
      } else if (event.type === 'agent_end') {
        const at = new Map(s.activeThreads)
        const prev = at.get(eventThreadId)
        if (prev) at.set(eventThreadId, { ...prev, running: false })
        patch({ activeThreads: at })
      }
    }

    // Background notifications for non-current threads
    if (!isCurrentThread) {
      if (event.type === 'ask_question') {
        patch({
          backgroundNotifications: [
            ...s.backgroundNotifications,
            { threadId: eventThreadId!, type: 'ask_question', data: event },
          ],
        })
      } else if (event.type === 'tool_approval_required') {
        patch({
          backgroundNotifications: [
            ...s.backgroundNotifications,
            { threadId: eventThreadId!, type: 'tool_approval', data: event },
          ],
        })
      } else if (event.type === 'plan_approval_required') {
        patch({
          backgroundNotifications: [
            ...s.backgroundNotifications,
            { threadId: eventThreadId!, type: 'plan_approval', data: event },
          ],
        })
      }
      return // Don't update main chat state for other threads
    }

    // Current thread event handling (same as before)
    switch (event.type) {
      // --- Core Lifecycle ---
      case 'agent_start':
        patch({
          status: 'streaming',
          error: null,
          // During replay, preserve existing tool/subagent states — clearing them would
          // drop state that was already reconstructed from earlier buffer events
          ...(isReplay ? {} : { toolStates: new Map(), subagentStates: new Map() }),
        })
        break

      case 'agent_end':
        patch({
          status: 'idle',
          currentStreamingMessage: null,
        })
        break

      case 'info':
        patch({ infoMessage: event.message })
        break

      case 'error':
        patch({ error: event.error })
        break

      // --- User Message (synthetic event from pool.send) ---
      case 'user_message': {
        // Dedup: don't add if we already have this message (optimistic add from sendMessage)
        const content = (event as any).content as string
        const alreadyHas = s.messages.some(m =>
          m.role === 'user' && m.content.some(c => c.type === 'text' && c.text === content)
        )
        if (!alreadyHas) {
          const userMsg: HarnessMessage = {
            id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: 'user',
            content: [{ type: 'text', text: content }],
            createdAt: new Date((event as any).createdAt),
          }
          patch({ messages: [...s.messages, userMsg] })
        }
        break
      }

      // --- Messages ---
      case 'message_start':
        patch({ currentStreamingMessage: event.message })
        break

      case 'message_update':
        patch({ currentStreamingMessage: event.message })
        break

      case 'message_end': {
        const existing = s.messages
        const idx = existing.findIndex(m => m.id === event.message.id)
        const updated = idx >= 0
          ? existing.map((m, i) => (i === idx ? event.message : m))
          : [...existing, event.message]
        patch({ messages: updated, currentStreamingMessage: null })
        break
      }

      // --- Tools ---
      case 'tool_start': {
        const ts = new Map(s.toolStates)
        ts.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          status: 'running',
        })
        patch({ toolStates: ts })
        break
      }

      case 'tool_approval_required': {
        const ts = new Map(s.toolStates)
        const prev = ts.get(event.toolCallId)
        ts.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          status: 'approval_required',
          ...prev && { partialResult: prev.partialResult, shellOutput: prev.shellOutput },
        })
        patch({
          toolStates: ts,
          pendingToolApproval: { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args },
        })
        break
      }

      case 'tool_update': {
        const ts = new Map(s.toolStates)
        const prev = ts.get(event.toolCallId)
        if (prev) {
          ts.set(event.toolCallId, { ...prev, partialResult: event.partialResult })
          patch({ toolStates: ts })
        }
        break
      }

      case 'tool_end': {
        const ts = new Map(s.toolStates)
        const prev = ts.get(event.toolCallId)
        ts.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: prev?.toolName ?? '',
          args: prev?.args,
          status: event.isError ? 'error' : 'completed',
          result: event.result,
          isError: event.isError,
          ...prev && { shellOutput: prev.shellOutput },
        })
        // Clear pending approval if this was the approved tool
        const pendingApproval = s.pendingToolApproval?.toolCallId === event.toolCallId ? null : s.pendingToolApproval
        patch({ toolStates: ts, pendingToolApproval: pendingApproval })
        break
      }

      // --- Shell ---
      case 'shell_output': {
        const ts = new Map(s.toolStates)
        const prev = ts.get(event.toolCallId)
        if (prev) {
          ts.set(event.toolCallId, {
            ...prev,
            shellOutput: (prev.shellOutput ?? '') + event.output,
          })
          patch({ toolStates: ts })
        }
        break
      }

      // --- Subagents ---
      case 'subagent_start': {
        const ss = new Map(s.subagentStates)
        ss.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          agentType: event.agentType,
          task: event.task,
          modelId: event.modelId,
          status: 'running',
          text: '',
          nestedTools: [],
        })
        patch({ subagentStates: ss })
        break
      }

      case 'subagent_text_delta': {
        const ss = new Map(s.subagentStates)
        const prev = ss.get(event.toolCallId)
        if (prev) {
          ss.set(event.toolCallId, { ...prev, text: prev.text + event.textDelta })
          patch({ subagentStates: ss })
        }
        break
      }

      case 'subagent_tool_start': {
        const ss = new Map(s.subagentStates)
        const prev = ss.get(event.toolCallId)
        if (prev) {
          const tool: SubagentToolState = {
            toolName: event.subToolName,
            args: event.subToolArgs,
            status: 'running',
          }
          ss.set(event.toolCallId, { ...prev, nestedTools: [...prev.nestedTools, tool] })
          patch({ subagentStates: ss })
        }
        break
      }

      case 'subagent_tool_end': {
        const ss = new Map(s.subagentStates)
        const prev = ss.get(event.toolCallId)
        if (prev) {
          const tools = prev.nestedTools.map(t =>
            t.toolName === event.subToolName && t.status === 'running'
              ? { ...t, result: event.subToolResult, isError: event.isError, status: event.isError ? 'error' as const : 'completed' as const }
              : t
          )
          ss.set(event.toolCallId, { ...prev, nestedTools: tools })
          patch({ subagentStates: ss })
        }
        break
      }

      case 'subagent_end': {
        const ss = new Map(s.subagentStates)
        const prev = ss.get(event.toolCallId)
        if (prev) {
          ss.set(event.toolCallId, {
            ...prev,
            status: event.isError ? 'error' : 'completed',
            result: event.result,
            isError: event.isError,
            durationMs: event.durationMs,
          })
          patch({ subagentStates: ss })
        }
        break
      }

      case 'subagent_model_changed':
        // Informational — no state change needed
        break

      // --- Mode / Model ---
      case 'mode_changed':
        patch({ currentModeId: event.modeId })
        break

      case 'model_changed':
        patch({ currentModelId: event.modelId })
        break

      // --- Thread (from pool — thread_created used for new threads) ---
      case 'thread_created':
        // Only update if it's for current thread (e.g., just created)
        break

      case 'thread_changed':
        // Pool model doesn't use switchThread — this shouldn't fire for UI threads
        break

      // --- State ---
      case 'state_changed':
        break

      // --- Interactive ---
      case 'ask_question':
        patch({
          pendingQuestion: {
            questionId: event.questionId,
            question: event.question,
            options: event.options,
          },
        })
        break

      case 'plan_approval_required':
        patch({
          pendingPlanApproval: {
            planId: event.planId,
            title: event.title,
            plan: event.plan,
          },
        })
        break

      case 'plan_approved':
        patch({ pendingPlanApproval: null })
        break

      // --- Usage ---
      case 'usage_update':
        patch({ tokenUsage: event.usage })
        break

      // --- Follow-up ---
      case 'follow_up_queued':
        patch({ followUpCount: event.count })
        break

      // --- Workspace ---
      case 'workspace_status_changed':
      case 'workspace_ready':
      case 'workspace_error':
        break

      // --- OM ---
      case 'om_status':
        patch({ omStatus: event })
        break

      case 'om_observation_start':
      case 'om_observation_end':
      case 'om_observation_failed':
      case 'om_reflection_start':
      case 'om_reflection_end':
      case 'om_reflection_failed':
      case 'om_model_changed':
      case 'om_buffering_start':
      case 'om_buffering_end':
      case 'om_buffering_failed':
      case 'om_activation':
        break

      // --- Tasks ---
      case 'task_updated':
        patch({ tasks: (event as any).tasks ?? [] })
        break
    }
  }, [patch])

  // ---------------------------------------------------------------------------
  // SSE Reconnect Recovery
  // ---------------------------------------------------------------------------

  /** Re-sync current thread state after SSE reconnect */
  const resyncCurrentThread = useCallback(async () => {
    const threadId = stateRef.current.currentThreadId
    if (!threadId) return

    try {
      const status = await harnessGet<{
        running: boolean;
        pending: {
          question: { questionId: string; question: string; options?: { label: string; description?: string }[] } | null;
          toolApproval: { toolCallId: string; toolName: string; args: unknown } | null;
          planApproval: { planId: string; title: string; plan: string } | null;
        };
        runBuffer: (HarnessEvent & { threadId?: string })[];
      }>('status', { threadId })

      if (status.running) {
        // Run still active — replay buffer to catch up on missed events
        patch({ toolStates: new Map(), subagentStates: new Map() })
        for (const event of status.runBuffer) {
          handleEvent({ ...event, threadId }, true)
        }
        patch({
          status: 'streaming',
          pendingQuestion: status.pending.question ?? null,
          pendingToolApproval: status.pending.toolApproval ?? null,
          pendingPlanApproval: status.pending.planApproval ?? null,
        })
      } else if (stateRef.current.status === 'streaming') {
        // Was streaming before disconnect, now idle — run completed during disconnect
        const data = await harnessGet<{ messages: HarnessMessage[] }>('thread/messages', { threadId })
        patch({
          messages: data.messages || [],
          status: 'idle',
          currentStreamingMessage: null,
          toolStates: new Map(),
          subagentStates: new Map(),
          pendingQuestion: null,
          pendingToolApproval: null,
          pendingPlanApproval: null,
        })
      }
    } catch {
      // Status endpoint unavailable — best effort
    }
  }, [patch, handleEvent])

  // Ref to avoid circular dependency between connect and resyncCurrentThread
  const resyncRef = useRef(resyncCurrentThread)
  resyncRef.current = resyncCurrentThread

  // ---------------------------------------------------------------------------
  // SSE Connection
  // ---------------------------------------------------------------------------

  const connect = useCallback(() => {
    // Clean up previous connection
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    fetchEventSource(harnessUrl('events'), {
      headers: authHeaders(),
      signal: ctrl.signal,
      openWhenHidden: true,

      async onopen(response) {
        if (response.ok && response.headers.get('content-type')?.includes(EventStreamContentType)) {
          const wasDisconnected = !stateRef.current.connected
          patch({ connected: true, error: null })
          // On reconnect, re-sync current thread to recover any missed events
          if (wasDisconnected && stateRef.current.currentThreadId) {
            resyncRef.current()
          }
          return
        }
        throw new Error(`SSE open failed: ${response.status} ${response.statusText}`)
      },

      onmessage(msg) {
        if (!msg.data || msg.data === ':heartbeat') return
        try {
          const event: HarnessEvent & { threadId?: string } = JSON.parse(msg.data)
          handleEvent(event)
        } catch {
          // Ignore unparseable messages (heartbeats, comments)
        }
      },

      onclose() {
        patch({ connected: false })
      },

      onerror(err) {
        patch({ connected: false })
        if (ctrl.signal.aborted) throw err
        return undefined
      },
    })
  }, [patch, handleEvent])

  const disconnect = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    patch({ connected: false })
  }, [patch])

  // Auto-connect on mount, disconnect on unmount
  useEffect(() => {
    connect()
    return () => { abortRef.current?.abort() }
  }, [connect])

  // ---------------------------------------------------------------------------
  // Action Methods (POST) — all include threadId
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(async (content: string, images?: string[]) => {
    const threadId = stateRef.current.currentThreadId
    if (!threadId) return

    // Add user message to local state immediately (optimistic)
    const userMsg: HarnessMessage = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user' as const,
      content: [{ type: 'text' as const, text: content }],
      createdAt: new Date(),
    }
    patch({ messages: [...stateRef.current.messages, userMsg] })
    await harnessPost('send', { threadId, content, images })
  }, [patch])

  const abort = useCallback(async () => {
    const threadId = stateRef.current.currentThreadId
    if (!threadId) return
    await harnessPost('abort', { threadId })
  }, [])

  const steer = useCallback(async (content: string) => {
    const threadId = stateRef.current.currentThreadId
    if (!threadId) return
    await harnessPost('steer', { threadId, content })
  }, [])

  const followUp = useCallback(async (content: string) => {
    const threadId = stateRef.current.currentThreadId
    if (!threadId) return
    await harnessPost('follow-up', { threadId, content })
  }, [])

  const switchMode = useCallback(async (modeId: string) => {
    const threadId = stateRef.current.currentThreadId
    if (!threadId) return
    await harnessPost('switch-mode', { threadId, modeId })
  }, [])

  const switchModel = useCallback(async (modelId: string, scope?: string, modeId?: string) => {
    const threadId = stateRef.current.currentThreadId
    if (!threadId) return
    await harnessPost('switch-model', { threadId, modelId, scope, modeId })
  }, [])

  const resolveToolApproval = useCallback(async (decision: 'approve' | 'decline' | 'always_allow_category') => {
    const threadId = stateRef.current.currentThreadId
    if (!threadId) return
    await harnessPost('tool-approval', { threadId, decision })
    patch({ pendingToolApproval: null })
  }, [patch])

  const respondToQuestion = useCallback(async (questionId: string, answer: string) => {
    const threadId = stateRef.current.currentThreadId
    if (!threadId) return
    await harnessPost('answer', { threadId, questionId, answer })
    patch({ pendingQuestion: null })
  }, [patch])

  /** Answer a question from a background thread (cross-thread) */
  const respondToBackgroundQuestion = useCallback(async (threadId: string, questionId: string, answer: string) => {
    await harnessPost('answer', { threadId, questionId, answer })
    patch({
      backgroundNotifications: stateRef.current.backgroundNotifications.filter(
        n => !(n.threadId === threadId && n.type === 'ask_question')
      ),
    })
  }, [patch])

  /** Approve/decline a tool from a background thread (cross-thread) */
  const respondToBackgroundToolApproval = useCallback(async (threadId: string, decision: 'approve' | 'decline' | 'always_allow_category') => {
    await harnessPost('tool-approval', { threadId, decision })
    patch({
      backgroundNotifications: stateRef.current.backgroundNotifications.filter(
        n => !(n.threadId === threadId && n.type === 'tool_approval')
      ),
    })
  }, [patch])

  /** Approve/reject a plan from a background thread (cross-thread) */
  const respondToBackgroundPlanApproval = useCallback(async (threadId: string, planId: string, response: { action: 'approved' | 'rejected'; feedback?: string }) => {
    await harnessPost('plan-approval', { threadId, planId, response })
    patch({
      backgroundNotifications: stateRef.current.backgroundNotifications.filter(
        n => !(n.threadId === threadId && n.type === 'plan_approval')
      ),
    })
  }, [patch])

  const respondToPlanApproval = useCallback(async (planId: string, response: { action: 'approved' | 'rejected'; feedback?: string }) => {
    const threadId = stateRef.current.currentThreadId
    if (!threadId) return
    await harnessPost('plan-approval', { threadId, planId, response })
    patch({ pendingPlanApproval: null })
  }, [patch])

  const createThread = useCallback(async (title?: string) => {
    const data = await harnessPost<{ threadId: string }>('thread/create', { title })
    return data
  }, [])

  /** Switch thread — purely UI-side, no server abort. Restores pending state from pool. */
  const switchThread = useCallback(async (threadId: string) => {
    patch({
      currentThreadId: threadId,
      messages: [],
      currentStreamingMessage: null,
      status: 'idle',
      toolStates: new Map(),
      subagentStates: new Map(),
      pendingQuestion: null,
      pendingToolApproval: null,
      pendingPlanApproval: null,
      tasks: [],
      error: null,
    })
    // Load messages for this thread
    try {
      const data = await harnessGet<{ messages: HarnessMessage[] }>('thread/messages', { threadId })
      patch({ messages: data.messages || [] })
    } catch {
      // Thread may be new with no messages yet
    }
    // Restore pending state + replay buffered run events from server pool
    try {
      const status = await harnessGet<{
        running: boolean;
        pending: {
          question: { questionId: string; question: string; options?: { label: string; description?: string }[] } | null;
          toolApproval: { toolCallId: string; toolName: string; args: unknown } | null;
          planApproval: { planId: string; title: string; plan: string } | null;
        };
        runBuffer: (HarnessEvent & { threadId?: string })[];
      }>('status', { threadId })
      // Restore pending interactive state
      patch({
        status: status.running ? 'streaming' : 'idle',
        pendingQuestion: status.pending.question
          ? { questionId: status.pending.question.questionId, question: status.pending.question.question, options: status.pending.question.options }
          : null,
        pendingToolApproval: status.pending.toolApproval
          ? { toolCallId: status.pending.toolApproval.toolCallId, toolName: status.pending.toolApproval.toolName, args: status.pending.toolApproval.args }
          : null,
        pendingPlanApproval: status.pending.planApproval
          ? { planId: status.pending.planApproval.planId, title: status.pending.planApproval.title, plan: status.pending.planApproval.plan }
          : null,
      })
      // Replay buffered run events to reconstruct in-flight state
      // (streaming messages, tool states, subagent states, etc.)
      // Skip message_end for messages already loaded from history —
      // history messages are complete (with tool_results), buffer snapshots may be incomplete.
      if (status.runBuffer.length > 0) {
        const historyMessageIds = new Set(stateRef.current.messages.map(m => m.id))
        for (const event of status.runBuffer) {
          if (event.type === 'message_end' && 'message' in event && historyMessageIds.has((event as { message: { id: string } }).message.id)) {
            continue
          }
          handleEvent({ ...event, threadId }, true)
        }
      }
    } catch {
      // Status endpoint may not be available — continue with defaults
    }
    // Restore persisted tasks from thread state (covers idle threads where runBuffer is empty)
    if (stateRef.current.tasks.length === 0) {
      try {
        const threadState = await harnessGet<{ tasks?: TaskItem[] }>('state', { threadId })
        if (threadState?.tasks?.length) {
          patch({ tasks: threadState.tasks })
        }
      } catch { /* state endpoint may not be available */ }
    }
    // Clear any background notifications for this thread (now current)
    patch({
      backgroundNotifications: stateRef.current.backgroundNotifications.filter(n => n.threadId !== threadId),
    })
  }, [patch, handleEvent])

  const renameThread = useCallback(async (title: string) => {
    const threadId = stateRef.current.currentThreadId
    if (!threadId) return
    await harnessPost('thread/rename', { threadId, title })
  }, [])

  const setPermissionCategory = useCallback(async (category: string, policy: PermissionPolicy) => {
    const threadId = stateRef.current.currentThreadId
    await harnessPost('permissions/update', { threadId, category, policy })
  }, [])

  const setPermissionTool = useCallback(async (toolName: string, policy: PermissionPolicy) => {
    const threadId = stateRef.current.currentThreadId
    await harnessPost('permissions/update', { threadId, toolName, policy })
  }, [])

  const grantSessionCategory = useCallback(async (category: string) => {
    const threadId = stateRef.current.currentThreadId
    await harnessPost('grants', { threadId, category })
  }, [])

  const grantSessionTool = useCallback(async (toolName: string) => {
    const threadId = stateRef.current.currentThreadId
    await harnessPost('grants', { threadId, toolName })
  }, [])

  // ---------------------------------------------------------------------------
  // Query Methods (GET / POST)
  // ---------------------------------------------------------------------------

  const init = useCallback(async () => {
    // List threads and pick the most recent, or create one
    const threadsData = await harnessGet<{ threads: HarnessThread[] }>('thread/list')
    const threads = threadsData.threads || []
    let threadId: string

    if (threads.length > 0) {
      // Pick most recent
      const sorted = [...threads].sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      threadId = sorted[0].id
    } else {
      // Create initial thread
      const created = await harnessPost<{ threadId: string }>('thread/create', { title: 'New Thread' })
      threadId = created.threadId
    }

    patch({ currentThreadId: threadId })

    // Load messages
    try {
      const data = await harnessGet<{ messages: HarnessMessage[] }>('thread/messages', { threadId })
      patch({ messages: data.messages || [] })
    } catch {
      // New thread, no messages
    }

    // Load modes
    try {
      const modesData = await harnessGet<{ modes: Array<{ id: string; default?: boolean }> }>('modes')
      const defaultMode = modesData.modes?.find((m) => m.default)
      if (defaultMode) patch({ currentModeId: defaultMode.id })
    } catch {
      // Modes not available yet
    }

    return { currentThreadId: threadId }
  }, [patch])

  const getSession = useCallback(async () => {
    return harnessGet<HarnessSession>('session')
  }, [])

  const getModes = useCallback(async () => {
    const data = await harnessGet<{ modes: Array<{ id: string; name?: string; color?: string; default?: boolean }> }>('modes')
    return data.modes || []
  }, [])

  const getMessages = useCallback(async (limit?: number) => {
    const threadId = stateRef.current.currentThreadId
    if (!threadId) return []
    const params: Record<string, string> = { threadId }
    if (limit != null) params.limit = String(limit)
    const data = await harnessGet<{ messages: HarnessMessage[] }>('thread/messages', params)
    const msgs = data.messages || []
    patch({ messages: msgs })
    return msgs
  }, [patch])

  const listThreads = useCallback(async () => {
    const data = await harnessGet<{ threads: HarnessThread[] }>('thread/list')
    return data.threads || []
  }, [])

  const getAvailableModels = useCallback(async () => {
    const data = await harnessGet<{ models: AvailableModel[] }>('models')
    return data.models || []
  }, [])

  const getPermissionRules = useCallback(async () => {
    return harnessGet<PermissionRules>('permissions')
  }, [])

  // ---------------------------------------------------------------------------
  // Computed values
  // ---------------------------------------------------------------------------

  // Merge streaming message into display list
  const displayMessages: HarnessMessage[] = state.currentStreamingMessage
    ? (() => {
        const idx = state.messages.findIndex(m => m.id === state.currentStreamingMessage!.id)
        if (idx >= 0) {
          return state.messages.map((m, i) => (i === idx ? state.currentStreamingMessage! : m))
        }
        return [...state.messages, state.currentStreamingMessage]
      })()
    : state.messages

  return {
    // State
    ...state,
    displayMessages,

    // Connection
    connect,
    disconnect,

    // Actions
    sendMessage,
    abort,
    steer,
    followUp,
    switchMode,
    switchModel,
    resolveToolApproval,
    respondToQuestion,
    respondToBackgroundQuestion,
    respondToBackgroundToolApproval,
    respondToBackgroundPlanApproval,
    respondToPlanApproval,
    createThread,
    switchThread,
    renameThread,
    setPermissionCategory,
    setPermissionTool,
    grantSessionCategory,
    grantSessionTool,

    // Queries
    init,
    getSession,
    getModes,
    getMessages,
    listThreads,
    getAvailableModels,
    getPermissionRules,
  }
}

export type UseHarnessReturn = ReturnType<typeof useHarness>
