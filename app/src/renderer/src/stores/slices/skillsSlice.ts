import type { StateCreator } from 'zustand'
import type { AppStore } from '../useAppStore'
import type { InstalledSkillInfo, SkillShBrowseItem } from '../../mastra-client'
import {
  fetchInstalledSkills,
  installSkillSh,
  removeSkillSh,
  fetchPopularSkills,
  searchSkillsSh,
} from '../../mastra-client'

export function skillKey(skill: SkillShBrowseItem): string {
  return `${skill.topSource}/${skill.id}`
}

export interface SkillsSlice {
  installedSkills: Record<string, InstalledSkillInfo>
  skillsLoaded: boolean
  installingKey: string | null

  browseSkills: SkillShBrowseItem[]
  browseLoaded: boolean
  browseLoading: boolean
  browseTotal: number
  browseLoadingMore: boolean

  loadInstalledSkills: () => Promise<void>
  installSkill: (skill: SkillShBrowseItem) => Promise<boolean>
  uninstallSkill: (skill: SkillShBrowseItem) => Promise<boolean>

  loadBrowseSkills: () => Promise<void>
  loadMoreBrowseSkills: () => Promise<void>
  searchBrowseSkills: (q: string) => Promise<void>
}

let _loadSkills: Promise<void> | null = null
let _loadBrowse: Promise<void> | null = null

export const createSkillsSlice: StateCreator<AppStore, [], [], SkillsSlice> = (set, get) => ({
  installedSkills: {},
  skillsLoaded: false,
  installingKey: null,

  browseSkills: [],
  browseLoaded: false,
  browseLoading: false,
  browseTotal: 0,
  browseLoadingMore: false,

  loadInstalledSkills: async () => {
    const fetcher = async () => {
      const res = await fetchInstalledSkills()
      const skills: Record<string, InstalledSkillInfo> = {}
      for (const s of res.skills) skills[s.name] = s
      set({ installedSkills: skills })
    }

    if (get().skillsLoaded) { fetcher().catch(() => {}); return }

    if (!_loadSkills) {
      _loadSkills = fetcher()
        .then(() => set({ skillsLoaded: true }))
        .catch(() => set({ skillsLoaded: true }))
        .finally(() => { _loadSkills = null })
    }
    return _loadSkills
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

  loadBrowseSkills: async () => {
    const fetcher = async () => {
      const { skills, count } = await fetchPopularSkills(20, 0)
      set({ browseSkills: skills, browseTotal: count })
    }

    if (get().browseLoaded) { fetcher().catch(() => {}); return }

    if (!_loadBrowse) {
      set({ browseLoading: true })
      _loadBrowse = fetcher()
        .then(() => set({ browseLoaded: true }))
        .catch(() => set({ browseLoaded: true }))
        .finally(() => {
          set({ browseLoading: false })
          _loadBrowse = null
        })
    }
    return _loadBrowse
  },

  loadMoreBrowseSkills: async () => {
    const { browseSkills, browseTotal, browseLoadingMore } = get()
    if (browseLoadingMore || browseSkills.length >= browseTotal) return
    set({ browseLoadingMore: true })
    try {
      const { skills } = await fetchPopularSkills(20, browseSkills.length)
      set((s) => ({ browseSkills: [...s.browseSkills, ...skills] }))
    } finally {
      set({ browseLoadingMore: false })
    }
  },

  searchBrowseSkills: async (q) => {
    set({ browseLoading: true })
    try {
      const { skills } = await searchSkillsSh(q)
      set({ browseSkills: skills, browseTotal: skills.length })
    } finally {
      set({ browseLoading: false })
    }
  },
})
