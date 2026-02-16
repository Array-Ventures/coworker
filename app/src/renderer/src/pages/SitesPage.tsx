import { useState, memo } from 'react'
import PageShell from '../components/PageShell'
import FilterTabs from '../components/FilterTabs'

const sitesTabs = ['Sites', 'Domains', 'Forms']

export default memo(function SitesPage() {
  const [activeTab, setActiveTab] = useState('Sites')

  return (
    <PageShell>
      <div className="flex flex-col h-full">
        <div className="flex items-center px-6 h-[56px] border-b border-border">
          <FilterTabs tabs={sitesTabs} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <span className="material-icon text-muted-dim mb-4" style={{ fontSize: 48 }}>language</span>
          <h2 className="font-primary text-lg font-semibold text-foreground mb-2">No Sites Yet</h2>
          <p className="font-secondary text-sm text-muted max-w-[360px] mb-5">
            Create and manage websites powered by AI.
            Deploy sites instantly with Coworker.
          </p>
          <button className="flex items-center gap-1.5 bg-primary text-primary-foreground border-none rounded-xl px-5 py-2.5 font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover mb-3">
            <span className="material-icon" style={{ fontSize: 16 }}>add</span>
            Create your first site
          </button>
          <button className="bg-transparent border-none text-primary font-secondary text-[13px] cursor-pointer hover:underline">
            Learn More
          </button>
        </div>
      </div>
    </PageShell>
  )
})
