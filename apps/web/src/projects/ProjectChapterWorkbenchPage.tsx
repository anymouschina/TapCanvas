import React from 'react'
import type { Edge, Node } from '@xyflow/react'
import { ActionIcon, AppShell, Badge, Box, Button, Card, Checkbox, Divider, FileInput, Group, Loader, Modal, Paper, ScrollArea, Select, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from '@mantine/core'
import { IconArrowLeft, IconChevronRight, IconFilePlus, IconHelpCircle, IconPhoto, IconPlayerPlay, IconPlus, IconRefresh, IconSearch, IconTrash, IconArrowUp, IconArrowDown, IconVectorBezier2 } from '@tabler/icons-react'
import GithubGate from '../auth/GithubGate'
import { useAuth } from '../auth/store'
import { createChapterShot, createMaterialAsset, createMaterialVersion, createProjectChapter, createServerAsset, deleteChapter, deleteChapterShot, fetchPublicTaskResultWithAuth, getChapterWorkbench, getProjectBookChapter, getProjectDefaultEntry, getProjectBookIndex, listChapterFlows, listImpactedShots, listMaterialAssets, listMaterialVersions, listProjectBooks, listProjectChapters, listServerAssets, listShotFlows, listShotMaterialRefs, moveChapterShot, runPublicTaskWithAuth, saveChapterFlow, saveShotFlow, updateChapter, updateChapterShot, updateServerAssetData, upsertShotMaterialRefs, type ChapterDto, type ChapterWorkbenchDto, type FlowDto, type MaterialAssetDto, type MaterialImpactResponseDto, type MaterialAssetVersionDto, type MaterialShotRefDto, type ProjectBookIndexDto, type ProjectBookListItemDto, type ServerAssetDto, type TaskAssetDto } from '../api/server'
import { agentsChat } from '../api/server'
import { buildProjectChapterUrl, buildProjectDirectoryUrl, buildProjectUrl, buildStudioUrl } from '../utils/appRoutes'
import { navigateBackOr, spaNavigate } from '../utils/spaNavigate'
import { pickCurrentProjectTextAsset, uploadProjectText } from '../ui/projectTextUpload'
import { toast } from '../ui/toast'
import { FeatureTour, type FeatureTourStep } from '../ui/tour/FeatureTour'
import { PanelCard } from '../ui/PanelCard'
import { InlinePanel } from '../ui/InlinePanel'
import CanvasEntryButton from '../ui/CanvasEntryButton'
import ProjectAssetsViewer from './ProjectAssetsViewer'
import ProjectArtStylePresetPicker from './ProjectArtStylePresetPicker'
import { ensureProjectHasAutoBoundFirstChapter, syncProjectChaptersFromPrimaryBook } from './projectChapterBootstrap'
import { DEFAULT_PROJECT_SETUP_PROFILE, getProjectSetupProfile, type ProjectSetupProfile, upsertProjectSetupProfile } from './projectSetupProfile'
import {
  PROJECT_DIRECTOR_MANUAL_PRESETS,
  applyArtStylePresetToProfile,
  applyDirectorManualPresetToProfile,
  getArtStylePresetById,
  getDirectorManualPresetById,
} from './projectPresetLibrary'
import {
  buildChapterBaseSceneAnchorName,
  buildChapterBaseSceneAnchorPrompt,
  PROJECT_SHOT_RENDER_ASSET_KIND,
  buildLocalDemoShotRenderAssets,
  buildDefaultShotPrompt,
  buildShotRenderAssetName,
  normalizeChapterBaseSceneAnchorVersionData,
  normalizeProjectShotRenderAssetData,
  pickShotRenderAsset,
  toShotRenderAssetPayload,
  type ChapterBaseSceneAnchorVersionData,
  type ProjectShotRenderAssetData,
} from './projectShotRender'
import { buildStoryboardProductionSummary } from '../ui/nanoComic/storyboardProduction'

type ProjectChapterWorkbenchLoadError = {
  message: string
  status: number | null
  code: string | null
}

const EMPTY_WORKBENCH_STATS: ChapterWorkbenchDto['stats'] = {
  totalShots: 0,
  generatedShots: 0,
  reviewShots: 0,
  reworkShots: 0,
}

function buildChapterHandoffStorageKey(projectId: string): string {
  return `tapcanvas:chapter-handoff:${projectId}`
}

function parseChapterRoute(): { projectId: string; chapterId?: string; shotId?: string } | null {
  if (typeof window === 'undefined') return null
  const path = window.location.pathname || ''
  const shotMatch = path.match(/^\/projects\/([^/]+)\/chapters\/([^/]+)\/shots\/([^/]+)\/?$/)
  if (shotMatch) {
    return {
      projectId: decodeURIComponent(shotMatch[1]),
      chapterId: decodeURIComponent(shotMatch[2]),
      shotId: decodeURIComponent(shotMatch[3]),
    }
  }
  const chapterMatch = path.match(/^\/projects\/([^/]+)\/chapters\/([^/]+)\/?$/)
  if (chapterMatch) {
    return {
      projectId: decodeURIComponent(chapterMatch[1]),
      chapterId: decodeURIComponent(chapterMatch[2]),
    }
  }
  return null
}

function formatChapterProductionStatus(status: string): string {
  if (status === 'planning') return '策划中'
  if (status === 'producing') return '生产中'
  if (status === 'review') return '待审阅'
  if (status === 'approved') return '已确认'
  if (status === 'locked') return '已锁定'
  if (status === 'archived') return '已归档'
  return '草稿'
}

function getChapterProductionStatusTone(status: string): 'gray' | 'blue' | 'yellow' | 'green' {
  if (status === 'producing') return 'blue'
  if (status === 'review') return 'yellow'
  if (status === 'approved' || status === 'locked' || status === 'archived') return 'green'
  return 'gray'
}

function formatShotProductionStatus(status: string): string {
  if (status === 'running') return '生成中'
  if (status === 'succeeded') return '可审阅'
  if (status === 'failed') return '待返工'
  return '待处理'
}

function getShotProductionStatusTone(status: string): 'gray' | 'blue' | 'green' | 'red' {
  if (status === 'running') return 'blue'
  if (status === 'succeeded') return 'green'
  if (status === 'failed') return 'red'
  return 'gray'
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

type FlowLaunchEvidence = {
  timestamp: string
  projectId: string
  ownerType: 'chapter' | 'shot'
  ownerId: string
  flowId: string
  mode: 'existing' | 'starter_created'
}

function recordFlowLaunchEvidence(input: FlowLaunchEvidence): void {
  if (typeof window === 'undefined') return
  try {
    const storageKey = `tapcanvas:flow-launch:${input.projectId}:${input.ownerType}:${input.ownerId}`
    const raw = window.sessionStorage.getItem(storageKey)
    let previous: FlowLaunchEvidence[] = []
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        previous = parsed as FlowLaunchEvidence[]
      }
    }
    const next = [input, ...previous].slice(0, 20)
    window.sessionStorage.setItem(storageKey, JSON.stringify(next))
  } catch {
    // ignore evidence persistence failures
  }
}

function readErrorCode(error: unknown): string {
  if (typeof error === 'object' && error && 'code' in error && typeof error.code === 'string') {
    return error.code.trim()
  }
  return ''
}

function isTransientFetchFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = String(error.message || '').trim().toLowerCase()
  return message === 'failed to fetch' || message.includes('networkerror') || message.includes('load failed')
}

function isLocalRuntimeHost(): boolean {
  if (typeof window === 'undefined') return false
  const host = String(window.location.hostname || '').trim().toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0'
}

function canUseLocalDemoShotFallback(error: unknown): boolean {
  return isLocalRuntimeHost() && readErrorCode(error) === 'team_insufficient_credits'
}

function hasFlowCanvasContent(flow: FlowDto | null | undefined): boolean {
  if (!flow || !flow.data) return false
  return (Array.isArray(flow.data.nodes) && flow.data.nodes.length > 0)
    || (Array.isArray(flow.data.edges) && flow.data.edges.length > 0)
}

function pickPreferredFlow(flows: FlowDto[]): FlowDto | null {
  if (!Array.isArray(flows) || flows.length === 0) return null
  const prioritized = [...flows].sort((left, right) => {
    const leftHasContent = hasFlowCanvasContent(left) ? 1 : 0
    const rightHasContent = hasFlowCanvasContent(right) ? 1 : 0
    if (leftHasContent !== rightHasContent) return rightHasContent - leftHasContent
    const leftTs = Date.parse(String(left.updatedAt || left.createdAt || ''))
    const rightTs = Date.parse(String(right.updatedAt || right.createdAt || ''))
    return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0)
  })
  return prioritized[0] || null
}

function createFlowTaskNode(input: {
  id: string
  x: number
  y: number
  label: string
  kind: 'text' | 'image' | 'storyboard'
  prompt: string
  width?: number
}): Node {
  return {
    id: input.id,
    type: 'taskNode',
    position: { x: input.x, y: input.y },
    data: {
      label: input.label,
      kind: input.kind,
      prompt: input.prompt,
      ...(typeof input.width === 'number' ? { nodeWidth: input.width } : null),
      ...(input.kind === 'image' ? { aspectRatio: '16:9' } : null),
      ...(input.kind === 'storyboard' ? { videoOrientation: 'landscape', videoDurationSeconds: 5 } : null),
    },
  }
}

function createFlowEdge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
    type: 'typed',
    animated: true,
  }
}

function pickSettledValue<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
): T {
  return result.status === 'fulfilled' ? result.value : fallback
}

function toWorkbenchLoadError(error: unknown, fallback: string): ProjectChapterWorkbenchLoadError {
  const message = describeError(error, fallback)
  const status =
    typeof error === 'object' && error && 'status' in error && typeof error.status === 'number'
      ? error.status
      : null
  const code =
    typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null
  return {
    message,
    status,
    code,
  }
}

function formatMoment(value?: string | null): string {
  const text = String(value || '').trim()
  if (!text) return '未记录'
  const ts = Date.parse(text)
  if (!Number.isFinite(ts)) return text
  return new Date(ts).toLocaleString()
}

function normalizeMatchText(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/第\s*\d+\s*章/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function scoreSourceChapterCandidate(input: {
  chapterTitle: string
  chapterSummary: string
  sourceTitle: string
  sourceSummary: string
  sourceChapter: number
}): number {
  const chapterTitle = normalizeMatchText(input.chapterTitle)
  const chapterSummary = normalizeMatchText(input.chapterSummary)
  const sourceTitle = normalizeMatchText(input.sourceTitle)
  const sourceSummary = normalizeMatchText(input.sourceSummary)
  let score = 0
  if (chapterTitle && sourceTitle && chapterTitle === sourceTitle) score += 100
  if (chapterTitle && sourceTitle && (chapterTitle.includes(sourceTitle) || sourceTitle.includes(chapterTitle))) score += 45
  if (chapterSummary && sourceSummary) {
    const token = chapterSummary.slice(0, 16)
    if (token && sourceSummary.includes(token)) score += 18
  }
  const explicitNo = (() => {
    const match = String(input.chapterTitle || '').match(/第\s*(\d+)\s*章/)
    const value = match ? Number.parseInt(match[1], 10) : NaN
    return Number.isFinite(value) ? value : null
  })()
  if (explicitNo && explicitNo === input.sourceChapter) score += 60
  return score
}

function normalizeAssetName(value: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function readMaterialVersionMeta(version?: MaterialAssetVersionDto | null): {
  chapterId: string
  sourceBookChapter: number | null
} {
  const data =
    version && typeof version.data === 'object' && version.data && !Array.isArray(version.data)
      ? version.data as Record<string, unknown>
      : {}
  const chapterId = typeof data.chapterId === 'string' ? data.chapterId.trim() : ''
  const sourceBookChapter =
    typeof data.sourceBookChapter === 'number' && Number.isFinite(data.sourceBookChapter)
      ? data.sourceBookChapter
      : null
  return { chapterId, sourceBookChapter }
}

function readChapterBaseSceneAnchorVersion(
  version?: MaterialAssetVersionDto | null,
): ChapterBaseSceneAnchorVersionData | null {
  return normalizeChapterBaseSceneAnchorVersionData(version?.data)
}

function readMaterialVersionImageUrl(version?: MaterialAssetVersionDto | null): string {
  const data =
    version && typeof version.data === 'object' && version.data && !Array.isArray(version.data)
      ? version.data as Record<string, unknown>
      : {}
  const directImageUrl = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''
  if (directImageUrl) return directImageUrl
  const selectedImageUrl = typeof data.selectedImageUrl === 'string' ? data.selectedImageUrl.trim() : ''
  if (selectedImageUrl) return selectedImageUrl
  const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls : []
  for (const item of imageUrls) {
    if (typeof item === 'string' && item.trim()) return item.trim()
  }
  const referenceImages = Array.isArray(data.referenceImages) ? data.referenceImages : []
  for (const item of referenceImages) {
    if (typeof item === 'string' && item.trim()) return item.trim()
  }
  return ''
}

function readMaterialVersionVisualSnapshot(
  version?: MaterialAssetVersionDto | null,
): {
  imageUrl?: string
  selectedImageUrl?: string
  imageUrls?: string[]
  referenceImages?: string[]
  sourceAssetId?: string
  shotId?: string
} {
  const data =
    version && typeof version.data === 'object' && version.data && !Array.isArray(version.data)
      ? version.data as Record<string, unknown>
      : {}
  const imageUrl = typeof data.imageUrl === 'string' && data.imageUrl.trim() ? data.imageUrl.trim() : undefined
  const selectedImageUrl =
    typeof data.selectedImageUrl === 'string' && data.selectedImageUrl.trim()
      ? data.selectedImageUrl.trim()
      : undefined
  const imageUrls = Array.isArray(data.imageUrls)
    ? data.imageUrls
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
    : []
  const referenceImages = Array.isArray(data.referenceImages)
    ? data.referenceImages
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
    : []
  const sourceAssetId = typeof data.sourceAssetId === 'string' && data.sourceAssetId.trim() ? data.sourceAssetId.trim() : undefined
  const shotId = typeof data.shotId === 'string' && data.shotId.trim() ? data.shotId.trim() : undefined
  return {
    ...(imageUrl ? { imageUrl } : null),
    ...(selectedImageUrl ? { selectedImageUrl } : null),
    ...(imageUrls.length > 0 ? { imageUrls } : null),
    ...(referenceImages.length > 0 ? { referenceImages } : null),
    ...(sourceAssetId ? { sourceAssetId } : null),
    ...(shotId ? { shotId } : null),
  }
}

function parseAgentsSpatialAnchorSummary(value: string): {
  semanticSpatialSummary?: string
  macroEnvironment?: string
  continuityConstraints: string[]
} | null {
  const text = String(value || '').trim()
  if (!text) return null
  const jsonText = (() => {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return ''
    return text.slice(start, end + 1)
  })()
  if (!jsonText) return null
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>
    const semanticSpatialSummary =
      typeof parsed.semanticSpatialSummary === 'string' && parsed.semanticSpatialSummary.trim()
        ? parsed.semanticSpatialSummary.trim()
        : undefined
    const macroEnvironment =
      typeof parsed.macroEnvironment === 'string' && parsed.macroEnvironment.trim()
        ? parsed.macroEnvironment.trim()
        : undefined
    const continuityConstraints = Array.isArray(parsed.continuityConstraints)
      ? parsed.continuityConstraints
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
      : []
    if (!semanticSpatialSummary && !macroEnvironment && continuityConstraints.length === 0) return null
    return {
      semanticSpatialSummary,
      macroEnvironment,
      continuityConstraints,
    }
  } catch {
    return null
  }
}

type ChapterMemoryClues = {
  characters: Array<{ name: string; description: string }>
  scenes: Array<{ name: string; description: string }>
  props: Array<{ name: string; description: string }>
}

type ChapterMemoryCoverage = {
  chapterRequirementCount: number
  matchedCount: number
  missingCount: number
  matchedNames: string[]
  missingNames: string[]
}

type ChapterPrerequisiteStatus = {
  ready: boolean
  items: Array<{
    key: 'source' | 'text' | 'shots' | 'scene_anchor' | 'character_anchor'
    label: string
    ready: boolean
    detail: string
    required: boolean
  }>
  missingDetails: string[]
}

type ChapterResumeStatus = {
  continuable: boolean
  totalEvidenceCount: number
  summary: string
  details: string[]
}

type ChapterPrerequisiteKey = ChapterPrerequisiteStatus['items'][number]['key']

function normalizeAssetKey(value: string): string {
  return normalizeAssetName(value).toLowerCase()
}

function summarizeChapterMemoryCoverage(
  clues: Array<{ name: string; description: string }>,
  existingItems: MaterialAssetDto[],
): ChapterMemoryCoverage {
  const existingKeys = new Set(existingItems.map((item) => normalizeAssetKey(item.name)))
  const matchedNames: string[] = []
  const missingNames: string[] = []
  for (const clue of clues) {
    const key = normalizeAssetKey(clue.name)
    if (!key) continue
    if (existingKeys.has(key)) {
      matchedNames.push(clue.name)
    } else {
      missingNames.push(clue.name)
    }
  }
  return {
    chapterRequirementCount: clues.length,
    matchedCount: matchedNames.length,
    missingCount: missingNames.length,
    matchedNames,
    missingNames,
  }
}

function evaluateChapterPrerequisites(input: {
  hasBoundSourceChapter: boolean
  hasChapterText: boolean
  hasShotUnits: boolean
  sceneReferenceImageCount: number
  characterRequirementCount: number
  characterReferenceImageCount: number
  legacyResumeStatus?: ChapterResumeStatus | null
}): ChapterPrerequisiteStatus {
  const resumeStatus = input.legacyResumeStatus && input.legacyResumeStatus.continuable
    ? input.legacyResumeStatus
    : null
  const items: ChapterPrerequisiteStatus['items'] = [
    {
      key: 'source',
      label: '原文绑定',
      ready: input.hasBoundSourceChapter || Boolean(resumeStatus),
      required: true,
      detail: input.hasBoundSourceChapter
        ? '已锁定章节原文。'
        : resumeStatus
          ? '老数据可先续接执行，后续再补录原文绑定。'
          : '当前章节未绑定原文。',
    },
    {
      key: 'text',
      label: '文本上下文',
      ready: input.hasChapterText || Boolean(resumeStatus),
      required: true,
      detail: input.hasChapterText
        ? '章节文本窗口可用。'
        : resumeStatus
          ? '已检测到历史章节结果，可先按旧结果续接，再补齐摘要/正文。'
          : '章节正文/摘要不足，无法稳定生成。',
    },
    {
      key: 'shots',
      label: '镜头单元',
      ready: input.hasShotUnits,
      required: true,
      detail: input.hasShotUnits ? '镜头板已建立。' : '当前章节还没有镜头单元。',
    },
    {
      key: 'scene_anchor',
      label: '场景锚点',
      ready: input.sceneReferenceImageCount > 0,
      required: true,
      detail: input.sceneReferenceImageCount > 0
        ? `已命中 ${input.sceneReferenceImageCount} 个场景视觉锚点。`
        : '缺少可执行场景锚点图。',
    },
    {
      key: 'character_anchor',
      label: '人物锚点',
      ready: input.characterRequirementCount <= 0 || input.characterReferenceImageCount > 0,
      required: input.characterRequirementCount > 0,
      detail: input.characterRequirementCount <= 0
        ? '本章未识别到强人物需求。'
        : input.characterReferenceImageCount > 0
          ? `已命中 ${input.characterReferenceImageCount} 个人物锚点图。`
          : '已识别人物需求，但没有人物锚点图。',
    },
  ]
  const requiredItems = items.filter((item) => item.required)
  const ready = requiredItems.every((item) => item.ready)
  const missingDetails = requiredItems.filter((item) => !item.ready).map((item) => item.detail)
  return {
    ready,
    items,
    missingDetails,
  }
}

function buildChapterResumeStatus(input: {
  shotCount: number
  generatedShotCount: number
  reviewShotCount: number
  reworkShotCount: number
  sceneAssetCount: number
  baseSceneAnchorCount: number
  storyboardChunkCount: number
  storyboardPlanShotCount: number
  recentTaskCount: number
}): ChapterResumeStatus {
  const details: string[] = []
  if (input.shotCount > 0) details.push(`已有 ${input.shotCount} 个镜头单元`)
  if (input.generatedShotCount > 0) details.push(`已有 ${input.generatedShotCount} 个镜头进入可审阅/已出图状态`)
  if (input.reviewShotCount > 0) details.push(`已有 ${input.reviewShotCount} 个镜头待审阅`)
  if (input.reworkShotCount > 0) details.push(`已有 ${input.reworkShotCount} 个镜头待返工`)
  if (input.sceneAssetCount > 0) details.push(`已沉淀 ${input.sceneAssetCount} 个章节场景资产`)
  if (input.baseSceneAnchorCount > 0) details.push(`已有 ${input.baseSceneAnchorCount} 个基础场景锚点`)
  if (input.storyboardChunkCount > 0) details.push(`已有 ${input.storyboardChunkCount} 组分镜结果`)
  if (input.storyboardPlanShotCount > 0) details.push(`已有 ${input.storyboardPlanShotCount} 条分镜脚本`)
  if (input.recentTaskCount > 0) details.push(`最近还有 ${input.recentTaskCount} 条章节任务记录`)
  const totalEvidenceCount = details.length
  return {
    continuable: totalEvidenceCount > 0,
    totalEvidenceCount,
    summary: totalEvidenceCount > 0
      ? `检测到 ${totalEvidenceCount} 类历史产物，可直接续接当前章节。`
      : '当前章节还没有可续接的历史产物。',
    details,
  }
}

function parseAgentsChapterMemoryClues(value: string): ChapterMemoryClues | null {
  const text = String(value || '').trim()
  if (!text) return null
  const jsonText = (() => {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return ''
    return text.slice(start, end + 1)
  })()
  if (!jsonText) return null
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>
    const toClues = (raw: unknown): Array<{ name: string; description: string }> => {
      if (!Array.isArray(raw)) return []
      return raw
        .map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return null
          const record = item as Record<string, unknown>
          const name = normalizeAssetName(typeof record.name === 'string' ? record.name : '')
          if (!name) return null
          return {
            name,
            description: String(record.description || '').trim(),
          }
        })
        .filter((item): item is { name: string; description: string } => Boolean(item))
        .slice(0, 16)
    }
    const characters = toClues(parsed.characters)
    const scenes = toClues(parsed.scenes)
    const props = toClues(parsed.props)
    if (characters.length === 0 && scenes.length === 0 && props.length === 0) return null
    return { characters, scenes, props }
  } catch {
    return null
  }
}

function buildProjectStyleAnchorName(input: {
  artStyleName?: string | null
  styleBibleName?: string | null
}): string {
  const artStyleName = String(input.artStyleName || '').trim()
  const styleBibleName = String(input.styleBibleName || '').trim()
  if (artStyleName) return `项目画风锚点 · ${artStyleName}`
  if (styleBibleName) return `项目画风锚点 · ${styleBibleName}`
  return '项目画风锚点'
}

function diagnoseShotGenerationFailure(input: {
  message?: string | null
  prompt?: string | null
  hasBoundSourceChapter: boolean
  suggestedAssetCount: number
}): { title: string; detail: string; tone: 'red' | 'yellow' | 'gray' } {
  const message = String(input.message || '').trim()
  const normalized = message.toLowerCase()
  if (!input.hasBoundSourceChapter) {
    return {
      title: '原文上下文不足',
      detail: '当前章节还没锁定原文，先完成章节绑定，再重新启动镜头生成。',
      tone: 'yellow',
    }
  }
  if (!String(input.prompt || '').trim()) {
    return {
      title: '镜头 Prompt 为空',
      detail: '当前镜头还没有可执行 Prompt，先整理镜头摘要或重建 Prompt。',
      tone: 'yellow',
    }
  }
  if (input.suggestedAssetCount === 0) {
    return {
      title: '项目锚点偏少',
      detail: '当前镜头缺少可复用角色 / 场景 / 道具 / 风格锚点，结果容易不稳定，可先同步章节线索。',
      tone: 'gray',
    }
  }
  if (/401|403|unauthorized|forbidden|auth|登录|权限/.test(normalized)) {
    return {
      title: '权限或登录状态异常',
      detail: '生成请求可能没有通过鉴权，先确认登录状态、团队额度或接口权限。',
      tone: 'red',
    }
  }
  if (/timeout|timed out|504|轮询|未返回任务 id|task id/.test(normalized)) {
    return {
      title: '任务执行或轮询超时',
      detail: '模型任务可能已排队过久、轮询超时或上游未返回稳定任务状态，可重试当前镜头。',
      tone: 'red',
    }
  }
  if (/积分不足|credit|credits|quota|team_insufficient_credits/.test(normalized)) {
    return {
      title: '当前账号没有可用积分',
      detail: '正式出图依赖模型额度；本地开发环境会自动切到演示图，线上环境请先补足积分后再生成。',
      tone: 'red',
    }
  }
  if (/model|vendor|api|quota|credit|余额|额度|上游|502|503|500/.test(normalized)) {
    return {
      title: '模型或上游接口异常',
      detail: '问题更像发生在模型服务、额度或上游通道，不是本章文本本身。',
      tone: 'red',
    }
  }
  return {
    title: '当前镜头生成失败',
    detail: '先检查本章文本窗口、项目锚点和当前 Prompt；如果都正常，再重试模型任务。',
    tone: 'yellow',
  }
}

function buildDraftShotsFromChapterText(input: {
  chapterTitle: string
  content?: string | null
  summary?: string | null
}): Array<{ title: string; summary: string }> {
  const rawContent = String(input.content || '').trim()
  const rawSummary = String(input.summary || '').trim()
  const normalized = rawContent
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join('\n')
  const sentenceCandidates = (normalized || rawSummary)
    .split(/(?<=[。！？!?；;])\s*|\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 6)
  const chunks: string[] = []
  if (sentenceCandidates.length > 0) {
    for (let i = 0; i < sentenceCandidates.length; i += 2) {
      const pair = sentenceCandidates.slice(i, i + 2).join(' ')
      if (pair) chunks.push(pair)
      if (chunks.length >= 8) break
    }
  }
  if (chunks.length === 0 && rawSummary) chunks.push(rawSummary)
  return chunks.slice(0, 8).map((chunk, index) => {
    const clean = chunk.replace(/\s+/g, ' ').trim()
    const titleSource = clean.split(/[，,。！？!?；;：:]/).map((item) => item.trim()).filter(Boolean)[0] || `${input.chapterTitle} 镜头 ${index + 1}`
    const title = titleSource.length > 18 ? `${titleSource.slice(0, 18)}…` : titleSource
    return {
      title: `镜头 ${index + 1} · ${title}`,
      summary: clean,
    }
  })
}

function pickPreferredShotId(
  shots: Array<{ id: string; shotIndex: number; title?: string; summary?: string }>,
): string | null {
  if (!shots.length) return null
  const first = shots[0] || null
  const last = shots[shots.length - 1] || null
  const conflictLike = shots.find((item) => /冲突|对峙|发现|反转|爆发|追|打|战|哭|死|醒|出现|进入/i.test(`${item.title || ''} ${item.summary || ''}`)) || null
  return conflictLike?.id || first?.id || last?.id || null
}

function pickNextPriorityShotId(input: {
  shots: Array<{ id: string; status?: string }>
  recommendedShotIds: string[]
  currentShotId?: string | null
}): string | null {
  const currentId = String(input.currentShotId || '').trim()
  const pendingRecommended = input.recommendedShotIds.filter((shotId) => {
    if (!shotId || shotId === currentId) return false
    const matched = input.shots.find((item) => item.id === shotId)
    if (!matched) return false
    return matched.status !== 'succeeded'
  })
  if (pendingRecommended[0]) return pendingRecommended[0]
  const nextPending = input.shots.find((item) => item.id !== currentId && item.status !== 'succeeded')
  return nextPending?.id || null
}

export default function ProjectChapterWorkbenchPage(): JSX.Element {
  const auth = useAuth()
  const route = parseChapterRoute()
  const [chapters, setChapters] = React.useState<ChapterDto[]>([])
  const [workbench, setWorkbench] = React.useState<ChapterWorkbenchDto | null>(null)
  const [projectSetup, setProjectSetup] = React.useState<ProjectSetupProfile>(DEFAULT_PROJECT_SETUP_PROFILE)
  const [projectBooks, setProjectBooks] = React.useState<ProjectBookListItemDto[]>([])
  const [bookIndex, setBookIndex] = React.useState<ProjectBookIndexDto | null>(null)
  const [boundSourceChapterDetail, setBoundSourceChapterDetail] = React.useState<Awaited<ReturnType<typeof getProjectBookChapter>> | null>(null)
  const [boundSourceChapterLoading, setBoundSourceChapterLoading] = React.useState(false)
  const [projectTextAsset, setProjectTextAsset] = React.useState<ServerAssetDto | null>(null)
  const [shotRenderAssets, setShotRenderAssets] = React.useState<ServerAssetDto[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<ProjectChapterWorkbenchLoadError | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [savingSetup, setSavingSetup] = React.useState(false)
  const [savingChapterMeta, setSavingChapterMeta] = React.useState(false)
  const [importingChapters, setImportingChapters] = React.useState(false)
  const [creatingShot, setCreatingShot] = React.useState(false)
  const [draftingShots, setDraftingShots] = React.useState(false)
  const [savingShot, setSavingShot] = React.useState(false)
  const [deletingShot, setDeletingShot] = React.useState(false)
  const [deletingChapter, setDeletingChapter] = React.useState(false)
  const [generatingShotImage, setGeneratingShotImage] = React.useState(false)
  const [savingShotSelection, setSavingShotSelection] = React.useState(false)
  const [promotingShotResult, setPromotingShotResult] = React.useState(false)
  const [confirmingShotResult, setConfirmingShotResult] = React.useState(false)
  const [syncingChapterMemory, setSyncingChapterMemory] = React.useState(false)
  const [bindingShotMemory, setBindingShotMemory] = React.useState(false)
  const [uploadingText, setUploadingText] = React.useState(false)
  const [reorderingChapter, setReorderingChapter] = React.useState(false)
  const [reorderingShotId, setReorderingShotId] = React.useState<string | null>(null)
  const [advancingChapter, setAdvancingChapter] = React.useState(false)
  const [chapterAutoRelayMessage, setChapterAutoRelayMessage] = React.useState('')
  const [nameDraft, setNameDraft] = React.useState('')
  const [shotQuery, setShotQuery] = React.useState('')
  const [shotStatusFilter, setShotStatusFilter] = React.useState<'all' | 'queued' | 'running' | 'succeeded' | 'failed'>('all')
  const [projectTextFile, setProjectTextFile] = React.useState<File | null>(null)
  const [shotControlExpanded, setShotControlExpanded] = React.useState(false)
  const [showAdvancedPanels, setShowAdvancedPanels] = React.useState(false)
  const [showAdvancedDiagnostics, setShowAdvancedDiagnostics] = React.useState(false)
  const [showShotAdvancedActions, setShowShotAdvancedActions] = React.useState(false)
  const [shotWorkspaceModalOpen, setShotWorkspaceModalOpen] = React.useState(false)
  const [showChapterContentPreview, setShowChapterContentPreview] = React.useState(false)
  const [chapterFlowCount, setChapterFlowCount] = React.useState(0)
  const [shotFlowCount, setShotFlowCount] = React.useState(0)
  const [chapterPreferredFlowId, setChapterPreferredFlowId] = React.useState<string | null>(null)
  const [shotPreferredFlowId, setShotPreferredFlowId] = React.useState<string | null>(null)
  const [flowMetaLoading, setFlowMetaLoading] = React.useState(false)
  const [openingChapterStudio, setOpeningChapterStudio] = React.useState(false)
  const [openingShotStudio, setOpeningShotStudio] = React.useState(false)
  const [sceneAssets, setSceneAssets] = React.useState<MaterialAssetDto[]>([])
  const [characterAssets, setCharacterAssets] = React.useState<MaterialAssetDto[]>([])
  const [propAssets, setPropAssets] = React.useState<MaterialAssetDto[]>([])
  const [styleAssets, setStyleAssets] = React.useState<MaterialAssetDto[]>([])
  const [currentSceneVersions, setCurrentSceneVersions] = React.useState<MaterialAssetVersionDto[]>([])
  const [currentSceneImpact, setCurrentSceneImpact] = React.useState<MaterialImpactResponseDto | null>(null)
  const [currentShotRefs, setCurrentShotRefs] = React.useState<MaterialShotRefDto[]>([])
  const [boundAssetVersions, setBoundAssetVersions] = React.useState<Record<string, MaterialAssetVersionDto | null>>({})
  const [boundAssetImpacts, setBoundAssetImpacts] = React.useState<Record<string, MaterialImpactResponseDto | null>>({})
  const [assetLatestVersions, setAssetLatestVersions] = React.useState<Record<string, MaterialAssetVersionDto | null>>({})
  const [resourceLoading, setResourceLoading] = React.useState(false)
  const [autoBindingChapter, setAutoBindingChapter] = React.useState(false)
  const [autoBindingAllChapters, setAutoBindingAllChapters] = React.useState(false)
  const [selectedShotIds, setSelectedShotIds] = React.useState<string[]>([])
  const [batchUpdatingShots, setBatchUpdatingShots] = React.useState(false)
  const [chapterMetaDraft, setChapterMetaDraft] = React.useState<{
    title: string
    summary: string
    sourceBookChapter: string
  }>({
    title: '',
    summary: '',
    sourceBookChapter: '',
  })
  const [shotDraft, setShotDraft] = React.useState<{
    shotId: string
    title: string
    summary: string
    status: string
  } | null>(null)
  const [shotRenderPrompt, setShotRenderPrompt] = React.useState('')
  const [assetsViewerOpen, setAssetsViewerOpen] = React.useState(false)
  const [chapterTourOpen, setChapterTourOpen] = React.useState(false)
  const [fillingPrerequisiteKey, setFillingPrerequisiteKey] = React.useState<ChapterPrerequisiteKey | null>(null)
  const textSectionRef = React.useRef<HTMLDivElement | null>(null)
  const bindingSectionRef = React.useRef<HTMLDivElement | null>(null)
  const shotsSectionRef = React.useRef<HTMLDivElement | null>(null)
  const renderSectionRef = React.useRef<HTMLDivElement | null>(null)
  const chapterStageRef = React.useRef<HTMLDivElement | null>(null)
  const autoDraftedChapterIdsRef = React.useRef<Set<string>>(new Set())
  const autoSyncedProjectChaptersRef = React.useRef<Set<string>>(new Set())
  const autoSyncedChapterMemoryRef = React.useRef<Set<string>>(new Set())
  const pendingAutoKickoffShotIdRef = React.useRef<string | null>(null)
  const consumedChapterHandoffRef = React.useRef<string | null>(null)
  const chapterAutoRelayTimerRef = React.useRef<number | null>(null)
  const lastStableChaptersRef = React.useRef<ChapterDto[]>([])
  const lastStableWorkbenchRef = React.useRef<ChapterWorkbenchDto | null>(null)
  const lastStableProjectBooksRef = React.useRef<ProjectBookListItemDto[]>([])
  const lastStableBookIndexRef = React.useRef<ProjectBookIndexDto | null>(null)
  const lastStableProjectTextAssetRef = React.useRef<ServerAssetDto | null>(null)
  const lastStableProjectSetupRef = React.useRef<ProjectSetupProfile>(DEFAULT_PROJECT_SETUP_PROFILE)
  const lastStableShotRenderAssetsRef = React.useRef<ServerAssetDto[]>([])

  const projectId = route?.projectId || ''
  const chapterId = route?.chapterId || ''
  const activeShotId = route?.shotId || ''

  React.useEffect(() => {
    if (chapters.length > 0) lastStableChaptersRef.current = chapters
  }, [chapters])

  React.useEffect(() => {
    if (workbench) lastStableWorkbenchRef.current = workbench
  }, [workbench])

  React.useEffect(() => {
    if (projectBooks.length > 0) lastStableProjectBooksRef.current = projectBooks
  }, [projectBooks])

  React.useEffect(() => {
    if (bookIndex) lastStableBookIndexRef.current = bookIndex
  }, [bookIndex])

  React.useEffect(() => {
    if (projectTextAsset) lastStableProjectTextAssetRef.current = projectTextAsset
  }, [projectTextAsset])

  React.useEffect(() => {
    lastStableProjectSetupRef.current = projectSetup
  }, [projectSetup])

  React.useEffect(() => {
    lastStableShotRenderAssetsRef.current = shotRenderAssets
  }, [shotRenderAssets])

  const reloadProjectContext = React.useCallback(async (options?: { bypassBookThrottle?: boolean }) => {
    if (!projectId || !chapterId) return
    const [
      chapterItemsResult,
      chapterWorkbenchResult,
      setupResult,
      booksResult,
      assetsResult,
      shotRenderAssetsResult,
    ] = await Promise.allSettled([
      listProjectChapters(projectId),
      getChapterWorkbench(chapterId),
      getProjectSetupProfile(projectId),
      listProjectBooks(projectId),
      listServerAssets({ projectId, limit: 100 }),
      listServerAssets({ projectId, kind: PROJECT_SHOT_RENDER_ASSET_KIND, limit: 100 }),
    ])

    if (chapterItemsResult.status === 'rejected') throw chapterItemsResult.reason
    if (chapterWorkbenchResult.status === 'rejected') throw chapterWorkbenchResult.reason

    const chapterItems = chapterItemsResult.value
    const chapterWorkbench = chapterWorkbenchResult.value
    const books = pickSettledValue(booksResult, lastStableProjectBooksRef.current)
    const setupProfile = setupResult.status === 'fulfilled'
      ? setupResult.value.profile
      : lastStableProjectSetupRef.current
    const textAsset = assetsResult.status === 'fulfilled'
      ? pickCurrentProjectTextAsset(assetsResult.value.items || [])
      : lastStableProjectTextAssetRef.current
    const refreshedShotRenderAssets = shotRenderAssetsResult.status === 'fulfilled'
      ? (shotRenderAssetsResult.value.items || [])
      : lastStableShotRenderAssetsRef.current

    const primaryBook = books[0] || null
    let nextBookIndex = lastStableBookIndexRef.current
    if (primaryBook) {
      try {
        nextBookIndex = await getProjectBookIndex(projectId, primaryBook.bookId, {
          bypassThrottle: options?.bypassBookThrottle === true,
        })
      } catch (error) {
        console.warn('刷新章节页时跳过原文目录刷新', error)
      }
    } else {
      nextBookIndex = null
    }

    return {
      chapterItems,
      chapterWorkbench,
      setupProfile,
      books,
      nextBookIndex,
      textAsset,
      shotRenderAssets: refreshedShotRenderAssets,
    }
  }, [chapterId, projectId])

  const composeShotRenderPrompt = React.useCallback((input: {
    workbenchValue: ChapterWorkbenchDto
    shotIdValue: string
    sourceChapterDetailValue?: Awaited<ReturnType<typeof getProjectBookChapter>> | null
  }): string => {
    const detailCharacters = (input.sourceChapterDetailValue?.characters || []).map((item) => normalizeAssetName(item.name || '')).filter(Boolean)
    const detailScenes = [
      ...(input.sourceChapterDetailValue?.scenes || []).map((item) => normalizeAssetName(item.name || '')),
      ...(input.sourceChapterDetailValue?.locations || []).map((item) => normalizeAssetName(item.name || '')),
    ].filter(Boolean)
    const detailProps = (input.sourceChapterDetailValue?.props || []).map((item) => normalizeAssetName(item.name || '')).filter(Boolean)
    const normalizedSourceChapterDetail = input.sourceChapterDetailValue
      ? {
          title: input.sourceChapterDetailValue.title,
          summary: input.sourceChapterDetailValue.summary ?? undefined,
          coreConflict: input.sourceChapterDetailValue.coreConflict ?? undefined,
          content: input.sourceChapterDetailValue.content,
          characters: input.sourceChapterDetailValue.characters,
          scenes: input.sourceChapterDetailValue.scenes,
          locations: input.sourceChapterDetailValue.locations,
          props: input.sourceChapterDetailValue.props,
        }
      : null
    return buildDefaultShotPrompt({
      workbench: input.workbenchValue,
      shotId: input.shotIdValue,
      projectSetup,
      sourceChapterDetail: normalizedSourceChapterDetail,
      sharedMemory: {
        characterAssets: characterAssets
          .filter((item) => detailCharacters.length === 0 || detailCharacters.some((name) => name.toLowerCase() === normalizeAssetName(item.name).toLowerCase()))
          .slice(0, 8)
          .map((item) => ({ name: item.name })),
        sceneAssets: sceneAssets
          .filter((item) => detailScenes.length === 0 || detailScenes.some((name) => normalizeAssetName(item.name).toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(normalizeAssetName(item.name).toLowerCase())))
          .slice(0, 6)
          .map((item) => {
            const anchorData = readChapterBaseSceneAnchorVersion(assetLatestVersions[item.id] || null)
            return {
              name: item.name,
              anchorType: anchorData ? 'chapter_base_space' as const : 'generic_scene' as const,
              semanticSpatialSummary: anchorData?.semanticSpatialSummary,
              macroEnvironment: anchorData?.macroEnvironment,
              continuityConstraints: anchorData?.continuityConstraints || [],
            }
          }),
        propAssets: propAssets
          .filter((item) => detailProps.length === 0 || detailProps.some((name) => name.toLowerCase() === normalizeAssetName(item.name).toLowerCase()))
          .slice(0, 8)
          .map((item) => ({ name: item.name })),
        styleAssets: styleAssets
          .slice(0, 3)
          .map((item) => ({ name: item.name })),
      },
      styleBible: bookIndex?.assets?.styleBible || null,
    })
  }, [assetLatestVersions, bookIndex?.assets?.styleBible, characterAssets, projectSetup, propAssets, sceneAssets, styleAssets])

  React.useEffect(() => {
    if (!auth.user || !projectId || !chapterId) return
    let alive = true
    setLoading(true)
    setLoadError(null)
    reloadProjectContext()
      .then((result) => {
        if (!alive || !result) return
        setChapters(result.chapterItems)
        setWorkbench(result.chapterWorkbench)
        setProjectSetup(result.setupProfile)
        setProjectBooks(result.books)
        setBookIndex(result.nextBookIndex)
        setProjectTextAsset(result.textAsset)
        setShotRenderAssets(result.shotRenderAssets)
        setChapterMetaDraft({
          title: result.chapterWorkbench.chapter.title || '',
          summary: result.chapterWorkbench.chapter.summary || '',
          sourceBookChapter:
            result.chapterWorkbench.chapter.sourceBookChapter != null
              ? String(result.chapterWorkbench.chapter.sourceBookChapter)
              : '',
        })
        const preferredShotId = activeShotId || pickPreferredShotId(result.chapterWorkbench.shots)
        const activeShot = result.chapterWorkbench.shots.find((item) => item.id === preferredShotId) || result.chapterWorkbench.shots[0] || null
        setShotDraft(activeShot ? {
          shotId: activeShot.id,
          title: activeShot.title || '',
          summary: activeShot.summary || '',
          status: activeShot.status || 'queued',
        } : null)
      })
      .catch((error) => {
        console.error('加载章节工作台失败', error)
        if (!alive) return
        if (isTransientFetchFailure(error)) {
          setLoadError(null)
          if (lastStableChaptersRef.current.length > 0) {
            setChapters(lastStableChaptersRef.current)
          }
          if (lastStableWorkbenchRef.current) {
            setWorkbench(lastStableWorkbenchRef.current)
          }
          if (lastStableProjectBooksRef.current.length > 0) {
            setProjectBooks(lastStableProjectBooksRef.current)
          }
          if (lastStableBookIndexRef.current) {
            setBookIndex(lastStableBookIndexRef.current)
          }
          if (lastStableProjectTextAssetRef.current) {
            setProjectTextAsset(lastStableProjectTextAssetRef.current)
          }
          return
        }
        setLoadError(toWorkbenchLoadError(error, '加载章节工作台失败'))
        setChapters([])
        setWorkbench(null)
        setProjectSetup(DEFAULT_PROJECT_SETUP_PROFILE)
        setProjectBooks([])
        setBookIndex(null)
        setProjectTextAsset(null)
        setShotRenderAssets([])
        setChapterMetaDraft({ title: '', summary: '', sourceBookChapter: '' })
        setShotDraft(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [auth.user?.sub, chapterId, projectId, reloadProjectContext])

  React.useEffect(() => {
    if (!auth.user || !projectId || !chapterId || !workbench) return
    if (workbench.chapter.sourceBookChapter) return
    if (workbench.shots.length > 0) return
    let alive = true
    ensureProjectHasAutoBoundFirstChapter(projectId)
      .then((result) => {
        if (!alive || !result.changed || !result.chapterId) return
        if (result.chapterId !== chapterId) {
          spaNavigate(buildProjectChapterUrl(projectId, result.chapterId))
          return
        }
        return reloadProjectContext({ bypassBookThrottle: true }).then((refreshed) => {
          if (!alive || !refreshed) return
          setChapters(refreshed.chapterItems)
          setWorkbench(refreshed.chapterWorkbench)
          setBookIndex(refreshed.nextBookIndex)
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [auth.user?.sub, chapterId, projectId, reloadProjectContext, workbench])

  React.useEffect(() => {
    if (!auth.user || !projectId) return
    const totalSourceChapters = bookIndex?.chapters?.length || 0
    if (totalSourceChapters === 0) return
    if (chapters.length >= totalSourceChapters) return
    if (importingChapters || uploadingText) return
    if (autoSyncedProjectChaptersRef.current.has(projectId)) return
    autoSyncedProjectChaptersRef.current.add(projectId)
    syncProjectChaptersFromPrimaryBook(projectId)
      .then((result) => {
        if (result.createdCount <= 0) return
        return reloadProjectContext({ bypassBookThrottle: true }).then((refreshed) => {
          if (!refreshed) return
          setProjectBooks(refreshed.books)
          setChapters(refreshed.chapterItems)
          setWorkbench(refreshed.chapterWorkbench)
          setBookIndex(refreshed.nextBookIndex)
          setProjectTextAsset(refreshed.textAsset)
          toast(`已自动补齐剩余 ${result.createdCount} 个章节。`, 'success')
        })
      })
      .catch(() => {
        autoSyncedProjectChaptersRef.current.delete(projectId)
      })
  }, [auth.user?.sub, bookIndex?.chapters?.length, chapters.length, importingChapters, projectId, reloadProjectContext, uploadingText])

  React.useEffect(() => {
    if (!auth.user || !projectId) return
    const primaryBook = projectBooks[0] || null
    const declaredChapterCount =
      typeof primaryBook?.chapterCount === 'number' && Number.isFinite(primaryBook.chapterCount)
        ? Math.max(0, Math.trunc(primaryBook.chapterCount))
        : 0
    const indexedChapterCount = bookIndex?.chapters?.length || 0
    const projectChapterCount = chapters.length
    const shouldPollIndex = declaredChapterCount > 0 && indexedChapterCount < declaredChapterCount
    const shouldSyncProjectChapters = indexedChapterCount > 0 && projectChapterCount < indexedChapterCount
    if (!shouldPollIndex && !shouldSyncProjectChapters) return
    if (importingChapters || uploadingText) return
    let cancelled = false
    const run = async () => {
      try {
        const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
        if (cancelled || !refreshed) return
        setProjectBooks(refreshed.books)
        setBookIndex(refreshed.nextBookIndex)
        setProjectTextAsset(refreshed.textAsset)
        if (refreshed.nextBookIndex?.chapters?.length && refreshed.chapterItems.length < refreshed.nextBookIndex.chapters.length) {
          const synced = await syncProjectChaptersFromPrimaryBook(projectId).catch(() => null)
          if (cancelled) return
          if (synced && synced.createdCount > 0) {
            const finalRefreshed = await reloadProjectContext({ bypassBookThrottle: true })
            if (cancelled || !finalRefreshed) return
            setProjectBooks(finalRefreshed.books)
            setChapters(finalRefreshed.chapterItems)
            setWorkbench(finalRefreshed.chapterWorkbench)
            setBookIndex(finalRefreshed.nextBookIndex)
            setProjectTextAsset(finalRefreshed.textAsset)
          } else {
            setChapters(refreshed.chapterItems)
            setWorkbench(refreshed.chapterWorkbench)
          }
          return
        }
        setChapters(refreshed.chapterItems)
        setWorkbench(refreshed.chapterWorkbench)
      } catch {}
    }
    const timer = window.setTimeout(() => {
      void run()
    }, 3500)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    auth.user?.sub,
    bookIndex?.chapters?.length,
    chapters.length,
    importingChapters,
    projectBooks,
    projectId,
    reloadProjectContext,
    uploadingText,
  ])

  React.useEffect(() => {
    if (!projectId || !chapterId || activeShotId || !workbench?.shots?.length) return
    const preferredShotId = pickPreferredShotId(workbench.shots)
    if (!preferredShotId) return
    const preferredShot = workbench.shots.find((item) => item.id === preferredShotId) || workbench.shots[0] || null
    if (!preferredShot) return
    setShotDraft((prev) => {
      if (prev?.shotId === preferredShot.id) return prev
      return {
        shotId: preferredShot.id,
        title: preferredShot.title || '',
        summary: preferredShot.summary || '',
        status: preferredShot.status || 'queued',
      }
    })
  }, [activeShotId, chapterId, projectId, workbench?.shots])

  React.useEffect(() => {
    const shot = workbench?.shots.find((item) => item.id === activeShotId) || null
    if (!shot) return
    setShotDraft({
      shotId: shot.id,
      title: shot.title || '',
      summary: shot.summary || '',
      status: shot.status || 'queued',
    })
  }, [activeShotId, workbench?.shots])

  React.useEffect(() => {
    const allowedIds = new Set((workbench?.shots || []).map((item) => item.id))
    setSelectedShotIds((prev) => prev.filter((item) => allowedIds.has(item)))
  }, [workbench?.shots])

  React.useEffect(() => {
    if (shotDraft?.shotId) return
    setShotWorkspaceModalOpen(false)
  }, [shotDraft?.shotId])

  React.useEffect(() => {
    if (!workbench || !shotDraft?.shotId) {
      setShotRenderPrompt('')
      return
    }
    const matched = pickShotRenderAsset(shotRenderAssets, shotDraft.shotId)
    if (matched?.data.prompt?.trim()) {
      setShotRenderPrompt(matched.data.prompt)
      return
    }
    setShotRenderPrompt(composeShotRenderPrompt({
      workbenchValue: workbench,
      shotIdValue: shotDraft.shotId,
      sourceChapterDetailValue: boundSourceChapterDetail,
    }))
  }, [boundSourceChapterDetail, composeShotRenderPrompt, shotDraft?.shotId, shotRenderAssets, workbench])

  React.useEffect(() => {
    if (!auth.user || !projectId || !workbench?.chapter.sourceBookId || !workbench?.chapter.sourceBookChapter) {
      setBoundSourceChapterDetail(null)
      setBoundSourceChapterLoading(false)
      return
    }
    let alive = true
    setBoundSourceChapterLoading(true)
    getProjectBookChapter(projectId, workbench.chapter.sourceBookId, workbench.chapter.sourceBookChapter)
      .then((detail) => {
        if (!alive) return
        setBoundSourceChapterDetail(detail)
      })
      .catch((error) => {
        console.error('加载绑定原文章节详情失败', error)
        if (!alive) return
        setBoundSourceChapterDetail(null)
      })
      .finally(() => {
        if (alive) setBoundSourceChapterLoading(false)
      })
    return () => {
      alive = false
    }
  }, [auth.user?.sub, projectId, workbench?.chapter.sourceBookId, workbench?.chapter.sourceBookChapter])

  React.useEffect(() => {
    if (!auth.user || !projectId || !chapterId || !workbench) {
      setChapterFlowCount(0)
      setShotFlowCount(0)
      setChapterPreferredFlowId(null)
      setShotPreferredFlowId(null)
      setFlowMetaLoading(false)
      return
    }
    let alive = true
    setFlowMetaLoading(true)
    Promise.all([
      listChapterFlows(projectId, chapterId).catch(() => []),
      activeShotId ? listShotFlows(projectId, activeShotId).catch(() => []) : Promise.resolve([]),
    ])
      .then(([chapterFlows, shotFlows]) => {
        if (!alive) return
        setChapterFlowCount(chapterFlows.length)
        setShotFlowCount(shotFlows.length)
        setChapterPreferredFlowId(pickPreferredFlow(chapterFlows)?.id || null)
        setShotPreferredFlowId(pickPreferredFlow(shotFlows)?.id || null)
      })
      .finally(() => {
        if (alive) setFlowMetaLoading(false)
      })
    return () => {
      alive = false
    }
  }, [activeShotId, auth.user?.sub, chapterId, projectId, workbench])

  const activeShot = workbench?.shots.find((item) => item.id === (activeShotId || shotDraft?.shotId || '')) || workbench?.shots[0] || null
  const activeSceneAssetId = String(activeShot?.sceneAssetId || '').trim()
  const activeShotRender = React.useMemo(
    () => (activeShot?.id ? pickShotRenderAsset(shotRenderAssets, activeShot.id) : null),
    [activeShot?.id, shotRenderAssets],
  )

  const handleOpenChapterStudio = React.useCallback(async () => {
    if (!projectId || !chapterId || !workbench || openingChapterStudio) return
    setOpeningChapterStudio(true)
    try {
      let targetFlowId = chapterPreferredFlowId
      let launchMode: 'existing' | 'starter_created' = targetFlowId ? 'existing' : 'starter_created'
      if (!targetFlowId) {
        const currentChapterTitle = String(workbench.chapter.title || '章节页').trim() || '章节页'
        const chapterSummary = String(workbench.chapter.summary || chapterMetaDraft.summary || '').trim()
        const chapterPrompt = [
          `章节：${currentChapterTitle}`,
          chapterSummary ? `摘要：${chapterSummary}` : '',
          `当前镜头数：${workbench.shots.length}`,
          `已生成镜头：${workbench.stats.generatedShots}`,
          '目标：围绕这一章继续做整章节奏、镜头联动、连续性和输出链路编排。',
        ].filter(Boolean).join('\n')
        const storyboardPrompt = [
          `围绕《${currentChapterTitle}》规划本章的镜头推进与分镜结构。`,
          chapterSummary ? `核心摘要：${chapterSummary}` : '',
          '要求：关注章节级节奏、关键转场、连续性与镜头组关系。',
        ].filter(Boolean).join('\n')
        const starterNodes: Node[] = [
          createFlowTaskNode({
            id: 'chapter_context',
            x: 40,
            y: 80,
            label: '章节上下文',
            kind: 'text',
            prompt: chapterPrompt,
            width: 360,
          }),
          createFlowTaskNode({
            id: 'chapter_storyboard',
            x: 420,
            y: 80,
            label: '章节分镜推进',
            kind: 'storyboard',
            prompt: storyboardPrompt,
            width: 520,
          }),
        ]
        const starterEdges: Edge[] = [
          createFlowEdge('chapter_context_to_storyboard', 'chapter_context', 'chapter_storyboard'),
        ]
        const created = await saveChapterFlow({
          projectId,
          chapterId,
          name: `${currentChapterTitle} · 章节流程`,
          nodes: starterNodes,
          edges: starterEdges,
        })
        targetFlowId = created.id
        setChapterFlowCount((prev) => prev + 1)
        setChapterPreferredFlowId(created.id)
      }
      recordFlowLaunchEvidence({
        timestamp: new Date().toISOString(),
        projectId,
        ownerType: 'chapter',
        ownerId: chapterId,
        flowId: targetFlowId,
        mode: launchMode,
      })
      window.location.href = buildStudioUrl({
        projectId,
        ownerType: 'chapter',
        ownerId: chapterId,
        flowId: targetFlowId,
      })
    } catch (error) {
      console.error('打开章节流程失败', error)
      toast(describeError(error, '打开章节流程失败'), 'error')
    } finally {
      setOpeningChapterStudio(false)
    }
  }, [
    chapterId,
    chapterMetaDraft.summary,
    chapterPreferredFlowId,
    openingChapterStudio,
    projectId,
    workbench,
  ])

  const handleOpenShotStudio = React.useCallback(async () => {
    const targetShotId = String(shotDraft?.shotId || '').trim()
    if (!projectId || !targetShotId || !activeShot || openingShotStudio) return
    setOpeningShotStudio(true)
    try {
      let targetFlowId = shotPreferredFlowId
      let launchMode: 'existing' | 'starter_created' = targetFlowId ? 'existing' : 'starter_created'
      if (!targetFlowId) {
        const currentChapterTitle = String(workbench?.chapter.title || '章节页').trim() || '章节页'
        const selectedImageUrl = String(activeShotRender?.data.selectedImageUrl || '').trim()
        const shotSummary = String(activeShot.summary || '').trim()
        const shotPrompt = [
          `章节：${currentChapterTitle}`,
          `镜头：${activeShot.title || `Shot ${activeShot.shotIndex + 1}`}`,
          shotSummary ? `摘要：${shotSummary}` : '',
          selectedImageUrl ? `当前已选结果图：${selectedImageUrl}` : '',
          '目标：继续深化这个镜头的出图、返工与镜头级实验链路。',
        ].filter(Boolean).join('\n')
        const imagePrompt = String(shotRenderPrompt || activeShot.summary || activeShot.title || `为 ${currentChapterTitle} 当前镜头生成画面`).trim()
        const starterNodes: Node[] = [
          createFlowTaskNode({
            id: 'shot_context',
            x: 40,
            y: 80,
            label: '镜头上下文',
            kind: 'text',
            prompt: shotPrompt,
            width: 360,
          }),
          createFlowTaskNode({
            id: 'shot_image',
            x: 420,
            y: 80,
            label: '镜头出图',
            kind: 'image',
            prompt: imagePrompt,
            width: 360,
          }),
        ]
        const starterEdges: Edge[] = [
          createFlowEdge('shot_context_to_image', 'shot_context', 'shot_image'),
        ]
        const created = await saveShotFlow({
          projectId,
          shotId: targetShotId,
          name: `${activeShot.title || `Shot ${activeShot.shotIndex + 1}`} · 镜头流程`,
          nodes: starterNodes,
          edges: starterEdges,
        })
        targetFlowId = created.id
        setShotFlowCount((prev) => prev + 1)
        setShotPreferredFlowId(created.id)
      }
      recordFlowLaunchEvidence({
        timestamp: new Date().toISOString(),
        projectId,
        ownerType: 'shot',
        ownerId: targetShotId,
        flowId: targetFlowId,
        mode: launchMode,
      })
      window.location.href = buildStudioUrl({
        projectId,
        ownerType: 'shot',
        ownerId: targetShotId,
        flowId: targetFlowId,
      })
    } catch (error) {
      console.error('打开镜头流程失败', error)
      toast(describeError(error, '打开镜头流程失败'), 'error')
    } finally {
      setOpeningShotStudio(false)
    }
  }, [
    activeShot,
    activeShotRender?.data.selectedImageUrl,
    openingShotStudio,
    projectId,
    workbench?.chapter.title,
    shotDraft?.shotId,
    shotPreferredFlowId,
    shotRenderPrompt,
  ])

  React.useEffect(() => {
    if (!auth.user || !projectId || !chapterId) {
      setSceneAssets([])
      setCharacterAssets([])
      setPropAssets([])
      setStyleAssets([])
      setCurrentSceneVersions([])
      setCurrentSceneImpact(null)
      setCurrentShotRefs([])
      setBoundAssetVersions({})
      setBoundAssetImpacts({})
      setAssetLatestVersions({})
      setResourceLoading(false)
      return
    }
    let alive = true
    setResourceLoading(true)
    Promise.all([
      listMaterialAssets({ projectId, kind: 'scene' }).catch(() => []),
      listMaterialAssets({ projectId, kind: 'character' }).catch(() => []),
      listMaterialAssets({ projectId, kind: 'prop' }).catch(() => []),
      listMaterialAssets({ projectId, kind: 'style' }).catch(() => []),
      activeSceneAssetId ? listMaterialVersions(activeSceneAssetId, 6).catch(() => []) : Promise.resolve([]),
      activeSceneAssetId ? listImpactedShots({ projectId, assetId: activeSceneAssetId }).catch(() => null) : Promise.resolve(null),
      activeShot?.id ? listShotMaterialRefs({ projectId, shotId: activeShot.id }).catch(() => []) : Promise.resolve([]),
    ])
      .then(([sceneAssetItems, characterAssetItems, propAssetItems, styleAssetItems, sceneVersionItems, sceneImpact, shotRefs]) => {
        if (!alive) return
        setSceneAssets(sceneAssetItems)
        setCharacterAssets(characterAssetItems)
        setPropAssets(propAssetItems)
        setStyleAssets(styleAssetItems)
        const nextLatestVersions: Record<string, MaterialAssetVersionDto | null> = {}
        for (const asset of [...sceneAssetItems, ...characterAssetItems, ...propAssetItems, ...styleAssetItems]) {
          nextLatestVersions[asset.id] = asset.latestVersion || null
        }
        setAssetLatestVersions(nextLatestVersions)
        setCurrentSceneVersions(sceneVersionItems)
        setCurrentSceneImpact(sceneImpact)
        setCurrentShotRefs(shotRefs)
      })
      .finally(() => {
        if (alive) setResourceLoading(false)
      })
    return () => {
      alive = false
    }
  }, [activeSceneAssetId, activeShot?.id, auth.user?.sub, chapterId, projectId])

  React.useEffect(() => {
    if (!auth.user || !projectId || !chapterId) {
      setBoundAssetVersions({})
      setBoundAssetImpacts({})
      return
    }
    const uniqueAssetIds = Array.from(new Set(currentShotRefs.map((item) => item.assetId).filter(Boolean)))
    if (uniqueAssetIds.length === 0) {
      setBoundAssetVersions({})
      setBoundAssetImpacts({})
      return
    }
    let alive = true
    Promise.all(
      uniqueAssetIds.map(async (assetId) => {
        const impact = await listImpactedShots({ projectId, assetId }).catch(() => null)
        return {
          assetId,
          version: assetLatestVersions[assetId] || null,
          impact,
        }
      }),
    )
      .then((rows) => {
        if (!alive) return
        const nextVersions: Record<string, MaterialAssetVersionDto | null> = {}
        const nextImpacts: Record<string, MaterialImpactResponseDto | null> = {}
        for (const row of rows) {
          nextVersions[row.assetId] = row.version
          nextImpacts[row.assetId] = row.impact
        }
        setBoundAssetVersions(nextVersions)
        setBoundAssetImpacts(nextImpacts)
      })
      .catch((error) => {
        console.error('加载镜头绑定资产追溯信息失败', error)
        if (!alive) return
        setBoundAssetVersions({})
        setBoundAssetImpacts({})
      })
    return () => {
      alive = false
    }
  }, [assetLatestVersions, auth.user?.sub, chapterId, currentShotRefs, projectId])

  const chapterTourSeenKey = React.useMemo(
    () => (auth.user?.sub && projectId && chapterId ? `tapcanvas-chapter-tour:v2:${String(auth.user.sub)}:${projectId}:${chapterId}` : ''),
    [auth.user?.sub, chapterId, projectId],
  )

  React.useEffect(() => {
    setShowShotAdvancedActions(false)
  }, [shotDraft?.shotId])

  React.useEffect(() => {
    setShowAdvancedPanels(false)
  }, [chapterId])

  const clearChapterAutoRelayMessage = React.useCallback(() => {
    if (chapterAutoRelayTimerRef.current != null) {
      window.clearTimeout(chapterAutoRelayTimerRef.current)
      chapterAutoRelayTimerRef.current = null
    }
    setChapterAutoRelayMessage('')
  }, [])

  const announceChapterAutoRelay = React.useCallback((message: string, options?: { autoClearMs?: number }) => {
    if (!message.trim()) {
      clearChapterAutoRelayMessage()
      return
    }
    if (chapterAutoRelayTimerRef.current != null) {
      window.clearTimeout(chapterAutoRelayTimerRef.current)
      chapterAutoRelayTimerRef.current = null
    }
    setChapterAutoRelayMessage(message)
    if (typeof options?.autoClearMs === 'number' && options.autoClearMs > 0) {
      chapterAutoRelayTimerRef.current = window.setTimeout(() => {
        chapterAutoRelayTimerRef.current = null
        setChapterAutoRelayMessage('')
      }, options.autoClearMs)
    }
  }, [clearChapterAutoRelayMessage])

  React.useEffect(() => {
    clearChapterAutoRelayMessage()
  }, [chapterId, clearChapterAutoRelayMessage])

  React.useEffect(() => () => {
    if (chapterAutoRelayTimerRef.current != null) {
      window.clearTimeout(chapterAutoRelayTimerRef.current)
      chapterAutoRelayTimerRef.current = null
    }
  }, [])

  const closeChapterTour = React.useCallback(() => {
    setChapterTourOpen(false)
    if (!chapterTourSeenKey) return
    try {
      window.localStorage.setItem(chapterTourSeenKey, '1')
    } catch {}
  }, [chapterTourSeenKey])

  if (!auth.user) {
    return <GithubGate><></></GithubGate>
  }

  const workbenchStats = workbench?.stats || EMPTY_WORKBENCH_STATS
  const chapterMissing = loadError?.status === 404 && (loadError.code === 'chapter_not_found' || loadError.code === 'project_not_found')
  const chapterTitle = workbench?.chapter.title || '章节页'

  const handleCreateChapter = async () => {
    const title = nameDraft.trim()
    if (!title || !projectId || creating) return
    setCreating(true)
    try {
      const created = await createProjectChapter(projectId, { title })
      toast('新章节已创建。', 'success')
      spaNavigate(buildProjectChapterUrl(projectId, created.id))
    } catch (error) {
      console.error('创建章节失败', error)
      toast(describeError(error, '创建章节失败，请稍后重试'), 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleMoveChapter = async (direction: 'up' | 'down') => {
    if (!workbench || reorderingChapter) return
    const currentIndex = chapters.findIndex((item) => item.id === chapterId)
    if (currentIndex < 0) return
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    const target = chapters[targetIndex]
    const current = chapters[currentIndex]
    if (!target || !current) return
    setReorderingChapter(true)
    try {
      await Promise.all([
        updateChapter(current.id, { sortOrder: target.sortOrder }),
        updateChapter(target.id, { sortOrder: current.sortOrder }),
      ])
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setChapters(refreshed.chapterItems)
        setWorkbench(refreshed.chapterWorkbench)
        setBookIndex(refreshed.nextBookIndex)
      }
      toast(direction === 'up' ? '章节已上移。' : '章节已下移。', 'success')
    } catch (error) {
      console.error('章节排序失败', error)
      toast(describeError(error, '章节排序失败，请稍后重试'), 'error')
    } finally {
      setReorderingChapter(false)
    }
  }

  const handleSaveProjectSetup = async () => {
    if (!projectId || savingSetup) return
    setSavingSetup(true)
    try {
      const saved = await upsertProjectSetupProfile(projectId, projectSetup)
      setProjectSetup(saved.profile)
    } catch (error) {
      console.error('保存项目设定失败', error)
      toast(describeError(error, '保存项目设定失败，请稍后重试'), 'error')
    } finally {
      setSavingSetup(false)
    }
  }

  const handleUploadProjectText = async () => {
    if (!projectId || !workbench?.project.name || !projectTextFile || uploadingText) return
    setUploadingText(true)
    try {
      const uploaded = await uploadProjectText({
        projectId,
        projectName: workbench.project.name,
        file: projectTextFile,
      })
      const saved = await upsertProjectSetupProfile(projectId, {
        ...projectSetup,
        creationMode: 'text-upload',
        createdFrom: 'uploaded-text',
        lastTextUploadName: projectTextFile.name,
        lastTextUploadMode: uploaded.mode,
        lastTextUploadAt: new Date().toISOString(),
      })
      setProjectSetup(saved.profile)
      setProjectTextFile(null)
      if (uploaded.mode === 'book') {
        for (let attempt = 0; attempt < 24; attempt += 1) {
          const synced = await syncProjectChaptersFromPrimaryBook(projectId).catch(() => null)
          if (synced && synced.totalSourceChapters > 0) break
          await new Promise((resolve) => window.setTimeout(resolve, 2000))
        }
      }
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setProjectBooks(refreshed.books)
        setChapters(refreshed.chapterItems)
        setWorkbench(refreshed.chapterWorkbench)
        setBookIndex(refreshed.nextBookIndex)
        setProjectTextAsset(refreshed.textAsset)
      }
      toast(uploaded.mode === 'book' ? '文本已上传，项目章节目录会自动按原文补齐。' : '文本已上传到当前项目。', 'success')
    } catch (error) {
      console.error('上传项目文本失败', error)
      toast(describeError(error, '上传项目文本失败，请稍后重试'), 'error')
    } finally {
      setUploadingText(false)
    }
  }

  const handleSaveChapterMeta = async () => {
    if (!chapterId || !workbench || savingChapterMeta || !bookIndex) return
    const parsedSourceChapter = chapterMetaDraft.sourceBookChapter.trim()
      ? Number.parseInt(chapterMetaDraft.sourceBookChapter.trim(), 10)
      : null
    setSavingChapterMeta(true)
    try {
      const nextSourceChapter =
        typeof parsedSourceChapter === 'number' && Number.isFinite(parsedSourceChapter) && parsedSourceChapter > 0
          ? parsedSourceChapter
          : null
      await updateChapter(chapterId, {
        title: chapterMetaDraft.title.trim() || '未命名章节',
        summary: chapterMetaDraft.summary.trim(),
        status: workbench.chapter.status,
        sourceBookId: nextSourceChapter ? projectBooks[0]?.bookId || null : null,
        sourceBookChapter: nextSourceChapter,
      })
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setChapters(refreshed.chapterItems)
        setWorkbench(refreshed.chapterWorkbench)
        setBookIndex(refreshed.nextBookIndex)
      }
      toast('章节信息已保存。', 'success')
    } catch (error) {
      console.error('保存章节映射失败', error)
      toast(describeError(error, '保存章节映射失败，请稍后重试'), 'error')
    } finally {
      setSavingChapterMeta(false)
    }
  }

  const handleImportChaptersFromBook = async (options?: { limit?: number }) => {
    const primaryBook = projectBooks[0]
    const sourceChapters = bookIndex?.chapters || []
    if (!projectId || !primaryBook || sourceChapters.length === 0 || importingChapters) return
    setImportingChapters(true)
    try {
      const mappedSourceChapterNos = new Set(
        chapters
          .map((chapter) => chapter.sourceBookId === primaryBook.bookId ? chapter.sourceBookChapter : null)
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
      )
      const missing = sourceChapters.filter((item) => !mappedSourceChapterNos.has(item.chapter))
      if (missing.length === 0) {
        toast('原文章节已经全部导入，无需重复生成。', 'info')
        return
      }
      const limit =
        typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
          ? Math.max(1, Math.trunc(options.limit))
          : null
      const targetItems = limit ? missing.slice(0, limit) : missing
      for (const item of targetItems) {
        const created = await createProjectChapter(projectId, {
          title: item.title || `第${item.chapter}章`,
          summary: item.summary || item.coreConflict || '',
        })
        await updateChapter(created.id, {
          title: item.title || created.title,
          summary: item.summary || item.coreConflict || '',
          sourceBookId: primaryBook.bookId,
          sourceBookChapter: item.chapter,
        })
      }
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setChapters(refreshed.chapterItems)
        setWorkbench(refreshed.chapterWorkbench)
        setBookIndex(refreshed.nextBookIndex)
      }
      const remainingCount = Math.max(0, missing.length - targetItems.length)
      toast(
        remainingCount > 0
          ? `已补齐 ${targetItems.length} 个章节，还剩 ${remainingCount} 个待导入。`
          : `已按原文目录补齐 ${targetItems.length} 个章节。`,
        'success',
      )
    } catch (error) {
      console.error('按原文章节导入失败', error)
      toast(describeError(error, '按原文章节导入失败，请稍后重试'), 'error')
    } finally {
      setImportingChapters(false)
    }
  }

  const handleAutoBindChapter = async (options?: { autoDraftAfterBind?: boolean }) => {
    if (!bookIndex?.chapters?.length || !chapterId || !workbench || autoBindingChapter) return
    const ranked = [...bookIndex.chapters]
      .map((item) => ({
        item,
        score: scoreSourceChapterCandidate({
          chapterTitle: chapterMetaDraft.title || workbench.chapter.title,
          chapterSummary: chapterMetaDraft.summary || workbench.chapter.summary || '',
          sourceTitle: item.title || '',
          sourceSummary: item.summary || item.coreConflict || '',
          sourceChapter: item.chapter,
        }),
      }))
      .sort((left, right) => right.score - left.score)
    const best = ranked[0]
    if (!best || best.score < 45) {
      toast('没有找到足够可信的原文章节，请手动绑定。', 'warning')
      return
    }
    setAutoBindingChapter(true)
    try {
      if (options?.autoDraftAfterBind) {
        announceChapterAutoRelay('正在为这一章对上原文，接着会直接起镜头板并启动关键镜头。')
      }
      const nextTitle = chapterMetaDraft.title.trim() || best.item.title || workbench.chapter.title || '未命名章节'
      const nextSummary = chapterMetaDraft.summary.trim() || best.item.summary || best.item.coreConflict || ''
      await updateChapter(chapterId, {
        title: nextTitle,
        summary: nextSummary,
        status: workbench.chapter.status,
        sourceBookId: projectBooks[0]?.bookId || null,
        sourceBookChapter: best.item.chapter,
      })
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setChapters(refreshed.chapterItems)
        setWorkbench(refreshed.chapterWorkbench)
        setBookIndex(refreshed.nextBookIndex)
        setChapterMetaDraft({
          title: refreshed.chapterWorkbench.chapter.title || nextTitle,
          summary: refreshed.chapterWorkbench.chapter.summary || nextSummary,
          sourceBookChapter: String(best.item.chapter),
        })
        if (
          options?.autoDraftAfterBind
          && refreshed.chapterWorkbench.shots.length === 0
          && (
            boundSourceChapterDetail?.content?.trim()
            || boundSourceChapterDetail?.summary?.trim()
            || boundSourceChapterDetail?.coreConflict?.trim()
            || nextSummary.trim()
          )
        ) {
          announceChapterAutoRelay('本章已自动绑定原文，正在生成镜头板并准备启动关键镜头。')
          window.setTimeout(() => {
            void handleDraftShotsFromChapter({ silent: true, autoOpenPreferredShot: true, autoKickoffPreferredShot: true })
          }, 0)
          return
        }
        window.setTimeout(() => {
          void handleSyncChapterMemory({ silent: true, includeStyleAnchor: true })
        }, 0)
        if (options?.autoDraftAfterBind) {
          announceChapterAutoRelay('本章原文已自动绑定。', { autoClearMs: 2600 })
        }
      }
    } catch (error) {
      console.error('智能绑定章节失败', error)
      toast(describeError(error, '智能绑定章节失败，请稍后重试'), 'error')
    } finally {
      setAutoBindingChapter(false)
    }
  }

  const handleAutoBindAllProjectChapters = async () => {
    if (!bookIndex?.chapters?.length || !projectBooks[0]?.bookId || autoBindingAllChapters) return
    const sourceItems = bookIndex.chapters
    const unmapped = chapters.filter((chapter) => !chapter.sourceBookChapter)
    if (unmapped.length === 0) {
      toast('当前项目章节已经都有原文绑定。', 'info')
      return
    }
    setAutoBindingAllChapters(true)
    try {
      let changedCount = 0
      const usedSourceNos = new Set(
        chapters
          .map((item) => item.sourceBookChapter)
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
      )
      for (const chapter of unmapped) {
        const ranked = sourceItems
          .filter((item) => !usedSourceNos.has(item.chapter))
          .map((item) => ({
            item,
            score: scoreSourceChapterCandidate({
              chapterTitle: chapter.title,
              chapterSummary: chapter.summary || '',
              sourceTitle: item.title || '',
              sourceSummary: item.summary || item.coreConflict || '',
              sourceChapter: item.chapter,
            }),
          }))
          .sort((left, right) => right.score - left.score)
        const best = ranked[0]
        if (!best || best.score < 45) continue
        await updateChapter(chapter.id, {
          title: chapter.title || best.item.title || '未命名章节',
          summary: chapter.summary || best.item.summary || best.item.coreConflict || '',
          status: chapter.status,
          sourceBookId: projectBooks[0].bookId,
          sourceBookChapter: best.item.chapter,
        })
        usedSourceNos.add(best.item.chapter)
        changedCount += 1
      }
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setChapters(refreshed.chapterItems)
        setWorkbench(refreshed.chapterWorkbench)
        setBookIndex(refreshed.nextBookIndex)
      }
      toast(changedCount > 0 ? `已自动绑定 ${changedCount} 个章节。` : '没有找到足够可信的待绑定章节。', changedCount > 0 ? 'success' : 'warning')
    } catch (error) {
      console.error('自动绑定项目章节失败', error)
      toast(describeError(error, '自动绑定项目章节失败，请稍后重试'), 'error')
    } finally {
      setAutoBindingAllChapters(false)
    }
  }

  const handleCreateShot = async () => {
    if (!chapterId || creatingShot) return
    setCreatingShot(true)
    try {
      const created = await createChapterShot(chapterId, {})
      if (workbench && (workbench.chapter.status === 'draft' || workbench.chapter.status === 'planning')) {
        await updateChapter(chapterId, {
          status: 'producing',
        }).catch(() => null)
      }
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setChapters(refreshed.chapterItems)
        setWorkbench(refreshed.chapterWorkbench)
        setBookIndex(refreshed.nextBookIndex)
      }
      toast('镜头已创建。', 'success')
      spaNavigate(buildProjectChapterUrl(projectId, chapterId, created.id))
    } catch (error) {
      console.error('创建镜头失败', error)
      toast(describeError(error, '创建镜头失败，请稍后重试'), 'error')
    } finally {
      setCreatingShot(false)
    }
  }

  const handleDraftShotsFromChapter = async (options?: { silent?: boolean; autoOpenPreferredShot?: boolean; autoKickoffPreferredShot?: boolean }) => {
    if (!chapterId || draftingShots || creatingShot) return
    const draftItems = buildDraftShotsFromChapterText({
      chapterTitle,
      content: boundSourceChapterDetail?.content,
      summary: boundSourceChapterDetail?.summary || boundSourceChapterDetail?.coreConflict || chapterMetaDraft.summary,
    })
    if (draftItems.length === 0) {
      if (!options?.silent) {
        toast('当前章节文本窗口还不足以自动起稿镜头，请先绑定原文或补充章节摘要。', 'warning')
      }
      return
    }
    setDraftingShots(true)
    try {
      if (options?.autoKickoffPreferredShot) {
        announceChapterAutoRelay('正在根据本章文本建立镜头板，并会直接启动关键镜头。')
      }
      const existingSummaryKeys = new Set((workbench?.shots || []).map((item) => normalizeAssetName(item.summary || '').toLowerCase()).filter(Boolean))
      let createdCount = 0
      for (const draft of draftItems) {
        const summaryKey = normalizeAssetName(draft.summary).toLowerCase()
        if (summaryKey && existingSummaryKeys.has(summaryKey)) continue
        const created = await createChapterShot(chapterId, { title: draft.title })
        await updateChapterShot(chapterId, created.id, {
          title: draft.title,
          summary: draft.summary,
          status: 'queued',
        })
        existingSummaryKeys.add(summaryKey)
        createdCount += 1
      }
      if (createdCount > 0 && workbench && (workbench.chapter.status === 'draft' || workbench.chapter.status === 'planning')) {
        await updateChapter(chapterId, {
          status: 'producing',
        }).catch(() => null)
      }
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setChapters(refreshed.chapterItems)
        setWorkbench(refreshed.chapterWorkbench)
        setBookIndex(refreshed.nextBookIndex)
        window.setTimeout(() => {
          void handleSyncChapterMemory({ silent: true, includeStyleAnchor: true })
        }, 0)
        if ((options?.autoOpenPreferredShot || options?.autoKickoffPreferredShot) && refreshed.chapterWorkbench.shots.length > 0) {
          const preferredShotId = pickPreferredShotId(refreshed.chapterWorkbench.shots)
          if (preferredShotId) {
            const preferredShot = refreshed.chapterWorkbench.shots.find((item) => item.id === preferredShotId) || refreshed.chapterWorkbench.shots[0] || null
            if (preferredShot) {
              setShotDraft({
                shotId: preferredShot.id,
                title: preferredShot.title || '',
                summary: preferredShot.summary || '',
                status: preferredShot.status || 'queued',
              })
            }
            if (options?.autoKickoffPreferredShot) {
              pendingAutoKickoffShotIdRef.current = preferredShotId
              announceChapterAutoRelay('镜头板已就位，正在打开关键镜头并开始出图。')
            }
          }
        }
      }
      if (!options?.silent || createdCount > 0) {
        toast(createdCount > 0 ? `已根据本章文本起稿 ${createdCount} 个镜头。` : '当前章节镜头板已经包含这些文本片段，无需重复起稿。', createdCount > 0 ? 'success' : 'info')
      }
    } catch (error) {
      console.error('按章节文本起稿镜头失败', error)
      if (!options?.silent) {
        toast(describeError(error, '按章节文本起稿镜头失败，请稍后重试'), 'error')
      }
    } finally {
      setDraftingShots(false)
    }
  }

  React.useEffect(() => {
    if (!chapterId || !workbench || workbench.shots.length > 0) return
    if (!workbench.chapter.sourceBookChapter) return
    if (!boundSourceChapterDetail?.content?.trim() && !boundSourceChapterDetail?.summary?.trim() && !boundSourceChapterDetail?.coreConflict?.trim() && !chapterMetaDraft.summary.trim()) return
    if (autoDraftedChapterIdsRef.current.has(chapterId)) return
    autoDraftedChapterIdsRef.current.add(chapterId)
    announceChapterAutoRelay('已识别到本章文本，正在建立镜头板并启动关键镜头。')
    void handleDraftShotsFromChapter({ silent: true, autoOpenPreferredShot: true, autoKickoffPreferredShot: true })
  }, [
    announceChapterAutoRelay,
    boundSourceChapterDetail?.content,
    boundSourceChapterDetail?.coreConflict,
    boundSourceChapterDetail?.summary,
    chapterId,
    chapterMetaDraft.summary,
    workbench,
  ])

  const handleMoveShot = async (shotId: string, direction: 'up' | 'down') => {
    if (!chapterId || reorderingShotId) return
    setReorderingShotId(shotId)
    try {
      await moveChapterShot(chapterId, shotId, { direction })
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setChapters(refreshed.chapterItems)
        setWorkbench(refreshed.chapterWorkbench)
        setBookIndex(refreshed.nextBookIndex)
      }
      toast(direction === 'up' ? '镜头已上移。' : '镜头已下移。', 'success')
    } catch (error) {
      console.error('镜头排序失败', error)
      toast(describeError(error, '镜头排序失败，请稍后重试'), 'error')
    } finally {
      setReorderingShotId(null)
    }
  }

  const handleBatchUpdateShots = async (status: string) => {
    if (!chapterId || batchUpdatingShots) return
    const targetIds = selectedShotIds.length > 0 ? selectedShotIds : filteredShots.map((item) => item.id)
    if (targetIds.length === 0) {
      toast('请先选择镜头，或至少保留一组筛选结果。', 'warning')
      return
    }
    setBatchUpdatingShots(true)
    try {
      for (const shotId of targetIds) {
        const matched = workbench?.shots.find((item) => item.id === shotId)
        if (!matched) continue
        await updateChapterShot(chapterId, shotId, {
          title: matched.title || '',
          summary: matched.summary || '',
          status,
        })
      }
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) setWorkbench(refreshed.chapterWorkbench)
      setSelectedShotIds([])
    } catch (error) {
      console.error('批量更新镜头状态失败', error)
      toast(describeError(error, '批量更新镜头状态失败，请稍后重试'), 'error')
    } finally {
      setBatchUpdatingShots(false)
    }
  }

  const handleSaveShot = async () => {
    if (!chapterId || !shotDraft?.shotId || savingShot) return
    setSavingShot(true)
    try {
      await updateChapterShot(chapterId, shotDraft.shotId, {
        title: shotDraft.title.trim(),
        summary: shotDraft.summary.trim(),
        status: shotDraft.status,
      })
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setWorkbench(refreshed.chapterWorkbench)
      }
      toast('镜头信息已保存。', 'success')
    } catch (error) {
      console.error('保存镜头失败', error)
      toast(describeError(error, '保存镜头失败，请稍后重试'), 'error')
    } finally {
      setSavingShot(false)
    }
  }

  const handleDeleteShot = async () => {
    if (!chapterId || !shotDraft?.shotId || deletingShot) return
    const ok = window.confirm('删除这个镜头？')
    if (!ok) return
    setDeletingShot(true)
    try {
      await deleteChapterShot(chapterId, shotDraft.shotId)
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setWorkbench(refreshed.chapterWorkbench)
        const nextShot = refreshed.chapterWorkbench.shots[0] || null
        setShotDraft(nextShot ? {
          shotId: nextShot.id,
          title: nextShot.title || '',
          summary: nextShot.summary || '',
          status: nextShot.status || 'queued',
        } : null)
        spaNavigate(buildProjectChapterUrl(projectId, chapterId))
      }
      toast('镜头已删除。', 'success')
    } catch (error) {
      console.error('删除镜头失败', error)
      toast(describeError(error, '删除镜头失败，请稍后重试'), 'error')
    } finally {
      setDeletingShot(false)
    }
  }

  const handleDeleteChapter = async () => {
    if (!chapterId || deletingChapter) return
    const ok = window.confirm('删除当前章节？章节下镜头会一并删除。')
    if (!ok) return
    setDeletingChapter(true)
    try {
      await deleteChapter(chapterId)
      toast('章节已删除。', 'success')
      const remaining = chapters.filter((item) => item.id !== chapterId)
      const next = remaining[0] || null
      if (next) spaNavigate(buildProjectChapterUrl(projectId, next.id))
      else spaNavigate('/projects')
    } catch (error) {
      console.error('删除章节失败', error)
      toast(describeError(error, '删除章节失败，请稍后重试'), 'error')
    } finally {
      setDeletingChapter(false)
    }
  }

  const handleArchiveChapter = async () => {
    if (!chapterId || !workbench || deletingChapter) return
    try {
      const nextArchived = workbench.chapter.status !== 'archived'
      const updatedChapter = await updateChapter(chapterId, {
        status: nextArchived ? 'archived' : 'draft',
      })
      setChapters((prev) => prev.map((item) => item.id === chapterId ? updatedChapter : item))
      setWorkbench((prev) => prev ? {
        ...prev,
        chapter: updatedChapter,
      } : prev)
      try {
        const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
        if (refreshed) {
          setChapters(refreshed.chapterItems)
          setWorkbench(refreshed.chapterWorkbench)
          setBookIndex(refreshed.nextBookIndex)
        }
      } catch (error) {
        console.warn('章节状态已更新，但章节页刷新未完全成功', error)
      }
      toast(nextArchived ? '章节已归档。' : '章节已恢复到草稿。', 'success')
    } catch (error) {
      console.error('切换章节归档状态失败', error)
      toast(describeError(error, '切换章节归档状态失败，请稍后重试'), 'error')
    }
  }

  const handleReviewDecision = async (decision: 'approved' | 'rework') => {
    if (!chapterId || !shotDraft?.shotId || savingShot) return
    setSavingShot(true)
    try {
      await updateChapterShot(chapterId, shotDraft.shotId, {
        title: shotDraft.title.trim(),
        summary: shotDraft.summary.trim(),
        status: decision === 'approved' ? 'succeeded' : 'failed',
      })
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setWorkbench(refreshed.chapterWorkbench)
        const latest = refreshed.chapterWorkbench.shots.find((item) => item.id === shotDraft.shotId)
        if (latest) {
          setShotDraft({
            shotId: latest.id,
            title: latest.title || '',
            summary: latest.summary || '',
            status: latest.status || 'queued',
          })
        }
        if (decision === 'approved') {
          advanceToNextPriorityShot(refreshed.chapterWorkbench.shots, shotDraft.shotId)
        }
      }
    } catch (error) {
      console.error('提交镜头审核结果失败', error)
      toast(describeError(error, '提交镜头审核结果失败，请稍后重试'), 'error')
    } finally {
      setSavingShot(false)
    }
  }

  const persistShotRenderAsset = React.useCallback(async (input: {
    shotId: string
    prompt: string
    status: ProjectShotRenderAssetData['status']
    vendor?: string
    model?: string
    taskId?: string
    errorMessage?: string
    images?: TaskAssetDto[]
    selectedAssetIndex?: number
  }) => {
    if (!projectId || !chapterId || !workbench) return null
    const shot = workbench.shots.find((item) => item.id === input.shotId)
    if (!shot) return null
    const matched = pickShotRenderAsset(shotRenderAssets, input.shotId)
    const payload = toShotRenderAssetPayload({
      existing: matched?.data || null,
      projectId,
      chapterId,
      shotId: input.shotId,
      shotIndex: shot.shotIndex,
      shotTitle: shot.title,
      shotSummary: shot.summary,
      prompt: input.prompt,
      status: input.status,
      vendor: input.vendor,
      model: input.model,
      taskId: input.taskId,
      errorMessage: input.errorMessage,
      images: input.images,
      selectedAssetIndex: input.selectedAssetIndex,
    })
    const saved = matched?.asset
      ? await updateServerAssetData(matched.asset.id, payload)
      : await createServerAsset({
        name: buildShotRenderAssetName({ shotIndex: shot.shotIndex, shotTitle: shot.title }),
        projectId,
        data: payload,
      })
    setShotRenderAssets((prev) => {
      const next = prev.filter((item) => item.id !== saved.id)
      return [saved, ...next]
    })
    return saved
  }, [chapterId, projectId, shotRenderAssets, workbench])

  const requestChapterSpatialAnchorSummary = React.useCallback(async (input: {
    chapterTitle: string
    chapterSummary: string
    chapterContent: string
    characterNames: string[]
    sceneNames: string[]
    propNames: string[]
  }): Promise<{
    semanticSpatialSummary?: string
    macroEnvironment?: string
    continuityConstraints: string[]
  } | null> => {
    const chapterContent = String(input.chapterContent || '').trim()
    if (!chapterContent && !input.chapterSummary.trim()) return null
    try {
      const response = await agentsChat({
        prompt: [
          '你是章节空间锚点分析器。请只抽取可复用的稳定空间事实，不要写剧情解说，不要写镜头语言，不要编造文本里没有的内容。',
          `章节：${input.chapterTitle}`,
          input.chapterSummary ? `章节摘要：${input.chapterSummary}` : '',
          input.sceneNames.length ? `候选场景线索：${input.sceneNames.join('、')}` : '',
          input.characterNames.length ? `候选人物：${input.characterNames.join('、')}` : '',
          input.propNames.length ? `候选道具：${input.propNames.join('、')}` : '',
          `正文：${chapterContent.slice(0, 1800)}`,
          '输出必须是 JSON 对象，且只能包含这三个字段：',
          'semanticSpatialSummary: 1 句话，描述最稳定、可复用的空间结构与氛围',
          'macroEnvironment: 1 个短句，描述宏观环境类型，例如“乡村低层村屋与田地，被开发工地侵蚀”',
          'continuityConstraints: 3-5 条字符串数组，描述后续镜头必须继承的空间连续性约束',
        ].filter(Boolean).join('\n'),
        chatContext: {
          workspaceAction: 'chapter_asset_generation',
          currentProjectName: workbench?.project.name,
        },
        requiredSkills: ['tapcanvas-storyboard-expert'],
        forceAssetGeneration: false,
      })
      return parseAgentsSpatialAnchorSummary(response.text || '')
    } catch (error) {
      console.warn('章节空间锚点 agents 摘要生成失败', error)
      return null
    }
  }, [workbench?.project.name])

  const requestShotExecutionPrompt = React.useCallback(async (input: {
    basePrompt: string
    chapterTitle: string
    shotTitle: string
    shotSummary: string
    chapterSummary: string
    chapterContent: string
    anchorData?: ChapterBaseSceneAnchorVersionData | null
  }): Promise<string | null> => {
    const basePrompt = String(input.basePrompt || '').trim()
    if (!basePrompt) return null
    try {
      const response = await agentsChat({
        prompt: [
          '你是漫剧镜头执行 prompt specialist。你的任务不是解释需求，而是把事实约束重写成能直接给图片模型执行的镜头 prompt。',
          '输出必须是纯 prompt 正文，不要加标题，不要加 JSON，不要加解释，不要加“以下是 prompt”。',
          '要求：画面语言自然、具体、可执行，优先描述主体、空间、镜位、景别、动作、光线、材质、氛围与连续性。',
          '要求：如果已有章节基础空间锚点，必须把它内化成镜头里的空间连续性，而不是重复罗列约束清单。',
          '要求：保留明确镜头意图，但不要写成僵硬 checklist，不要写成项目说明书，不要写成剧情摘要。',
          '禁止：清晰文字、水印、标题字、海报感、概念设定图口吻、与空间锚点冲突的建筑漂移。',
          `章节：${input.chapterTitle}`,
          input.chapterSummary ? `章节摘要：${input.chapterSummary}` : '',
          input.shotTitle ? `镜头标题：${input.shotTitle}` : '',
          input.shotSummary ? `镜头摘要：${input.shotSummary}` : '',
          input.anchorData?.semanticSpatialSummary ? `章节空间摘要：${input.anchorData.semanticSpatialSummary}` : '',
          input.anchorData?.macroEnvironment ? `宏观环境：${input.anchorData.macroEnvironment}` : '',
          input.anchorData?.continuityConstraints?.length
            ? `空间连续性约束：${input.anchorData.continuityConstraints.join('；')}`
            : '',
          input.chapterContent ? `原文片段：${input.chapterContent.slice(0, 1200)}` : '',
          `基础事实草稿：\n${basePrompt}`,
        ].filter(Boolean).join('\n'),
        chatContext: {
          workspaceAction: 'chapter_asset_generation',
          currentProjectName: workbench?.project.name,
        },
        requiredSkills: ['tapcanvas-storyboard-expert'],
        forceAssetGeneration: false,
      })
      const text = String(response.text || '').trim()
      return text || null
    } catch (error) {
      console.warn('镜头执行 prompt agents 精修失败', error)
      return null
    }
  }, [workbench?.project.name])

  const ensureCurrentChapterBaseSceneAnchor = React.useCallback(async (): Promise<{
    asset: MaterialAssetDto
    version: number
    data: ChapterBaseSceneAnchorVersionData
  } | null> => {
    if (!projectId || !chapterId || !workbench) return null

    const anchorName = buildChapterBaseSceneAnchorName({ chapterTitle })
    const existingSceneAssets = await listMaterialAssets({ projectId, kind: 'scene' })
    let existingAnchorAsset: MaterialAssetDto | null = null
    let existingAnchorData: ChapterBaseSceneAnchorVersionData | null = null

    for (const asset of existingSceneAssets) {
      if (existingAnchorAsset) break
      const latestVersion = asset.latestVersion || null
      const anchorData = readChapterBaseSceneAnchorVersion(latestVersion)
      if (anchorData && anchorData.chapterId === chapterId) {
        existingAnchorAsset = asset
        existingAnchorData = anchorData
        break
      }
      if (normalizeAssetName(asset.name) === normalizeAssetName(anchorName) && anchorData) {
        existingAnchorAsset = asset
        existingAnchorData = anchorData
        break
      }
    }

    if (existingAnchorAsset && existingAnchorData) {
      setSceneAssets(existingSceneAssets)
      return {
        asset: existingAnchorAsset,
        version: existingAnchorAsset.currentVersion,
        data: existingAnchorData,
      }
    }

    const sourceChapterMeta = (() => {
      const sourceChapterNo = workbench.chapter.sourceBookChapter
      if (!sourceChapterNo || !bookIndex?.chapters?.length) return null
      return bookIndex.chapters.find((item) => item.chapter === sourceChapterNo) || null
    })()
    const characterNames = (boundSourceChapterDetail?.characters || sourceChapterMeta?.characters || [])
      .map((item) => normalizeAssetName(item.name || ''))
      .filter(Boolean)
      .slice(0, 6)
    const sceneNames = [
      ...((boundSourceChapterDetail?.scenes || sourceChapterMeta?.scenes || []).map((item) => normalizeAssetName(item.name || ''))),
      ...((boundSourceChapterDetail?.locations || []).map((item) => normalizeAssetName(item.name || ''))),
    ].filter(Boolean).slice(0, 6)
    const propNames = (boundSourceChapterDetail?.props || sourceChapterMeta?.props || [])
      .map((item) => normalizeAssetName(item.name || ''))
      .filter(Boolean)
      .slice(0, 6)
    const chapterSummary = String(
      boundSourceChapterDetail?.summary
      || boundSourceChapterDetail?.coreConflict
      || workbench.chapter.summary
      || chapterMetaDraft.summary,
    ).trim()
    const chapterContent = String(boundSourceChapterDetail?.content || '').trim()
    const spatialSummary = await requestChapterSpatialAnchorSummary({
      chapterTitle,
      chapterSummary,
      chapterContent,
      sceneNames,
      characterNames,
      propNames,
    })
    const anchorPrompt = buildChapterBaseSceneAnchorPrompt({
      chapterTitle,
      chapterSummary,
      chapterConflict: boundSourceChapterDetail?.coreConflict || workbench.chapter.summary || '',
      chapterContent,
      sceneNames,
      characterNames,
      propNames,
      artStyleName: projectSetup.artStyleName,
      styleDirectives: projectSetup.styleDirectives,
      directorManual: projectSetup.directorManual,
      styleBible: bookIndex?.assets?.styleBible || null,
    })

    const started = await runPublicTaskWithAuth({
      request: {
        kind: 'text_to_image',
        prompt: anchorPrompt,
        extras: {
          ...(projectSetup.imageModel ? { modelAlias: projectSetup.imageModel } : {}),
          aspectRatio: projectSetup.videoRatio,
          imageQuality: projectSetup.imageQuality,
          chapterId,
          anchorType: 'chapter_base_space',
        },
      },
    })
    const taskId = started.result?.id
    const vendor = started.vendor
    if (!taskId) throw new Error('章节基础空间锚点未返回任务 ID。')

    let finalResult = started.result
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (finalResult.status === 'succeeded' || finalResult.status === 'failed') break
      await new Promise((resolve) => window.setTimeout(resolve, 1500))
      const polled = await fetchPublicTaskResultWithAuth({
        taskId,
        vendor,
        taskKind: 'text_to_image',
        prompt: anchorPrompt,
      })
      finalResult = polled.result
    }

    if (finalResult.status !== 'succeeded') {
      const message =
        typeof finalResult.raw?.message === 'string' && finalResult.raw.message.trim()
          ? finalResult.raw.message.trim()
          : '章节基础空间锚点生成失败，请稍后重试'
      throw new Error(message)
    }

    const primaryAsset = (finalResult.assets || []).find((item) => item.type === 'image' && typeof item.url === 'string' && item.url.trim()) || null
    const imageUrl = primaryAsset?.url?.trim() || ''
    if (!imageUrl) {
      throw new Error('章节基础空间锚点没有返回可用图片 URL。')
    }

    const versionData: ChapterBaseSceneAnchorVersionData = {
      imageUrl,
      prompt: anchorPrompt,
      chapterId,
      chapterTitle,
      sourceBookChapter: workbench.chapter.sourceBookChapter || null,
      anchorType: 'chapter_base_space',
      extractedFrom: 'chapterSpatialAnchor',
      sceneNames,
      characterNames,
      propNames,
      styleHints: [
        projectSetup.artStyleName,
        projectSetup.styleDirectives,
        bookIndex?.assets?.styleBible?.styleName,
        ...((bookIndex?.assets?.styleBible?.visualDirectives || []).slice(0, 4)),
      ].filter((item): item is string => Boolean(String(item || '').trim())),
      semanticSpatialSummary: spatialSummary?.semanticSpatialSummary,
      macroEnvironment: spatialSummary?.macroEnvironment,
      continuityConstraints: spatialSummary?.continuityConstraints || [],
      generatedAt: new Date().toISOString(),
    }

    let asset: MaterialAssetDto
    let version: number
    if (existingAnchorAsset) {
      await createMaterialVersion(existingAnchorAsset.id, {
        data: versionData,
        note: `刷新章节基础空间锚点：${chapterTitle}`,
      })
      asset = existingAnchorAsset
      version = existingAnchorAsset.currentVersion + 1
    } else {
      const created = await createMaterialAsset({
        projectId,
        kind: 'scene',
        name: anchorName,
        initialData: versionData,
        note: '由章节基础空间锚点生成',
      })
      asset = created.asset
      version = created.version.version
    }

    const refreshedScenes = await listMaterialAssets({ projectId, kind: 'scene' }).catch(() => existingSceneAssets)
    setSceneAssets(refreshedScenes)
    return {
      asset,
      version,
      data: versionData,
    }
  }, [
    boundSourceChapterDetail?.characters,
    boundSourceChapterDetail?.content,
    boundSourceChapterDetail?.coreConflict,
    boundSourceChapterDetail?.locations,
    boundSourceChapterDetail?.props,
    boundSourceChapterDetail?.scenes,
    boundSourceChapterDetail?.summary,
    chapterId,
    chapterMetaDraft.summary,
    chapterTitle,
    bookIndex?.assets?.styleBible,
    bookIndex?.chapters,
    projectId,
    projectSetup.artStyleName,
    projectSetup.directorManual,
    projectSetup.imageModel,
    projectSetup.imageQuality,
    projectSetup.styleDirectives,
    projectSetup.videoRatio,
    requestChapterSpatialAnchorSummary,
    workbench,
  ])

  const handleGenerateShotImage = async () => {
    if (!workbench || !shotDraft?.shotId || generatingShotImage) return
    const prompt = shotRenderPrompt.trim()
    if (!prompt) {
      toast('请先整理镜头 prompt。', 'warning')
      return
    }
    if (!chapterPrerequisiteStatus.ready) {
      toast('检测到前置资产未完备，系统正在自动补齐并继续执行。', 'info')
      try {
        if (!workbench.chapter.sourceBookChapter) {
          await handleAutoBindChapter({ autoDraftAfterBind: false })
        }
        if (workbench.shots.length === 0) {
          await handleDraftShotsFromChapter({
            silent: true,
            autoOpenPreferredShot: true,
            autoKickoffPreferredShot: false,
          })
        }
        await handleSyncChapterMemory({ silent: true, includeStyleAnchor: true })
      } catch (error) {
        console.warn('自动补齐前置资产失败，将继续尝试当前镜头生成', error)
      }
    }
    let refinedPrompt = prompt
    setGeneratingShotImage(true)
    try {
      const workbenchShot = workbench.shots.find((item) => item.id === shotDraft.shotId) || null
      if (workbenchShot && (
        normalizeAssetName(workbenchShot.title || '') !== normalizeAssetName(shotDraft.title || '')
        || normalizeAssetName(workbenchShot.summary || '') !== normalizeAssetName(shotDraft.summary || '')
        || (workbenchShot.status || 'queued') !== shotDraft.status
      )) {
        await updateChapterShot(chapterId, shotDraft.shotId, {
          title: shotDraft.title.trim(),
          summary: shotDraft.summary.trim(),
          status: shotDraft.status,
        })
      }
      await handleSyncChapterMemory({ silent: true })
      const baseSceneAnchor = await ensureCurrentChapterBaseSceneAnchor()
      refinedPrompt =
        await requestShotExecutionPrompt({
          basePrompt: prompt,
          chapterTitle,
          shotTitle: shotDraft.title.trim(),
          shotSummary: shotDraft.summary.trim(),
          chapterSummary: String(
            boundSourceChapterDetail?.summary
            || boundSourceChapterDetail?.coreConflict
            || workbench.chapter.summary
            || chapterMetaDraft.summary,
          ).trim(),
          chapterContent: String(boundSourceChapterDetail?.content || '').trim(),
          anchorData: baseSceneAnchor?.data || null,
        })
        || prompt
      if (suggestedShotMemoryAssets.length > 0 || baseSceneAnchor) {
        const mergedRefs = new Map<string, { assetId: string; assetVersion: number }>()
        for (const item of currentShotRefs) {
          mergedRefs.set(item.assetId, {
            assetId: item.assetId,
            assetVersion: item.assetVersion,
          })
        }
        for (const item of suggestedShotMemoryAssets) {
          mergedRefs.set(item.asset.id, {
            assetId: item.asset.id,
            assetVersion: item.version,
          })
        }
        if (baseSceneAnchor) {
          mergedRefs.set(baseSceneAnchor.asset.id, {
            assetId: baseSceneAnchor.asset.id,
            assetVersion: baseSceneAnchor.version,
          })
        }
        const savedRefs = await upsertShotMaterialRefs({
          projectId,
          shotId: shotDraft.shotId,
          refs: Array.from(mergedRefs.values()),
        })
        setCurrentShotRefs(savedRefs)
      }
      const memoryReferenceImages = suggestedShotMemoryAssets
        .map((item) => item.previewImageUrl)
        .filter((item): item is string => Boolean(String(item || '').trim()))
      const referenceImages = Array.from(
        new Set([
          ...(baseSceneAnchor ? [baseSceneAnchor.data.imageUrl] : []),
          ...memoryReferenceImages,
        ].filter((item) => typeof item === 'string' && item.trim())),
      ).slice(0, 6)
      await persistShotRenderAsset({
        shotId: shotDraft.shotId,
        prompt: refinedPrompt,
        status: 'running',
      })
      const started = await runPublicTaskWithAuth({
        request: {
          kind: 'text_to_image',
          prompt: refinedPrompt,
          extras: {
            ...(projectSetup.imageModel ? { modelAlias: projectSetup.imageModel } : {}),
            aspectRatio: projectSetup.videoRatio,
            imageQuality: projectSetup.imageQuality,
            chapterId,
            shotId: shotDraft.shotId,
            ...(referenceImages.length > 0 ? { referenceImages } : {}),
          },
        },
      })
      const taskId = started.result?.id
      const vendor = started.vendor
      if (!taskId) throw new Error('未返回任务 ID，无法轮询结果。')
      let finalResult = started.result
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (finalResult.status === 'succeeded' || finalResult.status === 'failed') break
        await new Promise((resolve) => window.setTimeout(resolve, 1500))
        const polled = await fetchPublicTaskResultWithAuth({
          taskId,
          vendor,
          taskKind: 'text_to_image',
          prompt: refinedPrompt,
        })
        finalResult = polled.result
      }
      if (finalResult.status !== 'succeeded') {
        const message =
          typeof finalResult.raw?.message === 'string' && finalResult.raw.message.trim()
            ? finalResult.raw.message.trim()
            : '镜头出图失败，请稍后重试'
        await persistShotRenderAsset({
          shotId: shotDraft.shotId,
          prompt: refinedPrompt,
          status: 'failed',
          vendor,
          model: projectSetup.imageModel || undefined,
          taskId,
          errorMessage: message,
        })
        toast(message, 'error')
        return
      }
      const savedShotRenderAsset = await persistShotRenderAsset({
        shotId: shotDraft.shotId,
        prompt: refinedPrompt,
        status: 'succeeded',
        vendor,
        model: projectSetup.imageModel || undefined,
        taskId,
        images: finalResult.assets || [],
        selectedAssetIndex: 0,
      })
      if (savedShotRenderAsset) {
        try {
          await upsertCurrentShotSceneAsset({
            shotId: shotDraft.shotId,
            renderAsset: savedShotRenderAsset,
          })
          const [nextScenes, nextShotRefs] = await Promise.all([
            listMaterialAssets({ projectId, kind: 'scene' }).catch(() => sceneAssets),
            listShotMaterialRefs({ projectId, shotId: shotDraft.shotId }).catch(() => currentShotRefs),
          ])
          setSceneAssets(nextScenes)
          setCurrentShotRefs(nextShotRefs)
        } catch (error) {
          console.warn('镜头结果自动沉淀公共场景失败', error)
        }
      }
    } catch (error) {
      console.error('镜头出图失败', error)
      if (canUseLocalDemoShotFallback(error) && shotDraft?.shotId) {
        const demoImages = buildLocalDemoShotRenderAssets({
          chapterTitle,
          shotTitle: shotDraft.title,
          shotSummary: shotDraft.summary,
          artStyleName: projectSetup.artStyleName,
          aspectRatio: projectSetup.videoRatio,
        })
        await persistShotRenderAsset({
          shotId: shotDraft.shotId,
          prompt: refinedPrompt,
          status: 'succeeded',
          vendor: 'local-demo',
          model: 'local-demo-fallback',
          images: demoImages,
          selectedAssetIndex: 0,
        }).catch(() => {})
        toast('当前账号积分不足，已自动切到本地演示图继续验证章节链路。', 'warning')
        return
      }
      const message = error instanceof Error ? error.message : '镜头出图失败，请稍后重试'
      if (shotDraft?.shotId) {
        await persistShotRenderAsset({
          shotId: shotDraft.shotId,
          prompt: refinedPrompt,
          status: 'failed',
          errorMessage: message,
        }).catch(() => {})
      }
      toast(message, 'error')
    } finally {
      setGeneratingShotImage(false)
    }
  }

  const currentShotRender = shotDraft ? pickShotRenderAsset(shotRenderAssets, shotDraft.shotId) : null
  const currentShotImages = currentShotRender?.data.images || []
  const currentShotPreviewUrl =
    String(currentShotRender?.data.selectedImageUrl || '').trim()
    || String(currentShotImages[0]?.thumbnailUrl || currentShotImages[0]?.url || '').trim()
  const shotHasRenderResult = Boolean(currentShotRender?.data.images?.length)
  const shotWorkspacePrimaryActionLabel = shotHasRenderResult ? '确认当前结果并继续' : '生成当前镜头'
  const shotWorkspacePrimaryActionHint = shotHasRenderResult
    ? '会自动确认当前选图、写入项目共享场景，并切到下一个优先镜头。'
    : '会自动保存当前镜头信息、补齐命中资产，并开始出图。'

  React.useEffect(() => {
    const pendingShotId = pendingAutoKickoffShotIdRef.current
    if (!pendingShotId || shotDraft?.shotId !== pendingShotId) return
    pendingAutoKickoffShotIdRef.current = null
    if (currentShotRender?.data.images?.length || generatingShotImage) return
    announceChapterAutoRelay('正在启动当前关键镜头。')
    window.setTimeout(() => {
      void handleGenerateShotImage()
    }, 120)
  }, [announceChapterAutoRelay, currentShotRender?.data.images?.length, generatingShotImage, shotDraft?.shotId])

  const handleSelectShotImage = async (index: number) => {
    if (!shotDraft?.shotId || savingShotSelection) return
    const matched = pickShotRenderAsset(shotRenderAssets, shotDraft.shotId)
    if (!matched || matched.data.images.length === 0) return
    setSavingShotSelection(true)
    try {
      await persistShotRenderAsset({
        shotId: shotDraft.shotId,
        prompt: matched.data.prompt,
        status: matched.data.status,
        vendor: matched.data.vendor,
        model: matched.data.model,
        taskId: matched.data.taskId,
        errorMessage: matched.data.errorMessage,
        selectedAssetIndex: index,
      })
    } catch (error) {
      console.error('切换镜头结果失败', error)
      toast(describeError(error, '切换镜头结果失败，请稍后重试'), 'error')
    } finally {
      setSavingShotSelection(false)
    }
  }

  const upsertCurrentShotSceneAsset = React.useCallback(async (input?: {
    shotId?: string
    renderAsset?: ServerAssetDto | null
  }) => {
    const effectiveShotId = String(input?.shotId || shotDraft?.shotId || '').trim()
    if (!projectId || !chapterId || !effectiveShotId) {
      throw new Error('当前镜头不存在')
    }
    const matched =
      input?.renderAsset && normalizeProjectShotRenderAssetData(input.renderAsset.data)
        ? {
            asset: input.renderAsset,
            data: normalizeProjectShotRenderAssetData(input.renderAsset.data) as ProjectShotRenderAssetData,
          }
        : pickShotRenderAsset(shotRenderAssets, effectiveShotId)
    const selectedImageUrl = matched?.data.selectedImageUrl
    if (!matched || !selectedImageUrl) {
      throw new Error('当前镜头还没有选中的结果图。')
    }
    const shot = workbench?.shots.find((item) => item.id === effectiveShotId) || null
    if (!shot) throw new Error('当前镜头不存在')
    const assetName = `${chapterTitle} / ${shot.title || `Shot ${shot.shotIndex + 1}`}`
    const existingAssets = await listMaterialAssets({ projectId, kind: 'scene' })
    const existing = existingAssets.find((item) => item.name.trim() === assetName) || null
    const versionData = {
      imageUrl: selectedImageUrl,
      prompt: matched.data.prompt,
      chapterId,
      chapterTitle,
      shotId: shot.id,
      shotIndex: shot.shotIndex,
      shotTitle: shot.title || '',
      sourceAssetId: matched.asset.id,
      promotedAt: new Date().toISOString(),
    }
    let asset: MaterialAssetDto
    let assetVersionToBind = 1
    if (existing) {
      await createMaterialVersion(existing.id, {
        data: versionData,
        note: `镜头结果同步 ${assetName}`,
      })
      asset = existing
      assetVersionToBind = existing.currentVersion + 1
    } else {
      const created = await createMaterialAsset({
        projectId,
        kind: 'scene',
        name: assetName,
        initialData: versionData,
        note: '由章节镜头结果提升',
      })
      asset = created.asset
      assetVersionToBind = created.version.version
    }
    await upsertShotMaterialRefs({
      projectId,
      shotId: shot.id,
      refs: [{ assetId: asset.id, assetVersion: assetVersionToBind }],
    })
    return {
      created: !existing,
      shotId: shot.id,
    }
  }, [chapterId, chapterTitle, projectId, shotDraft, shotRenderAssets, workbench])

  const handlePromoteShotResultToSceneAsset = async () => {
    if (!projectId || !chapterId || !shotDraft?.shotId || promotingShotResult) return
    setPromotingShotResult(true)
    try {
      const promotion = await upsertCurrentShotSceneAsset()
      toast(promotion.created ? '已创建场景物料并绑定到当前镜头。' : '已更新场景物料并绑定到当前镜头。', 'success')
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setChapters(refreshed.chapterItems)
        setWorkbench(refreshed.chapterWorkbench)
        setBookIndex(refreshed.nextBookIndex)
        setShotRenderAssets(refreshed.shotRenderAssets)
        advanceToNextPriorityShot(refreshed.chapterWorkbench.shots, shotDraft.shotId)
      }
    } catch (error) {
      console.error('提升镜头结果失败', error)
      toast(describeError(error, '提升镜头结果失败，请稍后重试'), 'error')
    } finally {
      setPromotingShotResult(false)
    }
  }

  const handleConfirmShotResultAndContinue = async () => {
    if (!chapterId || !shotDraft?.shotId || confirmingShotResult) return
    const matched = pickShotRenderAsset(shotRenderAssets, shotDraft.shotId)
    if (!matched?.data.selectedImageUrl) {
      toast('请先选中一张当前最佳结果。', 'warning')
      return
    }
    setConfirmingShotResult(true)
    try {
      await updateChapterShot(chapterId, shotDraft.shotId, {
        title: shotDraft.title.trim(),
        summary: shotDraft.summary.trim(),
        status: 'succeeded',
      })
      await upsertCurrentShotSceneAsset()
      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setChapters(refreshed.chapterItems)
        setWorkbench(refreshed.chapterWorkbench)
        setBookIndex(refreshed.nextBookIndex)
        setShotRenderAssets(refreshed.shotRenderAssets)
        window.setTimeout(() => {
          void handleSyncChapterMemory({ silent: true, includeStyleAnchor: true })
        }, 0)
        const latest = refreshed.chapterWorkbench.shots.find((item) => item.id === shotDraft.shotId)
        if (latest) {
          setShotDraft({
            shotId: latest.id,
            title: latest.title || '',
            summary: latest.summary || '',
            status: latest.status || 'queued',
          })
        }
        const nextPendingShotId = pickNextPriorityShotId({
          shots: refreshed.chapterWorkbench.shots,
          recommendedShotIds,
          currentShotId: shotDraft.shotId,
        })
        advanceToNextPriorityShot(refreshed.chapterWorkbench.shots, shotDraft.shotId)
        const remaining = refreshed.chapterWorkbench.shots.filter((item) => item.status !== 'succeeded').length
        if (remaining > 0) {
          if (nextPendingShotId) {
            pendingAutoKickoffShotIdRef.current = nextPendingShotId
            announceChapterAutoRelay(`当前镜头已确认，正在接力下一个待处理镜头。`, {
              autoClearMs: 5200,
            })
            renderSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
          toast(`当前镜头已确认。本章还剩 ${remaining} 个镜头待收口。`, 'success')
        } else {
          announceChapterAutoRelay(nextChapter ? '本章已全部收口，可直接进入下一章。' : '本章已全部收口，可继续做整章深化或补齐后续章节。', {
            autoClearMs: 5200,
          })
          chapterStageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          toast('当前镜头已确认，本章已全部收口。', 'success')
        }
      }
    } catch (error) {
      console.error('确认镜头结果失败', error)
      toast(describeError(error, '确认镜头结果失败，请稍后重试'), 'error')
    } finally {
      setConfirmingShotResult(false)
    }
  }

  const handleKickoffCurrentChapter = React.useCallback(async () => {
    if (!workbench || workbench.shots.length === 0) {
      shotsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    if (!shotDraft?.shotId) {
      const preferredShotId = pickPreferredShotId(workbench.shots)
      if (preferredShotId) {
        const preferredShot = workbench.shots.find((item) => item.id === preferredShotId) || workbench.shots[0] || null
        if (preferredShot) {
          setShotDraft({
            shotId: preferredShot.id,
            title: preferredShot.title || '',
            summary: preferredShot.summary || '',
            status: preferredShot.status || 'queued',
          })
        }
      }
      return
    }
    renderSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (!currentShotRender?.data.images?.length) {
      announceChapterAutoRelay('正在启动当前关键镜头。', { autoClearMs: 5000 })
      await handleGenerateShotImage()
      return
    }
    announceChapterAutoRelay('当前关键镜头已有结果图，可直接继续确认或深化。', { autoClearMs: 3200 })
  }, [announceChapterAutoRelay, chapterId, currentShotRender?.data.images?.length, projectId, shotDraft?.shotId, workbench])

  const handleFillChapterPrerequisite = React.useCallback(async (key: ChapterPrerequisiteKey) => {
    if (!projectId || !chapterId || fillingPrerequisiteKey) return
    setFillingPrerequisiteKey(key)
    try {
      if (key === 'source') {
        bindingSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        await handleAutoBindChapter({ autoDraftAfterBind: false })
        return
      }
      if (key === 'text') {
        bindingSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        if (!workbench?.chapter.sourceBookChapter) {
          await handleAutoBindChapter({ autoDraftAfterBind: false })
        }
        return
      }
      if (key === 'shots') {
        shotsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        await handleDraftShotsFromChapter({ silent: false, autoOpenPreferredShot: true, autoKickoffPreferredShot: false })
        return
      }
      if (key === 'scene_anchor') {
        await ensureCurrentChapterBaseSceneAnchor()
        const refreshedScenes = await listMaterialAssets({ projectId, kind: 'scene' }).catch(() => sceneAssets)
        setSceneAssets(refreshedScenes)
        const nextLatestVersions: Record<string, MaterialAssetVersionDto | null> = {}
        for (const asset of [...refreshedScenes, ...characterAssets, ...propAssets, ...styleAssets]) {
          nextLatestVersions[asset.id] = asset.latestVersion || null
        }
        setAssetLatestVersions(nextLatestVersions)
        toast('已补齐本章场景锚点。', 'success')
        return
      }
      window.location.href = buildStudioUrl({
        projectId,
        ownerType: 'chapter',
        ownerId: chapterId,
      })
    } catch (error) {
      console.error('补齐章节前置资产失败', error)
      toast(describeError(error, '补齐章节前置资产失败，请稍后重试'), 'error')
    } finally {
      setFillingPrerequisiteKey(null)
    }
  }, [
    chapterId,
    characterAssets,
    ensureCurrentChapterBaseSceneAnchor,
    fillingPrerequisiteKey,
    handleAutoBindChapter,
    handleDraftShotsFromChapter,
    projectId,
    propAssets,
    sceneAssets,
    styleAssets,
    workbench?.chapter.sourceBookChapter,
  ])

  React.useEffect(() => {
    if (!projectId || !chapterId || !workbench) return
    if (consumedChapterHandoffRef.current === chapterId) return
    let handoff: { chapterId?: string; at?: number } | null = null
    try {
      const raw = window.sessionStorage.getItem(buildChapterHandoffStorageKey(projectId))
      if (!raw) return
      handoff = JSON.parse(raw) as { chapterId?: string; at?: number }
    } catch {
      return
    }
    if (!handoff || handoff.chapterId !== chapterId) return
    if (typeof handoff.at === 'number' && Date.now() - handoff.at > 5 * 60 * 1000) {
      try {
        window.sessionStorage.removeItem(buildChapterHandoffStorageKey(projectId))
      } catch {}
      return
    }
    consumedChapterHandoffRef.current = chapterId
    try {
      window.sessionStorage.removeItem(buildChapterHandoffStorageKey(projectId))
    } catch {}
    window.setTimeout(() => {
      if (!workbench.chapter.sourceBookChapter) {
        announceChapterAutoRelay('已从上一章接力，正在为这一章对上原文。')
        void handleAutoBindChapter({ autoDraftAfterBind: true })
        return
      }
      if (workbench.shots.length === 0) {
        announceChapterAutoRelay('已从上一章接力，正在生成镜头板并启动关键镜头。')
        void handleDraftShotsFromChapter({ silent: true, autoOpenPreferredShot: true, autoKickoffPreferredShot: true })
        return
      }
      announceChapterAutoRelay('已从上一章接力，正在恢复当前关键镜头。', { autoClearMs: 5000 })
      void handleKickoffCurrentChapter()
    }, 180)
  }, [announceChapterAutoRelay, chapterId, handleKickoffCurrentChapter, projectId, workbench])

  const handleSyncChapterMemory = async (options?: { silent?: boolean; includeStyleAnchor?: boolean }) => {
    if (!projectId || syncingChapterMemory) return
    let chapterCharacters = (boundSourceChapterDetail?.characters || mappedSourceChapterMeta?.characters || [])
      .map((item) => ({
        name: normalizeAssetName(item.name || ''),
        description: String(item.description || '').trim(),
      }))
      .filter((item) => item.name)
    let chapterProps = (boundSourceChapterDetail?.props || mappedSourceChapterMeta?.props || [])
      .map((item) => ({
        name: normalizeAssetName(item.name || ''),
        description: String(item.description || '').trim(),
      }))
      .filter((item) => item.name)
    let chapterScenes = (boundSourceChapterDetail?.scenes || boundSourceChapterDetail?.locations || mappedSourceChapterMeta?.scenes || [])
      .map((item) => ({
        name: normalizeAssetName(item.name || ''),
        description: String(item.description || '').trim(),
      }))
      .filter((item) => item.name)

    const shouldIncludeStyleAnchor = options?.includeStyleAnchor !== false
    const styleAnchorName = buildProjectStyleAnchorName({
      artStyleName: projectSetup.artStyleName,
      styleBibleName: styleBible?.styleName,
    })
    const styleAnchorDescription = [
      projectSetup.artStyleName ? `项目画风：${projectSetup.artStyleName}` : '',
      projectSetup.styleDirectives ? `视觉规则：${projectSetup.styleDirectives}` : '',
      styleBible?.styleName ? `风格圣经：${styleBible.styleName}` : '',
      Array.isArray(styleBible?.visualDirectives) && styleBible.visualDirectives.length > 0
        ? `风格圣经视觉规则：${styleBible.visualDirectives.slice(0, 6).join('；')}`
        : '',
      Array.isArray(styleBible?.consistencyRules) && styleBible.consistencyRules.length > 0
        ? `一致性规则：${styleBible.consistencyRules.slice(0, 6).join('；')}`
        : '',
    ].filter(Boolean).join('\n')

    const fallbackChapterContent = String(boundSourceChapterDetail?.content || '').trim()
    const fallbackChapterSummary = String(
      boundSourceChapterDetail?.summary
      || boundSourceChapterDetail?.coreConflict
      || chapterMetaDraft.summary
      || workbench?.chapter.summary
      || '',
    ).trim()
    if (
      chapterCharacters.length === 0
      && chapterProps.length === 0
      && chapterScenes.length === 0
      && (fallbackChapterContent || fallbackChapterSummary)
    ) {
      try {
        const extraction = await agentsChat({
          prompt: [
            '你是章节记忆线索提取器。请基于正文抽取“可复用资产”，不要写剧情分析，不要补脑。',
            `章节：${chapterTitle}`,
            fallbackChapterSummary ? `章节摘要：${fallbackChapterSummary}` : '',
            `正文：${fallbackChapterContent.slice(0, 2600)}`,
            '输出必须是 JSON 对象，且只能包含三个字段：characters、scenes、props。',
            '每个字段是数组，每个元素是 { "name": string, "description": string }。',
            '只保留可复用的稳定名称；去掉“某人/有人/他们/地方/那里/东西”等泛词。',
            '每个数组最多 12 条。',
          ].filter(Boolean).join('\n'),
          chatContext: {
            workspaceAction: 'chapter_asset_generation',
            currentProjectName: workbench?.project.name,
          },
          requiredSkills: ['tapcanvas-storyboard-expert'],
          forceAssetGeneration: false,
        })
        const parsed = parseAgentsChapterMemoryClues(extraction.text || '')
        if (parsed) {
          if (chapterCharacters.length === 0) chapterCharacters = parsed.characters
          if (chapterScenes.length === 0) chapterScenes = parsed.scenes
          if (chapterProps.length === 0) chapterProps = parsed.props
        }
      } catch (error) {
        console.warn('章节记忆线索 agents 提取失败', error)
      }
    }

    if (!chapterCharacters.length && !chapterProps.length && !chapterScenes.length && !styleAnchorDescription.trim()) {
      if (!options?.silent) {
        toast('当前章节文本窗口还没有足够的角色、场景、道具或画风锚点。', 'warning')
      }
      return
    }

    setSyncingChapterMemory(true)
    try {
      const existingCharacters = await listMaterialAssets({ projectId, kind: 'character' })
      const existingProps = await listMaterialAssets({ projectId, kind: 'prop' })
      const existingScenes = await listMaterialAssets({ projectId, kind: 'scene' })
      const existingStyleAssets = shouldIncludeStyleAnchor
        ? await listMaterialAssets({ projectId, kind: 'style' }).catch(() => [])
        : []

      const coverageByKind = {
        character: summarizeChapterMemoryCoverage(chapterCharacters, existingCharacters),
        prop: summarizeChapterMemoryCoverage(chapterProps, existingProps),
        scene: summarizeChapterMemoryCoverage(chapterScenes, existingScenes),
      }

      const upsertFromClues = async (
        kind: 'character' | 'prop' | 'scene',
        existingItems: MaterialAssetDto[],
        clues: Array<{ name: string; description: string }>,
      ) => {
        let createdCount = 0
        let updatedCount = 0
        for (const clue of clues) {
          const matched = existingItems.find((item) => normalizeAssetName(item.name).toLowerCase() === clue.name.toLowerCase()) || null
          const fitWithGlobal = Boolean(matched)
          const previousVersion = matched
            ? (assetLatestVersions[matched.id] || matched.latestVersion || null)
            : null
          const visualSnapshot = readMaterialVersionVisualSnapshot(previousVersion)
          const versionData = {
            chapterId,
            chapterTitle,
            sourceBookChapter: workbench?.chapter.sourceBookChapter || null,
            description: clue.description,
            extractedFrom: 'chapterTextWindow',
            chapterRequirement: {
              kind,
              name: clue.name,
              fitWithGlobal,
              matchedAssetId: matched?.id || null,
            },
            globalCoverageAtSync: {
              existingAssetCount: existingItems.length,
              chapterRequirementCount: coverageByKind[kind].chapterRequirementCount,
              matchedCount: coverageByKind[kind].matchedCount,
              missingCount: coverageByKind[kind].missingCount,
              missingNamesSample: coverageByKind[kind].missingNames.slice(0, 8),
            },
            ...visualSnapshot,
            syncedAt: new Date().toISOString(),
          }
          if (matched) {
            await createMaterialVersion(matched.id, {
              data: versionData,
              note: `同步${kind === 'character' ? '角色' : kind === 'prop' ? '道具' : '场景'}线索：${clue.name}`,
            })
            updatedCount += 1
            continue
          }
          await createMaterialAsset({
            projectId,
            kind,
            name: clue.name,
            initialData: versionData,
            note: `由章节文本窗口沉淀${kind === 'character' ? '角色' : kind === 'prop' ? '道具' : '场景'}线索`,
          })
          createdCount += 1
        }
        return { createdCount, updatedCount }
      }

      const [characterResult, propResult, sceneResult] = await Promise.all([
        upsertFromClues('character', existingCharacters, chapterCharacters),
        upsertFromClues('prop', existingProps, chapterProps),
        upsertFromClues('scene', existingScenes, chapterScenes),
      ])
      let styleResult = { createdCount: 0, updatedCount: 0 }
      if (shouldIncludeStyleAnchor && styleAnchorDescription.trim()) {
        const matchedStyleAsset = existingStyleAssets.find((item) => normalizeAssetName(item.name).toLowerCase() === styleAnchorName.toLowerCase()) || null
        const styleVersionData = {
          chapterId,
          chapterTitle,
          sourceBookChapter: workbench?.chapter.sourceBookChapter || null,
          description: styleAnchorDescription,
          artStyleName: projectSetup.artStyleName || null,
          styleDirectives: projectSetup.styleDirectives || null,
          styleBibleName: styleBible?.styleName || null,
          styleBibleVisualDirectives: Array.isArray(styleBible?.visualDirectives) ? styleBible.visualDirectives : [],
          styleBibleConsistencyRules: Array.isArray(styleBible?.consistencyRules) ? styleBible.consistencyRules : [],
          extractedFrom: 'projectSetupAndStyleBible',
          syncedAt: new Date().toISOString(),
        }
        if (matchedStyleAsset) {
          await createMaterialVersion(matchedStyleAsset.id, {
            data: styleVersionData,
            note: `同步项目画风锚点：${styleAnchorName}`,
          })
          styleResult = { createdCount: 0, updatedCount: 1 }
        } else {
          await createMaterialAsset({
            projectId,
            kind: 'style',
            name: styleAnchorName,
            initialData: styleVersionData,
            note: '由项目设定与风格圣经沉淀画风锚点',
          })
          styleResult = { createdCount: 1, updatedCount: 0 }
        }
      }

      const refreshed = await reloadProjectContext({ bypassBookThrottle: true })
      if (refreshed) {
        setChapters(refreshed.chapterItems)
        setWorkbench(refreshed.chapterWorkbench)
        setBookIndex(refreshed.nextBookIndex)
      }
      const [nextCharacters, nextProps, nextScenes, nextStyleAssets] = await Promise.all([
        listMaterialAssets({ projectId, kind: 'character' }).catch(() => characterAssets),
        listMaterialAssets({ projectId, kind: 'prop' }).catch(() => propAssets),
        listMaterialAssets({ projectId, kind: 'scene' }).catch(() => sceneAssets),
        listMaterialAssets({ projectId, kind: 'style' }).catch(() => styleAssets),
      ])
      setCharacterAssets(nextCharacters)
      setPropAssets(nextProps)
      setSceneAssets(nextScenes)
      setStyleAssets(nextStyleAssets)
      const totalCreated = characterResult.createdCount + propResult.createdCount + sceneResult.createdCount + styleResult.createdCount
      const totalUpdated = characterResult.updatedCount + propResult.updatedCount + sceneResult.updatedCount + styleResult.updatedCount
      const coverageSummary = [
        `人物 ${coverageByKind.character.matchedCount}/${coverageByKind.character.chapterRequirementCount}`,
        `场景 ${coverageByKind.scene.matchedCount}/${coverageByKind.scene.chapterRequirementCount}`,
        `道具 ${coverageByKind.prop.matchedCount}/${coverageByKind.prop.chapterRequirementCount}`,
      ].join(' · ')
      if (!options?.silent || totalCreated > 0 || totalUpdated > 0) {
        toast(`已同步章节线索到项目记忆：新增 ${totalCreated}，更新 ${totalUpdated}。全局匹配：${coverageSummary}。`, 'success')
      }
    } catch (error) {
      console.error('同步章节记忆失败', error)
      if (!options?.silent) {
        toast(describeError(error, '同步章节记忆失败，请稍后重试'), 'error')
      }
    } finally {
      setSyncingChapterMemory(false)
    }
  }

  const handleBindShotMemory = async () => {
    if (!projectId || !activeShot?.id || bindingShotMemory) return
    if (suggestedShotMemoryAssets.length === 0) {
      toast('当前章节还没有可绑定到镜头的项目记忆资产。', 'warning')
      return
    }
    setBindingShotMemory(true)
    try {
      const mergedRefs = new Map<string, { assetId: string; assetVersion: number }>()
      for (const item of currentShotRefs) {
        mergedRefs.set(item.assetId, {
          assetId: item.assetId,
          assetVersion: item.assetVersion,
        })
      }
      for (const item of suggestedShotMemoryAssets) {
        mergedRefs.set(item.asset.id, {
          assetId: item.asset.id,
          assetVersion: item.version,
        })
      }
      const saved = await upsertShotMaterialRefs({
        projectId,
        shotId: activeShot.id,
        refs: Array.from(mergedRefs.values()),
      })
      setCurrentShotRefs(saved)
      toast(`已为当前镜头绑定 ${suggestedShotMemoryAssets.length} 个项目记忆资产。`, 'success')
    } catch (error) {
      console.error('绑定镜头记忆失败', error)
      toast(describeError(error, '绑定镜头记忆失败，请稍后重试'), 'error')
    } finally {
      setBindingShotMemory(false)
    }
  }

  const styleBible = bookIndex?.assets?.styleBible || null
  const mappedSourceChapterMeta = (() => {
    const chapterNo = workbench?.chapter.sourceBookChapter
    if (!chapterNo || !bookIndex?.chapters?.length) return null
    return bookIndex.chapters.find((item) => item.chapter === chapterNo) || null
  })()

  React.useEffect(() => {
    if (!projectId || !chapterId || !workbench?.chapter.sourceBookChapter) return
    const hasChapterClues = Boolean(
      (boundSourceChapterDetail?.characters || []).length
      || (boundSourceChapterDetail?.props || []).length
      || (boundSourceChapterDetail?.scenes || []).length
      || (boundSourceChapterDetail?.locations || []).length
      || (mappedSourceChapterMeta?.characters || []).length
      || (mappedSourceChapterMeta?.props || []).length
      || (mappedSourceChapterMeta?.scenes || []).length
    )
    const hasStyleAnchorSource = Boolean(
      projectSetup.artStyleName.trim()
      || projectSetup.styleDirectives.trim()
      || styleBible?.styleName
      || (styleBible?.visualDirectives || []).length
      || (styleBible?.consistencyRules || []).length
    )
    if (!hasChapterClues && !hasStyleAnchorSource) return
    if (syncingChapterMemory) return
    if (autoSyncedChapterMemoryRef.current.has(chapterId)) return
    autoSyncedChapterMemoryRef.current.add(chapterId)
    void handleSyncChapterMemory({ silent: true, includeStyleAnchor: true })
  }, [
    boundSourceChapterDetail?.characters,
    boundSourceChapterDetail?.locations,
    boundSourceChapterDetail?.props,
    boundSourceChapterDetail?.scenes,
    chapterId,
    mappedSourceChapterMeta?.characters,
    mappedSourceChapterMeta?.props,
    mappedSourceChapterMeta?.scenes,
    projectId,
    projectSetup.artStyleName,
    projectSetup.styleDirectives,
    styleBible?.consistencyRules,
    styleBible?.styleName,
    styleBible?.visualDirectives,
    syncingChapterMemory,
    workbench?.chapter.sourceBookChapter,
  ])

  const textAssetKind = (() => {
    const kind = typeof projectTextAsset?.data === 'object' && projectTextAsset?.data && !Array.isArray(projectTextAsset.data)
      ? String((projectTextAsset.data as Record<string, unknown>).kind || '').trim()
      : ''
    return kind || null
  })()
  const sourceChapterOptions = (bookIndex?.chapters || []).map((item) => ({
    value: String(item.chapter),
    label: `第${item.chapter}章 · ${item.title || '未命名章节'}`,
  }))
  const selectedDirectorManualPreset = getDirectorManualPresetById(projectSetup.directorManualPresetId)
  const currentChapterIndex = chapters.findIndex((item) => item.id === chapterId)
  const previousChapter = currentChapterIndex > 0 ? chapters[currentChapterIndex - 1] || null : null
  const nextChapter = currentChapterIndex >= 0 ? chapters[currentChapterIndex + 1] || null : null
  const currentSceneAsset = activeSceneAssetId
    ? sceneAssets.find((item) => item.id === activeSceneAssetId) || null
    : null
  const currentSceneVersionMeta = currentSceneVersions[0]?.data || {}
  const currentSceneOriginChapterId = typeof currentSceneVersionMeta.chapterId === 'string' ? currentSceneVersionMeta.chapterId : ''
  const impactedShotCount = currentSceneImpact?.items.length || 0
  const outdatedShotCount = currentSceneImpact?.items.filter((item) => item.isOutdated).length || 0
  const chapterCharacterNames = (boundSourceChapterDetail?.characters || mappedSourceChapterMeta?.characters || [])
    .map((item) => normalizeAssetName(item.name || ''))
    .filter(Boolean)
  const chapterSceneNames = [
    ...((boundSourceChapterDetail?.scenes || mappedSourceChapterMeta?.scenes || []).map((item) => normalizeAssetName(item.name || ''))),
    ...((boundSourceChapterDetail?.locations || []).map((item) => normalizeAssetName(item.name || ''))),
  ].filter(Boolean)
  const chapterPropNames = (boundSourceChapterDetail?.props || mappedSourceChapterMeta?.props || [])
    .map((item) => normalizeAssetName(item.name || ''))
    .filter(Boolean)
  const matchedCharacterAssets = characterAssets.filter((item) => chapterCharacterNames.some((name) => name.toLowerCase() === normalizeAssetName(item.name).toLowerCase()))
  const matchedSceneAssets = sceneAssets.filter((item) => chapterSceneNames.some((name) => normalizeAssetName(item.name).toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(normalizeAssetName(item.name).toLowerCase())))
  const matchedPropAssets = propAssets.filter((item) => chapterPropNames.some((name) => name.toLowerCase() === normalizeAssetName(item.name).toLowerCase()))
  const currentSourceChapterNo =
    typeof workbench?.chapter.sourceBookChapter === 'number' && Number.isFinite(workbench.chapter.sourceBookChapter)
      ? workbench.chapter.sourceBookChapter
      : null
  const previousSourceChapterNo =
    typeof previousChapter?.sourceBookChapter === 'number' && Number.isFinite(previousChapter.sourceBookChapter)
      ? previousChapter.sourceBookChapter
      : null
  const currentChapterSceneAssets = sceneAssets
    .filter((item) => {
      const latestVersion = assetLatestVersions[item.id] || null
      const versionMeta = readMaterialVersionMeta(latestVersion)
      return versionMeta.chapterId === chapterId
    })
    .sort((left, right) => Date.parse(String(right.updatedAt || '')) - Date.parse(String(left.updatedAt || '')))
  const currentChapterBaseSceneAssets = sceneAssets
    .map((item) => ({
      asset: item,
      anchorData: readChapterBaseSceneAnchorVersion(assetLatestVersions[item.id] || null),
    }))
    .filter((item): item is { asset: MaterialAssetDto; anchorData: ChapterBaseSceneAnchorVersionData } => {
      return Boolean(item.anchorData && item.anchorData.chapterId === chapterId)
    })
    .sort((left, right) => Date.parse(right.anchorData.generatedAt) - Date.parse(left.anchorData.generatedAt))
  const currentChapterPrimaryBaseSceneAnchor = currentChapterBaseSceneAssets[0] || null
  const carryoverCharacterAssets = previousChapter
    ? characterAssets
      .filter((item) => {
        const versionMeta = readMaterialVersionMeta(assetLatestVersions[item.id] || null)
        return (
          versionMeta.chapterId === previousChapter.id
          || (previousSourceChapterNo != null && versionMeta.sourceBookChapter === previousSourceChapterNo)
        )
      })
      .sort((left, right) => Date.parse(String(right.updatedAt || '')) - Date.parse(String(left.updatedAt || '')))
    : []
  const carryoverSceneAssets = previousChapter
    ? sceneAssets
      .filter((item) => {
        const versionMeta = readMaterialVersionMeta(assetLatestVersions[item.id] || null)
        return (
          versionMeta.chapterId === previousChapter.id
          || (previousSourceChapterNo != null && versionMeta.sourceBookChapter === previousSourceChapterNo)
          || normalizeAssetName(item.name).startsWith(`${normalizeAssetName(previousChapter.title || '')} /`)
        )
      })
      .sort((left, right) => Date.parse(String(right.updatedAt || '')) - Date.parse(String(left.updatedAt || '')))
    : []
  const carryoverPropAssets = previousChapter
    ? propAssets
      .filter((item) => {
        const versionMeta = readMaterialVersionMeta(assetLatestVersions[item.id] || null)
        return (
          versionMeta.chapterId === previousChapter.id
          || (previousSourceChapterNo != null && versionMeta.sourceBookChapter === previousSourceChapterNo)
        )
      })
      .sort((left, right) => Date.parse(String(right.updatedAt || '')) - Date.parse(String(left.updatedAt || '')))
    : []
  const preferredStyleAssets = styleAssets
    .filter((item) => {
      const versionMeta = readMaterialVersionMeta(assetLatestVersions[item.id] || null)
      if (currentSourceChapterNo != null && versionMeta.sourceBookChapter === currentSourceChapterNo) return true
      if (previousSourceChapterNo != null && versionMeta.sourceBookChapter === previousSourceChapterNo) return true
      return true
    })
    .sort((left, right) => Date.parse(String(right.updatedAt || '')) - Date.parse(String(left.updatedAt || '')))
  const currentShotBoundAssets = currentShotRefs
    .map((ref) => {
      const asset =
        sceneAssets.find((item) => item.id === ref.assetId) ||
        characterAssets.find((item) => item.id === ref.assetId) ||
        propAssets.find((item) => item.id === ref.assetId) ||
        styleAssets.find((item) => item.id === ref.assetId) ||
        null
      if (!asset) return null
      return { ref, asset }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
  const currentShotBoundAssetCards = currentShotBoundAssets.map((item) => {
    const latestVersion = boundAssetVersions[item.asset.id] || null
    const latestVersionData =
      latestVersion && typeof latestVersion.data === 'object' && latestVersion.data && !Array.isArray(latestVersion.data)
        ? latestVersion.data as Record<string, unknown>
        : {}
    const impact = boundAssetImpacts[item.asset.id] || null
    const originChapterId = typeof latestVersionData.chapterId === 'string' ? latestVersionData.chapterId.trim() : ''
    const originShotId = typeof latestVersionData.shotId === 'string' ? latestVersionData.shotId.trim() : ''
    const originChapterTitle = typeof latestVersionData.chapterTitle === 'string' ? latestVersionData.chapterTitle.trim() : ''
    const originSourceBookChapter =
      typeof latestVersionData.sourceBookChapter === 'number' && Number.isFinite(latestVersionData.sourceBookChapter)
        ? latestVersionData.sourceBookChapter
        : null
    const affectedShotCount = impact?.items.length || 0
    return {
      ...item,
      latestVersion,
      previewImageUrl: readMaterialVersionImageUrl(latestVersion),
      originChapterId,
      originShotId,
      originChapterTitle,
      originSourceBookChapter,
      affectedShotCount,
    }
  })
  const suggestedShotMemoryAssets = [
    ...preferredStyleAssets.map((asset) => ({ asset, version: asset.currentVersion })),
    ...matchedCharacterAssets.map((asset) => ({ asset, version: asset.currentVersion })),
    ...carryoverCharacterAssets.map((asset) => ({ asset, version: asset.currentVersion })),
    ...currentChapterBaseSceneAssets.map((item) => ({ asset: item.asset, version: item.asset.currentVersion })),
    ...matchedSceneAssets.map((asset) => ({ asset, version: asset.currentVersion })),
    ...currentChapterSceneAssets.map((asset) => ({ asset, version: asset.currentVersion })),
    ...carryoverSceneAssets.map((asset) => ({ asset, version: asset.currentVersion })),
    ...matchedPropAssets.map((asset) => ({ asset, version: asset.currentVersion })),
    ...carryoverPropAssets.map((asset) => ({ asset, version: asset.currentVersion })),
  ]
    .filter((item, index, array) => array.findIndex((candidate) => candidate.asset.id === item.asset.id) === index)
    .map((item) => {
      const latestVersion = assetLatestVersions[item.asset.id] || null
      return {
        ...item,
        latestVersion,
        previewImageUrl: readMaterialVersionImageUrl(latestVersion),
      }
    })
  const currentShotChecklistItems = [
    {
      key: 'prompt',
      label: '执行 Prompt',
      ready: Boolean(shotRenderPrompt.trim()),
      detail: shotRenderPrompt.trim() ? '已生成，可直接执行。' : '当前镜头还没有可执行 Prompt。',
    },
    {
      key: 'memory',
      label: '项目记忆',
      ready: currentShotBoundAssetCards.length > 0 || suggestedShotMemoryAssets.length > 0,
      detail:
        currentShotBoundAssetCards.length > 0
          ? `已绑定 ${currentShotBoundAssetCards.length} 个项目资产。`
          : suggestedShotMemoryAssets.length > 0
            ? `可自动命中 ${suggestedShotMemoryAssets.length} 个项目资产。`
            : '当前还没有命中可复用资产。',
    },
    {
      key: 'image',
      label: '当前结果图',
      ready: Boolean(currentShotPreviewUrl),
      detail: currentShotPreviewUrl ? '已有当前结果，可直接选图确认。' : '当前镜头还没有结果图。',
    },
    {
      key: 'scene',
      label: '共享场景',
      ready: Boolean(activeSceneAssetId),
      detail: activeSceneAssetId
        ? `已沉淀为「${sceneAssets.find((item) => item.id === activeSceneAssetId)?.name || '当前共享场景'}」。`
        : '当前结果还没有沉淀为共享场景。',
    },
  ] as const
  const chapterHasTextContext = Boolean(
    boundSourceChapterDetail?.content?.trim()
    || boundSourceChapterDetail?.summary?.trim()
    || boundSourceChapterDetail?.coreConflict?.trim()
    || chapterMetaDraft.summary.trim()
    || workbench?.chapter.summary?.trim(),
  )
  const chapterStoryboardProduction = buildStoryboardProductionSummary(bookIndex, currentSourceChapterNo)
  const chapterResumeStatus = buildChapterResumeStatus({
    shotCount: workbenchStats.totalShots,
    generatedShotCount: workbenchStats.generatedShots,
    reviewShotCount: workbenchStats.reviewShots,
    reworkShotCount: workbenchStats.reworkShots,
    sceneAssetCount: currentChapterSceneAssets.length,
    baseSceneAnchorCount: currentChapterBaseSceneAssets.length,
    storyboardChunkCount: chapterStoryboardProduction?.generatedChunks || 0,
    storyboardPlanShotCount: chapterStoryboardProduction?.totalShots || 0,
    recentTaskCount: workbench?.recentTasks.length || 0,
  })
  const sceneReferenceImageCount =
    suggestedShotMemoryAssets.filter((item) => item.asset.kind === 'scene' && Boolean(item.previewImageUrl)).length
    + (currentChapterPrimaryBaseSceneAnchor?.anchorData.imageUrl ? 1 : 0)
  const characterReferenceImageCount = suggestedShotMemoryAssets.filter((item) => item.asset.kind === 'character' && Boolean(item.previewImageUrl)).length
  const chapterPrerequisiteStatus = evaluateChapterPrerequisites({
    hasBoundSourceChapter: Boolean(workbench?.chapter.sourceBookChapter),
    hasChapterText: chapterHasTextContext,
    hasShotUnits: Boolean(workbench?.shots.length),
    sceneReferenceImageCount,
    characterRequirementCount: chapterCharacterNames.length,
    characterReferenceImageCount,
    legacyResumeStatus: chapterResumeStatus,
  })
  const chapterPrerequisiteActionMeta: Record<ChapterPrerequisiteKey, { actionLabel: string; disabled?: boolean }> = {
    source: { actionLabel: '绑定原文' },
    text: {
      actionLabel: workbench?.chapter.sourceBookChapter ? '查看原文' : chapterResumeStatus.continuable ? '续接后补录' : '先绑定原文',
      disabled: chapterHasTextContext || chapterResumeStatus.continuable,
    },
    shots: {
      actionLabel: Boolean(workbench?.shots.length) ? '继续补镜头' : '生成镜头板',
      disabled: !workbench?.chapter.sourceBookChapter && !chapterHasTextContext,
    },
    scene_anchor: {
      actionLabel: '补场景锚点',
      disabled: !chapterHasTextContext,
    },
    character_anchor: {
      actionLabel: '去补人物锚点',
      disabled: chapterCharacterNames.length <= 0,
    },
  }
  const promptConstraintItems = [
    chapterCharacterNames.length
      ? `章节角色线索 ${chapterCharacterNames.slice(0, 6).join('、')}${matchedCharacterAssets.length ? `；已命中项目角色资产 ${matchedCharacterAssets.slice(0, 4).map((item) => item.name).join('、')}` : '；尚未命中角色资产'}`
      : carryoverCharacterAssets.length > 0
        ? `当前章节会优先继承上一章连续角色 ${carryoverCharacterAssets.slice(0, 3).map((item) => item.name).join('、')}`
      : '当前章节还没有明确角色线索。',
    chapterSceneNames.length
      ? `章节场景线索 ${chapterSceneNames.slice(0, 4).join('、')}${matchedSceneAssets.length ? `；已命中项目场景资产 ${matchedSceneAssets.slice(0, 3).map((item) => item.name).join('、')}` : '；尚未命中场景资产'}`
      : currentChapterBaseSceneAssets.length > 0
        ? `本章基础空间锚点 ${currentChapterBaseSceneAssets.slice(0, 2).map((item) => item.asset.name).join('、')} 已就绪，后续镜头会优先继承空间结构`
      : currentChapterSceneAssets.length > 0
        ? `本章已沉淀场景 ${currentChapterSceneAssets.slice(0, 3).map((item) => item.name).join('、')}，后续镜头会优先复用`
      : carryoverSceneAssets.length > 0
        ? `当前章节会优先继承上一章连续场景 ${carryoverSceneAssets.slice(0, 3).map((item) => item.name).join('、')}`
      : '当前章节还没有明确场景线索。',
    chapterPropNames.length
      ? `章节道具线索 ${chapterPropNames.slice(0, 6).join('、')}${matchedPropAssets.length ? `；已命中项目道具资产 ${matchedPropAssets.slice(0, 4).map((item) => item.name).join('、')}` : '；尚未命中道具资产'}`
      : carryoverPropAssets.length > 0
        ? `当前章节会优先继承上一章连续道具 ${carryoverPropAssets.slice(0, 3).map((item) => item.name).join('、')}`
      : '当前章节还没有明确道具线索。',
    projectSetup.artStyleName.trim() || projectSetup.styleDirectives.trim()
      ? `当前镜头会继承项目画风「${projectSetup.artStyleName.trim() || '已配置视觉规则'}」。`
      : '当前项目还没有配置画风信息。',
  ]
  const filteredShots = workbench
    ? workbench.shots.filter((shot) => {
      if (shotStatusFilter !== 'all' && shot.status !== shotStatusFilter) return false
      const q = shotQuery.trim().toLowerCase()
      if (!q) return true
      return [
        `shot ${shot.shotIndex + 1}`,
        shot.title || '',
        shot.summary || '',
        shot.status || '',
      ].some((item) => item.toLowerCase().includes(q))
    })
    : []
  const shotOrderingLocked = shotStatusFilter !== 'all' || Boolean(shotQuery.trim())
  const shotControlDirty = shotControlExpanded || selectedShotIds.length > 0 || shotStatusFilter !== 'all' || Boolean(shotQuery.trim())
  const canDraftShotsFromChapter = Boolean(
    boundSourceChapterDetail?.content?.trim()
    || boundSourceChapterDetail?.summary?.trim()
    || boundSourceChapterDetail?.coreConflict?.trim()
    || chapterMetaDraft.summary.trim(),
  )
  const shotControlSummary = (() => {
    if (workbenchStats.totalShots === 0) {
      return canDraftShotsFromChapter
        ? '先按本章文本起稿，这里会直接生成第一版镜头板。'
        : '先补齐章节文本窗口，再起稿镜头板。'
    }
    if (selectedShotIds.length > 0) {
      return `当前已选 ${selectedShotIds.length} 个镜头，可批量调整状态。`
    }
    if (shotStatusFilter !== 'all' || shotQuery.trim()) {
      return `当前只显示 ${filteredShots.length} 个镜头，清空筛选后可恢复完整镜头板。`
    }
    return `当前已有 ${workbenchStats.totalShots} 个镜头，先点开一个镜头，再进入下方“镜头生产”。`
  })()
  const recommendedShotIds = React.useMemo(() => {
    if (!workbench?.shots?.length) return []
    const shots = workbench.shots
    const first = shots[0] || null
    const last = shots[shots.length - 1] || null
    const conflictLike = shots.find((item) => /冲突|对峙|发现|反转|爆发|追|打|战|哭|死|醒|出现|进入/i.test(`${item.title || ''} ${item.summary || ''}`)) || null
    return [first, conflictLike, last]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index)
      .map((item) => item.id)
  }, [workbench?.shots])
  const recommendedShots = (workbench?.shots || []).filter((item) => recommendedShotIds.includes(item.id))
  const recommendedShotLabel = recommendedShots.map((item) => item.title || `Shot ${item.shotIndex + 1}`).join('、')
  const advanceToNextPriorityShot = React.useCallback((shots: ChapterWorkbenchDto['shots'], currentShotId?: string | null) => {
    const nextShotId = pickNextPriorityShotId({
      shots,
      recommendedShotIds,
      currentShotId,
    })
    if (!nextShotId) return
    const nextShot = shots.find((item) => item.id === nextShotId) || shots[0] || null
    if (!nextShot) return
    setShotDraft({
      shotId: nextShot.id,
      title: nextShot.title || '',
      summary: nextShot.summary || '',
      status: nextShot.status || 'queued',
    })
  }, [recommendedShotIds])
  const chapterAllShotsSucceeded = Boolean(
    workbench
    && workbench.shots.length > 0
    && workbench.shots.every((item) => item.status === 'succeeded'),
  )
  const chapterReadyToAdvance = Boolean(
    workbench
    && workbench.chapter.sourceBookChapter
    && chapterAllShotsSucceeded
    && workbenchStats.reworkShots === 0,
  )
  const remainingChapterShotsToFinish = Math.max(
    0,
    (workbench?.shots || []).filter((item) => item.status !== 'succeeded').length,
  )
  const handleAdvanceToNextChapter = React.useCallback(async () => {
    if (!workbench || !chapterId || !projectId || advancingChapter) return
    setAdvancingChapter(true)
    try {
      if (workbench.chapter.status !== 'approved') {
        await updateChapter(chapterId, {
          status: 'approved',
        })
      }
      if (nextChapter) {
        if (nextChapter.status === 'draft' || nextChapter.status === 'planning') {
          await updateChapter(nextChapter.id, {
            status: 'producing',
          }).catch(() => null)
        }
        try {
          window.sessionStorage.setItem(
            buildChapterHandoffStorageKey(projectId),
            JSON.stringify({
              chapterId: nextChapter.id,
              at: Date.now(),
            }),
          )
        } catch {}
        spaNavigate(buildProjectChapterUrl(projectId, nextChapter.id))
        return
      }
      toast('当前已经是最后一章，可继续补齐章节或回到项目总览。', 'info')
    } catch (error) {
      console.error('推进到下一章失败', error)
      toast(describeError(error, '推进到下一章失败，请稍后重试'), 'error')
    } finally {
      setAdvancingChapter(false)
    }
  }, [advancingChapter, chapterId, nextChapter, projectId, workbench])
  const nextStepItems = (() => {
    if (!workbench) {
      return [
        '当前章节数据正在加载。',
        '加载完成后再继续绑定原文、整理镜头和执行生产。',
      ]
    }
    if (chapterResumeStatus.continuable && !workbench.chapter.sourceBookChapter) {
      return [
        chapterResumeStatus.summary,
        chapterResumeStatus.details[0] ? `可先从旧结果续接：${chapterResumeStatus.details[0]}。` : '可先从已有章节结果续接。',
        '建议先进入镜头板确认当前可复用结果，再按需要补录原文绑定、摘要和分镜脚本。',
      ]
    }
    if (!projectBooks.length && !projectTextAsset) {
      return [
        '当前项目还没有原文。',
        '可继续补充项目简介、画风和导演规则。',
      ]
    }
    if (projectBooks.length > 0 && !workbench.chapter.sourceBookChapter) {
      return [
        '当前章节还没有锁定对应原文。',
        '点击主按钮即可自动绑定，并继续生成第一版镜头。',
      ]
    }
    if (workbench.shots.length === 0) {
      return [
        '当前章节还没有镜头执行单元。',
        '点击主按钮后，这里会按本章文本自动建立第一版镜头板。',
      ]
    }
    if (chapterReadyToAdvance) {
      return [
        nextChapter
          ? `本章镜头已经收口，可进入 ${nextChapter.title || `第 ${nextChapter.index} 章`}。`
          : '本章镜头已经全部收口，可继续补齐后续章节或回到项目总览。',
        '确认本章后，会把本章标记为已确认，并切到下一章继续生产。',
      ]
    }
    if (remainingChapterShotsToFinish > 0 && workbenchStats.generatedShots > 0) {
      return [
        `本章还剩 ${remainingChapterShotsToFinish} 个镜头待收口。`,
        '先确认关键镜头结果并沉淀共享资产，再扩展剩余镜头。',
      ]
    }
    if (recommendedShots.length > 0) {
      return [
        `建议先做关键镜头：${recommendedShotLabel}。`,
        '先把开场、冲突或结尾钩子镜头打稳，再扩展整章，质量更容易稳定。',
      ]
    }
    return [
      '当前章节已经具备文本窗口和镜头列表。',
      '可继续处理镜头、资源和审阅。',
    ]
  })()
  const currentStage = (() => {
    if (!workbench) {
      return {
        badge: '加载中',
        title: '当前章节数据正在准备',
        description: '等待这一页加载完成后，再继续原文绑定、镜头整理和生产。',
        actionLabel: '查看章节列表',
        onAction: () => undefined,
      }
    }
    if (!projectBooks.length && !projectTextAsset) {
      if (chapterResumeStatus.continuable) {
        return {
          badge: '续接老数据',
          title: '检测到历史章节资产，可直接续接当前章节',
          description: chapterResumeStatus.details.slice(0, 2).join('；') || '当前章节已有旧镜头、分镜或沉淀资产，可先接着做。',
          actionLabel: workbench.shots.length > 0 ? '进入镜头板续接' : '查看章节资产',
          onAction: () => shotsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        }
      }
      return {
        badge: '先导入文本',
        title: '当前项目还没有生产底稿',
        description: '上传文本后即可继续章节导入和后续配置。',
        actionLabel: '跳到文本导入',
        onAction: () => textSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      }
    }
    if (chapterResumeStatus.continuable && !workbench.chapter.sourceBookChapter) {
      return {
        badge: '续接当前章节',
        title: '老章节已有结果，可先续接再补齐新链路字段',
        description: chapterResumeStatus.details.slice(0, 3).join('；') || '当前章节已经存在可复用的历史结果。',
        actionLabel: workbench.shots.length > 0 ? '进入镜头板续接' : '查看可复用资产',
        onAction: () => shotsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      }
    }
    if (!workbench.chapter.sourceBookChapter) {
      return {
        badge: '先绑定原文',
        title: '先把这一章绑定到正确的原文章节',
        description: '这里会优先自动绑定；如果这章还没有镜头板，会继续按本章文本起出第一版镜头。',
        actionLabel: '自动绑定并继续',
        onAction: () => void handleAutoBindChapter({ autoDraftAfterBind: true }),
      }
    }
    if (workbench.shots.length === 0) {
      return {
        badge: '先建镜头板',
        title: '章节已经就位，但还没有镜头执行单元',
        description: '这里会直接按本章文本起镜头板，并优先打开关键镜头开始出图。',
        actionLabel: canDraftShotsFromChapter ? '一键生成镜头板' : '查看镜头区',
        onAction: () => {
          if (canDraftShotsFromChapter) {
            void handleDraftShotsFromChapter({ autoOpenPreferredShot: true, autoKickoffPreferredShot: true })
            return
          }
          shotsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        },
      }
    }
    if (recommendedShots.length > 0 && !activeShot) {
      return {
        badge: '先做关键镜头',
        title: `建议先做 ${recommendedShots[0]?.title || `Shot ${(recommendedShots[0]?.shotIndex ?? 0) + 1}`}`,
        description: '先把关键镜头做稳，再扩展整章，连续性和风格更容易锁住。',
        actionLabel: '查看推荐镜头',
        onAction: () => shotsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      }
    }
    if (!chapterPrerequisiteStatus.ready) {
      return {
        badge: '自动补齐前置',
        title: '当前章节前置资产未完备',
        description: `系统会先自动补齐：${chapterPrerequisiteStatus.missingDetails.join('；')}，再继续当前镜头。`,
        actionLabel: '自动补齐并继续',
        onAction: () => void handleKickoffCurrentChapter(),
      }
    }
    if (!currentShotRender?.data.images?.length) {
      return {
        badge: '开始出图',
        title: '当前章节已具备执行条件',
        description: '这里会优先启动当前关键镜头，并自动带上本章命中资产与跨章连续资产。',
        actionLabel: '启动当前关键镜头',
        onAction: () => void handleKickoffCurrentChapter(),
      }
    }
    if (workbenchStats.reworkShots > 0) {
      return {
        badge: '优先返工',
        title: '这一章已经出现待返工镜头',
        description: '当前有待返工镜头，可回到镜头板查看。',
        actionLabel: '查看镜头板',
        onAction: () => shotsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      }
    }
    if (chapterReadyToAdvance) {
      return {
        badge: '进入下一章',
        title: nextChapter ? '这一章已经收口，可以继续下一章' : '这一章已经收口',
        description: nextChapter
          ? `下一章 ${nextChapter.title || `第 ${nextChapter.index} 章`} 已经接好。`
          : '当前没有下一章，可继续补齐章节或回到项目总览。',
        actionLabel: nextChapter ? '完成本章并进入下一章' : '完成本章',
        onAction: () => void handleAdvanceToNextChapter(),
      }
    }
    return {
      badge: '继续推进',
      title: '这一章已经进入连续生产状态',
      description: '可继续处理出图、结果选择和审阅。',
      actionLabel: '继续当前镜头',
      onAction: () => renderSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    }
  })()
  const chapterTourSteps: FeatureTourStep[] = React.useMemo(() => [
    {
      id: 'chapter-next-step',
      target: 'chapter-current-stage',
      title: currentStage.title,
      description: [currentStage.description, ...nextStepItems].join(' '),
    },
  ], [currentStage.description, currentStage.title, nextStepItems])
  const projectMemorySummary = {
    sourceReady: Boolean(projectBooks[0] || projectTextAsset),
    chapterCount: chapters.length,
    characterAssetCount: characterAssets.length,
    sceneAssetCount: sceneAssets.length,
    propAssetCount: propAssets.length,
    styleAssetCount: styleAssets.length,
    roleHintCount:
      (boundSourceChapterDetail?.characters || mappedSourceChapterMeta?.characters || []).length,
  }
  const chapterProgressSummary = {
    planningReady: Boolean(workbench?.chapter.sourceBookChapter),
    storyboardReady: Boolean(workbench && workbenchStats.totalShots > 0),
    renderReady: Boolean(currentShotRender?.data.images?.length),
    memoryReady: Boolean(currentSceneAsset),
  }
  const totalSourceChapterCount = bookIndex?.chapters?.length || projectBooks[0]?.chapterCount || 0
  const importedProjectChapterCount = chapters.length
  const remainingSourceChapterCount = Math.max(0, totalSourceChapterCount - importedProjectChapterCount)
  const productionStudioCallout = (() => {
    if (!currentShotRender?.data.images?.length && !chapterReadyToAdvance) return null
    if (chapterReadyToAdvance) {
      return {
        title: '本章已经收口，可做整章深化或交接下一章',
        description: nextChapter
          ? '如需继续做整章节奏、镜头联动或输出链路，可进入章节流程；若当前镜头还要继续打磨，也可以直接进镜头流程。'
          : '如果还要补整章节奏、镜头联动或输出链路，可进入章节流程；当前镜头也可单独继续深化。',
        primaryLabel: '进入章节深化',
        secondaryLabel: shotDraft?.shotId ? '进入当前镜头成片' : '',
      }
    }
    return {
      title: '当前已经有稳定结果，可继续做成片推进',
      description: '优先进入章节流程做整章编排与连续性控制；若只想深挖当前镜头，则直接进入镜头流程。',
      primaryLabel: '整章深化',
      secondaryLabel: shotDraft?.shotId ? '当前镜头成片' : '',
    }
  })()
  const showBindingEditor = showAdvancedPanels || !workbench?.chapter.sourceBookChapter
  const showProjectSetupPanel = showAdvancedPanels || (!projectBooks.length && !projectTextAsset)
  const showSourceUploadPanel = showAdvancedPanels || (!projectBooks.length && !projectTextAsset)
  const shotFailureDiagnosis = diagnoseShotGenerationFailure({
    message: currentShotRender?.data.errorMessage,
    prompt: shotRenderPrompt,
    hasBoundSourceChapter: Boolean(workbench?.chapter.sourceBookChapter),
    suggestedAssetCount: suggestedShotMemoryAssets.length,
  })
  const continuityChecks = workbench ? [
    {
      key: 'source-window',
      label: '章节文本窗口',
      status: workbench.chapter.sourceBookChapter ? 'ready' : 'missing',
      detail: workbench.chapter.sourceBookChapter
        ? `当前镜头只消费原文第 ${workbench.chapter.sourceBookChapter} 章。`
        : '当前还没绑定原文章节。',
    },
    {
      key: 'style-bible',
      label: '项目画风锚点',
      status: projectSetup.artStyleName.trim() || projectSetup.styleDirectives.trim() || styleAssets.length > 0 ? 'ready' : 'missing',
      detail: projectSetup.artStyleName.trim()
        ? `已配置画风「${projectSetup.artStyleName.trim()}」。`
        : styleAssets.length > 0
          ? `已有 ${styleAssets.length} 个风格资产。`
          : '当前还没有配置画风信息。',
    },
    {
      key: 'roles-memory',
      label: '角色连续性',
      status: projectMemorySummary.roleHintCount > 0 || projectMemorySummary.characterAssetCount > 0 ? 'ready' : 'warning',
      detail: projectMemorySummary.characterAssetCount > 0
        ? `项目层已有 ${projectMemorySummary.characterAssetCount} 个角色资产。`
        : projectMemorySummary.roleHintCount > 0
          ? `本章识别到 ${projectMemorySummary.roleHintCount} 个角色线索。`
          : '本章还没有明确角色线索。',
    },
    {
      key: 'prop-memory',
      label: '道具锚点',
      status: projectMemorySummary.propAssetCount > 0 || ((boundSourceChapterDetail?.props || mappedSourceChapterMeta?.props || []).length > 0) ? 'ready' : 'warning',
      detail: projectMemorySummary.propAssetCount > 0
        ? `项目层已有 ${projectMemorySummary.propAssetCount} 个道具资产。`
        : ((boundSourceChapterDetail?.props || mappedSourceChapterMeta?.props || []).length > 0)
          ? `当前文本窗口已识别 ${(boundSourceChapterDetail?.props || mappedSourceChapterMeta?.props || []).length} 个道具线索。`
          : '当前章节还没有道具线索。',
    },
    {
      key: 'scene-memory',
      label: '场景复用',
      status: currentSceneAsset ? (outdatedShotCount > 0 ? 'warning' : 'ready') : 'missing',
      detail: currentSceneAsset
        ? outdatedShotCount > 0
          ? `当前共享场景仍有 ${outdatedShotCount} 个镜头绑定旧版本。`
          : `当前镜头已接入共享场景「${currentSceneAsset.name}」。`
        : '当前镜头还没有绑定共享场景。',
    },
    {
      key: 'review-loop',
      label: '返工闭环',
      status: workbenchStats.reworkShots > 0 ? 'warning' : (workbenchStats.generatedShots > 0 ? 'ready' : 'missing'),
      detail: workbenchStats.reworkShots > 0
        ? `本章还有 ${workbenchStats.reworkShots} 个镜头待返工，应先收口。`
        : workbenchStats.generatedShots > 0
          ? '当前章节已有可审阅结果，可以继续推进或确认。'
          : '还没有形成可审阅结果，质量闭环尚未启动。',
    },
  ] as const : []
  const activeSharedMemorySignals = [
    projectMemorySummary.sourceReady ? `项目原文已接入，当前项目共 ${chapters.length} 章。` : '项目原文尚未接入。',
    currentChapterPrimaryBaseSceneAnchor
      ? `本章基础空间锚点已沉淀为「${currentChapterPrimaryBaseSceneAnchor.asset.name}」。`
      : '本章还没有基础空间锚点。',
    currentSceneAsset
      ? `当前镜头复用了共享场景「${currentSceneAsset.name}」，影响 ${impactedShotCount} 个镜头。`
      : '当前镜头还没有绑定共享场景。',
    styleAssets.length > 0
      ? `项目层已有 ${styleAssets.length} 个风格资产锚点。`
      : '项目层还没有风格资产锚点。',
    propAssets.length > 0
      ? `项目层已有 ${propAssets.length} 个可复用道具资产。`
      : '项目层还没有稳定的道具资产。',
    projectMemorySummary.roleHintCount > 0
      ? `本章文本窗口识别到 ${projectMemorySummary.roleHintCount} 个角色线索。`
      : '本章文本窗口还没有角色线索。',
  ]
  const chapterReusableMemoryGroups = [
    {
      key: 'character',
      label: '角色',
      ready: matchedCharacterAssets.length > 0 || carryoverCharacterAssets.length > 0,
      names: [...matchedCharacterAssets, ...carryoverCharacterAssets].slice(0, 4).map((item) => item.name).filter(Boolean),
      emptyText:
        carryoverCharacterAssets.length > 0
          ? '本章将优先继承上一章的连续角色。'
          : chapterCharacterNames.length > 0
            ? '本章识别到角色，但项目里还没有可复用角色资产。'
            : '本章还没识别到明确角色线索。',
    },
    {
      key: 'scene',
      label: '场景',
      ready: currentChapterBaseSceneAssets.length > 0 || matchedSceneAssets.length > 0 || currentChapterSceneAssets.length > 0 || carryoverSceneAssets.length > 0,
      names: [
        ...currentChapterBaseSceneAssets.map((item) => item.asset),
        ...matchedSceneAssets,
        ...currentChapterSceneAssets,
        ...carryoverSceneAssets,
      ].slice(0, 4).map((item) => item.name).filter(Boolean),
      emptyText:
        currentChapterBaseSceneAssets.length > 0
          ? '本章基础空间锚点已经就绪，后续镜头会优先继承这个稳定场景。'
        : currentChapterSceneAssets.length > 0
          ? '本章已经沉淀出可复用场景，会直接带入后续镜头。'
        : carryoverSceneAssets.length > 0
          ? '本章将优先继承上一章沉淀的连续场景。'
          : chapterSceneNames.length > 0
            ? '本章识别到场景，但项目里还没有稳定场景资产。'
            : '本章还没识别到明确场景线索。',
    },
    {
      key: 'prop',
      label: '道具',
      ready: matchedPropAssets.length > 0 || carryoverPropAssets.length > 0,
      names: [...matchedPropAssets, ...carryoverPropAssets].slice(0, 4).map((item) => item.name).filter(Boolean),
      emptyText:
        carryoverPropAssets.length > 0
          ? '本章将优先继承上一章的连续道具。'
          : chapterPropNames.length > 0
            ? '本章识别到道具，但项目里还没有可复用道具资产。'
            : '本章还没识别到明确道具线索。',
    },
  ] as const
  const chapterMemoryReadinessSummary = (() => {
    const readyCount = chapterReusableMemoryGroups.filter((item) => item.ready).length
    if (readyCount === 3) return '本章可直接复用现有角色、场景和道具。'
    if (readyCount > 0) return `本章已命中 ${readyCount} 类可复用资产，其余内容会在本章继续沉淀。`
    return '本章还没有命中可直接复用的共享资产，先从关键镜头开始沉淀。'
  })()
  const chapterRelaySummary = (() => {
    const inheritedKinds = chapterReusableMemoryGroups.filter((item) => item.ready)
    if (previousChapter?.status === 'approved' && inheritedKinds.length > 0) {
      return `上一章已确认，本章可直接继承 ${inheritedKinds.map((item) => item.label).join('、')} 资产继续生产。`
    }
    if (previousChapter?.status === 'approved') {
      return '上一章已确认，本章可以沿着既有画风和共享场景继续推进。'
    }
    if (inheritedKinds.length > 0) {
      return `本章已经命中 ${inheritedKinds.length} 类共享资产，可直接承接连续性。`
    }
    return '本章将从当前项目画风和后续沉淀的共享资产中继续建立连续性。'
  })()
  const reworkDiagnosisItems = (() => {
    const items: Array<{ title: string; detail: string; tone: 'red' | 'yellow' | 'gray' }> = []
    if (!workbench) {
      items.push({
        title: '章节数据尚未加载',
        detail: '等待这一页返回当前章节数据。',
        tone: 'gray',
      })
      return items
    }
    if (workbenchStats.reworkShots > 0) {
      items.push({
        title: '存在待返工镜头',
        detail: `当前章节有 ${workbenchStats.reworkShots} 个镜头处于返工态。`,
        tone: 'red',
      })
    }
    if (!workbench.chapter.sourceBookChapter) {
      items.push({
        title: '原文章节未锁定',
        detail: '当前还没有绑定原文章节。',
        tone: 'yellow',
      })
    }
    if (!currentShotRender?.data.images?.length) {
      items.push({
        title: '当前镜头还没有稳定结果',
        detail: '还没有可审阅结果图。',
        tone: 'gray',
      })
    }
    if (!projectSetup.artStyleName.trim() && !projectSetup.styleDirectives.trim() && styleAssets.length === 0) {
      items.push({
        title: '画风锚点不足',
        detail: '项目层还没有明确画风规则或风格资产。',
        tone: 'yellow',
      })
    }
    if (currentSceneAsset && outdatedShotCount > 0) {
      items.push({
        title: '共享场景版本未同步',
        detail: `当前共享场景仍有 ${outdatedShotCount} 个旧版本引用。`,
        tone: 'yellow',
      })
    }
    if (items.length === 0) {
      items.push({
        title: '当前章节没有明显返工阻塞',
        detail: '当前章节没有明显阻塞项。',
        tone: 'gray',
      })
    }
    return items
  })()
  const recentTaskItems = (workbench?.recentTasks || []).map((item) => {
    const isShot = item.ownerType === 'shot'
    const matchedShot = isShot && workbench ? workbench.shots.find((shot) => shot.id === item.ownerId) : null
    const tone = item.status === 'failed' ? 'red' : item.status === 'succeeded' ? 'green' : item.status === 'running' ? 'blue' : 'gray'
    const title = (() => {
      if (item.kind === 'chapter_bound') return '章节绑定已更新'
      if (item.kind === 'chapter_active') return '章节再次进入工作中'
      if (item.kind === 'shot_generated') return `${matchedShot?.title || '镜头'} 已生成结果`
      if (item.kind === 'shot_rework') return `${matchedShot?.title || '镜头'} 被标记为返工`
      if (item.kind === 'shot_running') return `${matchedShot?.title || '镜头'} 正在生成`
      if (item.kind === 'shot_planned') return `${matchedShot?.title || '镜头'} 已加入镜头板`
      return isShot ? `${matchedShot?.title || '镜头'} 有新动作` : '章节信息已更新'
    })()
    const detail = isShot
      ? `${matchedShot ? `Shot ${matchedShot.shotIndex + 1}` : '镜头'} · ${formatShotProductionStatus(matchedShot?.status || item.status)}`
      : `${chapterTitle} · ${formatChapterProductionStatus(workbench?.chapter.status || 'draft')}`
    return {
      ...item,
      tone,
      title,
      detail,
    }
  })
  const productionTimeline = workbench ? [
    {
      key: 'project-text',
      title: projectMemorySummary.sourceReady ? '项目原文已接入' : '项目原文尚未接入',
      detail: projectBooks[0]
        ? `已拆书 ${projectBooks[0].chapterCount} 章，后续按章节推进。`
        : projectTextAsset
          ? '文本已上传到项目，等待继续进入章节推进。'
          : '当前还没有生产底稿，后续章节与资产无法稳定收口。',
      time: projectBooks[0]?.updatedAt || projectTextAsset?.updatedAt || '',
      tone: projectMemorySummary.sourceReady ? 'blue' : 'gray',
    },
    {
      key: 'chapter-bind',
      title: workbench.chapter.sourceBookChapter ? `章节已绑定原文第 ${workbench.chapter.sourceBookChapter} 章` : '章节尚未绑定原文',
      detail: workbench.chapter.sourceBookChapter
        ? '本章后续的镜头 prompt、角色和场景上下文都以这一章为准。'
        : '先完成章节绑定，再继续镜头生产，避免拿错上下文。',
      time: workbench.chapter.lastWorkedAt || workbench.chapter.updatedAt,
      tone: workbench.chapter.sourceBookChapter ? 'blue' : 'gray',
    },
    {
      key: 'shot-progress',
      title: `镜头推进到 ${workbenchStats.totalShots} 个执行单元`,
      detail:
        workbenchStats.totalShots > 0
          ? `已生成 ${workbenchStats.generatedShots} 个，待返工 ${workbenchStats.reworkShots} 个。`
          : '当前还没有镜头，说明这一章还没拆成可执行的最小单元。',
      time: activeShot?.updatedAt || workbench.chapter.updatedAt,
      tone: workbenchStats.totalShots > 0 ? 'blue' : 'gray',
    },
    {
      key: 'render-result',
      title: currentShotRender?.data.images?.length ? '当前镜头已有可回看的生成结果' : '当前镜头还没有稳定生成结果',
      detail: currentShotRender?.data.images?.length
        ? `最近一轮结果 ${currentShotRender.data.images.length} 张，可继续选图、返工或提升为共享资产。`
        : '需要先完成一轮出图，才能进入资产沉淀与审阅。',
      time: currentShotRender?.asset.updatedAt || '',
      tone: currentShotRender?.data.images?.length ? 'blue' : 'gray',
    },
    {
      key: 'scene-memory',
      title: currentSceneAsset ? '当前镜头结果已沉淀为项目共享记忆' : '当前镜头还没有进入项目共享记忆',
      detail: currentSceneAsset
        ? `共享资源 ${currentSceneAsset.name} 当前版本 v${currentSceneAsset.currentVersion}，影响镜头 ${impactedShotCount} 个。`
        : '把当前结果提升为场景物料后，后续章节才能稳定复用。',
      time: currentSceneVersions[0]?.createdAt || currentSceneAsset?.updatedAt || '',
      tone: currentSceneAsset ? 'green' : 'gray',
    },
  ] : []

  return (
    <AppShell padding={0} header={{ height: 56 }} className="tc-pm__shell">
      <FeatureTour opened={chapterTourOpen} steps={chapterTourSteps} onClose={closeChapterTour} />
      <AppShell.Header className="tc-pm__header">
        <Group justify="space-between" px="md" h="100%">
          <Group gap="sm">
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={() => spaNavigate(buildProjectDirectoryUrl(projectId))}
              aria-label="返回项目页"
            >
              <IconArrowLeft size={18} />
            </ActionIcon>
            <Box>
              <Title order={4} className="tc-pm__title">{workbench?.project.name || '项目'}</Title>
              <Text size="xs" c="dimmed">按章节推进的漫剧制作页</Text>
            </Box>
          </Group>
          <Group gap="xs">
            <CanvasEntryButton
              href={buildStudioUrl({
                projectId,
                ownerType: 'chapter',
                ownerId: chapterId,
              })}
              variant="light"
              size="compact-sm"
            />
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="查看当前章节指引"
              onClick={() => setChapterTourOpen(true)}
            >
              <IconHelpCircle size={18} />
            </ActionIcon>
            <Badge variant="light" color="blue">{chapterTitle}</Badge>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main className="tc-pm__main">
        <div className="tc-pm__layout">
          <div className="tc-pm__sidebar">
            <Box className="tc-pm__sidebar-top">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text fw={700}>章节</Text>
                  <Badge variant="dot">{chapters.length}</Badge>
                </Group>
                <Group gap="xs">
                  <TextInput
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.currentTarget.value)}
                    placeholder="新建章节名称"
                    size="xs"
                    style={{ flex: 1 }}
                  />
                  <Button size="xs" leftSection={<IconFilePlus size={14} />} loading={creating} onClick={handleCreateChapter}>
                    新建
                  </Button>
                </Group>
              </Stack>
            </Box>
            <Divider />
            <ScrollArea className="tc-pm__tree">
              <Stack gap="xs">
                {chapters.map((chapter) => {
                  const active = chapter.id === chapterId
                  const index = chapters.findIndex((item) => item.id === chapter.id)
                  return (
                    <InlinePanel
                      key={chapter.id}
                      style={{
                        cursor: 'pointer',
                        borderColor: active ? 'var(--mantine-color-blue-5)' : undefined,
                        background: active ? 'rgba(59, 130, 246, 0.08)' : undefined,
                      }}
                      onClick={() => spaNavigate(buildProjectChapterUrl(projectId, chapter.id))}
                    >
                      <Group justify="space-between" align="flex-start" wrap="nowrap">
                        <Box style={{ minWidth: 0 }}>
                          <Text fw={700} size="sm">{`第 ${chapter.index} 章`}</Text>
                          <Text size="sm" truncate>{chapter.title}</Text>
                          {chapter.sourceBookChapter ? (
                            <Text size="xs" c="blue">{`绑定原文第 ${chapter.sourceBookChapter} 章`}</Text>
                          ) : null}
                          {chapter.summary ? <Text size="xs" c="dimmed" lineClamp={2}>{chapter.summary}</Text> : null}
                        </Box>
                        <Group gap={4} wrap="nowrap">
                          {active ? (
                            <>
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="gray"
                                loading={reorderingChapter}
                                disabled={index <= 0}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleMoveChapter('up')
                                }}
                                aria-label="上移章节"
                              >
                                <IconArrowUp size={14} />
                              </ActionIcon>
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="gray"
                                loading={reorderingChapter}
                                disabled={index < 0 || index >= chapters.length - 1}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleMoveChapter('down')
                                }}
                                aria-label="下移章节"
                              >
                                <IconArrowDown size={14} />
                              </ActionIcon>
                            </>
                          ) : null}
                          <IconChevronRight size={16} style={{ opacity: 0.55 }} />
                        </Group>
                      </Group>
                    </InlinePanel>
                  )
                })}
              </Stack>
            </ScrollArea>
          </div>
          <ScrollArea className="tc-pm__chapter-scroll">
            <Box className="tc-pm__chapter-content" p="md">
              {loading ? (
                <Group justify="center" py="xl">
                  <Loader size="sm" />
                </Group>
              ) : workbench ? (
                <Stack gap="md">
                  {chapterReadyToAdvance ? (
                    <PanelCard
                      className="tc-pm__chapter-next-step-card"
                      style={{
                        position: 'sticky',
                        top: 12,
                        zIndex: 5,
                        borderColor: 'rgba(34, 197, 94, 0.34)',
                        background: 'linear-gradient(135deg, rgba(22, 101, 52, 0.18), rgba(15, 23, 42, 0.72))',
                        boxShadow: '0 18px 36px rgba(0, 0, 0, 0.22)',
                      }}
                    >
                      <Group justify="space-between" align="center" gap="sm">
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="xs" c="dimmed">下一步</Text>
                          <Text fw={700} mt={4}>
                            {nextChapter ? `本章已收口，直接进入 ${nextChapter.title || `第 ${nextChapter.index} 章`}` : '本章已收口'}
                          </Text>
                          <Text size="xs" c="dimmed" mt={4}>
                            {nextChapter
                              ? '当前镜头和共享场景已经稳定，可直接接力下一章继续生产。'
                              : '当前没有下一章，可继续补齐章节或进入整章深化。'}
                          </Text>
                        </Box>
                        <Button
                          loading={advancingChapter}
                          onClick={() => void handleAdvanceToNextChapter()}
                        >
                          {nextChapter ? '完成本章并进入下一章' : '完成本章'}
                        </Button>
                      </Group>
                    </PanelCard>
                  ) : null}

                  <PanelCard className="tc-pm__chapter-header-card" data-tour="chapter-current-stage">
                    <Group justify="space-between" align="flex-start" gap="sm">
                      <Box>
                        <Title order={3}>{workbench.chapter.title}</Title>
                        <Text size="sm" c="dimmed">{workbench.chapter.summary || '当前章节尚未填写摘要。'}</Text>
                      </Box>
                      <Group gap="xs" align="center">
                        <Badge variant="light" color={getChapterProductionStatusTone(workbench.chapter.status)}>
                          {formatChapterProductionStatus(workbench.chapter.status)}
                        </Badge>
                        <Button
                          size="xs"
                          variant="light"
                          color={workbench.chapter.status === 'archived' ? 'gray' : 'yellow'}
                          onClick={() => void handleArchiveChapter()}
                        >
                          {workbench.chapter.status === 'archived' ? '取消归档' : '归档章节'}
                        </Button>
                        {showAdvancedPanels ? (
                          <Button
                            size="xs"
                            color="red"
                            variant="subtle"
                            leftSection={<IconTrash size={14} />}
                            loading={deletingChapter}
                            onClick={() => void handleDeleteChapter()}
                          >
                            删除章节
                          </Button>
                        ) : null}
                      </Group>
                    </Group>
                  </PanelCard>

                  {chapterAutoRelayMessage ? (
                    <PanelCard className="tc-pm__chapter-stage-card">
                      <Group justify="space-between" align="center" gap="sm">
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="xs" c="dimmed">自动接力中</Text>
                          <Text size="sm" fw={700} mt={4}>{chapterAutoRelayMessage}</Text>
                        </Box>
                        <Loader size="sm" color="blue" />
                      </Group>
                    </PanelCard>
                  ) : null}

                  <PanelCard className="tc-pm__chapter-stage-card">
                    <Box ref={chapterStageRef} />
                    <Group className="tc-pm__chapter-stage-layout" justify="space-between" align="flex-start" gap="lg">
                      <Box className="tc-pm__chapter-stage-main" style={{ flex: 1, minWidth: 280 }}>
                        <Badge variant="light" color="blue">{currentStage.badge}</Badge>
                        <Title order={3} mt={10}>本章现在该做什么</Title>
                        <Text size="sm" mt={6}>{currentStage.title}</Text>
                        <Text size="sm" c="dimmed" mt={6}>{currentStage.description}</Text>
                        <Group mt="md" gap="xs">
                          <Button loading={chapterReadyToAdvance && advancingChapter} onClick={currentStage.onAction}>{currentStage.actionLabel}</Button>
                          <Button variant="light" onClick={() => shotsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                            看镜头板
                          </Button>
                        </Group>
                      </Box>
                      <SimpleGrid className="tc-pm__chapter-stage-side" cols={{ base: 1, md: 1 }} spacing="sm" style={{ minWidth: 280, maxWidth: 320 }}>
                        <InlinePanel className="tc-pm__chapter-stage-panel">
                          <Text size="xs" c="dimmed">当前章节</Text>
                          <Text fw={700} mt={4}>
                            {workbench.chapter.sourceBookChapter
                              ? `已锁定原文第 ${workbench.chapter.sourceBookChapter} 章`
                              : chapterResumeStatus.continuable
                                ? '检测到可续接的历史章节结果'
                                : '还未锁定原文章节'}
                          </Text>
                          <Text size="xs" c="dimmed" mt={4}>
                            {chapterResumeStatus.continuable && !workbench.chapter.sourceBookChapter
                              ? chapterResumeStatus.details[0] || '可先从旧数据续接，再补齐原文绑定'
                              : workbenchStats.totalShots > 0
                              ? `已建立 ${workbenchStats.totalShots} 个镜头执行单元`
                              : '下一步建议先生成第一版镜头板'}
                          </Text>
                        </InlinePanel>
                        <InlinePanel className="tc-pm__chapter-stage-panel">
                          <Text size="xs" c="dimmed">本章节奏</Text>
                          <Text fw={700} mt={4}>{formatChapterProductionStatus(workbench.chapter.status)}</Text>
                          <Text size="xs" c="dimmed" mt={4}>
                            {workbenchStats.reworkShots > 0
                              ? `当前有 ${workbenchStats.reworkShots} 个镜头待返工`
                              : chapterReadyToAdvance
                                ? '本章已收口，可切到下一章'
                                : remainingChapterShotsToFinish > 0
                                  ? `本章还剩 ${remainingChapterShotsToFinish} 个镜头待收口`
                                  : currentShotRender?.data.images?.length
                                    ? '当前已有结果图，可继续确认并推进'
                                    : '还没有稳定结果，先做关键镜头'}
                          </Text>
                        </InlinePanel>
                        <InlinePanel className="tc-pm__chapter-stage-panel">
                          <Group justify="space-between" align="center" gap="xs">
                            <Text size="xs" c="dimmed">前置资产</Text>
                            <Badge variant="light" color={chapterPrerequisiteStatus.ready ? 'green' : 'yellow'}>
                              {chapterPrerequisiteStatus.ready ? '已完备' : chapterResumeStatus.continuable ? '可续接' : '待补齐'}
                            </Badge>
                          </Group>
                          <Stack className="tc-pm__chapter-prerequisite-list" gap={6} mt={8}>
                            {chapterPrerequisiteStatus.items.map((item) => {
                              const actionMeta = chapterPrerequisiteActionMeta[item.key]
                              return (
                                <Group
                                  key={item.key}
                                  className="tc-pm__chapter-prerequisite-row"
                                  justify="space-between"
                                  align="center"
                                  gap="xs"
                                  wrap="nowrap"
                                >
                                  <Box className="tc-pm__chapter-prerequisite-copy" style={{ flex: 1, minWidth: 0 }}>
                                    <Text size="xs" fw={600} c={item.ready ? 'white' : 'yellow'}>
                                      {item.label}：{item.ready ? 'OK' : '缺失'}
                                    </Text>
                                    <Text size="xs" c="dimmed" lineClamp={1}>{item.detail}</Text>
                                  </Box>
                                  {!item.ready ? (
                                    <Button
                                      className="tc-pm__chapter-prerequisite-action"
                                      size="compact-xs"
                                      variant="light"
                                      color="yellow"
                                      loading={fillingPrerequisiteKey === item.key}
                                      disabled={actionMeta.disabled}
                                      onClick={() => void handleFillChapterPrerequisite(item.key)}
                                    >
                                      {actionMeta.actionLabel}
                                    </Button>
                                  ) : null}
                                </Group>
                              )
                            })}
                          </Stack>
                        </InlinePanel>
                      </SimpleGrid>
                    </Group>
                    <Stack className="tc-pm__chapter-stage-step-list" gap={8} mt="md">
                      <Text size="sm" fw={700}>推荐路径</Text>
                      {nextStepItems.slice(0, 3).map((item, index) => (
                        <InlinePanel key={item} className="tc-pm__chapter-stage-step">
                          <Text size="xs" c="dimmed">{`Step ${index + 1}`}</Text>
                          <Text size="sm" mt={4}>{item}</Text>
                        </InlinePanel>
                      ))}
                    </Stack>
                    <div className="tc-pm__chapter-stage-callout-grid">
                    {remainingSourceChapterCount > 0 ? (
                      <InlinePanel className="tc-pm__chapter-stage-callout">
                        <Group justify="space-between" align="center" gap="sm">
                          <Box style={{ flex: 1, minWidth: 0 }}>
                            <Text size="sm" fw={700}>后续章节正在补齐</Text>
                            <Text size="xs" c="dimmed" mt={4}>
                              当前项目已创建 {importedProjectChapterCount} / {totalSourceChapterCount} 章。
                              原文目录已经拿到了，剩余章节会自动同步到左侧列表。
                              {showAdvancedPanels ? ' 如自动同步异常，也可手动补齐一次。' : ''}
                            </Text>
                          </Box>
                          {showAdvancedPanels ? (
                            <Group gap="xs">
                              <Button size="xs" variant="light" loading={importingChapters} onClick={() => void handleImportChaptersFromBook({ limit: 20 })}>
                                补齐后 20 章
                              </Button>
                              <Button size="xs" loading={importingChapters} onClick={() => void handleImportChaptersFromBook()}>
                                一次补齐全部
                              </Button>
                            </Group>
                          ) : null}
                        </Group>
                      </InlinePanel>
                    ) : null}
                    {chapterReadyToAdvance ? (
                      <InlinePanel className="tc-pm__chapter-stage-callout">
                        <Group justify="space-between" align="center" gap="sm">
                          <Box style={{ flex: 1, minWidth: 0 }}>
                            <Text size="sm" fw={700}>本章已达到可交付状态</Text>
                            <Text size="xs" c="dimmed" mt={4}>
                              所有镜头都已收口，且没有返工项。
                              {nextChapter
                                ? ` 现在可以直接切到 ${nextChapter.title || `第 ${nextChapter.index} 章`} 继续生产。`
                                : ' 当前没有下一章，可继续补齐章节。'}
                            </Text>
                          </Box>
                          <Button size="xs" loading={advancingChapter} onClick={() => void handleAdvanceToNextChapter()}>
                            {nextChapter ? '完成本章并进入下一章' : '完成本章'}
                          </Button>
                        </Group>
                      </InlinePanel>
                    ) : null}
                    {(previousChapter || nextChapter) ? (
                      <InlinePanel className="tc-pm__chapter-stage-callout">
                        <Group justify="space-between" align="center" gap="sm">
                          <Box style={{ flex: 1, minWidth: 0 }}>
                            <Text size="sm" fw={700}>章节连续生产</Text>
                            <Text size="xs" c="dimmed" mt={4}>
                              {previousChapter
                                ? `上一章：${previousChapter.title || `第 ${previousChapter.index} 章`}`
                                : '当前是第一章。'}
                              {nextChapter
                                ? ` 下一章：${nextChapter.title || `第 ${nextChapter.index} 章`}`
                                : ' 当前已经是最后一章。'}
                            </Text>
                          </Box>
                          <Group gap="xs">
                            {previousChapter ? (
                              <Button
                                size="xs"
                                variant="light"
                                onClick={() => spaNavigate(buildProjectChapterUrl(projectId, previousChapter.id))}
                              >
                                返回上一章
                              </Button>
                            ) : null}
                            {nextChapter ? (
                              <Button
                                size="xs"
                                variant="light"
                                onClick={() => spaNavigate(buildProjectChapterUrl(projectId, nextChapter.id))}
                              >
                                预览下一章
                              </Button>
                            ) : null}
                          </Group>
                        </Group>
                      </InlinePanel>
                    ) : null}
                    {productionStudioCallout ? (
                      <InlinePanel className="tc-pm__chapter-stage-callout">
                        <Group justify="space-between" align="center" gap="sm">
                          <Box style={{ flex: 1, minWidth: 0 }}>
                            <Text size="sm" fw={700}>{productionStudioCallout.title}</Text>
                            <Text size="xs" c="dimmed" mt={4}>
                              {productionStudioCallout.description}
                            </Text>
                          </Box>
                          <Group gap="xs">
                            <Button
                              size="xs"
                              variant={shotDraft?.shotId ? 'light' : 'filled'}
                              leftSection={<IconVectorBezier2 size={14} />}
                              onClick={() => {
                                window.location.href = buildStudioUrl({
                                  projectId,
                                  ownerType: 'chapter',
                                  ownerId: chapterId,
                                })
                              }}
                            >
                              {productionStudioCallout.primaryLabel}
                            </Button>
                            {shotDraft?.shotId ? (
                              <Button
                                size="xs"
                                leftSection={<IconPlayerPlay size={14} />}
                                onClick={() => {
                                  window.location.href = buildStudioUrl({
                                    projectId,
                                    ownerType: 'shot',
                                    ownerId: shotDraft.shotId,
                                  })
                                }}
                              >
                                {productionStudioCallout.secondaryLabel}
                              </Button>
                            ) : null}
                          </Group>
                        </Group>
                      </InlinePanel>
                    ) : null}
                    </div>
                  </PanelCard>

                  <Group justify="space-between" align="center">
                    <Text size="sm" c="dimmed">
                      {showAdvancedPanels
                        ? '当前正在查看改绑、共享记忆、项目级设定和诊断信息。'
                        : '默认只保留当前章节推进主链。改绑、共享资源、诊断和项目级补充都收进补充设置。'}
                    </Text>
                    <Button size="xs" variant={showAdvancedPanels ? 'filled' : 'light'} onClick={() => setShowAdvancedPanels((prev) => !prev)}>
                      {showAdvancedPanels ? '收起补充设置' : '打开补充设置'}
                    </Button>
                  </Group>

                  {showAdvancedPanels ? (
                    <InlinePanel>
                      <Group justify="space-between" align="center" gap="sm">
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="sm" fw={700}>诊断与库存</Text>
                          <Text size="xs" c="dimmed" mt={4}>
                            这里放连续性诊断、推进记录、共享库存和返工定位。只有排查问题或做项目级检查时才需要展开。
                          </Text>
                        </Box>
                        <Button size="xs" variant={showAdvancedDiagnostics ? 'filled' : 'light'} onClick={() => setShowAdvancedDiagnostics((prev) => !prev)}>
                          {showAdvancedDiagnostics ? '收起诊断与库存' : '查看诊断与库存'}
                        </Button>
                      </Group>
                    </InlinePanel>
                  ) : null}

                  {showAdvancedPanels ? (
                  <PanelCard className="tc-pm__chapter-onboarding-card" data-tour="chapter-onboarding">
                    <Group justify="space-between" align="flex-start" mb="sm">
                      <Box>
                        <Text fw={700}>本章操作路径</Text>
                        <Text size="xs" c="dimmed">这里汇总当前章节的主要操作步骤。</Text>
                      </Box>
                      <Badge variant="light" color={getChapterProductionStatusTone(workbench.chapter.status)}>
                        {formatChapterProductionStatus(workbench.chapter.status)}
                      </Badge>
                    </Group>
                    <SimpleGrid cols={{ base: 1, md: 4 }}>
                      <InlinePanel className="tc-pm__chapter-onboarding-step">
                        <Text size="xs" c="dimmed">Step 1</Text>
                        <Text size="sm" fw={700} mt={4}>绑定原文章节</Text>
                        <Text size="xs" c="dimmed" mt={4}>通常会自动对位；只有章节错位或需要改绑时才手动处理。</Text>
                      </InlinePanel>
                      <InlinePanel className="tc-pm__chapter-onboarding-step">
                        <Text size="xs" c="dimmed">Step 2</Text>
                        <Text size="sm" fw={700} mt={4}>建立镜头板</Text>
                        <Text size="xs" c="dimmed" mt={4}>补镜头标题、摘要和状态，必要时筛选或批量整理。</Text>
                      </InlinePanel>
                      <InlinePanel className="tc-pm__chapter-onboarding-step">
                        <Text size="xs" c="dimmed">Step 3</Text>
                        <Text size="sm" fw={700} mt={4}>生成当前镜头</Text>
                        <Text size="xs" c="dimmed" mt={4}>检查 Prompt，出图并选择当前最佳结果。</Text>
                      </InlinePanel>
                      <InlinePanel className="tc-pm__chapter-onboarding-step">
                        <Text size="xs" c="dimmed">Step 4</Text>
                        <Text size="sm" fw={700} mt={4}>提升与审阅</Text>
                        <Text size="xs" c="dimmed" mt={4}>可提升为场景物料并查看影响范围。</Text>
                      </InlinePanel>
                    </SimpleGrid>
                  </PanelCard>
                  ) : null}

                  <PanelCard>
                    <Box ref={bindingSectionRef} />
                    <Group justify="space-between" align="flex-start" mb="sm">
                      <Box>
                        <Text fw={700}>本章文本窗口</Text>
                        <Text size="xs" c="dimmed">默认只展示当前章会直接喂给镜头生产的文本上下文。</Text>
                      </Box>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="light"
                          loading={syncingChapterMemory}
                          onClick={() => void handleSyncChapterMemory()}
                        >
                          更新项目共享线索
                        </Button>
                        {showBindingEditor ? null : (
                          <Button size="xs" variant="subtle" onClick={() => setShowAdvancedPanels(true)}>
                            改绑本章
                          </Button>
                        )}
                        {workbench.chapter.sourceBookChapter ? (
                          <Badge variant="light">{`原文第 ${workbench.chapter.sourceBookChapter} 章`}</Badge>
                        ) : (
                          <Badge color="gray" variant="light">未绑定</Badge>
                        )}
                      </Group>
                    </Group>
                    {boundSourceChapterLoading ? (
                      <Group justify="center" py="md">
                        <Loader size="sm" />
                      </Group>
                    ) : boundSourceChapterDetail ? (
                      <Stack gap="sm">
                        <InlinePanel>
                          <Group justify="space-between" align="flex-start" gap="sm">
                            <Box style={{ flex: 1, minWidth: 0 }}>
                              <Text size="sm" fw={700}>{boundSourceChapterDetail.title || `第 ${boundSourceChapterDetail.chapter} 章`}</Text>
                              <Text size="sm" c="dimmed" mt={4}>
                                {boundSourceChapterDetail.summary || boundSourceChapterDetail.coreConflict || '当前原文章节还没有摘要。'}
                              </Text>
                              <Text size="xs" c="dimmed" mt={6}>
                                行号 {boundSourceChapterDetail.startLine}-{boundSourceChapterDetail.endLine}
                              </Text>
                              {totalSourceChapterCount > 0 && showAdvancedPanels ? (
                                <Text size="xs" c="dimmed" mt={6}>
                                  当前原文共 {totalSourceChapterCount} 章，项目内已创建 {importedProjectChapterCount} 章。
                                </Text>
                              ) : null}
                            </Box>
                            <Button
                              size="xs"
                              variant="subtle"
                              onClick={() => setShowChapterContentPreview((prev) => !prev)}
                            >
                              {showChapterContentPreview ? '收起正文' : '展开正文'}
                            </Button>
                          </Group>
                        </InlinePanel>
                        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                          <InlinePanel>
                            <Text size="sm" fw={600}>人物</Text>
                            <Text size="sm" c="dimmed" mt={4}>
                              {(boundSourceChapterDetail.characters || []).slice(0, 6).map((item) => item.name).filter(Boolean).join('、') || '暂无'}
                            </Text>
                          </InlinePanel>
                          <InlinePanel>
                            <Text size="sm" fw={600}>场景</Text>
                            <Text size="sm" c="dimmed" mt={4}>
                              {(boundSourceChapterDetail.scenes || boundSourceChapterDetail.locations || []).slice(0, 6).map((item) => item.name).filter(Boolean).join('、') || '暂无'}
                            </Text>
                          </InlinePanel>
                          <InlinePanel>
                            <Text size="sm" fw={600}>道具</Text>
                            <Text size="sm" c="dimmed" mt={4}>
                              {(boundSourceChapterDetail.props || []).slice(0, 6).map((item) => item.name).filter(Boolean).join('、') || '暂无'}
                            </Text>
                          </InlinePanel>
                          <InlinePanel>
                            <Text size="sm" fw={600}>文本规模</Text>
                            <Text size="sm" c="dimmed" mt={4}>
                              {`${Math.max(0, (boundSourceChapterDetail.endLine || 0) - (boundSourceChapterDetail.startLine || 0) + 1)} 行`}
                            </Text>
                          </InlinePanel>
                        </SimpleGrid>
                        {showChapterContentPreview ? (
                          <InlinePanel>
                            <Text size="sm" fw={600}>正文预览</Text>
                            <Text size="sm" c="dimmed" mt={4} lineClamp={10}>
                              {boundSourceChapterDetail.content || '当前章节正文为空。'}
                            </Text>
                          </InlinePanel>
                        ) : null}
                      </Stack>
                    ) : (
                      <Text size="sm" c="dimmed">当前章节还没有绑定源文本窗口。这里会先自动对位；如果没对上，再在下方改绑本章。</Text>
                    )}
                  </PanelCard>

                  {showAdvancedPanels ? (
                  <PanelCard className="tc-pm__chapter-memory-card" data-tour="chapter-shared-memory">
                    <Group justify="space-between" align="flex-start" mb="sm">
                      <Box>
                        <Text fw={700}>本章可复用资源</Text>
                        <Text size="xs" c="dimmed">先看这一章能直接继承什么，再决定哪些内容要在本章新沉淀。</Text>
                      </Box>
                      <Group gap="xs">
                        <Button size="xs" variant="light" loading={syncingChapterMemory} onClick={() => void handleSyncChapterMemory()}>
                          更新共享线索
                        </Button>
                        <Button size="xs" variant="subtle" onClick={() => setAssetsViewerOpen(true)}>
                          打开记忆库
                        </Button>
                      </Group>
                    </Group>
                    <InlinePanel className="tc-pm__chapter-memory-block" style={{ marginBottom: '12px' }}>
                      <Text size="sm" fw={700}>当前判断</Text>
                      <Text size="sm" c="dimmed" mt={4}>{chapterMemoryReadinessSummary}</Text>
                    </InlinePanel>
                    <InlinePanel className="tc-pm__chapter-memory-block" style={{ marginBottom: '12px' }}>
                      <Text size="sm" fw={700}>章节接力</Text>
                      <Text size="sm" c="dimmed" mt={4}>{chapterRelaySummary}</Text>
                      {carryoverCharacterAssets.length > 0 ? (
                        <Text size="xs" c="dimmed" mt={6}>
                          连续角色会优先带入当前章：{carryoverCharacterAssets.map((item) => item.name).join('、')}
                        </Text>
                      ) : null}
                      {carryoverSceneAssets.length > 0 ? (
                        <Text size="xs" c="dimmed" mt={6}>
                          会优先把上一章沉淀的连续场景带入当前镜头：{carryoverSceneAssets.map((item) => item.name).join('、')}
                        </Text>
                      ) : null}
                      {carryoverPropAssets.length > 0 ? (
                        <Text size="xs" c="dimmed" mt={6}>
                          连续道具会优先带入当前章：{carryoverPropAssets.map((item) => item.name).join('、')}
                        </Text>
                      ) : null}
                    </InlinePanel>
                    <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
                      {chapterReusableMemoryGroups.map((group) => (
                        <InlinePanel key={group.key} className="tc-pm__chapter-memory-group">
                          <Group justify="space-between" align="center" mb={6}>
                            <Text size="sm" fw={700}>{group.label}</Text>
                            <Badge variant="light" color={group.ready ? 'green' : 'gray'}>
                              {group.ready ? '可复用' : '待沉淀'}
                            </Badge>
                          </Group>
                          <Text size="sm" c="dimmed">
                            {group.names.length > 0 ? group.names.join('、') : group.emptyText}
                          </Text>
                        </InlinePanel>
                      ))}
                    </SimpleGrid>
                    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm" mt="sm">
                      <InlinePanel className="tc-pm__chapter-memory-stat">
                        <Text size="xs" c="dimmed">项目画风</Text>
                        <Text size="sm" fw={700} mt={4}>
                          {projectSetup.artStyleName.trim() || (styleAssets.length > 0 ? '已有风格锚点' : '还未配置')}
                        </Text>
                        <Text size="xs" c="dimmed" mt={4}>
                          {projectSetup.artStyleName.trim()
                            ? '当前章节会直接继承项目画风规则。'
                            : styleAssets.length > 0
                              ? `项目层已有 ${styleAssets.length} 个风格资产可参考。`
                              : '建议先确定画风后再大批量生成镜头。'}
                        </Text>
                      </InlinePanel>
                      <InlinePanel className="tc-pm__chapter-memory-stat">
                        <Text size="xs" c="dimmed">共享进度</Text>
                        <Text size="sm" fw={700} mt={4}>
                          {currentSceneAsset ? '当前镜头已进入共享场景' : '当前镜头还未沉淀进共享场景'}
                        </Text>
                        <Text size="xs" c="dimmed" mt={4}>
                          {currentSceneAsset
                            ? `${currentSceneAsset.name} 已影响 ${impactedShotCount} 个镜头。`
                            : '确认结果后会自动写入项目共享场景，供后续章节复用。'}
                        </Text>
                      </InlinePanel>
                    </SimpleGrid>
                  </PanelCard>
                  ) : null}

                  {showBindingEditor ? (
                  <PanelCard>
                    <Group justify="space-between" align="flex-start" mb="sm">
                      <Box>
                        <Text fw={700}>章节绑定</Text>
                        <Text size="xs" c="dimmed">这里只在自动绑定失准、章节错位或需要批量修正时使用。</Text>
                      </Box>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="default"
                          disabled={!bookIndex?.chapters?.length}
                          loading={autoBindingChapter}
                          onClick={() => void handleAutoBindChapter()}
                        >
                          智能绑定本章
                        </Button>
                        <Button
                          size="xs"
                          variant="default"
                          disabled={!bookIndex?.chapters?.length}
                          loading={autoBindingAllChapters}
                          onClick={() => void handleAutoBindAllProjectChapters()}
                        >
                          自动绑定未映射章节
                        </Button>
                        <Button
                          size="xs"
                          variant="light"
                          disabled={!bookIndex?.chapters?.length}
                          loading={importingChapters}
                          onClick={() => void handleImportChaptersFromBook()}
                        >
                          按原文导入章节
                        </Button>
                        <Button size="xs" loading={savingChapterMeta} onClick={() => void handleSaveChapterMeta()}>
                          保存章节
                        </Button>
                      </Group>
                    </Group>
                    <Stack gap="sm">
                      <TextInput
                        label="章节标题"
                        value={chapterMetaDraft.title}
                        onChange={(event) => setChapterMetaDraft((prev) => ({ ...prev, title: event.currentTarget.value }))}
                      />
                      <Textarea
                        label="章节摘要"
                        minRows={2}
                        maxRows={4}
                        value={chapterMetaDraft.summary}
                        onChange={(event) => setChapterMetaDraft((prev) => ({ ...prev, summary: event.currentTarget.value }))}
                      />
                      <Select
                        label="章节状态"
                        data={[
                          { value: 'draft', label: '草稿' },
                          { value: 'planning', label: '策划中' },
                          { value: 'producing', label: '生产中' },
                          { value: 'review', label: '待审阅' },
                          { value: 'approved', label: '已确认' },
                          { value: 'locked', label: '已锁定' },
                          { value: 'archived', label: '已归档' },
                        ]}
                        value={workbench.chapter.status}
                        onChange={(value) => {
                          if (!value || !workbench) return
                          setWorkbench({
                            ...workbench,
                            chapter: {
                              ...workbench.chapter,
                              status: value as ChapterDto['status'],
                            },
                          })
                        }}
                      />
                      <Select
                        label="绑定原文章节"
                        placeholder={sourceChapterOptions.length ? '选择原文章节' : '当前还没有可绑定的原文目录'}
                        data={sourceChapterOptions}
                        value={chapterMetaDraft.sourceBookChapter}
                        onChange={(value) => {
                          const matched = (bookIndex?.chapters || []).find((item) => String(item.chapter) === String(value || ''))
                          setChapterMetaDraft((prev) => ({
                            ...prev,
                            sourceBookChapter: value || '',
                            title: matched?.title ? matched.title : prev.title,
                            summary: matched?.summary || matched?.coreConflict || prev.summary,
                          }))
                        }}
                        clearable
                      />
                      {mappedSourceChapterMeta ? (
                        <InlinePanel>
                          <Text size="sm" fw={600}>{`原文第 ${mappedSourceChapterMeta.chapter} 章 · ${mappedSourceChapterMeta.title || '未命名章节'}`}</Text>
                          <Text size="sm" c="dimmed" mt={4}>
                            {mappedSourceChapterMeta.summary || mappedSourceChapterMeta.coreConflict || '当前原文章节还没有摘要。'}
                          </Text>
                          <Text size="xs" c="dimmed" mt={6}>
                            人物 {mappedSourceChapterMeta.characters?.length || 0} · 场景 {mappedSourceChapterMeta.scenes?.length || 0} · 道具 {mappedSourceChapterMeta.props?.length || 0}
                          </Text>
                        </InlinePanel>
                      ) : (
                      <Text size="sm" c="dimmed">当前章节还没有绑定到原文目录。</Text>
                      )}
                    </Stack>
                  </PanelCard>
                  ) : null}

                  {showAdvancedPanels && showAdvancedDiagnostics ? (
                  <Group grow align="stretch">
                    <PanelCard className="tc-pm__chapter-project-memory-card" data-tour="chapter-shared-memory">
                      <Text fw={700} mb="xs">章节指标</Text>
                      <Stack gap={6}>
                        <Text size="sm">总镜头: {workbenchStats.totalShots}</Text>
                        <Text size="sm">已生成: {workbenchStats.generatedShots}</Text>
                        <Text size="sm">待审阅: {workbenchStats.reviewShots}</Text>
                        <Text size="sm">待返工: {workbenchStats.reworkShots}</Text>
                      </Stack>
                    </PanelCard>
                    <PanelCard className="tc-pm__chapter-project-memory-card" data-tour="chapter-shared-memory">
                      <Group justify="space-between" align="flex-start" mb="xs">
                        <Box>
                          <Text fw={700}>项目共享库存</Text>
                          <Text size="sm" c="dimmed">这里看项目层的总量和库存状态，不处理当前章的生产动作。</Text>
                        </Box>
                        <Group gap="xs">
                          <Button size="xs" variant="light" loading={syncingChapterMemory} onClick={() => void handleSyncChapterMemory()}>
                            同步本章线索
                          </Button>
                          <Button size="xs" variant="light" onClick={() => setAssetsViewerOpen(true)}>
                            打开记忆库
                          </Button>
                        </Group>
                      </Group>
                      <SimpleGrid cols={2} spacing="sm">
                        <InlinePanel className="tc-pm__chapter-project-memory-stat">
                          <Text size="xs" c="dimmed">项目原文</Text>
                          <Text size="sm" fw={700} mt={4}>{projectMemorySummary.sourceReady ? '已接入' : '未接入'}</Text>
                        </InlinePanel>
                        <InlinePanel className="tc-pm__chapter-project-memory-stat">
                          <Text size="xs" c="dimmed">项目章节</Text>
                          <Text size="sm" fw={700} mt={4}>{projectMemorySummary.chapterCount}</Text>
                        </InlinePanel>
                        <InlinePanel className="tc-pm__chapter-project-memory-stat">
                          <Text size="xs" c="dimmed">场景共享资产</Text>
                          <Text size="sm" fw={700} mt={4}>{projectMemorySummary.sceneAssetCount}</Text>
                        </InlinePanel>
                        <InlinePanel className="tc-pm__chapter-project-memory-stat">
                          <Text size="xs" c="dimmed">本章识别角色</Text>
                          <Text size="sm" fw={700} mt={4}>{projectMemorySummary.roleHintCount}</Text>
                        </InlinePanel>
                        <InlinePanel className="tc-pm__chapter-project-memory-stat">
                          <Text size="xs" c="dimmed">角色共享资产</Text>
                          <Text size="sm" fw={700} mt={4}>{projectMemorySummary.characterAssetCount}</Text>
                        </InlinePanel>
                        <InlinePanel className="tc-pm__chapter-project-memory-stat">
                          <Text size="xs" c="dimmed">道具共享资产</Text>
                          <Text size="sm" fw={700} mt={4}>{projectMemorySummary.propAssetCount}</Text>
                        </InlinePanel>
                        <InlinePanel className="tc-pm__chapter-project-memory-stat">
                          <Text size="xs" c="dimmed">风格锚点</Text>
                          <Text size="sm" fw={700} mt={4}>{projectMemorySummary.styleAssetCount}</Text>
                        </InlinePanel>
                        <InlinePanel className="tc-pm__chapter-project-memory-stat">
                          <Text size="xs" c="dimmed">文本道具线索</Text>
                          <Text size="sm" fw={700} mt={4}>{(boundSourceChapterDetail?.props || mappedSourceChapterMeta?.props || []).length}</Text>
                        </InlinePanel>
                      </SimpleGrid>
                      <Stack gap="xs" mt="sm">
                        {activeSharedMemorySignals.map((item) => (
                          <InlinePanel key={item} className="tc-pm__chapter-project-memory-signal">
                            <Text size="sm">{item}</Text>
                          </InlinePanel>
                        ))}
                      </Stack>
                    </PanelCard>
                    <PanelCard>
                      <Text fw={700} mb="xs">章节裁剪</Text>
                      <Text size="sm" c="dimmed">
                        本页只渲染当前章节相关内容，不默认拉取整项目全量镜头、任务与历史。
                      </Text>
                    </PanelCard>
                    <PanelCard>
                      <Group justify="space-between" align="flex-start" mb="xs">
                        <Box>
                          <Text fw={700}>流程入口</Text>
                          <Text size="sm" c="dimmed">章节和镜头拥有各自的 Studio 流程，项目继续保留共享资源。</Text>
                        </Box>
                        {flowMetaLoading ? <Loader size="xs" /> : null}
                      </Group>
                      <Stack gap="xs">
                        <InlinePanel>
                          <Group justify="space-between" align="flex-start">
                            <Box>
                              <Text size="sm" fw={600}>章节流程</Text>
                              <Text size="xs" c="dimmed">当前章节可维护自己的工作流、节点和运行记录。</Text>
                            </Box>
                            <Badge variant="light">{chapterFlowCount}</Badge>
                          </Group>
                          <Button
                            mt="sm"
                            size="xs"
                            variant="light"
                            leftSection={<IconVectorBezier2 size={14} />}
                            loading={openingChapterStudio}
                            onClick={() => { void handleOpenChapterStudio() }}
                          >
                            进入章节流程
                          </Button>
                        </InlinePanel>
                        <InlinePanel>
                          <Group justify="space-between" align="flex-start">
                            <Box>
                              <Text size="sm" fw={600}>镜头流程</Text>
                              <Text size="xs" c="dimmed">
                                {shotDraft?.shotId ? '为当前镜头单独维护生成链路、返工链路和实验流。'
                                  : '先选中一个镜头，再进入镜头级流程。'}
                              </Text>
                            </Box>
                            <Badge variant="light">{shotDraft?.shotId ? shotFlowCount : 0}</Badge>
                          </Group>
                          <Button
                            mt="sm"
                            size="xs"
                            leftSection={<IconPlayerPlay size={14} />}
                            disabled={!shotDraft?.shotId}
                            loading={openingShotStudio}
                            onClick={() => { void handleOpenShotStudio() }}
                          >
                            进入镜头流程
                          </Button>
                        </InlinePanel>
                        <Button
                          variant="subtle"
                          size="xs"
                          onClick={() => {
                            void getProjectDefaultEntry(projectId)
                              .then((entry) => spaNavigate(buildProjectChapterUrl(entry.projectId, entry.chapterId)))
                              .catch(() => spaNavigate(buildStudioUrl()))
                          }}
                        >
                          回到最近章节入口
                        </Button>
                      </Stack>
                    </PanelCard>
                  </Group>
                  ) : null}

                  {showAdvancedPanels ? (
                  <Group grow align="stretch">
                    <PanelCard>
                      <Group justify="space-between" align="flex-start" mb="xs">
                        <Box>
                          <Text fw={700}>连续性总览</Text>
                          <Text size="xs" c="dimmed">查看当前章节的连续性和状态。</Text>
                        </Box>
                        <Badge variant="light" color={continuityChecks.every((item) => item.status === 'ready') ? 'green' : 'yellow'}>
                          {continuityChecks.filter((item) => item.status === 'ready').length}/{continuityChecks.length}
                        </Badge>
                      </Group>
                      <Stack gap="sm">
                        {continuityChecks.map((item) => (
                          <InlinePanel key={item.key}>
                            <Group justify="space-between" align="flex-start" gap="sm">
                              <Box style={{ flex: 1, minWidth: 0 }}>
                                <Text size="sm" fw={700}>{item.label}</Text>
                                <Text size="xs" c="dimmed" mt={4}>{item.detail}</Text>
                              </Box>
                              <Badge
                                variant="light"
                                color={item.status === 'ready' ? 'green' : item.status === 'warning' ? 'yellow' : 'gray'}
                              >
                                {item.status === 'ready' ? '稳定' : item.status === 'warning' ? '需盯紧' : '未就绪'}
                              </Badge>
                            </Group>
                          </InlinePanel>
                        ))}
                      </Stack>
                    </PanelCard>

                    <PanelCard>
                      <Group justify="space-between" align="flex-start" mb="xs">
                        <Box>
                          <Text fw={700}>章节推进闭环</Text>
                          <Text size="xs" c="dimmed">查看本章当前阶段和进度。</Text>
                        </Box>
                        <Badge variant="light" color={chapterProgressSummary.memoryReady ? 'green' : chapterProgressSummary.renderReady ? 'blue' : 'gray'}>
                          {chapterProgressSummary.memoryReady ? '可复用' : chapterProgressSummary.renderReady ? '已出结果' : '推进中'}
                        </Badge>
                      </Group>
                      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                        <InlinePanel>
                          <Text size="xs" c="dimmed">原文绑定</Text>
                          <Text size="sm" fw={700} mt={4}>{chapterProgressSummary.planningReady ? '已锁定' : '未锁定'}</Text>
                        </InlinePanel>
                        <InlinePanel>
                          <Text size="xs" c="dimmed">镜头执行单元</Text>
                          <Text size="sm" fw={700} mt={4}>{chapterProgressSummary.storyboardReady ? `${workbenchStats.totalShots} 个镜头` : '未建立'}</Text>
                        </InlinePanel>
                        <InlinePanel>
                          <Text size="xs" c="dimmed">可审阅结果</Text>
                          <Text size="sm" fw={700} mt={4}>{chapterProgressSummary.renderReady ? '已有结果图' : '尚未出图'}</Text>
                        </InlinePanel>
                        <InlinePanel>
                          <Text size="xs" c="dimmed">场景资源</Text>
                          <Text size="sm" fw={700} mt={4}>{chapterProgressSummary.memoryReady ? '已加入项目' : '未加入项目'}</Text>
                        </InlinePanel>
                      </SimpleGrid>
                    </PanelCard>
                  </Group>
                  ) : null}

                  {showAdvancedPanels && showAdvancedDiagnostics ? (
                  <PanelCard className="tc-pm__chapter-timeline-card" data-tour="chapter-rework-diagnosis">
                    <Group justify="space-between" align="flex-start" mb="sm">
                      <Box>
                        <Text fw={700}>本章推进记录</Text>
                        <Text size="xs" c="dimmed">查看本章的关键动作和时间线。</Text>
                      </Box>
                      <Badge variant="light">{productionTimeline.filter((item) => item.tone !== 'gray').length}/5</Badge>
                    </Group>
                    <Stack gap="sm">
                      {productionTimeline.map((item) => (
                        <InlinePanel key={item.key} className="tc-pm__chapter-timeline-item">
                          <Group justify="space-between" align="flex-start" gap="sm">
                            <Box style={{ flex: 1, minWidth: 0 }}>
                              <Group gap={8}>
                                <Badge
                                  variant="light"
                                  color={item.tone === 'green' ? 'green' : item.tone === 'blue' ? 'blue' : 'gray'}
                                >
                                  {item.tone === 'green' ? '已记录' : item.tone === 'blue' ? '处理中' : '待完成'}
                                </Badge>
                                <Text size="sm" fw={700}>{item.title}</Text>
                              </Group>
                              <Text size="xs" c="dimmed" mt={6}>{item.detail}</Text>
                            </Box>
                            <Text size="xs" c="dimmed">{formatMoment(item.time)}</Text>
                          </Group>
                        </InlinePanel>
                      ))}
                    </Stack>
                  </PanelCard>
                  ) : null}

                  {showAdvancedPanels && showAdvancedDiagnostics ? (
                  <PanelCard className="tc-pm__chapter-recent-actions-card">
                    <Group justify="space-between" align="flex-start" mb="sm">
                      <Box>
                        <Text fw={700}>最近生产动作</Text>
                        <Text size="xs" c="dimmed">查看最近动作记录。</Text>
                      </Box>
                      <Badge variant="light">{recentTaskItems.length}</Badge>
                    </Group>
                    {recentTaskItems.length ? (
                      <Stack gap="sm">
                        {recentTaskItems.map((item) => (
                          <InlinePanel key={item.id} className="tc-pm__chapter-recent-action-item">
                            <Group justify="space-between" align="flex-start" gap="sm">
                              <Box style={{ flex: 1, minWidth: 0 }}>
                                <Group gap={8}>
                                  <Badge variant="light" color={item.tone}>
                                    {item.ownerType === 'shot' ? '镜头动作' : '章节动作'}
                                  </Badge>
                                  <Text size="sm" fw={700}>{item.title}</Text>
                                </Group>
                                <Text size="xs" c="dimmed" mt={6}>{item.detail}</Text>
                              </Box>
                              <Text size="xs" c="dimmed">{formatMoment(item.updatedAt)}</Text>
                            </Group>
                          </InlinePanel>
                        ))}
                      </Stack>
                    ) : (
                      <Text size="sm" c="dimmed">当前章节还没有足够的生产动作记录。</Text>
                    )}
                  </PanelCard>
                  ) : null}

                  {showAdvancedPanels && showAdvancedDiagnostics ? (
                  <PanelCard className="tc-pm__chapter-rework-card">
                    <Group justify="space-between" align="flex-start" mb="sm">
                      <Box>
                        <Text fw={700}>返工原因定位</Text>
                        <Text size="xs" c="dimmed">查看当前返工相关信息。</Text>
                      </Box>
                      <Badge variant="light" color={reworkDiagnosisItems.some((item) => item.tone === 'red') ? 'red' : reworkDiagnosisItems.some((item) => item.tone === 'yellow') ? 'yellow' : 'gray'}>
                        {workbenchStats.reworkShots > 0 ? '待处理' : '当前稳定'}
                      </Badge>
                    </Group>
                    <Stack gap="sm">
                      {reworkDiagnosisItems.map((item) => (
                        <InlinePanel key={item.title} className="tc-pm__chapter-rework-item">
                          <Group justify="space-between" align="flex-start" gap="sm">
                            <Box style={{ flex: 1, minWidth: 0 }}>
                              <Text size="sm" fw={700}>{item.title}</Text>
                              <Text size="xs" c="dimmed" mt={4}>{item.detail}</Text>
                            </Box>
                            <Badge variant="light" color={item.tone}>
                              {item.tone === 'red' ? '阻塞' : item.tone === 'yellow' ? '风险' : '提示'}
                            </Badge>
                          </Group>
                        </InlinePanel>
                      ))}
                    </Stack>
                  </PanelCard>
                  ) : null}

                  {showAdvancedPanels && showAdvancedDiagnostics ? (
                    <Group grow align="stretch">
                      <PanelCard className="tc-pm__chapter-render-overview-card" data-tour="chapter-render-panel">
                        <Group justify="space-between" align="flex-start" mb="sm">
                          <Box>
                            <Text fw={700}>共享资源总览</Text>
                            <Text size="xs" c="dimmed">查看当前项目的共享资源。</Text>
                          </Box>
                          {resourceLoading ? <Loader size="xs" /> : null}
                        </Group>
                        <SimpleGrid cols={2}>
                          <InlinePanel className="tc-pm__chapter-render-overview-stat">
                            <Text size="sm" fw={600}>场景资产</Text>
                            <Text size="xs" c="dimmed" mt={4}>项目共享 {sceneAssets.length} 个</Text>
                          </InlinePanel>
                          <InlinePanel className="tc-pm__chapter-render-overview-stat">
                            <Text size="sm" fw={600}>风格资产</Text>
                            <Text size="xs" c="dimmed" mt={4}>项目共享 {styleAssets.length} 个</Text>
                          </InlinePanel>
                        </SimpleGrid>
                      </PanelCard>

                      <PanelCard className="tc-pm__chapter-current-resource-card">
                        <Group justify="space-between" align="flex-start" mb="sm">
                          <Box>
                            <Text fw={700}>当前镜头资源</Text>
                            <Text size="xs" c="dimmed">查看当前镜头绑定的场景资源和影响范围。</Text>
                          </Box>
                          {currentSceneAsset ? (
                            <Badge variant="light">{currentSceneAsset.currentVersion} versions</Badge>
                          ) : (
                            <Badge variant="light" color="gray">未绑定场景</Badge>
                          )}
                        </Group>
                        {currentSceneAsset ? (
                          <Stack gap="xs">
                            <InlinePanel className="tc-pm__chapter-current-resource-block">
                              <Text size="sm" fw={600}>{currentSceneAsset.name}</Text>
                              <Text size="xs" c="dimmed" mt={4}>
                                {currentSceneOriginChapterId
                                  ? currentSceneOriginChapterId === chapterId
                                    ? '来源：当前章节产出，可视作章节内刚沉淀到项目共享层的资源'
                                    : `来源：其他章节产出（${currentSceneOriginChapterId}）`
                                  : '来源：项目共享资源'}
                              </Text>
                            </InlinePanel>
                            <InlinePanel className="tc-pm__chapter-current-resource-block">
                              <Text size="sm" fw={600}>影响面</Text>
                              <Text size="xs" c="dimmed" mt={4}>
                                已绑定镜头 {impactedShotCount} 个 · 过期引用 {outdatedShotCount} 个
                              </Text>
                            </InlinePanel>
                          </Stack>
                        ) : (
                          <Text size="sm" c="dimmed">当前镜头还没有绑定场景物料。</Text>
                        )}
                      </PanelCard>
                    </Group>
                  ) : null}

                  {showAdvancedPanels && showAdvancedDiagnostics && currentSceneAsset ? (
                    <PanelCard className="tc-pm__chapter-impact-card">
                      <Group justify="space-between" align="flex-start" mb="sm">
                        <Box>
                          <Text fw={700}>资源影响范围</Text>
                          <Text size="xs" c="dimmed">当共享资源升级版本后，这里会告诉你哪些镜头仍绑定旧版本。</Text>
                        </Box>
                        <Badge variant="light" color={outdatedShotCount > 0 ? 'orange' : 'green'}>
                          {outdatedShotCount > 0 ? `${outdatedShotCount} 个需同步` : '引用已同步'}
                        </Badge>
                      </Group>
                      <Stack gap="sm">
                        {currentSceneImpact?.items?.length ? currentSceneImpact.items.slice(0, 8).map((item) => {
                          const impactedShot = workbench.shots.find((shot) => shot.id === item.shotId)
                          const isCurrentShot = impactedShot?.id === activeShot?.id
                          return (
                            <InlinePanel key={`${item.assetId}-${item.shotId}`} className="tc-pm__chapter-impact-item">
                              <Group justify="space-between" align="flex-start">
                                <Box>
                                  <Text size="sm" fw={600}>
                                    {impactedShot?.title || `Shot ${(impactedShot?.shotIndex ?? 0) + 1}`}
                                    {isCurrentShot ? ' · 当前镜头' : ''}
                                  </Text>
                                  <Text size="xs" c="dimmed" mt={4}>
                                    绑定版本 v{item.boundVersion} · 当前版本 v{item.currentVersion}
                                  </Text>
                                </Box>
                                <Badge variant="light" color={item.isOutdated ? 'orange' : 'green'}>
                                  {item.isOutdated ? '待同步' : '已同步'}
                                </Badge>
                              </Group>
                            </InlinePanel>
                          )
                        }) : (
                          <Text size="sm" c="dimmed">当前资源还没有关联到其他镜头，影响面为空。</Text>
                        )}
                      </Stack>
                    </PanelCard>
                  ) : null}

                  {showProjectSetupPanel ? (
                  <Group grow align="stretch">
                    <PanelCard className="tc-pm__chapter-project-setup-card">
                      <Group justify="space-between" align="flex-start" mb="sm">
                        <Box>
                          <Text fw={700}>项目设定</Text>
                          <Text size="xs" c="dimmed">章节页只处理当前章，公共资源仍在项目层统一维护。</Text>
                        </Box>
                        <Button size="xs" loading={savingSetup} onClick={() => void handleSaveProjectSetup()}>
                          保存设定
                        </Button>
                      </Group>
                      <Stack gap="sm">
                        <Select
                          label="项目类型"
                          data={[
                            { value: 'nano-comic', label: '漫剧工作台' },
                            { value: 'storyboard', label: '分镜项目' },
                            { value: 'novel-adaptation', label: '小说改编' },
                            { value: 'serialized', label: '连载项目' },
                          ]}
                          value={projectSetup.projectType}
                          onChange={(value) => setProjectSetup((prev) => ({ ...prev, projectType: (value as ProjectSetupProfile['projectType']) || 'nano-comic' }))}
                        />
                        <Textarea
                          label="项目简介"
                          minRows={2}
                          maxRows={4}
                          value={projectSetup.intro}
                          onChange={(event) => setProjectSetup((prev) => ({ ...prev, intro: event.currentTarget.value }))}
                        />
                        <ProjectArtStylePresetPicker
                          value={projectSetup.artStylePresetId}
                          description="项目画风要让人一眼能选，不该只看文字。选中后仍可继续微调规则。"
                          onChange={(value) => {
                            const preset = getArtStylePresetById(value)
                            if (!preset) {
                              setProjectSetup((prev) => ({ ...prev, artStylePresetId: undefined }))
                              return
                            }
                            setProjectSetup((prev) => applyArtStylePresetToProfile(prev, preset))
                          }}
                        />
                        <TextInput
                          label="画风 / 风格名"
                          value={projectSetup.artStyleName}
                          onChange={(event) => setProjectSetup((prev) => ({
                            ...prev,
                            artStylePresetId: undefined,
                            artStyleName: event.currentTarget.value,
                          }))}
                        />
                        <Textarea
                          label="视觉规则"
                          minRows={2}
                          maxRows={4}
                          value={projectSetup.styleDirectives}
                          onChange={(event) => setProjectSetup((prev) => ({
                            ...prev,
                            artStylePresetId: undefined,
                            styleDirectives: event.currentTarget.value,
                          }))}
                        />
                        <Select
                          label="导演手册预设"
                          description="继承 Toonflow 的叙事技能包，用于章节节奏和镜头语言的共识。"
                          data={PROJECT_DIRECTOR_MANUAL_PRESETS.map((item) => ({
                            value: item.id,
                            label: `${item.name} · ${item.tags.join(' / ')}`,
                          }))}
                          value={projectSetup.directorManualPresetId || null}
                          onChange={(value) => {
                            const preset = getDirectorManualPresetById(value)
                            if (!preset) {
                              setProjectSetup((prev) => ({ ...prev, directorManualPresetId: undefined }))
                              return
                            }
                            setProjectSetup((prev) => applyDirectorManualPresetToProfile(prev, preset))
                          }}
                          clearable
                          searchable
                          nothingFoundMessage="没有匹配的导演预设"
                        />
                        {selectedDirectorManualPreset ? (
                          <InlinePanel className="tc-pm__chapter-project-setup-highlight">
                            <Group justify="space-between" align="flex-start">
                              <Box style={{ minWidth: 0 }}>
                                <Text size="sm" fw={700}>{selectedDirectorManualPreset.name}</Text>
                                <Text size="xs" c="dimmed" mt={4}>{selectedDirectorManualPreset.summary}</Text>
                              </Box>
                              <Badge variant="light" color="grape">Toonflow</Badge>
                            </Group>
                            <Text size="xs" mt={8}>{selectedDirectorManualPreset.tags.join(' · ')}</Text>
                          </InlinePanel>
                        ) : null}
                        <Textarea
                          label="导演手册"
                          minRows={3}
                          maxRows={5}
                          value={projectSetup.directorManual}
                          onChange={(event) => setProjectSetup((prev) => ({
                            ...prev,
                            directorManualPresetId: undefined,
                            directorManual: event.currentTarget.value,
                          }))}
                        />
                        <Group grow>
                          <Select
                            label="画幅比例"
                            data={[
                              { value: '9:16', label: '9:16 竖屏' },
                              { value: '16:9', label: '16:9 横屏' },
                              { value: '1:1', label: '1:1 方图' },
                              { value: '4:3', label: '4:3 传统' },
                            ]}
                            value={projectSetup.videoRatio}
                            onChange={(value) => setProjectSetup((prev) => ({ ...prev, videoRatio: (value as ProjectSetupProfile['videoRatio']) || '9:16' }))}
                          />
                          <Select
                            label="图片质量"
                            data={[
                              { value: 'draft', label: '草稿' },
                              { value: 'standard', label: '标准' },
                              { value: 'high', label: '高质量' },
                            ]}
                            value={projectSetup.imageQuality}
                            onChange={(value) => setProjectSetup((prev) => ({ ...prev, imageQuality: (value as ProjectSetupProfile['imageQuality']) || 'standard' }))}
                          />
                        </Group>
                      </Stack>
                    </PanelCard>

                    {showSourceUploadPanel ? (
                    <PanelCard className="tc-pm__chapter-text-card">
                      <Text fw={700} mb="xs">文本与共享资源</Text>
                      <Stack gap="sm">
                        <InlinePanel className="tc-pm__chapter-text-block" ref={textSectionRef}>
                          <Text size="sm" fw={700}>文本导入区</Text>
                          <Text size="xs" c="dimmed" mt={4}>如果你刚创建项目，先在这里上传原文。后面的章节绑定和镜头生产都会围绕这份文本展开。</Text>
                        </InlinePanel>
                        <InlinePanel className="tc-pm__chapter-text-block">
                          <Text size="sm" fw={600}>导入状态</Text>
                          {projectBooks[0] ? (
                            <>
                              <Text size="sm" mt={4}>{projectBooks[0].title}</Text>
                              <Text size="xs" c="dimmed">
                                已拆书 {projectBooks[0].chapterCount} 章 · 更新时间 {new Date(projectBooks[0].updatedAt).toLocaleString()}
                              </Text>
                            </>
                          ) : projectTextAsset ? (
                            <>
                              <Text size="sm" mt={4}>已上传项目文本</Text>
                              <Text size="xs" c="dimmed">
                                当前模式 {textAssetKind || '文本资产'}{projectSetup.lastTextUploadName ? ` · ${projectSetup.lastTextUploadName}` : ''}
                              </Text>
                            </>
                          ) : (
                            <Text size="sm" c="dimmed" mt={4}>当前项目还没有导入原文。</Text>
                          )}
                        </InlinePanel>

                        {styleBible ? (
                          <InlinePanel className="tc-pm__chapter-text-block">
                            <Text size="sm" fw={600}>Style Bible</Text>
                            <Text size="sm" mt={4}>{styleBible.styleName || '未命名风格'}</Text>
                            <Text size="xs" c="dimmed" mt={4}>
                              视觉规则 {styleBible.visualDirectives.length} 条 · 一致性规则 {styleBible.consistencyRules.length} 条
                            </Text>
                          </InlinePanel>
                        ) : null}

                        <FileInput
                          label="补充 / 替换原文"
                          description="上传小说会进入现有拆书链路，也可用于替换当前项目文本。"
                          value={projectTextFile}
                          onChange={setProjectTextFile}
                          placeholder="选择文本文件"
                          clearable
                        />
                        <Button loading={uploadingText} disabled={!projectTextFile} onClick={() => void handleUploadProjectText()}>
                          上传文本
                        </Button>
                      </Stack>
                    </PanelCard>
                    ) : null}
                  </Group>
                  ) : null}

                  <PanelCard className="tc-pm__shots-card">
                    <Box ref={shotsSectionRef} />
                    <InlinePanel className="tc-pm__shots-toolbar-block" style={{ marginBottom: '12px' }}>
                      <Group justify="space-between" align="flex-start" gap="md">
                        <Box style={{ flex: 1, minWidth: 260 }}>
                          <Group gap="xs" mb={6}>
                            <Text fw={700}>镜头板</Text>
                            <Badge variant="light">{workbench.shots.length} 个镜头</Badge>
                          </Group>
                          <Text size="sm">{shotControlSummary}</Text>
                          <Text size="xs" c="dimmed" mt={6}>
                            默认只保留当前阶段最有用的动作，搜索、筛选和批量整理都收进“整理镜头”。
                          </Text>
                          {recommendedShots.length ? (
                            <Text size="xs" mt={6}>
                              建议先做：{recommendedShotLabel}
                            </Text>
                          ) : null}
                        </Box>
                        <Group gap="xs">
                          <Button
                            size="xs"
                            loading={draftingShots}
                            disabled={!canDraftShotsFromChapter}
                            onClick={() => void handleDraftShotsFromChapter({ autoOpenPreferredShot: true, autoKickoffPreferredShot: workbench.shots.length === 0 })}
                          >
                            {workbench.shots.length === 0 ? '一键生成镜头板' : '继续补镜头'}
                          </Button>
                          <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} loading={creatingShot} onClick={() => void handleCreateShot()}>
                            新建镜头
                          </Button>
                          <Button
                            size="xs"
                            variant={shotControlDirty ? 'filled' : 'default'}
                            onClick={() => setShotControlExpanded((prev) => !prev)}
                          >
                            {shotControlExpanded ? '收起整理区' : '整理镜头'}
                          </Button>
                        </Group>
                      </Group>
                      {shotDraft ? (
                        <PanelCard className="tc-pm__shot-preview-card" padding="compact" mt="sm">
                          <Group justify="space-between" align="flex-start" gap="md" wrap="nowrap">
                            <Group align="stretch" gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                              <Box className="tc-pm__shot-preview-media">
                                {currentShotPreviewUrl ? (
                                  <Box
                                    component="img"
                                    src={currentShotPreviewUrl}
                                    alt={shotDraft.title || '当前镜头预览'}
                                    className="tc-pm__shot-preview-image"
                                  />
                                ) : (
                                  <InlinePanel className="tc-pm__shot-preview-placeholder">
                                    <Stack gap={6}>
                                      <Text size="sm" fw={700}>当前镜头还没有结果图</Text>
                                      <Text size="xs" c="dimmed">先补齐 Prompt 和命中资产，再启动第一次生成。</Text>
                                    </Stack>
                                  </InlinePanel>
                                )}
                              </Box>
                              <Stack gap="sm" style={{ flex: 1, minWidth: 0 }}>
                                <Box>
                                  <Group gap="xs" mb={6}>
                                    <Badge variant="light" color={shotHasRenderResult ? 'green' : 'blue'}>
                                      {shotHasRenderResult ? '可确认' : '待出图'}
                                    </Badge>
                                    <Badge variant="light" color={getShotProductionStatusTone(shotDraft.status)}>
                                      {formatShotProductionStatus(shotDraft.status)}
                                    </Badge>
                                    {currentSceneAsset ? <Badge variant="light" color="teal">已入共享场景</Badge> : null}
                                  </Group>
                                  <Text fw={700}>{shotDraft.title || '未命名镜头'}</Text>
                                  <Text size="sm" c="dimmed" mt={4}>
                                    {shotDraft.summary || '当前镜头还没有摘要，建议先补一句明确动作和构图。'}
                                  </Text>
                                  <Text size="xs" c="dimmed" mt={6}>
                                    这里只保留当前镜头概览；编辑、绑定、选图和推进都放到镜头工作区里处理。
                                  </Text>
                                </Box>
                                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                                  {currentShotChecklistItems.map((item) => (
                                    <InlinePanel key={item.key} className="tc-pm__shot-workspace-subblock">
                                      <Group justify="space-between" align="flex-start" gap="sm">
                                        <Box style={{ flex: 1, minWidth: 0 }}>
                                          <Text size="xs" c="dimmed">{item.label}</Text>
                                          <Text size="sm" fw={700} mt={4}>{item.ready ? '已就绪' : '待处理'}</Text>
                                          <Text size="xs" c="dimmed" mt={4}>{item.detail}</Text>
                                        </Box>
                                        <Badge variant="light" color={item.ready ? 'green' : 'yellow'}>
                                          {item.ready ? 'OK' : '缺失'}
                                        </Badge>
                                      </Group>
                                    </InlinePanel>
                                  ))}
                                </SimpleGrid>
                              </Stack>
                            </Group>
                            <Stack gap="xs" align="flex-end">
                              <Button size="sm" variant="light" leftSection={<IconPhoto size={14} />} onClick={() => setShotWorkspaceModalOpen(true)}>
                                进入镜头工作区
                              </Button>
                              <Text size="xs" c="dimmed" ta="right">
                                {shotWorkspacePrimaryActionHint}
                              </Text>
                            </Stack>
                          </Group>
                        </PanelCard>
                      ) : null}
                      {shotControlExpanded ? (
                        <Stack gap="sm" mt="sm">
                          <Group grow align="end">
                            <TextInput
                              leftSection={<IconSearch size={14} />}
                              label="搜索镜头"
                              placeholder="标题 / 摘要 / 状态"
                              value={shotQuery}
                              onChange={(event) => setShotQuery(event.currentTarget.value)}
                            />
                            <Select
                              label="状态筛选"
                              value={shotStatusFilter}
                              onChange={(value) => setShotStatusFilter(((value as typeof shotStatusFilter) || 'all'))}
                              data={[
                                { value: 'all', label: '全部状态' },
                                { value: 'queued', label: '待处理' },
                                { value: 'running', label: '处理中' },
                                { value: 'succeeded', label: '已完成' },
                                { value: 'failed', label: '需返工' },
                              ]}
                            />
                          </Group>
                          <Group justify="space-between" align="center">
                            <Group gap="xs">
                              <Button
                                size="xs"
                                variant="default"
                                disabled={filteredShots.length === 0}
                                onClick={() => {
                                  const filteredIds = filteredShots.map((item) => item.id)
                                  setSelectedShotIds((prev) => {
                                    const filteredSet = new Set(filteredIds)
                                    const allSelected = filteredIds.every((id) => prev.includes(id))
                                    if (allSelected) return prev.filter((id) => !filteredSet.has(id))
                                    return Array.from(new Set([...prev, ...filteredIds]))
                                  })
                                }}
                              >
                                {filteredShots.length > 0 && filteredShots.every((item) => selectedShotIds.includes(item.id)) ? '取消全选' : '全选当前结果'}
                              </Button>
                              <Text size="xs" c="dimmed">已选 {selectedShotIds.length} 个</Text>
                              {(shotStatusFilter !== 'all' || shotQuery.trim()) ? (
                                <Button
                                  size="xs"
                                  variant="subtle"
                                  onClick={() => {
                                    setShotStatusFilter('all')
                                    setShotQuery('')
                                    setSelectedShotIds([])
                                  }}
                                >
                                  清空筛选
                                </Button>
                              ) : null}
                            </Group>
                            <Group gap="xs">
                              <Button size="xs" variant="light" loading={batchUpdatingShots} onClick={() => void handleBatchUpdateShots('queued')}>
                                批量待处理
                              </Button>
                              <Button size="xs" variant="light" loading={batchUpdatingShots} onClick={() => void handleBatchUpdateShots('running')}>
                                批量处理中
                              </Button>
                              <Button size="xs" variant="light" loading={batchUpdatingShots} onClick={() => void handleBatchUpdateShots('failed')}>
                                批量返工
                              </Button>
                            </Group>
                          </Group>
                        </Stack>
                      ) : null}
                    </InlinePanel>
                    {workbench.shots.length === 0 ? (
                      <Text size="sm" c="dimmed">当前章节还没有镜头数据。可点击“按本章文本起稿”生成第一版镜头板，或手动新建镜头。</Text>
                    ) : filteredShots.length === 0 ? (
                      <Text size="sm" c="dimmed">没有匹配当前筛选条件的镜头。</Text>
                    ) : (
                      <Stack gap="sm">
                        {filteredShots.map((shot, filteredIndex) => {
                          const active = activeShotId && shot.id === activeShotId
                          const shotRender = pickShotRenderAsset(shotRenderAssets, shot.id)
                          const shotImages = shotRender?.data.images || []
                          const shotPreviewUrl =
                            String(shotRender?.data.selectedImageUrl || '').trim()
                            || String(shotImages[0]?.thumbnailUrl || shotImages[0]?.url || '').trim()
                          return (
                            <InlinePanel
                              className="tc-pm__shot-list-item"
                              key={shot.id}
                              style={{
                                borderColor: active ? 'var(--mantine-color-blue-5)' : undefined,
                                background: active ? 'rgba(59, 130, 246, 0.08)' : undefined,
                              }}
                              onClick={() => spaNavigate(buildProjectChapterUrl(projectId, chapterId, shot.id))}
                            >
                              <Group className="tc-pm__shot-list-item-row" justify="space-between" align="stretch" wrap="nowrap">
                                <Group className="tc-pm__shot-list-item-main" gap="sm" align="stretch" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                                  {shotControlExpanded ? (
                                    <Checkbox
                                      className="tc-pm__shot-list-item-checkbox"
                                      mt={2}
                                      checked={selectedShotIds.includes(shot.id)}
                                      onChange={(event) => {
                                        event.stopPropagation()
                                        setSelectedShotIds((prev) => event.currentTarget.checked
                                          ? Array.from(new Set([...prev, shot.id]))
                                          : prev.filter((item) => item !== shot.id))
                                      }}
                                      onClick={(event) => event.stopPropagation()}
                                    />
                                  ) : null}
                                  {shotPreviewUrl ? (
                                    <Box className="tc-pm__shot-list-preview-media">
                                      <Box
                                        component="img"
                                        src={shotPreviewUrl}
                                        alt={shot.title || '镜头预览'}
                                        className="tc-pm__shot-list-preview-image"
                                      />
                                    </Box>
                                  ) : (
                                    <Box className="tc-pm__shot-list-preview-media tc-pm__shot-list-preview-media--empty">
                                      <Text className="tc-pm__shot-list-preview-empty" size="xs">无预览</Text>
                                    </Box>
                                  )}
                                  <Box className="tc-pm__shot-list-copy" style={{ minWidth: 0, flex: 1 }}>
                                    <Group className="tc-pm__shot-list-title-row" gap={6} wrap="wrap">
                                      <Text className="tc-pm__shot-list-index" fw={700} size="sm">{`Shot ${shot.shotIndex + 1}`}</Text>
                                      <Text className="tc-pm__shot-list-title" size="sm">{shot.title || '未命名镜头'}</Text>
                                      {recommendedShotIds.includes(shot.id) ? (
                                        <Badge size="xs" color="orange" variant="light">建议优先</Badge>
                                      ) : null}
                                    </Group>
                                    {shot.summary ? <Text className="tc-pm__shot-list-summary" size="xs" c="dimmed" lineClamp={3}>{shot.summary}</Text> : null}
                                  </Box>
                                </Group>
                                <Group className="tc-pm__shot-list-item-actions" gap={4} wrap="nowrap">
                                  {shotControlExpanded ? (
                                    <>
                                      <ActionIcon
                                        size="sm"
                                        variant="subtle"
                                        color="gray"
                                        loading={reorderingShotId === shot.id}
                                        disabled={shotOrderingLocked || filteredIndex <= 0}
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          void handleMoveShot(shot.id, 'up')
                                        }}
                                        aria-label="上移镜头"
                                      >
                                        <IconArrowUp size={14} />
                                      </ActionIcon>
                                      <ActionIcon
                                        size="sm"
                                        variant="subtle"
                                        color="gray"
                                        loading={reorderingShotId === shot.id}
                                        disabled={shotOrderingLocked || filteredIndex >= filteredShots.length - 1}
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          void handleMoveShot(shot.id, 'down')
                                        }}
                                        aria-label="下移镜头"
                                      >
                                        <IconArrowDown size={14} />
                                      </ActionIcon>
                                    </>
                                  ) : null}
                                  <Badge variant="light" color={getShotProductionStatusTone(shot.status)}>
                                    {formatShotProductionStatus(shot.status)}
                                  </Badge>
                                </Group>
                              </Group>
                            </InlinePanel>
                          )
                        })}
                      </Stack>
                    )}
                  </PanelCard>

                  {shotDraft ? (
                    <>
                      <Modal
                        opened={shotWorkspaceModalOpen}
                        onClose={() => setShotWorkspaceModalOpen(false)}
                        title="镜头工作区"
                        size="min(1180px, 96vw)"
                        centered
                        classNames={{
                          body: 'tc-pm__shot-workspace-modal-body',
                          content: 'tc-pm__shot-workspace-modal-content',
                        }}
                      >
                        <PanelCard className="tc-pm__shot-workspace-card">
                      <Box ref={renderSectionRef} />
                      <Group justify="space-between" align="flex-start" mb="sm">
                        <Box>
                          <Text fw={700}>镜头工作区</Text>
                          <Text size="xs" c="dimmed">
                            {shotHasRenderResult ? '当前镜头已有结果，重点做选图、沉淀资产和审阅。' : '当前镜头还没出图，先整理信息并完成第一次生成。'}
                          </Text>
                        </Box>
                        <Stack gap={6} align="flex-end">
                          {currentShotRender?.data.status ? (
                            <Badge
                              variant="light"
                              color={
                                currentShotRender.data.status === 'succeeded'
                                  ? 'green'
                                  : currentShotRender.data.status === 'failed'
                                    ? 'red'
                                    : 'blue'
                              }
                            >
                              {formatShotProductionStatus(currentShotRender.data.status)}
                            </Badge>
                          ) : null}
                          <Button
                            size="sm"
                            leftSection={shotHasRenderResult ? <IconChevronRight size={16} /> : <IconPlayerPlay size={16} />}
                            loading={shotHasRenderResult ? confirmingShotResult : generatingShotImage}
                            onClick={() => void (shotHasRenderResult ? handleConfirmShotResultAndContinue() : handleGenerateShotImage())}
                          >
                            {shotWorkspacePrimaryActionLabel}
                          </Button>
                          <Text size="xs" c="dimmed" ta="right">
                            {shotWorkspacePrimaryActionHint}
                          </Text>
                          <Button
                            size="xs"
                            variant="subtle"
                            color="gray"
                            onClick={() => setShowShotAdvancedActions((prev) => !prev)}
                          >
                            {showShotAdvancedActions ? '收起次要操作' : '展开次要操作'}
                          </Button>
                        </Stack>
                      </Group>
                      {showShotAdvancedActions ? (
                        <Group gap="xs" mb="sm">
                          <Button
                            size="xs"
                            variant="light"
                            leftSection={<IconRefresh size={14} />}
                            onClick={() => {
                              if (!workbench || !shotDraft?.shotId) return
                              setShotRenderPrompt(composeShotRenderPrompt({
                                workbenchValue: workbench,
                                shotIdValue: shotDraft.shotId,
                                sourceChapterDetailValue: boundSourceChapterDetail,
                              }))
                            }}
                          >
                            重建 Prompt
                          </Button>
                          {!shotHasRenderResult ? null : (
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={<IconPhoto size={14} />}
                              loading={promotingShotResult}
                              disabled={!currentShotRender?.data.selectedImageUrl}
                              onClick={() => void handlePromoteShotResultToSceneAsset()}
                            >
                              仅同步为场景物料
                            </Button>
                          )}
                          {shotHasRenderResult ? (
                            <Button size="xs" variant="light" color="orange" loading={savingShot} onClick={() => void handleReviewDecision('rework')}>
                              打回返工
                            </Button>
                          ) : null}
                          <Button size="xs" color="red" variant="light" leftSection={<IconTrash size={14} />} loading={deletingShot} onClick={() => void handleDeleteShot()}>
                            删除镜头
                          </Button>
                        </Group>
                      ) : null}
                      <Stack gap="sm">
                        <InlinePanel className="tc-pm__shot-workspace-step">
                          <Group justify="space-between" align="flex-start" mb="xs">
                            <Box>
                              <Text size="sm" fw={700}>Step 1 · 整理当前镜头</Text>
                              <Text size="xs" c="dimmed">
                                {shotHasRenderResult ? '当前镜头已经出图，默认收起编辑表单，只保留关键信息。' : '先把标题、摘要和状态收准，再执行生成。'}
                              </Text>
                            </Box>
                            {shotHasRenderResult && !showShotAdvancedActions ? (
                              <Button size="xs" variant="light" onClick={() => setShowShotAdvancedActions(true)}>
                                调整镜头信息
                              </Button>
                            ) : (
                              <Button size="xs" loading={savingShot} onClick={() => void handleSaveShot()}>
                                保存镜头
                              </Button>
                            )}
                          </Group>
                          {shotHasRenderResult && !showShotAdvancedActions ? (
                            <Stack gap="xs">
                              <InlinePanel className="tc-pm__shot-workspace-subblock">
                                <Text size="xs" c="dimmed">镜头标题</Text>
                                <Text size="sm" fw={600} mt={4}>{shotDraft.title || '未命名镜头'}</Text>
                              </InlinePanel>
                              <InlinePanel className="tc-pm__shot-workspace-subblock">
                                <Text size="xs" c="dimmed">镜头摘要</Text>
                                <Text size="sm" mt={4}>{shotDraft.summary || '当前镜头还没有摘要。'}</Text>
                              </InlinePanel>
                              <InlinePanel className="tc-pm__shot-workspace-subblock">
                                <Text size="xs" c="dimmed">镜头状态</Text>
                                <Text size="sm" mt={4}>{shotDraft.status === 'failed' ? '需返工' : shotDraft.status === 'running' ? '处理中' : shotDraft.status === 'succeeded' ? '已完成' : '待处理'}</Text>
                              </InlinePanel>
                            </Stack>
                          ) : (
                            <Stack gap="sm">
                              <TextInput
                                label="镜头标题"
                                value={shotDraft.title}
                                onChange={(event) => setShotDraft((prev) => prev ? { ...prev, title: event.currentTarget.value } : prev)}
                              />
                              <Textarea
                                label="镜头摘要"
                                minRows={2}
                                maxRows={4}
                                value={shotDraft.summary}
                                onChange={(event) => setShotDraft((prev) => prev ? { ...prev, summary: event.currentTarget.value } : prev)}
                              />
                              <Select
                                label="镜头状态"
                                data={[
                                  { value: 'queued', label: '待处理' },
                                  { value: 'running', label: '处理中' },
                                  { value: 'succeeded', label: '已完成' },
                                  { value: 'failed', label: '需返工' },
                                ]}
                                value={shotDraft.status}
                                onChange={(value) => setShotDraft((prev) => prev ? { ...prev, status: value || 'queued' } : prev)}
                              />
                            </Stack>
                          )}
                        </InlinePanel>
                        {!shotHasRenderResult ? (
                          <>
                            <InlinePanel className="tc-pm__shot-workspace-step">
                              <Group justify="space-between" align="flex-start" mb="xs">
                                <Box>
                                  <Text size="sm" fw={700}>Step 2 · 绑定项目记忆</Text>
                                  <Text size="xs" c="dimmed">让镜头和项目资产之间的关系可见，而不是只存在于 Prompt 里。</Text>
                                </Box>
                                <Button size="xs" variant="light" loading={bindingShotMemory} onClick={() => void handleBindShotMemory()}>
                                  绑定本章命中资产
                                </Button>
                              </Group>
                              <Stack gap="xs">
                                {currentShotBoundAssetCards.length ? currentShotBoundAssetCards.map((item) => (
                                  <InlinePanel key={`${item.asset.id}-${item.ref.assetVersion}`} className="tc-pm__shot-workspace-subblock">
                                    <Group justify="space-between" align="flex-start" gap="sm">
                                      <Box style={{ flex: 1, minWidth: 0 }}>
                                        <Text size="sm" fw={700}>{item.asset.name}</Text>
                                        <Text size="xs" c="dimmed" mt={4}>
                                          {item.asset.kind === 'character' ? '角色资产' : item.asset.kind === 'scene' ? '场景资产' : item.asset.kind === 'prop' ? '道具资产' : '风格资产'}
                                          {` · 绑定版本 v${item.ref.assetVersion}`}
                                        </Text>
                                        {item.previewImageUrl ? (
                                          <Box className="tc-pm__shot-list-preview-media" mt={8}>
                                            <Box
                                              component="img"
                                              src={item.previewImageUrl}
                                              alt={`${item.asset.name} 预览`}
                                              className="tc-pm__shot-list-preview-image"
                                            />
                                          </Box>
                                        ) : null}
                                      </Box>
                                      <Badge variant="light" color={item.ref.assetVersion < item.asset.currentVersion ? 'yellow' : 'green'}>
                                        {item.ref.assetVersion < item.asset.currentVersion ? `当前 v${item.asset.currentVersion}` : '已同步'}
                                      </Badge>
                                    </Group>
                                  </InlinePanel>
                                )) : (
                                  <Text size="sm" c="dimmed">当前镜头还没有绑定项目记忆资产。</Text>
                                )}
                                {suggestedShotMemoryAssets.length ? (
                                  <InlinePanel className="tc-pm__shot-workspace-subblock">
                                    <Group justify="space-between" align="center" gap="xs">
                                      <Text size="sm" fw={700}>可用项目资源</Text>
                                      <Badge variant="light">{suggestedShotMemoryAssets.length}</Badge>
                                    </Group>
                                    <SimpleGrid cols={{ base: 2, md: 3 }} spacing="xs" mt={6}>
                                      {suggestedShotMemoryAssets.map((item) => (
                                        <InlinePanel key={item.asset.id} className="tc-pm__shot-workspace-subblock">
                                          {item.previewImageUrl ? (
                                            <Box className="tc-pm__shot-list-preview-media">
                                              <Box
                                                component="img"
                                                src={item.previewImageUrl}
                                                alt={`${item.asset.name} 资源预览`}
                                                className="tc-pm__shot-list-preview-image"
                                              />
                                            </Box>
                                          ) : (
                                            <Box className="tc-pm__shot-list-preview-media tc-pm__shot-list-preview-media--empty">
                                              <Text className="tc-pm__shot-list-preview-empty" size="xs">无图</Text>
                                            </Box>
                                          )}
                                          <Text size="xs" mt={6} lineClamp={2}>{item.asset.name}</Text>
                                        </InlinePanel>
                                      ))}
                                    </SimpleGrid>
                                  </InlinePanel>
                                ) : null}
                              </Stack>
                            </InlinePanel>
                            <InlinePanel className="tc-pm__shot-workspace-step">
                              <Group justify="space-between" align="flex-start" mb="xs">
                                <Box>
                                  <Text size="sm" fw={700}>Step 3 · 检查本次生成参考</Text>
                                  <Text size="xs" c="dimmed">这里展示当前镜头可用的项目信息。</Text>
                                </Box>
                                <Button size="xs" variant="subtle" loading={syncingChapterMemory} onClick={() => void handleSyncChapterMemory()}>
                                  同步本章线索
                                </Button>
                              </Group>
                              <Stack gap="xs">
                                {promptConstraintItems.map((item) => (
                                  <InlinePanel key={item} className="tc-pm__shot-workspace-subblock">
                                    <Text size="sm">{item}</Text>
                                  </InlinePanel>
                                ))}
                              </Stack>
                            </InlinePanel>
                            <Textarea
                              label="Step 4 · 执行 Prompt"
                              minRows={8}
                              maxRows={16}
                              value={shotRenderPrompt}
                              onChange={(event) => setShotRenderPrompt(event.currentTarget.value)}
                              placeholder="这里会自动拼出当前镜头的执行 prompt，也支持手工改写。"
                            />
                          </>
                        ) : (
                          <>
                            <InlinePanel className="tc-pm__shot-workspace-step">
                              <Text size="sm" fw={700}>Step 2 · 选图后直接确认并继续</Text>
                              <Text size="xs" c="dimmed" mt={4}>选中当前最佳结果后，直接点右上角主按钮即可同步项目场景并推进到下一个优先镜头。</Text>
                            </InlinePanel>
                            {currentShotBoundAssetCards.length ? (
                              <InlinePanel className="tc-pm__shot-workspace-step">
                                <Group justify="space-between" align="center" gap="xs">
                                  <Text size="sm" fw={700}>当前镜头已绑定的项目记忆</Text>
                                  <Badge variant="light">{currentShotBoundAssetCards.length}</Badge>
                                </Group>
                                <Text size="xs" c="dimmed" mt={4}>
                                  {currentShotBoundAssetCards.map((item) => item.asset.name).join('、')}
                                </Text>
                              </InlinePanel>
                            ) : null}
                          </>
                        )}
                        {currentShotRender?.data.errorMessage ? (
                          <InlinePanel className="tc-pm__shot-workspace-step">
                            <Text size="sm" c="red">最近一次失败：{currentShotRender.data.errorMessage}</Text>
                            <Group gap="xs" mt="xs">
                              <Badge variant="light" color={shotFailureDiagnosis.tone === 'red' ? 'red' : shotFailureDiagnosis.tone === 'yellow' ? 'yellow' : 'gray'}>
                                {shotFailureDiagnosis.title}
                              </Badge>
                              <Text size="xs" c="dimmed">{shotFailureDiagnosis.detail}</Text>
                            </Group>
                          </InlinePanel>
                        ) : null}
                        {currentShotRender?.data.images?.length ? (
                          <Stack gap="xs">
                            <Group justify="space-between">
                              <Text size="sm" fw={600}>Step 5 · 最近结果</Text>
                              <Text size="xs" c="dimmed">
                                {currentShotRender.data.vendor || 'auto'}{currentShotRender.data.model ? ` · ${currentShotRender.data.model}` : ''}
                              </Text>
                            </Group>
                            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                              {currentShotRender.data.images.map((image, index) => {
                                const active = currentShotRender.data.selectedImageUrl === image.url
                                return (
                                  <Box
                                    key={`${image.url}-${index}`}
                                    className="tc-pm__shot-result-card"
                                    style={{
                                      padding: '8px',
                                      borderColor: active ? 'var(--mantine-color-blue-5)' : undefined,
                                      background: active ? 'rgba(59, 130, 246, 0.08)' : undefined,
                                      cursor: 'pointer',
                                    }}
                                    onClick={() => void handleSelectShotImage(index)}
                                  >
                                    <Stack gap={6}>
                                      <Box
                                        component="img"
                                        src={image.thumbnailUrl || image.url}
                                        alt={`Shot result ${index + 1}`}
                                        style={{
                                          width: '100%',
                                          aspectRatio: '16 / 9',
                                          objectFit: 'cover',
                                          borderRadius: 8,
                                          display: 'block',
                                          background: 'rgba(0,0,0,0.05)',
                                        }}
                                      />
                                      <Group justify="space-between" wrap="nowrap">
                                        <Text size="xs">{active ? '当前选中' : `候选 ${index + 1}`}</Text>
                                        <ActionIcon variant="subtle" color={active ? 'blue' : 'gray'} loading={savingShotSelection} aria-label="选择结果">
                                          <IconPhoto size={14} />
                                        </ActionIcon>
                                      </Group>
                                    </Stack>
                                  </Box>
                                )
                              })}
                            </SimpleGrid>
                          </Stack>
                        ) : (
                          <InlinePanel className="tc-pm__shot-workspace-step">
                            <Text size="sm" c="dimmed">当前镜头还没有生成结果。</Text>
                          </InlinePanel>
                        )}
                      </Stack>
                        </PanelCard>
                      </Modal>
                    </>
                  ) : null}
                </Stack>
              ) : (
                <PanelCard className="tc-pm__load-error-card">
                  <Stack gap="sm">
                    <Badge variant="light" color={chapterMissing ? 'yellow' : 'red'} className="tc-pm__load-error-badge">
                      {chapterMissing ? '章节不存在' : '加载失败'}
                    </Badge>
                    <Title order={3} className="tc-pm__load-error-title">
                      {chapterMissing ? '当前章节或项目已不存在' : '这一页暂时无法加载'}
                    </Title>
                    <Text size="sm" c="dimmed" className="tc-pm__load-error-text">
                      {loadError?.message || '当前无法获取这一页的数据。'}
                    </Text>
                    <Group gap="xs" className="tc-pm__load-error-actions">
                      <Button variant="default" onClick={() => spaNavigate(buildProjectDirectoryUrl(projectId))}>
                        返回项目页
                      </Button>
                      <Button
                        color="blue"
                        leftSection={<IconRefresh size={14} />}
                        onClick={() => {
                          window.location.reload()
                        }}
                      >
                        重新加载
                      </Button>
                    </Group>
                  </Stack>
                </PanelCard>
              )}
            </Box>
          </ScrollArea>
        </div>
      </AppShell.Main>
      <ProjectAssetsViewer
        opened={assetsViewerOpen}
        projectId={projectId}
        projectName={workbench?.project.name || '项目'}
        onClose={() => setAssetsViewerOpen(false)}
      />
    </AppShell>
  )
}
