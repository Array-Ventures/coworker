import { memo } from 'react'

type FilterTab = {
  label: string
  icon?: string
}

type FilterTabsProps = {
  tabs: (string | FilterTab)[]
  activeTab: string
  onTabChange: (tab: string) => void
}

export default memo(function FilterTabs({ tabs, activeTab, onTabChange }: FilterTabsProps) {
  return (
    <div className="flex items-center gap-1">
      {tabs.map((tab) => {
        const label = typeof tab === 'string' ? tab : tab.label
        const icon = typeof tab === 'string' ? undefined : tab.icon
        return (
          <button
            key={label}
            onClick={() => onTabChange(label)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-secondary cursor-pointer bg-transparent border transition-colors ${
              activeTab === label
                ? 'bg-sidebar-accent text-foreground border-border'
                : 'text-muted border-transparent hover:bg-card hover:text-foreground'
            }`}
          >
            {icon && <span className="material-icon" style={{ fontSize: 16 }}>{icon}</span>}
            {label}
          </button>
        )
      })}
    </div>
  )
})
