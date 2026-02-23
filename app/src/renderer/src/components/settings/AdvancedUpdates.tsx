import { useState, useEffect } from 'react'

type UpdateStatus = {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

export default function AdvancedUpdates() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' })
  const [appVersion, setAppVersion] = useState('dev')

  useEffect(() => {
    ;(window as any).updater?.getAppVersion?.().then((v: string) => v && setAppVersion(v))
    const unsub = (window as any).updater?.onUpdateStatus?.((data: any) => {
      setUpdateStatus(data)
    })
    return () => unsub?.()
  }, [])

  const handleCheck = () => {
    setUpdateStatus({ status: 'checking' })
    ;(window as any).updater?.checkForUpdates()
  }

  const handleDownload = () => {
    ;(window as any).updater?.downloadUpdate()
  }

  const handleInstall = () => {
    ;(window as any).updater?.installUpdate()
  }

  return (
    <div className="max-w-[640px] mx-auto flex flex-col gap-5">
      <div>
        <h3 className="font-secondary text-[18px] font-semibold text-foreground">App Updates</h3>
        <p className="font-secondary text-[14px] text-muted mt-1">
          Check for new versions and configure automatic update behavior.
        </p>
      </div>

      {/* Version card */}
      <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="font-secondary text-[12px] font-medium text-muted">Current Version</span>
            <span className="font-mono text-[16px] font-semibold text-foreground">v{appVersion}</span>
          </div>
          {(updateStatus.status === 'idle' || updateStatus.status === 'not-available' || updateStatus.status === 'error') && (
            <button
              onClick={handleCheck}
              className="flex items-center gap-1.5 h-9 px-3.5 bg-transparent border border-border rounded-xl font-secondary text-[13px] font-medium text-foreground cursor-pointer hover:border-foreground/20"
            >
              <span className="material-icon" style={{ fontSize: 16 }}>refresh</span>
              Check for Updates
            </button>
          )}
          {updateStatus.status === 'checking' && (
            <span className="font-secondary text-[13px] text-muted">Checking...</span>
          )}
          {updateStatus.status === 'available' && (
            <button
              onClick={handleDownload}
              className="h-9 px-3.5 bg-primary text-primary-foreground border-none rounded-xl font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover"
            >
              Download v{updateStatus.version}
            </button>
          )}
          {updateStatus.status === 'downloaded' && (
            <button
              onClick={handleInstall}
              className="h-9 px-3.5 bg-primary text-primary-foreground border-none rounded-xl font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover"
            >
              Restart & Install
            </button>
          )}
        </div>

        {updateStatus.status === 'downloading' && (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${updateStatus.percent ?? 0}%` }} />
            </div>
            <span className="font-secondary text-[12px] text-muted">{Math.round(updateStatus.percent ?? 0)}%</span>
          </div>
        )}

        {updateStatus.status === 'not-available' && (
          <div className="flex items-center gap-2">
            <span className="material-icon text-green-500" style={{ fontSize: 16 }}>check_circle</span>
            <span className="font-secondary text-[13px] text-muted">You're on the latest version</span>
          </div>
        )}

        {updateStatus.status === 'error' && (
          <p className="font-secondary text-[12px] text-red-500 m-0">Update error: {updateStatus.message}</p>
        )}
      </div>
    </div>
  )
}
