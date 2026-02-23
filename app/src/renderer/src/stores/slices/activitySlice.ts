import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'

export type ActivityFilter = 'all' | 'needs-input' | 'running'

export interface ActivitySlice {
  activityFilter: ActivityFilter
  dismissedNotifications: Set<string>

  setActivityFilter: (filter: ActivityFilter) => void
  dismissNotification: (key: string) => void
  clearDismissed: () => void
}

export const createActivitySlice: StateCreator<AppStore, [], [], ActivitySlice> = (set) => ({
  activityFilter: 'all',
  dismissedNotifications: new Set(),

  setActivityFilter: (filter) => set({ activityFilter: filter }),

  dismissNotification: (key) =>
    set((s) => {
      const next = new Set(s.dismissedNotifications)
      next.add(key)
      return { dismissedNotifications: next }
    }),

  clearDismissed: () => set({ dismissedNotifications: new Set() }),
})
