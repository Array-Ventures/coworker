import { memo, useState, useEffect, useCallback } from 'react'
import type { ScheduledTask } from '../mastra-client'
import { useAppStore } from '../stores/useAppStore'
import PageShell from '../components/PageShell'
import FilterTabs from '../components/FilterTabs'

type ScheduleType = 'once' | 'custom' | 'daily' | 'weekly' | 'monthly'

const SCHEDULE_TABS: ScheduleType[] = ['once', 'custom', 'daily', 'weekly', 'monthly']

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function formatSchedule(task: ScheduledTask): string {
  const config = task.scheduleConfig
  if (!config) return task.cron
  const time = `${String(config.hour ?? 9).padStart(2, '0')}:${String(config.minute ?? 0).padStart(2, '0')}`
  switch (config.type) {
    case 'daily': return `Daily at ${time}`
    case 'weekly': return `Every ${DAY_NAMES[config.dayOfWeek ?? 1]} at ${time}`
    case 'monthly': return `Monthly on day ${config.dayOfMonth ?? 1} at ${time}`
    case 'custom': return `Custom: ${config.cron}`
    case 'once': return config.date ? `Once on ${config.date} at ${time}` : `Once at ${time}`
    default: return task.cron
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Empty State ──

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <span className="material-icon text-muted-dim mb-4" style={{ fontSize: 48 }}>schedule</span>
      <h2 className="font-primary text-lg font-semibold text-foreground mb-2">No Autopilot Tasks</h2>
      <p className="font-secondary text-sm text-muted max-w-[360px] mb-5">
        Put tasks on autopilot to run automatically on a schedule.
        Coworker handles them and keeps you in the loop.
      </p>
      <button
        onClick={onCreate}
        className="flex items-center gap-1.5 bg-primary text-primary-foreground border-none rounded-xl px-5 py-2.5 font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover mb-3"
      >
        <span className="material-icon" style={{ fontSize: 16 }}>add</span>
        Add your first task
      </button>
    </div>
  )
}

// ── Task List ──

function TaskList({
  tasks,
  onCreate,
  onEdit,
  onToggle,
  onDelete,
}: {
  tasks: ScheduledTask[]
  onCreate: () => void
  onEdit: (task: ScheduledTask) => void
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between h-[56px] px-6 border-b border-border">
        <h2 className="font-primary text-base font-semibold text-foreground">Autopilot</h2>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground border-none rounded-lg px-3 py-1.5 font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover"
        >
          <span className="material-icon" style={{ fontSize: 14 }}>add</span>
          New Task
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-4 bg-card rounded-xl px-4 py-3 border border-border cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => onEdit(task)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-primary text-sm font-semibold text-foreground truncate">
                    {task.name}
                  </span>
                  {!task.enabled && (
                    <span className="font-secondary text-[11px] text-muted bg-background px-1.5 py-0.5 rounded">
                      Paused
                    </span>
                  )}
                </div>
                <div className="font-secondary text-xs text-muted flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="material-icon" style={{ fontSize: 13 }}>schedule</span>
                    {formatSchedule(task)}
                  </span>
                  {task.lastRunAt && (
                    <span className="flex items-center gap-1">
                      <span className="material-icon" style={{ fontSize: 13 }}>history</span>
                      Last: {formatDate(task.lastRunAt)}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onToggle(task.id, !task.enabled) }}
                className={`relative w-10 h-[22px] rounded-full border-none cursor-pointer transition-colors ${
                  task.enabled ? 'bg-primary' : 'bg-border'
                }`}
              >
                <span
                  className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all ${
                    task.enabled ? 'left-[21px]' : 'left-[3px]'
                  }`}
                />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(task.id) }}
                className="flex items-center justify-center w-8 h-8 bg-transparent border-none rounded-lg cursor-pointer text-muted hover:text-foreground hover:bg-background transition-colors"
              >
                <span className="material-icon" style={{ fontSize: 18 }}>delete_outline</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── New Task Form ──

function NewTaskForm({
  onDismiss,
  onCreated,
}: {
  onDismiss: () => void
  onCreated: (input: { name: string; scheduleConfig: any; prompt: string; notify: boolean }) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [scheduleType, setScheduleType] = useState<ScheduleType>('daily')
  const [hour, setHour] = useState(9)
  const [minute, setMinute] = useState(0)
  const [dayOfWeek, setDayOfWeek] = useState(1)
  const [dayOfMonth, setDayOfMonth] = useState(1)
  const [customCron, setCustomCron] = useState('*/30 * * * *')
  const [onceDate, setOnceDate] = useState(() => new Date().toISOString().split('T')[0])
  const [notify, setNotify] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

  const handleTimeChange = (val: string) => {
    const [h, m] = val.split(':').map(Number)
    setHour(h)
    setMinute(m)
  }

  const handleSubmit = async () => {
    if (!name.trim() || !prompt.trim()) return
    setSubmitting(true)
    try {
      const scheduleConfig: any = { type: scheduleType, hour, minute }
      if (scheduleType === 'weekly') scheduleConfig.dayOfWeek = dayOfWeek
      if (scheduleType === 'monthly') scheduleConfig.dayOfMonth = dayOfMonth
      if (scheduleType === 'custom') scheduleConfig.cron = customCron
      if (scheduleType === 'once') scheduleConfig.date = onceDate

      await onCreated({ name: name.trim(), scheduleConfig, prompt: prompt.trim(), notify })
    } catch (err) {
      console.error('Failed to create task:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between h-[56px] px-6 border-b border-border">
        <h2 className="font-primary text-base font-semibold text-foreground">New Autopilot Task</h2>
        <button
          onClick={onDismiss}
          className="bg-transparent border-none text-muted font-secondary text-[13px] cursor-pointer hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-5 max-w-[600px]">
          {/* Task Name */}
          <div>
            <label className="font-secondary text-xs font-semibold text-foreground mb-1.5 block">
              Task Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter task name..."
              className="w-full h-10 px-3 bg-card border border-border rounded-lg font-secondary text-sm text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
            />
          </div>

          {/* Schedule */}
          <div>
            <label className="font-secondary text-xs font-semibold text-foreground mb-1.5 block">
              Schedule
            </label>
            <FilterTabs
              tabs={SCHEDULE_TABS.map((t) => t.charAt(0).toUpperCase() + t.slice(1))}
              activeTab={scheduleType.charAt(0).toUpperCase() + scheduleType.slice(1)}
              onTabChange={(tab) => setScheduleType(tab.toLowerCase() as ScheduleType)}
            />
            <div className="flex items-center gap-3 mt-3">
              {scheduleType === 'once' && (
                <input
                  type="date"
                  value={onceDate}
                  onChange={(e) => setOnceDate(e.target.value)}
                  className="h-10 px-3 bg-card border border-border rounded-lg font-secondary text-sm text-foreground outline-none focus:border-primary"
                />
              )}
              {scheduleType === 'weekly' && (
                <select
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  className="h-10 px-3 bg-card border border-border rounded-lg font-secondary text-sm text-foreground outline-none focus:border-primary"
                >
                  {DAY_NAMES.map((d, i) => (
                    <option key={i} value={i}>{d}</option>
                  ))}
                </select>
              )}
              {scheduleType === 'monthly' && (
                <select
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Number(e.target.value))}
                  className="h-10 px-3 bg-card border border-border rounded-lg font-secondary text-sm text-foreground outline-none focus:border-primary"
                >
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>Day {i + 1}</option>
                  ))}
                </select>
              )}
              {scheduleType === 'custom' ? (
                <input
                  type="text"
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  placeholder="*/30 * * * *"
                  className="flex-1 h-10 px-3 bg-card border border-border rounded-lg font-primary text-sm text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
                />
              ) : (
                <input
                  type="time"
                  value={timeStr}
                  onChange={(e) => handleTimeChange(e.target.value)}
                  className="h-10 px-3 bg-card border border-border rounded-lg font-secondary text-sm text-foreground outline-none focus:border-primary"
                />
              )}
            </div>
          </div>

          {/* Notification Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-secondary text-sm font-semibold text-foreground">Notification</div>
              <div className="font-secondary text-xs text-muted">Get notified when the task completes</div>
            </div>
            <button
              onClick={() => setNotify(!notify)}
              className={`relative w-10 h-[22px] rounded-full border-none cursor-pointer transition-colors ${
                notify ? 'bg-primary' : 'bg-border'
              }`}
            >
              <span
                className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all ${
                  notify ? 'left-[21px]' : 'left-[3px]'
                }`}
              />
            </button>
          </div>

          {/* Prompt */}
          <div>
            <label className="font-secondary text-xs font-semibold text-foreground mb-1.5 block">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should Coworker do when this run runs?"
              rows={4}
              className="w-full px-3 py-2.5 bg-card border border-border rounded-lg font-secondary text-sm text-foreground placeholder:text-muted-dim outline-none focus:border-primary resize-y"
            />
          </div>

          {/* Submit */}
          <div className="flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={submitting || !name.trim() || !prompt.trim()}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground border-none rounded-xl px-5 py-2.5 font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Edit Task Form ──

function EditTaskForm({
  task,
  onDismiss,
  onSaved,
  onDeleted,
}: {
  task: ScheduledTask
  onDismiss: () => void
  onSaved: (id: string, data: { name?: string; scheduleConfig?: any; prompt?: string; notify?: boolean }) => Promise<boolean>
  onDeleted: (id: string) => Promise<boolean>
}) {
  const config = task.scheduleConfig ?? {}
  const [name, setName] = useState(task.name)
  const [scheduleType, setScheduleType] = useState<ScheduleType>(config.type ?? 'custom')
  const [hour, setHour] = useState(config.hour ?? 9)
  const [minute, setMinute] = useState(config.minute ?? 0)
  const [dayOfWeek, setDayOfWeek] = useState(config.dayOfWeek ?? 1)
  const [dayOfMonth, setDayOfMonth] = useState(config.dayOfMonth ?? 1)
  const [customCron, setCustomCron] = useState(config.cron ?? task.cron ?? '*/30 * * * *')
  const [onceDate, setOnceDate] = useState(config.date ?? new Date().toISOString().split('T')[0])
  const [notify, setNotify] = useState(task.notify)
  const [prompt, setPrompt] = useState(task.prompt)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

  const handleTimeChange = (val: string) => {
    const [h, m] = val.split(':').map(Number)
    setHour(h)
    setMinute(m)
  }

  const handleSave = async () => {
    if (!name.trim() || !prompt.trim()) return
    setSubmitting(true)
    try {
      const scheduleConfig: any = { type: scheduleType, hour, minute }
      if (scheduleType === 'weekly') scheduleConfig.dayOfWeek = dayOfWeek
      if (scheduleType === 'monthly') scheduleConfig.dayOfMonth = dayOfMonth
      if (scheduleType === 'custom') scheduleConfig.cron = customCron
      if (scheduleType === 'once') scheduleConfig.date = onceDate

      await onSaved(task.id, {
        name: name.trim(),
        scheduleConfig,
        prompt: prompt.trim(),
        notify,
      })
    } catch (err) {
      console.error('Failed to update task:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await onDeleted(task.id)
    } catch (err) {
      console.error('Failed to delete task:', err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between h-[56px] px-6 border-b border-border">
        <h2 className="font-primary text-base font-semibold text-foreground">Edit Task</h2>
        <button
          onClick={onDismiss}
          className="bg-transparent border-none text-muted font-secondary text-[13px] cursor-pointer hover:text-foreground"
        >
          Back
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-5 max-w-[600px]">
          {/* Task Name */}
          <div>
            <label className="font-secondary text-xs font-semibold text-foreground mb-1.5 block">
              Task Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter task name..."
              className="w-full h-10 px-3 bg-card border border-border rounded-lg font-secondary text-sm text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
            />
          </div>

          {/* Schedule */}
          <div>
            <label className="font-secondary text-xs font-semibold text-foreground mb-1.5 block">
              Schedule
            </label>
            <FilterTabs
              tabs={SCHEDULE_TABS.map((t) => t.charAt(0).toUpperCase() + t.slice(1))}
              activeTab={scheduleType.charAt(0).toUpperCase() + scheduleType.slice(1)}
              onTabChange={(tab) => setScheduleType(tab.toLowerCase() as ScheduleType)}
            />
            <div className="flex items-center gap-3 mt-3">
              {scheduleType === 'once' && (
                <input
                  type="date"
                  value={onceDate}
                  onChange={(e) => setOnceDate(e.target.value)}
                  className="h-10 px-3 bg-card border border-border rounded-lg font-secondary text-sm text-foreground outline-none focus:border-primary"
                />
              )}
              {scheduleType === 'weekly' && (
                <select
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  className="h-10 px-3 bg-card border border-border rounded-lg font-secondary text-sm text-foreground outline-none focus:border-primary"
                >
                  {DAY_NAMES.map((d, i) => (
                    <option key={i} value={i}>{d}</option>
                  ))}
                </select>
              )}
              {scheduleType === 'monthly' && (
                <select
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Number(e.target.value))}
                  className="h-10 px-3 bg-card border border-border rounded-lg font-secondary text-sm text-foreground outline-none focus:border-primary"
                >
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>Day {i + 1}</option>
                  ))}
                </select>
              )}
              {scheduleType === 'custom' ? (
                <input
                  type="text"
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  placeholder="*/30 * * * *"
                  className="flex-1 h-10 px-3 bg-card border border-border rounded-lg font-primary text-sm text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
                />
              ) : (
                <input
                  type="time"
                  value={timeStr}
                  onChange={(e) => handleTimeChange(e.target.value)}
                  className="h-10 px-3 bg-card border border-border rounded-lg font-secondary text-sm text-foreground outline-none focus:border-primary"
                />
              )}
            </div>
          </div>

          {/* Notification Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-secondary text-sm font-semibold text-foreground">Notification</div>
              <div className="font-secondary text-xs text-muted">Get notified when the task completes</div>
            </div>
            <button
              onClick={() => setNotify(!notify)}
              className={`relative w-10 h-[22px] rounded-full border-none cursor-pointer transition-colors ${
                notify ? 'bg-primary' : 'bg-border'
              }`}
            >
              <span
                className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all ${
                  notify ? 'left-[21px]' : 'left-[3px]'
                }`}
              />
            </button>
          </div>

          {/* Prompt */}
          <div>
            <label className="font-secondary text-xs font-semibold text-foreground mb-1.5 block">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should Coworker do when this task runs?"
              rows={4}
              className="w-full px-3 py-2.5 bg-card border border-border rounded-lg font-secondary text-sm text-foreground placeholder:text-muted-dim outline-none focus:border-primary resize-y"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 bg-transparent border border-red-500 text-red-500 rounded-xl px-5 py-2.5 font-secondary text-[13px] font-semibold cursor-pointer hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-icon" style={{ fontSize: 16 }}>delete_outline</span>
              {deleting ? 'Deleting...' : 'Delete Task'}
            </button>
            <button
              onClick={handleSave}
              disabled={submitting || !name.trim() || !prompt.trim()}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground border-none rounded-xl px-5 py-2.5 font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Page ──

export default memo(function ScheduledTasksPage() {
  const scheduledTasks = useAppStore((s) => s.scheduledTasks)
  const tasksLoaded = useAppStore((s) => s.tasksLoaded)
  const loadScheduledTasks = useAppStore((s) => s.loadScheduledTasks)
  const storeCreateTask = useAppStore((s) => s.createTask)
  const storeUpdateTask = useAppStore((s) => s.updateTask)
  const storeDeleteTask = useAppStore((s) => s.deleteTask)
  const storeToggleTask = useAppStore((s) => s.toggleTask)

  const [view, setView] = useState<'list' | 'new' | 'edit'>('list')
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null)

  const taskList = Object.values(scheduledTasks)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  useEffect(() => {
    if (!tasksLoaded) loadScheduledTasks()
  }, [tasksLoaded, loadScheduledTasks])

  const handleCreated = useCallback(
    async (input: { name: string; scheduleConfig: any; prompt: string; notify: boolean }) => {
      const ok = await storeCreateTask(input)
      if (ok) setView('list')
      return ok
    },
    [storeCreateTask],
  )

  const handleSaved = useCallback(
    async (id: string, data: { name?: string; scheduleConfig?: any; prompt?: string; notify?: boolean }) => {
      const ok = await storeUpdateTask(id, data)
      if (ok) {
        setEditingTask(null)
        setView('list')
      }
      return ok
    },
    [storeUpdateTask],
  )

  const handleDeleted = useCallback(
    async (id: string) => {
      const ok = await storeDeleteTask(id)
      if (ok) {
        setEditingTask(null)
        setView('list')
      }
      return ok
    },
    [storeDeleteTask],
  )

  if (!tasksLoaded) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-full">
          <span className="material-icon text-muted-dim animate-spin" style={{ fontSize: 24 }}>progress_activity</span>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      {view === 'new' ? (
        <NewTaskForm onDismiss={() => setView('list')} onCreated={handleCreated} />
      ) : view === 'edit' && editingTask ? (
        <EditTaskForm
          task={editingTask}
          onDismiss={() => { setEditingTask(null); setView('list') }}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      ) : taskList.length === 0 ? (
        <EmptyState onCreate={() => setView('new')} />
      ) : (
        <TaskList
          tasks={taskList}
          onCreate={() => setView('new')}
          onEdit={(task) => { setEditingTask(task); setView('edit') }}
          onToggle={storeToggleTask}
          onDelete={storeDeleteTask}
        />
      )}
    </PageShell>
  )
})
