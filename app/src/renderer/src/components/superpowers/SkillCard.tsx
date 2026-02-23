import { memo } from 'react'
import type { SkillShBrowseItem } from '../../mastra-client'
import { titleCase, formatCount } from './utils'

const SkillCard = memo(function SkillCard({
  skill,
  installed,
  isBusy,
  onInstall,
  onUninstall,
}: {
  skill: SkillShBrowseItem
  installed: boolean
  isBusy: boolean
  onInstall: () => void
  onUninstall: () => void
}) {
  return (
    <div className="flex items-center gap-3 border border-border rounded-xl px-4 py-3 bg-card">
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-background shrink-0">
        <span className="material-icon text-muted" style={{ fontSize: 20 }}>extension</span>
      </div>
      <div className="flex-1 min-w-0">
        <span className="font-secondary text-[13px] font-semibold text-foreground">
          {titleCase(skill.name)}
        </span>
        {skill.topSource && (
          <div className="font-secondary text-[11px] text-muted-dim truncate">{skill.topSource}</div>
        )}
        {skill.installs > 0 && (
          <div className="flex items-center gap-1 mt-0.5">
            <span className="material-icon text-muted-dim" style={{ fontSize: 13 }}>download</span>
            <span className="font-secondary text-[11px] font-medium text-muted-dim">
              {formatCount(skill.installs)}
            </span>
          </div>
        )}
      </div>
      {installed ? (
        <button
          onClick={onUninstall}
          disabled={isBusy}
          className="shrink-0 bg-red-500/8 border border-red-500/25 rounded-md text-red-400 px-3 py-1 font-secondary text-[12px] cursor-pointer hover:bg-red-500/15 hover:border-red-500/40 disabled:opacity-50 disabled:cursor-default"
        >
          {isBusy ? 'Removing...' : 'Uninstall'}
        </button>
      ) : (
        <button
          onClick={onInstall}
          disabled={isBusy}
          className="shrink-0 bg-transparent border border-border rounded-md text-muted px-3 py-1 font-secondary text-[12px] cursor-pointer hover:bg-sidebar-accent hover:text-foreground disabled:opacity-50 disabled:cursor-default"
        >
          {isBusy ? 'Installing...' : 'Install'}
        </button>
      )}
    </div>
  )
})

export default SkillCard
