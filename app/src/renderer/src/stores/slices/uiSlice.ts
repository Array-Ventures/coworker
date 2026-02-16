import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'

export interface UISlice {
  currentPage: string
  sidebarCollapsed: boolean
  showCommandPalette: boolean
  navigate: (page: string) => void
  toggleSidebar: () => void
  setShowCommandPalette: (show: boolean) => void
  toggleCommandPalette: () => void
}

export const createUISlice: StateCreator<AppStore, [], [], UISlice> = (set) => ({
  currentPage: 'home',
  sidebarCollapsed: true,
  showCommandPalette: false,
  navigate: (page) => set({ currentPage: page }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  toggleCommandPalette: () => set((s) => ({ showCommandPalette: !s.showCommandPalette })),
})
