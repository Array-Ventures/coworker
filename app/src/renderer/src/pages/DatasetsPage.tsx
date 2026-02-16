import { memo } from 'react'
import PageShell from '../components/PageShell'

export default memo(function DatasetsPage() {
  return (
    <PageShell>
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <span className="material-icon text-muted-dim mb-4" style={{ fontSize: 48 }}>database</span>
        <h2 className="font-primary text-lg font-semibold text-foreground mb-2">No datasets yet</h2>
        <p className="font-secondary text-sm text-muted max-w-[360px]">
          Datasets and data sources will appear here.
        </p>
      </div>
    </PageShell>
  )
})
