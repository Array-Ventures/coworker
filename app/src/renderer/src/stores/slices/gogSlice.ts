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

export const createGogSlice: StateCreator<AppStore, [], [], GogSlice> = (set, get) => ({
  gogInstalled: false,
  gogAccounts: [],
  gogLoaded: false,
  gogAuthUrl: null,
  gogAuthEmail: null,
  gogAuthError: null,

  loadGogStatus: async () => {
    try {
      const { installed, accounts } = await fetchGogStatus()
      set({ gogInstalled: installed, gogAccounts: accounts, gogLoaded: true })
    } catch {
      set({ gogLoaded: true })
    }
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
        set({ gogAuthUrl: null, gogAuthEmail: null, gogAuthError: null })
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
    await get().loadGogStatus()
  },

  gogClearAuth: () => {
    set({ gogAuthUrl: null, gogAuthEmail: null, gogAuthError: null })
  },
})
