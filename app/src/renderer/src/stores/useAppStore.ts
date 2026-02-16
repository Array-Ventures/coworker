import { create } from 'zustand'
import { type UISlice, createUISlice } from './slices/uiSlice'
import { type ChatSlice, createChatSlice } from './slices/chatSlice'
import { type PreferencesSlice, createPreferencesSlice } from './slices/preferencesSlice'
import { type SkillsSlice, createSkillsSlice } from './slices/skillsSlice'
import {
  type ScheduledTasksSlice,
  createScheduledTasksSlice,
} from './slices/scheduledTasksSlice'
import { type WhatsAppSlice, createWhatsAppSlice } from './slices/whatsappSlice'

export type AppStore = UISlice & ChatSlice & PreferencesSlice & SkillsSlice & ScheduledTasksSlice & WhatsAppSlice

export const useAppStore = create<AppStore>()((...a) => ({
  ...createUISlice(...a),
  ...createChatSlice(...a),
  ...createPreferencesSlice(...a),
  ...createSkillsSlice(...a),
  ...createScheduledTasksSlice(...a),
  ...createWhatsAppSlice(...a),
}))
