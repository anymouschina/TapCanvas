import type { Edge, Node } from '@xyflow/react'
import {
  createImageOperationState,
  imageOperationMaskUrl,
  parseImageOperationSpec,
  type ImageOperationSpec,
} from '@tapcanvas/image-operation-protocol'
import { isReferenceOnlyCanvasEdge } from '@tapcanvas/canvas-edge-semantics'
import { normalizePublicFlowAnchorBindings, type PublicFlowAnchorBinding } from '@tapcanvas/flow-anchor-bindings'
import type {
  MaterialAssetDto,
  ProjectBookIndexDto,
  ProjectRoleCardAssetDto,
  TaskAssetDto,
  TaskKind,
  TaskRequestDto,
  TaskResultDto,
} from '../api/server'
import {
  agentsChat,
  ensureProjectBookMetadataWindow,
  fetchProxiedImageBlob,
  getProjectBookIndex,
  listProjectBooks,
  listProjectRoleCardAssets,
  listMaterialAssets,
  listServerAssets,
  runPublicTask,
  uploadServerAssetFile,
  fetchPublicTaskResult,
  upsertProjectBookRoleCard,
  upsertProjectBookSemanticAsset,
  upsertProjectBookVisualRef,
  upsertProjectRoleCardAsset,
  upsertProjectBookStoryboardChunk,
} from '../api/server'
import { hasAuthSession } from '../auth/store'
import { useUIStore } from '../ui/uiStore'
import { toast } from '../ui/toast'
import { notifyAssetRefresh } from '../ui/assetEvents'
import { isAnthropicModel } from '../config/modelSource'
import {
  findModelOptionByIdentifier,
  getModelOptionRequestAlias,
  preloadModelOptions,
  resolveExecutableImageModel,
} from '../config/useModelOptions'
import {
  DEFAULT_VIDEO_REFERENCE_IMAGE_LIMIT,
  parseVideoModelCatalogConfig,
} from '../config/modelCatalogMeta'
import { resolveCatalogVideoVendor } from '../config/modelRouting'
import { normalizeOrientation, type Orientation } from '../utils/orientation'
import { buildVideoBillingSpecKey, normalizeVideoResolution } from '../utils/videoBillingSpec'
import { buildKlingMotionControlExtras, isKlingMotionControlModel, normalizeKlingKeepOriginalSound } from '../utils/klingMotionControl'
import { isKlingV3OmniVideoModel, normalizeKlingVideoReferType } from '../utils/klingV3'
import {
  buildVideoDurationPatch,
  parseVideoDurationFromSpecKey,
  readVideoDurationSeconds,
} from '../utils/videoDuration'
import { isRemoteUrl } from '../canvas/nodes/taskNode/utils'
import { isTapCanvasHostedUploadUrl } from '../canvas/nodes/taskNode/hostedUploadUrl'
import {
  normalizeStoryboardScenes,
  serializeStoryboardScenes,
  totalStoryboardDuration,
  STORYBOARD_MAX_TOTAL_DURATION,
} from '../canvas/nodes/storyboardUtils'
import { resolveTaskErrorDisplay } from './taskErrorClassifier'
import { mergeExecutionPromptSequence, selectExecutionUpstreamPrompts } from './promptAssembly'
import { resolveProviderTaskFailure } from './mediaTaskRuntime'
import {
  collectTextExecutionPromptCandidates,
  resolveExecutionPromptSourceCategory,
} from './executionPromptSource'
import {
  collectNodeReferenceImageUrls,
  readNodeFirstFrameUrl,
  readNodeLastFrameUrl,
} from './nodeReferenceInputs'
import {
  doesRoleCardStateMatchQuery,
  extractRoleCardMentionTokens,
  type RoleCardMentionToken,
} from './roleCardMention'
import {
  isSoraVideoModel,
  prepareSoraVideoReferenceAssets,
  type PreparedVideoReferenceAsset,
} from './videoReferenceAssetPrep'
import {
  appendReferenceAliasSlotPrompt,
  buildAssetRefId,
  buildImageAssetResultItem,
  buildNamedReferenceEntries,
  buildVideoAssetResultItem,
  mergeReferenceAssetInputs,
  type AssetResultItem,
  type RuntimeReferenceAssetInput,
} from './assetReference'
import {
  collectPromptMentionAliases,
  extractPromptMentionTokens,
  normalizePromptMentionAlias,
} from './promptMentionAliases'
import {
  isEligibleForGlobalStyleReference,
  mergeGlobalStyleReferenceImages,
  mergeGlobalStylePrompt,
} from './globalStyleReferenceInjection'
import {
  composeLabeledReferenceSheetBlob,
  uploadMergedReferenceSheet,
  type UploadedReferenceSheet,
} from './referenceSheet'
import { parseImageEditSizeDimensions } from '../canvas/nodes/taskNode/imageEditSize'
import { appendImageEditFocusGuidePrompt } from '../canvas/nodes/taskNode/imageEditFocusGuide'
import { buildPortraitTextureExecutionPrompt } from '../canvas/nodes/taskNode/portraitTextureContract'
import { buildCinematicCameraPrompt } from '../canvas/nodes/taskNode/cameraControlContract'
import {
  getProjectImageSettings,
  mergeChapterCreativeOverrideIntoProjectImageSettings,
} from '../canvas/projectImageSettingsStore'
import {
  buildStoryboardEditorPatch,
  resolveStoryboardEditorCellAspect,
} from '../canvas/nodes/taskNode/storyboardEditor'
import {
  collectOrderedUpstreamMediaSources,
  collectOrderedUpstreamReferenceItems,
  collectPoseReferenceUrlsFromNode,
  extractNodePrimaryAssetReference,
  pickPrimaryImageFromNode,
} from '../canvas/nodes/taskNode/upstreamReferences'
import {
  resolveCompiledImagePrompt,
  resolveImagePromptExecution,
} from '../canvas/nodes/taskNode/imagePromptSpec'
import imageViewControlsModule from '@tapcanvas/image-view-controls'
import {
  resolveSemanticNodeRoleBinding,
  resolveSemanticNodeVisualReferenceBinding,
  upsertSemanticNodeAnchorBinding,
} from '../canvas/utils/semanticBindings'
import { taskHubRuntime, configureTaskHub } from './taskHub'
import { withCanvasGenerationContext } from './generationAssetContext'
import {
  deriveShotPromptsFromStructuredData,
  normalizeStoryboardStructuredData,
  STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION,
} from '../storyboard/storyboardStructure'

configureTaskHub({
  fetch: async (taskId, kind, prompt) => {
    const { apiKey } = requirePublicApiRuntime()
    const res = await fetchPublicTaskResult(apiKey, {
      taskId: taskId.trim(),
      taskKind: kind,
      prompt,
    })
    return res.result
  },
})

const { appendImageViewPrompt } = imageViewControlsModule

function getRuntimeProjectImageSettings(projectId: string) {
  return mergeChapterCreativeOverrideIntoProjectImageSettings(
    getProjectImageSettings(projectId),
    useUIStore.getState().currentChapterCreativeOverride,
  )
}

type Getter = () => any
type Setter = (fn: (s: any) => any) => void
type NodeStatusValue = 'idle' | 'queued' | 'running' | 'success' | 'error'

interface RunnerHandlers {
  setNodeStatus: (id: string, status: NodeStatusValue, patch?: Partial<any>) => void
  appendLog: (id: string, line: string) => void
  beginToken: (id: string) => string
  endRunToken: (id: string) => void
  isCanceled: (id: string, runToken?: string | null) => boolean
}

interface RunnerContext extends RunnerHandlers {
  id: string
  state: any
  data: any
  kind: string
  taskKind: TaskKind
  prompt: string
  sampleCount: number
  supportsSamples: boolean
  isImageTask: boolean
  isVideoTask: boolean
  modelKey?: string
  getState: Getter
}

function nowLabel() {
  return new Date().toLocaleTimeString()
}

function readTrimmedRunnerText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeImageBillingSpecSegment(value: unknown): string {
  const raw = readTrimmedRunnerText(value).toLowerCase()
  if (!raw) return ''
  return raw.replace(/:/g, '_').replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
}

function buildImageBillingSpecKey(input: {
  modelKey: string
  aspectRatio: string
  imageSize?: string
  resolution?: string
  quality?: string
}): string | null {
  const resolution =
    normalizeImageBillingSpecSegment(input.resolution) ||
    normalizeImageBillingSpecSegment(input.imageSize)
  if (!resolution) return null
  const modelKey = input.modelKey.trim().toLowerCase()
  const quality = normalizeImageBillingSpecSegment(input.quality)
	if (modelKey.includes('gpt-image-2')) {
		return `image:${resolution}:${quality || 'low'}`
  }
  return null
}

export function buildCharacterBiblePromptHint(data: unknown): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  const record = data as Record<string, unknown>
  const bible =
    record.characterBible && typeof record.characterBible === 'object' && !Array.isArray(record.characterBible)
      ? (record.characterBible as Record<string, unknown>)
      : null
  if (!bible) return ''

  const identityHint =
    readTrimmedRunnerText(record.characterIdentityHint) ||
    readTrimmedRunnerText(bible.identityHint) ||
    readTrimmedRunnerText(bible.name)
  const worldview =
    readTrimmedRunnerText(record.characterWorldview) ||
    readTrimmedRunnerText(bible.filterWorldview)
  const theme =
    readTrimmedRunnerText(record.characterTheme) ||
    readTrimmedRunnerText(bible.filterTheme)
  const scene = readTrimmedRunnerText(record.characterScene) || readTrimmedRunnerText(bible.scene)
  const era = readTrimmedRunnerText(record.characterEra) || readTrimmedRunnerText(bible.era)
  const timePeriod =
    readTrimmedRunnerText(record.characterTimePeriod) ||
    readTrimmedRunnerText(bible.timePeriod)
  const traits =
    readTrimmedRunnerText(record.characterTraitsSummary) ||
    [
      readTrimmedRunnerText(bible.gender),
      readTrimmedRunnerText(bible.ageGroup),
      readTrimmedRunnerText(bible.species),
      readTrimmedRunnerText(bible.physique),
      readTrimmedRunnerText(bible.heightLevel),
      readTrimmedRunnerText(bible.hairColor),
      readTrimmedRunnerText(bible.temperament),
    ]
      .filter(Boolean)
      .join(' / ')
  const outfit = readTrimmedRunnerText(bible.outfit)
  const distinctiveFeatures = readTrimmedRunnerText(bible.distinctiveFeatures)

  const lines = [
    identityHint ? `角色事实锚点：${identityHint}` : '',
    traits ? `角色特征：${traits}` : '',
    outfit ? `服装约束：${outfit}` : '',
    distinctiveFeatures ? `辨识特征：${distinctiveFeatures}` : '',
    worldview ? `世界观：${worldview}` : '',
    theme ? `主题：${theme}` : '',
    era ? `时代大类：${era}` : '',
    timePeriod ? `时代细分：${timePeriod}` : '',
    scene ? `场景事实：${scene}` : '',
    '执行要求：若 referenceImages 中已给出角色参考图或三视图，必须保持同一角色身份、脸型、发型、服装主元素与关键配饰，不得改人设。',
  ].filter(Boolean)

  return lines.length ? lines.join('\n') : ''
}

const DEFAULT_TASK_POLL_TIMEOUT_MS = 600_000
const MAX_VIDEO_DURATION_SECONDS = 15
const SORA2_PRO_MAX_VIDEO_DURATION_SECONDS = 25
const IMAGE_NODE_KINDS = new Set(['image', 'imageEdit', 'storyboard'])
const VIDEO_RENDER_NODE_KINDS = new Set(['video', 'composeVideo'])
const NON_EXECUTABLE_REMOTE_NODE_KINDS = new Set(['text', 'workflowStage', 'workflowTrigger'])
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
function isVideoRenderKind(kind: string | null | undefined): boolean {
  return typeof kind === 'string' && VIDEO_RENDER_NODE_KINDS.has(kind)
}

function isStoryboardEditorKind(kind: string | null | undefined): boolean {
  return kind === 'storyboard'
}

function resolveImageTaskVendor(selectedModel: string, explicitVendor?: string | null): string {
  const normalizedExplicitVendor = String(explicitVendor || '').trim().toLowerCase()
  if (normalizedExplicitVendor) return normalizedExplicitVendor
  const modelLower = selectedModel.toLowerCase()
  if (modelLower.includes('gemini')) return 'gemini'
  if (modelLower.includes('gpt') || modelLower.includes('openai') || modelLower.includes('dall') || modelLower.includes('o3-')) {
    return 'openai'
  }
  return 'qwen'
}
type RoleCardRef = {
  roleName: string
  roleNameKey: string
  roleIdKey: string
  cardIdKey: string
  imageUrl: string
  ageDescription?: string
  stateLabel?: string
  stateDescription: string
  stateKey: string
  chapter?: number
  chapterStart?: number
  chapterEnd?: number
  chapterSpan?: number[]
  updatedAtTs: number
}

const ROLE_CARD_INDEX_CACHE = new Map<string, { at: number; roleNameMap: Map<string, RoleCardRef[]> }>()
const ROLE_CARD_INDEX_CACHE_TTL_MS = 60_000
type RoleCardMentionResult = { urls: string[]; matched: string[]; missing: string[]; ambiguous: string[] }
type PromptAssetRef = {
  assetRefId: string
  assetRefIdKey: string
  mentionKeys: string[]
  url: string
  assetId: string | null
  name: string
  updatedAtTs: number
  sourceNodeId?: string | null
  role?: 'style' | 'reference'
}
type PromptAssetMentionResult = {
  urls: string[]
  matched: string[]
  missing: string[]
  ambiguous: string[]
  sourceNodeIds: string[]
  assetInputs: RuntimeReferenceAssetInput[]
}
const PROJECT_ASSET_MENTION_CACHE = new Map<string, { at: number; refs: PromptAssetRef[] }>()
const PROJECT_ASSET_MENTION_CACHE_TTL_MS = 60_000
const MATERIAL_ASSET_MENTION_CACHE = new Map<string, { at: number; refs: PromptAssetRef[] }>()
const MATERIAL_ASSET_MENTION_CACHE_TTL_MS = 60_000

function createEmptyPromptAssetMentionResult(): PromptAssetMentionResult {
  return {
    urls: [],
    matched: [],
    missing: [],
    ambiguous: [],
    sourceNodeIds: [],
    assetInputs: [],
  }
}

function normalizeMentionToken(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[，。！？、；：,.!?;:)\]】》〉'"`]+$/g, '')
    .toLowerCase()
}

function normalizeMentionTokenCompact(raw: string): string {
  return normalizeMentionToken(raw).replace(/\s+/g, '')
}

function readPromptAssetReferenceUrl(record: Record<string, unknown>): string {
  const readUrl = (value: unknown): string => {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    return trimmed ? toAbsoluteHttpUrl(trimmed) || trimmed : ''
  }
  const imageResults = Array.isArray(record.imageResults) ? record.imageResults : []
  for (const item of imageResults) {
    if (!item || typeof item !== 'object') continue
    const url = readUrl((item as Record<string, unknown>).url)
    if (url) return url
  }
  const directImageUrl =
    readUrl(record.imageUrl) ||
    readUrl(record.referenceImageUrl) ||
    readUrl(record.previewUrl) ||
    readUrl(record.thumbnailUrl) ||
    readUrl(record.url)
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

function readPromptAssetRole(record: Record<string, unknown>): 'style' | 'reference' | undefined {
  const rawRole = String(record.assetRole || record.referenceRole || record.role || '').trim().toLowerCase()
  if (rawRole === 'style') return 'style'
  if (rawRole === 'reference') return 'reference'
  return undefined
}

function normalizeRoleCardStateKey(raw: string): string {
  return normalizeMentionToken(String(raw || '').replace(/\s+/g, ' '))
}

function normalizePositiveChapter(value: unknown): number | undefined {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return Math.trunc(numeric)
}

function normalizeChapterSpan(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.trunc(item))
}

function isRoleCardApplicableToChapter(input: {
  chapter?: number
  chapterStart?: number
  chapterEnd?: number
  chapterSpan?: number[]
}, chapter?: number | null): boolean {
  if (typeof chapter !== 'number' || !Number.isFinite(chapter) || chapter <= 0) return true
  const normalizedChapter = Math.trunc(chapter)
  const chapterSpan = normalizeChapterSpan(input.chapterSpan)
  if (chapterSpan.length > 0) return chapterSpan.includes(normalizedChapter)
  const exact = normalizePositiveChapter(input.chapter)
  if (typeof exact === 'number' && exact === normalizedChapter) return true
  const start = normalizePositiveChapter(input.chapterStart)
  const end = normalizePositiveChapter(input.chapterEnd) ?? start
  if (typeof start === 'number' && typeof end === 'number') return normalizedChapter >= start && normalizedChapter <= end
  if (typeof start === 'number') return normalizedChapter >= start
  return exact === undefined
}

function readRunnerChapter(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  return normalizePositiveChapter(record.chapter) ?? normalizePositiveChapter(record.materialChapter) ?? null
}

function buildProjectAssetRoleCardRefs(cards: ProjectRoleCardAssetDto[]): RoleCardRef[] {
  const refs: RoleCardRef[] = []
  for (const asset of cards) {
    const card = asset.data
    const status = String(card?.status || '').trim().toLowerCase()
    const imageUrl = String(card?.threeViewImageUrl || card?.imageUrl || '').trim()
    const roleName = String(card?.roleName || '').trim()
    const roleNameKey = normalizeMentionToken(roleName)
    if (status !== 'generated' || !imageUrl || !roleNameKey) continue
    refs.push({
      roleName,
      roleNameKey,
      roleIdKey: normalizeMentionToken(String(card?.roleId || '')),
      cardIdKey: normalizeMentionToken(String(card?.cardId || asset.id || '')),
      imageUrl,
      ageDescription: String(card?.ageDescription || card?.age || card?.ageLabel || '').trim(),
      stateLabel: String(card?.stateLabel || card?.currentState || card?.healthStatus || card?.injuryStatus || '').trim(),
      stateDescription: String(card?.stateDescription || '').trim(),
      stateKey: normalizeRoleCardStateKey(String(card?.stateKey || card?.stateDescription || '')),
      chapter: normalizePositiveChapter(card?.chapter),
      chapterStart: normalizePositiveChapter(card?.chapterStart),
      chapterEnd: normalizePositiveChapter(card?.chapterEnd),
      chapterSpan: normalizeChapterSpan(card?.chapterSpan),
      updatedAtTs: Date.parse(String(card?.updatedAt || asset.updatedAt || asset.createdAt || '')) || 0,
    })
  }
  return refs
}

function buildBookRoleCardRefs(index: ProjectBookIndexDto, chapter?: number | null): RoleCardRef[] {
  const roleCards = Array.isArray(index.assets?.roleCards) ? index.assets.roleCards : []
  return roleCards
    .map((card) => {
      const cardRecord = card as Record<string, unknown>
      const imageUrl = String(card.threeViewImageUrl || card.imageUrl || '').trim()
      const roleName = String(card.roleName || '').trim()
      const roleNameKey = normalizeMentionToken(roleName)
      const confirmedAt = String(card.confirmedAt || '').trim()
      const status = String(card.status || '').trim().toLowerCase()
      if (!imageUrl || !roleNameKey || !confirmedAt || status !== 'generated') return null
      const next: RoleCardRef = {
        roleName,
        roleNameKey,
        roleIdKey: normalizeMentionToken(String(card.roleId || '')),
        cardIdKey: normalizeMentionToken(String(card.cardId || '')),
        imageUrl,
        ageDescription: String(cardRecord.ageDescription || cardRecord.age || cardRecord.ageLabel || '').trim(),
        stateLabel: String(cardRecord.stateLabel || cardRecord.currentState || cardRecord.healthStatus || cardRecord.injuryStatus || '').trim(),
        stateDescription: String(card.stateDescription || '').trim(),
        stateKey: normalizeRoleCardStateKey(String(cardRecord.stateKey || card.stateDescription || '')),
        chapter: normalizePositiveChapter(card.chapter),
        chapterStart: normalizePositiveChapter(card.chapterStart),
        chapterEnd: normalizePositiveChapter(card.chapterEnd),
        chapterSpan: normalizeChapterSpan(card.chapterSpan),
        updatedAtTs: Date.parse(String(card.updatedAt || card.createdAt || '')) || 0,
      }
      return isRoleCardApplicableToChapter(next, chapter) ? next : null
    })
    .filter((item): item is RoleCardRef => item !== null)
}

async function resolveRoleCardImagesByMentions(input: {
  bookId?: string | null
  chapter?: number | null
  prompt?: string | null
}): Promise<RoleCardMentionResult> {
  const empty: RoleCardMentionResult = { urls: [], matched: [], missing: [], ambiguous: [] }
  const projectId = String((useUIStore.getState() as any)?.currentProject?.id || '').trim()
  const prompt = String(input.prompt || '').trim()
  if (!projectId || !prompt) return empty
  const mentions = extractRoleCardMentionTokens(prompt)
  if (!mentions.length) return empty

  const cacheKey = `${projectId}`
  if (input.bookId) {
    try {
      const index = await getProjectBookIndex(projectId, input.bookId)
      const roleRefs = buildBookRoleCardRefs(index, input.chapter)
      if (roleRefs.length > 0) {
        return buildRoleCardMatchResult(mentions, buildRoleCardNameMap(roleRefs))
      }
    } catch {
      // fall through to project asset cache
    }
  }
  const cached = await refreshRoleCardCacheIfNeeded({ cacheKey, projectId })
  return buildRoleCardMatchResult(mentions, cached.roleNameMap)
}

function sortRoleCardsByPriority(cards: RoleCardRef[]): RoleCardRef[] {
  return cards.slice().sort((a, b) => b.updatedAtTs - a.updatedAtTs)
}

function buildRoleCardNameMap(cards: RoleCardRef[]): Map<string, RoleCardRef[]> {
  const roleNameMap = new Map<string, RoleCardRef[]>()
  for (const asset of sortRoleCardsByPriority(cards)) {
    const keySet = new Set<string>([asset.roleNameKey, normalizeMentionTokenCompact(asset.roleName)])
    for (const key of keySet) {
      const normalizedKey = String(key || '').trim()
      if (!normalizedKey) continue
      const list = roleNameMap.get(normalizedKey) || []
      list.push(asset)
      roleNameMap.set(normalizedKey, list)
    }
  }
  return roleNameMap
}

async function refreshRoleCardCacheIfNeeded(input: {
  cacheKey: string
  projectId: string
}): Promise<{ at: number; roleNameMap: Map<string, RoleCardRef[]> }> {
  const now = Date.now()
  const cached = ROLE_CARD_INDEX_CACHE.get(input.cacheKey)
  if (cached && now - cached.at <= ROLE_CARD_INDEX_CACHE_TTL_MS) return cached
  const cards = await listProjectRoleCardAssets(input.projectId)
  const refreshed = { at: now, roleNameMap: buildRoleCardNameMap(buildProjectAssetRoleCardRefs(cards)) }
  ROLE_CARD_INDEX_CACHE.set(input.cacheKey, refreshed)
  return refreshed
}

function buildCanvasPromptAssetRefs(nodes: Node[]): PromptAssetRef[] {
  const out: PromptAssetRef[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    const primaryAsset = extractNodePrimaryAssetReference(node)
    if (!primaryAsset) continue
    const data = node.data && typeof node.data === 'object' && !Array.isArray(node.data)
      ? node.data as Record<string, unknown>
      : {}
    const mentionKeys = collectPromptMentionAliases({
      nodeId: node.id,
      assetId: primaryAsset.assetId,
      assetRefId: primaryAsset.assetRefId,
      aliases: [
        data.assetId,
        data.assetRefId,
        data.assetVersionId,
        data.referenceAssetId,
        data.referenceAssetVersionId,
        data.styleId,
      ],
      name: primaryAsset.displayName,
    })
    if (!mentionKeys.length) continue
    const seenKey = `${node.id}\u0000${primaryAsset.url}`
    if (seen.has(seenKey)) continue
    seen.add(seenKey)
    out.push({
      assetRefId: primaryAsset.assetRefId,
      assetRefIdKey: normalizePromptMentionAlias(primaryAsset.assetRefId) || mentionKeys[0]!,
      mentionKeys,
      url: primaryAsset.url,
      assetId: primaryAsset.assetId,
      name: primaryAsset.displayName,
      updatedAtTs: 0,
      sourceNodeId: node.id,
      role: readPromptAssetRole(data),
    })
  }
  return out
}

async function refreshProjectAssetMentionCacheIfNeeded(input: {
  cacheKey: string
  projectId: string
}): Promise<{ at: number; refs: PromptAssetRef[] }> {
  const now = Date.now()
  const cached = PROJECT_ASSET_MENTION_CACHE.get(input.cacheKey)
  if (cached && now - cached.at <= PROJECT_ASSET_MENTION_CACHE_TTL_MS) return cached
  const result = await listServerAssets({ projectId: input.projectId, kind: 'generation', limit: 200 })
  const refs = (Array.isArray(result.items) ? result.items : [])
    .map((asset): PromptAssetRef | null => {
      const rawData = asset?.data
      const data = rawData && typeof rawData === 'object' && !Array.isArray(rawData)
        ? rawData as Record<string, unknown>
        : {}
      const assetRefId = String(data.assetRefId || asset.name || asset.id || '').trim()
      const url = readPromptAssetReferenceUrl(data)
      const assetId = String(asset.id || '').trim() || null
      const name = String(data.assetName || asset.name || assetRefId).trim() || assetRefId
      const mentionKeys = collectPromptMentionAliases({
        assetId,
        assetRefId,
        aliases: [
          data.assetId,
          data.assetRefId,
          data.assetVersionId,
          data.referenceAssetId,
          data.referenceAssetVersionId,
          data.styleId,
        ],
        name,
      })
      if (!mentionKeys.length || !url) return null
      return {
        assetRefId,
        assetRefIdKey: normalizePromptMentionAlias(assetRefId) || mentionKeys[0]!,
        mentionKeys,
        url,
        assetId,
        name,
        updatedAtTs: Date.parse(String(asset.updatedAt || asset.createdAt || '')) || 0,
        role: readPromptAssetRole(data),
      }
    })
    .filter((item): item is PromptAssetRef => item !== null)
    .sort((left, right) => right.updatedAtTs - left.updatedAtTs)
  const refreshed = { at: now, refs }
  PROJECT_ASSET_MENTION_CACHE.set(input.cacheKey, refreshed)
  return refreshed
}

async function refreshMaterialAssetMentionCacheIfNeeded(input: {
  cacheKey: string
}): Promise<{ at: number; refs: PromptAssetRef[] }> {
  const now = Date.now()
  const cached = MATERIAL_ASSET_MENTION_CACHE.get(input.cacheKey)
  if (cached && now - cached.at <= MATERIAL_ASSET_MENTION_CACHE_TTL_MS) return cached
  const assets = await listMaterialAssets()
  const refs = assets
    .map((asset: MaterialAssetDto): PromptAssetRef | null => {
      const data = asset.latestVersion?.data || {}
      const assetRefId = String(data.assetRefId || asset.name || asset.id || '').trim()
      const assetId = String(asset.id || '').trim() || null
      const name = String(data.assetName || asset.name || assetRefId).trim() || assetRefId
      const url = readPromptAssetReferenceUrl(data)
      const mentionKeys = collectPromptMentionAliases({
        assetId,
        assetRefId,
        aliases: [
          asset.latestVersion?.id,
          data.assetId,
          data.assetRefId,
          data.assetVersionId,
          data.referenceAssetId,
          data.referenceAssetVersionId,
          data.styleId,
        ],
        name,
      })
      if (!mentionKeys.length || !url) return null
      return {
        assetRefId,
        assetRefIdKey: normalizePromptMentionAlias(assetRefId) || mentionKeys[0]!,
        mentionKeys,
        url,
        assetId,
        name,
        updatedAtTs: Date.parse(String(asset.updatedAt || asset.createdAt || '')) || 0,
        role: asset.kind === 'style' ? 'style' : 'reference',
      }
    })
    .filter((item): item is PromptAssetRef => item !== null)
    .sort((left, right) => right.updatedAtTs - left.updatedAtTs)
  const refreshed = { at: now, refs }
  MATERIAL_ASSET_MENTION_CACHE.set(input.cacheKey, refreshed)
  return refreshed
}

function buildLockedStylePromptAssetRef(projectId: string): PromptAssetRef | null {
  const lockedStyle = getRuntimeProjectImageSettings(projectId).lockedStyle
  const url = String(lockedStyle?.referenceImageUrl || '').trim()
  if (!url) return null
  const styleId = String(lockedStyle?.styleId || '').trim()
  const materialId = styleId.startsWith('material:') ? styleId.slice('material:'.length) : styleId
  const name = String(lockedStyle?.styleName || '').trim() || materialId || 'style'
  const mentionKeys = collectPromptMentionAliases({
    assetId: materialId,
    assetRefId: styleId,
    aliases: [styleId, materialId],
    name,
  })
  if (!mentionKeys.length) return null
  return {
    assetRefId: styleId || materialId || name,
    assetRefIdKey: mentionKeys[0]!,
    mentionKeys,
    url,
    assetId: materialId || null,
    name,
    updatedAtTs: 0,
    role: 'style',
  }
}

async function resolveAssetImagesByMentions(input: {
  prompt?: string | null
  nodes?: Node[]
}): Promise<PromptAssetMentionResult> {
  const empty = createEmptyPromptAssetMentionResult()
  const projectId = String((useUIStore.getState() as { currentProject?: { id?: string | null } })?.currentProject?.id || '').trim()
  const prompt = String(input.prompt || '').trim()
  if (!projectId || !prompt) return empty
  const mentions = extractPromptMentionTokens(prompt)
  if (!mentions.length) return empty

  const canvasRefs = buildCanvasPromptAssetRefs(Array.isArray(input.nodes) ? input.nodes : [])
  const projectCache = await refreshProjectAssetMentionCacheIfNeeded({ cacheKey: projectId, projectId })
  const materialCache = await refreshMaterialAssetMentionCacheIfNeeded({ cacheKey: 'account' })
  const lockedStyleRef = buildLockedStylePromptAssetRef(projectId)
  const candidatesByMention = new Map<string, PromptAssetRef[]>()
  for (const ref of [...canvasRefs, ...projectCache.refs, ...materialCache.refs, ...(lockedStyleRef ? [lockedStyleRef] : [])]) {
    for (const key of ref.mentionKeys) {
      const list = candidatesByMention.get(key) || []
      if (!list.some((item) => item.url === ref.url && item.assetId === ref.assetId && item.role === ref.role)) {
        list.push(ref)
        candidatesByMention.set(key, list)
      }
    }
  }

  const urls: string[] = []
  const urlSeen = new Set<string>()
  const matched: string[] = []
  const missing: string[] = []
  const ambiguous: string[] = []
  const sourceNodeIds: string[] = []
  const assetInputsByUrl = new Map<string, RuntimeReferenceAssetInput>()

  for (const mention of mentions) {
    const candidates = candidatesByMention.get(mention) || []
    if (candidates.length === 0) {
      missing.push(`@${mention}`)
      continue
    }
    if (candidates.length > 1) {
      ambiguous.push(`@${mention}`)
      continue
    }
    const candidate = candidates[0]!
    matched.push(`@${candidate.assetRefId}`)
    if (!urlSeen.has(candidate.url)) {
      urlSeen.add(candidate.url)
      urls.push(candidate.url)
    }
    if (candidate.sourceNodeId && !sourceNodeIds.includes(candidate.sourceNodeId)) {
      sourceNodeIds.push(candidate.sourceNodeId)
    }
    const binding: RuntimeReferenceAssetInput = {
      url: candidate.url,
      assetId: candidate.assetId,
      assetRefId: candidate.assetRefId,
      role: candidate.role || 'reference',
      name: candidate.name,
    }
    const existingBinding = assetInputsByUrl.get(candidate.url)
    if (!existingBinding || (binding.role === 'style' && existingBinding.role !== 'style')) {
      assetInputsByUrl.set(candidate.url, binding)
    }
  }

  return { urls, matched, missing, ambiguous, sourceNodeIds, assetInputs: Array.from(assetInputsByUrl.values()) }
}

function pickRoleCardCandidate(mention: RoleCardMentionToken, candidates: RoleCardRef[]): RoleCardRef | 'missing' | 'ambiguous' {
  if (!candidates.length) return 'missing'
  const narrowedByState = mention.stateKey
    ? candidates.filter((candidate) =>
        doesRoleCardStateMatchQuery({
          queryStateKey: mention.stateKey,
          ageDescription: candidate.ageDescription,
          stateDescription: candidate.stateDescription,
          stateLabel: candidate.stateLabel,
          stateKey: candidate.stateKey,
        }),
      )
    : candidates
  if (!narrowedByState.length) return 'missing'
  if (!mention.disambiguatorKey) return narrowedByState.length === 1 ? narrowedByState[0] : 'ambiguous'
  const picked =
    narrowedByState.find((x) => x.roleIdKey && x.roleIdKey.startsWith(mention.disambiguatorKey)) ||
    narrowedByState.find((x) => x.cardIdKey && x.cardIdKey.startsWith(mention.disambiguatorKey)) ||
    null
  return picked || 'missing'
}

function pushUniqueUrl(target: string[], seen: Set<string>, url: string) {
  if (!seen.has(url)) {
    seen.add(url)
    target.push(url)
  }
}

function buildRoleCardMatchResult(mentions: RoleCardMentionToken[], roleNameMap: Map<string, RoleCardRef[]>): RoleCardMentionResult {
  const urls: string[] = []
  const matched: string[] = []
  const missing: string[] = []
  const ambiguous: string[] = []
  const seenUrl = new Set<string>()
  for (const mention of mentions) {
    const picked = pickRoleCardCandidate(mention, roleNameMap.get(mention.roleNameKey) || [])
    if (picked === 'missing') {
      missing.push(mention.rawDisplay)
      continue
    }
    if (picked === 'ambiguous') {
      ambiguous.push(mention.rawDisplay)
      continue
    }
    const url = String(picked.imageUrl || '').trim()
    if (!url) {
      missing.push(mention.rawDisplay)
      continue
    }
    matched.push(mention.rawDisplay)
    pushUniqueUrl(urls, seenUrl, url)
  }
  return { urls: urls.slice(0, 3), matched, missing, ambiguous }
}

async function resolveFallbackRoleCardImages(input: {
  bookId?: string | null
  chapter?: number | null
  limit?: number
}): Promise<{ urls: string[]; names: string[] }> {
  const projectId = String((useUIStore.getState() as any)?.currentProject?.id || '').trim()
  const limit = Math.max(1, Math.min(8, Math.trunc(Number(input.limit || 3))))
  if (!projectId) return { urls: [], names: [] }
  try {
    const ordered = input.bookId
      ? (() => {
          const index = getProjectBookIndex(projectId, input.bookId)
          return index.then((value) => buildBookRoleCardRefs(value, input.chapter))
        })()
      : Promise.resolve<RoleCardRef[]>([])
    const bookOrdered = await ordered.catch(() => [])
    const projectOrdered = bookOrdered.length > 0
      ? bookOrdered
      : buildProjectAssetRoleCardRefs(await listProjectRoleCardAssets(projectId))
    const sorted = sortRoleCardsByPriority(projectOrdered)
    const urls: string[] = []
    const names: string[] = []
    const seen = new Set<string>()
    for (const asset of sorted) {
      const url = String(asset.imageUrl || '').trim()
      const roleName = String(asset.roleName || '').trim()
      if (!url || !roleName || seen.has(url)) continue
      seen.add(url)
      urls.push(url)
      names.push(roleName)
      if (urls.length >= limit) break
    }
    return { urls, names }
  } catch {
    return { urls: [], names: [] }
  }
}

function readSemanticAnchorBindings(nodeData: Record<string, unknown>): PublicFlowAnchorBinding[] {
  return normalizePublicFlowAnchorBindings(nodeData.anchorBindings)
}

function normalizeSemanticIdPart(input: unknown): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function inferSemanticShotNo(input: {
  explicitShotNo?: number
  nodeData: Record<string, unknown>
}): number | null {
  if (typeof input.explicitShotNo === 'number' && Number.isFinite(input.explicitShotNo) && input.explicitShotNo > 0) {
    return Math.trunc(input.explicitShotNo)
  }
  const candidates = [
    Number(input.nodeData.sourceShotNo),
    Number(input.nodeData.shotNo),
  ]
  for (const value of candidates) {
    if (Number.isFinite(value) && value > 0) return Math.trunc(value)
  }
  return null
}

function buildStableSemanticAssetId(input: {
  nodeId: string
  mediaKind: 'image' | 'video'
  explicitSemanticId?: string
  explicitShotNo?: number
  nodeData: Record<string, unknown>
}): string {
  const explicit = normalizeSemanticIdPart(input.explicitSemanticId)
  if (explicit) return explicit
  const sourceEntityKey = normalizeSemanticIdPart(input.nodeData.sourceEntityKey)
  if (sourceEntityKey) return `entity-${sourceEntityKey}-${input.mediaKind}`
  const sourceShotId = normalizeSemanticIdPart(input.nodeData.sourceShotId)
  if (sourceShotId) return `shot-${sourceShotId}-${input.mediaKind}`
  const shotNo = inferSemanticShotNo({
    explicitShotNo: input.explicitShotNo,
    nodeData: input.nodeData,
  })
  const chapter = readRunnerChapter(input.nodeData)
  if (shotNo && typeof chapter === 'number') {
    return `chapter-${chapter}-shot-${shotNo}-${input.mediaKind}`
  }
  if (shotNo) {
    return `shot-no-${shotNo}-${input.mediaKind}`
  }
  return `node-${normalizeSemanticIdPart(input.nodeId) || 'unknown'}-${input.mediaKind}`
}

async function resolveSemanticBookScope(input: {
  projectId: string
  nodeData: Record<string, unknown>
}): Promise<{
  sourceBookId: string | null
  bookScopeStatus: 'explicit' | 'single_project_book' | 'missing_or_ambiguous'
}> {
  const explicitBookIds = new Set<string>()
  const nodeSourceBookId = String(input.nodeData.sourceBookId || '').trim()
  if (nodeSourceBookId) explicitBookIds.add(nodeSourceBookId)
  for (const binding of readSemanticAnchorBindings(input.nodeData)) {
    const sourceBookId = String(binding.sourceBookId || '').trim()
    if (sourceBookId) explicitBookIds.add(sourceBookId)
  }
  if (explicitBookIds.size === 1) {
    return {
      sourceBookId: Array.from(explicitBookIds)[0] || null,
      bookScopeStatus: 'explicit',
    }
  }
  if (explicitBookIds.size > 1) {
    return {
      sourceBookId: null,
      bookScopeStatus: 'missing_or_ambiguous',
    }
  }
  try {
    const books = await listProjectBooks(input.projectId)
    if (books.length === 1) {
      const onlyBookId = String(books[0]?.bookId || '').trim()
      if (onlyBookId) {
        return {
          sourceBookId: onlyBookId,
          bookScopeStatus: 'single_project_book',
        }
      }
    }
  } catch {
    // keep missing_or_ambiguous
  }
  return {
    sourceBookId: null,
    bookScopeStatus: 'missing_or_ambiguous',
  }
}

async function persistSemanticAssetMetadata(input: {
  nodeId: string
  nodeKind: string
  nodeData: Record<string, unknown>
  mediaKind: 'image' | 'video'
  imageUrl?: string
  videoUrl?: string
  thumbnailUrl?: string
  prompt?: string
  shotNo?: number
  semanticId?: string
}): Promise<{
  semanticId: string
  sourceBookId: string | null
  metadataSynced: boolean
  bookScopeStatus: 'explicit' | 'single_project_book' | 'missing_or_ambiguous'
} | null> {
  const projectId = String((useUIStore.getState() as any)?.currentProject?.id || '').trim()
  if (!projectId) return null
  const imageUrl = String(input.imageUrl || '').trim()
  const videoUrl = String(input.videoUrl || '').trim()
  if (input.mediaKind === 'image' && !imageUrl) return null
  if (input.mediaKind === 'video' && !videoUrl) return null

  const { sourceBookId, bookScopeStatus } = await resolveSemanticBookScope({
    projectId,
    nodeData: input.nodeData,
  })
  if (!sourceBookId) {
    return {
      semanticId: String(input.semanticId || `node-${input.nodeId}-${input.mediaKind}`).trim(),
      sourceBookId: null,
      metadataSynced: false,
      bookScopeStatus,
    }
  }

  const chapter = readRunnerChapter(input.nodeData)
  const chapterStart = normalizePositiveChapter(input.nodeData.chapterStart)
  const chapterEnd = normalizePositiveChapter(input.nodeData.chapterEnd)
  const chapterSpan = normalizeChapterSpan(input.nodeData.chapterSpan)
  const stateDescription = String(input.nodeData.stateDescription || '').trim()
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  const resolvedShotNo = inferSemanticShotNo({
    explicitShotNo: input.shotNo,
    nodeData: input.nodeData,
  })
  const semanticId = buildStableSemanticAssetId({
    nodeId: input.nodeId,
    mediaKind: input.mediaKind,
    explicitSemanticId: input.semanticId,
    explicitShotNo: resolvedShotNo ?? undefined,
    nodeData: input.nodeData,
  })

  try {
    const synced = await upsertProjectBookSemanticAsset(projectId, sourceBookId, {
      semanticId,
      mediaKind: input.mediaKind,
      status: 'generated',
      nodeId: input.nodeId,
      nodeKind: input.nodeKind,
      ...(imageUrl ? { imageUrl } : {}),
      ...(videoUrl ? { videoUrl } : {}),
      ...(String(input.thumbnailUrl || '').trim() ? { thumbnailUrl: String(input.thumbnailUrl).trim() } : {}),
      ...(typeof chapter === 'number' ? { chapter } : {}),
      ...(typeof chapterStart === 'number' ? { chapterStart } : {}),
      ...(typeof chapterEnd === 'number' ? { chapterEnd } : {}),
      ...(chapterSpan.length > 0 ? { chapterSpan } : {}),
      ...(typeof resolvedShotNo === 'number' ? { shotNo: resolvedShotNo } : {}),
      ...(stateDescription ? { stateDescription } : {}),
      ...(prompt ? { prompt } : {}),
      ...(readSemanticAnchorBindings(input.nodeData).length
        ? { anchorBindings: readSemanticAnchorBindings(input.nodeData) }
        : {}),
      ...(String(input.nodeData.productionLayer || '').trim()
        ? { productionLayer: String(input.nodeData.productionLayer).trim() }
        : {}),
      ...(String(input.nodeData.creationStage || '').trim()
        ? { creationStage: String(input.nodeData.creationStage).trim() }
        : {}),
      ...(String(input.nodeData.approvalStatus || '').trim()
        ? { approvalStatus: String(input.nodeData.approvalStatus).trim() }
        : {}),
    })
    return {
      semanticId: String(synced?.semanticId || semanticId).trim(),
      sourceBookId,
      metadataSynced: true,
      bookScopeStatus,
    }
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'unknown error'
    throw new Error(`通用语义资产已解析，但同步书籍 semanticAssets 失败（book=${sourceBookId}）：${message}`)
  }
}

async function persistRoleCardImageBinding(input: {
  nodeId: string
  nodeData: Record<string, unknown>
  imageUrl: string
  prompt?: string
  modelKey?: string
}): Promise<{
  roleName: string
  roleId: string | null
  roleCardId: string | null
  sourceBookId: string | null
  metadataSynced: boolean
  bookScopeStatus: 'explicit' | 'single_project_book' | 'missing_or_ambiguous'
} | null> {
  const projectId = String((useUIStore.getState() as any)?.currentProject?.id || '').trim()
  const semanticRoleBinding = resolveSemanticNodeRoleBinding(input.nodeData)
  const roleName = String(semanticRoleBinding.roleName || '').trim()
  if (!projectId || !roleName) return null
  const bookScope = await resolveSemanticBookScope({
    projectId,
    nodeData: {
      ...input.nodeData,
      ...(semanticRoleBinding.sourceBookId ? { sourceBookId: semanticRoleBinding.sourceBookId } : {}),
    },
  })
  const resolvedSourceBookId = bookScope.sourceBookId
  const bookScopeStatus = bookScope.bookScopeStatus

  const chapter = readRunnerChapter(input.nodeData)
  const chapterStart = normalizePositiveChapter(input.nodeData.chapterStart)
  const chapterEnd = normalizePositiveChapter(input.nodeData.chapterEnd)
  const chapterSpan = normalizeChapterSpan(input.nodeData.chapterSpan)
  const stateDescription = String(input.nodeData.stateDescription || '').trim()
  const stateKey = normalizeRoleCardStateKey(String(input.nodeData.stateKey || stateDescription))
  const ageDescription = String(input.nodeData.ageDescription || '').trim()
  const stateLabel = String(input.nodeData.stateLabel || '').trim()
  const healthStatus = String(input.nodeData.healthStatus || '').trim()
  const injuryStatus = String(input.nodeData.injuryStatus || '').trim()
  const threeViewImageUrl =
    semanticRoleBinding.referenceView === 'three_view'
      ? String(input.imageUrl || '').trim()
      : ''
  const saved = await upsertProjectRoleCardAsset(projectId, {
    cardId: String(input.nodeData.roleCardId || '').trim() || undefined,
    roleId: String(input.nodeData.roleId || '').trim() || undefined,
    roleName,
    ...(stateDescription ? { stateDescription } : {}),
    ...(stateKey ? { stateKey } : {}),
    ...(ageDescription ? { ageDescription } : {}),
    ...(stateLabel ? { stateLabel } : {}),
    ...(healthStatus ? { healthStatus } : {}),
    ...(injuryStatus ? { injuryStatus } : {}),
    ...(typeof chapter === 'number' ? { chapter } : {}),
    ...(typeof chapterStart === 'number' ? { chapterStart } : {}),
    ...(typeof chapterEnd === 'number' ? { chapterEnd } : {}),
    ...(chapterSpan.length > 0 ? { chapterSpan } : {}),
    nodeId: input.nodeId,
    prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
    status: 'generated',
    modelKey: String(input.modelKey || '').trim() || undefined,
    imageUrl: String(input.imageUrl || '').trim() || undefined,
    ...(threeViewImageUrl ? { threeViewImageUrl } : {}),
  })
  let resolvedRoleId = String(saved?.data?.roleId || '').trim()
  let resolvedRoleCardId = String(saved?.data?.cardId || saved?.id || '').trim()
  let metadataSynced = false

  if (resolvedSourceBookId) {
    try {
      const synced = await upsertProjectBookRoleCard(projectId, resolvedSourceBookId, {
        cardId: resolvedRoleCardId || undefined,
        roleId: resolvedRoleId || undefined,
        roleName,
        ...(stateDescription ? { stateDescription } : {}),
        ...(stateKey ? { stateKey } : {}),
        ...(ageDescription ? { ageDescription } : {}),
        ...(stateLabel ? { stateLabel } : {}),
        ...(healthStatus ? { healthStatus } : {}),
        ...(injuryStatus ? { injuryStatus } : {}),
        ...(typeof chapter === 'number' ? { chapter } : {}),
        ...(typeof chapterStart === 'number' ? { chapterStart } : {}),
        ...(typeof chapterEnd === 'number' ? { chapterEnd } : {}),
        ...(chapterSpan.length > 0 ? { chapterSpan } : {}),
        nodeId: input.nodeId,
        prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
        status: 'generated',
        modelKey: String(input.modelKey || '').trim() || undefined,
        imageUrl: String(input.imageUrl || '').trim() || undefined,
        ...(threeViewImageUrl ? { threeViewImageUrl } : {}),
      })
      resolvedRoleCardId = String(synced?.cardId || resolvedRoleCardId).trim()
      metadataSynced = true
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'unknown error'
      throw new Error(`角色卡已写入 project 资产，但同步书籍 roleCards 失败（book=${resolvedSourceBookId}）：${message}`)
    }
  }

  return {
    roleName,
    roleId: resolvedRoleId || null,
    roleCardId: resolvedRoleCardId || null,
    sourceBookId: resolvedSourceBookId || null,
    metadataSynced,
    bookScopeStatus,
  }
}

async function persistVisualReferenceImageBinding(input: {
  nodeId: string
  nodeData: Record<string, unknown>
  imageUrl: string
  prompt?: string
  modelKey?: string
}): Promise<{
  refId: string
  refName: string
  category: 'scene_prop' | 'spell_fx'
  sourceBookId: string
  bookScopeStatus: 'explicit' | 'single_project_book' | 'missing_or_ambiguous'
} | null> {
  const projectId = String((useUIStore.getState() as any)?.currentProject?.id || '').trim()
  const semanticVisualBinding = resolveSemanticNodeVisualReferenceBinding(input.nodeData)
  const refName = String(semanticVisualBinding.refName || '').trim()
  const category = semanticVisualBinding.category || 'scene_prop'
  if (!projectId || !refName) return null

  const bookScope = await resolveSemanticBookScope({
    projectId,
    nodeData: {
      ...input.nodeData,
      ...(semanticVisualBinding.sourceBookId ? { sourceBookId: semanticVisualBinding.sourceBookId } : {}),
    },
  })
  const resolvedSourceBookId = bookScope.sourceBookId
  const bookScopeStatus = bookScope.bookScopeStatus

  if (!resolvedSourceBookId) return null

  const chapter = readRunnerChapter(input.nodeData)
  const chapterStart = normalizePositiveChapter(input.nodeData.chapterStart)
  const chapterEnd = normalizePositiveChapter(input.nodeData.chapterEnd)
  const chapterSpan = normalizeChapterSpan(input.nodeData.chapterSpan)
  const stateDescription = String(input.nodeData.stateDescription || '').trim()
  const stateKey = normalizeRoleCardStateKey(String(input.nodeData.stateKey || stateDescription))
  const synced = await upsertProjectBookVisualRef(projectId, resolvedSourceBookId, {
    refId: String(semanticVisualBinding.refId || '').trim() || undefined,
    category,
    name: refName,
    ...(typeof chapter === 'number' ? { chapter } : {}),
    ...(typeof chapterStart === 'number' ? { chapterStart } : {}),
    ...(typeof chapterEnd === 'number' ? { chapterEnd } : {}),
    ...(chapterSpan.length > 0 ? { chapterSpan } : {}),
    ...(stateDescription ? { stateDescription } : {}),
    ...(stateKey ? { stateKey } : {}),
    nodeId: input.nodeId,
    prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
    status: 'generated',
    modelKey: String(input.modelKey || '').trim() || undefined,
    imageUrl: String(input.imageUrl || '').trim() || undefined,
  })

  return {
    refId: String(synced?.refId || semanticVisualBinding.refId || '').trim(),
    refName,
    category,
    sourceBookId: resolvedSourceBookId,
    bookScopeStatus,
  }
}

function buildSemanticProjectTaskBindingPatch(input: {
  nodeData: Record<string, unknown>
  taskKind: TaskKind
}): Record<string, unknown> {
  if (input.taskKind !== 'text_to_image') return {}
  const roleBinding = resolveSemanticNodeRoleBinding(input.nodeData)
  const visualBinding = resolveSemanticNodeVisualReferenceBinding(input.nodeData)
  const patch: Record<string, unknown> = {}

  const existingRoleName = String(input.nodeData.roleName || '').trim()
  const existingRoleId = String(input.nodeData.roleId || '').trim()
  const existingRoleCardId = String(input.nodeData.roleCardId || '').trim()
  const existingReferenceView = String(input.nodeData.referenceView || '').trim()
  const existingSourceBookId = String(input.nodeData.sourceBookId || input.nodeData.bookId || '').trim()
  const existingVisualRefId =
    String(input.nodeData.scenePropRefId || input.nodeData.visualRefId || '').trim()
  const existingVisualRefName =
    String(input.nodeData.scenePropRefName || input.nodeData.visualRefName || '').trim()
  const existingVisualRefCategory = String(input.nodeData.visualRefCategory || '').trim()

  if (roleBinding.roleName && !existingRoleName) patch.roleName = roleBinding.roleName
  if (roleBinding.roleId && !existingRoleId) patch.roleId = roleBinding.roleId
  if (roleBinding.roleCardId && !existingRoleCardId) patch.roleCardId = roleBinding.roleCardId
  if (roleBinding.referenceView && !existingReferenceView) patch.referenceView = roleBinding.referenceView
  if (roleBinding.sourceBookId && !existingSourceBookId) patch.sourceBookId = roleBinding.sourceBookId

  if (visualBinding.refId && !existingVisualRefId) {
    patch.visualRefId = visualBinding.refId
    if (!String(input.nodeData.scenePropRefId || '').trim()) patch.scenePropRefId = visualBinding.refId
  }
  if (visualBinding.refName && !existingVisualRefName) {
    patch.visualRefName = visualBinding.refName
    if (!String(input.nodeData.scenePropRefName || '').trim()) patch.scenePropRefName = visualBinding.refName
  }
  if (visualBinding.category && !existingVisualRefCategory) {
    patch.visualRefCategory = visualBinding.category
  }
  if (visualBinding.sourceBookId && !existingSourceBookId) {
    patch.sourceBookId = visualBinding.sourceBookId
  }
  if (
    roleBinding.roleName ||
    roleBinding.roleCardId ||
    roleBinding.roleId ||
    visualBinding.refName ||
    visualBinding.refId
  ) {
    let nextAnchorBindings = input.nodeData.anchorBindings
    if (roleBinding.roleName || roleBinding.roleCardId || roleBinding.roleId) {
      nextAnchorBindings = upsertSemanticNodeAnchorBinding({
        existing: nextAnchorBindings,
        next: {
          kind: 'character',
          label: roleBinding.roleName,
          refId: roleBinding.roleCardId,
          entityId: roleBinding.roleId,
          sourceBookId: roleBinding.sourceBookId,
          referenceView: roleBinding.referenceView,
        },
      })
    }
    if (visualBinding.refName || visualBinding.refId) {
      nextAnchorBindings = upsertSemanticNodeAnchorBinding({
        existing: nextAnchorBindings,
        next: {
          kind: 'scene',
          label: visualBinding.refName,
          refId: visualBinding.refId,
          sourceBookId: visualBinding.sourceBookId,
          category: visualBinding.category,
        },
        replaceKinds: ['scene', 'prop'],
      })
    }
    patch.anchorBindings = nextAnchorBindings
  }

  return patch
}

function readNodeRunToken(getState: Getter, id: string): string | null {
  const s = getState()
  const nodes = (s?.nodes || []) as any[]
  const node = nodes.find((n) => n?.id === id)
  const token = (node?.data as any)?.runToken
  if (typeof token !== 'string') return null
  const trimmed = token.trim()
  return trimmed ? trimmed : null
}

function isRunTokenActive(getState: Getter, id: string, runToken: string): boolean {
  if (!runToken) return true
  return readNodeRunToken(getState, id) === runToken
}

function requirePublicApiRuntime(): { apiKey: string; vendorCandidates?: string[] } {
  const ui = useUIStore.getState() as any
  const apiKey = typeof ui?.publicApiKey === 'string' ? ui.publicApiKey.trim() : ''
	if (!apiKey && !hasAuthSession()) {
    throw new Error('未登录：请先登录后再试')
  }
  const candidates = Array.isArray(ui?.publicVendorCandidates) ? ui.publicVendorCandidates : []
  const vendorCandidates = candidates
    .map((v: any) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
  return { apiKey, ...(vendorCandidates.length ? { vendorCandidates } : {}) }
}

const TASK_LOG_REQUEST_MAX_CHARS = 12000

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function looksLikeBase64DataUrl(value: string): boolean {
  return /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i.test(value.trim())
}

function looksLikeBareBase64(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  if (!compact || compact.length < 256) return false
  if (compact.length % 4 !== 0) return false
  return /^[a-z0-9+/=]+$/i.test(compact)
}

function buildReferenceSheetLogMeta(sheet: UploadedReferenceSheet | null | undefined): Record<string, unknown> | undefined {
  if (!sheet?.url) return undefined
  return {
    kind: 'collage',
    url: sheet.url,
    sourceUrls: sheet.sourceUrls,
    entries: sheet.entries.map((entry) => ({
      id: entry.label,
      sourceUrl: entry.sourceUrl,
      ...(entry.assetId ? { assetId: entry.assetId } : null),
      ...(entry.note ? { note: entry.note } : null),
    })),
  }
}

function shouldAutoMergeReferenceSheet(): boolean {
  return false
}

function sanitizeTaskLogValue(value: unknown): unknown {
  const seen = new WeakSet<object>()

  const walk = (input: unknown): unknown => {
    if (input === null || input === undefined) return input
    if (typeof input === 'string') {
      const trimmed = input.trim()
      if (looksLikeBase64DataUrl(trimmed)) {
        return `[stripped-data-url len=${trimmed.length}]`
      }
      if (looksLikeBareBase64(trimmed)) {
        return `[stripped-base64 len=${trimmed.replace(/\s+/g, '').length}]`
      }
      return input
    }
    if (typeof input !== 'object') return input
    if (seen.has(input)) return '[Circular]'
    seen.add(input)
    if (Array.isArray(input)) return input.map((item) => walk(item))
    if (!isPlainRecord(input)) return input

    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(input)) {
      if (typeof child === 'string' && looksLikeBase64DataUrl(child)) {
        out[key] = `[stripped-data-url len=${child.trim().length}]`
        continue
      }
      if (typeof child === 'string' && looksLikeBareBase64(child)) {
        out[key] = `[stripped-base64 len=${child.replace(/\s+/g, '').length}]`
        continue
      }
      out[key] = walk(child)
    }
    return out
  }

  return walk(value)
}

function formatTaskLogJson(value: unknown): string {
  const text = JSON.stringify(sanitizeTaskLogValue(value), null, 2)
  if (typeof text !== 'string' || !text.trim()) return 'null'
  if (text.length <= TASK_LOG_REQUEST_MAX_CHARS) return text
  return `${text.slice(0, TASK_LOG_REQUEST_MAX_CHARS)}\n…[truncated]`
}

function appendRequestPayloadLog(input: {
  appendLog: RunnerHandlers['appendLog']
  nodeId: string
  result: TaskResultDto
  fallbackVendor: string
  fallbackRequest?: TaskRequestDto
}): void {
  const raw = isPlainRecord(input.result.raw) ? input.result.raw : null
  const provider = raw && typeof raw.provider === 'string' ? raw.provider.trim() : ''
  const upstreamRequest = raw && 'request' in raw ? raw.request : undefined

  if (typeof upstreamRequest !== 'undefined') {
    input.appendLog(
      input.nodeId,
      `[${nowLabel()}] 上游请求体（${provider || input.fallbackVendor}）:\n${formatTaskLogJson(upstreamRequest)}`,
    )
    return
  }

  if (input.fallbackRequest) {
    input.appendLog(
      input.nodeId,
      `[${nowLabel()}] 请求体（${input.fallbackVendor}）:\n${formatTaskLogJson({ vendor: input.fallbackVendor, request: input.fallbackRequest })}`,
    )
  }
}

async function runTaskByVendor(vendor: string, request: TaskRequestDto): Promise<TaskResultDto> {
  const normalizedVendor = String(vendor || '').trim()
  if (!normalizedVendor) {
    throw new Error('vendor is required')
  }
  const { apiKey, vendorCandidates } = requirePublicApiRuntime()
  const contextualRequest = withCanvasGenerationContext(request, useUIStore.getState())
  const res = await runPublicTask(apiKey, {
    vendor: normalizedVendor,
    ...(normalizedVendor === 'auto' && vendorCandidates ? { vendorCandidates } : {}),
    request: contextualRequest,
  })
  return res.result
}

function beginPendingRequestProgress(
  ctx: Pick<RunnerContext, 'id' | 'setNodeStatus' | 'isCanceled'>,
  options: {
    status?: 'queued' | 'running'
    startProgress: number
    maxProgress: number
    statusPatch?: Record<string, unknown>
    stepMs?: number
  },
): () => number {
  const status = options.status ?? 'running'
  const startProgress = Math.max(0, Math.min(95, Math.round(options.startProgress)))
  const maxProgress = Math.max(startProgress, Math.min(95, Math.round(options.maxProgress)))
  const stepMs = Math.max(600, Math.round(options.stepMs ?? 1800))
  let lastProgress = startProgress
  if (maxProgress <= startProgress) {
    return () => lastProgress
  }

  const timer = setInterval(() => {
    if (ctx.isCanceled(ctx.id)) {
      clearInterval(timer)
      return
    }
    const nextProgress = Math.min(maxProgress, lastProgress + 1)
    if (nextProgress <= lastProgress) return
    lastProgress = nextProgress
    ctx.setNodeStatus(ctx.id, status, {
      ...(options.statusPatch || {}),
      progress: lastProgress,
    })
  }, stepMs)

  return () => {
    clearInterval(timer)
    return lastProgress
  }
}

async function runTaskByVendorWithPendingProgress(
  ctx: Pick<RunnerContext, 'id' | 'setNodeStatus' | 'isCanceled'>,
  options: {
    vendor: string
    request: TaskRequestDto
    startProgress: number
    maxProgress: number
    status?: 'queued' | 'running'
    statusPatch?: Record<string, unknown>
    stepMs?: number
  },
): Promise<{ result: TaskResultDto; requestProgress: number }> {
  const stopProgress = beginPendingRequestProgress(ctx, {
    status: options.status,
    startProgress: options.startProgress,
    maxProgress: options.maxProgress,
    statusPatch: options.statusPatch,
    stepMs: options.stepMs,
  })
  try {
    const result = await runTaskByVendor(options.vendor, options.request)
    return {
      result,
      requestProgress: stopProgress(),
    }
  } catch (error) {
    stopProgress()
    throw error
  }
}

async function runChatByVendor(vendor: string, payload: {
  prompt: string
  systemPrompt?: string
  modelKey?: string
  referenceImages?: string[]
}): Promise<TaskResultDto> {
  const normalizedVendor = String(vendor || '').trim()
  if (!normalizedVendor) {
    throw new Error('vendor is required')
  }
  const { vendorCandidates } = requirePublicApiRuntime()
  const res = await agentsChat({
    vendor: normalizedVendor,
    ...(normalizedVendor === 'auto' && vendorCandidates ? { vendorCandidates } : {}),
    prompt: payload.prompt,
    ...(payload.systemPrompt ? { systemPrompt: payload.systemPrompt } : {}),
    ...(payload.modelKey ? { modelKey: payload.modelKey } : {}),
    ...(Array.isArray(payload.referenceImages) && payload.referenceImages.length
      ? { referenceImages: payload.referenceImages }
      : {}),
    mode: 'auto',
  })
  const assets = Array.isArray(res.assets)
    ? res.assets
        .map((a): TaskAssetDto => {
          const type = String(a?.type || '').trim().toLowerCase()
          const url = typeof a?.url === 'string' ? a.url.trim() : ''
          if (!url) throw new Error('agents chat 返回了无效的资产 URL')
          if (type !== 'image' && type !== 'video' && type !== 'audio') {
            throw new Error(`agents chat 返回了不支持的资产类型：${type || 'missing'}`)
          }
          return {
            type,
            url,
            ...((type === 'image' || type === 'video') && a?.thumbnailUrl
              ? { thumbnailUrl: a.thumbnailUrl }
              : null),
          }
        })
    : []
  return {
    id: res.id,
    kind: 'chat',
    status: 'succeeded',
    assets,
    raw: {
      ...(res as any),
      text: typeof res.text === 'string' ? res.text : '',
    },
  }
}

async function fetchTaskResult(
  taskId: string,
  taskKind?: TaskKind,
  prompt?: string | null,
): Promise<TaskResultDto> {
  const { apiKey } = requirePublicApiRuntime()
  const res = await fetchPublicTaskResult(apiKey, {
    taskId: taskId.trim(),
    ...(taskKind ? { taskKind } : {}),
    ...(typeof prompt === 'string' ? { prompt } : {}),
  })
  return res.result
}

function extractTaskProgressPercent(snapshot: TaskResultDto): number | null {
  const raw = snapshot.raw as any
  const rawProgress =
    (typeof raw?.progress === 'number' ? raw.progress : null) ??
    (typeof raw?.response?.progress === 'number' ? raw.response.progress : null) ??
    (typeof raw?.response?.progress_pct === 'number' ? raw.response.progress_pct * 100 : null)
  if (typeof rawProgress !== 'number' || !Number.isFinite(rawProgress)) return null
  const pct = rawProgress <= 1 ? rawProgress * 100 : rawProgress
  return Math.max(0, Math.min(100, pct))
}

function extractTaskFailureMessage(snapshot: TaskResultDto): string {
  const raw = snapshot.raw as any
  return (
    (typeof raw?.failureReason === 'string' && raw.failureReason.trim()) ||
    (typeof raw?.response?.error === 'string' && raw.response.error.trim()) ||
    (typeof raw?.response?.message === 'string' && raw.response.message.trim()) ||
    (typeof raw?.error === 'string' && raw.error.trim()) ||
    (typeof raw?.message === 'string' && raw.message.trim()) ||
    '任务失败'
  )
}

function updateTaskPollingProgress(
  ctx: Pick<RunnerContext, 'id' | 'setNodeStatus'>,
  snapshot: TaskResultDto,
  options: {
    progressRange?: { min: number; max: number }
    statusPatch?: Record<string, any>
    lastProgress: number
  },
): number {
  const pct = extractTaskProgressPercent(snapshot)
  const progressMin = options.progressRange?.min
  const progressMax = options.progressRange?.max
  if (pct == null || typeof progressMin !== 'number' || typeof progressMax !== 'number') {
    return options.lastProgress
  }
  const mapped = progressMin + Math.round(((progressMax - progressMin) * pct) / 100)
  const normalized = Math.min(95, Math.max(options.lastProgress, Math.max(progressMin, mapped)))
  ctx.setNodeStatus(ctx.id, snapshot.status === 'queued' ? 'queued' : 'running', {
    ...(options.statusPatch || {}),
    progress: normalized,
  })
  return normalized
}

type StoryboardImageStyle = 'realistic' | 'comic' | 'sketch' | 'strip'
type StoryboardImageAspectRatio = '16:9' | '9:16'

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function normalizeStoryboardImageStyle(value: unknown): StoryboardImageStyle {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (v === 'comic' || v === 'sketch' || v === 'strip' || v === 'realistic') return v
  return 'realistic'
}

function normalizeStoryboardImageAspectRatio(value: unknown): StoryboardImageAspectRatio {
  return value === '9:16' ? '9:16' : '16:9'
}

function toAbsoluteHttpUrl(raw: string): string | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (typeof window === 'undefined') return null
  try {
    const u = new URL(trimmed, window.location.href)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString()
    return null
  } catch {
    return null
  }
}

async function fetchBlob(url: string, init?: RequestInit): Promise<Blob> {
  const resp = await fetch(url, init)
  if (!resp.ok) throw new Error(`下载失败（${resp.status}）`)
  return await resp.blob()
}

async function fetchImageBlob(url: string): Promise<Blob> {
  const trimmed = (url || '').trim()
  if (!trimmed) throw new Error('缺少图片 URL')
  return await fetchBlob(trimmed)
}

async function splitGridToBlobs(options: {
  url: string
  rows: number
  cols: number
  take: number
}): Promise<Blob[]> {
  const { url, rows, cols, take } = options
  const blob = await fetchImageBlob(url)
  const bitmap = await createImageBitmap(blob)
  const w = bitmap.width
  const h = bitmap.height
  if (!w || !h) {
    bitmap.close()
    throw new Error('图片尺寸异常')
  }

  const out: Blob[] = []
  const total = Math.max(0, Math.min(rows * cols, Math.floor(take)))
  for (let idx = 0; idx < total; idx++) {
    const r = Math.floor(idx / cols)
    const c = idx % cols
    const sx = Math.floor((w * c) / cols)
    const ex = Math.floor((w * (c + 1)) / cols)
    const sy = Math.floor((h * r) / rows)
    const ey = Math.floor((h * (r + 1)) / rows)
    const sw = Math.max(1, ex - sx)
    const sh = Math.max(1, ey - sy)

    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      throw new Error('Canvas 初始化失败')
    }
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
    // eslint-disable-next-line no-await-in-loop
    const part = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出图片失败'))), 'image/png')
    })
    out.push(part)
  }
  bitmap.close()
  return out
}

function extractFirstImageAssetUrl(res: any): string | null {
  const urls = extractImageUrlsFromTaskResult(res)
  return urls[0] || null
}

function findTaskAssetIdByUrl(result: TaskResultDto | null | undefined, url: string): string | null {
  const normalizedUrl = String(url || '').trim()
  if (!normalizedUrl) return null
  const assets = Array.isArray(result?.assets) ? result.assets : []
  for (const asset of assets) {
    if (String(asset?.url || '').trim() !== normalizedUrl) continue
    const assetId = typeof asset?.assetId === 'string' ? asset.assetId.trim() : ''
    if (assetId) return assetId
  }
  return null
}

function normalizePossibleImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^data:image\/[^;]+;base64,/i.test(trimmed)) return trimmed
  const compact = trimmed.replace(/\s+/g, '')
  const looksLikeBase64 =
    compact.length > 256 &&
    /^[A-Za-z0-9+/_-]+=*$/.test(compact) &&
    (
      compact.startsWith('/9j/') ||
      compact.startsWith('iVBORw0KGgo') ||
      compact.startsWith('R0lGOD') ||
      compact.startsWith('UklGR') ||
      compact.startsWith('Qk0')
    )
  if (!looksLikeBase64) return null
  const mime = compact.startsWith('/9j/')
    ? 'image/jpeg'
    : compact.startsWith('R0lGOD')
      ? 'image/gif'
      : compact.startsWith('UklGR')
        ? 'image/webp'
        : compact.startsWith('Qk0')
          ? 'image/bmp'
          : 'image/png'
  return `data:${mime};base64,${compact}`
}

function extractImageUrlsFromTaskResult(res: any): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: unknown) => {
    const u = normalizePossibleImageUrl(raw)
    if (!u || seen.has(u)) return
    seen.add(u)
    out.push(u)
  }
  const visit = (value: any) => {
    if (!value) return
    const arr = Array.isArray(value) ? value : [value]
    for (const item of arr) {
      if (!item) continue
      if (typeof item === 'string') {
        push(item)
        continue
      }
      if (typeof item !== 'object') continue
      push((item as any).url)
      push((item as any).imageUrl)
      push((item as any).image_url)
      push((item as any).resultUrl)
      push((item as any).result_url)
      push((item as any).b64_json)
      push((item as any).base64)
      push((item as any).image_base64)
    }
  }

  const assets = Array.isArray(res?.assets) ? res.assets : []
  visit(assets.filter((a: any) => String(a?.type || '').toLowerCase() === 'image'))
  const raw = (res as any)?.raw || {}
  const candidates = [
    raw?.data,
    raw?.results,
    raw?.images,
    raw?.imageUrls,
    raw?.output?.data,
    raw?.output?.results,
    raw?.output?.images,
    raw?.response?.data,
    raw?.response?.results,
    raw?.response?.images,
    raw?.response?.output?.data,
    raw?.response?.output?.results,
    raw?.response?.output?.images,
  ]
  candidates.forEach(visit)
  return out.slice(0, 8)
}

async function ensureHostedImageUrl(url: string, meta?: {
  prompt?: string
  vendor?: string
  modelKey?: string
  taskKind?: TaskKind
  fileName?: string
}): Promise<string> {
  const normalized = String(url || '').trim()
  if (!normalized) return normalized

  const isBase64 = /^data:image\/[^;]+;base64,/i.test(normalized)
  const isExternalHttp = !isBase64
    && (normalized.startsWith('http://') || normalized.startsWith('https://'))
    && !isTapCanvasHostedUploadUrl(normalized)

  if (!isBase64 && !isExternalHttp) return normalized

  try {
    let blob: Blob
    if (isBase64) {
      const resp = await fetch(normalized)
      if (!resp.ok) return normalized
      blob = await resp.blob()
    } else {
      // External http URL - upload to TOS so future loads use our stable URL
      blob = await fetchProxiedImageBlob(normalized)
    }
    const mime = blob.type || 'image/png'
    const ext = mime.includes('jpeg') || mime.includes('jpg')
      ? 'jpg'
      : mime.includes('webp')
        ? 'webp'
        : mime.includes('gif')
          ? 'gif'
          : 'png'
    const file = new File([blob], meta?.fileName || `task-image-${Date.now()}.${ext}`, { type: mime })
    const uploaded = await uploadServerAssetFile(file, file.name, {
      prompt: meta?.prompt,
      vendor: meta?.vendor,
      modelKey: meta?.modelKey,
      taskKind: meta?.taskKind,
    })
    const hosted = typeof (uploaded as any)?.data?.url === 'string' ? String((uploaded as any).data.url).trim() : ''
    return hosted || normalized
  } catch {
    return normalized
  }
}

function getRemixTargetIdFromNodeData(data?: any): string | null {
  if (!data) return null
  const kind = String(data.kind || '').toLowerCase()
  const isVideoKind = kind === 'video' || kind === 'composevideo'
  if (!isVideoKind) return null

  const sanitize = (val: any) => {
    if (typeof val !== 'string') return null
    const trimmed = val.trim()
    if (!trimmed) return null
    const lower = trimmed.toLowerCase()
    // 仅允许 postId / p/ 形态
    if (lower.startsWith('s_') || lower.startsWith('p/')) return trimmed
    return null
  }

  const videoResults = Array.isArray(data.videoResults) ? data.videoResults : []
  const primaryIndex =
    typeof data.videoPrimaryIndex === 'number' &&
    data.videoPrimaryIndex >= 0 &&
    data.videoPrimaryIndex < videoResults.length
      ? data.videoPrimaryIndex
      : videoResults.length > 0
        ? 0
        : -1
  const primaryResult = primaryIndex >= 0 ? videoResults[primaryIndex] : null

  const candidates = [
    sanitize(data.videoPostId),
    sanitize(primaryResult?.remixTargetId),
    sanitize(primaryResult?.pid),
    sanitize(primaryResult?.postId),
    sanitize(primaryResult?.post_id),
  ]

  return candidates.find(Boolean) || null
}

function collectReferenceImages(
  state: any,
  targetId: string,
): string[] {
  if (!state) return []
  const edges = Array.isArray(state.edges) ? (state.edges as Edge[]) : []
  const nodes = Array.isArray(state.nodes) ? (state.nodes as Node[]) : []
  const orderedItems = collectOrderedUpstreamReferenceItems(nodes, edges, targetId)
  if (orderedItems.length === 0) return []

  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  const collected: string[] = []
  for (const item of orderedItems) {
    if (item.sourceKind === 'video') {
      // When actual video URL is available, skip thumbnail — it goes via upstreamVideoUrl instead
      if (!item.videoUrl && item.previewUrl) collected.push(item.previewUrl)
      continue
    }
    const sourceNode = nodeById.get(item.sourceNodeId)
    const primary = pickPrimaryImageFromNode(sourceNode)
    if (primary) collected.push(primary)
  }

  const mostRecentImageItem = orderedItems.find((item) => item.sourceKind === 'image' || item.sourceKind === 'imageEdit')
  const mostRecentImageNode = mostRecentImageItem ? nodeById.get(mostRecentImageItem.sourceNodeId) : null
  collectPoseReferenceUrlsFromNode(mostRecentImageNode).forEach((url) => collected.push(url))

  return Array.from(new Set(collected)).filter((url) => isRemoteUrl(url))
}

function collectUpstreamVideoReference(state: any, targetId: string): {
  url: string
  durationSeconds: number | null
} {
  if (!state) return { url: '', durationSeconds: null }
  const edges = Array.isArray(state.edges) ? (state.edges as Edge[]) : []
  const nodes = Array.isArray(state.nodes) ? (state.nodes as Node[]) : []
  const orderedItems = collectOrderedUpstreamReferenceItems(nodes, edges, targetId)
  for (const item of orderedItems) {
    if (item.sourceKind === 'video' && item.videoUrl && isRemoteUrl(item.videoUrl)) {
      const sourceNode = nodes.find((node) => node.id === item.sourceNodeId)
      const sourceData = sourceNode?.data && typeof sourceNode.data === 'object'
        ? sourceNode.data as Record<string, unknown>
        : {}
      const results = Array.isArray(sourceData.videoResults) ? sourceData.videoResults : []
      const matchingResult = results.find((result) => {
        if (!result || typeof result !== 'object' || Array.isArray(result)) return false
        return String((result as Record<string, unknown>).url || '').trim() === item.videoUrl
      })
      const resultDuration = matchingResult && typeof matchingResult === 'object'
        ? (matchingResult as Record<string, unknown>).duration
        : undefined
      const candidates = [sourceData.videoDurationSeconds, sourceData.durationSeconds, resultDuration]
      const durationSeconds = candidates.find(
        (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
      ) ?? null
      return { url: item.videoUrl, durationSeconds }
    }
  }
  return { url: '', durationSeconds: null }
}

function collectDynamicUpstreamReferenceEntries(
  state: unknown,
  targetId: string,
): Array<{ url: string; label: string; assetId?: string | null; name?: string | null }> {
  if (!state || typeof state !== 'object') return []
  const record = state as { edges?: unknown; nodes?: unknown }
  const edges = Array.isArray(record.edges) ? (record.edges as Edge[]) : []
  const nodes = Array.isArray(record.nodes) ? (record.nodes as Node[]) : []
  const orderedItems = collectOrderedUpstreamReferenceItems(nodes, edges, targetId)
  if (!orderedItems.length) return []

  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  const out: Array<{ url: string; label: string; assetId?: string | null; name?: string | null }> = []
  const seen = new Set<string>()
  for (const item of orderedItems) {
    if (seen.has(item.previewUrl)) continue
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
      continue
    }
    const meta = extractNodePrimaryAssetReference(nodeById.get(item.sourceNodeId))
    if (meta) {
      out.push({
        url: meta.url,
        label: meta.assetRefId,
        ...(meta.assetId ? { assetId: meta.assetId } : null),
        name: meta.displayName,
      })
      continue
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
  }
  return out
}

type RoleReferenceEntry = import('./assetReference').NamedReferenceEntry

function normalizeRoleReferenceEntries(value: any): RoleReferenceEntry[] {
  if (!Array.isArray(value)) return []
  const out: RoleReferenceEntry[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const name = String((item as any)?.name || (item as any)?.label || '').trim()
    const url = String((item as any)?.url || '').trim()
    if (!name || !url || seen.has(url)) continue
    seen.add(url)
    out.push({ label: buildAssetRefId({ name, fallbackPrefix: 'role', index: out.length }), url })
    if (out.length >= 10) break
  }
  return out
}

function normalizeImageResultItems(value: unknown): AssetResultItem[] {
  if (!Array.isArray(value)) return []
  const out: AssetResultItem[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (!url) continue
    out.push(
      buildImageAssetResultItem({
        url,
        title: typeof record.title === 'string' ? record.title.trim() : null,
        assetId: typeof record.assetId === 'string' ? record.assetId.trim() : null,
        assetName: typeof record.assetName === 'string' ? record.assetName.trim() : null,
        assetRefId: typeof record.assetRefId === 'string' ? record.assetRefId.trim() : null,
      }),
    )
    if (out.length >= 512) break
  }
  return out
}


async function composeStoryboardReferenceSheetBlob(frameUrls: string[]): Promise<Blob | null> {
  const urls = Array.from(
    new Set(
      (Array.isArray(frameUrls) ? frameUrls : [])
        .map((x) => String(x || '').trim())
        .filter(Boolean),
    ),
  ).slice(0, 9)
  if (urls.length < 2) return null

  const grid = urls.length <= 4 ? 2 : 3
  const cellSize = 640
  const width = cellSize * grid
  const height = cellSize * grid
  const offscreenSupported = typeof OffscreenCanvas !== 'undefined'
  const canvas: OffscreenCanvas | HTMLCanvasElement = offscreenSupported
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#0b1224'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i]!
    const col = i % grid
    const row = Math.floor(i / grid)
    const x = col * cellSize
    const y = row * cellSize
    let bitmap: ImageBitmap | null = null
    try {
      // eslint-disable-next-line no-await-in-loop
      const blob = await fetchImageBlob(url)
      // eslint-disable-next-line no-await-in-loop
      bitmap = await createImageBitmap(blob)
      const scale = Math.max(cellSize / bitmap.width, cellSize / bitmap.height)
      const drawW = Math.max(1, Math.round(bitmap.width * scale))
      const drawH = Math.max(1, Math.round(bitmap.height * scale))
      const dx = x + Math.floor((cellSize - drawW) / 2)
      const dy = y + Math.floor((cellSize - drawH) / 2)
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, cellSize, cellSize)
      ctx.clip()
      ctx.drawImage(bitmap, dx, dy, drawW, drawH)
      ctx.restore()
    } catch {
      ctx.fillStyle = '#141416'
      ctx.fillRect(x, y, cellSize, cellSize)
    } finally {
      if (bitmap) bitmap.close()
    }
  }

  ctx.save()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 4
  for (let c = 1; c < grid; c += 1) {
    const x = c * cellSize
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  for (let r = 1; r < grid; r += 1) {
    const y = r * cellSize
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  ctx.restore()

  if (canvas instanceof OffscreenCanvas) {
    return await canvas.convertToBlob({ type: 'image/png' })
  }
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('生成分镜参考网格失败'))), 'image/png')
  })
}

function extractStoryboardShotUrls(data: any): string[] {
  const results = Array.isArray(data?.imageResults) ? data.imageResults : []
  const shotUrls = results
    .filter(
      (it: any) =>
        it &&
        typeof it.url === 'string' &&
        it.url.trim() &&
        typeof it.title === 'string' &&
        /^镜头\s*\d+/i.test(it.title.trim()),
    )
    .map((it: any) => String(it.url || '').trim())
    .filter((url: string): url is string => Boolean(url))
  if (shotUrls.length) return Array.from(new Set<string>(shotUrls)).slice(0, 9)

  // Fallback: storyboard nodes usually store primary as grid and shots after it.
  const primaryIndex =
    typeof data?.imagePrimaryIndex === 'number' &&
    data.imagePrimaryIndex >= 0 &&
    data.imagePrimaryIndex < results.length
      ? data.imagePrimaryIndex
      : 0
  const fallback = results
    .slice(Math.max(0, primaryIndex + 1))
    .map((it: any) => (typeof it?.url === 'string' ? it.url.trim() : ''))
    .filter((url: string): url is string => Boolean(url))
  return Array.from(new Set<string>(fallback)).slice(0, 9)
}

function buildRunnerContext(id: string, get: Getter): RunnerContext | null {
  const state = get()
  const nodes = (state.nodes || []) as Node[]
  const node = nodes.find((n: Node) => n.id === id)
  if (!node) return null

  const rawData: any = node.data || {}
  // 风格基底与摄影机控制都是项目级配置，所有节点共享。
  // 在 runner 顶层 merge 进 data，下游 buildPromptFromState / collectNodeReferenceImageUrls 直接消费。
  const projectIdForImageSettings = String((useUIStore.getState() as any)?.currentProject?.id || '')
  const projectImageSettings = projectIdForImageSettings
    ? getRuntimeProjectImageSettings(projectIdForImageSettings)
    : null
  const hasStyleImages = !!projectImageSettings && projectImageSettings.styleImages.length > 0
  const hasCinematicCamera = !!projectImageSettings && !!projectImageSettings.imageCinematicCamera
  const data: any = hasStyleImages || hasCinematicCamera
    ? {
        ...rawData,
        ...(hasStyleImages ? { styleImages: projectImageSettings!.styleImages } : {}),
        ...(hasCinematicCamera
          ? { imageCinematicCamera: projectImageSettings!.imageCinematicCamera }
          : {}),
      }
    : rawData
  const kind: string = data.kind || 'task'
  const taskKind = resolveTaskKind(kind)
  const prompt = buildPromptFromState(kind, data, state, id)
  const { sampleCount, supportsSamples, isImageTask, isVideoTask } =
    computeSampleMeta(kind, data)
  const handlers: RunnerHandlers = {
    setNodeStatus: state.setNodeStatus as RunnerHandlers['setNodeStatus'],
    appendLog: state.appendLog as RunnerHandlers['appendLog'],
    beginToken: state.beginRunToken as RunnerHandlers['beginToken'],
    endRunToken: state.endRunToken as RunnerHandlers['endRunToken'],
    isCanceled: state.isCanceled as RunnerHandlers['isCanceled'],
  }

  const textModelKey =
    (data.geminiModel as string | undefined) ||
    (data.modelKey as string | undefined)
  const imageModelKey = data.imageModel as string | undefined
  const modelKey = (IMAGE_NODE_KINDS.has(kind) ? imageModelKey : textModelKey) || undefined

  return {
    id,
    state,
    data,
    kind,
    taskKind,
    prompt,
    sampleCount,
    supportsSamples,
    isImageTask,
    isVideoTask,
    modelKey,
    getState: get,
    ...handlers,
  }
}

function patchNodeImagePromptExecutionConfig(
  set: Setter,
  id: string,
  patch: {
    prompt?: string
    structuredPrompt?: unknown
    promptEditorMode?: 'structured'
  },
): void {
  set((state: { nodes?: Node[] }) => {
    const nodes = Array.isArray(state.nodes) ? state.nodes : []
    let changed = false
    const nextNodes = nodes.map((node) => {
      if (node.id !== id) return node
      const currentData =
        typeof node.data === 'object' && node.data !== null
          ? node.data as Record<string, unknown>
          : {}
      const nextPatch: Record<string, unknown> = {}

      if (typeof patch.prompt === 'string') {
        const currentPrompt =
          typeof currentData.prompt === 'string'
            ? currentData.prompt.trim()
            : ''
        if (currentPrompt !== patch.prompt) {
          nextPatch.prompt = patch.prompt
        }
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'structuredPrompt')) {
        const currentSpecJson = JSON.stringify(currentData.structuredPrompt ?? null)
        const nextSpecJson = JSON.stringify(patch.structuredPrompt ?? null)
        if (currentSpecJson !== nextSpecJson) {
          nextPatch.structuredPrompt = patch.structuredPrompt
        }
      }

      if (patch.promptEditorMode === 'structured' && currentData.promptEditorMode !== 'structured') {
        nextPatch.promptEditorMode = 'structured'
      }

      if (Object.keys(nextPatch).length === 0) return node
      changed = true
      return {
        ...node,
        data: {
          ...currentData,
          ...nextPatch,
        },
      }
    })

    return changed ? { nodes: nextNodes } : {}
  })
}

function reconcileRunnerImagePromptExecutionConfig(id: string, get: Getter, set: Setter): void {
  const state = get()
  const nodes = Array.isArray(state.nodes) ? state.nodes : []
  const node = nodes.find((candidate: Node) => candidate.id === id)
  if (!node) return

  const data =
    typeof node.data === 'object' && node.data !== null
      ? node.data as Record<string, unknown>
      : null
  if (!data) return

  const kind = typeof data.kind === 'string' ? data.kind.trim() : ''
  if (!IMAGE_NODE_KINDS.has(kind)) return

  const hasStructuredPromptSource =
    Object.prototype.hasOwnProperty.call(data, 'structuredPrompt') ||
    Object.prototype.hasOwnProperty.call(data, 'imagePromptSpecV2') ||
    Object.prototype.hasOwnProperty.call(data, 'imagePromptSpec') ||
    Object.prototype.hasOwnProperty.call(data, 'promptSpec')
  if (!hasStructuredPromptSource) return

  const resolved = resolveImagePromptExecution(data)
  const patch: {
    prompt?: string
    structuredPrompt?: unknown
    promptEditorMode?: 'structured'
  } = {}

  if (resolved.prompt) patch.prompt = resolved.prompt
  if (resolved.structuredPrompt) patch.structuredPrompt = resolved.structuredPrompt
  if (resolved.mode === 'structured') patch.promptEditorMode = 'structured'
  if (Object.keys(patch).length === 0) return

  patchNodeImagePromptExecutionConfig(set, id, patch)
  if (resolved.normalizedFromLegacy) {
    state.appendLog?.(id, `[${nowLabel()}] 已将旧版结构化图片提示词归一化到 structuredPrompt`)
  }
}

function patchNodeExecutionModel(
  set: Setter,
  id: string,
  patch: {
    imageModel: string
    imageModelVendor: string | null
  },
): void {
  set((state: { nodes?: Node[] }) => {
    const nodes = Array.isArray(state.nodes) ? state.nodes : []
    let changed = false
    const nextNodes = nodes.map((node) => {
      if (node.id !== id) return node
      const currentData =
        typeof node.data === 'object' && node.data !== null
          ? node.data as Record<string, unknown>
          : {}
      const currentModel =
        typeof currentData.imageModel === 'string'
          ? currentData.imageModel.trim()
          : ''
      const currentVendor =
        typeof currentData.imageModelVendor === 'string'
          ? currentData.imageModelVendor.trim()
          : ''
      const nextVendor = patch.imageModelVendor ? patch.imageModelVendor.trim() : ''
      if (currentModel === patch.imageModel && currentVendor === nextVendor) {
        return node
      }
      changed = true
      return {
        ...node,
        data: {
          ...currentData,
          imageModel: patch.imageModel,
          imageModelVendor: patch.imageModelVendor,
        },
      }
    })
    return changed ? { nodes: nextNodes } : {}
  })
}

async function resolveRunnerImageModelBeforeExecution(ctx: RunnerContext, set: Setter): Promise<void> {
  if (!ctx.isImageTask) return
  const requestedModel =
    typeof ctx.data.imageModel === 'string'
      ? ctx.data.imageModel.trim()
      : ''
  const resolution = await resolveExecutableImageModel({
    kind: ctx.kind === 'imageEdit' ? 'imageEdit' : 'image',
    value: typeof ctx.data.imageModel === 'string' ? ctx.data.imageModel : undefined,
  })
  if (resolution.shouldWriteBack) {
    patchNodeExecutionModel(set, ctx.id, {
      imageModel: resolution.value,
      imageModelVendor: null,
    })
  }
  ctx.data = {
    ...ctx.data,
    imageModel: resolution.requestModelKey,
    imageModelVendor: null,
  }
  ctx.modelKey = resolution.requestModelKey
  if (resolution.reason === 'canonicalized' && requestedModel !== resolution.value) {
    ctx.appendLog(ctx.id, `[${nowLabel()}] 图片模型 ${requestedModel} 已规范化为 ${resolution.value}`)
  }
}

function resolveTaskKind(kind: string): TaskKind {
  if (IMAGE_NODE_KINDS.has(kind)) return 'text_to_image'
  if (isVideoRenderKind(kind)) return 'text_to_video'
  return 'prompt_refine'
}

type PromptBucketItem = { text: string; fromImage: boolean }

function extractStoryboardShotLines(shotPrompts: unknown[]): string {
  const shotLines = shotPrompts
    .map((x, idx) => {
      const line = String(x || '').trim()
      return line ? `镜头 ${idx + 1}：${line}` : ''
    })
    .filter(Boolean)
  return shotLines.length ? shotLines.join('\n') : ''
}

function appendStoryContextPrompts(sd: any, output: PromptBucketItem[]) {
  const storyContextCandidates: string[] = []
  if (typeof sd.storyboardStoryContext === 'string') storyContextCandidates.push(sd.storyboardStoryContext)
  if (typeof sd.storyboardChunkNarrative === 'string') storyContextCandidates.push(sd.storyboardChunkNarrative)
  storyContextCandidates
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .forEach((p) => {
      // Story context is semantic narrative and must be preserved for downstream video generation.
      output.push({ text: p, fromImage: false })
    })
}

function collectImageSourcePrompts(input: {
  sd: any
  skind: string
  targetIsVideoRender: boolean
  upstreamPromptItems: PromptBucketItem[]
}): string[] {
  const { sd, targetIsVideoRender, upstreamPromptItems } = input
  const promptCandidates: string[] = []
  if (typeof sd.prompt === 'string') {
    promptCandidates.push(sd.prompt)
  }
  if (!targetIsVideoRender) return promptCandidates
  if (typeof sd.storyboardScript === 'string' && sd.storyboardScript.trim()) {
    promptCandidates.push(sd.storyboardScript)
  }
  const storyboardDialogue = normalizeStoryboardDialogueText(sd.storyboardDialogue)
  if (storyboardDialogue) {
    promptCandidates.push(`人物台词：${storyboardDialogue}`)
  }
  if (Array.isArray(sd.storyboardShotPrompts) && sd.storyboardShotPrompts.length) {
    const shotLines = extractStoryboardShotLines(sd.storyboardShotPrompts as unknown[])
    if (shotLines) promptCandidates.push(shotLines)
  }
  appendStoryContextPrompts(sd, upstreamPromptItems)
  return promptCandidates
}

function normalizeStoryboardDialogueText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 24)
    .join('；')
}

function collectVideoSourcePrompts(sd: any): string[] {
  const promptCandidates: string[] = []
  if (typeof sd.prompt === 'string') promptCandidates.push(sd.prompt)
  const storyboardDialogue = normalizeStoryboardDialogueText(sd.storyboardDialogue)
  if (storyboardDialogue) {
    promptCandidates.push(`人物台词：${storyboardDialogue}`)
  }
  return promptCandidates
}

function appendNormalizedPromptCandidates(input: {
  sourceIsImage: boolean
  promptCandidates: string[]
  upstreamPromptItems: PromptBucketItem[]
}) {
  input.promptCandidates
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .forEach((p) => {
      input.upstreamPromptItems.push({ text: p, fromImage: input.sourceIsImage })
    })
}

function collectInboundSourcePrompts(input: {
  kind: string
  skind: string
  sd: any
  upstreamPromptItems: PromptBucketItem[]
}): string[] {
  const targetIsVideoRender = VIDEO_RENDER_NODE_KINDS.has(input.kind)
  const sourceCategory = resolveExecutionPromptSourceCategory(input.skind)
  if (sourceCategory === 'image') {
    return collectImageSourcePrompts({
      sd: input.sd,
      skind: input.skind,
      targetIsVideoRender,
      upstreamPromptItems: input.upstreamPromptItems,
    })
  }
  if (sourceCategory === 'video') {
    return collectVideoSourcePrompts(input.sd)
  }
  if (sourceCategory === 'text') {
    const sourceData = input.sd && typeof input.sd === 'object' && !Array.isArray(input.sd)
      ? input.sd as Record<string, unknown>
      : {}
    return collectTextExecutionPromptCandidates(input.skind, sourceData)
  }
  return []
}

function buildPromptFromState(
  kind: string,
  data: any,
  state: any,
  id: string,
): string {
  const rawOwnPrompt = IMAGE_NODE_KINDS.has(kind)
    ? resolveCompiledImagePrompt(data)
    : typeof data.prompt === 'string'
      ? data.prompt
      : ''
  if (isVideoRenderKind(kind)) {
    // The video node's own prompt is the base instruction, but a connected
    // text node is also an executable prompt source. The edge is not merely a
    // visual annotation: its text must be compiled into the provider request.
    // Keep media/reference nodes out of this prose merge; their URLs are
    // collected separately by prepareVideoTaskInput.
    const edges = Array.isArray(state.edges)
      ? state.edges as Array<{ source?: unknown; target?: unknown; data?: unknown }>
      : []
    const upstreamPromptItems: PromptBucketItem[] = []
    const suppressUpstreamPrompts = Boolean((data as Record<string, unknown>)?.suppressUpstreamPrompts)
    if (!suppressUpstreamPrompts) {
      edges
        .filter((edge) =>
          edge.target === id &&
          typeof edge.source === 'string' &&
          !isReferenceOnlyCanvasEdge(edge),
        )
        .forEach((edge) => {
          const source = (state.nodes as Node[]).find((node: Node) => node.id === edge.source)
          if (!source || !source.data || typeof source.data !== 'object' || Array.isArray(source.data)) return
          const sourceData = source.data as Record<string, unknown>
          const sourceKind = typeof sourceData.kind === 'string' ? sourceData.kind : ''
          if (resolveExecutionPromptSourceCategory(sourceKind) !== 'text') return
          appendNormalizedPromptCandidates({
            sourceIsImage: false,
            promptCandidates: collectTextExecutionPromptCandidates(sourceKind, sourceData),
            upstreamPromptItems,
          })
        })
    }
    const upstreamPrompts = selectExecutionUpstreamPrompts({
      kind,
      upstreamPromptItems,
      inboundHasImage: false,
    })
    return mergeExecutionPromptSequence({
      kind,
      ownPrompt: rawOwnPrompt,
      upstreamPrompts,
      cameraRefPrompts: [],
    }).join('\n')
  }

  if (IMAGE_NODE_KINDS.has(kind)) {
    const edges = (state.edges || []) as any[]
    const inbound = edges.filter((e) => e.target === id && !isReferenceOnlyCanvasEdge(e))
    const upstreamPromptItems: PromptBucketItem[] = []
    const suppressUpstreamPrompts = Boolean((data as Record<string, unknown>)?.suppressUpstreamPrompts)
    const inboundHasImage = inbound.some((edge) => {
      const src = (state.nodes as Node[]).find((n: Node) => n.id === edge.source)
      const skind: string | undefined = (src?.data as any)?.kind
      return resolveExecutionPromptSourceCategory(skind) === 'image'
    })
    if (inbound.length && !suppressUpstreamPrompts) {
      inbound.forEach((edge) => {
        const src = (state.nodes as Node[]).find((n: Node) => n.id === edge.source)
        if (!src) return
        const sd: any = src.data || {}
        const skind: string | undefined = sd.kind
        if (!skind) return
        const sourceCategory = resolveExecutionPromptSourceCategory(skind)
        const sourceIsImage = sourceCategory === 'image'
        const sourceIsVideoRender = sourceCategory === 'video'
        if (sourceIsVideoRender) {
          // 当视频继续连接视频节点时，避免继承上游完整提示词以免重复堆叠
          return
        }
        const promptCandidates = collectInboundSourcePrompts({
          kind,
          skind,
          sd,
          upstreamPromptItems,
        })
        appendNormalizedPromptCandidates({
          sourceIsImage,
          promptCandidates,
          upstreamPromptItems,
        })
      })
    }
    const hasOwnPromptField = Object.prototype.hasOwnProperty.call(data, 'prompt')
    const own = hasOwnPromptField ? rawOwnPrompt : ''
    const upstreamPrompts = selectExecutionUpstreamPrompts({
      kind,
      upstreamPromptItems,
      inboundHasImage,
    })
    const combinedBase = mergeExecutionPromptSequence({
      kind,
      ownPrompt: own,
      upstreamPrompts,
      cameraRefPrompts: [],
    })
    const dedupeKey = (value: string) =>
      String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .toLowerCase()
    const seen = new Set<string>()
    const combined = combinedBase.filter((p) => {
      if (typeof p !== 'string') return false
      const normalized = p.trim()
      if (!normalized) return false
      const key = dedupeKey(normalized)
      if (!key) return false
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const basePrompt = combined.length ? combined.join('\n') : ((data.label as string) || '')
    const withCameraViews = appendImageViewPrompt(basePrompt, {
      cameraControl: (data as Record<string, unknown>)?.imageCameraControl,
      lightingRig: (data as Record<string, unknown>)?.imageLightingRig,
    })
    const cinematicCameraPrompt = buildCinematicCameraPrompt(
      (data as Record<string, unknown>)?.imageCinematicCamera,
    )
    return cinematicCameraPrompt
      ? `${withCameraViews}\n\n${cinematicCameraPrompt}`.trim()
      : withCameraViews
  }

  return (data.prompt as string) || (data.label as string) || ''
}

function normalizeTextDedupKey(value: string): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .toLowerCase()
}

function computeSampleMeta(kind: string, data: any) {
  const isImageTask = IMAGE_NODE_KINDS.has(kind)
  const isVideoTask = isVideoRenderKind(kind)
  const rawSampleCount = typeof data.sampleCount === 'number' ? data.sampleCount : 1
  const supportsSamples = isImageTask || isVideoTask
  const sampleCount = supportsSamples
    ? Math.max(1, Math.min(5, Math.floor(rawSampleCount || 1)))
    : 1

  return { sampleCount, supportsSamples, isImageTask, isVideoTask }
}

function ensurePrompt(ctx: RunnerContext): boolean {
  if (ctx.prompt.trim()) return true
  ctx.appendLog(ctx.id, `[${nowLabel()}] 缺少提示词，已终止`)
  ctx.setNodeStatus(ctx.id, 'error', {
    progress: 0,
    lastError: '缺少提示词',
    imageTaskId: '',
    videoTaskId: '',
  })
  return false
}

function beginQueuedRun(ctx: RunnerContext) {
  const rawSetNodeStatus = ctx.setNodeStatus
  const rawAppendLog = ctx.appendLog
  const rawIsCanceled = ctx.isCanceled

  const runToken = ctx.beginToken(ctx.id)

  ctx.setNodeStatus = (id, status, patch) => {
    if (!isRunTokenActive(ctx.getState, id, runToken)) return
    rawSetNodeStatus(id, status, patch)
  }
  ctx.appendLog = (id, line) => {
    if (!isRunTokenActive(ctx.getState, id, runToken)) return
    rawAppendLog(id, line)
  }
  ctx.isCanceled = (id) => rawIsCanceled(id, runToken)

  const priorStatus = typeof (ctx.data as any)?.status === 'string' ? String((ctx.data as any).status) : ''
  const shouldClearStaleTaskIds = priorStatus !== 'running' && priorStatus !== 'queued'
  ctx.setNodeStatus(ctx.id, 'queued', {
    progress: 0,
    ...(shouldClearStaleTaskIds ? { imageTaskId: '', videoTaskId: '' } : {}),
  })
  ctx.appendLog(
    ctx.id,
    `[${nowLabel()}] queued (AI, ${ctx.taskKind}${
      ctx.supportsSamples && ctx.sampleCount > 1 ? `, x${ctx.sampleCount}` : ''
    })`,
  )
}

export async function runNodeRemote(id: string, get: Getter, set: Setter) {
  let ctx: RunnerContext | null = null
  try {
    reconcileRunnerImagePromptExecutionConfig(id, get, set)
    ctx = buildRunnerContext(id, get)
  } catch (error: unknown) {
    const state = get()
    const message =
      error instanceof Error && error.message
        ? error.message
        : '执行前解析图片提示词失败'
    state.setNodeStatus?.(id, 'error', { progress: 0, lastError: message })
    state.appendLog?.(id, `[${nowLabel()}] error: ${message}`)
    if (!state.isCanceled?.(id)) {
      toast(message, 'error')
    }
    return
  }
  if (!ctx) return
  if (NON_EXECUTABLE_REMOTE_NODE_KINDS.has(ctx.kind)) return

  if (!isStoryboardEditorKind(ctx.kind) && !ensurePrompt(ctx)) return

  try {
    await resolveRunnerImageModelBeforeExecution(ctx, set)
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : '执行前解析图片模型失败'
    ctx.setNodeStatus(ctx.id, 'error', { progress: 0, lastError: message })
    ctx.appendLog(ctx.id, `[${nowLabel()}] error: ${message}`)
    if (!ctx.isCanceled(ctx.id)) {
      toast(message, 'error')
    }
    return
  }

  beginQueuedRun(ctx)

  if (isStoryboardEditorKind(ctx.kind)) {
    await runStoryboardEditorTask(ctx)
    return
  }

  
  if (ctx.isVideoTask) {
    await runVideoTask(ctx)
    return
  }

  await runGenericTask(ctx)
}

function pickNonEmptyText(value: any): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getFirstTaskResult(rawResponse: any): any {
  if (Array.isArray(rawResponse?.results) && rawResponse.results.length) return rawResponse.results[0]
  if (Array.isArray(rawResponse?.data?.results) && rawResponse.data.results.length) return rawResponse.data.results[0]
  return null
}

function extractVideoUrlFromRawResponse(rawResponse: any): string | null {
  const fromVideoUrlField = rawResponse?.video_url
  const fromVideoUrl =
    pickNonEmptyText(fromVideoUrlField?.url) ||
    pickNonEmptyText(fromVideoUrlField) ||
    pickNonEmptyText(rawResponse?.videoUrl?.url) ||
    pickNonEmptyText(rawResponse?.videoUrl) ||
    pickNonEmptyText(rawResponse?.result_url) ||
    pickNonEmptyText(rawResponse?.resultUrl) ||
    pickNonEmptyText(rawResponse?.metadata?.url) ||
    pickNonEmptyText(rawResponse?.content?.video_url) ||
    pickNonEmptyText(rawResponse?.content?.videoUrl) ||
    pickNonEmptyText(rawResponse?.data?.video_url) ||
    pickNonEmptyText(rawResponse?.data?.videoUrl) ||
    pickNonEmptyText(rawResponse?.data?.content?.video_url) ||
    pickNonEmptyText(rawResponse?.data?.content?.videoUrl) ||
    null
  if (fromVideoUrl) return fromVideoUrl
  const firstResult = getFirstTaskResult(rawResponse)
  const fromResult =
    pickNonEmptyText(firstResult?.url) ||
    pickNonEmptyText(firstResult?.video_url) ||
    pickNonEmptyText(firstResult?.videoUrl) ||
    null
  if (fromResult) return fromResult
  const content = pickNonEmptyText(rawResponse?.content)
  if (!content) return null
  const match = content.match(/<video[^>]+src=['"]([^'"]+)['"][^>]*>/i)
  return match && match[1] && match[1].trim() ? match[1].trim() : null
}

function extractVideoThumbnailFromRawResponse(rawResponse: any): string | null {
  const fromRoot = pickNonEmptyText(rawResponse?.thumbnail_url) || pickNonEmptyText(rawResponse?.thumbnailUrl)
  if (fromRoot) return fromRoot
  const firstResult = getFirstTaskResult(rawResponse)
  return pickNonEmptyText(firstResult?.thumbnailUrl) || pickNonEmptyText(firstResult?.thumbnail_url) || null
}

function extractVideoAssetFromRawResponse(rawResponse: any): { url: string; thumbnailUrl: string | null } | null {
  if (!rawResponse) return null
  const url = extractVideoUrlFromRawResponse(rawResponse)
  if (!url) return null
  return {
    url,
    thumbnailUrl: extractVideoThumbnailFromRawResponse(rawResponse),
  }
}

function parseInitialProgress(rawData: any): number {
  const raw = typeof rawData?.progress === 'number' && Number.isFinite(rawData.progress) ? rawData.progress : 10
  return Math.max(5, Math.min(95, Math.round(raw)))
}

type GenericVideoTaskOptions = {
  prompt: string
  vendor: string
  model: string
  aspectRatio: string
  orientation: Orientation
  size?: string | null
  resolution?: string | null
  specKey?: string | null
  referenceImages: string[]
  durationSeconds: number
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  uploadedReferenceAssets?: PreparedVideoReferenceAsset[]
  uploadedFirstFrameAsset?: PreparedVideoReferenceAsset | null
  uploadedLastFrameAsset?: PreparedVideoReferenceAsset | null
  referenceSheet?: UploadedReferenceSheet | null
  upstreamVideoUrl?: string
  referenceVideoDurationSeconds?: number | null
  autoReferenceImageUrls?: string[]
}

type PreparedVideoTaskInput = {
  videoVendor: string
  videoModelValue: string
  finalPrompt: string
  videoDurationSeconds: number
  orientation: Orientation
  aspectRatioSetting: string
  videoSize: string
  videoResolution: string
  videoSpecKey: string
  referenceImagesForVideo: string[]
  storyboardCompositeRef: string | null
  effectiveFirstFrameUrl: string
  lastFrameUrlValue: string
  autoReferenceImages: string[]
  uploadedReferenceAssets: PreparedVideoReferenceAsset[]
  uploadedFirstFrameAsset: PreparedVideoReferenceAsset | null
  uploadedLastFrameAsset: PreparedVideoReferenceAsset | null
  referenceSheet: UploadedReferenceSheet | null
  remixTargetId: string | null
  upstreamVideoUrl: string
  referenceVideoDurationSeconds: number | null
  autoReferenceImageUrls: string[]
}

function resolveVideoVendor(input: { data: any; videoModelValue?: string }): string {
  return resolveCatalogVideoVendor({
    explicitVendor: (input.data as any)?.videoModelVendor,
    modelKey: input.videoModelValue || (input.data as any)?.videoModel,
  })
}

function resolveVideoDurationSeconds(input: {
  data: any
  isStoryboard: boolean
  storyboardTotalDuration: number
  videoModelValue?: string
}): number {
  if (input.isStoryboard && input.storyboardTotalDuration > 0) {
    return Math.max(1, Math.round(input.storyboardTotalDuration))
  }
  const dataRecord =
    input.data && typeof input.data === 'object'
      ? (input.data as Record<string, unknown>)
      : {}
  const normalized = readVideoDurationSeconds(dataRecord, 5)
  const specDuration =
    parseVideoDurationFromSpecKey(dataRecord.videoSpecKey) ??
    parseVideoDurationFromSpecKey(dataRecord.specKey)
  const resolved = specDuration ?? normalized
  return resolved > 0 ? resolved : 5
}

function pickAllowedVideoDuration(
  allowed: number[],
  defaultDurationSeconds: number | undefined,
  current: number,
): number {
  if (allowed.length === 0) return current > 0 ? current : 5
  if (allowed.includes(current)) return current
  if (typeof defaultDurationSeconds === 'number' && allowed.includes(defaultDurationSeconds)) {
    return defaultDurationSeconds
  }
  return allowed[0] ?? 5
}

function pickAllowedVideoSize(
  allowed: string[],
  defaultSize: string | undefined,
  current: string,
): string {
  if (allowed.length === 0) return current
  if (current && allowed.includes(current)) return current
  if (defaultSize && allowed.includes(defaultSize)) return defaultSize
  return allowed[0] ?? current
}

function pickAllowedVideoResolution(
  allowed: string[],
  defaultResolution: string | undefined,
  current: string,
): string {
  if (allowed.length === 0) return current
  if (current && allowed.includes(current)) return current
  if (defaultResolution && allowed.includes(defaultResolution)) return defaultResolution
  return allowed[0] ?? current
}

function pickAllowedVideoOrientation(
  allowed: Orientation[],
  defaultOrientation: Orientation | undefined,
  current: Orientation,
): Orientation {
  if (allowed.length === 0) return current
  if (allowed.includes(current)) return current
  if (defaultOrientation && allowed.includes(defaultOrientation)) return defaultOrientation
  return allowed[0] ?? current
}

async function resolveVideoTaskSettingsFromCatalog(input: {
  modelValue: string
  durationSeconds: number
  size: string
  resolution: string
  orientation: Orientation
}): Promise<{
  modelValue: string
  durationSeconds: number
  size: string
  resolution: string
  orientation: Orientation
  maxReferenceImages: number
}> {
  const modelValue = String(input.modelValue || '').trim()
  if (!modelValue) {
    throw new Error('视频节点未配置模型：请先从系统模型目录中选择一个可用视频模型。')
  }
  const videoOptions = await preloadModelOptions('video')
  if (videoOptions.length === 0) {
    throw new Error('未找到可用视频模型：请先在系统模型管理中启用 video 模型。')
  }
  const matched = findModelOptionByIdentifier(videoOptions, modelValue)
  if (!matched) {
    throw new Error(`视频模型 ${modelValue} 当前不可用：请在系统模型管理中修复渠道、协议和价格，或重新选择模型。`)
  }
  const requestModelKey = getModelOptionRequestAlias(videoOptions, modelValue)
  if (!requestModelKey) {
    throw new Error(`视频模型 ${modelValue} 缺少请求模型键，请在系统模型管理中修复后重试。`)
  }
  const config = parseVideoModelCatalogConfig(matched?.meta)
  if (!config) {
    return {
      ...input,
      modelValue: requestModelKey,
      maxReferenceImages: DEFAULT_VIDEO_REFERENCE_IMAGE_LIMIT,
    }
  }

  const allowedDurations = config.durationOptions.map((option) => option.value)
  const allowedSizes = config.sizeOptions.map((option) => option.value)
  const allowedResolutions = config.resolutionOptions.map((option) => option.value)
  const allowedOrientations = config.orientationOptions.map((option) => option.value)

  return {
    modelValue: requestModelKey,
    durationSeconds: pickAllowedVideoDuration(
      allowedDurations,
      config.defaultDurationSeconds,
      input.durationSeconds,
    ),
    size: pickAllowedVideoSize(allowedSizes, config.defaultSize, input.size),
    resolution: pickAllowedVideoResolution(
      allowedResolutions,
      config.defaultResolution,
      input.resolution,
    ),
    orientation: pickAllowedVideoOrientation(
      allowedOrientations,
      config.defaultOrientation,
      input.orientation,
    ),
    maxReferenceImages:
      typeof config.maxReferenceImages === 'number' && config.maxReferenceImages > 0
        ? Math.trunc(config.maxReferenceImages)
        : DEFAULT_VIDEO_REFERENCE_IMAGE_LIMIT,
  }
}

async function prepareVideoTaskInput(ctx: RunnerContext): Promise<PreparedVideoTaskInput> {
  const { id, data, state, prompt, kind, appendLog } = ctx
  const rawOrientation: Orientation = normalizeOrientation((data as any)?.orientation)
  const initialAspectRatioSetting =
    typeof (data as any)?.aspect === 'string' && (data as any).aspect.trim() ? (data as any).aspect.trim() : '16:9'
  const selectedVideoModelValue =
    typeof (data as any)?.videoModel === 'string' ? String((data as any).videoModel).trim() : ''
  const videoVendor = resolveVideoVendor({ data })
  const rawVideoDurationSeconds = resolveVideoDurationSeconds({
    data,
    isStoryboard: kind === 'storyboard',
    storyboardTotalDuration: 0,
    videoModelValue: selectedVideoModelValue,
  })
  const rawVideoSize =
    typeof (data as any)?.videoSize === 'string' ? String((data as any).videoSize).trim().replace(/\s+/g, '') : ''
  const rawVideoResolution = normalizeVideoResolution(
    (data as Record<string, unknown>)?.videoResolution ?? (data as Record<string, unknown>)?.resolution,
  )
  const constrainedVideoSettings = await resolveVideoTaskSettingsFromCatalog({
    modelValue: selectedVideoModelValue,
    durationSeconds: rawVideoDurationSeconds,
    size: rawVideoSize,
    resolution: rawVideoResolution,
    orientation: rawOrientation,
  })
  const videoModelValue = constrainedVideoSettings.modelValue
  const videoDurationSeconds = constrainedVideoSettings.durationSeconds
  const videoSize = constrainedVideoSettings.size
  const videoResolution = constrainedVideoSettings.resolution
  const orientation = constrainedVideoSettings.orientation
  const maxReferenceImages = constrainedVideoSettings.maxReferenceImages
  const aspectRatioSetting = videoSize || initialAspectRatioSetting
  const videoSpecKey = buildVideoBillingSpecKey(videoResolution, videoDurationSeconds)
  const finalPrompt = String(prompt || '').trim()
  const collectedReferenceImages = Array.from(
    new Set([
      ...collectNodeReferenceImageUrls(data, maxReferenceImages),
      ...collectReferenceImages(state, id)
        .map((u) => String(u || '').trim())
        .filter(Boolean),
    ]),
  ).slice(0, maxReferenceImages)
  const nodes = Array.isArray((state as { nodes?: unknown }).nodes)
    ? ((state as { nodes?: unknown }).nodes as Node[])
    : []
  const mentionAssetRefs = await resolveAssetImagesByMentions({
    prompt: finalPrompt,
    nodes,
  }).catch(() => createEmptyPromptAssetMentionResult())
  if (mentionAssetRefs.matched.length) {
    appendLog(id, `[${nowLabel()}] 检测到资产引用：${mentionAssetRefs.matched.join('、')}，已自动注入参考资产`)
  }
  if (mentionAssetRefs.missing.length) {
    appendLog(id, `[${nowLabel()}] 未找到资产引用：${mentionAssetRefs.missing.join('、')}`)
  }
  if (mentionAssetRefs.ambiguous.length) {
    appendLog(id, `[${nowLabel()}] 资产引用存在同名冲突：${mentionAssetRefs.ambiguous.join('、')}，请保证引用ID唯一`)
  }
  const globalStyleRefs = (() => {
    // 单轨：与图片路径一致，画风锚定唯一真相源 = 项目「风格」槽（styleImages），
    // 节点风格 chip 移除后即不再注入，不读 uiStore.activeStyleBible。
    const pid = String((useUIStore.getState() as any)?.currentProject?.id || '').trim()
    if (!pid) return [] as string[]
    return getRuntimeProjectImageSettings(pid).styleImages
      .map((u) => (typeof u === 'string' ? u.trim() : ''))
      .filter(Boolean)
  })()
  const hasStyleAssetInput = Array.isArray((data as Record<string, unknown>)?.assetInputs)
    && ((data as Record<string, unknown>).assetInputs as unknown[]).some(
      (e) => e && typeof e === 'object' && (e as Record<string, unknown>).role === 'style',
    )
  const mentionStyleRefs = mentionAssetRefs.assetInputs
    .filter((input) => input.role === 'style')
    .map((input) => input.url)
  const styleRefsToInject = Array.from(
    new Set([
      ...mentionStyleRefs,
      ...(hasStyleAssetInput ? [] : globalStyleRefs),
    ]),
  )
  const nonStyleCollected = styleRefsToInject.length > 0
    ? Array.from(new Set([...collectedReferenceImages, ...mentionAssetRefs.urls]))
        .filter((u) => !styleRefsToInject.includes(u))
    : Array.from(new Set([...collectedReferenceImages, ...mentionAssetRefs.urls]))
  // 全局约定：画风锚定图固定排在参考图末尾（与图片路径 mergeGlobalStyleReferenceImages 一致），
  // 名额不足时优先保住风格图，截断内容参考。
  const styleRefsKept = styleRefsToInject.slice(0, maxReferenceImages)
  const mergedReferenceImages = [
    ...nonStyleCollected.slice(0, Math.max(0, maxReferenceImages - styleRefsKept.length)),
    ...styleRefsKept,
  ]
  const referenceEntries = buildNamedReferenceEntries({
    assetInputs: hasStyleAssetInput
      ? [
          ...mentionAssetRefs.assetInputs,
          ...((Array.isArray((data as Record<string, unknown>)?.assetInputs)
            ? (data as Record<string, unknown>).assetInputs as unknown[]
            : []) as object[]),
        ]
      : [
          ...mentionAssetRefs.assetInputs,
          ...styleRefsToInject
            .filter((url) => !mentionStyleRefs.includes(url))
            .map((url, idx) => ({
              url,
              role: 'style',
              name: styleRefsToInject.length > 1 ? `风格参考${idx + 1}` : '风格参考',
              assetRefId: `style-ref-${idx + 1}`,
            })),
          ...((Array.isArray((data as Record<string, unknown>)?.assetInputs)
            ? (data as Record<string, unknown>).assetInputs as unknown[]
            : []) as object[]),
        ],
    referenceImages: mergedReferenceImages,
    fallbackPrefix: 'ref',
    limit: maxReferenceImages,
  })
  let autoReferenceImages = mergedReferenceImages
  const firstFrameUrl = readNodeFirstFrameUrl(data)
  const lastFrameUrl = readNodeLastFrameUrl(data)
  const isSoraModel = isSoraVideoModel(videoModelValue)
  let uploadedReferenceAssets: PreparedVideoReferenceAsset[] = []
  let uploadedFirstFrameAsset: PreparedVideoReferenceAsset | null = null
  let uploadedLastFrameAsset: PreparedVideoReferenceAsset | null = null
  let referenceSheet: UploadedReferenceSheet | null = null

  if (shouldAutoMergeReferenceSheet() && autoReferenceImages.length > 2) {
    try {
      const mergedReferenceSheet = await uploadMergedReferenceSheet({
        id,
        entries: referenceEntries,
        prompt: finalPrompt,
        vendor: videoVendor,
        modelKey: videoModelValue,
        taskKind: 'text_to_video',
      })
      if (mergedReferenceSheet) {
        referenceSheet = mergedReferenceSheet
        autoReferenceImages = [mergedReferenceSheet.url]
        appendLog(id, `[${nowLabel()}] 参考资产超过 2 张，已自动生成带 id 标记的拼图参考板`)
      }
    } catch (err) {
      console.warn('[remoteRunner] merge video references failed', err)
    }
  }

  if (isSoraModel && (autoReferenceImages.length > 0 || firstFrameUrl || lastFrameUrl)) {
    const preparedAssets = await prepareSoraVideoReferenceAssets({
      firstFrameUrl,
      lastFrameUrl,
      referenceImages: autoReferenceImages,
      aspectRatio: aspectRatioSetting,
      size: videoSize,
      vendor: videoVendor,
      modelKey: videoModelValue,
      prompt: finalPrompt,
      taskKind: 'text_to_video',
    })
    uploadedReferenceAssets = preparedAssets.referenceAssets
    uploadedFirstFrameAsset = preparedAssets.firstFrameAsset
    uploadedLastFrameAsset = preparedAssets.lastFrameAsset
  }

  if (autoReferenceImages.length && !firstFrameUrl) {
    appendLog(id, `[${nowLabel()}] 已收集参考图 ${autoReferenceImages.length} 张`)
  }
  // 优先从 DAG 边收集上游视频 URL；若该 video 节点使用 sourcePrevVideoNodeId 直接引用
  // 且已由 dag.ts injectVideoUpstreamRefsIfNeeded 解析并写入 data.sourceVideoUrl，则作为回退。
  const connectedVideoReference = collectUpstreamVideoReference(state, id)
  const videoDataRecord = data as Record<string, unknown>
  const explicitSourceVideoUrl = typeof videoDataRecord.sourceVideoUrl === 'string' && isRemoteUrl(videoDataRecord.sourceVideoUrl.trim())
    ? videoDataRecord.sourceVideoUrl.trim()
    : ''
  // A continuation node may point to the original node for graph provenance while
  // carrying a separately uploaded, user-selected source segment. Preserve that
  // explicit clipped asset instead of letting the provenance edge replace it.
  const isContinuationWithExplicitSource = videoDataRecord.continuationMode === 'extend' && Boolean(explicitSourceVideoUrl)
  const upstreamVideoUrl = isContinuationWithExplicitSource
    ? explicitSourceVideoUrl
    : connectedVideoReference.url || explicitSourceVideoUrl
  const explicitReferenceDuration = (data as Record<string, unknown>)?.referenceVideoDurationSeconds
  const referenceVideoDurationSeconds = (isContinuationWithExplicitSource ? null : connectedVideoReference.durationSeconds) ??
    (typeof explicitReferenceDuration === 'number' && Number.isFinite(explicitReferenceDuration) && explicitReferenceDuration > 0
      ? explicitReferenceDuration
      : null)
  if (upstreamVideoUrl) {
    appendLog(id, `[${nowLabel()}] 检测到上游视频节点，已注入视频续写引用`)
  }
  return {
    videoVendor,
    videoModelValue,
    finalPrompt,
    videoDurationSeconds,
    orientation,
    aspectRatioSetting,
    videoSize,
    videoResolution,
    videoSpecKey,
    referenceImagesForVideo: uploadedReferenceAssets.length > 0 ? [] : autoReferenceImages,
    storyboardCompositeRef: null,
    effectiveFirstFrameUrl: uploadedFirstFrameAsset ? '' : firstFrameUrl,
    lastFrameUrlValue: uploadedLastFrameAsset ? '' : lastFrameUrl,
    autoReferenceImages,
    uploadedReferenceAssets,
    uploadedFirstFrameAsset,
    uploadedLastFrameAsset,
    referenceSheet,
    remixTargetId: null,
    upstreamVideoUrl,
    referenceVideoDurationSeconds,
    autoReferenceImageUrls: mergedReferenceImages,
  }
}

function normalizeVideoVendor(value: string | undefined | null): string {
  return String(value || '').trim().toLowerCase()
}

function resolveActiveVideoTaskIdByVendor(data: any, vendor?: string | null): string | null {
  const status = (data as any)?.status as NodeStatusValue | undefined
  if (status !== 'running' && status !== 'queued') return null
  if (vendor && normalizeVideoVendor((data as any)?.videoModelVendor) !== normalizeVideoVendor(vendor)) return null
  const taskId = String((data as any)?.videoTaskId || '').trim()
  return taskId || null
}

function isTaskRunningSnapshot(snapshot: TaskResultDto): boolean {
  return snapshot.status === 'running' || snapshot.status === 'queued'
}

function resolveGenericVideoAsset(snapshot: TaskResultDto): {
  url: string
  thumbnailUrl: string | null
  assetId: string | null
} | null {
  const primaryAsset = (snapshot.assets || []).find((asset) => asset.type === 'video' && asset.url)
  if (primaryAsset?.url) {
    return {
      url: primaryAsset.url,
      thumbnailUrl: primaryAsset.thumbnailUrl || null,
      assetId: typeof primaryAsset.assetId === 'string' && primaryAsset.assetId.trim() ? primaryAsset.assetId.trim() : null,
    }
  }
  const extracted = extractVideoAssetFromRawResponse((snapshot.raw as any)?.response || snapshot.raw)
  return extracted
    ? {
        url: extracted.url,
        thumbnailUrl: extracted.thumbnailUrl,
        assetId: null,
      }
    : null
}

async function finalizeGenericVideoSuccess(input: {
  snapshot: TaskResultDto
  taskId: string
  ctx: RunnerContext
  prompt: string
  durationSeconds: number
  modelKey: string
  vendor: string
  autoReferenceImageUrls?: string[]
}) {
  const { snapshot, taskId, ctx, prompt, durationSeconds, modelKey, vendor, autoReferenceImageUrls } = input
  const { id, data, kind, setNodeStatus, appendLog, isCanceled } = ctx
  const resolvedAsset = resolveGenericVideoAsset(snapshot)
  if (!resolvedAsset?.url) {
    const msg = `${vendor} 视频任务执行失败：未返回有效视频地址`
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
    return
  }
  const existingResults = ((data as any)?.videoResults as Array<Record<string, unknown>> | undefined) || []
  const updatedVideoResults = [
    ...existingResults,
    {
      id: snapshot.id || taskId,
      ...buildVideoAssetResultItem({
        url: resolvedAsset.url,
        thumbnailUrl: resolvedAsset.thumbnailUrl,
        title: (data as any)?.videoTitle || null,
        duration: durationSeconds,
        assetId: resolvedAsset.assetId,
      }),
      model: modelKey,
      remixTargetId: null,
    },
  ]
  setNodeStatus(id, 'success', {
    progress: 100,
    lastResult: {
      id: snapshot.id || taskId,
      at: Date.now(),
      kind,
      preview: { type: 'video', src: resolvedAsset.url },
    },
    prompt,
    videoUrl: resolvedAsset.url,
    videoThumbnailUrl: resolvedAsset.thumbnailUrl || (data as any)?.videoThumbnailUrl || null,
    videoResults: updatedVideoResults,
    videoPrimaryIndex: updatedVideoResults.length - 1,
    ...buildVideoDurationPatch(durationSeconds),
    videoModel: modelKey,
    videoModelVendor: vendor,
    videoTaskId: taskId,
  })
  appendLog(id, `[${nowLabel()}] ${vendor} 视频生成完成。`)
  if (autoReferenceImageUrls && autoReferenceImageUrls.length > 0 && !isCanceled(id)) {
    const storeState = ctx.getState()
    if (typeof storeState?.onConnect === 'function') {
      const refUrlSet = new Set(autoReferenceImageUrls.map((u) => String(u || '').trim()).filter(Boolean))
      const canvasNodes: Node[] = Array.isArray(storeState.nodes) ? storeState.nodes : []
      const canvasEdges: Edge[] = Array.isArray(storeState.edges) ? storeState.edges : []
      const connected: string[] = []
      for (const node of canvasNodes) {
        if (node.id === id) continue
        const primaryUrl = pickPrimaryImageFromNode(node)
        if (!primaryUrl || !refUrlSet.has(primaryUrl)) continue
        if (canvasEdges.some((e) => e.source === node.id && e.target === id)) continue
        storeState.onConnect({ source: node.id, target: id, sourceHandle: null, targetHandle: null })
        connected.push(node.id)
      }
      if (connected.length > 0) {
        appendLog(id, `[${nowLabel()}] 已自动连接 ${connected.length} 个参考图片节点`)
      }
    }
  }
  try {
    const semanticResult = await persistSemanticAssetMetadata({
      nodeId: id,
      nodeKind: kind,
      nodeData: {
        ...(data as Record<string, unknown>),
        prompt,
        videoUrl: resolvedAsset.url,
        videoThumbnailUrl: resolvedAsset.thumbnailUrl || (data as any)?.videoThumbnailUrl || null,
        ...buildVideoDurationPatch(durationSeconds),
        videoModel: modelKey,
        videoModelVendor: vendor,
        videoTaskId: taskId,
      },
      mediaKind: 'video',
      videoUrl: resolvedAsset.url,
      thumbnailUrl: resolvedAsset.thumbnailUrl || undefined,
      prompt,
    })
    if (semanticResult?.metadataSynced && semanticResult.sourceBookId) {
      appendLog(
        id,
        `[${nowLabel()}] 视频语义资产已同步到章节元数据（book=${semanticResult.sourceBookId}, semantic=${semanticResult.semanticId}）`,
      )
    } else if (semanticResult) {
      appendLog(
        id,
        `[${nowLabel()}] 视频语义资产未写入书籍 semanticAssets（bookScope=${semanticResult.bookScopeStatus}）`,
      )
    }
  } catch (error: unknown) {
    const message = error instanceof Error && error.message ? error.message : '视频语义资产回填失败'
    appendLog(id, `[${nowLabel()}] ${message}`)
    if (!isCanceled(id)) {
      toast(message, 'warning')
    }
  }
  if (snapshot.assets && snapshot.assets.length && !isCanceled(id)) notifyAssetRefresh()
}

function buildVeoTaskExtras(input: {
  kind: string
  id: string
  model: string
  aspectRatio: string
  size?: string | null
  resolution?: string | null
  specKey?: string | null
  referenceImages: string[]
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  uploadedReferenceAssets?: PreparedVideoReferenceAsset[]
  uploadedFirstFrameAsset?: PreparedVideoReferenceAsset | null
  uploadedLastFrameAsset?: PreparedVideoReferenceAsset | null
  referenceSheet?: UploadedReferenceSheet | null
  upstreamVideoUrl?: string | null
  referenceVideoDurationSeconds?: number | null
}): Record<string, unknown> {
  const extras: Record<string, unknown> = {
    nodeKind: input.kind,
    nodeId: input.id,
    modelKey: input.model,
    aspectRatio: input.aspectRatio,
    awaitResult: false,
  }
  if (input.size && input.size.trim()) {
    extras.size = input.size.trim()
  }
  if (input.resolution && input.resolution.trim()) {
    extras.resolution = input.resolution.trim()
  }
  if (input.specKey && input.specKey.trim()) {
    extras.specKey = input.specKey.trim()
    extras.videoSpecKey = input.specKey.trim()
  }
  const referenceSheetMeta = buildReferenceSheetLogMeta(input.referenceSheet)
  if (referenceSheetMeta) {
    extras.referenceSheet = referenceSheetMeta
  }
  if (input.uploadedFirstFrameAsset?.assetId) {
    extras.firstFrameAssetId = input.uploadedFirstFrameAsset.assetId
    if (input.uploadedLastFrameAsset?.assetId) extras.lastFrameAssetId = input.uploadedLastFrameAsset.assetId
    extras.assetInputs = [
      {
        assetId: input.uploadedFirstFrameAsset.assetId,
        role: 'target',
      },
      ...(input.uploadedLastFrameAsset?.assetId
        ? [{
            assetId: input.uploadedLastFrameAsset.assetId,
            role: 'reference',
          }]
        : []),
      ...((input.uploadedReferenceAssets || []).map((item) => ({
        assetId: item.assetId,
        role: item.role,
      }))),
    ]
  } else if (input.firstFrameUrl) {
    extras.firstFrameUrl = input.firstFrameUrl
    if (input.lastFrameUrl) extras.lastFrameUrl = input.lastFrameUrl
  }
  if (input.uploadedReferenceAssets?.length && !input.uploadedFirstFrameAsset?.assetId) {
    extras.referenceAssetIds = input.uploadedReferenceAssets.map((item) => item.assetId)
    extras.assetInputs = input.uploadedReferenceAssets.map((item) => ({
      assetId: item.assetId,
      role: item.role,
    }))
  } else if (input.referenceImages.length && !input.firstFrameUrl) {
    extras.referenceImages = input.referenceImages
  }
  if (input.upstreamVideoUrl && isRemoteUrl(String(input.upstreamVideoUrl))) {
    extras.upstreamVideoUrl = input.upstreamVideoUrl
    const isSeedance2 = /seedance[-_.]?2(?:[-_.]|$)/i.test(input.model)
    if (isSeedance2 && (!Number.isFinite(input.referenceVideoDurationSeconds) || Number(input.referenceVideoDurationSeconds) <= 0)) {
      throw new Error('参考视频时长缺失，无法计算 SD2 视频积分消耗')
    }
    if (isSeedance2) extras.referenceVideoDurationSeconds = input.referenceVideoDurationSeconds
  }
  return extras
}

function resolvePendingTaskIdFromResult(res: TaskResultDto): string | null {
  const pendingTaskIdRaw = (res.raw && ((res.raw as any).taskId as string | undefined)) || res.id || null
  const pendingTaskId =
    typeof pendingTaskIdRaw === 'string' ? pendingTaskIdRaw.trim() : String(pendingTaskIdRaw || '').trim() || null
  return pendingTaskId
}

function trySilentSaveProject() {
  if (typeof window !== 'undefined' && typeof (window as any).silentSaveProject === 'function') {
    try {
      ;(window as any).silentSaveProject()
    } catch {
      // ignore save errors here
    }
  }
}

async function pollGenericVideoResultClient(ctx: RunnerContext, options: {
  taskId: string
  prompt: string
  model: string
  vendor: string
  durationSeconds: number
  autoReferenceImageUrls?: string[]
}) {
  const { id, data, setNodeStatus, appendLog, isCanceled } = ctx
  const pollIntervalMs = 3000
  const pollTimeoutMs = 1_200_000
  const startedAt = Date.now()
  let lastProgress = typeof (data as any)?.progress === 'number' ? (data as any).progress : 10

  while (Date.now() - startedAt < pollTimeoutMs) {
    if (isCanceled(id)) {
      setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
      appendLog(id, `[${nowLabel()}] 已取消 ${options.vendor} 视频任务`)
      return
    }

    let snapshot: TaskResultDto
    try {
      snapshot = await fetchTaskResult(options.taskId, 'text_to_video', options.prompt)
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : '查询视频任务进度失败'
      appendLog(id, `[${nowLabel()}] error: ${message}`)
      await sleep(pollIntervalMs)
      continue
    }

    if (isTaskRunningSnapshot(snapshot)) {
      lastProgress = updateTaskPollingProgress(ctx, snapshot, {
        lastProgress,
        progressRange: { min: 10, max: 95 },
        statusPatch: {
          videoTaskId: options.taskId,
          videoModel: options.model,
          videoModelVendor: options.vendor,
        },
      })
      await sleep(pollIntervalMs)
      continue
    }

    if (snapshot.status === 'failed') {
      const failure = resolveProviderTaskFailure(
        snapshot.raw,
        `${options.vendor.trim() || '视频'} 视频任务失败`,
      )
      setNodeStatus(id, 'error', {
        progress: 0,
        lastError: failure.message,
        errorMessage: failure.message,
        ...(failure.code ? { errorCode: failure.code } : {}),
      })
      appendLog(id, `[${nowLabel()}] error: ${failure.message}`)
      return
    }

    await finalizeGenericVideoSuccess({
      snapshot,
      taskId: options.taskId,
      ctx,
      prompt: options.prompt,
      durationSeconds: options.durationSeconds,
      modelKey: options.model,
      vendor: options.vendor,
      autoReferenceImageUrls: options.autoReferenceImageUrls,
    })
    return
  }

  const timeoutMsg = `${options.vendor} 视频任务查询超时，请稍后在控制台确认结果`
  setNodeStatus(id, 'error', { progress: 0, lastError: timeoutMsg })
  appendLog(id, `[${nowLabel()}] error: ${timeoutMsg}`)
}

async function runVideoTask(ctx: RunnerContext) {
  const { id, setNodeStatus, appendLog } = ctx
  try {
    const prepared = await prepareVideoTaskInput(ctx)
    if (prepared.referenceImagesForVideo.length) {
      appendLog(
        id,
        `[${nowLabel()}] 视频参考图已注入 ${prepared.referenceImagesForVideo.length} 张${prepared.storyboardCompositeRef ? '（含分镜合成图）' : ''}`,
      )
    }
    if (prepared.uploadedFirstFrameAsset || prepared.uploadedLastFrameAsset || prepared.uploadedReferenceAssets.length) {
      const uploadedCount =
        (prepared.uploadedFirstFrameAsset ? 1 : 0) +
        (prepared.uploadedLastFrameAsset ? 1 : 0) +
        prepared.uploadedReferenceAssets.length
      appendLog(id, `[${nowLabel()}] Sora 参考图已按 ${prepared.videoSize || prepared.aspectRatioSetting} 预处理并上传 ${uploadedCount} 个文件`)
    }
    await runGenericVideoTask(ctx, {
      prompt: prepared.finalPrompt,
      vendor: prepared.videoVendor,
      model: prepared.videoModelValue,
      aspectRatio: prepared.aspectRatioSetting,
      size: prepared.videoSize,
      resolution: prepared.videoResolution,
      specKey: prepared.videoSpecKey,
      orientation: prepared.orientation,
      referenceImages: prepared.referenceImagesForVideo,
      durationSeconds: prepared.videoDurationSeconds,
      firstFrameUrl: prepared.effectiveFirstFrameUrl,
      lastFrameUrl: prepared.effectiveFirstFrameUrl ? prepared.lastFrameUrlValue : '',
      uploadedReferenceAssets: prepared.uploadedReferenceAssets,
      uploadedFirstFrameAsset: prepared.uploadedFirstFrameAsset,
      uploadedLastFrameAsset: prepared.uploadedLastFrameAsset,
      referenceSheet: prepared.referenceSheet,
      upstreamVideoUrl: prepared.upstreamVideoUrl,
      referenceVideoDurationSeconds: prepared.referenceVideoDurationSeconds,
      autoReferenceImageUrls: prepared.autoReferenceImageUrls,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error && error.message ? error.message : '视频任务执行失败'
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
    ctx.endRunToken(id)
  }
}

export async function syncImageNodeOnce(id: string, get: Getter) {
  const runTokenAtStart = readNodeRunToken(get, id)
  const ctx = buildRunnerContext(id, get)
  if (!ctx || !ctx.isImageTask) return

  const isAborted = () => ctx.isCanceled(id) || readNodeRunToken(get, id) !== runTokenAtStart
  if (isAborted()) return

  const { data, setNodeStatus, appendLog } = ctx
  const imageTaskId = typeof (data as any)?.imageTaskId === 'string' ? ((data as any).imageTaskId as string).trim() : ''
  const imageTaskKind: TaskKind =
    typeof (data as any)?.imageTaskKind === 'string' && (data as any).imageTaskKind.trim()
      ? ((data as any).imageTaskKind as TaskKind)
      : 'text_to_image'
  if (!imageTaskId) return

  let snapshot: TaskResultDto
  try {
    snapshot = await fetchTaskResult(imageTaskId, imageTaskKind, ctx.prompt)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '查询图像任务进度失败'
    appendLog(id, `[${nowLabel()}] error: ${message}`)
    return
  }
  if (isAborted()) return

  if (isTaskRunningSnapshot(snapshot)) {
    const pct = extractTaskProgressPercent(snapshot)
    if (typeof pct === 'number') {
      const current = typeof (data as any)?.progress === 'number' ? (data as any).progress as number : 10
      const normalized = Math.min(95, Math.max(current, Math.max(5, Math.round(pct))))
      setNodeStatus(id, snapshot.status === 'queued' ? 'queued' : 'running', {
        progress: normalized,
        imageTaskId,
      })
    }
    return
  }

  if (snapshot.status === 'failed') {
    const msg = extractTaskFailureMessage(snapshot)
    setNodeStatus(id, 'error', { progress: 0, lastError: msg, imageTaskId: '' })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
    return
  }

  // succeeded
  const rawUrl = extractFirstImageAssetUrl(snapshot)
  if (!rawUrl) {
    setNodeStatus(id, 'error', { progress: 0, lastError: '图像任务完成但未返回图片', imageTaskId: '' })
    return
  }
  const existingResults = Array.isArray((data as any)?.imageResults) ? (data as any).imageResults as Array<Record<string, unknown>> : []
  const newItem = buildImageAssetResultItem({ url: rawUrl, assetId: findTaskAssetIdByUrl(snapshot, rawUrl) })
  setNodeStatus(id, 'success', {
    progress: 100,
    imageUrl: rawUrl,
    imageResults: [...existingResults, newItem],
    imagePrimaryIndex: existingResults.length,
    imageTaskId: '',
    lastResult: {
      id: snapshot.id || imageTaskId,
      at: Date.now(),
      kind: ctx.kind,
      preview: { type: 'image', src: rawUrl },
    },
  })
  appendLog(id, `[${nowLabel()}] 图像任务已恢复完成。`)
}

async function runGenericVideoTask(ctx: RunnerContext, options: GenericVideoTaskOptions) {
  const { id, data, kind, setNodeStatus, appendLog, endRunToken } = ctx
  try {
    const normalizedVendor = normalizeVideoVendor(options.vendor)
    if (!normalizedVendor) {
      throw new Error('视频模型厂商未配置')
    }
    const modelKey = options.model.trim() || String((data as any)?.videoModel || '').trim()
    if (!modelKey) {
      throw new Error('视频模型未配置')
    }

    setNodeStatus(id, 'running', { progress: 5 })
    appendLog(id, `[${nowLabel()}] 调用 ${normalizedVendor} 视频模型 ${modelKey}…`)

    const extras = buildVeoTaskExtras({
      kind,
      id,
      model: modelKey,
      aspectRatio: options.aspectRatio,
      size: options.size,
      resolution: options.resolution,
      specKey: options.specKey,
      referenceImages: options.referenceImages,
      firstFrameUrl: options.firstFrameUrl,
      lastFrameUrl: options.lastFrameUrl,
      uploadedReferenceAssets: options.uploadedReferenceAssets,
      uploadedFirstFrameAsset: options.uploadedFirstFrameAsset,
      uploadedLastFrameAsset: options.uploadedLastFrameAsset,
      referenceSheet: options.referenceSheet,
      upstreamVideoUrl: options.upstreamVideoUrl,
      referenceVideoDurationSeconds: options.referenceVideoDurationSeconds,
    })
    extras.durationSeconds = options.durationSeconds
    extras.orientation = options.orientation
    extras.audio = (data as Record<string, unknown>).videoGenerateAudio !== false
    // sourcePrevTaskId 由 dag.ts injectVideoUpstreamRefsIfNeeded 从上游 video 节点 data.taskId 解析并写入。
    // 透传为 extras.prevTaskId，供 task.service.ts 注入 metadata.prevTaskId，
    // 最终由 new-api pixverse adaptor 用作 extend_from_task_id（apimart 续写）。
    const sourcePrevTaskId = String((data as any)?.sourcePrevTaskId || '').trim()
    if (sourcePrevTaskId && !extras.prevTaskId) extras.prevTaskId = sourcePrevTaskId

    if (isKlingMotionControlModel(modelKey)) {
      const motionExtras = buildKlingMotionControlExtras({
        data: data as Record<string, unknown>,
        durationSeconds: options.durationSeconds,
      })
      extras.characterOrientation = motionExtras.characterOrientation
      extras.motionMode = motionExtras.motionMode
      extras.keepOriginalSound = motionExtras.keepOriginalSound
      extras.watermarkEnabled = motionExtras.watermarkEnabled
      extras.durationSeconds = motionExtras.durationSeconds
    }

    // kling-v3-omni「参考视频用途」：feature=动作迁移（上游参考视频只供动作/运镜，
    // 新主体来自参考图）、base=底片重绘/续演。仅显式设置时透传，hono 只对 omni 注入。
    if (isKlingV3OmniVideoModel(modelKey)) {
      const referType = normalizeKlingVideoReferType((data as any)?.videoReferType)
      if (referType) extras.videoReferType = referType
      const rawKeepSound = (data as any)?.keepOriginalSound
      if (rawKeepSound !== undefined && rawKeepSound !== null && String(rawKeepSound).trim() !== '') {
        extras.keepOriginalSound = normalizeKlingKeepOriginalSound(rawKeepSound)
      }
    }

    const request: TaskRequestDto = {
      kind: 'text_to_video',
      prompt: options.prompt,
      extras,
    }
    const { result: res, requestProgress } = await runTaskByVendorWithPendingProgress(ctx, {
      vendor: normalizedVendor,
      request,
      startProgress: 5,
      maxProgress: 95,
      status: 'running',
    })
    appendRequestPayloadLog({
      appendLog,
      nodeId: id,
      result: res,
      fallbackVendor: normalizedVendor,
      fallbackRequest: request,
    })

    const pendingTaskId = resolvePendingTaskIdFromResult(res)
    if (res.status === 'queued' || res.status === 'running') {
      if (!pendingTaskId) {
        throw new Error(`${normalizedVendor} 视频任务创建失败：未返回任务 ID`)
      }

      setNodeStatus(id, res.status === 'queued' ? 'queued' : 'running', {
        progress: Math.max(10, requestProgress),
        videoTaskId: pendingTaskId,
        videoModel: modelKey,
        videoModelVendor: normalizedVendor,
        lastResult: {
          id: pendingTaskId,
          at: Date.now(),
          kind,
          preview: { type: 'text', value: `已创建 ${normalizedVendor} 视频任务（ID: ${pendingTaskId}）` },
        },
      })
      trySilentSaveProject()
      await pollGenericVideoResultClient(ctx, {
        taskId: pendingTaskId,
        prompt: options.prompt,
        model: modelKey,
        vendor: normalizedVendor,
        durationSeconds: options.durationSeconds,
        autoReferenceImageUrls: options.autoReferenceImageUrls,
      })
      return
    }

    await finalizeGenericVideoSuccess({
      snapshot: res,
      taskId: pendingTaskId || String(res.id || '').trim(),
      ctx,
      prompt: options.prompt,
      durationSeconds: options.durationSeconds,
      modelKey,
      vendor: normalizedVendor,
      autoReferenceImageUrls: options.autoReferenceImageUrls,
    })
  } catch (error: unknown) {
    const message = error instanceof Error && error.message ? error.message : '视频任务执行失败'
    setNodeStatus(id, 'error', { progress: 0, lastError: message })
    appendLog(id, `[${nowLabel()}] error: ${message}`)
  } finally {
    endRunToken(id)
  }
}

export async function syncGenericVideoNodeOnce(id: string, get: Getter) {
  const runTokenAtStart = readNodeRunToken(get, id)
  const ctx = buildRunnerContext(id, get)
  if (!ctx || !ctx.isVideoTask) return

  const isAborted = () => ctx.isCanceled(id) || readNodeRunToken(get, id) !== runTokenAtStart
  if (isAborted()) return

  const { data, prompt, setNodeStatus: setNodeStatusRaw, appendLog: appendLogRaw } = ctx
  const setNodeStatus: RunnerHandlers['setNodeStatus'] = (nodeId, status, patch) => {
    if (isAborted()) return
    setNodeStatusRaw(nodeId, status, patch)
  }
  const appendLog: RunnerHandlers['appendLog'] = (nodeId, line) => {
    if (isAborted()) return
    appendLogRaw(nodeId, line)
  }
  const vendor = normalizeVideoVendor((data as any)?.videoModelVendor || (data as any)?.videoVendor || '')
  const taskId = resolveActiveVideoTaskIdByVendor(data)
  if (!taskId || !vendor) return

  let snapshot: TaskResultDto
  try {
    snapshot = await fetchTaskResult(taskId, 'text_to_video', prompt)
  } catch (error: unknown) {
    const message = error instanceof Error && error.message ? error.message : '查询视频任务进度失败'
    appendLog(id, `[${nowLabel()}] error: ${message}`)
    return
  }
  if (isAborted()) return

  if (isTaskRunningSnapshot(snapshot)) {
    const current = typeof (data as any)?.progress === 'number' ? (data as any).progress : 10
    updateTaskPollingProgress({ id, setNodeStatus }, snapshot, {
      lastProgress: current,
      progressRange: { min: 10, max: 95 },
      statusPatch: {
        videoTaskId: taskId,
        videoModel: String((data as any)?.videoModel || '').trim() || undefined,
        videoModelVendor: vendor,
      },
    })
    return
  }

  if (snapshot.status === 'failed') {
    const failure = resolveProviderTaskFailure(
      snapshot.raw,
      `${vendor.trim() || '视频'} 视频任务失败`,
    )
    setNodeStatus(id, 'error', {
      progress: 0,
      lastError: failure.message,
      errorMessage: failure.message,
      ...(failure.code ? { errorCode: failure.code } : {}),
    })
    appendLog(id, `[${nowLabel()}] error: ${failure.message}`)
    return
  }

  await finalizeGenericVideoSuccess({
    snapshot,
    taskId,
    ctx,
    prompt,
    durationSeconds: resolveVideoDurationSeconds({
      data,
      isStoryboard: false,
      storyboardTotalDuration: 0,
      videoModelValue: String((data as any)?.videoModel || '').trim(),
    }),
    modelKey: String((data as any)?.videoModel || '').trim(),
    vendor,
  })
}

async function runStoryboardImageTask(ctx: RunnerContext) {
  const { id, data, kind, setNodeStatus, appendLog, isCanceled, state } = ctx

  try {
    const projectId = String((useUIStore.getState() as any)?.currentProject?.id || '').trim()
    const sourceBookId = String((data as any)?.sourceBookId || '').trim()
    const isNovelStoryboard = !!sourceBookId
    const storyboardCount = isNovelStoryboard
      ? clampInt((data as any)?.storyboardGroupSize || (data as any)?.storyboardCount, 1, 25, 1)
      : clampInt((data as any)?.storyboardCount, 4, 16, 4)
    const storyboardAspect = normalizeStoryboardImageAspectRatio((data as any)?.storyboardAspectRatio)
    const storyboardStyle = normalizeStoryboardImageStyle((data as any)?.storyboardStyle)

    const rawTheme = typeof (data as any)?.prompt === 'string' ? ((data as any).prompt as string).trim() : ''
    const explicitShotPrompts = Array.isArray((data as any)?.storyboardShotPrompts)
      ? ((data as any).storyboardShotPrompts as unknown[])
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      : []
    let storyboardArtifact: Record<string, unknown> | null = null
    let authoritativePlanId = ''
    let authoritativeTaskId = ''
    let previousChunkId = ''
    let chapterNo = 0
    let shotPrompts: string[] = []
    if (isNovelStoryboard && projectId && sourceBookId) {
      const chapterRaw = Number((data as any)?.chapter ?? (data as any)?.materialChapter)
      chapterNo = Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : 0
      const planId = String((data as any)?.storyboardPlanId || '').trim()
      const chunkIndexRaw = Number((data as any)?.storyboardChunkIndex)
      const chunkIndex = Number.isFinite(chunkIndexRaw) && chunkIndexRaw >= 0 ? Math.trunc(chunkIndexRaw) : -1
      if (!chapterNo || !planId || chunkIndex < 0) {
        throw new Error('小说分镜生成缺少 chapter、storyboardPlanId 或 storyboardChunkIndex')
      }
      const idx = await getProjectBookIndex(projectId, sourceBookId)
      const plans = Array.isArray(idx.assets?.storyboardPlans) ? idx.assets.storyboardPlans : []
      const plan = plans.find((candidate) => candidate.planId === planId) ?? null
      if (!plan || plan.chapter !== chapterNo) {
        throw new Error('未找到当前章节精确 storyboardPlanId 对应的分镜计划')
      }
      storyboardArtifact = plan.storyboardArtifact
      authoritativePlanId = plan.planId
      authoritativeTaskId = plan.taskId.trim()
      if (storyboardArtifact.schemaVersion !== STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION) {
        throw new Error('分镜计划缺少 storyboard-director/v1.2 原始 artifact')
      }
      if (!authoritativeTaskId) {
        throw new Error('分镜计划缺少 taskId')
      }
      const nodeTaskId = String((data as any)?.storyboardTaskId || '').trim()
      if (nodeTaskId && nodeTaskId !== authoritativeTaskId) {
        throw new Error('节点 storyboardTaskId 与分镜计划不一致')
      }
      if (plan.groupSize !== storyboardCount) {
        throw new Error(`节点分镜数量与分镜计划不一致：节点 ${storyboardCount}，计划 ${plan.groupSize}`)
      }
      previousChunkId = String((data as any)?.storyboardPreviousChunkId || '').trim()
      if (chunkIndex > 0) {
        if (!previousChunkId) {
          throw new Error('跨 chunk 小说分镜缺少精确 storyboardPreviousChunkId')
        }
        const previousChunk = idx.assets?.storyboardChunks?.find((chunk) => chunk.chunkId === previousChunkId) ?? null
        if (
          !previousChunk ||
          previousChunk.taskId !== authoritativeTaskId ||
          previousChunk.chapter !== chapterNo ||
          previousChunk.groupSize !== storyboardCount ||
          previousChunk.chunkIndex !== chunkIndex - 1 ||
          !previousChunk.tailFrameUrl.trim()
        ) {
          throw new Error('storyboardPreviousChunkId 与当前计划不构成具有真实 tailFrameUrl 的直接前驱关系')
        }
      }
      const structured = normalizeStoryboardStructuredData(storyboardArtifact)
      if (!structured || structured.sourceSchemaVersion !== STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION) {
        throw new Error('分镜计划的 v1.2 artifact 无法形成确定性结构投影')
      }
      const derivedPrompts = deriveShotPromptsFromStructuredData(structured)
      const storedProjection = plan.storyboardStructured
      if (storedProjection.sourceSchemaVersion !== STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION) {
        throw new Error('分镜计划缺少 storyboard-director/v1.2 确定性结构投影')
      }
      const storedProjectionPrompts = deriveShotPromptsFromStructuredData(storedProjection)
      if (
        storedProjectionPrompts.length !== derivedPrompts.length ||
        storedProjectionPrompts.some((prompt, index) => prompt !== derivedPrompts[index])
      ) {
        throw new Error('分镜计划的原始 artifact 与结构投影不一致')
      }
      const shotStartRaw = Number((data as any)?.storyboardShotStart)
      const shotEndRaw = Number((data as any)?.storyboardShotEnd)
      const shotStart = Number.isFinite(shotStartRaw) && shotStartRaw > 0 ? Math.trunc(shotStartRaw) : 0
      const shotEnd = Number.isFinite(shotEndRaw) && shotEndRaw >= shotStart ? Math.trunc(shotEndRaw) : 0
      const indexedPrompts = structured.shots
        .map((shot, index) => ({ shotNo: shot.shotNo, prompt: derivedPrompts[index] || '' }))
        .filter((entry) => entry.prompt)
      const rangedPrompts = shotStart > 0 && shotEnd >= shotStart
        ? indexedPrompts
            .filter((entry) => typeof entry.shotNo === 'number' && entry.shotNo >= shotStart && entry.shotNo <= shotEnd)
            .map((entry) => entry.prompt)
        : []
      if (rangedPrompts.length === storyboardCount) {
        shotPrompts = rangedPrompts
      } else if (derivedPrompts.length === storyboardCount && shotEnd - shotStart + 1 === storyboardCount) {
        shotPrompts = derivedPrompts
      } else {
        throw new Error(`结构化分镜计划与当前 chunk 范围不一致：期望 ${storyboardCount} 镜，无法精确映射`)
      }
      if (
        explicitShotPrompts.length > 0 &&
        (explicitShotPrompts.length !== shotPrompts.length || explicitShotPrompts.some((prompt, index) => prompt !== shotPrompts[index]))
      ) {
        throw new Error('节点 storyboardShotPrompts 与结构化分镜计划不一致')
      }
    } else {
      if (explicitShotPrompts.length !== storyboardCount) {
        throw new Error(`故事板节点必须提供 ${storyboardCount} 条结构化 storyboardShotPrompts`)
      }
      shotPrompts = explicitShotPrompts
    }

    const themeText = isNovelStoryboard ? '' : rawTheme

    const styleSuffix = (() => {
      switch (storyboardStyle) {
        case 'comic':
          return '美漫风格，粗线条，高对比，漫画渲染，统一角色设定'
        case 'sketch':
          return '手绘草图风格，铅笔线稿，素描质感，统一角色设定'
        case 'strip':
          return '条漫风格，黑白线稿，分镜漫画，统一角色设定'
        case 'realistic':
        default:
          return '写实摄影风格，电影级光影，真实质感，统一角色设定'
      }
    })()

    const gridLayout = (() => {
      if (storyboardCount <= 4) {
        return { rows: 2, cols: 2, sheetAspectRatio: storyboardAspect as string }
      }
      if (storyboardCount <= 9) {
        return { rows: 3, cols: 3, sheetAspectRatio: storyboardAspect as string }
      }
      if (storyboardCount <= 12) {
        return storyboardAspect === '16:9'
          ? { rows: 4, cols: 3, sheetAspectRatio: '4:3' }
          : { rows: 3, cols: 4, sheetAspectRatio: '3:4' }
      }
      if (storyboardCount <= 16) {
        return { rows: 4, cols: 4, sheetAspectRatio: storyboardAspect as string }
      }
      return { rows: 5, cols: 5, sheetAspectRatio: storyboardAspect as string }
    })()

    const totalCells = gridLayout.rows * gridLayout.cols
    const gridPrompt = [
      '请生成一张“分镜网格图”（storyboard contact sheet）。',
      themeText ? `剧情摘要：${themeText}` : '',
      `画面为 ${gridLayout.rows} 行 × ${gridLayout.cols} 列等分网格（总共 ${totalCells} 格），每格大小一致、边界对齐，便于按网格裁切。`,
      '每格为独立画面，按从左到右、从上到下排列。',
      `每格画面构图比例为 ${storyboardAspect}。`,
      !isNovelStoryboard ? '采用关键帧分镜模式：每格只表达关键动作与镜头变化，不做过细漫画化堆叠。' : '',
      !isNovelStoryboard ? '去同质化硬约束：相邻格至少在“主体动作/景别/机位运动”中变化两项，禁止重复构图与重复姿态。' : '',
      '不要在画面中出现任何文字、数字、字幕、对白气泡或水印。',
      !isNovelStoryboard ? `统一角色设定与连续性；风格要求：${styleSuffix}。` : '',
      '镜头列表（按顺序填入网格）：',
      ...shotPrompts.map((p, i) => `镜头 ${i + 1}：${p}`),
      totalCells > storyboardCount ? `剩余 ${totalCells - storyboardCount} 格保持空白纯色背景（不要内容）。` : '',
    ]
      .filter(Boolean)
      .join('\n')

    const storedImageModel =
      typeof data.imageModel === 'string' && data.imageModel.trim()
        ? data.imageModel.trim()
        : ''
    if (!storedImageModel) {
      throw new Error('分镜图片节点未配置模型：请先从系统模型目录中选择一个可用图片模型。')
    }
    const selectedModel = storedImageModel
    const modelLower = selectedModel.toLowerCase()
    const vendor = 'auto'

    const promptForModel = gridPrompt

    const edges = Array.isArray((state as any)?.edges) ? ((state as any).edges as any[]) : []
    const nodes = Array.isArray((state as any)?.nodes) ? ((state as any).nodes as Node[]) : []
    const inbound = edges.filter((e) => e && e.target === id && !isReferenceOnlyCanvasEdge(e))
    const lastEdge = inbound.length ? inbound[inbound.length - 1] : null
    const lastSourceNode = lastEdge ? nodes.find((n) => n.id === lastEdge.source) : null
    const lastSourceKind = lastSourceNode ? ((lastSourceNode.data as any)?.kind as string | undefined) : undefined
    const lastSourceLabel =
      lastSourceNode && lastSourceNode.data
        ? (typeof (lastSourceNode.data as any).label === 'string' && (lastSourceNode.data as any).label.trim()
          ? String((lastSourceNode.data as any).label).trim()
          : lastSourceNode.id)
        : null
    const hasStoryboardUpstream = lastSourceKind === 'storyboardImage' || lastSourceKind === 'novelStoryboard'

    const mentionRoleRefs = await resolveRoleCardImagesByMentions({
      bookId: sourceBookId,
      chapter: readRunnerChapter(data),
      prompt: gridPrompt,
    }).catch(() => ({ urls: [] as string[], matched: [] as string[], missing: [] as string[], ambiguous: [] as string[] }))
    const mentionAssetRefs = await resolveAssetImagesByMentions({
      prompt: gridPrompt,
      nodes,
    }).catch(() => createEmptyPromptAssetMentionResult())
    if (mentionRoleRefs.matched.length) {
      appendLog(id, `[${nowLabel()}] 检测到角色提及：${mentionRoleRefs.matched.join('、')}，已自动注入角色卡参考图`)
    }
    if (mentionRoleRefs.missing.length) {
      appendLog(id, `[${nowLabel()}] 未找到角色卡：${mentionRoleRefs.missing.join('、')}`)
    }
    if (mentionRoleRefs.ambiguous.length) {
      appendLog(
        id,
        `[${nowLabel()}] 角色名存在同名冲突：${mentionRoleRefs.ambiguous.join('、')}，请使用 @角色名#roleId前缀 或 @角色名#cardId前缀`,
      )
    }
    if (mentionAssetRefs.matched.length) {
      appendLog(id, `[${nowLabel()}] 检测到资产引用：${mentionAssetRefs.matched.join('、')}，已自动注入参考资产`)
    }
    if (mentionAssetRefs.missing.length) {
      appendLog(id, `[${nowLabel()}] 未找到资产引用：${mentionAssetRefs.missing.join('、')}`)
    }
    if (mentionAssetRefs.ambiguous.length) {
      appendLog(id, `[${nowLabel()}] 资产引用存在同名冲突：${mentionAssetRefs.ambiguous.join('、')}，请保证引用ID唯一`)
    }
    const roleCardRefImages =
      Array.isArray((data as any)?.roleCardReferenceImages)
        ? ((data as any).roleCardReferenceImages as unknown[])
            .map((x) => String(x || '').trim())
            .filter(Boolean)
        : []
    const roleReferenceEntries = normalizeRoleReferenceEntries((data as any)?.roleReferenceEntries)
    const explicitPrevTailRef = typeof (data as any)?.storyboardPrevTailImage === 'string'
      ? String((data as any).storyboardPrevTailImage || '').trim()
      : ''
    const referenceImagesRaw = [
      ...(explicitPrevTailRef ? [explicitPrevTailRef] : []),
      ...collectNodeReferenceImageUrls(data, 8),
      ...collectReferenceImages(state, id),
      ...mentionRoleRefs.urls,
      ...mentionAssetRefs.urls,
      ...roleCardRefImages,
    ]
    const normalizedReferenceImages = Array.from(
      new Set(
        referenceImagesRaw
          .map((u) => (typeof u === 'string' ? u.trim() : ''))
          .filter(Boolean)
          .map((u) => toAbsoluteHttpUrl(u) || u),
      ),
    ).slice(0, 8)
    let mergedRoleReferenceSheet: UploadedReferenceSheet | null = null
    if (shouldAutoMergeReferenceSheet() && roleReferenceEntries.length > 1) {
      try {
        mergedRoleReferenceSheet = await uploadMergedReferenceSheet({
          id,
          entries: roleReferenceEntries,
          prompt: gridPrompt,
          vendor,
          modelKey: selectedModel,
          taskKind: 'image_edit',
          mergeThreshold: 1,
        })
        if (mergedRoleReferenceSheet) {
          appendLog(id, `[${nowLabel()}] 已合并角色参考图：${roleReferenceEntries.length} 张 -> 1 张（带角色名标记）`)
        }
      } catch (err: any) {
        appendLog(id, `[${nowLabel()}] 角色参考图合并失败，降级为单张参考图：${err?.message || 'unknown error'}`)
      }
    }
    const mergedRoleReferenceUrl = mergedRoleReferenceSheet?.url || null
    const referenceImages = mergedRoleReferenceUrl
      ? [mergedRoleReferenceUrl, ...normalizedReferenceImages.filter((u) => u !== mergedRoleReferenceUrl).slice(0, 2)]
      : normalizedReferenceImages.slice(0, 3)
    if (isNovelStoryboard && referenceImages.length === 0) {
      const msg = '小说分镜必须使用主角/角色参考图：请先生成并绑定主角角色卡（或在节点绑定角色图）'
      setNodeStatus(id, 'error', { progress: 0, lastError: msg })
      appendLog(id, `[${nowLabel()}] error: ${msg}`)
      if (!isCanceled(id)) toast(msg, 'warning')
      return
    }
    const wantsImageEdit = isNovelStoryboard ? true : referenceImages.length > 0
    if (!wantsImageEdit && inbound.length) {
      appendLog(
        id,
        `[${nowLabel()}] 检测到上游连接，但未找到可用的上游图片输出作为参考图：请先运行上游节点并确认其“主图”已生成。`,
      )
    }
    const imageSizeSetting =
      typeof (data as any)?.imageSize === 'string' && (data as any).imageSize.trim()
        ? (data as any).imageSize.trim()
        : undefined
    const imageResolutionSetting =
      typeof (data as any)?.imageResolution === 'string' && (data as any).imageResolution.trim()
        ? (data as any).imageResolution.trim()
        : typeof (data as any)?.resolution === 'string' && (data as any).resolution.trim()
          ? (data as any).resolution.trim()
          : undefined
    const imageQualitySetting =
      typeof (data as Record<string, unknown>)?.imageQuality === 'string' && String((data as Record<string, unknown>).imageQuality).trim()
        ? String((data as Record<string, unknown>).imageQuality).trim()
        : undefined

    setNodeStatus(id, 'running', {
      progress: 5,
      lastError: undefined,
    })
    if (wantsImageEdit) {
      const refHint = lastSourceLabel
        ? hasStoryboardUpstream
          ? `（优先取最近连接的「${lastSourceLabel}」的最后一镜）`
          : `（优先取最近连接的「${lastSourceLabel}」）`
        : hasStoryboardUpstream
          ? '（优先使用上一张分镜的最后一镜作为参考）'
          : ''
      appendLog(
        id,
        `[${nowLabel()}] 检测到参考图 x${referenceImages.length}${refHint}`,
      )
      if (isNovelStoryboard) {
        appendLog(id, `[${nowLabel()}] 小说分镜一致性锁定已启用（多参考图+角色特征锁定）`)
      }
    }
    appendLog(id, `[${nowLabel()}] 生成分镜网格图（${gridLayout.rows}x${gridLayout.cols}，${storyboardCount} 镜头）…`)

    const persist = useUIStore.getState().assetPersistenceEnabled
    const runtimeReferenceAssetInputs = mergeReferenceAssetInputs({
      assetInputs: [
        ...mentionAssetRefs.assetInputs,
        ...((Array.isArray((data as Record<string, unknown>)?.assetInputs)
          ? (data as Record<string, unknown>).assetInputs as unknown[]
          : []) as object[]),
      ],
      dynamicEntries: collectDynamicUpstreamReferenceEntries(state, id),
      referenceImages,
      limit: 8,
    })
    const characterBibleHint = isNovelStoryboard ? '' : buildCharacterBiblePromptHint(data)
    const roleNameHint = !isNovelStoryboard && roleReferenceEntries.length
      ? `角色一致性锁定：${roleReferenceEntries.map((x) => x.label).filter(Boolean).join('、')}。所有镜头保持脸型/发型/服装主色/关键配饰不变，仅允许姿态与机位变化。`
      : ''
    const continuityHint = !isNovelStoryboard && wantsImageEdit
      ? hasStoryboardUpstream
        ? '如果提供了参考图（上一张分镜的最后一镜）：请让本次网格的镜头1在构图/主体位置/光线/时间上自然承接参考画面，再继续推进新内容；其余镜头保持角色与场景连续。'
        : '如果提供了参考图：请在角色外观（脸/发型/服装/配饰）、场景、光线与画风上保持一致，并在此基础上生成新的分镜网格。'
      : ''
    const finalPromptForModel = appendReferenceAliasSlotPrompt({
      prompt: [promptForModel, characterBibleHint, roleNameHint, continuityHint].filter(Boolean).join('\n\n'),
      assetInputs: runtimeReferenceAssetInputs,
      referenceImages,
      enabled: wantsImageEdit && !mergedRoleReferenceSheet,
    })
    const imageBillingSpecKey = buildImageBillingSpecKey({
      modelKey: selectedModel,
      aspectRatio: gridLayout.sheetAspectRatio,
      imageSize: imageSizeSetting,
      resolution: imageResolutionSetting,
		quality: imageQualitySetting,
    })
    const request: TaskRequestDto = {
      kind: wantsImageEdit ? 'image_edit' : 'text_to_image',
      prompt: finalPromptForModel,
      extras: {
        nodeKind: kind,
        nodeId: id,
        modelKey: selectedModel,
        aspectRatio: gridLayout.sheetAspectRatio,
        ...(imageBillingSpecKey ? { specKey: imageBillingSpecKey, billingSpecKey: imageBillingSpecKey } : {}),
        ...(imageSizeSetting ? { imageSize: imageSizeSetting } : {}),
        ...(imageResolutionSetting ? { imageResolution: imageResolutionSetting, resolution: imageResolutionSetting } : {}),
        ...(imageQualitySetting ? { quality: imageQualitySetting } : {}),
        ...(wantsImageEdit ? { referenceImages } : {}),
        ...(runtimeReferenceAssetInputs.length ? { assetInputs: runtimeReferenceAssetInputs } : {}),
        ...(mergedRoleReferenceSheet ? { referenceSheet: buildReferenceSheetLogMeta(mergedRoleReferenceSheet) } : {}),
        persistAssets: persist,
      },
    }
    const pendingTask = await runTaskByVendorWithPendingProgress(ctx, {
      vendor,
      request,
      startProgress: 5,
      maxProgress: 50,
      status: 'running',
      statusPatch: { lastError: undefined },
    })
    let res = pendingTask.result
    const requestProgress = pendingTask.requestProgress
    appendRequestPayloadLog({
      appendLog,
      nodeId: id,
      result: res,
      fallbackVendor: vendor,
      fallbackRequest: request,
    })

    if (res.status === 'queued' || res.status === 'running') {
      const taskId = typeof res.id === 'string' ? res.id.trim() : String(res.id || '').trim()
      if (!taskId) {
        throw new Error('分镜网格任务创建失败：未返回任务 ID')
      }

      setNodeStatus(id, res.status === 'queued' ? 'queued' : 'running', {
        progress: Math.max(10, requestProgress),
        imageTaskId: taskId,
        imageTaskKind: wantsImageEdit ? 'image_edit' : 'text_to_image',
        imageModel: selectedModel,
        imageModelVendor: null,
        lastResult: {
          id: taskId,
          at: Date.now(),
          kind,
          preview: { type: 'text', value: `已创建分镜网格任务（ID: ${taskId}）` },
        },
      })
      appendLog(id, `[${nowLabel()}] 已创建分镜网格任务（ID: ${taskId}），开始轮询进度…`)

      taskHubRuntime.registerTask({
        taskId,
        kind: wantsImageEdit ? 'image_edit' : 'text_to_image',
        prompt: finalPromptForModel,
        nodeId: id,
        isCanceled: () => isCanceled(id),
      })
      res = await taskHubRuntime.waitForTask(taskId)
    }

    const gridRawUrl = extractFirstImageAssetUrl(res)
    const gridUrl = gridRawUrl
      ? await ensureHostedImageUrl(gridRawUrl, {
          prompt: finalPromptForModel,
          vendor,
          modelKey: selectedModel,
          taskKind: wantsImageEdit ? 'image_edit' : 'text_to_image',
          fileName: `storyboard-grid-${id}-${Date.now()}.png`,
        })
      : null
    if (!gridUrl) {
      throw new Error('分镜网格生成失败：未返回图片结果')
    }

    const existing = Array.isArray((data as any)?.imageResults) ? (data as any).imageResults : []
    const gridItem = buildImageAssetResultItem({
      url: gridUrl,
      title: `分镜网格 ${gridLayout.rows}x${gridLayout.cols}`,
      assetId: findTaskAssetIdByUrl(res, gridUrl),
    })
    const baseIndex = existing.length

    setNodeStatus(id, 'running', {
      progress: 55,
      imageUrl: gridUrl,
      imageResults: [...existing, gridItem],
      imagePrimaryIndex: baseIndex,
      lastResult: {
        id: res?.id,
        at: Date.now(),
        kind,
        preview: { type: 'image', src: gridUrl },
      },
    })

    if (isCanceled(id)) {
      const msg = '任务已取消'
      setNodeStatus(id, 'error', { progress: 0, lastError: msg })
      appendLog(id, `[${nowLabel()}] ${msg}`)
      return
    }

    appendLog(id, `[${nowLabel()}] 网格已生成，开始切帧并上传镜头图…`)

    const shotBlobs = await splitGridToBlobs({
      url: gridUrl,
      rows: gridLayout.rows,
      cols: gridLayout.cols,
      take: storyboardCount,
    })

    const shotUrls: string[] = []
    const now = Date.now()
    for (let i = 0; i < shotBlobs.length; i++) {
      if (isCanceled(id)) {
        const msg = '任务已取消'
        setNodeStatus(id, 'error', { progress: 0, lastError: msg })
        appendLog(id, `[${nowLabel()}] ${msg}`)
        return
      }

      const blob = shotBlobs[i]!
      const file = new File([blob], `storyboard-${id}-${now}-shot-${i + 1}.png`, { type: 'image/png' })
      // eslint-disable-next-line no-await-in-loop
      const asset = await uploadServerAssetFile(file, `分镜图-镜头${i + 1}`, {
        prompt: finalPromptForModel,
        vendor,
        modelKey: selectedModel,
        taskKind: wantsImageEdit ? 'image_edit' : 'text_to_image',
      })
      const uploadedUrl = typeof (asset?.data as any)?.url === 'string' ? String((asset.data as any).url).trim() : ''
      if (!uploadedUrl) {
        throw new Error('镜头图上传失败：未返回 url')
      }
      shotUrls.push(uploadedUrl)

      const p = 55 + Math.round(((i + 1) / shotBlobs.length) * 40)
      setNodeStatus(id, 'running', { progress: Math.max(55, Math.min(95, p)) })
    }

    const shotItems = shotUrls.map((url, idx) =>
      buildImageAssetResultItem({
        url,
        title: `镜头 ${idx + 1}/${storyboardCount}`,
      }),
    )

    const merged = [...existing, gridItem, ...shotItems]
    setNodeStatus(id, 'success', {
      progress: 100,
      imageUrl: gridUrl,
      imageResults: merged,
      imagePrimaryIndex: baseIndex,
      lastResult: {
        id: res?.id,
        at: Date.now(),
        kind,
        preview: { type: 'image', src: gridUrl },
      },
    })

    let storyboardMetadataFailure = ''
    if ((kind === 'novelStoryboard' || kind === 'storyboardImage') && projectId && sourceBookId && shotItems.length > 0) {
      const taskId = authoritativeTaskId
      const groupSizeRaw = Number((data as any)?.storyboardGroupSize || storyboardCount || 25)
      const groupSize: 1 | 4 | 9 | 25 = groupSizeRaw === 25 ? 25 : groupSizeRaw === 9 ? 9 : groupSizeRaw === 4 ? 4 : 25
      const chunkIndexRaw = Number((data as any)?.storyboardChunkIndex)
      const chunkIndex = Number.isFinite(chunkIndexRaw) && chunkIndexRaw >= 0 ? Math.trunc(chunkIndexRaw) : 0
      const shotStartRaw = Number((data as any)?.storyboardShotStart)
      const shotStart = Number.isFinite(shotStartRaw) && shotStartRaw > 0 ? Math.trunc(shotStartRaw) : chunkIndex * groupSize + 1
      const shotEndRaw = Number((data as any)?.storyboardShotEnd)
      const shotEnd = Number.isFinite(shotEndRaw) && shotEndRaw >= shotStart
        ? Math.trunc(shotEndRaw)
        : shotStart + Math.max(1, shotItems.length) - 1
      const tailFrameUrl = String(shotItems[shotItems.length - 1]?.url || '').trim()
      if (taskId && tailFrameUrl && storyboardArtifact && authoritativePlanId && chapterNo > 0) {
        try {
          const persistedChunk = await upsertProjectBookStoryboardChunk(projectId, sourceBookId, {
            chunkId: `plan-${authoritativePlanId}-g${groupSize}-i${chunkIndex}`,
            planId: authoritativePlanId,
            ...(previousChunkId ? { previousChunkId } : null),
            taskId,
            chapter: chapterNo,
            groupSize,
            chunkIndex,
            shotStart,
            shotEnd,
            nodeId: id,
            storyboardStructured: storyboardArtifact,
            shotPrompts,
            frameUrls: shotItems.map((x) => String(x.url || '').trim()).filter(Boolean),
            tailFrameUrl,
          })
          setNodeStatus(id, 'success', {
            storyboardPrevTailImage: tailFrameUrl,
            storyboardChunkId: persistedChunk.chunkId,
            storyboardMetadataStatus: 'persisted',
            storyboardMetadataError: undefined,
          })
          appendLog(id, `[${nowLabel()}] 已写入章节分镜本地元数据（chunk=${chunkIndex + 1}，tail frame 已保存）`)
        } catch (metaErr: unknown) {
          const metaMsg = metaErr instanceof Error && metaErr.message ? metaErr.message : 'unknown error'
          storyboardMetadataFailure = `分镜图已生成并保留，但章节分镜元数据写入失败：${metaMsg}`
          setNodeStatus(id, 'success', {
            progress: 100,
            storyboardPrevTailImage: tailFrameUrl,
            storyboardMetadataStatus: 'failed',
            storyboardMetadataError: storyboardMetadataFailure,
          })
          toast(storyboardMetadataFailure, 'error')
          appendLog(id, `[${nowLabel()}] partial-success: ${storyboardMetadataFailure}`)
        }
      } else {
        storyboardMetadataFailure = '分镜图已生成并保留，但结构化 plan 证据或 tail frame 不完整，章节元数据未写入'
        setNodeStatus(id, 'success', {
          progress: 100,
          storyboardMetadataStatus: 'failed',
          storyboardMetadataError: storyboardMetadataFailure,
        })
        toast(storyboardMetadataFailure, 'error')
        appendLog(id, `[${nowLabel()}] partial-success: ${storyboardMetadataFailure}`)
      }
    }

    if (!isCanceled(id)) notifyAssetRefresh()
    appendLog(
      id,
      storyboardMetadataFailure
        ? `[${nowLabel()}] 分镜图部分成功：网格 1 张 + 镜头 ${shotItems.length} 张已保留；元数据未完成。`
        : `[${nowLabel()}] 分镜图完成：网格 1 张 + 镜头 ${shotItems.length} 张。`,
    )
  } catch (err: any) {
    const msg = err?.message || '分镜图生成失败'
    if (!isCanceled(id)) toast(msg, 'error')
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
  } finally {
    ctx.endRunToken(id)
  }
}

type ImageFissionMode = 'model' | 'creative' | 'detail' | 'all'
type ImageFissionConfig = {
  mode?: ImageFissionMode
  count?: 1 | 2 | 3 | 4
  aspectRatio?: '3:4' | '4:3'
  hd?: boolean
}

type ImageFissionSettings = {
  desiredGrids: number
  selectedModel: string
  vendor: string
  mode: ImageFissionMode
  resolvedAspect: '3:4' | '4:3'
  resolvedImageSize: '2K' | '4K'
  imageSizeSetting?: string
  imageResolutionSetting?: string
  imageQualitySetting?: string
}

const IMAGE_FISSION_TEMPLATES: Record<ImageFissionMode, string> = {
  model:
    'You are an efficient image variation engine. Generate a single 2x2 grid image (4 equal quadrants) containing 4 unique variations. The output MUST be a {RES} resolution image. Each quadrant should strictly follow the aspect ratio of {AR}.\nCRITICAL: Do NOT include the original reference image in the grid. Generate 4 NEW and DISTINCT variations that differ from the reference image in terms of pose, angle, or framing. MODE: Model Shot. Analyze the reference model\'s face, body, and clothing. Each quadrant shows the same character from different camera angles, in different shot sizes, and in different professional poses. Maintain exact detail fidelity but ensure all 4 poses differ from the reference.',
  creative:
    'You are an efficient image variation engine. Generate a single 2x2 grid image (4 equal quadrants) containing 4 unique variations. The output MUST be a {RES} resolution image. Each quadrant should strictly follow the aspect ratio of {AR}.\nCRITICAL: Do NOT include the original reference image in the grid. Generate 4 NEW and DISTINCT variations that differ from the reference image in terms of pose, angle, or framing. MODE: Clothing Creative. Keep the model, background, and lighting identical to the reference. Each quadrant shows different logical states of the garment (e.g. open vs closed, sleeves up vs down, different accessorizing). Fixed camera perspective. All 4 quadrants must be variations.',
  detail:
    'You are an efficient image variation engine. Generate a single 2x2 grid image (4 equal quadrants) containing 4 unique variations. The output MUST be a {RES} resolution image. Each quadrant should strictly follow the aspect ratio of {AR}.\nCRITICAL: Do NOT include the original reference image in the grid. Generate 4 NEW and DISTINCT variations that differ from the reference image in terms of pose, angle, or framing. MODE: Clothing Detail. Macro/Close-up focus. Quadrants show collar, fabric texture, prints, and stitching. Professional e-commerce detail photography.',
  all:
    'You are an efficient image variation engine. Generate a single 2x2 grid image (4 equal quadrants) containing 4 unique variations. The output MUST be a {RES} resolution image. Each quadrant should strictly follow the aspect ratio of {AR}.\nCRITICAL: Do NOT include the original reference image in the grid. Generate 4 NEW and DISTINCT variations that differ from the reference image in terms of pose, angle, or framing. MODE: Product Detail. High focus on product logos, material textures (brushed metal, wood grain), and component details. Sharp industrial product photography.',
}

function resolveImageFissionVendor(_selectedModel: string, _explicitVendor: string | null): string {
  return 'auto'
}

function resolveImageFissionSettings(ctx: RunnerContext): ImageFissionSettings {
  const { data, sampleCount } = ctx
  const cfg: ImageFissionConfig = ((data as any)?.imageFission || {}) as ImageFissionConfig
  const desiredGrids = clampInt(cfg.count ?? sampleCount, 1, 4, 1)
  const selectedModel =
    typeof data.imageModel === 'string' && data.imageModel.trim()
      ? data.imageModel.trim()
      : ''
  if (!selectedModel) {
    throw new Error('图片裂变未选择模型，请先从系统模型目录选择可用图片模型')
  }
  const mode: ImageFissionMode = (cfg.mode ?? 'creative') as ImageFissionMode
  const resolvedAspect =
    cfg.aspectRatio === '4:3' || cfg.aspectRatio === '3:4'
      ? cfg.aspectRatio
      : typeof (data as any)?.aspect === 'string' && (data as any).aspect.trim() === '4:3'
        ? '4:3'
        : '3:4'
  const resolvedImageSize: '2K' | '4K' = cfg.hd ? '4K' : '2K'
  const imageSizeSetting =
    resolvedImageSize ||
    (typeof (data as any)?.imageSize === 'string' && (data as any).imageSize.trim()
      ? (data as any).imageSize.trim()
      : undefined)
  const imageResolutionSetting =
    typeof (data as any)?.imageResolution === 'string' && (data as any).imageResolution.trim()
      ? (data as any).imageResolution.trim()
      : typeof (data as any)?.resolution === 'string' && (data as any).resolution.trim()
        ? (data as any).resolution.trim()
        : undefined
  const imageQualitySetting = readTrimmedRunnerText((data as Record<string, unknown>).imageQuality) || undefined
  return {
    desiredGrids,
    selectedModel,
    vendor: resolveImageFissionVendor(selectedModel, null),
    mode,
    resolvedAspect,
    resolvedImageSize,
    imageSizeSetting,
    imageResolutionSetting,
    imageQualitySetting,
  }
}

function collectSelfPrimaryImage(data: any): string {
  const results = Array.isArray((data as any)?.imageResults) ? (data as any).imageResults : []
  const primaryIndex =
    typeof (data as any)?.imagePrimaryIndex === 'number' &&
    (data as any).imagePrimaryIndex >= 0 &&
    (data as any).imagePrimaryIndex < results.length
      ? (data as any).imagePrimaryIndex
      : 0
  const fromResults =
    results[primaryIndex] && typeof results[primaryIndex].url === 'string'
      ? String(results[primaryIndex].url).trim()
      : ''
  const fromNode = typeof (data as any)?.imageUrl === 'string' ? String((data as any).imageUrl).trim() : ''
  return fromResults || fromNode || ''
}

async function resolveImageFissionRoleReferences(ctx: RunnerContext): Promise<RoleCardMentionResult> {
  const { data, prompt, id, appendLog } = ctx
  const empty: RoleCardMentionResult = { urls: [], matched: [], missing: [], ambiguous: [] }
  const refs = await resolveRoleCardImagesByMentions({
    bookId: String((data as any)?.sourceBookId || '').trim(),
    chapter: readRunnerChapter(data),
    prompt,
  }).catch(() => empty)
  if (refs.matched.length) {
    appendLog(id, `[${nowLabel()}] 检测到角色提及：${refs.matched.join('、')}，已自动注入角色卡参考图`)
  }
  if (refs.missing.length) {
    appendLog(id, `[${nowLabel()}] 未找到角色卡：${refs.missing.join('、')}`)
  }
  if (refs.ambiguous.length) {
    appendLog(id, `[${nowLabel()}] 角色名存在同名冲突：${refs.ambiguous.join('、')}，请使用 @角色名#roleId前缀 或 @角色名#cardId前缀`)
  }
  return refs
}

function resolveImageFissionReferences(ctx: RunnerContext, mentionUrls: string[]): string[] {
  const { state, id, data } = ctx
  const upstreamRefs = Array.from(
    new Set([
      ...collectNodeReferenceImageUrls(data, 3),
      ...collectReferenceImages(state, id),
    ]),
  ).slice(0, 3)
  const selfPrimary = collectSelfPrimaryImage(data)
  const roleCardRefImages =
    Array.isArray((data as any)?.roleCardReferenceImages)
      ? ((data as any).roleCardReferenceImages as unknown[]).map((x) => String(x || '').trim()).filter(Boolean)
      : []
  return Array.from(
    new Set(
      [...upstreamRefs, ...(selfPrimary ? [selfPrimary] : [])]
        .concat(mentionUrls)
        .concat(roleCardRefImages)
        .filter((u) => typeof u === 'string' && u.trim())
        .map((u) => u.trim()),
    ),
  ).slice(0, 3)
}

function failImageFissionTask(ctx: RunnerContext, message: string, level: 'warning' | 'error' = 'warning') {
  const { id, setNodeStatus, appendLog, isCanceled } = ctx
  setNodeStatus(id, 'error', { progress: 0, lastError: message })
  appendLog(id, `[${nowLabel()}] error: ${message}`)
  if (!isCanceled(id)) toast(message, level)
}

function ensureImageFissionInputReady(ctx: RunnerContext, referenceImages: string[]): boolean {
  if (referenceImages.length === 0) {
    failImageFissionTask(ctx, '图像裂变需要至少一张参考图：请连接一个上游图像节点，或先在本节点上传/选择一张图片。')
    return false
  }
  return true
}

function buildImageFissionPrompt(ctx: RunnerContext, settings: ImageFissionSettings): string {
  const template = IMAGE_FISSION_TEMPLATES[settings.mode] || IMAGE_FISSION_TEMPLATES.creative
  const compiled = template
    .split('{AR}')
    .join(settings.resolvedAspect)
    .split('{RES}')
    .join(settings.resolvedImageSize)
  const userHint = ctx.prompt.trim()
  const gridPrompt = userHint ? `${compiled}\n\nAdditional constraints:\n${userHint}` : compiled
  return gridPrompt
}

function buildImageFissionBaseResults(data: any): any[] {
  const existing = Array.isArray((data as any)?.imageResults) ? (data as any).imageResults : []
  if (existing.length) return existing
  if (typeof (data as any)?.imageUrl === 'string' && (data as any).imageUrl.trim()) {
    return [{ url: String((data as any).imageUrl).trim(), title: '参考图' }]
  }
  return []
}

async function runSingleFissionGrid(input: {
  ctx: RunnerContext
  settings: ImageFissionSettings
  referenceImages: string[]
  assetInputs?: unknown
  promptForModel: string
  gridIdx: number
}): Promise<{ items: { url: string; title?: string }[]; firstUrl: string; res: any }> {
  const { ctx, settings, referenceImages, assetInputs, promptForModel, gridIdx } = input
  const { id, kind, desiredGrids, selectedModel, imageSizeSetting, imageResolutionSetting, vendor } = {
    id: ctx.id,
    kind: ctx.kind,
    desiredGrids: settings.desiredGrids,
    selectedModel: settings.selectedModel,
    imageSizeSetting: settings.imageSizeSetting,
    imageResolutionSetting: settings.imageResolutionSetting,
    vendor: settings.vendor,
  }
  const progressBase = 5 + Math.floor((45 * gridIdx) / Math.max(1, desiredGrids))
  const sliceSpan = Math.max(5, Math.floor(45 / Math.max(1, desiredGrids)))
  const progressMax = Math.min(50, progressBase + sliceSpan)
  ctx.setNodeStatus(id, 'running', { progress: progressBase })
  ctx.appendLog(id, `[${nowLabel()}] 生成裂变网格（${gridIdx + 1}/${desiredGrids}）…`)

  const imageBillingSpecKey = buildImageBillingSpecKey({
    modelKey: selectedModel,
    aspectRatio: settings.resolvedAspect,
    imageSize: imageSizeSetting,
    resolution: imageResolutionSetting,
		quality: settings.imageQualitySetting,
  })
  const request: TaskRequestDto = {
    kind: 'image_edit',
    prompt: promptForModel,
    extras: {
      nodeKind: kind,
      nodeId: id,
      modelKey: selectedModel,
      aspectRatio: settings.resolvedAspect,
      ...(imageBillingSpecKey ? { specKey: imageBillingSpecKey, billingSpecKey: imageBillingSpecKey } : {}),
      ...(imageSizeSetting ? { imageSize: imageSizeSetting } : {}),
      ...(imageResolutionSetting ? { imageResolution: imageResolutionSetting, resolution: imageResolutionSetting } : {}),
      referenceImages,
      ...(Array.isArray(assetInputs) && assetInputs.length ? { assetInputs } : {}),
      persistAssets: useUIStore.getState().assetPersistenceEnabled,
    },
  }
  const pendingTask = await runTaskByVendorWithPendingProgress(ctx, {
    vendor,
    request,
    startProgress: progressBase,
    maxProgress: progressMax,
    status: 'running',
  })
  let res = pendingTask.result
  const requestProgress = pendingTask.requestProgress
  ctx.appendLog(id, `[${nowLabel()}] 请求已发送，记录任务请求体…`)
  appendRequestPayloadLog({
    appendLog: ctx.appendLog,
    nodeId: id,
    result: res,
    fallbackVendor: vendor,
    fallbackRequest: request,
  })

  if (res.status === 'queued' || res.status === 'running') {
    const taskId = typeof res.id === 'string' ? res.id.trim() : String(res.id || '').trim()
    if (!taskId) throw new Error('裂变任务创建失败：未返回任务 ID')
    ctx.appendLog(id, `[${nowLabel()}] 已创建裂变任务（ID: ${taskId}），开始轮询进度…`)
    taskHubRuntime.registerTask({
      taskId,
      kind: 'image_edit',
      prompt: promptForModel,
      nodeId: id,
      isCanceled: () => ctx.isCanceled(id),
    })
    res = await taskHubRuntime.waitForTask(taskId)
  }

  const gridRawUrl = extractFirstImageAssetUrl(res)
  const gridUrl = gridRawUrl
    ? await ensureHostedImageUrl(gridRawUrl, {
        prompt: promptForModel,
        vendor,
        modelKey: selectedModel,
        taskKind: 'image_edit',
        fileName: `fission-grid-${id}-${Date.now()}-${gridIdx + 1}.png`,
      })
    : null
  if (!gridUrl) throw new Error('裂变失败：未返回网格图')

  const quadrants = await splitGridToBlobs({ url: gridUrl, rows: 2, cols: 2, take: 4 })
  const items: { url: string; title?: string }[] = []
  const now = Date.now()
  for (let i = 0; i < quadrants.length; i++) {
    if (ctx.isCanceled(id)) throw new Error('任务已取消')
    const blob = quadrants[i]!
    const file = new File([blob], `fission-${id}-${now}-${gridIdx + 1}-${i + 1}.png`, { type: 'image/png' })
    // eslint-disable-next-line no-await-in-loop
    const asset = await uploadServerAssetFile(file, `裂变-${gridIdx + 1}-${i + 1}`, {
      prompt: promptForModel,
      vendor,
      modelKey: selectedModel,
      taskKind: 'image_edit',
    })
    const uploadedUrl = typeof (asset?.data as any)?.url === 'string' ? String((asset.data as any).url).trim() : ''
    if (!uploadedUrl) throw new Error('裂变上传失败：未返回 url')
    items.push({ url: uploadedUrl, title: `裂变 ${gridIdx + 1}-${i + 1}` })
    const doneParts = gridIdx * 4 + (i + 1)
    const totalParts = desiredGrids * 4
    const p = 50 + Math.round((doneParts / Math.max(1, totalParts)) * 45)
    ctx.setNodeStatus(id, 'running', { progress: Math.max(50, Math.min(95, p)) })
  }
  return { items, firstUrl: String(items[0]?.url || '').trim(), res }
}

async function runImageFissionTask(ctx: RunnerContext) {
  const { id, kind, setNodeStatus, appendLog, isCanceled, data } = ctx
  try {
    const settings = resolveImageFissionSettings(ctx)
    const mentionRoleRefs = await resolveImageFissionRoleReferences(ctx)
    const referenceImages = resolveImageFissionReferences(ctx, mentionRoleRefs.urls)
    if (!ensureImageFissionInputReady(ctx, referenceImages)) return
    const runtimeReferenceAssetInputs = mergeReferenceAssetInputs({
      assetInputs: (data as Record<string, unknown>)?.assetInputs,
      dynamicEntries: collectDynamicUpstreamReferenceEntries(ctx.state, id),
      referenceImages,
      limit: 8,
    })

    const promptForModel = appendReferenceAliasSlotPrompt({
      prompt: buildImageFissionPrompt(ctx, settings),
      assetInputs: runtimeReferenceAssetInputs,
      referenceImages,
      enabled: referenceImages.length > 0,
    })
    const baseResults = buildImageFissionBaseResults(data)
    setNodeStatus(id, 'running', { progress: 5, lastError: undefined })
    appendLog(
      id,
      `[${nowLabel()}] 图像裂变：${settings.mode} / ${settings.resolvedAspect} / ${settings.resolvedImageSize}，生成 2x2 变体网格 x${settings.desiredGrids}…`,
    )

    const newItems: { url: string; title?: string }[] = []
    let primaryUrl = ''
    let lastRes: any = null
    for (let gridIdx = 0; gridIdx < settings.desiredGrids; gridIdx++) {
      if (isCanceled(id)) throw new Error('任务已取消')
      // eslint-disable-next-line no-await-in-loop
      const one = await runSingleFissionGrid({
        ctx,
        settings,
        referenceImages,
        assetInputs: runtimeReferenceAssetInputs,
        promptForModel,
        gridIdx,
      })
      if (!primaryUrl) primaryUrl = one.firstUrl
      newItems.push(...one.items)
      lastRes = one.res
    }

    if (!primaryUrl || newItems.length === 0) throw new Error('裂变失败：未产出候选图')
    setNodeStatus(id, 'success', {
      progress: 100,
      imageUrl: primaryUrl,
      imageResults: [...newItems, ...baseResults],
      imagePrimaryIndex: 0,
      lastResult: {
        id: lastRes?.id,
        at: Date.now(),
        kind,
        preview: { type: 'image', src: primaryUrl },
      },
    })
    if (!isCanceled(id)) notifyAssetRefresh()
    appendLog(id, `[${nowLabel()}] 图像裂变完成：生成候选 ${newItems.length} 张。`)
  } catch (err: any) {
    const msg = err?.message || '图像裂变失败'
    if (!isCanceled(id)) toast(msg, 'error')
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
  } finally {
    ctx.endRunToken(id)
  }
}

async function runStoryboardEditorTask(ctx: RunnerContext) {
  const { id, data, kind, setNodeStatus, appendLog, isCanceled, state } = ctx

  try {
    const patch = buildStoryboardEditorPatch({
      cells: (data as Record<string, unknown>)?.storyboardEditorCells,
      grid: (data as Record<string, unknown>)?.storyboardEditorGrid,
      aspect: (data as Record<string, unknown>)?.storyboardEditorAspect,
      editMode: (data as Record<string, unknown>)?.storyboardEditorEditMode,
      collapsed: (data as Record<string, unknown>)?.storyboardEditorCollapsed,
    })
    const executableCells = patch.storyboardEditorCells
      .map((cell, index) => ({
        ...cell,
        executionPrompt: typeof cell.prompt === 'string' ? cell.prompt.trim() : '',
        executionLabel:
          (typeof cell.label === 'string' && cell.label.trim()) ||
          `镜头 ${typeof cell.shotNo === 'number' && cell.shotNo > 0 ? cell.shotNo : index + 1}`,
        executionShotNo:
          typeof cell.shotNo === 'number' && cell.shotNo > 0
            ? cell.shotNo
            : index + 1,
        cellIndex: index,
      }))
      .filter((cell) => cell.executionPrompt)

    if (executableCells.length === 0) {
      const msg = '分镜编辑缺少可执行 prompt：请先为至少一个格子填写镜头提示词'
      setNodeStatus(id, 'error', { progress: 0, lastError: msg })
      appendLog(id, `[${nowLabel()}] error: ${msg}`)
      if (!isCanceled(id)) toast(msg, 'warning')
      return
    }

    const promptForMentionLookup = executableCells.map((cell) => cell.executionPrompt).join('\n')
    const mentionRoleRefs = await resolveRoleCardImagesByMentions({
      bookId: String((data as Record<string, unknown>)?.sourceBookId || '').trim(),
      chapter: readRunnerChapter(data),
      prompt: promptForMentionLookup,
    }).catch(() => ({ urls: [] as string[], matched: [] as string[], missing: [] as string[], ambiguous: [] as string[] }))

    if (mentionRoleRefs.matched.length) {
      appendLog(id, `[${nowLabel()}] 检测到角色提及：${mentionRoleRefs.matched.join('、')}，已自动注入角色卡参考图`)
    }
    if (mentionRoleRefs.missing.length) {
      appendLog(id, `[${nowLabel()}] 未找到角色卡：${mentionRoleRefs.missing.join('、')}`)
    }
    if (mentionRoleRefs.ambiguous.length) {
      appendLog(
        id,
        `[${nowLabel()}] 角色名存在同名冲突：${mentionRoleRefs.ambiguous.join('、')}，请使用 @角色名#roleId前缀 或 @角色名#cardId前缀`,
      )
    }

    const roleCardReferenceImages = Array.isArray((data as Record<string, unknown>)?.roleCardReferenceImages)
      ? ((data as Record<string, unknown>).roleCardReferenceImages as unknown[])
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      : []
    let referenceImages = Array.from(
      new Set(
        [
          ...collectNodeReferenceImageUrls(data, 3),
          ...collectReferenceImages(state, id),
          ...mentionRoleRefs.urls,
          ...roleCardReferenceImages,
        ]
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    ).slice(0, 3)
    const effectiveTaskKind: TaskKind = referenceImages.length > 0 ? 'image_edit' : 'text_to_image'
    const storedImageModel =
      typeof (data as Record<string, unknown>)?.imageModel === 'string' && String((data as Record<string, unknown>).imageModel).trim()
        ? String((data as Record<string, unknown>).imageModel).trim()
        : ''
    const selectedModel =
      (typeof ctx.modelKey === 'string' && ctx.modelKey.trim()) ||
      storedImageModel
    if (!selectedModel) {
      throw new Error('图片节点未配置模型：请先从系统模型目录中选择一个可用图片模型。')
    }
    const vendor = resolveImageTaskVendor(
      selectedModel,
      typeof (data as Record<string, unknown>)?.imageModelVendor === 'string'
        ? String((data as Record<string, unknown>).imageModelVendor)
        : null,
    )
    let referenceSheet: UploadedReferenceSheet | null = null
    const runtimeReferenceAssetInputs = mergeReferenceAssetInputs({
      assetInputs: (data as Record<string, unknown>)?.assetInputs,
      dynamicEntries: collectDynamicUpstreamReferenceEntries(state, id),
      referenceImages,
      limit: 8,
    })
    if (shouldAutoMergeReferenceSheet() && referenceImages.length > 2) {
      try {
        const mergedReferenceSheet = await uploadMergedReferenceSheet({
          id,
          entries: buildNamedReferenceEntries({
            assetInputs: runtimeReferenceAssetInputs,
            referenceImages,
            fallbackPrefix: 'ref',
            limit: 8,
          }),
          prompt: promptForMentionLookup,
          vendor,
          modelKey: selectedModel,
          taskKind: 'image_edit',
        })
        if (mergedReferenceSheet) {
          referenceSheet = mergedReferenceSheet
          referenceImages = [mergedReferenceSheet.url]
          appendLog(id, `[${nowLabel()}] 分镜参考图超过 2 张，已自动合成带 id 标记的拼图参考板`)
        }
      } catch (err) {
        console.warn('[remoteRunner] merge storyboard references failed', err)
      }
    }
    const imageSizeSetting =
      typeof (data as Record<string, unknown>)?.imageSize === 'string' && String((data as Record<string, unknown>).imageSize).trim()
        ? String((data as Record<string, unknown>).imageSize).trim()
        : undefined
    const imageResolutionSetting =
      typeof (data as Record<string, unknown>)?.imageResolution === 'string' && String((data as Record<string, unknown>).imageResolution).trim()
        ? String((data as Record<string, unknown>).imageResolution).trim()
        : typeof (data as Record<string, unknown>)?.resolution === 'string' && String((data as Record<string, unknown>).resolution).trim()
          ? String((data as Record<string, unknown>).resolution).trim()
          : undefined
    const persistAssets = useUIStore.getState().assetPersistenceEnabled

    let nextCells = patch.storyboardEditorCells.slice()
    const existingResults = Array.isArray((data as Record<string, unknown>)?.imageResults)
      ? (((data as Record<string, unknown>).imageResults as unknown[]).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'))
      : []
    const newShotItems: Array<Record<string, unknown>> = []
    let firstGeneratedUrl = ''

    setNodeStatus(id, 'running', {
      progress: 5,
      lastError: undefined,
    })
    appendLog(
      id,
      `[${nowLabel()}] 开始执行分镜编辑：${executableCells.length} 格${referenceImages.length ? `，参考图 ${referenceImages.length} 张` : ''}`,
    )

    for (let index = 0; index < executableCells.length; index += 1) {
      const cell = executableCells[index]
      if (isCanceled(id)) throw new Error('任务已取消')

      const progressStart = 5 + Math.round((index / executableCells.length) * 80)
      const progressEnd = 5 + Math.round(((index + 1) / executableCells.length) * 80)
      const cellAspect = resolveStoryboardEditorCellAspect(cell, patch.storyboardEditorAspect)
      const effectiveCellPromptForModel = appendReferenceAliasSlotPrompt({
        prompt: cell.executionPrompt,
        assetInputs: runtimeReferenceAssetInputs,
        referenceImages,
        enabled: referenceImages.length > 0 && !referenceSheet,
      })

      setNodeStatus(id, 'running', {
        progress: progressStart,
      })
      appendLog(
        id,
        `[${nowLabel()}] 生成 ${cell.executionLabel}（${index + 1}/${executableCells.length}，${cellAspect}）…`,
      )

      const imageBillingSpecKey = buildImageBillingSpecKey({
        modelKey: selectedModel,
        aspectRatio: cellAspect,
        imageSize: imageSizeSetting,
        resolution: imageResolutionSetting,
		quality: readTrimmedRunnerText((data as Record<string, unknown>)?.imageQuality),
      })
      const request: TaskRequestDto = {
        kind: effectiveTaskKind,
        prompt: effectiveCellPromptForModel,
        extras: {
          nodeKind: kind,
          nodeId: id,
          modelKey: selectedModel,
          aspectRatio: cellAspect,
          ...(imageBillingSpecKey ? { specKey: imageBillingSpecKey, billingSpecKey: imageBillingSpecKey } : {}),
          ...(imageSizeSetting ? { imageSize: imageSizeSetting } : {}),
          ...(imageResolutionSetting ? { imageResolution: imageResolutionSetting, resolution: imageResolutionSetting } : {}),
          ...(referenceImages.length ? { referenceImages } : {}),
          ...(runtimeReferenceAssetInputs.length ? { assetInputs: runtimeReferenceAssetInputs } : {}),
          ...(referenceSheet ? { referenceSheet: buildReferenceSheetLogMeta(referenceSheet) } : {}),
          persistAssets,
        },
      }
      const pendingTask = await runTaskByVendorWithPendingProgress(ctx, {
        vendor,
        request,
        startProgress: progressStart,
        maxProgress: Math.max(progressStart + 1, progressEnd - 3),
        status: 'running',
      })
      let res = pendingTask.result
      const requestProgress = pendingTask.requestProgress
      appendRequestPayloadLog({
        appendLog,
        nodeId: id,
        result: res,
        fallbackVendor: vendor,
        fallbackRequest: request,
      })

      if (res.status === 'queued' || res.status === 'running') {
        const taskId = typeof res.id === 'string' ? res.id.trim() : String(res.id || '').trim()
        if (!taskId) {
          throw new Error(`${cell.executionLabel} 任务创建失败：未返回任务 ID`)
        }

        setNodeStatus(id, res.status === 'queued' ? 'queued' : 'running', {
          progress: Math.max(progressStart, requestProgress),
          imageTaskId: taskId,
          imageTaskKind: effectiveTaskKind,
          imageModel: selectedModel,
          imageModelVendor: null,
        })
        appendLog(id, `[${nowLabel()}] 已创建 ${cell.executionLabel} 任务（ID: ${taskId}），开始轮询进度…`)

        taskHubRuntime.registerTask({
          taskId,
          kind: effectiveTaskKind,
          prompt: effectiveCellPromptForModel,
          nodeId: id,
          isCanceled: () => isCanceled(id),
        })
        res = await taskHubRuntime.waitForTask(taskId)
      }

      const rawImageUrl = extractFirstImageAssetUrl(res)
      const hostedUrl = rawImageUrl
        ? await ensureHostedImageUrl(rawImageUrl, {
            prompt: effectiveCellPromptForModel,
            vendor,
            modelKey: selectedModel,
            taskKind: effectiveTaskKind,
            fileName: `storyboard-editor-${id}-${Date.now()}-${cell.executionShotNo}.png`,
          })
        : null
      if (!hostedUrl) {
        throw new Error(`${cell.executionLabel} 生成失败：未返回图片结果`)
      }

      if (!firstGeneratedUrl) firstGeneratedUrl = hostedUrl
      nextCells = nextCells.map((item, itemIndex) => (
        itemIndex === cell.cellIndex
          ? {
              ...item,
              imageUrl: hostedUrl,
              label: cell.executionLabel,
              prompt: cell.executionPrompt,
              shotNo: cell.executionShotNo,
            }
          : item
      ))
      const nextShotItems = [
        ...newShotItems,
        buildImageAssetResultItem({
          url: hostedUrl,
          title: cell.executionLabel,
        }),
      ]
      setNodeStatus(id, 'running', {
        progress: progressEnd,
        storyboardEditorCells: nextCells,
        imageUrl: firstGeneratedUrl,
        imageResults: [...existingResults, ...nextShotItems],
        imagePrimaryIndex: existingResults.length,
        lastResult: {
          id: res?.id,
          at: Date.now(),
          kind,
          preview: { type: 'image', src: hostedUrl },
        },
      })
      appendLog(id, `[${nowLabel()}] 已完成 ${cell.executionLabel}`)
      newShotItems.push(
        buildImageAssetResultItem({
          url: hostedUrl,
          title: cell.executionLabel,
        }),
      )
    }

    setNodeStatus(id, 'success', {
      progress: 100,
      storyboardEditorCells: nextCells,
      imageUrl: firstGeneratedUrl || null,
      imageResults: [...existingResults, ...newShotItems],
      imagePrimaryIndex: existingResults.length,
      imageModel: selectedModel,
      imageModelVendor: null,
      lastResult: firstGeneratedUrl
        ? {
            id: `${id}-storyboard-editor`,
            at: Date.now(),
            kind,
            preview: { type: 'image', src: firstGeneratedUrl },
          }
        : undefined,
    })
    if (newShotItems.length && !isCanceled(id)) notifyAssetRefresh()
    appendLog(id, `[${nowLabel()}] 分镜编辑执行完成：新增 ${newShotItems.length} 张镜头图。`)
  } catch (err: unknown) {
    const msg = err instanceof Error && err.message ? err.message : '分镜编辑执行失败'
    if (!isCanceled(id)) toast(msg, 'error')
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
  } finally {
    ctx.endRunToken(id)
  }
}

async function runGenericTask(ctx: RunnerContext) {
  const {
    id,
    data,
    taskKind,
    sampleCount,
    setNodeStatus,
    appendLog,
    isCanceled,
    isImageTask,
    kind,
    prompt,
    state,
  } = ctx

  let imageOperationSpec: ImageOperationSpec | null = null
  try {
    const nodeRecord = data as Record<string, unknown>
    if (nodeRecord.imageOperationSpec != null) {
      imageOperationSpec = parseImageOperationSpec(nodeRecord.imageOperationSpec)
      setNodeStatus(id, 'running', {
        imageOperationState: {
          ...createImageOperationState(imageOperationSpec, 'running'),
          attempt: Math.max(1, Number((nodeRecord.imageOperationState as Record<string, unknown> | undefined)?.attempt ?? 0) + 1),
          progress: 5,
          startedAt: new Date().toISOString(),
        },
      })
      appendLog(id, `[${nowLabel()}] 图片操作合同：${imageOperationSpec.kind} · ${imageOperationSpec.operationId}`)
    }
    const isPortraitTextureOperation = imageOperationSpec?.kind === 'portrait_adjust'
      || nodeRecord.libTvImageOperationKey === 'portrait-adjust'
    if (isPortraitTextureOperation && nodeRecord.portraitTextureSelectionStatus !== 'confirmed') {
      throw new Error('人像质感调节尚未选择人物，请返回原图完成人物识别或手动框选')
    }
    if (
      isPortraitTextureOperation
      && (typeof nodeRecord.maskUrl !== 'string' || !nodeRecord.maskUrl.trim())
    ) {
      throw new Error('人像质感调节缺少已上传的真实区域蒙版')
    }
    const storedImageModel =
      typeof data.imageModel === 'string' && data.imageModel.trim()
        ? data.imageModel.trim()
        : ''
    const storedTextModel =
      typeof data.geminiModel === 'string' && data.geminiModel.trim()
        ? data.geminiModel.trim()
        : typeof data.model === 'string' && data.model.trim()
          ? data.model.trim()
          : ''
    const focusGuideUrl =
      typeof (data as any)?.poseMaskUrl === 'string' && (data as any)?.poseMaskUrl.trim()
        ? (data as any).poseMaskUrl.trim()
        : null
    const visibleCompositeOnlyReference =
      kind === 'imageEdit' &&
      typeof (data as Record<string, unknown>)?.referenceImageStrategy === 'string' &&
      String((data as Record<string, unknown>).referenceImageStrategy).trim() === 'visible_composite_only'
    const upstreamReferenceImages = visibleCompositeOnlyReference ? [] : collectReferenceImages(state, id)
    const mentionRoleRefs = isImageTask
      ? await resolveRoleCardImagesByMentions({
          bookId: String((data as any)?.sourceBookId || '').trim(),
          chapter: readRunnerChapter(data),
          prompt,
        }).catch(() => ({ urls: [] as string[], matched: [] as string[], missing: [] as string[], ambiguous: [] as string[] }))
      : { urls: [] as string[], matched: [] as string[], missing: [] as string[], ambiguous: [] as string[] }
    const mentionAssetRefs = isImageTask
      ? await resolveAssetImagesByMentions({
          prompt,
          nodes: Array.isArray((state as { nodes?: unknown }).nodes)
            ? ((state as { nodes?: unknown }).nodes as Node[])
            : [],
        }).catch(() => createEmptyPromptAssetMentionResult())
      : createEmptyPromptAssetMentionResult()
    if (isImageTask && mentionRoleRefs.matched.length) {
      appendLog(id, `[${nowLabel()}] 检测到角色提及：${mentionRoleRefs.matched.join('、')}，已自动注入角色卡参考图`)
    }
    if (isImageTask && mentionRoleRefs.missing.length) {
      appendLog(id, `[${nowLabel()}] 未找到角色卡：${mentionRoleRefs.missing.join('、')}`)
    }
    if (isImageTask && mentionRoleRefs.ambiguous.length) {
      appendLog(
        id,
        `[${nowLabel()}] 角色名存在同名冲突：${mentionRoleRefs.ambiguous.join('、')}，请使用 @角色名#roleId前缀 或 @角色名#cardId前缀`,
      )
    }
    if (isImageTask && mentionAssetRefs.matched.length) {
      appendLog(id, `[${nowLabel()}] 检测到资产引用：${mentionAssetRefs.matched.join('、')}，已自动注入参考资产`)
    }
    if (isImageTask && mentionAssetRefs.missing.length) {
      appendLog(id, `[${nowLabel()}] 未找到资产引用：${mentionAssetRefs.missing.join('、')}`)
    }
    if (isImageTask && mentionAssetRefs.ambiguous.length) {
      appendLog(id, `[${nowLabel()}] 资产引用存在同名冲突：${mentionAssetRefs.ambiguous.join('、')}，请保证引用ID唯一`)
    }
    const roleCardRefImages = isImageTask
      ? (
          Array.isArray((data as any)?.roleCardReferenceImages)
            ? ((data as any).roleCardReferenceImages as unknown[])
                .map((x) => String(x || '').trim())
                .filter(Boolean)
            : []
        )
      : []
    const sourceBookId = String((data as any)?.sourceBookId || '').trim()
    const sourceTag = String((data as any)?.source || '').trim()
    const nodeLabel = String((data as any)?.label || '').trim()
    const semanticRoleBinding = resolveSemanticNodeRoleBinding(data)
    const roleNameHint = String(semanticRoleBinding.roleName || '').trim()
    const roleCardIdHint = String(semanticRoleBinding.roleCardId || '').trim()
    const isRoleCardTask =
      isImageTask &&
      (
        !!roleNameHint ||
        !!roleCardIdHint ||
        /角色卡|角色设定|主角角色卡/i.test(nodeLabel) ||
        sourceTag === 'novel_character_meta' ||
        sourceTag === 'main_role_card_confirmation' ||
        sourceTag === 'novel_upload_autoflow'
      )
    const selfPoseRefs = isImageTask
      ? (
          Array.isArray((data as any)?.poseReferenceImages)
            ? ((data as any).poseReferenceImages as unknown[])
                .map((x) => String(x || '').trim())
                .filter(Boolean)
            : []
        )
      : []
    const selfStickmanRef =
      isImageTask && typeof (data as any)?.poseStickmanUrl === 'string' && (data as any).poseStickmanUrl.trim()
        ? String((data as any).poseStickmanUrl).trim()
        : ''
    const referenceImagesRaw = isImageTask
      ? (
        isRoleCardTask
          ? [
              ...roleCardRefImages,
              ...mentionRoleRefs.urls,
              ...selfPoseRefs,
              ...(selfStickmanRef ? [selfStickmanRef] : []),
              ...collectNodeReferenceImageUrls(data, 8),
              ...upstreamReferenceImages,
              ...mentionAssetRefs.urls,
            ]
          : [
              ...selfPoseRefs,
              ...(selfStickmanRef ? [selfStickmanRef] : []),
              ...collectNodeReferenceImageUrls(data, 3),
              ...upstreamReferenceImages,
              ...mentionAssetRefs.urls,
              ...mentionRoleRefs.urls,
              ...roleCardRefImages,
            ]
      )
      : []
    const selfOwnedImageUrls = new Set<string>(
      [
        ...(Array.isArray((data as any)?.imageResults)
          ? ((data as any).imageResults as any[]).map((r: any) => String(r?.url || '').trim()).filter(Boolean)
          : []),
        typeof (data as any)?.imageUrl === 'string' ? String((data as any).imageUrl).trim() : '',
      ].filter(Boolean),
    )
    const deduped = Array.from(
      new Set(
        referenceImagesRaw.filter(
          (u) => typeof u === 'string' && u.trim() && !selfOwnedImageUrls.has(u.trim()),
        ),
      ),
    )
    if (
      isImageTask &&
      deduped.length === 0 &&
      (sourceTag === 'storyboard_shot_split' || sourceTag === 'novel_storyboard_group' || sourceTag === 'storyboard_shot_node')
    ) {
      const fallbackRefs = await resolveFallbackRoleCardImages({
        bookId: sourceBookId || undefined,
        chapter: readRunnerChapter(data),
        limit: 3,
      })
      if (fallbackRefs.urls.length) {
        deduped.push(...fallbackRefs.urls)
        appendLog(id, `[${nowLabel()}] 节点缺少显式参考图，已自动回填角色卡参考：${fallbackRefs.names.join('、')}`)
      }
    }
    const prioritized: string[] = []
    const hardLimit = isRoleCardTask ? 8 : 3
    const baseReferenceLimit = focusGuideUrl ? Math.max(1, hardLimit - 1) : hardLimit
    deduped.forEach((url) => {
      if (prioritized.length >= baseReferenceLimit) return
      if (url === focusGuideUrl) return
      prioritized.push(url)
    })
    let referenceImages = focusGuideUrl
      ? [...prioritized.slice(0, Math.max(0, hardLimit - 1)), focusGuideUrl]
      : prioritized.slice(0, hardLimit)
    // 全局画风参考（项目「风格」槽 styleImages）：空项目里随手「文生图」也跟随锁定的全局参考画风。
    // 只对普通文生图注入，角色卡/故事板分镜/局部编辑/自带 style 资产的节点跳过（见 isEligibleForGlobalStyleReference）。
    // 与视频路径的全局风格注入语义一致：画风锚定图固定放最后一张、去重、限 hardLimit，
    // 并显式打 role=style 进 assetInputs，供 appendReferenceAliasSlotPrompt 确定性标注图像角色（禁猜）。
    const globalStyleEligible = isEligibleForGlobalStyleReference({
      isImageTask,
      isRoleCardTask,
      sourceTag,
      visibleCompositeOnlyReference,
      hasFocusGuide: !!focusGuideUrl,
      hasExplicitStyleAssetInput:
        Array.isArray((data as Record<string, unknown>)?.assetInputs)
        && ((data as Record<string, unknown>).assetInputs as unknown[]).some(
          (e) => e && typeof e === 'object' && (e as Record<string, unknown>).role === 'style',
        ),
    })
    const mentionStyleAssetInputs = mentionAssetRefs.assetInputs.filter((input) => input.role === 'style')
    const mentionStyleUrls = mentionStyleAssetInputs.map((input) => input.url)
    let injectedStyleAssetInputs: Array<{ url: string; role: string; name: string; assetRefId: string }> = []
    if (globalStyleEligible || mentionStyleUrls.length > 0) {
      // 单轨：画风锚定的唯一真相源 = 项目「风格」槽（styleImages，节点风格 chip 可见、可手动移除）。
      // 不再读 uiStore.activeStyleBible，chip 移除后此处即不再注入——所见即所得。
      const pidForStyle = String((useUIStore.getState() as any)?.currentProject?.id || '').trim()
      const merged = mergeGlobalStyleReferenceImages({
        referenceImages,
        globalStyleRefs: [
          ...mentionStyleUrls,
          ...(globalStyleEligible && pidForStyle ? getRuntimeProjectImageSettings(pidForStyle).styleImages : []),
        ],
        selfOwnedImageUrls,
        hardLimit,
      })
      if (merged.injectedCount > 0) {
        referenceImages = merged.referenceImages
        injectedStyleAssetInputs = merged.styleUrls
          .filter((url) => !mentionStyleUrls.includes(url))
          .map((url, idx) => ({
            url,
            role: 'style',
            name: globalStyleEligible
              ? merged.styleUrls.length > 1 ? `全局画风锚定${idx + 1}` : '全局画风锚定'
              : `提示词风格参考${idx + 1}`,
            assetRefId: `style-ref-${idx + 1}`,
          }))
        if (mentionStyleUrls.length > 0) {
          appendLog(
            id,
            `[${nowLabel()}] 已保留提示词中的显式风格引用 x${mentionStyleUrls.length}（固定为参考图末尾）${
              globalStyleEligible ? '，并合并项目全局风格' : ''
            }`,
          )
        } else {
          appendLog(id, `[${nowLabel()}] 已注入全局画风参考 x${merged.injectedCount}（来自素材库风格参考，固定为最后 ${merged.injectedCount} 张）`)
        }
      }
    }
    // 全局锁定风格的「文字指令」（自定义文字风格 / 预设带文字）追加到图片 prompt，复用同款合格判断。
    const lockedStylePromptText = (() => {
      if (!isImageTask) return ''
      const pid = String((useUIStore.getState() as any)?.currentProject?.id || '').trim()
      if (!pid) return ''
      return getRuntimeProjectImageSettings(pid).lockedStyle?.stylePrompt || ''
    })()
    const executionBasePrompt = isPortraitTextureOperation
      ? buildPortraitTextureExecutionPrompt({
          strength: nodeRecord.portraitTextureStrength,
          supplementalPrompt: prompt,
        })
      : prompt
    const promptWithGlobalStyle = mergeGlobalStylePrompt({
      basePrompt: executionBasePrompt,
      stylePrompt: lockedStylePromptText,
      eligible: globalStyleEligible,
    })
    if (promptWithGlobalStyle !== prompt) {
      appendLog(id, `[${nowLabel()}] 已注入全局风格文字指令（来自锁定风格）`)
    }
    const dynamicReferenceEntries = visibleCompositeOnlyReference ? [] : collectDynamicUpstreamReferenceEntries(state, id)
    const explicitAssetInputs = Array.isArray((data as Record<string, unknown>)?.assetInputs)
      ? ((data as Record<string, unknown>).assetInputs as unknown[])
      : []
    let runtimeReferenceAssetInputs = mergeReferenceAssetInputs({
      assetInputs: [...mentionAssetRefs.assetInputs, ...explicitAssetInputs, ...injectedStyleAssetInputs],
      dynamicEntries: dynamicReferenceEntries,
      referenceImages,
      limit: 8,
    })
    if (isRoleCardTask && referenceImages.length) {
      appendLog(id, `[${nowLabel()}] 角色卡任务已启用风格锚定：注入参考图 x${referenceImages.length}`)
    }
    if (isImageTask && focusGuideUrl && referenceImages.length) {
      appendLog(id, `[${nowLabel()}] 已注入局部编辑区域引导图，模型仅允许修改高亮区域`)
    }
    const wantsImageEdit = isImageTask && referenceImages.length > 0
    // 抠图节点用 data.forceTaskKind 强制走像素级分割任务（image_remove_bg），
    // 绕过 Gemini 的生成式图像编辑；仅在图像任务上、且显式标记时生效。
    const forcedImageTaskKind: TaskKind | null =
      isImageTask && (data as any)?.forceTaskKind === 'image_remove_bg'
        ? 'image_remove_bg'
        : null
    const effectiveTaskKind: TaskKind =
      forcedImageTaskKind ?? (wantsImageEdit ? 'image_edit' : taskKind)
    if (isImageTask && !storedImageModel) {
      throw new Error('图片节点未配置模型：请先从系统模型目录中选择一个可用图片模型。')
    }
    if (!isImageTask && !storedTextModel) {
      throw new Error('节点未配置文本模型：请先从系统模型目录中选择一个可用文本模型。')
    }
    const selectedModel = isImageTask ? storedImageModel : storedTextModel
    const modelLower = selectedModel.toLowerCase()

    const explicitVendor = isImageTask
      ? null
      : ((data as any)?.modelVendor as string | undefined)
    const vendor = isImageTask
      ? 'auto'
      : explicitVendor || (
          isAnthropicModel(selectedModel) ||
          modelLower.includes('claude') ||
          modelLower.includes('glm')
            ? 'anthropic'
            : modelLower.includes('gpt') ||
                modelLower.includes('openai') ||
                modelLower.includes('o3-') ||
                modelLower.includes('codex')
              ? 'openai'
              : 'gemini'
        )
    let referenceSheet: UploadedReferenceSheet | null = null
    if (shouldAutoMergeReferenceSheet() && isImageTask && referenceImages.length > 2) {
      try {
        const mergedReferenceSheet = await uploadMergedReferenceSheet({
          id,
          entries: buildNamedReferenceEntries({
            assetInputs: runtimeReferenceAssetInputs,
            referenceImages,
            fallbackPrefix: 'ref',
            limit: 8,
          }),
          prompt,
          vendor,
          modelKey: selectedModel,
          taskKind: 'image_edit',
        })
        if (mergedReferenceSheet) {
          referenceSheet = mergedReferenceSheet
          referenceImages = [mergedReferenceSheet.url]
          runtimeReferenceAssetInputs = mergeReferenceAssetInputs({
            assetInputs: runtimeReferenceAssetInputs,
            dynamicEntries: dynamicReferenceEntries,
            referenceImages,
            limit: 8,
          })
          appendLog(id, `[${nowLabel()}] 参考资产超过 2 张，已自动合成带 id 标记的拼图参考板`)
        }
      } catch (err) {
        console.warn('[remoteRunner] merge image references failed', err)
      }
    }
    const rawAspectRatio =
      typeof (data as any)?.aspect === 'string' && (data as any)?.aspect.trim()
        ? (data as any).aspect.trim()
        : ''
    const aspectRatio =
      rawAspectRatio && rawAspectRatio.toLowerCase() !== 'auto'
        ? rawAspectRatio
        : '16:9'
    const imageSizeSetting =
      typeof (data as any)?.imageSize === 'string' && (data as any)?.imageSize.trim()
        ? (data as any).imageSize.trim()
        : undefined
    const imageResolutionSetting =
      typeof (data as any)?.imageResolution === 'string' && (data as any)?.imageResolution.trim()
        ? (data as any).imageResolution.trim()
        : typeof (data as any)?.resolution === 'string' && (data as any)?.resolution.trim()
          ? (data as any).resolution.trim()
          : undefined
    const imageQualitySetting =
      typeof (data as Record<string, unknown>)?.imageQuality === 'string' && String((data as Record<string, unknown>).imageQuality).trim()
        ? String((data as Record<string, unknown>).imageQuality).trim()
        : undefined
    const imageEditSizeSetting =
      effectiveTaskKind === 'image_edit' && typeof (data as any)?.imageEditSize === 'string' && (data as any).imageEditSize.trim()
        ? (data as any).imageEditSize.trim()
        : undefined
    const imageEditDimensions = imageEditSizeSetting
      ? parseImageEditSizeDimensions(imageEditSizeSetting)
      : null

    const allImageAssets: AssetResultItem[] = []
    const allTexts: string[] = []
    let lastRes: any = null

    const promptForModel = promptWithGlobalStyle
    const characterBibleHint = isImageTask ? buildCharacterBiblePromptHint(data) : ''
    const roleCardStyleLockHint =
      isRoleCardTask
        ? '角色卡强约束：必须严格沿用 referenceImages 的画风锚点（线条/材质/光影/色温），保持角色外观一致；不得擅自切换风格。'
        : ''
    const isNewAssetGeneration =
      isImageTask &&
      wantsImageEdit &&
      (data as any)?.productionLayer === 'anchors' &&
      (data as any)?.creationStage === 'single_variable_expansion'
    const styleOnlyHardConstraint = isNewAssetGeneration
      ? '【风格参考硬约束】参考图仅作章节画风方向锚定（笔触/色调/质感），严禁将参考图主体画面内容融入新生成图像，必须完全按以下文字描述从零生成全新独立图像，不得套用参考图的构图或主体形象。'
      : ''
    // 真正「编辑现有图片」（修复/放大/局部改）才点名待编辑目标图：
    // 角色卡生成 / 新资产单变量扩展 / 局部编辑引导图 这些流程里未命名图不是编辑目标，排除以免误标。
    const markEditTarget =
      wantsImageEdit && !referenceSheet && !isRoleCardTask && !isNewAssetGeneration && !focusGuideUrl
    const promptWithAliasSlotBinding = appendReferenceAliasSlotPrompt({
      prompt: [promptForModel, styleOnlyHardConstraint, characterBibleHint, roleCardStyleLockHint].filter(Boolean).join('\n\n'),
      assetInputs: runtimeReferenceAssetInputs,
      referenceImages,
      enabled: wantsImageEdit && !referenceSheet,
      markEditTarget,
    })
    const effectivePromptForModel = appendImageEditFocusGuidePrompt(
      promptWithAliasSlotBinding,
      Boolean(focusGuideUrl),
    )

    for (let i = 0; i < sampleCount; i++) {
      if (isCanceled(id)) {
        setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
        appendLog(id, `[${nowLabel()}] 已取消`)
        ctx.endRunToken(id)
        return
      }

      const progressBase = 5 + Math.floor((90 * i) / sampleCount)
      setNodeStatus(id, 'running', { progress: progressBase })
      const vendorName =
        vendor === 'qwen'
          ? 'Qwen'
          : vendor === 'anthropic'
            ? 'Claude'
            : vendor === 'openai'
              ? 'OpenAI'
              : vendor === 'veo'
                ? 'Veo'
                : 'Gemini'
      const modelType =
        effectiveTaskKind === 'image_remove_bg'
          ? '抠图'
          : effectiveTaskKind === 'image_edit'
            ? '图像编辑'
            : effectiveTaskKind === 'text_to_image'
              ? '图像'
              : '文案'
      appendLog(
        id,
        `[${nowLabel()}] 调用${vendorName} ${modelType}模型 ${sampleCount > 1 ? `(${i + 1}/${sampleCount})` : ''}…`,
      )

      const imageBillingSpecKey = isImageTask
        ? buildImageBillingSpecKey({
            modelKey: selectedModel,
            aspectRatio,
            imageSize: imageSizeSetting,
            resolution: imageResolutionSetting || imageEditSizeSetting,
            quality: imageQualitySetting,
          })
        : null
      const imageRequest: TaskRequestDto | null = isImageTask
        ? {
            kind: effectiveTaskKind,
            prompt: effectivePromptForModel,
            ...(imageEditDimensions ? imageEditDimensions : {}),
            extras: {
              nodeKind: kind,
              nodeId: id,
              modelKey: selectedModel,
              aspectRatio,
              ...(imageBillingSpecKey ? { specKey: imageBillingSpecKey, billingSpecKey: imageBillingSpecKey } : {}),
              ...(imageEditSizeSetting
                ? {
                    size: imageEditSizeSetting,
                    resolution: imageEditSizeSetting,
                    image_size: imageEditSizeSetting,
                  }
                : {}),
              ...(imageSizeSetting ? { imageSize: imageSizeSetting } : {}),
              ...(imageResolutionSetting ? { imageResolution: imageResolutionSetting, resolution: imageResolutionSetting } : {}),
              ...(imageQualitySetting ? { quality: imageQualitySetting } : {}),
              ...(wantsImageEdit ? { referenceImages } : {}),
              ...(effectiveTaskKind === 'image_edit'
                && (
                  (typeof (data as Record<string, unknown>).maskUrl === 'string'
                    && String((data as Record<string, unknown>).maskUrl).trim())
                  || (imageOperationSpec ? imageOperationMaskUrl(imageOperationSpec) : null)
                )
                ? {
                    maskUrl:
                      (typeof (data as Record<string, unknown>).maskUrl === 'string'
                        && String((data as Record<string, unknown>).maskUrl).trim())
                      || imageOperationMaskUrl(imageOperationSpec!)!,
                  }
                : {}),
              ...(imageOperationSpec
                ? {
                    imageOperationSpec,
                    imageOperationId: imageOperationSpec.operationId,
                    imageOperation: imageOperationSpec.kind,
                  }
                : {}),
              ...(runtimeReferenceAssetInputs.length ? { assetInputs: runtimeReferenceAssetInputs } : {}),
              ...(referenceSheet ? { referenceSheet: buildReferenceSheetLogMeta(referenceSheet) } : {}),
            },
          }
        : null
      const requestProgressCap = Math.max(
        progressBase + 1,
        Math.min(95, 5 + Math.floor((90 * (i + 1)) / sampleCount) - 2),
      )
      const pendingTask = imageRequest
        ? await runTaskByVendorWithPendingProgress(ctx, {
            vendor,
            request: imageRequest,
            startProgress: progressBase,
            maxProgress: requestProgressCap,
            status: 'running',
          })
        : null
      let res = imageRequest
        ? pendingTask!.result
        : await runChatByVendor(vendor, {
            prompt,
            ...(selectedModel ? { modelKey: selectedModel } : {}),
          })
      const requestProgress = imageRequest ? pendingTask!.requestProgress : progressBase

      if (isImageTask) {
        appendRequestPayloadLog({
          appendLog,
          nodeId: id,
          result: res,
          fallbackVendor: vendor,
          fallbackRequest: imageRequest!,
        })
      }

      if (isImageTask && (res.status === 'queued' || res.status === 'running')) {
        const taskId = typeof res.id === 'string' ? res.id.trim() : String(res.id || '').trim()
        if (!taskId) {
          throw new Error('图像任务创建失败：未返回任务 ID')
        }
        const semanticBindingPatch = buildSemanticProjectTaskBindingPatch({
          nodeData: (data as Record<string, unknown>) || {},
          taskKind: effectiveTaskKind,
        })

        setNodeStatus(id, 'running', {
          progress: Math.max(10, progressBase, requestProgress),
          imageTaskId: taskId,
          imageTaskKind: effectiveTaskKind,
          imageModel: selectedModel,
          imageModelVendor: null,
          ...semanticBindingPatch,
          lastResult: {
            id: taskId,
            at: Date.now(),
            kind,
            preview: { type: 'text', value: `已创建图像任务（ID: ${taskId}）` },
          },
        })
        appendLog(id, `[${nowLabel()}] 已创建图像任务（ID: ${taskId}），开始轮询进度…`)

        if (typeof window !== 'undefined' && typeof (window as any).silentSaveProject === 'function') {
          try {
            ;(window as any).silentSaveProject()
          } catch {}
        }

        const pollIntervalMs = 2500
        const pollTimeoutMs = DEFAULT_TASK_POLL_TIMEOUT_MS
        const startedAt = Date.now()
        let lastProgress = Math.max(10, progressBase, requestProgress)

        while (Date.now() - startedAt < pollTimeoutMs) {
          if (isCanceled(id)) {
            setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
            appendLog(id, `[${nowLabel()}] 已取消图像任务`)
            ctx.endRunToken(id)
            return
          }

          let snapshot: TaskResultDto
          try {
            snapshot = await fetchTaskResult(taskId, effectiveTaskKind, effectivePromptForModel)
          } catch (err: any) {
            const msg = err?.message || '查询图像任务进度失败'
            appendLog(id, `[${nowLabel()}] error: ${msg}`)
            await sleep(pollIntervalMs)
            continue
          }

          if (snapshot.status === 'queued' || snapshot.status === 'running') {
            const raw = snapshot.raw as any
            const rawProgress =
              (typeof raw?.progress === 'number' ? raw.progress : null) ??
              (typeof raw?.response?.progress === 'number' ? raw.response.progress : null) ??
              (typeof raw?.response?.progress_pct === 'number' ? raw.response.progress_pct * 100 : null)
            if (typeof rawProgress === 'number') {
              const normalized = Math.min(95, Math.max(lastProgress, Math.max(5, Math.round(rawProgress))))
              lastProgress = normalized
              setNodeStatus(id, snapshot.status === 'queued' ? 'queued' : 'running', {
                progress: normalized,
                imageTaskId: taskId,
              })
            }
            await sleep(pollIntervalMs)
            continue
          }

          if (snapshot.status === 'failed') {
            const msg =
              (snapshot.raw && ((snapshot.raw as any)?.failureReason as string | undefined)) ||
              (snapshot.raw && ((snapshot.raw as any)?.response?.error as string | undefined)) ||
              (snapshot.raw && ((snapshot.raw as any)?.response?.message as string | undefined)) ||
              '图像任务失败'
            throw new Error(msg)
          }

          // succeeded
          res = snapshot
          break
        }

        if (res.status === 'queued' || res.status === 'running') {
          throw new Error('图像任务轮询超时，服务端任务可能仍在继续，请稍后在历史或资产中确认结果')
        }
      }

      lastRes = res

      if (vendor === 'qwen' && res.status === 'failed') {
        const rawResponse = res.raw?.response
        const errMsg =
          rawResponse?.output?.error_message ||
          rawResponse?.error_message ||
          rawResponse?.message ||
          res.raw?.message ||
          'Qwen 图像生成失败'
        throw new Error(errMsg)
      }

      if ((vendor === 'gemini' || vendor === 'google') && res.status === 'failed') {
        const rawResponse = (res.raw as any)?.response || res.raw
        const errMsg =
          rawResponse?.failure_reason ||
          rawResponse?.error ||
          rawResponse?.message ||
          'Banana 图像生成失败'
        throw new Error(errMsg)
      }

      const textOut = (res.raw && (res.raw.text as string)) || ''
      if (textOut.trim()) {
        allTexts.push(textOut.trim())
      }

      const imageAssets = (Array.isArray(res.assets) ? res.assets : [])
        .filter((asset) => asset?.type === 'image' && typeof asset.url === 'string' && asset.url.trim().length > 0)
        .map((asset, index) => {
          const ordinal = allImageAssets.length + index + 1
          const roleNameHint = String(resolveSemanticNodeRoleBinding(data).roleName || '').trim()
          const labelHint = String((data as Record<string, unknown>)?.label || '').trim()
          const fallbackName = roleNameHint || labelHint || `image_${ordinal}`
          const fallbackTitle = labelHint ? `${labelHint} ${ordinal}` : `图像 ${ordinal}`
          return buildImageAssetResultItem({
            url: String(asset.url).trim(),
            title:
              typeof asset.assetName === 'string' && asset.assetName.trim()
                ? asset.assetName.trim()
                : fallbackTitle,
            assetId: typeof asset.assetId === 'string' ? asset.assetId.trim() : null,
            assetName:
              typeof asset.assetName === 'string' && asset.assetName.trim()
                ? asset.assetName.trim()
                : fallbackName,
            assetRefId: typeof asset.assetRefId === 'string' ? asset.assetRefId.trim() : null,
          })
        })
      if (imageAssets.length) {
        allImageAssets.push(...imageAssets)
      }

      if (isCanceled(id)) {
        setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
        appendLog(id, `[${nowLabel()}] 已取消`)
        ctx.endRunToken(id)
        return
      }
    }

    const res = lastRes
    const text = (res?.raw && (res.raw.text as string)) || ''
    const firstImage =
      isImageTask && allImageAssets.length ? allImageAssets[0] : null
    const preview =
      IMAGE_NODE_KINDS.has(kind) && firstImage
        ? { type: 'image', src: firstImage.url }
        : text.trim().length > 0
          ? { type: 'text', value: text }
          : { type: 'text', value: 'AI 调用成功' }

    let patchExtra: any = {}
    const existingPrompt =
      typeof (data as any)?.prompt === 'string'
        ? (data as any).prompt.trim()
        : ''
    if (isImageTask && res?.id) {
      patchExtra = {
        ...patchExtra,
        ...buildSemanticProjectTaskBindingPatch({
          nodeData: (data as Record<string, unknown>) || {},
          taskKind: effectiveTaskKind,
        }),
      }
    }
    if (isImageTask && allImageAssets.length) {
      const existing = normalizeImageResultItems((data as Record<string, unknown>)?.imageResults)
      const merged = [...existing, ...allImageAssets]
      const newPrimaryIndex = existing.length
      patchExtra = {
        ...patchExtra,
        imageUrl: firstImage!.url,
        imageResults: merged,
        imagePrimaryIndex: newPrimaryIndex,
      }
    }
    if (allTexts.length) {
      const existingTexts =
        (data.textResults as { text: string }[] | undefined) || []
      const mergedTexts = [
        ...existingTexts,
        ...allTexts.map((t) => ({ text: t })),
      ]
      patchExtra = {
        ...patchExtra,
        textResults: mergedTexts,
      }
    }

    // 将本次使用的提示词写回节点数据（仅在节点原本没有提示词，或本次使用的提示词与原值一致时）
    if (typeof prompt === 'string' && prompt.trim().length > 0) {
      const usedPrompt = prompt.trim()
      const shouldWritePromptBack = !existingPrompt || existingPrompt === usedPrompt
      if (shouldWritePromptBack) {
        patchExtra = {
          ...patchExtra,
          prompt: usedPrompt,
        }
      }
    }

    setNodeStatus(id, 'success', {
      progress: 100,
      lastResult: {
        id: res?.id,
        at: Date.now(),
        kind,
        preview,
      },
      ...patchExtra,
      ...(imageOperationSpec
        ? {
            imageOperationState: {
              ...createImageOperationState(imageOperationSpec, 'succeeded'),
              attempt: Math.max(1, Number(((data as Record<string, unknown>).imageOperationState as Record<string, unknown> | undefined)?.attempt ?? 0) + 1),
              progress: 100,
              startedAt: imageOperationSpec.createdAt,
              finishedAt: new Date().toISOString(),
              resultAssets: allImageAssets.map((asset) => ({
                role: 'result' as const,
                url: asset.url,
                assetId: asset.assetId,
              })),
            },
            imageOperationRevision: imageOperationSpec.sourceRevision + 1,
          }
        : {}),
    })
    if (isImageTask && firstImage?.url) {
      const nextNodeData: Record<string, unknown> = {
        ...(data as Record<string, unknown>),
        ...patchExtra,
      }
      let semanticNodeData: Record<string, unknown> = { ...nextNodeData }
      try {
        const bindingResult = await persistRoleCardImageBinding({
          nodeId: id,
          nodeData: nextNodeData,
          imageUrl: String(firstImage.url),
          prompt: typeof prompt === 'string' ? prompt : undefined,
          modelKey: String(selectedModel || '').trim() || undefined,
        })
        if (bindingResult && !isCanceled(id)) {
          const existingRoleRefUrls = Array.isArray((data as Record<string, unknown>)?.roleCardReferenceImages)
            ? ((data as Record<string, unknown>).roleCardReferenceImages as unknown[])
                .map((item) => String(item || '').trim())
                .filter(Boolean)
            : []
          const nextRoleRefUrls = firstImage?.url
            ? Array.from(new Set<string>([...existingRoleRefUrls, String(firstImage.url).trim()])).slice(0, 8)
            : existingRoleRefUrls
          const existingRoleReferenceEntries = Array.isArray((data as Record<string, unknown>)?.roleReferenceEntries)
            ? ((data as Record<string, unknown>).roleReferenceEntries as unknown[])
                .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
                .map((item) => ({
                  name: String(item.name || '').trim(),
                  url: String(item.url || '').trim(),
                }))
                .filter((item) => item.name && item.url)
            : []
          const nextRoleReferenceEntries = (() => {
            if (!firstImage?.url || !bindingResult.roleName) return existingRoleReferenceEntries
            const imageUrl = String(firstImage.url).trim()
            const deduped = existingRoleReferenceEntries.filter((item) => item.url !== imageUrl)
            deduped.unshift({
              name: bindingResult.roleName,
              url: imageUrl,
            })
            return deduped.slice(0, 10)
          })()
          const nextAnchorBindings = upsertSemanticNodeAnchorBinding({
            existing: semanticNodeData.anchorBindings,
            next: {
              kind: 'character',
              label: bindingResult.roleName,
              refId: bindingResult.roleCardId,
              entityId: bindingResult.roleId,
              sourceBookId: bindingResult.sourceBookId,
              imageUrl: String(firstImage.url).trim(),
              referenceView: 'three_view',
            },
          })
          semanticNodeData = {
            ...semanticNodeData,
            ...(bindingResult.sourceBookId ? { sourceBookId: bindingResult.sourceBookId } : {}),
            anchorBindings: nextAnchorBindings,
          }
          setNodeStatus(id, 'success', {
            roleName: bindingResult.roleName,
            ...(bindingResult.roleId ? { roleId: bindingResult.roleId } : null),
            ...(bindingResult.roleCardId ? { roleCardId: bindingResult.roleCardId } : null),
            ...(bindingResult.sourceBookId ? { sourceBookId: bindingResult.sourceBookId } : null),
            ...(nextRoleRefUrls.length ? { roleCardReferenceImages: nextRoleRefUrls } : null),
            ...(nextRoleReferenceEntries.length ? { roleReferenceEntries: nextRoleReferenceEntries } : null),
            anchorBindings: nextAnchorBindings,
            roleBindingSyncError: null,
            roleBindingBookScope: bindingResult.bookScopeStatus,
            roleBindingMetadataSynced: bindingResult.metadataSynced,
            roleBindingMetadataSyncedAt: bindingResult.metadataSynced ? new Date().toISOString() : null,
          })
          if (bindingResult.metadataSynced && bindingResult.sourceBookId) {
            appendLog(id, `[${nowLabel()}] 角色主图已同步到章节元数据（book=${bindingResult.sourceBookId}）`)
          } else {
            appendLog(
              id,
              `[${nowLabel()}] 角色主图已绑定到项目资产，但未同步到书籍 roleCards（bookScope=${bindingResult.bookScopeStatus}）`,
            )
          }
          notifyAssetRefresh()
        }
      } catch (err: any) {
        const syncError = String(err?.message || err || 'unknown')
        appendLog(id, `[${nowLabel()}] 角色卡回填失败：${syncError}`)
        setNodeStatus(id, 'success', {
          roleBindingSyncError: syncError,
          roleBindingMetadataSynced: false,
        })
        if (!isCanceled(id)) {
          toast(`角色绑定回填失败：${syncError}`, 'warning')
        }
      }

      try {
        const visualBindingResult = await persistVisualReferenceImageBinding({
          nodeId: id,
          nodeData: semanticNodeData,
          imageUrl: String(firstImage.url),
          prompt: typeof prompt === 'string' ? prompt : undefined,
          modelKey: String(selectedModel || '').trim() || undefined,
        })
        if (visualBindingResult && !isCanceled(id)) {
          const nextAnchorBindings = upsertSemanticNodeAnchorBinding({
            existing: semanticNodeData.anchorBindings,
            next: {
              kind: 'scene',
              label: visualBindingResult.refName,
              refId: visualBindingResult.refId,
              sourceBookId: visualBindingResult.sourceBookId,
              imageUrl: String(firstImage.url).trim(),
              category: visualBindingResult.category,
            },
            replaceKinds: ['scene', 'prop'],
          })
          semanticNodeData = {
            ...semanticNodeData,
            sourceBookId: visualBindingResult.sourceBookId,
            anchorBindings: nextAnchorBindings,
          }
          setNodeStatus(id, 'success', {
            visualRefId: visualBindingResult.refId,
            visualRefName: visualBindingResult.refName,
            visualRefCategory: visualBindingResult.category,
            ...(visualBindingResult.category === 'scene_prop'
              ? {
                  scenePropRefId: visualBindingResult.refId,
                  scenePropRefName: visualBindingResult.refName,
                }
              : null),
            sourceBookId: visualBindingResult.sourceBookId,
            anchorBindings: nextAnchorBindings,
          })
          appendLog(
            id,
            `[${nowLabel()}] 场景/道具参考已同步到章节元数据（book=${visualBindingResult.sourceBookId}, ref=${visualBindingResult.refName}）`,
          )
          notifyAssetRefresh()
        }
      } catch (err: any) {
        const syncError = String(err?.message || err || 'unknown')
        appendLog(id, `[${nowLabel()}] 场景/道具参考回填失败：${syncError}`)
        if (!isCanceled(id)) {
          toast(`场景/道具参考回填失败：${syncError}`, 'warning')
        }
      }

      try {
        const semanticResult = await persistSemanticAssetMetadata({
          nodeId: id,
          nodeKind: kind,
          nodeData: semanticNodeData,
          mediaKind: 'image',
          imageUrl: String(firstImage.url).trim(),
          prompt: typeof prompt === 'string' ? prompt : undefined,
        })
        if (semanticResult?.metadataSynced && semanticResult.sourceBookId) {
          appendLog(
            id,
            `[${nowLabel()}] 通用语义资产已同步到章节元数据（book=${semanticResult.sourceBookId}, semantic=${semanticResult.semanticId}）`,
          )
        } else if (semanticResult) {
          appendLog(
            id,
            `[${nowLabel()}] 通用语义资产未写入书籍 semanticAssets（bookScope=${semanticResult.bookScopeStatus}）`,
          )
        }
      } catch (err: any) {
        const syncError = String(err?.message || err || 'unknown')
        appendLog(id, `[${nowLabel()}] 通用语义资产回填失败：${syncError}`)
        if (!isCanceled(id)) {
          toast(`通用语义资产回填失败：${syncError}`, 'warning')
        }
      }
    }

    if (res?.assets && res.assets.length) {
      if (!isCanceled(id)) notifyAssetRefresh()
    }

    if (text.trim()) {
      appendLog(id, `[${nowLabel()}] AI: ${text.slice(0, 120)}`)
    } else {
      appendLog(id, `[${nowLabel()}] 文案模型调用成功`)
    }
  } catch (err: any) {
    const status = (err as any)?.status || 'unknown'
    const { enhancedMsg } = resolveTaskErrorDisplay(err, '图像模型调用失败')

    if (!isCanceled(id)) toast(enhancedMsg, 'error')

    setNodeStatus(id, 'error', {
      progress: 0,
      lastError: enhancedMsg,
      httpStatus: status,
      isQuotaExceeded: false,
      ...(imageOperationSpec
        ? {
            imageOperationState: {
              ...createImageOperationState(imageOperationSpec, 'failed'),
              attempt: Math.max(1, Number((((data as Record<string, unknown>).imageOperationState as Record<string, unknown> | undefined)?.attempt) ?? 0) + 1),
              progress: 0,
              finishedAt: new Date().toISOString(),
              error: {
                code: typeof (err as Record<string, unknown>)?.code === 'string'
                  ? String((err as Record<string, unknown>).code)
                  : 'image_operation_failed',
                message: enhancedMsg,
                retryable: status !== 400 && status !== 401 && status !== 403,
              },
            },
          }
        : {}),
    })
    appendLog(id, `[${nowLabel()}] error: ${enhancedMsg}`)
  } finally {
    ctx.endRunToken(id)
  }
}
