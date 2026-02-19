import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'
import {
  fetchGhStatus,
  ghStartAuth as apiGhStartAuth,
  ghPollAuth as apiGhPollAuth,
  ghLogout as apiGhLogout,
} from '../../mastra-client'

export interface GhSlice {
  ghInstalled: boolean
  ghLoggedIn: boolean
  ghUsername: string | null
  ghLoaded: boolean
  ghAuthInProgress: boolean
  ghUserCode: string | null
  ghAuthUrl: string | null
  ghAuthError: string | null

  loadGhStatus: () => Promise<void>
  ghStartLogin: () => Promise<void>
  ghPollAuthStatus: () => Promise<boolean>
  ghDoLogout: () => Promise<void>
  ghClearAuth: () => void
}

let _loadGh: Promise<void> | null = null

export const createGhSlice: StateCreator<AppStore, [], [], GhSlice> = (set, get) => ({
  ghInstalled: false,
  ghLoggedIn: false,
  ghUsername: null,
  ghLoaded: false,
  ghAuthInProgress: false,
  ghUserCode: null,
  ghAuthUrl: null,
  ghAuthError: null,

  loadGhStatus: async () => {
    const fetcher = async () => {
      const { installed, loggedIn, username } = await fetchGhStatus()
      set({ ghInstalled: installed, ghLoggedIn: loggedIn, ghUsername: username || null })
    }

    if (get().ghLoaded) { fetcher().catch(() => {}); return }

    if (!_loadGh) {
      _loadGh = fetcher()
        .then(() => set({ ghLoaded: true }))
        .catch(() => set({ ghLoaded: true }))
        .finally(() => { _loadGh = null })
    }
    return _loadGh
  },

  ghStartLogin: async () => {
    set({ ghAuthInProgress: true, ghAuthError: null, ghUserCode: null, ghAuthUrl: null })
    try {
      const { userCode, authUrl } = await apiGhStartAuth()
      set({ ghUserCode: userCode, ghAuthUrl: authUrl })
    } catch (err: any) {
      set({ ghAuthError: err.message || 'Failed to start auth', ghAuthInProgress: false })
    }
  },

  ghPollAuthStatus: async () => {
    try {
      const result = await apiGhPollAuth()
      if (result.ok) {
        set({
          ghLoggedIn: true,
          ghUsername: result.username || null,
          ghAuthInProgress: false,
          ghUserCode: null,
          ghAuthUrl: null,
          ghAuthError: null,
        })
        return true
      }
      return false
    } catch {
      return false
    }
  },

  ghDoLogout: async () => {
    try {
      await apiGhLogout()
      set({ ghLoggedIn: false, ghUsername: null })
    } catch {
      // ignore
    }
  },

  ghClearAuth: () => {
    set({
      ghAuthInProgress: false,
      ghUserCode: null,
      ghAuthUrl: null,
      ghAuthError: null,
    })
  },
})
