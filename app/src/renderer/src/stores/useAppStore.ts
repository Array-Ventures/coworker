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
import { type McpSlice, createMcpSlice } from './slices/mcpSlice'
import { type McpRegistrySlice, createMcpRegistrySlice } from './slices/mcpRegistrySlice'
import { type A2aSlice, createA2aSlice } from './slices/a2aSlice'
import { type GogSlice, createGogSlice } from './slices/gogSlice'

export type AppStore = UISlice & ChatSlice & PreferencesSlice & SkillsSlice & ScheduledTasksSlice & WhatsAppSlice & McpSlice & McpRegistrySlice & A2aSlice & GogSlice

export const useAppStore = create<AppStore>()((...a) => ({
  ...createUISlice(...a),
  ...createChatSlice(...a),
  ...createPreferencesSlice(...a),
  ...createSkillsSlice(...a),
  ...createScheduledTasksSlice(...a),
  ...createWhatsAppSlice(...a),
  ...createMcpSlice(...a),
  ...createMcpRegistrySlice(...a),
  ...createA2aSlice(...a),
  ...createGogSlice(...a),
}))
