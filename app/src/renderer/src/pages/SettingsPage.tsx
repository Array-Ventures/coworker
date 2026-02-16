import { useState, useEffect, useCallback, memo, useRef } from 'react'
import type { ThemeMode } from '../hooks/useTheme'
import { useAppStore } from '../stores/useAppStore'
import PageShell from '../components/PageShell'
import FilterTabs from '../components/FilterTabs'
import { fetchAgentConfig, updateAgentConfig, fetchAIProviders, fetchExposedMcpServers } from '../mastra-client'
import type { McpServerConfig, ApiKeyEntry, ExposedMcpServerInfo } from '../mastra-client'
import type { Provider } from '@mastra/client-js'

const settingsTabs = ['AI', 'UX', 'Channels', 'Integrations', 'Developer', 'Advanced']

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

  // Manage polling: stop when connected, start for transient states (connecting, qr_ready, logged_out)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = waStatus.status
    if (prev !== 'connected' && waStatus.status === 'connected') {
      stopWaPolling()
    } else if (waStatus.status !== 'connected' && waStatus.status !== 'disconnected') {
      startWaPolling()
    }
  }, [waStatus.status, stopWaPolling, startWaPolling])

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

/* ── Email (Google) ── */

function EmailSection() {
  const gogInstalled = useAppStore((s) => s.gogInstalled)
  const gogAccounts = useAppStore((s) => s.gogAccounts)
  const gogLoaded = useAppStore((s) => s.gogLoaded)
  const gogAuthUrl = useAppStore((s) => s.gogAuthUrl)
  const gogAuthEmail = useAppStore((s) => s.gogAuthEmail)
  const gogAuthError = useAppStore((s) => s.gogAuthError)
  const loadGogStatus = useAppStore((s) => s.loadGogStatus)
  const gogStartAuth = useAppStore((s) => s.gogStartAuth)
  const gogCompleteAuth = useAppStore((s) => s.gogCompleteAuth)
  const gogTestAccount = useAppStore((s) => s.gogTestAccount)
  const gogRemoveAccount = useAppStore((s) => s.gogRemoveAccount)
  const gogClearAuth = useAppStore((s) => s.gogClearAuth)

  const [newEmail, setNewEmail] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [completing, setCompleting] = useState(false)
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string }>>({})
  const [removing, setRemoving] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set(['gmail']))

  const GOG_SERVICES = [
    { id: 'gmail', label: 'Gmail', icon: 'mail' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar_today' },
    { id: 'drive', label: 'Drive', icon: 'folder' },
    { id: 'docs', label: 'Docs', icon: 'description' },
    { id: 'sheets', label: 'Sheets', icon: 'table_chart' },
    { id: 'contacts', label: 'Contacts', icon: 'contacts' },
    { id: 'tasks', label: 'Tasks', icon: 'task_alt' },
    { id: 'chat', label: 'Chat', icon: 'chat' },
  ] as const

  const toggleService = (id: string) => {
    setSelectedServices((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    if (!gogLoaded) loadGogStatus()
  }, [gogLoaded, loadGogStatus])

  const handleStartAuth = async () => {
    const email = newEmail.trim()
    if (!email || selectedServices.size === 0) return
    const services = Array.from(selectedServices).join(',')
    await gogStartAuth(email, services)
    setNewEmail('')
  }

  const handleCompleteAuth = async () => {
    if (!redirectUrl.trim() || !gogAuthEmail) return
    setCompleting(true)
    try {
      const services = Array.from(selectedServices).join(',')
      await gogCompleteAuth(gogAuthEmail, redirectUrl.trim(), services)
      setRedirectUrl('')
      setSelectedServices(new Set(['gmail']))
    } finally {
      setCompleting(false)
    }
  }

  const handleTest = async (email: string) => {
    setTesting((t) => ({ ...t, [email]: true }))
    setTestResults((r) => { const copy = { ...r }; delete copy[email]; return copy })
    try {
      const result = await gogTestAccount(email)
      setTestResults((r) => ({ ...r, [email]: result }))
    } finally {
      setTesting((t) => ({ ...t, [email]: false }))
    }
  }

  const handleRemove = async (email: string) => {
    setRemoving(email)
    try {
      await gogRemoveAccount(email)
    } finally {
      setRemoving(null)
    }
  }

  const handleCancel = () => {
    gogClearAuth()
    setRedirectUrl('')
  }

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <div>
        <h3 className="font-secondary text-[18px] font-semibold text-foreground mb-1">
          Email (Google)
        </h3>
        <p className="font-secondary text-[14px] text-muted" style={{ maxWidth: 600 }}>
          Connect your Google account to send and receive emails through Gmail. Supports Gmail,
          Calendar, and other Google services.
        </p>
      </div>

      {/* Not installed */}
      {gogLoaded && !gogInstalled && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl" style={{ padding: 20 }}>
          <div className="flex items-start gap-3">
            <span className="material-icon text-amber-600 dark:text-amber-400 shrink-0" style={{ fontSize: 20 }}>warning</span>
            <div>
              <p className="font-secondary text-[14px] font-medium text-foreground mb-1">
                gog CLI not found
              </p>
              <p className="font-secondary text-[13px] text-muted mb-3">
                The gog CLI is required to enable Google services. Install it to connect your Gmail and other Google accounts.
              </p>
              <code className="font-mono text-[13px] text-foreground bg-sidebar rounded-md inline-block" style={{ padding: '6px 12px' }}>
                brew install steipete/tap/gogcli
              </code>
            </div>
          </div>
        </div>
      )}

      {/* Auth in progress */}
      {gogInstalled && gogAuthUrl && gogAuthEmail && (
        <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
          <div className="flex items-center gap-2 mb-4">
            <span className="material-icon text-amber-500" style={{ fontSize: 18 }}>pending</span>
            <span className="font-secondary text-[14px] font-medium text-foreground">
              Authorization in progress for {gogAuthEmail}
            </span>
          </div>

          {/* Step 1 */}
          <p className="font-secondary text-[13px] font-medium text-muted mb-2">
            Step 1: Open the authorization link in your browser
          </p>
          <div
            className="flex items-center gap-2 bg-sidebar rounded-lg cursor-pointer hover:bg-sidebar/80 transition-colors mb-4"
            style={{ padding: '8px 12px' }}
            onClick={() => window.open(gogAuthUrl, '_blank')}
          >
            <code className="font-mono text-[12px] text-primary truncate flex-1">{gogAuthUrl}</code>
            <span className="material-icon text-muted shrink-0" style={{ fontSize: 16 }}>open_in_new</span>
          </div>

          {/* Step 2 */}
          <p className="font-secondary text-[13px] font-medium text-muted mb-2">
            Step 2: After authorizing, paste the redirect URL below
          </p>
          <textarea
            value={redirectUrl}
            onChange={(e) => setRedirectUrl(e.target.value)}
            placeholder="Paste the redirect URL here..."
            rows={2}
            className="w-full px-3 py-2 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary resize-none mb-3"
          />

          {gogAuthError && (
            <p className="font-secondary text-[13px] text-red-500 mb-3">{gogAuthError}</p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleCancel}
              className="font-secondary text-[13px] font-medium text-muted hover:text-foreground transition-colors"
              style={{ height: 36, padding: '0 12px' }}
            >
              Cancel
            </button>
            <button
              onClick={handleCompleteAuth}
              disabled={completing || !redirectUrl.trim()}
              className="flex items-center gap-1.5 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
              style={{ height: 36, padding: '0 16px' }}
            >
              {completing ? (
                <span className="material-icon animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
              ) : (
                <span className="material-icon" style={{ fontSize: 16 }}>check_circle</span>
              )}
              Complete Authorization
            </button>
          </div>
        </div>
      )}

      {/* Connected accounts */}
      {gogInstalled && gogAccounts.length > 0 && !gogAuthUrl && (
        <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
          <div className="flex items-center justify-between mb-3">
            <span className="font-secondary text-[14px] font-medium text-foreground">Google Accounts</span>
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1 font-secondary text-[13px] font-medium text-primary hover:text-primary-hover transition-colors"
            >
              <span className="material-icon" style={{ fontSize: 16 }}>add</span>
              Add account
            </button>
          </div>

          <div className="flex flex-col" style={{ gap: 8 }}>
            {gogAccounts.map((account) => (
              <div key={account.email} className="bg-sidebar rounded-lg" style={{ padding: '12px 14px' }}>
                <div className="flex items-center gap-3">
                  <span className="material-icon text-muted" style={{ fontSize: 20 }}>mail</span>
                  <p className="font-secondary text-[14px] font-medium text-foreground truncate flex-1 min-w-0">{account.email}</p>
                  <StatusBadge label="Connected" variant="success" />
                </div>

                {account.services.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2" style={{ marginLeft: 32 }}>
                    {account.services.map((svc) => (
                      <span
                        key={svc}
                        className="inline-flex items-center font-secondary text-[11px] font-medium rounded-md bg-primary/10 text-primary capitalize"
                        style={{ padding: '2px 8px' }}
                      >
                        {svc}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 mt-2" style={{ marginLeft: 32 }}>
                  <button
                    onClick={() => handleTest(account.email)}
                    disabled={testing[account.email]}
                    className="flex items-center gap-1 font-secondary text-[12px] font-medium text-muted hover:text-foreground transition-colors disabled:opacity-50"
                    style={{ padding: '4px 8px' }}
                  >
                    {testing[account.email] ? (
                      <span className="material-icon animate-spin" style={{ fontSize: 14 }}>progress_activity</span>
                    ) : (
                      <span className="material-icon" style={{ fontSize: 14 }}>science</span>
                    )}
                    Test
                  </button>

                  <button
                    onClick={() => handleRemove(account.email)}
                    disabled={removing === account.email}
                    className="flex items-center gap-1 font-secondary text-[12px] font-medium text-red-500 hover:text-red-600 transition-colors disabled:opacity-50"
                    style={{ padding: '4px 8px' }}
                  >
                    <span className="material-icon" style={{ fontSize: 14 }}>delete</span>
                    Remove
                  </button>

                  {testResults[account.email] && (
                    <span className={`font-secondary text-[12px] ${testResults[account.email].ok ? 'text-green-600' : 'text-red-500'}`}>
                      {testResults[account.email].ok ? 'OK' : testResults[account.email].error || 'Failed'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Inline add form (shown when "Add account" is clicked) */}
          {showAddForm && (
            <div className="mt-3 border-t border-border" style={{ paddingTop: 12 }}>
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { handleStartAuth(); setShowAddForm(false) }
                  if (e.key === 'Escape') { setShowAddForm(false); setNewEmail('') }
                }}
                placeholder="you@gmail.com"
                autoFocus
                className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-primary text-[14px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary mb-3"
              />
              <p className="font-secondary text-[12px] font-medium text-muted mb-2">Services</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {GOG_SERVICES.map((svc) => (
                  <button
                    key={svc.id}
                    onClick={() => toggleService(svc.id)}
                    className={`flex items-center gap-1.5 font-secondary text-[12px] font-medium rounded-lg border transition-colors ${
                      selectedServices.has(svc.id)
                        ? 'bg-primary/10 border-primary/30 text-primary'
                        : 'bg-transparent border-border text-muted hover:text-foreground hover:border-foreground/20'
                    }`}
                    style={{ padding: '5px 10px' }}
                  >
                    <span className="material-icon" style={{ fontSize: 14 }}>{svc.icon}</span>
                    {svc.label}
                    {selectedServices.has(svc.id) && (
                      <span className="material-icon" style={{ fontSize: 12 }}>check</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { handleStartAuth(); setShowAddForm(false) }}
                  disabled={!newEmail.trim() || selectedServices.size === 0}
                  className="flex items-center gap-1.5 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors shrink-0"
                  style={{ height: 36, padding: '0 16px' }}
                >
                  <span className="material-icon" style={{ fontSize: 16 }}>login</span>
                  Authorize
                </button>
                <button
                  onClick={() => { setShowAddForm(false); setNewEmail(''); setSelectedServices(new Set(['gmail'])) }}
                  className="font-secondary text-[13px] font-medium text-muted hover:text-foreground transition-colors shrink-0"
                  style={{ height: 36, padding: '0 8px' }}
                >
                  Cancel
                </button>
              </div>
              {gogAuthError && !gogAuthUrl && (
                <p className="font-secondary text-[13px] text-red-500 mt-2">{gogAuthError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add account (when installed but no accounts and no auth in progress) */}
      {gogInstalled && gogAccounts.length === 0 && !gogAuthUrl && (
        <div className="bg-card border border-border rounded-xl" style={{ padding: 20 }}>
          <p className="font-secondary text-[14px] font-medium text-foreground mb-1">Add Google Account</p>
          <p className="font-secondary text-[13px] text-muted mb-3">
            Enter your Google email and select the services you want to authorize.
          </p>
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleStartAuth()}
            placeholder="you@gmail.com"
            className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-primary text-[14px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary mb-3"
          />
          <p className="font-secondary text-[12px] font-medium text-muted mb-2">Services</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {GOG_SERVICES.map((svc) => (
              <button
                key={svc.id}
                onClick={() => toggleService(svc.id)}
                className={`flex items-center gap-1.5 font-secondary text-[12px] font-medium rounded-lg border transition-colors ${
                  selectedServices.has(svc.id)
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'bg-transparent border-border text-muted hover:text-foreground hover:border-foreground/20'
                }`}
                style={{ padding: '5px 10px' }}
              >
                <span className="material-icon" style={{ fontSize: 14 }}>{svc.icon}</span>
                {svc.label}
                {selectedServices.has(svc.id) && (
                  <span className="material-icon" style={{ fontSize: 12 }}>check</span>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={handleStartAuth}
            disabled={!newEmail.trim() || selectedServices.size === 0}
            className="flex items-center gap-1.5 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
            style={{ height: 36, padding: '0 16px' }}
          >
            <span className="material-icon" style={{ fontSize: 16 }}>login</span>
            Authorize
          </button>
          {gogAuthError && !gogAuthUrl && (
            <p className="font-secondary text-[13px] text-red-500 mt-2">{gogAuthError}</p>
          )}
        </div>
      )}
    </div>
  )
}

/* ── A2A / API Access ── */

const MASTRA_BASE_URL = 'http://localhost:4111'

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center justify-center text-muted hover:text-foreground transition-colors shrink-0"
      style={{ width: 28, height: 28 }}
      title="Copy"
    >
      <span className="material-icon" style={{ fontSize: 15 }}>
        {copied ? 'check' : 'content_copy'}
      </span>
    </button>
  )
}

function TestButton({ url, method = 'GET', body }: { url: string; method?: 'GET' | 'POST'; body?: object }) {
  const [state, setState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleTest = async () => {
    setState('testing')
    setErrorMsg('')
    try {
      const opts: RequestInit = { method }
      if (method === 'POST' && body) {
        opts.headers = { 'Content-Type': 'application/json' }
        opts.body = JSON.stringify(body)
      }
      const res = await fetch(url, opts)
      await res.json()
      // Any JSON response (including 401) means the endpoint is reachable
      setState('success')
    } catch (err: any) {
      setState('error')
      setErrorMsg(err?.message || 'Connection failed')
    }
    setTimeout(() => setState('idle'), 3000)
  }

  const icon = { idle: 'network_check', testing: 'progress_activity', success: 'check_circle', error: 'error' }[state]
  const color = { idle: undefined, testing: undefined, success: 'var(--color-success, #22c55e)', error: 'var(--color-error, #ef4444)' }[state]
  const title = { idle: 'Test endpoint', testing: 'Testing...', success: 'Connected', error: errorMsg || 'Connection failed' }[state]

  return (
    <button
      onClick={handleTest}
      disabled={state === 'testing'}
      className="flex items-center justify-center text-muted hover:text-foreground transition-colors shrink-0"
      style={{ width: 28, height: 28 }}
      title={title}
    >
      <span
        className={`material-icon${state === 'testing' ? ' animate-spin' : ''}`}
        style={{ fontSize: 15, color }}
      >
        {icon}
      </span>
    </button>
  )
}

function A2aEndpointCard() {
  const a2aInfo = useAppStore((s) => s.a2aInfo)
  const agentCardPath = a2aInfo?.endpoints?.agentCard || '/api/.well-known/coworker/agent-card.json'
  const a2aPath = a2aInfo?.endpoints?.a2a || '/api/a2a/coworker'
  const rows = [
    { label: 'Agent Card', url: `${MASTRA_BASE_URL}${agentCardPath}` },
    {
      label: 'Agent Endpoint',
      url: `${MASTRA_BASE_URL}${a2aPath}`,
      method: 'POST' as const,
      body: { jsonrpc: '2.0', method: 'tasks/get', id: 'test', params: { id: 'test' } },
    },
  ]
  return (
    <div className="bg-card border border-border rounded-xl" style={{ padding: '16px 20px' }}>
      <div className="flex flex-col" style={{ gap: 12 }}>
        {rows.map((r) => (
          <div key={r.label}>
            <p className="font-secondary text-[12px] text-muted mb-1">{r.label}</p>
            <div className="flex items-center gap-2">
              <code className="font-mono text-[13px] text-foreground bg-sidebar rounded-md flex-1 truncate" style={{ padding: '6px 10px' }}>
                {r.url}
              </code>
              <TestButton url={r.url} method={r.method} body={r.body} />
              <CopyButton value={r.url} />
            </div>
          </div>
        ))}
      </div>
      <p className="font-secondary text-[12px] text-muted-dim mt-3">
        These endpoints are automatically available while the server is running.
      </p>
    </div>
  )
}

function ApiKeyCard({
  entry,
  isNew,
  fullKey,
  onDismissNew,
  onDelete,
}: {
  entry: ApiKeyEntry
  isNew?: boolean
  fullKey?: string
  onDismissNew?: () => void
  onDelete: () => void
}) {
  return (
    <div className={`bg-card border rounded-xl ${isNew ? 'border-primary' : 'border-border'}`} style={{ padding: '14px 16px' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-secondary text-[14px] font-medium text-foreground">{entry.label}</span>
          <span className="font-secondary text-[12px] text-muted-dim">
            {new Date(entry.createdAt).toLocaleDateString()}
          </span>
        </div>
        <button
          onClick={onDelete}
          className="flex items-center justify-center text-muted hover:text-red-500 transition-colors"
          style={{ width: 28, height: 28 }}
          title="Delete key"
        >
          <span className="material-icon" style={{ fontSize: 16 }}>delete</span>
        </button>
      </div>
      {isNew && fullKey ? (
        <div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-[13px] text-foreground bg-sidebar rounded-md flex-1 truncate" style={{ padding: '6px 10px' }}>
              {fullKey}
            </code>
            <CopyButton value={fullKey} />
          </div>
          <p className="font-secondary text-[11px] text-amber-600 dark:text-amber-400 mt-2">
            Copy this key now — you won't be able to see it again.
          </p>
          <button
            onClick={onDismissNew}
            className="font-secondary text-[12px] text-muted hover:text-foreground mt-1 transition-colors"
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <code className="font-mono text-[13px] text-muted-dim bg-sidebar rounded-md flex-1" style={{ padding: '6px 10px' }}>
            {entry.key}
          </code>
        </div>
      )}
    </div>
  )
}

function ApiKeysSection() {
  const apiKeys = useAppStore((s) => s.apiKeys)
  const a2aLoaded = useAppStore((s) => s.a2aLoaded)
  const loadA2aData = useAppStore((s) => s.loadA2aData)
  const addApiKey = useAppStore((s) => s.addApiKey)
  const removeApiKey = useAppStore((s) => s.removeApiKey)

  const [newKey, setNewKey] = useState<{ entry: ApiKeyEntry; fullKey: string } | null>(null)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (!a2aLoaded) loadA2aData()
  }, [a2aLoaded, loadA2aData])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const label = `Key ${apiKeys.length + 1}`
      const entry = await addApiKey(label)
      setNewKey({ entry, fullKey: entry.key })
    } catch {
      // silently fail
    } finally {
      setGenerating(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
        <div>
          <h4 className="font-secondary text-[16px] font-semibold text-foreground mb-0.5">
            API Keys
          </h4>
          <p className="font-secondary text-[13px] text-muted">
            Create keys to authenticate external access to your agent.
          </p>
        </div>
        {apiKeys.length > 0 && (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors shrink-0 disabled:opacity-50"
            style={{ height: 36, padding: '0 16px' }}
          >
            {generating ? (
              <span className="material-icon animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
            ) : (
              <span className="material-icon" style={{ fontSize: 16 }}>add</span>
            )}
            Generate Key
          </button>
        )}
      </div>

      {apiKeys.length > 0 || newKey ? (
        <div className="flex flex-col" style={{ gap: 8 }}>
          {newKey && (
            <ApiKeyCard
              entry={newKey.entry}
              isNew
              fullKey={newKey.fullKey}
              onDismissNew={() => setNewKey(null)}
              onDelete={() => {
                removeApiKey(newKey.entry.id)
                setNewKey(null)
              }}
            />
          )}
          {apiKeys
            .filter((k) => !newKey || k.id !== newKey.entry.id)
            .map((k) => (
              <ApiKeyCard key={k.id} entry={k} onDelete={() => removeApiKey(k.id)} />
            ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center text-center" style={{ padding: '40px 20px' }}>
          <span className="material-icon text-muted-dim mb-3" style={{ fontSize: 36 }}>vpn_key</span>
          <p className="font-secondary text-[14px] font-medium text-foreground mb-1">No API keys</p>
          <p className="font-secondary text-[13px] text-muted-dim mb-4" style={{ maxWidth: 320 }}>
            Generate your first key to enable authenticated access.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50"
            style={{ height: 36, padding: '0 16px' }}
          >
            Generate Key
          </button>
        </div>
      )}

      {apiKeys.length > 0 && (
        <p className="font-secondary text-[12px] text-muted-dim">
          Endpoints require a Bearer token when API keys exist. Without keys, endpoints are open.
        </p>
      )}
    </>
  )
}

function A2aSection() {
  return (
    <div className="max-w-[640px] mx-auto flex flex-col" style={{ gap: 12 }}>
      <div>
        <h3 className="font-secondary text-[18px] font-semibold text-foreground mb-1">
          API Access
        </h3>
        <p className="font-secondary text-[14px] text-muted" style={{ maxWidth: 500 }}>
          Expose your agent via A2A protocol for external apps and agents to connect.
        </p>
      </div>
      <A2aEndpointCard />
      <ApiKeysSection />
    </div>
  )
}

/* ── API & MCP Container ── */

const devSubTabs = [
  { label: 'API', icon: 'api' },
  { label: 'MCP', icon: 'dns' },
  { label: 'MCP Server', icon: 'hub' },
]

function DeveloperContent() {
  const [subTab, setSubTab] = useState('API')
  return (
    <div className="flex flex-col" style={{ gap: 20 }}>
      <FilterTabs tabs={devSubTabs} activeTab={subTab} onTabChange={setSubTab} />
      {subTab === 'API' && <A2aSection />}
      {subTab === 'MCP' && <McpServersSection />}
      {subTab === 'MCP Server' && <ExposedMcpSection />}
    </div>
  )
}

/* ── MCP Servers ── */

function McpServerForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: McpServerConfig
  onSave: (server: McpServerConfig) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<'stdio' | 'http'>(initial?.type ?? 'stdio')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [args, setArgs] = useState(initial?.args?.join(' ') ?? '')
  const [env, setEnv] = useState(
    initial?.env ? Object.entries(initial.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
  )
  const [url, setUrl] = useState(initial?.url ?? '')
  const [headers, setHeaders] = useState(
    initial?.headers ? Object.entries(initial.headers).map(([k, v]) => `${k}=${v}`).join('\n') : '',
  )
  const [saving, setSaving] = useState(false)

  const testMcpConnection = useAppStore((s) => s.testMcpConnection)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; tools?: string[]; error?: string } | null>(null)

  const buildConfig = (): McpServerConfig => {
    const envObj: Record<string, string> = {}
    for (const line of env.split('\n').filter(Boolean)) {
      const idx = line.indexOf('=')
      if (idx > 0) envObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
    const headersObj: Record<string, string> = {}
    for (const line of headers.split('\n').filter(Boolean)) {
      const idx = line.indexOf('=')
      if (idx > 0) headersObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
    return {
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      type,
      enabled: initial?.enabled ?? true,
      command: type === 'stdio' ? command.trim() : undefined,
      args: type === 'stdio' ? args.trim().split(/\s+/).filter(Boolean) : undefined,
      env: type === 'stdio' && Object.keys(envObj).length > 0 ? envObj : undefined,
      url: type === 'http' ? url.trim() : undefined,
      headers: type === 'http' && Object.keys(headersObj).length > 0 ? headersObj : undefined,
    }
  }

  const handleSave = async () => {
    if (!name.trim()) return
    if (type === 'stdio' && !command.trim()) return
    if (type === 'http' && !url.trim()) return
    setSaving(true)
    try {
      await onSave(buildConfig())
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testMcpConnection(buildConfig())
      setTestResult(result)
    } catch {
      setTestResult({ ok: false, error: 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="bg-card border-2 border-primary/30 rounded-xl" style={{ padding: 20 }}>
      {/* Name */}
      <div className="mb-4">
        <label className="font-secondary text-[13px] font-medium text-muted block mb-1.5">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My MCP Server"
          className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-primary text-[14px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
        />
      </div>

      {/* Type toggle */}
      <div className="mb-4">
        <label className="font-secondary text-[13px] font-medium text-muted block mb-1.5">Type</label>
        <div className="flex gap-1">
          {(['stdio', 'http'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`font-secondary text-[13px] font-medium rounded-lg transition-colors ${
                type === t
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-sidebar text-muted hover:text-foreground'
              }`}
              style={{ height: 32, padding: '0 14px' }}
            >
              {t === 'stdio' ? 'Stdio' : 'URL'}
            </button>
          ))}
        </div>
      </div>

      {/* Stdio fields */}
      {type === 'stdio' && (
        <>
          <div className="mb-4">
            <label className="font-secondary text-[13px] font-medium text-muted block mb-1.5">Command</label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp"
              className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
            />
          </div>
          <div className="mb-4">
            <label className="font-secondary text-[13px] font-medium text-muted block mb-1.5">Arguments</label>
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="arg1 arg2"
              className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
            />
          </div>
          <div className="mb-4">
            <label className="font-secondary text-[13px] font-medium text-muted block mb-1.5">Environment Variables</label>
            <textarea
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              placeholder={'KEY=value\nANOTHER_KEY=value'}
              rows={3}
              className="w-full px-3 py-2 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary resize-y"
            />
          </div>
        </>
      )}

      {/* HTTP fields */}
      {type === 'http' && (
        <>
          <div className="mb-4">
            <label className="font-secondary text-[13px] font-medium text-muted block mb-1.5">URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-server.com/mcp"
              className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
            />
          </div>
          <div className="mb-4">
            <label className="font-secondary text-[13px] font-medium text-muted block mb-1.5">Headers</label>
            <textarea
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              placeholder={'Authorization=Bearer xxx\nX-Api-Key=your-key'}
              rows={3}
              className="w-full px-3 py-2 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary resize-y"
            />
          </div>
        </>
      )}

      {/* Test result */}
      {testResult && (
        <div className={`mb-4 rounded-lg px-3 py-2 font-secondary text-[13px] ${
          testResult.ok ? 'bg-[#DFE6E1] text-[#004D1A]' : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
        }`}>
          {testResult.ok ? (
            <span>Connected — {testResult.tools?.length ?? 0} tool{testResult.tools?.length === 1 ? '' : 's'} available</span>
          ) : (
            <span>{testResult.error || 'Connection failed'}</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleTest}
          disabled={testing || (!command.trim() && type === 'stdio') || (!url.trim() && type === 'http')}
          className="flex items-center gap-1.5 font-secondary text-[13px] font-medium text-muted hover:text-foreground disabled:opacity-40 transition-colors"
        >
          {testing ? (
            <span className="material-icon animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
          ) : (
            <span className="material-icon" style={{ fontSize: 16 }}>play_arrow</span>
          )}
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="font-secondary text-[13px] font-medium text-muted hover:text-foreground transition-colors"
            style={{ height: 36, padding: '0 12px' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex items-center gap-1.5 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
            style={{ height: 36, padding: '0 16px' }}
          >
            {saving ? 'Saving...' : 'Save Server'}
          </button>
        </div>
      </div>
    </div>
  )
}

function McpServerCard({
  server,
  onEdit,
  onDelete,
}: {
  server: McpServerConfig
  onEdit: () => void
  onDelete: () => void
}) {
  const testMcpConnection = useAppStore((s) => s.testMcpConnection)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; tools?: string[]; error?: string } | null>(null)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testMcpConnection(server)
      setTestResult(result)
    } catch {
      setTestResult({ ok: false, error: 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  const preview = server.type === 'stdio'
    ? [server.command, ...(server.args || [])].join(' ')
    : server.url || ''

  return (
    <div className={`bg-card border border-border rounded-xl transition-opacity ${!server.enabled ? 'opacity-50' : ''}`} style={{ padding: '16px 20px' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-secondary text-[15px] font-medium text-foreground">{server.name}</span>
          <span
            className="inline-flex items-center font-secondary text-[11px] font-medium rounded-md bg-sidebar text-muted"
            style={{ padding: '1px 8px' }}
          >
            {server.type === 'stdio' ? 'Stdio' : 'URL'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleTest}
            disabled={testing}
            title="Test connection"
            className="text-muted hover:text-foreground transition-colors disabled:opacity-40"
          >
            {testing ? (
              <span className="material-icon animate-spin" style={{ fontSize: 18 }}>progress_activity</span>
            ) : (
              <span className="material-icon" style={{ fontSize: 18 }}>play_arrow</span>
            )}
          </button>
          <button onClick={onEdit} title="Edit" className="text-muted hover:text-foreground transition-colors">
            <span className="material-icon" style={{ fontSize: 18 }}>edit</span>
          </button>
          <button onClick={onDelete} title="Delete" className="text-muted hover:text-red-500 transition-colors">
            <span className="material-icon" style={{ fontSize: 18 }}>delete</span>
          </button>
        </div>
      </div>
      <p className="font-mono text-[12px] text-muted-dim truncate">{preview}</p>
      {testResult && (
        <p className={`mt-2 font-secondary text-[12px] ${testResult.ok ? 'text-[#004D1A]' : 'text-red-500'}`}>
          {testResult.ok
            ? `${testResult.tools?.length ?? 0} tool${testResult.tools?.length === 1 ? '' : 's'} available`
            : testResult.error || 'Connection failed'}
        </p>
      )}
    </div>
  )
}

function ExposedMcpSection() {
  const [servers, setServers] = useState<ExposedMcpServerInfo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetchExposedMcpServers()
      .then((s) => { setServers(s); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [])

  if (!loaded || servers.length === 0) return null

  const srv = servers[0]
  const sseEndpoint = `${MASTRA_BASE_URL}/api/mcp/${srv.id}/sse`
  const configSnippet = JSON.stringify(
    { mcpServers: { [srv.name.toLowerCase()]: { url: sseEndpoint } } },
    null,
    2,
  )

  return (
    <div className="max-w-[640px] mx-auto flex flex-col" style={{ gap: 12 }}>
      <div>
        <h3 className="font-secondary text-[18px] font-semibold text-foreground mb-1">
          Expose as MCP Server
        </h3>
        <p className="font-secondary text-[14px] text-muted" style={{ maxWidth: 500 }}>
          Your agent is exposed as an MCP server. External clients like Cursor, Claude Desktop, or
          Windsurf can connect to it.
        </p>
      </div>

      {/* Endpoint */}
      <div className="bg-card border border-border rounded-xl" style={{ padding: '16px 20px' }}>
        <p className="font-secondary text-[12px] text-muted mb-1">MCP Endpoint (SSE)</p>
        <div className="flex items-center gap-2">
          <code className="font-mono text-[13px] text-foreground bg-sidebar rounded-md flex-1 truncate" style={{ padding: '6px 10px' }}>
            {sseEndpoint}
          </code>
          <TestButton url={`${MASTRA_BASE_URL}/api/mcp/v0/servers`} />
          <CopyButton value={sseEndpoint} />
        </div>
        <p className="font-secondary text-[12px] text-muted-dim mt-3">
          This endpoint is automatically available while the server is running.
        </p>
      </div>

      {/* Exposed tools */}
      {srv.tools.length > 0 && (
        <div className="bg-card border border-border rounded-xl" style={{ padding: '16px 20px' }}>
          <p className="font-secondary text-[12px] text-muted mb-2">Exposed Tools</p>
          <div className="flex flex-col" style={{ gap: 6 }}>
            {srv.tools.map((t) => (
              <div key={t.name} className="flex items-start gap-2">
                <span className="material-icon text-muted shrink-0" style={{ fontSize: 14, marginTop: 2 }}>build</span>
                <div>
                  <span className="font-mono text-[13px] text-foreground">{t.name}</span>
                  {t.description && (
                    <p className="font-secondary text-[12px] text-muted-dim">{t.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Config snippet */}
      <div className="bg-card border border-border rounded-xl" style={{ padding: '16px 20px' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="font-secondary text-[12px] text-muted">Connection Config</p>
          <button
            onClick={() => { navigator.clipboard.writeText(configSnippet); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            className="flex items-center gap-1 font-secondary text-[12px] text-muted hover:text-foreground transition-colors"
          >
            <span className="material-icon" style={{ fontSize: 14 }}>{copied ? 'check' : 'content_copy'}</span>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="font-mono text-[12px] text-foreground bg-sidebar rounded-md overflow-x-auto" style={{ padding: '10px 12px' }}>
          {configSnippet}
        </pre>
        <p className="font-secondary text-[11px] text-muted-dim mt-2">
          Add this to your MCP client configuration (Cursor, Claude Desktop, etc.)
        </p>
      </div>

      <ApiKeysSection />
    </div>
  )
}

function McpServersSection() {
  const mcpServers = useAppStore((s) => s.mcpServers)
  const mcpLoaded = useAppStore((s) => s.mcpLoaded)
  const loadMcpServers = useAppStore((s) => s.loadMcpServers)
  const addMcpServer = useAppStore((s) => s.addMcpServer)
  const updateMcpServer = useAppStore((s) => s.updateMcpServer)
  const deleteMcpServer = useAppStore((s) => s.deleteMcpServer)

  const [editing, setEditing] = useState<string | 'new' | null>(null)

  useEffect(() => {
    if (!mcpLoaded) loadMcpServers()
  }, [mcpLoaded, loadMcpServers])

  const handleSave = async (server: McpServerConfig) => {
    const existing = mcpServers.find((s) => s.id === server.id)
    if (existing) {
      await updateMcpServer(server)
    } else {
      await addMcpServer(server)
    }
    setEditing(null)
  }

  const editingServer = editing && editing !== 'new'
    ? mcpServers.find((s) => s.id === editing)
    : undefined

  return (
    <div className="max-w-[640px] mx-auto flex flex-col" style={{ gap: 12 }}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-secondary text-[18px] font-semibold text-foreground mb-1">
            MCP Servers
          </h3>
          <p className="font-secondary text-[14px] text-muted" style={{ maxWidth: 500 }}>
            Connect external tools and services to your agent via Model Context Protocol.
          </p>
        </div>
        {mcpServers.length > 0 && !editing && (
          <button
            onClick={() => setEditing('new')}
            className="flex items-center gap-1.5 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors shrink-0"
            style={{ height: 36, padding: '0 16px' }}
          >
            <span className="material-icon" style={{ fontSize: 16 }}>add</span>
            Add Server
          </button>
        )}
      </div>

      {/* Add/Edit form */}
      {editing && (
        <McpServerForm
          initial={editingServer}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Server list */}
      {mcpServers.length > 0 ? (
        <div className="flex flex-col" style={{ gap: 8 }}>
          {mcpServers.map((server) => (
            editing === server.id ? null : (
              <McpServerCard
                key={server.id}
                server={server}
                onEdit={() => setEditing(server.id)}
                onDelete={() => deleteMcpServer(server.id)}
              />
            )
          ))}
        </div>
      ) : !editing ? (
        /* Empty state */
        <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center text-center" style={{ padding: '40px 20px' }}>
          <span className="material-icon text-muted-dim mb-3" style={{ fontSize: 36 }}>dns</span>
          <p className="font-secondary text-[14px] font-medium text-foreground mb-1">No servers configured</p>
          <p className="font-secondary text-[13px] text-muted-dim mb-4" style={{ maxWidth: 320 }}>
            Add an MCP server to give your agent access to external tools and services.
          </p>
          <button
            onClick={() => setEditing('new')}
            className="flex items-center gap-1.5 font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors"
            style={{ height: 36, padding: '0 16px' }}
          >
            Add Server
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ChannelsContent() {
  return (
    <div className="max-w-[640px] mx-auto flex flex-col" style={{ gap: 32 }}>
      <WhatsAppSection />

      <EmailSection />

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

          {activeTab === 'Developer' && <DeveloperContent />}

          {activeTab !== 'AI' && activeTab !== 'UX' && activeTab !== 'Channels' && activeTab !== 'Developer' && (
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
