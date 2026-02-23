import { memo, useState } from 'react'
import type { TaskItem } from '../types/harness'

interface TaskProgressProps {
  tasks: TaskItem[]
}

export default memo(function TaskProgress({ tasks }: TaskProgressProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (tasks.length === 0) return null

  const completed = tasks.filter(t => t.status === 'completed').length
  const total = tasks.length

  // Hide when all tasks are completed
  if (completed === total) return null

  return (
    <div className="px-12 py-2 shrink-0 border-t border-border">
      {/* Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span className="material-icon text-muted" style={{ fontSize: 16 }}>checklist</span>
        <span className="text-[13px] font-secondary font-medium text-foreground">
          Tasks
        </span>
        <span className="text-[13px] font-secondary text-muted-dim font-normal">
          [{completed}/{total}]
        </span>
        <span className="material-icon text-muted-dim ml-auto" style={{ fontSize: 16 }}>
          {collapsed ? 'expand_more' : 'expand_less'}
        </span>
      </button>

      {/* Task list */}
      {!collapsed && (
        <div className="flex flex-col gap-0.5 mt-1.5 max-h-[120px] overflow-y-auto">
          {tasks.map((task, i) => (
            <TaskLine key={i} task={task} />
          ))}
        </div>
      )}
    </div>
  )
})

function TaskLine({ task }: { task: TaskItem }) {
  switch (task.status) {
    case 'completed':
      return (
        <div className="flex items-center gap-2 text-[12px] font-secondary pl-1">
          <span className="material-icon text-green-500" style={{ fontSize: 14 }}>check_circle</span>
          <span className="text-green-500/70 line-through">{task.content}</span>
        </div>
      )
    case 'in_progress':
      return (
        <div className="flex items-center gap-2 text-[12px] font-secondary pl-1">
          <span className="material-icon text-yellow-500 animate-pulse" style={{ fontSize: 14 }}>play_circle</span>
          <span className="text-yellow-500 font-medium">{task.activeForm}</span>
        </div>
      )
    case 'pending':
      return (
        <div className="flex items-center gap-2 text-[12px] font-secondary pl-1">
          <span className="material-icon text-muted-dim" style={{ fontSize: 14 }}>radio_button_unchecked</span>
          <span className="text-muted-dim">{task.content}</span>
        </div>
      )
  }
}
