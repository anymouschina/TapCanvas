import type { Edge, Node } from 'reactflow'
import { getAuthToken, getAuthTokenFromCookie } from '../auth/store'
// self-import guard: only used for type re-export in the same module

const viteEnv = ((import.meta as any).env || {}) as Record<string, any>
export const API_BASE =
  (typeof viteEnv.VITE_API_BASE === 'string' && viteEnv.VITE_API_BASE.trim() ? viteEnv.VITE_API_BASE.trim() : null) ||
  (viteEnv.DEV ? 'http://localhost:8788' : '')
const API_RETRY_WINDOW_MS = Number(viteEnv.VITE_API_RETRY_WINDOW_MS) || 8000
const API_RETRY_BASE_DELAY_MS = Number(viteEnv.VITE_API_RETRY_BASE_DELAY_MS) || 400
const API_RETRY_MAX_DELAY_MS = Number(viteEnv.VITE_API_RETRY_MAX_DELAY_MS) || 2000
function withAuth(init?: RequestInit): RequestInit {
  const t = getAuthToken() || getAuthTokenFromCookie()
  return {
    credentials: init?.credentials ?? 'include',
    ...(init || {}),
    headers: { ...(init?.headers || {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
  }
}

function withoutAuth(init?: RequestInit): RequestInit {
  return {
    credentials: init?.credentials ?? 'omit',
    ...(init || {}),
    headers: { ...(init?.headers || {}) },
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isRetryableStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)

const hasNoRetryHeader = (headers?: HeadersInit) => {
  if (!headers) return false
  if (headers instanceof Headers) {
    return headers.has('x-tap-no-retry') || headers.has('X-Tap-No-Retry')
  }
  if (Array.isArray(headers)) {
    return headers.some(([k]) => /x-tap-no-retry/i.test(k))
  }
  return Object.keys(headers).some((k) => /x-tap-no-retry/i.test(k))
}

const isBodyRetryable = (body: RequestInit['body']) => {
  if (!body) return true
  return typeof (body as any).getReader !== 'function'
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const startedAt = Date.now()
  const skipRetry = hasNoRetryHeader(init?.headers) || !isBodyRetryable(init?.body)
  let attempt = 0
  let lastResponse: Response | null = null

  while (true) {
    try {
      const res = await fetch(input, init)
      if (!isRetryableStatus(res.status) || skipRetry) return res
      lastResponse = res
    } catch (err) {
      if (skipRetry) throw err
      if (Date.now() - startedAt >= API_RETRY_WINDOW_MS) throw err
    }

    const elapsed = Date.now() - startedAt
    if (elapsed >= API_RETRY_WINDOW_MS) return lastResponse as Response

    const backoff = Math.min(API_RETRY_BASE_DELAY_MS * Math.pow(2, attempt), API_RETRY_MAX_DELAY_MS)
    const jitter = Math.floor(Math.random() * 120)
    attempt += 1
    await sleep(backoff + jitter)
  }
}

export type FlowDto = { id: string; name: string; data: { nodes: Node[]; edges: Edge[]; viewport?: { x: number; y: number; zoom: number } | null }; createdAt: string; updatedAt: string }
export type ProjectDto = { id: string; name: string; createdAt: string; updatedAt: string; isPublic?: boolean; owner?: string; ownerName?: string }
export type ModelProviderDto = { id: string; name: string; vendor: string; baseUrl?: string | null; sharedBaseUrl?: boolean }
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

export type ProxyConfigDto = {
  id: string
  name: string
  vendor: string
  baseUrl: string
  enabled: boolean
  enabledVendors: string[]
  hasApiKey: boolean
  createdAt?: string
  updatedAt?: string
}

export type WorkflowExecutionDto = {
  id: string
  flowId: string
  flowVersionId: string
  ownerId: string
  status: 'queued' | 'running' | 'success' | 'failed' | 'canceled'
  concurrency: number
  trigger?: string | null
  errorMessage?: string | null
  createdAt: string
  startedAt?: string | null
  finishedAt?: string | null
}

export type WorkflowExecutionEventDto = {
  id: string
  executionId: string
  seq: number
  eventType: string
  level: 'debug' | 'info' | 'warn' | 'error'
  nodeId?: string | null
  message?: string | null
  data?: any
  createdAt: string
}

export type WorkflowNodeRunDto = {
  id: string
  executionId: string
  nodeId: string
  status: 'queued' | 'running' | 'success' | 'failed' | 'skipped' | 'canceled'
  attempt: number
  errorMessage?: string | null
  outputRefs?: any
  createdAt: string
  startedAt?: string | null
  finishedAt?: string | null
}

export type VideoHistoryRecord = {
  id: string
  prompt: string | null
  taskId: string
  generationId?: string | null
  status: string
  videoUrl?: string | null
  thumbnailUrl?: string | null
  duration?: number | null
  width?: number | null
  height?: number | null
  provider: string
  model?: string | null
  createdAt: string
}

export type ProfileKind =
  | 'chat'
  | 'prompt_refine'
  | 'text_to_image'
  | 'image_to_prompt'
  | 'image_to_video'
  | 'text_to_video'
  | 'image_edit'

export type ModelProfileDto = {
  id: string
  ownerId: string
  providerId: string
  name: string
  kind: ProfileKind
  modelKey: string
  settings?: any
  provider?: { id: string; name: string; vendor: string }
}

export type AvailableModelDto = {
  value: string
  label: string
  vendor?: string
}

export type PromptSampleDto = {
  id: string
  scene: string
  commandType: string
  title: string
  nodeKind: 'image' | 'composeVideo' | 'storyboard'
  prompt: string
  description?: string
  inputHint?: string
  outputNote?: string
  keywords: string[]
  source?: 'official' | 'custom'
}

export type PromptSampleInput = {
  scene: string
  commandType: string
  title: string
  nodeKind: 'image' | 'composeVideo' | 'storyboard'
  prompt: string
  description?: string
  inputHint?: string
  outputNote?: string
  keywords?: string[]
}

export type PromptGeneratePayload = {
  workflow: 'character_creation' | 'direct_image' | 'merchandise'
  subject: string
  visual_style?: string
  model?: string
  consistency?: string
  language?: 'zh' | 'en'
}

export type PromptGenerateResult = {
  workflow: string
  prompt: string
  negative_prompt: string
  suggested_aspects: string[]
  notes: string[]
}

export type ChatSessionSummaryDto = {
  id: string
  title: string | null
  model: string | null
  provider: string | null
  lastMessage?: string | null
  createdAt: string
  updatedAt: string
}

export type ChatHistoryMessageDto = {
  id: string
  role: string
  content?: string | null
  parts?: any[] | null
  metadata?: Record<string, any> | null
  createdAt: string
}

export type ChatHistoryDto = {
  session: {
    id: string
    title: string | null
    model: string | null
    provider: string | null
    createdAt: string
    updatedAt: string
  } | null
  messages: ChatHistoryMessageDto[]
}

export type AgentContinueInput = {
  sessionId: string
  planId?: string
  intent?: string
  goals?: string[]
  guardrails?: {
    acceptance?: string[]
    checkpoints?: string[]
    extras?: string[]
    failureHandling?: string[]
  }
  toolResult: {
    sessionId: string
    toolCallId?: string
    toolName?: string
    nodeId?: string
    nodeKind?: string
    output?: any
    errorText?: string
  }
  model?: string
  provider?: string
}

export type AgentContinueOutput = {
  reply?: string
  followUp?: string
  shouldContinue?: boolean
}

export async function fetchPromptSamples(params?: { query?: string; nodeKind?: string; source?: 'official' | 'custom' | 'all' }): Promise<{ samples: PromptSampleDto[] }> {
  const qs = new URLSearchParams()
  if (params?.query) qs.set('q', params.query)
  if (params?.nodeKind) qs.set('nodeKind', params.nodeKind)
  if (params?.source) qs.set('source', params.source)
  const query = qs.toString()
  const url = query ? `${API_BASE}/ai/prompt-samples?${query}` : `${API_BASE}/ai/prompt-samples`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`fetch prompt samples failed: ${r.status}`)
  return r.json()
}

export async function parsePromptSample(payload: { rawPrompt: string; nodeKind?: string }): Promise<PromptSampleInput> {
  const r = await apiFetch(`${API_BASE}/ai/prompt-samples/parse`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`parse prompt sample failed: ${r.status}`)
  return r.json()
}

export async function createPromptSample(payload: PromptSampleInput): Promise<PromptSampleDto> {
  const r = await apiFetch(`${API_BASE}/ai/prompt-samples`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`create prompt sample failed: ${r.status}`)
  return r.json()
}

export async function listChatSessions(): Promise<ChatSessionSummaryDto[]> {
  const r = await apiFetch(`${API_BASE}/ai/chat/sessions`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `list chat sessions failed: ${r.status}`
    throw new Error(msg)
  }
  const sessions: any[] = Array.isArray(body?.sessions) ? body.sessions : []
  return sessions.map((s, index) => ({
    id: String(s.id ?? `session-${index}`),
    title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : null,
    model: typeof s.model === 'string' ? s.model : null,
    provider: typeof s.provider === 'string' ? s.provider : null,
    lastMessage: typeof s.lastMessage === 'string' ? s.lastMessage : null,
    createdAt: String(s.createdAt ?? s.created_at ?? ''),
    updatedAt: String(s.updatedAt ?? s.updated_at ?? ''),
  }))
}

export async function getChatHistory(sessionId: string): Promise<ChatHistoryDto> {
  const qs = new URLSearchParams()
  qs.set('sessionId', sessionId)
  const r = await apiFetch(`${API_BASE}/ai/chat/history?${qs.toString()}`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `get chat history failed: ${r.status}`
    throw new Error(msg)
  }
  const sessionRaw = body?.session || null
  const messagesRaw: any[] = Array.isArray(body?.messages) ? body.messages : []
  const session = sessionRaw
    ? {
        id: String(sessionRaw.id),
        title: typeof sessionRaw.title === 'string' ? sessionRaw.title : null,
        model: typeof sessionRaw.model === 'string' ? sessionRaw.model : null,
        provider: typeof sessionRaw.provider === 'string' ? sessionRaw.provider : null,
        createdAt: String(sessionRaw.createdAt ?? sessionRaw.created_at ?? ''),
        updatedAt: String(sessionRaw.updatedAt ?? sessionRaw.updated_at ?? ''),
      }
    : null
  const messages: ChatHistoryMessageDto[] = messagesRaw.map((row) => ({
    id: String(row.id),
    role: typeof row.role === 'string' ? row.role : 'user',
    content: typeof row.content === 'string' ? row.content : row.content ?? null,
    parts: Array.isArray(row.parts) ? row.parts : null,
    metadata: row && typeof row.metadata === 'object' ? row.metadata : null,
    createdAt: String(row.createdAt ?? row.created_at ?? ''),
  }))
  return { session, messages }
}

export async function renameChatSession(sessionId: string, title: string): Promise<ChatSessionSummaryDto> {
  const payload = { title }
  const r = await apiFetch(`${API_BASE}/ai/chat/sessions/${encodeURIComponent(sessionId)}`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `rename chat session failed: ${r.status}`
    throw new Error(msg)
  }
  return {
    id: String(body.id ?? sessionId),
    title: typeof body.title === 'string' ? body.title : null,
    model: typeof body.model === 'string' ? body.model : null,
    provider: typeof body.provider === 'string' ? body.provider : null,
    lastMessage: typeof body.lastMessage === 'string' ? body.lastMessage : null,
    createdAt: String(body.createdAt ?? body.created_at ?? ''),
    updatedAt: String(body.updatedAt ?? body.updated_at ?? ''),
  }
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/ai/chat/sessions/${encodeURIComponent(sessionId)}`, withAuth({
    method: 'DELETE',
  }))
  if (!r.ok) {
    let body: any = null
    try {
      body = await r.json()
    } catch {
      body = null
    }
    const msg = (body && (body.message || body.error)) || `delete chat session failed: ${r.status}`
    throw new Error(msg)
  }
}

export type LangGraphProjectThreadDto = {
  threadId: string | null
}

export type StatsDto = {
  onlineUsers: number
  totalUsers: number
  newUsersToday: number
}

export type DauPointDto = { day: string; activeUsers: number }
export type DauSeriesDto = { days: number; series: DauPointDto[] }

export async function getStats(): Promise<StatsDto> {
  const r = await apiFetch(`${API_BASE}/stats`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `get stats failed: ${r.status}`
    throw new Error(msg)
  }
  return {
    onlineUsers: Number(body?.onlineUsers ?? 0) || 0,
    totalUsers: Number(body?.totalUsers ?? 0) || 0,
    newUsersToday: Number(body?.newUsersToday ?? 0) || 0,
  }
}

export async function getDailyActiveUsers(days = 30): Promise<DauSeriesDto> {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(365, Math.floor(days))) : 30
  const r = await apiFetch(`${API_BASE}/stats/dau?days=${encodeURIComponent(String(safeDays))}`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `get dau failed: ${r.status}`
    throw new Error(msg)
  }
  const seriesRaw = Array.isArray(body?.series) ? body.series : []
  const series = seriesRaw
    .map((p: any) => ({ day: String(p?.day || ''), activeUsers: Number(p?.activeUsers ?? 0) || 0 }))
    .filter((p: any) => typeof p.day === 'string' && p.day.length >= 10)
  return { days: Number(body?.days ?? safeDays) || safeDays, series }
}

export async function getLangGraphProjectThread(projectId: string): Promise<LangGraphProjectThreadDto> {
  const r = await apiFetch(`${API_BASE}/ai/langgraph/projects/${encodeURIComponent(projectId)}/thread`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `get langgraph thread failed: ${r.status}`
    throw new Error(msg)
  }
  return { threadId: typeof body?.threadId === 'string' ? body.threadId : null }
}

export async function getPublicLangGraphProjectThread(projectId: string): Promise<LangGraphProjectThreadDto> {
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/langgraph/thread`, {
    headers: { 'Content-Type': 'application/json' },
  })
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `get public langgraph thread failed: ${r.status}`
    throw new Error(msg)
  }
  return { threadId: typeof body?.threadId === 'string' ? body.threadId : null }
}

export async function setLangGraphProjectThread(projectId: string, threadId: string): Promise<{ threadId: string }> {
  const r = await apiFetch(`${API_BASE}/ai/langgraph/projects/${encodeURIComponent(projectId)}/thread`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId }),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `set langgraph thread failed: ${r.status}`
    throw new Error(msg)
  }
  return { threadId: String(body?.threadId ?? threadId) }
}

export async function clearLangGraphProjectThread(projectId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/ai/langgraph/projects/${encodeURIComponent(projectId)}/thread`, withAuth({
    method: 'DELETE',
  }))
  if (!r.ok) {
    let body: any = null
    try {
      body = await r.json()
    } catch {
      body = null
    }
    const msg = (body && (body.message || body.error)) || `clear langgraph thread failed: ${r.status}`
    throw new Error(msg)
  }
}

export type LangGraphProjectSnapshotDto = {
  snapshot: { threadId: string | null; messagesJson: string } | null
}

export async function getLangGraphProjectSnapshot(projectId: string): Promise<LangGraphProjectSnapshotDto> {
  const r = await apiFetch(`${API_BASE}/ai/langgraph/projects/${encodeURIComponent(projectId)}/snapshot`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `get langgraph snapshot failed: ${r.status}`
    throw new Error(msg)
  }
  const snap = body?.snapshot
  if (!snap) return { snapshot: null }
  return {
    snapshot: {
      threadId: typeof snap?.threadId === 'string' ? snap.threadId : null,
      messagesJson: typeof snap?.messagesJson === 'string' ? snap.messagesJson : '',
    },
  }
}

export async function getLangGraphProjectSnapshotPublic(projectId: string): Promise<LangGraphProjectSnapshotDto> {
  const r = await apiFetch(
    `${API_BASE}/ai/langgraph/projects/${encodeURIComponent(projectId)}/snapshot`,
    withoutAuth(),
  )
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `get langgraph snapshot failed: ${r.status}`
    throw new Error(msg)
  }
  const snap = body?.snapshot
  if (!snap) return { snapshot: null }
  return {
    snapshot: {
      threadId: typeof snap?.threadId === 'string' ? snap.threadId : null,
      messagesJson: typeof snap?.messagesJson === 'string' ? snap.messagesJson : '',
    },
  }
}

export async function setLangGraphProjectSnapshot(projectId: string, payload: { threadId?: string | null; messagesJson: string }): Promise<{ threadId: string | null }> {
  const r = await apiFetch(`${API_BASE}/ai/langgraph/projects/${encodeURIComponent(projectId)}/snapshot`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `set langgraph snapshot failed: ${r.status}`
    throw new Error(msg)
  }
  const threadId = typeof body?.snapshot?.threadId === 'string' ? body.snapshot.threadId : null
  return { threadId }
}

export async function clearLangGraphProjectSnapshot(projectId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/ai/langgraph/projects/${encodeURIComponent(projectId)}/snapshot`, withAuth({
    method: 'DELETE',
  }))
  if (!r.ok) {
    let body: any = null
    try {
      body = await r.json()
    } catch {
      body = null
    }
    const msg = (body && (body.message || body.error)) || `clear langgraph snapshot failed: ${r.status}`
    throw new Error(msg)
  }
}

export type AgentContinueInput = {
  sessionId: string
  planId?: string
  intent?: string
  goals?: string[]
  guardrails?: {
    acceptance?: string[]
    checkpoints?: string[]
    extras?: string[]
    failureHandling?: string[]
  }
  toolResult: {
    sessionId: string
    toolCallId?: string
    toolName?: string
    nodeId?: string
    nodeKind?: string
    output?: any
    errorText?: string
  }
  model?: string
  provider?: string
}

export type AgentContinueOutput = {
  reply?: string
  followUp?: string
  shouldContinue?: boolean
}

export async function agentContinue(payload: AgentContinueInput): Promise<AgentContinueOutput> {
  const r = await apiFetch(`${API_BASE}/ai/agent/continue`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `agent continue failed: ${r.status}`
    throw new Error(msg)
  }
  return body as AgentContinueOutput
}

export async function deletePromptSample(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/ai/prompt-samples/${id}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete prompt sample failed: ${r.status}`)
}

export async function listServerFlows(): Promise<FlowDto[]> {
  const r = await apiFetch(`${API_BASE}/flows`, withAuth())
  if (!r.ok) throw new Error(`list flows failed: ${r.status}`)
  return r.json()
}

export async function getServerFlow(id: string): Promise<FlowDto> {
  const r = await apiFetch(`${API_BASE}/flows/${id}`, withAuth())
  if (!r.ok) throw new Error(`get flow failed: ${r.status}`)
  return r.json()
}

export async function saveServerFlow(payload: { id?: string; name: string; nodes: Node[]; edges: Edge[]; viewport?: { x: number; y: number; zoom: number } | null }): Promise<FlowDto> {
  const r = await apiFetch(`${API_BASE}/flows`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: payload.id, name: payload.name, data: { nodes: payload.nodes, edges: payload.edges, viewport: payload.viewport ?? null } })
  }))
  if (!r.ok) throw new Error(`save flow failed: ${r.status}`)
  return r.json()
}

export async function deleteServerFlow(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/flows/${id}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete flow failed: ${r.status}`)
}

export async function exchangeGithub(code: string): Promise<{ token: string; user: any }> {
  const r = await apiFetch(`${API_BASE}/auth/github/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`exchange failed: ${r.status} ${text}`.trim())
  }
  return r.json()
}

export async function createGuestSession(nickname?: string): Promise<{ token: string; user: any }> {
  const body = nickname ? { nickname } : {}
  const r = await apiFetch(`${API_BASE}/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`guest login failed: ${r.status}`)
  return r.json()
}

export async function listFlowVersions(flowId: string): Promise<Array<{ id: string; createdAt: string; name: string }>> {
  const r = await apiFetch(`${API_BASE}/flows/${flowId}/versions`, withAuth())
  if (!r.ok) throw new Error(`list versions failed: ${r.status}`)
  return r.json()
}

export async function rollbackFlow(flowId: string, versionId: string) {
  const r = await apiFetch(`${API_BASE}/flows/${flowId}/rollback`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId }) }))
  if (!r.ok) throw new Error(`rollback failed: ${r.status}`)
  return r.json()
}
export async function listProjects(): Promise<ProjectDto[]> {
  const r = await apiFetch(`${API_BASE}/projects`, withAuth())
  if (!r.ok) throw new Error(`list projects failed: ${r.status}`)
  return r.json()
}

export async function upsertProject(payload: { id?: string; name: string }): Promise<ProjectDto> {
  const r = await apiFetch(`${API_BASE}/projects`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))
  if (!r.ok) throw new Error(`save project failed: ${r.status}`)
  return r.json()
}

export async function listProjectFlows(projectId: string): Promise<FlowDto[]> {
  const r = await apiFetch(`${API_BASE}/flows?projectId=${encodeURIComponent(projectId)}`, withAuth())
  if (!r.ok) throw new Error(`list flows failed: ${r.status}`)
  return r.json()
}

export async function saveProjectFlow(payload: { id?: string; projectId: string; name: string; nodes: Node[]; edges: Edge[]; viewport?: { x: number; y: number; zoom: number } | null }): Promise<FlowDto> {
  const r = await apiFetch(`${API_BASE}/flows`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: payload.id, projectId: payload.projectId, name: payload.name, data: { nodes: payload.nodes, edges: payload.edges, viewport: payload.viewport ?? null } }) }))
  if (!r.ok) throw new Error(`save flow failed: ${r.status}`)
  return r.json()
}

export async function runWorkflowExecution(payload: { flowId: string; concurrency?: number }): Promise<WorkflowExecutionDto> {
  const r = await apiFetch(`${API_BASE}/executions/run`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowId: payload.flowId, concurrency: payload.concurrency ?? 1, trigger: 'manual' }),
  }))
  if (!r.ok) throw new Error(`run execution failed: ${r.status}`)
  return r.json()
}

export async function listWorkflowExecutions(payload: { flowId: string; limit?: number }): Promise<WorkflowExecutionDto[]> {
  const limit = payload.limit ?? 30
  const r = await apiFetch(`${API_BASE}/executions?flowId=${encodeURIComponent(payload.flowId)}&limit=${encodeURIComponent(String(limit))}`, withAuth())
  if (!r.ok) throw new Error(`list executions failed: ${r.status}`)
  return r.json()
}

export async function getWorkflowExecution(executionId: string): Promise<WorkflowExecutionDto> {
  const r = await apiFetch(`${API_BASE}/executions/${encodeURIComponent(executionId)}`, withAuth())
  if (!r.ok) throw new Error(`get execution failed: ${r.status}`)
  return r.json()
}

export async function listWorkflowNodeRuns(executionId: string): Promise<WorkflowNodeRunDto[]> {
  const r = await apiFetch(`${API_BASE}/executions/${encodeURIComponent(executionId)}/node-runs`, withAuth())
  if (!r.ok) throw new Error(`list node runs failed: ${r.status}`)
  return r.json()
}

// Public project APIs
export async function listPublicProjects(): Promise<ProjectDto[]> {
  const r = await apiFetch(`${API_BASE}/projects/public`, { headers: { 'Content-Type': 'application/json' } })
  if (!r.ok) throw new Error(`list public projects failed: ${r.status}`)
  return r.json()
}

export async function cloneProject(projectId: string, newName?: string): Promise<ProjectDto> {
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/clone`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName })
  }))
  if (!r.ok) throw new Error(`clone project failed: ${r.status}`)
  return r.json()
}

export async function toggleProjectPublic(projectId: string, isPublic: boolean): Promise<ProjectDto> {
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/public`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isPublic })
  }))
  if (!r.ok) throw new Error(`toggle project public failed: ${r.status}`)
  return r.json()
}

export async function deleteProject(projectId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete project failed: ${r.status}`)
}

export async function getPublicProjectFlows(projectId: string): Promise<FlowDto[]> {
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/flows`, { headers: { 'Content-Type': 'application/json' } })
  if (!r.ok) throw new Error(`get public project flows failed: ${r.status}`)
  return r.json()
}

// Model provider & token APIs
export async function listModelProviders(): Promise<ModelProviderDto[]> {
  const r = await apiFetch(`${API_BASE}/models/providers`, withAuth())
  if (!r.ok) throw new Error(`list providers failed: ${r.status}`)
  return r.json()
}

export async function upsertModelProvider(payload: { id?: string; name: string; vendor: string; baseUrl?: string | null; sharedBaseUrl?: boolean }): Promise<ModelProviderDto> {
  const r = await apiFetch(`${API_BASE}/models/providers`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`save provider failed: ${r.status}`)
  return r.json()
}

export async function listModelTokens(providerId: string): Promise<ModelTokenDto[]> {
  const r = await apiFetch(`${API_BASE}/models/providers/${encodeURIComponent(providerId)}/tokens`, withAuth())
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
  const r = await apiFetch(`${API_BASE}/models/tokens`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`save token failed: ${r.status}`)
  return r.json()
}

export async function deleteModelToken(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/models/tokens/${encodeURIComponent(id)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete token failed: ${r.status}`)
}

export async function listModelEndpoints(providerId: string): Promise<ModelEndpointDto[]> {
  const r = await apiFetch(`${API_BASE}/models/providers/${encodeURIComponent(providerId)}/endpoints`, withAuth())
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
  const r = await apiFetch(`${API_BASE}/models/endpoints`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`save endpoint failed: ${r.status}`)
  return r.json()
}

export async function getProxyConfig(vendor: string): Promise<ProxyConfigDto | null> {
  const r = await apiFetch(`${API_BASE}/models/proxy/${encodeURIComponent(vendor)}`, withAuth())
  if (!r.ok) {
    if (r.status === 404) return null
    throw new Error(`get proxy config failed: ${r.status}`)
  }
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!body) return null
  return {
    id: body.id,
    name: body.name,
    vendor: body.vendor,
    baseUrl: body.baseUrl || '',
    enabled: !!body.enabled,
    enabledVendors: Array.isArray(body.enabledVendors) ? body.enabledVendors : [],
    hasApiKey: !!body.hasApiKey,
    createdAt: body.createdAt,
    updatedAt: body.updatedAt,
  }
}

export async function upsertProxyConfig(
  vendor: string,
  payload: {
    baseUrl: string
    apiKey?: string | null
    enabled?: boolean
    enabledVendors?: string[]
    name?: string
  },
): Promise<ProxyConfigDto> {
  const body: any = {
    baseUrl: payload.baseUrl,
    enabled: payload.enabled ?? true,
    enabledVendors: Array.isArray(payload.enabledVendors) ? payload.enabledVendors : [],
    name: payload.name,
  }
  if (typeof payload.apiKey !== 'undefined') {
    body.apiKey = payload.apiKey
  }
  const r = await apiFetch(`${API_BASE}/models/proxy/${encodeURIComponent(vendor)}`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
  let resBody: any = null
  try {
    resBody = await r.json()
  } catch {
    resBody = null
  }
  if (!r.ok) {
    const msg = (resBody && (resBody.message || resBody.error)) || `save proxy config failed: ${r.status}`
    throw new Error(msg)
  }
  return {
    id: resBody.id,
    name: resBody.name,
    vendor: resBody.vendor,
    baseUrl: resBody.baseUrl || '',
    enabled: !!resBody.enabled,
    enabledVendors: Array.isArray(resBody.enabledVendors) ? resBody.enabledVendors : [],
    hasApiKey: !!resBody.hasApiKey,
    createdAt: resBody.createdAt,
    updatedAt: resBody.updatedAt,
  }
}

export async function getProxyCredits(vendor: string): Promise<{ credits: number }> {
  const r = await apiFetch(`${API_BASE}/models/proxy/${encodeURIComponent(vendor)}/credits`, withAuth())
  if (!r.ok) throw new Error(`get proxy credits failed: ${r.status}`)
  return r.json()
}

export async function getProxyModelStatus(vendor: string, model: string): Promise<{ status: boolean; error?: string }> {
  const qs = new URLSearchParams({ model })
  const r = await apiFetch(`${API_BASE}/models/proxy/${encodeURIComponent(vendor)}/model-status?${qs.toString()}`, withAuth())
  if (!r.ok) throw new Error(`get proxy model status failed: ${r.status}`)
  return r.json()
}

export async function listSoraVideoHistory(params?: {
  limit?: number
  offset?: number
  status?: string
}): Promise<{ records: VideoHistoryRecord[]; total: number }> {
  const qs = new URLSearchParams()
  if (typeof params?.limit === 'number') qs.set('limit', String(params.limit))
  if (typeof params?.offset === 'number') qs.set('offset', String(params.offset))
  if (params?.status) qs.set('status', params.status)
  const url = `${API_BASE}/sora/video/history${qs.toString() ? `?${qs.toString()}` : ''}`
  const r = await apiFetch(url, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `list sora video history failed: ${r.status}`
    throw new Error(msg)
  }
  return {
    records: Array.isArray(body?.records) ? body.records : [],
    total: typeof body?.total === 'number' ? body.total : 0,
  }
}

export async function listModelProfiles(params?: { providerId?: string; kinds?: ProfileKind[] }): Promise<ModelProfileDto[]> {
  const qs = new URLSearchParams()
  if (params?.providerId) qs.set('providerId', params.providerId)
  if (params?.kinds?.length) {
    params.kinds.forEach((kind) => qs.append('kind', kind))
  }
  const query = qs.toString()
  const url = query ? `${API_BASE}/models/profiles?${query}` : `${API_BASE}/models/profiles`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`list profiles failed: ${r.status}`)
  return r.json()
}

export async function upsertModelProfile(payload: {
  id?: string
  providerId: string
  name: string
  kind: ProfileKind
  modelKey: string
  settings?: any
}): Promise<ModelProfileDto> {
  const r = await apiFetch(`${API_BASE}/models/profiles`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`save profile failed: ${r.status}`)
  return r.json()
}

export async function deleteModelProfile(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/models/profiles/${encodeURIComponent(id)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete profile failed: ${r.status}`)
}

export async function listAvailableModels(vendor?: string): Promise<AvailableModelDto[]> {
  const qs = vendor ? `?vendor=${encodeURIComponent(vendor)}` : ''
  const r = await apiFetch(`${API_BASE}/models/available${qs}`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `list available models failed: ${r.status}`
    throw new Error(msg)
  }
  if (Array.isArray(body)) return body as AvailableModelDto[]
  if (Array.isArray(body?.models)) return body.models as AvailableModelDto[]
  return []
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
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`list drafts failed: ${r.status}`)
  return r.json()
}

export async function publishSoraDraft(tokenId: string, draftId: string, postText?: string, generationId?: string): Promise<void> {
  // 保留兼容，内部将 draftId 作为 taskId 透传到 video/publish
  return publishSoraVideo(tokenId, draftId, postText, generationId)
}

export async function publishSoraVideo(tokenId: string, taskId: string, postText?: string, generationId?: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/sora/video/publish`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenId, taskId, postText, generationId: generationId || taskId }),
  }))
  if (!r.ok) throw new Error(`publish video failed: ${r.status}`)
}

export async function deleteSoraDraft(tokenId: string, draftId: string): Promise<void> {
  const qs = new URLSearchParams({ tokenId, draftId })
  const r = await apiFetch(`${API_BASE}/sora/drafts/delete?${qs.toString()}`, withAuth())
  if (!r.ok) throw new Error(`delete draft failed: ${r.status}`)
}

export async function listSoraPublishedVideos(tokenId?: string | null, limit?: number): Promise<SoraDraftListDto> {
  const qs = new URLSearchParams()
  if (tokenId) qs.set('tokenId', tokenId)
  if (typeof limit === 'number' && !Number.isNaN(limit)) qs.set('limit', String(limit))
  const query = qs.toString()
  const url = query ? `${API_BASE}/sora/published/me?${query}` : `${API_BASE}/sora/published/me`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`list published videos failed: ${r.status}`)
  return r.json()
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
  const r = await apiFetch(url, withAuth())
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

export async function deleteSoraCharacter(tokenId: string, characterId: string): Promise<void> {
  const qs = new URLSearchParams({ tokenId, characterId })
  const r = await apiFetch(`${API_BASE}/sora/characters/delete?${qs.toString()}`, withAuth())
  if (!r.ok) throw new Error(`delete sora character failed: ${r.status}`)
}

export async function checkSoraCharacterUsername(
  tokenId: string | null,
  username: string,
): Promise<void> {
  const r = await apiFetch(`${API_BASE}/sora/characters/check-username`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenId: tokenId || undefined, username }),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  // 接口会返回 200 且 body.available=false 表示用户名不合法或不可用
  if (!r.ok) {
    const msg =
      (body && (body.message || body.error)) ||
      `check sora username failed: ${r.status}`
    throw new Error(msg)
  }
  if (body && body.available === false) {
    const msg =
      body.message ||
      '角色名只允许英文，长度不能超过20，且可能已被注册'
    throw new Error(msg)
  }
}

export async function listSoraMentions(
  username: string,
  tokenId?: string | null,
  limit: number = 10,
): Promise<any> {
  const qs = new URLSearchParams()
  qs.set('username', username)
  qs.set('intent', 'cameo')
  qs.set('limit', String(limit))
  if (tokenId) qs.set('tokenId', tokenId)
  const r = await apiFetch(`${API_BASE}/sora/mentions?${qs.toString()}`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg =
      (body && (body.message || body.error)) ||
      `list sora mentions failed: ${r.status}`
    throw new Error(msg)
  }
  return body
}

export async function listSoraPendingVideos(
  tokenId?: string | null,
): Promise<any[]> {
  const qs = new URLSearchParams()
  if (tokenId) qs.set('tokenId', tokenId)
  const url = qs.toString()
    ? `${API_BASE}/sora/video/pending?${qs.toString()}`
    : `${API_BASE}/sora/video/pending`
  const r = await apiFetch(url, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg =
      (body && (body.message || body.error)) ||
      `list sora pending videos failed: ${r.status}`
    throw new Error(msg)
  }
  if (Array.isArray(body)) return body
  if (Array.isArray(body?.items)) return body.items
  return []
}

export type SoraVideoDraftResponse = {
  id: string
  title: string | null
  prompt: string | null
  thumbnailUrl: string | null
  videoUrl: string | null
  postId?: string | null
  status?: string | null
  progress?: number | null
  raw?: any
}

function normalizeDraftProgress(value: any): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  const normalized = value <= 1 ? value * 100 : value
  return Math.max(0, Math.min(100, normalized))
}

export async function getSoraVideoDraftByTask(
  taskId: string,
  tokenId?: string | null,
): Promise<SoraVideoDraftResponse> {
  const qs = new URLSearchParams({ taskId })
  if (tokenId) qs.set('tokenId', tokenId)
  const url = `${API_BASE}/sora/video/draft-by-task?${qs.toString()}`
  console.debug('[getSoraVideoDraftByTask] requesting', { url, taskId, tokenId })
  const r = await apiFetch(url, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg =
      (body && (body.message || body.error)) ||
      `get sora video draft failed: ${r.status}`
    const err: any = new Error(msg)
    err.status = r.status
    if (body && typeof body.upstreamStatus !== 'undefined') {
      err.upstreamStatus = body.upstreamStatus
    }
    err.body = body
    console.debug('[getSoraVideoDraftByTask] failed', { taskId, tokenId, status: r.status, body })
    throw err
  }
  console.debug('[getSoraVideoDraftByTask] success', { taskId, tokenId, body })
  const raw = typeof body?.raw !== 'undefined' ? body.raw : body
  const status = typeof body?.status === 'string'
    ? body.status
    : typeof raw?.status === 'string'
      ? raw.status
      : null
  const progressValue = normalizeDraftProgress(
    typeof body?.progress === 'number'
      ? body.progress
      : typeof raw?.progress === 'number'
        ? raw.progress
        : null,
  )

  return {
    id: body.id,
    title: body.title ?? null,
    prompt: body.prompt ?? null,
    thumbnailUrl: body.thumbnailUrl ?? null,
    videoUrl: body.videoUrl ?? null,
    postId: body.postId ?? null,
    status,
    progress: progressValue,
    raw,
  }
}

export async function uploadSoraCharacterVideo(
  tokenId: string,
  file: File,
  timestamps: [number, number],
): Promise<any> {
  const [start, end] = timestamps
  const form = new FormData()
  form.append('tokenId', tokenId)
  form.append('file', file)
  form.append('timestamps', `${start},${end}`)

  const r = await apiFetch(`${API_BASE}/sora/characters/upload`, withAuth({
    method: 'POST',
    body: form,
  }))

  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }

  if (!r.ok) {
    const msg =
      (body && (body.message || body.error)) ||
      `upload sora character failed: ${r.status}`
    throw new Error(msg)
  }

  return body
}

export async function isSoraCameoInProgress(
  tokenId: string,
  id: string,
): Promise<{ inProgress: boolean; progressPct: number | null }> {
  const qs = new URLSearchParams({ tokenId, id })
  const r = await apiFetch(
    `${API_BASE}/sora/cameos/in-progress?${qs.toString()}`,
    withAuth(),
  )
  if (!r.ok) return { inProgress: false, progressPct: null }

  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }

  const status: string | null =
    body && typeof body.status === 'string'
      ? body.status
      : body && body.status === null
        ? null
        : null
  const progressPct: number | null =
    body && typeof body.progress_pct === 'number' ? body.progress_pct : null

  // 业务规则：
  // - status 不为 processing 且不为 null → 认为已完成（成功或失败）
  // - 或 progress_pct > 0.95 → 认为已完成
  // 其它情况视为仍在 processing
  const inProgress =
    status === null || status === 'processing'
      ? !(progressPct !== null && progressPct > 0.95)
      : false

  return { inProgress, progressPct }
}

export async function finalizeSoraCharacter(payload: {
  tokenId: string
  cameo_id: string
  username: string
  display_name: string
  profile_asset_pointer: any
}): Promise<any> {
  const r = await apiFetch(`${API_BASE}/sora/characters/finalize`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))

  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }

  if (!r.ok) {
    let msg: string | undefined
    // 优先使用上游 Sora 返回的错误信息
    const upstreamError =
      body?.upstreamData?.error ||
      body?.error ||
      (typeof body?.message === 'object' ? body.message : null)

    if (upstreamError && typeof upstreamError.message === 'string') {
      msg = upstreamError.message
    } else if (typeof body?.message === 'string') {
      msg = body.message
    } else if (typeof body?.error === 'string') {
      msg = body.error
    }

    // 特殊处理 invalid_request_error，提示需要重新走流程
    if (
      upstreamError &&
      upstreamError.type === 'invalid_request_error' &&
      upstreamError.message === 'Cameo is not pending'
    ) {
      msg = '当前视频任务已失效或不在可创建状态，请重新上传并创建角色'
    }

    if (!msg) {
      msg = `finalize sora character failed: ${r.status}`
    }

    throw new Error(msg)
  }

  return body
}

export async function createSoraVideo(payload: {
  tokenId?: string | null
  prompt: string
  orientation: 'portrait' | 'landscape' | 'square'
  size?: string
  n_frames?: number
  inpaintFileId?: string | null
  imageUrl?: string | null
  remixTargetId?: string | null
  operation?: string | null
  title?: string | null
}): Promise<any> {
  const body: any = {
    prompt: payload.prompt,
    orientation: payload.orientation,
    size: payload.size,
    n_frames: payload.n_frames,
  }
  if (payload.tokenId) {
    body.tokenId = payload.tokenId
  }
  if (payload.inpaintFileId) {
    body.inpaintFileId = payload.inpaintFileId
  }
  if (payload.imageUrl) {
    body.imageUrl = payload.imageUrl
  }
  if (payload.remixTargetId) {
    body.remixTargetId = payload.remixTargetId
  }
  if (payload.tokenId) {
    body.tokenId = payload.tokenId
  }
  if (payload.operation) {
    body.operation = payload.operation
  }
  if (payload.title) {
    body.title = payload.title
  }

  const r = await apiFetch(`${API_BASE}/sora/video/create`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

  let resBody: any = null
  try {
    resBody = await r.json()
  } catch {
    resBody = null
  }

  if (!r.ok) {
    const upstreamError =
      resBody?.upstreamData?.error ||
      resBody?.error ||
      (typeof resBody?.message === 'object' ? resBody.message : null)

    const msg =
      (upstreamError && typeof upstreamError.message === 'string' && upstreamError.message) ||
      (typeof resBody?.message === 'string' && resBody.message) ||
      (typeof resBody?.error === 'string' && resBody.error) ||
      `create sora video failed: ${r.status}`

    throw new Error(msg)
  }

  return resBody
}

export async function setSoraCameoPublic(
  tokenId: string,
  cameoId: string,
): Promise<void> {
  const r = await apiFetch(`${API_BASE}/sora/cameos/set-public`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenId, cameoId }),
  }))

  if (!r.ok) {
    let body: any = null
    try {
      body = await r.json()
    } catch {
      body = null
    }
    const msg =
      (body && (body.message || body.error)) ||
      `set sora cameo public failed: ${r.status}`
    throw new Error(msg)
  }
}

export async function uploadSoraProfileAsset(
  tokenId: string,
  file: File,
): Promise<any> {
  const form = new FormData()
  form.append('tokenId', tokenId)
  form.append('file', file)

  const r = await apiFetch(`${API_BASE}/sora/profile/upload`, withAuth({
    method: 'POST',
    body: form,
  }))

  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }

  if (!r.ok) {
    const msg =
      (body && (body.message || body.error)) ||
      `upload sora profile asset failed: ${r.status}`
    throw new Error(msg)
  }

  return body
}

export async function uploadSoraImage(
  tokenId: string | undefined,
  file: File,
): Promise<{ file_id: string; asset_pointer?: string }> {
  const form = new FormData()
  form.append('file', file)
  if (tokenId) form.append('tokenId', tokenId)

  const r = await apiFetch(`${API_BASE}/sora/upload/image`, withAuth({
    method: 'POST',
    body: form,
  }))

  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }

  if (!r.ok) {
    const msg =
      (body && (body.message || body.error)) ||
      `upload sora image failed: ${r.status}`
    throw new Error(msg)
  }

  return body
}

export async function updateSoraCharacter(payload: {
  tokenId: string
  characterId: string
  username?: string
  display_name?: string | null
  profile_asset_pointer?: any
}): Promise<any> {
  const r = await apiFetch(`${API_BASE}/sora/characters/update`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg =
      (body && (body.message || body.error)) ||
      `update sora character failed: ${r.status}`
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
  const r = await apiFetch(`${API_BASE}/drafts/suggest?${qs.toString()}`, withAuth())
  if (!r.ok) throw new Error(`suggest prompts failed: ${r.status}`)
  return r.json()
}

export async function markDraftPromptUsed(prompt: string, provider = 'sora'): Promise<void> {
  const qs = new URLSearchParams({ prompt })
  if (provider) qs.set('provider', provider)
  const r = await apiFetch(`${API_BASE}/drafts/mark-used?${qs.toString()}`, withAuth())
  if (!r.ok) throw new Error(`mark prompt used failed: ${r.status}`)
}

export async function generatePrompt(payload: PromptGeneratePayload): Promise<PromptGenerateResult> {
  const r = await apiFetch(`${API_BASE}/prompt/generate`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`generate prompt failed: ${r.status}`)
  return await r.json() as PromptGenerateResult
}

// Assets API - 用户级别资产
export type ServerAssetDto = {
  id: string
  name: string
  data: any
  createdAt: string
  updatedAt: string
  userId: string
  projectId?: string | null
}

export async function listServerAssets(input?: { limit?: number; cursor?: string | null }): Promise<{ items: ServerAssetDto[]; cursor: string | null }> {
  const qs = new URLSearchParams()
  if (input?.limit) qs.set('limit', String(input.limit))
  if (input?.cursor) qs.set('cursor', input.cursor)
  const url = qs.toString() ? `${API_BASE}/assets?${qs.toString()}` : `${API_BASE}/assets`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`list assets failed: ${r.status}`)
  return r.json()
}

export async function createServerAsset(payload: { name: string; data: any }): Promise<ServerAssetDto> {
  const r = await apiFetch(`${API_BASE}/assets`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))
  if (!r.ok) throw new Error(`create asset failed: ${r.status}`)
  return r.json()
}

export async function renameServerAsset(id: string, name: string): Promise<ServerAssetDto> {
  const r = await apiFetch(`${API_BASE}/assets/${id}`, withAuth({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }))
  if (!r.ok) throw new Error(`rename asset failed: ${r.status}`)
  return r.json()
}

export async function deleteServerAsset(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/assets/${id}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete asset failed: ${r.status}`)
}

export type PublicAssetDto = {
  id: string
  name: string
  type: 'image' | 'video'
  url: string
  thumbnailUrl?: string | null
  duration?: number | null
  prompt?: string | null
  vendor?: string | null
  modelKey?: string | null
  createdAt: string
  ownerLogin?: string | null
  ownerName?: string | null
  projectName?: string | null
}

export async function listPublicAssets(
  limit?: number,
  type?: 'image' | 'video' | 'all',
): Promise<PublicAssetDto[]> {
  const qs = new URLSearchParams()
  if (typeof limit === 'number' && !Number.isNaN(limit)) {
    qs.set('limit', String(limit))
  }
  if (type && type !== 'all') {
    qs.set('type', type)
  }
  const query = qs.toString()
  const url = query ? `${API_BASE}/assets/public?${query}` : `${API_BASE}/assets/public`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`list public assets failed: ${r.status}`)
  return r.json()
}

// Unified task API
export type TaskKind =
  | 'chat'
  | 'prompt_refine'
  | 'text_to_image'
  | 'image_to_prompt'
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

export type TaskProgressSnapshotDto = {
  taskId?: string
  nodeId?: string
  nodeKind?: string
  taskKind?: TaskKind
  vendor?: string
  status: TaskStatus
  progress?: number
  message?: string
  assets?: TaskAssetDto[]
  raw?: any
  timestamp?: number
}

export async function runTask(profileId: string, request: TaskRequestDto): Promise<TaskResultDto> {
  const r = await apiFetch(`${API_BASE}/tasks`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, request }),
  }))
  if (!r.ok) throw new Error(`run task failed: ${r.status}`)
  return r.json()
}

export async function runTaskByVendor(vendor: string, request: TaskRequestDto): Promise<TaskResultDto> {
  const r = await apiFetch(`${API_BASE}/tasks`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendor, request }),
  }))
  if (!r.ok) {
    let errorMessage = `run task failed: ${r.status}`
    try {
      const errorData = await r.json()
      errorMessage = errorData.message || errorData.error || errorMessage
    } catch {
      // 如果解析 JSON 失败，使用默认错误消息
    }

    const error = new Error(errorMessage) as any
    error.status = r.status
    throw error
  }
  return r.json()
}

export async function listPendingTasks(vendor?: string): Promise<TaskProgressSnapshotDto[]> {
  const qs = new URLSearchParams()
  if (vendor) qs.set('vendor', vendor)
  const url = qs.toString()
    ? `${API_BASE}/tasks/pending?${qs.toString()}`
    : `${API_BASE}/tasks/pending`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) {
    throw new Error(`list pending tasks failed: ${r.status}`)
  }
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!body) return []
  if (Array.isArray(body)) return body as TaskProgressSnapshotDto[]
  if (Array.isArray(body?.items)) return body.items as TaskProgressSnapshotDto[]
  return []
}

export async function fetchVeoTaskResult(taskId: string): Promise<TaskResultDto> {
  const r = await apiFetch(`${API_BASE}/tasks/veo/result`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  }))
  if (!r.ok) {
    let msg = `fetch veo result failed: ${r.status}`
    try {
      const body = await r.json()
      msg = body?.message || body?.error || msg
    } catch {}
    const err = new Error(msg) as any
    err.status = r.status
    throw err
  }
  return r.json()
}

export async function fetchSora2ApiTaskResult(
  taskId: string,
  prompt?: string | null,
): Promise<TaskResultDto> {
  const r = await apiFetch(`${API_BASE}/tasks/sora2api/result`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      typeof prompt === 'string' && prompt.trim()
        ? { taskId, prompt }
        : { taskId },
    ),
  }))
  if (!r.ok) {
    let msg = `fetch sora2api result failed: ${r.status}`
    try {
      const body = await r.json()
      msg = body?.message || body?.error || msg
    } catch {}
    const err = new Error(msg) as any
    err.status = r.status
    throw err
  }
  return r.json()
}

export async function unwatermarkSoraVideo(url: string): Promise<{ downloadUrl: string; raw: any }> {
  const r = await apiFetch(`${API_BASE}/sora/video/unwatermark`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }))
  if (!r.ok) {
    let msg = `unwatermark sora video failed: ${r.status}`
    try {
      const body = await r.json()
      msg = body?.message || body?.error || msg
    } catch {}
    const err = new Error(msg) as any
    err.status = r.status
    throw err
  }
  return r.json()
}

// --- Sora2API / grsai character helpers ---

export async function uploadSora2ApiCharacter(input: {
  url: string
  timestamps?: string
  webHook?: string
  shutProgress?: boolean
  vendor?: 'sora2api' | 'grsai'
}) {
  const r = await apiFetch(`${API_BASE}/sora/sora2api/characters/upload`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
  if (!r.ok) {
    let msg = `upload sora2api character failed: ${r.status}`
    try {
      const body = await r.json()
      msg = body?.message || body?.error || msg
    } catch {}
    const err = new Error(msg) as any
    err.status = r.status
    throw err
  }
  return r.json()
}

export async function createSora2ApiCharacterFromPid(input: {
  pid: string
  timestamps?: string
  webHook?: string
  shutProgress?: boolean
}) {
  const r = await apiFetch(`${API_BASE}/sora/sora2api/characters/create`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
  if (!r.ok) {
    let msg = `create sora2api character failed: ${r.status}`
    try {
      const body = await r.json()
      msg = body?.message || body?.error || msg
    } catch {}
    const err = new Error(msg) as any
    err.status = r.status
    throw err
  }
  return r.json()
}

export async function fetchSora2ApiCharacterResult(taskId: string) {
  const r = await apiFetch(`${API_BASE}/sora/sora2api/characters/result`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  }))
  if (!r.ok) {
    let msg = `fetch sora2api character result failed: ${r.status}`
    try {
      const body = await r.json()
      msg = body?.message || body?.error || msg
    } catch {}
    const err = new Error(msg) as any
    err.status = r.status
    throw err
  }
  return r.json()
}
