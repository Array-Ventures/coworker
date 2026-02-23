import { useState } from 'react'
import type { McpRegistryItem, McpServerConfig } from '../../mastra-client'
import { registryItemToConfig } from '../../stores/slices/mcpRegistrySlice'
import { mcpDisplayName } from './McpCard'

export default function McpConfigDialog({
  item,
  onSave,
  onCancel,
}: {
  item: McpRegistryItem
  onSave: (overrides: Partial<McpServerConfig>) => void
  onCancel: () => void
}) {
  const base = registryItemToConfig(item)
  const [name, setName] = useState(base.name)
  const [env, setEnv] = useState(
    base.env ? Object.entries(base.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
  )
  const [url, setUrl] = useState(base.url || '')
  const [headers, setHeaders] = useState('')

  const envVars = item.server.packages?.[0]?.environmentVariables || []
  const hasRequiredEnv = envVars.some((v) => v.isRequired)
  const isHttp = base.type === 'http'

  const handleSave = () => {
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

    const overrides: Partial<McpServerConfig> = { name: name.trim() }
    if (isHttp) {
      overrides.url = url.trim()
      if (Object.keys(headersObj).length > 0) overrides.headers = headersObj
    } else {
      if (Object.keys(envObj).length > 0) overrides.env = envObj
    }
    onSave(overrides)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-[480px]"
        style={{ padding: 24 }}
      >
        <h3 className="font-secondary text-[16px] font-semibold text-foreground mb-1">
          Configure MCP Server
        </h3>
        <p className="font-secondary text-[13px] text-muted mb-5">
          {item.server.description || `Set up ${mcpDisplayName(item)} before adding.`}
        </p>

        {/* Name */}
        <div className="mb-4">
          <label className="font-secondary text-[12px] font-medium text-muted block mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-primary text-[14px] text-foreground outline-none focus:border-primary"
          />
        </div>

        {/* HTTP: URL + Headers */}
        {isHttp && (
          <>
            <div className="mb-4">
              <label className="font-secondary text-[12px] font-medium text-muted block mb-1">URL</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                className="w-full h-9 px-3 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary"
              />
            </div>
            <div className="mb-4">
              <label className="font-secondary text-[12px] font-medium text-muted block mb-1">
                Headers <span className="text-muted-dim font-normal">(optional)</span>
              </label>
              <textarea
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
                placeholder={'Authorization=Bearer xxx'}
                rows={2}
                className="w-full px-3 py-2 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary resize-y"
              />
            </div>
          </>
        )}

        {/* Stdio: Environment Variables */}
        {!isHttp && envVars.length > 0 && (
          <div className="mb-4">
            <label className="font-secondary text-[12px] font-medium text-muted block mb-1">
              Environment Variables
              {hasRequiredEnv && <span className="text-red-400 ml-1">*</span>}
            </label>
            <div className="mb-2">
              {envVars.map((v) => (
                <p key={v.name} className="font-secondary text-[11px] text-muted-dim">
                  <span className="font-mono text-muted">{v.name}</span>
                  {v.description && ` — ${v.description}`}
                  {v.isRequired && <span className="text-red-400 ml-1">(required)</span>}
                </p>
              ))}
            </div>
            <textarea
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              placeholder={envVars.map((v) => `${v.name}=`).join('\n')}
              rows={Math.min(envVars.length + 1, 5)}
              className="w-full px-3 py-2 bg-transparent border border-border rounded-lg font-mono text-[13px] text-foreground placeholder:text-muted-dim outline-none focus:border-primary resize-y"
            />
          </div>
        )}

        {/* Stdio info when no env vars */}
        {!isHttp && envVars.length === 0 && (
          <div className="mb-4 rounded-lg bg-sidebar px-3 py-2">
            <p className="font-secondary text-[12px] text-muted">
              Will run: <span className="font-mono text-foreground">{base.command} {(base.args || []).join(' ')}</span>
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 mt-2">
          <button
            onClick={onCancel}
            className="font-secondary text-[13px] font-medium text-muted hover:text-foreground transition-colors"
            style={{ height: 36, padding: '0 14px' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="font-secondary text-[13px] font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
            style={{ height: 36, padding: '0 16px' }}
          >
            Add Server
          </button>
        </div>
      </div>
    </div>
  )
}
