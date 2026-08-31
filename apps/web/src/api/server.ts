import type { Edge, Node } from '@xyflow/react'
import type { PublicFlowAnchorBinding } from '@tapcanvas/flow-anchor-bindings'
import type {
  AgentAnnotationQueueItemV1,
  AgentDiagnosticsMetricsV1,
  AgentEvaluationResultV1,
  AgentHumanFeedbackV1,
  AgentLogicalTaskStateV1,
  AgentRegressionExampleV1,
  AgentRequestTerminalV1,
  AgentSpanKind,
  AgentSpanStatus,
  AgentTraceSpanV1,
} from '@tapcanvas/agent-observability'
import type {
  AiCharacterLibraryCharacterDto,
  CharacterBible,
  AiCharacterLibrarySyncStateDto,
  AiCharacterLibraryUpsertPayload,
} from '@tapcanvas/character-bible-protocol'
import type { StoryboardSelectionContext } from '@tapcanvas/storyboard-selection-protocol'
import type { ScheduleWorkflowTriggerSpecV1 } from '@tapcanvas/workflow-kernel-protocol'
import { normalizeShotTable, type ShotTableData } from '@tapcanvas/shot-table-protocol'
import {
  ProjectDirectorySnapshotSchema,
  SaveProjectDirectoryRequestSchema,
  type ProjectDirectorySnapshot,
  type SaveProjectDirectoryRequest,
} from '@tapcanvas/project-directory-protocol'
import type { User } from '../auth/store'
import { sanitizeFlowValueForPersistence } from '../canvas/utils/persistenceSanitizer'
import { useUploadRuntimeStore } from '../domain/upload-runtime/store/uploadRuntimeStore'
import type { StoryboardStructuredData } from '../storyboard/storyboardStructure'
import { fetchEditableImageBlob } from '../utils/editableImageSource'
import { createSseEventParser } from './sse'
import {
  parseAgentsChatTurnInterruptReceiptDto,
  parseAgentsChatTurnStatusDto,
  readAgentsChatTurnIdHeader,
  type AgentsChatTurnInterruptReceiptDto,
  type AgentsChatTurnResumeReceiptDto,
  type AgentsChatTurnStatusDto,
  type AgentsChatAttentionProjection,
} from './agentsChatTurn'
export type {
  AgentsChatTurnInterruptReceiptDto,
  AgentsChatTurnResumeReceiptDto,
  AgentsChatTurnPhase,
  AgentsChatTurnPublicState,
  AgentsChatTurnStatusDto,
  AgentsChatAttentionProjection,
} from './agentsChatTurn'
import type { ContentBlock, BlockStreamOp } from '../ui/chat/blocks/types'
import type { ModelOptionVideoAnalysisPricing } from '../config/models'
import { z } from 'zod'
// self-import guard: only used for type re-export in the same module

const viteEnv = import.meta.env
// API_BASE 拼在每个接口路径前（如 `${API_BASE}/auth/phone/request`）。取值三态：
//   - 绝对 URL（'https://api.example.com'）: 前后端分域，需 CORS
//   - 相对前缀（'/api'）              : 同源部署，nginx 把 /api/* 剥前缀转发给 api 容器
//   - 空                              : 直接打站点根路径 —— ⚠️ 同源部署下会与 SPA 路由撞车
//     （hono-api 的 /auth、/flows、/projects… 挂在根级，而 /projects 同时是前端路由），
//     故生产同源必须用 '/api' 前缀，不能留空。
const explicitApiBase =
  typeof viteEnv.VITE_API_BASE === 'string' && viteEnv.VITE_API_BASE.trim()
    ? viteEnv.VITE_API_BASE.trim()
    : null
export const API_BASE =
  explicitApiBase ||
  (viteEnv.DEV ? 'http://localhost:8788' : '')

/**
 * API_BASE 的绝对形式。同源部署时 API_BASE 是相对前缀（'/api'），但对外展示/交付给外部
 * 程序的端点（MCP / A2A、交给 CLI 的 apiBaseUrl）必须是绝对 URL，否则对方无法请求。
 */
export function absoluteApiBase(fallbackOrigin?: string): string {
  const strip = (s: string) => s.replace(/\/+$/, '')
  const origin =
    fallbackOrigin || (typeof window !== 'undefined' ? window.location.origin : '')
  if (!API_BASE) return strip(origin)
  if (/^https?:\/\//i.test(API_BASE)) return strip(API_BASE)
  return strip(strip(origin) + API_BASE)
}

/**
 * 构造带 query 拼装能力的 API URL 对象。
 *
 * ⚠️ 生产同源部署下 API_BASE 是相对前缀（'/api'），而 `new URL('/api/x')` 无 base 参数
 * 会抛 `TypeError: Invalid URL` —— 请求在 fetch 发出前就崩、被上层 catch 吞掉，表现为
 * “接口静默不发、列表恒空”（本地 dev 因 API_BASE 是绝对 URL 'http://localhost:8788'
 * 不触发，故只在生产复现）。统一用 window.location.origin 兜底 base；当 API_BASE 本身是
 * 绝对 URL（前后端分域）时，`new URL` 会忽略 base，行为不变。
 *
 * 需要 searchParams 的 GET 一律走此函数，不要再裸写 `new URL(\`${API_BASE}...\`)`。
 */
export function apiURL(path: string): URL {
  const base =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  return new URL(`${API_BASE}${path}`, base)
}


function getActiveTeamId(): string | null {
  try { return localStorage.getItem('tapcanvas_active_team_id') } catch { return null }
}

function withAuth(init?: RequestInit, teamIdOverride?: string | null): RequestInit {
  // When a caller explicitly targets a team (e.g. getMyTeam('personal')), align the
  // X-Team-Id header with that target. Otherwise the stale active-team header would win
  // over the ?teamId= query on the backend (header takes priority), making it impossible
  // to switch away from the current team.
  const teamId = teamIdOverride !== undefined ? teamIdOverride : getActiveTeamId()
  return {
    credentials: init?.credentials ?? 'include',
    ...(init || {}),
    headers: {
      ...(init?.headers || {}),
      ...(teamId ? { 'X-Team-Id': teamId } : {}),
    },
  }
}

function withPublicApiKey(apiKey: string, init?: RequestInit): RequestInit {
  const trimmedKey = typeof apiKey === 'string' ? apiKey.trim() : String(apiKey || '').trim()
  return {
    credentials: init?.credentials ?? (trimmedKey ? 'omit' : 'include'),
    ...(init || {}),
    headers: {
      ...(init?.headers || {}),
      ...(trimmedKey ? { 'X-API-Key': trimmedKey } : {}),
    },
  }
}

function withoutAuth(init?: RequestInit): RequestInit {
  return {
    credentials: init?.credentials ?? 'omit',
    ...(init || {}),
    headers: { ...(init?.headers || {}) },
  }
}

function readPendingRefCode(): string | null {
  if (typeof window === 'undefined') return null
  try { return window.sessionStorage.getItem('tapcanvas:pendingRef') } catch { return null }
}

export function clearPendingRefCode(): void {
  if (typeof window === 'undefined') return
  try { window.sessionStorage.removeItem('tapcanvas:pendingRef') } catch { /* noop */ }
}

function injectReferralHeader(init?: RequestInit): RequestInit | undefined {
  const ref = readPendingRefCode()
  if (!ref) return init
  const merged = init ? { ...init } : {}
  const headers = new Headers(merged.headers || undefined)
  if (!headers.has('x-tapcanvas-ref-code')) headers.set('x-tapcanvas-ref-code', ref)
  merged.headers = headers
  return merged
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = String(init?.method || 'GET').trim().toUpperCase()
  const shouldRetry = method === 'GET' || method === 'HEAD'
  const maxAttempts = shouldRetry ? 3 : 1
  let lastError: unknown = null
  const finalInit = injectReferralHeader(init)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(input, finalInit)
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message.trim().toLowerCase() : ''
      const transient =
        error instanceof TypeError
        || message.includes('failed to fetch')
        || message.includes('networkerror')
        || message.includes('socket')
      if (!shouldRetry || !transient || attempt >= maxAttempts) {
        throw error
      }
      await new Promise((resolve) => window.setTimeout(resolve, attempt * 250))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('api fetch failed')
}

/**
 * 同源下载代理：让服务端取回跨域资产字节、以带鉴权的同源响应流回，返回 Blob。
 * 用于「下载」按钮兜底——当资产 host 缺 CORS 头、浏览器直连 blob fetch 失败时，
 * 走这里可保证下载为真下载而非新标签预览。见 utils/download.ts 的 proxyBlob。
 */
export async function fetchAssetDownloadBlob(url: string): Promise<Blob> {
  const endpoint = `${API_BASE}/public/asset-download?url=${encodeURIComponent(url)}`
  const r = await apiFetch(endpoint, withAuth({ method: 'GET' }))
  if (!r.ok) throw new Error(`asset-download failed: ${r.status}`)
  return await r.blob()
}

type ApiRequestError = Error & {
  status?: number
  code?: string
  details?: unknown
  progress?: unknown
}

async function throwApiError(r: Response, fallbackMessage: string): Promise<never> {
  let msg = fallbackMessage
  let body: unknown = null
  try {
    body = await r.json()
    if (body && typeof body === 'object') {
      const candidateMessage = 'message' in body ? body.message : 'error' in body ? body.error : null
      if (typeof candidateMessage === 'string' && candidateMessage.trim()) {
        msg = candidateMessage
      }
    }
  } catch {
    // ignore body parse error
  }
  const err: ApiRequestError = new Error(msg)
  err.status = r.status
  if (body && typeof body === 'object') {
    err.code = 'code' in body && typeof body.code === 'string' ? body.code : undefined
    err.details = 'details' in body ? body.details : undefined
    err.progress = 'progress' in body ? body.progress : undefined
  }
  throw err
}

export async function fetchProxiedImageBlob(rawImageUrl: string): Promise<Blob> {
  const trimmed = typeof rawImageUrl === 'string' ? rawImageUrl.trim() : ''
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('only http/https image urls are allowed')
  }
  return await fetchEditableImageBlob(trimmed)
}

export async function uploadExternalImageToOss(
  externalUrl: string,
  opts?: { name?: string; projectId?: string; ownerNodeId?: string },
): Promise<{ url: string; assetId: string }> {
  const trimmed = externalUrl.trim()
  const blob = await fetchProxiedImageBlob(trimmed)
  const ext = (trimmed.split('?')[0] ?? '').split('.').pop()?.toLowerCase() ?? ''
  const safeExt = /^(jpg|jpeg|png|webp|gif|avif|heic)$/.test(ext) ? ext : 'jpg'
  const fileName = opts?.name || `external-${Date.now()}.${safeExt}`
  const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' })
  const asset = await uploadServerAssetFile(file, fileName, {
    ...(opts?.projectId ? { projectId: opts.projectId } : {}),
    ...(opts?.ownerNodeId ? { ownerNodeId: opts.ownerNodeId } : {}),
  })
  const ossUrl = typeof asset?.data?.url === 'string' ? asset.data.url.trim() : ''
  if (!ossUrl) throw new Error('外部图片已下载，但上传 OSS 失败')
  return { url: ossUrl, assetId: asset.id }
}

type AuthResponseDto = {
  authenticated: true
  user: User
}

export async function getBrowserSession(): Promise<AuthResponseDto> {
  const r = await apiFetch(`${API_BASE}/auth/session`, {
    method: 'GET',
    credentials: 'include',
  })
  if (!r.ok) throw new Error(`session failed: ${r.status}`)
  return await r.json() as AuthResponseDto
}

type AuthErrorBody = {
  error?: string
  message?: string
  code?: string
  details?: unknown
  sent?: boolean
  expiresInSeconds?: number
  devCode?: string
  delivery?: 'email' | 'debug'
}

async function parseAuthErrorBody(response: Response): Promise<AuthErrorBody | null> {
  try {
    return await response.json() as AuthErrorBody
  } catch {
    return null
  }
}

export type FlowDto = {
  id: string
  name: string
  ownerType?: 'project' | 'chapter' | 'shot' | null
  ownerId?: string | null
  data: {
    nodes: Node[]
    edges: Edge[]
    viewport?: { x: number; y: number; zoom: number } | null
    sceneCreationProgress?: unknown
  }
  createdAt: string
  updatedAt: string
  canvasRevision?: number
}
export type FlowSaveReceipt = Omit<FlowDto, 'data'> & {
  dataAdjusted: boolean
}
export type PublicProjectFlowListItemDto = {
  id: string
  name: string
  updatedAt: string
}
export type PublicProjectFlowDto = FlowDto
export type ProjectDto = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  isPublic?: boolean
  owner?: string
  ownerName?: string
  cloneCount?: number
  sortWeight?: number
  templateTitle?: string
  templateDescription?: string
  templateCoverUrl?: string
  teamShared?: boolean
  teamId?: string
  access?: 'owner' | 'team_edit'
  projectKind?: 'creative' | 'ai_workflow'
}

export type ChapterDto = {
  id: string
  projectId: string
  index: number
  title: string
  summary?: string
  status: 'draft' | 'planning' | 'producing' | 'review' | 'approved' | 'locked' | 'archived'
  sortOrder: number
  coverAssetId?: string
  continuityContext?: string
  styleProfileOverride?: string
  legacyChunkIndex?: number
  sourceBookId?: string
  sourceBookChapter?: number | null
  lastWorkedAt?: string
  createdAt: string
  updatedAt: string
}

export type ChapterDirectorPersonaOverride = {
  personaId: string
  personaName: string
  source?: 'catalog' | 'custom'
  prompt?: string
}

export type ChapterCreativeOverride = {
  styleId?: string
  styleName?: string
  stylePrompt?: string
  category?: string
  referenceImages?: string[]
  directorPersona?: ChapterDirectorPersonaOverride | null
}

export type ChapterStyleOverrideContext = {
  styleId?: string
  styleName?: string
  stylePrompt?: string
  category?: string
  referenceImageCount: number
}

export type AgentRoleSkillAssignment = {
  roleId: string
  roleName: string
  source: 'system' | 'custom'
  skillId?: string
  skillKey?: string
  skillName?: string
  fileName?: string
  content?: string
}

export type ProjectDefaultEntryDto = {
  entryType: 'chapter'
  projectId: string
  chapterId: string
}

export type ChapterWorkbenchShotDto = {
  id: string
  shotIndex: number
  title?: string
  summary?: string
  status: string
  thumbnailUrl?: string
  sceneAssetId?: string
  characterAssetIds: string[]
  updatedAt: string
}

export type ChapterWorkbenchDto = {
  project: {
    id: string
    name: string
    teamId: string | null
  }
  chapter: ChapterDto
  shots: ChapterWorkbenchShotDto[]
  stats: {
    totalShots: number
    generatedShots: number
    reviewShots: number
    reworkShots: number
  }
  recentTasks: Array<{
    id: string
    kind: string
    status: string
    ownerType: 'chapter' | 'shot'
    ownerId: string
    ownerLabel?: string
    updatedAt: string
  }>
}

export type DreaminaAccountDto = {
  id: string
  ownerId: string
  label: string
  cliPath: string | null
  sessionRoot: string
  enabled: boolean
  lastHealthcheckAt: string | null
  lastLoginAt: string | null
  lastError: string | null
  meta?: unknown
  createdAt: string
  updatedAt: string
}

export type DreaminaAccountProbeDto = {
  accountId: string
  ok: boolean
  version?: string | null
  loggedIn: boolean
  creditText?: string | null
  message: string
  stdout?: string | null
  stderr?: string | null
  checkedAt: string
}

export type DreaminaProjectBindingDto = {
  id: string
  ownerId: string
  projectId: string
  accountId: string
  enabled: boolean
  defaultModelVersion?: string | null
  defaultRatio?: string | null
  defaultResolutionType?: string | null
  defaultVideoResolution?: string | null
  createdAt: string
  updatedAt: string
}

export type ApiKeyDto = {
  id: string
  label: string
  keyPrefix: string
  allowedOrigins: string[]
  enabled: boolean
  scopes: ApiKeyScope[]
  expiresAt: string | null
  revokedAt: string | null
  rotatedFromId: string | null
  billingTeamId: string | null
  billingTeamName?: string | null
  billingAvailableCredits?: number | null
  lastUsedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type ApiKeyScope = 'public:read' | 'public:write' | 'agent:execute'

export type ApiKeyBillingOptionDto = {
  teamId: string
  name: string
  isPersonal: boolean
  availableCredits: number
}

export type VendorCallLogStatus = 'running' | 'succeeded' | 'failed'

export type VendorCallLogDto = {
  vendor: string
  taskId: string
  userId: string
  userLogin?: string | null
  userName?: string | null
  taskKind?: string | null
  status: VendorCallLogStatus
  startedAt?: string | null
  finishedAt?: string | null
  durationMs?: number | null
  errorMessage?: string | null
  requestPayload?: string | null
  upstreamResponse?: string | null
  createdAt: string
  updatedAt: string
}

export type VendorCallLogListResponseDto = {
  items: VendorCallLogDto[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type WorkflowExecutionDto = {
  id: string
  flowId: string
  flowVersionId: string
  workflowVersion?: string
  flowName?: string | null
  ownerId: string
  status: 'queued' | 'running' | 'success' | 'failed' | 'canceled'
  concurrency: number
  trigger?: string | null
  errorMessage?: string | null
  errorCode?: string | null
  failureStage?: string | null
  projectId?: string | null
  canvasId?: string | null
  userInput?: string | null
  projectContext?: unknown
  assetSnapshot?: unknown
  durationMs?: number | null
  retryCount?: number
  recoveryOfExecutionId?: string | null
  executionFamilyId: string
  usesProjectAssets?: boolean
  createdAt: string
  startedAt?: string | null
  finishedAt?: string | null
  nodeSummary?: {
    total: number
    queued: number
    running: number
    waitingExternal: number
    success: number
    failed: number
    canceled: number
    skipped: number
    notSelected: number
  }
  focusNode?: {
    nodeId: string
    nodeLabel: string
    status: WorkflowNodeRunDto['status']
    errorMessage: string | null
  } | null
}

export type WorkflowExecutionFamilyMemberDto = Pick<WorkflowExecutionDto,
  | 'id'
  | 'flowId'
  | 'flowVersionId'
  | 'workflowVersion'
  | 'flowName'
  | 'status'
  | 'concurrency'
  | 'trigger'
  | 'errorMessage'
  | 'errorCode'
  | 'failureStage'
  | 'projectId'
  | 'canvasId'
  | 'durationMs'
  | 'retryCount'
  | 'recoveryOfExecutionId'
  | 'executionFamilyId'
  | 'usesProjectAssets'
  | 'createdAt'
  | 'startedAt'
  | 'finishedAt'
>

export type WorkflowExecutionFamilyDto = Readonly<{
  executionFamilyId: string
  rootExecutionId: string
  latestExecutionId: string
  latestExecutionStatus: WorkflowExecutionDto['status']
  activeExecutionIds: string[]
  activeExecutionCount: number
  activeExecutionIdsTruncated: boolean
  executionCount: number
  successfulExecutionCount: number
  nodeAttemptCount: number
  createdAt: string
  updatedAt: string
  executions: WorkflowExecutionFamilyMemberDto[]
  nextCursor: string | null
}>

export type WorkflowExecutionSnapshotDto = {
  executionId: string
  flowId: string
  flowVersionId: string
  name: string
  createdAt: string
  data: unknown
  canvasData?: unknown
}

export type WorkflowExecutionEventDto = {
  id: string
  executionId: string
  seq: number
  eventType: string
  level: 'debug' | 'info' | 'warn' | 'error'
  nodeId?: string | null
  message?: string | null
  data?: unknown
  createdAt: string
}

export type WorkflowNodeRunDto = {
  id: string
  executionId: string
  nodeId: string
  status: 'queued' | 'running' | 'waiting_external' | 'success' | 'failed' | 'skipped' | 'not_selected' | 'canceled'
  attempt: number
  errorMessage?: string | null
  errorCode?: string | null
  failureStage?: string | null
  inputRefs?: unknown
  outputRefs?: unknown
  toolCalls?: unknown
  retryCount?: number
  nodeType?: string | null
  toolName?: string | null
  modelKey?: string | null
  durationMs?: number | null
  createdAt: string
  startedAt?: string | null
  finishedAt?: string | null
}

export type WorkflowExecutionContextDto = {
  executionId: string
  projectId: string | null
  canvasId: string | null
  projectContext: unknown
  assetSnapshot: unknown[]
  usesProjectAssets: boolean
}

export type WorkflowExecutionMetricsDto = {
  sampleSize: number
  workflowSuccessRate: number
  nodeFailureRate: number
  recoverySuccessRate: number
  breakdowns: Record<string, Array<{ key: string; total: number; success: number; failed: number; successRate: number }>>
}

export type WorkflowNodeRunHistoryDto = WorkflowNodeRunDto & {
  executionStatus: WorkflowExecutionDto['status']
  executionCreatedAt: string
  executionFinishedAt?: string | null
}

export type AgentPipelineStage =
  | 'material_ingest'
  | 'script_breakdown'
  | 'storyboard_generation'
  | 'shot_planning'
  | 'image_generation'
  | 'video_generation'
  | 'qc_publish'

export type AgentPipelineRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export type AgentPipelineRunResultDto = {
  storyboardContent?: string | null
  storyboardArtifact?: Record<string, unknown> | null
  storyboardStructured?: StoryboardStructuredData | null
  storyboardPlanId?: string | null
  [key: string]: unknown
}

export type AgentPipelineRunDto = {
  id: string
  ownerId: string
  projectId: string
  title: string
  goal?: string | null
  status: AgentPipelineRunStatus
  stages: AgentPipelineStage[]
  progress?: unknown
  result?: AgentPipelineRunResultDto
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
  startedAt?: string | null
  finishedAt?: string | null
}

export type MaterialKindDto = 'character' | 'scene' | 'prop' | 'style' | 'text' | 'ensemble' | 'pose' | 'voice'

export type MaterialAssetDto = {
  id: string
  projectId: string
  teamId?: string | null
  folderId?: string | null
  scope: 'project' | 'official' | 'personal' | 'team'
  kind: MaterialKindDto
  name: string
  favorite?: boolean
  currentVersion: number
  latestVersion?: MaterialAssetVersionDto | null
  createdAt: string
  updatedAt: string
  origin?: {
    type: 'project_node'
    ownerType: 'project' | 'chapter' | 'shot'
    ownerId: string
    flowId: string
    nodeId: string
  }
}

export type MaterialFolderDto = {
  id: string
  projectId?: string | null
  teamId?: string | null
  ownerId?: string | null
  scope: 'official' | 'personal' | 'team'
  name: string
  createdAt: string
}

export type MaterialAssetVersionDto = {
  id: string
  assetId: string
  projectId: string
  version: number
  data: Record<string, unknown>
  note: string | null
  createdAt: string
}

export type MaterialShotRefDto = {
  id: string
  projectId: string
  shotId: string
  assetId: string
  assetVersion: number
  createdAt: string
  updatedAt: string
}

export type MaterialImpactItemDto = {
  shotId: string
  assetId: string
  boundVersion: number
  currentVersion: number
  isOutdated: boolean
}

export type MaterialImpactResponseDto = {
  projectId: string
  items: MaterialImpactItemDto[]
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

export type LlmNodePresetType = 'text' | 'image' | 'video'
export type LlmNodePresetScope = 'base' | 'user'

const LlmNodePresetStyleReferenceSchema = z.object({
  styleId: z.string().optional(),
  categories: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  era: z.string().optional(),
  region: z.string().optional(),
  ethnicity: z.string().optional(),
  medium: z.string().optional(),
}).strict()

export type LlmNodePresetStyleReference = z.infer<typeof LlmNodePresetStyleReferenceSchema>

export const LlmNodePresetDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(['text', 'image', 'video']),
  prompt: z.string(),
  description: z.string().optional(),
  referenceImageUrl: z.string().url().optional(),
  styleReference: LlmNodePresetStyleReferenceSchema.optional(),
  scope: z.enum(['base', 'user']),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()

export type LlmNodePresetDto = z.infer<typeof LlmNodePresetDtoSchema>

export const AdminLlmNodePresetDtoSchema = LlmNodePresetDtoSchema.extend({
  scope: z.literal('base'),
  enabled: z.boolean(),
  sortOrder: z.number().int().nullable(),
}).strict()

export type AdminLlmNodePresetDto = z.infer<typeof AdminLlmNodePresetDtoSchema>

export type AdminLlmNodePresetUpsertInput = {
  id?: string
  title: string
  type: LlmNodePresetType
  prompt: string
  description?: string | null
  referenceImageUrl?: string | null
  styleReference?: LlmNodePresetStyleReference
  enabled: boolean
  sortOrder?: number | null
}

export type CreateLlmNodePresetInput = {
  title: string
  type: LlmNodePresetType
  prompt: string
  description?: string
  referenceImageUrl?: string | null
  styleReference?: LlmNodePresetStyleReference
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

export type AgentsChatGenerationProposal = {
  version: 1
  proposalId: string
  kind: 'image' | 'video' | 'audio' | 'prompt'
  title: string
  prompt: string
  model?: string
  parameters?: Array<{ label: string; value: string }>
  action?: string
  nodeId?: string
}

export type AgentsChatRequestDto = {
  vendor?: string
  vendorCandidates?: string[]
  prompt: string
  clientPendingId?: string
  displayPrompt?: string
  response_format?: unknown
  sessionKey?: string
  /** Replace the single project/flow/chapter conversation source before this turn. */
  resetSession?: boolean
  queueMode?: 'steering' | 'follow_up'
  bookId?: string
  chapterId?: string
  canvasProjectId?: string
  canvasFlowId?: string
  canvasNodeId?: string
  chatContext?: {
    generationProposal?: AgentsChatGenerationProposal
    requestedWorkflowExecutionVariant?: 'full_video' | 'first_video'
    currentProjectName?: string
    workspaceAction?: 'chapter_script_generation' | 'chapter_asset_generation' | 'shot_video_generation'
    skill?: {
      id: string
      source: 'system' | 'user' | 'marketplace'
    }
    roleSkillAssignments?: AgentRoleSkillAssignment[]
    selectedNodeLabel?: string
    selectedNodeKind?: string
    selectedNodeTextPreview?: string
    selectedReference?: {
      nodeId?: string
      label?: string
      kind?: string
      anchorBindings?: Array<{
        kind: 'character' | 'scene' | 'prop' | 'shot' | 'story' | 'asset' | 'context' | 'authority_base_frame'
        refId?: string
        entityId?: string
        label?: string
        sourceBookId?: string
        sourceNodeId?: string
        assetId?: string
        assetRefId?: string
        imageUrl?: string
        referenceView?: 'three_view' | 'role_card'
        category?: string
        note?: string
      }>
      imageUrl?: string
      sourceUrl?: string
      bookId?: string
      chapterId?: string
      shotNo?: number
      productionLayer?: string
      creationStage?: string
      approvalStatus?: string
      hasUpstreamTextEvidence?: boolean
      hasDownstreamComposeVideo?: boolean
      storyboardSelectionContext?: StoryboardSelectionContext
    }
    chapterCanvasReference?: {
      version: 1
      scopeKey: string
      nodeCount: number
      edgeCount: number
      summary?: string
      selectedNodeId?: string
    }
    chapterDirectorPersona?: ChapterDirectorPersonaOverride | null
    chapterStyleOverride?: ChapterStyleOverrideContext | null
    chatMode?: 'creative'
    creativePhase?: 'prep' | 'writing'
    canvasSummary?: string
  }
  planOnly?: boolean
  forceAssetGeneration?: boolean
  requestedImageCount?: number
  aspectRatio?: string
  systemPrompt?: string
  modelAlias?: string
  modelKey?: string
  temperature?: number
  disableQualityReview?: boolean
  mode?: 'chat' | 'auto'
  /** 智能团手动指派：强制本轮由指定子 agent（如 storyboard-director/film-editor）干活，覆盖小T自动委派 */
  forcedAgentRole?: string
  /** 调用方显式授权本轮可委派的 agent type，不允许 agents-cli 扩大该集合。 */
  allowedSubagentTypes?: string[]
  /** 本轮必须产生真实 agents-team 执行证据。 */
  requireAgentsTeamExecution?: boolean
  referenceImages?: string[]
  requiredSkills?: string[]
  executionToolPolicy?: {
    mode: 'restricted'
    allowedTools: string[]
  }
  stream?: boolean
  assetInputs?: Array<{
    assetId?: string
    assetRefId?: string
    url?: string
    role?: 'target' | 'reference' | 'character' | 'scene' | 'prop' | 'product' | 'style' | 'context' | 'mask'
    weight?: number
    note?: string
    name?: string
  }>
  requestUserInputResponse?: {
    requestId: string
    answers: Array<{
      id: string
      value: string
      optionLabel?: string
      optionIndex?: number
    }>
  }
}

export type AgentsChatQueueReceiptDto = {
  accepted: true
  queueId: string
  mode: 'steering' | 'follow_up'
  sessionId: string
  activeTurn: boolean
}

export async function enqueueAgentsChatMessage(payload: {
  prompt: string
  sessionKey: string
  queueMode: 'steering' | 'follow_up'
  modelKey?: string
  modelAlias?: string
  chatContext?: { generationProposal?: AgentsChatGenerationProposal }
}): Promise<AgentsChatQueueReceiptDto> {
  const r = await apiFetch(resolveAgentsChatEndpoint({ prompt: payload.prompt }), withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getClientPageTraceHeaders() },
    body: JSON.stringify({
      vendor: 'agents',
      ...payload,
      ...(payload.modelKey?.trim() ? { modelKey: payload.modelKey.trim() } : {}),
      ...(payload.modelAlias?.trim() ? { modelAlias: payload.modelAlias.trim() } : {}),
      ...(payload.chatContext ? { chatContext: payload.chatContext } : {}),
    }),
  }))
  const body: unknown = await r.json().catch(() => null)
  if (!r.ok) {
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : null
    const error = record?.error
    const message = typeof record?.message === 'string'
      ? record.message
      : error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string'
        ? String((error as Record<string, unknown>).message)
        : `agents queue failed: ${r.status}`
    throw new Error(message)
  }
  if (!body || typeof body !== 'object') throw new Error('agents queue response is invalid')
  const receipt = body as Record<string, unknown>
  if (receipt.accepted !== true || typeof receipt.queueId !== 'string') {
    throw new Error('agents queue response is missing an accepted queueId')
  }
  return body as AgentsChatQueueReceiptDto
}

export type AgentExecutionProvenanceDto = {
  version: 1
  executionId: string
  agentId?: string
  parentAgentId?: string
  sessionId?: string
  depth: number
  model: string
  apiStyle: 'chat' | 'responses'
  requiredSkills: string[]
  loadedSkills: string[]
  loadedSkillResources?: Array<{
    skill: string
    resource: string
    contentHash?: string
    contentChars?: number
  }>
  loadedSkillSources?: Array<{
    skill: string
    name?: string
    description?: string
    sourceKind: 'skill' | 'section' | 'resource' | 'external'
    source: string
    contentHash: string
    contentChars: number
    decisionBasisRole?: 'professional_method' | 'evidence_only'
  }>
  loadedKnowledgeSources?: Array<{
    cardId: string
    title: string
    description?: string
    domain?: string
    facet?: string
    sourceUrls: string[]
    contentHash: string
    contentChars: number
  }>
  startedAt: string
}

export type AgentsRuntimeTraceDto = {
  profile: 'general' | 'code' | 'unknown'
  registeredToolNames: string[]
  registeredTeamToolNames: string[]
  requiredSkills: string[]
  loadedSkills: string[]
  allowedSubagentTypes: string[]
  requireAgentsTeamExecution: boolean
  contextDiagnostics?: {
    totalChars: number
    totalBudgetChars: number
    sources: Array<{
      id: string
      kind: string
      summary: string
      chars: number
      budgetChars: number
      truncated: boolean
    }>
  }
  capabilitySnapshot?: {
    providers: Array<{
      kind: string
      name: string
      toolNames: string[]
      toolCount: number
    }>
    exposedToolNames: string[]
    exposedTeamToolNames: string[]
  }
  policySummary?: {
    totalDecisions: number
    allowCount: number
    denyCount: number
    requiresApprovalCount: number
    uniqueDeniedSignatures: string[]
  }
  canvasCapabilities?: {
    version: string | null
    localCanvasToolNames: string[]
    remoteToolNames: string[]
    nodeKinds: string[]
  }
  deliveryReport?: {
    required: boolean
    present: boolean
    satisfiedByAsyncSubmission: boolean
    remoteActionCount: number
    lastRemoteActionSeq: number | null
    lastReportSeq: number | null
  }
}

export type AgentsChatResponseDto = {
  id: string
  vendor: string
  modelKey?: string
  modelAlias?: string
  text: string
  agentDecision?: {
    executionKind: 'plan' | 'execute' | 'generate' | 'answer'
    canvasAction: 'create_canvas_workflow' | 'write_canvas' | 'none'
    assetCount: number
    projectStateRead: boolean
    reason: string
  }
  trace?: {
    requestId?: string
    sessionId?: string
    outputMode?: 'plan_with_assets' | 'plan_only' | 'direct_assets' | 'text_only'
    traceProjection?: {
      status: 'complete' | 'failed'
      code: string | null
      issues: Array<{ path: string; message: string }>
    }
    toolEvidence?: {
      toolNames: string[]
      readProjectState: boolean
      readBookList: boolean
      readBookIndex: boolean
      readChapter: boolean
      readStoryboardPlan: boolean
      readStoryboardContinuity: boolean
      readStoryboardSourceBundle: boolean
      readNodeContextBundle: boolean
      readVideoReviewBundle: boolean
      readMaterialAssets: boolean
      generatedAssets: boolean
      wroteCanvas: boolean
    }
    toolStatusSummary?: {
      totalToolCalls: number
      succeededToolCalls: number
      failedToolCalls: number
      deniedToolCalls: number
      blockedToolCalls: number
      runMs: number | null
    }
    canvasMutation?: {
      createdNodeIds: string[]
      patchedNodeIds: string[]
      executableNodeIds: string[]
    }
    diagnosticFlags?: Array<{
      code: string
      severity: 'high' | 'medium'
      title: string
      detail: string
    }>
    canvasPlan?: {
      tagPresent: boolean
      normalized: boolean
      parseSuccess: boolean
      error: string
      errorCode: string
      errorDetail: string
      schemaIssues: string[]
      detectedTagName: string
      nodeCount: number
      edgeCount: number
      nodeKinds: string[]
      hasAssetUrls: boolean
      action: string
      summary: string
      reason: string
      rawPayload: string
    }
    turnVerdict?: {
      status: 'satisfied' | 'partial' | 'failed'
      reasons: string[]
    }
    /** Legacy diagnostic only. Lifecycle authority is logicalTaskState. */
    requestTerminal?: AgentRequestTerminalV1
    logicalTaskState: AgentLogicalTaskStateV1
    runtime?: AgentsRuntimeTraceDto
    executionProvenance?: AgentExecutionProvenanceDto
    expectedDelivery?: {
      active: boolean
      kind: string
      source: 'none' | 'agents_cli_tool_trace' | 'agents_cli_user_intent_contract'
      reason: string
      taskGoal?: string
      requestedOutput?: string
      successCriteria?: string[]
      deliveryContract?: { kind: string } & Record<string, unknown>
      contractHash?: string
    }
    deliveryEvidence?: {
      version: 2
      items: Array<{
        evidenceId: string
        kind: 'final_response' | 'tool_call' | 'artifact' | 'persisted_state' | 'source'
        sourceRef: string
        requirementIds: string[]
        artifactClass?: string
        attributes: Record<string, string | number | boolean | null>
      }>
      artifacts: Array<{
        toolCallId: string
        toolName: string
        assetType: 'image' | 'video' | 'audio'
        deliveryState: 'materialized' | 'accepted_async'
        nodeId: string | null
        taskId: string | null
        runId: string | null
        clipIndex: number | null
        assetUrl: string | null
        completionBoundary?: 'submission'
      }>
      assetCount: number
      imageAssetCount: number
      videoAssetCount: number
      wroteCanvas: boolean
      generatedAssets: boolean
    }
    deliveryVerification?: {
      version: 2
      contractHash: string
      status: 'satisfied' | 'unsatisfied'
      criteria: Array<{
        requirementId: string
        status: 'satisfied' | 'avoided' | 'applied' | 'conflict' | 'unresolved'
        evidenceIds: string[]
        reason: string
      }>
      verifiedAt: string
    }
    todoList?: {
      sourceToolCallId: string
      items: Array<{
        text: string
        completed: boolean
        status: 'pending' | 'in_progress' | 'completed'
      }>
      totalCount: number
      completedCount: number
      inProgressCount: number
      pendingCount: number
    }
    todoEvents?: Array<{
      sourceToolCallId: string
      items: Array<{
        text: string
        completed: boolean
        status: 'pending' | 'in_progress' | 'completed'
      }>
      totalCount: number
      completedCount: number
      inProgressCount: number
      pendingCount: number
      atMs: number | null
      startedAt: string | null
      finishedAt: string | null
      durationMs: number | null
    }>
  }
  assets?: Array<{
    type: 'image' | 'video' | 'audio'
    title?: string
    url: string
    thumbnailUrl?: string
    assetId?: string
    assetRefId?: string
    vendor?: string
    modelKey?: string
    taskId?: string
  }>
  pendingUserInput?: {
    status: 'needs_input'
    requestId: string
    questions: Array<{
      id: string
      header: string
      question: string
      options: Array<{ label: string; description?: string; imageUrl?: string; thumbnailUrl?: string }>
    }>
  }
  blocks?: ContentBlock[]
  suggestions?: string[]
}

export type AgentsChatToolStreamPayload = {
  toolCallId: string
  toolName: string
  /** Bridge transport wrapper, present only when different from toolName. */
  transportToolName?: string
  phase: 'started' | 'completed'
  status?: 'succeeded' | 'failed' | 'denied' | 'blocked'
  severity?: 'warning' | 'error'
  input?: unknown
  outputPreview?: string
  errorMessage?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
}

export type AgentsChatLifecycleStreamPayload = Record<string, unknown>

// 团队角色子 agent 活动（分镜师/生成师/剪辑师/后期 正在工作）
export type AgentsChatAgentRoleStreamPayload = {
  agentId: string
  role: string
  roleName: string
  description?: string
  status: 'queued' | 'running' | 'idle' | 'completed' | 'failed' | 'closed'
  progressSummary?: string
  claimedTaskId?: string
  at?: string
}

export type AgentsChatSkillStreamPayload = {
  toolCallId: string
  phase: 'started' | 'completed'
  status?: 'succeeded' | 'failed' | 'denied' | 'blocked'
  id: string
  key: string
  name: string
  source: 'system' | 'user' | 'marketplace'
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  errorMessage?: string
}

export type AgentsChatStatusUpdateStreamPayload = {
  threadId: string
  turnId: string
  phase: 'agent_reasoning' | 'agent_continuation'
  llmTurn: number
  startedAt: string
  timeoutMs?: number
  afterToolCallId?: string
  afterToolName?: string
}

export type AgentsChatArtifactPart =
  | { kind: 'text'; text: string }
  | { kind: 'file'; file: { uri?: string; mimeType?: string } }

export type AgentsChatArtifactUpdateStreamPayload = {
  kind: 'artifact-update'
  taskId: string
  contextId: string
  artifact: {
    artifactId: string
    name?: string
    parts: AgentsChatArtifactPart[]
    metadata?: Record<string, unknown>
  }
}

export type AgentsChatStreamEventCursor = {
  /** Stable execution_trace_events cursor carried by the SSE `id` field. */
  eventId?: string
  sequence?: number
  replayed?: boolean
}

export type AgentsChatStreamEvent = (
  | { event: 'initial'; data: { requestId: string; messageId: string } }
  | { event: 'session'; data: { sessionId: string } }
  | { event: 'thinking'; data: { text: string } }
  | { event: 'tool'; data: AgentsChatToolStreamPayload }
  | { event: 'skill'; data: AgentsChatSkillStreamPayload }
  | {
    event: 'todo_list'
    data: {
      threadId: string
      turnId: string
      sourceToolCallId: string
      items: Array<{
        text: string
        completed: boolean
        status: 'pending' | 'in_progress' | 'completed'
      }>
      totalCount: number
      completedCount: number
      inProgressCount: number
    }
  }
  | { event: 'content'; data: { delta: string } }
  | { event: 'block'; data: BlockStreamOp }
  | { event: 'suggestions'; data: { items: string[] } }
  | { event: 'result'; data: { response: AgentsChatResponseDto } }
  | { event: 'agent_role'; data: AgentsChatAgentRoleStreamPayload }
  | { event: 'status-update'; data: AgentsChatStatusUpdateStreamPayload }
  | { event: 'artifact-update'; data: AgentsChatArtifactUpdateStreamPayload }
  | { event: 'error'; data: {
    message: string
    code?: string
    details?: unknown
    terminal: boolean
    scope: 'transport' | 'provider' | 'tool' | 'persistence' | 'protocol'
    retryability: 'retryable' | 'not_retryable' | 'unknown'
    acceptanceKnown: boolean
    sideEffectOutcomeKnown: boolean
    recovery?: {
      kind: 'status_reconcile' | 'durable_resume' | 'retry_projection'
      referenceId: string
    }
  } }
  | { event: 'resync'; data: {
    publicTurnId: string
    reason: 'retention_gap' | 'cursor_ahead' | 'payload_truncated' | 'terminal_projection_missing'
    requestedAfterEventId: string | null
    earliestAvailableEventId: string | null
    latestEventId: string | null
    recovery: {
      kind: 'status_reconcile'
      referenceId: string
    }
  } }
  | { event: 'done'; data: { reason: 'logical_succeeded' | 'logical_failed' | 'physical_suspended' | 'needs_input' | 'error' | 'interrupted' } }
  | { event: 'thread.started'; data: AgentsChatLifecycleStreamPayload }
  | { event: 'turn.started'; data: AgentsChatLifecycleStreamPayload }
  | { event: 'item.started'; data: AgentsChatLifecycleStreamPayload }
  | { event: 'item.updated'; data: AgentsChatLifecycleStreamPayload }
  | { event: 'item.completed'; data: AgentsChatLifecycleStreamPayload }
  | { event: 'turn.completed'; data: AgentsChatLifecycleStreamPayload }
) & AgentsChatStreamEventCursor

const agentsChatToolStreamPayloadSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  transportToolName: z.string().min(1).optional(),
  phase: z.enum(['started', 'completed']),
  status: z.enum(['succeeded', 'failed', 'denied', 'blocked']).optional(),
  severity: z.enum(['warning', 'error']).optional(),
  input: z.unknown().optional(),
  outputPreview: z.string().optional(),
  errorMessage: z.string().optional(),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1).optional(),
  durationMs: z.number().finite().min(0).optional(),
})

const agentsChatSkillStreamPayloadSchema = z.object({
  toolCallId: z.string().min(1),
  phase: z.enum(['started', 'completed']),
  status: z.enum(['succeeded', 'failed', 'denied', 'blocked']).optional(),
  id: z.string(),
  key: z.string(),
  name: z.string(),
  source: z.enum(['system', 'user', 'marketplace']),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  durationMs: z.number().finite().min(0).optional(),
  errorMessage: z.string().optional(),
})

const agentsChatTodoListStreamPayloadSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  sourceToolCallId: z.string().min(1),
  items: z.array(z.object({
    text: z.string().min(1),
    completed: z.boolean(),
    status: z.enum(['pending', 'in_progress', 'completed']),
  })),
  totalCount: z.number().int().min(0),
  completedCount: z.number().int().min(0),
  inProgressCount: z.number().int().min(0),
})

const agentsChatAgentRoleStreamPayloadSchema = z.object({
  agentId: z.string(),
  role: z.string(),
  roleName: z.string(),
  description: z.string().optional(),
  status: z.enum(['queued', 'running', 'idle', 'completed', 'failed', 'closed']),
  progressSummary: z.string().optional(),
  claimedTaskId: z.string().optional(),
  at: z.string().optional(),
})

const agentsChatStatusUpdateStreamPayloadSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  phase: z.enum(['agent_reasoning', 'agent_continuation']),
  llmTurn: z.number().int().min(1),
  startedAt: z.string().min(1),
  timeoutMs: z.number().finite().positive().optional(),
  afterToolCallId: z.string().min(1).optional(),
  afterToolName: z.string().min(1).optional(),
}).strict()

const agentsChatArtifactPartSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }).strict(),
  z.object({
    kind: z.literal('file'),
    file: z.object({
      uri: z.string().min(1).optional(),
      mimeType: z.string().min(1).optional(),
    }).strict(),
  }).strict(),
])

const agentsChatArtifactUpdateStreamPayloadSchema = z.object({
  kind: z.literal('artifact-update'),
  taskId: z.string().min(1),
  contextId: z.string().min(1),
  artifact: z.object({
    artifactId: z.string().min(1),
    name: z.string().min(1).optional(),
    parts: z.array(agentsChatArtifactPartSchema),
    metadata: z.record(z.unknown()).optional(),
  }).strict(),
}).strict()

const agentsChatReplayResyncPayloadSchema = z.object({
  publicTurnId: z.string().min(1),
  reason: z.enum([
    'retention_gap',
    'cursor_ahead',
    'payload_truncated',
    'terminal_projection_missing',
  ]),
  requestedAfterEventId: z.string().min(1).nullable(),
  earliestAvailableEventId: z.string().min(1).nullable(),
  latestEventId: z.string().min(1).nullable(),
  recovery: z.object({
    kind: z.literal('status_reconcile'),
    referenceId: z.string().min(1),
  }).strict(),
}).strict()

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAgentsChatResponseDto(value: unknown): value is AgentsChatResponseDto {
  return isRecordValue(value) &&
    typeof value.id === 'string' &&
    typeof value.vendor === 'string' &&
    typeof value.text === 'string'
}

function isBlockStreamOp(value: unknown): value is BlockStreamOp {
  if (!isRecordValue(value)) return false
  if (value.op === 'delta') {
    return typeof value.id === 'string' && typeof value.textDelta === 'string'
  }
  if (value.op === 'end') {
    return typeof value.id === 'string' &&
      (value.state === undefined || typeof value.state === 'string')
  }
  if (value.op !== 'start' && value.op !== 'set') return false
  return isRecordValue(value.block) &&
    typeof value.block.id === 'string' &&
    (value.block.type === 'text' || value.block.type === 'media' ||
      value.block.type === 'choice' || value.block.type === 'data')
}

export function parseAgentsChatStreamEvent(
  eventName: string,
  payload: unknown,
): AgentsChatStreamEvent {
  switch (eventName) {
    case 'initial':
      return { event: eventName, data: z.object({ requestId: z.string(), messageId: z.string() }).parse(payload) }
    case 'session':
      return { event: eventName, data: z.object({ sessionId: z.string() }).parse(payload) }
    case 'thinking':
      return { event: eventName, data: z.object({ text: z.string() }).parse(payload) }
    case 'tool':
      return { event: eventName, data: agentsChatToolStreamPayloadSchema.parse(payload) }
    case 'skill':
      return { event: eventName, data: agentsChatSkillStreamPayloadSchema.parse(payload) }
    case 'todo_list':
      return { event: eventName, data: agentsChatTodoListStreamPayloadSchema.parse(payload) }
    case 'content':
      return { event: eventName, data: z.object({ delta: z.string() }).parse(payload) }
    case 'block':
      if (!isBlockStreamOp(payload)) throw new Error('agents_chat_stream_block_payload_invalid')
      return { event: eventName, data: payload }
    case 'suggestions':
      return { event: eventName, data: z.object({ items: z.array(z.string()) }).parse(payload) }
    case 'result': {
      const result = z.object({ response: z.custom<AgentsChatResponseDto>(isAgentsChatResponseDto) }).parse(payload)
      return { event: eventName, data: result }
    }
    case 'agent_role':
      return { event: eventName, data: agentsChatAgentRoleStreamPayloadSchema.parse(payload) }
    case 'status-update':
      return { event: eventName, data: agentsChatStatusUpdateStreamPayloadSchema.parse(payload) }
    case 'artifact-update':
      return { event: eventName, data: agentsChatArtifactUpdateStreamPayloadSchema.parse(payload) }
    case 'error':
      return {
        event: eventName,
        data: z.object({
          message: z.string().min(1),
          code: z.string().optional(),
          details: z.unknown().optional(),
          terminal: z.boolean(),
          scope: z.enum(['transport', 'provider', 'tool', 'persistence', 'protocol']),
          retryability: z.enum(['retryable', 'not_retryable', 'unknown']),
          acceptanceKnown: z.boolean(),
          sideEffectOutcomeKnown: z.boolean(),
          recovery: z.object({
            kind: z.enum(['status_reconcile', 'durable_resume', 'retry_projection']),
            referenceId: z.string().min(1),
          }).strict().optional(),
        }).strict().parse(payload),
      }
    case 'resync':
      return { event: eventName, data: agentsChatReplayResyncPayloadSchema.parse(payload) }
    case 'done':
      return {
        event: eventName,
        data: z.object({
          reason: z.enum([
            'logical_succeeded',
            'logical_failed',
            'physical_suspended',
            'needs_input',
            'error',
            'interrupted',
          ]),
        }).parse(payload),
      }
    case 'thread.started':
    case 'turn.started':
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
    case 'turn.completed': {
      const data = z.record(z.unknown()).parse(payload)
      return { event: eventName, data }
    }
    default:
      throw new Error(`agents_chat_stream_event_unknown:${eventName || '<empty>'}`)
  }
}

function decodeAgentsChatStreamEvent(eventName: string, payloadText: string): AgentsChatStreamEvent {
  let payload: unknown
  try {
    payload = JSON.parse(payloadText) as unknown
  } catch (error) {
    const decodeError = new Error(`agents_chat_stream_json_invalid:${eventName || '<empty>'}`) as Error & { cause?: unknown }
    decodeError.cause = error
    throw decodeError
  }
  try {
    return parseAgentsChatStreamEvent(eventName, payload)
  } catch (error) {
    const validationError = new Error(`agents_chat_stream_payload_invalid:${eventName || '<empty>'}`) as Error & { cause?: unknown }
    validationError.cause = error
    throw validationError
  }
}

export type AgentsChatEventCursor = Readonly<{
  publicTurnId: string
  eventId: string | null
  sequence: number
}>

export type AgentsChatEventCursorAdvance =
  | Readonly<{ status: 'accepted'; cursor: AgentsChatEventCursor }>
  | Readonly<{ status: 'duplicate'; cursor: AgentsChatEventCursor }>
  | Readonly<{ status: 'invalid'; reason: 'missing' | 'turn_mismatch' | 'malformed'; cursor: AgentsChatEventCursor }>

export function advanceAgentsChatEventCursor(
  cursor: AgentsChatEventCursor,
  eventIdValue: string,
): AgentsChatEventCursorAdvance {
  const eventId = String(eventIdValue || '').trim()
  if (!eventId) return { status: 'invalid', reason: 'missing', cursor }
  const separatorIndex = eventId.lastIndexOf('#')
  if (separatorIndex <= 0) return { status: 'invalid', reason: 'malformed', cursor }
  if (eventId.slice(0, separatorIndex) !== cursor.publicTurnId) {
    return { status: 'invalid', reason: 'turn_mismatch', cursor }
  }
  const sequenceText = eventId.slice(separatorIndex + 1)
  if (!/^[1-9][0-9]*$/.test(sequenceText)) {
    return { status: 'invalid', reason: 'malformed', cursor }
  }
  const sequence = Number(sequenceText)
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    return { status: 'invalid', reason: 'malformed', cursor }
  }
  if (sequence <= cursor.sequence) return { status: 'duplicate', cursor }
  return {
    status: 'accepted',
    cursor: {
      publicTurnId: cursor.publicTurnId,
      eventId,
      sequence,
    },
  }
}

export class AgentsChatReplayResyncRequiredError extends Error {
  readonly code = 'agents_chat_event_resync_required' as const
  readonly details: Extract<AgentsChatStreamEvent, { event: 'resync' }>['data']

  constructor(details: Extract<AgentsChatStreamEvent, { event: 'resync' }>['data']) {
    super('对话事件日志存在缺口，已切换到持久状态对账。')
    this.name = 'AgentsChatReplayResyncRequiredError'
    this.details = details
  }
}

const AGENTS_CHAT_TRANSPORT_IDLE_MS = 45_000
const AGENTS_CHAT_ADMISSION_MAX_ATTEMPTS = 5

function readAcceptedPublicTurnId(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const apiError = error as ApiRequestError
  if (apiError.code !== 'agents_chat_turn_already_exists') return null
  const details = isRecordValue(apiError.details) ? apiError.details : null
  const publicTurnId = typeof details?.publicTurnId === 'string'
    ? details.publicTurnId.trim()
    : ''
  return publicTurnId || null
}

function isRetryableAgentsChatAdmissionError(error: unknown): boolean {
  if (error instanceof Error && error.message.startsWith('agents_chat_stream_')) return false
  if (!error || typeof error !== 'object') return true
  const statusValue = Number((error as ApiRequestError).status)
  if (!Number.isFinite(statusValue) || statusValue <= 0) return true
  return statusValue === 408
    || statusValue === 425
    || statusValue === 429
    || statusValue >= 500
}

function waitForAgentsChatRetry(signal: AbortSignal, milliseconds: number): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      globalThis.clearTimeout(timeoutId)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export type PublicVisionRequestDto = {
  vendor?: string
  vendorCandidates?: string[]
  imageUrl?: string
  imageData?: string
  prompt?: string
  modelAlias?: string
  modelKey?: string
  systemPrompt?: string
  temperature?: number
}

export type PublicVisionResponseDto = {
  id?: string
  vendor?: string
  text?: string
  raw?: any
}

export async function agentsChatStream(
  payload: AgentsChatRequestDto,
  handlers: {
    onEvent: (event: AgentsChatStreamEvent) => void
    onOpen?: (context: { turnId: string }) => void
    /** Raw transport activity, including SSE heartbeat comments. */
    onTransportActivity?: () => void
    onError?: (error: Error) => void
    signal?: AbortSignal
  },
  conversationId?: string,
): Promise<() => void> {
  const controller = new AbortController()
  const externalSignal = handlers.signal
  const abortFromExternalSignal = () => controller.abort()
  if (externalSignal?.aborted) controller.abort()
  else externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true })
  const releaseExternalSignal = () => {
    externalSignal?.removeEventListener('abort', abortFromExternalSignal)
  }

  let initialResponse: Response | null = null
  let publicTurnId = ''
  try {
    for (let attempt = 1; attempt <= AGENTS_CHAT_ADMISSION_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await apiFetch(resolveAgentsChatEndpoint(payload), withAuth({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...getClientPageTraceHeaders(),
            ...(conversationId ? { 'x-tapcanvas-conversation-id': conversationId } : {}),
          },
          body: JSON.stringify({ ...payload, stream: true }),
          signal: controller.signal,
        }))
        if (!response.ok) {
          await throwApiError(response, `agents chat stream failed: ${response.status}`)
        }
        publicTurnId = readAgentsChatTurnIdHeader(response.headers)
        initialResponse = response.body ? response : null
        break
      } catch (error: unknown) {
        const acceptedTurnId = readAcceptedPublicTurnId(error)
        if (acceptedTurnId) {
          publicTurnId = acceptedTurnId
          initialResponse = null
          break
        }
        if (
          controller.signal.aborted
          || !String(payload.clientPendingId || '').trim()
          || !isRetryableAgentsChatAdmissionError(error)
          || attempt >= AGENTS_CHAT_ADMISSION_MAX_ATTEMPTS
        ) {
          throw error
        }
        const backoffMs = Math.min(2_000, 250 * (2 ** (attempt - 1)))
        await waitForAgentsChatRetry(controller.signal, backoffMs)
      }
    }
  } catch (error: unknown) {
    releaseExternalSignal()
    throw error
  }
  if (!publicTurnId) {
    releaseExternalSignal()
    throw new Error('agents_chat_stream_admission_identity_missing')
  }
  handlers.onOpen?.({ turnId: publicTurnId })
  let cursor: AgentsChatEventCursor = {
    publicTurnId,
    eventId: null,
    sequence: 0,
  }
  let sawTerminalEvent = false
  let notifiedError = false

  const dispatchEvent = (
    eventName: string,
    payloadText: string,
    eventId: string,
    replayed: boolean,
  ): void => {
    const event = decodeAgentsChatStreamEvent(eventName, payloadText)
    if (event.event === 'resync') {
      handlers.onEvent({ ...event, replayed })
      throw new AgentsChatReplayResyncRequiredError(event.data)
    }
    const advanced = advanceAgentsChatEventCursor(cursor, eventId)
    if (advanced.status === 'invalid') {
      throw new Error(`agents_chat_stream_event_id_${advanced.reason}`)
    }
    if (advanced.status === 'duplicate') return
    cursor = advanced.cursor
    if (
      event.event === 'result' ||
      event.event === 'done' ||
      (event.event === 'error' && event.data.terminal === true)
    ) {
      sawTerminalEvent = true
    }
    handlers.onEvent({
      ...event,
      eventId: cursor.eventId ?? undefined,
      sequence: cursor.sequence,
      replayed,
    })
  }

  const consumeResponse = async (response: Response, replayed: boolean): Promise<void> => {
    const responseTurnId = readAgentsChatTurnIdHeader(response.headers)
    if (responseTurnId !== publicTurnId) {
      throw new Error('agents_chat_stream_replay_turn_mismatch')
    }
    if (!response.body) throw new Error('agents chat stream missing body')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const parser = createSseEventParser()
    let transportIdleTimerId: ReturnType<typeof globalThis.setTimeout> | null = null
    const armTransportIdle = () => {
      if (transportIdleTimerId !== null) globalThis.clearTimeout(transportIdleTimerId)
      transportIdleTimerId = globalThis.setTimeout(() => {
        // Cancel only this transport projection. The durable turn remains
        // accepted and the outer pump reopens /status from the last event id.
        void reader.cancel('agents_chat_transport_idle_reconnect').catch(() => undefined)
      }, AGENTS_CHAT_TRANSPORT_IDLE_MS)
    }
    try {
      armTransportIdle()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        armTransportIdle()
        handlers.onTransportActivity?.()
        const events = parser.push(decoder.decode(value, { stream: true }))
        for (const event of events) {
          const payloadText = String(event.data || '').trim()
          if (!payloadText) continue
          dispatchEvent(event.event, payloadText, event.id, replayed)
          if (sawTerminalEvent) return
        }
      }
      for (const event of parser.finish()) {
        const payloadText = String(event.data || '').trim()
        if (!payloadText) continue
        dispatchEvent(event.event, payloadText, event.id, replayed)
        if (sawTerminalEvent) return
      }
    } finally {
      if (transportIdleTimerId !== null) globalThis.clearTimeout(transportIdleTimerId)
      reader.releaseLock()
    }
  }

  const openReplayResponse = async (): Promise<Response> => {
    const replayResponse = await apiFetch(`${API_BASE}/public/agents/chat/status`, withAuth({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...getClientPageTraceHeaders(),
        ...(cursor.eventId ? { 'Last-Event-ID': cursor.eventId } : {}),
      },
      body: JSON.stringify({
        streamEvents: true,
        turnId: publicTurnId,
        afterEventId: cursor.eventId,
        ...(payload.sessionKey ? { sessionKey: payload.sessionKey } : {}),
        ...(payload.canvasProjectId ? { canvasProjectId: payload.canvasProjectId } : {}),
        ...(payload.canvasFlowId ? { canvasFlowId: payload.canvasFlowId } : {}),
        ...(payload.chapterId ? { chapterId: payload.chapterId } : {}),
      }),
      signal: controller.signal,
    }))
    if (!replayResponse.ok) {
      await throwApiError(replayResponse, `resume agents chat event stream failed: ${replayResponse.status}`)
    }
    if (!replayResponse.body) throw new Error('agents chat replay stream missing body')
    return replayResponse
  }

  const notifyError = (error: unknown): void => {
    if (notifiedError || controller.signal.aborted) return
    notifiedError = true
    handlers.onError?.(error instanceof Error ? error : new Error('agents chat stream error'))
  }

  const pump = async (): Promise<void> => {
    let response: Response | null = initialResponse
    let replayed = initialResponse === null
    let reconnectAttempt = 0
    while (!controller.signal.aborted && !sawTerminalEvent) {
      if (!response) {
        try {
          response = await openReplayResponse()
          replayed = true
          reconnectAttempt = 0
        } catch (error: unknown) {
          if (controller.signal.aborted) return
          const status = error && typeof error === 'object'
            ? Number((error as { status?: unknown }).status)
            : 0
          if (Number.isFinite(status) && status >= 400 && status < 500) {
            notifyError(error)
            return
          }
          reconnectAttempt += 1
          const backoffMs = Math.min(2_000, 200 * (2 ** Math.min(reconnectAttempt, 4)))
          await waitForAgentsChatRetry(controller.signal, backoffMs)
          continue
        }
      }
      try {
        await consumeResponse(response, replayed)
        if (sawTerminalEvent || controller.signal.aborted) return
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        if (
          error instanceof AgentsChatReplayResyncRequiredError ||
          (error instanceof Error && error.message.startsWith('agents_chat_stream_'))
        ) {
          notifyError(error)
          return
        }
      }
      // The accepted durable turn keeps running. Re-open only its event journal;
      // never resend the original chat request and never allocate another task.
      response = null
    }
  }

  void pump().catch(notifyError).finally(releaseExternalSignal)

  return () => {
    releaseExternalSignal()
    controller.abort()
  }
}

export async function agentsChat(payload: AgentsChatRequestDto): Promise<AgentsChatResponseDto> {
  const r = await apiFetch(resolveAgentsChatEndpoint(payload), withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getClientPageTraceHeaders() },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `agents chat failed: ${r.status}`)
  return r.json()
}

export async function llmChat(opts: {
  model: string
  systemPrompt: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
}): Promise<string> {
  const r = await apiFetch(`${API_BASE}/agents/llm/v1/chat/completions`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature ?? 0.3,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.userPrompt },
      ],
    }),
  }))
  if (!r.ok) {
    let msg = `llm chat failed: ${r.status}`
    try { const b: any = await r.json(); msg = b?.error?.message || b?.message || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  const data: any = await r.json()
  return (data?.choices?.[0]?.message?.content ?? '').trim()
}

export async function llmAuxiliaryChat(opts: {
  purpose: 'conversation_title'
  model: string
  systemPrompt: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
}): Promise<string> {
  const r = await apiFetch(`${API_BASE}/agents/llm/v1/auxiliary/chat/completions`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auxiliaryPurpose: opts.purpose,
      model: opts.model,
      temperature: opts.temperature ?? 0.3,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.userPrompt },
      ],
    }),
  }))
  if (!r.ok) await throwApiError(r, `auxiliary llm chat failed: ${r.status}`)
  const payload: unknown = await r.json()
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ''
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const firstChoice = choices[0]
  if (!firstChoice || typeof firstChoice !== 'object' || Array.isArray(firstChoice)) return ''
  const message = (firstChoice as { message?: unknown }).message
  if (!message || typeof message !== 'object' || Array.isArray(message)) return ''
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content.trim() : ''
}

export async function llmChatVision(opts: {
  model: string
  systemPrompt?: string
  imageUrl: string
  userText: string
  temperature?: number
}): Promise<string> {
  const messages: any[] = []
  if (opts.systemPrompt) {
    messages.push({ role: 'system', content: opts.systemPrompt })
  }
  messages.push({
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: opts.imageUrl } },
      { type: 'text', text: opts.userText },
    ],
  })
  const r = await apiFetch(`${API_BASE}/agents/llm/v1/chat/completions`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature ?? 0.3,
      messages,
    }),
  }))
  if (!r.ok) {
    let msg = `llm vision chat failed: ${r.status}`
    try { const b: any = await r.json(); msg = b?.error?.message || b?.message || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  const data: any = await r.json()
  return (data?.choices?.[0]?.message?.content ?? '').trim()
}

// 显式中断服务端在飞聊天回合。仅 abort 本地 SSE 流杀不掉服务端 run（S2 断连解耦），
// 「中断」按钮须打这个端点，否则回合在后台继续跑、重发即双回合互踩。
export async function interruptAgentsChatTurn(payload: {
  sessionKey?: string
  canvasProjectId?: string
  canvasFlowId?: string
  chapterId?: string
  turnId: string
  cancellationScope?: 'physical_only' | 'logical_task'
}): Promise<AgentsChatTurnInterruptReceiptDto> {
  const requestedTurnId = String(payload.turnId || '').trim()
  if (!requestedTurnId) throw new Error('中断聊天回合必须提供 turnId')
  const r = await apiFetch(`${API_BASE}/public/agents/chat/interrupt`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `interrupt agents chat failed: ${r.status}`)
  const data: unknown = await r.json()
  return parseAgentsChatTurnInterruptReceiptDto(data, requestedTurnId)
}

export async function getAgentsChatTurnStatus(payload: {
  sessionKey: string
}): Promise<AgentsChatTurnStatusDto> {
  const sessionKey = String(payload.sessionKey || '').trim()
  if (!sessionKey) throw new Error('sessionKey 不能为空')
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 12_000)
  try {
    const r = await apiFetch(`${API_BASE}/public/agents/chat/status`, withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getClientPageTraceHeaders() },
      body: JSON.stringify({ sessionKey }),
      signal: controller.signal,
    }))
    if (!r.ok) await throwApiError(r, `query agents chat turn failed: ${r.status}`)
    return parseAgentsChatTurnStatusDto(await r.json(), sessionKey)
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      throw new Error('查询持久任务状态超时（12 秒），请检查本地 8788 服务与 Agents Runtime')
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

export async function resumeAgentsChatTurn(payload: {
  sessionKey: string
  turnId: string
}): Promise<AgentsChatTurnResumeReceiptDto> {
  const sessionKey = String(payload.sessionKey || '').trim()
  const turnId = String(payload.turnId || '').trim()
  if (!sessionKey || !turnId) throw new Error('恢复聊天回合必须提供 sessionKey 与 turnId')
  const r = await apiFetch(`${API_BASE}/public/agents/chat/resume`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getClientPageTraceHeaders() },
    body: JSON.stringify({ sessionKey, turnId }),
  }))
  if (!r.ok) await throwApiError(r, `resume agents chat turn failed: ${r.status}`)
  const data: unknown = await r.json()
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('resume agents chat response is invalid')
  }
  const record = data as Record<string, unknown>
  const continuationId = typeof record.continuationId === 'string'
    ? record.continuationId.trim()
    : ''
  const stage = typeof record.stage === 'number' ? Math.trunc(record.stage) : -1
  const recoveryKind = record.recoveryKind
  const resumeTrigger = record.resumeTrigger
  if (
    record.ok !== true
    || record.resumed !== true
    || record.sessionKey !== sessionKey
    || record.turnId !== turnId
    || !continuationId
    || stage < 0
    || (resumeTrigger !== 'physical_budget' && resumeTrigger !== 'replan' && resumeTrigger !== 'dependency')
    || (
      recoveryKind !== 'physical_budget'
      && recoveryKind !== 'orphaned_checkpoint'
      && recoveryKind !== 'orphaned_continuation'
    )
  ) {
    throw new Error('resume agents chat response is missing or mismatches recovery fields')
  }
  return {
    ok: true,
    resumed: true,
    sessionKey,
    turnId,
    continuationId,
    stage,
    resumeTrigger,
    recoveryKind,
  }
}

/**
 * 终止指定画布作用域内的视频生产 run。未传 scope 时保留画布项目级终止入口的语义；
 * 已提交到供应商的 clip 不会被强杀，服务端只停止后续编排与新任务提交。
 */
export async function cancelProjectVideoRuns(
  projectId: string,
  scope?: { flowId?: string; chapterId?: string },
): Promise<number> {
  const normalizedScope = {
    ...(String(scope?.flowId || '').trim() ? { flowId: String(scope?.flowId).trim() } : {}),
    ...(String(scope?.chapterId || '').trim() ? { chapterId: String(scope?.chapterId).trim() } : {}),
  }
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/video-runs/cancel`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Object.keys(normalizedScope).length > 0 ? JSON.stringify(normalizedScope) : undefined,
  }))
  if (!r.ok) throw new Error(`cancel video runs failed: ${r.status}`)
  const data = await r.json().catch(() => ({})) as { cancelledCount?: number }
  return typeof data.cancelledCount === 'number' ? data.cancelledCount : 0
}

const VideoUnderstandingTransportSchema = z.object({
  type: z.literal('media-worker-understanding-proxy-v1'),
  url: z.string().url(),
  sizeBytes: z.number().finite().positive().max(50 * 1024 * 1024),
  durationSeconds: z.number().finite().positive().max(60),
}).strict()

const VideoAnalysisValidationIssueSchema = z.object({
  code: z.string().trim().min(1),
  path: z.array(z.union([z.string(), z.number().int().min(0)])),
  message: z.string().trim().min(1),
}).strict()

const VideoAnalysisExecutionAttemptSchema = z.object({
  sequence: z.number().int().min(1).max(2),
  kind: z.enum(['primary', 'targeted_fields', 'full_regeneration']),
  responseId: z.string().trim().min(1),
  previousResponseId: z.string().trim().min(1).nullable(),
  responseModel: z.string().trim().min(1),
  outputSha256: z.string().length(64),
  outputLength: z.number().int().min(1),
  validation: z.enum(['accepted', 'rejected']),
  issues: z.array(VideoAnalysisValidationIssueSchema),
}).strict()

const VideoAnalysisExecutionSchema = z.object({
  proxyTaskId: z.string().trim().min(1),
  requestedModel: z.string().trim().min(1),
  repaired: z.boolean(),
  repairKind: z.enum(['targeted_fields', 'full_regeneration']).nullable(),
  attempts: z.array(VideoAnalysisExecutionAttemptSchema).min(1).max(2),
}).strict()

const VideoShotTableAnalysisResponseEnvelopeSchema = z.object({
  table: z.unknown(),
  text: z.string().trim().min(1),
  model: z.string().trim().min(1),
  outputMode: z.literal('shot-table-v1'),
  transport: VideoUnderstandingTransportSchema,
  analysisExecution: VideoAnalysisExecutionSchema,
}).strict()

const VideoSpeechAuditUtteranceSchema = z.object({
  utteranceId: z.string().trim().min(1),
  startSeconds: z.number().finite().nonnegative(),
  endSeconds: z.number().finite().positive(),
  text: z.string().trim().min(1),
}).strict()

const VideoSpeechAuditResponseEnvelopeSchema = z.object({
  transcript: z.object({
    version: z.literal(1),
    language: z.string().trim().min(1),
    utterances: z.array(VideoSpeechAuditUtteranceSchema),
  }).strict(),
  model: z.string().trim().min(1),
  outputMode: z.literal('speech-audit-v1'),
  transport: VideoUnderstandingTransportSchema,
  analysisExecution: z.object({
    responseId: z.string().trim().min(1),
    model: z.string().trim().min(1),
    outputSha256: z.string().length(64),
    outputLength: z.number().int().min(1),
    store: z.literal(true),
    status: z.literal('completed'),
  }).strict(),
}).strict()

export type VideoShotTableAnalysisResponseDto = {
  table: ShotTableData
  text: string
  model: string
  outputMode: 'shot-table-v1'
  transport: z.infer<typeof VideoUnderstandingTransportSchema>
  analysisExecution: z.infer<typeof VideoAnalysisExecutionSchema>
}

export async function analyzeVideoToShotTable(opts: {
  model: string
  videoUrl: string
  userPrompt: string
  fps: number
}): Promise<VideoShotTableAnalysisResponseDto> {
  const r = await apiFetch(`${API_BASE}/agents/llm/v1/video-understand`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...opts, outputMode: 'shot-table-v1' }),
  }))
  if (!r.ok) await throwApiError(r, `视频分析失败: ${r.status}`)
  const envelope = VideoShotTableAnalysisResponseEnvelopeSchema.parse(await r.json())
  const normalized = normalizeShotTable(envelope.table)
  if (!normalized.ok) {
    throw new Error(`视频分析接口返回了无效分镜表：${normalized.issues.join('；')}`)
  }
  return { ...envelope, table: normalized.table }
}

export type VideoSpeechAuditResponseDto = z.infer<typeof VideoSpeechAuditResponseEnvelopeSchema>

/**
 * 使用与逐帧拉片相同的 video-understand 代理，但要求服务端只返回真实可听人声
 * 及其时间区间。字幕烧录前不会把模型输出当成可信文本以外的任何语义来源。
 */
export async function analyzeVideoToSpeechTranscript(opts: {
  model: string
  videoUrl: string
  fps: number
}): Promise<VideoSpeechAuditResponseDto> {
  const r = await apiFetch(`${API_BASE}/agents/llm/v1/video-understand`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...opts, userPrompt: '', outputMode: 'speech-audit-v1' }),
  }))
  if (!r.ok) await throwApiError(r, `视频人声识别失败: ${r.status}`)
  return VideoSpeechAuditResponseEnvelopeSchema.parse(await r.json())
}

function resolveAgentsChatEndpoint(payload: AgentsChatRequestDto): string {
  void payload
  return `${API_BASE}/public/agents/chat`
}

export async function publicVisionWithAuth(payload: PublicVisionRequestDto): Promise<PublicVisionResponseDto> {
  const r = await apiFetch(`${API_BASE}/public/vision`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    let msg = `public vision failed: ${r.status}`
    try {
      const body: any = await r.json()
      msg = body?.message || body?.error || msg
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
  return r.json()
}

const AgentSkillDtoSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  logoUrl: z.string().url().nullable(),
  category: z.string(),
  enabled: z.boolean(),
  visible: z.boolean(),
  sortOrder: z.number().int().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()

export type AgentSkillDto = z.infer<typeof AgentSkillDtoSchema>

export const AdminAgentSkillDtoSchema = AgentSkillDtoSchema.extend({
  content: z.string(),
}).strict()

export type AdminAgentSkillDto = z.infer<typeof AdminAgentSkillDtoSchema>

export const AdminBuiltInCapabilityDtoSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  requiredTools: z.array(z.string()),
  sideEffects: z.array(z.enum(['none', 'external_mutation', 'paid_generation'])),
  replaceable: z.boolean(),
  enabled: z.boolean(),
  updatedAt: z.string().nullable(),
  updatedByUserId: z.string().nullable(),
}).strict()

export type AdminBuiltInCapabilityDto = z.infer<typeof AdminBuiltInCapabilityDtoSchema>

export type AdminAgentSkillUpsertInput = {
  id?: string
  key: string
  name: string
  description?: string | null
  content: string
  logoUrl?: string | null
  category: string
  enabled: boolean
  visible: boolean
  sortOrder?: number | null
}

const AdminKnowledgeCardDtoSchema = z.object({
  id: z.string(),
  domain: z.string(),
  facet: z.string().nullable(),
  title: z.string(),
  roleScope: z.array(z.enum(['director', 'storyboard', 'generation', 'editor', 'post', 'qa'])),
  keywords: z.array(z.string()),
  sourceUrls: z.array(z.string()),
  body: z.string(),
  path: z.string(),
  sourceRoot: z.string(),
  sourceKind: z.enum(['filesystem', 'admin']),
  contentSha256: z.string(),
  embeddingModel: z.string(),
  updatedAt: z.string(),
  collectionId: z.string(),
  collectionLabel: z.string(),
  editable: z.boolean(),
}).strict()

const AdminKnowledgeListResponseSchema = z.object({
  embeddingModel: z.string(),
  cards: z.array(AdminKnowledgeCardDtoSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
  filters: z.object({
    collections: z.array(z.object({
      id: z.string(),
      label: z.string(),
      sourceRoot: z.string(),
      editable: z.boolean(),
      count: z.number().int().nonnegative(),
    }).strict()),
    domains: z.array(z.string()),
    facets: z.array(z.string()),
    roles: z.array(z.enum(['director', 'storyboard', 'generation', 'editor', 'post', 'qa'])),
  }).strict(),
}).strict()

const AdminKnowledgeSyncSummarySchema = z.object({
  status: z.literal('synced'),
  scope: z.enum(['card', 'all']),
  indexedCards: z.number().int().nonnegative(),
  totalCards: z.number().int().nonnegative(),
  embeddingModel: z.string(),
}).strict()

const AdminKnowledgeUpsertResponseSchema = z.object({
  card: AdminKnowledgeCardDtoSchema,
  sync: AdminKnowledgeSyncSummarySchema,
}).strict()

export type AdminKnowledgeCardDto = z.infer<typeof AdminKnowledgeCardDtoSchema>
export type AdminKnowledgeListResponseDto = z.infer<typeof AdminKnowledgeListResponseSchema>
export type AdminKnowledgeListQuery = {
  collection?: string
  page?: number
  pageSize?: number
  query?: string
  domain?: string
  facet?: string
  roleScope?: 'director' | 'storyboard' | 'generation' | 'editor' | 'post' | 'qa'
}
export type AdminKnowledgeSyncSummaryDto = z.infer<typeof AdminKnowledgeSyncSummarySchema>
export type AdminKnowledgeUpsertResponseDto = z.infer<typeof AdminKnowledgeUpsertResponseSchema>
export type AdminKnowledgeCardUpsertInput = {
  id: string
  domain: string
  facet: string | null
  title: string
  roleScope: Array<'director' | 'storyboard' | 'generation' | 'editor' | 'post' | 'qa'>
  keywords: string[]
  sourceUrls: string[]
  body: string
}

const RankingItemControlDtoSchema = z.object({
  manualBoost: z.number().int(),
  recommended: z.boolean(),
  pinned: z.boolean(),
  displayOrder: z.number().int(),
}).strict()

const SkillRankingConfigDtoSchema = z.object({
  purchaseWeight: z.number(),
  freshnessWeight: z.number(),
  freshnessHalfLifeDays: z.number(),
  items: z.record(z.string(), RankingItemControlDtoSchema),
}).strict()

const SkillMarketplaceItemDtoSchema = z.object({
  skill: AgentSkillDtoSchema,
	productId: z.string().nullable(),
	priceCredits: z.number().int().positive().nullable(),
	purchasable: z.boolean(),
	owned: z.boolean(),
	sourceType: z.enum(['official', 'user_asset']),
	sellerUserId: z.string().nullable(),
	sellerName: z.string().nullable(),
	sizeBytes: z.number().int().nonnegative().nullable(),
	promptCharacterCount: z.number().int().nonnegative(),
	listedAt: z.string().nullable(),
  realPurchaseCount: z.number().int().nonnegative(),
  algorithmScore: z.number(),
  manualBoost: z.number().int(),
  effectiveScore: z.number(),
  recommended: z.boolean(),
  pinned: z.boolean(),
  displayOrder: z.number().int(),
  rank: z.number().int().positive(),
}).strict()

export const SkillMarketplaceResponseDtoSchema = z.object({
	configured: z.boolean(),
	config: SkillRankingConfigDtoSchema,
	creditBalance: z.number().int().nonnegative(),
	canListSkills: z.boolean().optional(),
	items: z.array(SkillMarketplaceItemDtoSchema),
}).strict()

export type RankingItemControlDto = z.infer<typeof RankingItemControlDtoSchema>
export type SkillRankingConfigDto = z.infer<typeof SkillRankingConfigDtoSchema>
export type SkillMarketplaceItemDto = z.infer<typeof SkillMarketplaceItemDtoSchema>
export type SkillMarketplaceResponseDto = z.infer<typeof SkillMarketplaceResponseDtoSchema>

export type HomepageVideoRankingConfigDto = {
  engagementWeight: number
  freshnessWeight: number
  freshnessHalfLifeDays: number
  items: Record<string, RankingItemControlDto>
}

export type HomepageVideoModerationConfigDto = {
  kind: 'homepageVideoModeration'
  version: 1
  blockedAssetIds: string[]
}

const UserContextAssetDtoSchema = z.object({
  id: z.string(),
  kind: z.literal('skill'),
  fileName: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  logoUrl: z.string().url().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string(),
	marketplaceListing: z.object({
		productId: z.string(),
		priceCredits: z.number().int().positive(),
		listedAt: z.string(),
  }).strict().nullable(),
  sourceMarketplaceProductId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()

export type UserContextAssetDto = z.infer<typeof UserContextAssetDtoSchema>

export const WorkflowCapabilityDescriptorDtoSchema = z.object({
  protocolVersion: z.literal('tapcanvas.agent-capability/v1'),
  capabilityId: z.string(),
  kind: z.literal('workflow'),
  name: z.string(),
  summary: z.string(),
  sourceId: z.string(),
  sourceVersionId: z.string(),
  sourceRevision: z.number().int().nonnegative(),
  projectId: z.string().nullable(),
  triggerNodeId: z.string(),
  nodeCount: z.number().int().positive(),
  operations: z.array(z.string()),
  requiredSkills: z.array(z.string()),
  requiredTools: z.array(z.string()),
  inputArtifacts: z.array(z.string()),
  outputArtifacts: z.array(z.string()),
  invocation: z.object({
    sourceMode: z.enum(['none', 'inline_text', 'canvas_group', 'project_context']),
    requiredTriggerPayloadFields: z.array(z.string().trim().min(1)).max(16),
    executionVariant: z.enum(['full_video', 'first_video']).optional(),
  }).strict().optional(),
  permissions: z.array(z.string()),
  sideEffects: z.array(z.enum(['none', 'local_mutation', 'external_mutation', 'paid_generation'])),
  semanticEvidence: z.array(z.object({ label: z.string(), description: z.string(), operation: z.string() }).strict()),
}).strict()

const CapabilityConflictDtoSchema = z.object({
  id: z.string(),
  severity: z.enum(['blocking', 'warning', 'info']),
  category: z.enum([
    'identity_collision', 'version_change', 'permission_overlap', 'functional_overlap',
    'semantic_overlap', 'goal_contradiction', 'side_effect_collision', 'input_output_ambiguity',
  ]),
  withCapabilityId: z.string().nullable(),
  resolutionMode: z.enum(['acknowledge', 'choose_primary']),
  title: z.string(),
  rationale: z.string(),
  resolution: z.string(),
}).strict()

const CapabilityConflictReportDtoSchema = z.object({
  protocolVersion: z.literal('tapcanvas.capability-conflict-report/v1'),
  targetCapabilityId: z.string(),
  checkedAt: z.string(),
  descriptorSha256: z.string(),
  semanticAnalysis: z.discriminatedUnion('status', [
    z.object({ status: z.literal('succeeded') }).strict(),
    z.object({
      status: z.literal('unavailable'),
      errorCode: z.string(),
      message: z.string(),
    }).strict(),
  ]).default({ status: 'succeeded' }),
  conflicts: z.array(CapabilityConflictDtoSchema),
  blocking: z.boolean(),
  requiresConfirmation: z.boolean(),
}).strict()

const AgentCapabilityAttachmentDtoSchema = z.object({
  id: z.string(),
  kind: z.literal('workflow'),
  sourceId: z.string(),
  sourceVersionId: z.string(),
  descriptorSha256: z.string(),
  descriptor: WorkflowCapabilityDescriptorDtoSchema,
  conflictReport: CapabilityConflictReportDtoSchema,
  routeDecisions: z.array(z.object({
    conflictId: z.string(),
    withCapabilityId: z.string().nullable(),
    action: z.enum(['acknowledge', 'replace_existing']),
  }).strict()),
  routingReady: z.boolean(),
  scope: z.enum(['current_user', 'all_users']).default('current_user'),
  userEnabled: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()

const CapabilityBayCandidateDtoSchema = z.object({
  descriptor: WorkflowCapabilityDescriptorDtoSchema,
  descriptorSha256: z.string(),
  projectName: z.string().nullable(),
  attached: z.boolean(),
  attachedVersionId: z.string().nullable(),
  stale: z.boolean(),
}).strict()

const CapabilityBayDtoSchema = z.object({
  productName: z.literal('Agent 配置'),
  candidates: z.array(CapabilityBayCandidateDtoSchema),
  attachments: z.array(AgentCapabilityAttachmentDtoSchema),
  skills: z.array(z.object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    logoUrl: z.string().nullable(),
    category: z.string(),
    enabled: z.boolean(),
    disabledReason: z.enum(['user', 'replaced']).nullable(),
    replacedByCapabilityId: z.string().nullable(),
  }).strict()),
  builtInCapabilities: z.array(z.object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    description: z.string(),
    requiredTools: z.array(z.string()),
    sideEffects: z.array(z.enum(['none', 'external_mutation', 'paid_generation'])),
    enabled: z.boolean(),
    systemEnabled: z.boolean(),
    userEnabled: z.boolean(),
    disabledReason: z.enum(['system', 'user', 'replaced']).nullable(),
    replacedByCapabilityId: z.string().nullable(),
    replaceable: z.boolean(),
  }).strict()),
  currentProject: z.object({
    id: z.string(),
    name: z.string(),
    projectKind: z.enum(['creative', 'ai_workflow']),
    flowCount: z.number().int().nonnegative(),
    updatedAt: z.string(),
  }).strict().nullable(),
  workflowProjects: z.array(z.object({
    id: z.string(),
    name: z.string(),
    projectKind: z.literal('ai_workflow'),
    flowCount: z.number().int().nonnegative(),
    updatedAt: z.string(),
    canDelete: z.boolean(),
  }).strict()),
  invocations: z.array(z.object({
    id: z.string(),
    attachmentId: z.string(),
    capabilityId: z.string(),
    capabilityName: z.string(),
    sourceId: z.string(),
    sourceVersionId: z.string(),
    descriptorSha256: z.string(),
    workflowExecutionId: z.string(),
    executionStatus: z.enum(['queued', 'running', 'success', 'failed', 'canceled']),
    executionErrorMessage: z.string().nullable(),
    agentExecutionId: z.string().nullable(),
    sessionId: z.string().nullable(),
    toolCallId: z.string().nullable(),
    input: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
  }).strict()),
}).strict()

const CapabilityInspectionDtoSchema = z.object({
  descriptor: WorkflowCapabilityDescriptorDtoSchema,
  descriptorSha256: z.string(),
  report: CapabilityConflictReportDtoSchema,
  inspectionToken: z.string(),
}).strict()

export type WorkflowCapabilityDescriptorDto = z.infer<typeof WorkflowCapabilityDescriptorDtoSchema>
export type CapabilityConflictDto = z.infer<typeof CapabilityConflictDtoSchema>
export type CapabilityConflictReportDto = z.infer<typeof CapabilityConflictReportDtoSchema>
export type AgentCapabilityAttachmentDto = z.infer<typeof AgentCapabilityAttachmentDtoSchema>
export type CapabilityBayCandidateDto = z.infer<typeof CapabilityBayCandidateDtoSchema>
export type CapabilityBayDto = z.infer<typeof CapabilityBayDtoSchema>
export type CapabilityInvocationDto = CapabilityBayDto['invocations'][number]
export type CapabilityInspectionDto = z.infer<typeof CapabilityInspectionDtoSchema>

const CAPABILITY_BAY_LOAD_TIMEOUT_MS = 15_000

const WorkflowCapabilityDescriptionResponseDtoSchema = z.object({
  description: z.string().trim().min(1).max(1_000),
}).strict()

export async function generateWorkflowCapabilityDescription(input: {
  model: string
  workflow: {
    name: string
    nodeCount: number
    edgeCount: number
    invocation: {
      sourceMode: 'inline_text' | 'canvas_group' | 'project_context' | 'none'
      requiredTriggerPayloadFields: string[]
    }
    stages: Array<{
      label: string
      description: string
      operation: string
      executorRef: string
      outputArtifactType: string
    }>
  }
}): Promise<{ description: string }> {
  const response = await apiFetch(`${API_BASE}/agents/capability-bay/descriptions/generate`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
  if (!response.ok) await throwApiError(response, `智能生成工作流能力说明失败: ${response.status}`)
  return WorkflowCapabilityDescriptionResponseDtoSchema.parse(await response.json())
}

export async function getCapabilityBay(projectId?: string): Promise<CapabilityBayDto> {
	const normalizedProjectId = projectId?.trim() ?? ''
	const query = new URLSearchParams()
	if (normalizedProjectId) query.set('projectId', normalizedProjectId)
	const suffix = query.size > 0 ? `?${query.toString()}` : ''
	let response: Response
	try {
		response = await apiFetch(`${API_BASE}/agents/capability-bay${suffix}`, withAuth({
			signal: AbortSignal.timeout(CAPABILITY_BAY_LOAD_TIMEOUT_MS),
		}))
	} catch (error: unknown) {
		if (error instanceof DOMException && error.name === 'TimeoutError') {
			throw new Error('加载 Agent 配置超时（15 秒），请重试；服务端不会继续无期限占用页面')
		}
		throw error
	}
  if (!response.ok) await throwApiError(response, `加载 Agent 配置失败: ${response.status}`)
  return CapabilityBayDtoSchema.parse(await response.json())
}

export async function createAiWorkflowProject(name: string): Promise<{
  projectId: string
  flowId: string
  projectName: string
  flowName: string
}> {
  const response = await apiFetch(`${API_BASE}/agents/capability-bay/projects`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }))
  if (!response.ok) await throwApiError(response, `创建 AI 编排工作流失败: ${response.status}`)
  return await response.json() as {
    projectId: string
    flowId: string
    projectName: string
    flowName: string
  }
}

export async function adoptAiWorkflowProject(projectId: string): Promise<{
  projectId: string
  projectName: string
  projectKind: 'ai_workflow'
  flowCount: number
  eligibleFlowCount: number
  changed: boolean
  updatedAt: string
}> {
  const response = await apiFetch(`${API_BASE}/agents/capability-bay/projects/${encodeURIComponent(projectId)}`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectKind: 'ai_workflow' }),
  }))
  if (!response.ok) await throwApiError(response, `纳入工作流项目失败: ${response.status}`)
  return await response.json() as {
    projectId: string
    projectName: string
    projectKind: 'ai_workflow'
    flowCount: number
    eligibleFlowCount: number
    changed: boolean
    updatedAt: string
  }
}

export async function inspectWorkflowCapability(flowId: string): Promise<CapabilityInspectionDto> {
  const response = await apiFetch(`${API_BASE}/agents/capability-bay/inspect`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowId }),
  }))
  if (!response.ok) await throwApiError(response, `检查能力冲突失败: ${response.status}`)
  return CapabilityInspectionDtoSchema.parse(await response.json())
}

export async function equipWorkflowCapability(input: {
  flowId: string
  sourceVersionId: string
  descriptorSha256: string
  inspectionToken: string
  resolutions: Array<{
    conflictId: string
    withCapabilityId: string | null
    action: 'acknowledge' | 'replace_existing'
  }>
  scope?: 'current_user' | 'all_users'
}): Promise<AgentCapabilityAttachmentDto> {
  const response = await apiFetch(`${API_BASE}/agents/capability-bay/workflows/${encodeURIComponent(input.flowId)}`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceVersionId: input.sourceVersionId,
      descriptorSha256: input.descriptorSha256,
      inspectionToken: input.inspectionToken,
      resolutions: input.resolutions,
      ...(input.scope === undefined ? {} : { scope: input.scope }),
    }),
  }))
  if (!response.ok) await throwApiError(response, `添加工作流失败: ${response.status}`)
  return AgentCapabilityAttachmentDtoSchema.parse(await response.json())
}

export async function unequipWorkflowCapability(flowId: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/agents/capability-bay/workflows/${encodeURIComponent(flowId)}`, withAuth({ method: 'DELETE' }))
  if (!response.ok) await throwApiError(response, `移除工作流失败: ${response.status}`)
}

export async function deleteAiWorkflowProject(projectId: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/agents/capability-bay/projects/${encodeURIComponent(projectId)}`, withAuth({ method: 'DELETE' }))
  if (!response.ok) await throwApiError(response, `删除工作流项目失败: ${response.status}`)
}

export async function updateSkillCapabilityState(skillKey: string, enabled: boolean): Promise<void> {
  const response = await apiFetch(`${API_BASE}/agents/capability-bay/skills/${encodeURIComponent(skillKey)}`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }))
  if (!response.ok) await throwApiError(response, `更新 Skill 状态失败: ${response.status}`)
}

export async function updateBuiltInCapabilityState(capabilityKey: string, enabled: boolean): Promise<void> {
  const response = await apiFetch(`${API_BASE}/agents/capability-bay/built-ins/${encodeURIComponent(capabilityKey)}`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }))
  if (!response.ok) await throwApiError(response, `更新内置能力状态失败: ${response.status}`)
}

export async function updateWorkflowCapabilityState(flowId: string, enabled: boolean): Promise<void> {
  const response = await apiFetch(`${API_BASE}/agents/capability-bay/workflows/${encodeURIComponent(flowId)}/state`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }))
  if (!response.ok) await throwApiError(response, `更新工作流状态失败: ${response.status}`)
}

const SkillMarketplaceSellerListingDtoSchema = z.object({
	asset: UserContextAssetDtoSchema,
	reviewStatus: z.enum(['pending', 'approved', 'rejected']),
	category: z.string(),
	submittedAt: z.string(),
	reviewedAt: z.string().nullable(),
}).strict()

export type SkillMarketplaceSellerListingDto = z.infer<typeof SkillMarketplaceSellerListingDtoSchema>

const UserContextAssetContentDtoSchema = UserContextAssetDtoSchema.extend({
	content: z.string(),
}).strict()

export type UserContextAssetContentDto = z.infer<typeof UserContextAssetContentDtoSchema>

export async function listUserContextAssets(): Promise<UserContextAssetDto[]> {
  const r = await apiFetch(`${API_BASE}/agents/user-context-assets`, withAuth())
  if (!r.ok) await throwApiError(r, `加载 Agent 资产失败: ${r.status}`)
  const body: unknown = await r.json()
  return z.object({ assets: z.array(UserContextAssetDtoSchema) }).strict().parse(body).assets
}

export async function uploadUserContextAsset(payload: {
  fileName: string
  content: string
	name?: string
	description?: string | null
	logoUrl: string
	overwrite?: boolean
}): Promise<UserContextAssetDto> {
  const r = await apiFetch(`${API_BASE}/agents/user-context-assets`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `上传 Agent 资产失败: ${r.status}`)
  return UserContextAssetDtoSchema.parse(await r.json())
}

export async function getUserContextAssetContent(assetId: string): Promise<UserContextAssetContentDto> {
	const r = await apiFetch(`${API_BASE}/agents/user-context-assets/${encodeURIComponent(assetId)}`, withAuth())
	if (!r.ok) await throwApiError(r, `加载 Skill 指令失败: ${r.status}`)
	return UserContextAssetContentDtoSchema.parse(await r.json())
}

export async function updateUserContextAsset(payload: {
	assetId: string
	name?: string
	description?: string | null
	logoUrl?: string
	content?: string
}): Promise<UserContextAssetDto> {
	const { assetId, ...body } = payload
	const r = await apiFetch(`${API_BASE}/agents/user-context-assets/${encodeURIComponent(assetId)}`, withAuth({
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	}))
	if (!r.ok) await throwApiError(r, `更新 Skill 失败: ${r.status}`)
	return UserContextAssetDtoSchema.parse(await r.json())
}

export async function deleteUserContextAsset(assetId: string): Promise<void> {
	const r = await apiFetch(`${API_BASE}/agents/user-context-assets/${encodeURIComponent(assetId)}`, withAuth({ method: 'DELETE' }))
	if (!r.ok) await throwApiError(r, `卸载 Skill 失败: ${r.status}`)
	z.object({ deleted: z.literal(true) }).strict().parse(await r.json())
}

export async function listUserContextAssetOnMarketplace(payload: {
		assetId: string
		priceCredits: number
		category: string
}): Promise<UserContextAssetDto> {
  const r = await apiFetch(`${API_BASE}/agents/user-context-assets/${encodeURIComponent(payload.assetId)}/marketplace-listing`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ priceCredits: payload.priceCredits, category: payload.category }),
  }))
  if (!r.ok) await throwApiError(r, `Skill 上架失败: ${r.status}`)
  return UserContextAssetDtoSchema.parse(await r.json())
}

export async function unlistUserContextAssetFromMarketplace(assetId: string): Promise<UserContextAssetDto> {
	const r = await apiFetch(`${API_BASE}/agents/user-context-assets/${encodeURIComponent(assetId)}/marketplace-listing`, withAuth({
		method: 'DELETE',
	}))
	if (!r.ok) await throwApiError(r, `Skill 下架失败: ${r.status}`)
	return UserContextAssetDtoSchema.parse(await r.json())
}

export async function getAgentSkill(): Promise<AgentSkillDto | null> {
  const r = await apiFetch(`${API_BASE}/agents/skill`, withAuth())
  if (!r.ok) throw new Error(`get agent skill failed: ${r.status}`)
  const body: unknown = await r.json()
  return z.object({ skill: AgentSkillDtoSchema.nullable() }).strict().parse(body).skill
}

export async function listPublicAgentSkills(): Promise<AgentSkillDto[]> {
  const r = await apiFetch(`${API_BASE}/agents/skills`, withAuth())
  if (!r.ok) throw new Error(`list public agent skills failed: ${r.status}`)
  return z.array(AgentSkillDtoSchema).parse(await r.json())
}

export async function getSkillMarketplace(): Promise<SkillMarketplaceResponseDto> {
  const r = await apiFetch(`${API_BASE}/agents/skills/marketplace`, withAuth())
  if (!r.ok) await throwApiError(r, `加载 Skill 商城榜单失败: ${r.status}`)
  return SkillMarketplaceResponseDtoSchema.parse(await r.json())
}

const SkillFavoritesResponseDtoSchema = z.object({
	skillKeys: z.array(z.string().trim().min(1).max(240)),
}).strict()

const SkillFavoriteMutationResponseDtoSchema = z.object({
	skillKey: z.string().trim().min(1).max(240),
	favorited: z.boolean(),
}).strict()

export async function listSkillFavorites(): Promise<string[]> {
	const response = await apiFetch(`${API_BASE}/agents/skills/favorites`, withAuth())
	if (!response.ok) await throwApiError(response, `加载 Skill 收藏失败: ${response.status}`)
	return SkillFavoritesResponseDtoSchema.parse(await response.json()).skillKeys
}

export async function setSkillFavorite(skillKey: string, favorited: boolean): Promise<void> {
	const response = await apiFetch(
		`${API_BASE}/agents/skills/${encodeURIComponent(skillKey)}/favorite`,
		withAuth({ method: favorited ? 'POST' : 'DELETE' }),
	)
	if (!response.ok) await throwApiError(response, `${favorited ? '收藏' : '取消收藏'} Skill 失败: ${response.status}`)
	const result = SkillFavoriteMutationResponseDtoSchema.parse(await response.json())
	if (result.skillKey !== skillKey || result.favorited !== favorited) {
		throw new Error('Skill 收藏响应与请求不一致')
	}
}

const SkillMarketplaceListingEligibilitySchema = z.object({
	membership: z.object({
		current: z.unknown().nullable(),
	}).passthrough(),
	guestRestricted: z.boolean(),
}).passthrough()

export async function getSkillMarketplaceListingEligibility(): Promise<boolean> {
	const r = await apiFetch(`${API_BASE}/account/overview`, withAuth())
	if (!r.ok) await throwApiError(r, `加载 Skill 上架资格失败: ${r.status}`)
	const overview = SkillMarketplaceListingEligibilitySchema.parse(await r.json())
	return !overview.guestRestricted && overview.membership.current !== null
}

const PurchaseMarketplaceSkillResponseDtoSchema = z.object({
	status: z.enum(['purchased', 'already_owned']),
	listingPriceCredits: z.number().int().positive(),
	chargedCredits: z.number().int().nonnegative(),
	creditBalance: z.number().int().nonnegative(),
	installedAsset: UserContextAssetDtoSchema,
}).strict()

const SkillMarketplaceSellerDashboardDtoSchema = z.object({
	listedCount: z.number().int().nonnegative(),
	soldCount: z.number().int().nonnegative(),
	totalIncomeCredits: z.number().int().nonnegative(),
	recentSales: z.array(z.object({
		id: z.string(),
		skillName: z.string(),
		priceCredits: z.number().int().positive(),
		createdAt: z.string(),
	}).strict()),
}).strict()

export type PurchaseMarketplaceSkillResponseDto = z.infer<typeof PurchaseMarketplaceSkillResponseDtoSchema>
export type SkillMarketplaceSellerDashboardDto = z.infer<typeof SkillMarketplaceSellerDashboardDtoSchema>

export async function purchaseMarketplaceSkill(productId: string): Promise<PurchaseMarketplaceSkillResponseDto> {
	const r = await apiFetch(`${API_BASE}/agents/skills/marketplace/${encodeURIComponent(productId)}/purchase`, withAuth({
		method: 'POST',
	}))
	if (!r.ok) await throwApiError(r, `购买 Skill 失败: ${r.status}`)
	return PurchaseMarketplaceSkillResponseDtoSchema.parse(await r.json())
}

export async function getSkillMarketplaceSellerDashboard(): Promise<SkillMarketplaceSellerDashboardDto> {
	const r = await apiFetch(`${API_BASE}/agents/skills/marketplace/seller-dashboard`, withAuth())
	if (!r.ok) await throwApiError(r, `加载 Skill 积分收入失败: ${r.status}`)
	return SkillMarketplaceSellerDashboardDtoSchema.parse(await r.json())
}

export async function getSkillMarketplaceSellerListings(): Promise<SkillMarketplaceSellerListingDto[]> {
	const r = await apiFetch(`${API_BASE}/agents/skills/marketplace/seller-listings`, withAuth())
	if (!r.ok) await throwApiError(r, `加载 Skill 上架记录失败: ${r.status}`)
	const body: unknown = await r.json()
	return z.object({ items: z.array(SkillMarketplaceSellerListingDtoSchema) }).strict().parse(body).items
}

export async function getAdminSkillMarketplace(): Promise<SkillMarketplaceResponseDto> {
  const r = await apiFetch(`${API_BASE}/stats/rankings/skills`, withAuth())
  if (!r.ok) await throwApiError(r, `加载 Skill 榜单配置失败: ${r.status}`)
  return await r.json() as SkillMarketplaceResponseDto
}

export async function saveAdminSkillRanking(config: SkillRankingConfigDto): Promise<SkillMarketplaceResponseDto> {
  const r = await apiFetch(`${API_BASE}/stats/rankings/skills`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }))
  if (!r.ok) await throwApiError(r, `保存 Skill 榜单配置失败: ${r.status}`)
  return await r.json() as SkillMarketplaceResponseDto
}

export async function getAdminHomepageVideoRanking(): Promise<{ configured: boolean; config: HomepageVideoRankingConfigDto }> {
  const r = await apiFetch(`${API_BASE}/stats/rankings/homepage-videos`, withAuth())
  if (!r.ok) await throwApiError(r, `加载首页推荐配置失败: ${r.status}`)
  return await r.json() as { configured: boolean; config: HomepageVideoRankingConfigDto }
}

export async function saveAdminHomepageVideoRanking(config: HomepageVideoRankingConfigDto): Promise<{ configured: boolean; config: HomepageVideoRankingConfigDto }> {
  const r = await apiFetch(`${API_BASE}/stats/rankings/homepage-videos`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }))
  if (!r.ok) await throwApiError(r, `保存首页推荐配置失败: ${r.status}`)
  return await r.json() as { configured: boolean; config: HomepageVideoRankingConfigDto }
}

export async function getAdminHomepageVideoModeration(): Promise<{ configured: boolean; config: HomepageVideoModerationConfigDto }> {
  const r = await apiFetch(`${API_BASE}/stats/rankings/homepage-video-moderation`, withAuth())
  if (!r.ok) await throwApiError(r, `加载首页作品拉黑配置失败: ${r.status}`)
  return await r.json() as { configured: boolean; config: HomepageVideoModerationConfigDto }
}

export async function saveAdminHomepageVideoModeration(config: HomepageVideoModerationConfigDto): Promise<{ configured: boolean; config: HomepageVideoModerationConfigDto }> {
  const r = await apiFetch(`${API_BASE}/stats/rankings/homepage-video-moderation`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }))
  if (!r.ok) await throwApiError(r, `保存首页作品拉黑配置失败: ${r.status}`)
  return await r.json() as { configured: boolean; config: HomepageVideoModerationConfigDto }
}

export async function listAdminAgentSkills(): Promise<AdminAgentSkillDto[]> {
  const r = await apiFetch(`${API_BASE}/admin/agents/skills`, withAuth())
  if (!r.ok) await throwApiError(r, `加载官方 Agent Skills 失败: ${r.status}`)
  const body: unknown = await r.json()
  return z.array(AdminAgentSkillDtoSchema).parse(body)
}

export async function upsertAdminAgentSkill(payload: AdminAgentSkillUpsertInput): Promise<AdminAgentSkillDto> {
  const r = await apiFetch(`${API_BASE}/admin/agents/skills`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `保存官方 Agent Skill 失败: ${r.status}`)
  const body: unknown = await r.json()
  return AdminAgentSkillDtoSchema.parse(body)
}

export async function deleteAdminAgentSkill(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/admin/agents/skills/${encodeURIComponent(id)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) await throwApiError(r, `删除官方 Agent Skill 失败: ${r.status}`)
}

export async function listAdminBuiltInCapabilities(): Promise<AdminBuiltInCapabilityDto[]> {
  const response = await apiFetch(`${API_BASE}/admin/agents/built-ins`, withAuth())
  if (!response.ok) await throwApiError(response, `加载系统内置能力失败: ${response.status}`)
  const body: unknown = await response.json()
  return z.array(AdminBuiltInCapabilityDtoSchema).parse(body)
}

export async function updateAdminBuiltInCapabilityState(
  capabilityKey: string,
  enabled: boolean,
): Promise<AdminBuiltInCapabilityDto> {
  const response = await apiFetch(`${API_BASE}/admin/agents/built-ins/${encodeURIComponent(capabilityKey)}`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }))
  if (!response.ok) await throwApiError(response, `更新系统内置能力失败: ${response.status}`)
  const body: unknown = await response.json()
  return AdminBuiltInCapabilityDtoSchema.parse(body)
}

export async function listAdminKnowledge(
  input: AdminKnowledgeListQuery = {},
): Promise<AdminKnowledgeListResponseDto> {
  const query = new URLSearchParams()
  if (input.collection) query.set('collection', input.collection)
  if (input.page !== undefined) query.set('page', String(input.page))
  if (input.pageSize !== undefined) query.set('pageSize', String(input.pageSize))
  if (input.query) query.set('query', input.query)
  if (input.domain) query.set('domain', input.domain)
  if (input.facet) query.set('facet', input.facet)
  if (input.roleScope) query.set('roleScope', input.roleScope)
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  const r = await apiFetch(`${API_BASE}/admin/knowledge${suffix}`, withAuth())
  if (!r.ok) await throwApiError(r, `加载知识库失败: ${r.status}`)
  const body: unknown = await r.json()
  return AdminKnowledgeListResponseSchema.parse(body)
}

export async function listAllAdminKnowledgeCards(
  input: Omit<AdminKnowledgeListQuery, 'page' | 'pageSize'> = {},
): Promise<AdminKnowledgeCardDto[]> {
  const pageSize = 100
  const cards: AdminKnowledgeCardDto[] = []
  let page = 1
  while (true) {
    const result = await listAdminKnowledge({ ...input, page, pageSize })
    cards.push(...result.cards)
    if (page >= result.pagination.totalPages) return cards
    page += 1
  }
}

export async function getAdminKnowledgeCard(cardId: string): Promise<AdminKnowledgeCardDto> {
  const normalizedCardId = cardId.trim()
  if (!normalizedCardId) throw new Error('知识卡 ID 不能为空')
  const r = await apiFetch(`${API_BASE}/admin/knowledge/${encodeURIComponent(normalizedCardId)}`, withAuth())
  if (!r.ok) await throwApiError(r, `加载知识卡失败: ${r.status}`)
  const body: unknown = await r.json()
  return AdminKnowledgeCardDtoSchema.parse(body)
}

export async function upsertAdminKnowledge(payload: AdminKnowledgeCardUpsertInput): Promise<AdminKnowledgeUpsertResponseDto> {
  const r = await apiFetch(`${API_BASE}/admin/knowledge`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `保存知识卡失败: ${r.status}`)
  const body: unknown = await r.json()
  return AdminKnowledgeUpsertResponseSchema.parse(body)
}

export async function syncAdminKnowledge(): Promise<AdminKnowledgeSyncSummaryDto> {
  const r = await apiFetch(`${API_BASE}/admin/knowledge/sync`, withAuth({ method: 'POST' }))
  if (!r.ok) await throwApiError(r, `同步知识库失败: ${r.status}`)
  const body: unknown = await r.json()
  return AdminKnowledgeSyncSummarySchema.parse(body)
}

export type AgentDiagnosticsTraceDto = {
  id: string
  scopeType: string
  scopeId: string
  taskId: string | null
  requestKind: string
  inputSummary: string
  decisionLog: string[]
  toolCalls: Array<Record<string, unknown>>
  meta: Record<string, unknown> | null
  resultSummary: string | null
  errorCode: string | null
  errorDetail: string | null
  createdAt: string
  status: string
  sessionKey: string | null
  workflowKey: string | null
  logicalTaskId: string | null
  rootTraceId: string | null
  parentTraceId: string | null
  physicalRunId: string | null
  workflowRunId: string | null
  startedAt: string
  updatedAt: string
  finishedAt: string | null
  nextEventSeq: number
}

export type AgentExecutionEventDto = {
  id: string
  traceId: string
  seq: number
  producerEventId: string
  eventType: string
  eventClass: string
  eventKey: string
  phase: string | null
  status: string | null
  logicalTaskId: string | null
  rootTraceId: string | null
  parentTraceId: string | null
  physicalRunId: string | null
  workflowRunId: string | null
  workflowNodeId: string | null
  agentId: string | null
  parentAgentId: string | null
  toolCallId: string | null
  effectId: string | null
  providerTaskId: string | null
  spanId: string | null
  parentSpanId: string | null
  attempt: number | null
  payload: Record<string, unknown>
  payloadSizeBytes: number
  payloadTruncated: boolean
  createdAt: string
}

export type AgentExecutionEventPageDto = {
  events: AgentExecutionEventDto[]
  nextAfterSeq: number | null
  latestSeq: number
  traceStatus: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'waiting_async'
  serverObservedAt: string
  hasMore: boolean
  integrity: {
    status: 'consistent' | 'incomplete' | 'inconsistent'
    requestAcceptedCount: number
    terminalEventCount: number
    persistedEventCount: number
    latestPersistedSeq: number
    issues: Array<{
      code: string
      severity: 'warning' | 'error'
      detail: string
    }>
  }
}

export type AgentDiagnosticsPublicChatRunDto = {
  id: string
  sessionId: string
  sessionKey: string
  requestId: string | null
  projectId: string | null
  bookId: string | null
  chapterId: string | null
  label: string | null
  workflowKey: string
  requestKind: string
  userMessageId: string | null
  assistantMessageId: string | null
  outputMode: string
  turnVerdict: 'satisfied' | 'partial' | 'failed'
  turnVerdictReasons: string[]
  runOutcome: 'promote' | 'hold' | 'discard'
  agentDecision: Record<string, unknown> | null
  toolStatusSummary: Record<string, unknown> | null
  diagnosticFlags: Array<Record<string, unknown>>
  canvasPlan: Record<string, unknown> | null
  assetCount: number
  canvasWrite: boolean
  runMs: number | null
  createdAt: string
}

export type AgentDiagnosticsResponseDto = {
  projectId: string | null
  bookId: string | null
  chapterId: string | null
  flowId: string | null
  nodeId: string | null
  label: string | null
  traces: AgentDiagnosticsTraceDto[]
  executionHealth: AgentExecutionHealthDto
  publicChatRuns: AgentDiagnosticsPublicChatRunDto[]
  storyboardDiagnostics: Array<Record<string, unknown>>
  spans: AgentTraceSpanV1[]
  metrics: AgentDiagnosticsMetricsV1
  evaluations: AgentEvaluationResultV1[]
  humanFeedback: AgentHumanFeedbackV1[]
  annotationQueue: AgentAnnotationQueueItemV1[]
  regressionExamples: AgentRegressionExampleV1[]
  nextCursor: string | null
}

export type AgentExecutionHealthDto = {
  status: 'healthy' | 'degraded'
  staleAfterSeconds: number
  totalTraceCount: number
  runningTraceCount: number
  waitingAsyncTraceCount: number
  staleRunningTraceCount: number
  sequenceMismatchCount: number
  terminalIntegrityIssueCount: number
  orphanParentTraceCount: number
  persistenceDegradedTraceCount: number
  totalEventCount: number
  totalPayloadBytes: number
  oldestActiveStartedAt: string | null
  calculatedAt: string
}

export type ProductionWorkflowNodeEventDto = {
  protocolVersion: '1'
  workflowRunId: string
  workflowNodeId: string
  eventId: string
  seq: number
  kind: 'agent_turn' | 'tool_call' | 'effect' | 'artifact' | 'diagnostic' | 'status'
  occurredAt: string
  payloadRef: string | null
  artifactIds: string[]
  effectIds: string[]
}

export type ProductionWorkflowNodeEventPageDto = {
  workflowRunId: string
  workflowNodeId: string
  events: ProductionWorkflowNodeEventDto[]
  nextBeforeSeq: number | null
}

export async function fetchAdminProductionWorkflowNodeEvents(input: {
  workflowRunId: string
  workflowNodeId: string
  beforeSeq?: number | null
  limit?: number
}): Promise<ProductionWorkflowNodeEventPageDto> {
  const qs = new URLSearchParams()
  if (typeof input.beforeSeq === 'number') qs.set('beforeSeq', String(input.beforeSeq))
  if (typeof input.limit === 'number') qs.set('limit', String(input.limit))
  const path = `/admin/agents/diagnostics/workflows/${encodeURIComponent(input.workflowRunId)}/nodes/${encodeURIComponent(input.workflowNodeId)}/events`
  const response = await apiFetch(`${API_BASE}${path}${qs.toString() ? `?${qs.toString()}` : ''}`, withAuth())
  if (!response.ok) await throwApiError(response, `读取生产工作流节点事件失败: ${response.status}`)
  return await response.json() as ProductionWorkflowNodeEventPageDto
}

export async function fetchAdminVideoAtomicNodeRunHistory(input: {
  workflowRunId: string
  atomicNodeId: string
}): Promise<WorkflowNodeRunHistoryDto[]> {
  const path = `/admin/agents/diagnostics/video-runs/${encodeURIComponent(input.workflowRunId)}/atomic-nodes/${encodeURIComponent(input.atomicNodeId)}/history`
  const response = await apiFetch(`${API_BASE}${path}`, withAuth())
  if (!response.ok) await throwApiError(response, `读取一键成片原子节点历史失败: ${response.status}`)
  return await response.json() as WorkflowNodeRunHistoryDto[]
}

export async function fetchAdminExecutionEvents(input: {
  traceId: string
  afterSeq?: number | null
  beforeSeq?: number | null
  limit?: number
}): Promise<AgentExecutionEventPageDto> {
  const qs = new URLSearchParams()
  if (typeof input.afterSeq === 'number') qs.set('afterSeq', String(input.afterSeq))
  if (typeof input.beforeSeq === 'number') qs.set('beforeSeq', String(input.beforeSeq))
  if (typeof input.limit === 'number') qs.set('limit', String(input.limit))
  const path = `/admin/agents/diagnostics/executions/${encodeURIComponent(input.traceId)}/events`
  const response = await apiFetch(`${API_BASE}${path}${qs.toString() ? `?${qs.toString()}` : ''}`, withAuth())
  if (!response.ok) await throwApiError(response, `读取 AI 执行事件失败: ${response.status}`)
  return await response.json() as AgentExecutionEventPageDto
}

export async function fetchAdminExecutionDiagnosticBundle(traceId: string): Promise<Blob> {
  const path = `/admin/agents/diagnostics/executions/${encodeURIComponent(traceId)}/export`
  const response = await apiFetch(`${API_BASE}${path}`, withAuth())
  if (!response.ok) await throwApiError(response, `导出执行诊断包失败: ${response.status}`)
  return response.blob()
}

export type AgentDiagnosticsQuery = {
  traceId?: string
  projectId?: string
  bookId?: string
  chapterId?: string
  flowId?: string
  nodeId?: string
  label?: string
  workflowKey?: string
  modelKey?: string
  status?: AgentSpanStatus
  kind?: AgentSpanKind
  from?: string
  to?: string
  cursor?: string
  turnVerdict?: 'satisfied' | 'partial' | 'failed'
  runOutcome?: 'promote' | 'hold' | 'discard'
  limit?: number
}

function buildAgentDiagnosticsQuery(params?: AgentDiagnosticsQuery): string {
  const qs = new URLSearchParams()
  if (params?.traceId) qs.set('traceId', params.traceId)
  if (params?.projectId) qs.set('projectId', params.projectId)
  if (params?.bookId) qs.set('bookId', params.bookId)
  if (params?.chapterId) qs.set('chapterId', params.chapterId)
  if (params?.flowId) qs.set('flowId', params.flowId)
  if (params?.nodeId) qs.set('nodeId', params.nodeId)
  if (params?.label) qs.set('label', params.label)
  if (params?.workflowKey) qs.set('workflowKey', params.workflowKey)
  if (params?.modelKey) qs.set('modelKey', params.modelKey)
  if (params?.status) qs.set('status', params.status)
  if (params?.kind) qs.set('kind', params.kind)
  if (params?.from) qs.set('from', params.from)
  if (params?.to) qs.set('to', params.to)
  if (params?.cursor) qs.set('cursor', params.cursor)
  if (params?.turnVerdict) qs.set('turnVerdict', params.turnVerdict)
  if (params?.runOutcome) qs.set('runOutcome', params.runOutcome)
  if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) qs.set('limit', String(params.limit))
  return qs.toString()
}

async function requestAgentDiagnostics(
  path: '/agents/diagnostics' | '/admin/agents/diagnostics',
  params?: AgentDiagnosticsQuery,
): Promise<AgentDiagnosticsResponseDto> {
  const query = buildAgentDiagnosticsQuery(params)
  const url = `${API_BASE}${path}${query ? `?${query}` : ''}`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`读取 AI 执行诊断失败: ${r.status}`)
  return r.json()
}

/** 当前登录用户自己的生产诊断；画布执行台只能使用这一 owner-scoped 入口。 */
export async function fetchAgentDiagnostics(params?: AgentDiagnosticsQuery): Promise<AgentDiagnosticsResponseDto> {
  return requestAgentDiagnostics('/agents/diagnostics', params)
}

/** 跨用户全局诊断，仅供管理员质量页面使用。 */
export async function fetchAdminAgentDiagnostics(params?: AgentDiagnosticsQuery): Promise<AgentDiagnosticsResponseDto> {
  return requestAgentDiagnostics('/admin/agents/diagnostics', params)
}

export async function submitAdminAgentDiagnosticsFeedback(payload: {
  traceId: string
  spanId?: string | null
  threadId?: string | null
  feedbackKey: string
  value: AgentHumanFeedbackV1['value']
  comment?: string | null
}): Promise<AgentHumanFeedbackV1> {
  const r = await apiFetch(`${API_BASE}/admin/agents/diagnostics/feedback`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `保存 AI 诊断反馈失败: ${r.status}`)
  return await r.json() as AgentHumanFeedbackV1
}

export async function captureAdminAgentRegressionExample(payload: {
  traceId: string
  datasetKey: string
}): Promise<AgentRegressionExampleV1> {
  const r = await apiFetch(`${API_BASE}/admin/agents/diagnostics/regression-examples`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `加入 AI 回归数据集失败: ${r.status}`)
  return await r.json() as AgentRegressionExampleV1
}
export type ProjectWorkspaceContextFileVersionDto = {
  versionId: string
  fileName: string
  layer: "global" | "project"
  updatedAt: string
  updatedBy: string
}

export type ProjectWorkspaceContextFileVersionContentDto = {
  versionId: string
  fileName: string
  layer: "global" | "project"
  updatedAt: string
  updatedBy: string
  content: string
}

export type ProjectWorkspaceContextFileDto = {
  path: string
  content: string
  layer: "global" | "project"
  updatedAt: string | null
  updatedBy: string | null
  history: ProjectWorkspaceContextFileVersionDto[]
}

export type ProjectWorkspaceContextDto = {
  projectId: string
  ownerId: string
  projectRoot: string
  globalContextDir: string
  projectContextDir: string
  currentBookId: string | null
  currentChapter: number | null
  globalFiles: ProjectWorkspaceContextFileDto[]
  projectFiles: ProjectWorkspaceContextFileDto[]
}

export type ProjectWorkspaceContextFileName =
  | 'PROJECT.md'
  | 'CREATIVE_BRIEF.md'
  | 'RULES.md'
  | 'CHARACTERS.md'
  | 'STORY_STATE.md'

export async function fetchAdminProjectWorkspaceContext(params: {
  projectId: string
  bookId?: string
  chapter?: number
  refresh?: boolean
}): Promise<ProjectWorkspaceContextDto> {
  const qs = new URLSearchParams()
  qs.set('projectId', params.projectId)
  if (params.bookId) qs.set('bookId', params.bookId)
  if (typeof params.chapter === 'number' && Number.isFinite(params.chapter)) qs.set('chapter', String(params.chapter))
  if (params.refresh === true) qs.set('refresh', 'true')
  const url = `${API_BASE}/agents/project-context?${qs.toString()}`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`fetch admin project workspace context failed: ${r.status}`)
  return r.json()
}

export async function updateProjectWorkspaceContextFile(payload: {
  projectId: string
  fileName: ProjectWorkspaceContextFileName
  content: string
}): Promise<ProjectWorkspaceContextDto> {
  const r = await apiFetch(`${API_BASE}/agents/project-context/file`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`update project workspace context file failed: ${r.status}`)
  return r.json()
}

export async function fetchProjectWorkspaceContextFileVersion(params: {
  projectId: string
  fileName: ProjectWorkspaceContextFileName
  versionId: string
}): Promise<ProjectWorkspaceContextFileVersionContentDto> {
  const qs = new URLSearchParams()
  qs.set('projectId', params.projectId)
  qs.set('fileName', params.fileName)
  qs.set('versionId', params.versionId)
  const url = `${API_BASE}/agents/project-context/version?${qs.toString()}`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`fetch project workspace context file version failed: ${r.status}`)
  return r.json()
}

export async function rollbackProjectWorkspaceContextFile(payload: {
  projectId: string
  fileName: ProjectWorkspaceContextFileName
  versionId: string
}): Promise<ProjectWorkspaceContextFileDto> {
  const r = await apiFetch(`${API_BASE}/agents/project-context/rollback`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`rollback project workspace context file failed: ${r.status}`)
  return r.json()
}

export async function updateAdminGlobalWorkspaceContextFile(payload: {
  fileName: 'GLOBAL_RULES.md'
  content: string
}): Promise<ProjectWorkspaceContextFileDto> {
  const r = await apiFetch(`${API_BASE}/admin/agents/global-context/file`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`update admin global workspace context file failed: ${r.status}`)
  return r.json()
}

export async function fetchAdminGlobalWorkspaceContextFileVersion(params: {
  fileName: 'GLOBAL_RULES.md'
  versionId: string
}): Promise<ProjectWorkspaceContextFileVersionContentDto> {
  const qs = new URLSearchParams()
  qs.set('fileName', params.fileName)
  qs.set('versionId', params.versionId)
  const url = `${API_BASE}/admin/agents/global-context/version?${qs.toString()}`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`fetch admin global workspace context file version failed: ${r.status}`)
  return r.json()
}

export async function rollbackAdminGlobalWorkspaceContextFile(payload: {
  fileName: 'GLOBAL_RULES.md'
  versionId: string
}): Promise<ProjectWorkspaceContextFileDto> {
  const r = await apiFetch(`${API_BASE}/admin/agents/global-context/rollback`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`rollback admin global workspace context file failed: ${r.status}`)
  return r.json()
}

export type ProjectWorkspaceContextVerifyFileDto = {
  layer: "global" | "project"
  path: string
  charCount: number
  truncated: boolean
  updatedAt: string | null
  updatedBy: string | null
}

export type ProjectWorkspaceContextVerifyResponseDto = {
  projectId: string
  ownerId: string
  projectRoot: string
  globalContextDir: string
  projectContextDir: string
  budgets: { maxCharsPerFile: number; maxTotalChars: number }
  totalChars: number
  files: ProjectWorkspaceContextVerifyFileDto[]
  warnings: string[]
}

export async function verifyProjectWorkspaceContext(params: { projectId: string }): Promise<ProjectWorkspaceContextVerifyResponseDto> {
  const qs = new URLSearchParams()
  qs.set('projectId', params.projectId)
  const url = `${API_BASE}/agents/project-context/verify?${qs.toString()}`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`verify project workspace context failed: ${r.status}`)
  return r.json()
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

const llmNodePresetCache = new Map<string, LlmNodePresetDto[]>()
const llmNodePresetInFlight = new Map<string, Promise<LlmNodePresetDto[]>>()

function toLlmNodePresetCacheKey(params?: { type?: LlmNodePresetType; scope?: LlmNodePresetScope; query?: string; limit?: number }): string {
  const type = typeof params?.type === 'string' ? params.type.trim() : ''
  const scope = typeof params?.scope === 'string' ? params.scope.trim() : ''
  const query = typeof params?.query === 'string' ? params.query.trim() : ''
  const limit = typeof params?.limit === 'number' && Number.isFinite(params.limit) ? Math.trunc(params.limit) : ''
  return `type=${type}|scope=${scope}|q=${query}|limit=${limit}`
}

function cloneLlmNodePresets(items: LlmNodePresetDto[]): LlmNodePresetDto[] {
  return items.map((item) => ({ ...item }))
}

function invalidateLlmNodePresetCache(): void {
  llmNodePresetCache.clear()
  llmNodePresetInFlight.clear()
}

export async function listLlmNodePresets(params?: { type?: LlmNodePresetType; scope?: LlmNodePresetScope; query?: string; limit?: number }): Promise<LlmNodePresetDto[]> {
  const cacheKey = toLlmNodePresetCacheKey(params)
  const cached = llmNodePresetCache.get(cacheKey)
  if (cached) return cloneLlmNodePresets(cached)

  const inFlight = llmNodePresetInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const qs = new URLSearchParams()
  if (params?.type) qs.set('type', params.type)
  if (params?.scope) qs.set('scope', params.scope)
  if (params?.query) qs.set('q', params.query)
  if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) {
    qs.set('limit', String(Math.trunc(params.limit)))
  }
  const query = qs.toString()
  const url = query ? `${API_BASE}/ai/node-presets?${query}` : `${API_BASE}/ai/node-presets`
  const request = (async (): Promise<LlmNodePresetDto[]> => {
    const r = await apiFetch(url, withAuth())
    if (!r.ok) await throwApiError(r, `加载节点预设失败: ${r.status}`)
    const body: unknown = await r.json()
    const items = z.array(LlmNodePresetDtoSchema).parse(body)
    llmNodePresetCache.set(cacheKey, items)
    return cloneLlmNodePresets(items)
  })()
    .finally(() => {
      llmNodePresetInFlight.delete(cacheKey)
    })
  llmNodePresetInFlight.set(cacheKey, request)
  return request
}

export async function createLlmNodePreset(payload: CreateLlmNodePresetInput): Promise<LlmNodePresetDto> {
  const r = await apiFetch(`${API_BASE}/ai/node-presets`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `创建节点预设失败: ${r.status}`)
  const body: unknown = await r.json()
  const created = LlmNodePresetDtoSchema.parse(body)
  invalidateLlmNodePresetCache()
  return created
}

export async function deleteLlmNodePreset(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/ai/node-presets/${encodeURIComponent(id)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) await throwApiError(r, `删除节点预设失败: ${r.status}`)
  invalidateLlmNodePresetCache()
}

export async function listAdminLlmNodePresets(params?: { type?: LlmNodePresetType }): Promise<AdminLlmNodePresetDto[]> {
  const qs = new URLSearchParams()
  if (params?.type) qs.set('type', params.type)
  const query = qs.toString()
  const url = query ? `${API_BASE}/admin/ai/node-presets?${query}` : `${API_BASE}/admin/ai/node-presets`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) await throwApiError(r, `加载基础节点预设失败: ${r.status}`)
  const body: unknown = await r.json()
  return z.array(AdminLlmNodePresetDtoSchema).parse(body)
}

export async function upsertAdminLlmNodePreset(payload: AdminLlmNodePresetUpsertInput): Promise<AdminLlmNodePresetDto> {
  const r = await apiFetch(`${API_BASE}/admin/ai/node-presets`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `保存基础节点预设失败: ${r.status}`)
  const body: unknown = await r.json()
  const updated = AdminLlmNodePresetDtoSchema.parse(body)
  invalidateLlmNodePresetCache()
  return updated
}

export async function deleteAdminLlmNodePreset(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/admin/ai/node-presets/${encodeURIComponent(id)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) await throwApiError(r, `删除基础节点预设失败: ${r.status}`)
  invalidateLlmNodePresetCache()
}

const StatsDtoSchema = z.object({
  onlineUsers: z.number().int().nonnegative().safe(),
  totalUsers: z.number().int().nonnegative().safe(),
  newUsersToday: z.number().int().nonnegative().safe(),
  circulatingCredits: z.number().int().nonnegative().safe(),
  consumedCredits: z.number().int().nonnegative().safe(),
}).strict()

export type StatsDto = z.infer<typeof StatsDtoSchema>

export type AdminUserDto = {
  id: string
  login: string
  name?: string | null
  avatarUrl?: string | null
  email?: string | null
  phone?: string | null
  role?: string | null
  guest: boolean
  disabled: boolean
  deletedAt?: string | null
  lastSeenAt?: string | null
  createdAt: string
  updatedAt: string
  accountId: string | null
  accountName: string | null
  credits: number | null
  creditsFrozen: number | null
  creditsAvailable: number | null
  membership: {
    subscriptionId: string
    planCode: string
    startAt: string
    endAt: string
    billingCycle: 'monthly' | 'annual'
    monthlyCredits: number
    dailyGiftCredits: number
    concurrencyLimit: number
    capacityLabel: string
    timezone: string
  } | null
}

export type AdminUserListResponseDto = {
  items: AdminUserDto[]
  total: number
  page: number
  pageSize: number
}

export const AdminCreditGrantRecordSchema = z.object({
  id: z.string(),
  subscriptionId: z.string().nullable(),
  ownerId: z.string(),
  teamId: z.string(),
  userLogin: z.string(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  planCode: z.string().nullable(),
  subscriptionStatus: z.string().nullable(),
  grantType: z.enum(['monthly', 'daily']),
  grantKey: z.string(),
  amount: z.number().int().positive(),
  grantedAt: z.string(),
  expiresAt: z.string().nullable(),
  expiredAmount: z.number().int().nonnegative(),
  processedAt: z.string().nullable(),
})
export type AdminCreditGrantRecordDto = z.infer<typeof AdminCreditGrantRecordSchema>

const AdminCreditGrantListResponseSchema = z.object({
  items: z.array(AdminCreditGrantRecordSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
})
export type AdminCreditGrantListResponseDto = z.infer<typeof AdminCreditGrantListResponseSchema>

export type AdminProjectDto = {
  id: string
  name: string
  isPublic: boolean
  ownerId: string | null
  owner: string | null
  ownerName: string | null
  cloneCount: number
  sortWeight: number
  flowCount: number
  createdAt: string
  updatedAt: string
  templateTitle: string
  templateDescription: string | null
  templateCoverUrl: string | null
}

export type DauPointDto = { day: string; activeUsers: number }
export type DauSeriesDto = { days: number; series: DauPointDto[] }
export type VendorApiCallHistoryPointDto = { status: 'succeeded' | 'failed'; finishedAt: string }
export type VendorApiCallStatDto = {
  vendor: string
  total: number
  success: number
  successRate: number
  avgDurationMs: number | null
  lastStatus: 'succeeded' | 'failed' | null
  lastAt: string | null
  lastDurationMs: number | null
  history: VendorApiCallHistoryPointDto[]
}
export type VendorApiCallStatsDto = { days: number; points: number; vendors: VendorApiCallStatDto[] }
export type PromptEvolutionRunResponseDto = {
  ok: boolean
  runId?: string
  job: 'prompt-evolution'
  sinceHours: number
  sinceIso: string
  dryRun: boolean
  guardrail: {
    minSamples: number
    hasEnoughSamples: boolean
  }
  metrics: {
    total: number
    succeeded: number
    failed: number
    successRate: number
    avgDurationMs: number
  }
  action: 'ready_for_optimizer' | 'skip'
}
export type PromptEvolutionRunHistoryDto = {
  id: string
  actorUserId: string | null
  sinceHours: number
  minSamples: number
  dryRun: boolean
  action: 'ready_for_optimizer' | 'skip'
  metrics: PromptEvolutionRunResponseDto['metrics']
  createdAt: string
}
export type PromptEvolutionRuntimeDto = {
  activeRunId: string | null
  canaryPercent: number
  status: string
  lastAction: string | null
  note: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export async function getStats(): Promise<StatsDto> {
  const r = await apiFetch(`${API_BASE}/stats`, withAuth())
  if (!r.ok) await throwApiError(r, `get stats failed: ${r.status}`)
  const body: unknown = await r.json()
  return StatsDtoSchema.parse(body)
}

function mapAdminUserDto(body: unknown): AdminUserDto {
  const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  const membershipPayload = typeof payload.membership === 'object' && payload.membership !== null
    ? payload.membership as Record<string, unknown>
    : null
  const membership: AdminUserDto['membership'] = membershipPayload
    && typeof membershipPayload.subscriptionId === 'string'
    && typeof membershipPayload.planCode === 'string'
    && typeof membershipPayload.startAt === 'string'
    && typeof membershipPayload.endAt === 'string'
    && typeof membershipPayload.timezone === 'string'
    && (membershipPayload.billingCycle === 'monthly' || membershipPayload.billingCycle === 'annual')
    && typeof membershipPayload.monthlyCredits === 'number'
    && typeof membershipPayload.dailyGiftCredits === 'number'
    && typeof membershipPayload.concurrencyLimit === 'number'
    && typeof membershipPayload.capacityLabel === 'string'
    ? {
      subscriptionId: membershipPayload.subscriptionId,
      planCode: membershipPayload.planCode,
      startAt: membershipPayload.startAt,
      endAt: membershipPayload.endAt,
      billingCycle: membershipPayload.billingCycle,
      monthlyCredits: membershipPayload.monthlyCredits,
      dailyGiftCredits: membershipPayload.dailyGiftCredits,
      concurrencyLimit: membershipPayload.concurrencyLimit,
      capacityLabel: membershipPayload.capacityLabel,
      timezone: membershipPayload.timezone,
    }
    : null
  return {
    id: String(payload.id || ''),
    login: String(payload.login || ''),
    name: typeof payload.name === 'string' ? payload.name : null,
    avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : null,
    email: typeof payload.email === 'string' ? payload.email : null,
    phone: typeof payload.phone === 'string' ? payload.phone : null,
    role: typeof payload.role === 'string' ? payload.role : null,
    guest: Boolean(payload.guest),
    disabled: Boolean(payload.disabled),
    deletedAt: typeof payload.deletedAt === 'string' ? payload.deletedAt : null,
    lastSeenAt: typeof payload.lastSeenAt === 'string' ? payload.lastSeenAt : null,
    createdAt: String(payload.createdAt ?? payload.created_at ?? ''),
    updatedAt: String(payload.updatedAt ?? payload.updated_at ?? ''),
    accountId: typeof payload.accountId === 'string' ? payload.accountId : null,
    accountName: typeof payload.accountName === 'string' ? payload.accountName : null,
    credits: typeof payload.credits === 'number' && Number.isFinite(payload.credits) ? payload.credits : null,
    creditsFrozen: typeof payload.creditsFrozen === 'number' && Number.isFinite(payload.creditsFrozen) ? payload.creditsFrozen : null,
    creditsAvailable: typeof payload.creditsAvailable === 'number' && Number.isFinite(payload.creditsAvailable) ? payload.creditsAvailable : null,
    membership,
  }
}

function mapAdminProjectDto(body: any): AdminProjectDto {
  const name = String(body?.name || '')
  const templateTitleRaw = typeof body?.templateTitle === 'string' ? body.templateTitle.trim() : ''
  const templateDescriptionRaw = typeof body?.templateDescription === 'string' ? body.templateDescription.trim() : ''
  const templateCoverUrlRaw = typeof body?.templateCoverUrl === 'string' ? body.templateCoverUrl.trim() : ''
  return {
    id: String(body?.id || ''),
    name,
    isPublic: Boolean(body?.isPublic),
    ownerId: typeof body?.ownerId === 'string' ? body.ownerId : body?.ownerId ?? null,
    owner: typeof body?.owner === 'string' ? body.owner : body?.owner ?? null,
    ownerName: typeof body?.ownerName === 'string' ? body.ownerName : body?.ownerName ?? null,
    cloneCount: Number(body?.cloneCount ?? 0) || 0,
    sortWeight: typeof body?.sortWeight === 'number' ? body.sortWeight : 0,
    flowCount: Number(body?.flowCount ?? 0) || 0,
    createdAt: String(body?.createdAt ?? body?.created_at ?? ''),
    updatedAt: String(body?.updatedAt ?? body?.updated_at ?? ''),
    templateTitle: templateTitleRaw || name,
    templateDescription: templateDescriptionRaw || null,
    templateCoverUrl: templateCoverUrlRaw || null,
  }
}

function mapAdminUserListResponseDto(body: unknown): AdminUserListResponseDto {
  const payload = typeof body === 'object' && body !== null
    ? body as {
        items?: unknown
        total?: unknown
        page?: unknown
        pageSize?: unknown
      }
    : {}
  const items = Array.isArray(payload.items) ? payload.items : []
  const total = typeof payload.total === 'number' && Number.isFinite(payload.total) ? payload.total : Number(payload.total ?? 0) || 0
  const page = typeof payload.page === 'number' && Number.isFinite(payload.page) ? payload.page : Number(payload.page ?? 1) || 1
  const pageSize = typeof payload.pageSize === 'number' && Number.isFinite(payload.pageSize) ? payload.pageSize : Number(payload.pageSize ?? 20) || 20

  return {
    items: items.map(mapAdminUserDto).filter((u) => u.id && u.login),
    total: Math.max(0, Math.trunc(total)),
    page: Math.max(1, Math.trunc(page)),
    pageSize: Math.max(1, Math.trunc(pageSize)),
  }
}

function getErrorMessageFromBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const payload = body as { message?: unknown; error?: unknown }
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  return null
}

export async function listAdminUsers(opts?: { q?: string; includeDeleted?: boolean; page?: number; pageSize?: number }): Promise<AdminUserListResponseDto> {
  const params = new URLSearchParams()
  if (opts?.q && String(opts.q).trim()) params.set('q', String(opts.q).trim())
  if (typeof opts?.page === 'number' && Number.isFinite(opts.page)) params.set('page', String(Math.floor(opts.page)))
  if (typeof opts?.pageSize === 'number' && Number.isFinite(opts.pageSize)) params.set('pageSize', String(Math.floor(opts.pageSize)))
  if (opts?.includeDeleted) params.set('includeDeleted', '1')
  const url = `${API_BASE}/admin/users${params.toString() ? `?${params.toString()}` : ''}`

  const r = await apiFetch(url, withAuth())
  let body: unknown = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = getErrorMessageFromBody(body) || `list users failed: ${r.status}`
    throw new Error(msg)
  }
  return mapAdminUserListResponseDto(body)
}

export type AdminCreditGrantQuery = {
  q?: string
  grantType?: 'monthly' | 'daily'
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export async function listAdminCreditGrants(
  options: AdminCreditGrantQuery = {},
): Promise<AdminCreditGrantListResponseDto> {
  const url = apiURL('/admin/users/credit-grants')
  if (options.q?.trim()) url.searchParams.set('q', options.q.trim())
  if (options.grantType) url.searchParams.set('grantType', options.grantType)
  if (options.from) url.searchParams.set('from', options.from)
  if (options.to) url.searchParams.set('to', options.to)
  if (options.page) url.searchParams.set('page', String(options.page))
  if (options.pageSize) url.searchParams.set('pageSize', String(options.pageSize))
  const response = await apiFetch(url, withAuth())
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(getErrorMessageFromBody(body) || `list credit grants failed: ${response.status}`)
  }
  return AdminCreditGrantListResponseSchema.parse(body)
}

export async function updateAdminUser(userId: string, patch: { role?: 'admin' | null; disabled?: boolean }): Promise<AdminUserDto> {
  const r = await apiFetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `update user failed: ${r.status}`
    throw new Error(msg)
  }
  return mapAdminUserDto(body)
}

export async function deleteAdminUser(userId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}`, withAuth({
    method: 'DELETE',
  }))
  if (!r.ok) {
    let body: any = null
    try {
      body = await r.json()
    } catch {
      body = null
    }
    const msg = (body && (body.message || body.error)) || `delete user failed: ${r.status}`
    throw new Error(msg)
  }
}

export async function adjustAdminUserCredits(userId: string, payload: { delta: number; note?: string }): Promise<AdminUserDto> {
  const r = await apiFetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}/credits`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  let body: unknown = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = getErrorMessageFromBody(body) || `adjust user credits failed: ${r.status}`
    throw new Error(msg)
  }
  return mapAdminUserDto(body)
}

export async function setAdminUserMembership(userId: string, payload: {
  productId: string | null
  skuId?: string | null
  endAt?: string | null
}): Promise<AdminUserDto> {
  const r = await apiFetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}/membership`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  const body: unknown = await r.json().catch(() => null)
  if (!r.ok) {
    throw new Error(getErrorMessageFromBody(body) || `update user membership failed: ${r.status}`)
  }
  return mapAdminUserDto(body)
}

// ============= User credits / task log (admin) =============

export type AdminUserCreditsOverviewDto = {
  userId: string
  teamId: string | null
  totals: {
    deductTotal: number
    deductMonth: number
    deductToday: number
    frozenNow: number
    countTotal: number
  }
  byTaskKind: Array<{ taskKind: string; count: number; amount: number }>
}

export type AdminLedgerEntryDto = {
  id: string
  entryType: string
  amount: number
  taskId: string | null
  taskKind: string | null
  actorUserId: string | null
  note: string | null
  createdAt: string
}

export type AdminLedgerListResponseDto = {
  items: AdminLedgerEntryDto[]
  nextCursor: { id: string; createdAt: string } | null
}

export type AdminTaskLogBundleDto = {
  taskId: string
  userId: string
  result: {
    vendor: string | null
    kind: string | null
    status: string | null
    completedAt: string | null
    updatedAt: string | null
    raw: unknown
  } | null
  credits: { reserved: number; deducted: number; released: number; pending: number }
  statuses: Array<{
    id: string
    provider: string
    status: string
    data: unknown
    createdAt: string
    completedAt: string | null
  }>
  vendorCalls: Array<{
    rowId: number | null
    vendor: string
    status: string
    startedAt: string | null
    finishedAt: string | null
    durationMs: number | null
    errorMessage: string | null
    requestJson: unknown
    responseJson: unknown
  }>
}

export async function fetchAdminUserCredits(userId: string): Promise<AdminUserCreditsOverviewDto> {
  const r = await apiFetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}/credits`, withAuth())
  let body: any = null
  try { body = await r.json() } catch { body = null }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `fetch credits failed: ${r.status}`
    throw new Error(msg)
  }
  return body as AdminUserCreditsOverviewDto
}

export async function fetchAdminUserCreditsLedger(
  userId: string,
  opts?: {
    entryTypes?: string[]
    taskIdLike?: string
    since?: string
    until?: string
    cursor?: string
    cursorAt?: string
    limit?: number
  },
): Promise<AdminLedgerListResponseDto> {
  const params = new URLSearchParams()
  if (opts?.entryTypes && opts.entryTypes.length) params.set('entryTypes', opts.entryTypes.join(','))
  if (opts?.taskIdLike && opts.taskIdLike.trim()) params.set('taskIdLike', opts.taskIdLike.trim())
  if (opts?.since && opts.since.trim()) params.set('since', opts.since.trim())
  if (opts?.until && opts.until.trim()) params.set('until', opts.until.trim())
  if (opts?.cursor && opts.cursor.trim()) params.set('cursor', opts.cursor.trim())
  if (opts?.cursorAt && opts.cursorAt.trim()) params.set('cursorAt', opts.cursorAt.trim())
  if (typeof opts?.limit === 'number' && Number.isFinite(opts.limit)) params.set('limit', String(Math.floor(opts.limit)))
  const url = `${API_BASE}/admin/users/${encodeURIComponent(userId)}/credits/ledger${params.toString() ? `?${params.toString()}` : ''}`
  const r = await apiFetch(url, withAuth())
  let body: any = null
  try { body = await r.json() } catch { body = null }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `fetch ledger failed: ${r.status}`
    throw new Error(msg)
  }
  return body as AdminLedgerListResponseDto
}

export async function fetchAdminTaskLog(userId: string, taskId: string): Promise<AdminTaskLogBundleDto> {
  const url = `${API_BASE}/admin/users/${encodeURIComponent(userId)}/tasks/${encodeURIComponent(taskId)}/log`
  const r = await apiFetch(url, withAuth())
  let body: any = null
  try { body = await r.json() } catch { body = null }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `fetch task log failed: ${r.status}`
    throw new Error(msg)
  }
  return body as AdminTaskLogBundleDto
}

export async function listAdminProjects(opts?: { q?: string; ownerId?: string; isPublic?: boolean; limit?: number }): Promise<AdminProjectDto[]> {
  const params = new URLSearchParams()
  if (opts?.q && String(opts.q).trim()) params.set('q', String(opts.q).trim())
  if (opts?.ownerId && String(opts.ownerId).trim()) params.set('ownerId', String(opts.ownerId).trim())
  if (typeof opts?.isPublic === 'boolean') params.set('isPublic', opts.isPublic ? '1' : '0')
  if (typeof opts?.limit === 'number' && Number.isFinite(opts.limit)) params.set('limit', String(Math.floor(opts.limit)))
  const url = `${API_BASE}/admin/projects${params.toString() ? `?${params.toString()}` : ''}`

  const r = await apiFetch(url, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `list projects failed: ${r.status}`
    throw new Error(msg)
  }
  const items = Array.isArray(body) ? body : []
  return items.map(mapAdminProjectDto).filter((p) => p.id && p.name)
}

export async function updateAdminProject(projectId: string, patch: {
  name?: string
  isPublic?: boolean
  templateTitle?: string
  templateDescription?: string
  templateCoverUrl?: string
  sortWeight?: number
}): Promise<AdminProjectDto> {
  const r = await apiFetch(`${API_BASE}/admin/projects/${encodeURIComponent(projectId)}`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `update project failed: ${r.status}`
    throw new Error(msg)
  }
  return mapAdminProjectDto(body)
}

export async function deleteAdminProject(projectId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/admin/projects/${encodeURIComponent(projectId)}`, withAuth({
    method: 'DELETE',
  }))
  if (!r.ok) {
    let body: any = null
    try {
      body = await r.json()
    } catch {
      body = null
    }
    const msg = (body && (body.message || body.error)) || `delete project failed: ${r.status}`
    throw new Error(msg)
  }
}

export async function pingActivity(): Promise<void> {
  try {
    await apiFetch(`${API_BASE}/stats/ping`, withAuth({ method: 'POST' }))
  } catch {
    // best-effort，忽略失败
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

export async function getVendorApiCallStats(days = 7, points = 60): Promise<VendorApiCallStatsDto> {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(365, Math.floor(days))) : 7
  const safePoints = Number.isFinite(points) ? Math.max(1, Math.min(180, Math.floor(points))) : 60
  const r = await apiFetch(`${API_BASE}/stats/vendors?days=${encodeURIComponent(String(safeDays))}&points=${encodeURIComponent(String(safePoints))}`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `get vendor stats failed: ${r.status}`
    throw new Error(msg)
  }
  const vendorsRaw = Array.isArray(body?.vendors) ? body.vendors : []
  const vendors = vendorsRaw
    .map((v: any) => {
      const historyRaw = Array.isArray(v?.history) ? v.history : []
      const history = historyRaw
        .map((h: any) => ({
          status: h?.status === 'succeeded' ? 'succeeded' : 'failed',
          finishedAt: String(h?.finishedAt || ''),
        }))
        .filter((h: any) => h.finishedAt && h.finishedAt.length >= 10)
      return {
        vendor: String(v?.vendor || ''),
        total: Number(v?.total ?? 0) || 0,
        success: Number(v?.success ?? 0) || 0,
        successRate: Number(v?.successRate ?? 0) || 0,
        avgDurationMs: typeof v?.avgDurationMs === 'number' ? v.avgDurationMs : null,
        lastStatus: v?.lastStatus === 'succeeded' ? 'succeeded' : v?.lastStatus === 'failed' ? 'failed' : null,
        lastAt: typeof v?.lastAt === 'string' ? v.lastAt : null,
        lastDurationMs: typeof v?.lastDurationMs === 'number' ? v.lastDurationMs : null,
        history,
      } satisfies VendorApiCallStatDto
    })
    .filter((v: any) => v.vendor)

  return {
    days: Number(body?.days ?? safeDays) || safeDays,
    points: Number(body?.points ?? safePoints) || safePoints,
    vendors,
  }
}

export async function runPromptEvolution(input?: {
  sinceHours?: number
  minSamples?: number
  dryRun?: boolean
}): Promise<PromptEvolutionRunResponseDto> {
  const r = await apiFetch(`${API_BASE}/stats/prompt-evolution/run`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(typeof input?.sinceHours === 'number' ? { sinceHours: Math.max(1, Math.min(24 * 30, Math.floor(input.sinceHours))) } : {}),
      ...(typeof input?.minSamples === 'number' ? { minSamples: Math.max(1, Math.min(10_000, Math.floor(input.minSamples))) } : {}),
      ...(typeof input?.dryRun === 'boolean' ? { dryRun: input.dryRun } : {}),
    }),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `run prompt evolution failed: ${r.status}`
    throw new Error(msg)
  }
  const metrics = body?.metrics || {}
  const guardrail = body?.guardrail || {}
  return {
    ok: Boolean(body?.ok),
    runId: typeof body?.runId === 'string' ? body.runId : undefined,
    job: 'prompt-evolution',
    sinceHours: Number(body?.sinceHours ?? 24) || 24,
    sinceIso: String(body?.sinceIso || ''),
    dryRun: Boolean(body?.dryRun),
    guardrail: {
      minSamples: Number(guardrail?.minSamples ?? 0) || 0,
      hasEnoughSamples: Boolean(guardrail?.hasEnoughSamples),
    },
    metrics: {
      total: Number(metrics?.total ?? 0) || 0,
      succeeded: Number(metrics?.succeeded ?? 0) || 0,
      failed: Number(metrics?.failed ?? 0) || 0,
      successRate: Number(metrics?.successRate ?? 0) || 0,
      avgDurationMs: Number(metrics?.avgDurationMs ?? 0) || 0,
    },
    action: body?.action === 'ready_for_optimizer' ? 'ready_for_optimizer' : 'skip',
  }
}

export async function listPromptEvolutionRuns(limit = 30): Promise<PromptEvolutionRunHistoryDto[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 30
  const r = await apiFetch(`${API_BASE}/stats/prompt-evolution/runs?limit=${encodeURIComponent(String(safeLimit))}`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `list prompt evolution runs failed: ${r.status}`
    throw new Error(msg)
  }
  const items = Array.isArray(body?.items) ? body.items : []
  return items
    .map((item: any) => ({
      id: String(item?.id || ''),
      actorUserId: typeof item?.actorUserId === 'string' ? item.actorUserId : null,
      sinceHours: Number(item?.sinceHours ?? 0) || 0,
      minSamples: Number(item?.minSamples ?? 0) || 0,
      dryRun: Boolean(item?.dryRun),
      action: item?.action === 'ready_for_optimizer' ? 'ready_for_optimizer' : 'skip',
      metrics: {
        total: Number(item?.metrics?.total ?? 0) || 0,
        succeeded: Number(item?.metrics?.succeeded ?? 0) || 0,
        failed: Number(item?.metrics?.failed ?? 0) || 0,
        successRate: Number(item?.metrics?.successRate ?? 0) || 0,
        avgDurationMs: Number(item?.metrics?.avgDurationMs ?? 0) || 0,
      },
      createdAt: String(item?.createdAt || ''),
    }))
    .filter((item: PromptEvolutionRunHistoryDto) => !!item.id)
}

export async function getPromptEvolutionRuntime(): Promise<PromptEvolutionRuntimeDto> {
  const r = await apiFetch(`${API_BASE}/stats/prompt-evolution/runtime`, withAuth())
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `get prompt evolution runtime failed: ${r.status}`
    throw new Error(msg)
  }
  return {
    activeRunId: typeof body?.activeRunId === 'string' ? body.activeRunId : null,
    canaryPercent: Number(body?.canaryPercent ?? 5) || 5,
    status: typeof body?.status === 'string' ? body.status : 'idle',
    lastAction: typeof body?.lastAction === 'string' ? body.lastAction : null,
    note: typeof body?.note === 'string' ? body.note : null,
    updatedAt: typeof body?.updatedAt === 'string' ? body.updatedAt : null,
    updatedBy: typeof body?.updatedBy === 'string' ? body.updatedBy : null,
  }
}

export async function publishPromptEvolutionRun(input: { runId: string; canaryPercent: number }): Promise<PromptEvolutionRuntimeDto> {
  const r = await apiFetch(`${API_BASE}/stats/prompt-evolution/publish`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: String(input.runId || '').trim(),
      canaryPercent: Math.max(1, Math.min(100, Math.floor(Number(input.canaryPercent) || 0))),
    }),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `publish prompt evolution failed: ${r.status}`
    throw new Error(msg)
  }
  return {
    activeRunId: typeof body?.activeRunId === 'string' ? body.activeRunId : null,
    canaryPercent: Number(body?.canaryPercent ?? input.canaryPercent) || input.canaryPercent,
    status: typeof body?.status === 'string' ? body.status : 'active',
    lastAction: 'publish',
    note: null,
    updatedAt: typeof body?.updatedAt === 'string' ? body.updatedAt : null,
    updatedBy: null,
  }
}

export async function rollbackPromptEvolution(input?: { toRunId?: string; reason?: string }): Promise<PromptEvolutionRuntimeDto> {
  const r = await apiFetch(`${API_BASE}/stats/prompt-evolution/rollback`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(typeof input?.toRunId === 'string' && input.toRunId.trim() ? { toRunId: input.toRunId.trim() } : {}),
      ...(typeof input?.reason === 'string' && input.reason.trim() ? { reason: input.reason.trim() } : {}),
    }),
  }))
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.message || body.error)) || `rollback prompt evolution failed: ${r.status}`
    throw new Error(msg)
  }
  return {
    activeRunId: typeof body?.activeRunId === 'string' ? body.activeRunId : null,
    canaryPercent: 0,
    status: typeof body?.status === 'string' ? body.status : 'rolled_back',
    lastAction: 'rollback',
    note: typeof input?.reason === 'string' ? input.reason : null,
    updatedAt: typeof body?.updatedAt === 'string' ? body.updatedAt : null,
    updatedBy: null,
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

function sanitizeFlowDataForPersistence(value: unknown): unknown {
  return sanitizeFlowValueForPersistence(value, { stripBinaryUrls: true })
}

export async function saveServerFlow(payload: {
  id?: string
  name: string
  ownerType?: 'project' | 'chapter' | 'shot'
  ownerId?: string | null
  nodes: Node[]
  edges: Edge[]
  viewport?: { x: number; y: number; zoom: number } | null
  sceneCreationProgress?: unknown
}): Promise<FlowSaveReceipt> {
  const data = sanitizeFlowDataForPersistence({
    nodes: payload.nodes,
    edges: payload.edges,
    viewport: payload.viewport ?? null,
    ...(typeof payload.sceneCreationProgress === 'undefined' ? null : { sceneCreationProgress: payload.sceneCreationProgress }),
  })
  const r = await apiFetch(`${API_BASE}/flows`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: payload.id, name: payload.name, data, ownerType: payload.ownerType, ownerId: payload.ownerId ?? undefined })
  }))
  if (!r.ok) throw new Error(`save flow failed: ${r.status}`)
  return r.json()
}

export async function deleteServerFlow(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/flows/${id}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete flow failed: ${r.status}`)
}

export async function exchangeGithub(code: string): Promise<AuthResponseDto> {
  const r = await apiFetch(`${API_BASE}/auth/github/exchange`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`exchange failed: ${r.status} ${text}`.trim())
  }
  return r.json()
}

export async function createGuestSession(nickname?: string): Promise<AuthResponseDto> {
  const body = nickname ? { nickname } : {}
  const r = await apiFetch(`${API_BASE}/auth/guest`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`guest login failed: ${r.status}`)
  return r.json()
}

export async function requestEmailLoginCode(email: string): Promise<{ sent: boolean; expiresInSeconds?: number }> {
  const r = await apiFetch(`${API_BASE}/auth/email/request`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  let body: any = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  if (!r.ok) {
    const msg = (body && (body.error || body.message)) || `email request failed: ${r.status}`
    throw new Error(msg)
  }
  return {
    sent: Boolean(body?.sent),
    expiresInSeconds: typeof body?.expiresInSeconds === 'number' ? body.expiresInSeconds : undefined,
  }
}

export async function verifyEmailLogin(email: string, code: string): Promise<AuthResponseDto> {
  const r = await apiFetch(`${API_BASE}/auth/email/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  })
  const body = await parseAuthErrorBody(r)
  if (!r.ok) {
    const msg = (body && (body.error || body.message)) || `email login failed: ${r.status}`
    throw new Error(msg)
  }
  return body as AuthResponseDto
}

// ---- 公众号扫码登录 ----------------------------------------------------------

export type WechatLoginSessionDto = {
  sessionId: string
  qrCodeUrl: string
  expiresAt: string
}

export type WechatLoginStatusDto = {
  /// 后端刻意不返回 openId（身份凭据）——这里也拿不到，别指望
  status: 'pending' | 'unlinked' | 'authorized' | 'consumed' | 'expired'
  nickname: string | null
  avatarUrl: string | null
  returnTo: string | null
}

/// 未配置 WECHAT_OFFICIAL_* 时后端返 501，调用方据此隐藏入口而非报错
export class WechatLoginDisabledError extends Error {}

export async function createWechatLoginSession(returnTo?: string | null): Promise<WechatLoginSessionDto> {
  const r = await apiFetch(`${API_BASE}/auth/wechat-official/sessions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(returnTo ? { returnTo } : {}),
  })
  const body = await parseAuthErrorBody(r)
  if (r.status === 501) throw new WechatLoginDisabledError('微信扫码登录未开启')
  if (!r.ok) {
    throw new Error((body && (body.error || body.message)) || `create wechat session failed: ${r.status}`)
  }
  return body as WechatLoginSessionDto
}

export async function getWechatLoginStatus(sessionId: string): Promise<WechatLoginStatusDto> {
  const r = await apiFetch(`${API_BASE}/auth/wechat-official/sessions/${encodeURIComponent(sessionId)}`, {
    credentials: 'include',
  })
  const body = await parseAuthErrorBody(r)
  if (!r.ok) {
    throw new Error((body && (body.error || body.message)) || `get wechat session failed: ${r.status}`)
  }
  return body as WechatLoginStatusDto
}

export async function consumeWechatLoginSession(sessionId: string): Promise<AuthResponseDto> {
  const r = await apiFetch(`${API_BASE}/auth/wechat-official/sessions/${encodeURIComponent(sessionId)}/consume`, {
    method: 'POST',
    credentials: 'include',
  })
  const body = await parseAuthErrorBody(r)
  if (!r.ok) {
    throw new Error((body && (body.error || body.message)) || `consume wechat session failed: ${r.status}`)
  }
  return body as AuthResponseDto
}

export async function loginWithCredentials(username: string, password: string): Promise<AuthResponseDto> {
	const r = await apiFetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password }),
  })
  const body = await parseAuthErrorBody(r)
  if (!r.ok) {
		const msg = (body && (body.error || body.message)) || `credential login failed: ${r.status}`
    throw new Error(msg)
  }
  return body as AuthResponseDto
}

export type FlowVersionListItemDto = Readonly<{ id: string; createdAt: string; name: string }>

export type FlowVersionPageDto = Readonly<{
  items: FlowVersionListItemDto[]
  nextCursor: string | null
}>

export async function listFlowVersionsPage(input: Readonly<{
  flowId: string
  limit?: number
  cursor?: string
}>): Promise<FlowVersionPageDto> {
  const query = new URLSearchParams({ limit: String(input.limit ?? 40) })
  if (input.cursor) query.set('cursor', input.cursor)
  const r = await apiFetch(`${API_BASE}/flows/${encodeURIComponent(input.flowId)}/versions?${query.toString()}`, withAuth({
    signal: AbortSignal.timeout(15_000),
  }))
  if (!r.ok) throw new Error(`list versions failed: ${r.status}`)
  return r.json()
}

export async function createFlowVersionSnapshot(flowId: string): Promise<FlowVersionListItemDto> {
  const r = await apiFetch(`${API_BASE}/flows/${encodeURIComponent(flowId)}/versions`, withAuth({
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  }))
  if (!r.ok) await throwApiError(r, `save flow version failed: ${r.status}`)
  return r.json()
}

export async function rollbackFlow(flowId: string, versionId: string): Promise<FlowDto> {
  const r = await apiFetch(`${API_BASE}/flows/${flowId}/rollback`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId }) }))
  if (!r.ok) throw new Error(`rollback failed: ${r.status}`)
  return r.json() as Promise<FlowDto>
}
export async function listProjects(): Promise<ProjectDto[]> {
  const r = await apiFetch(`${API_BASE}/projects`, withAuth())
  if (!r.ok) throw new Error(`list projects failed: ${r.status}`)
  return r.json()
}

export async function listProjectsPaginated(params?: { limit?: number; cursor?: string; teamId?: string | null }): Promise<{ items: ProjectDto[]; nextCursor: string | null }> {
  const qs = new URLSearchParams()
  qs.set('limit', String(params?.limit ?? 30))
  if (params?.cursor) qs.set('cursor', params.cursor)
  if (params?.teamId) qs.set('teamId', params.teamId)
  const r = await apiFetch(`${API_BASE}/projects?${qs}`, withAuth())
  if (!r.ok) throw new Error(`list projects failed: ${r.status}`)
  return r.json()
}

export async function listProjectChapters(projectId: string): Promise<ChapterDto[]> {
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/chapters`, withAuth())
  if (!r.ok) await throwApiError(r, `list project chapters failed: ${r.status}`)
  const body = await r.json().catch(() => ({ items: [] }))
  const items = Array.isArray(body?.items) ? body.items : []
  return items as ChapterDto[]
}

export async function createProjectChapter(projectId: string, payload: {
  title: string
  summary?: string
}): Promise<ChapterDto> {
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/chapters`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `create project chapter failed: ${r.status}`)
  return r.json()
}

export async function updateChapter(chapterId: string, payload: {
  title?: string
  summary?: string
  status?: ChapterDto['status']
  sortOrder?: number
  sourceBookId?: string | null
  sourceBookChapter?: number | null
  styleProfileOverride?: ChapterCreativeOverride | null
}): Promise<ChapterDto> {
  const r = await apiFetch(`${API_BASE}/chapters/${encodeURIComponent(chapterId)}`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `update chapter failed: ${r.status}`)
  return r.json()
}

export async function deleteChapter(chapterId: string): Promise<{
  ok: true
  chapterId: string
  projectId: string
  deletedShotCount: number
}> {
  const r = await apiFetch(`${API_BASE}/chapters/${encodeURIComponent(chapterId)}`, withAuth({
    method: 'DELETE',
  }))
  if (!r.ok) await throwApiError(r, `delete chapter failed: ${r.status}`)
  return r.json()
}

export async function getProjectDefaultEntry(projectId: string): Promise<ProjectDefaultEntryDto> {
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/default-entry`, withAuth())
  if (!r.ok) await throwApiError(r, `get project default entry failed: ${r.status}`)
  return r.json()
}

export async function getChapterWorkbench(chapterId: string): Promise<ChapterWorkbenchDto> {
  const r = await apiFetch(`${API_BASE}/chapters/${encodeURIComponent(chapterId)}/workbench`, withAuth())
  if (!r.ok) await throwApiError(r, `get chapter workbench failed: ${r.status}`)
  return r.json()
}

export async function createChapterShot(chapterId: string, payload?: {
  title?: string
}): Promise<ChapterWorkbenchShotDto> {
  const r = await apiFetch(`${API_BASE}/chapters/${encodeURIComponent(chapterId)}/shots`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  }))
  if (!r.ok) await throwApiError(r, `create chapter shot failed: ${r.status}`)
  return r.json()
}

export async function updateChapterShot(chapterId: string, shotId: string, payload: {
  title?: string
  summary?: string
  status?: string
}): Promise<ChapterWorkbenchShotDto> {
  const r = await apiFetch(`${API_BASE}/chapters/${encodeURIComponent(chapterId)}/shots/${encodeURIComponent(shotId)}`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `update chapter shot failed: ${r.status}`)
  return r.json()
}

export async function moveChapterShot(chapterId: string, shotId: string, payload: {
  direction: 'up' | 'down'
}): Promise<ChapterWorkbenchShotDto> {
  const r = await apiFetch(`${API_BASE}/chapters/${encodeURIComponent(chapterId)}/shots/${encodeURIComponent(shotId)}/move`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `move chapter shot failed: ${r.status}`)
  return r.json()
}

export async function deleteChapterShot(chapterId: string, shotId: string): Promise<{ ok: true; shotId: string }> {
  const r = await apiFetch(`${API_BASE}/chapters/${encodeURIComponent(chapterId)}/shots/${encodeURIComponent(shotId)}`, withAuth({
    method: 'DELETE',
  }))
  if (!r.ok) await throwApiError(r, `delete chapter shot failed: ${r.status}`)
  return r.json()
}

export async function upsertProject(payload: { id?: string; name: string; teamId?: string | null }): Promise<ProjectDto> {
  const { teamId, ...rest } = payload
  const body = teamId ? { ...rest, teamId } : rest
  const r = await apiFetch(`${API_BASE}/projects`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  if (!r.ok) await throwApiError(r, `save project failed: ${r.status}`)
  return r.json()
}

export async function listProjectFlows(projectId: string): Promise<FlowDto[]> {
  // 项目级画布与章节/镜头画布必须按 owner scope 隔离；否则恢复项目时可能
  // 选中同一项目下更新时间更晚的章节 flow，造成项目画布看起来“丢失”。
  const params = new URLSearchParams({
    projectId,
    ownerType: 'project',
    ownerId: projectId,
  })
  const r = await apiFetch(`${API_BASE}/flows?${params.toString()}`, withAuth())
  if (!r.ok) await throwApiError(r, `list flows failed: ${r.status}`)
  return r.json()
}

export async function listChapterFlows(projectId: string, chapterId: string): Promise<FlowDto[]> {
  const params = new URLSearchParams({
    projectId,
    ownerType: 'chapter',
    ownerId: chapterId,
  })
  const r = await apiFetch(`${API_BASE}/flows?${params.toString()}`, withAuth())
  if (!r.ok) await throwApiError(r, `list chapter flows failed: ${r.status}`)
  return r.json()
}

export async function listShotFlows(projectId: string, shotId: string): Promise<FlowDto[]> {
  const params = new URLSearchParams({
    projectId,
    ownerType: 'shot',
    ownerId: shotId,
  })
  const r = await apiFetch(`${API_BASE}/flows?${params.toString()}`, withAuth())
  if (!r.ok) await throwApiError(r, `list shot flows failed: ${r.status}`)
  return r.json()
}

export async function saveProjectFlow(payload: { id?: string; projectId: string; name: string; nodes: Node[]; edges: Edge[]; viewport?: { x: number; y: number; zoom: number } | null; sceneCreationProgress?: unknown; expectedRevision?: number }): Promise<FlowSaveReceipt> {
  const data = sanitizeFlowDataForPersistence({
    nodes: payload.nodes,
    edges: payload.edges,
    viewport: payload.viewport ?? null,
    ...(typeof payload.sceneCreationProgress === 'undefined' ? null : { sceneCreationProgress: payload.sceneCreationProgress }),
  })
  const r = await apiFetch(`${API_BASE}/flows`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: payload.id, projectId: payload.projectId, name: payload.name, data, ownerType: 'project', ownerId: payload.projectId, expectedRevision: payload.expectedRevision, source: 'user' }) }))
  if (!r.ok) await throwApiError(r, `save flow failed: ${r.status}`)
  return r.json()
}

export type ProjectFlowBootstrapReceipt =
  | {
      status: 'complete'
      project: ProjectDto
      flow: Omit<FlowDto, 'data'>
    }
  | {
      status: 'partial'
      project: ProjectDto
      error: string
    }

export async function bootstrapProjectFlow(payload: {
  name: string
  teamId?: string | null
  flowName: string
  nodes: Node[]
  edges: Edge[]
  viewport?: { x: number; y: number; zoom: number } | null
}): Promise<ProjectFlowBootstrapReceipt> {
  const data = sanitizeFlowDataForPersistence({
    nodes: payload.nodes,
    edges: payload.edges,
    viewport: payload.viewport ?? null,
  })
  const r = await apiFetch(`${API_BASE}/projects/bootstrap`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: payload.name,
      ...(payload.teamId ? { teamId: payload.teamId } : null),
      flow: { name: payload.flowName, data },
    }),
  }))
  if (!r.ok) await throwApiError(r, `bootstrap project flow failed: ${r.status}`)
  const result = await r.json() as ProjectFlowBootstrapReceipt
  if (result.status !== 'complete' && result.status !== 'partial') {
    throw new Error('项目初始化接口返回了未知状态')
  }
  return result
}

export async function saveChapterFlow(payload: {
  id?: string
  projectId: string
  chapterId: string
  name: string
  nodes: Node[]
  edges: Edge[]
  viewport?: { x: number; y: number; zoom: number } | null
  sceneCreationProgress?: unknown
  expectedRevision?: number
}): Promise<FlowSaveReceipt> {
  const data = sanitizeFlowDataForPersistence({
    nodes: payload.nodes,
    edges: payload.edges,
    viewport: payload.viewport ?? null,
    ...(typeof payload.sceneCreationProgress === 'undefined' ? null : { sceneCreationProgress: payload.sceneCreationProgress }),
  })
  const r = await apiFetch(`${API_BASE}/flows`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: payload.id, projectId: payload.projectId, name: payload.name, data, ownerType: 'chapter', ownerId: payload.chapterId, expectedRevision: payload.expectedRevision, source: 'user' }) }))
  if (!r.ok) await throwApiError(r, `save chapter flow failed: ${r.status}`)
  return r.json()
}

export async function saveShotFlow(payload: {
  id?: string
  projectId: string
  shotId: string
  name: string
  nodes: Node[]
  edges: Edge[]
  viewport?: { x: number; y: number; zoom: number } | null
  sceneCreationProgress?: unknown
  expectedRevision?: number
}): Promise<FlowSaveReceipt> {
  const data = sanitizeFlowDataForPersistence({
    nodes: payload.nodes,
    edges: payload.edges,
    viewport: payload.viewport ?? null,
    ...(typeof payload.sceneCreationProgress === 'undefined' ? null : { sceneCreationProgress: payload.sceneCreationProgress }),
  })
  const r = await apiFetch(`${API_BASE}/flows`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: payload.id, projectId: payload.projectId, name: payload.name, data, ownerType: 'shot', ownerId: payload.shotId, expectedRevision: payload.expectedRevision, source: 'user' }) }))
  if (!r.ok) await throwApiError(r, `save shot flow failed: ${r.status}`)
  return r.json()
}

export async function runWorkflowExecution(payload: {
  flowId: string
  triggerNodeId: string
  stopAfterNodeId?: string
  replayFromExecutionId?: string
  startFromNodeId?: string
  concurrency?: number
}): Promise<WorkflowExecutionDto> {
  const r = await apiFetch(`${API_BASE}/executions/run`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      flowId: payload.flowId,
      triggerNodeId: payload.triggerNodeId,
      ...(payload.stopAfterNodeId ? { stopAfterNodeId: payload.stopAfterNodeId } : {}),
      ...(payload.replayFromExecutionId && payload.startFromNodeId
        ? {
          replayFromExecutionId: payload.replayFromExecutionId,
          startFromNodeId: payload.startFromNodeId,
        }
        : {}),
      concurrency: payload.concurrency ?? 1,
      trigger: 'manual',
    }),
  }))
  if (!r.ok) await throwApiError(r, `run execution failed: ${r.status}`)
  return r.json()
}

export async function previewWorkflowSchedule(spec: ScheduleWorkflowTriggerSpecV1): Promise<Readonly<{
  valid: true
  nextRuns: readonly string[]
}>> {
  const r = await apiFetch(`${API_BASE}/executions/schedule/preview`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  }))
  if (!r.ok) await throwApiError(r, `preview workflow schedule failed: ${r.status}`)
  return r.json()
}

export async function listWorkflowExecutions(payload: {
  flowId: string
  limit?: number
  activeOnly?: boolean
}): Promise<WorkflowExecutionDto[]> {
  const limit = payload.limit ?? 30
  const params = new URLSearchParams({
    flowId: payload.flowId,
    limit: String(limit),
  })
  if (payload.activeOnly === true) params.set('activeOnly', 'true')
  const r = await apiFetch(`${API_BASE}/executions?${params.toString()}`, withAuth())
  if (!r.ok) throw new Error(`list executions failed: ${r.status}`)
  return r.json()
}

export type WorkflowExecutionHistoryPageDto = Readonly<{
  items: WorkflowExecutionDto[]
  nextCursor: string | null
}>

export async function listWorkflowExecutionHistoryPage(payload: Readonly<{
  flowId?: string
  limit?: number
  cursor?: string
}> = {}): Promise<WorkflowExecutionHistoryPageDto> {
  const params = new URLSearchParams({ limit: String(payload.limit ?? 40) })
  if (payload.flowId) params.set('flowId', payload.flowId)
  if (payload.cursor) params.set('cursor', payload.cursor)
  const r = await apiFetch(`${API_BASE}/executions/history?${params.toString()}`, withAuth({
    signal: AbortSignal.timeout(15_000),
  }))
  if (!r.ok) await throwApiError(r, `list execution history failed: ${r.status}`)
  return r.json()
}

export async function getWorkflowExecution(executionId: string): Promise<WorkflowExecutionDto> {
  const r = await apiFetch(`${API_BASE}/executions/${encodeURIComponent(executionId)}`, withAuth())
  if (!r.ok) throw new Error(`get execution failed: ${r.status}`)
  return r.json()
}

export async function getWorkflowExecutionFamily(
  executionId: string,
  limit = 1,
): Promise<WorkflowExecutionFamilyDto> {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)))
  const r = await apiFetch(
    `${API_BASE}/executions/${encodeURIComponent(executionId)}/family?limit=${boundedLimit}`,
    withAuth(),
  )
  if (!r.ok) await throwApiError(r, `get execution family failed: ${r.status}`)
  return r.json()
}

export async function getWorkflowExecutionContext(executionId: string): Promise<WorkflowExecutionContextDto> {
  const r = await apiFetch(`${API_BASE}/executions/${encodeURIComponent(executionId)}/context`, withAuth())
  if (!r.ok) await throwApiError(r, `get execution context failed: ${r.status}`)
  return r.json()
}

export async function getWorkflowExecutionMetrics(flowId?: string): Promise<WorkflowExecutionMetricsDto> {
  const query = flowId ? `?flowId=${encodeURIComponent(flowId)}` : ''
  const r = await apiFetch(`${API_BASE}/executions/metrics${query}`, withAuth({
    signal: AbortSignal.timeout(15_000),
  }))
  if (!r.ok) await throwApiError(r, `get execution metrics failed: ${r.status}`)
  return r.json()
}

export async function resumeWorkflowExecution(
  executionId: string,
  request: Readonly<{ providerBalanceRestored?: true }> = {},
): Promise<WorkflowExecutionDto> {
  const r = await apiFetch(`${API_BASE}/executions/${encodeURIComponent(executionId)}/resume`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  }))
  if (!r.ok) await throwApiError(r, `resume workflow execution failed: ${r.status}`)
  return r.json()
}

export async function getWorkflowExecutionSnapshot(executionId: string): Promise<WorkflowExecutionSnapshotDto> {
  const r = await apiFetch(`${API_BASE}/executions/${encodeURIComponent(executionId)}/snapshot`, withAuth())
  if (!r.ok) await throwApiError(r, `get execution snapshot failed: ${r.status}`)
  return r.json()
}

export async function rerunWorkflowExecutionSnapshot(executionId: string): Promise<WorkflowExecutionDto> {
  const r = await apiFetch(`${API_BASE}/executions/${encodeURIComponent(executionId)}/rerun`, withAuth({ method: 'POST' }))
  if (!r.ok) await throwApiError(r, `rerun execution snapshot failed: ${r.status}`)
  return r.json()
}

export async function listWorkflowNodeRuns(executionId: string): Promise<WorkflowNodeRunDto[]> {
  const r = await apiFetch(`${API_BASE}/executions/${encodeURIComponent(executionId)}/node-runs`, withAuth())
  if (!r.ok) throw new Error(`list node runs failed: ${r.status}`)
  return r.json()
}

export async function respondWorkflowHumanApproval(input: Readonly<{
  executionId: string
  nodeId: string
  response: 'approved' | 'rejected'
}>): Promise<Readonly<{
  accepted: true
  executionId: string
  nodeId: string
  response: 'approved' | 'rejected'
  respondedAt: string
}>> {
  const r = await apiFetch(`${API_BASE}/executions/${encodeURIComponent(input.executionId)}/human-response`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId: input.nodeId, response: input.response }),
  }))
  if (!r.ok) await throwApiError(r, `respond to workflow approval failed: ${r.status}`)
  return r.json()
}

export async function listWorkflowNodeRunHistory(payload: {
  flowId: string
  nodeId: string
  limit?: number
}): Promise<WorkflowNodeRunHistoryDto[]> {
  const params = new URLSearchParams({
    flowId: payload.flowId,
    nodeId: payload.nodeId,
    limit: String(payload.limit ?? 20),
  })
  const r = await apiFetch(`${API_BASE}/executions/node-history?${params.toString()}`, withAuth())
  if (!r.ok) await throwApiError(r, `list node run history failed: ${r.status}`)
  return r.json()
}

export async function listAgentPipelineRuns(payload: { projectId?: string; limit?: number }): Promise<AgentPipelineRunDto[]> {
  const params = new URLSearchParams()
  if (payload.projectId) params.set('projectId', payload.projectId)
  if (typeof payload.limit === 'number') params.set('limit', String(payload.limit))
  const q = params.toString()
  const r = await apiFetch(`${API_BASE}/agents/pipeline/runs${q ? `?${q}` : ''}`, withAuth())
  if (!r.ok) throw new Error(`list agent pipeline runs failed: ${r.status}`)
  return r.json()
}

export async function createAgentPipelineRun(payload: {
  projectId: string
  title: string
  goal?: string | null
  stages: AgentPipelineStage[]
}): Promise<AgentPipelineRunDto> {
  const r = await apiFetch(`${API_BASE}/agents/pipeline/runs`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`create agent pipeline run failed: ${r.status}`)
  return r.json()
}

export async function getAgentPipelineRun(id: string): Promise<AgentPipelineRunDto> {
  const r = await apiFetch(`${API_BASE}/agents/pipeline/runs/${encodeURIComponent(id)}`, withAuth())
  if (!r.ok) throw new Error(`get agent pipeline run failed: ${r.status}`)
  return r.json()
}

export async function updateAgentPipelineRunStatus(
  id: string,
  payload: { status: AgentPipelineRunStatus; progress?: any; result?: any; errorMessage?: string | null },
): Promise<AgentPipelineRunDto> {
  const r = await apiFetch(`${API_BASE}/agents/pipeline/runs/${encodeURIComponent(id)}/status`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`update agent pipeline run status failed: ${r.status}`)
  return r.json()
}

export async function executeAgentPipelineRun(
  id: string,
  payload?: {
    force?: boolean
    skipMediaGeneration?: boolean
    systemPrompt?: string
    chapter?: number
    bookId?: string
    progress?: {
      taskId?: string
      previousChunkId?: string
      mode?: 'single' | 'full'
      groupSize?: 1 | 4 | 9 | 25
      totalShots?: number
      completedShots?: number
      nextShotStart?: number
      nextShotEnd?: number
      totalGroups?: number
      completedGroups?: number
      existingStoryboardContent?: string
    }
  },
): Promise<AgentPipelineRunDto> {
  const r = await apiFetch(`${API_BASE}/agents/pipeline/runs/${encodeURIComponent(id)}/execute`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-TapCanvas-Source': 'canvas' },
    body: JSON.stringify(payload || {}),
  }))
  if (!r.ok) await throwApiError(r, `execute agent pipeline run failed: ${r.status}`)
  return r.json()
}

export async function createMaterialAsset(payload: {
  projectId?: string
  kind: MaterialKindDto
  name: string
  initialData: Record<string, unknown>
  note?: string
  folderId?: string
}): Promise<{ asset: MaterialAssetDto; version: MaterialAssetVersionDto }> {
  const r = await apiFetch(`${API_BASE}/materials/assets`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `create material asset failed: ${r.status}`)
  return r.json()
}

export async function listMaterialAssets(input?: {
  kind?: MaterialKindDto
  projectId?: string
}): Promise<MaterialAssetDto[]> {
  const params = new URLSearchParams()
  if (input?.kind) params.set('kind', input.kind)
  if (input?.projectId) params.set('projectId', input.projectId)
  const qs = params.toString()
  const r = await apiFetch(`${API_BASE}/materials/assets${qs ? `?${qs}` : ''}`, withAuth())
  if (!r.ok) await throwApiError(r, `list material assets failed: ${r.status}`)
  return r.json()
}

export async function updateMaterialAsset(assetId: string, payload: {
  name?: string
  data?: Record<string, unknown>
  favorite?: boolean
}): Promise<MaterialAssetDto> {
  const r = await apiFetch(`${API_BASE}/materials/assets/${encodeURIComponent(assetId)}`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `update material asset failed: ${r.status}`)
  return r.json()
}

export async function deleteMaterialAsset(assetId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/materials/assets/${encodeURIComponent(assetId)}`, withAuth({
    method: 'DELETE',
  }))
  if (!r.ok) await throwApiError(r, `delete material asset failed: ${r.status}`)
}

export async function listTeamMaterialAssets(input: {
  teamId: string
  kind?: MaterialKindDto
}): Promise<MaterialAssetDto[]> {
  const params = new URLSearchParams({ teamId: input.teamId })
  if (input.kind) params.set('kind', input.kind)
  const r = await apiFetch(`${API_BASE}/materials/team-assets?${params.toString()}`, withAuth())
  if (!r.ok) await throwApiError(r, `list team material assets failed: ${r.status}`)
  return r.json()
}

export async function createTeamMaterialAsset(payload: {
  teamId: string
  kind: MaterialKindDto
  name: string
  initialData: Record<string, unknown>
  note?: string
  folderId?: string
}): Promise<{ asset: MaterialAssetDto; version: MaterialAssetVersionDto }> {
  const r = await apiFetch(`${API_BASE}/materials/team-assets`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `create team material asset failed: ${r.status}`)
  return r.json()
}

export async function deleteTeamMaterialAsset(assetId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/materials/team-assets/${encodeURIComponent(assetId)}`, withAuth({
    method: 'DELETE',
  }))
  if (!r.ok) await throwApiError(r, `delete team material asset failed: ${r.status}`)
}

export async function listMaterialFolders(input?: { teamId?: string }): Promise<MaterialFolderDto[]> {
  const params = new URLSearchParams()
  if (input?.teamId) params.set('teamId', input.teamId)
  const qs = params.toString()
  const r = await apiFetch(`${API_BASE}/materials/folders${qs ? `?${qs}` : ''}`, withAuth())
  if (!r.ok) await throwApiError(r, `list material folders failed: ${r.status}`)
  return r.json()
}

export async function createMaterialFolder(payload: { teamId?: string; name: string }): Promise<MaterialFolderDto> {
  const r = await apiFetch(`${API_BASE}/materials/folders`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `create material folder failed: ${r.status}`)
  return r.json()
}

export async function deleteMaterialFolder(folderId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/materials/folders/${encodeURIComponent(folderId)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) await throwApiError(r, `delete material folder failed: ${r.status}`)
}

export async function createMaterialVersion(assetId: string, payload: {
  data: Record<string, unknown>
  note?: string
}): Promise<MaterialAssetVersionDto> {
  const r = await apiFetch(`${API_BASE}/materials/assets/${encodeURIComponent(assetId)}/versions`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `create material version failed: ${r.status}`)
  return r.json()
}

const inflightMaterialVersionListRequests = new Map<string, Promise<MaterialAssetVersionDto[]>>()

export async function listMaterialVersions(assetId: string, limit = 20): Promise<MaterialAssetVersionDto[]> {
  const normalizedAssetId = String(assetId || '').trim()
  if (!normalizedAssetId) {
    throw new Error('assetId is required')
  }
  const normalizedLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 20)))
  const requestKey = `${normalizedAssetId}::${normalizedLimit}`
  const inflight = inflightMaterialVersionListRequests.get(requestKey)
  if (inflight) return inflight

  const request = (async (): Promise<MaterialAssetVersionDto[]> => {
    const r = await apiFetch(
      `${API_BASE}/materials/assets/${encodeURIComponent(normalizedAssetId)}/versions?limit=${normalizedLimit}`,
      withAuth(),
    )
    if (!r.ok) await throwApiError(r, `list material versions failed: ${r.status}`)
    return r.json()
  })()

  inflightMaterialVersionListRequests.set(requestKey, request)
  try {
    return await request
  } finally {
    inflightMaterialVersionListRequests.delete(requestKey)
  }
}

export async function upsertShotMaterialRefs(payload: {
  projectId: string
  shotId: string
  refs: Array<{ assetId: string; assetVersion: number }>
}): Promise<MaterialShotRefDto[]> {
  const r = await apiFetch(`${API_BASE}/materials/shot-refs/upsert`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `upsert shot material refs failed: ${r.status}`)
  return r.json()
}

export async function listShotMaterialRefs(input: {
  projectId: string
  shotId: string
}): Promise<MaterialShotRefDto[]> {
  const params = new URLSearchParams({ projectId: input.projectId, shotId: input.shotId })
  const r = await apiFetch(`${API_BASE}/materials/shot-refs?${params.toString()}`, withAuth())
  if (!r.ok) await throwApiError(r, `list shot material refs failed: ${r.status}`)
  return r.json()
}

export async function listImpactedShots(input: {
  projectId: string
  assetId?: string
}): Promise<MaterialImpactResponseDto> {
  const params = new URLSearchParams()
  if (input.assetId) params.set('assetId', input.assetId)
  const suffix = params.toString()
  const r = await apiFetch(
    `${API_BASE}/materials/projects/${encodeURIComponent(input.projectId)}/impacted-shots${suffix ? `?${suffix}` : ''}`,
    withAuth(),
  )
  if (!r.ok) await throwApiError(r, `list impacted shots failed: ${r.status}`)
  return r.json()
}

// 画布参考图生成完成后，将 imageUrl 写入服务端 canvas-index.json，供下次 intent 复用已有参考图
export async function upsertCanvasIndexRef(payload: {
  projectId: string
  nodeId?: string
  sourceNodeId?: string
  referenceType: 'character' | 'scene'
  name: string
  imageUrl: string
  prompt?: string
  modelKey?: string
  imageSize?: string
  creationStage?: string
}): Promise<void> {
  const r = await apiFetch(`${API_BASE}/materials/canvas-index/upsert-ref`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `upsert canvas index ref failed: ${r.status}`)
}

// Public project APIs
export async function listPublicProjects(): Promise<ProjectDto[]> {
  const r = await apiFetch(`${API_BASE}/projects/public`, { headers: { 'Content-Type': 'application/json' } })
  if (!r.ok) throw new Error(`list public projects failed: ${r.status}`)
  const body = await r.json().catch(() => [])
  const items = Array.isArray(body) ? body : []
  return items.map((raw): ProjectDto => {
    const it = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const templateTitle = typeof it.templateTitle === 'string' ? it.templateTitle.trim() : ''
    const templateDescription = typeof it.templateDescription === 'string' ? it.templateDescription.trim() : ''
    const templateCoverUrl = typeof it.templateCoverUrl === 'string' ? it.templateCoverUrl.trim() : ''
    return {
      id: String(it.id || ''),
      name: String(it.name || ''),
      createdAt: String(it.createdAt ?? it.created_at ?? ''),
      updatedAt: String(it.updatedAt ?? it.updated_at ?? ''),
      isPublic: typeof it.isPublic === 'boolean' ? it.isPublic : undefined,
      owner: typeof it.owner === 'string' ? it.owner : undefined,
      ownerName: typeof it.ownerName === 'string' ? it.ownerName : undefined,
      cloneCount: typeof it.cloneCount === 'number' ? it.cloneCount : undefined,
      templateTitle: templateTitle || undefined,
      templateDescription: templateDescription || undefined,
      templateCoverUrl: templateCoverUrl || undefined,
    }
  }).filter((it) => Boolean(it.id))
}

export async function cloneProject(projectId: string, newName?: string): Promise<ProjectDto> {
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/clone`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName })
  }))
  if (!r.ok) await throwApiError(r, `复制项目失败: ${r.status}`)
  return await r.json() as ProjectDto
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

export async function updateProjectTemplate(projectId: string, payload: {
  templateTitle: string
  templateDescription?: string
  templateCoverUrl?: string
  isPublic: boolean
  sortWeight?: number
}): Promise<ProjectDto> {
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/template`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `update project template failed: ${r.status}`)
  return r.json()
}

export async function deleteProject(projectId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete project failed: ${r.status}`)
}

export async function listDreaminaAccounts(): Promise<DreaminaAccountDto[]> {
  const r = await apiFetch(`${API_BASE}/dreamina/accounts`, withAuth())
  if (!r.ok) await throwApiError(r, `list dreamina accounts failed: ${r.status}`)
  return r.json()
}

export async function upsertDreaminaAccount(payload: {
  id?: string
  label: string
  cliPath?: string | null
  enabled?: boolean
  meta?: unknown
}): Promise<DreaminaAccountDto> {
  const r = await apiFetch(`${API_BASE}/dreamina/accounts`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `save dreamina account failed: ${r.status}`)
  return r.json()
}

export async function deleteDreaminaAccount(accountId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/dreamina/accounts/${encodeURIComponent(accountId)}`, withAuth({
    method: 'DELETE',
  }))
  if (!r.ok) await throwApiError(r, `delete dreamina account failed: ${r.status}`)
}

export async function probeDreaminaAccount(accountId: string): Promise<DreaminaAccountProbeDto> {
  const r = await apiFetch(`${API_BASE}/dreamina/accounts/${encodeURIComponent(accountId)}/probe`, withAuth({
    method: 'POST',
  }))
  if (!r.ok) await throwApiError(r, `probe dreamina account failed: ${r.status}`)
  return r.json()
}

export async function importDreaminaLoginResponse(accountId: string, loginResponseJson: string): Promise<DreaminaAccountProbeDto> {
  const r = await apiFetch(`${API_BASE}/dreamina/accounts/${encodeURIComponent(accountId)}/import-login`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginResponseJson }),
  }))
  if (!r.ok) await throwApiError(r, `import dreamina login failed: ${r.status}`)
  return r.json()
}

export async function getDreaminaProjectBinding(projectId: string): Promise<DreaminaProjectBindingDto | null> {
  const r = await apiFetch(`${API_BASE}/dreamina/projects/${encodeURIComponent(projectId)}/binding`, withAuth())
  if (!r.ok) await throwApiError(r, `get dreamina project binding failed: ${r.status}`)
  return r.json()
}

export async function upsertDreaminaProjectBinding(projectId: string, payload: {
  accountId: string
  enabled?: boolean
  defaultModelVersion?: string | null
  defaultRatio?: string | null
  defaultResolutionType?: string | null
  defaultVideoResolution?: string | null
}): Promise<DreaminaProjectBindingDto> {
  const r = await apiFetch(`${API_BASE}/dreamina/projects/${encodeURIComponent(projectId)}/binding`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `save dreamina project binding failed: ${r.status}`)
  return r.json()
}

export async function deleteDreaminaProjectBinding(projectId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/dreamina/projects/${encodeURIComponent(projectId)}/binding`, withAuth({
    method: 'DELETE',
  }))
  if (!r.ok) await throwApiError(r, `delete dreamina project binding failed: ${r.status}`)
}

function parseFlowDto(raw: unknown): FlowDto | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = String(item.id || '').trim()
  const name = String(item.name || '').trim()
  const updatedAt = String(item.updatedAt ?? item.updated_at ?? '').trim()
  if (!id || !name) return null
  const rawData = item.data
  const dataObject = rawData && typeof rawData === 'object'
    ? rawData as Record<string, unknown>
    : {}
  const nodes = Array.isArray(dataObject.nodes) ? dataObject.nodes as Node[] : []
  const edges = Array.isArray(dataObject.edges) ? dataObject.edges as Edge[] : []
  const viewportCandidate = dataObject.viewport
  const viewport = viewportCandidate && typeof viewportCandidate === 'object'
    && typeof (viewportCandidate as { x?: unknown }).x === 'number'
    && typeof (viewportCandidate as { y?: unknown }).y === 'number'
    && typeof (viewportCandidate as { zoom?: unknown }).zoom === 'number'
    ? viewportCandidate as { x: number; y: number; zoom: number }
    : null
  const ownerTypeRaw = item.ownerType ?? item.owner_type
  const ownerType = ownerTypeRaw === 'project' || ownerTypeRaw === 'chapter' || ownerTypeRaw === 'shot'
    ? ownerTypeRaw
    : null
  const ownerIdRaw = item.ownerId ?? item.owner_id
  const canvasRevisionRaw = item.canvasRevision ?? item.canvas_revision
  return {
    id,
    name,
    ownerType,
    ownerId: typeof ownerIdRaw === 'string' ? ownerIdRaw : null,
    data: {
      nodes,
      edges,
      ...(viewport ? { viewport } : {}),
      ...(dataObject.sceneCreationProgress !== undefined ? { sceneCreationProgress: dataObject.sceneCreationProgress } : {}),
    },
    createdAt: String(item.createdAt ?? item.created_at ?? updatedAt),
    updatedAt,
    ...(typeof canvasRevisionRaw === 'number' ? { canvasRevision: canvasRevisionRaw } : {}),
  }
}

export async function getPublicProjectFlows(
  projectId: string,
  scope?: { ownerType: 'chapter'; ownerId: string },
): Promise<PublicProjectFlowDto[]> {
  const params = new URLSearchParams()
  if (scope) {
    params.set('ownerType', scope.ownerType)
    params.set('ownerId', scope.ownerId)
  }
  const query = params.toString()
  const path = `${API_BASE}/projects/${encodeURIComponent(projectId)}/flows${query ? `?${query}` : ''}`
  const r = await apiFetch(path, { headers: { 'Content-Type': 'application/json' } })
  if (!r.ok) await throwApiError(r, '加载公开创作过程失败')
  const body = await r.json().catch(() => null)
  const itemsRaw = Array.isArray(body)
    ? body
    : typeof body === 'object' && body !== null && Array.isArray((body as { items?: unknown[] }).items)
      ? (body as { items: unknown[] }).items
      : []
  return itemsRaw
    .map(parseFlowDto)
    .filter((item): item is PublicProjectFlowDto => item !== null)
}

export async function getPublicProjectFlow(projectId: string, flowId: string): Promise<FlowDto> {
  const flows = await getPublicProjectFlows(projectId)
  const flow = flows.find((item) => item.id === flowId)
  if (!flow) throw new Error('public flow not found')
  return flow
}

export async function getPublicProjectFlowList(projectId: string): Promise<PublicProjectFlowListItemDto[]> {
  const flows = await getPublicProjectFlows(projectId)
  return flows.map((flow) => ({
    id: flow.id,
    name: flow.name,
    updatedAt: flow.updatedAt,
  }))
}

export async function getPublicFlow(flowId: string): Promise<FlowDto> {
  const r = await apiFetch(`${API_BASE}/projects/public/flows/${encodeURIComponent(flowId)}`, { headers: { 'Content-Type': 'application/json' } })
  if (!r.ok) throw new Error(`get public flow failed: ${r.status}`)
  const body = await r.json().catch(() => null)
  const flow = parseFlowDto(body)
  if (!flow) throw new Error('public flow payload invalid')
  return flow
}

// External API key management (dashboard)
export async function listApiKeys(): Promise<ApiKeyDto[]> {
  const r = await apiFetch(`${API_BASE}/api-keys`, withAuth())
  if (!r.ok) {
    await throwApiError(r, `list api keys failed: ${r.status}`)
  }
  return r.json()
}

export async function listApiKeyBillingOptions(): Promise<ApiKeyBillingOptionDto[]> {
  const r = await apiFetch(`${API_BASE}/api-keys/billing-options`, withAuth())
  if (!r.ok) {
    await throwApiError(r, `list api key billing options failed: ${r.status}`)
  }
  const data = await r.json()
  return Array.isArray(data?.options) ? data.options : []
}

export async function createApiKey(payload: { label: string; allowedOrigins: string[]; enabled?: boolean; billingTeamId?: string | null; scopes: ApiKeyScope[]; expiresAt?: string | null }): Promise<{ key: string; apiKey: ApiKeyDto }> {
  const r = await apiFetch(`${API_BASE}/api-keys`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    await throwApiError(r, `create api key failed: ${r.status}`)
  }
  return r.json()
}

export async function updateApiKey(id: string, payload: { label?: string; allowedOrigins?: string[]; enabled?: boolean; billingTeamId?: string | null; scopes?: ApiKeyScope[]; expiresAt?: string | null }): Promise<ApiKeyDto> {
  const r = await apiFetch(`${API_BASE}/api-keys/${encodeURIComponent(id)}`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    await throwApiError(r, `update api key failed: ${r.status}`)
  }
  return r.json()
}

export async function rotateApiKey(id: string): Promise<{ key: string; apiKey: ApiKeyDto }> {
  const r = await apiFetch(`${API_BASE}/api-keys/${encodeURIComponent(id)}/rotate`, withAuth({ method: 'POST' }))
  if (!r.ok) await throwApiError(r, `rotate api key failed: ${r.status}`)
  return await r.json() as { key: string; apiKey: ApiKeyDto }
}

export async function deleteApiKey(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/api-keys/${encodeURIComponent(id)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) {
    await throwApiError(r, `delete api key failed: ${r.status}`)
  }
}

export type ApiKeyUsageItem = {
  id: string
  path: string
  method: string
  status: number | null
  durationMs: number | null
  startedAt: string
}

export type ApiKeyCreditItem = {
  source: 'personal' | 'team'
  amount: number
  note: string | null
  createdAt: string
  kind: string | null
}

export type ApiKeyUsageQuery = { limit?: number; before?: string; since?: string; until?: string }

function buildUsageQuery(opts?: ApiKeyUsageQuery): string {
  const p = new URLSearchParams()
  p.set('limit', String(opts?.limit ?? 50))
  if (opts?.before) p.set('before', opts.before)
  if (opts?.since) p.set('since', opts.since)
  if (opts?.until) p.set('until', opts.until)
  return p.toString()
}

export async function getApiKeyUsage(id: string, opts?: ApiKeyUsageQuery): Promise<{ items: ApiKeyUsageItem[] }> {
  const r = await apiFetch(`${API_BASE}/api-keys/${encodeURIComponent(id)}/usage?${buildUsageQuery(opts)}`, withAuth())
  if (!r.ok) {
    await throwApiError(r, `get api key usage failed: ${r.status}`)
  }
  const raw = (await r.json()) as {
    items: Array<{ id: string; path: string; method: string; status: number | null; duration_ms: number | null; started_at: string }>
  }
  return {
    items: raw.items.map((x) => ({
      id: x.id,
      path: x.path,
      method: x.method,
      status: x.status,
      durationMs: x.duration_ms,
      startedAt: x.started_at,
    })),
  }
}

export async function getApiKeyCredits(id: string, opts?: ApiKeyUsageQuery): Promise<{ summary: { personalSpent: number; teamSpent: number }; items: ApiKeyCreditItem[] }> {
  const r = await apiFetch(`${API_BASE}/api-keys/${encodeURIComponent(id)}/credits?${buildUsageQuery(opts)}`, withAuth())
  if (!r.ok) {
    await throwApiError(r, `get api key credits failed: ${r.status}`)
  }
  return r.json()
}

// Shared team management
export type TeamRole = 'owner' | 'admin' | 'member'

export type TeamDto = {
  id: string
  name: string
  credits: number
  creditsFrozen: number
  creditsAvailable: number
  maxMembers: number
  memberCount: number
  personal: boolean
  createdAt: string
  updatedAt: string
}

export type TeamListItemDto = TeamDto & {
  memberCount: number
}

export type TeamMemberDto = {
  userId: string
  login: string
  name: string | null
  avatarUrl: string | null
  email: string | null
  phone: string | null
  role: TeamRole
  createdAt: string
  updatedAt: string
}

export type TeamInviteDto = {
  id: string
  teamId: string
  code: string
  email: string | null
  phone: string | null
  login: string | null
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

export type TeamProjectShareDto = {
  projectId: string
  teamId: string
  access: 'edit'
  createdAt: string
  updatedAt: string
}

export type TeamCreditLedgerEntryDto = {
  id: string
  teamId: string
  /** 扣款账户展示名（「个人账户」或团队名），/teams/me/ledger 聚合视图回填 */
  teamName?: string | null
  entryType: 'topup' | 'reserve' | 'deduct' | 'release' | 'referral_bonus' | 'referral_welcome'
  amount: number
  taskId: string | null
  taskKind: string | null
  actorUserId: string | null
  note: string | null
  createdAt: string
}

export type TeamCreditLedgerListResponseDto = {
  items: TeamCreditLedgerEntryDto[]
  hasMore: boolean
  nextBefore: string | null
  nextBeforeId: string | null
}

export async function listTeams(): Promise<TeamListItemDto[]> {
  const r = await apiFetch(`${API_BASE}/teams`, withAuth())
  if (!r.ok) throw new Error(`list teams failed: ${r.status}`)
  return r.json()
}

export async function getMyTeam(selectedTeamId?: string | null): Promise<{ team: TeamDto; role: TeamRole } | null> {
  const url = selectedTeamId
    ? `${API_BASE}/teams/me?teamId=${encodeURIComponent(selectedTeamId)}`
    : `${API_BASE}/teams/me`
  // Pass selectedTeamId as the X-Team-Id header too, so an explicit query (e.g. 'personal')
  // is not overridden by the previously active team header on the backend.
  const r = await apiFetch(url, withAuth(undefined, selectedTeamId ?? undefined))
  if (!r.ok) {
    if (r.status === 404) return null
    throw new Error(`get my team failed: ${r.status}`)
  }
  const body = await r.json().catch(() => null as any)
  if (!body || !body.team) return null
  return body
}

export async function listMyTeams(): Promise<TeamListItemDto[]> {
  const r = await apiFetch(`${API_BASE}/teams`, withAuth())
  if (!r.ok) throw new Error(`list my teams failed: ${r.status}`)
  const body: unknown = await r.json()
  return Array.isArray(body) ? (body as TeamListItemDto[]) : []
}

export async function createTeam(payload: { name: string; ownerLogin?: string; ownerUserId?: string }): Promise<{ id: string }> {
  const r = await apiFetch(`${API_BASE}/teams`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `create team failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function listTeamMembers(teamId: string): Promise<TeamMemberDto[]> {
  const r = await apiFetch(`${API_BASE}/teams/${encodeURIComponent(teamId)}/members`, withAuth())
  if (!r.ok) throw new Error(`list team members failed: ${r.status}`)
  return r.json()
}

export async function addTeamMember(
  teamId: string,
  payload: { login?: string; userId?: string; role?: TeamRole },
): Promise<void> {
  const r = await apiFetch(`${API_BASE}/teams/${encodeURIComponent(teamId)}/members`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `add team member failed: ${r.status}`
    throw new Error(msg)
  }
}

export async function topUpTeamCredits(
  teamId: string,
  payload: { amount: number; note?: string },
): Promise<TeamDto> {
  const r = await apiFetch(`${API_BASE}/teams/${encodeURIComponent(teamId)}/topup`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `top up team credits failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function listTeamInvites(teamId: string): Promise<TeamInviteDto[]> {
  const r = await apiFetch(`${API_BASE}/teams/${encodeURIComponent(teamId)}/invites`, withAuth())
  if (!r.ok) throw new Error(`list team invites failed: ${r.status}`)
  return r.json()
}

export async function createTeamInvite(
  teamId: string,
  payload: { email?: string; phone?: string; login?: string; expiresInDays?: number },
): Promise<TeamInviteDto> {
  const r = await apiFetch(`${API_BASE}/teams/${encodeURIComponent(teamId)}/invites`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `create team invite failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function acceptTeamInvite(payload: { code: string }): Promise<{ teamId: string }> {
  const r = await apiFetch(`${API_BASE}/teams/invites/accept`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `accept team invite failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function shareProjectWithTeam(
  projectId: string,
  payload: { teamId: string; shared: boolean },
): Promise<TeamProjectShareDto | null> {
  const r = await apiFetch(`${API_BASE}/teams/projects/${encodeURIComponent(projectId)}/share`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, payload.teamId))
  if (r.status === 204) return null
  if (!r.ok) await throwApiError(r, `share project failed: ${r.status}`)
  return r.json()
}

export async function listTeamCreditLedger(teamId: string, params?: {
  limit?: number
  before?: string | null
  beforeId?: string | null
}): Promise<TeamCreditLedgerListResponseDto> {
  const u = apiURL(`/teams/${encodeURIComponent(teamId)}/ledger`)
  if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) u.searchParams.set('limit', String(params.limit))
  if (params?.before) u.searchParams.set('before', params.before)
  if (params?.beforeId) u.searchParams.set('beforeId', params.beforeId)
  const r = await apiFetch(u.toString(), withAuth())
  if (!r.ok) throw new Error(`list team ledger failed: ${r.status}`)
  return r.json()
}

export async function listMyTeamCreditLedger(params?: {
  limit?: number
  before?: string | null
  beforeId?: string | null
}): Promise<TeamCreditLedgerListResponseDto> {
  const u = apiURL(`/teams/me/ledger`)
  if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) u.searchParams.set('limit', String(params.limit))
  if (params?.before) u.searchParams.set('before', params.before)
  if (params?.beforeId) u.searchParams.set('beforeId', params.beforeId)
  const r = await apiFetch(u.toString(), withAuth())
  if (!r.ok) throw new Error(`list my team ledger failed: ${r.status}`)
  return r.json()
}

export async function renameTeam(teamId: string, name: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/teams/${encodeURIComponent(teamId)}`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    throw new Error(body?.error || body?.message || `rename team failed: ${r.status}`)
  }
}

export async function removeMember(teamId: string, userId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    throw new Error(body?.error || body?.message || `remove member failed: ${r.status}`)
  }
}

export async function disbandTeam(teamId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/teams/${encodeURIComponent(teamId)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    throw new Error(body?.error || body?.message || `disband team failed: ${r.status}`)
  }
}

export type TeamSubscriptionPlanFeatures = {
  concurrent_tasks_per_seat: number
  unlimited_concurrent_tasks: boolean
  canvas_collab: boolean
  shared_asset_library: boolean
  seat_management: boolean
  credit_quota_control: boolean
  fast_invoice: boolean
  creditGrants: {
    annual: TeamSubscriptionCreditGrant
  }
  presentation: {
    badge: string
    variantOrder: number
    accent: 'graphite' | 'violet' | 'blue' | 'cyan'
    featured: boolean
    campaignBenefits: string[]
    capabilities: string[]
  }
}

export type TeamSubscriptionCreditGrant = {
  includedCreditsPerSeat: number
}

export type TeamSubscriptionPlanDto = {
  id: string
  name: string
  tier: string
  maxSeats: number
  minSeats: number
  features: TeamSubscriptionPlanFeatures
  sortWeight: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type TeamPlanSubscriptionDto = {
  id: string
  teamId: string
  planId: string
  plan?: TeamSubscriptionPlanDto
  billingCycle: 'monthly' | 'annual'
  seatCount: number
  status: 'active' | 'expired' | 'cancelled'
  currentPeriodStart: string
  currentPeriodEnd: string
  nextCreditRenewalAt: string
  lastRenewedAt: string | null
  creditsPerRenewal: number
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}

export async function listTeamSubscriptionPlans(): Promise<TeamSubscriptionPlanDto[]> {
  const r = await apiFetch(`${API_BASE}/teams/subscription-plans`, withAuth())
  if (!r.ok) throw new Error(`list subscription plans failed: ${r.status}`)
  return r.json()
}

export async function listAllTeamSubscriptionPlans(): Promise<TeamSubscriptionPlanDto[]> {
  const r = await apiFetch(`${API_BASE}/teams/subscription-plans/admin/all`, withAuth())
  if (!r.ok) throw new Error(`list all team subscription plans failed: ${r.status}`)
  return r.json()
}

export type UpsertTeamSubscriptionPlanPayload = {
  id?: string
  name: string
  tier: string
  maxSeats: number
  minSeats: number
  features: TeamSubscriptionPlanFeatures
  sortWeight: number
  enabled: boolean
}

export async function upsertTeamSubscriptionPlan(
  payload: UpsertTeamSubscriptionPlanPayload,
): Promise<TeamSubscriptionPlanDto> {
  const planId = payload.id?.trim()
  const url = planId
    ? `${API_BASE}/teams/subscription-plans/admin/${encodeURIComponent(planId)}`
    : `${API_BASE}/teams/subscription-plans/admin`
  const r = await apiFetch(url, withAuth({
    method: planId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body: unknown = await r.json().catch(() => null)
    const message = body && typeof body === 'object' && !Array.isArray(body)
      ? String((body as { error?: unknown }).error || '')
      : ''
    throw new Error(message || `upsert team subscription plan failed: ${r.status}`)
  }
  return r.json()
}

export async function getTeamSubscription(teamId: string): Promise<TeamPlanSubscriptionDto | null> {
  const r = await apiFetch(`${API_BASE}/teams/${encodeURIComponent(teamId)}/subscription`, withAuth())
  if (!r.ok) throw new Error(`get team subscription failed: ${r.status}`)
  const body = await r.json().catch(() => null)
  return body ?? null
}

export async function listTeamActiveSubscriptions(teamId: string): Promise<TeamPlanSubscriptionDto[]> {
  const r = await apiFetch(`${API_BASE}/teams/${encodeURIComponent(teamId)}/subscriptions`, withAuth())
  if (!r.ok) throw new Error(`list team subscriptions failed: ${r.status}`)
  return r.json()
}

export async function cancelTeamSubscriptionById(teamId: string, subId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/teams/${encodeURIComponent(teamId)}/subscriptions/${encodeURIComponent(subId)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`cancel subscription failed: ${r.status}`)
}

export async function activateTeamSubscription(
  teamId: string,
  payload: { planId: string; billingCycle: 'annual'; seatCount: number; issueCreditsNow?: boolean },
): Promise<TeamPlanSubscriptionDto> {
  const r = await apiFetch(`${API_BASE}/teams/${encodeURIComponent(teamId)}/subscription`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    throw new Error(body?.error || body?.message || `activate subscription failed: ${r.status}`)
  }
  return r.json()
}

// Billing / plans (admin dashboard)
export type BillingModelKind = 'text' | 'image' | 'video' | 'audio'

export type BillingModelOptionDto = {
  modelKey: string
  labelZh: string
  kind: BillingModelKind
  vendor?: string
}

export type ModelCreditCostDto = {
  modelKey: string
  specKey?: string
  cost: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type NewApiModelDto = {
  id: number
  modelName: string
  requestModelKey: string
  routingAliases: string[]
  displayLabel: string
  description: string | null
  icon: string | null
  tags: string[]
  vendorId: number | null
  endpoints: string[]
  runtimeEndpoints: string[]
  kind: BillingModelKind
  enabled: boolean
  syncOfficial: boolean
  nameRule: number
  createdTime: number
  updatedTime: number
  meta: Record<string, unknown> | null
  pricing?: {
    cost: number
    enabled: boolean
    specCosts: Array<{
      specKey: string
      cost: number
      enabled: boolean
    }>
  }
  videoAnalysisPricing?: ModelOptionVideoAnalysisPricing
}

export const NewApiGatewayReadinessSchema = z.object({
  ready: z.boolean(),
  enabledModelCount: z.number().int().nonnegative(),
  configuredChannelCount: z.number().int().nonnegative(),
  executableModelCount: z.number().int().nonnegative(),
  reasons: z.array(z.enum([
    'no_enabled_models',
    'no_configured_channels',
    'no_executable_models',
  ])),
  setupUrl: z.string().url(),
  recommendedProvider: z.object({
    name: z.string().min(1),
    baseUrl: z.string().url(),
    registerUrl: z.string().url(),
    topupUrl: z.string().url(),
    tokenUrl: z.string().url(),
  }),
})

export type NewApiGatewayReadinessDto = z.infer<typeof NewApiGatewayReadinessSchema>

export async function getNewApiGatewayReadiness(): Promise<NewApiGatewayReadinessDto> {
  const r = await apiFetch(`${API_BASE}/new-api-models/readiness`, withAuth({
    method: 'GET',
    headers: { 'Cache-Control': 'no-cache' },
  }))
  if (!r.ok) {
    await throwApiError(r, `get new-api readiness failed: ${r.status}`)
  }
  return NewApiGatewayReadinessSchema.parse(await r.json())
}

export async function listBillingModels(): Promise<BillingModelOptionDto[]> {
  const r = await apiFetch(`${API_BASE}/billing/models`, withAuth())
  if (!r.ok) throw new Error(`list billing models failed: ${r.status}`)
  return r.json()
}

export async function listModelCreditCosts(): Promise<ModelCreditCostDto[]> {
  const r = await apiFetch(`${API_BASE}/billing/model-costs`, withAuth())
  if (!r.ok) throw new Error(`list model credit costs failed: ${r.status}`)
  return r.json()
}

export async function upsertModelCreditCost(payload: { modelKey: string; specKey?: string; cost: number; enabled?: boolean }): Promise<ModelCreditCostDto> {
  const r = await apiFetch(`${API_BASE}/billing/model-costs`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `upsert model credit cost failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function deleteModelCreditCost(modelKey: string, specKey?: string): Promise<void> {
  const qs = new URLSearchParams()
  if (typeof specKey === 'string' && specKey.trim()) qs.set('specKey', specKey.trim())
  const r = await apiFetch(`${API_BASE}/billing/model-costs/${encodeURIComponent(modelKey)}${qs.toString() ? `?${qs.toString()}` : ''}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `delete model credit cost failed: ${r.status}`
    throw new Error(msg)
  }
}

// 用户全局生成偏好（AI 对话入口设置：生图模型/视频模型/规格）
export type UserGenerationPrefsDto = {
  imageModel?: string
  imageSize?: string
  videoModel?: string
  videoResolution?: string
  videoAspect?: string
}

export async function getGenerationPreferences(): Promise<UserGenerationPrefsDto | null> {
  const r = await apiFetch(`${API_BASE}/auth/generation-preferences`, withAuth())
  if (!r.ok) throw new Error(`get generation preferences failed: ${r.status}`)
  const body = await r.json().catch(() => null) as { prefs?: UserGenerationPrefsDto | null } | null
  return body?.prefs ?? null
}

export async function putGenerationPreferences(prefs: UserGenerationPrefsDto): Promise<UserGenerationPrefsDto | null> {
  const r = await apiFetch(`${API_BASE}/auth/generation-preferences`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  }))
  if (!r.ok) throw new Error(`save generation preferences failed: ${r.status}`)
  const body = await r.json().catch(() => null) as { prefs?: UserGenerationPrefsDto | null } | null
  return body?.prefs ?? null
}

export async function listNewApiModels(params?: {
  enabled?: boolean
  kind?: BillingModelKind
  fresh?: boolean
  selectable?: boolean
  /**
   * Include catalog rows that back explicit node actions (for example,
   * MediaKit subtitle removal) instead of ordinary generation models.
   * The default remains generation-only so action endpoints cannot be picked
   * as a regular text/image/video model by mistake.
   */
  includeActionModels?: boolean
}): Promise<NewApiModelDto[]> {
  const u = apiURL(`/new-api-models`)
  if (typeof params?.enabled === 'boolean') u.searchParams.set('enabled', params.enabled ? 'true' : 'false')
  if (params?.kind) u.searchParams.set('kind', params.kind)
  if (params?.fresh === true) u.searchParams.set('refresh', 'true')
  if (params?.selectable === true) u.searchParams.set('selectable', 'true')
  if (params?.includeActionModels === true) u.searchParams.set('include_action_models', 'true')
  const r = await apiFetch(u.toString(), withAuth())
  if (!r.ok) {
    await throwApiError(r, `list new-api models failed: ${r.status}`)
  }
  const body: unknown = await r.json()
  if (!Array.isArray(body)) {
    const error: ApiRequestError = new Error('模型目录响应结构无效')
    error.status = 502
    error.code = 'new_api_model_list_invalid'
    error.details = { reason: 'response_not_array' }
    throw error
  }
  return body as NewApiModelDto[]
}

export async function updateNewApiModelStatus(payload: { id: number; enabled: boolean }): Promise<NewApiModelDto> {
  const r = await apiFetch(`${API_BASE}/new-api-models/status`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as { message?: string; error?: string } | null)
    const msg = body?.message || body?.error || `update new-api model status failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

// Model catalog (admin dashboard)
export type ModelCatalogVendorAuthType = 'none' | 'bearer' | 'x-api-key' | 'query'

export type ModelCatalogVendorDto = {
  key: string
  name: string
  enabled: boolean
  hasApiKey?: boolean
  baseUrlHint?: string | null
  authType?: ModelCatalogVendorAuthType
  authHeader?: string | null
  authQueryParam?: string | null
  meta?: any
  createdAt: string
  updatedAt: string
}

export type ModelCatalogVendorApiKeyStatusDto = {
  vendorKey: string
  hasApiKey: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type ModelCatalogModelDto = {
  modelKey: string
  vendorKey: string
  modelAlias?: string | null
  labelZh: string
  kind: BillingModelKind
  enabled: boolean
  meta?: any
  pricing?: {
    cost: number
    enabled: boolean
    createdAt?: string
    updatedAt?: string
    specCosts: Array<{
      specKey: string
      cost: number
      enabled: boolean
      createdAt?: string
      updatedAt?: string
    }>
  }
  createdAt: string
  updatedAt: string
}

export type ModelCatalogMappingDto = {
  id: string
  vendorKey: string
  taskKind: ProfileKind
  name: string
  enabled: boolean
  requestMapping?: any
  responseMapping?: any
  createdAt: string
  updatedAt: string
}

export type ModelCatalogImportPackageDto = {
  version: string
  exportedAt?: string
  vendors: Array<{
    vendor: {
      key: string
      name: string
      enabled?: boolean
      baseUrlHint?: string | null
      authType?: ModelCatalogVendorAuthType
      authHeader?: string | null
      authQueryParam?: string | null
      meta?: any
    }
    apiKey?: {
      apiKey: string
      enabled?: boolean
    }
    models?: Array<{
      modelKey: string
      vendorKey?: string
      modelAlias?: string | null
      labelZh: string
      kind: BillingModelKind
      enabled?: boolean
      meta?: any
      pricing?: {
        cost: number
        enabled?: boolean
        specCosts?: Array<{
          specKey: string
          cost: number
          enabled?: boolean
        }>
      }
    }>
    mappings?: Array<{
      taskKind: ProfileKind
      name: string
      enabled?: boolean
      requestProfile?: unknown
      requestMapping?: any
      responseMapping?: any
    }>
  }>
}

export type ModelCatalogImportResultDto = {
  imported: { vendors: number; models: number; mappings: number }
  errors: string[]
}

export async function listModelCatalogVendors(): Promise<ModelCatalogVendorDto[]> {
  const r = await apiFetch(`${API_BASE}/model-catalog/vendors`, withAuth())
  if (!r.ok) throw new Error(`list model catalog vendors failed: ${r.status}`)
  return r.json()
}

export async function exportModelCatalogPackage(params?: { includeApiKeys?: boolean }): Promise<ModelCatalogImportPackageDto> {
  const u = apiURL(`/model-catalog/export`)
  if (params?.includeApiKeys) u.searchParams.set('includeApiKeys', 'true')
  const r = await apiFetch(u.toString(), withAuth())
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `export model catalog failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function upsertModelCatalogVendor(payload: {
  key: string
  name: string
  enabled?: boolean
  baseUrlHint?: string | null
  authType?: ModelCatalogVendorAuthType
  authHeader?: string | null
  authQueryParam?: string | null
  meta?: any
}): Promise<ModelCatalogVendorDto> {
  const r = await apiFetch(`${API_BASE}/model-catalog/vendors`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `upsert model catalog vendor failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function deleteModelCatalogVendor(key: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/model-catalog/vendors/${encodeURIComponent(key)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `delete model catalog vendor failed: ${r.status}`
    throw new Error(msg)
  }
}

export async function upsertModelCatalogVendorApiKey(vendorKey: string, payload: { apiKey: string; enabled?: boolean }): Promise<ModelCatalogVendorApiKeyStatusDto> {
  const r = await apiFetch(`${API_BASE}/model-catalog/vendors/${encodeURIComponent(vendorKey)}/api-key`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `upsert model catalog vendor api key failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function clearModelCatalogVendorApiKey(vendorKey: string): Promise<ModelCatalogVendorApiKeyStatusDto> {
  const r = await apiFetch(`${API_BASE}/model-catalog/vendors/${encodeURIComponent(vendorKey)}/api-key`, withAuth({ method: 'DELETE' }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `clear model catalog vendor api key failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function listModelCatalogModels(params?: { vendorKey?: string; kind?: BillingModelKind; enabled?: boolean }): Promise<ModelCatalogModelDto[]> {
  const u = apiURL(`/model-catalog/models`)
  if (params?.vendorKey) u.searchParams.set('vendorKey', params.vendorKey)
  if (params?.kind) u.searchParams.set('kind', params.kind)
  if (typeof params?.enabled === 'boolean') u.searchParams.set('enabled', params.enabled ? 'true' : 'false')
  const r = await apiFetch(u.toString(), withAuth())
  if (!r.ok) throw new Error(`list model catalog models failed: ${r.status}`)
  return r.json()
}

export async function upsertModelCatalogModel(payload: {
  modelKey: string
  vendorKey: string
  modelAlias?: string | null
  labelZh: string
  kind: BillingModelKind
  enabled?: boolean
  meta?: any
  pricing?: {
    cost: number
    enabled?: boolean
    specCosts?: Array<{
      specKey: string
      cost: number
      enabled?: boolean
    }>
  }
}): Promise<ModelCatalogModelDto> {
  const r = await apiFetch(`${API_BASE}/model-catalog/models`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `upsert model catalog model failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function deleteModelCatalogModel(vendorKey: string, modelKey: string): Promise<void> {
  const u = apiURL(`/model-catalog/models/${encodeURIComponent(modelKey)}`)
  u.searchParams.set('vendorKey', vendorKey)
  const r = await apiFetch(u.toString(), withAuth({ method: 'DELETE' }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `delete model catalog model failed: ${r.status}`
    throw new Error(msg)
  }
}

export async function listModelCatalogMappings(params?: { vendorKey?: string; taskKind?: ProfileKind; enabled?: boolean }): Promise<ModelCatalogMappingDto[]> {
  const u = apiURL(`/model-catalog/mappings`)
  if (params?.vendorKey) u.searchParams.set('vendorKey', params.vendorKey)
  if (params?.taskKind) u.searchParams.set('taskKind', params.taskKind)
  if (typeof params?.enabled === 'boolean') u.searchParams.set('enabled', params.enabled ? 'true' : 'false')
  const r = await apiFetch(u.toString(), withAuth())
  if (!r.ok) throw new Error(`list model catalog mappings failed: ${r.status}`)
  return r.json()
}

export async function upsertModelCatalogMapping(payload: {
  id?: string
  vendorKey: string
  taskKind: ProfileKind
  name: string
  enabled?: boolean
  requestMapping?: any
  responseMapping?: any
}): Promise<ModelCatalogMappingDto> {
  const r = await apiFetch(`${API_BASE}/model-catalog/mappings`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `upsert model catalog mapping failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function deleteModelCatalogMapping(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/model-catalog/mappings/${encodeURIComponent(id)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `delete model catalog mapping failed: ${r.status}`
    throw new Error(msg)
  }
}

export async function importModelCatalogPackage(payload: ModelCatalogImportPackageDto): Promise<ModelCatalogImportResultDto> {
  const r = await apiFetch(`${API_BASE}/model-catalog/import`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => null as any)
    const msg = body?.message || body?.error || `import model catalog package failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function listTaskLogs(params?: {
  page?: number
  pageSize?: number
  vendor?: string | null
  userId?: string | null
  taskId?: string | null
  status?: VendorCallLogStatus | null
  taskKind?: string | null
  createdFrom?: string | null
  createdTo?: string | null
}): Promise<VendorCallLogListResponseDto> {
  const u = apiURL(`/tasks/logs`)
  if (typeof params?.page === 'number' && Number.isFinite(params.page)) u.searchParams.set('page', String(params.page))
  if (typeof params?.pageSize === 'number' && Number.isFinite(params.pageSize)) u.searchParams.set('pageSize', String(params.pageSize))
  if (params?.vendor) u.searchParams.set('vendor', params.vendor)
  if (params?.userId) u.searchParams.set('userId', params.userId)
  if (params?.taskId) u.searchParams.set('taskId', params.taskId)
  if (params?.status) u.searchParams.set('status', params.status)
  if (params?.taskKind) u.searchParams.set('taskKind', params.taskKind)
  if (params?.createdFrom) u.searchParams.set('createdFrom', params.createdFrom)
  if (params?.createdTo) u.searchParams.set('createdTo', params.createdTo)

  const r = await apiFetch(u.toString(), withAuth())
  if (!r.ok) {
    const body: unknown = await r.json().catch(() => null)
    const payload = body && typeof body === 'object' ? body as { message?: unknown; error?: unknown } : null
    const serverMessage = typeof payload?.message === 'string'
      ? payload.message
      : typeof payload?.error === 'string'
        ? payload.error
        : null
    throw new Error(serverMessage || `list task logs failed: ${r.status}`)
  }
  return r.json()
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

export type ProjectMaterialKind = 'novelDoc' | 'scriptDoc' | 'storyboardScript' | 'visualManualDoc' | 'directorManualDoc'

export type AiCharacterLibraryListResponseDto = {
  characters: AiCharacterLibraryCharacterDto[]
  total: number
  page?: number
  pageSize?: number
  syncState: AiCharacterLibrarySyncStateDto | null
}

export type AiCharacterLibraryListParams = {
  q?: string
  page?: number
  pageSize?: number
  offset?: number
  limit?: number
  projectId?: string
  withTotal?: boolean
  filterWorldview?: string | string[]
  filterTheme?: string | string[]
  gender?: string | string[]
  ageGroup?: string | string[]
  species?: string | string[]
  physique?: string | string[]
  heightLevel?: string | string[]
  skinColor?: string | string[]
  hairLength?: string | string[]
  hairColor?: string | string[]
  temperament?: string | string[]
}

export type AiCharacterLibraryImportPayload = {
  projectId?: string | null
  sourceAuthorization: string
  sourceDeviceId?: string
  sourceTimezone?: string
  sourceLanguage?: string
  sourceBrowserLocale?: string
  filterWorldview?: string | string[]
  filterTheme?: string | string[]
  gender?: string | string[]
  ageGroup?: string | string[]
  species?: string | string[]
  physique?: string | string[]
  heightLevel?: string | string[]
  skinColor?: string | string[]
  hairLength?: string | string[]
  hairColor?: string | string[]
  temperament?: string | string[]
}

export type AiCharacterLibraryImportResultDto = {
  ok: true
  totalCharacters: number
  importedCharacters: number
  updatedCharacters: number
  storedCharacters: number
  lastSyncedAt: string
}

export type AiCharacterLibraryUpsertResponseDto = {
  character: AiCharacterLibraryCharacterDto
}

export type AiCharacterLibraryJsonImportPayload = {
  projectId?: string | null
  characters: AiCharacterLibraryUpsertPayload[]
}

export type AiCharacterLibraryJsonImportResultDto = {
  ok: true
  importedCharacters: number
  updatedCharacters: number
  storedCharacters: number
  lastSyncedAt: string
}

function getClientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  } catch {
    return 'Asia/Shanghai'
  }
}

function getClientLocale(): string {
  if (typeof navigator === 'undefined') return 'zh-CN'
  return String(navigator.language || 'zh-CN').trim() || 'zh-CN'
}

const AI_CHARACTER_LIBRARY_DEVICE_ID_STORAGE_KEY = 'tapcanvas_ai_character_library_device_id'

function getAiCharacterLibraryDeviceId(): string {
  if (typeof window === 'undefined') return 'tapcanvas-web'
  try {
    const existing = window.localStorage.getItem(AI_CHARACTER_LIBRARY_DEVICE_ID_STORAGE_KEY)
    if (existing && existing.trim()) return existing.trim()
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `tapcanvas-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    window.localStorage.setItem(AI_CHARACTER_LIBRARY_DEVICE_ID_STORAGE_KEY, generated)
    return generated
  } catch {
    return 'tapcanvas-web'
  }
}

function buildAiCharacterLibraryHeaders(): Record<string, string> {
  const locale = getClientLocale()
  return {
    'X-Device-ID': getAiCharacterLibraryDeviceId(),
    'X-Timezone': getClientTimezone(),
    'X-Device-Type': 'web',
    'User-Lang': locale,
    'X-Browser-Locale': locale,
  }
}

export async function listServerAssets(input?: {
  limit?: number
  cursor?: string | null
  projectId?: string | null
  projectIds?: string[]
  kind?: string | null
  fullData?: boolean
}): Promise<{ items: ServerAssetDto[]; cursor: string | null }> {
  const qs = new URLSearchParams()
  if (input?.limit) qs.set('limit', String(input.limit))
  if (input?.cursor) qs.set('cursor', input.cursor)
  if (input?.projectId) qs.set('projectId', input.projectId)
  for (const projectId of input?.projectIds || []) {
    const normalizedProjectId = projectId.trim()
    if (normalizedProjectId) qs.append('projectId', normalizedProjectId)
  }
  if (input?.kind) qs.set('kind', input.kind)
  if (input?.fullData) qs.set('fullData', '1')
  const url = qs.toString() ? `${API_BASE}/assets?${qs.toString()}` : `${API_BASE}/assets`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`list assets failed: ${r.status}`)
  return r.json()
}

export async function getProjectDirectorySnapshot(): Promise<ProjectDirectorySnapshot> {
  const response = await apiFetch(`${API_BASE}/project-directory`, withAuth())
  if (!response.ok) await throwApiError(response, `load project directory failed: ${response.status}`)
  const body: unknown = await response.json()
  return ProjectDirectorySnapshotSchema.parse(body)
}

export async function saveProjectDirectorySnapshot(
  request: SaveProjectDirectoryRequest,
): Promise<ProjectDirectorySnapshot> {
  const payload = SaveProjectDirectoryRequestSchema.parse(request)
  const response = await apiFetch(`${API_BASE}/project-directory`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!response.ok) await throwApiError(response, `save project directory failed: ${response.status}`)
  const body: unknown = await response.json()
  return ProjectDirectorySnapshotSchema.parse(body)
}

export async function listAiCharacterLibraryCharacters(
  input?: AiCharacterLibraryListParams,
): Promise<AiCharacterLibraryListResponseDto> {
  const appendMultiValueParam = (
    searchParams: URLSearchParams,
    key: string,
    value?: string | string[],
  ): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = String(item || '').trim()
        if (!text) continue
        searchParams.append(key, text)
      }
      return
    }
    const text = String(value || '').trim()
    if (text) searchParams.set(key, text)
  }
  const qs = new URLSearchParams()
  if (typeof input?.q === 'string' && input.q.trim()) qs.set('q', input.q.trim())
  if (typeof input?.page === 'number' && Number.isFinite(input.page)) qs.set('page', String(Math.max(1, Math.trunc(input.page))))
  if (typeof input?.pageSize === 'number' && Number.isFinite(input.pageSize)) qs.set('pageSize', String(Math.max(1, Math.trunc(input.pageSize))))
  if (typeof input?.offset === 'number' && Number.isFinite(input.offset)) qs.set('offset', String(Math.max(0, Math.trunc(input.offset))))
  if (typeof input?.limit === 'number' && Number.isFinite(input.limit)) qs.set('limit', String(Math.max(1, Math.trunc(input.limit))))
  if (input?.projectId) qs.set('projectId', input.projectId)
  if (typeof input?.withTotal === 'boolean') qs.set('with_total', input.withTotal ? 'true' : 'false')
  appendMultiValueParam(qs, 'filter_worldview', input?.filterWorldview)
  appendMultiValueParam(qs, 'filter_theme', input?.filterTheme)
  appendMultiValueParam(qs, 'gender', input?.gender)
  appendMultiValueParam(qs, 'age_group', input?.ageGroup)
  appendMultiValueParam(qs, 'species', input?.species)
  appendMultiValueParam(qs, 'physique', input?.physique)
  appendMultiValueParam(qs, 'height_level', input?.heightLevel)
  appendMultiValueParam(qs, 'skin_color', input?.skinColor)
  appendMultiValueParam(qs, 'hair_length', input?.hairLength)
  appendMultiValueParam(qs, 'hair_color', input?.hairColor)
  appendMultiValueParam(qs, 'temperament', input?.temperament)
  const url = `${API_BASE}/assets/character-library/characters?${qs.toString()}`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) {
    await throwApiError(r, `list ai character library failed: ${r.status}`)
  }
  const body = await r.json() as {
    characters?: AiCharacterLibraryCharacterDto[]
    total?: number
    page?: number
    pageSize?: number
    syncState?: AiCharacterLibrarySyncStateDto | null
  }
  return {
    characters: Array.isArray(body?.characters) ? body.characters : [],
    total: typeof body?.total === 'number' && Number.isFinite(body.total) ? body.total : 0,
    page: typeof body?.page === 'number' && Number.isFinite(body.page) ? body.page : undefined,
    pageSize: typeof body?.pageSize === 'number' && Number.isFinite(body.pageSize) ? body.pageSize : undefined,
    syncState: body?.syncState ?? null,
  }
}

export async function importAiCharacterLibraryCharacters(
  payload: AiCharacterLibraryImportPayload,
): Promise<AiCharacterLibraryImportResultDto> {
  const headers = buildAiCharacterLibraryHeaders()
  const r = await apiFetch(
    `${API_BASE}/assets/character-library/import`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        sourceDeviceId: payload.sourceDeviceId || headers['X-Device-ID'],
        sourceTimezone: payload.sourceTimezone || headers['X-Timezone'],
        sourceLanguage: payload.sourceLanguage || headers['User-Lang'],
        sourceBrowserLocale: payload.sourceBrowserLocale || headers['X-Browser-Locale'],
      }),
    }),
  )
  if (!r.ok) {
    await throwApiError(r, `import ai character library failed: ${r.status}`)
  }
  return await r.json() as AiCharacterLibraryImportResultDto
}

export async function createAiCharacterLibraryCharacter(
  payload: AiCharacterLibraryUpsertPayload,
): Promise<AiCharacterLibraryCharacterDto> {
  const r = await apiFetch(
    `${API_BASE}/assets/character-library/characters`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  if (!r.ok) {
    await throwApiError(r, `create ai character library character failed: ${r.status}`)
  }
  const body = await r.json() as AiCharacterLibraryUpsertResponseDto
  return body.character
}

export async function updateAiCharacterLibraryCharacter(
  id: string,
  payload: AiCharacterLibraryUpsertPayload,
): Promise<AiCharacterLibraryCharacterDto> {
  const r = await apiFetch(
    `${API_BASE}/assets/character-library/characters/${encodeURIComponent(id)}`,
    withAuth({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  if (!r.ok) {
    await throwApiError(r, `update ai character library character failed: ${r.status}`)
  }
  const body = await r.json() as AiCharacterLibraryUpsertResponseDto
  return body.character
}

export async function deleteAiCharacterLibraryCharacter(id: string): Promise<void> {
  const r = await apiFetch(
    `${API_BASE}/assets/character-library/characters/${encodeURIComponent(id)}`,
    withAuth({ method: 'DELETE' }),
  )
  if (!r.ok) {
    await throwApiError(r, `delete ai character library character failed: ${r.status}`)
  }
}

export async function importAiCharacterLibraryJson(
  payload: AiCharacterLibraryJsonImportPayload,
): Promise<AiCharacterLibraryJsonImportResultDto> {
  const r = await apiFetch(
    `${API_BASE}/assets/character-library/import-json`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  if (!r.ok) {
    await throwApiError(r, `import ai character library json failed: ${r.status}`)
  }
  return await r.json() as AiCharacterLibraryJsonImportResultDto
}

export async function createServerAsset(payload: { name: string; data: unknown; projectId?: string | null }): Promise<ServerAssetDto> {
  const r = await apiFetch(`${API_BASE}/assets`, withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))
  if (!r.ok) throw new Error(`create asset failed: ${r.status}`)
  return r.json()
}

export type ProjectRoleCardAssetData = {
  kind: 'projectRoleCard'
  roleName: string
  roleNameKey: string
  stateDescription?: string
  stateKey?: string
  ageDescription?: string
  stateLabel?: string
  healthStatus?: string
  injuryStatus?: string
  roleId?: string
  cardId?: string
  chapter?: number
  chapterStart?: number
  chapterEnd?: number
  chapterSpan?: number[]
  nodeId?: string
  prompt?: string
  status?: 'draft' | 'generated'
  modelKey?: string
  imageUrl?: string
  threeViewImageUrl?: string
  confirmationMode?: 'auto' | 'manual' | null
  confirmedAt?: string | null
  confirmedBy?: string | null
  createdAt?: string
  updatedAt?: string
}

export type ProjectRoleCardAssetDto = ServerAssetDto & {
  data: ProjectRoleCardAssetData
}

function normalizeRoleKey(raw: string): string {
  return String(raw || '').trim().toLowerCase()
}

function normalizeRoleCardStateKey(raw: string): string {
  return normalizeRoleKey(String(raw || '').replace(/\s+/g, ' '))
}

function normalizePositiveChapterNumber(value: unknown): number | undefined {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return Math.trunc(numeric)
}

function normalizeChapterHintsArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.trunc(item))
}

function buildProjectRoleCardScopeKey(input: {
  roleNameKey: string
  roleId?: string
  stateKey?: string
  chapter?: number
  chapterStart?: number
  chapterEnd?: number
  chapterSpan?: number[]
}): string {
  const roleKey = normalizeRoleKey(String(input.roleId || '').trim() || input.roleNameKey)
  const stateKey = normalizeRoleCardStateKey(input.stateKey || '')
  const chapterSpan = normalizeChapterHintsArray(input.chapterSpan)
  const chapterScope = chapterSpan.length > 0
    ? `span:${chapterSpan.join(',')}`
    : (() => {
        const chapter = normalizePositiveChapterNumber(input.chapter)
        const chapterStart = normalizePositiveChapterNumber(input.chapterStart) ?? chapter
        const chapterEnd = normalizePositiveChapterNumber(input.chapterEnd) ?? chapterStart
        if (typeof chapterStart === 'number' && typeof chapterEnd === 'number') return `range:${chapterStart}-${chapterEnd}`
        if (typeof chapter === 'number') return `chapter:${chapter}`
        return 'range:0-0'
      })()
  return `${roleKey}#state:${stateKey || 'default'}#${chapterScope}`
}

function parseProjectRoleCardData(data: unknown): ProjectRoleCardAssetData | null {
  if (!data || typeof data !== 'object') return null
  const raw = data as Record<string, unknown>
  const kind = String(raw.kind || '').trim()
  const roleName = String(raw.roleName || '').trim()
  if (kind !== 'projectRoleCard' || !roleName) return null
  const roleNameKey = normalizeRoleKey(String(raw.roleNameKey || roleName))
  if (!roleNameKey) return null
  const stateDescription = String(raw.stateDescription || '').trim()
  const stateKey = normalizeRoleCardStateKey(String(raw.stateKey || stateDescription))
  const ageDescription = String(raw.ageDescription || '').trim()
  const stateLabel = String(raw.stateLabel || '').trim()
  const healthStatus = String(raw.healthStatus || '').trim()
  const injuryStatus = String(raw.injuryStatus || '').trim()
  const chapter = normalizePositiveChapterNumber(raw.chapter)
  const chapterStart = normalizePositiveChapterNumber(raw.chapterStart)
  const chapterEnd = normalizePositiveChapterNumber(raw.chapterEnd)
  const chapterSpan = normalizeChapterHintsArray(raw.chapterSpan)
  return {
    kind: 'projectRoleCard',
    roleName,
    roleNameKey,
    ...(stateDescription ? { stateDescription } : {}),
    ...(stateKey ? { stateKey } : {}),
    ...(ageDescription ? { ageDescription } : {}),
    ...(stateLabel ? { stateLabel } : {}),
    ...(healthStatus ? { healthStatus } : {}),
    ...(injuryStatus ? { injuryStatus } : {}),
    ...(String(raw.roleId || '').trim() ? { roleId: String(raw.roleId).trim() } : {}),
    ...(String(raw.cardId || '').trim() ? { cardId: String(raw.cardId).trim() } : {}),
    ...(typeof chapter === 'number' ? { chapter } : {}),
    ...(typeof chapterStart === 'number' ? { chapterStart } : {}),
    ...(typeof chapterEnd === 'number' ? { chapterEnd } : {}),
    ...(chapterSpan.length > 0 ? { chapterSpan } : {}),
    ...(String(raw.nodeId || '').trim() ? { nodeId: String(raw.nodeId).trim() } : {}),
    ...(String(raw.prompt || '').trim() ? { prompt: String(raw.prompt).trim() } : {}),
    ...(String(raw.status || '').trim() === 'generated' ? { status: 'generated' as const } : {}),
    ...(String(raw.modelKey || '').trim() ? { modelKey: String(raw.modelKey).trim() } : {}),
    ...(String(raw.imageUrl || '').trim() ? { imageUrl: String(raw.imageUrl).trim() } : {}),
    ...(String(raw.threeViewImageUrl || '').trim() ? { threeViewImageUrl: String(raw.threeViewImageUrl).trim() } : {}),
    ...(raw.confirmationMode === 'auto' || raw.confirmationMode === 'manual'
      ? { confirmationMode: raw.confirmationMode }
      : {}),
    ...(typeof raw.confirmedAt === 'string' ? { confirmedAt: String(raw.confirmedAt).trim() || null } : {}),
    ...(typeof raw.confirmedBy === 'string' ? { confirmedBy: String(raw.confirmedBy).trim() || null } : {}),
    ...(String(raw.createdAt || '').trim() ? { createdAt: String(raw.createdAt).trim() } : {}),
    ...(String(raw.updatedAt || '').trim() ? { updatedAt: String(raw.updatedAt).trim() } : {}),
  }
}

const projectRoleCardAssetsCache = new Map<string, ProjectRoleCardAssetDto[]>()
const projectRoleCardAssetsInFlight = new Map<string, Promise<ProjectRoleCardAssetDto[]>>()

function cloneProjectRoleCardAssets(items: ProjectRoleCardAssetDto[]): ProjectRoleCardAssetDto[] {
  return items.map((item) => ({
    ...item,
    data: item?.data ? { ...item.data } : item.data,
  }))
}

function invalidateProjectRoleCardAssetsCache(projectId?: string): void {
  const key = String(projectId || '').trim()
  if (key) {
    projectRoleCardAssetsCache.delete(key)
    projectRoleCardAssetsInFlight.delete(key)
    return
  }
  projectRoleCardAssetsCache.clear()
  projectRoleCardAssetsInFlight.clear()
}

export async function listProjectRoleCardAssets(projectId: string): Promise<ProjectRoleCardAssetDto[]> {
  const projectIdTrimmed = String(projectId || '').trim()
  if (!projectIdTrimmed) return []
  const cached = projectRoleCardAssetsCache.get(projectIdTrimmed)
  if (cached) return cloneProjectRoleCardAssets(cached)

  const inFlight = projectRoleCardAssetsInFlight.get(projectIdTrimmed)
  if (inFlight) return inFlight

  const request = (async (): Promise<ProjectRoleCardAssetDto[]> => {
    const { items } = await listServerAssets({ projectId: projectIdTrimmed, kind: 'projectRoleCard', limit: 200 })
    const normalized = items
      .map((item) => {
        const parsed = parseProjectRoleCardData(item?.data)
        if (!parsed) return null
        return { ...item, data: parsed } as ProjectRoleCardAssetDto
      })
      .filter(Boolean) as ProjectRoleCardAssetDto[]
    projectRoleCardAssetsCache.set(projectIdTrimmed, normalized)
    return cloneProjectRoleCardAssets(normalized)
  })().finally(() => {
    projectRoleCardAssetsInFlight.delete(projectIdTrimmed)
  })
  projectRoleCardAssetsInFlight.set(projectIdTrimmed, request)
  return request
}

export async function upsertProjectRoleCardAsset(
  projectId: string,
  payload: {
    cardId?: string
    characterBibleId?: string
    roleId?: string
    roleName: string
    stateDescription?: string
    stateKey?: string
    ageDescription?: string
    stateLabel?: string
    healthStatus?: string
    injuryStatus?: string
    chapter?: number
    chapterStart?: number
    chapterEnd?: number
    chapterSpan?: number[]
    nodeId?: string
    prompt?: string
    status?: 'draft' | 'generated'
    modelKey?: string
    imageUrl?: string
    threeViewImageUrl?: string
  },
): Promise<ProjectRoleCardAssetDto> {
  const projectIdTrimmed = String(projectId || '').trim()
  const roleName = String(payload.roleName || '').trim()
  if (!projectIdTrimmed) throw new Error('projectId is required')
  if (!roleName) throw new Error('roleName is required')

  const roleNameKey = normalizeRoleKey(roleName)
  const stateDescription = String(payload.stateDescription || '').trim()
  const stateKey = normalizeRoleCardStateKey(String(payload.stateKey || stateDescription))
  const ageDescription = String(payload.ageDescription || '').trim()
  const stateLabel = String(payload.stateLabel || '').trim()
  const healthStatus = String(payload.healthStatus || '').trim()
  const injuryStatus = String(payload.injuryStatus || '').trim()
  const chapter = normalizePositiveChapterNumber(payload.chapter)
  const chapterStart = normalizePositiveChapterNumber(payload.chapterStart)
  const chapterEnd = normalizePositiveChapterNumber(payload.chapterEnd)
  const chapterSpan = normalizeChapterHintsArray(payload.chapterSpan)
  const roleIdKey = normalizeRoleKey(String(payload.roleId || ''))
  const cardIdKey = normalizeRoleKey(String(payload.cardId || ''))
  const targetScopeKey = buildProjectRoleCardScopeKey({
    roleNameKey,
    ...(roleIdKey ? { roleId: roleIdKey } : {}),
    ...(stateKey ? { stateKey } : {}),
    ...(typeof chapter === 'number' ? { chapter } : {}),
    ...(typeof chapterStart === 'number' ? { chapterStart } : {}),
    ...(typeof chapterEnd === 'number' ? { chapterEnd } : {}),
    ...(chapterSpan.length > 0 ? { chapterSpan } : {}),
  })
  const all = await listProjectRoleCardAssets(projectIdTrimmed)
  const matched =
    all.find((item) => cardIdKey && normalizeRoleKey(String(item.data?.cardId || '')) === cardIdKey) ||
    all.find((item) => roleIdKey && buildProjectRoleCardScopeKey({
      roleNameKey: normalizeRoleKey(String(item.data?.roleNameKey || item.data?.roleName || '')),
      roleId: normalizeRoleKey(String(item.data?.roleId || '')),
      stateKey: String(item.data?.stateKey || item.data?.stateDescription || ''),
      chapter: item.data?.chapter,
      chapterStart: item.data?.chapterStart,
      chapterEnd: item.data?.chapterEnd,
      chapterSpan: item.data?.chapterSpan,
    }) === targetScopeKey) ||
    all.find((item) => buildProjectRoleCardScopeKey({
      roleNameKey: normalizeRoleKey(String(item.data?.roleNameKey || item.data?.roleName || '')),
      roleId: normalizeRoleKey(String(item.data?.roleId || '')),
      stateKey: String(item.data?.stateKey || item.data?.stateDescription || ''),
      chapter: item.data?.chapter,
      chapterStart: item.data?.chapterStart,
      chapterEnd: item.data?.chapterEnd,
      chapterSpan: item.data?.chapterSpan,
    }) === targetScopeKey) ||
    null

  const nowIso = new Date().toISOString()
  const prev = matched?.data || null
  const hasExecutableAsset = Boolean(
    String(payload.threeViewImageUrl || payload.imageUrl || prev?.threeViewImageUrl || prev?.imageUrl || '').trim(),
  )
  const nextStatus = payload.status || prev?.status || 'generated'
  const nextConfirmationMode =
    prev?.confirmationMode === 'manual' && prev?.confirmedAt
      ? 'manual'
      : nextStatus === 'generated' && hasExecutableAsset
        ? 'auto'
        : prev?.confirmationMode || null
  const nextData: ProjectRoleCardAssetData = {
    kind: 'projectRoleCard',
    roleName,
    roleNameKey,
    ...(stateDescription || prev?.stateDescription ? { stateDescription: stateDescription || String(prev?.stateDescription || '').trim() } : {}),
    ...(stateKey || prev?.stateKey ? { stateKey: stateKey || String(prev?.stateKey || '').trim() } : {}),
    ...(ageDescription || prev?.ageDescription ? { ageDescription: ageDescription || String(prev?.ageDescription || '').trim() } : {}),
    ...(stateLabel || prev?.stateLabel ? { stateLabel: stateLabel || String(prev?.stateLabel || '').trim() } : {}),
    ...(healthStatus || prev?.healthStatus ? { healthStatus: healthStatus || String(prev?.healthStatus || '').trim() } : {}),
    ...(injuryStatus || prev?.injuryStatus ? { injuryStatus: injuryStatus || String(prev?.injuryStatus || '').trim() } : {}),
    ...(String(payload.roleId || prev?.roleId || '').trim() ? { roleId: String(payload.roleId || prev?.roleId).trim() } : {}),
    ...(String(payload.cardId || prev?.cardId || matched?.id || '').trim() ? { cardId: String(payload.cardId || prev?.cardId || matched?.id).trim() } : {}),
    ...(typeof chapter === 'number' ? { chapter } : typeof prev?.chapter === 'number' ? { chapter: prev.chapter } : {}),
    ...(typeof chapterStart === 'number' ? { chapterStart } : typeof prev?.chapterStart === 'number' ? { chapterStart: prev.chapterStart } : {}),
    ...(typeof chapterEnd === 'number' ? { chapterEnd } : typeof prev?.chapterEnd === 'number' ? { chapterEnd: prev.chapterEnd } : {}),
    ...(chapterSpan.length > 0 ? { chapterSpan } : Array.isArray(prev?.chapterSpan) && prev.chapterSpan.length > 0 ? { chapterSpan: prev.chapterSpan } : {}),
    ...(String(payload.nodeId || prev?.nodeId || '').trim() ? { nodeId: String(payload.nodeId || prev?.nodeId).trim() } : {}),
    ...(String(payload.prompt || prev?.prompt || '').trim() ? { prompt: String(payload.prompt || prev?.prompt).trim() } : {}),
    ...(String(payload.modelKey || prev?.modelKey || '').trim() ? { modelKey: String(payload.modelKey || prev?.modelKey).trim() } : {}),
    ...(String(payload.imageUrl || prev?.imageUrl || '').trim() ? { imageUrl: String(payload.imageUrl || prev?.imageUrl).trim() } : {}),
    ...(String(payload.threeViewImageUrl || prev?.threeViewImageUrl || '').trim() ? { threeViewImageUrl: String(payload.threeViewImageUrl || prev?.threeViewImageUrl).trim() } : {}),
    status: nextStatus,
    ...(nextConfirmationMode ? { confirmationMode: nextConfirmationMode } : {}),
    ...(nextStatus === 'generated' && hasExecutableAsset
      ? { confirmedAt: prev?.confirmationMode === 'manual' && prev?.confirmedAt ? prev.confirmedAt : nowIso }
      : typeof prev?.confirmedAt === 'string'
        ? { confirmedAt: prev.confirmedAt }
        : {}),
    ...(nextStatus === 'generated' && hasExecutableAsset
      ? { confirmedBy: prev?.confirmationMode === 'manual' && prev?.confirmedBy ? prev.confirmedBy : 'system' }
      : typeof prev?.confirmedBy === 'string'
        ? { confirmedBy: prev.confirmedBy }
        : {}),
    createdAt: prev?.createdAt || nowIso,
    updatedAt: nowIso,
  }

  if (matched?.id) {
    const updated = await updateServerAssetData(matched.id, nextData)
    invalidateProjectRoleCardAssetsCache(projectIdTrimmed)
    return { ...updated, data: nextData } as ProjectRoleCardAssetDto
  }

  const created = await createServerAsset({
    projectId: projectIdTrimmed,
    name: `角色卡 · ${roleName}`,
    data: nextData,
  })
  const createdData: ProjectRoleCardAssetData = {
    ...nextData,
    cardId: nextData.cardId || created.id,
  }
  if (!nextData.cardId) {
    const patched = await updateServerAssetData(created.id, createdData)
    invalidateProjectRoleCardAssetsCache(projectIdTrimmed)
    return { ...patched, data: createdData } as ProjectRoleCardAssetDto
  }
  invalidateProjectRoleCardAssetsCache(projectIdTrimmed)
  return { ...created, data: createdData } as ProjectRoleCardAssetDto
}

export async function ingestProjectMaterial(payload: {
  projectId: string
  kind: 'novelDoc' | 'scriptDoc' | 'storyboardScript'
  name: string
  content: string
  chapter?: number | null
}): Promise<{ ok: boolean; mode?: string; baseAssetId?: string; chaptersCreated?: number }> {
  const r = await apiFetch(`${API_BASE}/assets/ingest-material`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    let msg = `ingest material failed: ${r.status}`
    try {
      const body: any = await r.json()
      msg = body?.message || body?.error || msg
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
  return r.json()
}

export type ProjectBookListItemDto = {
  bookId: string
  title: string
  chapterCount: number
  updatedAt: string
}

export type ProjectBookStoryboardHistoryDto = {
  ok: true
  bookId: string
  progress: {
    totalShots?: number
    completedShots?: number
    progress01?: number
    next?: {
      taskId: string
      chapter?: number
      nextShotStart: number
      nextShotEnd: number
      groupSize: 1 | 4 | 9 | 25
    } | null
    updatedAt?: string
    updatedBy?: string
  } | null
  total: number
  items: Array<{
    version: 1
    projectId: string
    bookId: string
    taskId: string
    chapter?: number
    chunkId: string
    chunkIndex: number
    groupSize: 1 | 4 | 9 | 25
    shotNo: number
    shotIndexInChunk: number
    script: string
    imageUrl: string
    selectedImageUrl?: string
    selectedCandidateId?: string
    imageCandidates?: Array<{
      candidateId: string
      imageUrl: string
      source: 'generated' | 'edited'
      selected: boolean
      createdAt: string
      createdBy: string
      vendor?: string
      taskId?: string
    }>
    selectionHistory?: Array<{
      candidateId: string
      imageUrl: string
      source: 'generated' | 'edited'
      selectedAt: string
      selectedBy: string
    }>
    references: Array<{ label: string; url: string }>
    roleCardAnchors: Array<{ cardId: string; roleName: string; imageUrl: string; source: 'chunk_anchor' | 'shot_match' }>
    modelThinking: Record<string, unknown>
    worldEvolutionThinking: string
    createdAt: string
    updatedAt: string
    updatedBy: string
  }>
}

export type ProjectBookIndexDto = {
  bookId: string
  projectId: string
  title: string
  chapterCount: number
  updatedAt: string
  processedBy?: string
  rawPath: string
  source?: {
    schemaVersion: 'book-source/v1'
    originalFileName: string
    format: 'plain_text' | 'docx' | 'epub'
    mediaType: string
    sourceByteLength: number
    sourceSha256: string
    sourceTextSha256: string
    sourceEncoding: 'utf-8' | 'package-xml'
    extractedDocumentCount: number
    storedPath?: string
  }
  evidenceIndex?: {
    schemaVersion: 'book-evidence-index/v1'
    path: string
    sourceTextSha256: string
    segmentCount: number
    builtAt: string
  }
  assets?: {
    characters: Array<{ name: string; description?: string }>
    characterBibles?: Array<CharacterBible & { roleCardId?: string }>
    roleCards?: Array<{
      cardId: string
      characterBibleId?: string
      roleId?: string
      roleName: string
      referenceKind?: 'single_character' | 'group_cast'
      promptSchemaVersion?: string
      generatedFrom?: string
      stateDescription?: string
      stateKey?: string
      ageDescription?: string
      stateLabel?: string
      healthStatus?: string
      injuryStatus?: string
      chapter?: number
      chapterStart?: number
      chapterEnd?: number
      chapterSpan?: number[]
      nodeId?: string
      prompt?: string
      status: 'draft' | 'generated'
      modelKey?: string
      imageUrl?: string
      threeViewImageUrl?: string
      confirmationMode?: 'auto' | 'manual' | null
      confirmedAt?: string | null
      confirmedBy?: string | null
      createdAt: string
      updatedAt: string
      createdBy: string
      updatedBy: string
    }>
    visualRefs?: Array<{
      refId: string
      category: 'scene_prop' | 'spell_fx'
      name: string
      referenceKind?: 'scene_prop_grid' | 'spell_fx'
      promptSchemaVersion?: string
      generatedFrom?: string
      chapter?: number
      chapterStart?: number
      chapterEnd?: number
      chapterSpan?: number[]
      tags?: string[]
      stateDescription?: string
      stateKey?: string
      nodeId?: string
      prompt?: string
      status: 'draft' | 'generated'
      modelKey?: string
      imageUrl?: string
      confirmationMode?: 'auto' | 'manual' | null
      confirmedAt?: string | null
      confirmedBy?: string | null
      createdAt: string
      updatedAt: string
      createdBy: string
      updatedBy: string
    }>
    semanticAssets?: Array<{
      semanticId: string
      mediaKind: 'image' | 'video'
      status: 'draft' | 'generated'
      nodeId?: string
      nodeKind?: string
      taskId?: string
      planId?: string
      chunkId?: string
      imageUrl?: string
      videoUrl?: string
      thumbnailUrl?: string
      chapter?: number
      chapterStart?: number
      chapterEnd?: number
      chapterSpan?: number[]
      shotNo?: number
      stateDescription?: string
      prompt?: string
      anchorBindings?: PublicFlowAnchorBinding[]
      productionLayer?: string
      creationStage?: string
      approvalStatus?: string
      confirmationMode?: 'auto' | 'manual' | null
      confirmedAt?: string | null
      confirmedBy?: string | null
      createdAt: string
      updatedAt: string
      createdBy: string
      updatedBy: string
    }>
    characterProfiles?: Array<{
      name: string
      description?: string
      importance?: 'main' | 'supporting' | 'minor'
      firstChapter?: number
      lastChapter?: number
      chapterSpan?: number[]
      stageForms?: Array<{
        stage: string
        look?: string
        costume?: string
        props?: string[]
        emotion?: string
        chapterHints?: number[]
      }>
    }>
    props: Array<{ name: string; description?: string }>
    scenes: Array<{ name: string; description?: string }>
    locations: Array<{ name: string; description?: string }>
    characterGraph?: {
      nodes: Array<{
        id: string
        name: string
        importance?: 'main' | 'supporting' | 'minor'
        firstChapter?: number
        lastChapter?: number
        chapterSpan?: number[]
        unlockChapter?: number
      }>
      edges: Array<{
        sourceId: string
        targetId: string
        relation:
          | 'coappear'
          | 'family'
          | 'parent_child'
          | 'siblings'
          | 'mentor_disciple'
          | 'alliance'
          | 'friend'
          | 'lover'
          | 'rival'
          | 'enemy'
          | 'colleague'
          | 'master_servant'
          | 'betrayal'
          | 'conflict'
        weight: number
        chapterHints: number[]
      }>
    }
    styleBible?: {
      styleId: string
      styleName: string
      styleLocked: boolean
      mainCharacterCardsConfirmedAt?: string | null
      mainCharacterCardsConfirmedBy?: string | null
      confirmedAt?: string | null
      confirmedBy?: string | null
      visualDirectives: string[]
      negativeDirectives: string[]
      consistencyRules: string[]
      referenceImages?: string[]
      characterPromptTemplate: string
    }
    storyboardPlans?: Array<{
      planId: string
      taskId: string
      chapter?: number
      taskTitle?: string
      mode: 'single' | 'full'
      groupSize: 1 | 4 | 9 | 25
      outputAssetId?: string
      runId?: string
      storyboardContent?: string
      storyboardArtifact: Record<string, unknown>
      artifactSha256: string
      storyboardStructured: StoryboardStructuredData
      shotPrompts: string[]
      nextChunkIndexByGroup?: {
        '1'?: number
        '4'?: number
        '9'?: number
        '25'?: number
      }
      createdAt: string
      updatedAt: string
      createdBy: string
      updatedBy: string
    }>
    storyboardChunks?: Array<{
      chunkId: string
      planId: string
      previousChunkId?: string
      taskId: string
      chapter?: number
      groupSize: 1 | 4 | 9 | 25
      chunkIndex: number
      shotStart: number
      shotEnd: number
      nodeId?: string
      prompt?: string
      storyboardArtifact: Record<string, unknown>
      artifactSha256: string
      storyboardStructured: StoryboardStructuredData
      shotPrompts: string[]
      frameUrls: string[]
      tailFrameUrl: string
      roleCardRefIds?: string[]
      scenePropRefId?: string
      scenePropRefLabel?: string
      spellFxRefId?: string
      spellFxRefLabel?: string
      createdAt: string
      updatedAt: string
      createdBy: string
      updatedBy: string
    }>
  }
  chapters: Array<{
    chapter: number
    title: string
    startLine: number
    endLine: number
    startOffset: number
    endOffset: number
    length: number
    summary?: string
    keywords?: string[]
    coreConflict?: string
    characters?: Array<{ name: string; description?: string }>
    props?: Array<{
      name: string
      description?: string
      narrativeImportance?: 'critical' | 'supporting' | 'background'
      visualNeed?: 'must_render' | 'shared_scene_only' | 'mention_only'
      functionTags?: Array<'plot_trigger' | 'combat' | 'threat' | 'identity_marker' | 'continuity_anchor' | 'transaction' | 'environment_clutter'>
      reusableAssetPreferred?: boolean
      independentlyFramable?: boolean
    }>
    scenes?: Array<{ name: string; description?: string }>
    locations?: Array<{ name: string; description?: string }>
  }>
}

export async function upsertProjectBookStoryboardPlan(
  projectId: string,
  bookId: string,
  payload: {
    planId?: string
    taskId: string
    chapter?: number
    taskTitle?: string
    mode: 'single' | 'full'
    groupSize: 1 | 4 | 9 | 25
    outputAssetId?: string
    runId?: string
    storyboardStructured: Record<string, unknown>
    shotPrompts?: string[]
    nextChunkIndexByGroup?: {
      '1'?: number
      '4'?: number
      '9'?: number
      '25'?: number
    }
  },
): Promise<{ ok: boolean; planId: string; storyboardPlans: NonNullable<ProjectBookIndexDto['assets']>['storyboardPlans'] }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/storyboard-plans/upsert?projectId=${encodeURIComponent(projectId)}`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  if (!r.ok) throw new Error(`upsert project book storyboard plan failed: ${r.status}`)
  return r.json()
}

export async function upsertProjectBookStoryboardChunk(
  projectId: string,
  bookId: string,
  payload: {
    chunkId?: string
    planId: string
    previousChunkId?: string
    taskId: string
    chapter?: number
    groupSize: 1 | 4 | 9 | 25
    chunkIndex: number
    shotStart: number
    shotEnd: number
    nodeId?: string
    storyboardStructured: Record<string, unknown>
    shotPrompts?: string[]
    frameUrls: string[]
    tailFrameUrl: string
    roleCardRefIds?: string[]
    scenePropRefId?: string
    scenePropRefLabel?: string
    spellFxRefId?: string
    spellFxRefLabel?: string
  },
): Promise<{ ok: boolean; chunkId: string; storyboardChunks: NonNullable<ProjectBookIndexDto['assets']>['storyboardChunks'] }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/storyboard-chunks/upsert?projectId=${encodeURIComponent(projectId)}`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  if (!r.ok) throw new Error(`upsert project book storyboard chunk failed: ${r.status}`)
  return r.json()
}

export async function ingestProjectBook(payload: {
  projectId: string
  title: string
  content: string
}): Promise<{ ok: boolean; bookId: string; title: string; chapterCount: number }> {
  const r = await apiFetch(`${API_BASE}/assets/books/ingest`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `ingest project book failed: ${r.status}`)
  return r.json()
}

export async function startProjectBookUploadSession(payload: {
  projectId: string
  title: string
  sourceFileName: string
  contentBytes: number
}): Promise<{ ok: boolean; uploadId: string; projectId: string; title: string; sourceFileName: string }> {
  const r = await apiFetch(`${API_BASE}/assets/books/upload/start`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, `start project book upload failed: ${r.status}`)
  return r.json()
}

export async function appendProjectBookUploadChunk(payload: {
  projectId: string
  uploadId: string
  offset: number
  chunk: Blob
}): Promise<{ ok: boolean; uploadId: string; bytes: number }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/upload/${encodeURIComponent(payload.uploadId)}/append?projectId=${encodeURIComponent(payload.projectId)}&offset=${encodeURIComponent(String(payload.offset))}`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: payload.chunk,
    }),
  )
  if (!r.ok) await throwApiError(r, `append project book upload chunk failed: ${r.status}`)
  return r.json()
}

export async function finishProjectBookUploadSession(payload: {
  projectId: string
  uploadId: string
  strictAgents?: boolean
}): Promise<{ ok: boolean; job: ProjectBookUploadJobDto }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/upload/${encodeURIComponent(payload.uploadId)}/finish?projectId=${encodeURIComponent(payload.projectId)}`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strictAgents: payload.strictAgents !== false }),
    }),
  )
  if (!r.ok) await throwApiError(r, `finish project book upload failed: ${r.status}`)
  return r.json()
}

export type ProjectBookUploadJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type ProjectBookReconfirmJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type ProjectBookUploadJobDto = {
  id: string
  projectId: string
  uploadId: string
  title: string
  status: ProjectBookUploadJobStatus
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  progress?: {
    phase: string
    percent: number
    message?: string
    totalChapters?: number
    processedChapters?: number
  } | null
  result?: {
    ok: true
    bookId: string
    title: string
    chapterCount: number
    processedBy?: string
    warnings?: string[]
  }
  error?: { code?: string; message?: string; details?: unknown } | null
}

export type ProjectBookReconfirmJobDto = {
  id: string
  bookId: string
  projectId: string
  title: string
  mode: 'standard' | 'deep'
  status: ProjectBookReconfirmJobStatus
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  progress?: {
    phase: string
    percent: number
    message?: string
    totalChapters?: number
    processedChapters?: number
  } | null
  result?: {
    ok: true
    bookId: string
    title: string
    chapterCount: number
    processedBy?: string
    warnings?: string[]
  }
  error?: { code?: string; message?: string; details?: unknown } | null
}

export async function getLatestProjectBookUploadJob(projectId: string): Promise<{ job: ProjectBookUploadJobDto | null }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/upload/jobs/latest?projectId=${encodeURIComponent(projectId)}`,
    withAuth(),
  )
  if (!r.ok) await throwApiError(r, `get latest project book upload job failed: ${r.status}`)
  return r.json()
}

export async function getProjectBookUploadJob(projectId: string, jobId: string): Promise<{ job: ProjectBookUploadJobDto | null }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/upload/jobs/${encodeURIComponent(jobId)}?projectId=${encodeURIComponent(projectId)}`,
    withAuth(),
  )
  if (!r.ok) await throwApiError(r, `get project book upload job failed: ${r.status}`)
  return r.json()
}

export async function updateProjectBook(payload: {
  projectId: string
  bookId: string
  title?: string
  content: string
}): Promise<{ ok: boolean; bookId: string; title: string; chapterCount: number; updatedAt?: string }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(payload.bookId)}/update?projectId=${encodeURIComponent(payload.projectId)}`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: payload.title,
        content: payload.content,
      }),
    }),
  )
  if (!r.ok) await throwApiError(r, `update project book failed: ${r.status}`)
  return r.json()
}

export async function reconfirmProjectBook(
  projectId: string,
  bookId: string,
  options?: { mode?: 'standard' | 'deep'; async?: boolean },
): Promise<{
  ok: boolean
  async?: boolean
  bookId?: string
  title?: string
  chapterCount?: number
  updatedAt?: string
  index?: ProjectBookIndexDto
  mode?: 'standard' | 'deep'
  job?: ProjectBookReconfirmJobDto
}> {
  const mode = options?.mode === 'deep' ? 'deep' : 'standard'
  const asyncMode = typeof options?.async === 'boolean' ? options.async : mode === 'deep'
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/reconfirm?projectId=${encodeURIComponent(projectId)}`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, async: asyncMode }),
    }),
  )
  if (!r.ok) await throwApiError(r, `reconfirm project book failed: ${r.status}`)
  return r.json()
}

export async function getLatestProjectBookReconfirmJob(
  projectId: string,
  bookId?: string,
): Promise<{ job: ProjectBookReconfirmJobDto | null }> {
  const query = new URLSearchParams({ projectId })
  if (bookId) query.set('bookId', bookId)
  const r = await apiFetch(
    `${API_BASE}/assets/books/reconfirm/jobs/latest?${query.toString()}`,
    withAuth(),
  )
  if (!r.ok) await throwApiError(r, `get latest project book reconfirm job failed: ${r.status}`)
  return r.json()
}

export async function getProjectBookReconfirmJob(
  projectId: string,
  jobId: string,
): Promise<{ job: ProjectBookReconfirmJobDto | null }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/reconfirm/jobs/${encodeURIComponent(jobId)}?projectId=${encodeURIComponent(projectId)}`,
    withAuth(),
  )
  if (!r.ok) await throwApiError(r, `get project book reconfirm job failed: ${r.status}`)
  return r.json()
}

export async function ensureProjectBookMetadataWindow(
  projectId: string,
  bookId: string,
  payload: {
    chapter: number
    mode?: 'standard' | 'deep'
    windowSize?: number
    forceRefreshChapter?: boolean
  },
): Promise<{
  ok: boolean
  bookId: string
  projectId: string
  chapter: number
  mode: 'standard' | 'deep'
  windowStart: number
  windowEnd: number
  windowSize: number
  totalChapters: number
  metadataUpdated: boolean
  missingBefore: number[]
  missingAfter: number[]
  roleCardsAdded: number
}> {
  const mode = payload?.mode === 'deep' ? 'deep' : 'standard'
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/metadata/ensure-window?projectId=${encodeURIComponent(projectId)}`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapter: payload.chapter,
        mode,
        windowSize: payload.windowSize,
        forceRefreshChapter: payload.forceRefreshChapter === true,
      }),
    }),
  )
  if (!r.ok) await throwApiError(r, `ensure project book metadata window failed: ${r.status}`)
  return r.json()
}

export async function listProjectBooks(projectId: string): Promise<ProjectBookListItemDto[]> {
  const r = await apiFetch(`${API_BASE}/assets/books?projectId=${encodeURIComponent(projectId)}`, withAuth())
  if (!r.ok) throw new Error(`list project books failed: ${r.status}`)
  return r.json()
}

type ProjectBookIndexCacheEntry = {
  inFlight?: Promise<ProjectBookIndexDto>
  value?: ProjectBookIndexDto
  updatedAt?: number
}

const PROJECT_BOOK_INDEX_THROTTLE_MS = 800
const projectBookIndexCache = new Map<string, ProjectBookIndexCacheEntry>()

export async function getProjectBookIndex(
  projectId: string,
  bookId: string,
  options?: { bypassThrottle?: boolean },
): Promise<ProjectBookIndexDto> {
  const key = `${projectId}:${bookId}`
  const now = Date.now()
  const cached = projectBookIndexCache.get(key)
  const bypassThrottle = options?.bypassThrottle === true

  // Collapse repeated reads triggered by concurrent effects / rapid re-renders.
  if (cached?.inFlight) return cached.inFlight
  if (!bypassThrottle && cached?.value && cached.updatedAt && now - cached.updatedAt < PROJECT_BOOK_INDEX_THROTTLE_MS) {
    return cached.value
  }

  const request = (async () => {
    const r = await apiFetch(`${API_BASE}/assets/books/${encodeURIComponent(bookId)}/index?projectId=${encodeURIComponent(projectId)}`, withAuth())
    if (!r.ok) throw new Error(`get project book index failed: ${r.status}`)
    const nextValue = (await r.json()) as ProjectBookIndexDto
    projectBookIndexCache.set(key, { value: nextValue, updatedAt: Date.now() })
    return nextValue
  })()

  projectBookIndexCache.set(key, { ...(cached || {}), inFlight: request })
  try {
    return await request
  } catch (error) {
    projectBookIndexCache.delete(key)
    throw error
  }
}

export async function listProjectBookStoryboardHistory(
  projectId: string,
  bookId: string,
  options?: { taskId?: string; limit?: number },
): Promise<ProjectBookStoryboardHistoryDto> {
  const params = new URLSearchParams()
  params.set('projectId', projectId)
  if (typeof options?.taskId === 'string' && options.taskId.trim()) {
    params.set('taskId', options.taskId.trim())
  }
  if (typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
    params.set('limit', String(Math.trunc(options.limit)))
  }
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/storyboard/history?${params.toString()}`,
    withAuth(),
  )
  if (!r.ok) await throwApiError(r, `list project book storyboard history failed: ${r.status}`)
  return r.json()
}

export async function deleteProjectBookStoryboardHistoryShot(
  projectId: string,
  bookId: string,
  taskId: string,
  shotNo: number,
): Promise<{
  ok: boolean
  bookId: string
  deletedShotNo: number
  progress?: ProjectBookStoryboardHistoryDto['progress'] | null
  total?: number
}> {
  const normalizedShotNo = Math.max(1, Math.trunc(Number(shotNo || 0)))
  const normalizedTaskId = String(taskId || '').trim()
  if (!normalizedTaskId) throw new Error('taskId is required')
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/storyboard/history/${encodeURIComponent(String(normalizedShotNo))}?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(normalizedTaskId)}`,
    withAuth({ method: 'DELETE' }),
  )
  if (!r.ok) await throwApiError(r, `delete project book storyboard history shot failed: ${r.status}`)
  return r.json()
}

export type StoryboardRecipeDto = {
  id: string
  name: string
  description: string
  previewUrl: string
  gridSpec?: { rows: number; cols: number }
  aspect?: string
}

export async function listStoryboardRecipes(): Promise<StoryboardRecipeDto[]> {
  const r = await apiFetch(`${API_BASE}/public/storyboard/recipes`, withAuth())
  if (!r.ok) throw new Error(`list storyboard recipes failed: ${r.status}`)
  const body = await r.json().catch(() => [])
  return Array.isArray(body) ? body : []
}

// ── 视频领域档案（domain profile）路由 ─────────────────────────────────────────
// 设计 spec：docs/superpowers/specs/2026-06-06-video-workflow-intent-profile-routing-design.md
// 单一真相源在 agents-cli profiles/profiles.json（C1），由 hono-api profile-library.service（C4）
// 加载并经路由暴露。前端只在 VIDEO_PROFILE_ROUTING=ON 时调用这两个接口（确认卡）。

/** profiles.json 条目在前端用到的子集（确认卡展示用）。 */
export type VideoProfileDto = {
  id: string
  name: string
  styleTone: string        // clean-real | cinematic | anime；default 档为空字符串
  aspect?: string          // default 档可省略（=沿用现状）
  recipeBias?: string[]
  durationDefault?: number
}

/** tapcanvas-intent-classifier 结构化输出（C2）。 */
export type VideoIntentResult = {
  profileId: string
  confidence: number       // 0-1
  signals?: Record<string, unknown>
  rationale: string
}

/** 列出可选领域档案（含 default）。后端契约：GET /public/storyboard/profiles，由 C4 profile-library.service 提供。 */
export async function listVideoProfiles(): Promise<VideoProfileDto[]> {
  const r = await apiFetch(`${API_BASE}/public/storyboard/profiles`, withAuth())
  if (!r.ok) throw new Error(`list video profiles failed: ${r.status}`)
  const body = await r.json().catch(() => [])
  return Array.isArray(body) ? body : []
}

/** 第三方持 apikey 即可调用的用量接口返回形状（GET /public/usage）。 */
export type A2AUsageResult = {
  keyPrefix: string
  summary: { personalSpent: number; teamSpent: number }
  recentRequests: Array<{
    id?: string
    path: string
    method: string
    status: number
    duration_ms?: number
    started_at: string
  }>
  recentCredits: Array<{
    source: string
    amount: number
    note?: string
    createdAt: string
    kind?: string
  }>
}

/**
 * 查询当前 API Key 的用量。后端契约：GET /public/usage（由 apiKeyAuthMiddleware 保护，
 * 作用域严格限于调用方这把 key）。limit 默认 50（夹 1..200），before 为 ISO 时间戳翻页。
 */
export async function getMyUsage(opts?: { limit?: number; before?: string }): Promise<A2AUsageResult> {
  const qs = new URLSearchParams()
  if (opts?.limit != null) qs.set('limit', String(opts.limit))
  if (opts?.before) qs.set('before', opts.before)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const r = await apiFetch(`${API_BASE}/public/usage${suffix}`, withAuth())
  if (!r.ok) await throwApiError(r, `get usage failed: ${r.status}`)
  return r.json()
}

/**
 * 调意图分类器识别领域档案。后端契约：POST /agents/intent/classify-video，
 * 服务端转发给 agents-cli 的 tapcanvas-intent-classifier skill（C2）。
 * 入参为组内文本简报 + 组内图 URL（分类器内部对图走 analyze_image）+ 标识。
 */
export async function classifyVideoIntent(payload: {
  briefText?: string
  imageUrls?: string[]
  groupId?: string
  projectId?: string
}): Promise<VideoIntentResult> {
  const r = await apiFetch(`${API_BASE}/agents/intent/classify-video`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`classify video intent failed: ${r.status}`)
  return r.json()
}

export async function deleteProjectBook(projectId: string, bookId: string): Promise<{ ok: boolean; bookId: string }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}?projectId=${encodeURIComponent(projectId)}`,
    withAuth({ method: 'DELETE' }),
  )
  if (!r.ok) await throwApiError(r, `delete project book failed: ${r.status}`)
  return r.json()
}

export async function getProjectBookChapter(projectId: string, bookId: string, chapter: number): Promise<{
  bookId: string
  projectId: string
  chapter: number
  title: string
  content: string
  startLine: number
  endLine: number
  summary?: string | null
  keywords?: string[]
  coreConflict?: string | null
  characters?: Array<{ name: string; description?: string }>
  props?: Array<{
    name: string
    description?: string
    narrativeImportance?: 'critical' | 'supporting' | 'background'
    visualNeed?: 'must_render' | 'shared_scene_only' | 'mention_only'
    functionTags?: Array<'plot_trigger' | 'combat' | 'threat' | 'identity_marker' | 'continuity_anchor' | 'transaction' | 'environment_clutter'>
    reusableAssetPreferred?: boolean
    independentlyFramable?: boolean
  }>
  scenes?: Array<{ name: string; description?: string }>
  locations?: Array<{ name: string; description?: string }>
}> {
  const r = await apiFetch(`${API_BASE}/assets/books/${encodeURIComponent(bookId)}/chapter?projectId=${encodeURIComponent(projectId)}&chapter=${encodeURIComponent(String(chapter))}`, withAuth())
  if (!r.ok) throw new Error(`get project book chapter failed: ${r.status}`)
  return r.json()
}

export async function confirmProjectBookStyle(
  projectId: string,
  bookId: string,
  payload?: {
    confirmed?: boolean
    confirmMainCharacterCards?: boolean
    styleName?: string
    styleLocked?: boolean
    visualDirectives?: string[]
    consistencyRules?: string[]
    negativeDirectives?: string[]
    referenceImages?: string[]
  },
): Promise<ProjectBookIndexDto> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/style/confirm?projectId=${encodeURIComponent(projectId)}`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || { confirmed: true }),
    }),
  )
  if (!r.ok) throw new Error(`confirm project book style failed: ${r.status}`)
  return r.json()
}

// 项目级「全局风格图」（服务端 canvas-index.json）：取代原 localStorage-only 的项目风格设置，
// 让 picker / agent / 出图三方共享同一源、跨设备持久。
// styleLock = 并列的「锁定风格」元数据（chip 渲染用）。
export type ProjectStyleLock = {
  styleId: string
  styleName: string
  stylePrompt: string
  category?: string
}

export type ActiveProjectLookBibleSummary = {
  assetId: string
  assetName: string
  revision: number
  name: string
  summary: string
  sectionCount: number
  activatedAt: string
  sourceNodeId: string
  sourceFlowId: string | null
  sourceChapterId: string | null
}

function normalizeActiveProjectLookBibleSummary(raw: unknown): ActiveProjectLookBibleSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const assetId = typeof record.assetId === 'string' ? record.assetId.trim() : ''
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const revision = Number(record.revision)
  if (!assetId || !name || !Number.isInteger(revision) || revision < 1) return null
  return {
    assetId,
    assetName: typeof record.assetName === 'string' ? record.assetName : '',
    revision,
    name,
    summary: typeof record.summary === 'string' ? record.summary : '',
    sectionCount: Number.isInteger(Number(record.sectionCount)) ? Math.max(0, Number(record.sectionCount)) : 0,
    activatedAt: typeof record.activatedAt === 'string' ? record.activatedAt : '',
    sourceNodeId: typeof record.sourceNodeId === 'string' ? record.sourceNodeId : '',
    sourceFlowId: typeof record.sourceFlowId === 'string' && record.sourceFlowId ? record.sourceFlowId : null,
    sourceChapterId: typeof record.sourceChapterId === 'string' && record.sourceChapterId ? record.sourceChapterId : null,
  }
}

export async function getActiveProjectLookBible(
  projectId: string,
): Promise<ActiveProjectLookBibleSummary | null> {
  const r = await apiFetch(
    `${API_BASE}/materials/project-look-bible?projectId=${encodeURIComponent(projectId)}`,
    withAuth({ method: 'GET' }),
  )
  if (!r.ok) throw new Error(`get project look bible failed: ${r.status}`)
  const data = (await r.json().catch(() => ({}))) as { active?: unknown }
  return normalizeActiveProjectLookBibleSummary(data.active)
}

function normalizeProjectStyleLock(raw: unknown): ProjectStyleLock | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const styleId = typeof obj.styleId === 'string' ? obj.styleId.trim() : ''
  if (!styleId) return null
  return {
    styleId,
    styleName: typeof obj.styleName === 'string' ? obj.styleName : '',
    stylePrompt: typeof obj.stylePrompt === 'string' ? obj.stylePrompt : '',
    ...(typeof obj.category === 'string' && obj.category ? { category: obj.category } : {}),
  }
}

export async function getProjectStyleImages(
  projectId: string,
): Promise<{ styleImages: string[]; styleLock: ProjectStyleLock | null }> {
  const r = await apiFetch(
    `${API_BASE}/materials/canvas-index/style-images?projectId=${encodeURIComponent(projectId)}`,
    withAuth({ method: 'GET' }),
  )
  if (!r.ok) throw new Error(`get project style images failed: ${r.status}`)
  const data = (await r.json().catch(() => ({}))) as { styleImages?: unknown; styleLock?: unknown }
  return {
    styleImages: Array.isArray(data?.styleImages)
      ? data.styleImages.filter((u): u is string => typeof u === 'string')
      : [],
    styleLock: normalizeProjectStyleLock(data?.styleLock),
  }
}

export async function setProjectStyleImages(
  projectId: string,
  styleImages: string[],
  // undefined = 本次不改 styleLock；null = 显式清除。
  styleLock?: ProjectStyleLock | null,
): Promise<{ styleImages: string[]; styleLock: ProjectStyleLock | null }> {
  const body: Record<string, unknown> = { projectId, styleImages }
  if (styleLock !== undefined) body.styleLock = styleLock
  const r = await apiFetch(
    `${API_BASE}/materials/canvas-index/style-images`,
    withAuth({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  if (!r.ok) throw new Error(`set project style images failed: ${r.status}`)
  const data = (await r.json().catch(() => ({}))) as { styleImages?: unknown; styleLock?: unknown }
  return {
    styleImages: Array.isArray(data?.styleImages)
      ? data.styleImages.filter((u): u is string => typeof u === 'string')
      : [],
    styleLock: normalizeProjectStyleLock(data?.styleLock),
  }
}

// ── 项目级「摄像机规格」（canvas-index.json cinematicCamera）───────────
// 与 styleImages 同构：前端摄像机 chip / agent 出图注入共享同一服务端源，跨设备持久。
// 形状与 CameraControlPanel.tsx 的 CinematicCameraValue 一致（enabled 恒为 true，null = 未设置）。
export type ProjectCinematicCamera = {
  enabled: true
  cameraKey: string
  lensKey: string
  focalKey: string
  apertureKey: string
}

function normalizeProjectCinematicCamera(raw: unknown): ProjectCinematicCamera | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (obj.enabled !== true) return null
  const pick = (k: string) => (typeof obj[k] === 'string' ? (obj[k] as string) : '')
  const cam = {
    enabled: true as const,
    cameraKey: pick('cameraKey'),
    lensKey: pick('lensKey'),
    focalKey: pick('focalKey'),
    apertureKey: pick('apertureKey'),
  }
  if (!cam.cameraKey && !cam.lensKey && !cam.focalKey && !cam.apertureKey) return null
  return cam
}

export async function getProjectCinematicCamera(
  projectId: string,
): Promise<ProjectCinematicCamera | null> {
  const r = await apiFetch(
    `${API_BASE}/materials/canvas-index/cinematic-camera?projectId=${encodeURIComponent(projectId)}`,
    withAuth({ method: 'GET' }),
  )
  if (!r.ok) throw new Error(`get project cinematic camera failed: ${r.status}`)
  const data = (await r.json().catch(() => ({}))) as { cinematicCamera?: unknown }
  return normalizeProjectCinematicCamera(data?.cinematicCamera)
}

export async function setProjectCinematicCamera(
  projectId: string,
  cinematicCamera: ProjectCinematicCamera | null,
): Promise<ProjectCinematicCamera | null> {
  const r = await apiFetch(
    `${API_BASE}/materials/canvas-index/cinematic-camera`,
    withAuth({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, cinematicCamera }),
    }),
  )
  if (!r.ok) throw new Error(`set project cinematic camera failed: ${r.status}`)
  const data = (await r.json().catch(() => ({}))) as { cinematicCamera?: unknown }
  return normalizeProjectCinematicCamera(data?.cinematicCamera)
}

// ── 项目级「导演人格」（canvas-index.json directorPersona，指向 作者导演美学 知识卡）───────────
export type DirectorPersonaSummary = {
  id: string
  name: string
  description: string
  keywords: string[]
}

export type ProjectDirectorPersona = { personaId: string; personaName: string }

export async function listDirectorPersonas(): Promise<DirectorPersonaSummary[]> {
  const r = await apiFetch(`${API_BASE}/materials/director-personas`, withAuth({ method: 'GET' }))
  if (!r.ok) throw new Error(`list director personas failed: ${r.status}`)
  const data = (await r.json().catch(() => ({}))) as { personas?: unknown }
  if (!Array.isArray(data?.personas)) return []
  return data.personas.filter(
    (p): p is DirectorPersonaSummary =>
      !!p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string',
  )
}

function normalizeProjectDirectorPersona(raw: unknown): ProjectDirectorPersona | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as { personaId?: unknown; personaName?: unknown }
  if (typeof obj.personaId !== 'string' || !obj.personaId) return null
  return {
    personaId: obj.personaId,
    personaName: typeof obj.personaName === 'string' ? obj.personaName : '',
  }
}

export async function getProjectDirectorPersona(
  projectId: string,
): Promise<ProjectDirectorPersona | null> {
  const r = await apiFetch(
    `${API_BASE}/materials/canvas-index/director-persona?projectId=${encodeURIComponent(projectId)}`,
    withAuth({ method: 'GET' }),
  )
  if (!r.ok) throw new Error(`get project director persona failed: ${r.status}`)
  const data = (await r.json().catch(() => ({}))) as { persona?: unknown }
  return normalizeProjectDirectorPersona(data?.persona)
}

export async function setProjectDirectorPersona(
  projectId: string,
  persona: ProjectDirectorPersona | null,
): Promise<ProjectDirectorPersona | null> {
  const r = await apiFetch(
    `${API_BASE}/materials/canvas-index/director-persona`,
    withAuth({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, persona }),
    }),
  )
  if (!r.ok) throw new Error(`set project director persona failed: ${r.status}`)
  const data = (await r.json().catch(() => ({}))) as { persona?: unknown }
  return normalizeProjectDirectorPersona(data?.persona)
}

export async function updateProjectBookCharacterGraph(
  projectId: string,
  bookId: string,
  payload: {
    nodes: Array<{
      id: string
      name: string
      importance?: 'main' | 'supporting' | 'minor'
      firstChapter?: number
      lastChapter?: number
      chapterSpan?: number[]
      unlockChapter?: number
    }>
    edges: Array<{
      sourceId: string
      targetId: string
      relation:
        | 'coappear'
        | 'family'
        | 'parent_child'
        | 'siblings'
        | 'mentor_disciple'
        | 'alliance'
        | 'friend'
        | 'lover'
        | 'rival'
        | 'enemy'
        | 'colleague'
        | 'master_servant'
        | 'betrayal'
        | 'conflict'
      weight: number
      chapterHints?: number[]
    }>
  },
): Promise<ProjectBookIndexDto> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/graph/update?projectId=${encodeURIComponent(projectId)}`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  if (!r.ok) throw new Error(`update project book graph failed: ${r.status}`)
  return r.json()
}

export async function upsertProjectBookRoleCard(
  projectId: string,
  bookId: string,
  payload: {
    cardId?: string
    roleId?: string
    roleName: string
    stateDescription?: string
    stateKey?: string
    ageDescription?: string
    stateLabel?: string
    healthStatus?: string
    injuryStatus?: string
    chapter?: number
    chapterStart?: number
    chapterEnd?: number
    chapterSpan?: number[]
    nodeId?: string
    prompt?: string
    status?: 'draft' | 'generated'
    modelKey?: string
    imageUrl?: string
    threeViewImageUrl?: string
    characterBible?: CharacterBible
  },
): Promise<{
  ok: boolean
  cardId: string
  roleCards: NonNullable<ProjectBookIndexDto['assets']>['roleCards']
  characterBibles: NonNullable<ProjectBookIndexDto['assets']>['characterBibles']
}> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/role-cards/upsert?projectId=${encodeURIComponent(projectId)}`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  if (!r.ok) throw new Error(`upsert project book role card failed: ${r.status}`)
  return r.json()
}

export async function confirmProjectBookRoleCard(
  projectId: string,
  bookId: string,
  cardId: string,
  payload?: { confirmed?: boolean },
): Promise<{ ok: boolean; cardId: string; roleCards: NonNullable<ProjectBookIndexDto['assets']>['roleCards'] }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/role-cards/${encodeURIComponent(cardId)}/confirm?projectId=${encodeURIComponent(projectId)}`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || { confirmed: true }),
    }),
  )
  if (!r.ok) await throwApiError(r, `confirm project book role card failed: ${r.status}`)
  return r.json()
}

export async function upsertProjectBookVisualRef(
  projectId: string,
  bookId: string,
  payload: {
    refId?: string
    category: 'scene_prop' | 'spell_fx'
    name: string
    chapter?: number
    chapterStart?: number
    chapterEnd?: number
    chapterSpan?: number[]
    tags?: string[]
    stateDescription?: string
    stateKey?: string
    nodeId?: string
    prompt?: string
    status?: 'draft' | 'generated'
    modelKey?: string
    imageUrl?: string
  },
): Promise<{ ok: boolean; refId: string; visualRefs: NonNullable<ProjectBookIndexDto['assets']>['visualRefs'] }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/visual-refs/upsert?projectId=${encodeURIComponent(projectId)}`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  if (!r.ok) await throwApiError(r, `upsert project book visual ref failed: ${r.status}`)
  return r.json()
}

export async function upsertProjectBookSemanticAsset(
  projectId: string,
  bookId: string,
  payload: {
    semanticId?: string
    mediaKind: 'image' | 'video'
    status?: 'draft' | 'generated'
    nodeId?: string
    nodeKind?: string
    taskId?: string
    planId?: string
    chunkId?: string
    imageUrl?: string
    videoUrl?: string
    thumbnailUrl?: string
    chapter?: number
    chapterStart?: number
    chapterEnd?: number
    chapterSpan?: number[]
    shotNo?: number
    stateDescription?: string
    prompt?: string
    anchorBindings?: PublicFlowAnchorBinding[]
    productionLayer?: string
    creationStage?: string
    approvalStatus?: string
  },
): Promise<{ ok: boolean; semanticId: string; semanticAssets: NonNullable<ProjectBookIndexDto['assets']>['semanticAssets'] }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/semantic-assets/upsert?projectId=${encodeURIComponent(projectId)}`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  if (!r.ok) await throwApiError(r, `upsert project book semantic asset failed: ${r.status}`)
  return r.json()
}

export async function confirmProjectBookVisualRef(
  projectId: string,
  bookId: string,
  refId: string,
  payload?: { confirmed?: boolean },
): Promise<{ ok: boolean; refId: string; visualRefs: NonNullable<ProjectBookIndexDto['assets']>['visualRefs'] }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/visual-refs/${encodeURIComponent(refId)}/confirm?projectId=${encodeURIComponent(projectId)}`,
    withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || { confirmed: true }),
    }),
  )
  if (!r.ok) await throwApiError(r, `confirm project book visual ref failed: ${r.status}`)
  return r.json()
}

export async function deleteProjectBookVisualRef(
  projectId: string,
  bookId: string,
  refId: string,
): Promise<{ ok: boolean; refId: string; visualRefs: NonNullable<ProjectBookIndexDto['assets']>['visualRefs'] }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/visual-refs/${encodeURIComponent(refId)}?projectId=${encodeURIComponent(projectId)}`,
    withAuth({ method: 'DELETE' }),
  )
  if (!r.ok) await throwApiError(r, `delete project book visual ref failed: ${r.status}`)
  return r.json()
}

export async function deleteProjectBookRoleCard(
  projectId: string,
  bookId: string,
  cardId: string,
): Promise<{ ok: boolean; cardId: string; roleCards: NonNullable<ProjectBookIndexDto['assets']>['roleCards'] }> {
  const r = await apiFetch(
    `${API_BASE}/assets/books/${encodeURIComponent(bookId)}/role-cards/${encodeURIComponent(cardId)}?projectId=${encodeURIComponent(projectId)}`,
    withAuth({ method: 'DELETE' }),
  )
  if (!r.ok) await throwApiError(r, `delete project book role card failed: ${r.status}`)
  return r.json()
}

export async function updateServerAssetData(id: string, data: unknown): Promise<ServerAssetDto> {
  const r = await apiFetch(`${API_BASE}/assets/${id}/data`, withAuth({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }))
  if (!r.ok) throw new Error(`update asset data failed: ${r.status}`)
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

export async function listProjectMaterials(projectId: string, kind?: ProjectMaterialKind): Promise<ServerAssetDto[]> {
  const res = await listServerAssets({ projectId, kind: kind || undefined, limit: 50 })
  return (res.items || []).filter((item) => {
    const k = typeof item?.data?.kind === 'string' ? item.data.kind : ''
    return k === 'novelDoc' || k === 'scriptDoc' || k === 'storyboardScript'
  })
}

export type UploadServerAssetMeta = {
  prompt?: string | null
  vendor?: string | null
  modelKey?: string | null
  taskKind?: TaskKind | string | null
  projectId?: string | null
  ownerNodeId?: string | null
}

const inflightAssetUploadRequests = new Map<string, Promise<ServerAssetDto>>()

export function buildAssetUploadRequestKey(file: File, name?: string, meta?: UploadServerAssetMeta): string {
  const fileName = typeof file.name === 'string' ? file.name.trim() : ''
  const fileSize = typeof file.size === 'number' && Number.isFinite(file.size) ? String(file.size) : ''
  const lastModified =
    typeof file.lastModified === 'number' && Number.isFinite(file.lastModified)
      ? String(file.lastModified)
      : ''
  const fileType = typeof file?.type === 'string' ? file.type.trim().toLowerCase() : ''
  const uploadName = typeof name === 'string' ? name.trim() : ''
  const prompt = typeof meta?.prompt === 'string' ? meta.prompt.trim() : ''
  const vendor = typeof meta?.vendor === 'string' ? meta.vendor.trim() : ''
  const modelKey = typeof meta?.modelKey === 'string' ? meta.modelKey.trim() : ''
  const taskKind = typeof meta?.taskKind === 'string' ? String(meta.taskKind).trim() : ''
  const projectId = typeof meta?.projectId === 'string' ? meta.projectId.trim() : ''
  return [
    fileName,
    fileSize,
    lastModified,
    fileType,
    uploadName,
    prompt,
    vendor,
    modelKey,
    taskKind,
    projectId,
  ].join('|')
}

// File classifier for routing to direct-to-OSS upload.
// Triggers when:
//   • file is audio/video (always use the canonical direct asset path), or
//   • image > 25MB (close to the legacy /assets/upload 30MB hard cap)
const DIRECT_UPLOAD_THRESHOLD_BYTES = 25 * 1024 * 1024
function shouldUseDirectUpload(file: File): boolean {
  const ct = (file?.type || '').toLowerCase()
  if (ct.startsWith('video/')) return true
  if (ct.startsWith('audio/')) return true
  if (typeof file.size === 'number' && file.size > DIRECT_UPLOAD_THRESHOLD_BYTES) return true
  return false
}

type PresignResp = {
  uploadUrl: string
  key: string
  method: 'PUT'
  requiredHeaders: Record<string, string>
  publicUrl: string
  expiresIn: number
  kind: 'image' | 'video' | 'audio'
}

async function presignAssetUpload(input: {
  contentType: string
  size: number
  fileName?: string
  kind?: 'image' | 'video' | 'audio'
}): Promise<PresignResp> {
  const r = await apiFetch(`${API_BASE}/assets/upload/presign`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
  if (!r.ok) await throwApiError(r, 'presign upload failed')
  return await r.json() as PresignResp
}

// Stream-PUTs the file straight to TOS. Uses XHR so we can surface progress to
// the upload runtime store; fetch's Streams API still has spotty progress UX.
function putFileWithProgress(
  uploadUrl: string,
  file: File,
  headers: Record<string, string>,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl, true)
    for (const [k, v] of Object.entries(headers)) {
      try { xhr.setRequestHeader(k, v) } catch { /* some headers are read-only in the browser */ }
    }
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(e.loaded, e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`OSS PUT failed (${xhr.status}): ${xhr.responseText || xhr.statusText}`))
    }
    xhr.onerror = () => reject(new Error('network error during direct TOS upload (check TOS CORS)'))
    xhr.onabort = () => reject(new Error('upload aborted'))
    xhr.send(file)
  })
}

async function commitAssetUpload(input: {
  key: string
  name?: string
  contentType: string
  size: number
  kind: 'image' | 'video' | 'audio'
  originalName?: string
  projectId?: string
  prompt?: string
  vendor?: string
  modelKey?: string
  taskKind?: string
}): Promise<ServerAssetDto> {
  const r = await apiFetch(`${API_BASE}/assets/upload/commit`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
  if (!r.ok) await throwApiError(r, 'commit upload failed')
  return await r.json() as ServerAssetDto
}

async function uploadServerAssetFileDirect(
  file: File,
  name: string | undefined,
  meta: UploadServerAssetMeta | undefined,
): Promise<ServerAssetDto> {
  const contentType = (file?.type || '').split(';')[0].trim() || 'application/octet-stream'
  const presign = await presignAssetUpload({
    contentType,
    size: file.size,
    fileName: typeof file.name === 'string' ? file.name : undefined,
  })
  await putFileWithProgress(presign.uploadUrl, file, presign.requiredHeaders)
  return await commitAssetUpload({
    key: presign.key,
    name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
    contentType,
    size: file.size,
    kind: presign.kind,
    originalName: typeof file.name === 'string' && file.name.trim() ? file.name.trim() : undefined,
    projectId: typeof meta?.projectId === 'string' && meta.projectId.trim() ? meta.projectId.trim() : undefined,
    prompt: typeof meta?.prompt === 'string' && meta.prompt.trim() ? meta.prompt.trim() : undefined,
    vendor: typeof meta?.vendor === 'string' && meta.vendor.trim() ? meta.vendor.trim() : undefined,
    modelKey: typeof meta?.modelKey === 'string' && meta.modelKey.trim() ? meta.modelKey.trim() : undefined,
    taskKind:
      typeof meta?.taskKind === 'string' && String(meta.taskKind).trim()
        ? String(meta.taskKind).trim()
        : undefined,
  })
}

export async function uploadServerAssetFile(file: File, name?: string, meta?: UploadServerAssetMeta): Promise<ServerAssetDto> {
  const requestKey = buildAssetUploadRequestKey(file, name, meta)
  const effectiveFileName =
    (typeof name === 'string' && name.trim()) ||
    (typeof file.name === 'string' && file.name.trim()) ||
    '未命名文件'
  const trimmedProjectId = typeof meta?.projectId === 'string' && meta.projectId.trim() ? meta.projectId.trim() : ''
  const ownerNodeId = typeof meta?.ownerNodeId === 'string' && meta.ownerNodeId.trim() ? meta.ownerNodeId.trim() : ''
  const existing = inflightAssetUploadRequests.get(requestKey)
  if (existing) {
    useUploadRuntimeStore.getState().beginPendingUpload({
      id: requestKey,
      fileName: effectiveFileName,
      projectId: trimmedProjectId || null,
      ownerNodeId: ownerNodeId || null,
      startedAt: Date.now(),
    })
    return existing
  }
  useUploadRuntimeStore.getState().beginPendingUpload({
    id: requestKey,
    fileName: effectiveFileName,
    projectId: trimmedProjectId || null,
    ownerNodeId: ownerNodeId || null,
    startedAt: Date.now(),
  })

  const uploadPromise = (async (): Promise<ServerAssetDto> => {
    if (shouldUseDirectUpload(file)) {
      return await uploadServerAssetFileDirect(file, name, meta)
    }
    const trimmedPrompt = typeof meta?.prompt === 'string' && meta.prompt.trim() ? meta.prompt.trim() : ''
    const trimmedVendor = typeof meta?.vendor === 'string' && meta.vendor.trim() ? meta.vendor.trim() : ''
    const trimmedModelKey = typeof meta?.modelKey === 'string' && meta.modelKey.trim() ? meta.modelKey.trim() : ''
    const trimmedTaskKind = typeof meta?.taskKind === 'string' && String(meta.taskKind).trim() ? String(meta.taskKind).trim() : ''

    const hasMeta = Boolean(trimmedPrompt || trimmedVendor || trimmedModelKey || trimmedTaskKind || trimmedProjectId)
    if (hasMeta) {
      const form = new FormData()
      form.set('file', file)
      if (typeof name === 'string' && name.trim()) {
        form.set('name', name.trim())
      }
      if (trimmedPrompt) form.set('prompt', trimmedPrompt)
      if (trimmedVendor) form.set('vendor', trimmedVendor)
      if (trimmedModelKey) form.set('modelKey', trimmedModelKey)
      if (trimmedTaskKind) form.set('taskKind', trimmedTaskKind)
      if (trimmedProjectId) form.set('projectId', trimmedProjectId)

      const r = await apiFetch(`${API_BASE}/assets/upload`, withAuth({
        method: 'POST',
        headers: { 'x-tap-no-retry': '1' },
        body: form,
      }))
      if (!r.ok) throw new Error(`upload asset failed: ${r.status}`)
      return r.json()
    }

    const qs = new URLSearchParams()
    if (typeof name === 'string' && name.trim()) {
      qs.set('name', name.trim())
    }
    if (trimmedProjectId) {
      qs.set('projectId', trimmedProjectId)
    }
    const url = qs.toString() ? `${API_BASE}/assets/upload?${qs.toString()}` : `${API_BASE}/assets/upload`
    const contentType = (file?.type || '').split(';')[0].trim() || 'application/octet-stream'
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'x-tap-no-retry': '1',
    }
    if (typeof file.name === 'string' && file.name.trim()) {
      const fileName = file.name.trim()
      if (isIso88591HeaderValue(fileName)) {
        headers['X-File-Name'] = fileName
      }
    }
    if (typeof file.size === 'number' && Number.isFinite(file.size)) {
      headers['X-File-Size'] = String(file.size)
    }
    const body: RequestInit['body'] = file
    const r = await apiFetch(url, withAuth({ method: 'POST', headers, body }))
    if (!r.ok) throw new Error(`upload asset failed: ${r.status}`)
    return r.json()
  })()

  inflightAssetUploadRequests.set(requestKey, uploadPromise)
  try {
    return await uploadPromise
  } finally {
    inflightAssetUploadRequests.delete(requestKey)
    useUploadRuntimeStore.getState().finishPendingUpload(requestKey)
  }
}

function isIso88591HeaderValue(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code > 0xff) return false
  }
  return true
}

function sanitizeServerAssetUploadName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .trim()
    .slice(0, 160)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/]/g, '_')
}

function normalizeMimeType(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : ''
  return (s.split(';')[0] || '').trim().toLowerCase()
}

/**
 * Best-effort recovery for a completed upload when the client didn't get a usable response
 * (e.g. proxy/CORS/network hiccups after the server already persisted the asset row).
 */
export async function recoverUploadedServerAssetFile(
  file: File,
  options?: { withinMs?: number },
): Promise<ServerAssetDto | null> {
  const withinMsRaw = options?.withinMs
  const withinMs = Number.isFinite(withinMsRaw) ? Math.max(1000, Math.min(10 * 60 * 1000, Math.trunc(withinMsRaw!))) : 2 * 60 * 1000

  const wantedOriginalName = sanitizeServerAssetUploadName((file as any)?.name || '')
  const wantedSize =
    typeof (file as any)?.size === 'number' && Number.isFinite((file as any).size)
      ? Number((file as any).size)
      : null
  const wantedContentType = normalizeMimeType((file as any)?.type || '')

  if (!wantedOriginalName && wantedSize == null) return null

  let listed: { items: ServerAssetDto[]; cursor: string | null } | null = null
  try {
    listed = await listServerAssets({ limit: 10 })
  } catch {
    return null
  }

  const now = Date.now()
  const items = Array.isArray(listed?.items) ? listed!.items : []
  for (const asset of items) {
    if (!asset || typeof asset !== 'object') continue

    const createdAtMs = Date.parse((asset as any).createdAt)
    if (Number.isFinite(createdAtMs) && withinMs > 0 && now - createdAtMs > withinMs) continue

    const data = (asset as any).data || {}
    const kind = typeof data?.kind === 'string' ? data.kind.trim().toLowerCase() : ''
    if (kind && kind !== 'upload') continue

    const originalName = sanitizeServerAssetUploadName(data?.originalName || '')
    const size =
      typeof data?.size === 'number' && Number.isFinite(data.size) ? Number(data.size) : null
    const contentType = normalizeMimeType(data?.contentType || '')

    if (wantedSize != null) {
      if (size == null) continue
      if (size !== wantedSize) continue
    }
    if (wantedOriginalName) {
      if (!originalName) continue
      if (originalName !== wantedOriginalName) continue
    }
    if (wantedContentType && contentType && contentType !== wantedContentType) continue

    const url = typeof data?.url === 'string' ? String(data.url).trim() : ''
    if (!url) continue
    return asset
  }

  return null
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
  ownerAvatarUrl?: string | null
  projectName?: string | null
  projectId?: string | null
  pinWeight?: number
  sourceProjectId?: string | null
  sourceOwnerType?: 'project' | 'chapter' | 'shortFilm' | null
  sourceOwnerId?: string | null
  sourceChapterTitle?: string | null
  likeCount?: number | null
  favoriteCount?: number | null
  favorited?: boolean
  canvasPublic?: boolean
  algorithmScore?: number
  manualBoost?: number
  effectiveScore?: number
  recommended?: boolean
  pinned?: boolean
  displayOrder?: number
  rank?: number
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

export async function listPublishedVideos(limit?: number, surface?: 'homepage'): Promise<PublicAssetDto[]> {
  const qs = new URLSearchParams()
  if (typeof limit === 'number' && !Number.isNaN(limit)) {
    qs.set('limit', String(limit))
  }
  if (surface) qs.set('surface', surface)
  const query = qs.toString()
  const url = query ? `${API_BASE}/assets/published?${query}` : `${API_BASE}/assets/published`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`list published videos failed: ${r.status}`)
  return r.json()
}

export type CarouselSlide = {
  imageUrl: string
  title: string | null
  linkUrl: string | null
}

export async function listHomepageCarouselSlides(): Promise<CarouselSlide[]> {
  const url = `${API_BASE}/assets/homepage-carousel`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) await throwApiError(r, `list homepage carousel failed: ${r.status}`)
  const body = await r.json() as { slides?: CarouselSlide[] }
  return Array.isArray(body.slides) ? body.slides : []
}

export async function saveHomepageCarousel(slides: CarouselSlide[]): Promise<void> {
  const { items } = await listServerAssets({ kind: 'homepageCarousel', limit: 1 })
  const data = { kind: 'homepageCarousel', slides }
  if (items.length > 0) {
    await updateServerAssetData(items[0].id, data)
  } else {
    await createServerAsset({ name: 'homepageCarousel', data })
  }
}

export async function saveHomepageFeatured(featuredIds: string[]): Promise<void> {
  const { items } = await listServerAssets({ kind: 'homepageFeatured', limit: 1 })
  const data = { kind: 'homepageFeatured', featuredIds }
  if (items.length > 0) {
    await updateServerAssetData(items[0].id, data)
  } else {
    await createServerAsset({ name: 'homepageFeatured', data })
  }
}

export async function listHomepageFeaturedIds(): Promise<string[]> {
  const { items } = await listServerAssets({ kind: 'homepageFeatured', limit: 1 })
  if (!items.length) return []
  const d = items[0].data
  return Array.isArray(d?.featuredIds) ? d.featuredIds.map(String) : []
}

// ── 首页装修（homepageDecoration 全局 asset）─────────────────────────────
export type HomepageSkillCard = {
  title: string
  subtitle: string | null
  imageUrl: string | null
  link: string | null
}

export type LoginVideoItem = {
  url: string
  posterUrl: string | null
  caption: string | null
}

export type HomepageDecoration = {
  greetingSubtitle: string | null
  heroPlaceholder: string | null
  skillCards: HomepageSkillCard[]
  loginVideos: LoginVideoItem[]
}

export const EMPTY_HOMEPAGE_DECORATION: HomepageDecoration = {
  greetingSubtitle: null,
  heroPlaceholder: null,
  skillCards: [],
  loginVideos: [],
}

export async function fetchHomepageDecoration(): Promise<HomepageDecoration> {
  const r = await apiFetch(`${API_BASE}/assets/homepage-decoration`, withAuth())
  if (!r.ok) await throwApiError(r, `加载首页装修失败: ${r.status}`)
  return await r.json() as HomepageDecoration
}

export async function saveHomepageDecoration(decoration: HomepageDecoration): Promise<void> {
  const { items } = await listServerAssets({ kind: 'homepageDecoration', limit: 1 })
  const data = { kind: 'homepageDecoration', ...decoration }
  if (items.length > 0) {
    await updateServerAssetData(items[0].id, data)
  } else {
    await createServerAsset({ name: 'homepageDecoration', data })
  }
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
  | 'image_to_3d'
  | 'video_enhance'
  | 'video_edit'
  | 'image_remove_bg'

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type TaskAssetDto = {
  type: 'image' | 'video' | 'audio'
  url: string
  thumbnailUrl?: string | null
  assetId?: string | null
  assetRefId?: string | null
  assetName?: string | null
}

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

// Public API (/public/*): JWT 或 API key（二选一）；两者同时提供时以 JWT 作为计费/归属用户。
export type PublicRunTaskRequestDto = {
  // Deprecated: server ignores external vendor and always routes as auto.
  vendor?: string
  vendorCandidates?: string[]
  request: TaskRequestDto
}

export type PublicRunTaskResponseDto = {
  vendor: string
  result: TaskResultDto
}

type PublicDrawRequestDto = {
  // Deprecated: server ignores external vendor and always routes as auto.
  vendor?: string
  vendorCandidates?: string[]
  async?: boolean
  kind?: 'text_to_image' | 'image_edit'
  prompt: string
  negativePrompt?: string
  seed?: number
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  extras?: Record<string, unknown>
}

export type PublicFetchTaskResultRequestDto = {
  taskId: string
  vendor?: string
  taskKind?: TaskKind
  prompt?: string | null
}

export type PublicFetchTaskResultResponseDto = {
  vendor: string
  result: TaskResultDto
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

type PublicTaskError = Error & {
  status?: number
  code?: unknown
  details?: unknown
  requestId?: string
  rawResponse?: string
}

const PUBLIC_TASK_TRACE_HEADER_KEYS = ['x-request-id', 'x-trace-id', 'cf-ray'] as const

function getClientPageTraceHeaders(): Record<string, string> {
  try {
    if (typeof window === 'undefined') return {}
    const pagePath = `${window.location.pathname || ''}${window.location.search || ''}${window.location.hash || ''}`.trim()
    const referrerRaw = typeof document !== 'undefined' ? String(document.referrer || '').trim() : ''
    const referrerPath = (() => {
      if (!referrerRaw) return ''
      try {
        const u = new URL(referrerRaw)
        const currentOrigin = window.location.origin
        if (u.origin === currentOrigin) return `${u.pathname || ''}${u.search || ''}${u.hash || ''}`.trim()
        return referrerRaw
      } catch {
        return referrerRaw
      }
    })()
    return {
      ...(pagePath ? { 'x-tapcanvas-page-path': pagePath } : {}),
      ...(referrerPath ? { 'x-tapcanvas-referrer-path': referrerPath } : {}),
    }
  } catch {
    return {}
  }
}

function isPublicDrawKind(kind: TaskKind): kind is 'text_to_image' | 'image_edit' {
  return kind === 'text_to_image' || kind === 'image_edit'
}

function toPublicDrawPayload(payload: PublicRunTaskRequestDto): PublicDrawRequestDto | null {
  const request = payload.request
  if (!request || !isPublicDrawKind(request.kind)) return null
  return {
    vendorCandidates: payload.vendorCandidates,
    async: true,
    kind: request.kind,
    prompt: request.prompt,
    ...(typeof request.negativePrompt === 'string' ? { negativePrompt: request.negativePrompt } : {}),
    ...(typeof request.seed === 'number' ? { seed: request.seed } : {}),
    ...(typeof request.width === 'number' ? { width: request.width } : {}),
    ...(typeof request.height === 'number' ? { height: request.height } : {}),
    ...(typeof request.steps === 'number' ? { steps: request.steps } : {}),
    ...(typeof request.cfgScale === 'number' ? { cfgScale: request.cfgScale } : {}),
    ...(request.extras && typeof request.extras === 'object' ? { extras: request.extras as Record<string, unknown> } : {}),
  }
}

function sanitizePublicTaskPayload(payload: PublicRunTaskRequestDto): PublicRunTaskRequestDto {
  return {
    vendorCandidates: payload.vendorCandidates,
    request: payload.request,
  }
}

function readPublicTaskTraceId(r: Response): string | null {
  for (const key of PUBLIC_TASK_TRACE_HEADER_KEYS) {
    const value = String(r.headers.get(key) || '').trim()
    if (value) return value
  }
  return null
}

async function readPublicTaskErrorBody(r: Response): Promise<{
  message?: string
  code?: unknown
  details?: unknown
  rawResponse?: string
}> {
  const contentType = String(r.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('application/json')) {
    try {
      const parsed = (await r.json()) as unknown
      if (typeof parsed === 'object' && parsed) {
        const body = parsed as { message?: unknown; error?: unknown; code?: unknown; details?: unknown }
        const message =
          (typeof body.message === 'string' && body.message.trim()) ||
          (typeof body.error === 'string' && body.error.trim()) ||
          undefined
        return { message, code: body.code, details: body.details }
      }
    } catch {
      // ignore
    }
  }
  try {
    const text = (await r.text()).trim()
    if (!text) return {}
    const compact = text.replace(/\s+/g, ' ').trim()
    return { message: compact.slice(0, 240), rawResponse: compact.slice(0, 800) }
  } catch {
    return {}
  }
}

async function throwPublicTaskError(r: Response, fallbackMessage: string): Promise<never> {
  const body = await readPublicTaskErrorBody(r)
  const traceId = readPublicTaskTraceId(r)
  const messageCore = body.message || fallbackMessage
  const message = traceId ? `${messageCore} (requestId: ${traceId})` : messageCore
  const err = new Error(message) as PublicTaskError
  err.status = r.status
  err.code = body.code
  err.details = body.details
  err.requestId = traceId || undefined
  err.rawResponse = body.rawResponse
  throw err
}

const DEFAULT_PUBLIC_VISION_TEMPERATURE = 0.2

/** 图像理解统一入口：走 /public/vision，由服务端按模型目录/NewAPI 选择默认模型。 */
export async function runVisionTask(
  params: { imageUrl?: string; imageData?: string; prompt: string; systemPrompt?: string },
  extraExtras?: Record<string, unknown>,
): Promise<TaskResultDto> {
  const payload: PublicVisionRequestDto = {
    vendor: 'auto',
    temperature: DEFAULT_PUBLIC_VISION_TEMPERATURE,
    prompt: params.prompt,
    ...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),
    ...(params.imageUrl ? { imageUrl: params.imageUrl } : {}),
    ...(params.imageData ? { imageData: params.imageData } : {}),
    ...(extraExtras ?? {}),
  }
  const result = await publicVisionWithAuth(payload)
  return {
    id: typeof result.id === 'string' && result.id.trim() ? result.id.trim() : `vision-${Date.now().toString(36)}`,
    kind: 'image_to_prompt',
    status: 'succeeded',
    assets: [],
    raw: {
      provider: 'public_vision',
      vendor: result.vendor,
      text: typeof result.text === 'string' ? result.text : '',
      response: result.raw ?? result,
    },
  }
}

export async function runTaskByVendor(vendor: string, request: TaskRequestDto): Promise<TaskResultDto> {
  const normalizedVendor = String(vendor || '').trim()
  if (!normalizedVendor) throw new Error('vendor is required')
  const r = await apiFetch(`${API_BASE}/tasks`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendor: normalizedVendor, request }),
  }))
  if (!r.ok) {
    let errorMessage = `run task failed: ${r.status}`
    let errorData: any = null
    try {
      errorData = await r.json()
      errorMessage = errorData?.message || errorData?.error || errorMessage
    } catch {
      // ignore
    }
    const error = new Error(errorMessage) as any
    error.status = r.status
    if (errorData && typeof errorData === 'object') {
      error.code = errorData.code
      error.details = errorData.details
    }
    throw error
  }
  return r.json()
}

export async function runPublicTask(apiKey: string, payload: PublicRunTaskRequestDto): Promise<PublicRunTaskResponseDto> {
  const sanitizedPayload = sanitizePublicTaskPayload(payload)
  const drawPayload = toPublicDrawPayload(sanitizedPayload)
  const run = (endpoint: '/public/tasks' | '/public/draw', bodyPayload: PublicRunTaskRequestDto | PublicDrawRequestDto) => apiFetch(`${API_BASE}${endpoint}`, withPublicApiKey(apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getClientPageTraceHeaders() },
    body: JSON.stringify(bodyPayload),
  }))
  let r = await run('/public/tasks', sanitizedPayload)
  // Keep original behavior by default; only switch to async draw path when gateway times out.
  if (!r.ok && r.status === 504 && drawPayload) {
    r = await run('/public/draw', drawPayload)
  }
  if (!r.ok) {
    try {
      await throwPublicTaskError(r, `run public task failed: ${r.status}`)
    } catch (error) {
      const e = error as PublicTaskError
      if (e.code === 'team_required') {
        e.message = '个人账号也可使用，但需要有积分；请联系管理员分配额度，或使用邀请码注册领取欢迎积分。'
      }
      throw e
    }
  }
  return r.json()
}

// Authenticated JWT call to /public/tasks (uses server-side auto vendor routing/model catalog).
export async function runPublicTaskWithAuth(payload: PublicRunTaskRequestDto): Promise<PublicRunTaskResponseDto> {
  const sanitizedPayload = sanitizePublicTaskPayload(payload)
  const drawPayload = toPublicDrawPayload(sanitizedPayload)
  const run = (endpoint: '/public/tasks' | '/public/draw', bodyPayload: PublicRunTaskRequestDto | PublicDrawRequestDto) => apiFetch(`${API_BASE}${endpoint}`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getClientPageTraceHeaders() },
    body: JSON.stringify(bodyPayload),
  }))
  let r = await run('/public/tasks', sanitizedPayload)
  // Keep original behavior by default; only switch to async draw path when gateway times out.
  if (!r.ok && r.status === 504 && drawPayload) {
    r = await run('/public/draw', drawPayload)
  }
  if (!r.ok) {
    await throwPublicTaskError(r, `run public task(with auth) failed: ${r.status}`)
  }
  return r.json()
}

export async function fetchPublicTaskResult(apiKey: string, payload: PublicFetchTaskResultRequestDto): Promise<PublicFetchTaskResultResponseDto> {
  const r = await apiFetch(`${API_BASE}/public/tasks/result`, withPublicApiKey(apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    let msg = `fetch public task result failed: ${r.status}`
    let body: any = null
    try {
      body = await r.json()
      msg = body?.message || body?.error || msg
    } catch {
      body = null
    }
    const err = new Error(msg) as any
    err.status = r.status
    if (body && typeof body === 'object') {
      err.code = body.code
      err.details = body.details
      if (err.code === 'team_required') {
        err.message =
          '个人账号也可使用，但需要有积分；请联系管理员分配额度，或使用邀请码注册领取欢迎积分。'
      }
    }
    throw err
  }
  return r.json()
}

// Authenticated JWT call to /public/tasks/result.
export async function fetchPublicTaskResultWithAuth(payload: PublicFetchTaskResultRequestDto): Promise<PublicFetchTaskResultResponseDto> {
  const r = await apiFetch(`${API_BASE}/public/tasks/result`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    let msg = `fetch public task result(with auth) failed: ${r.status}`
    let body: unknown = null
    try {
      body = await r.json()
      if (typeof body === 'object' && body) {
        const b = body as { message?: unknown; error?: unknown }
        if (typeof b.message === 'string' && b.message.trim()) msg = b.message
        else if (typeof b.error === 'string' && b.error.trim()) msg = b.error
      }
    } catch {
      body = null
    }
    const err = new Error(msg) as Error & { status?: number; code?: unknown; details?: unknown }
    err.status = r.status
    if (typeof body === 'object' && body) {
      const b = body as { code?: unknown; details?: unknown }
      err.code = b.code
      err.details = b.details
    }
    throw err
  }
  return r.json()
}

export type SynthesizeSpeechRequestDto = {
  text: string
  model: string
  voiceId?: string
  emotion?: string
  speed?: number
  soundEffects?: string[]
  // 豆包语音 doubao-seed-audio 专有参数（model 以 doubao-seed-audio 开头时生效）
  speechRate?: number
  pitchRate?: number
  loudnessRate?: number
  sampleRate?: number
  responseFormat?: string
  // 音色克隆参考（图优先、与音频互斥）
  referenceAudioUrls?: string[]
  referenceImageUrl?: string
}

// 豆包语音富音色元数据（来自 hono /public/audio/doubao-voices → 火山 ListSpeakers）
export type DoubaoSeedAudioVoiceDto = {
  id: string
  name: string
  avatar: string
  trialUrl: string
  gender: string
  age: string
  scene: string
  description: string
  emotions?: string[]
}

// 拉取豆包富音色目录；后端未配 VOLC AK/SK 时返回空数组（调用方回落静态库）。
export async function fetchDoubaoSeedAudioVoices(): Promise<DoubaoSeedAudioVoiceDto[]> {
  const r = await apiFetch(`${API_BASE}/public/audio/doubao-voices`, withAuth({ method: 'GET' }))
  if (!r.ok) return []
  const body = await r.json().catch(() => null)
  const list = body && typeof body === 'object' ? (body as { voices?: unknown }).voices : null
  return Array.isArray(list) ? (list as DoubaoSeedAudioVoiceDto[]) : []
}

export type SynthesizeSpeechResponseDto = {
  url: string
  key: string
  bytes: number
  durationSec: number | null
  model: string
  voiceId: string
  emotion: string | null
}

// MiniMax 语音合成（hono → new-api relay → kapon），返回已转存对象存储的 mp3 URL。
export async function synthesizeSpeechAudio(payload: SynthesizeSpeechRequestDto): Promise<SynthesizeSpeechResponseDto> {
  const r = await apiFetch(`${API_BASE}/public/audio/speech`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    let msg = `speech synthesis failed: ${r.status}`
    try {
      const body = await r.json()
      if (body && typeof body === 'object') {
        const b = body as { error?: unknown; detail?: unknown; message?: unknown }
        if (typeof b.message === 'string' && b.message.trim()) msg = b.message
        else if (typeof b.detail === 'string' && b.detail.trim()) msg = b.detail
        else if (typeof b.error === 'string' && b.error.trim()) msg = b.error
      }
    } catch {
      // keep default message
    }
    throw new Error(msg)
  }
  return r.json()
}

export type GenerateMusicRequestDto = {
  prompt?: string
  lyrics?: string
  lyricsMode?: 'auto' | 'custom' | 'instrumental'
  model: string
}

export type GenerateMusicResponseDto = {
  url: string
  key: string
  bytes: number
  durationSec: number | null
  model: string
}

// MiniMax 音乐生成（hono → new-api 透传 → api.minimaxi.com），同步 1-3 分钟。
export async function generateMusicAudio(payload: GenerateMusicRequestDto): Promise<GenerateMusicResponseDto> {
  const r = await apiFetch(`${API_BASE}/public/audio/music`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    let msg = `music generation failed: ${r.status}`
    try {
      const body = await r.json()
      if (body && typeof body === 'object') {
        const b = body as { error?: unknown; detail?: unknown; message?: unknown }
        if (typeof b.message === 'string' && b.message.trim()) msg = b.message
        else if (typeof b.detail === 'string' && b.detail.trim()) msg = b.detail
        else if (typeof b.error === 'string' && b.error.trim()) msg = b.error
      }
    } catch {
      // keep default message
    }
    throw new Error(msg)
  }
  return r.json()
}

export type MuxVideoAudioRequestDto = {
  videoUrl: string
  audioUrl: string
  mode?: 'mix' | 'replace'
  originalVolume?: number
  audioVolume?: number
}

export type MuxVideoAudioResponseDto = {
  url: string
  key: string
  bytes: number
  durationSec: number | null
}

// 把音频节点的音轨合到视频上（服务端 ffmpeg）；mode=mix 与原音轨叠混，replace 替换。
export async function muxVideoAudio(payload: MuxVideoAudioRequestDto): Promise<MuxVideoAudioResponseDto> {
  const r = await apiFetch(`${API_BASE}/public/video/mux-audio`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    let msg = `video mux-audio failed: ${r.status}`
    try {
      const body = await r.json()
      if (body && typeof body === 'object') {
        const b = body as { error?: unknown; detail?: unknown }
        if (typeof b.detail === 'string' && b.detail.trim()) msg = b.detail
        else if (typeof b.error === 'string' && b.error.trim()) msg = b.error
      }
    } catch {
      // keep default message
    }
    throw new Error(msg)
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
	const parsed = z.array(z.object({
		taskId: z.string().optional(),
		nodeId: z.string().optional(),
		nodeKind: z.string().optional(),
		taskKind: z.enum([
			'chat',
			'prompt_refine',
			'text_to_image',
			'image_to_prompt',
			'image_to_video',
			'text_to_video',
			'image_edit',
			'image_to_3d',
			'video_enhance',
			'video_edit',
			'image_remove_bg',
		]).optional(),
		vendor: z.string().optional(),
		status: z.enum(['queued', 'running', 'succeeded', 'failed']),
		progress: z.number().optional(),
		message: z.string().optional(),
		assets: z.array(z.object({
			type: z.enum(['image', 'video', 'audio']),
			url: z.string(),
			thumbnailUrl: z.string().nullable().optional(),
			posterInline: z.string().nullable().optional(),
			assetId: z.string().nullable().optional(),
			assetRefId: z.string().nullable().optional(),
			assetName: z.string().nullable().optional(),
		})).optional(),
		raw: z.unknown().optional(),
		timestamp: z.number().optional(),
	})).safeParse(await r.json())
	if (!parsed.success) {
		throw new Error(`pending task response invalid: ${parsed.error.message}`)
	}
	return parsed.data
}

const TaskInboxItemSchema = z.object({
	taskId: z.string().min(1),
	vendor: z.string().min(1),
	kind: z.string().min(1),
	status: z.enum(['queued', 'running', 'succeeded', 'failed']),
	assetCount: z.number().int().min(0),
	assets: z.array(z.object({
		type: z.enum(['image', 'video', 'audio']),
		url: z.string(),
		thumbnailUrl: z.string().nullable().optional(),
		posterInline: z.string().nullable().optional(),
		assetId: z.string().nullable().optional(),
		assetRefId: z.string().nullable().optional(),
		assetName: z.string().nullable().optional(),
	})),
	prompt: z.string().nullable(),
	errorMessage: z.string().nullable(),
	nodeId: z.string().nullable(),
	chapterId: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	completedAt: z.string().nullable(),
	notificationId: z.string().nullable(),
	readAt: z.string().nullable(),
})

const TaskInboxResponseSchema = z.object({
	items: z.array(TaskInboxItemSchema),
	nextCursor: z.string().nullable(),
	unreadCount: z.number().int().min(0),
})

export type TaskInboxItemDto = z.infer<typeof TaskInboxItemSchema>
export type TaskInboxResponseDto = z.infer<typeof TaskInboxResponseSchema>

export async function listTaskInbox(input?: { cursor?: string | null; limit?: number }): Promise<TaskInboxResponseDto> {
	const query = new URLSearchParams({ limit: String(input?.limit ?? 50) })
	if (input?.cursor) query.set('cursor', input.cursor)
	const response = await apiFetch(`${API_BASE}/tasks/inbox?${query.toString()}`, withAuth())
	if (!response.ok) throw new Error(`加载生成记录失败: ${response.status}`)
	const parsed = TaskInboxResponseSchema.safeParse(await response.json())
	if (!parsed.success) throw new Error(`生成记录数据无效: ${parsed.error.message}`)
	return parsed.data
}

export async function markTaskInboxNotificationRead(notificationId: string): Promise<{ id: string; readAt: string; updated: boolean }> {
	const response = await apiFetch(
		`${API_BASE}/account/notifications/${encodeURIComponent(notificationId)}/read`,
		withAuth({ method: 'POST' }),
	)
	if (!response.ok) throw new Error(`标记生成记录为已读失败: ${response.status}`)
	const parsed = z.object({
		id: z.string(),
		readAt: z.string(),
		updated: z.boolean(),
	}).safeParse(await response.json())
	if (!parsed.success) throw new Error(`task notification read response invalid: ${parsed.error.message}`)
	return parsed.data
}

export type CommerceProductStatus = 'draft' | 'active' | 'inactive'

export type CommerceProductSkuDto = {
  id: string
  productId: string
  name: string
  spec: string
  priceCents: number
  stock: number
  isDefault: boolean
  status: CommerceProductStatus
  createdAt: string
  updatedAt: string
}

export type CommerceProductDto = {
  id: string
  title: string
  subtitle: string | null
  description: string | null
  currency: string
  priceCents: number
  stock: number
  status: CommerceProductStatus
  entitlementType: ProductEntitlementType
  entitlementConfigJson: string | null
  coverImageUrl: string | null
  images: string[]
  skus: CommerceProductSkuDto[]
  createdAt: string
  updatedAt: string
}

export type CommerceProductListResponseDto = {
  items: CommerceProductDto[]
  total: number
  page: number
  size: number
}

export async function listCommerceProducts(params?: {
  keyword?: string
  status?: CommerceProductStatus
  entitlementType?: Exclude<ProductEntitlementType, 'none'>
  scope?: 'all' | 'billing'
  page?: number
  size?: number
}): Promise<CommerceProductListResponseDto> {
  const qs = new URLSearchParams()
  if (params?.keyword) qs.set('keyword', params.keyword)
  if (params?.status) qs.set('status', params.status)
  if (params?.entitlementType) qs.set('entitlementType', params.entitlementType)
  if (params?.scope) qs.set('scope', params.scope)
  if (typeof params?.page === 'number') qs.set('page', String(params.page))
  if (typeof params?.size === 'number') qs.set('size', String(params.size))
  const r = await apiFetch(`${API_BASE}/products${qs.toString() ? `?${qs.toString()}` : ''}`, withAuth())
  if (!r.ok) throw new Error(`list products failed: ${r.status}`)
  return r.json()
}

export async function getCommerceProduct(productId: string): Promise<CommerceProductDto> {
  const r = await apiFetch(`${API_BASE}/products/${encodeURIComponent(productId)}`, withAuth())
  if (!r.ok) throw new Error(`get product failed: ${r.status}`)
  return r.json()
}

export async function upsertCommerceProduct(payload: {
  id?: string
  title: string
  subtitle?: string
  description?: string
  currency?: string
  priceCents: number
  stock: number
  status?: CommerceProductStatus
  coverImageUrl?: string
  images?: string[]
  skus?: Array<{
    id?: string
    name: string
    spec?: string
    priceCents: number
    stock: number
    isDefault?: boolean
    status?: CommerceProductStatus
  }>
}): Promise<CommerceProductDto> {
  const isUpdate = typeof payload.id === 'string' && payload.id.trim().length > 0
  const url = isUpdate
    ? `${API_BASE}/products/${encodeURIComponent(payload.id!.trim())}`
    : `${API_BASE}/products`
  const r = await apiFetch(url, withAuth({
    method: isUpdate ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    const msg = body?.message || body?.error || `upsert product failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function updateCommerceProductStatus(productId: string, status: CommerceProductStatus): Promise<CommerceProductDto> {
  const r = await apiFetch(`${API_BASE}/products/${encodeURIComponent(productId)}/status`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }))
  if (!r.ok) throw new Error(`update product status failed: ${r.status}`)
  return r.json()
}

export async function deleteCommerceProduct(productId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/products/${encodeURIComponent(productId)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete product failed: ${r.status}`)
}

export type CommerceDictionaryItemDto = {
  id: string
  ownerId: string
  dictType: string
  code: string
  name: string
  valueJson: string | null
  enabled: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export async function listCommerceDictionaries(dictType?: string): Promise<CommerceDictionaryItemDto[]> {
  const qs = new URLSearchParams()
  if (dictType) qs.set('dictType', dictType)
  const r = await apiFetch(`${API_BASE}/commerce/dictionaries${qs.toString() ? `?${qs.toString()}` : ''}`, withAuth())
  if (!r.ok) throw new Error(`list commerce dictionaries failed: ${r.status}`)
  return r.json()
}

export async function upsertCommerceDictionary(payload: {
  id?: string
  dictType: string
  code: string
  name: string
  valueJson?: string
  enabled?: boolean
  sortOrder?: number
}): Promise<CommerceDictionaryItemDto> {
  const r = await apiFetch(`${API_BASE}/commerce/dictionaries`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`upsert commerce dictionary failed: ${r.status}`)
  return r.json()
}

export async function deleteCommerceDictionary(id: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/commerce/dictionaries/${encodeURIComponent(id)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete commerce dictionary failed: ${r.status}`)
}

export async function cancelWorkflowExecution(executionId: string): Promise<Readonly<{
  execution: WorkflowExecutionDto
  receipt: unknown
  localAbortedJobs: number
}>> {
  const r = await apiFetch(`${API_BASE}/executions/${encodeURIComponent(executionId)}/cancel`, withAuth({ method: 'POST' }))
  if (!r.ok) await throwApiError(r, `cancel execution failed: ${r.status}`)
  return r.json()
}

export type ProductEntitlementType = 'none' | 'membership' | 'team_plan' | 'skill_license'

export type ProductEntitlementDto = {
  productId: string
  entitlementType: ProductEntitlementType
  configJson: string | null
  createdAt: string
  updatedAt: string
}

export async function upsertProductEntitlement(productId: string, payload: {
  entitlementType: ProductEntitlementType
  config: Record<string, unknown>
}): Promise<ProductEntitlementDto> {
  const r = await apiFetch(`${API_BASE}/commerce/products/${encodeURIComponent(productId)}/entitlement`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) throw new Error(`upsert product entitlement failed: ${r.status}`)
  return r.json()
}

export type SubscriptionDto = {
  id: string
  ownerId: string
  planCode: string
  status: 'active' | 'expired' | 'canceled'
  startAt: string
  endAt: string
  billingCycle: 'monthly' | 'annual'
  durationDays: number
  monthlyCredits: number
  dailyGiftCredits: number
  concurrencyLimit: number
  capacityLabel: string
  creditGrantCount: number
  creditGrantsIssued: number
  nextCreditGrantAt: string | null
  timezone: string
  createdAt: string
  updatedAt: string
  canceledAt: string | null
}

export type SubscriptionDailyQuotaDto = {
  id: string
  subscriptionId: string
  ownerId: string
  quotaDate: string
  dailyLimit: number
  usedCount: number
  remaining: number
  createdAt: string
  updatedAt: string
}

export async function listActiveSubscriptions(): Promise<SubscriptionDto[]> {
  const r = await apiFetch(`${API_BASE}/commerce/subscriptions/active`, withAuth())
  if (!r.ok) throw new Error(`list active subscriptions failed: ${r.status}`)
  return r.json()
}

export async function listSubscriptionQuotas(subscriptionId: string): Promise<SubscriptionDailyQuotaDto[]> {
  const r = await apiFetch(`${API_BASE}/commerce/subscriptions/${encodeURIComponent(subscriptionId)}/quotas`, withAuth())
  if (!r.ok) throw new Error(`list subscription quotas failed: ${r.status}`)
  return r.json()
}

export async function consumeSubscriptionQuota(subscriptionId: string, payload: {
  amount: number
  idempotencyKey: string
  reason?: string
}): Promise<SubscriptionDailyQuotaDto> {
  const r = await apiFetch(`${API_BASE}/commerce/subscriptions/${encodeURIComponent(subscriptionId)}/consume`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    const msg = body?.message || body?.error || `consume subscription quota failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export type DetailPageSampleDto = {
  id: string
  ownerId: string
  title: string
  category: string
  tags: string[]
  source: string | null
  imageUrl: string | null
  summary: string | null
  modulesJson: string | null
  copyJson: string | null
  styleJson: string | null
  scoreQuality: number
  scoreVisual: number
  scoreConversion: number
  usageCount: number
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

export type DetailPageSampleRetrieveDto = {
  sample: DetailPageSampleDto
  score: number
}

export type DetailPageSampleRetrieveResponseDto = {
  items: DetailPageSampleRetrieveDto[]
  contextSnippet: string
}

export type DetailPageEvolutionSummaryDto = {
  sampleCount: number
  retrievalCount7d: number
  feedbackCount7d: number
  avgOverallScore: number
  avgEditRatio: number
}

export type DetailPageEvolutionRunResponseDto = {
  runId: string
  action: 'ready_for_optimizer' | 'skip'
  metrics: DetailPageEvolutionSummaryDto & {
    minFeedbacks: number
    hasEnoughFeedbacks: boolean
    weakCategories: Array<{
      category: string
      avgOverallScore: number
      feedbackCount: number
    }>
  }
  createdAt: string
}

export async function listDetailPageSamples(params?: {
  category?: string
  limit?: number
}): Promise<DetailPageSampleDto[]> {
  const qs = new URLSearchParams()
  if (params?.category) qs.set('category', params.category)
  if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) qs.set('limit', String(Math.trunc(params.limit)))
  const url = qs.toString() ? `${API_BASE}/commerce/detail-page-samples?${qs.toString()}` : `${API_BASE}/commerce/detail-page-samples`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) throw new Error(`list detail page samples failed: ${r.status}`)
  return r.json()
}

export async function upsertDetailPageSample(payload: {
  id?: string
  title: string
  category: string
  tags?: string[]
  source?: string
  imageUrl?: string
  summary?: string
  modulesJson?: string
  copyJson?: string
  styleJson?: string
  scoreQuality?: number
  scoreVisual?: number
  scoreConversion?: number
}): Promise<DetailPageSampleDto> {
  const r = await apiFetch(`${API_BASE}/commerce/detail-page-samples`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    const msg = body?.message || body?.error || `upsert detail page sample failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function deleteDetailPageSample(sampleId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/commerce/detail-page-samples/${encodeURIComponent(sampleId)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) throw new Error(`delete detail page sample failed: ${r.status}`)
}

export async function retrieveDetailPageSamples(payload: {
  query?: string
  category?: string
  limit?: number
}): Promise<DetailPageSampleRetrieveResponseDto> {
  const r = await apiFetch(`${API_BASE}/commerce/detail-page-samples/retrieve`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    const msg = body?.message || body?.error || `retrieve detail page samples failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function createDetailPageFeedback(payload: {
  generationId?: string
  sampleIds: string[]
  scoreOverall: number
  scoreStructure?: number
  scoreVisual?: number
  scoreConversion?: number
  editRatio?: number
  note?: string
}): Promise<{ inserted: number }> {
  const r = await apiFetch(`${API_BASE}/commerce/detail-page-feedback`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    const msg = body?.message || body?.error || `create detail page feedback failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export async function getDetailPageEvolutionSummary(): Promise<DetailPageEvolutionSummaryDto> {
  const r = await apiFetch(`${API_BASE}/commerce/detail-page-evolution/summary`, withAuth())
  if (!r.ok) throw new Error(`get detail page evolution summary failed: ${r.status}`)
  return r.json()
}

export async function runDetailPageEvolution(payload?: {
  minFeedbacks?: number
}): Promise<DetailPageEvolutionRunResponseDto> {
  const r = await apiFetch(`${API_BASE}/commerce/detail-page-evolution/run`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  }))
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    const msg = body?.message || body?.error || `run detail page evolution failed: ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}

export type MemoryScopeType = 'user' | 'project' | 'book' | 'chapter' | 'session' | 'task'
export type MemoryEntryType = 'preference' | 'domain_fact' | 'artifact_ref' | 'summary'
export type MemoryStatus = 'active' | 'archived' | 'superseded'

export type MemoryEntryDto = {
  id: string
  scopeType: MemoryScopeType
  scopeId: string
  memoryType: MemoryEntryType
  title: string | null
  summaryText: string | null
  content: Record<string, unknown>
  importance: number
  status: MemoryStatus
  createdAt: string
  updatedAt: string
  tags: string[]
}

export type MemorySearchRequestDto = {
  query?: string
  scopes?: Array<{ scopeType: MemoryScopeType; scopeId: string }>
  memoryTypes?: MemoryEntryType[]
  tags?: string[]
  status?: MemoryStatus
  limit?: number
}

export type MemorySearchResponseDto = {
  items: MemoryEntryDto[]
}

export async function searchMemoryEntries(payload: MemorySearchRequestDto): Promise<MemorySearchResponseDto> {
  const r = await apiFetch(`${API_BASE}/memory/search`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, '查询记忆失败')
  return await r.json() as MemorySearchResponseDto
}

export type MemoryWriteEntryDto = {
  scopeType: MemoryScopeType
  scopeId: string
  memoryType: MemoryEntryType
  title?: string
  summaryText?: string
  content: Record<string, unknown>
  sourceKind: 'user_input' | 'agent_output' | 'system_extract' | 'task_result' | 'manual'
  sourceId?: string
  importance?: number
  tags?: string[]
  status?: MemoryStatus
}

export type MemoryWriteResponseDto = {
  success: boolean
  items: Array<{ id: string }>
}

export async function writeMemoryEntries(entries: MemoryWriteEntryDto[]): Promise<MemoryWriteResponseDto> {
  const r = await apiFetch(`${API_BASE}/memory/write`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  }))
  if (!r.ok) await throwApiError(r, '写入记忆失败')
  return await r.json() as MemoryWriteResponseDto
}

export type MemoryContextRequestDto = {
  sessionKey?: string
  projectId?: string
  bookId?: string
  chapterId?: string
  limitPerScope?: number
  recentConversationLimit?: number
}

export type MemoryContextSectionDto = {
  userPreferences: MemoryEntryDto[]
  projectFacts: MemoryEntryDto[]
  bookFacts: MemoryEntryDto[]
  chapterFacts: MemoryEntryDto[]
  artifactRefs: MemoryEntryDto[]
  rollups: {
    user: MemoryEntryDto[]
    project: MemoryEntryDto[]
    book: MemoryEntryDto[]
    chapter: MemoryEntryDto[]
    session: MemoryEntryDto[]
  }
  recentConversation: MemoryConversationItemDto[]
}

export type MemoryContextResponseDto = {
  context: MemoryContextSectionDto
  summaryText: string
  promptText: string
}

export type MemoryConversationItemDto = {
  messageId: string
  turnId?: string
  role: string
  content: string
  assets: unknown[]
  createdAt: string
  executionProvenance?: AgentExecutionProvenanceDto
}

export async function getMemoryContext(payload: MemoryContextRequestDto): Promise<MemoryContextResponseDto> {
  const r = await apiFetch(`${API_BASE}/memory/context`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, '获取记忆上下文失败')
  return await r.json() as MemoryContextResponseDto
}

export type ProjectChatArtifactAssetDto = {
  type: 'image' | 'video' | 'audio' | null
  title: string | null
  url: string
  thumbnailUrl: string | null
  vendor: string | null
  modelKey: string | null
  taskId: string | null
}

export type ProjectChatArtifactTurnDto = {
  assistantMessageId: string
  createdAt: string
  userText: string | null
  assistantText: string
  assets: ProjectChatArtifactAssetDto[]
}

export type ProjectChatArtifactSessionDto = {
  sessionId: string
  sessionKey: string
  updatedAt: string
  lane: string
  skillId: string
  turns: ProjectChatArtifactTurnDto[]
}

export type ChatSessionSummaryDto = {
  sessionId: string
  sessionKey: string
  updatedAt: string
  firstUserMessage: string | null
}

export type ProjectChatSessionsRequestDto = {
  projectId: string
  flowId?: string
  // 章节画布作用域：按 project:<pid>:chapter:<chapterId> 前缀列会话（优先于 flowId）
  chapterId?: string
  limit?: number
}

export async function listProjectChatSessions(
  payload: ProjectChatSessionsRequestDto,
): Promise<ChatSessionSummaryDto[]> {
  const r = await apiFetch(`${API_BASE}/memory/project-sessions`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, '获取项目会话历史失败')
  const data = await r.json() as { items: ChatSessionSummaryDto[] }
  return data.items
}

export type ProjectChatArtifactSessionsRequestDto = {
  projectId: string
  flowId?: string
  limitSessions?: number
  limitTurns?: number
}

export type ProjectChatArtifactSessionsResponseDto = {
  items: ProjectChatArtifactSessionDto[]
}

export async function listProjectChatArtifactSessions(
  payload: ProjectChatArtifactSessionsRequestDto,
): Promise<ProjectChatArtifactSessionsResponseDto> {
  const r = await apiFetch(`${API_BASE}/memory/project-chat-artifacts`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, '获取项目对话产物历史失败')
  return await r.json() as ProjectChatArtifactSessionsResponseDto
}

export type PublicConversationMessageDto = {
  id: string
  role: 'user' | 'assistant'
  content: string
  assets: ProjectChatArtifactAssetDto[]
  createdAt: string
}

export type PublicConversationSessionDto = {
  sessionId: string
  sessionKey: string
  updatedAt: string
  messages: PublicConversationMessageDto[]
}

export type PublicConversationResponseDto = {
  sessions: PublicConversationSessionDto[]
}

export async function getPublicProjectConversation(
  projectId: string,
  scope?: { ownerType: 'chapter'; ownerId: string },
): Promise<PublicConversationResponseDto> {
  const params = new URLSearchParams()
  if (scope) {
    params.set('ownerType', scope.ownerType)
    params.set('ownerId', scope.ownerId)
  }
  const query = params.toString()
  const path = `${API_BASE}/projects/${encodeURIComponent(projectId)}/conversation${query ? `?${query}` : ''}`
  const r = await apiFetch(path, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!r.ok) await throwApiError(r, '获取项目对话过程失败')
  return await r.json() as PublicConversationResponseDto
}

export async function getPublicProjectChatSessions(projectId: string): Promise<ProjectChatArtifactSessionsResponseDto> {
  const r = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/chat`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!r.ok) await throwApiError(r, '获取项目对话历史失败')
  return await r.json() as ProjectChatArtifactSessionsResponseDto
}

// ── Project Cover Meta ──────────────────────────────────────────────────────

export async function fetchProjectCoverImageUrl(projectId: string): Promise<string | null> {
  const trimmed = projectId.trim()
  if (!trimmed) return null
  try {
    const { items } = await listServerAssets({ projectId: trimmed, kind: 'projectCoverMeta', limit: 1 })
    const imageUrl = String(items[0]?.data?.imageUrl || '').trim()
    if (imageUrl) return imageUrl
  } catch {
    // non-critical
  }
  return null
}

export async function saveProjectCoverMeta(projectId: string, imageUrl: string): Promise<void> {
  const trimmedProject = projectId.trim()
  const trimmedUrl = imageUrl.trim()
  if (!trimmedProject || !trimmedUrl) return // empty imageUrl is a no-op; clearing is not supported
  try {
    const { items } = await listServerAssets({ projectId: trimmedProject, kind: 'projectCoverMeta', limit: 1 })
    const payload = { kind: 'projectCoverMeta', imageUrl: trimmedUrl }
    if (items[0]) {
      await updateServerAssetData(items[0].id, payload)
    } else {
      await createServerAsset({ name: 'projectCoverMeta', projectId: trimmedProject, data: payload })
    }
  } catch {
    // cover is non-critical; silently ignore write failures
  }
}

// ============================================================================
// Referral campaign / popup ad
// ============================================================================

export type ReferralCampaignDto = {
  enabled: boolean
  title: string
  body: string
  ctaText: string
  imageUrl: string | null
  inviteeWelcomeCredits: number
}

export type MyReferralDto = { inviteCode: string; inviteUrl: string }

export type ReferralStatsDto = { inviteeCount: number; totalGrantedCredits: number }

export async function getReferralCampaign(): Promise<ReferralCampaignDto> {
  const r = await apiFetch(`${API_BASE}/api/referral/campaign`, withoutAuth())
  if (!r.ok) await throwApiError(r, 'campaign load failed')
  return await r.json() as ReferralCampaignDto
}

export async function getMyReferral(): Promise<MyReferralDto> {
  const r = await apiFetch(`${API_BASE}/api/referral/me`, withAuth())
  if (!r.ok) await throwApiError(r, 'referral load failed')
  return await r.json() as MyReferralDto
}

export async function getReferralStats(): Promise<ReferralStatsDto> {
  const r = await apiFetch(`${API_BASE}/api/referral/stats`, withAuth())
  if (!r.ok) await throwApiError(r, 'stats load failed')
  return await r.json() as ReferralStatsDto
}

export type AdminReferralConfigDto = {
  id: number
  enabled: number
  title: string
  body: string
  cta_text: string
  image_url: string | null
  invitee_welcome_credits: number
  anti_self_check: number
  anti_self_window_days: number
  updated_at: string
}

export async function adminGetReferralConfig(): Promise<AdminReferralConfigDto> {
  const r = await apiFetch(`${API_BASE}/admin/referral/config`, withAuth())
  if (!r.ok) await throwApiError(r, 'config load failed')
  return await r.json() as AdminReferralConfigDto
}

export async function adminUpdateReferralConfig(
  patch: Partial<AdminReferralConfigDto>,
): Promise<AdminReferralConfigDto> {
  const r = await apiFetch(`${API_BASE}/admin/referral/config`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
  if (!r.ok) await throwApiError(r, 'config save failed')
  return await r.json() as AdminReferralConfigDto
}

export async function adminRegenerateReferralImage(): Promise<AdminReferralConfigDto> {
  const r = await apiFetch(`${API_BASE}/admin/referral/image:regenerate`, withAuth({
    method: 'POST',
  }))
  if (!r.ok) await throwApiError(r, 'image generate failed')
  return await r.json() as AdminReferralConfigDto
}

export type AdminReferralOverviewRowDto = {
  referrer_user_id: string
  referrer_login: string | null
  referrer_phone: string | null
  referrer_invite_code: string | null
  invitee_count: number
  total_granted_credits: number
  last_grant_at: string | null
}

export type AdminReferralBindingRowDto = {
  invitee_user_id: string
  invitee_login: string | null
  invitee_phone: string | null
  referrer_user_id: string
  referrer_login: string | null
  referrer_phone: string | null
  referrer_bound_at: string | null
  invitee_grant_total: number
}

export type AdminReferralGrantRowDto = {
  id: string
  source_topup_ledger_id: string
  referrer_user_id: string
  referrer_login: string | null
  invitee_user_id: string
  invitee_login: string | null
  kind: 'welcome_bonus'
  granted_credits: number
  ledger_entry_id: string
  created_at: string
}

export async function adminListReferralOverview(opts?: { limit?: number; search?: string }): Promise<{ items: AdminReferralOverviewRowDto[] }> {
  const params = new URLSearchParams()
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.search) params.set('search', opts.search)
  const qs = params.toString()
  const r = await apiFetch(`${API_BASE}/admin/referral/overview${qs ? `?${qs}` : ''}`, withAuth())
  if (!r.ok) await throwApiError(r, 'overview load failed')
  return await r.json() as { items: AdminReferralOverviewRowDto[] }
}

export async function adminListReferralBindings(opts?: { referrerUserId?: string; limit?: number }): Promise<{ items: AdminReferralBindingRowDto[] }> {
  const params = new URLSearchParams()
  if (opts?.referrerUserId) params.set('referrerUserId', opts.referrerUserId)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const qs = params.toString()
  const r = await apiFetch(`${API_BASE}/admin/referral/bindings${qs ? `?${qs}` : ''}`, withAuth())
  if (!r.ok) await throwApiError(r, 'bindings load failed')
  return await r.json() as { items: AdminReferralBindingRowDto[] }
}

export async function adminListReferralGrants(opts?: { referrerUserId?: string; limit?: number }): Promise<{ items: AdminReferralGrantRowDto[] }> {
  const params = new URLSearchParams()
  if (opts?.referrerUserId) params.set('referrerUserId', opts.referrerUserId)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const qs = params.toString()
  const r = await apiFetch(`${API_BASE}/admin/referral/grants${qs ? `?${qs}` : ''}`, withAuth())
  if (!r.ok) await throwApiError(r, 'grants load failed')
  return await r.json() as { items: AdminReferralGrantRowDto[] }
}

// ── 用户通知偏好 ──────────────────────────────────────────────────────────────

export async function getNotificationPreferences(): Promise<{ emailMarketing: boolean }> {
  const r = await apiFetch(`${API_BASE}/auth/notification-preferences`, withAuth())
  if (!r.ok) await throwApiError(r, '获取通知偏好失败')
  return await r.json() as { emailMarketing: boolean }
}

export async function updateNotificationPreferences(prefs: { emailMarketing: boolean }): Promise<void> {
  const r = await apiFetch(`${API_BASE}/auth/notification-preferences`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  }))
  if (!r.ok) await throwApiError(r, '更新通知偏好失败')
}

// ── 管理员邮件群发 ─────────────────────────────────────────────────────────────

export type EmailCampaignResult = {
  total: number
  sent: number
  failed: number
  skippedNoEmail: number
}

export type EmailCampaignRecipient = { id: string; email: string; login: string }
export type EmailCampaignRecipientsResult = { items: EmailCampaignRecipient[]; total: number; page: number; pageSize: number }

export async function getEmailCampaignRecipients(page: number, pageSize: number): Promise<EmailCampaignRecipientsResult> {
  const r = await apiFetch(`${API_BASE}/admin/users/email-campaign/recipients?page=${page}&pageSize=${pageSize}`, withAuth())
  if (!r.ok) await throwApiError(r, '获取收件人列表失败')
  return await r.json() as EmailCampaignRecipientsResult
}

export async function sendEmailCampaign(data: { subject: string; body: string }): Promise<EmailCampaignResult> {
  const r = await apiFetch(`${API_BASE}/admin/users/email-campaign`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }))
  if (!r.ok) await throwApiError(r, '邮件群发失败')
  return await r.json() as EmailCampaignResult
}

// ===== Community (P1): channels / explore / social / publish / profile =====

export type CommunityChannelDto = {
  slug: string
  name: string
  description: string | null
  icon: string | null
  sortOrder: number
}

export type CommunityProjectCardDto = {
  id: string
  name: string
  coverUrl: string | null
  description: string | null
  channelSlug: string | null
  ownerLogin: string | null
  ownerName: string | null
  ownerAvatarUrl: string | null
  likeCount: number
  favoriteCount: number
  commentCount: number
  viewCount: number
  cloneCount: number
  episodeCount: number
  publishedAt: string | null
  updatedAt: string
}

export type CommunityExplorePageDto = {
  items: CommunityProjectCardDto[]
  nextCursor: string | null
}

export type CommunityProjectDetailDto = CommunityProjectCardDto & {
  liked: boolean
  favorited: boolean
  forkedFromProjectId: string | null
}

export type CommunityCommentDto = {
  id: string
  projectId: string
  userId: string
  parentId: string | null
  body: string
  likeCount: number
  createdAt: string
  authorLogin: string | null
  authorName: string | null
  authorAvatarUrl: string | null
}

export type CommunityAuthorPageDto = {
  login: string
  name: string | null
  avatarUrl: string | null
  bio: string | null
  bannerUrl: string | null
  links: Array<{ label: string; url: string }>
  followerCount: number
  followingCount: number
  following: boolean
  projects: CommunityProjectCardDto[]
}

export type ExploreSort = 'hot' | 'new' | 'fav'

export async function listCommunityChannels(): Promise<CommunityChannelDto[]> {
  const r = await apiFetch(`${API_BASE}/community/channels`, withAuth())
  if (!r.ok) return []
  return (await r.json()) as CommunityChannelDto[]
}

export async function exploreCommunity(params?: {
  channel?: string
  sort?: ExploreSort
  q?: string
  cursor?: string
  limit?: number
}): Promise<CommunityExplorePageDto> {
  const qs = new URLSearchParams()
  if (params?.channel) qs.set('channel', params.channel)
  if (params?.sort) qs.set('sort', params.sort)
  if (params?.q) qs.set('q', params.q)
  if (params?.cursor) qs.set('cursor', params.cursor)
  if (typeof params?.limit === 'number') qs.set('limit', String(params.limit))
  const query = qs.toString()
  const url = query ? `${API_BASE}/community/explore?${query}` : `${API_BASE}/community/explore`
  const r = await apiFetch(url, withAuth())
  if (!r.ok) await throwApiError(r, '加载探索列表失败')
  return (await r.json()) as CommunityExplorePageDto
}

export async function listFeaturedCommunity(limit = 8): Promise<CommunityProjectCardDto[]> {
  const r = await apiFetch(`${API_BASE}/community/featured?limit=${encodeURIComponent(String(limit))}`, withAuth())
  if (!r.ok) return []
  return (await r.json()) as CommunityProjectCardDto[]
}

export async function getCommunityProject(projectId: string): Promise<CommunityProjectDetailDto> {
  const r = await apiFetch(`${API_BASE}/community/projects/${encodeURIComponent(projectId)}`, withAuth())
  if (!r.ok) await throwApiError(r, '加载项目详情失败')
  return (await r.json()) as CommunityProjectDetailDto
}

export async function listCommunityComments(projectId: string, cursor?: string | null): Promise<{ items: CommunityCommentDto[]; nextCursor: string | null }> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  const r = await apiFetch(`${API_BASE}/community/projects/${encodeURIComponent(projectId)}/comments${qs}`, withAuth())
  if (!r.ok) await throwApiError(r, '加载评论失败')
  return (await r.json()) as { items: CommunityCommentDto[]; nextCursor: string | null }
}

export async function addCommunityComment(projectId: string, body: string, parentId?: string): Promise<{ id: string }> {
  const payload = parentId ? { body, parentId } : { body }
  const r = await apiFetch(`${API_BASE}/community/projects/${encodeURIComponent(projectId)}/comments`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, '发表评论失败')
  return (await r.json()) as { id: string }
}

export async function deleteCommunityComment(commentId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/community/comments/${encodeURIComponent(commentId)}`, withAuth({ method: 'DELETE' }))
  if (!r.ok) await throwApiError(r, '删除评论失败')
}

export async function setCommunityLike(projectId: string, liked: boolean): Promise<void> {
  const r = await apiFetch(`${API_BASE}/community/projects/${encodeURIComponent(projectId)}/like`, withAuth({ method: liked ? 'POST' : 'DELETE' }))
  if (!r.ok) await throwApiError(r, '操作点赞失败')
}

export async function setCommunityFavorite(projectId: string, favorited: boolean): Promise<void> {
  const r = await apiFetch(`${API_BASE}/community/projects/${encodeURIComponent(projectId)}/favorite`, withAuth({ method: favorited ? 'POST' : 'DELETE' }))
  if (!r.ok) await throwApiError(r, '操作收藏失败')
}

export async function recordCommunityView(projectId: string): Promise<void> {
  await apiFetch(`${API_BASE}/community/projects/${encodeURIComponent(projectId)}/view`, withAuth({ method: 'POST' })).catch(() => {})
}

export async function publishProjectToChannel(projectId: string, payload: {
  isPublic: boolean
  channelSlug?: string
  coverUrl?: string | null
  description?: string | null
  tags?: string[]
}): Promise<void> {
  const r = await apiFetch(`${API_BASE}/community/projects/${encodeURIComponent(projectId)}/publish`, withAuth({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, '发布失败')
}

export async function getCommunityAuthor(login: string): Promise<CommunityAuthorPageDto> {
  const r = await apiFetch(`${API_BASE}/community/users/${encodeURIComponent(login)}`, withAuth())
  if (!r.ok) await throwApiError(r, '加载作者主页失败')
  return (await r.json()) as CommunityAuthorPageDto
}

export async function setCommunityFollow(login: string, following: boolean): Promise<void> {
  const r = await apiFetch(`${API_BASE}/community/users/${encodeURIComponent(login)}/follow`, withAuth({ method: following ? 'POST' : 'DELETE' }))
  if (!r.ok) await throwApiError(r, '操作关注失败')
}

export async function updateMyCommunityProfile(payload: {
  bio?: string | null
  bannerUrl?: string | null
  links?: Array<{ label: string; url: string }>
}): Promise<void> {
  const r = await apiFetch(`${API_BASE}/community/me/profile`, withAuth({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  if (!r.ok) await throwApiError(r, '更新资料失败')
}

// ---------------------------------------------------------------------------
// Director-capture polling bridge (browser-side renderer → agents-cli)
// ---------------------------------------------------------------------------

export async function claimDirectorCapture(captureId: string): Promise<{ ok: boolean; leaseToken?: string; scene?: unknown; code?: string }> {
  const r = await apiFetch(`${API_BASE}/public/director-capture/claim`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ captureId }),
  }))
  // 409 = already_claimed (another tab won the race); return body, do not throw
  if (!r.ok && r.status !== 409) await throwApiError(r, 'claim director capture failed')
  return r.json()
}

export async function reportDirectorCapture(input: {
  captureId: string
  leaseToken: string
  status: 'succeeded' | 'failed'
  imageUrl?: string
  videoUrl?: string
  assetId?: string
  error?: string
}): Promise<void> {
  const r = await apiFetch(`${API_BASE}/public/director-capture/report`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
  if (!r.ok) await throwApiError(r, 'report director capture failed')
}
