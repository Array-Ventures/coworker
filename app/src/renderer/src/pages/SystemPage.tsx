import { memo } from 'react'
import PageShell from '../components/PageShell'

type SystemPageProps = {
  activePage: string
  onNavigate: (page: string) => void
  onNewChat: () => void
}

export default memo(function SystemPage({ activePage, onNavigate, onNewChat }: SystemPageProps) {
  return (
    <PageShell activePage={activePage} onNavigate={onNavigate} onNewChat={onNewChat}>
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <span className="material-icon text-muted-dim mb-4" style={{ fontSize: 48 }}>terminal</span>
        <h2 className="font-primary text-lg font-semibold text-foreground mb-2">System</h2>
        <p className="font-secondary text-sm text-muted max-w-[360px]">
          System logs and diagnostics will be available here.
        </p>
      </div>
    </PageShell>
  )
})
