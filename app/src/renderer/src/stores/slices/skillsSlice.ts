import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'
import type { InstalledSkillInfo, SkillShBrowseItem } from '../../mastra-client'
import { fetchInstalledSkills, installSkillSh, removeSkillSh } from '../../mastra-client'

export function skillKey(skill: SkillShBrowseItem): string {
  return `${skill.topSource}/${skill.id}`
}

export interface SkillsSlice {
  installedSkills: Record<string, InstalledSkillInfo>
  installingKey: string | null

  loadInstalledSkills: () => Promise<void>
  installSkill: (skill: SkillShBrowseItem) => Promise<boolean>
  uninstallSkill: (skill: SkillShBrowseItem) => Promise<boolean>
}

export const createSkillsSlice: StateCreator<AppStore, [], [], SkillsSlice> = (set, get) => ({
  installedSkills: {},
  installingKey: null,

  loadInstalledSkills: async () => {
    const res = await fetchInstalledSkills()
    const skills: Record<string, InstalledSkillInfo> = {}
    for (const s of res.skills) skills[s.name] = s
    set({ installedSkills: skills })
  },

  installSkill: async (skill) => {
    set({ installingKey: skillKey(skill) })
    try {
      const [owner, repo] = skill.topSource.split('/')
      const res = await installSkillSh(owner, repo, skill.id)
      if (res.success) {
        await get().loadInstalledSkills()
        return true
      }
      return false
    } catch {
      return false
    } finally {
      set({ installingKey: null })
    }
  },

  uninstallSkill: async (skill) => {
    set({ installingKey: skillKey(skill) })
    try {
      const res = await removeSkillSh(skill.id)
      if (res.success) {
        const { [skill.id]: _, ...rest } = get().installedSkills
        set({ installedSkills: rest })
        return true
      }
      return false
    } catch {
      return false
    } finally {
      set({ installingKey: null })
    }
  },
})
