import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'

export interface PreferencesSlice {}

export const createPreferencesSlice: StateCreator<AppStore, [], [], PreferencesSlice> = () => ({})
