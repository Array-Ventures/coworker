import { memo } from 'react'
import { useAppStore } from './stores/useAppStore'

const topNav = [
  { id: 'home', icon: 'home', label: 'Home' },
  { id: 'chats', icon: 'chat_bubble', label: 'Chats' },
  { id: 'scheduled-tasks', icon: 'schedule', label: 'Autopilot' },
  { id: 'files', icon: 'folder', label: 'Files' },
  { id: 'superpowers', icon: 'auto_awesome', label: 'Superpowers' },
  { id: 'apps', icon: 'apps', label: 'Apps' },
]

const bottomNav = [
  { id: 'settings', icon: 'settings', label: 'Settings' },
]

function NavItem({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: { id: string; icon: string; label: string }
  active: boolean
  collapsed: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={[
        'no-drag flex items-center shrink-0 rounded-xl',
        'text-[15px] font-secondary transition-colors',
        collapsed ? 'justify-center h-9' : 'gap-3 h-11',
        active
          ? 'bg-sidebar-accent text-foreground font-semibold'
          : 'text-muted-dim font-medium hover:bg-sidebar-accent hover:text-muted',
      ].join(' ')}
      style={collapsed ? undefined : { padding: '0 16px' }}
    >
      <span className="material-icon shrink-0" style={{ fontSize: 20 }}>
        {item.icon}
      </span>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  )
}

export default memo(function Sidebar() {
  const currentPage = useAppStore((s) => s.currentPage)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const navigate = useAppStore((s) => s.navigate)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)

  return (
    <aside
      className="flex shrink-0 flex-col justify-between h-screen bg-sidebar border-r border-sidebar-border overflow-hidden transition-[width] duration-200 ease-in-out"
      style={{
        width: collapsed ? 56 : 220,
        padding: collapsed ? '16px 6px' : '16px 12px',
      }}
    >
      {/* ── Top group ── */}
      <div className="flex flex-col gap-1 min-h-0">
        {/* Logo */}
        <div
          className="drag-region flex items-center shrink-0"
          style={{
            padding: collapsed ? '8px 0' : '8px 4px',
            gap: 8,
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
        >
          <span className="material-icon text-primary shrink-0" style={{ fontSize: 24 }}>
            pets
          </span>
          {!collapsed && (
            <>
              <span className="font-primary text-base font-bold text-foreground whitespace-nowrap">
                Coworker
              </span>
              <button
                className="no-drag ml-auto text-muted-dim rounded-md hover:text-muted flex items-center justify-center"
                onClick={toggleSidebar}
                title="Collapse sidebar"
                style={{ width: 24, height: 24 }}
              >
                <span className="material-icon" style={{ fontSize: 18 }}>dock_to_right</span>
              </button>
            </>
          )}
          {collapsed && (
            <button
              className="no-drag absolute text-muted-dim rounded-md hover:text-muted flex items-center justify-center"
              onClick={toggleSidebar}
              title="Expand sidebar"
              style={{ display: 'none' }}
            />
          )}
        </div>

        {/* Spacer 8px */}
        <div className="h-2 shrink-0" />

        {/* Top nav items */}
        <nav className="flex flex-col gap-1 overflow-y-auto flex-1 min-h-0">
          {topNav.map((item) => (
            <NavItem
              key={item.id}
              item={item}
              active={currentPage === item.id}
              collapsed={collapsed}
              onClick={() => navigate(item.id)}
            />
          ))}
        </nav>
      </div>

      {/* ── Bottom group (pinned) ── */}
      <nav className="flex flex-col gap-1 shrink-0 pt-2">
        {collapsed && (
          <button
            className="no-drag flex items-center justify-center h-9 shrink-0 rounded-xl text-muted-dim hover:bg-sidebar-accent hover:text-muted"
            onClick={toggleSidebar}
            title="Expand sidebar"
          >
            <span className="material-icon" style={{ fontSize: 20 }}>chevron_right</span>
          </button>
        )}
        {bottomNav.map((item) => (
          <NavItem
            key={item.id}
            item={item}
            active={currentPage === item.id}
            collapsed={collapsed}
            onClick={() => navigate(item.id)}
          />
        ))}
      </nav>
    </aside>
  )
})
