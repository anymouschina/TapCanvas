import type { Edge, Node } from 'reactflow'
import { getAuthToken } from '../auth/store'

const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3000'
function withAuth(init?: RequestInit): RequestInit {
  const t = getAuthToken()
  return { ...(init || {}), headers: { ...(init?.headers || {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) } }
}

export type FlowDto = { id: string; name: string; data: { nodes: Node[]; edges: Edge[] }; createdAt: string; updatedAt: string }
export type ProjectDto = { id: string; name: string; createdAt: string; updatedAt: string }
export type ModelProviderDto = { id: string; name: string; vendor: string; baseUrl?: string | null }
export type ModelTokenDto = {
  id: string
  providerId: string
  label: string
  secretToken: string
  userAgent?: string | null
  enabled: boolean
  shared?: boolean
}
export type ModelEndpointDto = {
  id: string
  providerId: string
  key: string
  label: string
  baseUrl: string
  shared?: boolean
}

export async function listServerFlows(): Promise<FlowDto[]> {
  const r = await fetch(`${API_BASE}/flows`, withAuth())
  if (!r.ok) throw new Error(`list flows failed: ${r.status}`)
  return r.json()
}

export async function getServerFlow(id: string): Promise<FlowDto> {
  const r = await fetch(`${API_BASE}/flows/${id}`, withAuth())
  if (!r.ok) throw new Error(`get flow failed: ${r.status}`)
  return r.json()
}

export async function saveServerFlow(payload: { id?: string; name: string; nodes: Node[]; edges: Edge[] }): Promise<FlowDto> {
  const r = await fetch(`${API_BASE}/flows`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: payload.id, name: payload.name, data: { nodes: payload.nodes, edges: payload.edges } })
  }))
  if (!r.ok) throw new Error(`save flow failed: ${r.status}`)
  return r.json()
}

export async function deleteServerFlow(id: string): Promise<void> {
  const r = await fetch(`${API_BASE}/flows/${id}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete flow failed: ${r.status}`)
}

export async function exchangeGithub(code: string): Promise<{ token: string; user: any }> {
  const r = await fetch(`${API_BASE}/auth/github/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
  if (!r.ok) throw new Error(`exchange failed: ${r.status}`)
  return r.json()
}

export async function listFlowVersions(flowId: string): Promise<Array<{ id: string; createdAt: string; name: string }>> {
  const r = await fetch(`${API_BASE}/flows/${flowId}/versions`, withAuth())
  if (!r.ok) throw new Error(`list versions failed: ${r.status}`)
  return r.json()
}

export async function rollbackFlow(flowId: string, versionId: string) {
  const r = await fetch(`${API_BASE}/flows/${flowId}/rollback`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId }) }))
  if (!r.ok) throw new Error(`rollback failed: ${r.status}`)
  return r.json()
}
export async function listProjects(): Promise<ProjectDto[]> {
  const r = await fetch(`${API_BASE}/projects`, withAuth())
  if (!r.ok) throw new Error(`list projects failed: ${r.status}`)
  return r.json()
}

export async function upsertProject(payload: { id?: string; name: string }): Promise<ProjectDto> {
  const r = await fetch(`${API_BASE}/projects`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))
  if (!r.ok) throw new Error(`save project failed: ${r.status}`)
  return r.json()
}

export async function listProjectFlows(projectId: string): Promise<FlowDto[]> {
  const r = await fetch(`${API_BASE}/flows?projectId=${encodeURIComponent(projectId)}`, withAuth())
  if (!r.ok) throw new Error(`list flows failed: ${r.status}`)
  return r.json()
}

export async function saveProjectFlow(payload: { id?: string; projectId: string; name: string; nodes: Node[]; edges: Edge[] }): Promise<FlowDto> {
  const r = await fetch(`${API_BASE}/flows`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: payload.id, projectId: payload.projectId, name: payload.name, data: { nodes: payload.nodes, edges: payload.edges } }) }))
  if (!r.ok) throw new Error(`save flow failed: ${r.status}`)
  return r.json()
}

// Model provider & token APIs
export async function listModelProviders(): Promise<ModelProviderDto[]> {
  const r = await fetch(`${API_BASE}/models/providers`, withAuth())
  if (!r.ok) throw new Error(`list providers failed: ${r.status}`)
  return r.json()
}

export async function upsertModelProvider(payload: { id?: string; name: string; vendor: string; baseUrl?: string | null }): Promise<ModelProviderDto> {
  const r = await fetch(`${API_BASE}/models/providers`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`save provider failed: ${r.status}`)
  return r.json()
}

export async function listModelTokens(providerId: string): Promise<ModelTokenDto[]> {
  const r = await fetch(`${API_BASE}/models/providers/${encodeURIComponent(providerId)}/tokens`, withAuth())
  if (!r.ok) throw new Error(`list tokens failed: ${r.status}`)
  return r.json()
}

export async function upsertModelToken(payload: {
  id?: string
  providerId: string
  label: string
  secretToken: string
  enabled?: boolean
  userAgent?: string | null
  shared?: boolean
}): Promise<ModelTokenDto> {
  const r = await fetch(`${API_BASE}/models/tokens`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`save token failed: ${r.status}`)
  return r.json()
}

export async function deleteModelToken(id: string): Promise<void> {
  const r = await fetch(`${API_BASE}/models/tokens/${encodeURIComponent(id)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete token failed: ${r.status}`)
}

export async function listModelEndpoints(providerId: string): Promise<ModelEndpointDto[]> {
  const r = await fetch(`${API_BASE}/models/providers/${encodeURIComponent(providerId)}/endpoints`, withAuth())
  if (!r.ok) throw new Error(`list endpoints failed: ${r.status}`)
  return r.json()
}

export async function upsertModelEndpoint(payload: {
  id?: string
  providerId: string
  key: string
  label: string
  baseUrl: string
  shared?: boolean
}): Promise<ModelEndpointDto> {
  const r = await fetch(`${API_BASE}/models/endpoints`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`save endpoint failed: ${r.status}`)
  return r.json()
}

export type SoraDraftItemDto = {
  id: string
  kind: string
  title: string | null
  prompt: string | null
  width: number | null
  height: number | null
  generationType: string | null
  createdAt: number | null
  thumbnailUrl: string | null
  videoUrl: string | null
  platform: 'sora'
}

export type SoraDraftListDto = { items: SoraDraftItemDto[]; cursor: string | null }

export async function listSoraDrafts(tokenId?: string | null, cursor?: string | null): Promise<SoraDraftListDto> {
  const qs = new URLSearchParams()
  if (tokenId) qs.set('tokenId', tokenId)
  if (cursor) qs.set('cursor', cursor)
  const query = qs.toString()
  const url = query ? `${API_BASE}/sora/drafts?${query}` : `${API_BASE}/sora/drafts`
  const r = await fetch(url, withAuth())
  if (!r.ok) throw new Error(`list drafts failed: ${r.status}`)
  return r.json()
}

export async function deleteSoraDraft(tokenId: string, draftId: string): Promise<void> {
  const qs = new URLSearchParams({ tokenId, draftId })
  const r = await fetch(`${API_BASE}/sora/drafts/delete?${qs.toString()}`, withAuth())
  if (!r.ok) throw new Error(`delete draft failed: ${r.status}`)
}

export async function listSoraCharacters(
  tokenId?: string | null,
  cursor?: string | null,
  limit?: number,
): Promise<{ items: any[]; cursor: string | null }> {
  const qs = new URLSearchParams()
  if (tokenId) qs.set('tokenId', tokenId)
  if (cursor) qs.set('cursor', cursor)
  if (typeof limit === 'number' && !Number.isNaN(limit)) qs.set('limit', String(limit))
  const query = qs.toString()
  const url = query ? `${API_BASE}/sora/characters?${query}` : `${API_BASE}/sora/characters`
  const r = await fetch(url, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg =
      (body && (body.message || body.error)) ||
      `list sora characters failed: ${r.status}`
    throw new Error(msg)
  }
  return body
}

export async function suggestDraftPrompts(
  query: string,
  provider = 'sora',
  mode?: 'history' | 'semantic',
): Promise<{ prompts: string[] }> {
  const qs = new URLSearchParams({ q: query })
  if (provider) qs.set('provider', provider)
  if (mode === 'semantic') qs.set('mode', 'semantic')
  const r = await fetch(`${API_BASE}/drafts/suggest?${qs.toString()}`, withAuth())
  if (!r.ok) throw new Error(`suggest prompts failed: ${r.status}`)
  return r.json()
}

export async function markDraftPromptUsed(prompt: string, provider = 'sora'): Promise<void> {
  const qs = new URLSearchParams({ prompt })
  if (provider) qs.set('provider', provider)
  const r = await fetch(`${API_BASE}/drafts/mark-used?${qs.toString()}`, withAuth())
  if (!r.ok) throw new Error(`mark prompt used failed: ${r.status}`)
}

// Assets API
export type ServerAssetDto = { id: string; name: string; data: any; createdAt: string; updatedAt: string; projectId?: string|null }

export async function listServerAssets(projectId: string): Promise<ServerAssetDto[]> {
  const r = await fetch(`${API_BASE}/assets?projectId=${encodeURIComponent(projectId)}`, withAuth())
  if (!r.ok) throw new Error(`list assets failed: ${r.status}`)
  return r.json()
}

export async function createServerAsset(payload: { projectId: string; name: string; data: any }): Promise<ServerAssetDto> {
  const r = await fetch(`${API_BASE}/assets`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))
  if (!r.ok) throw new Error(`create asset failed: ${r.status}`)
  return r.json()
}

export async function renameServerAsset(id: string, name: string): Promise<ServerAssetDto> {
  const r = await fetch(`${API_BASE}/assets/${id}`, withAuth({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }))
  if (!r.ok) throw new Error(`rename asset failed: ${r.status}`)
  return r.json()
}

export async function deleteServerAsset(id: string): Promise<void> {
  const r = await fetch(`${API_BASE}/assets/${id}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete asset failed: ${r.status}`)
}

// Unified task API
export type TaskKind =
  | 'chat'
  | 'prompt_refine'
  | 'text_to_image'
  | 'image_to_video'
  | 'text_to_video'
  | 'image_edit'

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type TaskAssetDto = { type: 'image' | 'video'; url: string; thumbnailUrl?: string | null }

export type TaskResultDto = {
  id: string
  kind: TaskKind
  status: TaskStatus
  assets: TaskAssetDto[]
  raw: any
}

export type TaskRequestDto = {
  kind: TaskKind
  prompt: string
  negativePrompt?: string
  seed?: number
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  extras?: Record<string, any>
}

export async function runTask(profileId: string, request: TaskRequestDto): Promise<TaskResultDto> {
  const r = await fetch(`${API_BASE}/tasks`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, request }),
  }))
  if (!r.ok) throw new Error(`run task failed: ${r.status}`)
  return r.json()
}

export async function runTaskByVendor(vendor: string, request: TaskRequestDto): Promise<TaskResultDto> {
  const r = await fetch(`${API_BASE}/tasks`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendor, request }),
  }))
  if (!r.ok) throw new Error(`run task failed: ${r.status}`)
  return r.json()
}
