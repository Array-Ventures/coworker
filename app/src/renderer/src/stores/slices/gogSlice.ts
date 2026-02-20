import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'
import type { GogAccount } from '../../mastra-client'
import {
  fetchGogStatus,
  startGogAuth as apiStartGogAuth,
  completeGogAuth as apiCompleteGogAuth,
  testGogAccount as apiTestGogAccount,
  removeGogAccount as apiRemoveGogAccount,
} from '../../mastra-client'

export interface GogSlice {
  gogInstalled: boolean
  gogConfigured: boolean
  gogAccounts: GogAccount[]
  gogLoaded: boolean
  gogAuthUrl: string | null
  gogAuthEmail: string | null
  gogAuthError: string | null

  loadGogStatus: () => Promise<void>
  gogStartAuth: (email: string, services?: string) => Promise<void>
  gogCompleteAuth: (email: string, redirectUrl: string, services?: string) => Promise<void>
  gogTestAccount: (email: string) => Promise<{ ok: boolean; error?: string }>
  gogRemoveAccount: (email: string) => Promise<void>
  gogClearAuth: () => void
}

let _loadGog: Promise<void> | null = null

export const createGogSlice: StateCreator<AppStore, [], [], GogSlice> = (set, get) => ({
  gogInstalled: false,
  gogConfigured: false,
  gogAccounts: [],
  gogLoaded: false,
  gogAuthUrl: null,
  gogAuthEmail: null,
  gogAuthError: null,

  loadGogStatus: async () => {
    const fetcher = async () => {
      const { installed, configured, accounts } = await fetchGogStatus()
      set({ gogInstalled: installed, gogConfigured: configured, gogAccounts: accounts })
    }

    if (get().gogLoaded) { fetcher().catch(() => {}); return }

    if (!_loadGog) {
      _loadGog = fetcher()
        .then(() => set({ gogLoaded: true }))
        .catch(() => set({ gogLoaded: true }))
        .finally(() => { _loadGog = null })
    }
    return _loadGog
  },

  gogStartAuth: async (email, services) => {
    set({ gogAuthEmail: email, gogAuthError: null, gogAuthUrl: null })
    try {
      const { authUrl } = await apiStartGogAuth(email, services)
      set({ gogAuthUrl: authUrl })
    } catch (err: any) {
      set({ gogAuthError: err.message || 'Failed to start auth', gogAuthEmail: null })
    }
  },

  gogCompleteAuth: async (email, redirectUrl, services) => {
    set({ gogAuthError: null })
    try {
      const result = await apiCompleteGogAuth(email, redirectUrl, services)
      if (result.ok) {
        set({ gogAuthUrl: null, gogAuthEmail: null, gogAuthError: null, gogLoaded: false })
        await get().loadGogStatus()
      } else {
        set({ gogAuthError: result.error || 'Authorization failed' })
      }
    } catch (err: any) {
      set({ gogAuthError: err.message || 'Failed to complete auth' })
    }
  },

  gogTestAccount: async (email) => {
    return apiTestGogAccount(email)
  },

  gogRemoveAccount: async (email) => {
    await apiRemoveGogAccount(email)
    set({ gogLoaded: false })
    await get().loadGogStatus()
  },

  gogClearAuth: () => {
    set({ gogAuthUrl: null, gogAuthEmail: null, gogAuthError: null })
  },
})
