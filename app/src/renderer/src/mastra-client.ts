import { MastraClient } from '@mastra/client-js'
import type { StorageThreadType } from '@mastra/core/memory'
import type { ListSkillsResponse } from '@mastra/client-js'
import type { ObservationalMemoryRecord } from '@mastra/core/storage'

export type { StorageThreadType } from '@mastra/core/memory'
export type { SkillMetadata, ListSkillsResponse } from '@mastra/client-js'
export type { ObservationalMemoryRecord } from '@mastra/core/storage'

// Extended type — the actual list-skills response includes fields not in the SDK type
export type InstalledSkillInfo = {
  name: string
  description: string
  path?: string
  skillsShSource?: { owner: string; repo: string }
}

const DEFAULT_BASE_URL = 'http://localhost:4111'

export let MASTRA_BASE_URL = DEFAULT_BASE_URL
let MASTRA_API_TOKEN = ''

export const AGENT_ID = 'coworker'
export const RESOURCE_ID = 'coworker'

/** Returns auth headers when a token is configured, empty object otherwise */
export function authHeaders(): Record<string, string> {
  if (!MASTRA_API_TOKEN) return {}
  return { Authorization: `Bearer ${MASTRA_API_TOKEN}` }
}


function rebuildClient() {
  mastraClient = new MastraClient({
    baseUrl: MASTRA_BASE_URL,
    ...(MASTRA_API_TOKEN ? { headers: { Authorization: `Bearer ${MASTRA_API_TOKEN}` } } : {}),
  })
}

export let mastraClient = new MastraClient({
  baseUrl: MASTRA_BASE_URL,
})

/** Load persisted server URL + token from electron-store (call once on app init) */
export async function initMastraBaseUrl(): Promise<string> {
  try {
    const savedUrl = await (window as any).settings?.get('mastraBaseUrl')
    if (savedUrl && typeof savedUrl === 'string') {
      MASTRA_BASE_URL = savedUrl
    }
    const savedToken = await (window as any).settings?.get('mastraApiToken')
    if (savedToken && typeof savedToken === 'string') {
      MASTRA_API_TOKEN = savedToken
    }
    rebuildClient()
  } catch {
    // electron-store not available — keep defaults
  }
  return MASTRA_BASE_URL
}

/** Update the server URL and persist it */
export async function setMastraBaseUrl(url: string): Promise<void> {
  MASTRA_BASE_URL = url
  rebuildClient()
  try {
    await (window as any).settings?.set('mastraBaseUrl', url)
  } catch {
    // ignore if not in Electron
  }
}

/** Update the API token and persist it */
export async function setMastraApiToken(token: string): Promise<void> {
  MASTRA_API_TOKEN = token
  rebuildClient()
  try {
    await (window as any).settings?.set('mastraApiToken', token)
  } catch {
    // ignore if not in Electron
  }
}

export async function fetchThreadsPage(page = 0, perPage = 100) {
  const result = await mastraClient.listMemoryThreads({
    agentId: AGENT_ID,
    resourceId: RESOURCE_ID,
    perPage,
    page,
    sortDirection: 'DESC',
  })
  return { threads: result.threads as StorageThreadType[], hasMore: result.hasMore }
}

export async function fetchThread(threadId: string): Promise<StorageThreadType> {
  const thread = mastraClient.getMemoryThread({
    threadId,
    agentId: AGENT_ID,
  })
  return thread.get()
}

export async function fetchThreadMessages(threadId: string, page = 0, perPage = 40) {
  const thread = mastraClient.getMemoryThread({
    threadId,
    agentId: AGENT_ID,
  })
  return thread.listMessages({
    page,
    perPage,
    orderBy: { field: 'createdAt', direction: 'DESC' },
  })
}

export async function updateThreadTitle(threadId: string, title: string) {
  const thread = mastraClient.getMemoryThread({ threadId, agentId: AGENT_ID })
  return thread.update({ title, metadata: {}, resourceId: RESOURCE_ID })
}

export async function deleteThread(threadId: string) {
  const thread = mastraClient.getMemoryThread({ threadId, agentId: AGENT_ID })
  return thread.delete()
}

// ── Workspace helpers ──

let _workspaceId: string | null = null

async function getWorkspaceId(): Promise<string | null> {
  if (_workspaceId) return _workspaceId
  const { workspaces } = await mastraClient.listWorkspaces()
  _workspaceId = workspaces[0]?.id ?? null
  return _workspaceId
}

function getWorkspace(id: string) {
  return mastraClient.getWorkspace(id)
}

export async function listWorkspaceFiles(path: string) {
  const id = await getWorkspaceId()
  if (!id) return { path, entries: [] }
  return getWorkspace(id).listFiles(path)
}

export async function uploadWorkspaceFile(
  dir: string,
  name: string,
  content: string,
  encoding?: 'utf-8' | 'base64',
) {
  const id = await getWorkspaceId()
  if (!id) throw new Error('No workspace available')
  return getWorkspace(id).writeFile(`${dir}/${name}`, content, { recursive: true, encoding })
}

export async function deleteWorkspaceFile(path: string) {
  const id = await getWorkspaceId()
  if (!id) throw new Error('No workspace available')
  return getWorkspace(id).delete(path, { recursive: true, force: true })
}

export async function createWorkspaceDir(path: string) {
  const id = await getWorkspaceId()
  if (!id) throw new Error('No workspace available')
  return getWorkspace(id).mkdir(path, true)
}

export async function readWorkspaceFile(path: string, encoding?: string) {
  const id = await getWorkspaceId()
  if (!id) throw new Error('No workspace available')
  return getWorkspace(id).readFile(path, encoding)
}

// ── Agent Config ──

export async function fetchAIProviders() {
  const { providers } = await mastraClient.listAgentsModelProviders()
  return providers
}

export async function fetchAgentConfig() {
  const res = await fetch(`${MASTRA_BASE_URL}/agent-config`, { headers: authHeaders() })
  return res.json()
}

export async function updateAgentConfig(body: {
  model?: string | null
  instructions?: string | null
  sandboxEnv?: Record<string, string> | null
}) {
  const res = await fetch(`${MASTRA_BASE_URL}/agent-config`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

// ── Working Memory ──

export type WorkingMemory = {
  persona?: {
    soul?: string
    expression?: string
    interests?: string
    learnedBehaviors?: string
  }
  org?: {
    overview?: string
    team?: string
    stack?: string
    projects?: string
    preferences?: string
  }
}

export async function fetchWorkingMemory(): Promise<WorkingMemory> {
  const raw = await mastraClient.getWorkingMemory({
    agentId: AGENT_ID,
    threadId: '__seed__',
    resourceId: RESOURCE_ID,
  })
  if (!raw) return {}
  // SDK returns { source, threadExists, workingMemory, workingMemoryTemplate }
  const wmString = (raw as any).workingMemory
  if (!wmString) return {}
  return typeof wmString === 'string' ? JSON.parse(wmString) : wmString
}

export async function saveWorkingMemory(wm: WorkingMemory): Promise<void> {
  await mastraClient.updateWorkingMemory({
    agentId: AGENT_ID,
    threadId: '__seed__',
    resourceId: RESOURCE_ID,
    workingMemory: JSON.stringify(wm),
  })
}

// ── Observational Memory ──

export async function fetchObservationalMemory(): Promise<ObservationalMemoryRecord | null> {
  const raw = await mastraClient.getObservationalMemory({
    agentId: AGENT_ID,
    resourceId: RESOURCE_ID,
  })
  return (raw as any)?.record ?? null
}

// ── Scheduled Tasks ──

export interface ScheduledTask {
  id: string
  name: string
  scheduleType: string
  cron: string
  scheduleConfig: any
  prompt: string
  notify: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastRunAt: string | null
}

export async function fetchScheduledTasks(): Promise<ScheduledTask[]> {
  const res = await fetch(`${MASTRA_BASE_URL}/scheduled-tasks`, { headers: authHeaders() })
  const data = await res.json()
  return data.items
}

export async function createScheduledTask(body: {
  name: string
  scheduleConfig: any
  prompt: string
  notify?: boolean
}) {
  const res = await fetch(`${MASTRA_BASE_URL}/scheduled-tasks`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function deleteScheduledTask(id: string) {
  const res = await fetch(`${MASTRA_BASE_URL}/scheduled-tasks/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return res.json()
}

export async function updateScheduledTask(
  id: string,
  body: { name?: string; scheduleConfig?: any; prompt?: string; notify?: boolean },
) {
  const res = await fetch(`${MASTRA_BASE_URL}/scheduled-tasks/${id}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function toggleScheduledTask(id: string, enabled: boolean) {
  const res = await fetch(`${MASTRA_BASE_URL}/scheduled-tasks/${id}/toggle`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  return res.json()
}

// ── MCP Registry ──

export interface McpRegistryPackage {
  registryType: string
  identifier: string
  version?: string
  transport: { type: string }
  environmentVariables?: { name: string; description?: string; isRequired?: boolean; isSecret?: boolean; format?: string }[]
}

export interface McpRegistryRemote {
  type: string
  url: string
}

export interface McpRegistryServer {
  name: string
  description?: string
  title?: string
  version: string
  repository?: { url?: string; source?: string }
  packages?: McpRegistryPackage[]
  remotes?: McpRegistryRemote[]
}

export interface McpRegistryItem {
  server: McpRegistryServer
  _meta: {
    'io.modelcontextprotocol.registry/official': {
      status: string
      publishedAt: string
      updatedAt?: string
      isLatest: boolean
    }
  }
}

export interface McpRegistryResponse {
  servers: McpRegistryItem[]
  metadata: { nextCursor?: string; count: number }
}

export async function fetchRegistryMcps(limit = 20, cursor?: string): Promise<McpRegistryResponse> {
  const params = new URLSearchParams({ limit: String(limit), version: 'latest' })
  if (cursor) params.set('cursor', cursor)
  const res = await fetch(`${MASTRA_BASE_URL}/mcp-registry/servers?${params}`, { headers: authHeaders() })
  return res.json()
}

export async function searchRegistryMcps(q: string, limit = 30): Promise<McpRegistryResponse> {
  const params = new URLSearchParams({ search: q, limit: String(limit), version: 'latest' })
  const res = await fetch(`${MASTRA_BASE_URL}/mcp-registry/servers?${params}`, { headers: authHeaders() })
  return res.json()
}

// ── Skills (skills.sh) ──

// Browse/search response shape from built-in skills-sh proxy (not in SDK types)
export type SkillShBrowseItem = { id: string; name: string; installs: number; topSource: string }

export async function fetchPopularSkills(limit = 20, offset = 0) {
  const wId = await getWorkspaceId()
  if (!wId) return { skills: [] as SkillShBrowseItem[], count: 0 }
  const res = await fetch(
    `${MASTRA_BASE_URL}/api/workspaces/${wId}/skills-sh/popular?limit=${limit}&offset=${offset}`,
    { headers: authHeaders() },
  )
  return res.json() as Promise<{ skills: SkillShBrowseItem[]; count: number }>
}

export async function searchSkillsSh(q: string, limit = 30) {
  const wId = await getWorkspaceId()
  if (!wId) return { skills: [] as SkillShBrowseItem[], count: 0 }
  const res = await fetch(
    `${MASTRA_BASE_URL}/api/workspaces/${wId}/skills-sh/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    { headers: authHeaders() },
  )
  return res.json() as Promise<{ skills: SkillShBrowseItem[]; count: number }>
}

async function syncSkillsBin() {
  try {
    await fetch(`${MASTRA_BASE_URL}/sync-skills-bin`, { method: 'POST', headers: authHeaders() })
  } catch {}
}

export async function installSkillSh(owner: string, repo: string, skillName: string) {
  const wId = await getWorkspaceId()
  if (!wId) throw new Error('No workspace')
  const res = await fetch(`${MASTRA_BASE_URL}/api/workspaces/${wId}/skills-sh/install`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, repo, skillName }),
  })
  const data = await res.json()
  if (data.success) await syncSkillsBin()
  return data
}

export async function removeSkillSh(skillName: string) {
  const wId = await getWorkspaceId()
  if (!wId) throw new Error('No workspace')
  const res = await fetch(`${MASTRA_BASE_URL}/api/workspaces/${wId}/skills-sh/remove`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ skillName }),
  })
  const data = await res.json()
  if (data.success) await syncSkillsBin()
  return data
}

export async function fetchInstalledSkills(): Promise<{
  skills: InstalledSkillInfo[]
  isSkillsConfigured: boolean
}> {
  const wId = await getWorkspaceId()
  if (!wId) return { skills: [], isSkillsConfigured: false }
  // The actual response includes skillsShSource and path beyond the SDK type
  const res = await getWorkspace(wId).listSkills()
  return res as { skills: InstalledSkillInfo[]; isSkillsConfigured: boolean }
}

// ── Google (gog CLI) ──

export interface GogAccount {
  email: string
  client: string
  services: string[]
  scopes: string[]
  created_at: string
  auth: string
}

export async function fetchGogStatus(): Promise<{ installed: boolean; configured: boolean; accounts: GogAccount[] }> {
  const res = await fetch(`${MASTRA_BASE_URL}/gog/status`, { headers: authHeaders() })
  return res.json()
}

export async function startGogAuth(
  email: string,
  services?: string,
): Promise<{ authUrl: string }> {
  const res = await fetch(`${MASTRA_BASE_URL}/gog/auth/start`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, services }),
  })
  return res.json()
}

export async function completeGogAuth(
  email: string,
  redirectUrl: string,
  services?: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${MASTRA_BASE_URL}/gog/auth/complete`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirectUrl, services }),
  })
  return res.json()
}

export async function testGogAccount(email: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${MASTRA_BASE_URL}/gog/auth/test`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  return res.json()
}

export async function removeGogAccount(email: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${MASTRA_BASE_URL}/gog/auth/remove`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  return res.json()
}

// ── GitHub (gh CLI) ──

export async function fetchGhStatus(): Promise<{ installed: boolean; loggedIn: boolean; username: string | null }> {
  const res = await fetch(`${MASTRA_BASE_URL}/gh/status`, { headers: authHeaders() })
  return res.json()
}

export async function ghStartAuth(): Promise<{ userCode: string; authUrl: string }> {
  const res = await fetch(`${MASTRA_BASE_URL}/gh/auth/start`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to start auth' }))
    throw new Error(data.error || 'Failed to start auth')
  }
  return res.json()
}

export async function ghPollAuth(): Promise<{ ok: boolean; username?: string; error?: string }> {
  const res = await fetch(`${MASTRA_BASE_URL}/gh/auth/poll`, { method: 'POST', headers: authHeaders() })
  return res.json()
}

export async function ghLogout(): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${MASTRA_BASE_URL}/gh/auth/logout`, { method: 'POST', headers: authHeaders() })
  return res.json()
}

// ── WhatsApp ──

export interface WhatsAppStatus {
  status: 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'logged_out'
  qrDataUrl: string | null
  connectedPhone: string | null
}

export interface AllowlistEntry {
  phoneNumber: string
  label: string | null
  createdAt: string
}

export async function fetchWhatsAppStatus(): Promise<WhatsAppStatus> {
  const res = await fetch(`${MASTRA_BASE_URL}/whatsapp/status`, { headers: authHeaders() })
  return res.json()
}

export async function connectWhatsApp(): Promise<WhatsAppStatus> {
  const res = await fetch(`${MASTRA_BASE_URL}/whatsapp/connect`, { method: 'POST', headers: authHeaders() })
  return res.json()
}

export async function disconnectWhatsApp(): Promise<WhatsAppStatus> {
  const res = await fetch(`${MASTRA_BASE_URL}/whatsapp/disconnect`, { method: 'POST', headers: authHeaders() })
  return res.json()
}

export async function logoutWhatsApp(): Promise<void> {
  await fetch(`${MASTRA_BASE_URL}/whatsapp/logout`, { method: 'POST', headers: authHeaders() })
}

export async function fetchWhatsAppAllowlist(): Promise<AllowlistEntry[]> {
  const res = await fetch(`${MASTRA_BASE_URL}/whatsapp/allowlist`, { headers: authHeaders() })
  const data = await res.json()
  return data.items
}

export async function addToWhatsAppAllowlist(
  phoneNumber: string,
  label?: string,
): Promise<AllowlistEntry[]> {
  const res = await fetch(`${MASTRA_BASE_URL}/whatsapp/allowlist`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber, label }),
  })
  const data = await res.json()
  return data.items
}

export async function removeFromWhatsAppAllowlist(phoneNumber: string): Promise<void> {
  await fetch(`${MASTRA_BASE_URL}/whatsapp/allowlist/${encodeURIComponent(phoneNumber)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
}

export async function approveWhatsAppPairing(
  code: string,
): Promise<{ ok: boolean; error?: string; items?: AllowlistEntry[] }> {
  const res = await fetch(`${MASTRA_BASE_URL}/whatsapp/pair`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  return res.json()
}

// ── WhatsApp Groups ──

export interface GroupEntry {
  groupJid: string
  groupName: string | null
  mode: string
  enabled: boolean
  createdAt: string
}

export async function fetchWhatsAppGroups(): Promise<GroupEntry[]> {
  const res = await fetch(`${MASTRA_BASE_URL}/messaging/groups`, { headers: authHeaders() })
  const data = await res.json()
  return data.groups ?? []
}

export async function addWhatsAppGroup(groupJid: string, groupName?: string, mode?: string): Promise<void> {
  await fetch(`${MASTRA_BASE_URL}/messaging/groups`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupJid, groupName, mode }),
  })
}

export async function updateWhatsAppGroup(groupJid: string, updates: { enabled?: boolean; mode?: string; groupName?: string }): Promise<void> {
  await fetch(`${MASTRA_BASE_URL}/messaging/groups/${encodeURIComponent(groupJid)}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
}

export async function removeWhatsAppGroup(groupJid: string): Promise<void> {
  await fetch(`${MASTRA_BASE_URL}/messaging/groups/${encodeURIComponent(groupJid)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
}

// ── Superpowers (runtime check/install) ──

export async function checkSuperpowerRuntime(check: string): Promise<{ ok: boolean; output?: string; error?: string }> {
  const res = await fetch(`${MASTRA_BASE_URL}/superpowers/check-runtime`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ check }),
  })
  return res.json()
}

export async function installSuperpowerRuntime(install: string): Promise<{ ok: boolean; output?: string; error?: string }> {
  const res = await fetch(`${MASTRA_BASE_URL}/superpowers/install-runtime`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ install }),
  })
  return res.json()
}

// ── Browser Login ──

export async function startBrowserLogin(url: string): Promise<{ ok: boolean; url?: string; title?: string; error?: string }> {
  const res = await fetch(`${MASTRA_BASE_URL}/browser-login/start`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  return res.json()
}

export function getBrowserLoginFramesUrl(): string {
  return `${MASTRA_BASE_URL}/browser-login/frames`
}

export async function sendBrowserLoginInput(event: { type: string; params: unknown }): Promise<{ ok: boolean }> {
  const res = await fetch(`${MASTRA_BASE_URL}/browser-login/input`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  return res.json()
}

export async function navigateBrowserLogin(url: string): Promise<{ ok: boolean; url?: string; title?: string; error?: string }> {
  const res = await fetch(`${MASTRA_BASE_URL}/browser-login/navigate`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  return res.json()
}

export async function saveBrowserLoginAndClose(): Promise<{ ok: boolean; saved?: boolean; error?: string }> {
  const res = await fetch(`${MASTRA_BASE_URL}/browser-login/save-close`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
  })
  return res.json()
}

export async function getBrowserLoginStatus(): Promise<{ active: boolean; screencasting: boolean }> {
  const res = await fetch(`${MASTRA_BASE_URL}/browser-login/status`, { headers: authHeaders() })
  return res.json()
}

// ── MCP Servers ──

export interface McpServerConfig {
  id: string
  name: string
  type: 'stdio' | 'http'
  enabled: boolean
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  oauthStatus?: 'none' | 'authorized' | 'pending'
}

export async function fetchMcpServers(): Promise<McpServerConfig[]> {
  const res = await fetch(`${MASTRA_BASE_URL}/mcp-servers`, { headers: authHeaders() })
  const data = await res.json()
  return data.servers
}

export async function saveMcpServers(servers: McpServerConfig[]): Promise<McpServerConfig[]> {
  const res = await fetch(`${MASTRA_BASE_URL}/mcp-servers`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ servers }),
  })
  const data = await res.json()
  return data.servers
}

export async function testMcpServer(
  config: McpServerConfig,
): Promise<{ ok: boolean; tools?: string[]; error?: string; oauthRequired?: boolean }> {
  const res = await fetch(`${MASTRA_BASE_URL}/mcp-servers/test`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  return res.json()
}

// ── MCP OAuth ──

export async function startMcpOAuth(
  serverId: string,
  serverUrl: string,
): Promise<{ ok: boolean; authUrl?: string; alreadyAuthorized?: boolean; error?: string }> {
  const res = await fetch(`${MASTRA_BASE_URL}/mcp-servers/oauth/start`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId, serverUrl, callbackBaseUrl: MASTRA_BASE_URL }),
  })
  return res.json()
}

export async function pollMcpOAuthStatus(
  serverId: string,
): Promise<{ ok: boolean; pending: boolean }> {
  const res = await fetch(`${MASTRA_BASE_URL}/mcp-servers/oauth/poll`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId }),
  })
  return res.json()
}

export async function revokeMcpOAuth(serverId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${MASTRA_BASE_URL}/mcp-servers/oauth/revoke`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId }),
  })
  return res.json()
}

// ── Exposed MCP Server Info ──

export interface ExposedMcpServerInfo {
  id: string
  name: string
  description?: string
  version: string
  tools: { name: string; description?: string }[]
}

export async function fetchExposedMcpServers(): Promise<ExposedMcpServerInfo[]> {
  const res = await fetch(`${MASTRA_BASE_URL}/api/mcp/v0/servers`, { headers: authHeaders() })
  const data = await res.json()
  return Promise.all(
    (data.servers || []).map(async (srv: any) => {
      try {
        const toolsRes = await fetch(`${MASTRA_BASE_URL}/api/mcp/${srv.id}/tools`, { headers: authHeaders() })
        const toolsData = await toolsRes.json()
        const toolsList = Array.isArray(toolsData.tools)
          ? toolsData.tools.map((t: any) => ({ name: t.name || t.id, description: t.description }))
          : Object.entries(toolsData.tools || {}).map(([name, t]: [string, any]) => ({
              name,
              description: (t as any)?.description,
            }))
        return { ...srv, tools: toolsList }
      } catch {
        return { ...srv, tools: [] }
      }
    }),
  )
}

// ── A2A Info ──

export interface A2aInfo {
  agentId: string
  endpoints: { a2a: string; agentCard: string }
}

export async function fetchA2aInfo(): Promise<A2aInfo> {
  const res = await fetch(`${MASTRA_BASE_URL}/a2a-info`, { headers: authHeaders() })
  return res.json()
}
