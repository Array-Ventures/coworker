import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'
import type { ScheduledTask } from '../../mastra-client'
import {
  fetchScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  toggleScheduledTask,
} from '../../mastra-client'

export interface ScheduledTasksSlice {
  scheduledTasks: Record<string, ScheduledTask>
  tasksLoaded: boolean

  loadScheduledTasks: () => Promise<void>
  createTask: (input: {
    name: string
    scheduleConfig: any
    prompt: string
    notify?: boolean
  }) => Promise<boolean>
  updateTask: (
    id: string,
    data: { name?: string; scheduleConfig?: any; prompt?: string; notify?: boolean },
  ) => Promise<boolean>
  deleteTask: (id: string) => Promise<boolean>
  toggleTask: (id: string, enabled: boolean) => Promise<boolean>
}

export const createScheduledTasksSlice: StateCreator<AppStore, [], [], ScheduledTasksSlice> = (
  set,
  get,
) => ({
  scheduledTasks: {},
  tasksLoaded: false,

  loadScheduledTasks: async () => {
    const items = await fetchScheduledTasks()
    const record: Record<string, ScheduledTask> = {}
    for (const t of items) record[t.id] = t
    set({ scheduledTasks: record, tasksLoaded: true })
  },

  createTask: async (input) => {
    try {
      const task = await createScheduledTask(input)
      set((state) => ({
        scheduledTasks: { ...state.scheduledTasks, [task.id]: task },
      }))
      return true
    } catch {
      return false
    }
  },

  updateTask: async (id, data) => {
    try {
      const task = await updateScheduledTask(id, data)
      set((state) => ({
        scheduledTasks: { ...state.scheduledTasks, [task.id]: task },
      }))
      return true
    } catch {
      return false
    }
  },

  deleteTask: async (id) => {
    const prev = get().scheduledTasks
    const { [id]: _, ...rest } = prev
    set({ scheduledTasks: rest })
    try {
      await deleteScheduledTask(id)
      return true
    } catch {
      set({ scheduledTasks: prev })
      return false
    }
  },

  toggleTask: async (id, enabled) => {
    const prev = get().scheduledTasks
    const task = prev[id]
    if (!task) return false
    set((state) => ({
      scheduledTasks: { ...state.scheduledTasks, [id]: { ...task, enabled } },
    }))
    try {
      await toggleScheduledTask(id, enabled)
      return true
    } catch {
      set({ scheduledTasks: prev })
      return false
    }
  },
})
