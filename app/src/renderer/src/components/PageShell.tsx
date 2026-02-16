import { type ReactNode, memo } from 'react'
import TopTabBar from './TopTabBar'

type PageShellProps = {
  showTabBar?: boolean
  children: ReactNode
}

export default memo(function PageShell({
  showTabBar = true,
  children,
}: PageShellProps) {
  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {showTabBar && <TopTabBar />}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  )
})
