import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'
import type { WhatsAppStatus, AllowlistEntry } from '../../mastra-client'
import {
  fetchWhatsAppStatus,
  connectWhatsApp,
  disconnectWhatsApp,
  logoutWhatsApp,
  fetchWhatsAppAllowlist,
  addToWhatsAppAllowlist,
  removeFromWhatsAppAllowlist,
  approveWhatsAppPairing,
} from '../../mastra-client'

export interface WhatsAppSlice {
  waStatus: WhatsAppStatus
  waAllowlist: AllowlistEntry[]
  waLoaded: boolean
  waPollingTimer: ReturnType<typeof setInterval> | null

  loadWhatsAppStatus: () => Promise<void>
  startWaPolling: () => void
  stopWaPolling: () => void
  waConnect: () => Promise<void>
  waDisconnect: () => Promise<void>
  waLogout: () => Promise<void>
  loadWaAllowlist: () => Promise<void>
  waAddAllowlist: (phone: string, label?: string) => Promise<void>
  waRemoveAllowlist: (phone: string) => Promise<void>
  waPair: (code: string) => Promise<{ ok: boolean; error?: string }>
}

export const createWhatsAppSlice: StateCreator<AppStore, [], [], WhatsAppSlice> = (set, get) => ({
  waStatus: { status: 'disconnected', qrDataUrl: null, connectedPhone: null },
  waAllowlist: [],
  waLoaded: false,
  waPollingTimer: null,

  loadWhatsAppStatus: async () => {
    try {
      const status = await fetchWhatsAppStatus()
      set({ waStatus: status, waLoaded: true })
    } catch {
      set({ waLoaded: true })
    }
  },

  startWaPolling: () => {
    const existing = get().waPollingTimer
    if (existing) return
    const timer = setInterval(async () => {
      try {
        const status = await fetchWhatsAppStatus()
        set({ waStatus: status })
      } catch {
        // ignore polling errors
      }
    }, 2000)
    set({ waPollingTimer: timer })
  },

  stopWaPolling: () => {
    const timer = get().waPollingTimer
    if (timer) {
      clearInterval(timer)
      set({ waPollingTimer: null })
    }
  },

  waConnect: async () => {
    const status = await connectWhatsApp()
    set({ waStatus: status })
    get().startWaPolling()
  },

  waDisconnect: async () => {
    get().stopWaPolling()
    const status = await disconnectWhatsApp()
    set({ waStatus: status })
  },

  waLogout: async () => {
    get().stopWaPolling()
    await logoutWhatsApp()
    set({ waStatus: { status: 'disconnected', qrDataUrl: null, connectedPhone: null } })
  },

  loadWaAllowlist: async () => {
    try {
      const items = await fetchWhatsAppAllowlist()
      set({ waAllowlist: items })
    } catch {
      // ignore
    }
  },

  waAddAllowlist: async (phone, label) => {
    const items = await addToWhatsAppAllowlist(phone, label)
    set({ waAllowlist: items })
  },

  waRemoveAllowlist: async (phone) => {
    await removeFromWhatsAppAllowlist(phone)
    const items = await fetchWhatsAppAllowlist()
    set({ waAllowlist: items })
  },

  waPair: async (code) => {
    const result = await approveWhatsAppPairing(code)
    if (result.ok && result.items) {
      set({ waAllowlist: result.items })
    }
    return { ok: result.ok, error: result.error }
  },
})
