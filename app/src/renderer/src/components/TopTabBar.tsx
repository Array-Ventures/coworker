import { memo } from 'react'
import { useAppStore } from '../stores/useAppStore'
import NewChatButton from './NewChatButton'

const tabs = [
  { id: 'chats', icon: 'chat_bubble', label: 'Chats' },
  { id: 'scheduled-tasks', icon: 'schedule', label: 'Autopilot' },
  { id: 'files', icon: 'folder', label: 'Files' },
  { id: 'superpowers', icon: 'auto_awesome', label: 'Superpowers' },
  { id: 'apps', icon: 'apps', label: 'Apps' },
  { id: 'settings', icon: 'settings', label: 'Settings' },
]

export default memo(function TopTabBar() {
  const currentPage = useAppStore((s) => s.currentPage)
  const navigate = useAppStore((s) => s.navigate)

  return (
    <div
      className="drag-region flex items-center shrink-0 border-b border-border bg-background"
      style={{ height: 52, padding: '0 24px', gap: 8 }}
    >
      {/* Tabs */}
      <div className="no-drag flex items-center gap-2 overflow-x-auto">
        {tabs.map((tab) => {
          const active = currentPage === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => navigate(tab.id)}
              className={[
                'no-drag flex items-center gap-2 shrink-0 rounded-xl font-secondary text-[14px] transition-colors',
                active
                  ? 'bg-card border border-border text-foreground font-medium'
                  : 'text-muted-dim hover:bg-card hover:text-muted',
              ].join(' ')}
              style={{ height: 40, padding: '0 16px' }}
            >
              <span className="material-icon shrink-0" style={{ fontSize: 18 }}>
                {tab.icon}
              </span>
              <span className="whitespace-nowrap">{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Right side — pushed to end */}
      <div className="no-drag flex items-center justify-end flex-1">
        <NewChatButton />
      </div>
    </div>
  )
})

