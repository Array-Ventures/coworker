import { MastraClient } from '@mastra/client-js'
import type { StorageThreadType } from '@mastra/core/memory'
import type { ListSkillsResponse } from '@mastra/client-js'

export type { StorageThreadType } from '@mastra/core/memory'
export type { SkillMetadata, ListSkillsResponse } from '@mastra/client-js'

// Extended type — the actual list-skills response includes fields not in the SDK type
export type InstalledSkillInfo = {
  name: string
  description: string
  path?: string
  skillsShSource?: { owner: string; repo: string }
}

const MASTRA_BASE_URL = 'http://localhost:4111'

export const AGENT_ID = 'coworker'
export const RESOURCE_ID = 'local-user'

export const mastraClient = new MastraClient({
  baseUrl: MASTRA_BASE_URL,
})

export async function fetchThreads(filter?: string) {
  const params: Record<string, any> = { agentId: AGENT_ID }

  if (filter === 'Scheduled') {
    // Scheduled task runs use a dedicated resourceId
    params.resourceId = 'scheduled-tasks'
  } else {
    params.resourceId = RESOURCE_ID
  }

  const result = await mastraClient.listMemoryThreads(params)
  return result.threads
}

export async function fetchThread(threadId: string): Promise<StorageThreadType> {
  const thread = mastraClient.getMemoryThread({
    threadId,
    agentId: AGENT_ID,
  })
  return thread.get()
}

export async function fetchThreadMessages(threadId: string) {
  const thread = mastraClient.getMemoryThread({
    threadId,
    agentId: AGENT_ID,
  })
  const result = await thread.listMessages({
    orderBy: { field: 'createdAt', direction: 'ASC' },
  })
  return result.messages
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
  const res = await fetch(`${MASTRA_BASE_URL}/agent-config`)
  return res.json()
}

export async function updateAgentConfig(body: {
  model?: string | null
  instructions?: string | null
}) {
  const res = await fetch(`${MASTRA_BASE_URL}/agent-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
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
  const res = await fetch(`${MASTRA_BASE_URL}/scheduled-tasks`)
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function deleteScheduledTask(id: string) {
  const res = await fetch(`${MASTRA_BASE_URL}/scheduled-tasks/${id}`, {
    method: 'DELETE',
  })
  return res.json()
}

export async function updateScheduledTask(
  id: string,
  body: { name?: string; scheduleConfig?: any; prompt?: string; notify?: boolean },
) {
  const res = await fetch(`${MASTRA_BASE_URL}/scheduled-tasks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function toggleScheduledTask(id: string, enabled: boolean) {
  const res = await fetch(`${MASTRA_BASE_URL}/scheduled-tasks/${id}/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
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
  )
  return res.json() as Promise<{ skills: SkillShBrowseItem[]; count: number }>
}

export async function searchSkillsSh(q: string, limit = 30) {
  const wId = await getWorkspaceId()
  if (!wId) return { skills: [] as SkillShBrowseItem[], count: 0 }
  const res = await fetch(
    `${MASTRA_BASE_URL}/api/workspaces/${wId}/skills-sh/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  )
  return res.json() as Promise<{ skills: SkillShBrowseItem[]; count: number }>
}

export async function installSkillSh(owner: string, repo: string, skillName: string) {
  const wId = await getWorkspaceId()
  if (!wId) throw new Error('No workspace')
  const res = await fetch(`${MASTRA_BASE_URL}/api/workspaces/${wId}/skills-sh/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, repo, skillName }),
  })
  return res.json()
}

export async function removeSkillSh(skillName: string) {
  const wId = await getWorkspaceId()
  if (!wId) throw new Error('No workspace')
  const res = await fetch(`${MASTRA_BASE_URL}/api/workspaces/${wId}/skills-sh/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skillName }),
  })
  return res.json()
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
  const res = await fetch(`${MASTRA_BASE_URL}/whatsapp/status`)
  return res.json()
}

export async function connectWhatsApp(): Promise<WhatsAppStatus> {
  const res = await fetch(`${MASTRA_BASE_URL}/whatsapp/connect`, { method: 'POST' })
  return res.json()
}

export async function disconnectWhatsApp(): Promise<WhatsAppStatus> {
  const res = await fetch(`${MASTRA_BASE_URL}/whatsapp/disconnect`, { method: 'POST' })
  return res.json()
}

export async function logoutWhatsApp(): Promise<void> {
  await fetch(`${MASTRA_BASE_URL}/whatsapp/logout`, { method: 'POST' })
}

export async function fetchWhatsAppAllowlist(): Promise<AllowlistEntry[]> {
  const res = await fetch(`${MASTRA_BASE_URL}/whatsapp/allowlist`)
  const data = await res.json()
  return data.items
}

export async function addToWhatsAppAllowlist(
  phoneNumber: string,
  label?: string,
): Promise<AllowlistEntry[]> {
  const res = await fetch(`${MASTRA_BASE_URL}/whatsapp/allowlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber, label }),
  })
  const data = await res.json()
  return data.items
}

export async function removeFromWhatsAppAllowlist(phoneNumber: string): Promise<void> {
  await fetch(`${MASTRA_BASE_URL}/whatsapp/allowlist/${encodeURIComponent(phoneNumber)}`, {
    method: 'DELETE',
  })
}

export async function approveWhatsAppPairing(
  code: string,
): Promise<{ ok: boolean; error?: string; items?: AllowlistEntry[] }> {
  const res = await fetch(`${MASTRA_BASE_URL}/whatsapp/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  return res.json()
}
