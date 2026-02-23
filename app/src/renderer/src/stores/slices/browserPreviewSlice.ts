import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'

export interface BrowserPreviewMeta {
  deviceWidth: number
  deviceHeight: number
  scrollOffsetX: number
  scrollOffsetY: number
}

export interface BrowserPreviewSlice {
  browserPreviewOpen: boolean
  browserPreviewConnected: boolean
  browserPreviewFrame: string | null
  browserPreviewMeta: BrowserPreviewMeta | null
  browserPreviewPort: number

  toggleBrowserPreview: () => void
  setBrowserPreviewOpen: (open: boolean) => void
  setBrowserPreviewConnected: (connected: boolean) => void
  setBrowserPreviewFrame: (data: string, meta: BrowserPreviewMeta) => void
  clearBrowserPreview: () => void
}

export const createBrowserPreviewSlice: StateCreator<AppStore, [], [], BrowserPreviewSlice> = (set) => ({
  browserPreviewOpen: false,
  browserPreviewConnected: false,
  browserPreviewFrame: null,
  browserPreviewMeta: null,
  browserPreviewPort: 9223,

  toggleBrowserPreview: () => set((s) => ({ browserPreviewOpen: !s.browserPreviewOpen })),
  setBrowserPreviewOpen: (open) => set({ browserPreviewOpen: open }),
  setBrowserPreviewConnected: (connected) => set({ browserPreviewConnected: connected }),
  setBrowserPreviewFrame: (data, meta) => set({ browserPreviewFrame: data, browserPreviewMeta: meta }),
  clearBrowserPreview: () => set({
    browserPreviewOpen: false,
    browserPreviewConnected: false,
    browserPreviewFrame: null,
    browserPreviewMeta: null,
  }),
})
