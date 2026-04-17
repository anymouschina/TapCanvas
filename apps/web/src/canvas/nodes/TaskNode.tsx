import React from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { Position, NodeResizeControl, NodeToolbar, useStore } from '@xyflow/react'
import { useRFStore } from '../store'
import { useUIStore } from '../../ui/uiStore'
import { ASSET_REFRESH_EVENT, notifyAssetRefresh } from '../../ui/assetEvents'
import { ActionIcon, Group, Paper, Popover, Button, Text, Stack, TextInput, Textarea, Select, Loader, Badge, Slider, Modal, Tooltip, Switch, useMantineColorScheme, useMantineTheme } from '@mantine/core'
import {
  IconArrowsDiagonal2,
  IconAdjustments,
  IconBold,
  IconBulb,
  IconCamera,
  IconColorSwatch,
  IconItalic,
  IconList,
  IconListNumbers,
  IconPalette,
  IconPhotoSearch,
  IconRefresh,
  IconSeparatorHorizontal,
  IconUsers,
  IconLayoutGrid,
  IconTarget,
} from '@tabler/icons-react'
import {
  createAgentPipelineRun,
  createServerAsset,
  executeAgentPipelineRun,
  getProjectBookIndex,
  listProjectBooks,
  listProjectBookStoryboardHistory,
  fetchPublicTaskResult,
  listProjectRoleCardAssets,
  listServerAssets,
  markDraftPromptUsed,
  recoverUploadedServerAssetFile,
  runPublicTask,
  suggestDraftPrompts,
  upsertProjectBookRoleCard,
  upsertProjectBookVisualRef,
  upsertProjectRoleCardAsset,
  updateServerAssetData,
  uploadServerAssetFile,
  createLlmNodePreset,
  listLlmNodePresets,
  type LlmNodePresetDto,
  type LlmNodePresetType,
  type PromptSampleDto,
  type ProjectBookStoryboardHistoryDto,
  type ServerAssetDto,
} from '../../api/server'
import {
  getDefaultModel,
  getModelLabel,
  type ModelOption,
  type NodeKind,
} from '../../config/models'
import {
  parseImageModelCatalogConfig,
  formatVideoOptionLabel,
  parseVideoModelCatalogConfig,
  type ImageModelControlBinding,
  type ImageModelCatalogConfig,
  type VideoModelControlBinding,
  type VideoModelCatalogConfig,
} from '../../config/modelCatalogMeta'
import {
  getModelOptionRequestAlias,
  findModelOptionByIdentifier,
  resolveExecutableImageModel,
  useModelOptions,
} from '../../config/useModelOptions'
import { resolveModelGenerationCredits } from '../../config/modelPricing'
import {
  StoryboardScene,
  createScene,
  normalizeStoryboardScenes,
  serializeStoryboardScenes,
  STORYBOARD_DURATION_STEP,
  STORYBOARD_MIN_DURATION,
  STORYBOARD_MAX_DURATION,
  STORYBOARD_MAX_TOTAL_DURATION,
  totalStoryboardDuration,
  scenesAreEqual,
  STORYBOARD_DEFAULT_DURATION,
  enforceStoryboardTotalLimit,
} from './storyboardUtils'
import { getTaskNodeCoreType, getTaskNodeSchema, normalizeTaskNodeKind } from './taskNodeSchema'
import { buildTaskNodeFeatureFlags, type TaskNodeFeatureFlags } from './taskNode/features'
import {
  applyMentionFallback,
  computeHandleLayout,
  extractTextFromTaskResult,
  genTaskNodeId,
  isDynamicHandlesConfig,
  isStaticHandlesConfig,
  MAX_VEO_REFERENCE_IMAGES,
  MAX_FRAME_ANALYSIS_SAMPLES,
  normalizeVeoReferenceUrls,
} from './taskNodeHelpers'
import { PromptSampleDrawer } from '../components/PromptSampleDrawer'
import { toast } from '../../ui/toast'
import { DEFAULT_REVERSE_PROMPT_INSTRUCTION } from '../constants'
import { CANVAS_CONFIG } from '../utils/constants'
import { resourceManager } from '../../domain/resource-runtime'
import { getPendingUploadHandlesByOwnerNodeId, useUploadRuntimeStore } from '../../domain/upload-runtime/store/uploadRuntimeStore'
import { captureFramesAtTimes } from '../../utils/videoFrameExtractor'
import { appendDownloadSuffix, downloadUrl } from '../../utils/download'
import { getAuthToken } from '../../auth/store'
import { dedupeLocalFiles } from '../../utils/localUploadDedup'
import { normalizeOrientation, type Orientation } from '../../utils/orientation'
import { buildVideoBillingSpecKey, normalizeVideoResolution } from '../../utils/videoBillingSpec'
import { buildVideoDurationPatch, readVideoDurationSeconds } from '../../utils/videoDuration'
import { usePoseEditor } from './taskNode/PoseEditor'
import { useImageViewEditor, type ImageViewEditorApplyPayload } from './taskNode/ImageViewEditor'
import { TaskNodeHandles } from './taskNode/components/TaskNodeHandles'
import { TopToolbar } from './taskNode/components/TopToolbar'
import { TaskNodeHeader } from './taskNode/components/TaskNodeHeader'
import { ControlChips } from './taskNode/components/ControlChips'
import { StatusBanner } from './taskNode/components/StatusBanner'
import { GenerationOverlay } from './taskNode/components/GenerationOverlay'
import { PromptSection, type MentionSuggestionItem } from './taskNode/components/PromptSection'
import { StructuredPromptSection } from './taskNode/components/StructuredPromptSection'
import { UpstreamReferenceStrip } from './taskNode/components/UpstreamReferenceStrip'
import { VideoContent } from './taskNode/components/VideoContent'
import { TextContent } from './taskNode/components/TextContent'
import { resolveTextNodePlainText, type TextNodeDisplaySource } from './taskNode/textNodeContent'
import { VeoImageModal } from './taskNode/components/VeoImageModal'
import { VideoResultModal } from './taskNode/VideoResultModal'
import { renderFeatureBlocks } from './taskNode/featureRenderers'
import { REMOTE_IMAGE_URL_REGEX, normalizeClipRange, pickOnlyBookId, syncDraftWithExternalValue } from './taskNode/utils'
import { runNodeRemote } from '../../runner/remoteRunner'
import {
  appendReferenceAliasSlotPrompt,
  buildAssetRefId,
  buildNamedReferenceEntries,
  mergeReferenceAssetInputs,
} from '../../runner/assetReference'
import { uploadMergedReferenceSheet } from '../../runner/referenceSheet'
import { runNodeDagToTarget } from '../../runner/dag'
import { BASE_DURATION_OPTIONS, MINIMAX_DURATION_OPTIONS, SAMPLE_OPTIONS, STORYBOARD_DURATION_OPTION, VEO_DURATION_OPTIONS } from './taskNode/constants'
import type { FrameSample } from './taskNode/types'
import {
  buildDefaultStoryboardEditorData,
  buildStoryboardEditorPatch,
  normalizeStoryboardEditorSelectedIndex,
  type StoryboardEditorAspect,
  type StoryboardEditorCell,
  type StoryboardEditorGrid,
} from './taskNode/storyboardEditor'
import {
  STORYBOARD_SELECTION_PROTOCOL_VERSION,
  normalizeStoryboardReferenceBindings,
  normalizeStoryboardSelectionContext,
  type StoryboardReferenceBinding,
  type StoryboardSelectionContext,
} from '@tapcanvas/storyboard-selection-protocol'
import type { PublicFlowAnchorBindingKind } from '@tapcanvas/flow-anchor-bindings'
import {
  getNodeProductionMeta,
  inferProductionNodeMeta,
  readChapterGroundedProductionMetadata,
} from '../productionMeta'
import {
  DEFAULT_CANVAS_RESIZE_SIZE,
  DEFAULT_IMAGE_EDIT_SIZE,
  IMAGE_EDIT_SIZE_OPTIONS,
  normalizeCanvasResizeSize,
  normalizeImageEditSize,
  parseImageEditSizeDimensions,
  resolveImageEditSizeOption,
  toAspectRatioFromImageEditSize,
} from './taskNode/imageEditSize'
import { appendImageEditFocusGuidePrompt } from './taskNode/imageEditFocusGuide'
import {
  collectOrderedUpstreamReferenceItems,
  extractNodePrimaryAssetReference,
  type OrderedUpstreamReferenceItem,
} from './taskNode/upstreamReferences'
import { collectUpstreamVideoTextContext } from './taskNode/videoPromptGeneration'
import { ChapterGroundedBadge } from './taskNode/components/ChapterGroundedBadge'
import { resolveCompiledImagePrompt, resolveImagePromptExecution } from './taskNode/imagePromptSpec'
import { refineStructuredImagePrompt } from './taskNode/structuredPromptRefine'
import imageViewControlsModule from '@tapcanvas/image-view-controls'
import {
  resolvePrimarySemanticAnchorBinding,
  resolveSemanticNodeRoleBinding,
  resolveSemanticNodeVisualReferenceBinding,
  upsertSemanticNodeAnchorBinding,
} from '../utils/semanticBindings'
import { useCanvasRenderContext } from '../CanvasRenderContext'

const {
  hasActiveImageCameraControl,
  hasActiveImageLightingRig,
  normalizeImageCameraControl,
  normalizeImageLightingRig,
} = imageViewControlsModule

type Data = {
  label: string
  kind?: string
  status?: 'idle' | 'queued' | 'running' | 'success' | 'error' | 'canceled'
  progress?: number
  aiChatPlanCreatedAt?: string
  aiChatPlanIsNew?: boolean
}

function escapeTextNodeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function convertPlainTextToHtml(value: string): string {
  return value
    .split('\n')
    .map((line) => `<p>${escapeTextNodeHtml(line)}</p>`)
    .join('')
}

function formatImageResolutionOptionLabel(label: string, value: string, priceLabel?: string): string {
  const trimmedValue = String(value || '').trim()
  const trimmedLabel = String(label || '').trim()
  const baseLabel =
    trimmedLabel.endsWith('输出') && trimmedValue
      ? trimmedValue
      : trimmedLabel || trimmedValue
  return formatVideoOptionLabel(baseLabel, priceLabel)
}

type HeaderMetaBadge = {
  label: string
  color: string
  variant?: 'light' | 'outline' | 'filled'
}

type ToolbarMetaAction = {
  key: string
  label: string
  icon: JSX.Element
  onClick: () => void
  active?: boolean
}

const PRODUCTION_LAYER_LABELS: Record<string, string> = {
  evidence: '证据',
  constraints: '约束',
  anchors: '锚点',
  expansion: '扩展',
  execution: '执行',
  results: '结果',
}

const PRODUCTION_LAYER_BADGE_COLORS: Record<string, string> = {
  evidence: 'gray',
  constraints: 'indigo',
  anchors: 'teal',
  expansion: 'cyan',
  execution: 'orange',
  results: 'grape',
}

const APPROVAL_STATUS_LABELS: Record<string, string> = {
  needs_confirmation: '待确认',
  approved: '已确认',
  rejected: '已拒绝',
}

const APPROVAL_STATUS_BADGE_COLORS: Record<string, string> = {
  needs_confirmation: 'yellow',
  approved: 'green',
  rejected: 'red',
}

const UI_ANCHOR_ELIGIBLE_KINDS = new Set([
  'image',
  'imageEdit',
  'textToImage',
  'storyboardImage',
  'novelStoryboard',
  'imageFission',
])

export type TaskNodeType = Node<Data, 'taskNode'>
type TaskNodeImageResult = {
  url: string
  title?: string
  assetId?: string | null
  assetRefId?: string | null
  assetName?: string | null
  prompt?: string
  storyboardScript?: string
  storyboardShotPrompt?: string
  storyboardDialogue?: string
  shotNo?: number
  storyboardSelectionContext?: StoryboardSelectionContext
}

function normalizeStoryboardSelectionProtocolGroupSize(
  value: unknown,
): StoryboardSelectionContext['groupSize'] | undefined {
  const numeric = Math.trunc(Number(value))
  if (numeric === 1 || numeric === 4 || numeric === 9 || numeric === 25) {
    return numeric
  }
  return undefined
}

function buildStoryboardSelectionContextOrThrow(
  input: Omit<StoryboardSelectionContext, 'version'>,
): StoryboardSelectionContext {
  const normalized = normalizeStoryboardSelectionContext({
    version: STORYBOARD_SELECTION_PROTOCOL_VERSION,
    ...input,
  })
  if (!normalized) {
    throw new Error('分镜选择协议构造失败')
  }
  return normalized
}

function buildStoryboardChunkScript(shotItems: Array<{ shotNo: number; script: string }>): string {
  return shotItems
    .map((item) => `镜头 ${item.shotNo}：${item.script}`)
    .join('\n')
}

function buildReplayStoryboardChunkId(input: {
  taskId: string
  chunkId?: string | null
  chunkIndex: number
}): string {
  const normalizedChunkId = String(input.chunkId || '').trim()
  if (normalizedChunkId) return normalizedChunkId.slice(0, 200)
  const normalizedTaskId = String(input.taskId || '').trim() || 'task'
  return `task-${normalizedTaskId}-chunk-${input.chunkIndex}`.slice(0, 200)
}
type TaskNodeVideoResult = {
  id?: string
  url: string
  thumbnailUrl?: string | null
  title?: string | null
  assetId?: string | null
  assetRefId?: string | null
  assetName?: string | null
  duration?: number
  createdAt?: string
  clipRange?: { start: number; end: number } | null
  model?: string | null
  remixTargetId?: string | null
}

type AdoptedAssetMetadata = {
  index: number
  url: string
  adoptedAt: string
  progress: number | null
}

type CharacterRef = {
  nodeId: string
  username: string
  displayName: string
  rawLabel: string
  source: 'character' | 'asset'
  assetUrl?: string | null
  assetId?: string | null
  assetRefId?: string | null
  assetName?: string | null
}
const EMPTY_CHARACTER_REFS: CharacterRef[] = []

function readPrimaryReferenceAssetUrl(record: Record<string, unknown>): string {
  const readUrl = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
  const imageResults = Array.isArray(record.imageResults) ? record.imageResults : []
  for (const item of imageResults) {
    if (!item || typeof item !== 'object') continue
    const url = readUrl((item as Record<string, unknown>).url)
    if (url) return url
  }
  const directImageUrl = readUrl(record.imageUrl)
  if (directImageUrl) return directImageUrl
  const videoResults = Array.isArray(record.videoResults) ? record.videoResults : []
  for (const item of videoResults) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const thumbnailUrl = readUrl(row.thumbnailUrl)
    if (thumbnailUrl) return thumbnailUrl
    const url = readUrl(row.url)
    if (url) return url
  }
  return readUrl(record.videoThumbnailUrl) || readUrl(record.videoUrl)
}

function getTaskNodeModelDisplayLabel(
  option: Pick<ModelOption, 'label' | 'modelAlias' | 'modelKey' | 'value'> | null | undefined,
): string {
  const alias = typeof option?.modelAlias === 'string' ? option.modelAlias.trim() : ''
  if (alias) return alias
  const modelKey = typeof option?.modelKey === 'string' ? option.modelKey.trim() : ''
  if (modelKey) return modelKey
  const label = typeof option?.label === 'string' ? option.label.trim() : ''
  if (label) return label
  return typeof option?.value === 'string' ? option.value.trim() : ''
}

const projectRoleRefsPromiseByProjectId = new Map<string, Promise<CharacterRef[]>>()
const projectAssetMentionRefsPromiseByProjectId = new Map<string, Promise<CharacterRef[]>>()

function normalizeProjectRoleRefs(assets: readonly {
  id?: string | null
  data?: {
    roleName?: string | null
  } | null
}[]): CharacterRef[] {
  const map = new Map<string, CharacterRef>()
  for (const asset of assets) {
    const roleName = String(asset?.data?.roleName || '').trim()
    const username = toMentionUsername(roleName)
    if (!roleName || !username) continue
    const key = username.toLowerCase()
    if (map.has(key)) continue
    map.set(key, {
      nodeId: `project-role:${String(asset?.id || key)}`,
      username,
      displayName: roleName,
      rawLabel: roleName,
      source: 'character',
    })
  }
  return Array.from(map.values())
}

function normalizeProjectAssetMentionRefs(items: readonly ServerAssetDto[]): CharacterRef[] {
  const map = new Map<string, CharacterRef>()
  for (const asset of items) {
    const rawData = asset?.data
    const data = rawData && typeof rawData === 'object' && !Array.isArray(rawData)
      ? rawData as Record<string, unknown>
      : {}
    const username = toMentionUsername(data.assetRefId || asset?.id || '')
    if (!username || map.has(username.toLowerCase())) continue
    const displayName = String(data.assetName || asset?.name || '').trim() || username
    const assetUrl = readPrimaryReferenceAssetUrl(data)
    const assetId = String(asset?.id || '').trim() || null
    const assetRefId = String(data.assetRefId || '').trim() || username
    map.set(username.toLowerCase(), {
      nodeId: `project-asset:${String(asset?.id || username)}`,
      username,
      displayName,
      rawLabel: displayName,
      source: 'asset',
      assetUrl: assetUrl || null,
      assetId,
      assetRefId,
      assetName: displayName,
    })
  }
  return Array.from(map.values())
}

function loadProjectRoleRefs(projectId: string): Promise<CharacterRef[]> {
  const normalizedProjectId = String(projectId || '').trim()
  if (!normalizedProjectId) return Promise.resolve(EMPTY_CHARACTER_REFS)
  const cached = projectRoleRefsPromiseByProjectId.get(normalizedProjectId)
  if (cached) return cached
  const request = listProjectRoleCardAssets(normalizedProjectId)
    .then((assets) => normalizeProjectRoleRefs(Array.isArray(assets) ? assets : []))
    .catch((error: unknown) => {
      projectRoleRefsPromiseByProjectId.delete(normalizedProjectId)
      throw error
    })
  projectRoleRefsPromiseByProjectId.set(normalizedProjectId, request)
  return request
}

function loadProjectAssetMentionRefs(projectId: string): Promise<CharacterRef[]> {
  const normalizedProjectId = String(projectId || '').trim()
  if (!normalizedProjectId) return Promise.resolve(EMPTY_CHARACTER_REFS)
  const cached = projectAssetMentionRefsPromiseByProjectId.get(normalizedProjectId)
  if (cached) return cached
  const request = listServerAssets({ projectId: normalizedProjectId, kind: 'generation', limit: 100 })
    .then((result) => normalizeProjectAssetMentionRefs(Array.isArray(result.items) ? result.items : []))
    .catch((error: unknown) => {
      projectAssetMentionRefsPromiseByProjectId.delete(normalizedProjectId)
      throw error
    })
  projectAssetMentionRefsPromiseByProjectId.set(normalizedProjectId, request)
  return request
}

function invalidateProjectMentionRefCaches(projectId: string): void {
  const normalizedProjectId = String(projectId || '').trim()
  if (!normalizedProjectId) return
  projectRoleRefsPromiseByProjectId.delete(normalizedProjectId)
  projectAssetMentionRefsPromiseByProjectId.delete(normalizedProjectId)
}
const DEFAULT_IMAGE_ASPECT_RATIO = '16:9'
const TEXT_NODE_DEFAULT_WIDTH = 380
const TEXT_NODE_MIN_WIDTH = 340
const TEXT_NODE_MAX_WIDTH = 620
const TEXT_NODE_DEFAULT_HEIGHT = 360
const TEXT_NODE_MIN_HEIGHT = 240
const TEXT_NODE_MAX_HEIGHT = 680
const UNIFIED_STORYBOARD_SKILL = 'tapcanvas-storyboard-expert'
const UNIFIED_STORYBOARD_SYSTEM_HINT = [
  `必须先通过 Skill 工具加载 ${UNIFIED_STORYBOARD_SKILL}，再执行分镜输出。`,
  '请遵守该技能中的连续性、风格锁定与生产计划约束。',
].join('\n')
const NODE_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'text',
  'novelDoc',
  'scriptDoc',
  'storyboardScript',
  'image',
  'imageEdit',
  'cameraRef',
  'storyboardImage',
  'novelStoryboard',
  'storyboardShot',
  'imageFission',
  'mosaic',
  'video',
  'composeVideo',
  'storyboard',
  'audio',
  'subtitle',
  'character',
])
const toNodeKind = (value?: string): NodeKind | undefined => {
  if (!value) return undefined
  return NODE_KINDS.has(value as NodeKind) ? (value as NodeKind) : undefined
}
const areCharacterRefsEqual = (a: CharacterRef[], b: CharacterRef[]) => {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]
    const bi = b[i]
    if (ai.nodeId !== bi.nodeId) return false
    if (ai.username !== bi.username) return false
    if (ai.displayName !== bi.displayName) return false
    if (ai.rawLabel !== bi.rawLabel) return false
  }
  return true
}

const EMPTY_UPSTREAM_REFERENCE_ITEMS: OrderedUpstreamReferenceItem[] = []

type NodeResizeEndParams = {
  width?: number
  height?: number
}

type ToolbarMappedControl = {
  key: string
  binding: VideoModelControlBinding | ImageModelControlBinding
  title: string
  summary: string
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
  onChange: (value: string) => void
}

function normalizeImageAspect(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.toLowerCase() === 'auto') return DEFAULT_IMAGE_ASPECT_RATIO
  return raw
}

function normalizeImageSizeSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '') : ''
}

function normalizeImageResolutionSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '') : ''
}

function pickImageAspectValue(config: ImageModelCatalogConfig | null, current: string): string | null {
  if (!config) return null
  const normalizedCurrent = normalizeImageAspect(current)
  const allowed = config.aspectRatioOptions.map((option) => option.value)
  if (allowed.length) {
    if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
    if (config.defaultAspectRatio && allowed.includes(config.defaultAspectRatio)) {
      return config.defaultAspectRatio
    }
    return allowed[0] ?? null
  }
  return config.defaultAspectRatio || null
}

function pickImageSizeValue(config: ImageModelCatalogConfig | null, current: string): string | null {
  if (!config) return null
  const normalizedCurrent = normalizeImageSizeSetting(current)
  const allowed = config.imageSizeOptions.map((option) => option.value)
  if (allowed.length) {
    if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
    if (config.defaultImageSize && allowed.includes(config.defaultImageSize)) {
      return config.defaultImageSize
    }
    return allowed[0] ?? null
  }
  return config.defaultImageSize || null
}

function pickImageResolutionValue(config: ImageModelCatalogConfig | null, current: string): string | null {
  if (!config) return null
  const normalizedCurrent = normalizeImageResolutionSetting(current)
  const allowed = config.resolutionOptions.map((option) => option.value)
  if (allowed.length) {
    if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
    return allowed[0] ?? null
  }
  return null
}

function pickVideoDurationValue(config: VideoModelCatalogConfig | null, current: number): number | null {
  if (!config || !config.durationOptions.length) return null
  const allowed = config.durationOptions.map((option) => option.value)
  if (allowed.includes(current)) return current
  if (typeof config.defaultDurationSeconds === 'number' && allowed.includes(config.defaultDurationSeconds)) {
    return config.defaultDurationSeconds
  }
  return allowed[0] ?? null
}

function pickVideoSizeValue(config: VideoModelCatalogConfig | null, current: string): string | null {
  if (!config || !config.sizeOptions.length) return null
  const normalizedCurrent = current.trim().replace(/\s+/g, '')
  const allowed = config.sizeOptions.map((option) => option.value)
  if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
  if (config.defaultSize && allowed.includes(config.defaultSize)) return config.defaultSize
  return allowed[0] ?? null
}

function pickVideoResolutionValue(config: VideoModelCatalogConfig | null, current: string): string | null {
  if (!config || !config.resolutionOptions.length) return null
  const normalizedCurrent = normalizeVideoResolution(current)
  const allowed = config.resolutionOptions.map((option) => option.value)
  if (normalizedCurrent && allowed.includes(normalizedCurrent)) return normalizedCurrent
  if (config.defaultResolution && allowed.includes(config.defaultResolution)) {
    return config.defaultResolution
  }
  return allowed[0] ?? null
}

function pickVideoOrientationValue(config: VideoModelCatalogConfig | null, current: Orientation): Orientation | null {
  if (!config || !config.orientationOptions.length) return null
  const allowed = config.orientationOptions.map((option) => option.value)
  if (allowed.includes(current)) return current
  if (config.defaultOrientation && allowed.includes(config.defaultOrientation)) return config.defaultOrientation
  return allowed[0] ?? null
}

function inferOrientationFromAspect(value: string): Orientation | null {
  const raw = value.trim()
  if (!raw) return null
  const match = raw.match(/^(\d+)\s*[:/xX]\s*(\d+)$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  return height > width ? 'portrait' : 'landscape'
}

function resolveVideoOrientationValue(params: {
  currentOrientation: unknown
  size: string
  aspect: string
  config: VideoModelCatalogConfig | null
}): Orientation {
  const normalizedSize = params.size.trim().replace(/\s+/g, '')
  const sizeRule = normalizedSize && params.config
    ? params.config.sizeOptions.find((option) => option.value === normalizedSize) || null
    : null
  if (sizeRule?.orientation) return sizeRule.orientation
  if (sizeRule?.aspectRatio) {
    const inferredFromSizeRule = inferOrientationFromAspect(sizeRule.aspectRatio)
    if (inferredFromSizeRule) return inferredFromSizeRule
  }
  const inferredFromAspect = inferOrientationFromAspect(params.aspect)
  if (inferredFromAspect) return inferredFromAspect
  if (typeof params.currentOrientation === 'string' && params.currentOrientation.trim()) {
    return normalizeOrientation(params.currentOrientation)
  }
  return 'landscape'
}

function toMentionUsername(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[，。！？、；：,.!?;:)\]】》〉'"`]+$/g, '')
    .replace(/\s+/g, '')
}

function extractPromptMentionUsernames(raw: unknown): string[] {
  const text = String(raw || '')
  if (!text) return []
  const matches = text.match(/@[^\s@]+/g) || []
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of matches) {
    const username = toMentionUsername(match)
    if (!username) continue
    const key = username.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(username)
    if (out.length >= 12) break
  }
  return out
}

type MentionRefConflictInput = {
  candidate: string
  roleRefs?: readonly CharacterRef[]
  assetRefs?: readonly CharacterRef[]
}

type MentionRefConflict = {
  kind: 'role_name_conflict' | 'asset_ref_conflict'
  mention: string
  displayName: string
}

function findMentionRefConflict(input: MentionRefConflictInput): MentionRefConflict | null {
  const mention = toMentionUsername(input.candidate)
  if (!mention) return null
  const mentionKey = mention.toLowerCase()
  const findDisplayName = (refs: readonly CharacterRef[] | undefined): string | null => {
    if (!Array.isArray(refs)) return null
    for (const ref of refs) {
      const username = toMentionUsername(ref?.username)
      if (!username || username.toLowerCase() !== mentionKey) continue
      const displayName = String(ref?.displayName || ref?.rawLabel || username).trim()
      return displayName || username
    }
    return null
  }
  const roleDisplayName = findDisplayName(input.roleRefs)
  if (roleDisplayName) {
    return {
      kind: 'role_name_conflict',
      mention,
      displayName: roleDisplayName,
    }
  }
  const assetDisplayName = findDisplayName(input.assetRefs)
  if (assetDisplayName) {
    return {
      kind: 'asset_ref_conflict',
      mention,
      displayName: assetDisplayName,
    }
  }
  return null
}

function inferNodePresetType(input: {
  isVideoNode: boolean
  hasImage: boolean
  hasImageResults: boolean
}): LlmNodePresetType {
  if (input.isVideoNode) return 'video'
  if (input.hasImage || input.hasImageResults) return 'image'
  return 'text'
}

function extractStoryboardFirstFrameCandidates(
  data: any,
  sourceLabel: string,
): Array<{ url: string; label: string; sourceType: 'image' }> {
  const imageResults = Array.isArray(data?.imageResults) ? (data.imageResults as TaskNodeImageResult[]) : []
  const shotEntries = imageResults
    .filter(
      (it: any) =>
        it &&
        typeof it.url === 'string' &&
        it.url.trim() &&
        typeof it.title === 'string' &&
        /^镜头\s*\d+/i.test(it.title.trim()),
    )
    .map((it: any) => ({
      url: String(it.url || '').trim(),
      label: `${sourceLabel} · ${String(it.title || '').trim()}`,
      sourceType: 'image' as const,
    }))
    .filter((it: { url: string }) => Boolean(it.url))

  if (shotEntries.length) {
    return shotEntries.slice(0, 16)
  }

  const fallback: Array<{ url: string; label: string; sourceType: 'image' }> = []
  const push = (value?: unknown, label?: string) => {
    const next = typeof value === 'string' ? value.trim() : ''
    if (!next) return
    fallback.push({
      url: next,
      label: label ? `${sourceLabel} · ${label}` : sourceLabel,
      sourceType: 'image',
    })
  }

  push(data?.imageUrl, '主图')
  imageResults.forEach((it, index: number) =>
    push(it?.url, typeof it?.title === 'string' ? it.title.trim() : `候选 ${index + 1}`),
  )
  return fallback.slice(0, 16)
}

function inferRoleNameFromTaskNode(input: { roleName?: unknown; label?: unknown; prompt?: unknown }): string {
  const explicit = String(input?.roleName || '').trim()
  if (explicit) return explicit

  const label = String(input?.label || '').trim()
  const labelPatterns = [
    /^(?:主角角色卡(?:刷新)?|角色卡|角色设定)\s*[·:：-]\s*(.+)$/i,
    /^(.+?)\s*角色卡$/i,
  ]
  for (const re of labelPatterns) {
    const m = label.match(re)
    const name = String(m?.[1] || '').trim()
    if (name) return name
  }

  const prompt = String(input?.prompt || '')
  if (prompt) {
    const lineMatch = prompt.match(/(?:^|\n)\s*角色名\s*[：:]\s*([^\n\r]+)/)
    const name = String(lineMatch?.[1] || '').trim()
    if (name) return name
  }
  return ''
}

function collectDynamicUpstreamReferenceEntriesForNode(
  nodes: Node[],
  edges: Edge[],
  targetId: string,
): Array<{ url: string; label: string; assetId?: string | null; name?: string | null }> {
  const orderedItems = collectOrderedUpstreamReferenceItems(nodes, edges, targetId)
  if (!orderedItems.length) return []
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  const out: Array<{ url: string; label: string; assetId?: string | null; name?: string | null }> = []
  const seen = new Set<string>()

  orderedItems.forEach((item) => {
    if (seen.has(item.previewUrl)) return
    seen.add(item.previewUrl)
    if (item.sourceKind === 'video') {
      out.push({
        url: item.previewUrl,
        label: buildAssetRefId({
          name: item.label,
          fallbackPrefix: 'ref',
          index: out.length,
        }),
        name: item.label,
      })
      return
    }
    const meta = extractNodePrimaryAssetReference(nodeById.get(item.sourceNodeId))
    if (meta) {
      out.push({
        url: meta.url,
        label: meta.assetRefId,
        ...(meta.assetId ? { assetId: meta.assetId } : null),
        name: meta.displayName,
      })
      return
    }
    out.push({
      url: item.previewUrl,
      label: buildAssetRefId({
        name: item.label,
        fallbackPrefix: 'ref',
        index: out.length,
      }),
      name: item.label,
    })
  })

  return out
}

function TaskNodeInner({ id, data, selected, dragging }: NodeProps<TaskNodeType>): JSX.Element {
  const status = data?.status ?? 'idle'
  const showGenerationOverlay = status === 'running' || status === 'queued'
  const color =
    status === 'success' ? '#16a34a' :
    status === 'error' ? '#ef4444' :
    status === 'canceled' ? '#475569' :
    status === 'running' ? '#8b5cf6' :
    status === 'queued' ? '#f59e0b' : 'rgba(127,127,127,.6)'
  const statusLabel =
    status === 'success' ? '已完成' :
    status === 'error' ? '异常' :
    status === 'canceled' ? '已取消' :
    status === 'running' ? '生成中' :
    status === 'queued' ? '排队中' : '待命'
  const { colorScheme } = useMantineColorScheme()
  const theme = useMantineTheme()
  const isDarkUi = colorScheme === 'dark'
  const rgba = (color: string, alpha: number) => typeof theme.fn?.rgba === 'function' ? theme.fn.rgba(color, alpha) : color
  const accentPrimary = theme.colors.blue?.[isDarkUi ? 4 : 6] || '#4c6ef5'
  const accentSecondary = theme.colors.cyan?.[isDarkUi ? 4 : 5] || '#22d3ee'
  const nodeShellBackground = isDarkUi ? 'rgba(15,20,28,0.96)' : 'rgba(255,255,255,0.98)'
  const nodeShellBorder = isDarkUi ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.08)'
  const nodeShellShadow = isDarkUi
    ? '0 18px 36px rgba(0, 0, 0, 0.5)'
    : '0 16px 32px rgba(15, 23, 42, 0.12)'
  const nodeShellGlow = '0 0 0 rgba(0, 0, 0, 0)'
  const nodeShellText = isDarkUi ? theme.white : (theme.colors.gray?.[9] || '#111321')
  const quickActionBackgroundActive = isDarkUi ? rgba(accentPrimary, 0.25) : rgba(accentPrimary, 0.12)
  const quickActionIconColor = rgba(nodeShellText, 0.55)
  const quickActionIconActive = accentPrimary
  const quickActionHint = rgba(nodeShellText, 0.55)
  const mediaOverlayBackground = isDarkUi ? 'rgba(4, 7, 16, 0.92)' : 'rgba(246, 248, 255, 0.95)'
  const mediaOverlayText = nodeShellText
  const toolbarBackground = isDarkUi ? 'rgba(4, 7, 16, 0.9)' : 'rgba(255,255,255,0.96)'
  const toolbarShadow = isDarkUi ? '0 22px 45px rgba(0,0,0,0.6)' : '0 22px 50px rgba(15,23,42,0.14)'
  const subtleOverlayBackground = isDarkUi ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.05)'
  const mediaFallbackSurface = isDarkUi ? 'rgba(3,6,12,0.92)' : 'rgba(244,247,255,0.95)'
  const mediaFallbackText = isDarkUi ? rgba(theme.colors.gray?.[4] || '#94a3b8', 0.85) : rgba(theme.colors.gray?.[6] || '#64748b', 0.85)
  const videoSurface = isDarkUi ? 'rgba(11, 16, 28, 0.9)' : 'rgba(236, 241, 255, 0.9)'
  const inlineDividerColor = rgba(nodeShellText, 0.12)
  const sleekChipBorderColor = rgba(nodeShellText, 0.08)
  const toolbarButtonBorderColor = rgba(nodeShellText, 0.12)
  const summaryChipStyles = React.useMemo(() => ({
    borderRadius: 999,
    background: isDarkUi ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)',
    color: nodeShellText,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    fontWeight: 600,
    fontSize: 12,
    height: 30,
    lineHeight: 1.1,
    letterSpacing: 0.25,
  }), [isDarkUi, nodeShellText])
  const controlValueStyle = React.useMemo(() => ({
    fontSize: 12,
    fontWeight: 600,
    color: nodeShellText,
  }), [nodeShellText])
  const sleekChipBase = React.useMemo(() => ({
    padding: '6px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 500,
    color: nodeShellText,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    borderRadius: 999,
    background: isDarkUi ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
  }), [isDarkUi, nodeShellText, sleekChipBorderColor])
  const toolbarActionIconStyles = React.useMemo(() => ({
    root: {
      width: 32,
      height: 32,
      borderRadius: 12,
      background: isDarkUi ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
      color: nodeShellText,
      padding: 0,
    },
    icon: {
      fontSize: 16,
    },
  }), [isDarkUi, nodeShellText, toolbarButtonBorderColor])
  const galleryCardBackground = isDarkUi ? 'rgba(7,12,24,0.96)' : 'rgba(255,255,255,0.96)'

  const placeholderIconColor = nodeShellText
  const iconBadgeBackground = isDarkUi ? rgba(accentPrimary, 0.2) : rgba(accentPrimary, 0.12)
  const iconBadgeShadow = isDarkUi ? '0 10px 20px rgba(0,0,0,0.35)' : '0 10px 20px rgba(15,23,42,0.1)'
  const darkContentBackground = isDarkUi ? 'rgba(9,13,20,0.92)' : 'rgba(246,248,255,0.95)'
  const darkCardShadow = isDarkUi ? '0 12px 24px rgba(0, 0, 0, 0.4)' : '0 12px 24px rgba(15, 23, 42, 0.1)'
  const lightContentBackground = isDarkUi ? 'rgba(9,14,28,0.3)' : 'rgba(227,235,255,0.7)'

  const kind = normalizeTaskNodeKind(typeof data?.kind === 'string' ? data.kind : null) || 'text'
  const coreKind = getTaskNodeCoreType(kind)
  const productionMeta = React.useMemo(
    () => getNodeProductionMeta({ type: 'taskNode', data }),
    [data],
  )
  const productionMetadata = React.useMemo(
    () => readChapterGroundedProductionMetadata((data as Record<string, unknown>)?.productionMetadata),
    [data],
  )
  const isCameraRefNode = false
  const schema = React.useMemo(() => getTaskNodeSchema(kind), [kind])
  const NodeIcon = schema.icon
  const featureFlags = React.useMemo<TaskNodeFeatureFlags>(
    () => buildTaskNodeFeatureFlags(schema, kind),
    [schema, kind],
  )
  const {
    isStoryboardNode,
    isComposerNode,
    isMosaicNode,
    hasImage,
    hasImageResults,
    hasAnchorBinding,
    hasImageUpload: supportsImageUpload,
    hasReversePrompt: supportsReversePrompt,
    hasVideo,
    hasVideoResults,
    hasAudio: isAudioNode,
    hasSubtitle: isSubtitleNode,
    hasCharacter: isCharacterNode,
    hasSystemPrompt,
    hasModelSelect,
    hasSampleCount,
    hasAspect,
    hasImageSize,
    hasOrientation,
    hasDuration,
    hasTextResults,
    hasStoryboardEditor,
    supportsSubflowHandles,
  } = featureFlags
  const isProjectDocNode = false
  const isPlainTextNode = coreKind === 'text'
  const isVideoNode = coreKind === 'video'
  const isStoryboardEditorNode = hasStoryboardEditor
  const presetType = React.useMemo<LlmNodePresetType>(
    () => inferNodePresetType({ isVideoNode, hasImage, hasImageResults }),
    [hasImage, hasImageResults, isVideoNode],
  )
  const isInnerStoryboardShotNode = false
  const targets: { id: string; type: string; pos: Position }[] = []
  const sources: { id: string; type: string; pos: Position }[] = []
  const schemaHandles = schema.handles
  if (isDynamicHandlesConfig(schemaHandles)) {
    if (supportsSubflowHandles) {
      const io = (data as any)?.io as {
        inputs?: { id: string; type: string; label?: string }[]
        outputs?: { id: string; type: string; label?: string }[]
      } | undefined
      if (io?.inputs?.length) {
        io.inputs.forEach((p) => targets.push({ id: `in-${p.type}`, type: p.type, pos: Position.Left }))
      }
      if (io?.outputs?.length) {
        io.outputs.forEach((p) => sources.push({ id: `out-${p.type}`, type: p.type, pos: Position.Right }))
      }
    }
  } else if (isStaticHandlesConfig(schemaHandles)) {
    schemaHandles.targets?.forEach((handle) => {
      targets.push({
        id: handle.id,
        type: handle.type,
        pos: handle.position ?? Position.Left,
      })
    })
    schemaHandles.sources?.forEach((handle) => {
      sources.push({
        id: handle.id,
        type: handle.type,
        pos: handle.position ?? Position.Right,
      })
    })
  } else {
    targets.push({ id: 'in-any', type: 'any', pos: Position.Left })
    sources.push({ id: 'out-any', type: 'any', pos: Position.Right })
  }
  if (isInnerStoryboardShotNode) {
    targets.length = 0
    sources.length = 0
  }
  const handleLayoutMap = computeHandleLayout([...targets, ...sources])
  const wideHandleBase: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
    width: 16,
    height: 'calc(100% - 12px)',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    border: '1px dashed rgba(255,255,255,0.12)',
    background: 'transparent',
    opacity: 0,
    boxShadow: 'none',
  }
  const defaultInputType = targets[0]?.type || 'any'
  const defaultOutputType = sources[0]?.type || 'any'

  const [editing, setEditing] = React.useState(false)
  const updateNodeLabel = useRFStore(s => s.updateNodeLabel)
  const openSubflow = useUIStore(s => s.openSubflow)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const currentProject = useUIStore(s => s.currentProject)
  const openWebCutVideoEditModal = useUIStore(s => s.openWebCutVideoEditModal)
  const edgeRoute = useUIStore(s => s.edgeRoute)
  const viewOnly = useUIStore(s => s.viewOnly)
  const canvasReferencePicker = useUIStore(s => s.canvasReferencePicker)
  const openCanvasReferencePicker = useUIStore(s => s.openCanvasReferencePicker)
  const closeCanvasReferencePicker = useUIStore(s => s.closeCanvasReferencePicker)
  const syncCreationSessionCheckpoint = useUIStore(s => s.syncCreationSessionCheckpoint)
  const failCreationSession = useUIStore(s => s.failCreationSession)
  const runSelected = useRFStore(s => s.runSelected)
  const cancelNodeExecution = useRFStore(s => s.cancelNode)
  const setNodeStatus = useRFStore(s => s.setNodeStatus)
  const updateNodeData = useRFStore(s => s.updateNodeData)
  const deleteEdge = useRFStore(s => s.deleteEdge)
  const appendLog = useRFStore(s => s.appendLog)
  const addNode = useRFStore(s => s.addNode)
  const rawPrompt = (data as any)?.prompt as string | undefined
  const imagePromptExecutionState = React.useMemo(() => {
    try {
      return {
        execution: resolveImagePromptExecution(data),
        errorMessage: '',
      }
    } catch (error) {
      return {
        execution: {
          prompt: rawPrompt || '',
          structuredPrompt: null,
          normalizedFromLegacy: false,
          mode: 'text' as const,
        },
        errorMessage: error instanceof Error ? error.message : 'structuredPrompt 解析失败',
      }
    }
  }, [data, rawPrompt])
  const canUseStructuredPromptEditor = coreKind === 'image'
  const isStructuredPromptMode = canUseStructuredPromptEditor && imagePromptExecutionState.execution.mode === 'structured'
  const structuredPromptValue = imagePromptExecutionState.execution.structuredPrompt
  const structuredPromptErrorMessage = imagePromptExecutionState.errorMessage
  const [prompt, setPrompt] = React.useState<string>(rawPrompt || '')
  const [structuredPromptRefineLoading, setStructuredPromptRefineLoading] = React.useState(false)
  const rawStoryboardEditorPatch = React.useMemo(
    () => buildStoryboardEditorPatch({
      cells: (data as Record<string, unknown>)?.storyboardEditorCells,
      grid: (data as Record<string, unknown>)?.storyboardEditorGrid,
      aspect: (data as Record<string, unknown>)?.storyboardEditorAspect,
      editMode: (data as Record<string, unknown>)?.storyboardEditorEditMode,
      collapsed: (data as Record<string, unknown>)?.storyboardEditorCollapsed,
    }),
    [data],
  )
  const storyboardEditorCells = rawStoryboardEditorPatch.storyboardEditorCells as StoryboardEditorCell[]
  const storyboardEditorGrid = rawStoryboardEditorPatch.storyboardEditorGrid as StoryboardEditorGrid
  const storyboardEditorAspect = rawStoryboardEditorPatch.storyboardEditorAspect as StoryboardEditorAspect
  const storyboardEditorEditMode = rawStoryboardEditorPatch.storyboardEditorEditMode
  const storyboardEditorCollapsed = rawStoryboardEditorPatch.storyboardEditorCollapsed
  const storyboardEditorSelectedIndex = normalizeStoryboardEditorSelectedIndex(
    (data as Record<string, unknown>)?.storyboardEditorSelectedIndex,
    storyboardEditorCells.length,
  )

  // 当节点数据中的 prompt 发生变化（例如由 AI 自动生成）时，同步到本地输入框状态
  React.useEffect(() => {
    if (typeof rawPrompt === 'string' && rawPrompt !== prompt) {
      setPrompt(rawPrompt)
    }
  }, [rawPrompt])
  React.useEffect(() => {
    if (!isStoryboardEditorNode) return
    const record = data as Record<string, unknown>
    const hasStoryboardEditorShape =
      Array.isArray(record.storyboardEditorCells) &&
      typeof record.storyboardEditorGrid === 'string' &&
      typeof record.storyboardEditorAspect === 'string'
    if (hasStoryboardEditorShape) return
    updateNodeData(id, buildDefaultStoryboardEditorData())
  }, [data, id, isStoryboardEditorNode, updateNodeData])
  const textFontSize = Math.max(12, Math.min(48, Number((data as any)?.textFontSize) || 16))
  const textFontWeight = Math.max(300, Math.min(800, Number((data as any)?.textFontWeight) || 500))
  const textColor = String((data as any)?.textColor || (isDarkUi ? '#f8fafc' : '#0f172a'))
  const textBackgroundColor = String((data as any)?.textBackgroundColor || (isDarkUi ? 'rgba(12,17,28,0.88)' : 'rgba(248,250,255,0.95)'))
  const [aspect, setAspect] = React.useState<string>(normalizeImageAspect((data as any)?.aspect))
  const [imageSize, setImageSize] = React.useState<string>((data as any)?.imageSize || '1K')
  const [imageResolution, setImageResolution] = React.useState<string>(
    normalizeImageResolutionSetting((data as any)?.imageResolution ?? (data as any)?.resolution ?? ''),
  )
  const [imageEditSize, setImageEditSize] = React.useState<string>(() =>
    kind === 'imageEdit'
      ? normalizeImageEditSize((data as Record<string, unknown>)?.imageEditSize ?? (data as Record<string, unknown>)?.size)
      : DEFAULT_IMAGE_EDIT_SIZE,
  )
  const [canvasResizeSize, setCanvasResizeSize] = React.useState<string>(() =>
    normalizeCanvasResizeSize((data as Record<string, unknown>)?.canvasResizeSize ?? DEFAULT_CANVAS_RESIZE_SIZE),
  )
  const [scale, setScale] = React.useState<number>((data as any)?.scale || 1)
  const [sampleCount, setSampleCount] = React.useState<number>((data as any)?.sampleCount || 1)
  const [storyboardScenes, setStoryboardScenes] = React.useState<StoryboardScene[]>(() =>
    isStoryboardNode
      ? enforceStoryboardTotalLimit(
          normalizeStoryboardScenes(
            (data as any)?.storyboardScenes,
            (data as any)?.storyboard || (data as any)?.prompt || '',
          ),
        )
      : [],
  )
  const [storyboardNotes, setStoryboardNotes] = React.useState<string>(() =>
    isStoryboardNode ? ((data as any)?.storyboardNotes || '') : '',
  )
  const [storyboardTitle, setStoryboardTitle] = React.useState<string>(() =>
    isStoryboardNode ? ((data as any)?.storyboardTitle || data?.label || '') : '',
  )
  const lastStoryboardSerializedRef = React.useRef<string | null>(null)

  // 文本节点的系统提示词状态（保留兼容旧数据，不再在 UI 直接展示）
  const rawStoryboardScenes = (data as any)?.storyboardScenes
  const rawStoryboardString = (data as any)?.storyboard || (data as any)?.prompt || ''
  const rawStoryboardNotes = (data as any)?.storyboardNotes || ''
  const rawStoryboardTitle = (data as any)?.storyboardTitle || data?.label || ''

  React.useEffect(() => {
    if (!isStoryboardNode) return
    if (rawStoryboardString && rawStoryboardString === lastStoryboardSerializedRef.current) {
      return
    }
    const normalized = enforceStoryboardTotalLimit(
      normalizeStoryboardScenes(rawStoryboardScenes, rawStoryboardString),
    )
    if (!scenesAreEqual(normalized, storyboardScenes)) {
      setStoryboardScenes(normalized)
    }
    if (rawStoryboardNotes !== storyboardNotes) {
      setStoryboardNotes(rawStoryboardNotes)
    }
    if (rawStoryboardTitle !== storyboardTitle) {
      setStoryboardTitle(rawStoryboardTitle)
    }
  }, [
    isStoryboardNode,
    rawStoryboardScenes,
    rawStoryboardString,
    rawStoryboardNotes,
    rawStoryboardTitle,
    storyboardScenes,
    storyboardNotes,
    storyboardTitle,
  ])

  React.useEffect(() => {
    if (!isStoryboardNode) return
    const serialized = serializeStoryboardScenes(storyboardScenes, {
      title: storyboardTitle,
      notes: storyboardNotes,
    })
    if (lastStoryboardSerializedRef.current !== serialized) {
      lastStoryboardSerializedRef.current = serialized
      updateNodeData(id, {
        storyboardScenes,
        storyboardNotes,
        storyboardTitle,
        storyboard: serialized,
      })
    }
  }, [id, isStoryboardNode, storyboardScenes, storyboardNotes, storyboardTitle, updateNodeData])

  React.useEffect(() => {
    if (!isStoryboardNode) {
      lastStoryboardSerializedRef.current = null
    }
  }, [isStoryboardNode])

  const storyboardTotalDuration = React.useMemo(
    () => (isStoryboardNode ? totalStoryboardDuration(storyboardScenes) : 0),
    [isStoryboardNode, storyboardScenes],
  )

  const rawSystemPrompt = (data as any)?.systemPrompt as string | undefined
  const [systemPrompt, setSystemPrompt] = React.useState<string>(() => {
    if (typeof rawSystemPrompt === 'string' && rawSystemPrompt.trim().length > 0) {
      return rawSystemPrompt
    }
    return '你是一个提示词优化助手。请在保持核心意图不变的前提下，把下面的提示词补全为更具体、更可执行的版本；优先明确主体数量、空间关系、前中后景、镜头与构图、光线与材质细节。除非用户明确要求精简，否则不要主动缩短；避免引入血腥、残酷暴力或肢解等直观血腥描写，可用暗示和留白代替。'
  })

  const rawShowSystemPrompt = (data as any)?.showSystemPrompt as boolean | undefined
  const [showSystemPrompt, setShowSystemPrompt] = React.useState<boolean>(() => {
    if (typeof rawShowSystemPrompt === 'boolean') return rawShowSystemPrompt
    // 默认关闭系统提示词，由用户手动开启
    return false
  })

  React.useEffect(() => {
    if (typeof rawSystemPrompt === 'string') {
      setSystemPrompt(rawSystemPrompt)
    }
  }, [rawSystemPrompt])

  React.useEffect(() => {
    if (typeof rawShowSystemPrompt === 'boolean' && rawShowSystemPrompt !== showSystemPrompt) {
      setShowSystemPrompt(rawShowSystemPrompt)
    }
  }, [rawShowSystemPrompt, showSystemPrompt])

  React.useEffect(() => {
    if (typeof rawSystemPrompt !== 'string' || !rawSystemPrompt.trim()) {
      if (systemPrompt && systemPrompt.trim()) {
        updateNodeData(id, { systemPrompt })
      }
    }
  }, [id, updateNodeData])

  const handleSystemPromptChange = React.useCallback(
    (next: string) => {
      setSystemPrompt(next)
      updateNodeData(id, { systemPrompt: next })
    },
    [id, updateNodeData],
  )

  const handleSystemPromptToggle = React.useCallback(
    (next: boolean) => {
      setShowSystemPrompt(next)
      updateNodeData(id, { showSystemPrompt: next })
    },
    [id, updateNodeData],
  )
  const edgesForCharacters = useRFStore(s => s.edges)
  const fileRef = React.useRef<HTMLInputElement|null>(null)
  const imageUrl = (data as any)?.imageUrl as string | undefined
  const nodeHasUploadIntent = useUploadRuntimeStore(
    React.useCallback((state) => state.activeNodeImageUploadIds.includes(id), [id]),
  )
  const nodePendingUploadCount = useUploadRuntimeStore(
    React.useCallback(
      (state) => {
        void state.handlesById
        return getPendingUploadHandlesByOwnerNodeId(id).length
      },
      [id],
    ),
  )
  const nodeHasPendingUploads = nodePendingUploadCount > 0
  const isUploadingImage = nodeHasUploadIntent || nodeHasPendingUploads
  const [reversePromptLoading, setReversePromptLoading] = React.useState(false)
  const poseStickmanUrl = (data as any)?.poseStickmanUrl as string | undefined
  const poseReferenceImages = (data as any)?.poseReferenceImages as string[] | undefined
  const imageResults = React.useMemo<TaskNodeImageResult[]>(() => {
    const raw = (data as any)?.imageResults as Array<Record<string, unknown>> | undefined
    if (raw && Array.isArray(raw) && raw.length > 0) {
      return raw.map((item) => ({
        url: typeof item.url === 'string' ? item.url : '',
        title: typeof item.title === 'string' ? item.title : undefined,
        assetId: typeof item.assetId === 'string' && item.assetId.trim() ? item.assetId.trim() : null,
        assetRefId: typeof item.assetRefId === 'string' && item.assetRefId.trim() ? item.assetRefId.trim() : null,
        assetName: typeof item.assetName === 'string' && item.assetName.trim() ? item.assetName.trim() : undefined,
        prompt: typeof item.prompt === 'string' ? item.prompt : undefined,
        storyboardScript: typeof item.storyboardScript === 'string' ? item.storyboardScript : undefined,
        storyboardShotPrompt:
          typeof item.storyboardShotPrompt === 'string'
            ? item.storyboardShotPrompt
            : typeof item.shotPrompt === 'string'
              ? item.shotPrompt
              : undefined,
        storyboardDialogue: typeof item.storyboardDialogue === 'string' ? item.storyboardDialogue : undefined,
        shotNo: typeof item.shotNo === 'number' && Number.isFinite(item.shotNo) ? Math.max(1, Math.trunc(item.shotNo)) : undefined,
        storyboardSelectionContext: normalizeStoryboardSelectionContext(item.storyboardSelectionContext) || undefined,
      }))
        .filter((item) => item.url.trim().length > 0)
    }
    const single = imageUrl || null
    return single ? [{ url: single }] : []
  }, [data, imageUrl])
  const persistedImagePrimaryIndexRaw = (data as any)?.imagePrimaryIndex
  const persistedImagePrimaryIndex =
    typeof persistedImagePrimaryIndexRaw === 'number' ? persistedImagePrimaryIndexRaw : null
  const [imageExpanded, setImageExpanded] = React.useState(false)
  const [imagePrimaryIndex, setImagePrimaryIndex] = React.useState<number>(() =>
    persistedImagePrimaryIndex !== null ? persistedImagePrimaryIndex : 0,
  )
  const [imageSelectedIndex, setImageSelectedIndex] = React.useState(0)
  const hasPrimaryImage = React.useMemo(
    () => imageResults.some((img) => typeof img?.url === 'string' && img.url.trim().length > 0),
    [imageResults]
  )
  const primaryImageUrl = React.useMemo(() => {
    if (!hasPrimaryImage) return null
    const current = imageResults[imagePrimaryIndex]?.url
    if (typeof current === 'string' && current.trim().length > 0) {
      return current
    }
    const fallback = imageResults.find((img) => typeof img?.url === 'string' && img.url.trim().length > 0)
    return fallback?.url ?? null
  }, [hasPrimaryImage, imagePrimaryIndex, imageResults])
  const adoptedImageMetadata = React.useMemo<AdoptedAssetMetadata | null>(() => {
    const raw = (data as { adoptedImageAsset?: unknown } | undefined)?.adoptedImageAsset
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const candidate = raw as Record<string, unknown>
    const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''
    if (!url) return null
    const rawIndex = typeof candidate.index === 'number' && Number.isFinite(candidate.index) ? Math.max(0, Math.trunc(candidate.index)) : -1
    const resolvedIndex = imageResults[rawIndex]?.url === url
      ? rawIndex
      : imageResults.findIndex((item) => item.url === url)
    if (resolvedIndex < 0) return null
    return {
      index: resolvedIndex,
      url,
      adoptedAt: typeof candidate.adoptedAt === 'string' ? candidate.adoptedAt : '',
      progress: typeof candidate.progress === 'number' && Number.isFinite(candidate.progress) ? candidate.progress : null,
    }
  }, [data, imageResults])
  const adoptedImageIndex = adoptedImageMetadata?.index ?? null
  const isPrimaryImageAdopted = adoptedImageIndex !== null && adoptedImageIndex === imagePrimaryIndex
  const [assetBindingId, setAssetBindingId] = React.useState<string>(() => {
    const explicit = String((data as any)?.assetRefId || '').trim()
    if (explicit) return explicit
    const primaryImage = Array.isArray((data as any)?.imageResults) ? (data as any).imageResults[0] : null
    const primaryVideo = Array.isArray((data as any)?.videoResults) ? (data as any).videoResults[0] : null
    return String(primaryImage?.assetRefId || primaryVideo?.assetRefId || (data as any)?.assetId || '').trim()
  })
  const primarySemanticAnchor = React.useMemo(() => resolvePrimarySemanticAnchorBinding(data), [data])
  const semanticRoleBinding = React.useMemo(() => resolveSemanticNodeRoleBinding(data), [data])
  const [anchorBindingKind, setAnchorBindingKind] = React.useState<PublicFlowAnchorBindingKind>(
    () => primarySemanticAnchor?.kind || 'character',
  )
  const [anchorBindingLabel, setAnchorBindingLabel] = React.useState<string>(
    () => String(primarySemanticAnchor?.label || resolveSemanticNodeRoleBinding(data).roleName || '').trim(),
  )
  const [bindAnchorLoading, setBindAnchorLoading] = React.useState(false)
  const autoRoleResolvedRef = React.useRef<string>('')
  const lastAnchorBindingExternalLabelRef = React.useRef<string>(
    String(primarySemanticAnchor?.label || resolveSemanticNodeRoleBinding(data).roleName || '').trim(),
  )
  const lastAnchorBindingExternalKindRef = React.useRef<PublicFlowAnchorBindingKind>(
    primarySemanticAnchor?.kind || 'character',
  )
  const rawRoleName = String(semanticRoleBinding.roleName || '').trim()
  const rawAnchorLabel = String(primarySemanticAnchor?.label || rawRoleName || '').trim()
  const inferredRoleName = React.useMemo(() => inferRoleNameFromTaskNode({
    roleName: semanticRoleBinding.roleName,
    label: (data as any)?.label,
    prompt: (data as any)?.prompt,
  }), [semanticRoleBinding.roleName, (data as any)?.label, (data as any)?.prompt])

  React.useEffect(() => {
    const nextDraft = syncDraftWithExternalValue({
      previousExternalValue: lastAnchorBindingExternalLabelRef.current,
      nextExternalValue: rawAnchorLabel,
      currentDraft: anchorBindingLabel,
    })
    lastAnchorBindingExternalLabelRef.current = rawAnchorLabel
    if (nextDraft !== anchorBindingLabel) {
      setAnchorBindingLabel(nextDraft)
    }
  }, [anchorBindingLabel, rawAnchorLabel])

  React.useEffect(() => {
    const nextKind = primarySemanticAnchor?.kind || 'character'
    if (lastAnchorBindingExternalKindRef.current !== nextKind) {
      lastAnchorBindingExternalKindRef.current = nextKind
      setAnchorBindingKind(nextKind)
    }
  }, [primarySemanticAnchor?.kind])

  React.useEffect(() => {
    const rawImageResults = Array.isArray((data as any)?.imageResults) ? (data as any).imageResults : []
    const rawVideoResults = Array.isArray((data as any)?.videoResults) ? (data as any).videoResults : []
    const primaryImage = rawImageResults[0] || null
    const primaryVideo = rawVideoResults[0] || null
    const nextBindingId =
      String((data as any)?.assetRefId || '').trim() ||
      String(primaryImage?.assetRefId || primaryVideo?.assetRefId || (data as any)?.assetId || '').trim()
    if (nextBindingId && nextBindingId !== assetBindingId) {
      setAssetBindingId(nextBindingId)
    }
  }, [assetBindingId, data])

  React.useEffect(() => {
    if (!inferredRoleName) return
    if (!anchorBindingLabel.trim()) {
      setAnchorBindingLabel(inferredRoleName)
    }
    if (!rawRoleName) {
      updateNodeData(id, {
        roleName: inferredRoleName,
        anchorBindings: upsertSemanticNodeAnchorBinding({
          existing: (data as Record<string, unknown>)?.anchorBindings,
          next: {
            kind: 'character',
            label: inferredRoleName,
            sourceBookId: String((data as Record<string, unknown>)?.sourceBookId || '').trim() || null,
          },
        }),
      })
    }
  }, [anchorBindingLabel, data, id, inferredRoleName, rawRoleName, updateNodeData])

  React.useEffect(() => {
    const projectId = String(currentProject?.id || '').trim()
    const roleNameRaw = inferRoleNameFromTaskNode({
      roleName: semanticRoleBinding.roleName,
      label: (data as any)?.label,
      prompt: (data as any)?.prompt,
    })
    const roleName = roleNameRaw.trim()
    const promptMentionUsernames = extractPromptMentionUsernames((data as any)?.prompt)
    if (!projectId || (!roleName && promptMentionUsernames.length === 0)) return

    const existingRoleId = String(semanticRoleBinding.roleId || '').trim()
    const existingRoleCardId = String(semanticRoleBinding.roleCardId || '').trim()
    const mentionKey = promptMentionUsernames.map((item) => item.toLowerCase()).join(',')
    const refKey = `${projectId}::${roleName.toLowerCase()}::${mentionKey}::${existingRoleId}::${existingRoleCardId}`
    if (autoRoleResolvedRef.current === refKey) return
    autoRoleResolvedRef.current = refKey

    let canceled = false
    ;(async () => {
      try {
        const cards = await listProjectRoleCardAssets(projectId)
        if (canceled || !Array.isArray(cards)) return
        const mentionMatchedCards = promptMentionUsernames.length
          ? cards.filter((asset) => {
              const card = asset?.data || {}
              const roleNameCandidate = toMentionUsername(card?.roleName)
              const hasGenerated = String(card?.status || '').toLowerCase() === 'generated'
              return !!roleNameCandidate && hasGenerated && promptMentionUsernames.some((item) => item.toLowerCase() === roleNameCandidate.toLowerCase())
            })
          : []
        const matchedCards = cards
          .filter((asset) => {
            const card = asset?.data || {}
            const byId = existingRoleId && String(card?.roleId || '').trim() === existingRoleId
            const byCardId = existingRoleCardId && String(card?.cardId || asset?.id || '').trim() === existingRoleCardId
            const byName = roleName && String(card?.roleName || '').trim().toLowerCase() === roleName.toLowerCase()
            const hasGenerated = String(card?.status || '').toLowerCase() === 'generated'
            if (!hasGenerated) return false
            return byId || byCardId || byName
          })
          .sort((a, b) => {
            const ac = a?.data || {}
            const bc = b?.data || {}
            const ap = Boolean(ac.cardId && existingRoleCardId && String(ac.cardId).trim() === existingRoleCardId)
            const bp = Boolean(bc.cardId && existingRoleCardId && String(bc.cardId).trim() === existingRoleCardId)
            if (ap !== bp) return (bp ? 1 : 0) - (ap ? 1 : 0)
            const at = Date.parse(String(ac?.updatedAt || a?.updatedAt || ''))
            const bt = Date.parse(String(bc?.updatedAt || b?.updatedAt || ''))
            return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0)
          })
        const bestCard =
          matchedCards[0] ||
          (mentionMatchedCards.length === 1 ? mentionMatchedCards[0] || null : null)
        const resolvedRoleName =
          roleName ||
          (mentionMatchedCards.length === 1
            ? String(mentionMatchedCards[0]?.data?.roleName || '').trim()
            : '')
        if (!bestCard && !resolvedRoleName) return
        const bestData = bestCard?.data || {}
        const roleId = String(bestData?.roleId || existingRoleId || '').trim()
        const roleCardId = String(bestData?.cardId || bestCard?.id || existingRoleCardId || '').trim()
        const roleImage = String(bestData?.threeViewImageUrl || bestData?.imageUrl || '').trim()
        const patch: Record<string, unknown> = {}
        if (resolvedRoleName && !String(semanticRoleBinding.roleName || '').trim()) patch.roleName = resolvedRoleName
        if (roleId && !existingRoleId) patch.roleId = roleId
        if (roleCardId && !existingRoleCardId) patch.roleCardId = roleCardId
        if (
          roleImage &&
          !Array.isArray((data as any)?.roleCardReferenceImages)
        ) {
          patch.roleCardReferenceImages = [roleImage]
        }
        if (roleImage) {
          const currentImageUrl = String((data as any)?.imageUrl || '').trim()
          const currentImageResults = Array.isArray((data as any)?.imageResults) ? (data as any).imageResults : []
          if (!currentImageUrl && currentImageResults.length === 0) {
            patch.imageUrl = roleImage
            patch.imageResults = [{ url: roleImage }]
            patch.imagePrimaryIndex = 0
            patch.status = 'success'
          }
        }
        if (resolvedRoleName || roleCardId || roleId || roleImage) {
          patch.anchorBindings = upsertSemanticNodeAnchorBinding({
            existing: (data as Record<string, unknown>)?.anchorBindings,
            next: {
              kind: 'character',
              label: resolvedRoleName || rawRoleName || null,
              refId: roleCardId || null,
              entityId: roleId || null,
              imageUrl: roleImage || null,
              sourceBookId: String((data as Record<string, unknown>)?.sourceBookId || '').trim() || null,
              referenceView: 'three_view',
            },
          })
        }
        if (Object.keys(patch).length > 0) {
          updateNodeData(id, patch)
        }
      } catch {
        // ignore auto-bind failures; manual bind remains available
      }
    })()

    return () => {
      canceled = true
    }
  }, [currentProject?.id, data, id, semanticRoleBinding.roleCardId, semanticRoleBinding.roleId, semanticRoleBinding.roleName, updateNodeData])

  const primaryImageForAnchorBinding = React.useMemo(() => {
    const fromResults =
      imageResults[imagePrimaryIndex] && typeof imageResults[imagePrimaryIndex].url === 'string'
        ? String(imageResults[imagePrimaryIndex].url).trim()
        : ''
    const fromNode = typeof (data as any)?.imageUrl === 'string' ? String((data as any).imageUrl).trim() : ''
    return fromResults || fromNode || ''
  }, [data, imagePrimaryIndex, imageResults])

  const anchorBindStatusText = React.useMemo(() => {
    const anchorKind = String(primarySemanticAnchor?.kind || '').trim()
    const anchorLabel = String(primarySemanticAnchor?.label || '').trim()
    const anchorRefId = String(primarySemanticAnchor?.refId || '').trim()
    if (!anchorKind && !anchorLabel && !anchorRefId) return ''
    const anchorKindLabel =
      anchorKind === 'character'
        ? '角色'
        : anchorKind === 'scene'
          ? '场景'
          : anchorKind === 'prop'
            ? '道具'
            : anchorKind === 'shot'
              ? '分镜'
              : anchorKind === 'story'
                ? '剧情'
                : anchorKind === 'asset'
                  ? '资产'
                  : anchorKind === 'context'
                    ? '上下文'
                    : anchorKind === 'authority_base_frame'
                      ? '权威基底帧'
                      : anchorKind
    const parts: string[] = []
    if (anchorKindLabel) parts.push(`当前锚点：${anchorKindLabel}`)
    if (anchorLabel) parts.push(`名称：${anchorLabel}`)
    if (primarySemanticAnchor?.referenceView === 'three_view') parts.push('参考视图：三视图')
    if (anchorRefId) parts.push(`引用ID：${anchorRefId}`)
    return parts.join(' · ')
  }, [primarySemanticAnchor])

  const legacyImagePrimaryIndex = React.useMemo(() => {
    if (!imageUrl) return null
    const match = imageResults.findIndex((img) => img?.url === imageUrl)
    return match >= 0 ? match : null
  }, [imageUrl, imageResults])

  React.useEffect(() => {
    const total = imageResults.length
    if (total === 0) {
      setImagePrimaryIndex(0)
      return
    }
    if (persistedImagePrimaryIndex !== null) {
      const clamped = Math.max(0, Math.min(total - 1, persistedImagePrimaryIndex))
      setImagePrimaryIndex((prev) => (prev === clamped ? prev : clamped))
      return
    }
    if (legacyImagePrimaryIndex !== null) {
      const clamped = Math.max(0, Math.min(total - 1, legacyImagePrimaryIndex))
      setImagePrimaryIndex((prev) => (prev === clamped ? prev : clamped))
      return
    }
    setImagePrimaryIndex((prev) => Math.max(0, Math.min(total - 1, prev)))
  }, [persistedImagePrimaryIndex, legacyImagePrimaryIndex, imageResults.length])

  const onReversePrompt = React.useCallback(async () => {
    if (!supportsReversePrompt) return

    const targetUrl = (
      primaryImageUrl ||
      imageResults[imagePrimaryIndex]?.url ||
      imageResults[0]?.url ||
      imageUrl ||
      ''
    ).trim()
    if (!targetUrl) {
      toast('请先上传或生成图片', 'error')
      return
    }

    try {
      setReversePromptLoading(true)
      const ui = useUIStore.getState()
      const apiKey = (ui.publicApiKey || '').trim()
      const token = getAuthToken()
      if (!apiKey && !token) {
        toast('请先登录后再试', 'error')
        return
      }
      const resolveRemoteImageUrl = async (raw: string): Promise<{ url: string; assetId?: string } | null> => {
        const normalized = (raw || '').trim()
        if (!normalized) return null
        if (REMOTE_IMAGE_URL_REGEX.test(normalized)) {
          return { url: normalized }
        }
        if (normalized.startsWith('blob:')) {
          if (!token) return null
          try {
            const res = await fetch(normalized)
            if (!res.ok) return null
            const blob = await res.blob()
            const mime = blob.type || 'image/png'
            const ext = mime.includes('jpeg') || mime.includes('jpg')
              ? 'jpg'
              : mime.includes('webp')
                ? 'webp'
                : 'png'
            const fileName = `reverse-${Date.now()}.${ext}`
            const file = new File([blob], fileName, { type: mime })
            const hosted = await uploadServerAssetFile(file, fileName, { taskKind: 'image_to_prompt' })
            const url = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
            if (!url) return null
            return { url, assetId: hosted.id }
          } catch {
            return null
          }
        }
        // 禁止 data:*;base64,... 进入后端：必须先托管到 OSS 后再使用 URL
        return null
      }

      const resolved = await resolveRemoteImageUrl(targetUrl)
      if (!resolved?.url) {
        const hint = targetUrl.startsWith('blob:')
          ? '本地图片需要先登录并上传到 OSS 才能反推提示词'
          : '反推提示词仅支持 http(s) 图片链接（请先上传到 OSS）'
        toast(hint, 'error')
        return
      }
      if (resolved.assetId) {
        updateNodeData(id, { imageUrl: resolved.url, serverAssetId: resolved.assetId })
      }
      const persist = ui.assetPersistenceEnabled
      const taskRes = await runPublicTask(apiKey, {
        request: {
          kind: 'image_to_prompt',
          prompt: DEFAULT_REVERSE_PROMPT_INSTRUCTION,
          extras: {
            imageUrl: resolved.url,
            nodeId: id,
            persistAssets: persist,
          },
        },
      })
      const nextPrompt = extractTextFromTaskResult(taskRes.result)
      if (nextPrompt) {
        setPrompt(nextPrompt)
        updateNodeData(id, { prompt: nextPrompt })
        toast('已根据图片生成提示词', 'success')
      } else {
        toast('模型未返回提示词，请稍后重试', 'error')
      }
    } catch (error: any) {
      const message = typeof error?.message === 'string' ? error.message : '反推提示词失败'
      toast(message, 'error')
    } finally {
      setReversePromptLoading(false)
    }
  }, [supportsReversePrompt, primaryImageUrl, imageResults, imagePrimaryIndex, imageUrl, id, updateNodeData, setPrompt])

  const basePoseImage = React.useMemo(
    () => primaryImageUrl || imageResults[imagePrimaryIndex]?.url || imageResults[0]?.url || '',
    [imagePrimaryIndex, imageResults, primaryImageUrl],
  )

  const videoUrl = ((data as any)?.videoUrl as string | undefined) ?? null
  const videoThumbnailUrl = ((data as any)?.videoThumbnailUrl as string | undefined) ?? null
  const videoTitle = ((data as any)?.videoTitle as string | undefined) ?? null
  const videoTokenId = ((data as any)?.videoTokenId as string | undefined) || null
  const [videoPromptGenerationLoading, setVideoPromptGenerationLoading] = React.useState(false)

  // Video history results (similar to imageResults)
  const videoResults = React.useMemo<TaskNodeVideoResult[]>(() => {
    const raw = (data as any)?.videoResults as TaskNodeVideoResult[] | undefined
    if (raw && Array.isArray(raw) && raw.length > 0) {
      return raw.map((item): TaskNodeVideoResult => ({
        ...item,
        assetId: typeof item?.assetId === 'string' && item.assetId.trim() ? item.assetId.trim() : null,
        assetRefId: typeof item?.assetRefId === 'string' && item.assetRefId.trim() ? item.assetRefId.trim() : null,
        assetName: typeof item?.assetName === 'string' && item.assetName.trim() ? item.assetName.trim() : null,
        clipRange: normalizeClipRange(item?.clipRange),
      }))
    }
    const single = videoUrl
      ? {
          url: videoUrl,
          thumbnailUrl: videoThumbnailUrl,
          title: videoTitle,
          duration: (data as any)?.videoDuration,
          clipRange: normalizeClipRange((data as any)?.clipRange),
          remixTargetId: (data as any)?.remixTargetId || null,
        }
      : null
    return single ? [single] : []
  }, [data, videoUrl, videoThumbnailUrl, videoTitle])

  const persistedVideoPrimaryIndexRaw = (data as any)?.videoPrimaryIndex
  const persistedVideoPrimaryIndex = typeof persistedVideoPrimaryIndexRaw === 'number' ? persistedVideoPrimaryIndexRaw : null
  const [videoExpanded, setVideoExpanded] = React.useState(false)
  const [videoPrimaryIndex, setVideoPrimaryIndex] = React.useState<number>(() => (persistedVideoPrimaryIndex !== null ? persistedVideoPrimaryIndex : 0))
  React.useEffect(() => {
    const total = videoResults.length
    const clamped =
      persistedVideoPrimaryIndex !== null && total > 0
        ? Math.max(0, Math.min(total - 1, persistedVideoPrimaryIndex))
        : persistedVideoPrimaryIndex ?? 0
    setVideoPrimaryIndex((prev) => (prev === clamped ? prev : clamped))
  }, [persistedVideoPrimaryIndex, videoResults.length])
  const hasPrimaryVideo = Boolean(videoResults[videoPrimaryIndex]?.url || videoUrl)
  const adoptedVideoMetadata = React.useMemo<AdoptedAssetMetadata | null>(() => {
    const raw = (data as { adoptedVideoAsset?: unknown } | undefined)?.adoptedVideoAsset
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const candidate = raw as Record<string, unknown>
    const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''
    if (!url) return null
    const rawIndex = typeof candidate.index === 'number' && Number.isFinite(candidate.index) ? Math.max(0, Math.trunc(candidate.index)) : -1
    const resolvedIndex = videoResults[rawIndex]?.url === url
      ? rawIndex
      : videoResults.findIndex((item) => item.url === url)
    if (resolvedIndex < 0) return null
    return {
      index: resolvedIndex,
      url,
      adoptedAt: typeof candidate.adoptedAt === 'string' ? candidate.adoptedAt : '',
      progress: typeof candidate.progress === 'number' && Number.isFinite(candidate.progress) ? candidate.progress : null,
    }
  }, [data, videoResults])
  const adoptedVideoIndex = adoptedVideoMetadata?.index ?? null
  const isPrimaryVideoAdopted = adoptedVideoIndex !== null && adoptedVideoIndex === videoPrimaryIndex
  const videoClipRange = React.useMemo(() => {
    const fromResult = normalizeClipRange((videoResults[videoPrimaryIndex] as any)?.clipRange)
    if (fromResult) return fromResult
    return normalizeClipRange((data as any)?.clipRange)
  }, [data, videoPrimaryIndex, videoResults])
  const [videoSelectedIndex, setVideoSelectedIndex] = React.useState(0)
  const frameSampleUrlsRef = React.useRef<string[]>([])
  const [frameSamples, setFrameSamples] = React.useState<FrameSample[]>([])
  const [frameCaptureLoading, setFrameCaptureLoading] = React.useState(false)

  const cleanupFrameSamples = React.useCallback(() => {
    frameSampleUrlsRef.current.forEach((u) => {
      try {
        URL.revokeObjectURL(u)
      } catch {
        // ignore
      }
    })
    frameSampleUrlsRef.current = []
    setFrameSamples([])
  }, [])

  React.useEffect(() => {
    return () => {
      cleanupFrameSamples()
    }
  }, [cleanupFrameSamples])

	  const handleCaptureVideoFrames = React.useCallback(async () => {
	    const src = videoResults[videoPrimaryIndex]?.url || videoUrl
	    if (!src) {
	      toast('当前没有可用的视频链接', 'error')
	      return
	    }
    const duration = videoResults[videoPrimaryIndex]?.duration
    const sampleTimes = (() => {
      if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
        const durationSeconds = Math.max(1, duration)
        const floorSeconds = Math.floor(durationSeconds)
        const times: number[] = []
        const step = floorSeconds + 1 > MAX_FRAME_ANALYSIS_SAMPLES
          ? Math.ceil((floorSeconds + 1) / MAX_FRAME_ANALYSIS_SAMPLES)
          : 1
        for (let t = 0; t <= floorSeconds; t += step) {
          times.push(Number(t.toFixed(2)))
        }
        if (!times.includes(Number(durationSeconds.toFixed(2)))) {
          times.push(Number(durationSeconds.toFixed(2)))
        }
        return times
      }
      return [1]
    })().filter((t, idx, arr) => Number.isFinite(t) && t >= 0 && arr.indexOf(t) === idx)

    setFrameCaptureLoading(true)
    cleanupFrameSamples()
    try {
      const { frames } = await captureFramesAtTimes({ type: 'url', url: src }, sampleTimes)
      frameSampleUrlsRef.current = frames.map((f) => f.objectUrl)
      setFrameSamples(
        frames.map((f) => ({
          url: f.objectUrl,
          time: f.time,
          blob: f.blob,
          remoteUrl: null,
          description: null,
          describing: false,
        })),
      )
      if (!frames.length) {
        toast('未能抽取到有效帧，可能受跨域或视频格式限制', 'error')
      } else {
        toast(`已抽取 ${frames.length} 帧`, 'success')
      }
    } catch (err: any) {
      console.error('captureFramesAtTimes error', err)
      const message =
        (err?.message as string | undefined) ||
        '抽帧失败，可能是跨域或视频格式不支持'
      toast(message, 'error')
	    } finally {
	      setFrameCaptureLoading(false)
	    }
	  }, [cleanupFrameSamples, videoPrimaryIndex, videoResults, videoUrl])

	  // 旧版基于 Sora 的角色创建能力已移除（不再依赖前端配置 Token/厂商）。

  const persistedCharacterRewriteModel = (data as any)?.characterRewriteModel
  const [characterRewriteModel, setCharacterRewriteModel] = React.useState<string>(() => {
    const stored = persistedCharacterRewriteModel
    return typeof stored === 'string' && stored.trim() ? stored : 'glm-4.6'
  })
  const [characterRewriteLoading, setCharacterRewriteLoading] = React.useState(false)
  const [characterRewriteError, setCharacterRewriteError] = React.useState<string | null>(null)

  const promptSuggestMode = useUIStore(s => s.promptSuggestMode)
  const [promptSuggestions, setPromptSuggestions] = React.useState<string[]>([])
  const [activeSuggestion, setActiveSuggestion] = React.useState(0)
  const suggestionsAllowed = promptSuggestMode !== 'off' && !isVideoNode
  const [suggestionsEnabled, setSuggestionsEnabled] = React.useState(() => suggestionsAllowed)
  const [promptSamplesOpen, setPromptSamplesOpen] = React.useState(false)
  const [mediaFocusOptionsOpen, setMediaFocusOptionsOpen] = React.useState(false)
  const [presetModalOpen, setPresetModalOpen] = React.useState(false)
  const [presetSaving, setPresetSaving] = React.useState(false)
  const [presetItems, setPresetItems] = React.useState<LlmNodePresetDto[]>([])
  const [presetLoading, setPresetLoading] = React.useState(false)
  const [selectedPresetId, setSelectedPresetId] = React.useState<string | null>(
    () => {
      const value = (data as any)?.llmPresetId
      return typeof value === 'string' && value.trim() ? value : null
    },
  )
  const [newPresetTitle, setNewPresetTitle] = React.useState('')
  const [newPresetPrompt, setNewPresetPrompt] = React.useState('')
  const [newPresetType, setNewPresetType] = React.useState<LlmNodePresetType>('text')
  const suggestTimeout = React.useRef<number | null>(null)
  const lastResult = (data as any)?.lastResult as { preview?: { type?: string; value?: string } } | undefined
  const lastText =
    lastResult && lastResult.preview && lastResult.preview.type === 'text'
      ? String(lastResult.preview.value || '')
      : ''
  const rawTextResults =
    ((data as any)?.textResults as { text: string }[] | undefined) || []
  const textResults =
    rawTextResults.length > 0
      ? rawTextResults
      : lastText
        ? [{ text: lastText }]
        : []
  const latestTextResult =
    textResults.length > 0 && typeof textResults[textResults.length - 1]?.text === 'string'
      ? String(textResults[textResults.length - 1].text).trim()
      : ''
  const docPreviewText = isProjectDocNode
    ? (latestTextResult || String(prompt || '').trim())
    : ''
  const [compareOpen, setCompareOpen] = React.useState(false)
  const [materialSaving, setMaterialSaving] = React.useState(false)
  const [modelKey, setModelKey] = React.useState<string>(
    (data as any)?.geminiModel || getDefaultModel((coreKind === 'image' ? 'image' : coreKind) as NodeKind),
  )
  const defaultCanvasImageModel = kind === 'imageEdit' ? getDefaultModel('imageEdit') : getDefaultModel('image')
  const [imageModel, setImageModel] = React.useState<string>((data as any)?.imageModel || defaultCanvasImageModel)
  const [videoModel, setVideoModel] = React.useState<string>((data as any)?.videoModel || 'veo3.1-fast')
  const [videoHd, setVideoHd] = React.useState<boolean>(() => {
    const raw = (data as any)?.videoHd
    return typeof raw === 'boolean' ? raw : false
  })
  const [videoDuration, setVideoDuration] = React.useState<number>(() => {
    const dataRecord =
      data && typeof data === 'object'
        ? (data as Record<string, unknown>)
        : {}
    return readVideoDurationSeconds(
      dataRecord,
      isStoryboardNode ? STORYBOARD_MAX_TOTAL_DURATION : 15,
    )
  })
  const [videoSize, setVideoSize] = React.useState<string>(() => {
    const raw = typeof (data as any)?.videoSize === 'string' ? String((data as any).videoSize).trim() : ''
    return raw.replace(/\s+/g, '')
  })
  const [videoResolution, setVideoResolution] = React.useState<string>(() => {
    const dataRecord = data as Record<string, unknown>
    return normalizeVideoResolution(dataRecord.videoResolution ?? dataRecord.resolution)
  })
  const [orientation, setOrientation] = React.useState<Orientation>(() => {
    const dataRecord = data as Record<string, unknown>
    const rawVideoSize = typeof dataRecord.videoSize === 'string' ? dataRecord.videoSize.trim() : ''
    const rawAspect = typeof dataRecord.aspect === 'string' ? dataRecord.aspect.trim() : ''
    return resolveVideoOrientationValue({
      currentOrientation: dataRecord.orientation,
      size: rawVideoSize,
      aspect: rawAspect,
      config: null,
    })
  })
  const orientationRef = React.useRef<Orientation>(orientation)
  React.useEffect(() => {
    const dataRecord = data as Record<string, unknown>
    const rawVideoSize = typeof dataRecord.videoSize === 'string' ? dataRecord.videoSize.trim() : ''
    const rawAspect = typeof dataRecord.aspect === 'string' ? dataRecord.aspect.trim() : ''
    const normalized = resolveVideoOrientationValue({
      currentOrientation: dataRecord.orientation,
      size: rawVideoSize,
      aspect: rawAspect,
      config: null,
    })
    setOrientation((prev) => (prev === normalized ? prev : normalized))
    orientationRef.current = normalized
  }, [(data as any)?.orientation, (data as any)?.videoSize, (data as any)?.aspect])
  React.useEffect(() => {
    const raw = typeof (data as any)?.videoSize === 'string' ? String((data as any).videoSize).trim() : ''
    const normalized = raw.replace(/\s+/g, '')
    setVideoSize((prev) => (prev === normalized ? prev : normalized))
  }, [(data as any)?.videoSize])
  React.useEffect(() => {
    const dataRecord = data as Record<string, unknown>
    const normalized = normalizeVideoResolution(dataRecord.videoResolution ?? dataRecord.resolution)
    setVideoResolution((prev) => (prev === normalized ? prev : normalized))
  }, [(data as Record<string, unknown>)?.videoResolution, (data as Record<string, unknown>)?.resolution])
  React.useEffect(() => {
    if (kind !== 'imageEdit') return
    const next = normalizeImageEditSize((data as Record<string, unknown>)?.imageEditSize ?? (data as Record<string, unknown>)?.size)
    setImageEditSize((prev) => (prev === next ? prev : next))
  }, [(data as Record<string, unknown>)?.imageEditSize, (data as Record<string, unknown>)?.size, kind])
  React.useEffect(() => {
    if (kind !== 'imageEdit') return
    const dataRecord = data as Record<string, unknown>
    const storedImageEditSize = typeof dataRecord.imageEditSize === 'string' ? dataRecord.imageEditSize.trim() : ''
    const storedSize = typeof dataRecord.size === 'string' ? dataRecord.size.trim() : ''
    if (storedImageEditSize && storedSize) return
    const nextSize = normalizeImageEditSize(storedImageEditSize || storedSize || imageEditSize)
    updateNodeData(id, {
      imageEditSize: nextSize,
      size: nextSize,
      aspect: toAspectRatioFromImageEditSize(nextSize),
    })
  }, [data, id, imageEditSize, kind, updateNodeData])
  React.useEffect(() => {
    const next = normalizeCanvasResizeSize((data as Record<string, unknown>)?.canvasResizeSize ?? canvasResizeSize)
    setCanvasResizeSize((prev) => (prev === next ? prev : next))
  }, [(data as Record<string, unknown>)?.canvasResizeSize, canvasResizeSize])
  const [veoReferenceImages, setVeoReferenceImages] = React.useState<string[]>(() =>
    normalizeVeoReferenceUrls((data as any)?.veoReferenceImages),
  )
  const [veoFirstFrameUrl, setVeoFirstFrameUrl] = React.useState<string>(
    ((data as any)?.veoFirstFrameUrl as string | undefined) || '',
  )
  const [veoLastFrameUrl, setVeoLastFrameUrl] = React.useState<string>(
    ((data as any)?.veoLastFrameUrl as string | undefined) || '',
  )
  const [veoCustomImageInput, setVeoCustomImageInput] = React.useState('')
  const activeVideoDuration = React.useMemo(() => {
    const candidate = videoResults[videoPrimaryIndex]?.duration ?? videoDuration
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return candidate
    }
    return null
  }, [videoResults, videoPrimaryIndex, videoDuration])

  const handleSaveProjectMaterial = React.useCallback(async () => {
    if (!isProjectDocNode) return
    const projectId = typeof currentProject?.id === 'string' ? currentProject.id.trim() : ''
    if (!projectId) {
      toast('请先选择项目，再保存文档素材', 'warning')
      return
    }

    const latestText =
      textResults.length > 0 && typeof textResults[textResults.length - 1]?.text === 'string'
        ? String(textResults[textResults.length - 1].text).trim()
        : ''
    const promptText = typeof prompt === 'string' ? prompt.trim() : ''
    const content = latestText || promptText
    if (!content) {
      toast('当前没有可保存的文本内容', 'warning')
      return
    }

    const nowIso = new Date().toISOString()
    const inferChapter = (input: string): number | null => {
      const m = String(input || '').match(/第\s*([0-9]{1,4})\s*章/)
      if (!m) return null
      const n = Number(m[1])
      if (!Number.isFinite(n) || n <= 0) return null
      return Math.trunc(n)
    }
    const chapterFromDataRaw = Number((data as any)?.materialChapter ?? (data as any)?.chapter)
    const chapterFromData =
      Number.isFinite(chapterFromDataRaw) && chapterFromDataRaw > 0
        ? Math.trunc(chapterFromDataRaw)
        : null
    const inferredChapter = chapterFromData || inferChapter(String((data as any)?.label || '')) || inferChapter(content.slice(0, 80))
    const materialData = {
      kind,
      content,
      prompt: promptText || null,
      textResults,
      chapter: inferredChapter,
      sourceNodeId: id,
      flowId: useUIStore.getState().currentFlow?.id || null,
      savedAt: nowIso,
    }

    const materialAssetIdRaw = (data as any)?.materialAssetId
    const materialAssetId = typeof materialAssetIdRaw === 'string' ? materialAssetIdRaw.trim() : ''

    setMaterialSaving(true)
    try {
      let savedId = materialAssetId
      if (savedId) {
        const updated = await updateServerAssetData(savedId, materialData)
        savedId = updated.id
      } else {
        const created = await createServerAsset({
          name: `${(data as any)?.label || '文档'}-${new Date().toLocaleString()}`,
          projectId,
          data: materialData,
        })
        savedId = created.id
      }

      updateNodeData(id, {
        materialAssetId: savedId,
        materialProjectId: projectId,
        materialChapter: inferredChapter,
        materialSavedAt: nowIso,
      })
      toast('已保存到项目素材', 'success')
    } catch (error: any) {
      toast(error?.message || '保存项目素材失败', 'error')
    } finally {
      setMaterialSaving(false)
    }
  }, [isProjectDocNode, currentProject?.id, textResults, prompt, kind, id, data, updateNodeData])

  React.useEffect(() => {
    const next = normalizeVeoReferenceUrls((data as any)?.veoReferenceImages)
    setVeoReferenceImages((prev) => {
      if (prev.length === next.length && prev.every((item, index) => item === next[index])) {
        return prev
      }
      return next
    })
  }, [(data as any)?.veoReferenceImages])

  React.useEffect(() => {
    const next = ((data as any)?.veoFirstFrameUrl as string | undefined) || ''
    setVeoFirstFrameUrl((prev) => (prev === next ? prev : next))
  }, [(data as any)?.veoFirstFrameUrl])

  React.useEffect(() => {
    const next = ((data as any)?.veoLastFrameUrl as string | undefined) || ''
    setVeoLastFrameUrl((prev) => (prev === next ? prev : next))
  }, [(data as any)?.veoLastFrameUrl])

  const primaryMedia = React.useMemo(() => {
    if (hasPrimaryImage || hasImageResults) return 'image' as const
    if (isVideoNode && (videoResults[videoPrimaryIndex]?.url || (data as any)?.videoUrl)) return 'video' as const
    if (isAudioNode && (data as any)?.audioUrl) return 'audio' as const
    return null
  }, [
    hasPrimaryImage,
    hasImageResults,
    isVideoNode,
    videoResults,
    videoPrimaryIndex,
    data,
    isAudioNode,
  ])
  const { selectedNodeCount } = useCanvasRenderContext()
  const isSingleSelectionActive = Boolean(selected && !dragging && selectedNodeCount <= 1)
  const wantsCharacterRefs = isSingleSelectionActive
  const characterRefs = useRFStore(
    React.useCallback((s): CharacterRef[] => {
      if (!wantsCharacterRefs) return EMPTY_CHARACTER_REFS
      const results: CharacterRef[] = []
      s.nodes.forEach((node) => {
        const nodeKind = (node.data as any)?.kind
        const nodeSchema = getTaskNodeSchema(nodeKind)
        if (!(nodeSchema.category === 'character' || nodeSchema.features.includes('character'))) return
        const payload: any = node.data || {}
        const usernameRaw =
          payload.characterUsername ||
          payload.username ||
          payload.soraCharacterUsername ||
          ''
        const username = typeof usernameRaw === 'string' ? usernameRaw.replace(/^@/, '') : ''
        const displayName =
          payload.characterDisplayName ||
          payload.displayName ||
          payload.label ||
          (username ? `@${username}` : node.id)
        results.push({ nodeId: node.id, username, displayName, rawLabel: payload.label || '' })
      })
      return results.filter((ref) => ref.username || ref.displayName)
    }, [wantsCharacterRefs]),
    areCharacterRefsEqual,
  )
  const characterRefMap = React.useMemo(() => {
    const map = new Map<string, { nodeId: string; username: string; displayName: string }>()
    characterRefs.forEach((ref) => map.set(ref.nodeId, ref))
    return map
  }, [characterRefs])
  const [projectRoleRefs, setProjectRoleRefs] = React.useState<CharacterRef[]>(EMPTY_CHARACTER_REFS)
  const [projectRoleRefsVersion, setProjectRoleRefsVersion] = React.useState(0)
  React.useEffect(() => {
    if (typeof window === 'undefined' || !wantsCharacterRefs) return
    const projectId = String(currentProject?.id || '').trim()
    const onRefresh = () => {
      invalidateProjectMentionRefCaches(projectId)
      setProjectRoleRefsVersion((v) => v + 1)
    }
    window.addEventListener(ASSET_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(ASSET_REFRESH_EVENT, onRefresh)
  }, [currentProject?.id, wantsCharacterRefs])
  React.useEffect(() => {
    const projectId = String(currentProject?.id || '').trim()
    if (!projectId || !wantsCharacterRefs) {
      setProjectRoleRefs(EMPTY_CHARACTER_REFS)
      return
    }
    let canceled = false
    ;(async () => {
      try {
        const refs = await loadProjectRoleRefs(projectId)
        if (canceled) return
        setProjectRoleRefs(refs)
      } catch {
        if (canceled) return
        setProjectRoleRefs(EMPTY_CHARACTER_REFS)
      }
    })()
    return () => {
      canceled = true
    }
  }, [currentProject?.id, projectRoleRefsVersion, wantsCharacterRefs])
  const mergedCharacterRefs = React.useMemo(() => {
    if (!projectRoleRefs.length) return characterRefs
    const byUsername = new Map<string, CharacterRef>()
    for (const ref of characterRefs) {
      const key = String(ref.username || '').trim().toLowerCase()
      if (!key) continue
      byUsername.set(key, ref)
    }
    for (const ref of projectRoleRefs) {
      const key = String(ref.username || '').trim().toLowerCase()
      if (!key || byUsername.has(key)) continue
      byUsername.set(key, ref)
    }
    return Array.from(byUsername.values())
  }, [characterRefs, projectRoleRefs])
  const canvasAssetMentionRefs = useRFStore(
    React.useCallback((s): CharacterRef[] => {
      if (!wantsCharacterRefs) return EMPTY_CHARACTER_REFS
      const results: CharacterRef[] = []
      s.nodes.forEach((node) => {
        if (node.id === id) return
        const payload: any = node.data || {}
        const imageResults = Array.isArray(payload.imageResults) ? payload.imageResults : []
        const videoResults = Array.isArray(payload.videoResults) ? payload.videoResults : []
        const primaryImage = imageResults[0] || null
        const primaryVideo = videoResults[0] || null
        const assetUrl = readPrimaryReferenceAssetUrl(payload)
        const usernameRaw =
          payload.assetRefId ||
          primaryImage?.assetRefId ||
          primaryVideo?.assetRefId ||
          payload.assetId ||
          primaryImage?.assetId ||
          primaryVideo?.assetId ||
          ''
        const username = toMentionUsername(usernameRaw)
        if (!username) return
        const displayName =
          payload.assetName ||
          primaryImage?.assetName ||
          primaryVideo?.assetName ||
          primaryImage?.title ||
          primaryVideo?.title ||
          payload.label ||
          username
        results.push({
          nodeId: node.id,
          username,
          displayName,
          rawLabel: payload.label || displayName,
          source: 'asset',
          assetUrl: assetUrl || null,
          assetId:
            String(
              payload.assetId ||
              primaryImage?.assetId ||
              primaryVideo?.assetId ||
              '',
            ).trim() || null,
          assetRefId:
            String(
              payload.assetRefId ||
              primaryImage?.assetRefId ||
              primaryVideo?.assetRefId ||
              username,
            ).trim() || username,
          assetName: String(displayName || username).trim() || username,
        })
      })
      return results.filter((ref) => ref.username)
    }, [id, wantsCharacterRefs]),
    areCharacterRefsEqual,
  )
  const [projectAssetMentionRefs, setProjectAssetMentionRefs] = React.useState<CharacterRef[]>(EMPTY_CHARACTER_REFS)
  React.useEffect(() => {
    const projectId = String(currentProject?.id || '').trim()
    if (!projectId || !wantsCharacterRefs) {
      setProjectAssetMentionRefs(EMPTY_CHARACTER_REFS)
      return
    }
    let canceled = false
    ;(async () => {
      try {
        const refs = await loadProjectAssetMentionRefs(projectId)
        if (canceled) return
        setProjectAssetMentionRefs(refs)
      } catch {
        if (!canceled) setProjectAssetMentionRefs(EMPTY_CHARACTER_REFS)
      }
    })()
    return () => {
      canceled = true
    }
  }, [currentProject?.id, projectRoleRefsVersion, wantsCharacterRefs])
  const mergedAssetMentionRefs = React.useMemo(() => {
    const byUsername = new Map<string, CharacterRef>()
    for (const ref of canvasAssetMentionRefs) {
      const key = String(ref.username || '').trim().toLowerCase()
      if (!key) continue
      byUsername.set(key, ref)
    }
    for (const ref of projectAssetMentionRefs) {
      const key = String(ref.username || '').trim().toLowerCase()
      if (!key || byUsername.has(key)) continue
      byUsername.set(key, ref)
    }
    return Array.from(byUsername.values())
  }, [canvasAssetMentionRefs, projectAssetMentionRefs])
  const handleBindPrimaryAnchor = React.useCallback(async () => {
    const projectId = typeof currentProject?.id === 'string' ? currentProject.id.trim() : ''
    const anchorKind = anchorBindingKind
    const anchorLabel = anchorBindingLabel.trim()
    const imageUrl = primaryImageForAnchorBinding
    const nodeData = data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : {}
    const sourceBookId = typeof nodeData.sourceBookId === 'string' ? nodeData.sourceBookId.trim() : ''
    const parsePositiveNumber = (value: unknown): number | undefined => {
      const numeric = Number(value)
      return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : undefined
    }
    const chapter = parsePositiveNumber(nodeData.materialChapter) ?? parsePositiveNumber(nodeData.chapter)
    const stateDescription =
      typeof nodeData.stateDescription === 'string' && nodeData.stateDescription.trim()
        ? nodeData.stateDescription.trim()
        : undefined
    const semanticRoleBinding = resolveSemanticNodeRoleBinding(nodeData)
    const semanticVisualBinding = resolveSemanticNodeVisualReferenceBinding(nodeData)
    if (!anchorLabel) {
      toast('请先填写锚点名称', 'warning')
      return
    }
    if (!imageUrl) {
      toast('当前节点还没有可用主图，请先生成图片后再绑定', 'warning')
      return
    }
    if (bindAnchorLoading) return
    setBindAnchorLoading(true)
    try {
      let resolvedSourceBookId = sourceBookId
      if (!resolvedSourceBookId && projectId) {
        resolvedSourceBookId = pickOnlyBookId(await listProjectBooks(projectId))
      }

      if (anchorKind === 'character') {
        const assetConflict = findMentionRefConflict({
          candidate: anchorLabel,
          assetRefs: mergedAssetMentionRefs,
        })
        if (assetConflict) {
          toast(`绑定失败：@${assetConflict.mention} 已被资产引用占用（${assetConflict.displayName}）`, 'error')
          return
        }

        const referenceView = semanticRoleBinding.referenceView || 'three_view'
        const nextRoleRefUrls = Array.from(
          new Set([
            ...(Array.isArray(nodeData.roleCardReferenceImages)
              ? (nodeData.roleCardReferenceImages as unknown[]).map((item) => String(item || '').trim()).filter(Boolean)
              : []),
            imageUrl,
          ]),
        ).slice(0, 8)

        if (!projectId) {
          updateNodeData(id, {
            roleName: anchorLabel,
            ...(resolvedSourceBookId ? { sourceBookId: resolvedSourceBookId } : null),
            referenceView,
            roleCardReferenceImages: nextRoleRefUrls,
            anchorBindings: upsertSemanticNodeAnchorBinding({
              existing: nodeData.anchorBindings,
              next: {
                kind: 'character',
                label: anchorLabel,
                sourceBookId: resolvedSourceBookId || null,
                sourceNodeId: id,
                imageUrl,
                referenceView,
              },
            }),
          })
          toast(`已绑定角色锚点：${anchorLabel}`, 'success')
          return
        }

        const saved = await upsertProjectRoleCardAsset(projectId, {
          cardId: String(nodeData.roleCardId || '').trim() || undefined,
          roleId: String(nodeData.roleId || '').trim() || undefined,
          roleName: anchorLabel,
          nodeId: id,
          prompt: prompt?.trim() || undefined,
          status: 'generated',
          modelKey: String(nodeData.modelKey || nodeData.imageModel || '').trim() || undefined,
          imageUrl,
          ...(referenceView === 'three_view' ? { threeViewImageUrl: imageUrl } : null),
        })
        let syncedRoleCardId = String(saved?.data?.cardId || saved?.id || '').trim()
        if (resolvedSourceBookId) {
          const bookSaved = await upsertProjectBookRoleCard(projectId, resolvedSourceBookId, {
            cardId: syncedRoleCardId || undefined,
            roleId: String(saved?.data?.roleId || '').trim() || undefined,
            roleName: anchorLabel,
            ...(stateDescription ? { stateDescription } : {}),
            ...(typeof chapter === 'number' ? { chapter } : {}),
            nodeId: id,
            prompt: prompt?.trim() || undefined,
            status: 'generated',
            modelKey: String(nodeData.modelKey || nodeData.imageModel || '').trim() || undefined,
            imageUrl,
            ...(referenceView === 'three_view' ? { threeViewImageUrl: imageUrl } : null),
          })
          syncedRoleCardId = String(bookSaved?.cardId || syncedRoleCardId).trim()
        }

        updateNodeData(id, {
          roleName: anchorLabel,
          ...(saved?.data?.roleId ? { roleId: saved.data.roleId } : null),
          ...(syncedRoleCardId ? { roleCardId: syncedRoleCardId } : null),
          ...(resolvedSourceBookId ? { sourceBookId: resolvedSourceBookId } : null),
          referenceView,
          roleCardReferenceImages: nextRoleRefUrls,
          anchorBindings: upsertSemanticNodeAnchorBinding({
            existing: nodeData.anchorBindings,
            next: {
              kind: 'character',
              label: anchorLabel,
              refId: syncedRoleCardId || null,
              entityId: String(saved?.data?.roleId || '').trim() || null,
              sourceBookId: resolvedSourceBookId || null,
              sourceNodeId: id,
              imageUrl,
              referenceView,
            },
          }),
        })
        notifyAssetRefresh()
        if (resolvedSourceBookId) {
          toast(`已绑定角色锚点并同步到工作台：${anchorLabel}`, 'success')
        } else {
          toast(`已绑定角色锚点：${anchorLabel}；当前节点缺少唯一书籍上下文，未同步到书籍 roleCards`, 'info')
        }
        return
      }

      if (anchorKind === 'scene' || anchorKind === 'prop') {
        if (projectId && resolvedSourceBookId) {
          const saved = await upsertProjectBookVisualRef(projectId, resolvedSourceBookId, {
            refId: semanticVisualBinding.refId || undefined,
            category: 'scene_prop',
            name: anchorLabel,
            ...(typeof chapter === 'number' ? { chapter } : {}),
            ...(stateDescription ? { stateDescription } : {}),
            nodeId: id,
            prompt: prompt?.trim() || undefined,
            status: 'generated',
            modelKey: String(nodeData.modelKey || nodeData.imageModel || '').trim() || undefined,
            imageUrl,
          })
          updateNodeData(id, {
            ...(resolvedSourceBookId ? { sourceBookId: resolvedSourceBookId } : null),
            visualRefId: saved.refId,
            visualRefName: anchorLabel,
            visualRefCategory: 'scene_prop',
            scenePropRefId: saved.refId,
            scenePropRefName: anchorLabel,
            anchorBindings: upsertSemanticNodeAnchorBinding({
              existing: nodeData.anchorBindings,
              next: {
                kind: anchorKind,
                label: anchorLabel,
                refId: saved.refId,
                sourceBookId: resolvedSourceBookId,
                sourceNodeId: id,
                imageUrl,
                category: 'scene_prop',
              },
            }),
          })
          notifyAssetRefresh()
          toast(`已绑定${anchorKind === 'scene' ? '场景' : '道具'}锚点并同步到工作台：${anchorLabel}`, 'success')
          return
        }

        updateNodeData(id, {
          ...(resolvedSourceBookId ? { sourceBookId: resolvedSourceBookId } : null),
          scenePropRefName: anchorLabel,
          visualRefName: anchorLabel,
          visualRefCategory: 'scene_prop',
          anchorBindings: upsertSemanticNodeAnchorBinding({
            existing: nodeData.anchorBindings,
            next: {
              kind: anchorKind,
              label: anchorLabel,
              sourceBookId: resolvedSourceBookId || null,
              sourceNodeId: id,
              imageUrl,
              category: 'scene_prop',
            },
          }),
        })
        toast(`已绑定${anchorKind === 'scene' ? '场景' : '道具'}锚点：${anchorLabel}`, 'success')
        return
      }

      updateNodeData(id, {
        ...(resolvedSourceBookId ? { sourceBookId: resolvedSourceBookId } : null),
        anchorBindings: upsertSemanticNodeAnchorBinding({
          existing: nodeData.anchorBindings,
          next: {
            kind: anchorKind,
            label: anchorLabel,
            sourceBookId: resolvedSourceBookId || null,
            sourceNodeId: id,
            imageUrl,
          },
        }),
      })
      toast(`已绑定锚点：${anchorLabel}`, 'success')
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '绑定锚点失败'
      toast(errorMessage || '绑定锚点失败', 'error')
    } finally {
      setBindAnchorLoading(false)
    }
  }, [anchorBindingKind, anchorBindingLabel, bindAnchorLoading, currentProject?.id, data, id, mergedAssetMentionRefs, primaryImageForAnchorBinding, prompt, updateNodeData])
  const primaryMediaUrl = React.useMemo(() => {
    switch (primaryMedia) {
      case 'image':
        return (
          imageResults[imagePrimaryIndex]?.url ||
          imageUrl ||
          (data as any)?.imageUrl ||
          null
        )
      case 'video':
        return (
          videoResults[videoPrimaryIndex]?.url ||
          (data as any)?.videoUrl ||
          null
        )
      case 'audio':
        return (data as any)?.audioUrl || null
      default:
        return null
    }
  }, [
    primaryMedia,
    imageResults,
    imagePrimaryIndex,
    imageUrl,
    data,
    videoResults,
    videoPrimaryIndex,
  ])
  const primaryBindableAsset = React.useMemo(() => {
    if (primaryMedia === 'image') {
      const current = imageResults[imagePrimaryIndex] || imageResults[0] || null
      const directUrl = typeof (data as any)?.imageUrl === 'string' ? String((data as any).imageUrl).trim() : ''
      const directAssetId = typeof (data as any)?.assetId === 'string' ? String((data as any).assetId).trim() : ''
      const directAssetRefId = typeof (data as any)?.assetRefId === 'string' ? String((data as any).assetRefId).trim() : ''
      const directAssetName = typeof (data as any)?.assetName === 'string' ? String((data as any).assetName).trim() : ''
      const url = current?.url || directUrl
      if (!url) return null
      return {
        kind: 'image' as const,
        url,
        assetId: current?.assetId || directAssetId || null,
        assetRefId: current?.assetRefId || directAssetRefId || null,
        assetName: current?.assetName || current?.title || directAssetName || String((data as any)?.label || '').trim() || null,
      }
    }
    if (primaryMedia === 'video') {
      const current = videoResults[videoPrimaryIndex] || videoResults[0] || null
      const directUrl = typeof (data as any)?.videoUrl === 'string' ? String((data as any).videoUrl).trim() : ''
      const directAssetId = typeof (data as any)?.assetId === 'string' ? String((data as any).assetId).trim() : ''
      const directAssetRefId = typeof (data as any)?.assetRefId === 'string' ? String((data as any).assetRefId).trim() : ''
      const directAssetName = typeof (data as any)?.assetName === 'string' ? String((data as any).assetName).trim() : ''
      const url = current?.url || directUrl
      if (!url) return null
      return {
        kind: 'video' as const,
        url,
        assetId: current?.assetId || directAssetId || null,
        assetRefId: current?.assetRefId || directAssetRefId || null,
        assetName: current?.assetName || current?.title || directAssetName || String((data as any)?.label || '').trim() || null,
      }
    }
    return null
  }, [data, imagePrimaryIndex, imageResults, primaryMedia, videoPrimaryIndex, videoResults])
  const assetBindStatusText = React.useMemo(() => {
    const parts: string[] = []
    const currentRefId = String((data as any)?.assetRefId || primaryBindableAsset?.assetRefId || '').trim()
    const currentAssetId = String((data as any)?.assetId || primaryBindableAsset?.assetId || '').trim()
    if (currentRefId) parts.push(`引用ID：${currentRefId}`)
    if (currentAssetId) parts.push(`资产ID：${currentAssetId}`)
    return parts.join(' · ')
  }, [data, primaryBindableAsset])
  const handleBindPrimaryAssetReference = React.useCallback(() => {
    const nextRefId = toMentionUsername(assetBindingId)
    if (!nextRefId) {
      toast('请先填写引用ID', 'warning')
      return
    }
    if (!primaryBindableAsset?.url) {
      toast('当前节点还没有可绑定的图片或视频结果', 'warning')
      return
    }
    const roleConflict = findMentionRefConflict({
      candidate: nextRefId,
      roleRefs: projectRoleRefs,
    })
    if (roleConflict) {
      toast(`绑定失败：@${roleConflict.mention} 已被角色卡占用（${roleConflict.displayName}）`, 'error')
      return
    }
    const nextAssetName = primaryBindableAsset.assetName || String((data as any)?.label || '').trim() || nextRefId
    const patch: Record<string, unknown> = {
      assetRefId: nextRefId,
      ...(primaryBindableAsset.assetId ? { assetId: primaryBindableAsset.assetId } : null),
      assetName: nextAssetName,
    }
    if (primaryBindableAsset.kind === 'image') {
      const nextResults = imageResults.length
        ? imageResults.map((item, index) => index === imagePrimaryIndex
          ? {
              ...item,
              ...(primaryBindableAsset.assetId ? { assetId: primaryBindableAsset.assetId } : null),
              assetRefId: nextRefId,
              assetName: nextAssetName,
            }
          : item)
        : [{
            url: primaryBindableAsset.url,
            ...(primaryBindableAsset.assetId ? { assetId: primaryBindableAsset.assetId } : null),
            assetRefId: nextRefId,
            assetName: nextAssetName,
          }]
      patch.imageResults = nextResults
    } else if (primaryBindableAsset.kind === 'video') {
      const nextResults = videoResults.length
        ? videoResults.map((item, index) => index === videoPrimaryIndex
          ? {
              ...item,
              ...(primaryBindableAsset.assetId ? { assetId: primaryBindableAsset.assetId } : null),
              assetRefId: nextRefId,
              assetName: nextAssetName,
            }
          : item)
        : [{
            url: primaryBindableAsset.url,
            ...(primaryBindableAsset.assetId ? { assetId: primaryBindableAsset.assetId } : null),
            assetRefId: nextRefId,
            assetName: nextAssetName,
          }]
      patch.videoResults = nextResults
    }
    updateNodeData(id, patch)
    setAssetBindingId(nextRefId)
    toast(`已绑定引用ID：@${nextRefId}`, 'success')
  }, [assetBindingId, data, id, imagePrimaryIndex, imageResults, primaryBindableAsset, projectRoleRefs, updateNodeData, videoPrimaryIndex, videoResults])
  const handleMentionApplied = React.useCallback((item: MentionSuggestionItem) => {
    if (item.source !== 'asset') return
    const assetBinding = item.assetBinding
    if (!assetBinding?.url) return
    const nodeData = data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : {}
    const existingReferenceImages = Array.isArray(nodeData.referenceImages)
      ? nodeData.referenceImages
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter(Boolean)
      : []
    const nextReferenceImages = existingReferenceImages.includes(assetBinding.url)
      ? existingReferenceImages
      : [...existingReferenceImages, assetBinding.url].slice(0, 12)
    const existingAssetInputs = Array.isArray(nodeData.assetInputs)
      ? nodeData.assetInputs.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      : []
    const existingIndex = existingAssetInputs.findIndex((entry) => {
      const record = entry as Record<string, unknown>
      return typeof record.url === 'string' && record.url.trim() === assetBinding.url
    })
    const nextAssetInput = {
      url: assetBinding.url,
      role: 'reference',
      ...(assetBinding.assetId ? { assetId: assetBinding.assetId } : null),
      ...(assetBinding.assetRefId ? { assetRefId: assetBinding.assetRefId } : null),
      ...(assetBinding.assetName ? { name: assetBinding.assetName } : null),
    }
    const nextAssetInputs =
      existingIndex >= 0
        ? existingAssetInputs.map((entry, index) => (index === existingIndex ? { ...(entry as Record<string, unknown>), ...nextAssetInput } : entry))
        : [...existingAssetInputs, nextAssetInput].slice(0, 12)
    updateNodeData(id, {
      referenceImages: nextReferenceImages,
      assetInputs: nextAssetInputs,
    })
  }, [data, id, updateNodeData])

  const activeModelKey = isVideoNode
    ? videoModel
    : coreKind === 'image' || kind === 'imageEdit'
      ? imageModel
      : modelKey
  const modelList = useModelOptions(kind as NodeKind)
  const modelMenuOptions = React.useMemo<ModelOption[]>(() => {
    if (modelList.length) {
      return modelList.map((option) => ({
        ...option,
        label: getTaskNodeModelDisplayLabel(option),
      }))
    }
    const fallbackValue = String(activeModelKey || '').trim()
    if (!fallbackValue) return []
    return [{ value: fallbackValue, label: fallbackValue, modelKey: fallbackValue }]
  }, [activeModelKey, modelList])
  const selectedActiveModelOption = React.useMemo(
    () => findModelOptionByIdentifier(modelMenuOptions, activeModelKey),
    [activeModelKey, modelMenuOptions],
  )
  const findVendorForModel = React.useCallback(
    (value: string | null | undefined) => {
      if (!value) return null
      const match = findModelOptionByIdentifier(modelList, value)
      return match?.vendor || null
    },
    [modelList],
  )
  const resolveRequestedModelIdentifier = React.useCallback(
    (value: string | null | undefined) => {
      const identifier = String(value || '').trim()
      if (!identifier) return ''
      return getModelOptionRequestAlias(modelList.length ? modelList : modelMenuOptions, identifier) || identifier
    },
    [modelList, modelMenuOptions],
  )
  const handleApplyImageViewEdit = React.useCallback(
    ({ cameraControl, lightingRig }: ImageViewEditorApplyPayload) => {
      const normalizedBaseImageUrl = String(basePoseImage || '').trim()
      if (!normalizedBaseImageUrl) {
        toast('请先上传或生成图片', 'warning')
        return
      }

      const normalizedCameraControl = normalizeImageCameraControl(cameraControl)
      const normalizedLightingRig = normalizeImageLightingRig(lightingRig)
      const shouldPersistCamera = hasActiveImageCameraControl(normalizedCameraControl)
      const shouldPersistLighting = hasActiveImageLightingRig(normalizedLightingRig)

      if (!shouldPersistCamera && !shouldPersistLighting) {
        toast('请先启用角度或灯光控制', 'warning')
        return
      }

      const stateBefore = useRFStore.getState()
      const beforeIds = new Set(stateBefore.nodes.map((node) => node.id))
      const sourceDataRecord = data as Record<string, unknown>
      const nextImageEditSize = normalizeImageEditSize(
        kind === 'imageEdit'
          ? (sourceDataRecord.imageEditSize ?? sourceDataRecord.size)
          : imageEditSize,
      )
      const nextImageEditAspect = toAspectRatioFromImageEditSize(nextImageEditSize)
      const fallbackModel = getDefaultModel('imageEdit')
      const editableModel = String(imageModel || fallbackModel).trim() || fallbackModel

      addNode('taskNode', undefined, {
        kind: 'imageEdit',
        prompt: prompt.trim(),
        aspect: nextImageEditAspect,
        sampleCount,
        imageModel: editableModel,
        imageModelVendor: null,
        imageEditSize: nextImageEditSize,
        size: nextImageEditSize,
        referenceImages: [normalizedBaseImageUrl],
        ...(Array.isArray(sourceDataRecord.anchorBindings) ? { anchorBindings: sourceDataRecord.anchorBindings } : null),
        ...(Array.isArray(sourceDataRecord.assetInputs) ? { assetInputs: sourceDataRecord.assetInputs } : null),
        ...(shouldPersistCamera ? { imageCameraControl: normalizedCameraControl } : null),
        ...(shouldPersistLighting ? { imageLightingRig: normalizedLightingRig } : null),
      })

      const afterAdd = useRFStore.getState()
      const newNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
      if (!newNode) {
        toast('图片编辑配置已生成，但未能创建新节点', 'error')
        return
      }

      const sourceNode = afterAdd.nodes.find((node) => node.id === id)
      const targetPos = {
        x: (sourceNode?.position?.x || 0) + 380,
        y: sourceNode?.position?.y || 0,
      }
      afterAdd.onNodesChange([
        { id: newNode.id, type: 'position', position: targetPos, dragging: false },
        { id: newNode.id, type: 'select', selected: true },
      ])
      afterAdd.onConnect({
        source: id,
        sourceHandle: 'out-image',
        target: newNode.id,
        targetHandle: 'in-image',
      })

      runNodeDagToTarget(newNode.id, useRFStore.getState, useRFStore.setState, { concurrency: 1 }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '新图片编辑生成启动失败'
        console.error('auto run image view edit failed', error)
        toast(message, 'error')
      })
    },
    [addNode, basePoseImage, data, id, imageEditSize, imageModel, kind, prompt, sampleCount],
  )
  const { openCameraEditor, openLightingEditor, modal: imageViewEditorModal } = useImageViewEditor({
    baseImageUrl: basePoseImage,
    cameraControl: (data as Record<string, unknown>)?.imageCameraControl,
    lightingRig: (data as Record<string, unknown>)?.imageLightingRig,
    hasImages: imageResults.length > 0,
    isDarkUi,
    inlineDividerColor,
    onApply: handleApplyImageViewEdit,
  })
  const existingModelVendor = (data as any)?.modelVendor
  const existingVideoVendor = (data as any)?.videoModelVendor
  const resolvedVideoVendor = React.useMemo(() => {
    if (existingVideoVendor) return existingVideoVendor
    return findVendorForModel(videoModel)
  }, [existingVideoVendor, findVendorForModel, videoModel])
  const selectedVideoModelOption = React.useMemo(() => {
    if (!isVideoNode) return null
    return selectedActiveModelOption
  }, [isVideoNode, selectedActiveModelOption])
  const selectedImageModelOption = React.useMemo(() => {
    if (isVideoNode) return null
    return selectedActiveModelOption
  }, [isVideoNode, selectedActiveModelOption])
  const selectedVideoModelMeta = React.useMemo(() => {
    if (!selectedVideoModelOption || !('meta' in selectedVideoModelOption)) return undefined
    return selectedVideoModelOption.meta
  }, [selectedVideoModelOption])
  const selectedImageModelMeta = React.useMemo(() => {
    if (!selectedImageModelOption || !('meta' in selectedImageModelOption)) return undefined
    return selectedImageModelOption.meta
  }, [selectedImageModelOption])
  const imageModelConfig = React.useMemo(
    () => parseImageModelCatalogConfig(selectedImageModelMeta),
    [selectedImageModelMeta],
  )
  const videoModelConfig = React.useMemo(
    () => parseVideoModelCatalogConfig(selectedVideoModelMeta),
    [selectedVideoModelMeta],
  )
  const configuredImageAspectOptions = React.useMemo(
    () =>
      (imageModelConfig?.aspectRatioOptions || []).map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [imageModelConfig],
  )
  const configuredImageSizeOptions = React.useMemo(
    () =>
      (imageModelConfig?.imageSizeOptions || []).map((option) => ({
        value: option.value,
        label: formatVideoOptionLabel(option.label, option.priceLabel),
      })),
    [imageModelConfig],
  )
  const configuredImageResolutionOptions = React.useMemo(
    () =>
      (imageModelConfig?.resolutionOptions || []).map((option) => ({
        value: option.value,
        label: formatImageResolutionOptionLabel(option.label, option.value, option.priceLabel),
      })),
    [imageModelConfig],
  )
  const effectiveVideoResolution = React.useMemo(
    () => pickVideoResolutionValue(videoModelConfig, videoResolution) || videoResolution,
    [videoModelConfig, videoResolution],
  )
  const configuredDurationOptions = React.useMemo(
    () =>
      (videoModelConfig?.durationOptions || []).map((option) => ({
        value: String(option.value),
        label: formatVideoOptionLabel(option.label, option.priceLabel),
      })),
    [videoModelConfig],
  )
  const configuredSizeOptions = React.useMemo(
    () =>
      (videoModelConfig?.sizeOptions || []).map((option) => ({
        value: option.value,
        label: formatVideoOptionLabel(option.label, option.priceLabel),
      })),
    [videoModelConfig],
  )
  const configuredVideoResolutionOptions = React.useMemo(
    () =>
      (videoModelConfig?.resolutionOptions || []).map((option) => ({
        value: option.value,
        label: formatVideoOptionLabel(option.label, option.priceLabel),
      })),
    [videoModelConfig],
  )
  const isImageEditNode = kind === 'imageEdit'
  const imageEditSizeOption = React.useMemo(
    () => resolveImageEditSizeOption(imageEditSize),
    [imageEditSize],
  )
  const imageEditPreview = React.useMemo(
    () =>
      isImageEditNode
        ? {
            label: imageEditSizeOption.value,
            width: imageEditSizeOption.width,
            height: imageEditSizeOption.height,
          }
        : null,
    [imageEditSizeOption.height, imageEditSizeOption.value, imageEditSizeOption.width, isImageEditNode],
  )
  const imageEditResolutionOptions = React.useMemo(
    () =>
      IMAGE_EDIT_SIZE_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [],
  )
  const configuredOrientationOptions = React.useMemo(
    () => (videoModelConfig?.orientationOptions || []).map((option) => ({ value: option.value, label: option.label })),
    [videoModelConfig],
  )
  const selectedConfiguredDurationOption = React.useMemo(
    () => configuredDurationOptions.find((option) => Number(option.value) === videoDuration) || null,
    [configuredDurationOptions, videoDuration],
  )
  const selectedConfiguredSizeOption = React.useMemo(
    () => configuredSizeOptions.find((option) => option.value === videoSize) || null,
    [configuredSizeOptions, videoSize],
  )
  const selectedConfiguredResolutionOption = React.useMemo(
    () =>
      configuredVideoResolutionOptions.find((option) => option.value === effectiveVideoResolution) || null,
    [configuredVideoResolutionOptions, effectiveVideoResolution],
  )
  const selectedConfiguredImageAspectOption = React.useMemo(
    () => configuredImageAspectOptions.find((option) => option.value === aspect) || null,
    [aspect, configuredImageAspectOptions],
  )
  const selectedConfiguredImageSizeOption = React.useMemo(
    () => configuredImageSizeOptions.find((option) => option.value === imageSize) || null,
    [configuredImageSizeOptions, imageSize],
  )
  const selectedConfiguredImageResolutionOption = React.useMemo(
    () => configuredImageResolutionOptions.find((option) => option.value === imageResolution) || null,
    [configuredImageResolutionOptions, imageResolution],
  )
  const imageSizeMatchesResolutionOptions = React.useMemo(() => {
    if (!configuredImageSizeOptions.length || !configuredImageResolutionOptions.length) {
      return false
    }
    if (configuredImageSizeOptions.length !== configuredImageResolutionOptions.length) {
      return false
    }
    return configuredImageSizeOptions.every((option, index) => {
      const resolutionOption = configuredImageResolutionOptions[index]
      return (
        resolutionOption?.value === option.value &&
        resolutionOption.label === option.label
      )
    })
  }, [configuredImageResolutionOptions, configuredImageSizeOptions])
  const videoSpecKey = React.useMemo(
    () => buildVideoBillingSpecKey(effectiveVideoResolution, videoDuration),
    [effectiveVideoResolution, videoDuration],
  )
  const [editingShotSourceIndex, setEditingShotSourceIndex] = React.useState<number | null>(null)
  const editingShotSourceIndexRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    editingShotSourceIndexRef.current = editingShotSourceIndex
  }, [editingShotSourceIndex])
  const handlePoseSaved = React.useCallback(
    ({ mode, poseStickmanUrl: stickmanUrl, poseReferenceImages: refs, baseImageUrl, maskUrl, prompt: posePrompt, imageEditSize: nextImageEditSizeRaw, resizedImageUrl }: { mode: 'pose' | 'depth' | 'size'; poseStickmanUrl: string | null; poseReferenceImages: string[]; baseImageUrl: string; maskUrl?: string | null; prompt?: string; imageEditSize?: string; resizedImageUrl?: string | null }) => {
      const normalizedBaseImageUrl = String(baseImageUrl || '').trim()
      const normalizedRefs = Array.from(
        new Set(
          [
            normalizedBaseImageUrl,
            ...(refs || []).map((x) => String(x || '').trim()),
          ].filter(Boolean),
        ),
      )
      const effectivePrompt = (posePrompt || prompt || (data as any)?.prompt || '').trim()
      const normalizedMaskGuideUrl = mode === 'depth' ? String(maskUrl || '').trim() : ''
      const normalizedEditRefs = normalizedMaskGuideUrl
        ? [...normalizedRefs.filter((url) => url !== normalizedMaskGuideUrl).slice(0, 7), normalizedMaskGuideUrl]
        : normalizedRefs.slice(0, 8)
      const imageEditPrompt = appendImageEditFocusGuidePrompt(
        effectivePrompt || '保持原构图，修复不合理细节并提升质量',
        Boolean(normalizedMaskGuideUrl),
      )
      const nextImageEditSize = normalizeImageEditSize(nextImageEditSizeRaw || imageEditSize)
      const nextImageEditAspect = toAspectRatioFromImageEditSize(nextImageEditSize)
      const nextImageEditDimensions = parseImageEditSizeDimensions(nextImageEditSize)
      const normalizedResizedImageUrl = String(resizedImageUrl || '').trim()
      const sourceTag = String((data as any)?.source || '').toLowerCase()
      const hasStoryboardMarkers =
        typeof (data as any)?.storyboardCount === 'number' ||
        (Array.isArray((data as any)?.storyboardShotPrompts) && (data as any).storyboardShotPrompts.length > 0) ||
        /storyboard/i.test(sourceTag) ||
        Number.isFinite(Number((data as any)?.storyboardChunkIndex)) ||
        Number.isFinite(Number((data as any)?.storyboardShotStart))
      const isInsideNovelStoryboardGroup = (() => {
        const state = useRFStore.getState()
        const self = state.nodes.find((n) => n.id === id) as any
        const parentId = String(self?.parentId || '').trim()
        if (!parentId) return false
        const parent = state.nodes.find((n) => n.id === parentId) as any
        return String(parent?.data?.groupKind || '').trim() === 'novel_storyboard_chapter'
      })()
      const requestedTargetIndex =
        typeof editingShotSourceIndexRef.current === 'number' && editingShotSourceIndexRef.current >= 0
          ? editingShotSourceIndexRef.current
          : (typeof (data as any)?.imagePrimaryIndex === 'number' && (data as any).imagePrimaryIndex >= 0
              ? (data as any).imagePrimaryIndex
              : 0)
      const shouldOverwriteInPlace =
        kind === 'novelStoryboard' ||
        kind === 'storyboardImage' ||
        kind === 'storyboardShot' ||
        typeof editingShotSourceIndexRef.current === 'number' ||
        hasStoryboardMarkers ||
        isInsideNovelStoryboardGroup

      if (mode === 'size' && shouldOverwriteInPlace) {
        if (!normalizedResizedImageUrl) {
          toast('尺寸调整失败：未返回新图地址', 'error')
          return
        }
        const currentResults = Array.isArray((data as any)?.imageResults) ? ([...(data as any).imageResults] as any[]) : []
        const resolvedTargetIndex = currentResults[requestedTargetIndex]
          ? requestedTargetIndex
          : (typeof (data as any)?.imagePrimaryIndex === 'number' && currentResults[(data as any).imagePrimaryIndex]
              ? (data as any).imagePrimaryIndex
              : 0)
        const prev = currentResults[resolvedTargetIndex] || {}
        if (currentResults.length > 0) {
          currentResults[resolvedTargetIndex] = { ...prev, url: normalizedResizedImageUrl }
        } else {
          currentResults.push({ url: normalizedResizedImageUrl })
        }
        updateNodeData(id, {
          imageResults: currentResults,
          imageUrl: normalizedResizedImageUrl,
          imagePrimaryIndex: resolvedTargetIndex,
          imageEditSize: nextImageEditSize,
          size: nextImageEditSize,
          aspect: nextImageEditAspect,
        })
        toast(`镜头 ${resolvedTargetIndex + 1} 已按 ${nextImageEditSize} 尺寸更新`, 'success')
        return
      }

      if (shouldOverwriteInPlace) {
        const run = async () => {
          try {
            const ui = useUIStore.getState()
            const apiKey = (ui.publicApiKey || '').trim()
            const token = getAuthToken()
            if (!apiKey && !token) {
              toast('请先登录后再试', 'error')
              return
            }
            const persist = ui.assetPersistenceEnabled
            const resolvedImageModel = await resolveExecutableImageModel({
              kind: 'imageEdit',
              value: imageModel,
            })
            const modelKey = resolvedImageModel.value
            if (resolvedImageModel.shouldWriteBack) {
              setImageModel(modelKey)
              updateNodeData(id, {
                imageModel: modelKey,
                imageModelVendor: null,
              })
            }
            const aspectRatio = nextImageEditAspect || normalizeImageAspect((data as any)?.aspect)
            let effectiveEditReferenceImages = normalizedEditRefs
            let referenceSheetMeta: Record<string, unknown> | null = null
            const { nodes, edges } = useRFStore.getState()
            const runtimeReferenceAssetInputs = mergeReferenceAssetInputs({
              assetInputs: (data as Record<string, unknown>)?.assetInputs,
              dynamicEntries: collectDynamicUpstreamReferenceEntriesForNode(nodes, edges, id),
              referenceImages: effectiveEditReferenceImages,
              limit: 8,
            })
            if (normalizedEditRefs.length > 2) {
              try {
                const mergedReferenceSheet = await uploadMergedReferenceSheet({
                  id,
                  entries: buildNamedReferenceEntries({
                    assetInputs: runtimeReferenceAssetInputs,
                    referenceImages: normalizedEditRefs,
                    fallbackPrefix: 'ref',
                    limit: 8,
                  }),
                  prompt: imageEditPrompt,
                  vendor: resolvedImageModel.vendor || 'auto',
                  modelKey,
                  taskKind: 'image_edit',
                })
                if (mergedReferenceSheet) {
                  effectiveEditReferenceImages = [mergedReferenceSheet.url]
                  referenceSheetMeta = {
                    kind: 'collage',
                    url: mergedReferenceSheet.url,
                    sourceUrls: mergedReferenceSheet.sourceUrls,
                    entries: mergedReferenceSheet.entries.map((entry) => ({
                      id: entry.label,
                      sourceUrl: entry.sourceUrl,
                      ...(entry.assetId ? { assetId: entry.assetId } : null),
                      ...(entry.note ? { note: entry.note } : null),
                    })),
                  }
                }
              } catch (error) {
                console.warn('[TaskNode] merge image edit references failed', error)
              }
            }
            const effectiveEditAssetInputs = mergeReferenceAssetInputs({
              assetInputs: runtimeReferenceAssetInputs,
              dynamicEntries: collectDynamicUpstreamReferenceEntriesForNode(nodes, edges, id),
              referenceImages: effectiveEditReferenceImages,
              limit: 8,
            })
            const internalImageEditPrompt = appendReferenceAliasSlotPrompt({
              prompt: imageEditPrompt,
              assetInputs: effectiveEditAssetInputs,
              referenceImages: effectiveEditReferenceImages,
              enabled: effectiveEditReferenceImages.length > 0 && !referenceSheetMeta,
            })
            let nextUrl = ''

            if (!nextUrl) {
              const taskRes = await runPublicTask(apiKey, {
                request: {
                  kind: 'image_edit',
                  prompt: internalImageEditPrompt,
                  ...nextImageEditDimensions,
                  extras: {
                    nodeKind: kind,
                    nodeId: id,
                    modelKey,
                    aspectRatio,
                    imageEditSize: nextImageEditSize,
                    size: nextImageEditSize,
                    resolution: nextImageEditSize,
                    image_size: nextImageEditSize,
                    referenceImages: effectiveEditReferenceImages,
                    ...(effectiveEditAssetInputs.length ? { assetInputs: effectiveEditAssetInputs } : {}),
                    ...(referenceSheetMeta ? { referenceSheet: referenceSheetMeta } : {}),
                    persistAssets: persist,
                  },
                },
              })

              let result = taskRes.result
              const taskId = String(result?.id || '').trim()
              if ((result.status === 'queued' || result.status === 'running') && taskId) {
                for (let i = 0; i < 24; i += 1) {
                  await new Promise((r) => window.setTimeout(r, 1500))
                  const polled = await fetchPublicTaskResult(apiKey, {
                    taskId,
                    vendor: taskRes.vendor,
                    taskKind: 'image_edit',
                    prompt: internalImageEditPrompt,
                  })
                  result = polled.result
                  if (result.status === 'succeeded' || result.status === 'failed') break
                }
              }

              if (result.status !== 'succeeded') {
                throw new Error('单镜头微调失败：任务未成功完成')
              }
              const imageAsset =
                (Array.isArray(result.assets) ? result.assets.find((a) => a.type === 'image' && a.url) : null) ||
                (Array.isArray(result.assets) ? result.assets.find((a) => !!a?.url) : null) ||
                null
              nextUrl = typeof imageAsset?.url === 'string' ? imageAsset.url.trim() : ''
            }
            if (!nextUrl) {
              throw new Error('单镜头微调失败：未返回图片地址')
            }

            const currentResults = Array.isArray((data as any)?.imageResults) ? ([...(data as any).imageResults] as any[]) : []
            const resolvedTargetIndex = currentResults[requestedTargetIndex]
              ? requestedTargetIndex
              : (typeof (data as any)?.imagePrimaryIndex === 'number' && currentResults[(data as any).imagePrimaryIndex]
                  ? (data as any).imagePrimaryIndex
                  : 0)
            const prev = currentResults[resolvedTargetIndex] || {}
            const nowIso = new Date().toISOString()
            const previousUrl = String(prev?.url || '').trim()
            type StoryboardShotCandidate = {
              url: string
              selected: boolean
              createdAt: string
              source: 'generated' | 'edited'
            }
            type StoryboardShotCandidateBucket = {
              sourceIndex: number
              candidates: StoryboardShotCandidate[]
            }
            const rawBuckets = Array.isArray((data as any)?.storyboardShotCandidates)
              ? ((data as any).storyboardShotCandidates as unknown[])
              : []
            const nextBuckets: StoryboardShotCandidateBucket[] = rawBuckets
              .map((entry) => {
                if (!entry || typeof entry !== 'object') return null
                const parsed = entry as { sourceIndex?: unknown; candidates?: unknown }
                const sourceIndexRaw = Number(parsed.sourceIndex)
                if (!Number.isFinite(sourceIndexRaw) || sourceIndexRaw < 0) return null
                const sourceIndex = Math.trunc(sourceIndexRaw)
                const candidatesRaw = Array.isArray(parsed.candidates) ? parsed.candidates : []
                const candidates: StoryboardShotCandidate[] = candidatesRaw
                  .map((candidate) => {
                    if (!candidate || typeof candidate !== 'object') return null
                    const item = candidate as { url?: unknown; selected?: unknown; createdAt?: unknown; source?: unknown }
                    const url = String(item.url || '').trim()
                    if (!url) return null
                    const source = String(item.source || '').trim().toLowerCase() === 'edited' ? 'edited' : 'generated'
                    return {
                      url,
                      selected: item.selected === true,
                      createdAt: String(item.createdAt || '').trim() || nowIso,
                      source,
                    }
                  })
                  .filter((candidate): candidate is StoryboardShotCandidate => Boolean(candidate))
                return { sourceIndex, candidates }
              })
              .filter((bucket): bucket is StoryboardShotCandidateBucket => Boolean(bucket))
              .slice(0, 200)

            const bucketIdx = nextBuckets.findIndex((bucket) => bucket.sourceIndex === resolvedTargetIndex)
            const fallbackCandidates = previousUrl
              ? [{ url: previousUrl, selected: true, createdAt: nowIso, source: 'generated' as const }]
              : []
            const bucket: StoryboardShotCandidateBucket = bucketIdx >= 0
              ? nextBuckets[bucketIdx]
              : { sourceIndex: resolvedTargetIndex, candidates: fallbackCandidates }
            const deselected = bucket.candidates.map((candidate) => ({ ...candidate, selected: false }))
            const existingCandidateIndex = deselected.findIndex((candidate) => candidate.url === nextUrl)
            if (existingCandidateIndex >= 0) {
              deselected[existingCandidateIndex] = { ...deselected[existingCandidateIndex], selected: true }
            } else {
              deselected.push({
                url: nextUrl,
                selected: true,
                createdAt: nowIso,
                source: 'edited',
              })
            }
            const nextBucket: StoryboardShotCandidateBucket = {
              sourceIndex: resolvedTargetIndex,
              candidates: deselected.slice(-30),
            }
            if (bucketIdx >= 0) nextBuckets[bucketIdx] = nextBucket
            else nextBuckets.push(nextBucket)

            const rawSelectionHistory = Array.isArray((data as any)?.storyboardSelectionHistory)
              ? ((data as any).storyboardSelectionHistory as unknown[])
              : []
            const nextSelectionHistory = [
              ...rawSelectionHistory,
              {
                sourceIndex: resolvedTargetIndex,
                imageUrl: nextUrl,
                selectedAt: nowIso,
                source: 'edited',
              },
            ].slice(-500)
            if (currentResults.length > 0) {
              currentResults[resolvedTargetIndex] = { ...prev, url: nextUrl }
            } else {
              currentResults.push({ url: nextUrl })
            }
            const currentPrimary = typeof (data as any)?.imagePrimaryIndex === 'number' ? (data as any).imagePrimaryIndex : 0
            updateNodeData(id, {
              imageResults: currentResults,
              ...(currentPrimary === resolvedTargetIndex || !((data as any)?.imageUrl)
                ? { imageUrl: nextUrl, imagePrimaryIndex: resolvedTargetIndex }
                : {}),
              storyboardShotCandidates: nextBuckets,
              storyboardSelectionHistory: nextSelectionHistory,
              poseStickmanUrl: stickmanUrl || null,
              poseReferenceImages: normalizedRefs,
              poseMaskUrl: normalizedMaskGuideUrl || null,
              ...(effectivePrompt ? { prompt: effectivePrompt } : {}),
              imageEditSize: nextImageEditSize,
              size: nextImageEditSize,
              aspect: nextImageEditAspect,
            })
            toast(`镜头 ${resolvedTargetIndex + 1} 已更新（覆盖当前节点）`, 'success')
          } catch (err: any) {
            toast(err?.message || '单镜头更新失败', 'error')
          } finally {
            editingShotSourceIndexRef.current = null
            setEditingShotSourceIndex(null)
          }
        }
        void run()
        return
      }

      const stateBefore = useRFStore.getState()
      const beforeIds = new Set(stateBefore.nodes.map((n) => n.id))
      if (mode === 'size') {
        if (!normalizedResizedImageUrl) {
          toast('尺寸调整失败：未返回新图地址', 'error')
          return
        }
        const stateBefore = useRFStore.getState()
        const beforeIds = new Set(stateBefore.nodes.map((n) => n.id))
        addNode('taskNode', undefined, {
          kind: 'image',
          prompt: effectivePrompt,
          aspect: nextImageEditAspect,
          sampleCount: 1,
          imageUrl: normalizedResizedImageUrl,
          imageResults: [{ url: normalizedResizedImageUrl }],
          imagePrimaryIndex: 0,
          imageModel: String(imageModel || getDefaultModel('image')).trim() || getDefaultModel('image'),
          imageModelVendor: null,
          imageEditSize: nextImageEditSize,
          size: nextImageEditSize,
        })
        const afterAdd = useRFStore.getState()
        const newNode = afterAdd.nodes.find((n) => !beforeIds.has(n.id))
        if (!newNode) {
          toast('尺寸调整已完成，但未能创建新图像节点', 'error')
          return
        }
        const sourceNode = afterAdd.nodes.find((n) => n.id === id)
        const targetPos = {
          x: (sourceNode?.position?.x || 0) + 380,
          y: sourceNode?.position?.y || 0,
        }
        afterAdd.onNodesChange([
          { id: newNode.id, type: 'position', position: targetPos, dragging: false },
          { id: newNode.id, type: 'select', selected: true },
        ])
        afterAdd.onConnect({
          source: id,
          sourceHandle: 'out-image',
          target: newNode.id,
          targetHandle: 'in-image',
        })
        toast(`已生成 ${nextImageEditSize} 新图`, 'success')
        return
      }

      const targetKind = 'imageEdit'
      const fallbackModel = getDefaultModel('imageEdit')
      const editableModel = String(imageModel || fallbackModel).trim() || fallbackModel

      addNode('taskNode', undefined, {
        kind: targetKind,
        prompt: effectivePrompt,
        aspect: nextImageEditAspect,
        sampleCount,
        imageModel: editableModel,
        imageModelVendor: null,
        imageEditSize: nextImageEditSize,
        size: nextImageEditSize,
        poseStickmanUrl: stickmanUrl || null,
        poseReferenceImages: normalizedRefs.slice(0, 8),
        poseMaskUrl: normalizedMaskGuideUrl || null,
      })

      const afterAdd = useRFStore.getState()
      const newNode = afterAdd.nodes.find((n) => !beforeIds.has(n.id))
      if (!newNode) {
        toast('图片编辑已保存，但未能创建新图像节点', 'error')
        return
      }

      const sourceNode = afterAdd.nodes.find((n) => n.id === id)
      const targetPos = {
        x: (sourceNode?.position?.x || 0) + 380,
        y: sourceNode?.position?.y || 0,
      }
      afterAdd.onNodesChange([
        { id: newNode.id, type: 'position', position: targetPos, dragging: false },
        { id: newNode.id, type: 'select', selected: true },
      ])
      afterAdd.onConnect({
        source: id,
        sourceHandle: 'out-image',
        target: newNode.id,
        targetHandle: 'in-image',
      })

      if (!effectivePrompt) {
        toast('已创建新图片编辑节点，请填写提示词后再运行', 'info')
        return
      }

      runNodeDagToTarget(newNode.id, useRFStore.getState, useRFStore.setState, { concurrency: 1 }).catch((err) => {
        console.error('auto run pose image failed', err)
        toast(err?.message || '新图片编辑生成启动失败', 'error')
      })
    },
    [addNode, currentProject?.id, data, editingShotSourceIndex, findVendorForModel, id, imageEditSize, imageModel, kind, prompt, sampleCount, updateNodeData],
  )

  const { open: openPoseEditor, modal: poseEditorModal } = usePoseEditor({
    nodeId: id,
    baseImageUrl: basePoseImage,
    poseReferenceImages,
    poseStickmanUrl,
    promptValue: prompt,
    onPromptSave: (next) => {
      setPrompt(next)
      updateNodeData(id, { prompt: next })
    },
    imageEditSize,
    imageEditSizeOptions: imageEditResolutionOptions,
    onImageEditSizeChange: (next) => {
      const normalized = normalizeImageEditSize(next)
      setImageEditSize(normalized)
      updateNodeData(id, {
        imageEditSize: normalized,
        size: normalized,
        aspect: toAspectRatioFromImageEditSize(normalized),
      })
    },
    canvasResizeSize,
    onCanvasResizeSizeChange: (next) => {
      const normalized = normalizeCanvasResizeSize(next)
      setCanvasResizeSize(normalized)
      updateNodeData(id, { canvasResizeSize: normalized })
    },
    hasImages: imageResults.length > 0,
    isDarkUi,
    inlineDividerColor,
    updateNodeData,
    onPoseSaved: handlePoseSaved,
  })

  const [mosaicModalOpen, setMosaicModalOpen] = React.useState(false)
  const [mosaicInvalidUrls, setMosaicInvalidUrls] = React.useState<string[]>([])
  const [mosaicLayoutMode, setMosaicLayoutMode] = React.useState<'square' | 'columns'>(() => (
    (data as any)?.mosaicLayoutMode === 'columns' ? 'columns' : 'square'
  ))
  const [mosaicGrid, setMosaicGrid] = React.useState<number>(() => {
    const stored = (data as any)?.mosaicGrid
    return typeof stored === 'number' && stored >= 1 && stored <= 3 ? stored : 2
  })
  const [mosaicColumns, setMosaicColumns] = React.useState<number>(() => {
    const raw = Number((data as any)?.mosaicColumns)
    return Number.isFinite(raw) && raw >= 1 && raw <= 6 ? Math.trunc(raw) : 3
  })
  const [mosaicSelected, setMosaicSelected] = React.useState<string[]>(() => {
    const imgs = Array.isArray((data as any)?.mosaicImages)
      ? ((data as any)?.mosaicImages as any[]).map((i) => (typeof i?.url === 'string' ? i.url : null)).filter(Boolean)
      : []
    return imgs.length ? imgs.slice(0, 30) : []
  })
  const [mosaicCellSize, setMosaicCellSize] = React.useState<number>(() => {
    const raw = Number((data as any)?.mosaicCellSize)
    return Number.isFinite(raw) && raw >= 256 && raw <= 2048 ? Math.trunc(raw) : 480
  })
  const [mosaicDividerWidth, setMosaicDividerWidth] = React.useState<number>(() => {
    const raw = Number((data as any)?.mosaicDividerWidth)
    return Number.isFinite(raw) && raw >= 0 && raw <= 24 ? raw : 0
  })
  const [mosaicDividerColor, setMosaicDividerColor] = React.useState<string>(() => {
    const raw = String((data as any)?.mosaicDividerColor || '').trim()
    return raw || '#ffffff'
  })
  const [mosaicBackgroundColor, setMosaicBackgroundColor] = React.useState<string>(() => {
    const raw = String((data as any)?.mosaicBackgroundColor || '').trim()
    return raw || '#0b1224'
  })
  const [mosaicTitle, setMosaicTitle] = React.useState<string>(() => String((data as any)?.mosaicTitle || ''))
  const [mosaicSubtitle, setMosaicSubtitle] = React.useState<string>(() => String((data as any)?.mosaicSubtitle || ''))
  const [mosaicTitleColor, setMosaicTitleColor] = React.useState<string>(() => {
    const raw = String((data as any)?.mosaicTitleColor || '').trim()
    return raw || '#f8fafc'
  })
  const [mosaicSubtitleColor, setMosaicSubtitleColor] = React.useState<string>(() => {
    const raw = String((data as any)?.mosaicSubtitleColor || '').trim()
    return raw || '#cbd5e1'
  })
  const mosaicLimit = mosaicLayoutMode === 'columns' ? 30 : mosaicGrid * mosaicGrid
  const allImages = React.useMemo(() => {
    if (!isMosaicNode || !mosaicModalOpen) return []
    const urls: string[] = []
    const push = (url: unknown) => {
      if (typeof url !== 'string') return
      const trimmed = url.trim()
      if (trimmed) urls.push(trimmed)
    }
    const stateNodes = useRFStore.getState().nodes
    stateNodes.forEach((node) => {
      const nodeData = node.data || {}
      push((nodeData as any).imageUrl)
      if (Array.isArray((nodeData as any).imageResults)) {
        ;((nodeData as any).imageResults as Array<{ url?: unknown }>).forEach((item) => push(item?.url))
      }
    })
    return Array.from(new Set(urls))
  }, [isMosaicNode, mosaicModalOpen])
  const availableImages = React.useMemo(() => {
    const filtered = allImages.filter((url) => !mosaicInvalidUrls.includes(url))
    if (mosaicSelected.length) {
      const selectedSet = new Set(mosaicSelected)
      const rest = filtered.filter((url) => !selectedSet.has(url))
      return [...mosaicSelected, ...rest]
    }
    return filtered
  }, [allImages, mosaicInvalidUrls, mosaicSelected])
  const [mosaicPreviewUrl, setMosaicPreviewUrl] = React.useState<string | null>(null)
  const [mosaicPreviewError, setMosaicPreviewError] = React.useState<string | null>(null)
  const [mosaicPreviewLoading, setMosaicPreviewLoading] = React.useState(false)
  const buildMosaicPreview = React.useCallback(async (
    urls: string[],
    grid: number,
    options?: {
      cellSize?: number
      dividerWidth?: number
      dividerColor?: string
      layoutMode?: 'square' | 'columns'
      columns?: number
      backgroundColor?: string
      title?: string
      subtitle?: string
      titleColor?: string
      subtitleColor?: string
    },
  ) => {
    const { buildMosaicCanvas } = await import('../../runner/mosaicRunner')
    setMosaicPreviewLoading(true)
    setMosaicPreviewError(null)
    try {
      const { canvas, failedUrls } = await buildMosaicCanvas(urls, grid || 2, {
        cellSize: options?.cellSize,
        dividerWidth: options?.dividerWidth,
        dividerColor: options?.dividerColor,
        layoutMode: options?.layoutMode,
        columns: options?.columns,
        backgroundColor: options?.backgroundColor,
        title: options?.title,
        subtitle: options?.subtitle,
        titleColor: options?.titleColor,
        subtitleColor: options?.subtitleColor,
      })
      setMosaicPreviewUrl(canvas.toDataURL('image/png'))
      if (failedUrls.length) {
        setMosaicPreviewError(`已移除 ${failedUrls.length} 张过期或不可访问的图片`)
        setMosaicSelected((prev) => prev.filter((url) => !failedUrls.includes(url)))
        setMosaicInvalidUrls((prev) => Array.from(new Set([...prev, ...failedUrls])))
      }
    } catch (error: unknown) {
      console.warn('mosaic preview failed', error)
      setMosaicPreviewUrl(null)
      const failedUrls = Array.isArray((error as { failedUrls?: unknown })?.failedUrls)
        ? ((error as { failedUrls: string[] }).failedUrls)
        : []
      if (failedUrls.length) {
        setMosaicSelected((prev) => prev.filter((url) => !failedUrls.includes(url)))
        setMosaicInvalidUrls((prev) => Array.from(new Set([...prev, ...failedUrls])))
      }
      const message = error instanceof Error ? error.message : '预览生成失败，请检查图片是否可跨域访问'
      setMosaicPreviewError(message)
    } finally {
      setMosaicPreviewLoading(false)
    }
  }, [])
  const handleMosaicToggle = React.useCallback(
    (url: string, checked?: boolean) => {
      if (!url) return
      if (mosaicInvalidUrls.includes(url)) {
        toast('该图片已失效，请选择其他图片', 'error')
        return
      }
      setMosaicSelected((prev) => {
        const nextChecked = typeof checked === 'boolean' ? checked : !prev.includes(url)
        if (nextChecked) {
          if (prev.includes(url)) return prev
          const next = [...prev, url]
          if (next.length > mosaicLimit) return prev
          return next
        }
        return prev.filter((item) => item !== url)
      })
    },
    [mosaicInvalidUrls, mosaicLimit],
  )
  const moveMosaicItem = React.useCallback((url: string, dir: number) => {
    setMosaicSelected((prev) => {
      const idx = prev.findIndex((item) => item === url)
      if (idx < 0) return prev
      const nextIdx = idx + dir
      if (nextIdx < 0 || nextIdx >= prev.length) return prev
      const next = [...prev]
      const current = next[idx]
      next[idx] = next[nextIdx]
      next[nextIdx] = current
      return next
    })
  }, [])
  const handleMosaicSave = React.useCallback(async () => {
    const picked = mosaicSelected.slice(0, mosaicLimit)
    if (!picked.length) {
      toast('请至少选择 1 张图片', 'error')
      return
    }
    try {
      const { buildMosaicCanvas } = await import('../../runner/mosaicRunner')
      const result = await buildMosaicCanvas(picked, mosaicGrid, {
        cellSize: mosaicCellSize,
        dividerWidth: mosaicDividerWidth,
        dividerColor: mosaicDividerColor,
        layoutMode: mosaicLayoutMode,
        columns: mosaicColumns,
        backgroundColor: mosaicBackgroundColor,
        title: mosaicTitle,
        subtitle: mosaicSubtitle,
        titleColor: mosaicTitleColor,
        subtitleColor: mosaicSubtitleColor,
      })
      if (result.failedUrls.length) {
        setMosaicSelected((prev) => prev.filter((url) => !result.failedUrls.includes(url)))
        setMosaicInvalidUrls((prev) => Array.from(new Set([...prev, ...result.failedUrls])))
        toast(`已移除 ${result.failedUrls.length} 张过期图片，已用剩余图片拼图`, 'info')
      }
      const blob: Blob = await new Promise((resolve, reject) => {
        try {
          result.canvas.toBlob((canvasBlob) => {
            if (canvasBlob) resolve(canvasBlob)
            else reject(new Error('未生成拼图结果'))
          }, 'image/png')
        } catch (error) {
          reject(error)
        }
      })
      const fileName = `mosaic-${Date.now()}.png`
      const file = new File([blob], fileName, { type: 'image/png' })
      const hosted = await uploadServerAssetFile(file, fileName, { taskKind: 'mosaic' })
      const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
      if (!hostedUrl) throw new Error('拼图已生成，但上传到 OSS 失败')

      const existing = Array.isArray((data as any)?.imageResults) ? (data as any)?.imageResults : []
      const sanitizedExisting = existing.filter((item: unknown) => {
        const url = typeof (item as { url?: unknown })?.url === 'string' ? String((item as { url: string }).url).trim() : ''
        return Boolean(url) && REMOTE_IMAGE_URL_REGEX.test(url)
      })
      const merged = [...sanitizedExisting, { url: hostedUrl, title: mosaicTitle || '拼图' }]
      const primaryIndex = merged.length - 1
      setNodeStatus(id, 'success', {
        progress: 100,
        imageUrl: hostedUrl,
        imageResults: merged,
        imagePrimaryIndex: primaryIndex,
        serverAssetId: hosted.id,
        mosaicImages: picked.map((url) => ({ url })),
        mosaicGrid,
        mosaicColumns,
        mosaicLimit,
        mosaicLayoutMode,
        mosaicCellSize,
        mosaicDividerWidth,
        mosaicDividerColor,
        mosaicBackgroundColor,
        mosaicTitle,
        mosaicSubtitle,
        mosaicTitleColor,
        mosaicSubtitleColor,
        lastResult: {
          id,
          at: Date.now(),
          kind: 'mosaic',
          preview: { type: 'image', src: hostedUrl },
        },
      })
      setMosaicModalOpen(false)
      toast('拼图已更新', 'success')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '拼图生成失败'
      toast(message, 'error')
    }
  }, [
    data,
    id,
    mosaicBackgroundColor,
    mosaicCellSize,
    mosaicColumns,
    mosaicDividerColor,
    mosaicDividerWidth,
    mosaicGrid,
    mosaicLayoutMode,
    mosaicLimit,
    mosaicSelected,
    mosaicSubtitle,
    mosaicSubtitleColor,
    mosaicTitle,
    mosaicTitleColor,
    setNodeStatus,
  ])

  React.useEffect(() => {
    const picked = mosaicSelected.slice(0, mosaicLimit)
    if (!picked.length) {
      setMosaicPreviewUrl(null)
      setMosaicPreviewError(null)
      return
    }
    buildMosaicPreview(picked, mosaicGrid, {
      cellSize: mosaicCellSize,
      dividerWidth: mosaicDividerWidth,
      dividerColor: mosaicDividerColor,
      layoutMode: mosaicLayoutMode,
      columns: mosaicColumns,
      backgroundColor: mosaicBackgroundColor,
      title: mosaicTitle,
      subtitle: mosaicSubtitle,
      titleColor: mosaicTitleColor,
      subtitleColor: mosaicSubtitleColor,
    })
  }, [
    buildMosaicPreview,
    mosaicBackgroundColor,
    mosaicCellSize,
    mosaicColumns,
    mosaicDividerColor,
    mosaicDividerWidth,
    mosaicGrid,
    mosaicLayoutMode,
    mosaicLimit,
    mosaicSelected,
    mosaicSubtitle,
    mosaicSubtitleColor,
    mosaicTitle,
    mosaicTitleColor,
  ])
  React.useEffect(() => {
    setMosaicSelected((prev) => prev.slice(0, mosaicLimit))
  }, [mosaicLimit])

  React.useEffect(() => {
    if (!mosaicModalOpen) return
    setMosaicLayoutMode((data as any)?.mosaicLayoutMode === 'columns' ? 'columns' : 'square')
    const storedGrid = (data as any)?.mosaicGrid
    setMosaicGrid(typeof storedGrid === 'number' && storedGrid >= 1 && storedGrid <= 3 ? storedGrid : 2)
    const storedColumns = Number((data as any)?.mosaicColumns)
    setMosaicColumns(Number.isFinite(storedColumns) && storedColumns >= 1 && storedColumns <= 6 ? Math.trunc(storedColumns) : 3)
    const storedCellSize = Number((data as any)?.mosaicCellSize)
    setMosaicCellSize(Number.isFinite(storedCellSize) && storedCellSize >= 256 && storedCellSize <= 2048 ? Math.trunc(storedCellSize) : 480)
    const storedDividerWidth = Number((data as any)?.mosaicDividerWidth)
    setMosaicDividerWidth(Number.isFinite(storedDividerWidth) && storedDividerWidth >= 0 && storedDividerWidth <= 24 ? storedDividerWidth : 0)
    const storedDividerColor = String((data as any)?.mosaicDividerColor || '').trim()
    setMosaicDividerColor(storedDividerColor || '#ffffff')
    const storedBackgroundColor = String((data as any)?.mosaicBackgroundColor || '').trim()
    setMosaicBackgroundColor(storedBackgroundColor || '#0b1224')
    setMosaicTitle(String((data as any)?.mosaicTitle || ''))
    setMosaicSubtitle(String((data as any)?.mosaicSubtitle || ''))
    const storedTitleColor = String((data as any)?.mosaicTitleColor || '').trim()
    setMosaicTitleColor(storedTitleColor || '#f8fafc')
    const storedSubtitleColor = String((data as any)?.mosaicSubtitleColor || '').trim()
    setMosaicSubtitleColor(storedSubtitleColor || '#cbd5e1')
    const imgs = Array.isArray((data as any)?.mosaicImages)
      ? ((data as any)?.mosaicImages as any[]).map((i) => (typeof i?.url === 'string' ? i.url : null)).filter(Boolean)
      : []
    if (imgs.length) {
      setMosaicSelected(imgs.slice(0, (data as any)?.mosaicLayoutMode === 'columns' ? 30 : ((typeof storedGrid === 'number' && storedGrid >= 1 && storedGrid <= 3 ? storedGrid : 2) ** 2)))
    }
  }, [data, mosaicModalOpen])

  const rewriteModelOptions = useModelOptions('text')
  const rewriteModelSelectOptions = React.useMemo<ModelOption[]>(
    () => rewriteModelOptions.map((option) => ({
      ...option,
      label: getTaskNodeModelDisplayLabel(option),
    })),
    [rewriteModelOptions],
  )
  const resolvePromptRefineModelAlias = React.useCallback(() => {
    const candidates = [
      String((data as any)?.geminiModel || '').trim(),
      String(modelKey || '').trim(),
    ].filter(Boolean)
    for (const candidate of candidates) {
      const matched = findModelOptionByIdentifier(rewriteModelOptions, candidate)
      if (!matched) continue
      const resolved = getModelOptionRequestAlias(rewriteModelOptions, matched.value)
      if (resolved) return resolved
    }
    const firstTextModel = rewriteModelOptions.find((opt) => typeof opt?.value === 'string' && opt.value.trim())
    return getModelOptionRequestAlias(rewriteModelOptions, firstTextModel?.value) || ''
  }, [data, modelKey, rewriteModelOptions])
  const refineStructuredPromptFromText = React.useCallback(async (basePrompt?: string) => {
    const nextPrompt = typeof basePrompt === 'string' ? basePrompt.trim() : prompt.trim()
    if (!nextPrompt) {
      throw new Error('请先输入提示词，再切到 JSON 模式')
    }

    return refineStructuredImagePrompt({
      prompt: nextPrompt,
      negativePrompt: String((data as Record<string, unknown>)?.negativePrompt || '').trim(),
      systemPrompt,
      modelAlias: resolvePromptRefineModelAlias(),
      productionMetadata: (data as Record<string, unknown>)?.productionMetadata,
    })
  }, [data, prompt, resolvePromptRefineModelAlias, systemPrompt])
  const handleCommitStructuredPrompt = React.useCallback((patch: {
    structuredPrompt: Record<string, unknown>
    prompt: string
  }) => {
    setPrompt(patch.prompt)
    updateNodeData(id, {
      structuredPrompt: patch.structuredPrompt,
      prompt: patch.prompt,
      promptEditorMode: 'structured',
    })
  }, [id, updateNodeData])
  const handleEnableStructuredPromptMode = React.useCallback(async () => {
    if (!canUseStructuredPromptEditor || structuredPromptRefineLoading) return

    const currentPrompt = prompt.trim()
    const existingCompiledPrompt = structuredPromptValue
      ? resolveCompiledImagePrompt({
        structuredPrompt: structuredPromptValue,
        promptEditorMode: 'structured',
      }).trim()
      : ''

    if (!currentPrompt && existingCompiledPrompt) {
      setPrompt(existingCompiledPrompt)
      updateNodeData(id, {
        structuredPrompt: structuredPromptValue,
        prompt: existingCompiledPrompt,
        promptEditorMode: 'structured',
      })
      return
    }

    if (!currentPrompt) {
      toast('请先输入提示词，再切到 JSON 模式', 'warning')
      return
    }

    if (
      structuredPromptValue &&
      existingCompiledPrompt &&
      existingCompiledPrompt === currentPrompt
    ) {
      updateNodeData(id, {
        structuredPrompt: structuredPromptValue,
        prompt: existingCompiledPrompt,
        promptEditorMode: 'structured',
      })
      return
    }

    try {
      setStructuredPromptRefineLoading(true)
      const nextStructuredPrompt = await refineStructuredPromptFromText(currentPrompt)
      const nextCompiledPrompt = resolveCompiledImagePrompt({
        structuredPrompt: nextStructuredPrompt,
        promptEditorMode: 'structured',
      }).trim()
      setPrompt(nextCompiledPrompt)
      updateNodeData(id, {
        structuredPrompt: nextStructuredPrompt,
        prompt: nextCompiledPrompt,
        promptEditorMode: 'structured',
      })
      toast('已切换为 JSON 提示词模式', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成结构化 JSON 失败'
      toast(message, 'error')
    } finally {
      setStructuredPromptRefineLoading(false)
    }
  }, [
    canUseStructuredPromptEditor,
    id,
    prompt,
    refineStructuredPromptFromText,
    structuredPromptRefineLoading,
    structuredPromptValue,
    updateNodeData,
  ])
  const handleStructuredPromptModeChange = React.useCallback((next: boolean) => {
    if (next) {
      void handleEnableStructuredPromptMode()
      return
    }
    updateNodeData(id, { promptEditorMode: 'text' })
  }, [handleEnableStructuredPromptMode, id, updateNodeData])
  const baseShowTimeMenu = hasDuration
  const baseShowResolutionMenu = isVideoNode
    ? configuredSizeOptions.length > 0 || hasAspect
    : imageModelConfig
      ? configuredImageAspectOptions.length > 0
      : hasAspect
  const videoFramingControlledBySize = Boolean(isVideoNode && baseShowResolutionMenu)
  const baseShowOrientationMenu = isVideoNode
    ? !videoFramingControlledBySize && (hasOrientation || configuredOrientationOptions.length > 0)
    : hasOrientation
  React.useEffect(() => {
    if (!modelList.length) return
    const matched = findModelOptionByIdentifier(modelList, activeModelKey)
    const next = matched || modelList[0]
    if (!next) return
    const nextRequestedModel = resolveRequestedModelIdentifier(next.value)
    if (!nextRequestedModel) return
    if (String(activeModelKey || '').trim() === nextRequestedModel) return
    setModelKey(nextRequestedModel)
    setImageModel(nextRequestedModel)
    setVideoModel(nextRequestedModel)
    updateNodeData(id, {
      geminiModel: nextRequestedModel,
      imageModel: nextRequestedModel,
      videoModel: nextRequestedModel,
      modelVendor: next.vendor || null,
      imageModelVendor: null,
      videoModelVendor: next.vendor || null,
    })
  }, [activeModelKey, modelList, id, resolveRequestedModelIdentifier, updateNodeData])

  React.useEffect(() => {
    if (!isVideoNode) return
    const dataRecord =
      data && typeof data === 'object'
        ? (data as Record<string, unknown>)
        : {}
    const nextDuration = readVideoDurationSeconds(
      dataRecord,
      isStoryboardNode ? STORYBOARD_MAX_TOTAL_DURATION : 15,
    )
    setVideoDuration((prev) => (prev === nextDuration ? prev : nextDuration))
  }, [data, isStoryboardNode, isVideoNode])

  React.useEffect(() => {
    if (!isVideoNode || !videoModelConfig) return

    const patch: Record<string, unknown> = {}
    const nextDuration = pickVideoDurationValue(videoModelConfig, videoDuration)
    if (nextDuration !== null && nextDuration !== videoDuration) {
      setVideoDuration(nextDuration)
      Object.assign(patch, buildVideoDurationPatch(nextDuration))
    }

    const nextSize = pickVideoSizeValue(videoModelConfig, videoSize)
    if (nextSize !== null && nextSize !== videoSize) {
      setVideoSize(nextSize)
      patch.videoSize = nextSize
    }

    const nextResolution = pickVideoResolutionValue(videoModelConfig, videoResolution)
    if (nextResolution !== null && nextResolution !== videoResolution) {
      setVideoResolution(nextResolution)
      patch.videoResolution = nextResolution
    }
    const resolvedDuration = nextDuration ?? videoDuration
    const resolvedResolution = normalizeVideoResolution(nextResolution ?? videoResolution)
    const nextSpecKey = buildVideoBillingSpecKey(resolvedResolution, resolvedDuration)
    if (nextSpecKey) {
      patch.videoSpecKey = nextSpecKey
      patch.specKey = nextSpecKey
    }

    const sizeRule = nextSize
      ? videoModelConfig.sizeOptions.find((option) => option.value === nextSize) || null
      : null

    const nextAspectFromConfig = sizeRule?.aspectRatio
      ? normalizeImageAspect(sizeRule.aspectRatio)
      : null
    const nextOrientationFromConfig = resolveVideoOrientationValue({
      currentOrientation: pickVideoOrientationValue(videoModelConfig, orientationRef.current),
      size: nextSize || videoSize,
      aspect: nextAspectFromConfig || aspect,
      config: videoModelConfig,
    })
    if (nextOrientationFromConfig && nextOrientationFromConfig !== orientationRef.current) {
      orientationRef.current = nextOrientationFromConfig
      setOrientation(nextOrientationFromConfig)
      patch.orientation = nextOrientationFromConfig
    }

    if (nextAspectFromConfig && nextAspectFromConfig !== aspect) {
      setAspect(nextAspectFromConfig)
      patch.aspect = nextAspectFromConfig
    }

    if (Object.keys(patch).length) {
      updateNodeData(id, patch)
    }
  }, [aspect, id, isVideoNode, updateNodeData, videoDuration, videoModelConfig, videoResolution, videoSize])

  React.useEffect(() => {
    if (isVideoNode || !imageModelConfig) return

    const patch: Record<string, unknown> = {}
    const nextAspect = pickImageAspectValue(imageModelConfig, aspect)
    if (nextAspect && nextAspect !== aspect) {
      setAspect(nextAspect)
      patch.aspect = nextAspect
    }

    const nextImageSize = pickImageSizeValue(imageModelConfig, imageSize)
    if (nextImageSize && nextImageSize !== imageSize) {
      setImageSize(nextImageSize)
      patch.imageSize = nextImageSize
    }

    const nextImageResolution = pickImageResolutionValue(imageModelConfig, imageResolution)
    if (nextImageResolution && nextImageResolution !== imageResolution) {
      setImageResolution(nextImageResolution)
      patch.imageResolution = nextImageResolution
      patch.resolution = nextImageResolution
    }

    if (Object.keys(patch).length) {
      updateNodeData(id, patch)
    }
  }, [aspect, id, imageModelConfig, imageResolution, imageSize, isVideoNode, updateNodeData])

  React.useEffect(() => {
    if (!isVideoNode) return
    const storedVideoResolution = typeof (data as Record<string, unknown>)?.videoResolution === 'string'
      ? normalizeVideoResolution((data as Record<string, unknown>)?.videoResolution)
      : ''
    const storedVideoSpecKey = typeof (data as any)?.videoSpecKey === 'string' ? String((data as any).videoSpecKey).trim() : ''
    const storedSpecKey = typeof (data as any)?.specKey === 'string' ? String((data as any).specKey).trim() : ''
    if (
      storedVideoResolution === effectiveVideoResolution &&
      storedVideoSpecKey === videoSpecKey &&
      storedSpecKey === videoSpecKey
    ) {
      return
    }
    updateNodeData(id, {
      videoResolution: effectiveVideoResolution || null,
      videoSpecKey: videoSpecKey || null,
      specKey: videoSpecKey || null,
    })
  }, [data, effectiveVideoResolution, id, isVideoNode, updateNodeData, videoSpecKey])

  const trimmedFirstFrameUrl = veoFirstFrameUrl.trim()
  const trimmedLastFrameUrl = veoLastFrameUrl.trim()
  const firstFrameLocked = Boolean(trimmedFirstFrameUrl)
  const hasStoryboardImageUpstreamForVideo = useRFStore(
    React.useCallback((s) => {
      if (!isVideoNode || resolvedVideoVendor !== 'veo') return false
      return s.edges.some((edge) => {
        if (edge.target !== id) return false
        const src = s.nodes.find((n) => n.id === edge.source)
        const sk = String((src?.data as any)?.kind || '').trim()
        return sk === 'storyboardImage' || sk === 'novelStoryboard' || sk === 'storyboardShot'
      })
    }, [id, isVideoNode, resolvedVideoVendor]),
  )
  const veoReferenceLimitReached = veoReferenceImages.length >= MAX_VEO_REFERENCE_IMAGES
  const [veoImageModalMode, setVeoImageModalMode] = React.useState<'first' | 'last' | 'reference' | null>(null)

  React.useEffect(() => {
    if (existingModelVendor || !modelKey) return
    const vendor = findVendorForModel(modelKey)
    if (vendor) {
      updateNodeData(id, { modelVendor: vendor })
    }
  }, [existingModelVendor, modelKey, findVendorForModel, id, updateNodeData])

  React.useEffect(() => {
    if (!isVideoNode) return
    if (existingVideoVendor || !videoModel) return
    const vendor = findVendorForModel(videoModel)
    if (vendor) {
      updateNodeData(id, { videoModelVendor: vendor })
    }
  }, [existingVideoVendor, videoModel, findVendorForModel, updateNodeData, id, isVideoNode])
  const summaryModelLabel =
    findModelOptionByIdentifier(modelMenuOptions, activeModelKey)?.label ||
    getModelLabel(toNodeKind(coreKind === 'image' ? 'image' : kind), activeModelKey)
  const summaryDuration =
    isVideoNode
      ? selectedConfiguredDurationOption?.label || `${videoDuration}s`
      : `${sampleCount}x`
  const summaryVideoSize = isVideoNode
    ? selectedConfiguredSizeOption?.label || videoSize || aspect
    : isImageEditNode
      ? imageEditSizeOption.label
      : selectedConfiguredImageAspectOption?.label || aspect
  const summaryVideoResolution = React.useMemo(() => {
    if (!isVideoNode) return ''
    return selectedConfiguredResolutionOption?.label || effectiveVideoResolution || '未设定'
  }, [effectiveVideoResolution, isVideoNode, selectedConfiguredResolutionOption])
  const summaryResolution = summaryVideoSize
  const summaryOrientation = React.useMemo(() => {
    const configuredLabel =
      configuredOrientationOptions.find((option) => option.value === orientation)?.label || ''
    if (configuredLabel) return configuredLabel
    return orientation === 'portrait' ? '竖屏' : '横屏'
  }, [configuredOrientationOptions, orientation])
  const summaryExec = `${sampleCount} x`
  const billingNodeKind = React.useMemo<NodeKind>(() => {
    if (isVideoNode) return 'video'
    if (kind === 'imageEdit') return 'imageEdit'
    if (coreKind === 'image') return 'image'
    if (isAudioNode) return 'audio'
    if (isSubtitleNode) return 'subtitle'
    if (isCharacterNode) return 'character'
    return 'text'
  }, [coreKind, isAudioNode, isCharacterNode, isSubtitleNode, isVideoNode, kind])
  const requiredGenerationCredits = React.useMemo(
    () =>
      resolveModelGenerationCredits({
        kind: billingNodeKind,
        modelOption: selectedActiveModelOption,
        specKey: isVideoNode ? videoSpecKey : null,
        quantity: coreKind === 'image' ? sampleCount : 1,
      }),
    [billingNodeKind, coreKind, isVideoNode, sampleCount, selectedActiveModelOption, videoSpecKey],
  )
  const requiredCreditsLabel = React.useMemo(() => {
    if (!(isVideoNode || coreKind === 'image')) return null
    return `${requiredGenerationCredits}积分`
  }, [coreKind, isVideoNode, requiredGenerationCredits])
  const promptPresetOptions = React.useMemo(
    () =>
      presetItems.map((item) => ({
        value: item.id,
        label: `${item.title}${item.scope === 'base' ? '（基础）' : ''}`,
      })),
    [presetItems],
  )
  const allowNodePresetForPrompt = !isStoryboardNode
  const durationOptions = React.useMemo(() => {
    if (configuredDurationOptions.length) return configuredDurationOptions
    if (resolvedVideoVendor === 'veo') {
      return [...VEO_DURATION_OPTIONS]
    }
    if (isStoryboardNode) {
      return [...BASE_DURATION_OPTIONS, STORYBOARD_DURATION_OPTION]
    }
    return BASE_DURATION_OPTIONS
  }, [configuredDurationOptions, isStoryboardNode, resolvedVideoVendor])

  React.useEffect(() => {
    const raw = (data as any)?.videoHd
    const next = typeof raw === 'boolean' ? raw : false
    setVideoHd((prev) => (prev === next ? prev : next))
  }, [(data as any)?.videoHd])

  React.useEffect(() => {
    if (!isVideoNode) return
    if (!videoHd) return
    setVideoHd(false)
    updateNodeData(id, { videoHd: false })
  }, [id, isVideoNode, updateNodeData, videoHd])

  React.useEffect(() => {
    if (!isVideoNode || !hasDuration) return
    const allowed = durationOptions
      .map((opt) => Number(opt.value))
      .filter((v) => Number.isFinite(v) && v > 0)
    if (!allowed.length) return
    const current =
      typeof videoDuration === 'number' && Number.isFinite(videoDuration) && videoDuration > 0
        ? videoDuration
        : allowed[0]
    if (allowed.includes(current) && current === videoDuration) return

    let best = allowed[0]
    let bestDiff = Math.abs(current - best)
    for (const candidate of allowed) {
      const diff = Math.abs(current - candidate)
      if (diff < bestDiff || (diff === bestDiff && candidate > best)) {
        best = candidate
        bestDiff = diff
      }
    }

    if (best !== videoDuration) {
      setVideoDuration(best)
      updateNodeData(id, buildVideoDurationPatch(best))
    }
  }, [durationOptions, hasDuration, id, isVideoNode, updateNodeData, videoDuration])

  const handleToolbarModelChange = React.useCallback((value: string) => {
    const requestedValue = resolveRequestedModelIdentifier(value) || value
    setModelKey(requestedValue)
    setImageModel(requestedValue)
    setVideoModel(requestedValue)
    const option = findModelOptionByIdentifier(modelMenuOptions, value)
    updateNodeData(id, {
      geminiModel: requestedValue,
      imageModel: requestedValue,
      videoModel: requestedValue,
      modelVendor: option?.vendor || null,
      imageModelVendor: null,
      videoModelVendor: option?.vendor || null,
    })
  }, [findModelOptionByIdentifier, id, modelMenuOptions, resolveRequestedModelIdentifier, updateNodeData])

  const handleToolbarDurationChange = React.useCallback((num: number) => {
    const nextSpecKey = buildVideoBillingSpecKey(effectiveVideoResolution, num)
    setVideoDuration(num)
    updateNodeData(id, {
      ...buildVideoDurationPatch(num),
      videoResolution: effectiveVideoResolution || null,
      videoSpecKey: nextSpecKey || null,
      specKey: nextSpecKey || null,
    })
  }, [effectiveVideoResolution, id, updateNodeData])

  const handleToolbarSizeChange = React.useCallback((value: string) => {
    if (isVideoNode) {
      const normalizedSize = value.trim().replace(/\s+/g, '')
      const matchedOption =
        videoModelConfig?.sizeOptions.find((option) => option.value === normalizedSize) || null
      const nextSpecKey = buildVideoBillingSpecKey(effectiveVideoResolution, videoDuration)
      const nextAspect = matchedOption?.aspectRatio ? normalizeImageAspect(matchedOption.aspectRatio) : aspect
      const nextOrientation = resolveVideoOrientationValue({
        currentOrientation: matchedOption?.orientation ?? orientationRef.current,
        size: normalizedSize,
        aspect: nextAspect,
        config: videoModelConfig,
      })
      setVideoSize(normalizedSize)
      updateNodeData(id, {
        videoSize: normalizedSize,
        videoResolution: effectiveVideoResolution || null,
        videoSpecKey: nextSpecKey || null,
        specKey: nextSpecKey || null,
        ...(matchedOption?.aspectRatio ? { aspect: nextAspect } : {}),
        orientation: nextOrientation,
      })
      if (matchedOption?.aspectRatio) {
        setAspect(nextAspect)
      }
      orientationRef.current = nextOrientation
      setOrientation(nextOrientation)
      return
    }
    const normalizedAspect = normalizeImageAspect(value)
    setAspect(normalizedAspect)
    updateNodeData(id, { aspect: normalizedAspect })
  }, [aspect, effectiveVideoResolution, id, isVideoNode, updateNodeData, videoDuration, videoModelConfig])

  const handleToolbarVideoResolutionChange = React.useCallback((value: string) => {
    const normalizedResolution = normalizeVideoResolution(value)
    const nextSpecKey = buildVideoBillingSpecKey(normalizedResolution, videoDuration)
    setVideoResolution(normalizedResolution)
    updateNodeData(id, {
      videoResolution: normalizedResolution || null,
      videoSpecKey: nextSpecKey || null,
      specKey: nextSpecKey || null,
    })
  }, [id, updateNodeData, videoDuration])

  const handleToolbarOrientationChange = React.useCallback((value: Orientation) => {
    const normalized = normalizeOrientation(value)
    const matchedOption =
      videoModelConfig?.orientationOptions.find((option) => option.value === normalized) || null
    const nextSize = matchedOption?.size ? matchedOption.size : videoSize
    const nextSpecKey = buildVideoBillingSpecKey(effectiveVideoResolution, videoDuration)
    orientationRef.current = normalized
    setOrientation(normalized)
    updateNodeData(id, {
      orientation: normalized,
      videoResolution: effectiveVideoResolution || null,
      videoSpecKey: nextSpecKey || null,
      specKey: nextSpecKey || null,
      ...(matchedOption?.size ? { videoSize: matchedOption.size } : {}),
      ...(matchedOption?.aspectRatio ? { aspect: normalizeImageAspect(matchedOption.aspectRatio) } : {}),
    })
    if (matchedOption?.size) {
      setVideoSize(matchedOption.size)
    }
    if (matchedOption?.aspectRatio) {
      setAspect(normalizeImageAspect(matchedOption.aspectRatio))
    }
  }, [effectiveVideoResolution, id, updateNodeData, videoDuration, videoModelConfig, videoSize])

  const mappedVideoControls = React.useMemo<ReadonlyArray<ToolbarMappedControl>>(() => {
    if (!isVideoNode || !videoModelConfig) return []
    const controls = videoModelConfig.controls.flatMap((control) => {
      if (control.binding === 'durationSeconds') {
        if (!durationOptions.length) return []
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: summaryDuration,
          options: durationOptions.map((option) => ({ value: option.value, label: option.label })),
          onChange: (value: string) => {
            const parsed = Number(value)
            if (Number.isFinite(parsed) && parsed > 0) {
              handleToolbarDurationChange(parsed)
            }
          },
        }]
      }
      if (control.binding === 'resolution') {
        const options = configuredVideoResolutionOptions
        if (!options.length) return []
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: summaryVideoResolution,
          options,
          onChange: handleToolbarVideoResolutionChange,
        }]
      }
      if (control.binding === 'size') {
        const options = configuredSizeOptions
        if (!options.length) return []
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: summaryVideoSize,
          options,
          onChange: handleToolbarSizeChange,
        }]
      }
      const options = configuredOrientationOptions
      if (!options.length) return []
      return [{
        key: control.key,
        binding: control.binding,
        title: control.label,
        summary: summaryOrientation,
        options,
        onChange: (value: string) => {
          if (value === 'portrait' || value === 'landscape') {
            handleToolbarOrientationChange(value)
          }
        },
      }]
    })
    const hasSizeControl = controls.some((control) => control.binding === 'size')
    const hasResolutionControl = controls.some((control) => control.binding === 'resolution')
    const autoResolutionControl = !hasResolutionControl && configuredVideoResolutionOptions.length
      ? [{
          key: 'video_resolution',
          binding: 'resolution' as const,
          title: '分辨率',
          summary: summaryVideoResolution,
          options: configuredVideoResolutionOptions,
          onChange: handleToolbarVideoResolutionChange,
        }]
      : []
    return hasSizeControl
      ? [...controls.filter((control) => control.binding !== 'orientation'), ...autoResolutionControl]
      : [...controls, ...autoResolutionControl]
  }, [
    configuredVideoResolutionOptions,
    configuredOrientationOptions,
    configuredSizeOptions,
    durationOptions,
    handleToolbarDurationChange,
    handleToolbarOrientationChange,
    handleToolbarSizeChange,
    handleToolbarVideoResolutionChange,
    isVideoNode,
    summaryDuration,
    summaryOrientation,
    summaryVideoResolution,
    summaryVideoSize,
    videoModelConfig,
  ])

  const mappedVideoControlBindings = React.useMemo(() => {
    return new Set<VideoModelControlBinding>(mappedVideoControls.map((control) => control.binding))
  }, [mappedVideoControls])

  const mappedImageControls = React.useMemo<ReadonlyArray<ToolbarMappedControl>>(() => {
    if (isVideoNode || !imageModelConfig) return []
    return imageModelConfig.controls.flatMap((control) => {
      if (control.binding === 'aspectRatio') {
        if (!configuredImageAspectOptions.length) return []
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: selectedConfiguredImageAspectOption?.label || aspect,
          options: configuredImageAspectOptions,
          onChange: handleToolbarSizeChange,
        }]
      }
      if (control.binding === 'imageSize') {
        if (imageSizeMatchesResolutionOptions) return []
        if (!configuredImageSizeOptions.length) return []
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: selectedConfiguredImageSizeOption?.label || imageSize,
          options: configuredImageSizeOptions,
          onChange: (value: string) => {
            setImageSize(value)
            updateNodeData(id, { imageSize: value })
          },
        }]
      }
      if (control.binding === 'resolution') {
        if (!configuredImageResolutionOptions.length) return []
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: selectedConfiguredImageResolutionOption?.label || imageResolution || '分辨率',
          options: configuredImageResolutionOptions,
          onChange: (value: string) => {
            setImageResolution(value)
            updateNodeData(id, { imageResolution: value, resolution: value })
          },
        }]
      }
      return []
    })
  }, [
    aspect,
    configuredImageAspectOptions,
    configuredImageResolutionOptions,
    configuredImageSizeOptions,
    handleToolbarSizeChange,
    id,
    imageModelConfig,
    imageResolution,
    imageSize,
    imageSizeMatchesResolutionOptions,
    isVideoNode,
    selectedConfiguredImageAspectOption,
    selectedConfiguredImageResolutionOption,
    selectedConfiguredImageSizeOption,
    updateNodeData,
  ])

  const mappedImageControlBindings = React.useMemo(() => {
    return new Set<ImageModelControlBinding>(
      mappedImageControls
        .map((control) => control.binding)
        .filter(
          (binding): binding is ImageModelControlBinding =>
            binding === 'aspectRatio' || binding === 'imageSize' || binding === 'resolution',
        ),
    )
  }, [mappedImageControls])

  const showTimeMenu = baseShowTimeMenu && !mappedVideoControlBindings.has('durationSeconds')
  const showResolutionMenu = isVideoNode
    ? baseShowResolutionMenu && !mappedVideoControlBindings.has('size')
    : baseShowResolutionMenu && !mappedImageControlBindings.has('aspectRatio')
  const showOrientationMenu =
    baseShowOrientationMenu &&
    !mappedVideoControlBindings.has('orientation') &&
    !mappedVideoControlBindings.has('size')
  const showImageSizeMenu =
    hasImageSize &&
    !imageSizeMatchesResolutionOptions &&
    (imageModelConfig ? configuredImageSizeOptions.length > 0 : true) &&
    !mappedImageControlBindings.has('imageSize')
  React.useEffect(() => {
    if (typeof persistedCharacterRewriteModel === 'string' && persistedCharacterRewriteModel.trim() && persistedCharacterRewriteModel !== characterRewriteModel) {
      setCharacterRewriteModel(persistedCharacterRewriteModel)
    }
  }, [persistedCharacterRewriteModel, characterRewriteModel])
  React.useEffect(() => {
    if (!rewriteModelOptions.length) return
    if (!rewriteModelOptions.some((opt) => opt.value === characterRewriteModel)) {
      const fallback = rewriteModelOptions[0].value
      setCharacterRewriteModel(fallback)
      updateNodeData(id, { characterRewriteModel: fallback })
    }
  }, [rewriteModelOptions, characterRewriteModel, updateNodeData, id])
  const handleRewriteModelChange = React.useCallback((value: string | null) => {
    if (!value) return
    setCharacterRewriteModel(value)
    updateNodeData(id, { characterRewriteModel: value })
  }, [id, updateNodeData])

  const handleApplyPromptSample = React.useCallback((sample: PromptSampleDto) => {
    if (!sample?.prompt) return
    setPrompt(sample.prompt)
    updateNodeData(id, { prompt: sample.prompt })
    setPromptSamplesOpen(false)
  }, [id, updateNodeData])

  React.useEffect(() => {
    const fromData = (data as any)?.llmPresetId
    const next = typeof fromData === 'string' && fromData.trim() ? fromData : null
    setSelectedPresetId((prev) => (prev === next ? prev : next))
  }, [(data as any)?.llmPresetId])

  React.useEffect(() => {
    setNewPresetType(presetType)
  }, [presetType])

  const reloadNodePresets = React.useCallback(async () => {
    setPresetLoading(true)
    try {
      const list = await listLlmNodePresets({ type: presetType })
      setPresetItems(Array.isArray(list) ? list : [])
    } catch (err: any) {
      setPresetItems([])
      toast(err?.message || '加载节点预设失败', 'error')
    } finally {
      setPresetLoading(false)
    }
  }, [presetType])

  React.useEffect(() => {
    void reloadNodePresets()
  }, [reloadNodePresets])

  const handlePresetChange = React.useCallback((presetId: string | null) => {
    setSelectedPresetId(presetId)
    if (!presetId) {
      updateNodeData(id, { llmPresetId: null })
      return
    }
    const selectedPreset = presetItems.find((item) => item.id === presetId)
    if (!selectedPreset) {
      updateNodeData(id, { llmPresetId: presetId })
      return
    }
    setPrompt(selectedPreset.prompt)
    updateNodeData(id, {
      prompt: selectedPreset.prompt,
      llmPresetId: selectedPreset.id,
      llmPresetType: selectedPreset.type,
      llmPresetTitle: selectedPreset.title,
    })
  }, [id, presetItems, updateNodeData])

  const handleCreateNodePreset = React.useCallback(async () => {
    const title = newPresetTitle.trim()
    const promptText = newPresetPrompt.trim()
    if (!title || !promptText) {
      toast('请填写预设名称和提示词', 'error')
      return
    }
    setPresetSaving(true)
    try {
      const created = await createLlmNodePreset({
        title,
        prompt: promptText,
        type: newPresetType,
      })
      setPresetModalOpen(false)
      setNewPresetTitle('')
      setNewPresetPrompt('')
      await reloadNodePresets()
      const shouldApplyPrompt = created.type === presetType
      if (shouldApplyPrompt) {
        setSelectedPresetId(created.id)
        setPrompt(created.prompt)
        updateNodeData(id, {
          prompt: created.prompt,
          llmPresetId: created.id,
          llmPresetType: created.type,
          llmPresetTitle: created.title,
        })
      }
      toast('预设创建成功', 'success')
    } catch (err: any) {
      toast(err?.message || '创建预设失败', 'error')
    } finally {
      setPresetSaving(false)
    }
  }, [id, newPresetPrompt, newPresetTitle, newPresetType, presetType, reloadNodePresets, updateNodeData])

  const applyVeoReferenceImages = React.useCallback((next: string[]) => {
    const normalized = normalizeVeoReferenceUrls(next)
    setVeoReferenceImages(normalized)
    updateNodeData(id, { veoReferenceImages: normalized })
  }, [id, updateNodeData])

  const handleReferenceToggle = React.useCallback((url: string) => {
    if (firstFrameLocked) return
    const exists = veoReferenceImages.includes(url)
    if (!exists && veoReferenceLimitReached) return
    const next = exists
      ? veoReferenceImages.filter((item) => item !== url)
      : [...veoReferenceImages, url]
    applyVeoReferenceImages(next)
  }, [applyVeoReferenceImages, firstFrameLocked, veoReferenceImages, veoReferenceLimitReached])

  const handleAddCustomReferenceImage = React.useCallback(() => {
    if (firstFrameLocked) return
    const trimmed = veoCustomImageInput.trim()
    if (!trimmed) return
    applyVeoReferenceImages([...veoReferenceImages, trimmed])
    setVeoCustomImageInput('')
  }, [applyVeoReferenceImages, firstFrameLocked, veoCustomImageInput, veoReferenceImages])

  const handleSetFirstFrameUrl = React.useCallback((value: string) => {
    setVeoFirstFrameUrl(value)
    const trimmed = value.trim()
    updateNodeData(id, { veoFirstFrameUrl: trimmed || null })
    if (!trimmed) {
      setVeoLastFrameUrl('')
      updateNodeData(id, { veoLastFrameUrl: null })
      return
    }
    if (veoReferenceImages.length) {
      applyVeoReferenceImages([])
    }
  }, [applyVeoReferenceImages, id, updateNodeData, veoReferenceImages.length])

  const handleSetLastFrameUrl = React.useCallback((value: string) => {
    if (!firstFrameLocked) return
    setVeoLastFrameUrl(value)
    const trimmed = value.trim()
    updateNodeData(id, { veoLastFrameUrl: trimmed || null })
  }, [firstFrameLocked, id, updateNodeData])

  const handleRemoveReferenceImage = React.useCallback((url: string) => {
    applyVeoReferenceImages(veoReferenceImages.filter((item) => item !== url))
  }, [applyVeoReferenceImages, veoReferenceImages])

  const openVeoModal = React.useCallback((mode: 'first' | 'last' | 'reference') => {
    setVeoImageModalMode(mode)
  }, [])
  const closeVeoModal = React.useCallback(() => setVeoImageModalMode(null), [])

  const showUpstreamPreview = Boolean(isSingleSelectionActive && isComposerNode)
  const upstreamSourceId = useRFStore(
    React.useCallback((s) => {
      if (!showUpstreamPreview) return null
      let lastSource: string | null = null
      s.edges.forEach((edge) => {
        if (edge.target === id) lastSource = edge.source
      })
      return lastSource
    }, [id, showUpstreamPreview]),
  )
  const upstreamSourceData = useRFStore(
    React.useCallback((s) => {
      if (!upstreamSourceId) return null
      const src = s.nodes.find((n) => n.id === upstreamSourceId)
      return src ? (src.data as any) : null
    }, [upstreamSourceId]),
  )
  const { upstreamText, upstreamImageUrl, upstreamVideoUrl } = React.useMemo(() => {
    if (!showUpstreamPreview || !upstreamSourceData) {
      return {
        upstreamText: null as string | null,
        upstreamImageUrl: null as string | null,
        upstreamVideoUrl: null as string | null,
      }
    }

    const sd: any = upstreamSourceData || {}
    const skind: string | undefined = sd.kind
    const sourceSchema = getTaskNodeSchema(skind)
    const sourceFeatures = new Set(sourceSchema.features)
    const sourceIsImageNode =
      sourceSchema.category === 'image' || sourceFeatures.has('image') || sourceFeatures.has('imageResults')
    const sourceHasVideoResults =
      sourceFeatures.has('videoResults') ||
      sourceFeatures.has('video') ||
      sourceSchema.category === 'video' ||
      sourceSchema.category === 'composer' ||
      sourceSchema.category === 'storyboard'

    // 获取最新的主文本 / 提示词
    const uText =
      sd.prompt && typeof sd.prompt === 'string'
        ? sd.prompt
        : sourceFeatures.has('textResults') && sd.textResults && sd.textResults.length > 0
          ? sd.textResults[sd.textResults.length - 1]
          : sourceSchema.category === 'document'
            ? (sd.prompt as string | undefined) || (sd.label as string | undefined) || null
            : null

    // 获取最新的主图片 URL
    let uImg = null as string | null
    if (sourceIsImageNode) {
      uImg = (sd.imageUrl as string | undefined) || null
    } else if (sourceHasVideoResults && sd.videoResults && sd.videoResults.length > 0 && sd.videoPrimaryIndex !== undefined) {
      uImg = sd.videoResults[sd.videoPrimaryIndex]?.thumbnailUrl || sd.videoResults[0]?.thumbnailUrl
    }

    // 获取最新的主视频 URL
    let uVideo = null as string | null
    if (sourceHasVideoResults) {
      if (sd.videoResults && sd.videoResults.length > 0 && sd.videoPrimaryIndex !== undefined) {
        uVideo = sd.videoResults[sd.videoPrimaryIndex]?.url || sd.videoResults[0]?.url
      } else {
        uVideo = (sd.videoUrl as string | undefined) || null
      }
    }

    return { upstreamText: uText, upstreamImageUrl: uImg, upstreamVideoUrl: uVideo }
  }, [showUpstreamPreview, upstreamSourceData])

  const buildFeaturePatch = React.useCallback((nextPrompt: string) => {
    const patch: Record<string, unknown> = { prompt: nextPrompt }
    if (hasAspect) patch.aspect = aspect
    if (hasImageSize) patch.imageSize = imageSize
    if (hasImageResults) {
      patch.imageModel = imageModel
      patch.imageModelVendor = null
    }
    if (hasSampleCount) patch.sampleCount = sampleCount
    if (isVideoNode || hasVideo || hasVideoResults) {
      patch.videoModel = videoModel
      patch.videoModelVendor = findVendorForModel(videoModel)
      if (hasDuration) Object.assign(patch, buildVideoDurationPatch(videoDuration))
      if (hasOrientation) patch.orientation = orientationRef.current
      if (videoSize) patch.videoSize = videoSize
      if (effectiveVideoResolution) patch.videoResolution = effectiveVideoResolution
      if (videoSpecKey) {
        patch.videoSpecKey = videoSpecKey
        patch.specKey = videoSpecKey
      }
    }
    patch.modelVendor = findVendorForModel(modelKey)
    return patch
  }, [
    aspect,
    imageSize,
    findVendorForModel,
    hasAspect,
    hasImageSize,
    hasDuration,
    hasImageResults,
    hasOrientation,
    hasSampleCount,
    hasVideo,
    hasVideoResults,
    imageModel,
    isVideoNode,
    modelKey,
    sampleCount,
    videoDuration,
    videoModel,
    effectiveVideoResolution,
    videoSpecKey,
    videoSize,
    orientationRef,
  ])

  const runNode = () => {
    if (isPlainTextNode) {
      updateNodeData(id, { prompt })
      return
    }
    let nextPrompt = (prompt || (data as any)?.prompt || '').trim()
    const patch: Record<string, unknown> = {}
    const featurePatch = buildFeaturePatch(nextPrompt)
    Object.assign(patch, featurePatch)
    if (hasImage) {
      setPrompt(nextPrompt)
    }
    updateNodeData(id, patch)
    runSelected()
  }

  const handleAdoptVideo = React.useCallback((idx: number) => {
    const target = videoResults[idx]
    if (!target) return
    updateNodeData(id, {
      adoptedVideoAsset: {
        index: idx,
        url: target.url,
        adoptedAt: new Date().toISOString(),
        progress: typeof data?.progress === 'number' && Number.isFinite(data.progress) ? data.progress : null,
      } satisfies AdoptedAssetMetadata,
    })
    toast(`已采纳第 ${idx + 1} 个视频`, 'success')
  }, [data?.progress, id, updateNodeData, videoResults])

	  const videoContent = !isVideoNode
	    ? null
	    : (
	      <VideoContent
        videoResults={videoResults}
        videoPrimaryIndex={videoPrimaryIndex}
        adoptedVideoIndex={adoptedVideoIndex}
        isPrimaryVideoAdopted={isPrimaryVideoAdopted}
        videoUrl={videoUrl}
        videoThumbnailUrl={videoThumbnailUrl}
        videoTitle={videoTitle}
        frameCaptureLoading={frameCaptureLoading}
        frameSamples={frameSamples}
        handleCaptureVideoFrames={handleCaptureVideoFrames}
        cleanupFrameSamples={cleanupFrameSamples}
        mediaOverlayBackground={mediaOverlayBackground}
        mediaOverlayText={mediaOverlayText}
        mediaFallbackSurface={mediaFallbackSurface}
        mediaFallbackText={mediaFallbackText}
		        inlineDividerColor={inlineDividerColor}
		        accentPrimary={accentPrimary}
		        rgba={rgba}
		        videoSurface={videoSurface}
		        onAdoptVideo={handleAdoptVideo}
		        onOpenVideoModal={() => setVideoExpanded(true)}
		        onOpenWebCut={
		          viewOnly
		            ? undefined
		            : () => {
	              const src = videoResults[videoPrimaryIndex]?.url || videoUrl || ''
              if (!src) {
                toast('暂无可剪辑的视频', 'error')
                return
              }

              const baseTitle =
                (videoResults[videoPrimaryIndex]?.title || videoTitle || '').trim() ||
                'clip'
              const nextTitle = `${baseTitle}-剪辑`

              openWebCutVideoEditModal({
                nodeId: id,
                videoUrl: src,
                videoTitle: baseTitle,
                onApply: async (result) => {
                  const before = useRFStore.getState()
                  const beforeIds = new Set(before.nodes.map((n) => n.id))

                  addNode('taskNode', undefined, {
                    kind: 'video',
                    videoUrl: result.url,
                    videoThumbnailUrl: result.thumbnailUrl || null,
                    videoTitle: nextTitle,
                    serverAssetId: result.assetId,
                  })

                  const after = useRFStore.getState()
                  const newNode = after.nodes.find((n) => !beforeIds.has(n.id))
                  if (!newNode) {
                    toast('剪辑已上传，但未能创建新视频节点', 'error')
                    return
                  }

                  const sourceNode = after.nodes.find((n) => n.id === id)
                  const targetPos = {
                    x: (sourceNode?.position?.x || 0) + 520,
                    y: sourceNode?.position?.y || 0,
                  }
                  after.onNodesChange([
                    { id: newNode.id, type: 'position', position: targetPos, dragging: false },
                    { id: newNode.id, type: 'select', selected: true },
                  ])
                },
              })
            }
	        }
	      />
	    )

	  const characterContentProps = null

	  const mosaicProps = {
	    imageResults,
	    imagePrimaryIndex,
	    placeholderColor: placeholderIconColor,
    mosaicGrid,
    onOpenModal: () => setMosaicModalOpen(true),
    onSave: handleMosaicSave,
  }

  const handleImageUpload = React.useCallback(async (files: File[]) => {
    if (!supportsImageUpload) return
    if (nodeHasUploadIntent || nodeHasPendingUploads) {
      toast('当前节点仍有图片上传中，请等待完成后再试', 'info')
      return
    }

    try {
      useUploadRuntimeStore.getState().beginNodeImageUpload(id)

      const picked = (files || []).filter((f): f is File => Boolean(f))
      if (!picked.length) return

      const deduped = dedupeLocalFiles(picked, (file) => file.name || 'Image')
      if (deduped.skippedCount > 0) {
        useUploadRuntimeStore.getState().recordDuplicateBlocked(deduped.skippedCount)
        toast(`已跳过 ${deduped.skippedCount} 个同批次重复文件`, 'info')
      }

      const MAX_BYTES = 30 * 1024 * 1024
      const tooLarge = deduped.uniqueFiles.filter((f) => (typeof f.size === 'number' ? f.size : 0) > MAX_BYTES)
      if (tooLarge.length) toast(`有 ${tooLarge.length} 张图片超过 30MB，已跳过`, 'error')
      const valid = deduped.uniqueFiles.filter((f) => (typeof f.size === 'number' ? f.size : 0) <= MAX_BYTES)
      if (!valid.length) return

      const allNodes = useRFStore.getState().nodes
      const self = allNodes.find((n) => n.id === id) as any
      const basePos = self?.position || { x: 0, y: 0 }
      const parentId = self?.parentId as string | undefined
      const extent = self?.extent as any

      const spacingX = CANVAS_CONFIG.NODE_SPACING_X + 60
      const spacingY = CANVAS_CONFIG.NODE_SPACING_Y + 40
      const cols = 3

      const extraFiles = valid.slice(1)
      const extraPrepared = extraFiles.map((file, idx) => {
        const newId = genTaskNodeId()
        const localUrl = URL.createObjectURL(file)
        const col = idx % cols
        const row = Math.floor(idx / cols)
        const position = {
          x: basePos.x + spacingX * (col + 1),
          y: basePos.y + spacingY * row,
        }
        return { id: newId, file, localUrl, position }
      })

      if (extraPrepared.length) {
        useRFStore.setState((s: any) => {
          const newNodes = extraPrepared.map((p) => ({
            id: p.id,
            type: 'taskNode' as const,
            position: p.position,
            parentId,
            extent,
            data: { label: 'Image', kind: 'image', imageUrl: p.localUrl },
            selected: false,
          }))
          return { nodes: [...s.nodes, ...newNodes], nextId: s.nextId + newNodes.length }
        })
      }

      const uploadIntoNode = async (nodeId: string, file: File, localUrl: string): Promise<boolean> => {
        const imageTitle = typeof file?.name === 'string' && file.name.trim() ? file.name.trim() : '上传图片'
        const requestKey = `${nodeId}:${file.name}:${file.size}:${file.lastModified}`
        const localPreviewResourceId = resourceManager.buildResourceId({
          url: localUrl,
          kind: 'preview',
          variantKey: 'preview',
        })
        useUploadRuntimeStore.getState().registerUploadIntent({
          id: requestKey,
          requestKey,
          fileName: imageTitle,
          ownerNodeId: nodeId,
          localPreviewResourceId,
          localPreviewUrl: localUrl,
        })
        updateNodeData(nodeId, {
          imageUrl: localUrl,
          imageResults: [{ url: localUrl, title: imageTitle }],
          imagePrimaryIndex: 0,
        })

        let hostedUrl: string | null = null
        let hostedAssetId: string | null = null
        try {
          useUploadRuntimeStore.getState().markUploadStarted(requestKey)
          const hosted = await uploadServerAssetFile(file, file.name || 'Image', { ownerNodeId: nodeId })
          const url = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
          if (url) {
            hostedUrl = url
            hostedAssetId = hosted.id
          }
        } catch (error) {
          console.error('Failed to upload image to OSS:', error)
          const msg = String((error as any)?.message || '').trim()
          const statusMatch = msg.match(/upload asset failed:\\s*(\\d+)/i)
          const status = statusMatch && statusMatch[1] ? Number(statusMatch[1]) : NaN
          const mayHaveSucceeded = !Number.isFinite(status) || status >= 500
          if (mayHaveSucceeded) {
            const recovered = await recoverUploadedServerAssetFile(file)
            const recoveredUrl = typeof recovered?.data?.url === 'string' ? recovered.data.url.trim() : ''
            if (recovered && recoveredUrl) {
              hostedUrl = recoveredUrl
              hostedAssetId = recovered.id
            }
          }
        }

        const remoteUrl = hostedUrl || localUrl
        updateNodeData(nodeId, {
          imageUrl: remoteUrl,
          imageResults: [{ url: remoteUrl, title: imageTitle }],
          imagePrimaryIndex: 0,
          serverAssetId: hostedAssetId,
        })
        if (remoteUrl !== localUrl) {
          const remoteResourceId = resourceManager.buildResourceId({
            url: remoteUrl,
            kind: 'image',
            variantKey: 'original',
          })
          useUploadRuntimeStore.getState().commitUploadHosted({
            handleId: requestKey,
            remoteResourceId,
            remoteUrl,
          })
          resourceManager.replaceLocalPreview(localPreviewResourceId)
          URL.revokeObjectURL(localUrl)
        } else {
          useUploadRuntimeStore.getState().failUpload({
            handleId: requestKey,
            error: 'remote upload unavailable; local preview only',
          })
        }
        useUploadRuntimeStore.getState().finishUpload(requestKey)

        if ((window as any).silentSaveProject) {
          (window as any).silentSaveProject()
        }
        return Boolean(hostedUrl)
      }

      let successCount = 0
      const firstFile = valid[0]
      const firstLocalUrl = URL.createObjectURL(firstFile)
      try {
        if (await uploadIntoNode(id, firstFile, firstLocalUrl)) successCount += 1
      } catch (error) {
        console.error('Failed to upload image:', error)
        toast('上传图片失败，请稍后再试', 'error')
      }

      for (const p of extraPrepared) {
        try {
          if (await uploadIntoNode(p.id, p.file, p.localUrl)) successCount += 1
        } catch (error) {
          console.error('Failed to upload image:', error)
          toast('上传图片失败，请稍后再试', 'error')
        }
      }

      if (successCount === 0) {
        toast('已添加图片，但未能托管到 OSS/R2，将仅使用本地预览（无法用于远程任务）', 'error')
      }

      if (successCount > 0 && extraPrepared.length) {
        useRFStore.setState((s: any) => {
          const ids = new Set(extraPrepared.map((p) => p.id))
          const posById = new Map(
            extraPrepared.map((p, idx) => {
              const col = idx % cols
              const row = Math.floor(idx / cols)
              return [
                p.id,
                { x: basePos.x + spacingX * (col + 1), y: basePos.y + spacingY * row },
              ] as const
            }),
          )
          const past = [...s.historyPast, JSON.parse(JSON.stringify({ nodes: s.nodes, edges: s.edges }))].slice(-50)
          return {
            nodes: s.nodes.map((n: any) => (ids.has(n.id) ? { ...n, position: posById.get(n.id)! } : n)),
            historyPast: past,
            historyFuture: [],
          }
        })
      }
    } catch (error) {
      console.error('Failed to upload image:', error)
      toast('上传图片失败，请稍后再试', 'error')
    } finally {
      useUploadRuntimeStore.getState().finishNodeImageUpload(id)
    }
  }, [supportsImageUpload, nodeHasUploadIntent, nodeHasPendingUploads, id, updateNodeData])

  const isImageNode = coreKind === 'image'
  const hideImageMeta = isImageNode && !selected
  const isImageExpired = Boolean((data as any)?.expired || (data as any)?.imageExpired)
  // GenerationOverlay 已覆盖 running/queued 状态；本地上传仍需独立提示，避免组件 remount 后丢失“上传中”事实。
  const showImageStateOverlay = Boolean(isImageNode && (isImageExpired || isUploadingImage))
  const imageStateLabel = isUploadingImage ? '上传中' : isImageExpired ? '已过期' : null

  const isCanvasMediaNode = coreKind === 'image' || coreKind === 'video'
  const isResizableVisualNode = isCanvasMediaNode || isStoryboardEditorNode
  const useMediaFocusToolbar = isCanvasMediaNode
  const showBottomToolbar = isSingleSelectionActive && !isCameraRefNode && !isPlainTextNode && !isStoryboardEditorNode
  const showUpstreamReferenceStrip = Boolean(useMediaFocusToolbar && isImageNode && isSingleSelectionActive)
  const serializedUpstreamReferenceItems = useRFStore(
    React.useCallback((state) => {
      if (!showUpstreamReferenceStrip) return ''
      const items = collectOrderedUpstreamReferenceItems(state.nodes, state.edges, id)
      if (items.length === 0) return ''
      return items.map((item) => JSON.stringify(item)).join('\n')
    }, [id, showUpstreamReferenceStrip]),
  )
  const upstreamReferenceItems = React.useMemo<OrderedUpstreamReferenceItem[]>(() => {
    if (!serializedUpstreamReferenceItems) return EMPTY_UPSTREAM_REFERENCE_ITEMS
    return serializedUpstreamReferenceItems
      .split('\n')
      .filter(Boolean)
      .map((item) => JSON.parse(item) as OrderedUpstreamReferenceItem)
  }, [serializedUpstreamReferenceItems])
  const canvasReferencePickerActive = canvasReferencePicker?.targetNodeId === id
  const handleToggleCanvasReferencePicker = React.useCallback(() => {
    if (canvasReferencePickerActive) {
      closeCanvasReferencePicker()
      return
    }
    openCanvasReferencePicker({
      targetNodeId: id,
      blockedSourceNodeIds: upstreamReferenceItems.map((item) => item.sourceNodeId),
    })
  }, [canvasReferencePickerActive, closeCanvasReferencePicker, id, openCanvasReferencePicker, upstreamReferenceItems])
  const handleRemoveUpstreamReference = React.useCallback((edgeId: string) => {
    deleteEdge(edgeId)
  }, [deleteEdge])
  const handleReorderUpstreamReference = React.useCallback((draggedEdgeId: string, targetEdgeId: string) => {
    const currentIndex = upstreamReferenceItems.findIndex((item) => item.edgeId === draggedEdgeId)
    const targetIndex = upstreamReferenceItems.findIndex((item) => item.edgeId === targetEdgeId)
    if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) return
    const reordered = upstreamReferenceItems.slice()
    const [moved] = reordered.splice(currentIndex, 1)
    if (!moved) return
    reordered.splice(targetIndex, 0, moved)
    updateNodeData(id, {
      upstreamReferenceOrder: reordered.map((item) => item.sourceNodeId),
    })
  }, [id, updateNodeData, upstreamReferenceItems])
  const canvasZoom = useStore((state) => {
    if (!showBottomToolbar) return 1
    const zoom = state.transform[2]
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  })

  const clampFinite = (value: unknown, min: number, max: number, fallback: number) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, Math.round(n)))
  }

  const visualNodeDefaults = React.useMemo(() => {
    if (coreKind === 'video') return { width: 400, height: 225, minWidth: 240, maxWidth: 960, minHeight: 160, maxHeight: 720 }
    if (isStoryboardEditorNode) return { width: 560, height: 470, minWidth: 360, maxWidth: 960, minHeight: 260, maxHeight: 760 }
    if (kind === 'imageEdit') return { width: 320, height: 220, minWidth: 180, maxWidth: 420, minHeight: 120, maxHeight: 420 }
    return { width: 120, height: 210, minWidth: 110, maxWidth: 420, minHeight: 90, maxHeight: 420 }
  }, [coreKind, isStoryboardEditorNode, kind])

  const nodeWidth = isResizableVisualNode
    ? clampFinite((data as any)?.nodeWidth, visualNodeDefaults.minWidth, visualNodeDefaults.maxWidth, visualNodeDefaults.width)
    : isPlainTextNode
      ? clampFinite((data as any)?.nodeWidth, 340, 620, TEXT_NODE_DEFAULT_WIDTH)
    : typeof (data as any)?.nodeWidth === 'number' && Number.isFinite((data as any)?.nodeWidth)
      ? Math.max(320, Math.min(720, Number((data as any)?.nodeWidth)))
      : coreKind === 'video' ? 400 : 360

  const nodeHeight = isResizableVisualNode
    ? clampFinite((data as any)?.nodeHeight, visualNodeDefaults.minHeight, visualNodeDefaults.maxHeight, visualNodeDefaults.height)
    : null
  const toolbarBaseWidth = useMediaFocusToolbar ? 650 : 380
  const toolbarMinScale = 220 / toolbarBaseWidth
  const toolbarScale = Math.max(toolbarMinScale, canvasZoom)
  const toolbarWidthCss = `min(${toolbarBaseWidth}px, calc((100vw - 48px) / ${toolbarScale}))`
  const toolbarMaxHeightCss = `calc(60vh / ${toolbarScale})`
  const textNodeHeight = isPlainTextNode
    ? clampFinite((data as any)?.nodeHeight, TEXT_NODE_MIN_HEIGHT, TEXT_NODE_MAX_HEIGHT, TEXT_NODE_DEFAULT_HEIGHT)
    : null

  const variantsOpen = Boolean((data as any)?.variantsOpen)
  const variantsBaseWidthRaw = Number((data as any)?.variantsBaseWidth)
  const variantsBaseHeightRaw = Number((data as any)?.variantsBaseHeight)
  const variantsBaseWidth = Number.isFinite(variantsBaseWidthRaw) && variantsBaseWidthRaw > 0 ? variantsBaseWidthRaw : null
  const variantsBaseHeight = Number.isFinite(variantsBaseHeightRaw) && variantsBaseHeightRaw > 0 ? variantsBaseHeightRaw : null

  const storyboardCount = React.useMemo(() => {
    if (kind === 'novelStoryboard') {
      const raw = Number((data as any)?.storyboardCount)
      if (Number.isFinite(raw)) return Math.max(1, Math.min(25, Math.floor(raw)))
      const promptsLen = Array.isArray((data as any)?.storyboardShotPrompts)
        ? (data as any).storyboardShotPrompts.length
        : 0
      if (promptsLen > 0) return Math.max(1, Math.min(25, Math.floor(promptsLen)))
      return 1
    }
    if (kind !== 'storyboardImage') return 4
    const raw = Number((data as any)?.storyboardCount)
    if (!Number.isFinite(raw)) return 4
    return Math.max(4, Math.min(16, Math.floor(raw)))
  }, [data, kind])

  const storyboardImageAspectRatio =
    (kind === 'storyboardImage' || kind === 'novelStoryboard') && String((data as any)?.storyboardAspectRatio || '16:9') === '9:16'
      ? '9:16'
      : '16:9'
  const storyboardImageStyle = kind === 'storyboardImage' || kind === 'novelStoryboard' ? String((data as any)?.storyboardStyle || 'realistic') : 'realistic'
  const isNovelStoryboardNode = kind === 'novelStoryboard'
  const handleMediaResizeEnd = React.useCallback(
    (_event: unknown, params: NodeResizeEndParams) => {
      const nextWidth = clampFinite(params?.width, visualNodeDefaults.minWidth, visualNodeDefaults.maxWidth, nodeWidth)
      const nextHeight = clampFinite(params?.height, visualNodeDefaults.minHeight, visualNodeDefaults.maxHeight, nodeHeight ?? visualNodeDefaults.height)
      if (Math.abs(nextWidth - nodeWidth) <= 1 && Math.abs(nextHeight - (nodeHeight ?? visualNodeDefaults.height)) <= 1) {
        return
      }
      updateNodeData(id, {
        nodeWidth: nextWidth,
        nodeHeight: nextHeight,
      })
    },
    [clampFinite, id, nodeHeight, nodeWidth, updateNodeData, visualNodeDefaults.height, visualNodeDefaults.maxHeight, visualNodeDefaults.maxWidth, visualNodeDefaults.minHeight, visualNodeDefaults.minWidth],
  )

  const parseStoryboardShotsFromText = React.useCallback((text: string): string[] => {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const shots: string[] = []
    const shotsByNo = new Map<number, string>()
    for (const line of lines) {
      if (/^\d+\s*[-~到]\s*\d+\s*秒\s*[：:]/.test(line) || /^\d+\s*秒\s*[：:]/.test(line)) continue
      const tableMatch =
        line.match(/^\|\s*\*{0,2}S?(\d{1,3})\*{0,2}\s*\|\s*(.+?)\s*\|/i) ||
        line.match(/^\|\s*\*{0,2}镜头\s*(\d{1,3})\*{0,2}\s*\|\s*(.+?)\s*\|/i)
      if (tableMatch) {
        const no = Number(tableMatch[1] || '')
        const shot = String(tableMatch[2] || '').trim()
        if (shot && Number.isFinite(no) && no > 0) {
          if (!shotsByNo.has(no)) shotsByNo.set(no, shot)
          continue
        }
      }
      const boldSectionMatch = line.match(/^\*{1,2}\s*S?(\d{1,3})\s*[｜|:：\-]\s*(.+?)\s*\*{1,2}$/i)
      if (boldSectionMatch) {
        const no = Number(boldSectionMatch[1] || '')
        const shot = String(boldSectionMatch[2] || '').trim()
        if (shot && Number.isFinite(no) && no > 0) {
          if (!shotsByNo.has(no)) shotsByNo.set(no, shot)
          continue
        }
      }
      const m =
        line.match(/^(?:[-*]\s*)?(?:镜头|分镜)\s*(\d+)?\s*[：:.\u3001-]?\s*(.+)$/) ??
        line.match(/^Shot\s+(\d+)\s*[:.-]\s*(.+)$/i) ??
        line.match(/^#{1,6}\s*(?:镜头|分镜)\s*(\d+)\s*[：:.\u3001-]?\s*(.+)$/) ??
        line.match(/^\s*S?(\d{1,3})\s*[｜|:：]\s*(.+)$/i)
      const no = Number(m?.[1] || '')
      const shot = String(m?.[2] || '').trim()
      if (!shot) continue
      if (Number.isFinite(no) && no > 0) {
        if (!shotsByNo.has(no)) shotsByNo.set(no, shot)
      } else {
        shots.push(shot)
      }
    }
    if (shotsByNo.size) {
      return Array.from(shotsByNo.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, s]) => s)
        .filter(Boolean)
    }
    // Parse section style output: ### S01 ... + bullet lines
    const sections: Array<{ no: number; lines: string[] }> = []
    let current: { no: number; lines: string[] } | null = null
    for (const line of lines) {
      const hm =
        line.match(/^#{1,6}\s*\*{0,2}\s*S?(\d{1,3})\b/i) ||
        line.match(/^#{1,6}\s*\*{0,2}(?:镜头|分镜)\s*(\d{1,3})\b/i) ||
        line.match(/^\*{0,2}\s*S(\d{1,3})\b/i)
      if (hm) {
        if (current) sections.push(current)
        current = { no: Math.trunc(Number(hm[1])), lines: [] }
        continue
      }
      if (current) current.lines.push(line)
    }
    if (current) sections.push(current)
    if (sections.length) {
      const sectionShots = sections
        .sort((a, b) => a.no - b.no)
        .map((sec) => {
          const normalizedLines = sec.lines
            .map((ln) => ln.replace(/^[-*]\s*/, '').trim())
            .filter(Boolean)
          const sceneLine =
            normalizedLines.find((ln) => /^(画面|scene)\s*[：:]/i.test(ln)) ||
            normalizedLines.find((ln) => !/^(镜头运动|时长|台词|字幕|音效|转场|production|qc)/i.test(ln))
          if (!sceneLine) return ''
          return sceneLine.replace(/^(画面|scene)\s*[：:]\s*/i, '').trim()
        })
        .filter(Boolean)
      if (sectionShots.length) return sectionShots
    }
    return shots
  }, [])
  const sanitizeNovelStoryboardShots = React.useCallback((shots: string[]): string[] => {
    const isNoise = (line: string) => {
      const v = String(line || '').trim()
      if (!v) return true
      if (/^#{1,6}\s+/.test(v)) return true
      if (/^\|.*\|$/.test(v)) return true
      if (/^[-*_]{3,}$/.test(v)) return true
      if (/^(统一参数|结构化分镜脚本|镜头列表|生产建议|全镜头通用约束|每镜头图像提示词|每镜头视频提示词)\b/i.test(v)) return true
      if (/同时标注内容分级|避免露骨|已根据素材完成续写分镜|整合\s*\d+\s*-\s*\d+\s*连续可执行稿/i.test(v)) return true
      if (/^角色一致性固定串/i.test(v)) return true
      if (/^(?:-|•)?\s*(?:唯|萧夜|真宫寺唯|鸣神素子|萧羽)\s*[：:]/i.test(v)) return true
      if (/^(?:-|•)?\s*(?:风格|style)\s*[：:]/i.test(v)) return true
      if (/加载\s*TapCanvas\s*能力技能|基于小说正文与已完成|产出新增镜头|可执行分镜包|避免重复/i.test(v)) return true
      if (/^(镜头|分镜)\s*[；;|]/.test(v)) return true
      if (/^(plan|note|tips?|prompt list|shot list|act|report)[:：]?$/i.test(v)) return true
      if (/第\d+章(电影级写实镜头|人物交互镜头|情绪推进镜头|转场收束镜头)/.test(v)) return true
      return false
    }
    return (Array.isArray(shots) ? shots : [])
      .map((x) => String(x || '').trim())
      .filter((x) => x && !isNoise(x))
  }, [])

  const storyboardShotPromptsForDrag = React.useMemo(() => {
    if (!(isNovelStoryboardNode || kind === 'storyboardImage')) return [] as string[]
    const maxShots = isNovelStoryboardNode ? 25 : 24
    const explicit = Array.isArray((data as any)?.storyboardShotPrompts)
      ? ((data as any).storyboardShotPrompts as unknown[])
          .map((x) => String(x || '').trim())
          .filter(Boolean)
      : []
    if (explicit.length) return explicit.slice(0, maxShots)
    const fromScript = parseStoryboardShotsFromText(String((data as any)?.storyboardScript || prompt || ''))
    return fromScript.slice(0, maxShots)
  }, [data, isNovelStoryboardNode, kind, parseStoryboardShotsFromText, prompt])

  const novelStoryboardShots = React.useMemo(() => {
    if (!isNovelStoryboardNode) return [] as string[]
    return storyboardShotPromptsForDrag
  }, [isNovelStoryboardNode, storyboardShotPromptsForDrag])

  const upsertNovelStoryboardShots = React.useCallback((nextShots: string[]) => {
    const maxShots = isNovelStoryboardNode ? 25 : 24
    const normalized = nextShots
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .slice(0, maxShots)
    const count = Math.max(1, normalized.length)
    const script = normalized
      .map((shot, idx) => `镜头 ${idx + 1}：${shot}`)
      .join('\n')
    setPrompt(script)
    updateNodeData(id, {
      prompt: script,
      storyboardScript: script,
      storyboardShotPrompts: normalized,
      storyboardCount: isNovelStoryboardNode
        ? Math.max(1, Math.min(25, count))
        : Math.max(4, Math.min(16, count)),
    })
  }, [id, isNovelStoryboardNode, updateNodeData])

  const stripUrlsFromText = React.useCallback((text: string): string => {
    return String(text || '')
      .replace(/https?:\/\/[^\s；;，,]+/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .trim()
  }, [])

  const novelStoryboardProgressMeta = React.useMemo(() => {
    if (!isNovelStoryboardNode) return null
    const projectId = String(currentProject?.id || '').trim()
    const bookId = String((data as any)?.sourceBookId || '').trim()
    const taskIdFromData = String((data as any)?.storyboardTaskId || (data as any)?.storyboardPlanId || '').trim()
    const chapterRaw = Number((data as any)?.chapter ?? (data as any)?.materialChapter)
    const chapter = Number.isFinite(chapterRaw) ? Math.max(1, Math.trunc(chapterRaw)) : 0
    const taskId = taskIdFromData
    const shotEndRaw = Number((data as any)?.storyboardShotEnd)
    const currentShotEnd = Number.isFinite(shotEndRaw) ? Math.max(0, Math.trunc(shotEndRaw)) : 0
    if (!projectId || !bookId || !taskId) return null
    return { projectId, bookId, taskId, chapter, currentShotEnd }
  }, [currentProject?.id, data, isNovelStoryboardNode])

  const [novelStoryboardContinueLoading, setNovelStoryboardContinueLoading] = React.useState(false)
  const novelStoryboardCanGenerateNext = React.useMemo(
    () => !!novelStoryboardProgressMeta,
    [novelStoryboardProgressMeta],
  )
  const novelStoryboardSessionId = React.useMemo(() => {
    if (!novelStoryboardProgressMeta) return ''
    return `creation:${novelStoryboardProgressMeta.projectId}:${novelStoryboardProgressMeta.bookId}:${novelStoryboardProgressMeta.taskId}`
  }, [novelStoryboardProgressMeta])
  const novelStoryboardCurrentIndex = React.useMemo(() => {
    const chunkIndexRaw = Number((data as Record<string, unknown>)?.storyboardChunkIndex)
    return Number.isFinite(chunkIndexRaw) ? Math.max(1, Math.trunc(chunkIndexRaw) + 1) : 0
  }, [data])
  const novelStoryboardTotalUnits = React.useMemo(() => {
    const totalRaw = Number((data as Record<string, unknown>)?.storyboardTotalChunks)
    return Number.isFinite(totalRaw) ? Math.max(0, Math.trunc(totalRaw)) : 0
  }, [data])

  const handleGenerateNovelStoryboardNextChunk = React.useCallback(async () => {
    if (!novelStoryboardProgressMeta || novelStoryboardContinueLoading) return
    setNovelStoryboardContinueLoading(true)
    try {
      type StoryboardHistoryItem = ProjectBookStoryboardHistoryDto['items'][number]
      const chapterNo = Math.max(1, Math.trunc(Number(novelStoryboardProgressMeta.chapter || 1)))
      const taskId = String(novelStoryboardProgressMeta.taskId || '').trim()
      const runTitle = `分镜渐进续写 · ${new Date().toLocaleString()}`
      const runGoal = '仅生成当前全书进度的下一组 25 镜头（从当前节点继续）'
      const beforeHistory = await listProjectBookStoryboardHistory(
        novelStoryboardProgressMeta.projectId,
        novelStoryboardProgressMeta.bookId,
        { taskId, limit: 240 },
      ).catch(() => null)
      const beforeItems = Array.isArray(beforeHistory?.items) ? beforeHistory.items : []
      const historyKey = (item: ProjectBookStoryboardHistoryDto['items'][number]) =>
        `${String(item.taskId || '').trim()}:${Math.max(1, Math.trunc(Number(item.shotNo || 1)))}`
      const beforeKeys = new Set(beforeItems.map(historyKey))

      const created = await createAgentPipelineRun({
        projectId: novelStoryboardProgressMeta.projectId,
        title: runTitle,
        goal: runGoal,
        stages: [
          'material_ingest',
          'script_breakdown',
          'storyboard_generation',
          'shot_planning',
          'image_generation',
          'video_generation',
          'qc_publish',
        ],
      })
      const variationHint = [
        '关键帧差异为强约束：任意相邻镜头在以下三项中至少显式变化两项：主体动作、镜头类型、机位运动。',
        '每个镜头提示词必须明确写出这三项：主体动作、镜头类型、机位运动，禁止留空或复用上一个镜头。',
      ].join('\n')
      const attemptPayloads = [
        { force: false, hint: '' },
        { force: true, hint: variationHint },
      ] as const
      let afterItems: StoryboardHistoryItem[] = []
      let lastRunError = ''
      let lastDoneResult: { result?: { storyboardContent?: unknown } } | null = null
      for (const attempt of attemptPayloads) {
        const done = await executeAgentPipelineRun(created.id, {
          force: attempt.force,
          systemPrompt: [UNIFIED_STORYBOARD_SYSTEM_HINT, attempt.hint].filter(Boolean).join('\n\n'),
          bookId: novelStoryboardProgressMeta.bookId,
          progress: {
            taskId,

            mode: 'single',
            groupSize: 25,
          },
        })
        lastDoneResult = done
        const status = String((done as any)?.status || '')
        const isFailed = status === 'failed' || status === 'canceled'
        lastRunError = String((done as any)?.errorMessage || '').trim()
        const refreshedHistory = await listProjectBookStoryboardHistory(
          novelStoryboardProgressMeta.projectId,
          novelStoryboardProgressMeta.bookId,
          { taskId, limit: 240 },
        ).catch(() => null)
        const currentItems = Array.isArray(refreshedHistory?.items) ? refreshedHistory.items : []
        const addedNow = currentItems.filter((item) => !beforeKeys.has(historyKey(item)))
        afterItems = currentItems
        if (addedNow.length > 0 || !isFailed) break
      }

      const addedItems = afterItems.filter((item) => !beforeKeys.has(historyKey(item)))
      const shotNoOf = (item: StoryboardHistoryItem) => Math.max(1, Math.trunc(Number(item.shotNo || 1)))
      const chapterOf = (item: StoryboardHistoryItem) => Math.max(1, Math.trunc(Number((item as any).chapter || chapterNo)))
      const taskOf = (item: StoryboardHistoryItem) => String(item.taskId || taskId).trim()
      const byShotNoAsc = (a: StoryboardHistoryItem, b: StoryboardHistoryItem) => shotNoOf(a) - shotNoOf(b)
      const dedupeByShotNo = (items: StoryboardHistoryItem[]) => {
        const pick = new Map<number, StoryboardHistoryItem>()
        for (const item of items) {
          const shotNo = shotNoOf(item)
          const prev = pick.get(shotNo)
          if (!prev) {
            pick.set(shotNo, item)
            continue
          }
          const prevTs = Date.parse(String(prev.updatedAt || prev.createdAt || ''))
          const curTs = Date.parse(String(item.updatedAt || item.createdAt || ''))
          if ((Number.isFinite(curTs) ? curTs : 0) >= (Number.isFinite(prevTs) ? prevTs : 0)) {
            pick.set(shotNo, item)
          }
        }
        return Array.from(pick.values()).sort(byShotNoAsc)
      }
      const groupByChunk = (items: StoryboardHistoryItem[]) => {
        const map = new Map<string, StoryboardHistoryItem[]>()
        for (const item of items) {
          const itemTaskId = taskOf(item)
          const chunkId = String(item.chunkId || '').trim()
          const chunkIndex = Math.max(0, Math.trunc(Number(item.chunkIndex || 0)))
          const key = `${itemTaskId}:${chunkId || `chunk-${chunkIndex}`}`
          if (!map.has(key)) map.set(key, [])
          map.get(key)!.push(item)
        }
        return map
      }
      const pickBestChunk = (items: StoryboardHistoryItem[]) => {
        const grouped = Array.from(groupByChunk(items).values()).map((group) => {
          const deduped = dedupeByShotNo(group)
          const maxShot = deduped.reduce((max, it) => Math.max(max, shotNoOf(it)), 0)
          const latestTs = deduped.reduce((max, it) => {
            const ts = Date.parse(String(it.updatedAt || it.createdAt || ''))
            return Math.max(max, Number.isFinite(ts) ? ts : 0)
          }, 0)
          return { items: deduped, count: deduped.length, maxShot, latestTs }
        })
        grouped.sort((a, b) => b.count - a.count || b.maxShot - a.maxShot || b.latestTs - a.latestTs)
        return grouped[0]?.items || []
      }

      const currentTaskNewItems = addedItems.filter((item) => taskOf(item) === taskId)
      const currentTaskAfterItems = afterItems.filter((item) => taskOf(item) === taskId)
      const afterCurrentShot = currentTaskAfterItems.filter((item) => shotNoOf(item) > novelStoryboardProgressMeta.currentShotEnd)
      const generatedBatch = pickBestChunk(
        currentTaskNewItems.length
          ? currentTaskNewItems
          : afterCurrentShot.length
            ? afterCurrentShot
            : currentTaskAfterItems.length
              ? currentTaskAfterItems
              : afterItems,
      )
      const effectiveBatch = generatedBatch
      if (!effectiveBatch.length) {
        throw new Error(lastRunError || '后端已执行但未产出可用分镜历史；禁止使用本地模板回退，请检查 agents 日志与上游产物')
      }

      const historyChapter = chapterOf(effectiveBatch[0])
      const normalizedBatch = dedupeByShotNo(effectiveBatch)
      const shotStart = shotNoOf(normalizedBatch[0])
      const shotEnd = shotNoOf(normalizedBatch[normalizedBatch.length - 1])
      const groupSize = Math.max(
        normalizedBatch.length,
        Math.max(1, Math.trunc(Number(normalizedBatch[0]?.groupSize || normalizedBatch.length))),
      )
      const chunkIndex = Math.max(0, Math.trunc(Number(normalizedBatch[0]?.chunkIndex || 0)))
      const nodeDataRecord = data as Record<string, unknown>
      const storyboardAspectRatio =
        typeof nodeDataRecord.storyboardAspectRatio === 'string' && nodeDataRecord.storyboardAspectRatio.trim()
          ? nodeDataRecord.storyboardAspectRatio.trim()
          : '16:9'
      const imageModelKey =
        typeof nodeDataRecord.imageModel === 'string' && nodeDataRecord.imageModel.trim()
          ? nodeDataRecord.imageModel.trim()
          : getDefaultModel('imageEdit')
      const storyboardStoryContext =
        typeof nodeDataRecord.storyboardStoryContext === 'string' && nodeDataRecord.storyboardStoryContext.trim()
          ? nodeDataRecord.storyboardStoryContext.trim()
          : undefined
      const storyboardPlanId =
        typeof nodeDataRecord.storyboardPlanId === 'string' && nodeDataRecord.storyboardPlanId.trim()
          ? nodeDataRecord.storyboardPlanId.trim()
          : undefined
      const replayChunkId = buildReplayStoryboardChunkId({
        taskId,
        chunkId: normalizedBatch[0]?.chunkId,
        chunkIndex,
      })

      type ReplayShotItem = {
        shotNo: number
        frameIndex: number
        script: string
        imageUrl: string
        roleAnchorUrls: string[]
        referenceBindings: StoryboardReferenceBinding[]
      }

      const shotItems: ReplayShotItem[] = normalizedBatch.map((item, index) => {
        const shotNo = shotNoOf(item)
        const script = String(item.script || '').trim()
        if (!script) {
          throw new Error(`分镜历史缺少脚本：shotNo=${shotNo}`)
        }
        const imageUrl = String(item.selectedImageUrl || item.imageUrl || '').trim()
        const roleBindings = Array.isArray(item.roleCardAnchors)
          ? item.roleCardAnchors.map((anchor) => ({
              kind: 'role' as const,
              refId: String(anchor.cardId || '').trim() || undefined,
              label: String(anchor.roleName || '').trim() || '角色锚点',
              imageUrl: String(anchor.imageUrl || '').trim(),
            }))
          : []
        const genericReferenceBindings = Array.isArray(item.references)
          ? item.references.map((reference) => ({
              kind: 'reference' as const,
              label: String(reference.label || '').trim() || '参考图',
              imageUrl: String(reference.url || '').trim(),
            }))
          : []
        const referenceBindings = normalizeStoryboardReferenceBindings([
          ...roleBindings,
          ...genericReferenceBindings,
        ])
        const roleAnchorUrls = roleBindings
          .map((binding) => String(binding.imageUrl || '').trim())
          .filter(Boolean)
        const shotIndexRaw = Number(item.shotIndexInChunk)
        const frameIndex =
          Number.isFinite(shotIndexRaw) && shotIndexRaw >= 0
            ? Math.trunc(shotIndexRaw)
            : Math.max(0, shotNo - shotStart || index)
        return {
          shotNo,
          frameIndex,
          script,
          imageUrl,
          roleAnchorUrls,
          referenceBindings,
        }
      })

      const imageShotItems = shotItems.filter((item) => item.imageUrl)
      const roleRefs = Array.from(new Set(shotItems.flatMap((item) => item.roleAnchorUrls))).slice(0, 8)
      const storyboardShotPrompts = shotItems.map((item) => item.script)
      const storyboardScript = buildStoryboardChunkScript(shotItems)
      const tailFrameUrl = imageShotItems.length > 0 ? imageShotItems[imageShotItems.length - 1]?.imageUrl || '' : ''
      const chunkReferenceBindings = normalizeStoryboardReferenceBindings([
        ...(tailFrameUrl
          ? [{ kind: 'continuity_tail' as const, label: '本组尾帧', imageUrl: tailFrameUrl }]
          : []),
        ...shotItems.flatMap((item) => item.referenceBindings),
      ])
      const protocolGroupSize = normalizeStoryboardSelectionProtocolGroupSize(groupSize)
      const buildChunkSelectionContext = (input?: { title?: string; imageUrl?: string }): StoryboardSelectionContext => (
        buildStoryboardSelectionContextOrThrow({
          scope: 'chunk',
          taskId,
          planId: storyboardPlanId,
          chunkId: replayChunkId,
          chunkIndex,
          groupSize: protocolGroupSize,
          shotStart,
          shotEnd,
          title: typeof input?.title === 'string' && input.title.trim() ? input.title.trim() : undefined,
          imageUrl: typeof input?.imageUrl === 'string' && input.imageUrl.trim() ? input.imageUrl.trim() : undefined,
          sourceBookId: novelStoryboardProgressMeta.bookId,
          materialChapter: historyChapter,
          storyContext: storyboardStoryContext,
          storyboardScript,
          modelKey: imageModelKey,
          aspectRatio: storyboardAspectRatio,
          referenceBindings: chunkReferenceBindings.length > 0 ? chunkReferenceBindings : undefined,
        })
      )
      const buildFrameSelectionContext = (
        shotItem: ReplayShotItem,
        input?: { title?: string; imageUrl?: string },
      ): StoryboardSelectionContext => (
        buildStoryboardSelectionContextOrThrow({
          scope: 'frame',
          taskId,
          planId: storyboardPlanId,
          chunkId: replayChunkId,
          chunkIndex,
          groupSize: protocolGroupSize,
          shotStart,
          shotEnd,
          shotNo: shotItem.shotNo,
          frameIndex: shotItem.frameIndex,
          title: typeof input?.title === 'string' && input.title.trim() ? input.title.trim() : undefined,
          imageUrl:
            typeof input?.imageUrl === 'string' && input.imageUrl.trim()
              ? input.imageUrl.trim()
              : shotItem.imageUrl || undefined,
          sourceBookId: novelStoryboardProgressMeta.bookId,
          materialChapter: historyChapter,
          storyContext: storyboardStoryContext,
          shotPrompt: shotItem.script,
          storyboardScript,
          modelKey: imageModelKey,
          aspectRatio: storyboardAspectRatio,
          referenceBindings:
            shotItem.referenceBindings.length > 0
              ? shotItem.referenceBindings
              : chunkReferenceBindings.length > 0
                ? chunkReferenceBindings
                : undefined,
        })
      )
      const imageResults = imageShotItems.map((item) => ({
        url: item.imageUrl,
        title: `镜头 ${item.shotNo}`,
        shotPrompt: item.script,
        storyboardSelectionContext: buildFrameSelectionContext(item, {
          title: `镜头 ${item.shotNo}`,
          imageUrl: item.imageUrl,
        }),
      }))
      const primaryImageUrl = imageResults[0]?.url || ''
      const primaryShotNo = imageShotItems[0]?.shotNo || shotStart
      const chunkSelectionContext = buildChunkSelectionContext({
        title: `分镜续写 · 任务 ${taskId} 镜头${shotStart}-${shotEnd}`,
        imageUrl: primaryImageUrl || undefined,
      })

      const createReplayTaskNode = (label: string, payload: Record<string, unknown>): string => {
        const before = new Set(useRFStore.getState().nodes.map((n) => String(n.id || '').trim()))
        addNode('taskNode', label, payload)
        const created = useRFStore
          .getState()
          .nodes
          .find((n) => !before.has(String(n.id || '').trim()))
        return created?.id ? String(created.id) : ''
      }

      const shotScriptNodeIds = shotItems
        .map((item, idx) => (
          createReplayTaskNode(
            `镜头脚本 ${item.shotNo} · 任务 ${taskId}`,
            {
              kind: 'storyboardScript',
              autoLabel: false,
              prompt: item.script,
              textBackgroundColor: idx % 2 === 0 ? '#eff6ff' : '#f8fafc',
              sourceBookId: novelStoryboardProgressMeta.bookId,
              storyboardTaskId: taskId,
              chapter: historyChapter,
              materialChapter: historyChapter,
              source: 'novel_storyboard_pipeline_replay_shot',
              storyboardGroupSize: groupSize,
              storyboardChunkIndex: chunkIndex,
              storyboardShotStart: item.shotNo,
              storyboardShotEnd: item.shotNo,
              storyboardShotNo: item.shotNo,
              storyboardSelectionContext: buildFrameSelectionContext(item, {
                title: `镜头脚本 ${item.shotNo} · 任务 ${taskId}`,
              }),
              status: 'success',
              progress: 100,
              nodeWidth: 250,
              nodeHeight: 105,
            },
          )
        ))
        .filter(Boolean)

      const anchorNodeId = roleRefs.length
        ? createReplayTaskNode(
            `角色锚点 · 任务 ${taskId} 镜头${shotStart}-${shotEnd}`,
            {
              kind: 'image',
              autoLabel: false,
              sourceBookId: novelStoryboardProgressMeta.bookId,
              storyboardTaskId: taskId,
              chapter: historyChapter,
              materialChapter: historyChapter,
              source: 'novel_storyboard_pipeline_anchor',
              roleCardReferenceImages: roleRefs,
              imageUrl: roleRefs[0],
              imagePrimaryIndex: 0,
              imageResults: roleRefs.map((url, idx) => ({ url, title: `角色锚点 ${idx + 1}` })),
              storyboardSelectionContext: buildChunkSelectionContext({
                title: `角色锚点 · 任务 ${taskId} 镜头${shotStart}-${shotEnd}`,
                imageUrl: roleRefs[0],
              }),
              status: 'success',
              progress: 100,
              nodeWidth: 320,
              nodeHeight: 210,
            },
          )
        : ''

      const storyboardNodeId = createReplayTaskNode(`分镜续写 · 任务 ${taskId} 镜头${shotStart}-${shotEnd}`, {
        kind: 'novelStoryboard',
        autoLabel: false,
        storyboardCount: groupSize,
        storyboardAspectRatio,
        storyboardStyle: 'realistic',
        imageModel: imageModelKey,
        storyboardScript,
        storyboardShotPrompts,
        storyboardChunkNarrative: storyboardShotPrompts.join('；'),
        storyboardStoryContext: storyboardStoryContext || undefined,
        sourceBookId: novelStoryboardProgressMeta.bookId,
        roleCardReferenceImages: roleRefs.length ? roleRefs : undefined,
        storyboardTaskId: taskId,
        storyboardPlanId: storyboardPlanId || undefined,
        chapter: historyChapter,
        materialChapter: historyChapter,
        source: 'novel_storyboard_history',
        storyboardGroupSize: groupSize,
        storyboardChunkIndex: chunkIndex,
        storyboardShotStart: shotStart,
        storyboardShotEnd: shotEnd,
        storyboardSelectionContext: chunkSelectionContext,
        imageUrl: primaryImageUrl || undefined,
        imagePrimaryIndex: primaryImageUrl ? 0 : undefined,
        imageResults,
        storyboardShotNo: primaryShotNo,
        status: 'success',
        progress: 100,
      })
      if (!storyboardNodeId) {
        toast('创建后续分镜节点失败', 'error')
        return
      }
      const scriptGroupNodeIds = [...shotScriptNodeIds, anchorNodeId].filter(Boolean)
      const afterAdd = useRFStore.getState()
      const newNode = afterAdd.nodes.find((n) => String(n.id || '') === storyboardNodeId)
      if (!newNode) return

      const sourceNode = afterAdd.nodes.find((n) => n.id === id) as any
      const targetGroupId = String(sourceNode?.parentId || '').trim()
      if (targetGroupId) {
        const siblings = afterAdd.nodes.filter((n: any) => !scriptGroupNodeIds.includes(String(n.id || '')) && String(n?.parentId || '') === targetGroupId)
        const baseX = Number(sourceNode?.position?.x || 0)
        const baseY = Number(sourceNode?.position?.y || 0)
        const maxY = siblings.reduce((max, n: any) => Math.max(max, Number(n?.position?.y || 0)), baseY)
        const startY = maxY + 150
        const replayPositions = new Map<string, { x: number; y: number }>()
        shotScriptNodeIds.forEach((nodeId, idx) => {
          const col = idx % 5
          const row = Math.floor(idx / 5)
          replayPositions.set(nodeId, { x: baseX + col * 260, y: startY + row * 120 })
        })
        const scriptRows = Math.max(1, Math.ceil(Math.max(1, shotScriptNodeIds.length) / 5))
        const anchorY = startY + scriptRows * 120 + 24
        if (anchorNodeId) replayPositions.set(anchorNodeId, { x: baseX, y: anchorY })
        useRFStore.setState((s: any) => ({
          ...s,
          nodes: s.nodes.map((n: any) => (
            replayPositions.has(String(n.id || ''))
              ? {
                  ...n,
                  position: replayPositions.get(String(n.id || ''))!,
                  parentId: targetGroupId,
                  extent: sourceNode.extent,
                  selected: n.id === storyboardNodeId,
                }
              : {
                  ...n,
                  selected: n.id === storyboardNodeId,
            }
          )),
        }))
        if (scriptGroupNodeIds.length >= 2) {
          afterAdd.arrangeGroupChildren(targetGroupId, 'grid', scriptGroupNodeIds)
        }
        const latest = useRFStore.getState().nodes
        const parentGroup = latest.find((n: any) => String(n?.id || '') === targetGroupId)
        const groupW = Math.max(980, Math.round(Number((parentGroup as any)?.style?.width || (parentGroup as any)?.measured?.width || 980)))
        useRFStore.setState((s: any) => ({
          ...s,
          nodes: s.nodes.map((n: any) => (
            String(n?.id || '') === storyboardNodeId
              ? {
                  ...n,
                  parentId: undefined,
                  extent: undefined,
                  position: { x: baseX + groupW + 32, y: baseY + 8 },
                }
              : n
          )),
        }))
      } else {
        const baseX = Number(sourceNode?.position?.x || 0) + 240
        const baseY = Number(sourceNode?.position?.y || 0)
        const posById = new Map<string, { x: number; y: number }>()
        shotScriptNodeIds.forEach((nodeId, idx) => {
          const col = idx % 5
          const row = Math.floor(idx / 5)
          posById.set(nodeId, { x: baseX + col * 260, y: baseY + row * 120 - 180 })
        })
        const scriptRows = Math.max(1, Math.ceil(Math.max(1, shotScriptNodeIds.length) / 5))
        const anchorY = baseY + scriptRows * 120 - 40
        if (anchorNodeId) posById.set(anchorNodeId, { x: baseX, y: anchorY })
        const changes = Array.from(posById.entries()).flatMap(([nodeId, position]) => ([
          { id: nodeId, type: 'position' as const, position, dragging: false },
          { id: nodeId, type: 'select' as const, selected: nodeId === storyboardNodeId },
        ]))
        afterAdd.onNodesChange(changes)
        const scriptAreaWidth = Math.max(980, Math.ceil(Math.max(1, shotScriptNodeIds.length) / 5) * 260)
        afterAdd.onNodesChange([
          {
            id: storyboardNodeId,
            type: 'position',
            position: { x: baseX + scriptAreaWidth + 32, y: baseY - 40 },
            dragging: false,
          },
          { id: storyboardNodeId, type: 'select', selected: true },
        ])
      }

      afterAdd.onConnect({
        source: id,
        sourceHandle: 'out-image-wide',
        target: storyboardNodeId,
        targetHandle: 'in-image-wide',
      })
      shotScriptNodeIds.forEach((nodeId, idx) => {
        if (idx === 0) return
        afterAdd.onConnect({
          source: shotScriptNodeIds[idx - 1],
          sourceHandle: 'out-text',
          target: nodeId,
          targetHandle: 'in-text',
        })
      })
      shotScriptNodeIds.forEach((nodeId) => {
        afterAdd.onConnect({
          source: nodeId,
          sourceHandle: 'out-text',
          target: storyboardNodeId,
          targetHandle: 'in-image-wide',
        })
      })
      if (anchorNodeId) {
        afterAdd.onConnect({
          source: anchorNodeId,
          sourceHandle: 'out-image-wide',
          target: storyboardNodeId,
          targetHandle: 'in-image-wide',
        })
      }
      toast(`已创建后续分镜节点（任务 ${taskId} · 镜头${shotStart}-${shotEnd}）`, 'success')
    } catch (err: any) {
      console.error(err)
      toast(err?.message || '生成后续分镜失败', 'error')
    } finally {
      setNovelStoryboardContinueLoading(false)
    }
  }, [addNode, data, id, novelStoryboardContinueLoading, novelStoryboardProgressMeta, parseStoryboardShotsFromText])

  React.useEffect(() => {
    if (!isNovelStoryboardNode || !novelStoryboardProgressMeta || !novelStoryboardSessionId) return
    if (status === 'running' || status === 'queued') {
      syncCreationSessionCheckpoint({
        id: novelStoryboardSessionId,
        title: novelStoryboardProgressMeta.chapter > 0 ? `AI 创作 · 第${novelStoryboardProgressMeta.chapter}章` : 'AI 创作',
        status: 'running',
        unitType: 'storyboard_chunk',
        currentIndex: Math.max(0, novelStoryboardCurrentIndex),
        total: novelStoryboardTotalUnits,
        currentNodeId: id,
        currentTaskId: novelStoryboardProgressMeta.taskId,
        summary: novelStoryboardCurrentIndex > 0
          ? `正在生成第 ${novelStoryboardCurrentIndex} 个创作单元`
          : '正在生成当前创作单元',
        updatedAt: Date.now(),
      })
      return
    }
    if (status === 'success' && novelStoryboardCanGenerateNext) {
      syncCreationSessionCheckpoint({
        id: novelStoryboardSessionId,
        title: novelStoryboardProgressMeta.chapter > 0 ? `AI 创作 · 第${novelStoryboardProgressMeta.chapter}章` : 'AI 创作',
        status: 'paused',
        unitType: 'storyboard_chunk',
        currentIndex: Math.max(0, novelStoryboardCurrentIndex),
        total: novelStoryboardTotalUnits,
        currentNodeId: id,
        currentTaskId: novelStoryboardProgressMeta.taskId,
        summary: novelStoryboardCurrentIndex > 0
          ? `第 ${novelStoryboardCurrentIndex} 个创作单元已生成。可在节点上直接继续下一单元。`
          : '当前创作单元已生成。可在节点上直接继续。',
        updatedAt: Date.now(),
      })
      return
    }
    if (status === 'error') {
      failCreationSession(String((data as Record<string, unknown>)?.lastError || '创作单元执行失败'))
    }
  }, [
    data,
    failCreationSession,
    handleGenerateNovelStoryboardNextChunk,
    id,
    isNovelStoryboardNode,
    novelStoryboardCanGenerateNext,
    novelStoryboardCurrentIndex,
    novelStoryboardProgressMeta,
    novelStoryboardSessionId,
    novelStoryboardTotalUnits,
    status,
    syncCreationSessionCheckpoint,
  ])
  const migrateLegacyStoryboardToNovel = React.useCallback(() => {
    if (kind !== 'storyboardImage') return
    const script = String((data as any)?.storyboardScript || prompt || '').trim()
    const parsed = parseStoryboardShotsFromText(script)
    const existingShots = Array.isArray((data as any)?.storyboardShotPrompts)
      ? ((data as any).storyboardShotPrompts as unknown[]).map((x) => String(x || '').trim()).filter(Boolean)
      : []
    const shotPrompts = (existingShots.length ? existingShots : parsed).slice(0, 25)
    updateNodeData(id, {
      kind: 'novelStoryboard',
      novelStoryboardCollapsed: false,
      ...(shotPrompts.length ? { storyboardShotPrompts: shotPrompts } : null),
      ...(script ? { storyboardScript: script, prompt: script } : null),
    })
    toast('已迁移为小说分镜节点', 'success')
  }, [data, id, kind, parseStoryboardShotsFromText, prompt, updateNodeData])

  const imageProps = {
    nodeId: id,
    nodeKind: kind,
    selected: isSingleSelectionActive,
    nodeWidth,
    nodeHeight: nodeHeight ?? visualNodeDefaults.height,
    variantsOpen,
    variantsBaseWidth,
    variantsBaseHeight,
    hasPrimaryImage,
    imageResults,
    imagePrimaryIndex,
    primaryImageUrl,
    fileRef,
    canUpload: supportsImageUpload,
    uploading: isUploadingImage,
    onUpload: handleImageUpload,
    onSelectPrimary: (idx: number, url: string) => {
      setImagePrimaryIndex(idx)
      updateNodeData(id, { imageUrl: url, imagePrimaryIndex: idx })
    },
    adoptedImageIndex,
    isPrimaryImageAdopted,
    onAdoptImage: (idx: number) => {
      const target = imageResults[idx]
      if (!target) return
      updateNodeData(id, {
        adoptedImageAsset: {
          index: idx,
          url: target.url,
          adoptedAt: new Date().toISOString(),
          progress: typeof data?.progress === 'number' && Number.isFinite(data.progress) ? data.progress : null,
        } satisfies AdoptedAssetMetadata,
      })
      toast(`已采纳第 ${idx + 1} 张图片`, 'success')
    },
    compact: hideImageMeta,
    showStateOverlay: showImageStateOverlay,
    stateLabel: imageStateLabel,
    onUpdateNodeData: (patch: Record<string, any>) => updateNodeData(id, patch),
    nodeShellText,
    darkCardShadow,
    mediaOverlayText,
    subtleOverlayBackground,
    imageUrl,
    themeWhite: theme.white,
    imageEditPreview,
  }

  const handleEditSingleShot = React.useCallback((input: { url: string; label: string; sourceIndex?: number }) => {
    const shotUrl = String(input?.url || '').trim()
    if (!shotUrl) {
      toast('镜头图片地址无效，无法编辑', 'error')
      return
    }
    if (typeof input.sourceIndex !== 'number' || input.sourceIndex < 0) {
      toast('当前镜头来源不可编辑，请先完成分镜生图再试', 'warning')
      return
    }
    const sourceIndex = input.sourceIndex
    const primaryTitle =
      imageResults[imagePrimaryIndex] && typeof imageResults[imagePrimaryIndex]?.title === 'string'
        ? String(imageResults[imagePrimaryIndex]?.title || '').trim()
        : ''
    const primaryIsShot = primaryTitle.startsWith('镜头')
    const shotSourceOffset =
      (kind === 'novelStoryboard' || kind === 'storyboardImage')
        ? (primaryIsShot ? Math.max(0, imagePrimaryIndex) : (imagePrimaryIndex >= 0 ? imagePrimaryIndex + 1 : 1))
        : 0
    const shotPromptIndex = Math.max(0, sourceIndex - shotSourceOffset)
    const shotPrompt = String(novelStoryboardShots[shotPromptIndex] || '').trim()
    const repairPrompt = [
      '请先理解参考图中当前镜头的构图与角色，再执行定向修复。',
      '任务目标：只修复不合理细节，保持角色身份、画风、服装、光线与镜头意图连续。',
      shotPrompt ? `当前镜头脚本：${shotPrompt}` : '',
      '修复要求：构图不偏移、人物不换脸、不新增无关元素、避免畸形肢体与错误透视。',
      '输出：仅返回1张修复后的镜头图。',
    ]
      .filter(Boolean)
      .join('\n')
    editingShotSourceIndexRef.current = sourceIndex
    setEditingShotSourceIndex(sourceIndex)
    handlePoseSaved({
      poseStickmanUrl: null,
      poseReferenceImages: [shotUrl],
      baseImageUrl: shotUrl,
      prompt: repairPrompt,
    })
  }, [handlePoseSaved, imagePrimaryIndex, kind, novelStoryboardShots])

  const storyboardImageProps = {
    nodeId: id,
    nodePrompt: prompt,
    storyboardScript: String((data as any)?.storyboardScript || prompt || '').trim(),
    storyboardShotPrompts: storyboardShotPromptsForDrag,
    nodeWidth,
    nodeHeight: nodeHeight ?? visualNodeDefaults.height,
    variantsOpen,
    variantsBaseWidth,
    variantsBaseHeight,
    imageResults,
    imagePrimaryIndex,
    primaryImageUrl,
    storyboardCount,
    onUpdateNodeData: (patch: Record<string, any>) => updateNodeData(id, patch),
    showStateOverlay: showImageStateOverlay,
    stateLabel: imageStateLabel,
    nodeShellText,
    darkCardShadow,
    subtleOverlayBackground,
    mediaOverlayText,
    themeWhite: theme.white,
    onEditShot: handleEditSingleShot,
  }

  const handleComposeStoryboardEditorImage = React.useCallback(async (file: File) => {
    const trimmedProjectId = typeof currentProject?.id === 'string' ? currentProject.id.trim() : ''
    const hosted = await uploadServerAssetFile(file, file.name, {
      taskKind: 'storyboard_compose',
      ...(trimmedProjectId ? { projectId: trimmedProjectId } : {}),
    })
    const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
    if (!hostedUrl) {
      throw new Error('分镜已合成，但上传失败')
    }

    const sourceNode = useRFStore.getState().nodes.find((node) => String(node.id) === id)
    const sourcePosition = sourceNode?.position ?? { x: 0, y: 0 }
    const parentId =
      typeof sourceNode?.parentId === 'string' && sourceNode.parentId.trim()
        ? sourceNode.parentId.trim()
        : undefined
    const composedTitle = `${(typeof data?.label === 'string' && data.label.trim()) || '分镜编辑'} · 合成图`
    const imageResultsPatch = [{ url: hostedUrl, title: composedTitle }]

    updateNodeData(id, {
      imageUrl: hostedUrl,
      imageResults: imageResultsPatch,
      imagePrimaryIndex: 0,
      serverAssetId: hosted.id,
    })

    addNode('taskNode', composedTitle, {
      autoLabel: false,
      kind: 'image',
      imageUrl: hostedUrl,
      imageResults: imageResultsPatch,
      imagePrimaryIndex: 0,
      serverAssetId: hosted.id,
      position: {
        x: Number(sourcePosition.x ?? 0) + nodeWidth + 96,
        y: Number(sourcePosition.y ?? 0),
      },
      ...(parentId ? { parentId } : {}),
    })
    notifyAssetRefresh()
    toast('已输出拼接图片节点', 'success')
  }, [addNode, currentProject?.id, data?.label, id, nodeWidth, updateNodeData])

  const isRunning = status === 'running' || status === 'queued'

  const storyboardEditorProps = {
    label: typeof data?.label === 'string' ? data.label : '',
    selected: isSingleSelectionActive,
    nodeWidth,
    nodeHeight: nodeHeight ?? visualNodeDefaults.height,
    aspect: storyboardEditorAspect,
    grid: storyboardEditorGrid,
    cells: storyboardEditorCells,
    selectedIndex: storyboardEditorSelectedIndex,
    editMode: storyboardEditorEditMode,
    collapsed: storyboardEditorCollapsed,
    composedImageUrl: typeof imageUrl === 'string' ? imageUrl : null,
    onComposeToImageNode: handleComposeStoryboardEditorImage,
    onUpdateNodeData: (patch: Record<string, unknown>) => updateNodeData(id, patch),
    isRunning,
    onRun: runNode,
    onCancelRun: () => {
      cancelNodeExecution(id)
      toast('已请求停止当前任务', 'info')
    },
  }

	  const toolbarPreview = React.useMemo(() => {
	    if (primaryMedia && primaryMediaUrl) {
	      return { url: primaryMediaUrl, kind: primaryMedia as any }
	    }
    if (isStoryboardEditorNode) {
      return { url: imageUrl || (data as any)?.imageUrl || null, kind: 'image' as const }
    }
    // Fallbacks for legacy nodes
    if (hasImageResults) return { url: imageUrl || (data as any)?.imageUrl || null, kind: 'image' as const }
    if (isVideoNode) {
      const url = (data as any)?.videoUrl || videoResults[videoPrimaryIndex]?.url || null
      return { url, kind: 'video' as const }
    }
    if (isAudioNode) return { url: (data as any)?.audioUrl || null, kind: 'audio' as const }
    return { url: null, kind: 'image' as const }
  }, [
    primaryMedia,
    primaryMediaUrl,
    isStoryboardEditorNode,
    hasImageResults,
    imageUrl,
    data,
    isVideoNode,
    videoResults,
    videoPrimaryIndex,
    isAudioNode,
  ])

  const handlePreview = React.useCallback(() => {
    if (!toolbarPreview.url) return
    useUIStore.getState().openPreview({ url: toolbarPreview.url, kind: toolbarPreview.kind as any, name: data?.label })
  }, [data?.label, toolbarPreview])

  const handleDownload = React.useCallback(() => {
    if (!toolbarPreview.url) return
    void downloadUrl({
      url: toolbarPreview.url,
      filename: appendDownloadSuffix(data?.label || kind || 'node', Date.now()),
      preferBlob: true,
      fallbackTarget: '_blank',
    })
  }, [data?.label, kind, toolbarPreview])

  const featureBlocks = renderFeatureBlocks(schema.features, {
    featureFlags,
    videoContent,
    imageProps,
    storyboardEditorProps,
  })
	  const [mentionOpen, setMentionOpen] = React.useState(false)
	  const [mentionFilter, setMentionFilter] = React.useState('')
	  const [mentionItems, setMentionItems] = React.useState<MentionSuggestionItem[]>([])
	  const [mentionLoading, setMentionLoading] = React.useState(false)
	  const mentionMetaRef = React.useRef<{
	    at: number
	    caret: number
	    target?: 'prompt' | 'storyboard_scene' | 'storyboard_notes'
	    sceneId?: string
	  } | null>(null)
  const rewriteRequestIdRef = React.useRef(0)

  const autoCharacterOptions = React.useMemo(() => {
    if (!mergedCharacterRefs.length) return []
    const connected = new Set<string>()
    edgesForCharacters.forEach((edge) => {
      if (edge.target === id && characterRefMap.has(edge.source)) {
        connected.add(edge.source)
      }
    })
    return mergedCharacterRefs
      .map((ref) => ({
        value: ref.nodeId,
        label: ref.username ? `${ref.displayName} · @${ref.username}` : ref.displayName,
        connected: connected.has(ref.nodeId),
        username: ref.username,
        displayName: ref.displayName,
        rawLabel: ref.rawLabel,
      }))
      .sort((a, b) => Number(b.connected) - Number(a.connected))
  }, [characterRefMap, edgesForCharacters, id, mergedCharacterRefs])
  const connectedCharacterOptions = React.useMemo(() => {
    const withUsername = autoCharacterOptions.filter((opt) => opt.username)
    const direct = withUsername.filter((opt) => opt.connected)
    return direct.length > 0 ? direct : withUsername
  }, [autoCharacterOptions])
  const upstreamReferenceMentionRefs = useRFStore(
    React.useCallback((s): CharacterRef[] => {
      if (!wantsCharacterRefs) return EMPTY_CHARACTER_REFS
      return collectDynamicUpstreamReferenceEntriesForNode(s.nodes, s.edges, id)
        .map((entry) => {
          const username = toMentionUsername(entry.label)
          if (!username) return null
          return {
            nodeId: `upstream-ref:${id}:${username}`,
            username,
            displayName: String(entry.name || entry.label).trim() || username,
            rawLabel: String(entry.name || entry.label).trim() || username,
            source: 'character',
          } satisfies CharacterRef
        })
        .filter((item): item is CharacterRef => item !== null)
    }, [id, wantsCharacterRefs]),
    areCharacterRefsEqual,
  )
  const mentionSuggestionOptions = React.useMemo(() => {
    const byUsername = new Map<string, CharacterRef>()
      const push = (item: {
        username?: string
        displayName?: string
        rawLabel?: string
        source?: 'character' | 'asset'
        assetUrl?: string | null
        assetId?: string | null
        assetRefId?: string | null
        assetName?: string | null
      }) => {
      const username = toMentionUsername(item.username)
      if (!username) return
      const key = username.toLowerCase()
      if (byUsername.has(key)) return
      const displayName = String(item.displayName || '').trim() || username
      byUsername.set(key, {
        nodeId: `mention:${key}`,
        username,
        displayName,
        rawLabel: String(item.rawLabel || displayName).trim() || displayName,
        source: item.source === 'asset' ? 'asset' : 'character',
        assetUrl: item.assetUrl || null,
        assetId: item.assetId || null,
        assetRefId: item.assetRefId || null,
        assetName: item.assetName || null,
      })
    }
    connectedCharacterOptions.forEach(push)
    upstreamReferenceMentionRefs.forEach(push)
    canvasAssetMentionRefs.forEach(push)
    projectAssetMentionRefs.forEach(push)
    return Array.from(byUsername.values())
  }, [canvasAssetMentionRefs, connectedCharacterOptions, projectAssetMentionRefs, upstreamReferenceMentionRefs])
  const isUsingWorkflowCharacters = React.useMemo(
    () => connectedCharacterOptions.length > 0 && connectedCharacterOptions.every((opt) => !opt.connected),
    [connectedCharacterOptions],
  )

  const clampStoryboardDuration = React.useCallback((value: number): number => {
    if (Number.isNaN(value)) return STORYBOARD_DEFAULT_DURATION
    return Math.min(STORYBOARD_MAX_DURATION, Math.max(STORYBOARD_MIN_DURATION, value))
  }, [])

  const notifyStoryboardLimit = React.useCallback(() => {
    toast('分镜总时长上限为 25 秒，请调整各镜头时长', 'error')
  }, [])

  const applyStoryboardChange = React.useCallback(
    (mutator: (prev: StoryboardScene[]) => StoryboardScene[]) => {
      setStoryboardScenes((prev) => {
        const next = mutator(prev)
        if (next === prev) return prev
        const total = totalStoryboardDuration(next)
        if (total > STORYBOARD_MAX_TOTAL_DURATION + 1e-6) {
          notifyStoryboardLimit()
          return prev
        }
        return next
      })
    },
    [notifyStoryboardLimit],
  )

  const updateStoryboardScene = React.useCallback(
    (sceneId: string, patch: Partial<StoryboardScene>) => {
      applyStoryboardChange((prev) =>
        prev.map((scene) =>
          scene.id === sceneId
            ? {
                ...scene,
                ...patch,
                duration:
                  typeof patch.duration === 'number'
                    ? clampStoryboardDuration(patch.duration)
                    : scene.duration,
              }
            : scene,
        ),
      )
    },
    [applyStoryboardChange, clampStoryboardDuration],
  )

  const handleAddScene = React.useCallback(() => {
    applyStoryboardChange((prev) => {
      const remaining = STORYBOARD_MAX_TOTAL_DURATION - totalStoryboardDuration(prev)
      if (remaining <= 0) {
        notifyStoryboardLimit()
        return prev
      }
      const duration = Math.min(STORYBOARD_DEFAULT_DURATION, remaining)
      return [...prev, createScene({ duration })]
    })
  }, [applyStoryboardChange, notifyStoryboardLimit])

  const handleRemoveScene = React.useCallback(
    (sceneId: string) => {
      applyStoryboardChange((prev) => {
        const filtered = prev.filter((scene) => scene.id !== sceneId)
        if (filtered.length === 0) {
          return [
            createScene({
              duration: Math.min(STORYBOARD_DEFAULT_DURATION, STORYBOARD_MAX_TOTAL_DURATION),
            }),
          ]
        }
        return filtered
      })
    },
    [applyStoryboardChange],
  )

  const handleSceneDurationDelta = React.useCallback(
    (sceneId: string, delta: number) => {
      applyStoryboardChange((prev) =>
        prev.map((scene) =>
          scene.id === sceneId
            ? {
                ...scene,
                duration: clampStoryboardDuration(scene.duration + delta),
              }
            : scene,
        ),
      )
    },
    [applyStoryboardChange, clampStoryboardDuration],
  )

  const [storyboardScriptLoading, setStoryboardScriptLoading] = React.useState(false)
  const [storyboardImageScriptLoading, setStoryboardImageScriptLoading] = React.useState(false)

  const handleGenerateStoryboardImageScript = React.useCallback(async () => {
    if (viewOnly) return
    if (kind !== 'storyboardImage' && kind !== 'novelStoryboard') return
    if (storyboardImageScriptLoading) return
    if (status === 'running' || status === 'queued') return

    const desiredCount = Math.max(4, Math.min(16, Math.floor(storyboardCount || 4)))
    const aspectRatio = storyboardImageAspectRatio

    const mentionList = connectedCharacterOptions
      .map((opt) => String(opt.username || '').replace(/^@/, '').trim())
      .filter(Boolean)
      .map((u) => `@${u}`)
      .join(' ')

    const refText = typeof upstreamText === 'string' ? upstreamText.trim() : ''
    const theme = prompt.trim() || refText || String((data as any)?.label || '').trim()
    if (!theme) {
      toast('请先输入主题或连接参考文本', 'warning')
      return
    }

    const styleLabel = (() => {
      switch (storyboardImageStyle) {
        case 'comic':
          return '美漫'
        case 'sketch':
          return '草图'
        case 'strip':
          return '条漫'
        case 'realistic':
        default:
          return '写实'
      }
    })()

    const systemPrompt = [
      '你是一个分镜脚本生成助手。',
      '你必须严格按用户指定格式输出；不要解释、不要 Markdown、不要代码块。',
      `输出必须恰好 ${desiredCount} 行，每行都必须从 "镜头 i：" 开始（i 从 1 到 ${desiredCount}）。`,
      '每行只写该镜头的画面提示词，尽量一行写完，不要换行。',
      '输出语言跟随用户输入语言；若未指定则默认中文。',
      '@username 前后必须各留一个空格（例如："... @alice ..."）。',
    ].join('\n')

    const promptText = [
      `目标镜头数：${desiredCount}`,
      `画幅比例：${aspectRatio}`,
      `风格倾向：${styleLabel}`,
      refText ? `参考文本：${refText}` : null,
      mentionList ? `可用角色：${mentionList}` : null,
      '',
      '主题/剧情：',
      theme,
      '',
      '请生成分镜脚本，严格输出格式（示例，仅示意格式）：',
      '镜头 1：……',
      '镜头 2：……',
      '（只输出脚本正文，不要添加任何解释或多余内容）',
    ]
      .filter(Boolean)
      .join('\n')



    try {
      setStoryboardImageScriptLoading(true)
      const ui = useUIStore.getState()
      const apiKey = (ui.publicApiKey || '').trim()
      const token = getAuthToken()
      if (!apiKey && !token) {
        toast('请先登录后再试', 'error')
        return
      }
      const persist = ui.assetPersistenceEnabled
      const forceUnifiedSkill = kind === 'novelStoryboard'
      const promptRefineModelAlias = resolvePromptRefineModelAlias()
      const taskRes = await runPublicTask(apiKey, {
        request: {
          kind: 'prompt_refine',
          prompt: promptText,
          extras: {
            systemPrompt: forceUnifiedSkill
              ? [UNIFIED_STORYBOARD_SYSTEM_HINT, systemPrompt].filter(Boolean).join('\n\n')
              : systemPrompt,
            ...(forceUnifiedSkill ? { requiredSkills: [UNIFIED_STORYBOARD_SKILL] } : {}),
            ...(promptRefineModelAlias ? { modelAlias: promptRefineModelAlias } : {}),
            persistAssets: persist,
          },
        },
      })
      const raw = extractTextFromTaskResult(taskRes.result).trim()
      if (!raw) {
        toast('模型未返回分镜脚本，请稍后重试', 'error')
        return
      }

      const normalizedShots = parseStoryboardShotsFromText(raw)
      if (normalizedShots.length !== desiredCount) {
        throw new Error(`模型返回的分镜脚本数量不符合要求：expected=${desiredCount} actual=${normalizedShots.length}`)
      }

      setPrompt(raw)
      updateNodeData(id, { prompt: raw })
      toast('已生成分镜脚本', 'success')
    } catch (error: any) {
      const message = typeof error?.message === 'string' ? error.message : '生成脚本失败'
      toast(message, 'error')
    } finally {
      setStoryboardImageScriptLoading(false)
    }
  }, [
    connectedCharacterOptions,
    data,
    id,
    kind,
    prompt,
    status,
    storyboardCount,
    storyboardImageAspectRatio,
    storyboardImageScriptLoading,
    storyboardImageStyle,
    upstreamText,
    updateNodeData,
    resolvePromptRefineModelAlias,
    viewOnly,
  ])

  const handleGenerateStoryboardScript = React.useCallback(async () => {
    if (viewOnly) return
    if (!isStoryboardNode) return
    if (storyboardScriptLoading) return

    const desiredCount = Math.max(4, Math.min(16, Math.floor(storyboardScenes.length || 4)))
    const orientation = normalizeOrientation(orientationRef.current)
    const aspectRatio = orientation === 'portrait' ? '9:16' : '16:9'

    const mentionList = connectedCharacterOptions
      .map((opt) => String(opt.username || '').replace(/^@/, '').trim())
      .filter(Boolean)
      .map((u) => `@${u}`)
      .join(' ')

    const title = storyboardTitle.trim()
    const notes = storyboardNotes.trim()
    const refText = typeof upstreamText === 'string' ? upstreamText.trim() : ''

    const systemPrompt = [
      '你是一个分镜脚本生成助手。',
      '你必须严格按用户指定格式输出；不要解释、不要 Markdown、不要代码块。',
      '输出必须从第一行就以 "Shot 1:" 开始。',
      '每个 Shot 必须包含 duration/framing/movement/Scene 四项；framing 仅可用 close/medium/wide；movement 仅可用 static/push/pull/pan/tilt。',
      '输出语言跟随用户输入语言；若未指定则默认中文。@username 前后必须各留一个空格（例如："... @alice ..."）。',
    ].join('\n')

    const promptText = [
      `目标镜头数：${desiredCount}`,
      `画幅比例：${aspectRatio}`,
      title ? `标题：${title}` : null,
      notes ? `全局备注：${notes}` : null,
      refText ? `参考文本：${refText}` : null,
      mentionList ? `可用角色：${mentionList}` : null,
      '',
      '请生成分镜脚本，严格输出以下格式（示例，注意从第一行就开始）：',
      'Shot 1:',
      'duration: 5.0sec',
      'framing: medium',
      'movement: static',
      'Scene: （用中文写镜头提示词，尽量一行写完）',
      '',
      `要求：`,
      `- 一共输出 ${desiredCount} 个 Shot，编号从 1 递增；`,
      `- 总时长不超过 ${STORYBOARD_MAX_TOTAL_DURATION} 秒；`,
      '- 只输出脚本正文，不要添加任何前缀/解释/总结；',
    ]
      .filter(Boolean)
      .join('\n')

    try {
      setStoryboardScriptLoading(true)
      const ui = useUIStore.getState()
      const apiKey = (ui.publicApiKey || '').trim()
      const token = getAuthToken()
      if (!apiKey && !token) {
        toast('请先登录后再试', 'error')
        return
      }
      const persist = ui.assetPersistenceEnabled
      const promptRefineModelAlias = resolvePromptRefineModelAlias()
      const taskRes = await runPublicTask(apiKey, {
        request: {
          kind: 'prompt_refine',
          prompt: promptText,
          extras: {
            systemPrompt,
            ...(promptRefineModelAlias ? { modelAlias: promptRefineModelAlias } : {}),
            persistAssets: persist,
          },
        },
      })
      const raw = extractTextFromTaskResult(taskRes.result).trim()
      if (!raw) {
        toast('模型未返回分镜脚本，请稍后重试', 'error')
        return
      }

      const trimmed = raw.trim()
      const firstShotIdx = trimmed.search(/Shot\s+1:\s*/i)
      const normalizedText = firstShotIdx >= 0 ? trimmed.slice(firstShotIdx) : trimmed
      if (!/Shot\s+\d+:\s*/i.test(normalizedText)) {
        throw new Error('模型未按要求返回 Shot 脚本；禁止使用本地模板回退')
      }

      const parsedScenes = enforceStoryboardTotalLimit(normalizeStoryboardScenes(normalizedText, null))
      if (parsedScenes.length !== desiredCount) {
        throw new Error(`模型返回的 Shot 数量不符合要求：expected=${desiredCount} actual=${parsedScenes.length}`)
      }

      applyStoryboardChange(() => parsedScenes)
      toast('已生成分镜脚本', 'success')
    } catch (error: any) {
      const message = typeof error?.message === 'string' ? error.message : '生成脚本失败'
      toast(message, 'error')
    } finally {
      setStoryboardScriptLoading(false)
    }
  }, [
    applyStoryboardChange,
    clampStoryboardDuration,
    connectedCharacterOptions,
    isStoryboardNode,
    orientationRef,
    storyboardNotes,
    storyboardScenes.length,
    storyboardScriptLoading,
    storyboardTitle,
    upstreamText,
    resolvePromptRefineModelAlias,
    viewOnly,
  ])

  const handleSmartGenerateVideoPrompt = React.useCallback(async () => {
    if (viewOnly || !isVideoNode) return
    if (videoPromptGenerationLoading) return
    if (status === 'running' || status === 'queued') return

    const { nodes, edges } = useRFStore.getState()
    const upstreamContext = collectUpstreamVideoTextContext(nodes, edges, id)
    if (!upstreamContext.combinedText.trim()) {
      toast('请先连接上游文本节点，再智能生成视频提示词', 'warning')
      return
    }

    const mentionList = connectedCharacterOptions
      .map((opt) => String(opt.username || '').replace(/^@/, '').trim())
      .filter(Boolean)
      .map((username) => `@${username}`)
      .join(' ')

    const systemPrompt = [
      '你是 TapCanvas 的视频提示词生成助手。',
      '你的唯一任务是根据上游文本上下文，输出当前视频节点唯一的最终执行 prompt。',
      '只输出最终 prompt 正文，不要解释、不要标题、不要 Markdown、不要 JSON。',
      '若上游文本冲突严重或信息不足以生成稳定 prompt，必须只输出一行：ERROR: 具体原因。',
    ].join('\n')

    const promptText = [
      '请基于以下上下文，生成当前视频节点的最终执行 prompt。',
      `视频参数：时长=${videoDuration}s；画幅=${aspect || '16:9'}`,
      mentionList ? `可用角色引用：${mentionList}` : null,
      prompt.trim() ? `当前节点已有 prompt 草稿（可参考但不要机械复述）：\n${prompt.trim()}` : null,
      '上游文本上下文（按画布连接顺序拼接）：',
      upstreamContext.combinedText,
      '输出要求：',
      '- 只输出最终视频 prompt 正文。',
      '- 把明确的镜头顺序、动作、场景、节奏、台词线索和连续性约束压缩进一条连贯 prompt。',
      '- 不要返回“Shot 1/镜头 1/分点列表/说明文字”。',
      '- 如果证据冲突或不足，请输出 ERROR。',
    ]
      .filter(Boolean)
      .join('\n\n')

    try {
      setVideoPromptGenerationLoading(true)
      const ui = useUIStore.getState()
      const apiKey = (ui.publicApiKey || '').trim()
      const token = getAuthToken()
      if (!apiKey && !token) {
        toast('请先登录后再试', 'error')
        return
      }
      const promptRefineModelAlias = resolvePromptRefineModelAlias()
      const taskRes = await runPublicTask(apiKey, {
        request: {
          kind: 'prompt_refine',
          prompt: promptText,
          extras: {
            systemPrompt,
            ...(promptRefineModelAlias ? { modelAlias: promptRefineModelAlias } : {}),
            persistAssets: false,
          },
        },
      })
      const nextPrompt = extractTextFromTaskResult(taskRes.result).trim()
      if (!nextPrompt) {
        throw new Error('模型未返回视频提示词')
      }
      if (/^ERROR\s*:/i.test(nextPrompt)) {
        throw new Error(nextPrompt.replace(/^ERROR\s*:\s*/i, '').trim() || '上游文本不足，无法生成视频提示词')
      }
      setPrompt(nextPrompt)
      updateNodeData(id, { prompt: nextPrompt })
      toast('已根据上游文本生成视频提示词', 'success')
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : '生成视频提示词失败'
      toast(message, 'error')
    } finally {
      setVideoPromptGenerationLoading(false)
    }
  }, [
    aspect,
    connectedCharacterOptions,
    id,
    isVideoNode,
    orientation,
    prompt,
    resolvePromptRefineModelAlias,
    status,
    updateNodeData,
    videoDuration,
    videoPromptGenerationLoading,
    viewOnly,
  ])

const rewritePromptWithCharacters = React.useCallback(
  async ({
    basePrompt,
    roles,
    modelValue,
  }: {
    basePrompt: string
    roles: Array<{ mention: string; displayName: string; aliases: string[] }>
    modelValue: string
  }) => {
    const summary = roles
      .map((role, idx) => {
        const aliasDesc = role.aliases.length ? role.aliases.join(' / ') : '无'
        return [
          `角色 ${idx + 1}`,
          `- 统一引用：${role.mention}`,
          `- 名称：${role.displayName || role.mention}`,
          `- 可能的别名/同音：${aliasDesc}`,
        ].join('\n')
      })
      .join('\n\n')
    const instructions = [
      '【角色设定】',
      summary,
      '',
      '【任务说明】',
      '请在保持原文语气、内容和结构不变的前提下，完成以下操作：',
      '1. 将所有与上述角色相关的称呼（包含别名、同音写法）替换为对应的 @username；',
      '2. 如果某个角色在原文未出现，也请在合适的位置补上一处 @username；',
      '3. 只输出替换后的脚本正文，不要添加解释、前缀或 Markdown；',
      '4. 全文保持中文。',
      '5. 确保每个 @username 前后至少保留一个空格，避免紧贴其他字符。',
      '',
      '【原始脚本】',
      basePrompt,
    ].join('\n')
    const systemPrompt =
      '你是一个提示词修订助手。请根据用户提供的角色映射，统一替换或补充脚本中的角色引用，只输出修改后的脚本文本。务必确保每个 @username 前后至少保留一个空格。'
    const ui = useUIStore.getState()
    const apiKey = (ui.publicApiKey || '').trim()
    const token = getAuthToken()
    if (!apiKey && !token) {
      throw new Error('未登录：请先登录后再试')
    }
    const persist = ui.assetPersistenceEnabled
    const taskRes = await runPublicTask(apiKey, {
      request: {
        kind: 'prompt_refine',
        prompt: instructions,
        extras: { systemPrompt, modelAlias: modelValue, persistAssets: persist },
      },
    })
    const text = extractTextFromTaskResult(taskRes.result)
    return text.trim()
  },
  [],
)

  const handleApplyCharacterMentions = React.useCallback(async () => {
    if (!connectedCharacterOptions.length) return
    const mentionList = connectedCharacterOptions
      .map((opt) => `@${String(opt.username || '').replace(/^@/, '')}`)
      .filter(Boolean)
    const appendedMentions = mentionList.join(' ')
    const roles = connectedCharacterOptions.map((opt) => {
      const username = String(opt.username || '').replace(/^@/, '')
      const mention = `@${username}`
      const aliasList = [
        opt.displayName,
        opt.rawLabel,
        username,
        opt.displayName?.replace(/\s+/g, ''),
        opt.rawLabel?.replace(/\s+/g, ''),
      ].filter((alias): alias is string => Boolean(alias && alias.trim().length > 0))
      return { mention, displayName: opt.displayName || mention, aliases: aliasList }
    })

    if (isStoryboardNode) {
      if (!storyboardScenes.length) {
        applyStoryboardChange(() => [createScene({ description: appendedMentions })])
        setCharacterRewriteError(null)
        return
      }
      const allEmpty = storyboardScenes.every((scene) => !scene.description.trim())
      if (allEmpty) {
        applyStoryboardChange((prev) => {
      if (!prev.length) return [createScene({ description: appendedMentions })]
      const [first, ...rest] = prev
      return [
            {
              ...first,
              description: appendedMentions || first.description,
            },
            ...rest,
          ]
        })
        setCharacterRewriteError(null)
        return
      }
    } else if (!prompt.trim()) {
      if (appendedMentions) {
        setPrompt(appendedMentions)
        updateNodeData(id, { prompt: appendedMentions })
      }
      setCharacterRewriteError(null)
      return
    }

    setCharacterRewriteError(null)
    const currentRequestId = ++rewriteRequestIdRef.current
    setCharacterRewriteLoading(true)
    try {
      if (isStoryboardNode) {
        let aiFailed = false
        const updatedScenes: StoryboardScene[] = []
        for (const scene of storyboardScenes) {
          const base = scene.description || ''
          if (!base.trim()) {
            updatedScenes.push(scene)
            continue
          }
          let rewritten = ''
          try {
            rewritten = await rewritePromptWithCharacters({
              basePrompt: base,
              roles,
              modelValue: characterRewriteModel,
            })
          } catch (err) {
            aiFailed = true
            console.warn('[TaskNode] rewrite via AI failed', err)
          }
          let nextText = (rewritten || '').trim()
          if (!nextText) {
            nextText = roles.reduce((acc, role) => {
              const fallback = applyMentionFallback(acc, role.mention, role.aliases)
              return fallback.text
            }, base).trim()
          }
          updatedScenes.push({ ...scene, description: nextText })
        }
        if (aiFailed) {
          setCharacterRewriteError('AI 替换失败，已使用本地规则处理')
        }
        applyStoryboardChange(() => updatedScenes)
      } else {
        let rewritten = ''
        try {
          rewritten = await rewritePromptWithCharacters({
            basePrompt: prompt,
            roles,
            modelValue: characterRewriteModel,
          })
        } catch (err) {
          console.warn('[TaskNode] rewrite via AI failed', err)
          setCharacterRewriteError(err instanceof Error ? err.message : 'AI 替换失败，使用本地规则处理')
        }
        let nextText = (rewritten || '').trim()
        if (!nextText) {
          nextText = roles.reduce((acc, role) => {
            const fallback = applyMentionFallback(acc, role.mention, role.aliases)
            return fallback.text
          }, prompt)
        }
        setPrompt(nextText)
        updateNodeData(id, { prompt: nextText })
      }
    } finally {
      if (rewriteRequestIdRef.current === currentRequestId) {
        setCharacterRewriteLoading(false)
      }
    }
  }, [
    connectedCharacterOptions,
    prompt,
    characterRewriteModel,
    rewritePromptWithCharacters,
    id,
    updateNodeData,
    isStoryboardNode,
    storyboardScenes,
    applyStoryboardChange,
  ])
  const handleSetPrimaryVideo = React.useCallback((idx: number) => {
    const target = videoResults[idx]
    if (!target) return
    setVideoPrimaryIndex(idx)
    const shouldUpdateRemixTarget = Object.prototype.hasOwnProperty.call(target, 'remixTargetId')
    const nextRemixTargetId =
      typeof target.remixTargetId === 'string' && target.remixTargetId.trim()
        ? target.remixTargetId.trim()
        : null
    const patch: any = {
      videoPrimaryIndex: idx,
      videoUrl: target.url,
      videoThumbnailUrl: target.thumbnailUrl,
      videoTitle: target.title,
      videoDuration: target.duration,
    }
    if (shouldUpdateRemixTarget) {
      patch.remixTargetId = nextRemixTargetId
      patch.videoPostId = nextRemixTargetId
    }
    updateNodeData(id, patch)
    setVideoExpanded(false)
  }, [id, updateNodeData, videoResults])

  // Define node-specific tools and overflow calculation
  const uniqueDefs = React.useMemo(() => {
    if (hasImageResults) {
      const tools: { key: string; label: string; icon: JSX.Element; onClick: () => void }[] = [
      ]
      if (kind === 'image') {
        tools.push(
          {
            key: 'image-edit',
            label: '图片编辑',
            icon: <IconAdjustments size={16} />,
            onClick: () => openPoseEditor(),
          },
        )
      }
      if (kind === 'image' || kind === 'imageEdit') {
        tools.push(
          {
            key: 'camera-angle',
            label: '角度',
            icon: <IconCamera size={16} />,
            onClick: () => openCameraEditor(),
          },
          {
            key: 'lighting-edit',
            label: '打光',
            icon: <IconBulb size={16} />,
            onClick: () => openLightingEditor(),
          },
        )
      }
      if (supportsReversePrompt) {
        tools.push({
          key: 'reverse',
          label: '反推提示词',
          icon: <IconPhotoSearch size={16} />,
          onClick: () => onReversePrompt(),
        })
      }
      return tools
    }
    // default tools for other node kinds (kept minimal)
    return [
      { key: 'extend', label: '扩展', icon: <IconArrowsDiagonal2 size={16} />, onClick: () => {} },
    ] as { key: string; label: string; icon: JSX.Element; onClick: () => void }[]
  }, [
    hasImageResults,
    kind,
    openCameraEditor,
    openLightingEditor,
    openPoseEditor,
    onReversePrompt,
    supportsReversePrompt,
  ])

  type VeoCandidateImage = { url: string; label: string; sourceType: 'image' | 'video' }
  const veoCandidateImages = React.useMemo(() => {
    if (!veoImageModalMode) return [] as VeoCandidateImage[]
    if (!isVideoNode || resolvedVideoVendor !== 'veo') return [] as VeoCandidateImage[]

    const seen = new Set<string>()
    const results: VeoCandidateImage[] = []
    const { nodes, edges } = useRFStore.getState()

    if (veoImageModalMode === 'first') {
      const inboundStoryboardSources = (edges || [])
        .filter((edge) => edge.target === id)
        .map((edge) => (nodes || []).find((node) => node.id === edge.source))
        .filter((node): node is Node => Boolean(node))
        .filter((node) => {
          const sourceKind = String(((node.data as any)?.kind || '')).trim()
          return sourceKind === 'image'
        })

      if (inboundStoryboardSources.length) {
        const strictCandidates: VeoCandidateImage[] = []
        inboundStoryboardSources.forEach((node) => {
          const sourceData: any = node.data || {}
          const sourceLabel = String(sourceData.label || node.id).trim() || node.id
          const candidates = extractStoryboardFirstFrameCandidates(sourceData, sourceLabel)
          candidates.forEach((candidate) => {
            if (!candidate.url || seen.has(candidate.url)) return
            seen.add(candidate.url)
            strictCandidates.push(candidate)
          })
        })
        if (strictCandidates.length) {
          return strictCandidates.slice(0, 20)
        }
      }
    }

    nodes.forEach((node) => {
      const sd: any = node.data || {}
      const kind: string | undefined = sd.kind
      const schema = getTaskNodeSchema(kind)
      const features = new Set(schema.features)
      const label = (sd.label as string | undefined) || node.id
      const isImageProducer =
        schema.category === 'image' ||
        features.has('image') ||
        features.has('imageResults')
      const isVideoProducer =
        schema.category === 'video' ||
        schema.category === 'composer' ||
        schema.category === 'storyboard' ||
        features.has('videoResults')

      const collect = (value?: string | null, sourceType: 'image' | 'video' = 'image') => {
        if (typeof value !== 'string') return
        const trimmed = value.trim()
        if (!trimmed || seen.has(trimmed)) return
        seen.add(trimmed)
        results.push({ url: trimmed, label, sourceType })
      }

      if (isImageProducer) {
        collect(sd.imageUrl, 'image')
        const imgs = Array.isArray(sd.imageResults) ? sd.imageResults : []
        imgs.forEach((img: any) => collect(img?.url, 'image'))
      }

      if (isVideoProducer) {
        collect(sd.videoThumbnailUrl, 'video')
        collect(sd.videoUrl, 'video')
        const videos = Array.isArray(sd.videoResults) ? sd.videoResults : []
        videos.forEach((video: any) => {
          collect(video?.thumbnailUrl, 'video')
          collect(video?.url, 'video')
        })
      }
    })

    return results.slice(0, 20)
  }, [isVideoNode, resolvedVideoVendor, veoImageModalMode])



  React.useEffect(() => {
    if (!suggestionsAllowed && suggestionsEnabled) {
      setSuggestionsEnabled(false)
    }
  }, [suggestionsAllowed, suggestionsEnabled])

  React.useEffect(() => {
    if (suggestTimeout.current) {
      window.clearTimeout(suggestTimeout.current)
      suggestTimeout.current = null
    }
    const value = prompt.trim()
    if (!value || value.length < 6 || !suggestionsEnabled || !suggestionsAllowed) {
      setPromptSuggestions([])
      setActiveSuggestion(0)
      return
    }
    suggestTimeout.current = window.setTimeout(async () => {
      try {
        const mode = promptSuggestMode === 'semantic' ? 'semantic' : 'history'
        const res = await suggestDraftPrompts(value, 'sora', mode)
        setPromptSuggestions(res.prompts || [])
        setActiveSuggestion(0)
      } catch {
        setPromptSuggestions([])
        setActiveSuggestion(0)
      }
    }, 260)
    return () => {
      if (suggestTimeout.current) {
        window.clearTimeout(suggestTimeout.current)
        suggestTimeout.current = null
      }
    }
  }, [prompt, suggestionsEnabled, suggestionsAllowed, promptSuggestMode])

  // 输入 @ 时，基于工作流内连接的角色引用做本地联想（不依赖厂商/Token）。
  React.useEffect(() => {
    if (!mentionOpen) return
    const q = (mentionFilter || '').trim().toLowerCase()
    const items = mentionSuggestionOptions
      .filter((opt) => {
        const username = String(opt.username || '').toLowerCase()
        const displayName = String(opt.displayName || '').toLowerCase()
        return !q || username.includes(q) || displayName.includes(q)
      })
      .slice(0, 12)
      .map((opt): MentionSuggestionItem => ({
        username: opt.username,
        display_name: opt.displayName,
        source: opt.source,
        ...(opt.source === 'asset' && opt.assetUrl
          ? {
              assetBinding: {
                url: opt.assetUrl,
                assetId: opt.assetId || null,
                assetRefId: opt.assetRefId || opt.username,
                assetName: opt.assetName || opt.displayName,
              },
            }
          : null),
      }))
    setMentionItems(items)
    setMentionLoading(false)
  }, [mentionFilter, mentionOpen, mentionSuggestionOptions])

  const hasContent = React.useMemo(() => {
    if (hasImageResults) return Boolean(imageUrl || imageResults.length)
    if (isVideoNode || hasVideoResults) return Boolean((data as any)?.videoUrl)
    if (isAudioNode) return Boolean((data as any)?.audioUrl)
    return false
  }, [hasImageResults, isVideoNode, hasVideoResults, isAudioNode, imageUrl, imageResults.length, data])

  const defaultLabel = React.useMemo(() => {
    if (isComposerNode || hasVideo || hasVideoResults || schema.category === 'video') return '文生视频'
    if (hasImageResults) return '图像节点'
    if (isAudioNode) return '音频节点'
    if (isSubtitleNode) return '字幕节点'
    return 'Task'
  }, [hasImageResults, hasVideo, hasVideoResults, isComposerNode, isAudioNode, isSubtitleNode, schema.category])
  const currentLabel = React.useMemo(() => {
    const text = (data?.label ?? '').trim()
    return text || defaultLabel
  }, [data?.label, defaultLabel])
  const [labelDraft, setLabelDraft] = React.useState(currentLabel)
  const labelInputRef = React.useRef<HTMLInputElement | null>(null)
  React.useEffect(() => {
    setLabelDraft(currentLabel)
  }, [currentLabel])
  React.useEffect(() => {
    if (editing && labelInputRef.current) {
      labelInputRef.current.focus()
      labelInputRef.current.select()
    }
  }, [editing])
  const commitLabel = React.useCallback(() => {
    const next = (labelDraft || '').trim() || defaultLabel
    updateNodeLabel(id, next)
    setEditing(false)
  }, [labelDraft, defaultLabel, id, updateNodeLabel])
  const handleCancelRun = React.useCallback(() => {
    cancelNodeExecution(id)
    setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
  }, [cancelNodeExecution, id, setNodeStatus])
  const shellOutline = 'none'
  const shellShadow = selected ? `${nodeShellShadow}, ${nodeShellGlow}` : nodeShellShadow
  const subtitle = schema.label || defaultLabel
  const inferredProductionMeta = React.useMemo(() => inferProductionNodeMeta(kind), [kind])
  const isExplicitAnchor = productionMeta.productionLayer === 'anchors'
  const canToggleAnchor = UI_ANCHOR_ELIGIBLE_KINDS.has(String(kind || '').trim())
  const canToggleApproval =
    canToggleAnchor ||
    productionMeta.productionLayer === 'anchors' ||
    productionMeta.productionLayer === 'expansion'
  const headerMetaBadges = React.useMemo<HeaderMetaBadge[]>(() => {
    const badges: HeaderMetaBadge[] = []
    const productionLayer = productionMeta.productionLayer
    if (productionLayer && PRODUCTION_LAYER_LABELS[productionLayer]) {
      badges.push({
        label: PRODUCTION_LAYER_LABELS[productionLayer],
        color: PRODUCTION_LAYER_BADGE_COLORS[productionLayer] || 'gray',
        variant: 'light',
      })
    }
    const approvalStatus = productionMeta.approvalStatus
    if (approvalStatus && APPROVAL_STATUS_LABELS[approvalStatus]) {
      badges.push({
        label: APPROVAL_STATUS_LABELS[approvalStatus],
        color: APPROVAL_STATUS_BADGE_COLORS[approvalStatus] || 'gray',
        variant: approvalStatus === 'approved' ? 'light' : 'outline',
      })
    }
    return badges
  }, [productionMeta.approvalStatus, productionMeta.productionLayer])
  const handleUnsetAnchor = React.useCallback(() => {
    updateNodeData(id, {
      productionLayer: inferredProductionMeta.productionLayer,
      creationStage: inferredProductionMeta.creationStage,
    })
    appendLog(id, `[${new Date().toLocaleTimeString()}] 已取消锚点`)
    toast('已取消锚点', 'info')
  }, [appendLog, id, inferredProductionMeta.creationStage, inferredProductionMeta.productionLayer, updateNodeData])
  const handleApproveAnchor = React.useCallback(() => {
    updateNodeData(id, {
      productionLayer: 'anchors',
      creationStage: 'shot_anchor_lock',
      approvalStatus: 'approved',
    })
    appendLog(id, `[${new Date().toLocaleTimeString()}] 已确认为锚点`)
    toast('已确认为锚点', 'success')
  }, [appendLog, id, updateNodeData])
  const toolbarMetaActions = React.useMemo(() => {
    const actions: ToolbarMetaAction[] = []
    const isApproved = productionMeta.approvalStatus === 'approved'
    const isAnchorActive = isExplicitAnchor && isApproved
    if (canToggleAnchor || canToggleApproval) {
      actions.push({
        key: 'toggle-anchor',
        label: isAnchorActive ? '取消锚点' : '锚点',
        icon: <IconTarget size={16} />,
        onClick: isAnchorActive ? handleUnsetAnchor : handleApproveAnchor,
        active: isAnchorActive,
      })
    }
    return actions
  }, [
    canToggleAnchor,
    canToggleApproval,
    handleApproveAnchor,
    handleUnsetAnchor,
    isExplicitAnchor,
    productionMeta.approvalStatus,
  ])

  const visibleDefs = uniqueDefs

  const shellBackground = 'transparent'
  const shellBorder = 'none'
  const shellShadowResolved = 'none'
  const shellPadding = 0
  const shellBackdrop = 'none'
  const textNodePlainText = React.useMemo(
    () => resolveTextNodePlainText({
      data: data as TextNodeDisplaySource,
      latestTextResult,
    }),
    [data, latestTextResult],
  )
  const nodeShellRef = React.useRef<HTMLDivElement | null>(null)
  const textEditorRef = React.useRef<HTMLDivElement | null>(null)
  const textComposingRef = React.useRef(false)
  const [textEditorFocused, setTextEditorFocused] = React.useState(false)
  const [textHtml, setTextHtml] = React.useState<string>(() => {
    const rawHtml = String((data as any)?.textHtml || '').trim()
    if (rawHtml) return rawHtml
    const plain = String(textNodePlainText || '').trim()
    if (!plain) return ''
    return convertPlainTextToHtml(textNodePlainText)
  })
  const [textColorPickerOpen, setTextColorPickerOpen] = React.useState(false)
  const [textBgPickerOpen, setTextBgPickerOpen] = React.useState(false)
  const TEXT_COLOR_PRESETS = React.useMemo(
    () => ['#0f172a', '#f8fafc', '#1d4ed8', '#b91c1c', '#047857', '#7c3aed'],
    [],
  )
  const TEXT_BG_PRESETS = React.useMemo(
    () => ['rgba(248,250,255,0.95)', 'rgba(12,17,28,0.88)', '#fff7ed', '#eff6ff', '#ecfeff', '#f5f3ff'],
    [],
  )
  const blurActiveEditableElement = React.useCallback(() => {
    const activeElement = document.activeElement
    if (!(activeElement instanceof HTMLElement)) return
    if (nodeShellRef.current?.contains(activeElement)) return
    if (
      activeElement.isContentEditable ||
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement ||
      activeElement instanceof HTMLSelectElement
    ) {
      activeElement.blur()
    }
  }, [])
  const withAlpha = React.useCallback((colorValue: string, alpha: number): string => {
    const raw = String(colorValue || '').trim()
    if (!raw) return `rgba(15,23,42,${alpha})`
    const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (hex) {
      const v = hex[1]
      const full = v.length === 3 ? v.split('').map((c) => `${c}${c}`).join('') : v
      const r = parseInt(full.slice(0, 2), 16)
      const g = parseInt(full.slice(2, 4), 16)
      const b = parseInt(full.slice(4, 6), 16)
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
    const rgb = raw.match(/^rgba?\(([^)]+)\)$/i)
    if (rgb) {
      const parts = rgb[1].split(',').map((p) => p.trim())
      const r = Number(parts[0] || 0)
      const g = Number(parts[1] || 0)
      const b = Number(parts[2] || 0)
      if ([r, g, b].every((n) => Number.isFinite(n))) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`
      }
    }
    return raw
  }, [])
  const textBackgroundTint = withAlpha(textBackgroundColor, 0.125)
  const rawTextHtml = String((data as any)?.textHtml || '').trim()
  React.useEffect(() => {
    const rawHtml = rawTextHtml
    const el = textEditorRef.current
    if (!el) return
    if (document.activeElement === el) return
    if (textComposingRef.current) return
    if (rawHtml) {
      if (rawHtml !== textHtml) {
        setTextHtml(rawHtml)
      }
      if (el.innerHTML !== rawHtml) {
        el.innerHTML = rawHtml
      }
      return
    }

    const plain = String(textNodePlainText || '')
    const plainNormalized = plain.trim()
    const currentPlain = textHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim()

    if (!plainNormalized) {
      if (textHtml) setTextHtml('')
      if (el.innerHTML) el.innerHTML = ''
      return
    }

    const nextHtml =
      plainNormalized !== currentPlain || !textHtml
        ? convertPlainTextToHtml(plain)
        : textHtml

    if (nextHtml !== textHtml) {
      setTextHtml(nextHtml)
    }

    if (el.innerHTML !== nextHtml) {
      el.innerHTML = nextHtml
    }
  }, [rawTextHtml, textNodePlainText, textHtml])
  React.useEffect(() => {
    if (selected) return
    const el = textEditorRef.current
    if (el && document.activeElement === el) {
      el.blur()
    }
    setTextEditorFocused(false)
  }, [selected])
  React.useLayoutEffect(() => {
    if (!isPlainTextNode) return
    const shellEl = nodeShellRef.current
    const editorEl = textEditorRef.current
    if (!shellEl || !editorEl) return

    const frameId = window.requestAnimationFrame(() => {
      const shellRect = shellEl.getBoundingClientRect()
      const editorRect = editorEl.getBoundingClientRect()
      const horizontalChrome = Math.max(0, Math.round(shellRect.width - editorRect.width))
      const verticalChrome = Math.max(0, Math.round(shellRect.height - editorRect.height))
      const currentWidth = nodeWidth
      const currentHeight = textNodeHeight ?? TEXT_NODE_DEFAULT_HEIGHT
      const measuredEditor = editorEl.cloneNode(true)

      if (!(measuredEditor instanceof HTMLDivElement)) return

      measuredEditor.style.position = 'absolute'
      measuredEditor.style.left = '-99999px'
      measuredEditor.style.top = '0'
      measuredEditor.style.visibility = 'hidden'
      measuredEditor.style.pointerEvents = 'none'
      measuredEditor.style.height = 'auto'
      measuredEditor.style.minHeight = '0'
      measuredEditor.style.overflow = 'visible'
      measuredEditor.style.width = 'max-content'
      measuredEditor.style.minWidth = `${Math.max(TEXT_NODE_MIN_WIDTH - horizontalChrome, 1)}px`
      measuredEditor.style.maxWidth = `${Math.max(TEXT_NODE_MAX_WIDTH - horizontalChrome, 1)}px`

      if (!measuredEditor.innerHTML.trim()) {
        measuredEditor.innerHTML = '<p><br></p>'
      }

      document.body.appendChild(measuredEditor)
      const measuredRect = measuredEditor.getBoundingClientRect()
      document.body.removeChild(measuredEditor)

      const nextWidth = clampFinite(
        Math.ceil(measuredRect.width + horizontalChrome),
        TEXT_NODE_MIN_WIDTH,
        TEXT_NODE_MAX_WIDTH,
        currentWidth,
      )
      const nextHeight = clampFinite(
        Math.ceil(measuredRect.height + verticalChrome),
        TEXT_NODE_MIN_HEIGHT,
        TEXT_NODE_MAX_HEIGHT,
        currentHeight,
      )

      if (Math.abs(nextWidth - currentWidth) <= 1 && Math.abs(nextHeight - currentHeight) <= 1) {
        return
      }

      updateNodeData(id, {
        nodeWidth: nextWidth,
        nodeHeight: nextHeight,
      })
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [
    clampFinite,
    id,
    isPlainTextNode,
    nodeWidth,
    textHtml,
    textNodeHeight,
    textNodePlainText,
    updateNodeData,
  ])
  const syncTextNodeContent = React.useCallback((opts?: { persist?: boolean }) => {
    const el = textEditorRef.current
    if (!el) return
    const html = el.innerHTML
    const plain = (el.innerText || '').replace(/\u00A0/g, ' ')
    setTextHtml(html)
    setPrompt(plain)
    if (opts?.persist === false) return
    updateNodeData(id, { prompt: plain, textHtml: html })
  }, [id, updateNodeData])
  const runRichCommand = React.useCallback((command: string, value?: string) => {
    const el = textEditorRef.current
    if (!el) return
    el.focus()
    document.execCommand(command, false, value)
    syncTextNodeContent()
  }, [syncTextNodeContent])
  const applyHeading = React.useCallback((level: 1 | 2 | 3 | 4) => {
    runRichCommand('formatBlock', `H${level}`)
  }, [runRichCommand])
  const applyList = React.useCallback((ordered: boolean) => {
    runRichCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList')
  }, [runRichCommand])
  const insertDivider = React.useCallback(() => {
    runRichCommand('insertHorizontalRule')
  }, [runRichCommand])
  const isFreshAiChatNode = React.useMemo(() => {
    const enabled = (data as any)?.aiChatPlanIsNew !== false
    if (!enabled) return false
    const createdAt = typeof (data as any)?.aiChatPlanCreatedAt === 'string'
      ? String((data as any).aiChatPlanCreatedAt).trim()
      : ''
    if (!createdAt) return false
    const createdAtMs = Date.parse(createdAt)
    if (!Number.isFinite(createdAtMs)) return false
    return Date.now() - createdAtMs <= 10 * 60 * 1000
  }, [data])
  const smartVideoPromptAction = isVideoNode
    ? {
        title: '智能生成当前视频提示词',
        onClick: () => {
          void handleSmartGenerateVideoPrompt()
        },
        loading: videoPromptGenerationLoading,
        disabled: viewOnly,
      }
    : null
  const controlChipsNode = !isPlainTextNode ? (
    <ControlChips
      summaryChipStyles={summaryChipStyles}
      controlValueStyle={controlValueStyle}
      summaryModelLabel={summaryModelLabel}
      summaryDuration={summaryDuration}
      summaryQuality={videoHd ? 'HD' : '标准'}
      summaryResolution={summaryResolution}
      summaryExec={summaryExec}
      showModelMenu={hasModelSelect && modelMenuOptions.length > 0}
      modelList={modelMenuOptions}
      onModelChange={handleToolbarModelChange}
      showTimeMenu={showTimeMenu}
      durationOptions={durationOptions}
      onDurationChange={handleToolbarDurationChange}
      showQualityMenu={false}
      qualityOptions={[
        { value: 'standard', label: '标准' },
        { value: 'hd', label: 'HD' },
      ]}
      onQualityChange={(value) => {
        const next = value === 'hd'
        setVideoHd(next)
        updateNodeData(id, { videoHd: next })
      }}
      showResolutionMenu={showResolutionMenu}
      resolutionTitle={isVideoNode ? '画幅' : '比例'}
      resolutionOptions={isVideoNode
        ? configuredSizeOptions
        : configuredImageAspectOptions.length
          ? configuredImageAspectOptions
          : undefined}
      onResolutionChange={handleToolbarSizeChange}
      showImageSizeMenu={showImageSizeMenu}
      imageSize={selectedConfiguredImageSizeOption?.label || imageSize}
      imageSizeOptions={configuredImageSizeOptions.length ? configuredImageSizeOptions : undefined}
      onImageSizeChange={(value) => {
        setImageSize(value)
        updateNodeData(id, { imageSize: value })
      }}
      showOrientationMenu={showOrientationMenu}
      orientation={orientation}
      orientationOptions={configuredOrientationOptions.length ? configuredOrientationOptions : undefined}
      onOrientationChange={handleToolbarOrientationChange}
      showSampleMenu={hasSampleCount}
      sampleOptions={SAMPLE_OPTIONS}
      sampleCount={sampleCount}
      onSampleChange={(value) => {
        setSampleCount(value)
        updateNodeData(id, { sampleCount: value })
      }}
      mappedControls={isVideoNode ? mappedVideoControls : mappedImageControls}
      isCharacterNode={isCharacterNode}
      isRunning={isRunning}
      smartAction={smartVideoPromptAction}
      requiredCreditsLabel={requiredCreditsLabel}
      onCancelRun={handleCancelRun}
      onRun={runNode}
    />
  ) : null
  const mediaFocusControlChipsNode = useMediaFocusToolbar && !isPlainTextNode ? (
    <ControlChips
      summaryChipStyles={summaryChipStyles}
      controlValueStyle={controlValueStyle}
      summaryModelLabel={summaryModelLabel}
      summaryDuration={summaryDuration}
      summaryQuality={videoHd ? 'HD' : '标准'}
      summaryResolution={summaryResolution}
      summaryExec={summaryExec}
      showModelMenu={hasModelSelect && modelMenuOptions.length > 0}
      modelList={modelMenuOptions}
      onModelChange={handleToolbarModelChange}
      showTimeMenu={false}
      durationOptions={durationOptions}
      onDurationChange={() => {}}
      showQualityMenu={false}
      qualityOptions={[]}
      onQualityChange={() => {}}
      showResolutionMenu={showResolutionMenu}
      resolutionTitle={isVideoNode ? '画幅' : '比例'}
      resolutionOptions={isVideoNode
        ? configuredSizeOptions
        : configuredImageAspectOptions.length
          ? configuredImageAspectOptions
          : undefined}
      onResolutionChange={handleToolbarSizeChange}
      showImageSizeMenu={showImageSizeMenu}
      imageSize={selectedConfiguredImageSizeOption?.label || imageSize}
      imageSizeOptions={configuredImageSizeOptions.length ? configuredImageSizeOptions : undefined}
      onImageSizeChange={(value) => {
        setImageSize(value)
        updateNodeData(id, { imageSize: value })
      }}
      showOrientationMenu={showOrientationMenu}
      orientation={orientation}
      orientationOptions={configuredOrientationOptions.length ? configuredOrientationOptions : undefined}
      onOrientationChange={handleToolbarOrientationChange}
      showSampleMenu={false}
      sampleOptions={SAMPLE_OPTIONS}
      sampleCount={sampleCount}
      onSampleChange={(value) => {
        setSampleCount(value)
        updateNodeData(id, { sampleCount: value })
      }}
      mappedControls={isVideoNode ? mappedVideoControls : mappedImageControls}
      isCharacterNode={isCharacterNode}
      isRunning={isRunning}
      smartAction={smartVideoPromptAction}
      requiredCreditsLabel={requiredCreditsLabel}
      onCancelRun={handleCancelRun}
      onRun={runNode}
    />
  ) : null
  const showVeoImageControls = Boolean(isVideoNode && resolvedVideoVendor === 'veo')
  const showMediaFocusSettings = Boolean(
    useMediaFocusToolbar
      && (
        showVeoImageControls
        || allowNodePresetForPrompt
        || hasAnchorBinding
        || connectedCharacterOptions.length > 0
      ),
  )
  const mediaFocusSettingsTrigger = showMediaFocusSettings ? (
    <Popover
      opened={mediaFocusOptionsOpen}
      onChange={setMediaFocusOptionsOpen}
      position="bottom-start"
      offset={10}
      withArrow
      shadow="md"
      withinPortal
    >
      <Popover.Target>
        <ActionIcon
          className="tc-task-node__media-focus-settings-trigger"
          variant="subtle"
          size="sm"
          onClick={() => setMediaFocusOptionsOpen((current) => !current)}
          aria-label="打开媒体节点高级设置"
          title="更多设置"
        >
          <IconAdjustments size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown className="tc-task-node__media-focus-settings-dropdown">
        <Stack className="tc-task-node__media-focus-settings-stack" gap="sm">
          {showVeoImageControls && (
            <div className="tc-task-node__media-focus-settings-group">
              <Group className="tc-task-node__media-focus-settings-header" justify="space-between" gap={6}>
                <Text className="tc-task-node__media-focus-settings-label" size="xs" fw={700}>
                  Veo 图像控制
                </Text>
                <Badge className="tc-task-node__media-focus-settings-badge" size="xs" color="grape">
                  Veo3
                </Badge>
              </Group>
              {hasStoryboardImageUpstreamForVideo && (
                <Text className="tc-task-node__media-focus-settings-help" size="xs" c="dimmed">
                  已连接分镜节点时，会默认把“4图合成图”作为首帧输入。
                </Text>
              )}
              <Group className="tc-task-node__media-focus-settings-actions" gap={6} wrap="wrap">
                <Button
                  className="tc-task-node__media-focus-settings-button"
                  size="compact-xs"
                  variant={trimmedFirstFrameUrl ? 'light' : 'subtle'}
                  onClick={() => openVeoModal('first')}
                >
                  {trimmedFirstFrameUrl ? '更换首帧' : '选择首帧'}
                </Button>
                <Button
                  className="tc-task-node__media-focus-settings-button"
                  size="compact-xs"
                  variant={trimmedLastFrameUrl ? 'light' : 'subtle'}
                  disabled={!firstFrameLocked}
                  onClick={() => openVeoModal('last')}
                >
                  {trimmedLastFrameUrl ? '更换尾帧' : '选择尾帧'}
                </Button>
                <Button
                  className="tc-task-node__media-focus-settings-button"
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => openVeoModal('reference')}
                >
                  管理参考图
                </Button>
              </Group>
              <Group className="tc-task-node__media-focus-settings-actions" gap={6} wrap="wrap">
                <Text className="tc-task-node__media-focus-settings-help" size="xs" c="dimmed">
                  参考图 {veoReferenceImages.length}/{MAX_VEO_REFERENCE_IMAGES}
                </Text>
                {trimmedFirstFrameUrl && (
                  <Button
                    className="tc-task-node__media-focus-settings-button"
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    onClick={() => handleSetFirstFrameUrl('')}
                  >
                    清除首帧
                  </Button>
                )}
                {trimmedLastFrameUrl && (
                  <Button
                    className="tc-task-node__media-focus-settings-button"
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    onClick={() => handleSetLastFrameUrl('')}
                  >
                    清除尾帧
                  </Button>
                )}
              </Group>
              {(trimmedFirstFrameUrl || trimmedLastFrameUrl) && (
                <div className="tc-task-node__media-focus-settings-preview-list">
                  {trimmedFirstFrameUrl && (
                    <Paper
                      className="tc-task-node__media-focus-settings-preview-card"
                      radius="md"
                      p="xs"
                      withBorder
                    >
                      <div className="tc-task-node__media-focus-settings-preview-thumb">
                        <img
                          className="tc-task-node__media-focus-settings-preview-image nodrag nopan"
                          src={trimmedFirstFrameUrl}
                          alt="首帧"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>
                      <Text className="tc-task-node__media-focus-settings-preview-label" size="xs" c="dimmed">
                        首帧
                      </Text>
                    </Paper>
                  )}
                  {trimmedLastFrameUrl && (
                    <Paper
                      className="tc-task-node__media-focus-settings-preview-card"
                      radius="md"
                      p="xs"
                      withBorder
                    >
                      <div className="tc-task-node__media-focus-settings-preview-thumb">
                        <img
                          className="tc-task-node__media-focus-settings-preview-image nodrag nopan"
                          src={trimmedLastFrameUrl}
                          alt="尾帧"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>
                      <Text className="tc-task-node__media-focus-settings-preview-label" size="xs" c="dimmed">
                        尾帧
                      </Text>
                    </Paper>
                  )}
                </div>
              )}
            </div>
          )}

          {allowNodePresetForPrompt && (
            <div className="tc-task-node__media-focus-settings-group">
              <Text className="tc-task-node__media-focus-settings-label" size="xs" fw={700}>
                预设能力
              </Text>
              <Select
                className="tc-task-node__media-focus-settings-select"
                size="xs"
                data={promptPresetOptions}
                value={selectedPresetId}
                onChange={handlePresetChange}
                placeholder={promptPresetOptions.length ? '选择预设能力' : '暂无预设能力'}
                searchable
                clearable
                disabled={viewOnly}
                nothingFoundMessage="没有匹配的预设"
              />
              {!viewOnly && (
                <Group className="tc-task-node__media-focus-settings-actions" gap={6}>
                  <Button
                    className="tc-task-node__media-focus-settings-button"
                    size="compact-xs"
                    variant="light"
                    onClick={() => {
                      setMediaFocusOptionsOpen(false)
                      setPresetModalOpen(true)
                    }}
                  >
                    新增预设
                  </Button>
                  <Button
                    className="tc-task-node__media-focus-settings-button"
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => {
                      setMediaFocusOptionsOpen(false)
                      setPromptSamplesOpen(true)
                    }}
                  >
                    提示词示例
                  </Button>
                </Group>
              )}
            </div>
          )}

          {hasAnchorBinding && (
            <div className="tc-task-node__media-focus-settings-group">
              <Text className="tc-task-node__media-focus-settings-label" size="xs" fw={700}>
                锚点绑定
              </Text>
              <Select
                className="tc-task-node__media-focus-settings-select"
                size="xs"
                data={[
                  { value: 'character', label: '角色' },
                  { value: 'scene', label: '场景' },
                  { value: 'prop', label: '道具' },
                  { value: 'shot', label: '分镜' },
                  { value: 'story', label: '剧情' },
                  { value: 'asset', label: '资产' },
                  { value: 'context', label: '上下文' },
                  { value: 'authority_base_frame', label: '权威基底帧' },
                ]}
                value={anchorBindingKind}
                onChange={(value) => {
                  if (!value) return
                  setAnchorBindingKind(value as PublicFlowAnchorBindingKind)
                }}
                allowDeselect={false}
              />
              <TextInput
                className="tc-task-node__media-focus-settings-input"
                size="xs"
                value={anchorBindingLabel}
                onChange={(e) => setAnchorBindingLabel(e.currentTarget.value)}
                placeholder="例如：方源 / 青茅山宗祠 / 春秋蝉"
              />
              <Button
                className="tc-task-node__media-focus-settings-button"
                size="compact-xs"
                variant="light"
                color="grape"
                loading={bindAnchorLoading}
                disabled={bindAnchorLoading || !primaryImageForAnchorBinding}
                onClick={() => { void handleBindPrimaryAnchor() }}
              >
                绑定当前主图
              </Button>
              {!!anchorBindStatusText && (
                <Text className="tc-task-node__media-focus-settings-help" size="xs" c="dimmed">
                  {anchorBindStatusText}
                </Text>
              )}
            </div>
          )}

          {connectedCharacterOptions.length > 0 && (
            <div className="tc-task-node__media-focus-settings-group">
              <Text className="tc-task-node__media-focus-settings-label" size="xs" fw={700}>
                角色替换
              </Text>
              <Select
                className="tc-task-node__media-focus-settings-select"
                size="xs"
                withinPortal
                data={
                  rewriteModelSelectOptions.length
                    ? rewriteModelSelectOptions
                    : (characterRewriteModel
                        ? [{ value: characterRewriteModel, label: characterRewriteModel }]
                        : [])
                }
                value={characterRewriteModel}
                onChange={handleRewriteModelChange}
              />
              <Button
                className="tc-task-node__media-focus-settings-button"
                size="compact-xs"
                variant="light"
                loading={characterRewriteLoading}
                onClick={() => { void handleApplyCharacterMentions() }}
              >
                一键替换 @引用
              </Button>
              {characterRewriteError && (
                <Text className="tc-task-node__media-focus-settings-help" size="xs" c="red">
                  {characterRewriteError}
                </Text>
              )}
            </div>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  ) : null

  return (
    <div
      ref={nodeShellRef}
      className="tc-task-node"
      onPointerDownCapture={blurActiveEditableElement}
      style={{
        border: shellBorder,
        borderRadius: 22,
        padding: shellPadding,
        background: isPlainTextNode ? textBackgroundTint : shellBackground,
        color: nodeShellText,
        boxShadow: shellShadowResolved,
        backdropFilter: shellBackdrop,
        transition: 'box-shadow 180ms ease',
        position: 'relative',
        outline: shellOutline,
        boxSizing: 'border-box',
        display: isPlainTextNode || isVideoNode ? 'flex' : undefined,
        flexDirection: isPlainTextNode || isVideoNode ? 'column' : undefined,
        width: nodeWidth,
        maxWidth: 720,
        ...(isPlainTextNode && textNodeHeight ? { height: textNodeHeight } : null),
        ...(isResizableVisualNode && nodeHeight ? { height: nodeHeight } : null),
      } as React.CSSProperties}
    >
      <GenerationOverlay
        visible={showGenerationOverlay}
        status={status}
        progress={(data as any)?.progress}
      />
      {productionMetadata && <ChapterGroundedBadge metadata={productionMetadata} />}
      {!hideImageMeta && !isCanvasMediaNode && !isStoryboardEditorNode && !isCameraRefNode && (
        <TaskNodeHeader
          NodeIcon={NodeIcon}
          editing={editing}
          labelDraft={labelDraft}
          currentLabel={currentLabel}
          subtitle={subtitle}
          metaBadges={headerMetaBadges}
          statusLabel={statusLabel}
          statusColor={color}
          nodeShellText={nodeShellText}
          iconBadgeBackground={iconBadgeBackground}
          iconBadgeShadow={iconBadgeShadow}
          sleekChipBase={sleekChipBase}
          labelSingleLine={isImageNode}
          isNew={isFreshAiChatNode}
        showMeta={false}
        showIcon={false}
        showStatus={false}
          onLabelDraftChange={setLabelDraft}
          onCommitLabel={commitLabel}
          onCancelEdit={() => {
            setLabelDraft(currentLabel)
            setEditing(false)
          }}
          onStartEdit={() => setEditing(true)}
          labelInputRef={labelInputRef}
        />
      )}
      <TopToolbar
        isVisible={isSingleSelectionActive && !isCameraRefNode}
        hasContent={hasContent}
        toolbarBackground={toolbarBackground}
        toolbarShadow={toolbarShadow}
        toolbarActionIconStyles={toolbarActionIconStyles}
        inlineDividerColor={inlineDividerColor}
        visibleDefs={visibleDefs}
        extraActions={toolbarMetaActions}
        onPreview={handlePreview}
        onDownload={handleDownload}
      />
      {isPlainTextNode && isSingleSelectionActive && (
        <NodeToolbar className="tc-task-node__text-inline-toolbar" position={Position.Top} align="center">
          <div
            className="tc-task-node__text-inline-toolbar-content"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderRadius: 999,
              background: toolbarBackground,
              boxShadow: toolbarShadow,
              backdropFilter: 'blur(18px)',
              maxWidth: 'min(95vw, 980px)',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
            }}
          >
            {[1, 2, 3, 4].map((level) => (
              <Tooltip key={`h-${level}`} label={`H${level}`} position="bottom" withArrow>
                <ActionIcon
                  className="tc-task-node__text-inline-action"
                  variant="transparent"
                  size="sm"
                  onClick={() => applyHeading(level as 1 | 2 | 3 | 4)}
                >
                  <Text size="xs" fw={700}>{`H${level}`}</Text>
                </ActionIcon>
              </Tooltip>
            ))}
            <div className="tc-task-node__text-inline-divider" style={{ width: 1, height: 20, background: inlineDividerColor }} />
            <Tooltip label="加粗" position="bottom" withArrow>
              <ActionIcon className="tc-task-node__text-inline-action" variant="transparent" size="sm" onClick={() => runRichCommand('bold')}>
                <IconBold size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="斜体" position="bottom" withArrow>
              <ActionIcon className="tc-task-node__text-inline-action" variant="transparent" size="sm" onClick={() => runRichCommand('italic')}>
                <IconItalic size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="有序列表" position="bottom" withArrow>
              <ActionIcon className="tc-task-node__text-inline-action" variant="transparent" size="sm" onClick={() => applyList(true)}>
                <IconListNumbers size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="无序列表" position="bottom" withArrow>
              <ActionIcon className="tc-task-node__text-inline-action" variant="transparent" size="sm" onClick={() => applyList(false)}>
                <IconList size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="分割线" position="bottom" withArrow>
              <ActionIcon className="tc-task-node__text-inline-action" variant="transparent" size="sm" onClick={insertDivider}>
                <IconSeparatorHorizontal size={16} />
              </ActionIcon>
            </Tooltip>
            <div className="tc-task-node__text-inline-divider" style={{ width: 1, height: 20, background: inlineDividerColor }} />
            <Popover
              opened={textColorPickerOpen}
              onChange={setTextColorPickerOpen}
              position="bottom"
              withArrow
              withinPortal
              shadow="md"
            >
              <Popover.Target>
                <div>
                  <Tooltip label="文字颜色" position="bottom" withArrow>
                    <ActionIcon
                      className="tc-task-node__text-inline-action"
                      variant="transparent"
                      size="sm"
                      onClick={() => setTextColorPickerOpen((prev) => !prev)}
                    >
                      <IconPalette size={16} color={textColor} />
                    </ActionIcon>
                  </Tooltip>
                </div>
              </Popover.Target>
              <Popover.Dropdown>
                <Group className="tc-task-node__text-inline-palette" gap={4} wrap="nowrap">
                  {TEXT_COLOR_PRESETS.map((colorValue) => (
                    <ActionIcon
                      key={colorValue}
                      className="tc-task-node__text-inline-color"
                      size="sm"
                      variant="subtle"
                      onClick={() => {
                        runRichCommand('foreColor', colorValue)
                        updateNodeData(id, { textColor: colorValue })
                        setTextColorPickerOpen(false)
                      }}
                    >
                      <span className="tc-task-node__text-inline-color-dot" style={{ width: 12, height: 12, borderRadius: 999, background: colorValue }} />
                    </ActionIcon>
                  ))}
                </Group>
              </Popover.Dropdown>
            </Popover>
            <Popover
              opened={textBgPickerOpen}
              onChange={setTextBgPickerOpen}
              position="bottom"
              withArrow
              withinPortal
              shadow="md"
            >
              <Popover.Target>
                <div>
                  <Tooltip label="背景色" position="bottom" withArrow>
                    <ActionIcon
                      className="tc-task-node__text-inline-action"
                      variant="transparent"
                      size="sm"
                      onClick={() => setTextBgPickerOpen((prev) => !prev)}
                    >
                      <IconColorSwatch size={16} />
                    </ActionIcon>
                  </Tooltip>
                </div>
              </Popover.Target>
              <Popover.Dropdown>
                <Group className="tc-task-node__text-inline-palette" gap={4} wrap="nowrap">
                  {TEXT_BG_PRESETS.map((colorValue) => (
                    <ActionIcon
                      key={colorValue}
                      className="tc-task-node__text-inline-color"
                      size="sm"
                      variant="subtle"
                      onClick={() => {
                        updateNodeData(id, { textBackgroundColor: colorValue })
                        setTextBgPickerOpen(false)
                      }}
                    >
                      <span className="tc-task-node__text-inline-color-dot" style={{ width: 12, height: 12, borderRadius: 999, background: colorValue, border: '1px solid rgba(255,255,255,0.25)' }} />
                    </ActionIcon>
                  ))}
                </Group>
              </Popover.Dropdown>
            </Popover>
          </div>
        </NodeToolbar>
      )}
      <TaskNodeHandles
        targets={targets}
        sources={sources}
        layout={handleLayoutMap}
        defaultInputType={defaultInputType}
        defaultOutputType={defaultOutputType}
        wideHandleBase={wideHandleBase}
        showHandles={!isInnerStoryboardShotNode}
        showWideHandles={!isInnerStoryboardShotNode}
      />
      {isResizableVisualNode && isSingleSelectionActive && !variantsOpen && (
        <NodeResizeControl
          className="tc-task-node__media-resize nodrag"
          position="bottom-right"
          keepAspectRatio={!isStoryboardEditorNode}
          minWidth={visualNodeDefaults.minWidth}
          minHeight={visualNodeDefaults.minHeight}
          onResizeEnd={handleMediaResizeEnd}
        >
          <div className="tc-task-node__media-resize-handle" style={{ width: 10, height: 10, borderRight: '2px solid rgba(255,255,255,0.55)', borderBottom: '2px solid rgba(255,255,255,0.55)' }} />
        </NodeResizeControl>
      )}
      {isPlainTextNode && (
        <TextContent
          selected={isSingleSelectionActive}
          textEditorFocused={textEditorFocused}
          textBackgroundTint={textBackgroundTint}
          textColor={textColor}
          textFontSize={textFontSize}
          textFontWeight={textFontWeight as React.CSSProperties['fontWeight']}
          editorRef={textEditorRef}
          onFocus={() => {
            setTextEditorFocused(true)
          }}
          onInput={() => {
            if (textComposingRef.current) return
            syncTextNodeContent()
          }}
          onCompositionStart={() => {
            textComposingRef.current = true
          }}
          onCompositionEnd={() => {
            textComposingRef.current = false
            syncTextNodeContent()
          }}
          onBlur={() => {
            setTextEditorFocused(false)
            syncTextNodeContent()
          }}
        />
      )}
      {/* Content Area for Character/Image/Video/Text kinds */}
      {featureBlocks}
      {isProjectDocNode && !isResizableVisualNode && (
        <Paper
          className="tc-task-node__doc-preview"
          radius="md"
          withBorder
          p="sm"
          style={{
            marginTop: 8,
            width: '100%',
            background: isDarkUi ? 'rgba(12,17,28,0.88)' : 'rgba(248,250,255,0.95)',
          }}
        >
          <Stack className="tc-task-node__doc-preview-stack" gap={6}>
            <Text className="tc-task-node__doc-preview-title" size="xs" c="dimmed">
              {schema.label || '文稿'}预览
            </Text>
            <Text
              className="tc-task-node__doc-preview-content"
              size="sm"
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.45,
              }}
            >
              {docPreviewText || '当前文稿为空。选中节点后可在底部工具栏编辑，并保存到项目素材。'}
            </Text>
          </Stack>
        </Paper>
      )}
            {/* remove bottom kind text for all nodes */}
      {/* Removed bottom tag list; top-left label identifies node type */}
      {/* Bottom detail panel near node */}
      {showBottomToolbar && (
        <NodeToolbar className="tc-task-node__toolbar" position={Position.Bottom} align="center">
          <div
            className={[
              'tc-task-node__toolbar-frame',
              useMediaFocusToolbar ? 'tc-task-node__toolbar-frame--media' : '',
            ].filter(Boolean).join(' ')}
            style={{
              position: 'relative',
              zIndex: 3001,
              width: toolbarWidthCss,
              maxHeight: toolbarMaxHeightCss,
              overflowY: 'auto',
              overflowX: 'visible',
              transformOrigin: 'top center',
              transform: `scale(${toolbarScale})`,
            }}
          >
            <div
              className={[
                'tc-task-node__toolbar-content',
                useMediaFocusToolbar ? 'tc-task-node__toolbar-content--media' : '',
              ].filter(Boolean).join(' ')}
            >
              {!useMediaFocusToolbar && controlChipsNode ? (
                <div className="tc-task-node__toolbar-controls">
                  {controlChipsNode}
                </div>
              ) : null}

              <div className="tc-task-node__toolbar-body">
                {isProjectDocNode && (
                  <Paper
                    className="tc-task-node__doc-material-panel"
                    radius="md"
                    p="xs"
                    style={{ background: lightContentBackground }}
                  >
                    <Group className="tc-task-node__doc-material-row" justify="space-between" gap={8}>
                      <Text className="tc-task-node__doc-material-text" size="xs" c="dimmed">
                        {currentProject?.id
                          ? `项目素材已关联：${currentProject.name || currentProject.id}`
                          : '未关联项目：先在顶部选择项目'}
                      </Text>
                      <Button
                        className="tc-task-node__doc-material-save"
                        size="compact-xs"
                        variant="light"
                        onClick={() => void handleSaveProjectMaterial()}
                        loading={materialSaving}
                        disabled={!currentProject?.id}
                      >
                        保存素材
                      </Button>
                    </Group>
                  </Paper>
                )}

                {!useMediaFocusToolbar && (
                  <StatusBanner status={status} lastError={(data as any)?.lastError} httpStatus={(data as any)?.httpStatus} />
                )}

                {isVideoNode && upstreamImageUrl && !useMediaFocusToolbar && (
                  <div className="tc-task-node__composer-upstream">
                    <div
                      className="tc-task-node__composer-upstream-media"
                      style={{
                        position: 'relative',
                        width: '100%',
                        maxHeight: 180,
                        borderRadius: 8,
                        overflow: 'hidden',
                        marginBottom: 0,
                        border: 'none',
                        background: darkContentBackground,
                      }}
                    >
                      <img
                        className="tc-task-node__composer-upstream-image"
                        src={upstreamImageUrl}
                        alt="上游图片素材"
                        style={{
                          width: '100%',
                          height: 'auto',
                          maxHeight: 180,
                          objectFit: 'contain',
                          display: 'block',
                          backgroundColor: mediaFallbackSurface,
                        }}
                      />
                    </div>
                  </div>
                )}

                {connectedCharacterOptions.length > 0 && !useMediaFocusToolbar && (
                  <Paper className="tc-task-node__character-summary" radius="md" p="xs">
                    <Group className="tc-task-node__character-summary-actions" align="flex-end" gap="xs" wrap="wrap">
                      <Select
                        className="tc-task-node__character-summary-select"
                        label="替换模型"
                        size="xs"
                        withinPortal
                        data={
                          rewriteModelSelectOptions.length
                            ? rewriteModelSelectOptions
                            : (characterRewriteModel
                                ? [{ value: characterRewriteModel, label: characterRewriteModel }]
                                : [])
                        }
                        value={characterRewriteModel}
                        onChange={handleRewriteModelChange}
                        style={{ minWidth: 180 }}
                      />
                      <Button
                        className="tc-task-node__character-summary-action"
                        size="xs"
                        variant="light"
                        loading={characterRewriteLoading}
                        onClick={() => { void handleApplyCharacterMentions() }}
                      >
                        一键替换 @引用
                      </Button>
                    </Group>
                    {characterRewriteError && (
                      <Text className="tc-task-node__character-summary-error" size="xs" c="red" mt={4}>
                        {characterRewriteError}
                      </Text>
                    )}
                  </Paper>
                )}

                {showUpstreamReferenceStrip && (
                  <UpstreamReferenceStrip
                    targetNodeId={id}
                    items={upstreamReferenceItems}
                    onReorder={handleReorderUpstreamReference}
                    onRemove={handleRemoveUpstreamReference}
                    onToggleCanvasReferencePicker={handleToggleCanvasReferencePicker}
                    canvasReferencePickerActive={canvasReferencePickerActive}
                  />
                )}

                {canUseStructuredPromptEditor && !isPlainTextNode && (
                  <Group className="tc-task-node__prompt-mode-switch" justify="space-between" gap={8}>
                    <Text className="tc-task-node__prompt-mode-switch-label" size="xs" c="dimmed">
                      提示词编辑模式
                    </Text>
                    <Group className="tc-task-node__prompt-mode-switch-control" gap={8}>
                      {structuredPromptRefineLoading ? (
                        <Loader className="tc-task-node__prompt-mode-switch-loader" size="xs" />
                      ) : null}
                      <Switch
                        className="tc-task-node__prompt-mode-switch-input"
                        size="xs"
                        checked={isStructuredPromptMode}
                        disabled={viewOnly || structuredPromptRefineLoading}
                        label="JSON"
                        onChange={(event) => handleStructuredPromptModeChange(event.currentTarget.checked)}
                      />
                    </Group>
                  </Group>
                )}

                {isPlainTextNode ? null : isStructuredPromptMode ? (
                  <StructuredPromptSection
                    structuredValue={structuredPromptValue}
                    loading={structuredPromptRefineLoading}
                    externalError={structuredPromptErrorMessage}
                    onCommit={handleCommitStructuredPrompt}
                    onRefine={
                      viewOnly
                        ? undefined
                        : () => {
                            void handleEnableStructuredPromptMode()
                          }
                    }
                  />
                ) : (
                  <PromptSection
                    layout={useMediaFocusToolbar ? 'media-focus' : 'default'}
                    hideBrainButton={useMediaFocusToolbar || isVideoNode}
                    hidePresetSection={useMediaFocusToolbar}
                    hideAnchorBindingSection={useMediaFocusToolbar}
                    isCharacterNode={isCharacterNode}
                    isComposerNode={isComposerNode}
                    isStoryboardNode={isStoryboardNode}
                    prompt={prompt}
                    setPrompt={setPrompt}
                    onUpdateNodeData={(patch) => updateNodeData(id, patch)}
                    placeholder={
                      isVideoNode
                        ? '描述这条视频要生成的画面、动作和情绪'
                        : undefined
                    }
                    minRows={isVideoNode ? 3 : 2}
                    maxRows={6}
                    suggestionsAllowed={suggestionsAllowed}
                    suggestionsEnabled={suggestionsEnabled}
                    setSuggestionsEnabled={setSuggestionsEnabled}
                    promptSuggestions={promptSuggestions}
                    activeSuggestion={activeSuggestion}
                    setActiveSuggestion={setActiveSuggestion}
                    setPromptSuggestions={setPromptSuggestions}
                    markPromptUsed={(value) => markDraftPromptUsed(value, 'sora').catch(() => {})}
                    mentionOpen={mentionOpen}
                    mentionItems={mentionItems}
                    mentionLoading={mentionLoading}
                    mentionFilter={mentionFilter}
                    setMentionFilter={setMentionFilter}
                    setMentionOpen={setMentionOpen}
                    mentionMetaRef={mentionMetaRef}
                    onMentionApplied={handleMentionApplied}
                    showAssetBinding={Boolean(primaryBindableAsset?.url)}
                    assetBindingId={assetBindingId}
                    setAssetBindingId={setAssetBindingId}
                    onBindPrimaryAssetReference={handleBindPrimaryAssetReference}
                    bindAssetDisabled={!primaryBindableAsset?.url}
                    bindAssetStatusText={assetBindStatusText}
                    showAnchorBinding={hasAnchorBinding}
                    anchorBindingKind={anchorBindingKind}
                    setAnchorBindingKind={(value) => {
                      if (!value) return
                      setAnchorBindingKind(value as PublicFlowAnchorBindingKind)
                    }}
                    anchorBindingLabel={anchorBindingLabel}
                    setAnchorBindingLabel={setAnchorBindingLabel}
                    onBindPrimaryAnchor={() => { void handleBindPrimaryAnchor() }}
                    bindAnchorLoading={bindAnchorLoading}
                    bindAnchorDisabled={bindAnchorLoading || !primaryImageForAnchorBinding}
                    bindAnchorStatusText={anchorBindStatusText}
                    isDarkUi={isDarkUi}
                    nodeShellText={nodeShellText}
                    onOpenPromptSamples={
                      useMediaFocusToolbar
                        ? undefined
                        : () => setPromptSamplesOpen(true)
                    }
                    presetOptions={allowNodePresetForPrompt ? promptPresetOptions : undefined}
                    presetValue={allowNodePresetForPrompt ? selectedPresetId : null}
                    presetDisabled={viewOnly}
                    onPresetChange={allowNodePresetForPrompt ? handlePresetChange : undefined}
                    onOpenCreatePresetModal={
                      allowNodePresetForPrompt && !viewOnly
                        ? () => setPresetModalOpen(true)
                        : undefined
                    }
                  />
                )}

              </div>

              {useMediaFocusToolbar && (
                <div className="tc-task-node__toolbar-footer">
                  <StatusBanner status={status} lastError={(data as any)?.lastError} httpStatus={(data as any)?.httpStatus} />
                  {mediaFocusControlChipsNode || mediaFocusSettingsTrigger ? (
                    <div className="tc-task-node__toolbar-controls tc-task-node__toolbar-controls--footer tc-task-node__toolbar-controls--media-footer">
                      {mediaFocusSettingsTrigger ? (
                        <div className="tc-task-node__toolbar-settings">
                          {mediaFocusSettingsTrigger}
                        </div>
                      ) : null}
                      {mediaFocusControlChipsNode ? (
                        <div className="tc-task-node__toolbar-controls-main">
                          {mediaFocusControlChipsNode}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </NodeToolbar>
      )}
	      <PromptSampleDrawer
	        opened={promptSamplesOpen}
	        nodeKind={kind}
	        onClose={() => setPromptSamplesOpen(false)}
        onApplySample={handleApplyPromptSample}
      />
      <Modal
        className="task-node-preset-modal"
        opened={presetModalOpen}
        onClose={() => setPresetModalOpen(false)}
        title="新增预设能力"
        centered
        size="md"
      >
        <Stack className="task-node-preset-modal__stack" gap="sm">
          <Select
            className="task-node-preset-modal__type"
            label="类型"
            data={[
              { value: 'text', label: '文本' },
              { value: 'image', label: '图片' },
              { value: 'video', label: '视频' },
            ]}
            value={newPresetType}
            onChange={(value) => setNewPresetType((value as LlmNodePresetType) || 'text')}
            allowDeselect={false}
          />
          <TextInput
            className="task-node-preset-modal__title"
            label="预设名称"
            placeholder="例如：产品卖点增强"
            value={newPresetTitle}
            onChange={(e) => setNewPresetTitle(e.currentTarget.value)}
          />
          <Textarea
            className="task-node-preset-modal__prompt"
            label="提示词"
            placeholder="输入该预设的提示词模板"
            minRows={5}
            value={newPresetPrompt}
            onChange={(e) => setNewPresetPrompt(e.currentTarget.value)}
          />
          <Group className="task-node-preset-modal__actions" justify="flex-end" gap="xs">
            <Button
              className="task-node-preset-modal__cancel"
              variant="subtle"
              onClick={() => setPresetModalOpen(false)}
            >
              取消
            </Button>
            <Button
              className="task-node-preset-modal__save"
              onClick={() => { void handleCreateNodePreset() }}
              loading={presetSaving}
            >
              保存预设
            </Button>
          </Group>
          {presetLoading && (
            <Text className="task-node-preset-modal__loading" size="xs" c="dimmed">
              正在同步预设列表...
            </Text>
          )}
        </Stack>
      </Modal>

      {veoImageModalMode && (
        <VeoImageModal
          opened
          mode={veoImageModalMode}
          statusColor={color}
          firstFrameLocked={firstFrameLocked}
          trimmedFirstFrameUrl={trimmedFirstFrameUrl}
          trimmedLastFrameUrl={trimmedLastFrameUrl}
          veoReferenceImages={veoReferenceImages}
          veoReferenceLimitReached={veoReferenceLimitReached}
          veoCustomImageInput={veoCustomImageInput}
          veoCandidateImages={veoCandidateImages}
          mediaFallbackSurface={mediaFallbackSurface}
          inlineDividerColor={inlineDividerColor}
          onClose={closeVeoModal}
          onCustomImageInputChange={setVeoCustomImageInput}
          onAddCustomReferenceImage={handleAddCustomReferenceImage}
          onRemoveReferenceImage={handleRemoveReferenceImage}
          onSetFirstFrameUrl={handleSetFirstFrameUrl}
          onSetLastFrameUrl={handleSetLastFrameUrl}
          onToggleReference={handleReferenceToggle}
        />
      )}

      {poseEditorModal}
      {imageViewEditorModal}

      {isVideoNode && videoExpanded && (
        <VideoResultModal
          opened={videoExpanded}
          onClose={() => setVideoExpanded(false)}
          videos={videoResults}
          primaryIndex={videoPrimaryIndex}
          adoptedIndex={adoptedVideoIndex}
          onSelectPrimary={handleSetPrimaryVideo}
          onAdopt={handleAdoptVideo}
          onPreview={(video) => {
            const openPreview = useUIStore.getState().openPreview
            openPreview({
              url: video.url,
              kind: 'video',
              name: video.title || data?.label || 'Video',
            })
          }}
          galleryCardBackground={galleryCardBackground}
          mediaFallbackSurface={mediaFallbackSurface}
          mediaFallbackText={mediaFallbackText}
          isStoryboardNode={isStoryboardNode}
        />
      )}

      {/* More panel rendered directly under the top toolbar with 4px gap */}
    </div>
  )
}

const areTaskNodePropsEqual = (prev: NodeProps<TaskNodeType>, next: NodeProps<TaskNodeType>) => {
  if (prev.id !== next.id) return false
  if (prev.selected !== next.selected) return false
  if (prev.dragging !== next.dragging) return false
  if (prev.data !== next.data) return false
  if (prev.width !== next.width) return false
  if (prev.height !== next.height) return false
  if (prev.isConnectable !== next.isConnectable) return false
  if (prev.parentId !== next.parentId) return false
  return true
}

export default React.memo(TaskNodeInner, areTaskNodePropsEqual)
