import { useState, useEffect } from 'react'
import { MASTRA_BASE_URL, setMastraBaseUrl, setMastraApiToken } from '../../mastra-client'

export default function AdvancedServer() {
  const [serverUrl, setServerUrl] = useState(MASTRA_BASE_URL)
  const [apiToken, setApiToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [savingToken, setSavingToken] = useState(false)
  const [savedToken, setSavedToken] = useState(false)

  useEffect(() => {
    ;(window as any).settings?.get('mastraApiToken')?.then((v: string) => v && setApiToken(v))
  }, [])

  const handleSaveUrl = async () => {
    const trimmed = serverUrl.replace(/\/+$/, '')
    setSaving(true)
    try {
      await setMastraBaseUrl(trimmed)
      setServerUrl(trimmed)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveToken = async () => {
    setSavingToken(true)
    try {
      await setMastraApiToken(apiToken.trim())
      setSavedToken(true)
      setTimeout(() => window.location.reload(), 600)
    } finally {
      setSavingToken(false)
    }
  }

  return (
    <div className="max-w-[640px] mx-auto flex flex-col gap-5">
      <div>
        <h3 className="font-secondary text-[18px] font-semibold text-foreground">Server Connection</h3>
        <p className="font-secondary text-[14px] text-muted mt-1">
          Configure the backend server URL that the Electron app connects to.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-5">
        {/* Server URL */}
        <div className="flex flex-col gap-1.5">
          <label className="font-secondary text-[13px] font-medium text-foreground">Server URL</label>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => { setServerUrl(e.target.value); setSaved(false) }}
            placeholder="http://localhost:4111"
            className="h-10 px-3 bg-background border border-border rounded-lg font-mono text-[13px] text-foreground outline-none focus:border-primary"
          />
        </div>

        {/* API Token */}
        <div className="flex flex-col gap-1.5">
          <label className="font-secondary text-[13px] font-medium text-foreground">API Token</label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={apiToken}
              onChange={(e) => { setApiToken(e.target.value); setSavedToken(false) }}
              placeholder="Paste your COWORKER_API_TOKEN here"
              className="w-full h-10 px-3 pr-10 bg-background border border-border rounded-lg font-mono text-[13px] text-foreground outline-none focus:border-primary"
            />
            <button
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center text-muted hover:text-foreground transition-colors"
              style={{ width: 28, height: 28 }}
              title={showToken ? 'Hide token' : 'Show token'}
            >
              <span className="material-icon" style={{ fontSize: 16 }}>
                {showToken ? 'visibility_off' : 'visibility'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {saved && (
        <p className="font-secondary text-[12px] text-green-500 m-0">
          Server URL updated. Reload the app for all connections to use the new URL.
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <button
          onClick={handleSaveUrl}
          disabled={saving || serverUrl === MASTRA_BASE_URL}
          className="h-10 px-4 bg-primary text-primary-foreground border-none rounded-xl font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover disabled:opacity-40 disabled:cursor-default"
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save URL'}
        </button>
        <button
          onClick={handleSaveToken}
          disabled={savingToken}
          className="h-10 px-4 bg-primary text-primary-foreground border-none rounded-xl font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover disabled:opacity-40 disabled:cursor-default"
        >
          {savingToken ? 'Saving...' : savedToken ? 'Saved' : 'Save Token'}
        </button>
      </div>
    </div>
  )
}
