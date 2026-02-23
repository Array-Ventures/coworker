import { memo, useMemo, useCallback } from 'react'
import { useAppStore } from '../stores/useAppStore'
import type { BackgroundNotification } from '../hooks/useHarness'
import type { ActivityFilter } from '../stores/slices/activitySlice'
import PageShell from '../components/PageShell'
import FilterTabs from '../components/FilterTabs'
import { QuestionCard, PlanApprovalCard, ToolApprovalCard, RunningCard } from '../components/activity'

type ActivityPageProps = {
  backgroundNotifications: BackgroundNotification[]
  activeThreads: Map<string, { running: boolean; channel: string }>
  onRespondToQuestion: (threadId: string, questionId: string, answer: string) => void
  onRespondToToolApproval: (threadId: string, decision: 'approve' | 'decline' | 'always_allow_category') => void
  onRespondToPlanApproval: (threadId: string, planId: string, response: { action: 'approved' | 'rejected'; feedback?: string }) => void
}

const filterTabs = [
  { label: 'All', icon: 'list' },
  { label: 'Needs Input', icon: 'help' },
  { label: 'Running', icon: 'play_arrow' },
]

const filterMap: Record<string, ActivityFilter> = {
  'All': 'all',
  'Needs Input': 'needs-input',
  'Running': 'running',
}

const reverseFilterMap: Record<ActivityFilter, string> = {
  'all': 'All',
  'needs-input': 'Needs Input',
  'running': 'Running',
}

function notificationKey(n: BackgroundNotification): string {
  return `${n.threadId}:${n.type}`
}

function channelFromThreadId(threadId: string): string {
  if (threadId.startsWith('whatsapp-')) return 'WhatsApp'
  if (threadId.startsWith('scheduled-')) return 'Scheduled'
  if (threadId.startsWith('email-')) return 'Email'
  if (threadId.startsWith('api-')) return 'API'
  return 'App'
}

export default memo(function ActivityPage({
  backgroundNotifications,
  activeThreads,
  onRespondToQuestion,
  onRespondToToolApproval,
  onRespondToPlanApproval,
}: ActivityPageProps) {
  const activityFilter = useAppStore((s) => s.activityFilter)
  const setActivityFilter = useAppStore((s) => s.setActivityFilter)
  const dismissedNotifications = useAppStore((s) => s.dismissedNotifications)
  const dismissNotification = useAppStore((s) => s.dismissNotification)
  const clearDismissed = useAppStore((s) => s.clearDismissed)
  const openThread = useAppStore((s) => s.openThread)
  const threads = useAppStore((s) => s.threads)

  const threadTitleMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of threads) {
      map.set(t.id, t.title || 'Untitled')
    }
    return map
  }, [threads])

  const handleFilterChange = useCallback((label: string) => {
    setActivityFilter(filterMap[label] ?? 'all')
  }, [setActivityFilter])

  // Filter notifications by dismissed state
  const visibleNotifications = useMemo(() => {
    return backgroundNotifications.filter(
      (n) => !dismissedNotifications.has(notificationKey(n))
    )
  }, [backgroundNotifications, dismissedNotifications])

  // Running threads (exclude current thread — that's shown in ActiveChatPage)
  const runningThreadIds = useMemo(() => {
    const ids: string[] = []
    activeThreads.forEach((state, threadId) => {
      if (state.running) ids.push(threadId)
    })
    return ids
  }, [activeThreads])

  // Apply filter
  const needsInputNotifications = useMemo(
    () => visibleNotifications.filter((n) => n.type === 'ask_question' || n.type === 'tool_approval' || n.type === 'plan_approval'),
    [visibleNotifications],
  )

  const filteredNotifications = activityFilter === 'needs-input'
    ? needsInputNotifications
    : activityFilter === 'all'
      ? visibleNotifications
      : []

  const filteredRunning = activityFilter === 'running' || activityFilter === 'all'
    ? runningThreadIds
    : []

  const totalCount = needsInputNotifications.length + runningThreadIds.length
  const isEmpty = filteredNotifications.length === 0 && filteredRunning.length === 0

  return (
    <PageShell>
      <div className="flex flex-col h-full">
        {/* Top bar */}
        <div className="flex items-center justify-between h-[52px] px-6 border-b border-border shrink-0">
          <h1 className="text-base font-semibold text-foreground font-secondary">Activity</h1>
          {totalCount > 0 && (
            <button
              onClick={clearDismissed}
              className="text-xs text-muted font-secondary bg-transparent border-none cursor-pointer hover:text-foreground transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Filter row */}
        <div className="flex items-center h-12 px-6 shrink-0">
          <FilterTabs
            tabs={filterTabs}
            activeTab={reverseFilterMap[activityFilter]}
            onTabChange={handleFilterChange}
          />
        </div>

        {/* Notification list */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <div className="flex flex-col gap-0.5">
            {/* Needs-input cards first */}
            {filteredNotifications.map((n) => {
              const key = notificationKey(n)
              const title = threadTitleMap.get(n.threadId) ?? 'Untitled'
              const channel = channelFromThreadId(n.threadId)
              const handleOpen = () => openThread(n.threadId)
              const handleDismiss = () => dismissNotification(key)

              if (n.type === 'ask_question') {
                const data = n.data as { questionId: string; question: string; options?: { label: string; description?: string }[] }
                return (
                  <QuestionCard
                    key={key}
                    channel={channel}
                    time="Now"
                    threadTitle={title}
                    question={data.question}
                    options={data.options}
                    onOpen={handleOpen}
                    onDismiss={handleDismiss}
                  />
                )
              }

              if (n.type === 'tool_approval') {
                const data = n.data as { toolCallId: string; toolName: string; args: unknown }
                return (
                  <ToolApprovalCard
                    key={key}
                    channel={channel}
                    time="Now"
                    threadTitle={title}
                    toolName={data.toolName}
                    toolArgs={data.args}
                    onApprove={() => onRespondToToolApproval(n.threadId, 'approve')}
                    onAlwaysAllow={() => onRespondToToolApproval(n.threadId, 'always_allow_category')}
                    onDecline={() => onRespondToToolApproval(n.threadId, 'decline')}
                  />
                )
              }

              if (n.type === 'plan_approval') {
                const data = n.data as { planId: string; title: string; plan: string }
                return (
                  <PlanApprovalCard
                    key={key}
                    channel={channel}
                    time="Now"
                    threadTitle={title}
                    planTitle={data.title}
                    planSummary={data.plan}
                    onApprove={() => onRespondToPlanApproval(n.threadId, data.planId, { action: 'approved' })}
                    onReject={() => onRespondToPlanApproval(n.threadId, data.planId, { action: 'rejected' })}
                    onOpen={handleOpen}
                  />
                )
              }

              return null
            })}

            {/* Running thread cards */}
            {filteredRunning.map((threadId) => (
              <RunningCard
                key={`running:${threadId}`}
                channel={channelFromThreadId(threadId)}
                threadTitle={threadTitleMap.get(threadId) ?? 'Untitled'}
                onOpen={() => openThread(threadId)}
              />
            ))}
          </div>

          {/* Empty state */}
          {isEmpty && (
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <span className="material-icon text-muted" style={{ fontSize: 48 }}>notifications_none</span>
              <p className="mt-4 text-sm text-muted font-secondary">No activity</p>
              <p className="mt-1 text-xs text-muted font-secondary">
                Notifications from background threads will appear here.
              </p>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
})
