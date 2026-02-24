import { useState, useEffect, useRef, useCallback, memo } from 'react'
import type { HarnessMessage, TaskItem } from '../types/harness'
import type { ToolState, SubagentState } from '../types/harness'
import { useAppStore } from '../stores/useAppStore'
import PageShell from '../components/PageShell'
import MessageBubble from '../components/MessageBubble'
import ChatInput from '../components/ChatInput'
import NewChatButton from '../components/NewChatButton'
import ThreadSwitcher from '../components/ThreadSwitcher'
import TaskProgress from '../components/TaskProgress'


type ActiveChatPageProps = {
  messages: HarnessMessage[]
  onSend: () => void
  onStop: () => void
  error: Error | null
  isLoading: boolean
  isDark?: boolean
  toolStates: Map<string, ToolState>
  subagentStates: Map<string, SubagentState>
  pendingQuestion: { questionId: string; question: string; options?: { label: string; description?: string }[] } | null
  pendingToolApproval: { toolCallId: string; toolName: string; args: unknown } | null
  pendingPlanApproval: { planId: string; title: string; plan: string } | null
  tasks: TaskItem[]
  onResolveToolApproval: (decision: 'approve' | 'decline' | 'always_allow_category') => void
  onRespondToQuestion: (questionId: string, answer: string) => void
  onRespondToPlanApproval: (planId: string, response: { action: 'approved' | 'rejected'; feedback?: string }) => void
  currentModeId: string
  onSwitchMode: (modeId: string) => void
}

export default memo(function ActiveChatPage({
  messages,
  onSend,
  onStop,
  error,
  isLoading,
  isDark = true,
  toolStates,
  subagentStates,
  pendingQuestion,
  tasks,
  pendingPlanApproval,
  onResolveToolApproval,
  onRespondToQuestion,
  onRespondToPlanApproval,
  currentModeId,
  onSwitchMode,
}: ActiveChatPageProps) {
  const threadTitle = useAppStore((s) => s.threadTitle)
  const switchingThread = useAppStore((s) => s.switchingThread)
  const input = useAppStore((s) => s.input)
  const setInput = useAppStore((s) => s.setInput)
  const updateTitle = useAppStore((s) => s.updateTitle)
  const deleteThread = useAppStore((s) => s.deleteThread)
  const threadId = useAppStore((s) => s.threadId)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [showSwitcher, setShowSwitcher] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const prevMessagesLenRef = useRef(0)

  // Auto-scroll to bottom on new messages
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
            <button
              onClick={() => threadId && deleteThread(threadId)}
              className="flex items-center justify-center border border-border rounded-[10px] text-muted-dim hover:bg-card hover:text-foreground transition-colors"
              style={{ width: 36, height: 36 }}
            >
              <span className="material-icon" style={{ fontSize: 16 }}>delete</span>
            </button>
          </div>

          {/* Thread switcher dropdown */}
          {showSwitcher && <ThreadSwitcher onClose={() => setShowSwitcher(false)} />}
        </div>

        {/* Content Area: chat + optional browser preview side by side */}
        <div className="flex flex-1 min-h-0">
          {/* Main chat content */}
          <div className="flex flex-col flex-1 min-w-0">
            {/* Error bar */}
            {error && (
              <div className="flex items-center gap-2 px-12 py-2 bg-error-bg shrink-0">
                <span className="material-icon text-error" style={{ fontSize: 16 }}>error</span>
                <span className="text-error text-[13px] font-secondary flex-1">{error.message}</span>
              </div>
            )}

            {/* Messages area */}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-12 py-8 flex flex-col gap-6 min-h-0">
              {messages.length === 0 && !switchingThread && (
                <div className="text-muted text-center text-sm font-secondary flex-1 flex items-center justify-center">
                  Send a message to start working with your agent.
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
                  toolStates={toolStates}
                  subagentStates={subagentStates}
                  onResolveToolApproval={onResolveToolApproval}
                />
              ))}

              {/* Inline question prompt */}
              {pendingQuestion && (
                <QuestionPrompt
                  question={pendingQuestion}
                  onRespond={onRespondToQuestion}
                />
              )}

              {/* Plan approval prompt */}
              {pendingPlanApproval && (
                <PlanReview
                  plan={pendingPlanApproval}
                  onRespond={onRespondToPlanApproval}
                />
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Task progress (between messages and input, hidden when empty/all done) */}
            <TaskProgress tasks={tasks} />

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
                currentModeId={currentModeId}
                onModeSwitch={onSwitchMode}
              />
            </div>
          </div>

        </div>
      </div>
    </PageShell>
  )
})

// ─── Inline Question Prompt ────────────────────────────────────────────────

function QuestionPrompt({
  question,
  onRespond,
}: {
  question: { questionId: string; question: string; options?: { label: string; description?: string }[] }
  onRespond: (questionId: string, answer: string) => void
}) {
  const [freeText, setFreeText] = useState('')

  return (
    <div className="self-start w-full">
      <div className="bg-card border border-primary rounded-lg p-4 max-w-[600px]">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-icon text-primary" style={{ fontSize: 18 }}>help</span>
          <span className="font-secondary text-[14px] font-medium text-foreground">
            Coworker has a question
          </span>
        </div>
        <p className="font-secondary text-[14px] text-foreground mb-3">{question.question}</p>

        {question.options && question.options.length > 0 ? (
          <div className="flex flex-col gap-2">
            {question.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => onRespond(question.questionId, opt.label)}
                className="flex flex-col items-start bg-secondary hover:bg-background border border-border rounded-lg px-3 py-2 transition-colors"
              >
                <span className="font-secondary text-[13px] font-medium text-foreground">{opt.label}</span>
                {opt.description && (
                  <span className="font-secondary text-[11px] text-muted">{opt.description}</span>
                )}
              </button>
            ))}
            <div className="flex gap-2 mt-1">
              <input
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="Or type your answer..."
                className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 font-secondary text-[13px] text-foreground outline-none focus:border-primary"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && freeText.trim()) {
                    onRespond(question.questionId, freeText.trim())
                  }
                }}
              />
              <button
                onClick={() => freeText.trim() && onRespond(question.questionId, freeText.trim())}
                disabled={!freeText.trim()}
                className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 font-secondary text-[13px] font-semibold disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="Type your answer..."
              autoFocus
              className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 font-secondary text-[13px] text-foreground outline-none focus:border-primary"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && freeText.trim()) {
                  onRespond(question.questionId, freeText.trim())
                }
              }}
            />
            <button
              onClick={() => freeText.trim() && onRespond(question.questionId, freeText.trim())}
              disabled={!freeText.trim()}
              className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 font-secondary text-[13px] font-semibold disabled:opacity-50"
            >
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Plan Review Prompt ────────────────────────────────────────────────────

function PlanReview({
  plan,
  onRespond,
}: {
  plan: { planId: string; title: string; plan: string }
  onRespond: (planId: string, response: { action: 'approved' | 'rejected'; feedback?: string }) => void
}) {
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)

  return (
    <div className="self-start w-full">
      <div className="bg-card border border-primary rounded-lg overflow-hidden max-w-[700px]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <span className="material-icon text-primary" style={{ fontSize: 18 }}>assignment</span>
          <span className="font-secondary text-[14px] font-medium text-foreground">
            {plan.title || 'Plan Review'}
          </span>
        </div>

        <div className="px-4 py-3 max-h-[400px] overflow-y-auto">
          <pre className="font-secondary text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
            {plan.plan}
          </pre>
        </div>

        <div className="border-t border-border px-4 py-3">
          {showFeedback ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What should be changed?"
                autoFocus
                className="bg-background border border-border rounded-lg px-3 py-2 font-secondary text-[13px] text-foreground outline-none focus:border-primary resize-none"
                rows={3}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => onRespond(plan.planId, { action: 'rejected', feedback: feedback.trim() || undefined })}
                  className="bg-destructive text-white rounded-lg px-3 py-1.5 font-secondary text-[13px] font-semibold"
                >
                  Reject with Feedback
                </button>
                <button
                  onClick={() => setShowFeedback(false)}
                  className="bg-secondary text-muted rounded-lg px-3 py-1.5 font-secondary text-[13px] font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => onRespond(plan.planId, { action: 'approved' })}
                className="flex items-center gap-1 bg-primary text-primary-foreground rounded-lg px-4 py-1.5 font-secondary text-[13px] font-semibold hover:bg-primary-hover transition-colors"
              >
                <span className="material-icon" style={{ fontSize: 14 }}>check</span>
                Approve Plan
              </button>
              <button
                onClick={() => setShowFeedback(true)}
                className="flex items-center gap-1 bg-secondary text-muted rounded-lg px-4 py-1.5 font-secondary text-[13px] font-semibold hover:bg-card transition-colors"
              >
                <span className="material-icon" style={{ fontSize: 14 }}>edit</span>
                Request Changes
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
