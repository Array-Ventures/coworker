import { useState, useEffect, useCallback, memo, useRef } from 'react'
import type { ThemeMode } from '../hooks/useTheme'
import { useAppStore } from '../stores/useAppStore'
import PageShell from '../components/PageShell'
import FilterTabs from '../components/FilterTabs'
import { fetchAgentConfig, updateAgentConfig, fetchAIProviders } from '../mastra-client'
import type { Provider } from '@mastra/client-js'

const settingsTabs = ['AI', 'UX', 'Channels', 'Integrations', 'API & MCP', 'Advanced']

const themeModes: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'system', label: 'System', icon: 'desktop_windows' },
  { value: 'light', label: 'Light', icon: 'light_mode' },
  { value: 'dark', label: 'Dark', icon: 'dark_mode' },
]

/* ── Channels ── */

function StatusBadge({ label, variant }: { label: string; variant: 'success' | 'warning' | 'muted' }) {
  const styles = {
    success: 'bg-[#DFE6E1] text-[#004D1A]',
    warning: 'bg-[#E9E3D8] text-[#804200]',
    muted: 'bg-sidebar text-muted',
  }
  return (
    <span
      className={`inline-flex items-center font-secondary text-[12px] font-medium rounded-md ${styles[variant]}`}
      style={{ padding: '2px 8px' }}
    >
      {label}
    </span>
  )
}

function WhatsAppSection() {
  const waStatus = useAppStore((s) => s.waStatus)
  const waAllowlist = useAppStore((s) => s.waAllowlist)
  const waLoaded = useAppStore((s) => s.waLoaded)
  const loadWhatsAppStatus = useAppStore((s) => s.loadWhatsAppStatus)
  const startWaPolling = useAppStore((s) => s.startWaPolling)
  const stopWaPolling = useAppStore((s) => s.stopWaPolling)
  const waConnect = useAppStore((s) => s.waConnect)
  const waDisconnect = useAppStore((s) => s.waDisconnect)
  const waLogout = useAppStore((s) => s.waLogout)
  const loadWaAllowlist = useAppStore((s) => s.loadWaAllowlist)
  const waAddAllowlist = useAppStore((s) => s.waAddAllowlist)
  const waRemoveAllowlist = useAppStore((s) => s.waRemoveAllowlist)
  const waPair = useAppStore((s) => s.waPair)

  const [newPhone, setNewPhone] = useState('')
  const [adding, setAdding] = useState(false)
  const [pairingCode, setPairingCode] = useState('')
  const [pairing, setPairing] = useState(false)
  const [pairingError, setPairingError] = useState('')
  const prevStatusRef = useRef(waStatus.status)

  useEffect(() => {
    if (!waLoaded) {
      loadWhatsAppStatus()
      loadWaAllowlist()
    }
  }, [waLoaded, loadWhatsAppStatus, loadWaAllowlist])

  // Stop polling once connected (was polling during QR scan)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = waStatus.status
    if (prev !== 'connected' && waStatus.status === 'connected') {
      stopWaPolling()
    }
  }, [waStatus.status, stopWaPolling])

  const handleConnect = async () => {
    await waConnect()
  }

  const handleDisconnect = async () => {
    await waDisconnect()
  }

  const handleLogout = async () => {
    await waLogout()
  }

  const handleAddPhone = async () => {
    if (!newPhone.trim()) return
    setAdding(true)
    try {
      await waAddAllowlist(newPhone.trim())
      setNewPhone('')
    } finally {
      setAdding(false)
    }
  }

  const handlePair = async () => {
    if (!pairingCode.trim()) return
    setPairing(true)
    setPairingError('')
    try {
      const result = await waPair(pairingCode.trim())
      if (result.ok) {
        setPairingCode('')
      } else {
        setPairingError(result.error || 'Pairing failed')
      }
    } finally {
      setPairing(false)
    }
  }

  const { status, qrDataUrl, connectedPhone } = waStatus

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <div>
        <h3 className="font-secondary text-[18px] font-semibold text-foreground mb-1">
          Ask Coworker over WhatsApp
        </h3>
        <p className="font-secondary text-[14px] text-muted" style={{ maxWidth: 600 }}>
          Send a WhatsApp message to Coworker from your phone. Replies are sent back in the chat.
        </p>
      </div>

      {/* Connection card */}
      <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
        <div className="flex items-center justify-between mb-3">
          <span className="font-secondary text-[13px] font-medium text-muted">Connection</span>
          {status === 'connected' && <StatusBadge label="Connected" variant="success" />}
          {status === 'connecting' && <StatusBadge label="Connecting..." variant="warning" />}
          {status === 'qr_ready' && <StatusBadge label="Scan QR" variant="warning" />}
          {status === 'logged_out' && <StatusBadge label="Logged out" variant="muted" />}
          {status === 'disconnected' && <StatusBadge label="Disconnected" variant="muted" />}
        </div>

        {/* QR code display */}
        {status === 'qr_ready' && qrDataUrl && (
          <div className="flex flex-col items-center gap-3 py-4">
            <img
              src={qrDataUrl}
              alt="WhatsApp QR Code"
              style={{ width: 200, height: 200, borderRadius: 12 }}
            />
            <span className="font-secondary text-[13px] text-muted">
              Open WhatsApp on your phone and scan this code
            </span>
            <button
              onClick={handleDisconnect}
              className="font-secondary text-[13px] text-muted-dim hover:text-muted"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Connected state */}
        {status === 'connected' && (
          <div className="flex items-center justify-between" style={{ padding: '12px 0' }}>
            <span className="font-primary text-[14px] text-foreground">
              {connectedPhone || 'Connected'}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDisconnect}
                className="font-secondary text-[13px] font-medium text-foreground border border-border rounded-lg hover:bg-sidebar-accent transition-colors"
                style={{ height: 32, padding: '0 12px' }}
              >
                Disconnect
              </button>
              <button
                onClick={handleLogout}
                className="font-secondary text-[13px] font-medium text-red-500 border border-border rounded-lg hover:bg-sidebar-accent transition-colors"
                style={{ height: 32, padding: '0 12px' }}
              >
                Logout
              </button>
            </div>
          </div>
        )}

        {/* Disconnected / logged out state */}
        {(status === 'disconnected' || status === 'logged_out') && (
          <div style={{ padding: '12px 0' }}>
            <button
              onClick={handleConnect}
              className="flex items-center gap-2 font-secondary text-[13px] font-medium text-foreground bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors"
              style={{ height: 36, padding: '0 16px' }}
            >
              <span className="material-icon" style={{ fontSize: 16 }}>qr_code_2</span>
              Connect WhatsApp
            </button>
          </div>
        )}

        {/* Connecting state */}
        {status === 'connecting' && (
          <div className="flex items-center gap-2" style={{ padding: '12px 0' }}>
            <span className="font-secondary text-[13px] text-muted">Initializing connection...</span>
          </div>
        )}
      </div>

      {/* Pairing card */}
      <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
        <div className="flex items-center justify-between mb-1">
          <span className="font-secondary text-[13px] font-medium text-muted">Pair a Contact</span>
        </div>
        <p className="font-secondary text-[12px] text-muted-dim mb-3">
          When someone messages Coworker on WhatsApp, they receive a pairing code. Enter it here to allow them.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={pairingCode}
            onChange={(e) => { setPairingCode(e.target.value); setPairingError('') }}
            onKeyDown={(e) => e.key === 'Enter' && handlePair()}
            placeholder="Enter 6-digit code"
            className="flex-1 h-9 px-3 bg-transparent border border-border rounded-lg font-primary text-[14px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
            maxLength={6}
          />
          <button
            onClick={handlePair}
            disabled={pairing || !pairingCode.trim()}
            className="flex items-center gap-1.5 font-secondary text-[13px] font-medium text-foreground bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50"
            style={{ height: 36, padding: '0 14px' }}
          >
            {pairing ? 'Pairing...' : 'Pair'}
          </button>
        </div>
        {pairingError && (
          <p className="font-secondary text-[12px] text-red-500 mt-2">{pairingError}</p>
        )}
      </div>

      {/* Allowlist card */}
      <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
        <div className="flex items-center justify-between mb-3">
          <span className="font-secondary text-[13px] font-medium text-muted">Allowed Numbers</span>
        </div>

        {/* Add phone form (manual fallback) */}
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddPhone()}
            placeholder="+1 555 012 3456"
            className="flex-1 h-9 px-3 bg-transparent border border-border rounded-lg font-primary text-[14px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
          />
          <button
            onClick={handleAddPhone}
            disabled={adding || !newPhone.trim()}
            className="flex items-center gap-1.5 font-secondary text-[13px] font-medium text-foreground border border-border rounded-lg hover:bg-sidebar-accent transition-colors disabled:opacity-50"
            style={{ height: 36, padding: '0 12px' }}
          >
            <span className="material-icon" style={{ fontSize: 16 }}>add</span>
            Add
          </button>
        </div>

        {/* Allowlist items */}
        {waAllowlist.map((entry, i) => (
          <div
            key={entry.phoneNumber}
            className={`flex items-center justify-between ${i > 0 || true ? 'border-t border-border' : ''}`}
            style={{ padding: '12px 0' }}
          >
            <span className="font-primary text-[14px] text-foreground">{entry.phoneNumber}</span>
            <button
              onClick={() => waRemoveAllowlist(entry.phoneNumber)}
              className="text-muted-dim hover:text-red-500 transition-colors"
              title="Remove"
            >
              <span className="material-icon" style={{ fontSize: 18 }}>close</span>
            </button>
          </div>
        ))}

        {waAllowlist.length === 0 && (
          <p className="font-secondary text-[13px] text-muted-dim py-2">
            No numbers added yet. Add phone numbers that can message Coworker.
          </p>
        )}
      </div>
    </div>
  )
}

function ChannelsContent() {
  return (
    <div className="max-w-[640px] mx-auto flex flex-col" style={{ gap: 32 }}>
      <WhatsAppSection />

      {/* Email — placeholder */}
      <div className="flex flex-col" style={{ gap: 12 }}>
        <div>
          <h3 className="font-secondary text-[18px] font-semibold text-foreground mb-1">
            Ask Coworker over email
          </h3>
          <p className="font-secondary text-[14px] text-muted" style={{ maxWidth: 600 }}>
            Send an email to Coworker and get a response back. Only allowed senders can interact.
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl flex items-center justify-center" style={{ padding: 20, minHeight: 80 }}>
          <span className="font-secondary text-[13px] text-muted-dim">Coming soon</span>
        </div>
      </div>

      {/* Telegram — placeholder */}
      <div className="flex flex-col" style={{ gap: 12 }}>
        <div>
          <h3 className="font-secondary text-[18px] font-semibold text-foreground mb-1">
            Ask Coworker over Telegram
          </h3>
          <p className="font-secondary text-[14px] text-muted" style={{ maxWidth: 600 }}>
            Message Coworker on Telegram. Connect your bot token to enable this channel.
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl flex items-center justify-center" style={{ padding: 20, minHeight: 80 }}>
          <span className="font-secondary text-[13px] text-muted-dim">Coming soon</span>
        </div>
      </div>
    </div>
  )
}

type SettingsPageProps = {
  themeMode: ThemeMode
  onThemeChange: (mode: ThemeMode) => void
}

export default memo(function SettingsPage({
  themeMode,
  onThemeChange,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState('UX')

  // AI config state
  const [model, setModel] = useState('')
  const [instructions, setInstructions] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [defaultInstructions, setDefaultInstructions] = useState('')
  const [isCustomModel, setIsCustomModel] = useState(false)
  const [isCustomInstructions, setIsCustomInstructions] = useState(false)
  const [savingModel, setSavingModel] = useState(false)
  const [savingInstructions, setSavingInstructions] = useState(false)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [providers, setProviders] = useState<Provider[]>([])

  const loadConfig = useCallback(async () => {
    try {
      const [config, providerList] = await Promise.all([
        fetchAgentConfig(),
        fetchAIProviders(),
      ])
      setModel(config.model)
      setInstructions(config.instructions)
      setDefaultModel(config.defaultModel)
      setDefaultInstructions(config.defaultInstructions)
      setIsCustomModel(config.isCustomModel)
      setIsCustomInstructions(config.isCustomInstructions)
      // Sort: connected providers first, then alphabetically
      setProviders(
        providerList.sort((a, b) => {
          if (a.connected !== b.connected) return a.connected ? -1 : 1
          return a.name.localeCompare(b.name)
        }),
      )
      setConfigLoaded(true)
    } catch (err) {
      console.error('Failed to load agent config:', err)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'AI' && !configLoaded) loadConfig()
  }, [activeTab, configLoaded, loadConfig])

  const handleSaveModelValue = async (value: string) => {
    setSavingModel(true)
    try {
      const config = await updateAgentConfig({ model: value.trim() || null })
      setModel(config.model)
      setIsCustomModel(config.isCustomModel)
    } catch (err) {
      console.error('Failed to save model:', err)
    } finally {
      setSavingModel(false)
    }
  }

  const handleSaveInstructions = async () => {
    setSavingInstructions(true)
    try {
      const config = await updateAgentConfig({ instructions: instructions.trim() || null })
      setInstructions(config.instructions)
      setIsCustomInstructions(config.isCustomInstructions)
    } catch (err) {
      console.error('Failed to save instructions:', err)
    } finally {
      setSavingInstructions(false)
    }
  }

  const handleResetInstructions = async () => {
    setSavingInstructions(true)
    try {
      const config = await updateAgentConfig({ instructions: null })
      setInstructions(config.instructions)
      setIsCustomInstructions(config.isCustomInstructions)
    } catch (err) {
      console.error('Failed to reset instructions:', err)
    } finally {
      setSavingInstructions(false)
    }
  }

  const handleResetModel = async () => {
    setSavingModel(true)
    try {
      const config = await updateAgentConfig({ model: null })
      setModel(config.model)
      setIsCustomModel(config.isCustomModel)
    } catch (err) {
      console.error('Failed to reset model:', err)
    } finally {
      setSavingModel(false)
    }
  }

  return (
    <PageShell>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 h-[56px] border-b border-border">
          <FilterTabs tabs={settingsTabs} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-8">
          {activeTab === 'AI' && (
            <div className="max-w-[480px] mx-auto">
              {/* Model */}
              <div className="mb-8">
                <h3 className="font-secondary text-[15px] font-medium text-foreground mb-1">Model</h3>
                <p className="font-secondary text-[13px] text-muted mb-4">
                  The language model used by the agent.
                </p>
                <div className="flex gap-2">
                  <select
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value)
                      handleSaveModelValue(e.target.value)
                    }}
                    className="flex-1 h-10 px-3 bg-card border border-border rounded-lg font-secondary text-sm text-foreground outline-none focus:border-primary"
                  >
                    {providers.map((provider) => (
                      <optgroup
                        key={provider.id}
                        label={`${provider.name}${provider.connected ? '' : ' (no key)'}`}
                      >
                        {provider.models.map((m) => (
                          <option key={`${provider.id}/${m}`} value={`${provider.id}/${m}`}>
                            {m}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <p className="font-secondary text-[12px] text-muted mt-2">
                  Current: <span className="text-foreground">{model}</span>
                </p>
                {isCustomModel && (
                  <button
                    onClick={handleResetModel}
                    className="mt-1 bg-transparent border-none text-muted font-secondary text-[12px] cursor-pointer hover:text-foreground p-0"
                  >
                    Reset to default ({defaultModel})
                  </button>
                )}
              </div>

              {/* System Prompt */}
              <div className="border-t border-border pt-6">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-secondary text-[15px] font-medium text-foreground">System Prompt</h3>
                  {isCustomInstructions && (
                    <button
                      onClick={handleResetInstructions}
                      disabled={savingInstructions}
                      className="bg-transparent border-none text-muted font-secondary text-[12px] cursor-pointer hover:text-foreground p-0"
                    >
                      Reset to default
                    </button>
                  )}
                </div>
                <p className="font-secondary text-[13px] text-muted mb-4">
                  Instructions that guide the agent's behavior.
                </p>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={12}
                  className="w-full px-3 py-2.5 bg-card border border-border rounded-lg font-secondary text-sm text-foreground placeholder:text-muted-dim outline-none focus:border-primary resize-y"
                />
                <div className="flex justify-end mt-3">
                  <button
                    onClick={handleSaveInstructions}
                    disabled={savingInstructions}
                    className="h-10 px-4 bg-primary text-primary-foreground border-none rounded-lg font-secondary text-[13px] font-semibold cursor-pointer hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingInstructions ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'UX' && (
            <div className="max-w-[480px] mx-auto">
              {/* Theme selector */}
              <div className="mb-8">
                <h3 className="font-secondary text-[15px] font-medium text-foreground mb-1">Appearance</h3>
                <p className="font-secondary text-[13px] text-muted mb-4">
                  Choose your preferred color theme.
                </p>
                <div className="flex gap-2">
                  {themeModes.map((tm) => (
                    <button
                      key={tm.value}
                      onClick={() => onThemeChange(tm.value)}
                      className={`flex items-center gap-2 rounded-xl font-secondary text-[13px] font-medium transition-colors ${
                        themeMode === tm.value
                          ? 'bg-card border border-border text-foreground'
                          : 'text-muted-dim hover:text-foreground hover:bg-card'
                      }`}
                      style={{ padding: '8px 16px' }}
                    >
                      <span className="material-icon" style={{ fontSize: 16 }}>{tm.icon}</span>
                      {tm.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Channels' && <ChannelsContent />}

          {activeTab !== 'AI' && activeTab !== 'UX' && activeTab !== 'Channels' && (
            <div className="flex flex-col items-center justify-center text-center flex-1 min-h-[300px]">
              <span className="material-icon text-muted-dim mb-4" style={{ fontSize: 48 }}>settings</span>
              <h2 className="font-primary text-lg font-semibold text-foreground mb-2">{activeTab}</h2>
              <p className="font-secondary text-sm text-muted max-w-[360px]">
                {activeTab} settings will be available soon.
              </p>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
})
