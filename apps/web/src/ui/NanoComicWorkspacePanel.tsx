import React from 'react'
import type { Node } from '@xyflow/react'
import {
  ActionIcon,
  Button,
  Group,
  Loader,
  Menu,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  Tabs,
  Title,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { InlinePanel } from './InlinePanel'
import { PanelCard } from './PanelCard'
import {
  IconBrain,
  IconChevronDown,
  IconLayoutGrid,
  IconRefresh,
  IconVideo,
  IconX,
} from '@tabler/icons-react'
import {
  agentsChatStream,
  type AgentsChatResponseDto,
  confirmProjectBookStyle,
  ensureProjectBookMetadataWindow,
  getServerFlow,
  getLatestProjectBookReconfirmJob,
  getLatestProjectBookUploadJob,
  getProjectBookChapter,
  getProjectBookIndex,
  listProjectChatArtifactSessions,
  listProjectBookStoryboardHistory,
  listProjectBooks,
  listProjectRoleCardAssets,
  publicVisionWithAuth,
  uploadServerAssetFile,
  upsertProjectBookVisualRef,
  type ProjectBookIndexDto,
  type ProjectChatArtifactSessionDto,
  type ProjectBookListItemDto,
  type ProjectBookReconfirmJobDto,
  type ProjectBookStoryboardHistoryDto,
  type ProjectRoleCardAssetDto,
} from '../api/server'
import { useRFStore } from '../canvas/store'
import { CanvasService } from '../ai/canvasService'
import { useUIStore } from './uiStore'
import { toast } from './toast'
import { spaNavigate } from '../utils/spaNavigate'
import { findModelOptionByIdentifier, getModelOptionRequestAlias, useModelOptions } from '../config/useModelOptions'
import type { ModelOption } from '../config/models'
import {
  buildStoryboardShots,
} from './nanoComic/dataMappers'
import NanoComicStoryboardTab from './nanoComic/NanoComicStoryboardTab'
import NanoComicVideoGenerationTab from './nanoComic/NanoComicVideoGenerationTab'
import { pickPrimaryProjectBook, sortProjectBooksByUpdatedAt } from './projectBooks'
import {
  buildStoryboardProductionSummary,
  getChapterStoryboardPlan,
  getPlanShotPrompts,
  normalizeNanoComicStoryboardGroupSize,
  type StoryboardGroupSize,
} from './nanoComic/storyboardProduction'
import { upsertSemanticNodeAnchorBinding } from '../canvas/utils/semanticBindings'
import { autoRunAiChatCanvasNodes, autoRunAiChatPatchedCanvasNodes } from './chat/autoRunCanvasNodes'
import { resolveAiChatReloadAutoRunPlan } from './chat/canvasMutation'
import type {
  NanoComicShotItem,
  NanoComicStoryboardProductionItem,
} from './nanoComic/types'
import { getNanoComicEntityKey } from './nanoComic/types'
import { buildEffectiveChatSessionKey } from './chat/chatSessionKey'
import { parseRoleCardMentionToken } from '../runner/roleCardMention'
import { uploadProjectText } from './projectTextUpload'
import {
  deriveStyleHintsFromReferenceImage,
  listCanvasStyleReferenceCandidates,
  persistStyleReferenceImage,
} from './styleReference'
function focusCanvasNode(nodeId: string): void {
  try {
    const focusNode = (window as Window & { __tcFocusNode?: (id: string) => void }).__tcFocusNode
    focusNode?.(nodeId)
  } catch {
    // ignore focus failures
  }
}

function readStoryboardGroupSizeFromHistory(
  history: ProjectBookStoryboardHistoryDto | null,
  chapterNo: number | null,
): StoryboardGroupSize | null {
  const next = history?.progress?.next
  if (!next) return null
  const nextChapter = Number(next.chapter)
  if (chapterNo && Number.isFinite(nextChapter) && nextChapter > 0 && Math.trunc(nextChapter) !== chapterNo) {
    return null
  }
  return normalizeNanoComicStoryboardGroupSize(next.groupSize)
}

function areLinkedNodeMapsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false
  }
  return true
}

function buildWorkspaceModelSelectionKey(option: ModelOption): string {
  const vendor = typeof option.vendor === 'string' ? option.vendor.trim() : ''
  const value = typeof option.value === 'string' ? option.value.trim() : ''
  return `${vendor}::${value}`
}

function findWorkspaceModelOptionBySelectionKey(
  options: readonly ModelOption[],
  selectionKey: string | null | undefined,
): ModelOption | null {
  const rawSelectionKey = typeof selectionKey === 'string' ? selectionKey.trim() : ''
  if (!rawSelectionKey) return null
  const separatorIndex = rawSelectionKey.indexOf('::')
  if (separatorIndex < 0) {
    return findModelOptionByIdentifier(options, rawSelectionKey)
  }
  const vendor = rawSelectionKey.slice(0, separatorIndex).trim()
  const value = rawSelectionKey.slice(separatorIndex + 2).trim()
  if (!value) return null
  return (
    options.find((option) => {
      const optionVendor = typeof option.vendor === 'string' ? option.vendor.trim() : ''
      const optionValue = typeof option.value === 'string' ? option.value.trim() : ''
      return optionVendor === vendor && optionValue === value
    }) ||
    findModelOptionByIdentifier(options, value)
  )
}

function readWorkspaceRequestedModel(option: ModelOption | null): string {
  if (!option) return ''
  const alias = typeof option.modelAlias === 'string' ? option.modelAlias.trim() : ''
  if (alias) return alias
  const modelKey = typeof option.modelKey === 'string' ? option.modelKey.trim() : ''
  if (modelKey) return modelKey
  return typeof option.value === 'string' ? option.value.trim() : ''
}

function readRequestedWorkspaceChapterFromSearch(search: string): number | null {
  const rawSearch = String(search || '').trim()
  if (!rawSearch) return null
  try {
    const params = new URLSearchParams(rawSearch)
    const chapter = Number(params.get('chapter') || '')
    return Number.isFinite(chapter) && chapter > 0 ? Math.trunc(chapter) : null
  } catch {
    return null
  }
}

function readRequestedWorkspaceShotIdFromSearch(search: string): string {
  const rawSearch = String(search || '').trim()
  if (!rawSearch) return ''
  try {
    return String(new URLSearchParams(rawSearch).get('shotId') || '').trim()
  } catch {
    return ''
  }
}

type ChapterWorkspaceDetail = {
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
}

type ChapterProductionRequestState = {
  status: 'idle' | 'running' | 'success' | 'error'
  message: string
  updatedAtLabel: string
  updatedAtMs: number
}

type WorkspaceChecklistItem = {
  key: string
  title: string
  detail: string
  actionLabel?: string
  actionLoading?: boolean
  action?: () => void
}

const WORKSPACE_RUNTIME_SUCCESS_TTL_MS = 8000
const PROJECT_TEXT_REQUIRED_MESSAGE = '当前项目还没有上传文本，请先上传或替换项目文本。'
const STORYBOARD_EXPERT_SKILL_ID = 'tapcanvas-storyboard-expert'
const WORKSPACE_ROLE_ANCHOR_BATCH_CONCURRENCY = 4

function isWorkspaceChapterMetadataComplete(chapter: unknown): boolean {
  if (!chapter || typeof chapter !== 'object' || Array.isArray(chapter)) return false
  const record = chapter as Record<string, unknown>
  const title = String(record.title || '').trim()
  const summary = String(record.summary || '').trim()
  const coreConflict = String(record.coreConflict || '').trim()
  return (
    !!title &&
    !!summary &&
    !!coreConflict &&
    Array.isArray(record.keywords) &&
    record.keywords.length > 0 &&
    Array.isArray(record.characters) &&
    Array.isArray(record.props) &&
    Array.isArray(record.scenes) &&
    Array.isArray(record.locations)
  )
}

function hasPersistedChapterStoryboardPlan(
  index: ProjectBookIndexDto | null,
  chapterNo: number | null,
): boolean {
  const plan = getChapterStoryboardPlan(index, chapterNo)
  if (!plan) return false
  return getPlanShotPrompts(plan).length > 0
}

function hasStoryboardPlanUpsertToolEvidence(response: AgentsChatResponseDto | null): boolean {
  const toolNames = Array.isArray(response?.trace?.toolEvidence?.toolNames)
    ? response.trace.toolEvidence.toolNames
    : []
  return toolNames.includes('tapcanvas_book_storyboard_plan_upsert')
}

function buildChapterScriptPersistenceErrorMessage(response: AgentsChatResponseDto | null): string {
  const turnVerdictStatus = response?.trace?.turnVerdict?.status
  const diagnosticFlags = Array.isArray(response?.trace?.diagnosticFlags) ? response.trace.diagnosticFlags : []
  const diagnosticDetail = diagnosticFlags[0]?.detail ? `：${diagnosticFlags[0].detail}` : ''
  if (!hasStoryboardPlanUpsertToolEvidence(response)) {
    return '章节剧本结果未写回当前工作台：本轮没有调用章节剧本持久化工具 tapcanvas_book_storyboard_plan_upsert。'
  }
  if (turnVerdictStatus === 'partial' || turnVerdictStatus === 'failed') {
    return `章节剧本结果未完整落盘：agents 返回 ${turnVerdictStatus}，请检查执行日志${diagnosticDetail}`
  }
  return '章节剧本结果未写回当前工作台：刷新后仍未发现当前章节的 storyboardPlans。'
}

function didBackendWriteCanvas(response: AgentsChatResponseDto | null): boolean {
  return (
    response?.agentDecision?.canvasAction === 'write_canvas' ||
    response?.trace?.toolEvidence?.wroteCanvas === true
  )
}

type ReloadCanvasFlowResult = {
  reloaded: boolean
  newNodeIds: string[]
}

async function reloadCanvasFlowFromServer(input: {
  flowId: string
  expectedProjectId?: string
  expectedFlowId?: string
}): Promise<ReloadCanvasFlowResult> {
  const flowId = String(input.flowId || '').trim()
  if (!flowId) return { reloaded: false, newNodeIds: [] }

  const uiState = useUIStore.getState()
  const liveProjectId = String(uiState.currentProject?.id || '').trim()
  const liveFlowId = String(uiState.currentFlow?.id || '').trim()
  const expectedProjectId = String(input.expectedProjectId || '').trim()
  const expectedFlowId = String(input.expectedFlowId || '').trim()

  if (expectedProjectId && liveProjectId && liveProjectId !== expectedProjectId) {
    return { reloaded: false, newNodeIds: [] }
  }
  if (expectedFlowId && liveFlowId && liveFlowId !== expectedFlowId) {
    return { reloaded: false, newNodeIds: [] }
  }

  const localNodeIds = new Set(
    useRFStore.getState().nodes
      .map((node) => String(node.id || '').trim())
      .filter(Boolean),
  )
  const flow = await getServerFlow(flowId)
  const flowData = flow?.data || { nodes: [], edges: [] }
  const nextNodes = Array.isArray(flowData.nodes) ? flowData.nodes : []
  const newNodeIds = nextNodes
    .map((node) => String(node?.id || '').trim())
    .filter((nodeId) => Boolean(nodeId) && !localNodeIds.has(nodeId))
  useRFStore.getState().load({
    nodes: nextNodes,
    edges: Array.isArray(flowData.edges) ? flowData.edges : [],
  })
  useUIStore.getState().setRestoreViewport(
    flowData.viewport && typeof flowData.viewport.zoom === 'number' ? flowData.viewport : null,
  )
  useUIStore.getState().setCurrentFlow({ id: flow.id, name: flow.name, source: 'server' })
  useUIStore.getState().setDirty(false)
  return { reloaded: true, newNodeIds }
}

function readVideoPreviewFromNodeData(node: Node | undefined): { videoUrl?: string; thumbnailUrl?: string } {
  const data = node?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const record = data as Record<string, unknown>
  const directVideoUrl = typeof record.videoUrl === 'string' ? record.videoUrl.trim() : ''
  const directThumbnailUrl = typeof record.videoThumbnailUrl === 'string' ? record.videoThumbnailUrl.trim() : ''
  const videoResults = Array.isArray(record.videoResults) ? record.videoResults : []
  const firstResult = videoResults.find((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown> | undefined
  const resultVideoUrl = typeof firstResult?.url === 'string' ? firstResult.url.trim() : ''
  const resultThumbnailUrl = typeof firstResult?.thumbnailUrl === 'string' ? firstResult.thumbnailUrl.trim() : ''
  const videoUrl = directVideoUrl || resultVideoUrl
  const thumbnailUrl = directThumbnailUrl || resultThumbnailUrl || videoUrl
  return {
    ...(videoUrl ? { videoUrl } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  }
}

function readImagePreviewFromNodeData(node: Node | undefined): { imageUrl?: string } {
  const data = node?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const record = data as Record<string, unknown>
  const directImageUrl = typeof record.imageUrl === 'string' ? record.imageUrl.trim() : ''
  const imageResults = Array.isArray(record.imageResults) ? record.imageResults : []
  const imagePrimaryIndexRaw = Number(record.imagePrimaryIndex)
  const primaryResult =
    Number.isFinite(imagePrimaryIndexRaw) && imagePrimaryIndexRaw >= 0 && imagePrimaryIndexRaw < imageResults.length
      ? imageResults[Math.trunc(imagePrimaryIndexRaw)]
      : null
  const primaryResultUrl =
    primaryResult && typeof primaryResult === 'object' && !Array.isArray(primaryResult) && typeof (primaryResult as { url?: unknown }).url === 'string'
      ? String((primaryResult as { url?: string }).url || '').trim()
      : ''
  let fallbackImageUrl = ''
  if (!primaryResultUrl) {
    for (const item of imageResults) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const nextUrl = typeof (item as { url?: unknown }).url === 'string' ? String((item as { url?: string }).url || '').trim() : ''
      if (!nextUrl) continue
      fallbackImageUrl = nextUrl
      break
    }
  }
  let storyboardCellImageUrl = ''
  const storyboardCells = Array.isArray(record.storyboardEditorCells) ? record.storyboardEditorCells : []
  for (const cell of storyboardCells) {
    if (!cell || typeof cell !== 'object' || Array.isArray(cell)) continue
    const nextUrl = typeof (cell as { imageUrl?: unknown }).imageUrl === 'string'
      ? String((cell as { imageUrl?: string }).imageUrl || '').trim()
      : ''
    if (!nextUrl) continue
    storyboardCellImageUrl = nextUrl
    break
  }
  const imageUrl = directImageUrl || primaryResultUrl || fallbackImageUrl || storyboardCellImageUrl
  return imageUrl ? { imageUrl } : {}
}

function buildRuntimeStamp(label: string): { updatedAtLabel: string; updatedAtMs: number } {
  const updatedAtMs = Date.now()
  return {
    updatedAtLabel: `${label}：${new Date(updatedAtMs).toLocaleString()}`,
    updatedAtMs,
  }
}

function resolveShotVideoProductionStatus(input: {
  runtimeStatus?: 'idle' | 'running' | 'success' | 'error'
  hasPersistedVideo: boolean
}): string {
  if (input.runtimeStatus === 'running') return '视频生成中'
  if (input.runtimeStatus === 'success') return '视频已生成'
  if (input.runtimeStatus === 'error') return '视频失败'
  if (input.hasPersistedVideo) return '视频已生成'
  return '待生成片段'
}

function resolveShotStoryboardProductionStatus(input: {
  chapterRunStatus?: 'running' | 'success' | 'error'
  hasStoryboardImage: boolean
}): string {
  if (input.chapterRunStatus === 'running') return '分镜生成中'
  if (input.chapterRunStatus === 'error') return '分镜失败'
  if (input.hasStoryboardImage) return '已出分镜'
  return '待生成分镜'
}

function readRuntimeUpdatedAtMs(record: Record<string, unknown>): number {
  const lastResult = record.lastResult
  if (lastResult && typeof lastResult === 'object' && !Array.isArray(lastResult)) {
    const at = Number((lastResult as Record<string, unknown>).at)
    if (Number.isFinite(at) && at > 0) return Math.trunc(at)
  }
  const updatedAtMs = Date.parse(String(record.updatedAt || '').trim())
  if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) return updatedAtMs
  return 0
}

function buildPersistedShotVideoPreviewByShotId(input: {
  shots: readonly NanoComicShotItem[]
  nodes: readonly Node[]
  projectId: string
  selectedChapterNo: number | null
  semanticAssets: ReadonlyArray<{
    mediaKind: 'image' | 'video'
    videoUrl?: string
    thumbnailUrl?: string
    chapter?: number
    shotNo?: number
    updatedAt?: string
  }>
}): Record<string, { videoUrl?: string; thumbnailUrl?: string }> {
  const shotIdByShotNo = new Map<number, string>()
  for (const shot of input.shots) {
    shotIdByShotNo.set(shot.shotNo, shot.id)
  }

  const resolved = new Map<string, { videoUrl?: string; thumbnailUrl?: string; updatedAtMs: number }>()
  const assignPreview = (shotId: string, preview: { videoUrl?: string; thumbnailUrl?: string; updatedAtMs: number }) => {
    if (!shotId || !String(preview.videoUrl || '').trim()) return
    const current = resolved.get(shotId)
    if (!current || preview.updatedAtMs >= current.updatedAtMs) {
      resolved.set(shotId, preview)
    }
  }

  for (const asset of input.semanticAssets) {
    if (asset.mediaKind !== 'video') continue
    const shotNo = typeof asset.shotNo === 'number' ? Math.trunc(asset.shotNo) : 0
    if (shotNo <= 0) continue
    const shotId = shotIdByShotNo.get(shotNo) || ''
    if (!shotId) continue
    const chapterNo = typeof asset.chapter === 'number' ? Math.trunc(asset.chapter) : null
    if (input.selectedChapterNo && chapterNo && chapterNo !== input.selectedChapterNo) continue
    const videoUrl = String(asset.videoUrl || '').trim()
    if (!videoUrl) continue
    assignPreview(shotId, {
      videoUrl,
      thumbnailUrl: String(asset.thumbnailUrl || '').trim() || undefined,
      updatedAtMs: Date.parse(String(asset.updatedAt || '').trim()) || 0,
    })
  }

  for (const node of input.nodes) {
    if (node.type === 'groupNode') continue
    const record = readNodeDataRecord(node)
    const sourceProjectId = readTrimmedRecordString(record, 'sourceProjectId')
    if (sourceProjectId !== input.projectId) continue
    const sourceShotId = readTrimmedRecordString(record, 'sourceShotId')
    const sourceShotNo = readPositiveRecordNumber(record, ['sourceShotNo', 'shotNo'])
    const shotId = sourceShotId || (sourceShotNo ? (shotIdByShotNo.get(sourceShotNo) || '') : '')
    if (!shotId) continue
    const chapterNo = readPositiveRecordNumber(record, ['materialChapter', 'chapter'])
    if (input.selectedChapterNo && chapterNo && chapterNo !== input.selectedChapterNo) continue
    const preview = readVideoPreviewFromNodeData(node)
    if (!String(preview.videoUrl || '').trim()) continue
    assignPreview(shotId, {
      ...preview,
      updatedAtMs: readRuntimeUpdatedAtMs(record),
    })
  }

  return Object.fromEntries(
    Array.from(resolved.entries()).map(([shotId, preview]) => [
      shotId,
      {
        ...(preview.videoUrl ? { videoUrl: preview.videoUrl } : {}),
        ...(preview.thumbnailUrl ? { thumbnailUrl: preview.thumbnailUrl } : {}),
      },
    ]),
  )
}

type ShotVideoRuntimeState = {
  status: 'idle' | 'running' | 'success' | 'error'
  message: string
  updatedAtLabel: string
  updatedAtMs: number
  taskId?: string
  videoUrl?: string
  thumbnailUrl?: string
}

type ChapterScriptRuntimeState = {
  status: 'idle' | 'running' | 'success' | 'error'
  message: string
  updatedAtLabel: string
  updatedAtMs: number
}

type WorkspaceAssetInput = {
  assetId?: string
  assetRefId?: string
  url?: string
  role?: 'target' | 'reference' | 'character' | 'scene' | 'prop' | 'product' | 'style' | 'context' | 'mask'
  weight?: number
  note?: string
  name?: string
}

function normalizeWorkspaceAssetInput(input: WorkspaceAssetInput): WorkspaceAssetInput | null {
  const url = String(input.url || '').trim()
  if (!url) return null
  const assetId = String(input.assetId || '').trim()
  const assetRefId = String(input.assetRefId || '').trim()
  const role = typeof input.role === 'string' ? input.role : undefined
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  return {
    ...(assetId ? { assetId } : {}),
    ...(assetRefId ? { assetRefId } : {}),
    url,
    ...(role ? { role } : {}),
    ...(typeof input.weight === 'number' ? { weight: input.weight } : {}),
    ...(note ? { note } : {}),
    ...(name ? { name } : {}),
  }
}

function dedupeWorkspaceAssetInputs(items: readonly WorkspaceAssetInput[]): WorkspaceAssetInput[] {
  const seen = new Set<string>()
  const out: WorkspaceAssetInput[] = []
  for (const item of items) {
    const normalized = normalizeWorkspaceAssetInput(item)
    if (!normalized?.url) continue
    const dedupeKey = [
      normalized.assetId || '',
      normalized.assetRefId || '',
      normalized.url,
      normalized.role || '',
      normalized.name || '',
    ].join('::')
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push(normalized)
  }
  return out
}

function mergeWorkspaceAssetInputs(sections: readonly (readonly WorkspaceAssetInput[])[]): WorkspaceAssetInput[] {
  const out: WorkspaceAssetInput[] = []
  const seenUrls = new Set<string>()
  for (const section of sections) {
    for (const item of section) {
      const normalized = normalizeWorkspaceAssetInput(item)
      if (!normalized?.url) continue
      if (seenUrls.has(normalized.url)) continue
      seenUrls.add(normalized.url)
      out.push(normalized)
    }
  }
  return out
}

function clipWorkspaceText(input: string, maxLength: number): string {
  const compact = input.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

async function runWorkspaceTasksWithConcurrency(
  taskIds: readonly string[],
  concurrency: number,
  worker: (taskId: string) => Promise<void>,
): Promise<void> {
  const normalizedConcurrency = Math.max(1, Math.min(taskIds.length || 1, Math.trunc(concurrency || 1)))
  let nextIndex = 0
  const runWorker = async (): Promise<void> => {
    while (nextIndex < taskIds.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      await worker(taskIds[currentIndex])
    }
  }
  await Promise.all(Array.from({ length: normalizedConcurrency }, () => runWorker()))
}

type WorkspaceAssetListItem = {
  id: string
  title: string
  subtitle: string
  kindLabel: string
  statusLabel: string
  canGenerate?: boolean
  generationTarget?:
    | {
        kind: 'roleCard'
        cardId?: string
        roleName: string
        description?: string
      }
    | {
        kind: 'visualRef'
        refId?: string
        category: 'scene_prop' | 'spell_fx'
        name: string
        description?: string
        tags?: string[]
      }
  imageUrl?: string
  videoUrl?: string
  entityKey?: string
  mentionAliases?: readonly string[]
  note?: string
  chapterNo?: number | null
  isCurrentChapter?: boolean
}

function readNodeDataRecord(node: Node): Record<string, unknown> {
  return node.data && typeof node.data === 'object' && !Array.isArray(node.data)
    ? node.data as Record<string, unknown>
    : {}
}

function readTrimmedRecordString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readPositiveRecordNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = Number(record[key])
    if (Number.isFinite(value) && value > 0) {
      return Math.trunc(value)
    }
  }
  return null
}

function normalizeAssetLookupKey(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .replace(/[·•,，。:：;；!！?？'"“”‘’\-_/\\|()（）[\]【】<>《》]/g, '')
}

function dedupeTrimmedTexts(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

function dedupeTrimmedUrls(urls: readonly string[]): string[] {
  return Array.from(new Set(urls.map((url) => String(url || '').trim()).filter(Boolean)))
}

function collectWorkspacePromptMentionKeys(promptText: string): {
  directKeys: Set<string>
  roleNameKeys: Set<string>
} {
  const directKeys = new Set<string>()
  const roleNameKeys = new Set<string>()
  const matches = String(promptText || '').match(/@[^\s@]+/g) || []
  for (const match of matches) {
    const trimmed = String(match || '').trim()
    if (!trimmed) continue
    const directKey = normalizeAssetLookupKey(
      trimmed
        .replace(/^@+/, '')
        .replace(/[，。！？、；：,.!?;:)\]】》〉'"`]+$/g, ''),
    )
    if (directKey) directKeys.add(directKey)
    const roleMention = parseRoleCardMentionToken(trimmed)
    const roleNameKey = normalizeAssetLookupKey(roleMention?.roleNameKey || '')
    if (roleNameKey) roleNameKeys.add(roleNameKey)
  }
  return { directKeys, roleNameKeys }
}

function isLikelyVideoUrl(url: string): boolean {
  const normalized = String(url || '').trim().split(/[?#]/, 1)[0]?.toLowerCase() || ''
  if (!normalized) return false
  return (
    normalized.endsWith('.mp4') ||
    normalized.endsWith('.mov') ||
    normalized.endsWith('.webm') ||
    normalized.endsWith('.m4v') ||
    normalized.endsWith('.mkv') ||
    normalized.endsWith('.avi') ||
    normalized.endsWith('.wmv') ||
    normalized.endsWith('.flv') ||
    normalized.endsWith('.m3u8')
  )
}

function pickWorkspaceFirstFrameImageUrl(input: {
  previewImageUrl?: string
  referenceImageUrls: readonly string[]
  anchorImageUrls: readonly string[]
}): string {
  const candidates = dedupeTrimmedUrls([
    String(input.previewImageUrl || '').trim(),
    ...input.referenceImageUrls,
    ...input.anchorImageUrls,
  ])
  return candidates.find((url) => !isLikelyVideoUrl(url)) || ''
}

function buildWorkspaceShotVideoBlockReason(input: {
  shot: NanoComicShotItem
  promptText: string
  selectedVideoModel: string
  hasVideoModelOptions: boolean
  chapterAssetItems: readonly WorkspaceAssetListItem[]
}): string | null {
  const promptText = String(input.promptText || '').trim()
  if (!promptText) return '当前片段提示词为空'
  if (!input.hasVideoModelOptions) return '当前没有可用视频模型'
  if (!String(input.selectedVideoModel || '').trim()) return '还没有选择视频模型'
  const resolvedReferences = resolveShotWorkspaceReferences({
    shot: input.shot,
    assetItems: input.chapterAssetItems,
    promptText,
  })
  const hasExistingReferences = (
    resolvedReferences.referenceImageUrls.length > 0 ||
    resolvedReferences.anchorImageUrls.length > 0 ||
    Boolean(
      pickWorkspaceFirstFrameImageUrl({
        previewImageUrl: input.shot.previewImageUrl,
        referenceImageUrls: resolvedReferences.referenceImageUrls,
        anchorImageUrls: resolvedReferences.anchorImageUrls,
      }),
    )
  )
  if (hasExistingReferences || resolvedReferences.missingAssetIds.length > 0) return null
  return '既没有真实参考图，也没有可自动补齐的角色卡/场景资产'
}

function resolveShotWorkspaceReferences(input: {
  shot: NanoComicShotItem
  assetItems: readonly WorkspaceAssetListItem[]
  promptText?: string
}): {
  referenceImageUrls: string[]
  anchorImageUrls: string[]
  missingAssetIds: string[]
} {
  const roleKeys = new Set(input.shot.castNames.map((name) => normalizeAssetLookupKey(name)).filter(Boolean))
  const locationKey = normalizeAssetLookupKey(input.shot.locationName)
  const propKeys = new Set(input.shot.propNames.map((name) => normalizeAssetLookupKey(name)).filter(Boolean))
  const referenceUrls = [...input.shot.referenceImageUrls]
  const anchorUrls = [...input.shot.anchorImageUrls]
  const missingAssetIds: string[] = []
  const promptMentionKeys = collectWorkspacePromptMentionKeys(input.promptText || '')

  for (const asset of input.assetItems) {
    if (asset.isCurrentChapter === false) continue
    const titleKey = normalizeAssetLookupKey(asset.title)
    if (!titleKey) continue
    const isRoleCard = asset.generationTarget?.kind === 'roleCard'
    const isStyle = asset.id.startsWith('style-')
    const assetLookupKeys = new Set(
      [titleKey, ...dedupeTrimmedTexts(asset.mentionAliases || [])]
        .map((item) => normalizeAssetLookupKey(item))
        .filter(Boolean),
    )
    const matchesRole = roleKeys.has(titleKey)
    const matchesLocation = Boolean(locationKey) && titleKey === locationKey
    const matchesProp = propKeys.has(titleKey)
    const matchesPromptMention = Array.from(assetLookupKeys).some((key) => (
      promptMentionKeys.directKeys.has(key) ||
      (isRoleCard && promptMentionKeys.roleNameKeys.has(key))
    ))
    const matched = isStyle || matchesRole || matchesLocation || matchesProp || matchesPromptMention
    if (!matched) continue
    const imageUrl = String(asset.imageUrl || '').trim()
    if (imageUrl) {
      if (isRoleCard || matchesRole) {
        anchorUrls.push(imageUrl)
      } else {
        referenceUrls.push(imageUrl)
      }
      continue
    }
    if (asset.canGenerate) {
      missingAssetIds.push(asset.id)
    }
  }

  return {
    referenceImageUrls: dedupeTrimmedUrls(referenceUrls),
    anchorImageUrls: dedupeTrimmedUrls(anchorUrls),
    missingAssetIds: Array.from(new Set(missingAssetIds)),
  }
}

function readImageUrlFromCanvasRunResult(result: unknown): string {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ''
  const record = result as Record<string, unknown>
  const directImageUrl = typeof record.imageUrl === 'string' ? record.imageUrl.trim() : ''
  if (directImageUrl) return directImageUrl
  const imageResults = Array.isArray(record.imageResults) ? record.imageResults : []
  for (const item of imageResults) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const url = typeof (item as { url?: string }).url === 'string' ? String((item as { url?: string }).url).trim() : ''
    if (url) return url
  }
  return ''
}

function isAssetVisibleInChapter(input: {
  chapter?: number | null
  chapterStart?: number | null
  chapterEnd?: number | null
  chapterSpan?: readonly number[] | null
  selectedChapterNo: number | null
}): boolean {
  const targetChapter = input.selectedChapterNo
  if (!targetChapter || !Number.isFinite(targetChapter) || targetChapter <= 0) return true
  const chapterSpan = Array.isArray(input.chapterSpan)
    ? input.chapterSpan
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.trunc(value))
    : []
  if (chapterSpan.length > 0) return chapterSpan.includes(targetChapter)
  const chapter = typeof input.chapter === 'number' && Number.isFinite(input.chapter) && input.chapter > 0
    ? Math.trunc(input.chapter)
    : null
  if (chapter) return chapter === targetChapter
  const chapterStart = typeof input.chapterStart === 'number' && Number.isFinite(input.chapterStart) && input.chapterStart > 0
    ? Math.trunc(input.chapterStart)
    : null
  const chapterEnd = typeof input.chapterEnd === 'number' && Number.isFinite(input.chapterEnd) && input.chapterEnd > 0
    ? Math.trunc(input.chapterEnd)
    : null
  if (chapterStart && chapterEnd) return targetChapter >= chapterStart && targetChapter <= chapterEnd
  if (chapterStart) return targetChapter >= chapterStart
  if (chapterEnd) return targetChapter <= chapterEnd
  return true
}

function classifyCanvasAssetKind(record: Record<string, unknown>, entityKey: string): string {
  const nodeKind = readTrimmedRecordString(record, 'kind')
  const productionLayer = readTrimmedRecordString(record, 'productionLayer')
  if (entityKey.startsWith('video_segment:') || nodeKind === 'video' || nodeKind === 'composeVideo') return '视频片段'
  if (entityKey.startsWith('shot:')) return '分镜节点'
  if (entityKey.startsWith('asset:role-')) return '角色卡'
  if (productionLayer === 'anchors') return '前置资产'
  return '画布资产'
}

function isWorkspaceImageNode(record: Record<string, unknown>): boolean {
  const nodeKind = readTrimmedRecordString(record, 'kind')
  return nodeKind === 'image' || nodeKind === 'imageEdit' || nodeKind === 'storyboard' || nodeKind === 'storyboardImage'
}

function isWorkspaceVideoNode(record: Record<string, unknown>): boolean {
  const nodeKind = readTrimmedRecordString(record, 'kind')
  return nodeKind === 'video' || nodeKind === 'composeVideo'
}

function findMatchingWorkspaceAssetNodeId(input: {
  nodes: readonly Node[]
  projectId: string
  chapterNo: number | null
  targetAsset: WorkspaceAssetListItem
  ensuredVisualRefId?: string
}): string | null {
  const targetNameKey = normalizeAssetLookupKey(input.targetAsset.title)
  for (const node of input.nodes) {
    if (node.type === 'groupNode') continue
    const nodeId = String(node.id || '').trim()
    if (!nodeId) continue
    const record = readNodeDataRecord(node)
    if (!isWorkspaceImageNode(record)) continue
    const sourceProjectId = readTrimmedRecordString(record, 'sourceProjectId')
    if (sourceProjectId !== input.projectId) continue
    const nodeChapterNo = readPositiveRecordNumber(record, ['materialChapter', 'chapter'])
    if (input.chapterNo && nodeChapterNo && nodeChapterNo !== input.chapterNo) continue

    if (input.targetAsset.generationTarget?.kind === 'roleCard') {
      const targetCardId = String(input.targetAsset.generationTarget.cardId || '').trim()
      const nodeCardId = readTrimmedRecordString(record, 'roleCardId')
      if (targetCardId && nodeCardId === targetCardId) return nodeId
      const nodeRoleNameKey = normalizeAssetLookupKey(readTrimmedRecordString(record, 'roleName'))
      if (targetNameKey && nodeRoleNameKey === targetNameKey) return nodeId
      continue
    }

    if (input.targetAsset.generationTarget?.kind === 'visualRef') {
      const resolvedRefId = String(input.ensuredVisualRefId || input.targetAsset.generationTarget.refId || '').trim()
      const nodeRefId = readTrimmedRecordString(record, 'visualRefId') || readTrimmedRecordString(record, 'scenePropRefId')
      if (resolvedRefId && nodeRefId === resolvedRefId) return nodeId
      const nodeNameKey = normalizeAssetLookupKey(
        readTrimmedRecordString(record, 'visualRefName') ||
          readTrimmedRecordString(record, 'scenePropRefName') ||
          readTrimmedRecordString(record, 'label') ||
          readTrimmedRecordString(record, 'title'),
      )
      if (targetNameKey && nodeNameKey === targetNameKey) return nodeId
    }
  }
  return null
}

function findMatchingWorkspaceVideoNodeId(input: {
  nodes: readonly Node[]
  projectId: string
  chapterNo: number | null
  sourceEntityKey: string
}): string | null {
  const targetEntityKey = String(input.sourceEntityKey || '').trim()
  if (!targetEntityKey) return null
  for (const node of input.nodes) {
    if (node.type === 'groupNode') continue
    const nodeId = String(node.id || '').trim()
    if (!nodeId) continue
    const record = readNodeDataRecord(node)
    if (!isWorkspaceVideoNode(record)) continue
    const sourceProjectId = readTrimmedRecordString(record, 'sourceProjectId')
    if (sourceProjectId !== input.projectId) continue
    const nodeChapterNo = readPositiveRecordNumber(record, ['materialChapter', 'chapter'])
    if (input.chapterNo && nodeChapterNo && nodeChapterNo !== input.chapterNo) continue
    const entityKey = readTrimmedRecordString(record, 'sourceEntityKey')
    if (entityKey === targetEntityKey) return nodeId
  }
  return null
}

function collectWorkspaceReferenceSourceNodeIds(input: {
  nodes: readonly Node[]
  projectId: string
  referenceUrls: readonly string[]
}): string[] {
  const orderedUrls = dedupeTrimmedUrls(input.referenceUrls).filter((url) => !isLikelyVideoUrl(url))
  if (orderedUrls.length === 0) return []

  const nodeIdByImageUrl = new Map<string, string>()
  for (const node of input.nodes) {
    if (node.type === 'groupNode') continue
    const nodeId = String(node.id || '').trim()
    if (!nodeId) continue
    const record = readNodeDataRecord(node)
    if (!isWorkspaceImageNode(record)) continue
    const sourceProjectId = readTrimmedRecordString(record, 'sourceProjectId')
    if (sourceProjectId !== input.projectId) continue
    const imageUrl = String(readImagePreviewFromNodeData(node).imageUrl || '').trim()
    if (!imageUrl || nodeIdByImageUrl.has(imageUrl)) continue
    nodeIdByImageUrl.set(imageUrl, nodeId)
  }

  const seenNodeIds = new Set<string>()
  const orderedNodeIds: string[] = []
  for (const url of orderedUrls) {
    const nodeId = nodeIdByImageUrl.get(url)
    if (!nodeId || seenNodeIds.has(nodeId)) continue
    seenNodeIds.add(nodeId)
    orderedNodeIds.push(nodeId)
  }
  return orderedNodeIds
}

async function syncWorkspaceVideoReferenceEdges(input: {
  projectId: string
  targetNodeId: string
  sourceNodeIds: readonly string[]
}): Promise<void> {
  const targetNodeId = String(input.targetNodeId || '').trim()
  if (!targetNodeId) return

  const desiredSourceNodeIds = Array.from(
    new Set(input.sourceNodeIds.map((nodeId) => String(nodeId || '').trim()).filter(Boolean)),
  )

  const initialState = useRFStore.getState()
  const nodeById = new Map(
    initialState.nodes
      .map((node) => [String(node.id || '').trim(), node] as const)
      .filter(([nodeId]) => Boolean(nodeId)),
  )
  const staleEdgeIds = initialState.edges
    .filter((edge) => String(edge.target || '').trim() === targetNodeId)
    .filter((edge) => {
      const sourceNode = nodeById.get(String(edge.source || '').trim())
      if (!sourceNode) return false
      const record = readNodeDataRecord(sourceNode)
      if (!isWorkspaceImageNode(record)) return false
      const sourceProjectId = readTrimmedRecordString(record, 'sourceProjectId')
      if (sourceProjectId !== input.projectId) return false
      return !desiredSourceNodeIds.includes(sourceNode.id)
    })
    .map((edge) => String(edge.id || '').trim())
    .filter(Boolean)

  for (const edgeId of staleEdgeIds) {
    const result = await CanvasService.disconnectNodes({ edgeId })
    if (!result.success) {
      throw new Error(result.error || `断开参考边失败：${edgeId}`)
    }
  }

  const edgeKeySet = new Set(
    useRFStore.getState().edges
      .filter((edge) => String(edge.target || '').trim() === targetNodeId)
      .map((edge) => `${String(edge.source || '').trim()}=>${String(edge.target || '').trim()}`),
  )

  for (const sourceNodeId of desiredSourceNodeIds) {
    const edgeKey = `${sourceNodeId}=>${targetNodeId}`
    if (edgeKeySet.has(edgeKey)) continue
    const result = await CanvasService.connectNodes({
      sourceNodeId,
      targetNodeId,
      sourceHandle: 'out-image',
      targetHandle: 'in-any',
    })
    if (!result.success) {
      throw new Error(result.error || `连接参考边失败：${sourceNodeId} -> ${targetNodeId}`)
    }
    edgeKeySet.add(edgeKey)
  }
}

function buildCanvasWorkspaceAssetItems(input: {
  nodes: readonly Node[]
  projectId: string
  selectedChapterNo: number | null
}): WorkspaceAssetListItem[] {
  const items: WorkspaceAssetListItem[] = []
  const seen = new Set<string>()
  for (const node of input.nodes) {
    if (node.type === 'groupNode') continue
    const nodeId = String(node.id || '').trim()
    if (!nodeId) continue
    const record = readNodeDataRecord(node)
    const sourceProjectId = readTrimmedRecordString(record, 'sourceProjectId')
    if (sourceProjectId !== input.projectId) continue
    const entityKey = readTrimmedRecordString(record, 'sourceEntityKey')
    const { imageUrl } = readImagePreviewFromNodeData(node)
    const { videoUrl, thumbnailUrl } = readVideoPreviewFromNodeData(node)
    const prompt = readTrimmedRecordString(record, 'prompt')
    const label = [
      readTrimmedRecordString(record, 'label'),
      readTrimmedRecordString(record, 'title'),
      readTrimmedRecordString(record, 'visualRefName'),
      readTrimmedRecordString(record, 'scenePropRefName'),
      readTrimmedRecordString(record, 'roleName'),
      nodeId,
    ].find(Boolean) || nodeId
    const chapterNo = readPositiveRecordNumber(record, ['materialChapter', 'chapter'])
    const isCurrentChapter = isAssetVisibleInChapter({
      chapter: chapterNo,
      selectedChapterNo: input.selectedChapterNo,
    })
    const dedupeKey = entityKey || `node:${nodeId}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    items.push({
      id: `canvas-${nodeId}`,
      title: label,
      subtitle: clipWorkspaceText(
        [
          readTrimmedRecordString(record, 'stateDescription'),
          readTrimmedRecordString(record, 'summary'),
          prompt,
        ].find(Boolean) || '当前 flow 已写入节点',
        72,
      ),
      kindLabel: classifyCanvasAssetKind(record, entityKey),
      statusLabel: videoUrl ? '已落视频' : imageUrl ? '已落图' : '已写入画布',
      imageUrl: String(thumbnailUrl || imageUrl || '').trim() || undefined,
      videoUrl: videoUrl || undefined,
      entityKey: entityKey || undefined,
      mentionAliases: dedupeTrimmedTexts([
        label,
        readTrimmedRecordString(record, 'visualRefName'),
        readTrimmedRecordString(record, 'scenePropRefName'),
        readTrimmedRecordString(record, 'roleName'),
        readTrimmedRecordString(record, 'assetRefId'),
        entityKey,
      ]),
      note: [
        readTrimmedRecordString(record, 'creationStage'),
        readTrimmedRecordString(record, 'approvalStatus'),
      ].filter(Boolean).join(' · ') || undefined,
      chapterNo,
      isCurrentChapter,
    })
  }
  return items.sort((left, right) => {
    const leftCurrent = left.isCurrentChapter ? 1 : 0
    const rightCurrent = right.isCurrentChapter ? 1 : 0
    if (leftCurrent !== rightCurrent) return rightCurrent - leftCurrent
    const leftChapter = typeof left.chapterNo === 'number' ? left.chapterNo : 0
    const rightChapter = typeof right.chapterNo === 'number' ? right.chapterNo : 0
    if (leftChapter !== rightChapter) return rightChapter - leftChapter
    return left.title.localeCompare(right.title, 'zh-Hans-CN')
  })
}

function mergeWorkspaceAssetListItems(
  baseItems: readonly WorkspaceAssetListItem[],
  canvasItems: readonly WorkspaceAssetListItem[],
): WorkspaceAssetListItem[] {
  const merged = new Map<string, WorkspaceAssetListItem>()
  const getKey = (item: WorkspaceAssetListItem): string => {
    if (item.entityKey) return `entity:${item.entityKey}`
    return `item:${item.id}`
  }
  for (const item of baseItems) {
    merged.set(getKey(item), item)
  }
  for (const item of canvasItems) {
    const key = getKey(item)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, item)
      continue
    }
    const mergedImageUrl = item.imageUrl || existing.imageUrl
    const mergedVideoUrl = item.videoUrl || existing.videoUrl
    merged.set(key, {
      ...existing,
      imageUrl: mergedImageUrl,
      videoUrl: mergedVideoUrl,
      entityKey: item.entityKey || existing.entityKey,
      mentionAliases: dedupeTrimmedTexts([
        ...(existing.mentionAliases || []),
        ...(item.mentionAliases || []),
      ]),
      statusLabel: item.statusLabel || existing.statusLabel,
      note: item.note || existing.note,
      chapterNo: item.chapterNo ?? existing.chapterNo,
      isCurrentChapter: item.isCurrentChapter ?? existing.isCurrentChapter,
      canGenerate:
        existing.canGenerate === undefined
          ? undefined
          : existing.canGenerate && !mergedImageUrl && !mergedVideoUrl,
    })
  }
  return Array.from(merged.values())
}

function buildWorkspaceRoleCardPrompt(input: {
  roleName: string
  description?: string
  chapterNo: number
  chapterTitle?: string
}): string {
  return [
    `角色卡设定图，角色名：${input.roleName}。`,
    input.chapterTitle ? `章节：第${input.chapterNo}章《${input.chapterTitle}》` : `章节：第${input.chapterNo}章。`,
    input.description ? `角色说明：${input.description}` : '',
    '要求：三视图角色卡，空背景或纯背景，不要场景元素，不要文字，不要 logo。',
    '必须稳定呈现角色年龄段、脸型、发型、服饰层次和主体色，适合作为后续分镜与视频连续性锚点。',
  ].filter(Boolean).join('\n')
}

function buildWorkspaceVisualRefPrompt(input: {
  name: string
  description?: string
  chapterNo: number
  chapterTitle?: string
  category: 'scene_prop' | 'spell_fx'
}): string {
  const visualKind = input.category === 'spell_fx' ? '特效参考图' : '场景/道具参考图'
  return [
    `${visualKind}，名称：${input.name}。`,
    input.chapterTitle ? `章节：第${input.chapterNo}章《${input.chapterTitle}》` : `章节：第${input.chapterNo}章。`,
    input.description ? `剧情说明：${input.description}` : '',
    '要求：主体明确、构图稳定、视觉识别点清晰，适合作为后续分镜和视频片段的复用锚点。',
    input.category === 'spell_fx'
      ? '强调特效形态、运动趋势、材质与发光层次，不要塞入无关环境。'
      : '优先明确空间结构、主体道具轮廓和材质关系，不要漂成泛化插图。',
  ].filter(Boolean).join('\n')
}

export default function NanoComicWorkspacePanel(): JSX.Element | null {
  const activePanel = useUIStore((state) => state.activePanel)
  const setActivePanel = useUIStore((state) => state.setActivePanel)
  const requestAssetPanelFocus = useUIStore((state) => state.requestAssetPanelFocus)
  const nanoComicStoryboardRunState = useUIStore((state) => state.nanoComicStoryboardRunState)
  const currentProject = useUIStore((state) => state.currentProject)
  const currentFlowId = useUIStore((state) => (state.currentFlow?.id ? String(state.currentFlow.id).trim() : ''))
  const canvasNodes = useRFStore((state) => state.nodes)
  const canvasNodeCount = useRFStore((state) => state.nodes.length)
  const mounted = activePanel === 'nanoComic'
  const routeSearch = typeof window !== 'undefined' ? window.location.search : ''
  const requestedChapterNo = React.useMemo(
    () => readRequestedWorkspaceChapterFromSearch(routeSearch),
    [routeSearch],
  )
  const requestedShotId = React.useMemo(
    () => readRequestedWorkspaceShotIdFromSearch(routeSearch),
    [routeSearch],
  )
  const [books, setBooks] = React.useState<ProjectBookListItemDto[]>([])
  const [selectedBookId, setSelectedBookId] = React.useState<string>('')
  const [selectedBookIndex, setSelectedBookIndex] = React.useState<ProjectBookIndexDto | null>(null)
  const [selectedChapter, setSelectedChapter] = React.useState<string>('')
  const [selectedChapterDetail, setSelectedChapterDetail] = React.useState<ChapterWorkspaceDetail | null>(null)
  const [storyboardHistory, setStoryboardHistory] = React.useState<ProjectBookStoryboardHistoryDto | null>(null)
  const [projectRoleCards, setProjectRoleCards] = React.useState<ProjectRoleCardAssetDto[]>([])
  const [chatArtifactSessions, setChatArtifactSessions] = React.useState<ProjectChatArtifactSessionDto[]>([])
  const [projectWorkspaceLoading, setProjectWorkspaceLoading] = React.useState(false)
  const [bookWorkspaceLoading, setBookWorkspaceLoading] = React.useState(false)
  const [chapterDetailLoading, setChapterDetailLoading] = React.useState(false)
  const [chatArtifactsLoading, setChatArtifactsLoading] = React.useState(false)
  const [projectWorkspaceError, setProjectWorkspaceError] = React.useState<string | null>(null)
  const [bookWorkspaceError, setBookWorkspaceError] = React.useState<string | null>(null)
  const [chapterDetailError, setChapterDetailError] = React.useState<string | null>(null)
  const [chatArtifactsError, setChatArtifactsError] = React.useState<string | null>(null)
  const [workspaceTextUploading, setWorkspaceTextUploading] = React.useState(false)
  const [workspaceStyleReferenceUploading, setWorkspaceStyleReferenceUploading] = React.useState(false)
  const [workspaceMetadataEnsuring, setWorkspaceMetadataEnsuring] = React.useState(false)
  const [refreshTick, setRefreshTick] = React.useState(0)
  const [selectedShotId, setSelectedShotId] = React.useState<string>('')
  const [linkedNodeIdsByEntityKey, setLinkedNodeIdsByEntityKey] = React.useState<Record<string, string>>({})
  const [generatingAssetIds, setGeneratingAssetIds] = React.useState<Set<string>>(() => new Set())
  const [productionRequestState, setProductionRequestState] = React.useState<ChapterProductionRequestState>({
    status: 'idle',
    message: '',
    updatedAtLabel: '',
    updatedAtMs: 0,
  })
  const [activeShotPrompt, setActiveShotPrompt] = React.useState('')
  const [selectedImageModel, setSelectedImageModel] = React.useState('')
  const [selectedVideoModel, setSelectedVideoModel] = React.useState('')
  const [videoDurationSeconds, setVideoDurationSeconds] = React.useState<number>(10)
  const workspaceTextUploadInputRef = React.useRef<HTMLInputElement | null>(null)
  const workspaceStyleReferenceUploadInputRef = React.useRef<HTMLInputElement | null>(null)
  const storyboardImageSectionRef = React.useRef<HTMLDivElement | null>(null)
  const generateWorkspaceAssetByIdRef = React.useRef<(assetId: string) => Promise<string>>(async () => '')
  const autoEnsureChapterMetadataAttemptAtRef = React.useRef<Map<string, number>>(new Map())
  const [videoRuntimeByShotId, setVideoRuntimeByShotId] = React.useState<Record<string, ShotVideoRuntimeState>>({})
  const [chapterScriptState, setChapterScriptState] = React.useState<ChapterScriptRuntimeState>({
    status: 'idle',
    message: '',
    updatedAtLabel: '',
    updatedAtMs: 0,
  })
  const [latestBookReconfirmJob, setLatestBookReconfirmJob] = React.useState<ProjectBookReconfirmJobDto | null>(null)
  const [promptOverrideByShotId, setPromptOverrideByShotId] = React.useState<Record<string, string>>({})
  const [workspaceView, setWorkspaceView] = React.useState<'storyboardImage' | 'videoGeneration'>('storyboardImage')
  const availableVideoModels = useModelOptions('video')
  const availableImageModels = useModelOptions('image')
  const imageModelLoading = mounted && availableImageModels.length === 0
  const videoModelLoading = mounted && availableVideoModels.length === 0

  const linkedEntityKeys = React.useMemo(
    () => new Set(Object.keys(linkedNodeIdsByEntityKey)),
    [linkedNodeIdsByEntityKey],
  )
  const workspaceLoading = projectWorkspaceLoading || bookWorkspaceLoading
  const workspaceError = bookWorkspaceError || projectWorkspaceError
  const syncLinkedNodeIdsFromCanvas = React.useCallback(() => {
    const projectId = String(currentProject?.id || '').trim()
    if (!projectId) {
      setLinkedNodeIdsByEntityKey((current) => (Object.keys(current).length > 0 ? {} : current))
      return
    }
    const nextMap: Record<string, string> = {}
    for (const node of useRFStore.getState().nodes) {
      const nodeId = String(node.id || '').trim()
      if (!nodeId) continue
      const data = node.data
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue
      const record = data as Record<string, unknown>
      const entityKey = typeof record.sourceEntityKey === 'string' ? record.sourceEntityKey.trim() : ''
      const sourceProjectId = String(record.sourceProjectId || '').trim()
      if (!entityKey || sourceProjectId !== projectId) continue
      if (!nextMap[entityKey]) {
        nextMap[entityKey] = nodeId
      }
    }
    setLinkedNodeIdsByEntityKey((current) => (
      areLinkedNodeMapsEqual(current, nextMap)
        ? current
        : nextMap
    ))
  }, [currentProject?.id])

  const handleClose = React.useCallback(() => {
    setActivePanel(null)
  }, [setActivePanel])

  const refreshSelectedBookArtifacts = React.useCallback(async (
    options?: { bookId?: string; preserveSelectedChapter?: boolean },
  ): Promise<{ index: ProjectBookIndexDto; history: ProjectBookStoryboardHistoryDto } | null> => {
    const projectId = String(currentProject?.id || '').trim()
    const bookId = String(options?.bookId || selectedBookId || '').trim()
    if (!projectId || !bookId) return null
    const [nextIndex, nextHistory] = await Promise.all([
      getProjectBookIndex(projectId, bookId),
      listProjectBookStoryboardHistory(projectId, bookId, { limit: 160 }),
    ])
    setSelectedBookIndex(nextIndex)
    setStoryboardHistory(nextHistory)
    if (options?.preserveSelectedChapter !== true) {
      const chapterOptions = Array.isArray(nextIndex.chapters) ? nextIndex.chapters : []
      setSelectedChapter((currentSelectedChapter) => {
        const hasCurrent = chapterOptions.some((chapter) => String(chapter.chapter) === currentSelectedChapter)
        if (hasCurrent) return currentSelectedChapter
        return chapterOptions[0] ? String(chapterOptions[0].chapter) : ''
      })
    }
    return {
      index: nextIndex,
      history: nextHistory,
    }
  }, [currentProject?.id, selectedBookId])

  React.useEffect(() => {
    if (!mounted || !currentProject?.id) return
    let cancelled = false
    setProjectWorkspaceLoading(true)
    setProjectWorkspaceError(null)
    void Promise.all([
      listProjectBooks(currentProject.id),
      listProjectRoleCardAssets(currentProject.id),
    ])
      .then(([nextBooks, nextRoleCards]) => {
        if (cancelled) return
        const normalizedBooks = sortProjectBooksByUpdatedAt(Array.isArray(nextBooks) ? nextBooks : [])
        setBooks(normalizedBooks)
        setProjectRoleCards(Array.isArray(nextRoleCards) ? nextRoleCards : [])
        setSelectedBookId((currentSelectedBookId) => {
          if (currentSelectedBookId && normalizedBooks.some((book) => book.bookId === currentSelectedBookId)) {
            return currentSelectedBookId
          }
          return pickPrimaryProjectBook(normalizedBooks)?.bookId ?? ''
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : '加载项目工作台数据失败'
        setProjectWorkspaceError(message)
        setBooks([])
        setProjectRoleCards([])
      })
      .finally(() => {
        if (cancelled) return
        setProjectWorkspaceLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [currentProject?.id, mounted, refreshTick])

  React.useEffect(() => {
    if (!mounted) {
      setSelectedImageModel('')
      return
    }
    setSelectedImageModel((current) => {
      const currentOption = findWorkspaceModelOptionBySelectionKey(availableImageModels, current)
      if (currentOption) return buildWorkspaceModelSelectionKey(currentOption)
      return availableImageModels[0] ? buildWorkspaceModelSelectionKey(availableImageModels[0]) : ''
    })
  }, [availableImageModels, mounted])

  React.useEffect(() => {
    if (!mounted) {
      setSelectedVideoModel('')
      return
    }
    setSelectedVideoModel((current) => {
      const currentOption = findWorkspaceModelOptionBySelectionKey(availableVideoModels, current)
      if (currentOption) return buildWorkspaceModelSelectionKey(currentOption)
      return availableVideoModels[0] ? buildWorkspaceModelSelectionKey(availableVideoModels[0]) : ''
    })
  }, [availableVideoModels, mounted])

  React.useEffect(() => {
    if (!mounted || !currentProject?.id) {
      setChatArtifactSessions([])
      setChatArtifactsError(null)
      setChatArtifactsLoading(false)
      return
    }
    let cancelled = false
    setChatArtifactsLoading(true)
    setChatArtifactsError(null)
    void listProjectChatArtifactSessions({
      projectId: currentProject.id,
      ...(currentFlowId ? { flowId: currentFlowId } : {}),
      limitSessions: 8,
      limitTurns: 6,
    })
      .then((response) => {
        if (cancelled) return
        setChatArtifactSessions(Array.isArray(response.items) ? response.items : [])
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setChatArtifactSessions([])
        setChatArtifactsError(error instanceof Error ? error.message : '加载对话产物历史失败')
      })
      .finally(() => {
        if (cancelled) return
        setChatArtifactsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentFlowId, currentProject?.id, mounted, refreshTick])

  React.useEffect(() => {
    if (productionRequestState.status !== 'success' || productionRequestState.updatedAtMs <= 0) return
    const targetUpdatedAtMs = productionRequestState.updatedAtMs
    const timer = window.setTimeout(() => {
      setProductionRequestState((current) => (
        current.status === 'success' && current.updatedAtMs === targetUpdatedAtMs
          ? { status: 'idle', message: '', updatedAtLabel: '', updatedAtMs: 0 }
          : current
      ))
    }, WORKSPACE_RUNTIME_SUCCESS_TTL_MS)
    return () => window.clearTimeout(timer)
  }, [productionRequestState])

  React.useEffect(() => {
    if (chapterScriptState.status !== 'success' || chapterScriptState.updatedAtMs <= 0) return
    const targetUpdatedAtMs = chapterScriptState.updatedAtMs
    const timer = window.setTimeout(() => {
      setChapterScriptState((current) => (
        current.status === 'success' && current.updatedAtMs === targetUpdatedAtMs
          ? { status: 'idle', message: '', updatedAtLabel: '', updatedAtMs: 0 }
          : current
      ))
    }, WORKSPACE_RUNTIME_SUCCESS_TTL_MS)
    return () => window.clearTimeout(timer)
  }, [chapterScriptState])

  React.useEffect(() => {
    const successEntries = Object.entries(videoRuntimeByShotId).filter(([, runtime]) => (
      runtime.status === 'success' && runtime.updatedAtMs > 0
    ))
    if (successEntries.length <= 0) return
    const timers = successEntries.map(([shotId, runtime]) => window.setTimeout(() => {
      setVideoRuntimeByShotId((current) => {
        const nextRuntime = current[shotId]
        if (!nextRuntime || nextRuntime.status !== 'success' || nextRuntime.updatedAtMs !== runtime.updatedAtMs) {
          return current
        }
        const { [shotId]: _removed, ...rest } = current
        return rest
      })
    }, WORKSPACE_RUNTIME_SUCCESS_TTL_MS))
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [videoRuntimeByShotId])

  React.useEffect(() => {
    if (!mounted) return
    if (!books.length) {
      if (selectedBookId) setSelectedBookId('')
      return
    }
    const selectedExists = books.some((book) => book.bookId === selectedBookId)
    if (selectedExists) return
    const primaryBookId = pickPrimaryProjectBook(books)?.bookId ?? ''
    if (primaryBookId !== selectedBookId) {
      setSelectedBookId(primaryBookId)
    }
  }, [books, mounted, selectedBookId])

  React.useEffect(() => {
    if (!mounted || !currentProject?.id || !selectedBookId) {
      setBookWorkspaceLoading(false)
      setBookWorkspaceError(null)
      setSelectedBookIndex(null)
      setStoryboardHistory(null)
      setLatestBookReconfirmJob(null)
      setSelectedChapter('')
      return
    }
    let cancelled = false
    setBookWorkspaceLoading(true)
    setBookWorkspaceError(null)
    void Promise.all([
      getProjectBookIndex(currentProject.id, selectedBookId),
      listProjectBookStoryboardHistory(currentProject.id, selectedBookId, { limit: 160 }),
      getLatestProjectBookReconfirmJob(currentProject.id, selectedBookId).catch(() => ({ job: null })),
    ])
      .then(([index, history, reconfirm]) => {
        if (cancelled) return
        setSelectedBookIndex(index)
        setStoryboardHistory(history)
        setLatestBookReconfirmJob(reconfirm.job)
        const chapterOptions = Array.isArray(index.chapters) ? index.chapters : []
        setSelectedChapter((currentSelectedChapter) => {
          const nextExists = chapterOptions.some((chapter) => String(chapter.chapter) === currentSelectedChapter)
          if (nextExists) return currentSelectedChapter
          return chapterOptions[0] ? String(chapterOptions[0].chapter) : ''
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : '加载项目文本索引失败'
        setBookWorkspaceError(message)
        setSelectedBookIndex(null)
        setStoryboardHistory(null)
        setLatestBookReconfirmJob(null)
      })
      .finally(() => {
        if (cancelled) return
        setBookWorkspaceLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentProject?.id, mounted, refreshTick, selectedBookId])

  React.useEffect(() => {
    if (!mounted || !requestedChapterNo) return
    const chapterOptions = Array.isArray(selectedBookIndex?.chapters) ? selectedBookIndex.chapters : []
    const hasRequestedChapter = chapterOptions.some((chapter) => chapter.chapter === requestedChapterNo)
    if (!hasRequestedChapter) return
    setSelectedChapter((current) => (
      current === String(requestedChapterNo)
        ? current
        : String(requestedChapterNo)
    ))
  }, [mounted, requestedChapterNo, selectedBookIndex?.chapters])

  React.useEffect(() => {
    const projectId = String(currentProject?.id || '').trim()
    const bookId = String(selectedBookId || '').trim()
    const chapterNo = Number(selectedChapter)
    if (!mounted || !projectId || !bookId || !Number.isFinite(chapterNo) || chapterNo <= 0) {
      setSelectedChapterDetail(null)
      setChapterDetailError(null)
      setChapterDetailLoading(false)
      return
    }
    let cancelled = false
    setChapterDetailLoading(true)
    setChapterDetailError(null)
    void getProjectBookChapter(projectId, bookId, Math.trunc(chapterNo))
      .then((payload) => {
        if (cancelled) return
        setSelectedChapterDetail(payload)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setSelectedChapterDetail(null)
        setChapterDetailError(error instanceof Error ? error.message : '读取章节正文失败')
      })
      .finally(() => {
        if (cancelled) return
        setChapterDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentProject?.id, mounted, selectedBookId, selectedChapter])

  React.useEffect(() => {
    if (!mounted) return
    syncLinkedNodeIdsFromCanvas()
  }, [canvasNodeCount, currentProject?.id, mounted, syncLinkedNodeIdsFromCanvas])

  const handleLocateInCanvas = React.useCallback((entityKey: string) => {
    const nodeId = linkedNodeIdsByEntityKey[entityKey]
    if (!nodeId) return
    focusCanvasNode(nodeId)
  }, [linkedNodeIdsByEntityKey])

  const handleRefreshWorkspace = React.useCallback(() => {
    syncLinkedNodeIdsFromCanvas()
    setRefreshTick((current) => current + 1)
  }, [syncLinkedNodeIdsFromCanvas])

  const selectedChapterNo = React.useMemo(() => {
    const nextValue = Number(selectedChapter)
    return Number.isFinite(nextValue) && nextValue > 0 ? Math.trunc(nextValue) : null
  }, [selectedChapter])

  const storyboardHistoryGroupSize = React.useMemo<StoryboardGroupSize | null>(
    () => readStoryboardGroupSizeFromHistory(storyboardHistory, selectedChapterNo),
    [selectedChapterNo, storyboardHistory],
  )

  const rawStoryboardShots = React.useMemo(
    () => buildStoryboardShots({ index: selectedBookIndex, history: storyboardHistory, chapterNo: selectedChapterNo }),
    [selectedBookIndex, selectedChapterNo, storyboardHistory],
  )
  const selectedBookRoleCards = React.useMemo(() => {
    const merged = new Map<string, NonNullable<NonNullable<ProjectBookIndexDto['assets']>['roleCards']>[number]>()
    const bookRoleCards = Array.isArray(selectedBookIndex?.assets?.roleCards) ? selectedBookIndex.assets.roleCards : []
    for (const card of bookRoleCards) {
      const cardId = String(card?.cardId || '').trim()
      if (!cardId) continue
      merged.set(cardId, card)
    }
    for (const asset of projectRoleCards) {
      const assetCardId = String(asset.data.cardId || asset.id || '').trim()
      if (!assetCardId || merged.has(assetCardId)) continue
      merged.set(assetCardId, {
        cardId: assetCardId,
        roleId: String(asset.data.roleId || '').trim() || undefined,
        roleName: String(asset.data.roleName || '').trim(),
        stateDescription: String(asset.data.stateDescription || '').trim() || undefined,
        chapter: typeof asset.data.chapter === 'number' ? asset.data.chapter : undefined,
        chapterStart: typeof asset.data.chapterStart === 'number' ? asset.data.chapterStart : undefined,
        chapterEnd: typeof asset.data.chapterEnd === 'number' ? asset.data.chapterEnd : undefined,
        chapterSpan: Array.isArray(asset.data.chapterSpan) ? asset.data.chapterSpan : undefined,
        nodeId: String(asset.data.nodeId || '').trim() || undefined,
        prompt: String(asset.data.prompt || '').trim() || undefined,
        status: asset.data.status === 'draft' ? 'draft' : 'generated',
        modelKey: String(asset.data.modelKey || '').trim() || undefined,
        imageUrl: String(asset.data.imageUrl || '').trim() || undefined,
        confirmedAt: String(asset.data.confirmedAt || '').trim() || undefined,
        confirmedBy: String(asset.data.confirmedBy || '').trim() || undefined,
        createdAt: String(asset.updatedAt || '').trim(),
        createdBy: 'system',
        updatedAt: asset.data.updatedAt,
        updatedBy: 'system',
      })
    }
    return Array.from(merged.values()).sort((left, right) => (
      Date.parse(String(right.updatedAt || '')) - Date.parse(String(left.updatedAt || ''))
    ))
  }, [projectRoleCards, selectedBookIndex?.assets?.roleCards])

  const storyboardShots = rawStoryboardShots
  const selectedShotVideoRuntime = selectedShotId ? (videoRuntimeByShotId[selectedShotId] ?? null) : null
  const persistedShotVideoPreviewByShotId = React.useMemo(
    () => buildPersistedShotVideoPreviewByShotId({
      shots: storyboardShots,
      nodes: useRFStore.getState().nodes,
      projectId: String(currentProject?.id || '').trim(),
      selectedChapterNo,
      semanticAssets: Array.isArray(selectedBookIndex?.assets?.semanticAssets) ? selectedBookIndex.assets.semanticAssets : [],
    }),
    [canvasNodeCount, currentProject?.id, selectedBookIndex?.assets?.semanticAssets, selectedChapterNo, storyboardShots],
  )
  const videoPreviewByShotId = React.useMemo(
    () => {
      const merged: Record<string, { videoUrl?: string; thumbnailUrl?: string }> = { ...persistedShotVideoPreviewByShotId }
      for (const [shotId, runtime] of Object.entries(videoRuntimeByShotId)) {
        merged[shotId] = {
          ...(merged[shotId] || {}),
          ...(runtime.videoUrl ? { videoUrl: runtime.videoUrl } : {}),
          ...(runtime.thumbnailUrl ? { thumbnailUrl: runtime.thumbnailUrl } : {}),
        }
      }
      return merged
    },
    [persistedShotVideoPreviewByShotId, videoRuntimeByShotId],
  )

  const chapterOptions = React.useMemo(
    () => (selectedBookIndex?.chapters || []).map((chapter) => ({
      value: String(chapter.chapter),
      label: `第 ${chapter.chapter} 章 · ${chapter.title || '未命名章节'}`,
    })),
    [selectedBookIndex?.chapters],
  )
  const selectedChapterMeta = React.useMemo(
    () => selectedBookIndex?.chapters.find((chapter) => chapter.chapter === selectedChapterNo) || null,
    [selectedBookIndex?.chapters, selectedChapterNo],
  )
  const selectedChapterTitle = React.useMemo(
    () => String(selectedChapterDetail?.title || selectedChapterMeta?.title || '').trim(),
    [selectedChapterDetail?.title, selectedChapterMeta?.title],
  )
  const selectedChapterMetadataComplete = React.useMemo(
    () => isWorkspaceChapterMetadataComplete(selectedChapterMeta),
    [selectedChapterMeta],
  )
  const isBackgroundReconfirmRunning = React.useMemo(() => (
    latestBookReconfirmJob?.status === 'queued' || latestBookReconfirmJob?.status === 'running'
  ), [latestBookReconfirmJob])
  const isBookMetadataPendingBackgroundDerivation = React.useMemo(
    () => String(selectedBookIndex?.processedBy || '').trim() === 'agents-cli-on-demand',
    [selectedBookIndex?.processedBy],
  )
  const metadataBlockedByBackgroundPreprocess = React.useMemo(
    () => !selectedChapterMetadataComplete && (isBackgroundReconfirmRunning || isBookMetadataPendingBackgroundDerivation),
    [isBackgroundReconfirmRunning, isBookMetadataPendingBackgroundDerivation, selectedChapterMetadataComplete],
  )
  const selectedChapterCharacterCount = React.useMemo(
    () => Array.isArray(selectedChapterMeta?.characters) ? selectedChapterMeta.characters.length : 0,
    [selectedChapterMeta],
  )
  const selectedChapterSceneCount = React.useMemo(
    () => Array.isArray(selectedChapterMeta?.scenes) ? selectedChapterMeta.scenes.length : 0,
    [selectedChapterMeta],
  )
  const selectedChapterPropCount = React.useMemo(
    () => Array.isArray(selectedChapterMeta?.props) ? selectedChapterMeta.props.length : 0,
    [selectedChapterMeta],
  )
  const selectedChapterLocationCount = React.useMemo(
    () => Array.isArray(selectedChapterDetail?.locations) ? selectedChapterDetail.locations.length : 0,
    [selectedChapterDetail?.locations],
  )
  const currentChapterRoleAnchorCount = React.useMemo(
    () => selectedBookRoleCards.filter((roleCard) => {
      if (!String(roleCard.imageUrl || '').trim()) return false
      return isAssetVisibleInChapter({
        chapter: typeof roleCard.chapter === 'number' ? roleCard.chapter : null,
        chapterStart: typeof roleCard.chapterStart === 'number' ? roleCard.chapterStart : null,
        chapterEnd: typeof roleCard.chapterEnd === 'number' ? roleCard.chapterEnd : null,
        chapterSpan: Array.isArray(roleCard.chapterSpan) ? roleCard.chapterSpan : null,
        selectedChapterNo,
      })
    }).length,
    [selectedBookRoleCards, selectedChapterNo],
  )
  const imageModelOptions = React.useMemo(
    () => availableImageModels.map((item) => ({
      value: buildWorkspaceModelSelectionKey(item),
      label: item.vendor ? `${item.label} · ${item.vendor}` : item.label,
    })),
    [availableImageModels],
  )
  const videoModelOptions = React.useMemo(
    () => availableVideoModels.map((item) => ({
      value: buildWorkspaceModelSelectionKey(item),
      label: item.vendor ? `${item.label} · ${item.vendor}` : item.label,
    })),
    [availableVideoModels],
  )

  React.useEffect(() => {
    if (requestedShotId && storyboardShots.some((shot) => shot.id === requestedShotId)) {
      setSelectedShotId((current) => (current === requestedShotId ? current : requestedShotId))
      return
    }
    if (!selectedShotId && storyboardShots[0]?.id) {
      setSelectedShotId(storyboardShots[0].id)
    }
    if (selectedShotId && storyboardShots.some((shot) => shot.id === selectedShotId)) return
    setSelectedShotId(storyboardShots[0]?.id ?? '')
  }, [requestedShotId, selectedShotId, storyboardShots])

  const storyboardProductionSummary = React.useMemo(
    () => buildStoryboardProductionSummary(selectedBookIndex, selectedChapterNo, {
      preferredGroupSize: storyboardHistoryGroupSize,
    }),
    [selectedBookIndex, selectedChapterNo, storyboardHistoryGroupSize],
  )

  const storyboardProduction = React.useMemo<NanoComicStoryboardProductionItem | null>(() => {
    if (!storyboardProductionSummary) return null
    return {
      chapterNo: storyboardProductionSummary.chapterNo,
      groupSize: storyboardProductionSummary.groupSize,
      totalShots: storyboardProductionSummary.totalShots,
      totalChunks: storyboardProductionSummary.totalChunks,
      generatedChunks: storyboardProductionSummary.generatedChunks,
      generatedShots: storyboardProductionSummary.generatedShots,
      nextChunkIndex: storyboardProductionSummary.nextChunkIndex,
      nextShotStart: storyboardProductionSummary.nextShotStart,
      nextShotEnd: storyboardProductionSummary.nextShotEnd,
      isComplete: storyboardProductionSummary.isComplete,
      latestTailFrameUrl: storyboardProductionSummary.latestTailFrameUrl,
    }
  }, [storyboardProductionSummary])

  const enhancedStoryboardShots = React.useMemo(() => {
    const targetBookId = String(selectedBookId || '').trim()
    if (!nanoComicStoryboardRunState || String(nanoComicStoryboardRunState.bookId || '').trim() !== targetBookId) {
      return storyboardShots.map((shot) => {
        const runtimeVideo = videoRuntimeByShotId[shot.id]
        const persistedPreview = videoPreviewByShotId[shot.id]
        const hasPersistedVideo = Boolean(String(persistedPreview?.videoUrl || '').trim())
        return {
          ...shot,
          previewImageUrl: String(runtimeVideo?.thumbnailUrl || persistedPreview?.thumbnailUrl || shot.previewImageUrl || '').trim(),
          productionStatus: resolveShotVideoProductionStatus({
            runtimeStatus: runtimeVideo?.status,
            hasPersistedVideo,
          }),
        }
      })
    }
    const runtimeChapter = Math.trunc(Number(nanoComicStoryboardRunState.chapter || 0))
    return storyboardShots.map((shot) => {
      const runtimeVideo = videoRuntimeByShotId[shot.id]
      const persistedPreview = videoPreviewByShotId[shot.id]
      const hasPersistedVideo = Boolean(String(persistedPreview?.videoUrl || '').trim())
      if (shot.chapterNo !== runtimeChapter) return shot
      return {
        ...shot,
        chapterRunStatus: nanoComicStoryboardRunState.status,
        chapterRunText: nanoComicStoryboardRunState.progressText,
        previewImageUrl: String(runtimeVideo?.thumbnailUrl || persistedPreview?.thumbnailUrl || shot.previewImageUrl || '').trim(),
        productionStatus: resolveShotVideoProductionStatus({
          runtimeStatus: runtimeVideo?.status,
          hasPersistedVideo,
        }),
      }
    })
  }, [nanoComicStoryboardRunState, selectedBookId, storyboardShots, videoPreviewByShotId, videoRuntimeByShotId])

  const emptyStateMessage = React.useMemo(() => {
    if (workspaceError) return workspaceError
    if (!currentProject?.id) return '请先选择项目。'
    if (books.length === 0) return '当前项目还没有上传文本，请直接在上方检查清单上传项目文本。'
    if (!selectedBookId) return '当前项目文本索引不存在，请重新上传项目文本。'
    return null
  }, [books.length, currentProject?.id, selectedBookId, workspaceError])
  const hasCurrentChapterStoryboardPlan = React.useMemo(
    () => hasPersistedChapterStoryboardPlan(selectedBookIndex ?? null, selectedChapterNo),
    [selectedBookIndex, selectedChapterNo],
  )

  const openWorkspaceTextUpload = React.useCallback(() => {
    if (!currentProject?.id) {
      toast('请先选择项目', 'warning')
      return
    }
    if (workspaceTextUploading) return
    workspaceTextUploadInputRef.current?.click()
  }, [currentProject?.id, workspaceTextUploading])

  const handleWorkspaceTextUploadInputChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !currentProject?.id) return
    setWorkspaceTextUploading(true)
    try {
      toast('小说上传成功，开始分块上传并进入异步任务队列…', 'info')
      const latestUploadJobResponse = await getLatestProjectBookUploadJob(currentProject.id).catch(() => null)
      const latestUploadJob = latestUploadJobResponse?.job ?? null
      const blockingUpload = latestUploadJob && (latestUploadJob.status === 'queued' || latestUploadJob.status === 'running') ? latestUploadJob : null
      const result = await uploadProjectText({
        projectId: currentProject.id,
        projectName: currentProject.name,
        file,
        isBookUploadLocked: Boolean(blockingUpload),
        uploadMode: 'book-only',
        onChunkProgress: (completed, total) => {
          if (completed % 5 === 0 || completed === total) {
            toast(`分块上传进度：${completed}/${total}`, 'info')
          }
        },
      })
      toast('已进入后台队列，正在拆分任务处理小说…', 'info')
      toast('已开始处理小说', 'success')
      const nextBooks = await listProjectBooks(currentProject.id).catch(() => [])
      const normalizedBooks = sortProjectBooksByUpdatedAt(Array.isArray(nextBooks) ? nextBooks : [])
      setBooks(normalizedBooks)
      if (result.mode === 'book') {
        const nextPrimaryBookId = pickPrimaryProjectBook(normalizedBooks)?.bookId || ''
        setSelectedBookId((currentValue) => currentValue || nextPrimaryBookId)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '上传项目文本失败'
      toast(message, 'error')
    } finally {
      setWorkspaceTextUploading(false)
    }
  }, [currentProject?.id, currentProject?.name])

  const selectedStyleReferenceImages = React.useMemo(() => {
    const rawStyleBible = selectedBookIndex?.assets?.styleBible
    if (!rawStyleBible || typeof rawStyleBible !== 'object') return [] as string[]
    const referenceImages = Reflect.get(rawStyleBible, 'referenceImages')
    if (!Array.isArray(referenceImages)) return [] as string[]
    const dedupedUrls: string[] = []
    const seen = new Set<string>()
    for (const item of referenceImages) {
      const url = typeof item === 'string' ? item.trim() : ''
      if (!url || seen.has(url)) continue
      seen.add(url)
      dedupedUrls.push(url)
      if (dedupedUrls.length >= 8) break
    }
    return dedupedUrls
  }, [selectedBookIndex])

  const canvasStyleReferenceCandidates = React.useMemo(
    () => listCanvasStyleReferenceCandidates(canvasNodes),
    [canvasNodes],
  )

  const deriveWorkspaceStyleHints = React.useCallback(
    async (referenceUrl: string) => deriveStyleHintsFromReferenceImage(referenceUrl, publicVisionWithAuth),
    [],
  )

  const persistWorkspaceStyleReference = React.useCallback(async (
    referenceUrl: string,
    sourceLabel?: string,
  ) => {
    if (!currentProject?.id || !selectedBookId) {
      throw new Error(PROJECT_TEXT_REQUIRED_MESSAGE)
    }
    const nextIndex = await persistStyleReferenceImage({
      projectId: currentProject.id,
      bookId: selectedBookId,
      referenceUrl,
      sourceLabel,
      deriveStyleHints: deriveWorkspaceStyleHints,
      confirmProjectBookStyle,
    })
    setSelectedBookIndex(nextIndex)
    toast(sourceLabel ? `画风参考图已更新（来自${sourceLabel}）` : '画风参考图已更新', 'success')
    toast('已根据参考图自动提炼风格规则，并应用到角色卡', 'info')
  }, [currentProject?.id, deriveWorkspaceStyleHints, selectedBookId])

  const openWorkspaceStyleReferenceUpload = React.useCallback(() => {
    if (!currentProject?.id || !selectedBookId) {
      toast(PROJECT_TEXT_REQUIRED_MESSAGE, 'warning')
      return
    }
    if (workspaceStyleReferenceUploading) return
    workspaceStyleReferenceUploadInputRef.current?.click()
  }, [currentProject?.id, selectedBookId, workspaceStyleReferenceUploading])

  const handleWorkspaceStyleReferenceUploadInputChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!currentProject?.id || !selectedBookId) {
      toast(PROJECT_TEXT_REQUIRED_MESSAGE, 'warning')
      return
    }
    if (!String(file.type || '').startsWith('image/')) {
      toast('请选择图片文件', 'warning')
      return
    }
    setWorkspaceStyleReferenceUploading(true)
    try {
      const uploaded = await uploadServerAssetFile(file, file.name, {
        projectId: currentProject.id,
        taskKind: 'style_reference',
      })
      const uploadedData = uploaded && typeof uploaded.data === 'object' && uploaded.data !== null && !Array.isArray(uploaded.data)
        ? uploaded.data as Record<string, unknown>
        : null
      const url =
        String(uploadedData?.url || '').trim()
        || String(uploadedData?.imageUrl || '').trim()
        || String(uploadedData?.thumbnailUrl || '').trim()
      if (!url) throw new Error('上传成功但未返回可用图片地址')
      await persistWorkspaceStyleReference(url)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '上传画风参考图失败'
      toast(message, 'error')
    } finally {
      setWorkspaceStyleReferenceUploading(false)
    }
  }, [currentProject?.id, persistWorkspaceStyleReference, selectedBookId])

  const useCanvasStyleReferenceFromWorkspace = React.useCallback(async () => {
    if (workspaceStyleReferenceUploading) return
    if (!currentProject?.id || !selectedBookId) {
      toast(PROJECT_TEXT_REQUIRED_MESSAGE, 'warning')
      return
    }
    const candidate = canvasStyleReferenceCandidates[0]
    if (!candidate?.url) {
      toast('画布里还没有可用图片，请先生成一张图', 'warning')
      return
    }
    setWorkspaceStyleReferenceUploading(true)
    try {
      await persistWorkspaceStyleReference(candidate.url, `画布「${candidate.label}」`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '使用画布图片失败'
      toast(message, 'error')
    } finally {
      setWorkspaceStyleReferenceUploading(false)
    }
  }, [
    canvasStyleReferenceCandidates,
    currentProject?.id,
    persistWorkspaceStyleReference,
    selectedBookId,
    workspaceStyleReferenceUploading,
  ])

  const openWorkspaceProjectTextDependency = React.useCallback(() => {
    requestAssetPanelFocus({
      tab: 'materials',
      materialCategory: 'docs',
      scrollTarget: 'top',
    })
    setActivePanel('assets')
  }, [requestAssetPanelFocus, setActivePanel])

  React.useEffect(() => {
    const projectId = String(currentProject?.id || '').trim()
    const bookId = String(selectedBookId || '').trim()
    const chapterNo = typeof selectedChapterNo === 'number' ? selectedChapterNo : null
    if (!mounted || !projectId || !bookId || !chapterNo) return
    if (selectedChapterMetadataComplete || metadataBlockedByBackgroundPreprocess || workspaceMetadataEnsuring) return
    const requestKey = `${bookId}:${chapterNo}`
    const now = Date.now()
    const lastAttemptAt = autoEnsureChapterMetadataAttemptAtRef.current.get(requestKey) ?? 0
    if (now - lastAttemptAt < 30_000) return
    autoEnsureChapterMetadataAttemptAtRef.current.set(requestKey, now)
    let cancelled = false
    setWorkspaceMetadataEnsuring(true)
    void (async () => {
      try {
        await ensureProjectBookMetadataWindow(projectId, bookId, {
          chapter: chapterNo,
          mode: 'standard',
          windowSize: 1,
        })
        await refreshSelectedBookArtifacts({ bookId, preserveSelectedChapter: true })
      } catch (error: unknown) {
        const errorCode = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : ''
        if (errorCode === 'BOOK_METADATA_ENSURE_WINDOW_BUSY') {
          window.setTimeout(() => {
            void refreshSelectedBookArtifacts({ bookId, preserveSelectedChapter: true }).catch(() => {})
          }, 1500)
          return
        }
        const message = error instanceof Error ? error.message : '章节元数据自动分析失败'
        if (!cancelled) {
          toast(message, 'error')
        }
      } finally {
        if (!cancelled) {
          setWorkspaceMetadataEnsuring(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    currentProject?.id,
    metadataBlockedByBackgroundPreprocess,
    mounted,
    refreshSelectedBookArtifacts,
    selectedBookId,
    selectedChapterMetadataComplete,
    selectedChapterNo,
    workspaceMetadataEnsuring,
  ])

  const chapterAssetItems = React.useMemo(() => {
    const items: WorkspaceAssetListItem[] = []
    for (const roleCard of selectedBookRoleCards) {
      const cardId = String(roleCard.cardId || '').trim()
      const isCurrentChapter = isAssetVisibleInChapter({
        chapter: typeof roleCard.chapter === 'number' ? roleCard.chapter : null,
        chapterStart: typeof roleCard.chapterStart === 'number' ? roleCard.chapterStart : null,
        chapterEnd: typeof roleCard.chapterEnd === 'number' ? roleCard.chapterEnd : null,
        chapterSpan: Array.isArray(roleCard.chapterSpan) ? roleCard.chapterSpan : null,
        selectedChapterNo,
      })
      items.push({
        id: `role-${cardId}`,
        title: roleCard.roleName,
        subtitle: String(roleCard.stateDescription || '角色锚点').trim() || '角色锚点',
        kindLabel: '角色卡',
        statusLabel: String(roleCard.imageUrl || '').trim() ? '已锚定' : '待补图',
        canGenerate: !String(roleCard.imageUrl || '').trim(),
        generationTarget: {
          kind: 'roleCard',
          cardId,
          roleName: roleCard.roleName,
          description: String(roleCard.stateDescription || '').trim() || undefined,
        },
        imageUrl: String(roleCard.imageUrl || '').trim() || undefined,
        entityKey: cardId ? getNanoComicEntityKey('asset', `role-${cardId}`) : undefined,
        mentionAliases: dedupeTrimmedTexts([
          roleCard.roleName,
          String(roleCard.roleId || '').trim(),
          cardId,
        ]),
        note: String(roleCard.confirmedAt || '').trim() ? '已确认，可直接作为角色引用' : '未确认，建议先确认后批量生产',
        chapterNo: typeof roleCard.chapter === 'number' ? roleCard.chapter : null,
        isCurrentChapter,
      })
    }
    const visualRefs = Array.isArray(selectedBookIndex?.assets?.visualRefs) ? selectedBookIndex.assets.visualRefs : []
    for (const visualRef of visualRefs) {
      const refId = String(visualRef.refId || '').trim()
      const isCurrentChapter = isAssetVisibleInChapter({
        chapter: typeof visualRef.chapter === 'number' ? visualRef.chapter : null,
        chapterStart: typeof visualRef.chapterStart === 'number' ? visualRef.chapterStart : null,
        chapterEnd: typeof visualRef.chapterEnd === 'number' ? visualRef.chapterEnd : null,
        chapterSpan: Array.isArray(visualRef.chapterSpan) ? visualRef.chapterSpan : null,
        selectedChapterNo,
      })
      items.push({
        id: `visual-${refId}`,
        title: visualRef.name,
        subtitle: String(visualRef.stateDescription || visualRef.generatedFrom || '').trim() || '章节视觉参考',
        kindLabel: visualRef.category === 'spell_fx' ? '特效参考' : '场景/道具参考',
        statusLabel: String(visualRef.imageUrl || '').trim() ? '已生成' : '待补图',
        canGenerate: !String(visualRef.imageUrl || '').trim(),
        generationTarget: {
          kind: 'visualRef',
          refId,
          category: visualRef.category,
          name: visualRef.name,
          description: String(visualRef.stateDescription || visualRef.generatedFrom || '').trim() || undefined,
        },
        imageUrl: String(visualRef.imageUrl || '').trim() || undefined,
        mentionAliases: dedupeTrimmedTexts([
          visualRef.name,
          refId,
        ]),
        note: String(visualRef.prompt || '').trim() || undefined,
        entityKey: refId ? getNanoComicEntityKey('asset', `visual-${refId}`) : undefined,
        chapterNo: typeof visualRef.chapter === 'number' ? visualRef.chapter : null,
        isCurrentChapter,
      })
    }
    const styleBible = selectedBookIndex?.assets?.styleBible
    const styleRefs = Array.isArray(styleBible?.referenceImages) ? styleBible.referenceImages : []
    for (const [index, referenceUrl] of styleRefs.entries()) {
      const imageUrl = String(referenceUrl || '').trim()
      if (!imageUrl) continue
      items.push({
        id: `style-${index}`,
        title: styleBible?.styleName || '项目风格锚点',
        subtitle: '所有场景图和分镜图都应继承这一组风格参考',
        kindLabel: '风格参考',
        statusLabel: '已锚定',
        imageUrl,
        mentionAliases: dedupeTrimmedTexts([
          styleBible?.styleName || '',
          `style-ref-${index + 1}`,
          `style-${index}`,
        ]),
        isCurrentChapter: true,
      })
    }
    const chapterMeta = selectedBookIndex?.chapters.find((chapter) => chapter.chapter === selectedChapterNo) || null
    const existingRoleNameKeys = new Set(
      selectedBookRoleCards
        .map((roleCard) => normalizeAssetLookupKey(roleCard.roleName))
        .filter(Boolean),
    )
    for (const character of (chapterMeta?.characters || [])) {
      const roleName = String(character.name || '').trim()
      const roleNameKey = normalizeAssetLookupKey(roleName)
      if (!roleName || !roleNameKey || existingRoleNameKeys.has(roleNameKey)) continue
      items.push({
        id: `chapter-role-${roleName}`,
        title: roleName,
        subtitle: String(character.description || '章节文本提及角色').trim() || '章节文本提及角色',
        kindLabel: '章节角色',
        statusLabel: '待角色卡',
        canGenerate: true,
        generationTarget: {
          kind: 'roleCard',
          roleName,
          description: String(character.description || '').trim() || undefined,
        },
        mentionAliases: dedupeTrimmedTexts([roleName]),
        chapterNo: selectedChapterNo,
        isCurrentChapter: true,
      })
    }
    for (const scene of (chapterMeta?.scenes || [])) {
      items.push({
        id: `scene-${scene.name}`,
        title: scene.name,
        subtitle: String(scene.description || '章节文本提及场景').trim() || '章节文本提及场景',
        kindLabel: '文本场景',
        statusLabel: '待显式资产',
        canGenerate: true,
        generationTarget: {
          kind: 'visualRef',
          category: 'scene_prop',
          name: scene.name,
          description: String(scene.description || '').trim() || undefined,
          tags: ['scene'],
        },
        mentionAliases: dedupeTrimmedTexts([scene.name]),
        chapterNo: selectedChapterNo,
        isCurrentChapter: true,
      })
    }
    for (const prop of (chapterMeta?.props || [])) {
      items.push({
        id: `prop-${prop.name}`,
        title: prop.name,
        subtitle: String(prop.description || '章节文本提及道具').trim() || '章节文本提及道具',
        kindLabel: '文本道具',
        statusLabel: '待显式资产',
        canGenerate: true,
        generationTarget: {
          kind: 'visualRef',
          category: 'scene_prop',
          name: prop.name,
          description: String(prop.description || '').trim() || undefined,
          tags: ['prop'],
        },
        mentionAliases: dedupeTrimmedTexts([prop.name]),
        chapterNo: selectedChapterNo,
        isCurrentChapter: true,
      })
    }
    const canvasItems = buildCanvasWorkspaceAssetItems({
      nodes: useRFStore.getState().nodes,
      projectId: String(currentProject?.id || '').trim(),
      selectedChapterNo,
    })
    return mergeWorkspaceAssetListItems(items, canvasItems)
  }, [canvasNodeCount, currentProject?.id, refreshTick, selectedBookIndex?.assets?.styleBible, selectedBookIndex?.assets?.visualRefs, selectedBookIndex?.chapters, selectedBookRoleCards, selectedChapterNo])
  const currentChapterPendingRoleAnchorItems = React.useMemo(
    () => chapterAssetItems
      .filter((item) => item.generationTarget?.kind === 'roleCard')
      .filter((item) => item.isCurrentChapter !== false)
      .filter((item) => item.canGenerate === true)
      .slice(0, 8),
    [chapterAssetItems],
  )
  const currentChapterMissingRoleAnchorCount = React.useMemo(
    () => currentChapterPendingRoleAnchorItems.length,
    [currentChapterPendingRoleAnchorItems],
  )
  const isWorkspaceAssetGenerating = generatingAssetIds.size > 0

  const handleGenerateMissingRoleAnchors = React.useCallback(async () => {
    if (isWorkspaceAssetGenerating) return
    const pendingRoleAssetIds = currentChapterPendingRoleAnchorItems.map((item) => item.id)
    if (pendingRoleAssetIds.length === 0) {
      toast('当前章节没有待补齐的角色锚点。', 'info')
      return
    }
    const failures: string[] = []
    setProductionRequestState({
      status: 'running',
      message: `正在并发补齐 ${pendingRoleAssetIds.length} 个角色锚点…`,
      ...buildRuntimeStamp('启动时间'),
    })
    await runWorkspaceTasksWithConcurrency(
      pendingRoleAssetIds,
      WORKSPACE_ROLE_ANCHOR_BATCH_CONCURRENCY,
      async (assetId) => {
        try {
          await generateWorkspaceAssetByIdRef.current(assetId)
        } catch (error: unknown) {
          failures.push(error instanceof Error ? error.message : `角色锚点 ${assetId} 补齐失败`)
        }
      },
    )
    if (failures.length > 0) {
      setProductionRequestState({
        status: 'error',
        message: failures[0],
        updatedAtLabel: failures.length > 1 ? `另有 ${failures.length - 1} 个角色锚点失败` : '',
        updatedAtMs: Date.now(),
      })
      toast(failures[0], 'error')
    } else {
      setProductionRequestState({
        status: 'success',
        message: `已补齐当前章节 ${pendingRoleAssetIds.length} 个角色锚点。`,
        ...buildRuntimeStamp('完成时间'),
      })
    }
    setRefreshTick((current) => current + 1)
  }, [currentChapterPendingRoleAnchorItems, isWorkspaceAssetGenerating])

  const workspaceChecklistItems = React.useMemo<WorkspaceChecklistItem[]>(() => {
    if (!currentProject?.id) {
      return [{
        key: 'project',
        title: '选择项目',
        detail: '漫剧工作台依赖当前项目作用域，没有项目时无法读取文本、章节和资产。',
        actionLabel: '前往项目列表',
        action: () => {
          setActivePanel(null)
          spaNavigate('/projects')
        },
      }]
    }
    const items: WorkspaceChecklistItem[] = []
    const hasUploadedBook = books.length > 0
    if (!hasUploadedBook) {
      items.push({
        key: 'project-text',
        title: '项目文本',
        detail: '当前工作台依赖项目文本。现在可以直接在这里上传，不必先切去素材面板找入口。',
        actionLabel: '直接上传文本',
        actionLoading: workspaceTextUploading,
        action: openWorkspaceTextUpload,
      })
    }
    if (hasUploadedBook && !selectedBookId) {
      items.push({
        key: 'book-index',
        title: '文本索引',
        detail: '检测到文本索引未就绪，继续创作前需要重新选择或替换文本。',
        actionLabel: '去文本素材',
        action: openWorkspaceProjectTextDependency,
      })
    }
    if (hasUploadedBook && selectedChapterMetadataComplete && currentChapterMissingRoleAnchorCount > 0) {
      items.push({
        key: 'role-anchors',
        title: '角色锚点',
        detail: `章节里识别到了 ${selectedChapterCharacterCount} 个角色，但还有 ${currentChapterMissingRoleAnchorCount} 个缺少可复用角色卡锚点，继续出图会放大人物漂移。`,
        actionLabel: '补齐角色卡',
        actionLoading: isWorkspaceAssetGenerating,
        action: handleGenerateMissingRoleAnchors,
      })
    }
    if (hasUploadedBook && selectedStyleReferenceImages.length <= 0) {
      items.push({
        key: 'style-reference',
        title: '风格参考',
        detail: canvasStyleReferenceCandidates.length > 0
          ? '角色卡和章节资产生产依赖风格参考。当前画布已有可复用图片，可以直接拿最近一张设为风格锚点。'
          : '角色卡和章节资产生产依赖风格参考。现在可以直接在工作台上传风格图，不必切去素材面板。',
        actionLabel: canvasStyleReferenceCandidates.length > 0 ? '使用最近画布图' : '上传风格图',
        actionLoading: workspaceStyleReferenceUploading,
        action: canvasStyleReferenceCandidates.length > 0
          ? useCanvasStyleReferenceFromWorkspace
          : openWorkspaceStyleReferenceUpload,
      })
    }
    return items
  }, [
    books.length,
    canvasStyleReferenceCandidates.length,
    currentProject?.id,
    currentChapterMissingRoleAnchorCount,
    handleGenerateMissingRoleAnchors,
    isWorkspaceAssetGenerating,
    openWorkspaceTextUpload,
    openWorkspaceProjectTextDependency,
    openWorkspaceStyleReferenceUpload,
    selectedChapterCharacterCount,
    selectedChapterMetadataComplete,
    selectedChapterNo,
    selectedBookId,
    selectedStyleReferenceImages.length,
    setActivePanel,
    useCanvasStyleReferenceFromWorkspace,
    workspaceStyleReferenceUploading,
    workspaceTextUploading,
  ])

  const resolvedStoryboardShots = React.useMemo(() => enhancedStoryboardShots.map((shot) => {
    const promptText = String(shot.promptJson || shot.script || shot.note || shot.continuityHint || '').trim()
    const resolvedReferences = resolveShotWorkspaceReferences({
      shot,
      assetItems: chapterAssetItems,
      promptText,
    })
    const previewImageUrl = String(
      shot.previewImageUrl ||
      resolvedReferences.referenceImageUrls[0] ||
      resolvedReferences.anchorImageUrls[0] ||
      '',
    ).trim()
    return {
      ...shot,
      previewImageUrl,
      referenceImageUrls: resolvedReferences.referenceImageUrls,
      anchorImageUrls: resolvedReferences.anchorImageUrls,
      videoReady: !buildWorkspaceShotVideoBlockReason({
        shot: {
          ...shot,
          previewImageUrl,
          referenceImageUrls: resolvedReferences.referenceImageUrls,
          anchorImageUrls: resolvedReferences.anchorImageUrls,
        },
        promptText,
        selectedVideoModel,
        hasVideoModelOptions: availableVideoModels.length > 0,
        chapterAssetItems,
      }),
      videoBlockReason: buildWorkspaceShotVideoBlockReason({
        shot: {
          ...shot,
          previewImageUrl,
          referenceImageUrls: resolvedReferences.referenceImageUrls,
          anchorImageUrls: resolvedReferences.anchorImageUrls,
        },
        promptText,
        selectedVideoModel,
        hasVideoModelOptions: availableVideoModels.length > 0,
        chapterAssetItems,
      }) || undefined,
    }
  }), [availableVideoModels.length, chapterAssetItems, enhancedStoryboardShots, selectedVideoModel])

  const storyboardImageShots = React.useMemo(() => storyboardShots.map((shot) => {
    const promptText = String(shot.promptJson || shot.script || shot.note || shot.continuityHint || '').trim()
    const resolvedReferences = resolveShotWorkspaceReferences({
      shot,
      assetItems: chapterAssetItems,
      promptText,
    })
    const previewImageUrl = String(
      shot.previewImageUrl ||
      resolvedReferences.referenceImageUrls[0] ||
      resolvedReferences.anchorImageUrls[0] ||
      '',
    ).trim()
    return {
      ...shot,
      previewImageUrl,
      referenceImageUrls: resolvedReferences.referenceImageUrls,
      anchorImageUrls: resolvedReferences.anchorImageUrls,
      productionStatus: resolveShotStoryboardProductionStatus({
        chapterRunStatus: shot.chapterRunStatus,
        hasStoryboardImage: Boolean(previewImageUrl),
      }),
      videoReady: false,
      videoBlockReason: undefined,
    }
  }), [chapterAssetItems, storyboardShots])

  const selectedResolvedShot = React.useMemo(
    () => resolvedStoryboardShots.find((shot) => shot.id === selectedShotId) || resolvedStoryboardShots[0] || null,
    [resolvedStoryboardShots, selectedShotId],
  )
  const selectedShotVideoBlockedReason = React.useMemo(() => {
    if (!selectedResolvedShot) return '请先选择一个片段'
    const promptText = String(activeShotPrompt || '').trim()
    return buildWorkspaceShotVideoBlockReason({
      shot: selectedResolvedShot,
      promptText,
      selectedVideoModel,
      hasVideoModelOptions: availableVideoModels.length > 0,
      chapterAssetItems,
    })
  }, [activeShotPrompt, availableVideoModels.length, chapterAssetItems, selectedResolvedShot, selectedVideoModel])

  const generateWorkspaceAssetById = React.useCallback(async (assetId: string): Promise<string> => {
    const projectId = String(currentProject?.id || '').trim()
    const bookId = String(selectedBookId || '').trim()
    const chapterNo = typeof selectedChapterNo === 'number' ? selectedChapterNo : null
    const targetAsset = chapterAssetItems.find((item) => item.id === assetId) || null
    if (!projectId || !bookId || !chapterNo || !targetAsset?.generationTarget) {
      notifications.show({
        title: '缺少上下文',
        message: '当前项目、工作流、章节或目标资产未就绪，无法在工作台内发起生成。',
        color: 'red',
      })
      return ''
    }
    const resolvedAssetImageUrl = String(targetAsset.imageUrl || '').trim()
    if (resolvedAssetImageUrl) {
      return resolvedAssetImageUrl
    }
    const currentNodes = useRFStore.getState().nodes
    const preExistingNodeId = findMatchingWorkspaceAssetNodeId({
      nodes: currentNodes,
      projectId,
      chapterNo,
      targetAsset,
      ensuredVisualRefId: targetAsset.generationTarget.kind === 'visualRef'
        ? targetAsset.generationTarget.refId
        : undefined,
    })
    const preExistingNode = preExistingNodeId
      ? currentNodes.find((node) => String(node.id || '').trim() === preExistingNodeId)
      : undefined
    const preExistingNodeImageUrl = String(readImagePreviewFromNodeData(preExistingNode).imageUrl || '').trim()
    if (preExistingNodeImageUrl) {
      setRefreshTick((current) => current + 1)
      return preExistingNodeImageUrl
    }
    const preferredImageModel = findWorkspaceModelOptionBySelectionKey(availableImageModels, selectedImageModel)
      ?? availableImageModels[0]
      ?? null
    if (!preferredImageModel) {
      notifications.show({
        title: '图片模型未就绪',
        message: '当前没有可用图片模型，请先在系统模型管理中启用 image 模型。',
        color: 'red',
      })
      return ''
    }
    if (generatingAssetIds.has(assetId)) return ''

    setGeneratingAssetIds((current) => {
      const next = new Set(current)
      next.add(assetId)
      return next
    })
    setProductionRequestState({
      status: 'running',
      message: `正在补齐资产：${targetAsset.title}`,
      ...buildRuntimeStamp('启动时间'),
    })

    let resolved = false
    try {
      let ensuredVisualRefId = targetAsset.generationTarget.kind === 'visualRef'
        ? targetAsset.generationTarget.refId
        : undefined
      if (targetAsset.generationTarget.kind === 'visualRef' && !targetAsset.generationTarget.refId) {
        const saved = await upsertProjectBookVisualRef(projectId, bookId, {
          category: targetAsset.generationTarget.category,
          name: targetAsset.generationTarget.name,
          chapter: chapterNo,
          chapterStart: chapterNo,
          chapterEnd: chapterNo,
          chapterSpan: [chapterNo],
          tags: targetAsset.generationTarget.tags,
          stateDescription: targetAsset.generationTarget.description,
          status: 'draft',
        })
        ensuredVisualRefId = saved.refId
      }
      const imageModel = readWorkspaceRequestedModel(preferredImageModel) || getModelOptionRequestAlias(availableImageModels, preferredImageModel.value)
      const imageModelVendor = typeof preferredImageModel.vendor === 'string' ? preferredImageModel.vendor.trim() : ''
      const styleRefs = Array.isArray(selectedBookIndex?.assets?.styleBible?.referenceImages)
        ? selectedBookIndex.assets.styleBible.referenceImages.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
        : []
      const chapterTitle = String(selectedChapterDetail?.title || '').trim() || undefined
      const generationPrompt = targetAsset.generationTarget.kind === 'roleCard'
        ? buildWorkspaceRoleCardPrompt({
            roleName: targetAsset.generationTarget.roleName,
            description: targetAsset.generationTarget.description,
            chapterNo,
            chapterTitle,
          })
        : buildWorkspaceVisualRefPrompt({
            name: targetAsset.generationTarget.name,
            description: targetAsset.generationTarget.description,
            chapterNo,
            chapterTitle,
            category: targetAsset.generationTarget.category,
          })
      const nodeLabel = targetAsset.generationTarget.kind === 'roleCard'
        ? `角色卡 · ${targetAsset.generationTarget.roleName}`
        : `${targetAsset.generationTarget.category === 'spell_fx' ? '特效参考' : '场景参考'} · ${targetAsset.generationTarget.name}`
      const anchorBindings = targetAsset.generationTarget.kind === 'roleCard'
        ? upsertSemanticNodeAnchorBinding({
            existing: [],
            next: {
              kind: 'character',
              refId: targetAsset.generationTarget.cardId || null,
              label: targetAsset.generationTarget.roleName,
              sourceBookId: bookId,
              referenceView: 'three_view',
            },
          })
        : upsertSemanticNodeAnchorBinding({
            existing: [],
            next: {
              kind: 'scene',
              refId: ensuredVisualRefId || null,
              label: targetAsset.generationTarget.name,
              sourceBookId: bookId,
              category: targetAsset.generationTarget.category,
            },
            replaceKinds: ['scene', 'prop'],
          })
      const nodeConfig: Record<string, unknown> = {
        kind: 'image',
        autoLabel: false,
        prompt: generationPrompt,
        imageModel,
        ...(imageModelVendor ? { imageModelVendor } : null),
        sourceProjectId: projectId,
        sourceBookId: bookId,
        chapter: chapterNo,
        materialChapter: chapterNo,
        productionLayer: 'anchors',
        creationStage: 'workspace_asset_generate',
        approvalStatus: 'draft',
        anchorBindings,
        source: 'chapter_assets_confirm',
        status: 'idle',
        progress: 0,
        imageUrl: null,
        imageResults: [],
        lastResult: null,
        lastError: null,
        ...(styleRefs.length > 0
          ? (targetAsset.generationTarget.kind === 'roleCard'
              ? { roleCardReferenceImages: styleRefs }
              : { referenceImages: styleRefs })
          : null),
        ...(targetAsset.generationTarget.kind === 'roleCard'
          ? {
              roleCardId: targetAsset.generationTarget.cardId,
              roleName: targetAsset.generationTarget.roleName,
              referenceView: 'three_view',
            }
          : {
              scenePropRefId: ensuredVisualRefId,
              scenePropRefName: targetAsset.generationTarget.name,
              visualRefId: ensuredVisualRefId,
              visualRefName: targetAsset.generationTarget.name,
              visualRefCategory: targetAsset.generationTarget.category,
            }),
      }
      const liveNodes = useRFStore.getState().nodes
      const existingNodeId = findMatchingWorkspaceAssetNodeId({
        nodes: liveNodes,
        projectId,
        chapterNo,
        targetAsset,
        ensuredVisualRefId,
      })
      let nodeId = ''
      if (existingNodeId) {
        const existingNode = liveNodes.find((node) => String(node.id || '').trim() === existingNodeId)
        const existingNodeImageUrl = String(readImagePreviewFromNodeData(existingNode).imageUrl || '').trim()
        if (existingNodeImageUrl) {
          setRefreshTick((current) => current + 1)
          return existingNodeImageUrl
        }
        const updateResult = await CanvasService.updateNode({
          nodeId: existingNodeId,
          label: nodeLabel,
          config: nodeConfig,
        })
        if (!updateResult.success) {
          throw new Error(updateResult.error)
        }
        nodeId = existingNodeId
      } else {
        const createResult = await CanvasService.createNode({
          type: 'taskNode',
          label: nodeLabel,
          config: nodeConfig,
        })
        if (!createResult.success) {
          throw new Error(createResult.error)
        }
        nodeId = typeof createResult.data?.nodeId === 'string' ? createResult.data.nodeId.trim() : ''
      }
      if (!nodeId) {
        throw new Error('工作台已创建资产节点，但未返回 nodeId')
      }
      setProductionRequestState({
        status: 'running',
        message: `正在执行 ${targetAsset.title} 的图片生成…`,
        updatedAtLabel: `节点：${nodeId}`,
        updatedAtMs: Date.now(),
      })
      const runResult = await CanvasService.runNode({ nodeId })
      if (!runResult.success) {
        throw new Error(runResult.error)
      }
      const resolvedImageUrl = readImageUrlFromCanvasRunResult(runResult.data)
      resolved = true
      setProductionRequestState({
        status: 'success',
        message: `资产 ${targetAsset.title} 已生成并写回工作台。`,
        ...buildRuntimeStamp('完成时间'),
      })
      await refreshSelectedBookArtifacts({ bookId, preserveSelectedChapter: true })
      syncLinkedNodeIdsFromCanvas()
      setRefreshTick((current) => current + 1)
      return resolvedImageUrl
    } catch (error: unknown) {
      if (!resolved) {
        setProductionRequestState({
          status: 'error',
          message: error instanceof Error ? error.message : `资产 ${targetAsset.title} 生成失败`,
          ...buildRuntimeStamp('失败时间'),
        })
      }
      throw error
    } finally {
      setGeneratingAssetIds((current) => {
        if (!current.has(assetId)) return current
        const next = new Set(current)
        next.delete(assetId)
        return next
      })
    }
  }, [
    chapterAssetItems,
    currentProject?.id,
    generatingAssetIds,
    refreshSelectedBookArtifacts,
    availableImageModels,
    selectedImageModel,
    selectedBookId,
    selectedBookIndex?.assets?.styleBible?.referenceImages,
    selectedChapterDetail?.title,
    selectedChapterNo,
    syncLinkedNodeIdsFromCanvas,
  ])

  React.useEffect(() => {
    generateWorkspaceAssetByIdRef.current = generateWorkspaceAssetById
  }, [generateWorkspaceAssetById])

  const handleGenerateWorkspaceAsset = React.useCallback(async (assetId: string) => {
    try {
      await generateWorkspaceAssetById(assetId)
    } catch {
      // state is already updated in generateWorkspaceAssetById
    }
  }, [generateWorkspaceAssetById])

  const handleGenerateChapterScript = React.useCallback(() => {
    const projectId = String(currentProject?.id || '').trim()
    const projectName = String(currentProject?.name || '').trim()
    const flowId = String(currentFlowId || '').trim()
    const bookId = String(selectedBookId || '').trim()
    const chapterNo = typeof selectedChapterNo === 'number' ? selectedChapterNo : null
    if (!projectId || !flowId || !bookId || !chapterNo) {
      notifications.show({
        title: '缺少上下文',
        message: '当前项目、工作流或章节未就绪，无法发起章节生产。',
        color: 'red',
      })
      return
    }

    const sessionKey = buildEffectiveChatSessionKey({
      persistedBaseKey: `chapter-workspace-${bookId}-chapter-${chapterNo}`,
      projectId,
      flowId,
      skillId: STORYBOARD_EXPERT_SKILL_ID,
      lane: 'general',
    })
    const prompt = [
      `只生成第${chapterNo}章的章节剧本与分镜计划。`,
      '硬约束：只允许写入当前 book index 的 storyboardPlans / shotPrompts / storyboardStructured 等章节剧本元数据。',
      '完成后必须调用 tapcanvas_book_storyboard_plan_upsert 把本章章节剧本写入当前 book index；没有真实写入成功，不算完成。',
      '禁止创建图片、视频、画布节点、前置资产节点，禁止发起任何真实媒体生成。',
      '必须先读取当前章节全文；若存在上一组 tail frame，则仅把它作为连续性参考，不得跳过章节正文。',
      '输出目标：为当前章节写出完整、可执行、可继续驱动后续分镜与视频片段的 shot prompts。',
      '如果章节证据不足或无法形成可执行 shot prompts，必须显式失败，不要只返回说明文字。',
    ].join('\n')

    setChapterScriptState({
      status: 'running',
      message: `正在生成第 ${chapterNo} 章章节剧本…`,
      ...buildRuntimeStamp('启动时间'),
    })

    let resolved = false
    let finalizing = false
    const finalizeChapterScriptRun = (response: AgentsChatResponseDto | null, source: 'result' | 'done' | 'stream_error') => {
      if (finalizing) return
      finalizing = true
      setChapterScriptState({
        status: 'running',
        message: source === 'stream_error'
          ? '章节剧本流已结束，正在回读校验落盘结果。'
          : '章节剧本已生成，正在校验工作台回填。',
        ...buildRuntimeStamp('校验时间'),
      })
      void (async () => {
        try {
          const refreshed = await refreshSelectedBookArtifacts({ bookId, preserveSelectedChapter: true })
          const persisted = hasPersistedChapterStoryboardPlan(refreshed?.index ?? null, chapterNo)
          if (!persisted) {
            setChapterScriptState({
              status: 'error',
              message: response
                ? buildChapterScriptPersistenceErrorMessage(response)
                : '章节剧本流已结束，但刷新后仍未发现当前章节的 storyboardPlans。',
              ...buildRuntimeStamp('失败时间'),
            })
            return
          }
          setChapterScriptState({
            status: 'success',
            message: '章节剧本已生成并回填当前工作台。',
            ...buildRuntimeStamp('完成时间'),
          })
          setRefreshTick((current) => current + 1)
        } catch (error: unknown) {
          setChapterScriptState({
            status: 'error',
            message: error instanceof Error ? error.message : '章节剧本回填校验失败',
            ...buildRuntimeStamp('失败时间'),
          })
        }
      })()
    }
    void agentsChatStream({
      vendor: 'agents',
      prompt,
      sessionKey,
      bookId,
      chapterId: String(chapterNo),
      canvasProjectId: projectId,
      canvasFlowId: flowId,
      requiredSkills: [STORYBOARD_EXPERT_SKILL_ID],
      chatContext: {
        currentProjectName: projectName || '当前项目',
        workspaceAction: 'chapter_script_generation',
        selectedReference: {
          bookId,
          chapterId: String(chapterNo),
        },
      },
      mode: 'auto',
      temperature: 0.7,
      stream: true,
    }, {
      onEvent: (event) => {
        if (event.event === 'tool') {
          const toolName = String(event.data?.toolName || 'tool').trim()
          setChapterScriptState({
            status: 'running',
            message: `正在生成章节剧本：${toolName}`,
            ...buildRuntimeStamp('最近更新'),
          })
          return
        }
        if (event.event === 'error') {
          resolved = true
          setChapterScriptState({
            status: 'error',
            message: String(event.data?.message || '章节剧本生成失败').trim() || '章节剧本生成失败',
            ...buildRuntimeStamp('失败时间'),
          })
        }
        if (event.event === 'result') {
          resolved = true
          finalizeChapterScriptRun(event.data.response, 'result')
          return
        }
        if (event.event === 'done' && !resolved) {
          resolved = true
          finalizeChapterScriptRun(null, 'done')
        }
      },
      onError: () => {
        if (resolved) return
        resolved = true
        finalizeChapterScriptRun(null, 'stream_error')
      },
    })
      .catch((error: unknown) => {
        if (resolved) return
        setChapterScriptState({
          status: 'error',
          message: error instanceof Error ? error.message : '章节剧本生成失败',
          ...buildRuntimeStamp('失败时间'),
        })
      })
  }, [currentFlowId, currentProject?.id, currentProject?.name, refreshSelectedBookArtifacts, selectedBookId, selectedChapterNo])

  const handleRequestChapterProduction = React.useCallback(() => {
    const projectId = String(currentProject?.id || '').trim()
    const projectName = String(currentProject?.name || '').trim()
    const flowId = String(currentFlowId || '').trim()
    const bookId = String(selectedBookId || '').trim()
    const chapterNo = typeof selectedChapterNo === 'number' ? selectedChapterNo : null
    if (!projectId || !flowId || !bookId || !chapterNo) {
      notifications.show({
        title: '缺少上下文',
        message: '当前项目、工作流或章节未就绪，无法发起章节资产生产。',
        color: 'red',
      })
      return
    }

    const sessionKey = buildEffectiveChatSessionKey({
      persistedBaseKey: `chapter-workspace-${bookId}-chapter-assets-${chapterNo}`,
      projectId,
      flowId,
      skillId: 'default',
      lane: 'general',
    })
    const styleRefs = Array.isArray(selectedBookIndex?.assets?.styleBible?.referenceImages)
      ? selectedBookIndex.assets.styleBible.referenceImages
      : []
    const roleAssetInputs = selectedBookRoleCards
      .map((item) => ({
        assetId: String(item.cardId || '').trim() || undefined,
        url: String(item.imageUrl || '').trim() || undefined,
        role: 'character' as const,
        name: item.roleName,
        note: String(item.stateDescription || '').trim() || '角色卡参考',
      }))
      .filter((item) => item.url)
      .slice(0, 8)
    const styleAssetInputs = styleRefs
      .map((url, index) => ({
        url: String(url || '').trim() || undefined,
        role: 'style' as const,
        name: `style-ref-${index + 1}`,
        note: '统一画风锚点',
      }))
      .filter((item) => item.url)
    const chapterVisualInputs = (Array.isArray(selectedBookIndex?.assets?.visualRefs) ? selectedBookIndex.assets.visualRefs : [])
      .map((item) => ({
        assetRefId: String(item.refId || '').trim() || undefined,
        url: String(item.imageUrl || '').trim() || undefined,
        role: item.category === 'spell_fx' ? 'prop' as const : 'scene' as const,
        name: item.name,
        note: String(item.stateDescription || '').trim() || '章节视觉参考',
      }))
      .filter((item) => item.url)
      .slice(0, 8)
    const tailFrameInput = storyboardProduction?.latestTailFrameUrl
      ? [{
          url: storyboardProduction.latestTailFrameUrl,
          role: 'context' as const,
          name: `chapter-${chapterNo}-tail-frame`,
          note: '上一组尾帧承接',
        }]
      : []
    const assetInputs = mergeWorkspaceAssetInputs([
      dedupeWorkspaceAssetInputs(tailFrameInput),
      dedupeWorkspaceAssetInputs(styleAssetInputs),
      dedupeWorkspaceAssetInputs(roleAssetInputs),
      dedupeWorkspaceAssetInputs(chapterVisualInputs),
    ])

    const prompt = [
      `基于第${chapterNo}章已有章节剧本，补齐当前章节的前置资产与分镜图片节点。`,
      '前提：必须优先读取当前章节已落盘的 storyboardPlans / shotPrompts；如果当前章节还没有可执行章节剧本，必须显式失败，并提示先生成当前章节剧本。',
      '要求：先补齐缺失角色卡、场景参考、核心道具参考，再生成当前章节所需的分镜图片节点。',
      '若本轮已通过 tapcanvas_flow_patch 把可执行图片节点真实写入当前画布，并保留 prompt、structuredPrompt、referenceImages / assetInputs 或上游边绑定，即可把本轮收口为“已写入待执行节点”；工作台会基于 executableNodeIds 自动执行这些节点。',
      '不要把“当前回合同步结果里尚未出现 imageUrl”误判成失败；真正禁止的是只写 metadata、只建空占位节点，或写出不可执行节点。',
      '禁止重写章节剧情，禁止把本轮目标退化成纯文本回复。',
    ].join('\n')

    setProductionRequestState({
      status: 'running',
      message: `正在补齐第 ${chapterNo} 章资产与分镜图片…`,
      ...buildRuntimeStamp('启动时间'),
    })

    let resolved = false
    void agentsChatStream({
      vendor: 'agents',
      prompt,
      sessionKey,
      bookId,
      chapterId: String(chapterNo),
      canvasProjectId: projectId,
      canvasFlowId: flowId,
      chatContext: {
        currentProjectName: projectName || '当前项目',
        workspaceAction: 'chapter_asset_generation',
        selectedReference: {
          bookId,
          chapterId: String(chapterNo),
        },
      },
      mode: 'auto',
      temperature: 0.7,
      stream: true,
      assetInputs,
    }, {
      onEvent: (event) => {
        if (event.event === 'tool') {
          const toolName = String(event.data?.toolName || 'tool').trim()
          setProductionRequestState({
            status: 'running',
            message: `正在补齐资产：${toolName}`,
            ...buildRuntimeStamp('最近更新'),
          })
          return
        }
        if (event.event === 'error') {
          resolved = true
          setProductionRequestState({
            status: 'error',
            message: String(event.data?.message || '章节资产生产失败').trim() || '章节资产生产失败',
            ...buildRuntimeStamp('失败时间'),
          })
        }
        if (event.event === 'result') {
          resolved = true
          const response = event.data.response
          setProductionRequestState({
            status: 'running',
            message: '章节资产请求已完成，正在校验画布与工作台回填。',
            ...buildRuntimeStamp('校验时间'),
          })
          void (async () => {
            try {
              const backendWroteCanvas = didBackendWriteCanvas(response)
              if (backendWroteCanvas) {
                const reloaded = await reloadCanvasFlowFromServer({
                  flowId,
                  expectedProjectId: projectId,
                  expectedFlowId: flowId,
                })
                const reloadAutoRunPlan = resolveAiChatReloadAutoRunPlan({
                  newNodeIds: reloaded.newNodeIds,
                  traceCanvasMutation: response.trace?.canvasMutation,
                  failedTurn: response.trace?.turnVerdict?.status === 'failed',
                })
                if (reloaded.reloaded) {
                  if (reloadAutoRunPlan.autoRunNewNodeIds.length > 0) {
                    autoRunAiChatCanvasNodes(reloadAutoRunPlan.autoRunNewNodeIds)
                  }
                  if (reloadAutoRunPlan.autoRunPatchedNodeIds.length > 0) {
                    autoRunAiChatPatchedCanvasNodes(reloadAutoRunPlan.autoRunPatchedNodeIds)
                  }
                }
              }
              await refreshSelectedBookArtifacts({ bookId, preserveSelectedChapter: true })
              syncLinkedNodeIdsFromCanvas()
              setProductionRequestState({
                status: 'success',
                message: backendWroteCanvas
                  ? '章节资产节点已写入画布，工作台会继续自动执行这些图片节点。'
                  : '章节资产请求完成，但未检测到后端画布写入；请检查执行日志。',
                ...buildRuntimeStamp('完成时间'),
              })
              setRefreshTick((current) => current + 1)
            } catch (error: unknown) {
              setProductionRequestState({
                status: 'error',
                message: error instanceof Error ? error.message : '章节资产回填校验失败',
                ...buildRuntimeStamp('失败时间'),
              })
            }
          })()
        }
      },
    })
      .catch((error: unknown) => {
        if (resolved) return
        setProductionRequestState({
          status: 'error',
          message: error instanceof Error ? error.message : '章节资产生产失败',
          ...buildRuntimeStamp('失败时间'),
        })
      })
  }, [currentFlowId, currentProject?.id, currentProject?.name, refreshSelectedBookArtifacts, selectedBookId, selectedBookIndex?.assets?.styleBible?.referenceImages, selectedBookIndex?.assets?.visualRefs, selectedBookRoleCards, selectedChapterNo, storyboardProduction?.latestTailFrameUrl, syncLinkedNodeIdsFromCanvas])

  const handleGenerateVideo = React.useCallback(async () => {
    const selectedShot = selectedResolvedShot
    const prompt = String(activeShotPrompt || '').trim()
    const selectedVideoOption = findWorkspaceModelOptionBySelectionKey(availableVideoModels, selectedVideoModel)
    const modelKey = typeof selectedVideoOption?.value === 'string' ? selectedVideoOption.value.trim() : ''
    const projectId = String(currentProject?.id || '').trim()
    const bookId = String(selectedBookId || '').trim()
    const chapterNo = typeof selectedChapterNo === 'number' ? selectedChapterNo : null
    if (!selectedShot) {
      notifications.show({
        title: '缺少片段',
        message: '请先选中一个片段，再生成视频。',
        color: 'red',
      })
      return
    }
    if (selectedShotVideoBlockedReason) {
      notifications.show({
        title: '前置条件未满足',
        message: selectedShotVideoBlockedReason,
        color: 'red',
      })
      return
    }
    if (!prompt) {
      notifications.show({
        title: '提示词为空',
        message: '当前片段提示词为空，无法生成视频。',
        color: 'red',
      })
      return
    }
    if (!modelKey) {
      notifications.show({
        title: '模型未就绪',
        message: '当前没有可用视频模型，请先检查模型配置。',
        color: 'red',
      })
      return
    }
    if (!projectId || !bookId || !chapterNo) {
      notifications.show({
        title: '缺少上下文',
        message: '当前项目或章节未就绪，无法把视频结果写回工作台。',
        color: 'red',
      })
      return
    }
    const requestedVideoModel = readWorkspaceRequestedModel(selectedVideoOption)
      || getModelOptionRequestAlias(availableVideoModels, modelKey)
    const vendor = typeof selectedVideoOption?.vendor === 'string' ? selectedVideoOption.vendor.trim() : ''
    if (!vendor) {
      notifications.show({
        title: '模型配置异常',
        message: '所选模型缺少 vendor，无法直接执行视频生成。',
        color: 'red',
      })
      return
    }
    if (!requestedVideoModel) {
      notifications.show({
        title: '模型配置异常',
        message: '所选视频模型缺少可执行标识，无法直接执行视频生成。',
        color: 'red',
      })
      return
    }
    const resolvedReferences = resolveShotWorkspaceReferences({
      shot: selectedShot,
      assetItems: chapterAssetItems,
      promptText: prompt,
    })
    const generatedReferenceUrls: string[] = []
    const generatedAnchorUrls: string[] = []
    if (resolvedReferences.missingAssetIds.length > 0) {
      setVideoRuntimeByShotId((current) => ({
        ...current,
        [selectedShot.id]: {
          status: 'running',
          message: `片段 ${selectedShot.shotCode} 正在补齐缺失参考资产…`,
          ...buildRuntimeStamp('启动时间'),
        },
      }))
      for (const missingAssetId of resolvedReferences.missingAssetIds) {
        const generatedUrl = String(await generateWorkspaceAssetById(missingAssetId)).trim()
        if (generatedUrl) {
          const targetAsset = chapterAssetItems.find((item) => item.id === missingAssetId) || null
          if (targetAsset?.generationTarget?.kind === 'roleCard') {
            generatedAnchorUrls.push(generatedUrl)
          } else {
            generatedReferenceUrls.push(generatedUrl)
          }
        }
      }
    }
    const finalReferenceImageUrls = dedupeTrimmedUrls([
      ...resolvedReferences.referenceImageUrls,
      ...generatedReferenceUrls,
    ]).filter((url) => !isLikelyVideoUrl(url))
    const finalAnchorImageUrls = dedupeTrimmedUrls([
      ...resolvedReferences.anchorImageUrls,
      ...generatedAnchorUrls,
    ]).filter((url) => !isLikelyVideoUrl(url))
    const firstFrameUrl = pickWorkspaceFirstFrameImageUrl({
      previewImageUrl: selectedShot.previewImageUrl,
      referenceImageUrls: finalReferenceImageUrls,
      anchorImageUrls: finalAnchorImageUrls,
    })
    if (!firstFrameUrl && finalReferenceImageUrls.length <= 0 && finalAnchorImageUrls.length <= 0) {
      setVideoRuntimeByShotId((current) => ({
        ...current,
        [selectedShot.id]: {
          status: 'error',
          message: '当前片段缺少真实参考图，且自动补资产失败，无法生成视频',
          ...buildRuntimeStamp('失败时间'),
        },
      }))
      return
    }

    setVideoRuntimeByShotId((current) => ({
      ...current,
      [selectedShot.id]: {
        status: 'running',
        message: `正在生成片段 ${selectedShot.shotCode} 视频…`,
        ...buildRuntimeStamp('启动时间'),
      },
    }))

    try {
      const sourceEntityKey = getNanoComicEntityKey('video_segment', selectedShot.id)
      const nodeLabel = `${selectedShot.shotCode} 视频`
      const referenceSourceNodeIds = collectWorkspaceReferenceSourceNodeIds({
        nodes: useRFStore.getState().nodes,
        projectId,
        referenceUrls: [
          firstFrameUrl,
          ...finalReferenceImageUrls,
          ...finalAnchorImageUrls,
        ],
      })
      const nodeConfig: Record<string, unknown> = {
        kind: 'video',
        prompt,
        videoModel: requestedVideoModel,
        videoModelVendor: vendor,
        sourceProjectId: projectId,
        sourceBookId: bookId,
        chapter: chapterNo,
        materialChapter: chapterNo,
        sourceEntityKey,
        sourceShotId: selectedShot.id,
        sourceShotCode: selectedShot.shotCode,
        sourceShotNo: selectedShot.shotNo,
        sourceSceneCode: selectedShot.sceneCode,
        sourceLocationName: selectedShot.locationName,
        durationSeconds: videoDurationSeconds,
        videoDurationSeconds,
        ...(firstFrameUrl ? { firstFrameUrl } : null),
        ...(finalReferenceImageUrls.length > 0 ? { referenceImages: finalReferenceImageUrls } : null),
        upstreamReferenceOrder: referenceSourceNodeIds,
        ...(finalAnchorImageUrls.length > 0
          ? {
              assetInputs: finalAnchorImageUrls.map((url, index) => ({
                url,
                role: 'character',
                name: `${selectedShot.shotCode}-anchor-${index + 1}`,
              })),
            }
          : null),
      }
      const liveNodes = useRFStore.getState().nodes
      const existingNodeId = linkedNodeIdsByEntityKey[sourceEntityKey]
        || findMatchingWorkspaceVideoNodeId({
          nodes: liveNodes,
          projectId,
          chapterNo,
          sourceEntityKey,
        })
      let nodeId = ''
      if (existingNodeId) {
        const updateResult = await CanvasService.updateNode({
          nodeId: existingNodeId,
          label: nodeLabel,
          config: nodeConfig,
        })
        if (!updateResult.success) {
          throw new Error(updateResult.error)
        }
        nodeId = existingNodeId
      } else {
        const createResult = await CanvasService.createNode({
          type: 'taskNode',
          label: nodeLabel,
          config: nodeConfig,
        })
        if (!createResult.success) {
          throw new Error(createResult.error)
        }
        nodeId = typeof createResult.data?.nodeId === 'string' ? createResult.data.nodeId.trim() : ''
      }
      if (!nodeId) {
        throw new Error('工作台已创建视频节点，但未返回 nodeId')
      }
      await syncWorkspaceVideoReferenceEdges({
        projectId,
        targetNodeId: nodeId,
        sourceNodeIds: referenceSourceNodeIds,
      })
      setVideoRuntimeByShotId((current) => ({
        ...current,
        [selectedShot.id]: {
          status: 'running',
          message: `片段 ${selectedShot.shotCode} 视频节点已创建，正在执行…`,
          updatedAtLabel: `节点：${nodeId}`,
          updatedAtMs: Date.now(),
        },
      }))
      const runResult = await CanvasService.runNode({ nodeId })
      if (!runResult.success) {
        throw new Error(runResult.error)
      }
      const latestNode = useRFStore.getState().nodes.find((node) => String(node.id || '').trim() === nodeId)
      const preview = readVideoPreviewFromNodeData(latestNode)
      const latestData = latestNode?.data && typeof latestNode.data === 'object' && !Array.isArray(latestNode.data)
        ? latestNode.data as Record<string, unknown>
        : null
      const taskId = latestData && typeof latestData.taskId === 'string' ? latestData.taskId.trim() : ''
      syncLinkedNodeIdsFromCanvas()
      setRefreshTick((current) => current + 1)
      setVideoRuntimeByShotId((current) => ({
        ...current,
        [selectedShot.id]: {
          status: 'success',
          message: `片段 ${selectedShot.shotCode} 视频已生成并写回画布`,
          ...buildRuntimeStamp('完成时间'),
          ...(taskId ? { taskId } : {}),
          ...preview,
        },
      }))
    } catch (error: unknown) {
      setVideoRuntimeByShotId((current) => ({
        ...current,
        [selectedShot.id]: {
          ...(current[selectedShot.id] || { status: 'error', message: '', updatedAtLabel: '', updatedAtMs: 0 }),
          status: 'error',
          message: error instanceof Error ? error.message : '视频生成失败',
          ...buildRuntimeStamp('失败时间'),
        },
      }))
    }
  }, [activeShotPrompt, availableVideoModels, chapterAssetItems, currentProject?.id, generateWorkspaceAssetById, linkedNodeIdsByEntityKey, selectedBookId, selectedChapterNo, selectedResolvedShot, selectedShotVideoBlockedReason, selectedVideoModel, syncLinkedNodeIdsFromCanvas, videoDurationSeconds])

  const handleAssistShotPrompt = React.useCallback(() => {
    void handleGenerateChapterScript()
  }, [handleGenerateChapterScript])

  const handleHeaderGenerateAssets = React.useCallback(() => {
    if (chapterScriptState.status === 'running' || productionRequestState.status === 'running') return
    if (hasCurrentChapterStoryboardPlan) {
      handleRequestChapterProduction()
      return
    }
    handleGenerateChapterScript()
  }, [
    chapterScriptState.status,
    handleGenerateChapterScript,
    handleRequestChapterProduction,
    hasCurrentChapterStoryboardPlan,
    productionRequestState.status,
  ])

  if (!mounted) return null

  return (
    <Modal
      className="nano-comic-workspace__modal"
      classNames={{
        content: 'nano-comic-workspace__modal-content',
        body: 'nano-comic-workspace__modal-body',
        header: 'nano-comic-workspace__modal-header',
        overlay: 'nano-comic-workspace__modal-overlay',
      }}
      opened={mounted}
      onClose={handleClose}
      fullScreen
      withCloseButton={false}
      trapFocus={false}
      title={null}
      overlayProps={{ opacity: 0.28, blur: 3 }}
      withinPortal
      zIndex={360}
    >
      <div className="nano-comic-workspace" data-ux-panel>
        <div className="nano-comic-workspace__shell">
        {currentProject ? (
          <Stack className="nano-comic-workspace__stack" gap="md">
            <div className="nano-comic-workspace__toolbar">
              <Group className="nano-comic-workspace__toolbar-actions" gap="xs">
                <Select
                  className="nano-comic-workspace__toolbar-select"
                  placeholder="选择章节"
                  data={chapterOptions}
                  value={selectedChapter}
                  onChange={(value) => setSelectedChapter(typeof value === 'string' ? value : '')}
                  disabled={chapterOptions.length === 0}
                  clearable={false}
                  comboboxProps={{ withinPortal: true, zIndex: 9000 }}
                />
                <Select
                  className="nano-comic-workspace__toolbar-select"
                  searchable
                  placeholder={imageModelLoading ? '加载生图模型…' : '选择生图模型'}
                  data={imageModelOptions}
                  value={selectedImageModel}
                  onChange={(value) => setSelectedImageModel(typeof value === 'string' ? value : '')}
                  disabled={imageModelLoading || imageModelOptions.length === 0}
                  clearable={false}
                  comboboxProps={{ withinPortal: true, zIndex: 9000 }}
                />
                {workspaceLoading ? (
                  <Loader className="nano-comic-workspace__toolbar-loader" size="sm" />
                ) : null}
                {workspaceView === 'storyboardImage' ? (
                  <>
                    <Button
                      className="nano-comic-workspace__header-action"
                      leftSection={<IconBrain className="nano-comic-workspace__header-action-icon" size={14} />}
                      radius="sm"
                      variant="light"
                      onClick={handleAssistShotPrompt}
                      loading={chapterScriptState.status === 'running'}
                      disabled={chapterScriptState.status === 'running'}
                    >
                      生成章节剧本
                    </Button>
                    <Button
                      className="nano-comic-workspace__header-action"
                      leftSection={<IconLayoutGrid className="nano-comic-workspace__header-action-icon" size={14} />}
                      radius="sm"
                      variant="light"
                      onClick={handleHeaderGenerateAssets}
                      loading={chapterScriptState.status === 'running' || productionRequestState.status === 'running'}
                    >
                      生成分镜资产
                    </Button>
                  </>
                ) : (
                  <Group gap={0} wrap="nowrap">
                    <Tooltip
                      className="nano-comic-workspace__header-action-tooltip"
                      label={selectedShotVideoBlockedReason || '基于当前镜头结果生成视频'}
                      disabled={!selectedShotVideoBlockedReason}
                      withArrow
                    >
                      <Button
                        className="nano-comic-workspace__header-action"
                        leftSection={<IconVideo className="nano-comic-workspace__header-action-icon" size={14} />}
                        radius="sm"
                        variant="light"
                        loading={selectedShotVideoRuntime?.status === 'running'}
                        disabled={Boolean(selectedShotVideoBlockedReason)}
                        onClick={handleGenerateVideo}
                      >
                        生成视频
                      </Button>
                    </Tooltip>
                    <Menu shadow="md" width={280} position="bottom-end" withinPortal zIndex={9000}>
                      <Menu.Target>
                        <ActionIcon
                          className="nano-comic-workspace__header-action nano-comic-workspace__header-action--split"
                          radius="sm"
                          variant="light"
                          aria-label="视频生成参数"
                        >
                          <IconChevronDown className="nano-comic-workspace__header-action-icon" size={14} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <div className="nano-comic-workspace__video-menu">
                          <Text className="nano-comic-workspace__video-menu-label" size="xs">模型</Text>
                          <Select
                            className="nano-comic-workspace__video-menu-select"
                            searchable
                            placeholder={videoModelLoading ? '加载中…' : '选择视频模型'}
                            data={videoModelOptions}
                            value={selectedVideoModel}
                            onChange={(value) => setSelectedVideoModel(typeof value === 'string' ? value : '')}
                            disabled={videoModelLoading || videoModelOptions.length === 0}
                            clearable={false}
                            comboboxProps={{ withinPortal: true, zIndex: 9000 }}
                          />
                          {videoModelLoading ? (
                            <Text className="nano-comic-workspace__video-menu-hint" size="xs" c="dimmed">
                              正在加载视频模型…
                            </Text>
                          ) : videoModelOptions.length <= 0 ? (
                            <Text className="nano-comic-workspace__video-menu-hint" size="xs" c="red">
                              当前没有可用视频模型。请先在系统模型管理中启用 `video` 模型。
                            </Text>
                          ) : !selectedVideoModel ? (
                            <Text className="nano-comic-workspace__video-menu-hint" size="xs" c="dimmed">
                              先选择一个视频模型，生成按钮才会解锁。
                            </Text>
                          ) : null}
                          <Text className="nano-comic-workspace__video-menu-label" size="xs">时长</Text>
                          <NumberInput
                            className="nano-comic-workspace__video-menu-number"
                            min={1}
                            max={15}
                            value={videoDurationSeconds}
                            onChange={(value) => setVideoDurationSeconds(Math.max(1, Math.min(15, Math.trunc(Number(value || 10)))))}
                            suffix="s"
                          />
                        </div>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                )}
                <ActionIcon className="nano-comic-workspace__toolbar-icon" radius="sm" variant="default" aria-label="刷新工作台" onClick={handleRefreshWorkspace}>
                  <IconRefresh className="nano-comic-workspace__toolbar-icon-svg" size={15} />
                </ActionIcon>
                <ActionIcon
                  className="nano-comic-workspace__close"
                  radius="sm"
                  variant="default"
                  aria-label="关闭漫剧工作台"
                  onClick={handleClose}
                >
                  <IconX className="nano-comic-workspace__close-icon" size={16} />
                </ActionIcon>
              </Group>
            </div>

            {workspaceError ? (
              <PanelCard className="nano-comic-workspace__error" padding="compact">
                <Text className="nano-comic-workspace__error-text" size="sm">
                  {workspaceError}
                </Text>
              </PanelCard>
            ) : null}

            <div className="nano-comic-workspace__content">
              <Tabs
                className="nano-comic-workspace__tabs"
                value={workspaceView}
                onChange={(value) => setWorkspaceView(value === 'videoGeneration' ? 'videoGeneration' : 'storyboardImage')}
              >
                <Tabs.List className="nano-comic-workspace__tabs-list">
                  <Tabs.Tab className="nano-comic-workspace__tab" value="storyboardImage">分镜图片</Tabs.Tab>
                  <Tabs.Tab className="nano-comic-workspace__tab" value="videoGeneration">视频生成</Tabs.Tab>
                </Tabs.List>
              </Tabs>
              <input
                className="nano-comic-workspace__text-upload-input"
                ref={workspaceTextUploadInputRef}
                type="file"
                accept=".txt,.md,.markdown,.json,.csv,.tsv,.doc,.docx"
                hidden
                onChange={handleWorkspaceTextUploadInputChange}
              />
              <input
                className="nano-comic-workspace__style-upload-input"
                ref={workspaceStyleReferenceUploadInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleWorkspaceStyleReferenceUploadInputChange}
              />
              {workspaceView === 'storyboardImage' ? (
                <div className="nano-comic-workspace__chapter-view">
                  {workspaceChecklistItems.length > 0 ? (
                    <PanelCard className="nano-comic-workspace__checklist" padding="compact">
                      <Stack className="nano-comic-workspace__checklist-stack" gap="xs">
                        <div className="nano-comic-workspace__checklist-copy">
                          <Title className="nano-comic-workspace__checklist-title" order={5}>
                            进入工作台前的检查清单
                          </Title>
                          <Text className="nano-comic-workspace__checklist-subtitle" size="xs" c="dimmed">
                            只显示真正会阻塞当前工作流的前置条件，并提供直接跳转入口。
                          </Text>
                        </div>
                        <Stack className="nano-comic-workspace__checklist-items" gap="xs">
                          {workspaceChecklistItems.map((item) => (
                            <InlinePanel
                              className="nano-comic-workspace__checklist-item"
                              key={item.key}
                            >
                              <Group className="nano-comic-workspace__checklist-item-row" justify="space-between" align="flex-start" wrap="nowrap">
                                <div className="nano-comic-workspace__checklist-item-copy">
                                  <Text className="nano-comic-workspace__checklist-item-title" size="sm" fw={600}>
                                    待处理 · {item.title}
                                  </Text>
                                  <Text className="nano-comic-workspace__checklist-item-detail" size="xs" c="dimmed">
                                    {item.detail}
                                  </Text>
                                </div>
                                {item.actionLabel && item.action ? (
                                  <Button
                                    className="nano-comic-workspace__checklist-item-action"
                                    size="xs"
                                    variant="light"
                                    loading={item.actionLoading}
                                    onClick={item.action}
                                  >
                                    {item.actionLabel}
                                  </Button>
                                ) : null}
                              </Group>
                            </InlinePanel>
                          ))}
                        </Stack>
                      </Stack>
                    </PanelCard>
                  ) : null}

                  <div className="nano-comic-workspace__chapter-view-grid">
                    <PanelCard className="nano-comic-workspace__chapter-panel">
                      <Stack gap="sm">
                        <Group justify="space-between" align="flex-start">
                          <div>
                            <Title order={4}>章节文本窗口</Title>
                            <Text size="xs" c="dimmed">当前章节的正文、摘要和冲突会直接决定后续镜头板质量。</Text>
                          </div>
                          <Text className="nano-comic-workspace__section-badge" size="xs" fw={700}>
                            {selectedChapterMetadataComplete ? '已就绪' : '待补齐'}
                          </Text>
                        </Group>
                        <InlinePanel className="nano-comic-workspace__chapter-panel-block">
                          <Text size="xs" c="dimmed">章节摘要</Text>
                          <Text size="sm" mt={4}>
                            {selectedChapterDetail?.summary || selectedChapterMeta?.summary || selectedChapterDetail?.coreConflict || '当前章节还没有稳定摘要，建议先生成章节剧本。'}
                          </Text>
                        </InlinePanel>
                        <InlinePanel className="nano-comic-workspace__chapter-panel-block">
                          <Text size="xs" c="dimmed">正文窗口</Text>
                          <Text size="sm" mt={4}>
                            {String(selectedChapterDetail?.content || '').trim()
                              ? `${String(selectedChapterDetail?.content || '').trim().slice(0, 220)}${String(selectedChapterDetail?.content || '').trim().length > 220 ? '…' : ''}`
                              : '当前章节正文窗口还未读到可执行文本。'}
                          </Text>
                        </InlinePanel>
                      </Stack>
                    </PanelCard>

                    <PanelCard className="nano-comic-workspace__chapter-panel">
                      <Stack gap="sm">
                        <Group justify="space-between" align="flex-start">
                          <div>
                            <Title order={4}>章节线索</Title>
                            <Text size="xs" c="dimmed">这里看的是本章真正可复用的角色、场景、道具和地点线索。</Text>
                          </div>
                          <Text className="nano-comic-workspace__section-badge" size="xs" fw={700}>
                            {selectedChapterCharacterCount + selectedChapterSceneCount + selectedChapterPropCount}
                          </Text>
                        </Group>
                        <div className="nano-comic-workspace__chapter-metrics">
                          <InlinePanel className="nano-comic-workspace__chapter-metric"><Text size="xs" c="dimmed">角色</Text><Text size="sm" fw={700} mt={4}>{selectedChapterCharacterCount}</Text></InlinePanel>
                          <InlinePanel className="nano-comic-workspace__chapter-metric"><Text size="xs" c="dimmed">场景</Text><Text size="sm" fw={700} mt={4}>{selectedChapterSceneCount}</Text></InlinePanel>
                          <InlinePanel className="nano-comic-workspace__chapter-metric"><Text size="xs" c="dimmed">道具</Text><Text size="sm" fw={700} mt={4}>{selectedChapterPropCount}</Text></InlinePanel>
                          <InlinePanel className="nano-comic-workspace__chapter-metric"><Text size="xs" c="dimmed">地点</Text><Text size="sm" fw={700} mt={4}>{selectedChapterLocationCount}</Text></InlinePanel>
                        </div>
                        <InlinePanel className="nano-comic-workspace__chapter-panel-block">
                          <Text size="xs" c="dimmed">连续性准备度</Text>
                          <Text size="sm" mt={4}>
                            {selectedChapterMetadataComplete
                              ? `角色锚点 ${currentChapterRoleAnchorCount} 个，风格参考 ${selectedStyleReferenceImages.length} 组，可直接继续本章分镜生产。`
                              : '当前章节上下文还没完全锁住，继续大批量出图会放大漂移。'}
                          </Text>
                        </InlinePanel>
                      </Stack>
                    </PanelCard>
                  </div>

                  <PanelCard className="nano-comic-workspace__storyboard-stage" padding="comfortable">
                    <Stack className="nano-comic-workspace__storyboard-stage-stack" gap="sm">
                      <Group className="nano-comic-workspace__storyboard-stage-header" justify="space-between" align="flex-start">
                        <div className="nano-comic-workspace__storyboard-stage-copy">
                          <Title className="nano-comic-workspace__storyboard-stage-title" order={4}>
                            镜头板工作区
                          </Title>
                          <Text className="nano-comic-workspace__storyboard-stage-subtitle" size="xs" c="dimmed">
                            上面的章节上下文确认完，再在这里逐镜头看脚本、改提示词、出图并回写画布。
                          </Text>
                        </div>
                        <Text className="nano-comic-workspace__section-badge" size="xs" fw={700}>
                          Shot Board
                        </Text>
                      </Group>

                      <div className="nano-comic-workspace__storyboard-stage-body" ref={storyboardImageSectionRef}>
                        <NanoComicStoryboardTab
                          shots={storyboardImageShots}
                          selectedShotId={selectedShotId}
                          onSelectShot={setSelectedShotId}
                          onPromptChange={({ shotId, prompt }) => {
                            if (shotId !== selectedShotId) return
                            setActiveShotPrompt(prompt)
                          }}
                          onGenerateChapterScript={handleAssistShotPrompt}
                          chapterScriptState={chapterScriptState}
                          promptOverrides={promptOverrideByShotId}
                          onLocateInCanvas={handleLocateInCanvas}
                          onGenerateAsset={handleGenerateWorkspaceAsset}
                          linkedEntityKeys={linkedEntityKeys}
                          emptyStateMessage={emptyStateMessage}
                          assetItems={chapterAssetItems.map((item) => ({
                            ...item,
                            isGenerating: generatingAssetIds.has(item.id),
                          }))}
                        />
                      </div>
                    </Stack>
                  </PanelCard>
                </div>
              ) : (
                <NanoComicVideoGenerationTab
                  shots={resolvedStoryboardShots}
                  selectedShotId={selectedShotId}
                  onSelectShot={setSelectedShotId}
                  onPromptChange={({ shotId, prompt }) => {
                    if (shotId !== selectedShotId) return
                    setActiveShotPrompt(prompt)
                  }}
                  onGenerateChapterScript={handleAssistShotPrompt}
                  chapterScriptState={chapterScriptState}
                  promptOverrides={promptOverrideByShotId}
                  onLocateInCanvas={handleLocateInCanvas}
                  onGenerateAsset={handleGenerateWorkspaceAsset}
                  linkedEntityKeys={linkedEntityKeys}
                  emptyStateMessage={emptyStateMessage}
                  assetItems={chapterAssetItems.map((item) => ({
                    ...item,
                    isGenerating: generatingAssetIds.has(item.id),
                  }))}
                  videoPreviewByShotId={videoPreviewByShotId}
                  selectedShotVideoBlockedReason={selectedShotVideoBlockedReason}
                />
              )}
            </div>
          </Stack>
        ) : (
          <PanelCard className="nano-comic-workspace__empty" padding="comfortable">
            <Stack className="nano-comic-workspace__empty-stack" gap="md" align="flex-start">
              <Title className="nano-comic-workspace__empty-title" order={3}>
                还没有选中项目
              </Title>
              <Text className="nano-comic-workspace__empty-text" size="sm" c="dimmed">
                先去项目列表选择一个 `currentProject`，再回到当前页打开漫剧工作台。
              </Text>
              <Button
                className="nano-comic-workspace__empty-action"
                radius="sm"
                onClick={() => {
                  setActivePanel(null)
                  spaNavigate('/projects')
                }}
              >
                前往项目列表
              </Button>
            </Stack>
          </PanelCard>
        )}
        </div>
      </div>
    </Modal>
  )
}
