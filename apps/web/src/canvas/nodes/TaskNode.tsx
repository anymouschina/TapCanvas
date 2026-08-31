import React from 'react'
import { createPortal } from 'react-dom'
import {
  createImageOperationState,
  updateImageOperationParameters,
  type ImageOperationExecution,
  type ImageOperationKind,
  type ImageOperationSpec,
} from '@tapcanvas/image-operation-protocol'
import { readSbaNodePresentation } from '@tapcanvas/storyboard-adventure-protocol'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import { Position, NodeResizeControl, NodeToolbar, useStore, useReactFlow } from '@xyflow/react'
import { isCanvasNodeDragActive, useRFStore } from '../store'
import { useUIStore } from '../../ui/uiStore'
import { ASSET_REFRESH_EVENT, notifyAssetRefresh } from '../../ui/assetEvents'
import { ActionIcon, Group, Paper, Popover, Button, Text, Stack, TextInput, Select, Badge, Tooltip } from '@mantine/core'
import {
  IconAdjustments,
  IconBulb,
  IconCamera,
  IconPhotoSearch,
  IconRefresh,
  IconLayoutGrid,
  IconGrid3x3,
  IconBorderAll,
  IconSparkles,
  IconScissors,
  IconFocusCentered,
  IconMaximize,
  IconScreenshot,
  IconPanoramaHorizontal,
  IconMoodSmile,
  IconArrowNarrowLeft,
  IconCrop,
  IconPencil,
  IconRotate,
  IconMovie,
  IconArrowMergeBoth,
  IconApps,
  IconPhotoSpark,
  IconFolderPlus,
  IconMusic,
  IconBadgeHd,
  IconRepeat,
  IconTimeline,
  IconSubtitlesOff,
  IconArrowsSplit,
  IconUserOff,
  IconDots,
} from '@tabler/icons-react'
import {
  fetchPublicTaskResultWithAuth,
  listProjectRoleCardAssets,
  listServerAssets,
  recoverUploadedServerAssetFile,
  runPublicTask,
  runTaskByVendor,
  runVisionTask,
  llmChat,
  uploadServerAssetFile,
  uploadExternalImageToOss,
  fetchProxiedImageBlob,
  fetchAssetDownloadBlob,
  upsertCanvasIndexRef,
  type PromptSampleDto,
  type ServerAssetDto,
  type UserGenerationPrefsDto,
} from '../../api/server'
import { type ModelOption, type NodeKind } from '../../config/models'
import {
  constrainImageModelCatalogConfigByPricing,
  parseImageModelCatalogConfig,
  constrainVideoModelCatalogConfigByPricing,
  DEFAULT_VIDEO_REFERENCE_IMAGE_LIMIT,
  parseVideoModelCatalogConfig,
  type ImageModelControlBinding,
  type VideoModelControlBinding,
} from '../../config/modelCatalogMeta'
import {
  getModelOptionRequestAlias,
  findModelOptionByIdentifier,
  useModelOptions,
  useModelOptionsState,
} from '../../config/useModelOptions'
import { resolveModelGenerationCredits } from '../../config/modelPricing'
import { resolveVideoInputPosterUrl } from './taskNode/videoPosterUrl'
import { resolveDefaultCatalogModelOption } from './taskNode/defaultCatalogModel'
import { getTaskNodeCoreType, getTaskNodeSchema, normalizeTaskNodeKind } from './taskNodeSchema'
import { buildTaskNodeFeatureFlags, type TaskNodeFeatureFlags } from './taskNode/features'
import {
  computeHandleLayout,
  extractTextFromTaskResult,
  genTaskNodeId,
  isStaticHandlesConfig,
  MAX_VEO_REFERENCE_IMAGES,
  normalizeVeoReferenceUrls,
  HANDLE_HORIZONTAL_OFFSET,
  getVisualNodeDefaults,
  getTextNodeSize,
  TEXT_NODE_DEFAULT_HEIGHT,
  TEXT_NODE_DEFAULT_WIDTH,
  TEXT_NODE_MAX_HEIGHT,
  TEXT_NODE_MAX_WIDTH,
  TEXT_NODE_MIN_HEIGHT,
  TEXT_NODE_MIN_WIDTH,
  fitVisualSizeToNatural,
} from './taskNodeHelpers'
import { toast } from '../../ui/toast'
import { DEFAULT_REVERSE_PROMPT_INSTRUCTION } from '../constants'
import { CANVAS_CONFIG } from '../utils/constants'
import { ManagedImage, resourceManager } from '../../domain/resource-runtime'
import { useResourceRuntimeStore } from '../../domain/resource-runtime/store/resourceRuntimeStore'
import { getPendingUploadHandlesByOwnerNodeId, useUploadRuntimeStore } from '../../domain/upload-runtime/store/uploadRuntimeStore'
import { captureFramesAtTimes } from '../../utils/videoFrameExtractor'
import { appendDownloadSuffix, downloadUrl } from '../../utils/download'
import { hasAuthSession } from '../../auth/store'
import { dedupeLocalFiles } from '../../utils/localUploadDedup'
import { normalizeOrientation, type Orientation } from '../../utils/orientation'
import { buildVideoBillingSpecKey, normalizeVideoResolution } from '../../utils/videoBillingSpec'
import { isKlingV3OmniVideoModel, normalizeKlingVideoReferType } from '../../utils/klingV3'
import { buildVideoDurationPatch, readVideoDurationSeconds } from '../../utils/videoDuration'
import { withCanvasGenerationContext } from '../../runner/generationAssetContext'
import { useImageViewEditor, type ImageViewEditorApplyPayload } from './taskNode/ImageViewEditor'
import { PanoramicViewer, PANORAMIC_DEFAULT_CAMERA } from './taskNode/PanoramicViewer'
import type { PanoramicCameraState, PanoramicViewerHandle } from './taskNode/PanoramicViewer'
import { PanoramicMultiAngleEditor, FOUR_VIEW_ANGLES, TWELVE_VIEW_ANGLES, multiAngleFovToZoom } from './taskNode/PanoramicMultiAngleEditor'
import {
  buildLibTvLightingOperationParameters,
  cameraFovToImageDistance,
  findClosestLightDirection,
  LIBTV_MAIN_LIGHT_DIRECTIONS,
  LIBTV_RIM_LIGHT_DIRECTIONS,
} from './taskNode/imageViewEditorContract'
import { createMaskEditSourcePng } from './taskNode/maskEditAssets'
import { parseGridSplitSelectedCells, sortGridSplitCells, type GridSplitCell } from './taskNode/gridSplitCells'
import { isTapCanvasHostedUploadUrl } from './taskNode/hostedUploadUrl'
import { TaskNodeHandles } from './taskNode/components/TaskNodeHandles'
import { TopToolbar, type ToolbarMenuItem } from './taskNode/components/TopToolbar'
import { LibTvImageToolbarIcon } from './taskNode/components/LibTvImageToolbarIcon'
import { CAMERA_BODIES, type CinematicCameraValue } from './taskNode/cameraControlContract'
import {
  useProjectImageSettingsStore,
  useProjectImageSettings,
  mergeChapterCreativeOverrideIntoProjectImageSettings,
} from '../projectImageSettingsStore'
import { TaskNodeHeader } from './taskNode/components/TaskNodeHeader'
import type { MediaPromptLibraryKind } from './taskNode/components/MediaPromptLibraryModal'
import {
  findLibTvImagePreset,
  LIBTV_IMAGE_NINE_GRID_PRESET_KEYS,
  type LibTvImagePreset,
} from './taskNode/libTvImagePresets'
import {
  LIBTV_IMAGE_GRID_SPLIT_ACTIONS,
  LIBTV_IMAGE_HD_ACTIONS,
  LIBTV_IMAGE_NINE_GRID_ICONS,
  LIBTV_IMAGE_PORTRAIT_ACTIONS,
} from './taskNode/libTvImageToolbar'
import {
  buildCharacterFissionNodeDraft,
  type CharacterFissionDraft,
} from './taskNode/characterFissionContract'
import { buildMediaGenerationSettings } from './taskNode/mediaGenerationSettings'
import { StatusBanner } from './taskNode/components/StatusBanner'
import { GenerationOverlay } from './taskNode/components/GenerationOverlay'
import type { Image3DParams } from './taskNode/components/Image3DPanel'
import type { EnhanceParams } from './taskNode/components/VideoEnhancePanel'
import { computeEnhanceSpecKey } from './taskNode/components/enhanceSpecKey'
import type { MentionSuggestionItem } from './taskNode/components/PromptSection'
import { buildPersistedPromptAssetMentionRefs } from './taskNode/persistedPromptAssetMentions'
import { readVideoClipIndex, readVideoClipRunId } from '../videoClipCanvasFacts'
import { requestVideoClipAgentAction } from '../videoClipAgentAction'
import { readWorkflowCanvasPorts, workflowPortHandleId } from '../workflowCanvasPorts'
import { buildWorkflowAgentReferenceHandles } from '../workflowAgentReferenceHandles'
import type { SegmentRemakeRange } from './taskNode/components/SegmentRemakeContent'
import type { MediaEmptyAction } from './taskNode/components/MediaEmptyState'
import { consumeMediaEmptyAction } from './taskNode/mediaEmptyActionRuntime'
import {
  convertPlainTextToHtml,
  resolveTextNodeLatestResult,
  resolveTextNodePlainText,
  withTextNodeAlpha,
  type TextNodeDisplaySource,
} from './taskNode/textNodeContent'
import type { VideoMarkerDraft } from './taskNode/components/VideoMarkerToolbar'
import { createVideoMarker, normalizeVideoMarkers, validateVideoMarkerRange } from './taskNode/videoMarkers'
import {
  buildRetainedVideoSurfaceKey,
  readRetainedVideoPlaybackSnapshot,
} from './taskNode/components/retainedVideoSurface'
import { uploadCanvasImageBlob } from './directorConsole/uploadCanvasImageBlob'
import { useTaskNodeTheme } from './taskNode/useTaskNodeTheme'
import { renderFeatureBlocks } from './taskNode/featureRenderers'
import type { ShotTableAssetReference } from './taskNode/shotTable/ShotTableAssetPicker'
import type { ComposeVideoSource } from './taskNode/components/useVideoCompose'
import { buildComposeInitialPatch, buildComposeUrlSwapPatch } from './taskNode/components/composeWriteback'
import { INTENT_ACTIONS } from './taskNode/intentActions'
import { dispatchIntent } from '../dispatchIntent'
import { readNodeModelPrefs, saveNodeModelPrefs } from '../nodeModelPrefs'
import { DEFAULT_GENERATION_PREFS, updateRecentGenerationPrefs } from '../../config/generationPrefs'
import { resolveIntentChapterContext } from './taskNode/intentChapterContext'
import { useIntentLifecycle } from '../intentLifecycle'
import type { ChapterCanvasIntent } from '@tapcanvas/chapter-canvas-intents'
import { REMOTE_IMAGE_URL_REGEX } from './taskNode/utils'
import {
  buildAssetRefId,
} from '../../runner/assetReference'
import { runNodeDagToTarget } from '../../runner/dag'
import { isModerationFailure } from '../../runner/taskErrorClassifier'
import { collectUpstreamComposeAudioTracks } from '../../runner/collectUpstreamComposeSources'
import {
  AUDIO_EMOTION_OPTIONS,
  AUDIO_LYRICS_MODE_OPTIONS,
  AUDIO_VOICE_OPTIONS,
  DOUBAO_LOUDNESS_RATE_OPTIONS,
  DOUBAO_PITCH_RATE_OPTIONS,
  DOUBAO_SPEECH_RATE_OPTIONS,
} from './taskNode/audioControlOptions'
import { SAMPLE_OPTIONS } from './taskNode/constants'
import {
  buildCharacterBibleFromDto,
  buildCharacterReferenceImages,
  type AiCharacterLibraryCharacterDto,
} from '@tapcanvas/character-bible-protocol'

import {
  buildDefaultStoryboardEditorData,
  buildStoryboardEditorPatch,
  normalizeStoryboardEditorSelectedIndex,
  type StoryboardEditorAspect,
  type StoryboardEditorCell,
  type StoryboardEditorGrid,
} from './taskNode/storyboardEditor'
import {
  normalizeStoryboardSelectionContext,
  type StoryboardSelectionContext,
} from '@tapcanvas/storyboard-selection-protocol'
import {
  getNodeProductionMeta,
  readChapterGroundedProductionMetadata,
} from '../productionMeta'
import {
  DEFAULT_IMAGE_EDIT_SIZE,
  normalizeImageEditSize,
  parseImageEditSizeDimensions,
  toAspectRatioFromImageEditSize,
} from './taskNode/imageEditSize'
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
  resolveSemanticNodeRoleBinding,
} from '../utils/semanticBindings'
import { useCanvasRenderContext } from '../CanvasRenderContext'
import { useWorkflowNodeInspectorStore } from '../workflowNodeInspectorStore'
import type { VideoContinuationSubmit } from './taskNode/VideoContinuationPanel'
import type { VideoToolEditorMode } from './taskNode/VideoToolEditorPanel'
import type { VideoSeparationOutput } from './taskNode/videoSeparation'
import type { EmotionApplyRequest } from './taskNode/EmotionPanel'
import { buildLibTvEmotionPrompt } from './taskNode/emotionModel'
import { cropImageBlobToNormalizedRect, normalizedRectToPixelBoundingBox } from './taskNode/portraitSelection'
import type { ElementEditSubmit } from './taskNode/ElementEditEditor'
import type { PortraitTextureSelection } from './taskNode/PortraitTextureEditor'
import {
  normalizePortraitTextureStrength,
  PORTRAIT_TEXTURE_DEFAULT_STRENGTH,
} from './taskNode/portraitTextureContract'
import {
  createImageOperationForSource,
  createPresetImageOperation,
  readImageOperationSourceRevision,
} from './taskNode/imageOperationFactory'
import { createCenteredOutpaintAssets } from './taskNode/outpaintAssets'
import type { TaskNodeType } from './taskNode/taskNodeTypes'
import { areTaskNodePropsEqual } from './taskNode/taskNodePropsEqual'
import {
  buildImageBillingSpecKeyForOption,
  formatImageQualityOptionLabel,
  formatImageResolutionOptionLabel,
  getTaskNodeModelDisplayLabel,
  isCatalogAudioType,
  normalizeImageAspect,
  normalizeImageQualitySetting,
  normalizeImageResolutionSetting,
  pickImageAspectValue,
  pickImageQualityValue,
  pickImageResolutionValue,
  pickImageSizeValue,
  pickVideoDurationValue,
  pickVideoOrientationValue,
  pickVideoResolutionValue,
  pickVideoSizeValue,
  readCatalogTags,
  readCatalogTagValue,
  resolveVideoOrientationValue,
} from './taskNode/mediaModelControls'
import {
  ImagePresetConfirmPortal,
  PanoramicConfirmPortal,
} from './taskNode/components/TaskNodeConfirmPortals'
import {
  LazyCharacterFissionEditorPortal,
  LazyCameraControlPanel,
  LazyDoubaoVoicePicker,
  LazyAiCharacterLibraryModal,
  LazyAnnotationEditor,
  LazyCropOverlayEditor,
  LazyElementEditEditor,
  LazyEmotionPanel,
  LazyExpandPanel,
  LazyGridCustomPicker,
  LazyHdUpscalePanel,
  LazyImage3DPanel,
  LazyImagePickerModal,
  LazyIntentConfigModal,
  LazyIntentActionGroup,
  LazyLibTvMediaQuickActions,
  LazyLibTvPresetLibrary,
  LazyMaskDrawingEditor,
  LazyMediaPromptLibraryModal,
  LazyModel3DOverlay,
  LazyPortraitTextureEditor,
  LazyPortraitTextureControls,
  LazyPromptSection,
  LazyPromptSampleDrawer,
  LazyRotatePanel,
  LazySaveToLibraryModal,
  LazySegmentRemakeContent,
  LazyStructuredPromptSection,
  LazyStyleImagePickerModal,
  LazyVeoImageModal,
  LazyVideoComposeEditorModal,
  LazyVideoContent,
  LazyVideoContinuationPanel,
  LazyVideoEnhancePanel,
  LazyVideoMarkerToolbar,
  LazyVideoResultModal,
  LazyVideoContinuityInspector,
  LazyVideoToolEditorPanel,
  LazyVideoTrimEditor,
  LazyWorkflowPresetSelector,
  LazyControlChips,
  LazyTaskNodeTextInlineToolbar,
  LazyTextContent,
} from './taskNode/components/lazyTaskNodeFeatures'

const {
  hasActiveImageCameraControl,
  normalizeImageCameraControl,
  normalizeImageLightingRig,
} = imageViewControlsModule

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
  loading?: boolean
  disabled?: boolean
  showLabel?: boolean
  badge?: React.ReactNode
}

// 打光 / 调整角度统一走 gemini-3.1-flash-image-preview：它支持参考图编辑，
// 且使用仅由分辨率决定的 image:{resolution} 计费规格。
const RELIGHT_MODEL_KEY = 'gemini-3.1-flash-image-preview'

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

type HostedEditedImageAsset = {
  url: string
  assetId: string
}

function readServerAssetHostedUrl(asset: ServerAssetDto): string {
  const rawData = asset.data
  const data = rawData && typeof rawData === 'object' && !Array.isArray(rawData)
    ? rawData as Record<string, unknown>
    : {}
  const url = typeof data.url === 'string' ? data.url.trim() : ''
  return REMOTE_IMAGE_URL_REGEX.test(url) ? url : ''
}

function getImageFileExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg'
  if (normalized.includes('webp')) return 'webp'
  if (normalized.includes('gif')) return 'gif'
  if (normalized.includes('avif')) return 'avif'
  return 'png'
}

function normalizeUploadFilePrefix(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'edited-image'
}

async function createBlobSha256Hex(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('当前浏览器缺少图片上传去重所需的摘要能力')
  }
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function canvasToImageBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
          return
        }
        reject(new Error('图片导出失败'))
      },
      type,
      quality,
    )
  })
}

async function dataUrlToImageBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl)
  if (!response.ok) throw new Error('读取截图结果失败')
  const blob = await response.blob()
  const mimeType = (blob.type || '').split(';')[0].trim().toLowerCase()
  if (!mimeType.startsWith('image/')) {
    throw new Error('截图结果不是图片资源')
  }
  return blob
}

async function loadImageElementFromBlob(blob: Blob): Promise<{ image: HTMLImageElement; objectUrl: string }> {
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.crossOrigin = 'anonymous'
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = objectUrl
    })
    return { image, objectUrl }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

async function cropGridSplitCellBlob(input: {
  image: HTMLImageElement
  rows: number
  cols: number
  cell: GridSplitCell
}): Promise<Blob> {
  const cw = Math.round(input.image.naturalWidth / input.cols)
  const ch = Math.round(input.image.naturalHeight / input.rows)
  const sx = Math.round((input.cell.col * input.image.naturalWidth) / input.cols)
  const sy = Math.round((input.cell.row * input.image.naturalHeight) / input.rows)
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 初始化失败')
  context.drawImage(input.image, sx, sy, cw, ch, 0, 0, cw, ch)
  return await canvasToImageBlob(canvas, 'image/jpeg', 0.95)
}

function buildHostedImageResult(asset: HostedEditedImageAsset, title: string): TaskNodeImageResult {
  return {
    url: asset.url,
    title,
    assetId: asset.assetId,
  }
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
  model?: string | null
  remixTargetId?: string | null
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
  mentionAliases?: readonly string[]
  assetRole?: 'style' | 'reference'
  isConnected?: boolean
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
const DEFAULT_IMAGE_NODE_REFERENCE_IMAGE_LIMIT = 12
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

type RFStoreSnapshot = ReturnType<typeof useRFStore.getState>

function useStableRFStoreSelection<T>(
  selector: (state: RFStoreSnapshot) => T,
  equals: (left: T, right: T) => boolean,
): T {
  const cachedRef = React.useRef<{ value: T } | null>(null)
  const stableSelector = React.useMemo(
    () => (state: RFStoreSnapshot): T => {
      const next = selector(state)
      const cached = cachedRef.current
      if (cached && equals(cached.value, next)) return cached.value
      cachedRef.current = { value: next }
      return next
    },
    [equals, selector],
  )
  return useRFStore(stableSelector)
}

const EMPTY_UPSTREAM_REFERENCE_ITEMS: OrderedUpstreamReferenceItem[] = []

type NodeResizeEndParams = {
  width?: number
  height?: number
}

type MediaNaturalSize = {
  width: number
  height: number
  url: string
}

type ToolbarMappedControl = {
  key: string
  // 'videoReferType' 是节点级自定义控件（kling-v3-omni 动作迁移开关），不走 params_def 绑定。
  binding: VideoModelControlBinding | ImageModelControlBinding | 'videoReferType'
  title: string
  summary: string
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
  onChange: (value: string) => void
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
    status === 'canceled' ? '#3e4044' :
    status === 'running' ? '#7c828e' :
    status === 'queued' ? '#f59e0b' : 'rgba(127,127,127,.6)'
  const statusLabel =
    status === 'success' ? '已完成' :
    status === 'error' ? '异常' :
    status === 'canceled' ? '已取消' :
    status === 'running' ? '生成中' :
    status === 'queued' ? '排队中' : '待命'
  const {
    isDarkUi,
    themeWhite,
    rgba,
    accentPrimary,
    nodeShellBorder,
    nodeShellShadow,
    nodeShellText,
    mediaOverlayBackground,
    mediaOverlayText,
    toolbarBackground,
    toolbarShadow,
    subtleOverlayBackground,
    mediaFallbackSurface,
    mediaFallbackText,
    videoSurface,
    inlineDividerColor,
    galleryCardBackground,
    iconBadgeBackground,
    iconBadgeShadow,
    darkCardShadow,
    summaryChipStyles,
    controlValueStyle,
    sleekChipBase,
    toolbarActionIconStyles,
  } = useTaskNodeTheme()

  const kind = normalizeTaskNodeKind(typeof data?.kind === 'string' ? data.kind : null) || 'text'
  const isWorkflowPresetSelectorNode = (data as Record<string, unknown>)?.workflowPresetSelectorVersion === 2
  const draftByAgent = Boolean((data as any)?.draftByAgent)
  const coreKind = getTaskNodeCoreType(kind)
  const isCharacterReferenceNode = coreKind === 'image'
    && String((data as Record<string, unknown>)?.referenceType || '').trim().toLowerCase() === 'character'
  const productionMeta = React.useMemo(
    () => getNodeProductionMeta({ type: 'taskNode', data }),
    [data],
  )
  const productionMetadata = React.useMemo(
    () => readChapterGroundedProductionMetadata((data as Record<string, unknown>)?.productionMetadata),
    [data],
  )
  const sbaPresentation = React.useMemo(
    () => readSbaNodePresentation(data as Record<string, unknown>),
    [data],
  )
  const schema = React.useMemo(() => getTaskNodeSchema(kind), [kind])
  const NodeIcon = schema.icon
  const featureFlags = React.useMemo<TaskNodeFeatureFlags>(
    () => buildTaskNodeFeatureFlags(schema, kind),
    [schema, kind],
  )
  const {
    hasImage,
    hasImageResults,
    hasImageUpload: supportsImageUpload,
    hasReversePrompt: supportsReversePrompt,
    hasVideo,
    hasVideoResults,
    hasAudio: isAudioNode,
    hasSubtitle: isSubtitleNode,
    hasCharacter: isCharacterNode,
    hasModelSelect,
    hasSampleCount,
    hasAspect,
    hasImageSize,
    hasOrientation,
    hasDuration,
    hasStoryboardEditor,
  } = featureFlags
  const isVideoAnalysisNode = kind === 'videoAnalysis'
  const isShotTableNode = kind === 'shotTable'
  const isWorkflowStageNode = kind === 'workflowStage'
  const isWorkflowTriggerNode = kind === 'workflowTrigger'
  const isStructuredWorkflowNode = isVideoAnalysisNode || isShotTableNode || isWorkflowStageNode || isWorkflowTriggerNode
  const isPlainTextNode = coreKind === 'text' && !isStructuredWorkflowNode
  const isVideoNode = coreKind === 'video'
  const isSegmentRemakeNode = isVideoNode && (data as Record<string, unknown>).segmentRemake === true
  const isOrchestratedVideoClip = isVideoNode && Boolean(readVideoClipRunId(data))
  const referenceImageLimitRef = React.useRef(
    isVideoNode
      ? DEFAULT_VIDEO_REFERENCE_IMAGE_LIMIT
      : DEFAULT_IMAGE_NODE_REFERENCE_IMAGE_LIMIT,
  )
  const isVideoComposeNode = kind === 'videoCompose'
  const isStoryboardEditorNode = hasStoryboardEditor
  const targets: { id: string; type: string; pos: Position; label?: string }[] = []
  const sources: { id: string; type: string; pos: Position; label?: string }[] = []
  const schemaHandles = schema.handles
  const workflowPorts = isWorkflowStageNode || isWorkflowTriggerNode
    ? readWorkflowCanvasPorts(data as Record<string, unknown>)
    : null
  const workflowNodeData = data as Record<string, unknown>
  if (workflowPorts) {
    workflowPorts.inputs.forEach((portId) => targets.push({
      id: workflowPortHandleId('input', portId),
      type: 'workflow',
      pos: Position.Left,
      label: portId,
    }))
    workflowPorts.outputs.forEach((portId) => sources.push({
      id: workflowPortHandleId('output', portId),
      type: 'workflow',
      pos: Position.Right,
      label: portId,
    }))
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
  const referenceHandles = buildWorkflowAgentReferenceHandles(workflowNodeData)
  targets.push(...referenceHandles.targets)
  sources.push(...referenceHandles.sources)
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
  const [isAspectTransitioning, setIsAspectTransitioning] = React.useState(false)
  const aspectTransitionTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // Actions are module-level stable refs in Zustand — subscribing creates 13 wasted listeners per node.
  // Read directly from getState() instead; the values are guaranteed identical across renders.
  const updateNodeLabel = useRFStore.getState().updateNodeLabel
  const { currentProject, viewOnly } = useCanvasRenderContext()
  const nodeReadOnly = viewOnly || (data as { readOnly?: unknown } | undefined)?.readOnly === true
  const canvasReferencePicker = useUIStore(s => s.canvasReferencePicker)
  const openCanvasReferencePicker = useUIStore.getState().openCanvasReferencePicker
  const closeCanvasReferencePicker = useUIStore.getState().closeCanvasReferencePicker
  const syncCreationSessionCheckpoint = useUIStore.getState().syncCreationSessionCheckpoint
  const failCreationSession = useUIStore.getState().failCreationSession
  const runSelected = useRFStore.getState().runSelected
  const cancelNodeExecution = useRFStore.getState().cancelNode
  const setNodeStatus = useRFStore.getState().setNodeStatus
  const updateNodeData = useRFStore.getState().updateNodeData
  const appendLog = useRFStore.getState().appendLog
  const addNode = useRFStore.getState().addNode
  const inheritUpstreamConnections = useRFStore.getState().inheritUpstreamConnections
  const setCanvasViewLocked = useRFStore.getState().setCanvasViewLocked
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
  const storyboardEditorInitRef = React.useRef(false)
  React.useEffect(() => {
    if (!isStoryboardEditorNode || storyboardEditorInitRef.current) return
    const record = data as Record<string, unknown>
    const hasStoryboardEditorShape =
      Array.isArray(record.storyboardEditorCells) &&
      typeof record.storyboardEditorGrid === 'string' &&
      typeof record.storyboardEditorAspect === 'string'
    storyboardEditorInitRef.current = true
    if (!hasStoryboardEditorShape) {
      updateNodeData(id, buildDefaultStoryboardEditorData())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStoryboardEditorNode, id, updateNodeData])
  const textFontSize = Math.max(12, Math.min(48, Number((data as any)?.textFontSize) || 16))
  const textFontWeight = Math.max(300, Math.min(800, Number((data as any)?.textFontWeight) || 500))
  const textColor = String((data as any)?.textColor || (isDarkUi ? '#f6f7f8' : '#131316'))
  const textBackgroundColor = String((data as any)?.textBackgroundColor || (isDarkUi ? 'rgba(12,17,28,0.88)' : 'rgba(248,250,255,0.95)'))
  const [aspect, setAspect] = React.useState<string>(() => {
    const dataAspect = (data as Record<string, unknown>)?.aspect
    const fallbackAspect = isVideoNode
      ? readNodeModelPrefs().videoAspect || DEFAULT_GENERATION_PREFS.videoAspect
      : undefined
    return normalizeImageAspect(dataAspect ?? fallbackAspect)
  })
  const [imageSize, setImageSize] = React.useState<string>(() =>
    (data as any)?.imageSize || readNodeModelPrefs().imageSize || DEFAULT_GENERATION_PREFS.imageSize,
  )
  const [imageResolution, setImageResolution] = React.useState<string>(
    normalizeImageResolutionSetting((data as any)?.imageResolution ?? (data as any)?.resolution ?? ''),
  )
  const [imageQuality, setImageQuality] = React.useState<string>(
    normalizeImageQualitySetting((data as Record<string, unknown>)?.imageQuality),
  )
  const [imageEditSize, setImageEditSize] = React.useState<string>(() =>
    kind === 'imageEdit'
      ? normalizeImageEditSize((data as Record<string, unknown>)?.imageEditSize ?? (data as Record<string, unknown>)?.size)
      : DEFAULT_IMAGE_EDIT_SIZE,
  )
  const [sampleCount, setSampleCount] = React.useState<number>((data as any)?.sampleCount || 1)
  // 单次点击生成份数（视频节点）：>1 时克隆同节点并行执行，继承上下游连线
  const [runCount, setRunCount] = React.useState<number>(() => {
    const raw = Number((data as any)?.runCount)
    return Number.isFinite(raw) && raw >= 1 ? Math.min(8, Math.floor(raw)) : 1
  })
  // Zustand runs every selector after every store update, including each drag
  // position frame. Keep the subscribed selector O(1); derive inbound edges
  // only when the edges collection actually changes. The previous selector
  // filtered all edges once per mounted TaskNode on every drag frame.
  const canvasEdges = useRFStore((state) => state.edges)
  const edgesForCharacters = React.useMemo(
    () => canvasEdges.filter((edge) => edge.target === id),
    [canvasEdges, id],
  )
  const upstreamVideosDuringDragRef = React.useRef<ComposeVideoSource[]>([])
  const upstreamVideosSelector = React.useMemo(() => {
    let lastNodes: ReturnType<typeof useRFStore.getState>['nodes'] | null = null
    let lastEdges: ReturnType<typeof useRFStore.getState>['edges'] | null = null
    let lastResult: ComposeVideoSource[] = []
    return (
      (s: RFStoreSnapshot): ComposeVideoSource[] => {
        if (!isVideoComposeNode || isOrchestratedVideoClip) return lastResult
        if (isCanvasNodeDragActive()) return upstreamVideosDuringDragRef.current
        if (s.nodes === lastNodes && s.edges === lastEdges) return lastResult
        const incoming = s.edges.filter((e) => e.target === id)
        const results: ComposeVideoSource[] = []
        for (const edge of incoming) {
          const srcNode = s.nodes.find((n) => n.id === edge.source)
          if (!srcNode) continue
          const srcData: any = srcNode.data || {}
          const srcSchema = getTaskNodeSchema(srcData?.kind)
          if (srcSchema.category !== 'video') continue
          const vr = Array.isArray(srcData.videoResults) ? srcData.videoResults : []
          const idx = typeof srcData.videoPrimaryIndex === 'number' ? srcData.videoPrimaryIndex : 0
          const primary = vr[idx] || vr[0]
          const url: string | undefined = primary?.url || srcData.videoUrl
          if (url) {
            results.push({
              url,
              title: primary?.title || (srcData.label as string | undefined) || undefined,
              thumbnailUrl: (primary?.thumbnailUrl as string | undefined) || undefined,
              durationSec: typeof primary?.duration === 'number'
                ? primary.duration
                : typeof srcData.videoDuration === 'number' ? srcData.videoDuration : undefined,
              dialoguePrompt: typeof srcData.prompt === 'string' && srcData.prompt.trim() ? srcData.prompt : undefined,
            })
          }
        }
        // 【cut 模式无连线兜底】整片成片节点与 N 段 clip 常只靠 clipRunId 关联、无 edge（用户要的「不依赖
        // 前端 DAG」）。边收不到 clip 时，按本成片节点的 clipRunId 收齐同 run 的 video 节点、按 clipIndex 排序，
        // 让用户点「合成视频」时收得到源（根治：run=concatenated 但成片节点 clips_ready 无 videoUrl 的回写缺口）。
        if (results.length < 2) {
          const selfNode = s.nodes.find((n) => n.id === id)
          const runId = (selfNode?.data as any)?.clipRunId
          if (runId) {
            const byRun: ComposeVideoSource[] = []
            s.nodes
              .filter((n) => {
                const d: any = n.data || {}
                return (
                  n.id !== id &&
                  d.clipRunId === runId &&
                  typeof d.clipIndex === 'number' &&
                  getTaskNodeSchema(d?.kind).category === 'video'
                )
              })
              .sort((a, b) => ((a.data as any)?.clipIndex ?? 0) - ((b.data as any)?.clipIndex ?? 0))
              .forEach((n) => {
                const d: any = n.data || {}
                const vr = Array.isArray(d.videoResults) ? d.videoResults : []
                const idx = typeof d.videoPrimaryIndex === 'number' ? d.videoPrimaryIndex : 0
                const primary = vr[idx] || vr[0]
                const url: string | undefined = primary?.url || d.videoUrl
                if (url) {
                  byRun.push({
                    url,
                    title: primary?.title || (d.label as string | undefined) || undefined,
                    thumbnailUrl: (primary?.thumbnailUrl as string | undefined) || undefined,
                    durationSec: typeof primary?.duration === 'number'
                      ? primary.duration
                      : typeof d.videoDuration === 'number' ? d.videoDuration : undefined,
                    dialoguePrompt: typeof d.prompt === 'string' && d.prompt.trim() ? d.prompt : undefined,
                  })
                }
              })
            if (byRun.length > results.length) {
              lastNodes = s.nodes
              lastEdges = s.edges
              lastResult = byRun
              return lastResult
            }
          }
        }
        lastNodes = s.nodes
        lastEdges = s.edges
        lastResult = results
        upstreamVideosDuringDragRef.current = results
        return lastResult
      }
    )
  }, [id, isOrchestratedVideoClip, isVideoComposeNode])
  // useRFStore is created with Zustand's standard `create`; returning a fresh
  // array from its selector makes useSyncExternalStore see a new snapshot on
  // every render. Cache by the structural nodes/edges identities instead of
  // relying on a second equality argument that this hook does not own.
  const upstreamVideos = useRFStore(upstreamVideosSelector)
  const [composeEditorOpen, setComposeEditorOpen] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement|null>(null)
  const pendingImageUploadActionRef = React.useRef<'image-to-image' | 'image-upscale' | null>(null)
  const imageUrl = (data as any)?.imageUrl as string | undefined
  const imageServerAssetId = (data as any)?.serverAssetId as string | undefined
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
  upstreamVideosDuringDragRef.current = upstreamVideos
  const nodeHasPendingUploads = nodePendingUploadCount > 0
  const isUploadingImage = nodeHasUploadIntent || nodeHasPendingUploads
  const [reversePromptLoading, setReversePromptLoading] = React.useState(false)
  const reversePromptInFlightRef = React.useRef(false)
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
  const [imagePrimaryIndex, setImagePrimaryIndex] = React.useState<number>(() =>
    persistedImagePrimaryIndex !== null ? persistedImagePrimaryIndex : 0,
  )
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
  const semanticRoleBinding = React.useMemo(() => resolveSemanticNodeRoleBinding(data), [data])
  const autoRoleResolvedRef = React.useRef<string>('')

  React.useEffect(() => {
    if (viewOnly) return
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
  }, [currentProject?.id, data, id, semanticRoleBinding.roleCardId, semanticRoleBinding.roleId, semanticRoleBinding.roleName, updateNodeData, viewOnly])

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

  // 场景/角色参考图生成完成后，将 imageUrl 同步到服务端 canvas-index.json，供无 bookId 的 intent 复用
  const canvasIndexSyncedRef = React.useRef<string>('')
  React.useEffect(() => {
    // 只读浏览（分享/制作过程，未登录）下不得写 canvas-index：owner-scoped 接口会 401。
    if (viewOnly) return
    // 角色裂变是待确认的设计候选，不得在生成成功时自动登记为 canonical 角色参考。
    if ((data as Record<string, unknown>).skipCanvasIndexSync === true) return
    if (status !== 'success') return
    const refType = String((data as any)?.referenceType || '').trim().toLowerCase()
    if (refType !== 'character' && refType !== 'scene') return
    const url = (primaryImageUrl || '').trim()
    if (!url) return
    const projectId = String(currentProject?.id || '').trim()
    if (!projectId) return
    const name = (
      refType === 'character'
        ? String((data as any)?.characterName || (data as any)?.label || '').trim()
        : String((data as any)?.label || '').trim()
    )
    if (!name) return
    const syncKey = `${id}::${url}`
    if (canvasIndexSyncedRef.current === syncKey) return
    canvasIndexSyncedRef.current = syncKey
    upsertCanvasIndexRef({
      projectId,
      nodeId: id,
      sourceNodeId: String((data as any)?.sourceNodeId || '').trim() || undefined,
      referenceType: refType as 'character' | 'scene',
      name,
      imageUrl: url,
      prompt: String((data as any)?.prompt || '').trim() || undefined,
      modelKey: String((data as any)?.imageModel || '').trim() || undefined,
      imageSize: String((data as any)?.imageSize || '').trim() || undefined,
      creationStage: String((data as any)?.creationStage || '').trim() || undefined,
    }).catch(() => {})
  }, [status, primaryImageUrl, currentProject?.id, data, id, viewOnly])

  // Auto-upload third-party external images to OSS when imageUrl is an http(s) URL but has no serverAssetId yet.
  // Already-hosted TapCanvas upload URLs may lose serverAssetId in old persisted flows; do not re-upload them on refresh.
  const ossUploadInProgressRef = React.useRef(false)
  React.useEffect(() => {
    if (!imageUrl) return
    if (imageServerAssetId) return
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) return
    if (isTapCanvasHostedUploadUrl(imageUrl)) return
    if (ossUploadInProgressRef.current) return
    const projectId = String(currentProject?.id || '').trim()
    ossUploadInProgressRef.current = true
    uploadExternalImageToOss(imageUrl, {
      name: `node-img-${id}-${Date.now()}.jpg`,
      ...(projectId ? { projectId } : {}),
      ownerNodeId: id,
    })
      .then(({ url, assetId }) => {
        updateNodeData(id, { imageUrl: url, serverAssetId: assetId })
      })
      .catch(() => {
        // Silently ignore — image stays as-is, user can retry manually
      })
      .finally(() => {
        ossUploadInProgressRef.current = false
      })
  // Only re-run when imageUrl or serverAssetId identity changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, imageServerAssetId])

  const onReversePrompt = React.useCallback(async () => {
    if (!supportsReversePrompt) return
    if (reversePromptInFlightRef.current) return

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
      reversePromptInFlightRef.current = true
      setReversePromptLoading(true)
      if (!hasAuthSession()) {
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
      // Align with the project's style-recognition pipeline: route through the
      // unified /tasks endpoint with kind=image_to_prompt so this run shares
      // billing, vendor selection, and vendor_call_log with PoseEditor's depth
      // analyzer. Hard-coded direct calls via /agents/llm/v1/chat/completions
      // bypassed all of that.
      const taskRes = await runVisionTask({
        imageUrl: resolved.url,
        prompt: DEFAULT_REVERSE_PROMPT_INSTRUCTION,
      })
      const nextPrompt = extractTextFromTaskResult(taskRes).trim()
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
      reversePromptInFlightRef.current = false
      setReversePromptLoading(false)
    }
  }, [supportsReversePrompt, primaryImageUrl, imageResults, imagePrimaryIndex, imageUrl, id, updateNodeData, setPrompt])

  const basePoseImage = React.useMemo(
    () => primaryImageUrl || imageResults[imagePrimaryIndex]?.url || imageResults[0]?.url || '',
    [imagePrimaryIndex, imageResults, primaryImageUrl],
  )

  const videoUrl = ((data as any)?.videoUrl as string | undefined) ?? null
  const rawVideoThumbnailUrl = (data as { videoThumbnailUrl?: unknown })?.videoThumbnailUrl
  const videoThumbnailUrl = typeof rawVideoThumbnailUrl === 'string' && rawVideoThumbnailUrl.trim()
    ? rawVideoThumbnailUrl.trim()
    : resolveVideoInputPosterUrl(data)
  const videoTitle = ((data as any)?.videoTitle as string | undefined) ?? null
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
      }))
    }
    const single = videoUrl
      ? {
          url: videoUrl,
          thumbnailUrl: videoThumbnailUrl,
          title: videoTitle,
          duration: (data as any)?.videoDuration,
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
  const [videoMarkerOpen, setVideoMarkerOpen] = React.useState(false)
  const [videoMarkerSaving, setVideoMarkerSaving] = React.useState(false)
  const [videoMarkerPlayback, setVideoMarkerPlayback] = React.useState<{
    currentTime: number
    duration: number | null
  }>({ currentTime: 0, duration: null })
  const videoMarkers = React.useMemo(
    () => normalizeVideoMarkers((data as Record<string, unknown>).videoMarkers),
    [data],
  )

	  // 旧版基于 Sora 的角色创建能力已移除（不再依赖前端配置 Token/厂商）。

  const persistedCharacterRewriteModel = (data as any)?.characterRewriteModel
  const [characterRewriteModel, setCharacterRewriteModel] = React.useState<string>(() => {
    const stored = persistedCharacterRewriteModel
    return typeof stored === 'string' && stored.trim() ? stored : 'glm-4.6'
  })
  const [characterRewriteLoading, setCharacterRewriteLoading] = React.useState(false)
  const [characterRewriteError, setCharacterRewriteError] = React.useState<string | null>(null)

  const [promptSamplesOpen, setPromptSamplesOpen] = React.useState(false)
  const [stylePickerOpen, setStylePickerOpen] = React.useState(false)
  const [styleImagePickerOpen, setStyleImagePickerOpen] = React.useState(false)
  const [mediaPromptLibraryKind, setMediaPromptLibraryKind] = React.useState<MediaPromptLibraryKind | null>(null)
  const [characterLibraryOpen, setCharacterLibraryOpen] = React.useState(false)
  const [cameraControlOpen, setCameraControlOpen] = React.useState(false)
  const [mediaFocusOptionsOpen, setMediaFocusOptionsOpen] = React.useState(false)
  const latestTextResult = resolveTextNodeLatestResult(data as TextNodeDisplaySource)
  const [modelKey, setModelKey] = React.useState<string>(() => {
    const value = (data as Record<string, unknown>).geminiModel
    return typeof value === 'string' ? value.trim() : ''
  })
  const [imageModel, setImageModel] = React.useState<string>(() => {
    const value = (data as Record<string, unknown>).imageModel
    if (typeof value === 'string' && value.trim()) return value.trim()
    return String(readNodeModelPrefs().imageModel || DEFAULT_GENERATION_PREFS.imageModel).trim()
  })
  const [videoModel, setVideoModel] = React.useState<string>(() => {
    const value = (data as Record<string, unknown>).videoModel
    if (typeof value === 'string' && value.trim()) return value.trim()
    return String(readNodeModelPrefs().videoModel || DEFAULT_GENERATION_PREFS.videoModel).trim()
  })
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
      15,
    )
  })
  const [videoGenerateAudio, setVideoGenerateAudio] = React.useState<boolean>(
    () => (data as Record<string, unknown>)?.videoGenerateAudio !== false,
  )
  const [videoSize, setVideoSize] = React.useState<string>(() => {
    const raw = typeof (data as any)?.videoSize === 'string' ? String((data as any).videoSize).trim() : ''
    return raw.replace(/\s+/g, '')
  })
  const [videoResolution, setVideoResolution] = React.useState<string>(() => {
    const dataRecord = data as Record<string, unknown>
    return normalizeVideoResolution(
      dataRecord.videoResolution
      ?? dataRecord.resolution
      ?? readNodeModelPrefs().videoResolution
      ?? DEFAULT_GENERATION_PREFS.videoResolution,
    )
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
  const { selectedNodeCount, isBoxSelecting } = useCanvasRenderContext()
  const isSingleSelectionActive = Boolean(selected && !dragging && !isBoxSelecting && selectedNodeCount <= 1)
  const wantsCharacterRefs = isSingleSelectionActive
  const characterRefs = useStableRFStoreSelection(
    React.useCallback((s): CharacterRef[] => {
      if (!wantsCharacterRefs) return EMPTY_CHARACTER_REFS
      const results: CharacterRef[] = []
      s.nodes.forEach((node) => {
        const nodeKind = (node.data as any)?.kind
        const nodeSchema = getTaskNodeSchema(nodeKind)
        if (!nodeSchema.features.includes('character')) return
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
        const assetUrl = readPrimaryReferenceAssetUrl(payload)
        results.push({
          nodeId: node.id,
          username,
          displayName,
          rawLabel: payload.label || '',
          source: 'character',
          assetUrl: assetUrl || null,
        })
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
  const canvasAssetMentionRefs = useStableRFStoreSelection(
    React.useCallback((s): CharacterRef[] => {
      if (!wantsCharacterRefs) return EMPTY_CHARACTER_REFS
      const directSourceIds = new Set<string>()
      for (const edge of s.edges) {
        if (edge.target === id) directSourceIds.add(edge.source)
      }
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
          isConnected: directSourceIds.has(node.id),
        })
      })
      return results.filter((ref) => ref.username)
    }, [id, wantsCharacterRefs]),
    areCharacterRefsEqual,
  )
  const [projectAssetMentionRefs, setProjectAssetMentionRefs] = React.useState<CharacterRef[]>(EMPTY_CHARACTER_REFS)
  React.useEffect(() => {
    const projectId = String(currentProject?.id || '').trim()
    if (viewOnly || !projectId || !wantsCharacterRefs) {
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
  }, [currentProject?.id, projectRoleRefsVersion, wantsCharacterRefs, viewOnly])
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
  const shotTableAssetReferences = React.useMemo<ShotTableAssetReference[]>(() => {
    const references = new Map<string, ShotTableAssetReference>()
    const append = (ref: CharacterRef): void => {
      const username = String(ref.username || '').trim()
      if (!username) return
      const source = ref.nodeId.startsWith('project-') ? 'project' : 'canvas'
      const key = `${source}:${ref.nodeId}:${ref.assetId ?? ''}:${username.toLocaleLowerCase()}`
      if (references.has(key)) return
      references.set(key, {
        id: key,
        username,
        displayName: String(ref.displayName || ref.rawLabel || username).trim(),
        source,
        nodeId: source === 'canvas' ? ref.nodeId : null,
        assetUrl: ref.assetUrl ?? null,
        assetId: ref.assetId ?? null,
        assetRefId: ref.assetRefId ?? username,
        assetName: String(ref.assetName || ref.displayName || username).trim(),
      })
    }
    mergedCharacterRefs.forEach(append)
    mergedAssetMentionRefs.forEach(append)
    return Array.from(references.values())
  }, [mergedAssetMentionRefs, mergedCharacterRefs])
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
  const handleMentionApplied = React.useCallback((item: MentionSuggestionItem) => {
    if (
      item.nodeId &&
      !item.nodeId.startsWith('mention:') &&
      !item.nodeId.startsWith('upstream-ref:')
    ) {
      const rfState = useRFStore.getState()
      const alreadyConnected = rfState.edges.some(
        (e) => e.source === item.nodeId && e.target === id,
      )
      if (!alreadyConnected) {
        rfState.onConnect({ source: item.nodeId!, target: id, sourceHandle: null, targetHandle: null })
      }
    }
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
      : [...existingReferenceImages, assetBinding.url].slice(0, referenceImageLimitRef.current)
    const existingAssetInputs = Array.isArray(nodeData.assetInputs)
      ? nodeData.assetInputs.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      : []
    const existingIndex = existingAssetInputs.findIndex((entry) => {
      const record = entry as Record<string, unknown>
      return typeof record.url === 'string' && record.url.trim() === assetBinding.url
    })
    const nextAssetInput = {
      url: assetBinding.url,
      role: assetBinding.role || 'reference',
      ...(assetBinding.assetId ? { assetId: assetBinding.assetId } : null),
      ...(assetBinding.assetRefId ? { assetRefId: assetBinding.assetRefId } : null),
      ...(assetBinding.assetName ? { name: assetBinding.assetName } : null),
    }
    const nextAssetInputs =
      existingIndex >= 0
        ? existingAssetInputs.map((entry, index) => (index === existingIndex ? { ...(entry as Record<string, unknown>), ...nextAssetInput } : entry))
        : [...existingAssetInputs, nextAssetInput].slice(0, referenceImageLimitRef.current)
    updateNodeData(id, {
      referenceImages: nextReferenceImages,
      assetInputs: nextAssetInputs,
    })
  }, [data, id, updateNodeData])

  const handlePickFromLibrary = React.useCallback(() => {
    const nodeData = (data && typeof data === 'object' && !Array.isArray(data))
      ? data as Record<string, unknown>
      : {}
    const existing: string[] = Array.isArray(nodeData.referenceImages)
      ? (nodeData.referenceImages as unknown[]).map((v) => String(v || '').trim()).filter(Boolean)
      : []
    const referenceImageLimit = referenceImageLimitRef.current
    if (existing.length >= referenceImageLimit) {
      toast(`当前模型最多支持 ${referenceImageLimit} 张参考图，请先移除部分参考图`, 'warning')
      return
    }
    setStylePickerOpen(true)
  }, [data])

  // 风格基底 / 摄影机控制是项目级配置：所有图片节点共享，任一节点修改会同步全部。
  const projectIdForImageSettings = useUIStore((s) => String(s.currentProject?.id || ''))
  const projectImageSettingsBase = useProjectImageSettings(projectIdForImageSettings)
  const currentChapterCreativeOverride = useUIStore((s) => s.currentChapterCreativeOverride)
  const projectImageSettings = React.useMemo(
    () => mergeChapterCreativeOverrideIntoProjectImageSettings(
      projectImageSettingsBase,
      currentChapterCreativeOverride,
    ),
    [currentChapterCreativeOverride, projectImageSettingsBase],
  )

  const styleImages: string[] = React.useMemo(() => {
    if (projectImageSettings.styleImages.length) return projectImageSettings.styleImages
    // 兼容旧画布：节点级数据作为 fallback
    const s = (data as Record<string, unknown>)?.styleImages
    return Array.isArray(s) ? (s as unknown[]).map((v) => String(v || '').trim()).filter(Boolean) : []
  }, [projectImageSettings.styleImages, data])

  const imageCinematicCamera: CinematicCameraValue | null = React.useMemo(() => {
    if (projectImageSettings.imageCinematicCamera) return projectImageSettings.imageCinematicCamera
    // 兼容旧画布：节点级数据作为 fallback
    const c = (data as Record<string, unknown>)?.imageCinematicCamera as Record<string, unknown> | null | undefined
    if (!c || typeof c !== 'object') return null
    return c as unknown as CinematicCameraValue
  }, [projectImageSettings.imageCinematicCamera, data])

  const handleStyleImageConfirm = React.useCallback((url: string) => {
    if (!url || !projectIdForImageSettings) return
    const current = styleImages.includes(url)
      ? styleImages.filter((u) => u !== url)
      : [...styleImages, url]
    useProjectImageSettingsStore.getState().setStyleImages(projectIdForImageSettings, current)
  }, [styleImages, projectIdForImageSettings])

  const handleCinematicCameraChange = React.useCallback((cam: Omit<CinematicCameraValue, 'enabled'>) => {
    if (!projectIdForImageSettings) return
    useProjectImageSettingsStore.getState().setCinematicCamera(
      projectIdForImageSettings,
      { enabled: true, ...cam },
    )
  }, [projectIdForImageSettings])

  const handleStyleClear = React.useCallback(() => {
    if (!projectIdForImageSettings) return
    // 单轨约定：节点「风格」chip 移除 = 取消整个画风锚定（连 lockedStyle 元信息与服务端持久化一起清），
    // 否则 lockedStyle 残留会让生成层把画风参考悄悄注回来（黑盒复活）。
    useProjectImageSettingsStore.getState().setLockedStyle(projectIdForImageSettings, null)
  }, [projectIdForImageSettings])

  const handleStyleImageRemove = React.useCallback((url: string) => {
    if (!projectIdForImageSettings) return
    const remaining = styleImages.filter((u) => u !== url)
    const store = useProjectImageSettingsStore.getState()
    if (remaining.length === 0) {
      // 移除最后一张 = 整体取消画风锚定（单轨约定，与 chip ✕ 一致）
      store.setLockedStyle(projectIdForImageSettings, null)
    } else {
      store.setStyleImages(projectIdForImageSettings, remaining)
    }
  }, [styleImages, projectIdForImageSettings])

  const handleCameraClear = React.useCallback(() => {
    if (!projectIdForImageSettings) return
    useProjectImageSettingsStore.getState().setCinematicCamera(projectIdForImageSettings, null)
  }, [projectIdForImageSettings])

  const handleStylePickerSelect = React.useCallback((url: string) => {
    const nodeData = (data && typeof data === 'object' && !Array.isArray(data))
      ? data as Record<string, unknown>
      : {}
    const existing: string[] = Array.isArray(nodeData.referenceImages)
      ? (nodeData.referenceImages as unknown[]).map((v) => String(v || '').trim()).filter(Boolean)
      : []
    if (existing.includes(url)) return
    const referenceImageLimit = referenceImageLimitRef.current
    const nextReferenceImages = [...existing, url].slice(0, referenceImageLimit)
    const existingAssetInputs: unknown[] = Array.isArray(nodeData.assetInputs)
      ? (nodeData.assetInputs as unknown[]).filter((e) => e && typeof e === 'object')
      : []
    const nextAssetInputs = [...existingAssetInputs, { url, role: 'reference' }].slice(0, referenceImageLimit)
    updateNodeData(id, { referenceImages: nextReferenceImages, assetInputs: nextAssetInputs })
  }, [data, id, updateNodeData])

  const storedAudioModel = typeof (data as Record<string, unknown>).audioModel === 'string'
    ? String((data as Record<string, unknown>).audioModel).trim()
    : ''
  const activeModelKey = isAudioNode
    ? storedAudioModel
    : isVideoNode
    ? videoModel
    : coreKind === 'image' || kind === 'imageEdit'
      ? imageModel
      : modelKey
  const modelCatalogKind: NodeKind = isAudioNode
    ? 'audio'
    : isVideoNode
      ? 'video'
      : coreKind === 'image' || kind === 'imageEdit'
        ? kind === 'imageEdit' ? 'imageEdit' : 'image'
        : 'text'
  const shouldLoadPrimaryModelCatalog = !viewOnly
    && !isStructuredWorkflowNode
    && (hasModelSelect || isAudioNode)
  const {
    options: modelList,
    loading: modelListLoading,
    error: modelListError,
    retry: retryModelList,
  } = useModelOptionsState(modelCatalogKind, { enabled: shouldLoadPrimaryModelCatalog })
  const modelMenuOptions = React.useMemo<ModelOption[]>(() => {
    return modelList.map((option) => ({
      ...option,
      label: getTaskNodeModelDisplayLabel(option),
    }))
  }, [modelList])
  const {
    options: videoActionModelList,
    loading: videoActionModelListLoading,
    error: videoActionModelListError,
  } = useModelOptionsState('video', {
    enabled: shouldLoadPrimaryModelCatalog && isVideoNode,
    includeActionModels: true,
  })
  const usePrimaryImageEditCatalog = modelCatalogKind === 'image' || modelCatalogKind === 'imageEdit'
  const {
    options: secondaryImageEditOptions,
    loading: secondaryImageEditLoading,
    error: secondaryImageEditError,
  } = useModelOptionsState('imageEdit', {
    enabled: !viewOnly && coreKind === 'image' && !usePrimaryImageEditCatalog,
  })
  const imageEditActionOptions = usePrimaryImageEditCatalog ? modelMenuOptions : secondaryImageEditOptions
  const imageEditActionLoading = usePrimaryImageEditCatalog ? modelListLoading : secondaryImageEditLoading
  const imageEditActionError = usePrimaryImageEditCatalog ? modelListError : secondaryImageEditError
  const resolveImageEditModelForAction = React.useCallback((requestedValue?: string | null): string | null => {
    if (imageEditActionLoading) {
      toast('图片模型目录仍在加载，请稍后重试', 'error')
      return null
    }
    if (imageEditActionError) {
      toast(`图片模型目录加载失败：${imageEditActionError.message}`, 'error')
      return null
    }
    if (!imageEditActionOptions.length) {
      toast('没有可用图片模型，请先在系统模型管理中配置渠道、协议与价格', 'error')
      return null
    }
    const requestedModel = String(requestedValue ?? imageModel ?? '').trim()
    if (requestedModel) {
      const matched = findModelOptionByIdentifier(imageEditActionOptions, requestedModel)
      if (!matched) {
        toast(`图片模型 ${requestedModel} 当前不可用，请重新选择后重试`, 'error')
        return null
      }
      return matched.value
    }
    return imageEditActionOptions[0]?.value || null
  }, [imageEditActionError, imageEditActionLoading, imageEditActionOptions, imageModel])
  const selectedActiveModelOption = React.useMemo(
    () => findModelOptionByIdentifier(modelMenuOptions, activeModelKey),
    [activeModelKey, modelMenuOptions],
  )
  React.useEffect(() => {
    if (viewOnly || isAudioNode) return
    const firstOption = resolveDefaultCatalogModelOption({
      currentValue: activeModelKey,
      options: modelMenuOptions,
      loading: modelListLoading,
      error: modelListError,
    })
    if (!firstOption) return
    const firstValue = firstOption.value.trim()
    if (isVideoNode) {
      setVideoModel(firstValue)
      updateNodeData(id, { videoModel: firstValue, videoModelVendor: firstOption.vendor || null })
      return
    }
    if (coreKind === 'image' || kind === 'imageEdit') {
      setImageModel(firstValue)
      updateNodeData(id, { imageModel: firstValue, imageModelVendor: null })
      return
    }
    setModelKey(firstValue)
    updateNodeData(id, { geminiModel: firstValue, modelVendor: firstOption.vendor || null })
  }, [
    activeModelKey,
    coreKind,
    id,
    isAudioNode,
    isVideoNode,
    kind,
    modelListError,
    modelListLoading,
    modelMenuOptions,
    updateNodeData,
    viewOnly,
  ])
  const findVendorForModel = React.useCallback(
    (value: string | null | undefined) => {
      if (!value) return null
      const match = findModelOptionByIdentifier(modelList, value)
      return match?.vendor || null
    },
    [modelList],
  )
  const handleApplyImageViewEdit = React.useCallback(
    async ({ cameraControl, lightingRig, lightingControlState, smartPrompt, lightingReferenceImageUrl }: ImageViewEditorApplyPayload) => {
      const normalizedBaseImageUrl = String(basePoseImage || '').trim()
      if (!normalizedBaseImageUrl) {
        throw new Error('请先上传或生成图片')
      }

      const normalizedCameraControl = normalizeImageCameraControl(cameraControl)
      const normalizedLightingRig = normalizeImageLightingRig(lightingRig)
      const shouldPersistCamera = hasActiveImageCameraControl(normalizedCameraControl)
      const shouldPersistLighting = lightingControlState.directionEnabled
        || lightingControlState.brightnessEnabled
        || lightingControlState.colorEnabled
        || lightingControlState.rimEnabled
      const activeSmartPrompt = lightingControlState.smartMode ? (smartPrompt || '').trim() : ''
      const activeLightingReferenceImageUrl = lightingControlState.smartMode
        ? lightingReferenceImageUrl
        : null
      const hasLightingReference = Boolean(activeLightingReferenceImageUrl)

      if (!shouldPersistCamera && !shouldPersistLighting && !activeSmartPrompt && !hasLightingReference) {
        throw new Error('请先启用角度或灯光控制')
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
      const relightDims = parseImageEditSizeDimensions(nextImageEditSize)
      const relightImageSize: '1K' | '2K' =
        Math.max(relightDims.width, relightDims.height) >= 1700 ? '2K' : '1K'
      const operationKind: ImageOperationKind = shouldPersistLighting ? 'relight' : 'multi_angle'
      const mainLightDirection = findClosestLightDirection(LIBTV_MAIN_LIGHT_DIRECTIONS, normalizedLightingRig.main)
      const rimLightDirection = findClosestLightDirection(LIBTV_RIM_LIGHT_DIRECTIONS, normalizedLightingRig.fill)
      const libTvLightingParameters = buildLibTvLightingOperationParameters({
        ...lightingControlState,
        mainDirectionKey: mainLightDirection.key,
        rimDirectionKey: rimLightDirection.key,
        colorHex: normalizedLightingRig.main.colorHex,
        brightness: normalizedLightingRig.main.intensity,
        smartPrompt: activeSmartPrompt,
        referenceImageUrl: activeLightingReferenceImageUrl,
      })
      const imageOperationSpec = createImageOperationForSource({
        kind: operationKind,
        execution: 'image-edit',
        sourceNodeId: id,
        sourceUrl: normalizedBaseImageUrl,
        sourceRevision: readImageOperationSourceRevision(sourceDataRecord.imageOperationRevision),
        parameters: {
          ...libTvLightingParameters,
          ...(shouldPersistCamera ? { camera: normalizedCameraControl } : {}),
          ...(shouldPersistLighting ? { lightingRig: normalizedLightingRig } : {}),
          preserveIdentity: true,
          preserveLayout: true,
          preserveMaterials: true,
        },
        additionalInputs: activeLightingReferenceImageUrl
          ? [{ role: 'reference', url: activeLightingReferenceImageUrl }]
          : [],
      })

      addNode('taskNode', undefined, {
        kind: 'imageEdit',
        prompt: activeSmartPrompt,
        aspect: nextImageEditAspect,
        sampleCount: 1,
        imageModel: RELIGHT_MODEL_KEY,
        imageModelVendor: null,
        imageSize: relightImageSize,
        imageResolution: relightImageSize,
        resolution: relightImageSize,
        referenceImages: activeLightingReferenceImageUrl
          ? [normalizedBaseImageUrl, activeLightingReferenceImageUrl]
          : [normalizedBaseImageUrl],
        suppressUpstreamPrompts: true,
        imageOperationSpec,
        imageOperationState: createImageOperationState(imageOperationSpec),
        imageOperationRevision: 1,
        libTvImageOperationKey: shouldPersistLighting ? 'relight' : 'multi-angle',
        ...(Array.isArray(sourceDataRecord.assetInputs) ? { assetInputs: sourceDataRecord.assetInputs } : null),
        ...(shouldPersistCamera ? { imageCameraControl: normalizedCameraControl } : null),
        ...(shouldPersistLighting ? { imageLightingRig: normalizedLightingRig } : null),
      })

      const afterAdd = useRFStore.getState()
      const newNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
      if (!newNode) {
        throw new Error('图片编辑结果节点创建失败')
      }

      const sourceNode = afterAdd.nodes.find((node) => node.id === id)
      const targetPos = {
        x: (sourceNode?.position?.x || 0) + 380,
        y: sourceNode?.position?.y || 0,
      }
      afterAdd.onNodesChange([
        { id: newNode.id, type: 'position', position: targetPos, dragging: false },
        { id: id, type: 'select' as const, selected: false },
        { id: newNode.id, type: 'select', selected: true },
      ])
      afterAdd.onConnect({
        source: id,
        sourceHandle: 'out-image',
        target: newNode.id,
        targetHandle: 'in-image',
      })

      await runNodeDagToTarget(newNode.id, useRFStore.getState, useRFStore.setState, { concurrency: 1 })
    },
    [addNode, basePoseImage, data, id, imageEditSize, kind],
  )
  const lightingCreditCost = React.useMemo(() => {
    const sourceDataRecord = data as Record<string, unknown>
    const candidateSize = normalizeImageEditSize(
      kind === 'imageEdit'
        ? (sourceDataRecord.imageEditSize ?? sourceDataRecord.size)
        : imageEditSize,
    )
    const dims = parseImageEditSizeDimensions(candidateSize)
    const specKey = `image:${Math.max(dims.width, dims.height) >= 1700 ? '2k' : '1k'}`
    const relightOption = findModelOptionByIdentifier(modelList, RELIGHT_MODEL_KEY)
    if (!relightOption) return undefined
    const credits = resolveModelGenerationCredits({
      kind: 'imageEdit',
      modelOption: relightOption,
      specKey,
      quantity: sampleCount,
    })
    return credits > 0 ? credits : undefined
  }, [data, imageEditSize, kind, modelList, sampleCount])
  const handleUploadLightingReferenceImage = React.useCallback(async (file: File): Promise<string> => {
    const projectId = typeof currentProject?.id === 'string' ? currentProject.id.trim() : ''
    const uploaded = await uploadServerAssetFile(file, file.name || '打光参考图', {
      taskKind: 'image_edit',
      ownerNodeId: id,
      ...(projectId ? { projectId } : {}),
    })
    const url = readServerAssetHostedUrl(uploaded)
    if (!url) throw new Error('打光参考图上传成功，但返回结果缺少可用 URL')
    notifyAssetRefresh()
    return url
  }, [currentProject?.id, id])
  const { openCameraEditor, openLightingEditor, closeEditor: closeLightingEditor, modal: imageViewEditorModal, lightingToolbar: imageViewLightingToolbar, isEditorOpen: imageViewEditorOpen } = useImageViewEditor({
    baseImageUrl: basePoseImage,
    cameraControl: (data as Record<string, unknown>)?.imageCameraControl,
    lightingRig: (data as Record<string, unknown>)?.imageLightingRig,
    hasImages: imageResults.length > 0,
    isDarkUi,
    inlineDividerColor,
    nodeId: id,
    lightingCreditCost,
    onUploadLightingReferenceImage: handleUploadLightingReferenceImage,
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
    () =>
      constrainImageModelCatalogConfigByPricing(
        parseImageModelCatalogConfig(selectedImageModelMeta),
        selectedImageModelOption?.pricing,
      ),
    [selectedImageModelMeta, selectedImageModelOption?.pricing],
  )
  const videoModelConfig = React.useMemo(
    () => constrainVideoModelCatalogConfigByPricing(
      parseVideoModelCatalogConfig(selectedVideoModelMeta),
      selectedVideoModelOption?.pricing,
    ),
    [selectedVideoModelMeta, selectedVideoModelOption?.pricing],
  )
  const continuationDurationOptions = React.useMemo(() => {
    const max = videoModelConfig?.maxVideoExtensionDurationSeconds
    return (videoModelConfig?.durationOptions || [])
      .map((option) => option.value)
      .filter((value) => max === undefined || value <= max)
  }, [videoModelConfig])
  const videoEditModelOptions = React.useMemo(() => {
    return videoActionModelList
      .map((option) => ({ ...option, config: parseVideoModelCatalogConfig(option.meta) }))
      .filter((option) => option.config?.supportsVideoEditing === true)
  }, [videoActionModelList])
  const videoSubjectRemovalModelOptions = React.useMemo(
    () => videoEditModelOptions
      .filter((option) => option.config?.supportsVideoSubjectRemoval === true)
      .map((option) => option),
    [videoEditModelOptions],
  )
  const videoSubtitleRemovalModelOptions = React.useMemo(
    () => videoEditModelOptions
      .filter((option) => option.config?.supportsVideoSubtitleRemoval === true)
      .map((option) => option),
    [videoEditModelOptions],
  )
  React.useEffect(() => {
    referenceImageLimitRef.current = isVideoNode && videoModelConfig?.maxReferenceImages
      ? Math.max(1, Math.trunc(videoModelConfig.maxReferenceImages))
      : isVideoNode
        ? DEFAULT_VIDEO_REFERENCE_IMAGE_LIMIT
        : DEFAULT_IMAGE_NODE_REFERENCE_IMAGE_LIMIT
  }, [isVideoNode, videoModelConfig?.maxReferenceImages])
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
        label: option.label,
      })),
    [imageModelConfig],
  )
  const configuredImageResolutionOptions = React.useMemo(
    () =>
      (imageModelConfig?.resolutionOptions || []).map((option) => ({
        value: option.value,
        label: formatImageResolutionOptionLabel(option.label, option.value),
      })),
    [imageModelConfig],
  )
  const configuredImageQualityOptions = React.useMemo(
    () =>
      (imageModelConfig?.qualityOptions || []).map((option) => ({
        value: option.value,
        label: formatImageQualityOptionLabel(option.label, option.value),
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
        label: option.label,
      })),
    [videoModelConfig],
  )
  const configuredSizeOptions = React.useMemo(
    () =>
      (videoModelConfig?.sizeOptions || []).map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [videoModelConfig],
  )
  const configuredVideoResolutionOptions = React.useMemo(
    () =>
      (videoModelConfig?.resolutionOptions || []).map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [videoModelConfig],
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
  const imageSpecKey = React.useMemo(
    () =>
      buildImageBillingSpecKeyForOption({
        modelOption: selectedActiveModelOption,
        aspect,
        imageSize,
        imageResolution,
        imageQuality,
      }),
    [aspect, imageQuality, imageResolution, imageSize, selectedActiveModelOption],
  )
  const rewriteModelOptions = useModelOptions('text', {
    enabled: !viewOnly && !isStructuredWorkflowNode,
  })
  const rewriteModelSelectOptions = React.useMemo<ModelOption[]>(
    () => rewriteModelOptions.map((option) => ({
      ...option,
      label: getTaskNodeModelDisplayLabel(option),
    })),
    [rewriteModelOptions],
  )
  const resolvePromptRefineModelKey = React.useCallback(() => {
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
      modelKey: resolvePromptRefineModelKey(),
      productionMetadata: (data as Record<string, unknown>)?.productionMetadata,
    })
  }, [data, prompt, resolvePromptRefineModelKey])
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
    if (!matched) return
    const next = matched
    const nextModelValue = String(next.value || '').trim()
    if (!nextModelValue) return
    if (String(activeModelKey || '').trim() === nextModelValue) return
    if (isAudioNode) {
      updateNodeData(id, { audioModel: nextModelValue })
      return
    }
    if (isVideoNode) {
      setVideoModel(nextModelValue)
      updateNodeData(id, { videoModel: nextModelValue, videoModelVendor: next.vendor || null })
      return
    }
    if (coreKind === 'image' || kind === 'imageEdit') {
      setImageModel(nextModelValue)
      updateNodeData(id, { imageModel: nextModelValue, imageModelVendor: null })
      return
    }
    setModelKey(nextModelValue)
    updateNodeData(id, { geminiModel: nextModelValue, modelVendor: next.vendor || null })
  }, [activeModelKey, coreKind, id, isAudioNode, isVideoNode, kind, modelList, updateNodeData])

  React.useEffect(() => {
    if (!isVideoNode) return
    const dataRecord =
      data && typeof data === 'object'
        ? (data as Record<string, unknown>)
        : {}
    const nextDuration = readVideoDurationSeconds(
      dataRecord,
      15,
    )
    setVideoDuration((prev) => (prev === nextDuration ? prev : nextDuration))
  }, [data, isVideoNode])

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

    const nextImageQuality = pickImageQualityValue(imageModelConfig, imageQuality)
    if (nextImageQuality && nextImageQuality !== imageQuality) {
      setImageQuality(nextImageQuality)
      patch.imageQuality = nextImageQuality
    }

    if (Object.keys(patch).length) {
      updateNodeData(id, patch)
    }
  }, [aspect, id, imageModelConfig, imageQuality, imageResolution, imageSize, isVideoNode, updateNodeData])

  React.useEffect(() => {
    if (!isVideoNode) return
    const dataRecord = data as Record<string, unknown>
    const storedVideoResolution = typeof dataRecord.videoResolution === 'string'
      ? normalizeVideoResolution(dataRecord.videoResolution)
      : ''
    const storedVideoSpecKey = typeof dataRecord.videoSpecKey === 'string' ? dataRecord.videoSpecKey.trim() : ''
    const storedSpecKey = typeof dataRecord.specKey === 'string' ? dataRecord.specKey.trim() : ''
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

  React.useEffect(() => {
    if (isVideoNode) return
    const dataRecord = data as Record<string, unknown>
    const storedSpecKey = typeof dataRecord.specKey === 'string' ? dataRecord.specKey.trim() : ''
    if (storedSpecKey === (imageSpecKey || '')) return
    updateNodeData(id, { specKey: imageSpecKey || null })
  }, [data, id, imageSpecKey, isVideoNode, updateNodeData])

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
  const [continueVeoSelectionToLastFrame, setContinueVeoSelectionToLastFrame] = React.useState(false)

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
  const summaryModelLabel = selectedActiveModelOption?.label || (
    modelListError
      ? '模型目录加载失败'
      : modelListLoading
        ? '正在读取模型…'
        : activeModelKey
          ? `模型不可用：${activeModelKey}`
          : '未选择模型'
  )
  const summaryDuration =
    isVideoNode
      ? selectedConfiguredDurationOption?.label || `${videoDuration}s`
      : `${sampleCount}x`
  const summaryVideoSize = isVideoNode
    ? selectedConfiguredSizeOption?.label || videoSize || aspect
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
        specKey: isVideoNode ? videoSpecKey : imageSpecKey,
        quantity: coreKind === 'image' ? sampleCount : 1,
      }),
    [billingNodeKind, coreKind, imageSpecKey, isVideoNode, sampleCount, selectedActiveModelOption, videoSpecKey],
  )
  const characterFissionCreditsPerVariant = React.useMemo(() => {
    if (!isCharacterReferenceNode || !selectedActiveModelOption) return 0
    const specKey = buildImageBillingSpecKeyForOption({
      modelOption: selectedActiveModelOption,
      aspect: '3:4',
      imageSize,
      imageResolution,
    })
    return resolveModelGenerationCredits({
      kind: 'imageEdit',
      modelOption: selectedActiveModelOption,
      specKey,
      quantity: 1,
    })
  }, [imageResolution, imageSize, isCharacterReferenceNode, selectedActiveModelOption])
  const requiredCreditsLabel = React.useMemo(() => {
    if (isAudioNode) {
      if ((data as any)?.audioType === 'music') {
        const fixedCredits = resolveModelGenerationCredits({
          kind: 'audio',
          modelOption: selectedActiveModelOption,
          quantity: 1,
        })
        return fixedCredits > 0 ? `${fixedCredits}积分` : null
      }
      const billingUnit = readCatalogTagValue(selectedActiveModelOption, 'tapcanvas:billing-unit')
      const configuredRate = Number(readCatalogTagValue(selectedActiveModelOption, 'tapcanvas:billing-credits'))
      if (billingUnit === 'second' && Number.isFinite(configuredRate) && configuredRate > 0) {
        return `${configuredRate}积分/秒`
      }
      if (billingUnit !== '10k_chars' || !Number.isFinite(configuredRate) || configuredRate <= 0) {
        return null
      }
      const text = (prompt || '').trim()
      if (!text) return null
      let chars = 0
      for (const ch of text) {
        const code = ch.codePointAt(0) ?? 0
        chars +=
          (code >= 0x2e80 && code <= 0x9fff) ||
          (code >= 0xac00 && code <= 0xd7af) ||
          (code >= 0xf900 && code <= 0xfaff) ||
          (code >= 0x3000 && code <= 0x303f) ||
          (code >= 0xff00 && code <= 0xffef)
            ? 2
            : 1
      }
      return `${Math.max(1, Math.ceil((chars * configuredRate) / 10000))}积分`
    }
    if (!(isVideoNode || coreKind === 'image')) return null
    if (!(requiredGenerationCredits > 0)) return null
    // 批量分支：N 份 = N 次独立生成，积分按份数汇总展示
    const multiplier = runCount > 1 ? runCount : 1
    return `${requiredGenerationCredits * multiplier}积分`
  }, [coreKind, isAudioNode, isVideoNode, requiredGenerationCredits, runCount, data, prompt, selectedActiveModelOption])
  const durationOptions = React.useMemo(
    () => configuredDurationOptions,
    [configuredDurationOptions],
  )

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

  const persistRecentGenerationPrefs = React.useCallback((patch: UserGenerationPrefsDto) => {
    saveNodeModelPrefs(patch)
    void updateRecentGenerationPrefs(patch).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      toast(`账号生成偏好保存失败：${message}`, 'error')
    })
  }, [])

  const handleToolbarModelChange = React.useCallback((value: string) => {
    const selectedValue = String(value || '').trim()
    if (!selectedValue) return
    const option = findModelOptionByIdentifier(modelMenuOptions, value)
    if (!option) {
      toast(`模型 ${selectedValue} 不在当前系统模型目录中`, 'error')
      return
    }
    if (isVideoNode) {
      setVideoModel(selectedValue)
      updateNodeData(id, { videoModel: selectedValue, videoModelVendor: option.vendor || null })
      persistRecentGenerationPrefs({ videoModel: selectedValue })
      return
    }
    if (coreKind === 'image' || kind === 'imageEdit') {
      setImageModel(selectedValue)
      updateNodeData(id, { imageModel: selectedValue, imageModelVendor: null })
      persistRecentGenerationPrefs({ imageModel: selectedValue })
      return
    }
    setModelKey(selectedValue)
    updateNodeData(id, { geminiModel: selectedValue, modelVendor: option.vendor || null })
  }, [coreKind, id, isVideoNode, kind, modelMenuOptions, persistRecentGenerationPrefs, updateNodeData])

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
      const sizeParts = normalizedSize.split(':')
      const declaredAspect = matchedOption?.aspectRatio || (sizeParts.length === 2 ? normalizedSize : '')
      const nextAspect = declaredAspect ? normalizeImageAspect(declaredAspect) : aspect
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
        ...(declaredAspect ? { aspect: nextAspect } : {}),
        orientation: nextOrientation,
      })
      if (declaredAspect) {
        setAspect(nextAspect)
        persistRecentGenerationPrefs({ videoAspect: nextAspect })
      }
      orientationRef.current = nextOrientation
      setOrientation(nextOrientation)
      return
    }
    const normalizedAspect = normalizeImageAspect(value)
    setAspect(normalizedAspect)
    const patch: Record<string, unknown> = { aspect: normalizedAspect }
    if (!hasPrimaryImage) {
      const parts = normalizedAspect.split(':')
      const aw = parseFloat(parts[0] ?? '')
      const ah = parseFloat(parts[1] ?? '')
      const currentWidth = typeof (data as any)?.nodeWidth === 'number' && (data as any)?.nodeWidth > 0
        ? (data as any).nodeWidth as number
        : 360
      if (aw > 0 && ah > 0) {
        const raw = Math.round(currentWidth / (aw / ah))
        patch.nodeHeight = Math.max(90, Math.min(960, raw))
      }
    }
    updateNodeData(id, patch)
    if (typeof patch.nodeHeight === 'number') {
      const patchedWidth = typeof (data as any)?.nodeWidth === 'number' && (data as any)?.nodeWidth > 0
        ? (data as any).nodeWidth as number
        : 360
      rf.updateNode(id, (node) => ({
        style: { ...node.style, width: patchedWidth, height: patch.nodeHeight as number },
      }))
    }
    if (aspectTransitionTimerRef.current) clearTimeout(aspectTransitionTimerRef.current)
    setIsAspectTransitioning(true)
    aspectTransitionTimerRef.current = setTimeout(() => setIsAspectTransitioning(false), 320)
  }, [aspect, data, effectiveVideoResolution, hasPrimaryImage, id, isVideoNode, persistRecentGenerationPrefs, updateNodeData, videoDuration, videoModelConfig])

  const handleToolbarVideoResolutionChange = React.useCallback((value: string) => {
    const normalizedResolution = normalizeVideoResolution(value)
    const nextSpecKey = buildVideoBillingSpecKey(normalizedResolution, videoDuration)
    setVideoResolution(normalizedResolution)
    updateNodeData(id, {
      videoResolution: normalizedResolution || null,
      videoSpecKey: nextSpecKey || null,
      specKey: nextSpecKey || null,
    })
    if (normalizedResolution) persistRecentGenerationPrefs({ videoResolution: normalizedResolution })
  }, [id, persistRecentGenerationPrefs, updateNodeData, videoDuration])

  const handleToolbarOrientationChange = React.useCallback((value: Orientation) => {
    const normalized = normalizeOrientation(value)
    const matchedOption =
      videoModelConfig?.orientationOptions.find((option) => option.value === normalized) || null
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
      const nextAspect = normalizeImageAspect(matchedOption.aspectRatio)
      setAspect(nextAspect)
      persistRecentGenerationPrefs({ videoAspect: nextAspect })
    }
  }, [effectiveVideoResolution, id, persistRecentGenerationPrefs, updateNodeData, videoDuration, videoModelConfig, videoSize])

  // kling-v3-omni「参考视频用途」：feature=动作迁移（上游参考视频只供动作/运镜/风格，
  // 新主体来自参考图）、base=底片重绘/续演（默认）。写入 data.videoReferType，
  // remoteRunner / bridge 透传 → hono metadata.video_refer_type → apimart video_list[].refer_type。
  const videoReferTypeSetting = normalizeKlingVideoReferType((data as any)?.videoReferType) ?? 'base'

  const mappedVideoControls = React.useMemo<ReadonlyArray<ToolbarMappedControl>>(() => {
    if (!isVideoNode || !videoModelConfig) return []
    const controls = videoModelConfig.controls.flatMap((control): ToolbarMappedControl[] => {
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
    // kling-v3-omni 专属：参考视频用途（动作迁移/底片重绘）。仅当上游连入视频时该设置才生效，
    // 但常驻展示便于先选模式再连线。
    const referTypeControl: ToolbarMappedControl[] = isKlingV3OmniVideoModel(videoModel)
      ? [{
          key: 'video_refer_type',
          binding: 'videoReferType' as const,
          title: '参考视频用途',
          summary: videoReferTypeSetting === 'feature' ? '动作迁移' : '底片重绘',
          options: [
            { value: 'base', label: '底片重绘（重绘/续演参考视频本身）' },
            { value: 'feature', label: '动作迁移（动作/运镜迁移到参考图新主体）' },
          ],
          onChange: (value: string) => {
            updateNodeData(id, { videoReferType: value === 'feature' ? 'feature' : 'base' })
          },
        }]
      : []
    return hasSizeControl
      ? [...controls.filter((control) => control.binding !== 'orientation'), ...autoResolutionControl, ...referTypeControl]
      : [...controls, ...autoResolutionControl, ...referTypeControl]
  }, [
    configuredVideoResolutionOptions,
    configuredOrientationOptions,
    configuredSizeOptions,
    durationOptions,
    handleToolbarDurationChange,
    handleToolbarOrientationChange,
    handleToolbarSizeChange,
    handleToolbarVideoResolutionChange,
    id,
    isVideoNode,
    summaryDuration,
    summaryOrientation,
    summaryVideoResolution,
    summaryVideoSize,
    updateNodeData,
    videoModel,
    videoModelConfig,
    videoReferTypeSetting,
  ])

  const mappedVideoControlBindings = React.useMemo(() => {
    return new Set<ToolbarMappedControl['binding']>(mappedVideoControls.map((control) => control.binding))
  }, [mappedVideoControls])

  // whenSelected 约束：由当前 imageSize 选项决定
  const selectedImageSizeConstraint = React.useMemo(() => {
    if (!imageModelConfig) return null
    return imageModelConfig.imageSizeOptions.find((o) => o.value === imageSize)?.whenSelected ?? null
  }, [imageModelConfig, imageSize])

  // 受约束的比例选项：whenSelected.aspectRatioOptions 存在时覆盖全局列表
  const effectiveImageAspectOptions = React.useMemo(() => {
    const constrained = selectedImageSizeConstraint?.aspectRatioOptions
    if (constrained?.length) {
      return constrained.map((v) => ({ value: v, label: v }))
    }
    return configuredImageAspectOptions
  }, [configuredImageAspectOptions, selectedImageSizeConstraint])

  // 当 imageSize 切换后，若当前比例不在有效列表内则自动修正
  React.useEffect(() => {
    if (!effectiveImageAspectOptions.length) return
    if (effectiveImageAspectOptions.some((o) => o.value === aspect)) return
    const first = effectiveImageAspectOptions[0]?.value
    if (first) {
      setAspect(first)
      updateNodeData(id, { aspect: first })
    }
  }, [aspect, effectiveImageAspectOptions, id, updateNodeData])

  const mappedImageControls = React.useMemo<ReadonlyArray<ToolbarMappedControl>>(() => {
    if (isVideoNode || !imageModelConfig) return []
    const hiddenBindings = new Set(selectedImageSizeConstraint?.hides ?? [])
    return imageModelConfig.controls.flatMap((control): ToolbarMappedControl[] => {
      if (control.binding === 'aspectRatio') {
        if (!effectiveImageAspectOptions.length) return []
        const selectedAspectOption = effectiveImageAspectOptions.find((o) => o.value === aspect)
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: selectedAspectOption?.label || aspect,
          options: effectiveImageAspectOptions,
          onChange: handleToolbarSizeChange,
        }]
      }
      if (control.binding === 'imageSize') {
        if (imageSizeMatchesResolutionOptions) return []
        // 单档不渲染下拉，避免单选项的伪菜单
        if (configuredImageSizeOptions.length <= 1) return []
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: selectedConfiguredImageSizeOption?.label || imageSize,
          options: configuredImageSizeOptions,
          onChange: (value: string) => {
            setImageSize(value)
            // 同步 imageResolution / resolution，spec key 优先读 imageResolution，
            // 不同步会让切换分辨率时积分不变。
            setImageResolution(value)
            updateNodeData(id, { imageSize: value, imageResolution: value, resolution: value })
            persistRecentGenerationPrefs({ imageSize: value })
          },
        }]
      }
      if (control.binding === 'resolution') {
        if (hiddenBindings.has('resolution')) return []
        if (configuredImageResolutionOptions.length <= 1) return []
        return [{
          key: control.key,
          binding: control.binding,
          title: control.label,
          summary: selectedConfiguredImageResolutionOption?.label || imageResolution || '分辨率',
          options: configuredImageResolutionOptions,
          onChange: (value: string) => {
            setImageResolution(value)
            // 同步 imageSize 让 catalog 默认值算出的 specKey 与 toolbar 显示对齐。
            setImageSize(value)
            updateNodeData(id, { imageResolution: value, resolution: value, imageSize: value })
            persistRecentGenerationPrefs({ imageSize: value })
          },
        }]
      }
      if (control.binding === 'quality') {
        if (configuredImageQualityOptions.length <= 1) return []
        const selectedQualityOption = configuredImageQualityOptions.find((option) => option.value === imageQuality)
        return [{
          key: control.key,
          binding: control.binding,
          title: '画质',
          summary: selectedQualityOption?.label || imageQuality,
          options: configuredImageQualityOptions,
          onChange: (value: string) => {
            setImageQuality(value)
            updateNodeData(id, { imageQuality: value })
          },
        }]
      }
      return []
    })
  }, [
    aspect,
    configuredImageAspectOptions,
    configuredImageQualityOptions,
    configuredImageResolutionOptions,
    configuredImageSizeOptions,
    effectiveImageAspectOptions,
    handleToolbarSizeChange,
    id,
    imageModelConfig,
    imageQuality,
    imageResolution,
    imageSize,
    imageSizeMatchesResolutionOptions,
    isVideoNode,
    persistRecentGenerationPrefs,
    selectedConfiguredImageResolutionOption,
    selectedConfiguredImageSizeOption,
    selectedImageSizeConstraint,
    updateNodeData,
  ])

  const mappedImageControlBindings = React.useMemo(() => {
    return new Set<ImageModelControlBinding>(
      mappedImageControls
        .map((control) => control.binding)
        .filter(
          (binding): binding is ImageModelControlBinding =>
            binding === 'aspectRatio' || binding === 'imageSize' || binding === 'resolution' || binding === 'quality',
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
    // 单档选项（如 gemini-2.5-flash-image-preview 只支持 1K）就不渲染下拉，
    // 避免出现 1 项的伪选择菜单。
    (imageModelConfig ? configuredImageSizeOptions.length > 1 : true) &&
    !mappedImageControlBindings.has('imageSize')

  const mediaGenerationSettings = React.useMemo(() => {
    if (isVideoComposeNode || isAudioNode || !(isVideoNode || coreKind === 'image')) return null
    return buildMediaGenerationSettings({
      kind: isVideoNode ? 'video' : 'image',
      aspect,
      videoSize,
      orientation,
      effectiveVideoResolution,
      imageResolution,
      imageSize,
      imageQuality,
      videoReferType: videoReferTypeSetting,
      mappedControls: isVideoNode ? mappedVideoControls : mappedImageControls,
      fallbackAspectOptions: isVideoNode ? configuredSizeOptions : effectiveImageAspectOptions,
      onFallbackAspectChange: handleToolbarSizeChange,
      duration: isVideoNode && durationOptions.length > 0
        ? {
            value: videoDuration,
            options: durationOptions,
            onChange: handleToolbarDurationChange,
          }
        : null,
      audio: isVideoNode && videoModelConfig?.supportsNativeAudio === true
        ? {
            value: videoGenerateAudio,
            onChange: (value: boolean) => {
              setVideoGenerateAudio(value)
              updateNodeData(id, { videoGenerateAudio: value })
            },
          }
        : null,
      summaryAspect: isVideoNode
        ? summaryVideoSize
        : selectedConfiguredImageAspectOption?.label || aspect,
      summaryResolution: summaryVideoResolution,
      summaryDuration,
      quantity: runCount,
      onQuantityChange: (value: number) => {
        setRunCount(value)
        updateNodeData(id, { runCount: value })
      },
    })
  }, [
    aspect,
    configuredSizeOptions,
    coreKind,
    durationOptions,
    effectiveImageAspectOptions,
    effectiveVideoResolution,
    handleToolbarDurationChange,
    handleToolbarSizeChange,
    id,
    imageResolution,
    imageSize,
    imageQuality,
    isAudioNode,
    isVideoComposeNode,
    isVideoNode,
    mappedImageControls,
    mappedVideoControls,
    orientation,
    runCount,
    selectedConfiguredImageAspectOption,
    summaryDuration,
    summaryVideoResolution,
    summaryVideoSize,
    updateNodeData,
    videoDuration,
    videoGenerateAudio,
    videoModelConfig?.supportsNativeAudio,
    videoReferTypeSetting,
    videoSize,
  ])
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

  const handleApplyPromptLibraryEntry = React.useCallback((promptText: string) => {
    setPrompt(promptText)
    updateNodeData(id, { prompt: promptText })
  }, [id, updateNodeData])

  const applyVeoReferenceImages = React.useCallback((next: string[]) => {
    const normalized = normalizeVeoReferenceUrls(next)
    setVeoReferenceImages(normalized)
    updateNodeData(id, { veoReferenceImages: normalized })
  }, [id, updateNodeData])

  const clearVideoReferenceEdges = React.useCallback(() => {
    const state = useRFStore.getState()
    const edgeIds = collectOrderedUpstreamReferenceItems(state.nodes, state.edges, id).map((item) => item.edgeId)
    if (edgeIds.length > 0) {
      state.onEdgesChange(edgeIds.map((edgeId) => ({ id: edgeId, type: 'remove' as const })))
    }
    updateNodeData(id, { upstreamReferenceOrder: [] })
    closeCanvasReferencePicker()
  }, [closeCanvasReferencePicker, id, updateNodeData])

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
    clearVideoReferenceEdges()
  }, [applyVeoReferenceImages, clearVideoReferenceEdges, id, updateNodeData, veoReferenceImages.length])

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
  const closeVeoModal = React.useCallback(() => {
    setVeoImageModalMode(null)
    setContinueVeoSelectionToLastFrame(false)
  }, [])

  const buildFeaturePatch = React.useCallback((nextPrompt: string) => {
    const patch: Record<string, unknown> = { prompt: nextPrompt }
    if (hasAspect) patch.aspect = aspect
    if (hasImageSize) patch.imageSize = imageSize
    if (!isVideoNode && imageSpecKey) patch.specKey = imageSpecKey
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
    imageSpecKey,
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
    if (isOrchestratedVideoClip) {
      requestVideoClipAgentAction({
        nodeId: id,
        action: 'resume_clip',
        runId: readVideoClipRunId(data),
        clipIndex: readVideoClipIndex(data),
      })
      return
    }
    if (isPlainTextNode) {
      updateNodeData(id, { prompt })
      return
    }
    const liveNodeData = useRFStore.getState().nodes.find((node) => node.id === id)?.data
    const nodeRecord = (liveNodeData ?? data) as Record<string, unknown>
    if (
      nodeRecord.libTvImageOperationKey === 'portrait-adjust'
      && nodeRecord.portraitTextureSelectionStatus !== 'confirmed'
    ) {
      toast('请先在原图上选择要调节的人物并确认', 'error')
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
    if ((isVideoNode || coreKind === 'image') && runCount > 1) {
      // 批量分支执行：克隆 runCount-1 个同节点并行跑（继承上下游连线、剥离旧结果）
      void useRFStore.getState().runNodeBranchClones(id, runCount)
      return
    }
    runSelected()
  }

  const handleImageUpload = React.useCallback(async (files: File[]) => {
    const requestedEmptyAction = pendingImageUploadActionRef.current
    pendingImageUploadActionRef.current = null
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
        toast('已添加图片，但未能托管到 TOS，将仅使用本地预览（无法用于远程任务）', 'error')
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
      if (successCount > 0 && requestedEmptyAction === 'image-upscale') {
        setHdPanelOpen(true)
      } else if (successCount > 0 && requestedEmptyAction === 'image-to-image') {
        toast('参考图已加载，请输入改图指令', 'success')
      }
    } catch (error) {
      console.error('Failed to upload image:', error)
      toast('上传图片失败，请稍后再试', 'error')
    } finally {
      useUploadRuntimeStore.getState().finishNodeImageUpload(id)
    }
  }, [supportsImageUpload, nodeHasUploadIntent, nodeHasPendingUploads, id, updateNodeData])

  const [videoUploading, setVideoUploading] = React.useState(false)

  const handleVideoUpload = React.useCallback(async (files: File[]) => {
    if (!isVideoNode || viewOnly) return
    const valid = (files || []).filter((f) => {
      if (!f.type.startsWith('video/')) return false
      const MAX_BYTES = 500 * 1024 * 1024
      if (f.size > MAX_BYTES) {
        toast(`视频 "${f.name}" 超过 500MB，已跳过`, 'error')
        return false
      }
      return true
    })
    if (!valid.length) return

    setVideoUploading(true)
    for (const file of valid) {
      const localUrl = URL.createObjectURL(file)
      const title = file.name.replace(/\.[a-z0-9]+$/i, '').trim() || '上传视频'
      updateNodeData(id, { videoUrl: localUrl })
      try {
        const hosted = await uploadServerAssetFile(file, title, { ownerNodeId: id })
        const url = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
        if (url) {
          updateNodeData(id, {
            videoUrl: url,
            videoResults: [...videoResults, { url, title, thumbnailUrl: null, duration: null }],
            videoPrimaryIndex: videoResults.length,
            serverAssetId: hosted.id,
          })
          URL.revokeObjectURL(localUrl)
        } else {
          toast('视频上传成功但未获取到链接，使用本地预览', 'error')
        }
      } catch (error) {
        console.error('Failed to upload video:', error)
        toast('视频上传失败，请稍后再试', 'error')
        URL.revokeObjectURL(localUrl)
        updateNodeData(id, { videoUrl: null })
      }
    }
    setVideoUploading(false)
  }, [isVideoNode, viewOnly, id, updateNodeData, videoResults])

  const isImageNode = coreKind === 'image'

  // ─── Image → 3D ───────────────────────────────────────────────────────────
  const [show3dPanel, setShow3dPanel] = React.useState(false)
  const sleep3d = React.useCallback((ms: number) => new Promise<void>((r) => setTimeout(r, ms)), [])
  const legacyImageUrl = (data as any)?.imageUrl as string | undefined
  const handleRun3d = React.useCallback(async (p: Image3DParams) => {
    setShow3dPanel(false)
    const imageUrl = primaryImageUrl || legacyImageUrl
    if (!imageUrl) {
      toast('请先生成或上传图片', 'error')
      return
    }
    // 参照图片编辑/重绘的交互：3D 结果落在右侧新建的下游节点（原图节点保持不动），
    // 新节点继承原图作占位预览，连线 out-image → in-image，完成后自动切 3D 视图。
    const beforeIds = new Set(useRFStore.getState().nodes.map(n => n.id))
    addNode('taskNode', '3D 模型', {
      kind: 'image',
      prompt: p.prompt,
      imageUrl,
      model3dStatus: 'running',
      model3dPrompt: p.prompt,
    })
    const afterAdd = useRFStore.getState()
    const newNode = afterAdd.nodes.find(n => !beforeIds.has(n.id))
    if (!newNode) {
      toast('3D 节点创建失败', 'error')
      return
    }
    const targetId = newNode.id
    const sourceNode = afterAdd.nodes.find(n => n.id === id)
    // nodeWidth 声明在本回调之后，这里从节点实测宽度取（fallback 520）
    const srcWidth = Number((sourceNode as any)?.measured?.width ?? (sourceNode as any)?.width) || 520
    afterAdd.onNodesChange([{
      id: targetId, type: 'position' as const,
      position: { x: (sourceNode?.position?.x ?? 0) + srcWidth + 80, y: sourceNode?.position?.y ?? 0 },
      dragging: false,
    }])
    afterAdd.onConnect({ source: id, sourceHandle: 'out-image', target: targetId, targetHandle: 'in-image' })
    setNodeStatus(targetId, 'running', { progress: 5 })
    try {
      let result = await runTaskByVendor('doubao', withCanvasGenerationContext({
        kind: 'image_to_3d',
        prompt: p.prompt,
        extras: { modelKey: 'doubao-seed3d-2-0-260328', imageUrl },
      }, useUIStore.getState(), targetId))
      const taskId = result.id
      updateNodeData(targetId, { model3dStatus: 'running', model3dPrompt: p.prompt, model3dTaskId: taskId })
      const deadline = Date.now() + 15 * 60 * 1000
      while (result.status !== 'succeeded' && result.status !== 'failed' && Date.now() < deadline) {
        await sleep3d(3000)
        const res = await fetchPublicTaskResultWithAuth({ taskId, taskKind: 'image_to_3d', prompt: p.prompt })
        result = res.result
        setNodeStatus(targetId, 'running', { progress: 50, model3dStatus: 'running' })
      }
      if (result.status !== 'succeeded' && result.status !== 'failed') {
        throw new Error('3D 生成超时（超过 15 分钟），请稍后重试')
      }
      if (result.status === 'failed') throw new Error('3D 生成失败')
      const url = result.assets?.find((a) => a.url)?.url
      if (!url) throw new Error('未返回 3D 模型 URL')
      setNodeStatus(targetId, 'success', { progress: 100, model3dStatus: 'success', model3dUrl: url, model3dView: true })
      notifyAssetRefresh()
    } catch (e) {
      setNodeStatus(targetId, 'error', { model3dStatus: 'error', lastError: e instanceof Error ? e.message : '3D 生成失败' })
    }
  }, [addNode, id, primaryImageUrl, legacyImageUrl, setNodeStatus, updateNodeData, sleep3d])

  // ─── Video → Enhance ──────────────────────────────────────────────────────
  const [showEnhancePanel, setShowEnhancePanel] = React.useState(false)
  const handleRunEnhance = React.useCallback(async (p: EnhanceParams) => {
    setShowEnhancePanel(false)
    const sourceData = data as Record<string, unknown>
    const vr = Array.isArray(sourceData.videoResults)
      ? sourceData.videoResults.filter((entry): entry is Record<string, unknown> => (
        Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
      ))
      : []
    const pidx = typeof sourceData.videoPrimaryIndex === 'number' ? sourceData.videoPrimaryIndex : 0
    const srcUrl = String(vr[pidx]?.url || sourceData.videoUrl || vr[0]?.url || '').trim()
    if (!srcUrl) {
      toast('当前节点没有可增强的视频', 'error')
      return
    }
    const sourceNode = useRFStore.getState().nodes.find((node) => node.id === id)
    const sourceWidth = sourceNode?.measured?.width ?? sourceNode?.width ?? 520
    const beforeIds = new Set(useRFStore.getState().nodes.map((node) => node.id))
    addNode('taskNode', '画质增强', {
      kind: 'video',
      videoResults: [],
      videoPrimaryIndex: 0,
      videoDuration: typeof sourceData.videoDuration === 'number' ? sourceData.videoDuration : undefined,
      sourceVideoNodeId: id,
      sourceVideoUrl: srcUrl,
      videoEnhanceParams: p,
      prompt: typeof sourceData.prompt === 'string' ? sourceData.prompt : '',
      status: 'queued',
      progress: 0,
    })
    const afterAdd = useRFStore.getState()
    const outputNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
    if (!outputNode) {
      toast('画质增强占位节点创建失败', 'error')
      return
    }
    afterAdd.onNodesChange([{
      id: outputNode.id,
      type: 'position' as const,
      position: {
        x: (sourceNode?.position?.x ?? 0) + sourceWidth + 80,
        y: sourceNode?.position?.y ?? 0,
      },
      dragging: false,
    }])
    afterAdd.onConnect({ source: id, sourceHandle: 'out-video', target: outputNode.id, targetHandle: 'in-video' })
    afterAdd.clearPendingFocusNodeId()
    setNodeStatus(outputNode.id, 'running', { progress: 5 })

    const startTime = Date.now()
    try {
      const specKey = computeEnhanceSpecKey(p)
      const extras: Record<string, unknown> = {
        modelKey: 'volc-enhance-video',
        video_url: srcUrl,
        specKey,
        tool_version: p.tool_version,
        scene: p.scene,
      }
      if (p.fps !== undefined) extras.fps = p.fps
      if (p.resolution) extras.resolution = p.resolution
      if (p.resolution_limit) extras.resolution_limit = p.resolution_limit
      let result = await runTaskByVendor('volc', withCanvasGenerationContext(
        { kind: 'video_enhance', prompt: '', extras },
        useUIStore.getState(),
        outputNode.id,
      ))
      const taskId = result.id
      const deadline = Date.now() + 30 * 60 * 1000
      while (result.status !== 'succeeded' && result.status !== 'failed' && Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, 5000))
        const res = await fetchPublicTaskResultWithAuth({ taskId, taskKind: 'video_enhance', prompt: '' })
        result = res.result
        const elapsed = Date.now() - startTime
        const prog = Math.min(90, 10 + Math.floor((elapsed / (30 * 60 * 1000)) * 80))
        setNodeStatus(outputNode.id, 'running', { progress: prog })
      }
      if (result.status !== 'succeeded' && result.status !== 'failed') {
        throw new Error('画质增强超时（超过 30 分钟），请稍后重试')
      }
      if (result.status === 'failed') throw new Error('画质增强失败')
      const url = result.assets?.find((asset) => typeof asset.url === 'string' && asset.url.trim())?.url?.trim()
      if (!url) throw new Error('未返回增强视频 URL')
      updateNodeData(outputNode.id, {
        videoUrl: url,
        videoResults: [{ url, title: '画质增强', duration: sourceData.videoDuration }],
        videoPrimaryIndex: 0,
        videoDuration: sourceData.videoDuration,
      })
      setNodeStatus(outputNode.id, 'success', { progress: 100 })
      notifyAssetRefresh()
      toast('画质增强完成，结果已回填到新视频节点', 'success')
    } catch (e) {
      const message = e instanceof Error ? e.message : '画质增强失败'
      setNodeStatus(outputNode.id, 'error', { lastError: message })
      toast(message, 'error')
    }
  }, [addNode, data, id, setNodeStatus, updateNodeData])

  const handleVideoEditSubmit = React.useCallback(async (input: {
    mode: Exclude<VideoToolEditorMode, 'separation'>
    selections: Array<{ id: string; x: number; y: number; width: number; height: number }>
    modelValue: string
  }): Promise<void> => {
    const sourceData = data as Record<string, unknown>
    const rawResults = Array.isArray(sourceData.videoResults) ? sourceData.videoResults : []
    const primaryIndex = typeof sourceData.videoPrimaryIndex === 'number' ? sourceData.videoPrimaryIndex : 0
    const primary = rawResults[primaryIndex] as Record<string, unknown> | undefined
    const first = rawResults[0] as Record<string, unknown> | undefined
    const sourceUrl = String(primary?.url || sourceData.videoUrl || first?.url || '').trim()
    if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
      throw new Error('当前节点没有可处理的真实视频 URL')
    }
    const modelOptions = input.mode === 'subject' ? videoSubjectRemovalModelOptions : videoSubtitleRemovalModelOptions
    const modelOption = findModelOptionByIdentifier(modelOptions, input.modelValue)
    if (!modelOption) throw new Error('当前编辑模型不可用，请重新选择')
    const modelKey = getModelOptionRequestAlias(modelOptions, modelOption.value) || modelOption.value
    const actionModelConfig = parseVideoModelCatalogConfig(modelOption.meta)
    const editOperation = input.mode === 'subject'
      ? 'subject_remove'
      : input.mode === 'subtitle-auto'
        ? 'subtitle_remove_auto'
        : 'subtitle_remove'
    const selectionSummary = input.selections
      .map((selection, index) => `区域${index + 1}(x=${selection.x.toFixed(4)},y=${selection.y.toFixed(4)},w=${selection.width.toFixed(4)},h=${selection.height.toFixed(4)})`)
      .join('；')
    const prompt = input.mode === 'subject'
      ? `移除视频中指定区域内的主体，对整段视频进行跨帧对象跟踪，并使用时序一致的背景修复自然填补原主体区域。${selectionSummary ? `选区为：${selectionSummary}。` : ''}`
      : input.mode === 'subtitle-auto'
        ? '自动识别并移除整段视频中的硬字幕、贴纸字幕和时间轴字幕，保持人物、背景、镜头运动与画面纹理连续，不改变原视频内容。'
        : `移除视频中指定区域内的字幕，对整段视频进行跨帧跟踪与时序修复，保持背景纹理和镜头运动连续。选区为：${selectionSummary}。`

    const sourceNode = useRFStore.getState().nodes.find((node) => node.id === id)
    const sourceWidth = sourceNode?.measured?.width ?? sourceNode?.width ?? 520
    const beforeIds = new Set(useRFStore.getState().nodes.map((node) => node.id))
    addNode('taskNode', input.mode === 'subject' ? '主体消除' : '去字幕', {
      kind: 'video',
      videoResults: [],
      videoPrimaryIndex: 0,
      videoDuration: typeof sourceData.videoDuration === 'number' ? sourceData.videoDuration : undefined,
      sourceVideoNodeId: id,
      sourceVideoUrl: sourceUrl,
      videoEditOperation: editOperation,
      videoEditSelections: input.selections,
      videoEditModel: modelKey,
      prompt,
      status: 'queued',
      progress: 0,
    })
    const afterAdd = useRFStore.getState()
    const outputNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
    if (!outputNode) throw new Error('视频编辑占位节点创建失败')
    afterAdd.onNodesChange([{
      id: outputNode.id,
      type: 'position' as const,
      position: {
        x: (sourceNode?.position?.x ?? 0) + sourceWidth + 80,
        y: sourceNode?.position?.y ?? 0,
      },
      dragging: false,
    }])
    afterAdd.onConnect({ source: id, sourceHandle: 'out-video', target: outputNode.id, targetHandle: 'in-video' })
    afterAdd.clearPendingFocusNodeId()
    setNodeStatus(outputNode.id, 'running', { progress: 5 })

    const startedAt = Date.now()
    try {
      const sourceDurationRaw = typeof sourceData.videoDuration === 'number' && Number.isFinite(sourceData.videoDuration)
        ? sourceData.videoDuration
        : typeof primary?.duration === 'number' && Number.isFinite(primary.duration)
          ? primary.duration
          : undefined
      const sourceDurationSeconds = typeof sourceDurationRaw === 'number' && sourceDurationRaw > 0
        ? Math.max(1, Math.ceil(sourceDurationRaw))
        : undefined
      const declaredDurationOptions = (actionModelConfig?.durationOptions || [])
        .map((option) => option.value)
        .filter((value) => Number.isFinite(value) && value > 0)
      const declaredMaxDuration = declaredDurationOptions.length > 0
        ? Math.max(...declaredDurationOptions)
        : undefined
      const declaredMinDuration = declaredDurationOptions.length > 0
        ? Math.min(...declaredDurationOptions)
        : undefined
      if (sourceDurationSeconds !== undefined && declaredMaxDuration !== undefined && sourceDurationSeconds > declaredMaxDuration) {
        throw new Error(`所选编辑模型“${getTaskNodeModelDisplayLabel(modelOption)}”最多处理 ${declaredMaxDuration} 秒；当前源视频为 ${sourceDurationSeconds} 秒，请先裁剪或更换支持长视频的模型。`)
      }
      if (sourceDurationSeconds !== undefined && declaredMinDuration !== undefined && sourceDurationSeconds < declaredMinDuration) {
        throw new Error(`所选编辑模型“${getTaskNodeModelDisplayLabel(modelOption)}”要求至少 ${declaredMinDuration} 秒；当前源视频为 ${sourceDurationSeconds} 秒，请先补足片段或更换模型。`)
      }
      // 编辑模型的 duration 既是 provider 的硬边界，也是 new-api 线性时长计费事实。
      // MediaKit 不会把该字段当作生成时长，但仍需透传用于准确计费。
      const durationSeconds = sourceDurationSeconds
      const billingResolution = typeof sourceData.videoResolution === 'string' && sourceData.videoResolution.trim()
        ? sourceData.videoResolution.trim()
        : actionModelConfig?.defaultResolution
      let result = await runTaskByVendor('auto', withCanvasGenerationContext({
        kind: 'video_edit',
        prompt,
        extras: {
          modelKey,
          upstreamVideoUrl: sourceUrl,
          editOperation,
          editSelections: input.selections,
          editPreserveSourceDuration: durationSeconds === undefined,
          ...(typeof durationSeconds === 'number' ? { durationSeconds } : {}),
          ...(billingResolution ? { resolution: billingResolution } : {}),
          ...(typeof sourceDurationRaw === 'number' && sourceDurationRaw > 0
            ? { billingReferenceVideoDurationSeconds: sourceDurationRaw }
            : {}),
        },
      }, useUIStore.getState(), outputNode.id))
      const taskId = result.id
      const deadline = Date.now() + 30 * 60 * 1000
      while (result.status !== 'succeeded' && result.status !== 'failed' && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5000))
        const polled = await fetchPublicTaskResultWithAuth({ taskId, taskKind: 'video_edit', prompt })
        result = polled.result
        const elapsed = Date.now() - startedAt
        setNodeStatus(outputNode.id, 'running', { progress: Math.min(90, 10 + Math.floor((elapsed / (30 * 60 * 1000)) * 80)) })
      }
      if (result.status !== 'succeeded' && result.status !== 'failed') throw new Error('视频编辑超时（超过 30 分钟），请稍后重试')
      if (result.status === 'failed') throw new Error('视频编辑失败，请查看任务详情')
      const url = result.assets?.find((asset) => typeof asset.url === 'string' && asset.url.trim())?.url?.trim()
      if (!url) throw new Error('视频编辑完成但未返回视频 URL')
      updateNodeData(outputNode.id, {
        videoUrl: url,
        videoResults: [{ url, title: input.mode === 'subject' ? '主体消除' : '去字幕', duration: sourceData.videoDuration }],
        videoPrimaryIndex: 0,
        videoDuration: sourceData.videoDuration,
      })
      setNodeStatus(outputNode.id, 'success', { progress: 100 })
      notifyAssetRefresh()
      toast('视频编辑完成，结果已回填到新视频节点', 'success')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '视频编辑失败'
      setNodeStatus(outputNode.id, 'error', { lastError: message })
      toast(message, 'error')
      throw error
    }
  }, [addNode, data, id, setNodeStatus, updateNodeData, videoSubjectRemovalModelOptions, videoSubtitleRemovalModelOptions])

  const cameraChipLabel = React.useMemo(() => {
    if (!imageCinematicCamera?.enabled || !imageCinematicCamera?.cameraKey) return '摄影机控制'
    return CAMERA_BODIES.find((c) => c.key === imageCinematicCamera.cameraKey)?.label ?? '摄影机控制'
  }, [imageCinematicCamera])
  const hideImageMeta = isImageNode && !selected
  const isImageExpired = Boolean((data as any)?.expired || (data as any)?.imageExpired)
  // GenerationOverlay 已覆盖 running/queued 状态；本地上传仍需独立提示，避免组件 remount 后丢失”上传中”事实。
  const showImageStateOverlay = Boolean(isImageNode && (isImageExpired || isUploadingImage))
  const imageStateLabel = isUploadingImage ? '上传中' : isImageExpired ? '已过期' : null

  // ─── Panoramic state ──────────────────────────────────────────────────────
  const isPanoramic = isImageNode && Boolean((data as any)?.isPanoramic)
  const panoramicCamera: PanoramicCameraState = React.useMemo(() => {
    const raw = (data as any)?.panoramicCamera
    if (raw && typeof raw === 'object') {
      const az = Number(raw.azimuthDeg)
      const el = Number(raw.elevationDeg)
      const fov = Number(raw.fovDeg)
      if (Number.isFinite(az) && Number.isFinite(el) && Number.isFinite(fov)) {
        return { azimuthDeg: az, elevationDeg: el, fovDeg: fov }
      }
    }
    return PANORAMIC_DEFAULT_CAMERA
  }, [(data as any)?.panoramicCamera])
  const panoramicGridVisible = Boolean((data as any)?.panoramicGridVisible)
  const panoramicViewerRef = React.useRef<PanoramicViewerHandle>(null)
  const [panoramicFullscreenOpen, setPanoramicFullscreenOpen] = React.useState(false)
  const [imageNodeMultiAngleOpen, setImageNodeMultiAngleOpen] = React.useState(false)
  const [imageNodeMultiAngleGenerating, setImageNodeMultiAngleGenerating] = React.useState(false)
  const [imageNodeCamera, setImageNodeCamera] = React.useState<PanoramicCameraState>({ azimuthDeg: 0, elevationDeg: 0, fovDeg: 75 })
  const [imageNodeMultiAnglePrompt, setImageNodeMultiAnglePrompt] = React.useState('')
  const [panoramicGenerating, setPanoramicGenerating] = React.useState(false)
  const [panoramicConfirm, setPanoramicConfirm] = React.useState(false)
  const [panoramicSphereMode, setPanoramicSphereMode] = React.useState(false)
  const [gridSplitOpen, setGridSplitOpen] = React.useState(false)
  const [pendingIntentConfig, setPendingIntentConfig] = React.useState<{ intent: ChapterCanvasIntent; chapterContext: NonNullable<ReturnType<typeof resolveIntentChapterContext>> } | null>(null)
  const activeIntent = useIntentLifecycle((s) => s.activeIntent)
  const runningNodeIntents = useIntentLifecycle((s) => s.runningNodeIntents)
  // ─── 图片编辑器 state ─────────────────────────────────────────────────────
  const [cropOpen, setCropOpen] = React.useState(false)
  const [trimOpen, setTrimOpen] = React.useState(false)
  const [videoContinuationOpen, setVideoContinuationOpen] = React.useState(false)
  const [videoToolEditorMode, setVideoToolEditorMode] = React.useState<VideoToolEditorMode | null>(null)
  const [videoEditModel, setVideoEditModel] = React.useState('')
  const [maskMode, setMaskMode] = React.useState<'repaint' | 'erase' | null>(null)
  const [annotateOpen, setAnnotateOpen] = React.useState(false)
  const [elementEditOpen, setElementEditOpen] = React.useState(false)
  const [portraitTextureEditorOutputNodeId, setPortraitTextureEditorOutputNodeId] = React.useState<string | null>(null)
  const [hdPanelOpen, setHdPanelOpen] = React.useState(false)
  const [hdLoading, setHdLoading] = React.useState(false)
  const [emotionPanelOpen, setEmotionPanelOpen] = React.useState(false)
  const [emotionPersonSelectorOpen, setEmotionPersonSelectorOpen] = React.useState(false)
  const [emotionSelectorManual, setEmotionSelectorManual] = React.useState(false)
  const [emotionSelection, setEmotionSelection] = React.useState<PortraitTextureSelection | null>(null)
  const [emotionLoading, setEmotionLoading] = React.useState(false)
  const [emotionError, setEmotionError] = React.useState<string | null>(null)
  const [denoiseLoading, setDenoiseLoading] = React.useState(false)
  const [expandPanelOpen, setExpandPanelOpen] = React.useState(false)
  const [expandLoading, setExpandLoading] = React.useState(false)
  const isRotatePreview = !!(data as any)?._rotatePreview
  const [rotatePrevAngle, setRotatePrevAngle] = React.useState<number>(() => Number((data as any)?._rotatePreview?.angle ?? 0))
  const [rotatePrevFlipH, setRotatePrevFlipH] = React.useState<boolean>(() => Boolean((data as any)?._rotatePreview?.flipH))
  const [rotatePrevFlipV, setRotatePrevFlipV] = React.useState<boolean>(() => Boolean((data as any)?._rotatePreview?.flipV))
  const [rotateSaving, setRotateSaving] = React.useState(false)
  const [rotatePreviewNodeId, setRotatePreviewNodeId] = React.useState<string | null>(null)
  const [extractLoading, setExtractLoading] = React.useState(false)
  const [smartCutoutLoading, setSmartCutoutLoading] = React.useState(false)
  const [layerLoading, setLayerLoading] = React.useState(false)
  const [imageNaturalSize, setImageNaturalSize] = React.useState<{ w: number; h: number } | null>(null)
  const [gridSplitRows, setGridSplitRows] = React.useState(2)
  const [gridSplitCols, setGridSplitCols] = React.useState(2)
  const [gridSplitSelectedCells, setGridSplitSelectedCells] = React.useState<Set<string>>(new Set())
  const [gridSplitHoveredCell, setGridSplitHoveredCell] = React.useState<string | null>(null)
  const [gridSplitScale, setGridSplitScale] = React.useState(2)
  const [gridSplitCreating, setGridSplitCreating] = React.useState(false)
  const [gridSplitCreatingHD, setGridSplitCreatingHD] = React.useState(false)
  React.useEffect(() => {
    if (videoEditModel && videoEditModelOptions.some((option) => option.value === videoEditModel)) return
    const next = videoEditModelOptions[0]?.value || ''
    if (next !== videoEditModel) setVideoEditModel(next)
  }, [videoEditModel, videoEditModelOptions])
  const panoramicModelOption = React.useMemo(
    () => findModelOptionByIdentifier(imageEditActionOptions, imageModel)
      ?? (!imageModel ? imageEditActionOptions[0] ?? null : null),
    [imageEditActionOptions, imageModel],
  )
  const panoramicSpecKey = React.useMemo(
    () => buildImageBillingSpecKeyForOption({ modelOption: panoramicModelOption, aspect: '2:1', imageSize: '', imageResolution: '4k' }),
    [panoramicModelOption],
  )
  const panoramicCredits = React.useMemo(
    () => resolveModelGenerationCredits({ kind: 'image', modelOption: panoramicModelOption, specKey: panoramicSpecKey, quantity: 1 }),
    [panoramicModelOption, panoramicSpecKey],
  )

  const handlePanoramicCameraChange = React.useCallback(
    (camera: PanoramicCameraState) => {
      updateNodeData(id, { panoramicCamera: camera })
    },
    [id, updateNodeData],
  )

  const handleImageNodeMultiAngleCapture = React.useCallback(
    async (
      _captures: Array<{ label: string; dataUrl: string }>,
      options: { promptEnabled: boolean },
    ) => {
      if (imageNodeMultiAngleGenerating) return
      const baseImageUrl = (primaryImageUrl || imageResults[imagePrimaryIndex]?.url || imageResults[0]?.url || '').trim()
      if (!baseImageUrl) {
        toast('多角度生成缺少真实源图片', 'error')
        return
      }
      const stateBefore = useRFStore.getState()
      const beforeIds = new Set(stateBefore.nodes.map((node) => node.id))
      const editableModel = resolveImageEditModelForAction()
      if (!editableModel) return
      setImageNodeMultiAngleGenerating(true)
      const horizontalAngle = Math.round(((imageNodeCamera.azimuthDeg % 360) + 360) % 360)
      const verticalAngle = Math.round(Math.max(-30, Math.min(60, imageNodeCamera.elevationDeg)))
      const zoom = multiAngleFovToZoom(imageNodeCamera.fovDeg)
      const executionPrompt = options.promptEnabled ? imageNodeMultiAnglePrompt.trim() : ''
      const cameraParameters = {
        azimuthDeg: horizontalAngle,
        elevationDeg: verticalAngle,
        fovDeg: imageNodeCamera.fovDeg,
        distance: cameraFovToImageDistance(imageNodeCamera.fovDeg),
      }
      const imageOperationSpec = createImageOperationForSource({
        kind: 'multi_angle',
        execution: 'image-edit',
        sourceNodeId: id,
        sourceUrl: baseImageUrl,
        sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
        parameters: {
          horizontal_angle: String(horizontalAngle),
          vertical_angle: String(verticalAngle),
          zoom: String(zoom),
          prompt: executionPrompt,
          camera: cameraParameters,
          preserveIdentity: true,
          preserveSceneLayout: true,
        },
      })
      try {
        addNode('taskNode', `多角度 ${horizontalAngle}°/${verticalAngle}°`, {
          kind: 'imageEdit',
          prompt: executionPrompt,
          imageModel: editableModel,
          imageModelVendor: null,
          referenceImages: [baseImageUrl],
          imageOperationSpec,
          imageOperationState: createImageOperationState(imageOperationSpec),
          imageOperationRevision: 1,
          libTvImageOperationKey: 'multi-angle',
          imageCameraControl: {
            enabled: true,
            presetId: 'front',
            azimuthDeg: horizontalAngle,
            elevationDeg: verticalAngle,
            distance: cameraFovToImageDistance(imageNodeCamera.fovDeg),
          },
        })
        const afterAdd = useRFStore.getState()
        const newNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
        if (!newNode) throw new Error('多角度结果节点创建失败')
        const sourceNode = afterAdd.nodes.find((node) => node.id === id)
        afterAdd.onNodesChange([
          { id: newNode.id, type: 'position', position: { x: (sourceNode?.position?.x || 0) + 380, y: sourceNode?.position?.y || 0 }, dragging: false },
          { id: id, type: 'select' as const, selected: false },
          { id: newNode.id, type: 'select', selected: true },
        ])
        afterAdd.onConnect({ source: id, sourceHandle: 'out-image', target: newNode.id, targetHandle: 'in-image' })
        setImageNodeMultiAngleOpen(false)
        await runNodeDagToTarget(newNode.id, useRFStore.getState, useRFStore.setState, { concurrency: 1 })
      } catch (error: unknown) {
        toast(error instanceof Error ? error.message : '多角度生成启动失败', 'error')
      } finally {
        setImageNodeMultiAngleGenerating(false)
      }
    },
    [addNode, data, id, imageNodeCamera, imageNodeMultiAngleGenerating, imageNodeMultiAnglePrompt, imageResults, imagePrimaryIndex, primaryImageUrl, resolveImageEditModelForAction],
  )

  // audio 与图/视频同用 media-focus 工具栏与可调尺寸资产卡（样式统一）
  const isCanvasMediaNode = coreKind === 'image' || coreKind === 'video' || coreKind === 'audio'
  // audio 卡片固定 16:9，不参与自由 resize；仍走 media-focus 工具栏
  const isResizableVisualNode =
    (isCanvasMediaNode && coreKind !== 'audio') || isStoryboardEditorNode || isStructuredWorkflowNode
  const useMediaFocusToolbar = isCanvasMediaNode && !isVideoComposeNode
  const isPortraitTextureNode = (data as Record<string, unknown>).libTvImageOperationKey === 'portrait-adjust'
  const showStyleChip = (isImageNode || kind === 'imageEdit') && useMediaFocusToolbar
  const showCameraChip = (isImageNode || kind === 'imageEdit') && useMediaFocusToolbar
  const portraitTextureEditorOpen = portraitTextureEditorOutputNodeId !== null
  const anyImageEditorOpen = cropOpen || maskMode !== null || annotateOpen || elementEditOpen || portraitTextureEditorOpen || emotionPersonSelectorOpen || hdPanelOpen || expandPanelOpen || isRotatePreview || trimOpen || showEnhancePanel || videoContinuationOpen || videoToolEditorMode !== null || imageNodeMultiAngleOpen || imageViewEditorOpen
  // 视频菜单能力（高清增强、智能续写、智能擦除、智能去字幕、主体消除、音视频分离）
  // 都是配置面板/弹窗，不应复用图片/视频编辑覆盖层的 fitView + lock。否则大尺寸
  // 视频节点会被强制移到视口中心，面板反而被推到视口外，用户无法平移画布操作。
  // 真正需要在媒体表面上拖拽的裁剪、蒙版、标注、时间轴编辑仍保留聚焦锁定。
  const canvasViewLockEditorOpen =
    cropOpen || maskMode !== null || annotateOpen || elementEditOpen || portraitTextureEditorOpen || emotionPersonSelectorOpen || hdPanelOpen || expandPanelOpen || isRotatePreview || trimOpen || imageNodeMultiAngleOpen || imageViewEditorOpen
  const showBottomToolbar =
    isSingleSelectionActive &&
    !isPlainTextNode &&
    !isStoryboardEditorNode &&
    !isVideoComposeNode &&
    !isSegmentRemakeNode &&
    !isStructuredWorkflowNode &&
    !gridSplitOpen &&
    !anyImageEditorOpen
  const mediaNaturalSize = React.useMemo(() => {
    const raw = (data as any)?.mediaNaturalSize
    if (!raw || typeof raw !== 'object') return null
    const w = Number(raw.width)
    const h = Number(raw.height)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
    return { width: w, height: h }
  }, [(data as any)?.mediaNaturalSize])

  const imageDimensionTrailing = hasImageResults && mediaNaturalSize ? (
    <Text
      className="tc-task-node__header-dimensions"
      size="xs"
      c="dimmed"
      style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', userSelect: 'none', pointerEvents: 'none' }}
    >
      {mediaNaturalSize.width} × {mediaNaturalSize.height}
    </Text>
  ) : null

  const textIntentActions = isPlainTextNode ? (
    <div
      className="tc-task-node__header-intent-actions"
      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <LazyIntentActionGroup
        nodeId={id}
        kind={kind}
        semanticKind={typeof data?.kind === 'string' ? data.kind : undefined}
        nodeData={typeof data === 'object' && data ? (data as Record<string, unknown>) : undefined}
        preset={typeof (data as Record<string, unknown>).preset === 'string'
          ? (data as Record<string, unknown>).preset as string
          : undefined}
      />
    </div>
  ) : null

  const showUpstreamReferenceStrip = Boolean(
    useMediaFocusToolbar && (isImageNode || isVideoNode) && isSingleSelectionActive,
  )
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
  const handleOpenMediaMarker = React.useCallback(() => {
    if (isImageNode && hasImageResults) {
      setAnnotateOpen(true)
      setCropOpen(false)
      setMaskMode(null)
      return
    }
    if (isVideoNode) {
      const sourceUrl = videoResults[videoPrimaryIndex]?.url || videoUrl || ''
      if (!sourceUrl) {
        toast('当前没有可标记的真实视频资产', 'error')
        return
      }
      const playback = readRetainedVideoPlaybackSnapshot(buildRetainedVideoSurfaceKey(id, sourceUrl))
      setVideoMarkerPlayback({
        currentTime: playback?.currentTime ?? 0,
        duration: playback?.duration ?? activeVideoDuration,
      })
      setVideoMarkerOpen(true)
      return
    }
    toast('当前节点没有可标记的媒体资产', 'warning')
  }, [activeVideoDuration, hasImageResults, id, isImageNode, isVideoNode, videoPrimaryIndex, videoResults, videoUrl])

  const handleSaveVideoMarker = React.useCallback(async (draft: VideoMarkerDraft): Promise<void> => {
    if (videoMarkerSaving) return
    const sourceVideoUrl = videoResults[videoPrimaryIndex]?.url || videoUrl || ''
    if (!sourceVideoUrl) {
      toast('当前没有可标记的真实视频资产', 'error')
      return
    }
    const rangeError = validateVideoMarkerRange({
      startSeconds: draft.startSeconds,
      endSeconds: draft.endSeconds,
      durationSeconds: videoMarkerPlayback.duration,
    })
    if (rangeError) {
      toast(rangeError, 'error')
      return
    }
    setVideoMarkerSaving(true)
    let capturedFrames: Awaited<ReturnType<typeof captureFramesAtTimes>>['frames'] = []
    try {
      const captured = await captureFramesAtTimes(
        { type: 'url', url: sourceVideoUrl },
        [draft.startSeconds],
        { mimeType: 'image/jpeg', quality: 0.92 },
      )
      capturedFrames = captured.frames
      const frame = capturedFrames[0]
      if (!frame) throw new Error('标记起始时间没有可用视频帧')
      const hosted = await uploadCanvasImageBlob({
        blob: frame.blob,
        label: '视频标记截帧',
        filePrefix: 'video-marker-frame',
        ownerNodeId: id,
        projectId: typeof currentProject?.id === 'string' ? currentProject.id : undefined,
      })
      const marker = createVideoMarker({
        sourceVideoUrl,
        startSeconds: draft.startSeconds,
        endSeconds: draft.endSeconds,
        frameUrl: hosted.url,
        frameAssetId: hosted.assetId,
        note: draft.note,
      })
      updateNodeData(id, {
        videoMarkers: [...videoMarkers, marker],
        activeVideoMarkerId: marker.id,
      })
      setVideoMarkerOpen(false)
      toast(draft.endSeconds > draft.startSeconds ? '已保存视频片段标记' : '已保存视频帧标记', 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '视频标记保存失败', 'error')
    } finally {
      capturedFrames.forEach((frame) => URL.revokeObjectURL(frame.objectUrl))
      setVideoMarkerSaving(false)
    }
  }, [currentProject?.id, id, updateNodeData, videoMarkerPlayback.duration, videoMarkerSaving, videoMarkers, videoPrimaryIndex, videoResults, videoUrl])
  const handleSelectMediaPromptLibraryItem = React.useCallback((item: { prompt: string }) => {
    const addition = item.prompt.trim()
    if (!addition) return
    const nextPrompt = prompt.trim() ? `${prompt.trim()}，${addition}` : addition
    setPrompt(nextPrompt)
    updateNodeData(id, { prompt: nextPrompt })
    setMediaPromptLibraryKind(null)
  }, [id, prompt, updateNodeData])
  const handleApplyCharacterFromLibrary = React.useCallback((character: AiCharacterLibraryCharacterDto) => {
    const roleName = String(character.identity_hint || character.name || character.character_id || '角色').trim()
    const references = buildCharacterReferenceImages(character)
    if (references.length === 0) {
      throw new Error(`角色“${roleName}”没有可用参考图`)
    }
    const record = data as Record<string, unknown>
    const existingReferences = Array.isArray(record.roleCardReferenceImages)
      ? record.roleCardReferenceImages.map((value) => String(value || '').trim()).filter(Boolean)
      : []
    const nextReferences = Array.from(new Set([...existingReferences, ...references]))
      .slice(0, referenceImageLimitRef.current)
    const mention = `@${roleName.replace(/\s+/g, '_')}`
    const nextPrompt = prompt.includes(mention)
      ? prompt
      : `${prompt.trim()}${prompt.trim() ? ' ' : ''}${mention}`
    setPrompt(nextPrompt)
    updateNodeData(id, {
      prompt: nextPrompt,
      roleName,
      characterBible: buildCharacterBibleFromDto(character),
      roleCardReferenceImages: nextReferences,
    })
  }, [data, id, prompt, updateNodeData])
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

  const visualNodeDefaults = React.useMemo(
    () => isSegmentRemakeNode
      ? { width: 610, height: 350, minWidth: 300, maxWidth: 960, minHeight: 169, maxHeight: 720 }
      : getVisualNodeDefaults(kind, coreKind, isStoryboardEditorNode),
    [coreKind, isSegmentRemakeNode, isStoryboardEditorNode, kind],
  )
  const textNodeSize = isPlainTextNode
    ? getTextNodeSize(data as Record<string, unknown>)
    : null

  const nodeWidth = isResizableVisualNode
    ? clampFinite((data as any)?.nodeWidth, visualNodeDefaults.minWidth, visualNodeDefaults.maxWidth, visualNodeDefaults.width)
    : isPlainTextNode
      ? (textNodeSize?.width ?? TEXT_NODE_DEFAULT_WIDTH)
    : typeof (data as any)?.nodeWidth === 'number' && Number.isFinite((data as any)?.nodeWidth)
      ? Math.max(320, Math.min(720, Number((data as any)?.nodeWidth)))
      : 360

  const nodeHeight = isResizableVisualNode
    ? clampFinite((data as any)?.nodeHeight, visualNodeDefaults.minHeight, visualNodeDefaults.maxHeight, visualNodeDefaults.height)
    : null

  const editedImageUploadCacheRef = React.useRef<Map<string, Promise<HostedEditedImageAsset>>>(new Map())

  const uploadEditedImageBlob = React.useCallback(async (input: {
    blob: Blob
    label: string
    filePrefix: string
    taskKind?: string
  }): Promise<HostedEditedImageAsset> => {
    const digest = await createBlobSha256Hex(input.blob)
    const mimeType = (input.blob.type || '').split(';')[0].trim() || 'image/png'
    const taskKind = typeof input.taskKind === 'string' && input.taskKind.trim()
      ? input.taskKind.trim()
      : 'image_edit'
    const projectId = typeof currentProject?.id === 'string' ? currentProject.id.trim() : ''
    const cacheKey = [projectId, taskKind, mimeType, input.blob.size, digest].join('|')
    const cached = editedImageUploadCacheRef.current.get(cacheKey)
    if (cached) return await cached

    const uploadPromise = (async (): Promise<HostedEditedImageAsset> => {
      const extension = getImageFileExtension(mimeType)
      const fileName = `${normalizeUploadFilePrefix(input.filePrefix)}-${digest.slice(0, 16)}.${extension}`
      const file = new File([input.blob], fileName, { type: mimeType, lastModified: 0 })
      const uploaded = await uploadServerAssetFile(file, input.label, {
        taskKind,
        ownerNodeId: id,
        ...(projectId ? { projectId } : {}),
      })
      const url = readServerAssetHostedUrl(uploaded)
      const assetId = typeof uploaded.id === 'string' ? uploaded.id.trim() : ''
      if (!url || !assetId) {
        throw new Error(`${input.label}已处理，但上传结果缺少可用图片 URL`)
      }
      notifyAssetRefresh()
      return { url, assetId }
    })()

    editedImageUploadCacheRef.current.set(cacheKey, uploadPromise)
    try {
      return await uploadPromise
    } catch (error) {
      editedImageUploadCacheRef.current.delete(cacheKey)
      throw error
    }
  }, [currentProject?.id, id])

  // Panoramic callbacks (depend on nodeWidth)
  const handlePanoramicScreenshot = React.useCallback(async () => {
    const viewer = panoramicViewerRef.current
    if (!viewer || !hasPrimaryImage) return
    const dataUrl = viewer.captureAtAngle(
      panoramicCamera.azimuthDeg,
      panoramicCamera.elevationDeg,
      panoramicCamera.fovDeg,
      1280,
      720,
    )
    if (!dataUrl) return
    const sourceNode = useRFStore.getState().nodes.find((n) => n.id === id)
    const sx = sourceNode ? Number(sourceNode.position.x) : 0
    const sy = sourceNode ? Number(sourceNode.position.y) : 0
    const label = `全景截图-${Math.round(panoramicCamera.azimuthDeg)}°`
    try {
      const hosted = await uploadEditedImageBlob({
        blob: await dataUrlToImageBlob(dataUrl),
        label,
        filePrefix: 'panoramic-screenshot',
      })
      const imageResult = buildHostedImageResult(hosted, label)
      addNode('taskNode', label, {
        kind: 'image',
        imageUrl: hosted.url,
        imageResults: [imageResult],
        imagePrimaryIndex: 0,
        serverAssetId: hosted.assetId,
        status: 'done',
        position: { x: sx + nodeWidth + 96, y: sy },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '全景截图上传失败'
      toast(message, 'error')
    }
  }, [addNode, hasPrimaryImage, id, nodeWidth, panoramicCamera, uploadEditedImageBlob])

  const handlePanoramicMultiView = React.useCallback(
    async (count: 4 | 12) => {
      const viewer = panoramicViewerRef.current
      if (!viewer || !hasPrimaryImage) return
      const angles = count === 4 ? FOUR_VIEW_ANGLES : TWELVE_VIEW_ANGLES
      const captures = angles.map((a) => ({
        label: a.label,
        dataUrl: viewer.captureAtAngle(a.azimuthDeg, a.elevationDeg, a.fovDeg, 1280, 720) ?? '',
      })).filter((c) => c.dataUrl)
      if (!captures.length) return
      const uploadedCaptures: Array<{ label: string; asset: HostedEditedImageAsset }> = []
      for (const capture of captures) {
        try {
          const asset = await uploadEditedImageBlob({
            blob: await dataUrlToImageBlob(capture.dataUrl),
            label: capture.label,
            filePrefix: 'panoramic-multiview',
          })
          uploadedCaptures.push({ label: capture.label, asset })
        } catch (error) {
          const message = error instanceof Error ? error.message : '上传失败'
          toast(`${capture.label} 上传失败：${message}`, 'error')
        }
      }
      if (!uploadedCaptures.length) return

      const sourceNode = useRFStore.getState().nodes.find((n) => n.id === id)
      const sx = sourceNode ? Number(sourceNode.position.x) : 0
      const sy = sourceNode ? Number(sourceNode.position.y) : 0
      const groupId = `group-${Date.now()}`
      const colWidth = 360
      const colGap = 24
      const rowHeight = 260
      const rowGap = 24
      const cols = count === 4 ? 2 : 4
      const groupW = cols * colWidth + (cols - 1) * colGap + 48
      const rows = Math.ceil(uploadedCaptures.length / cols)
      const groupH = rows * rowHeight + (rows - 1) * rowGap + 48
      const groupX = sx + nodeWidth + 96
      const groupY = sy

      useRFStore.setState((s: any) => {
        const newGroupNode = {
          id: groupId,
          type: 'groupNode',
          position: { x: groupX, y: groupY },
          data: { label: `全景截图组 (${count}张)` },
          style: { width: groupW, height: groupH },
        }
        const newImageNodes = uploadedCaptures.map((cap, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          const imageResult = buildHostedImageResult(cap.asset, cap.label)
          return {
            id: `pano-shot-${Date.now()}-${i}`,
            type: 'taskNode',
            position: { x: 24 + col * (colWidth + colGap), y: 24 + row * (rowHeight + rowGap) },
            parentId: groupId,
            data: {
              label: cap.label,
              kind: 'image',
              imageUrl: cap.asset.url,
              imageResults: [imageResult],
              imagePrimaryIndex: 0,
              serverAssetId: cap.asset.assetId,
              status: 'done',
            },
            style: { width: colWidth, height: rowHeight },
          }
        })
        const sourceEdge = {
          id: `e-pano-${id}-${groupId}`,
          source: id,
          target: groupId,
          type: 'default',
        }
        return {
          nodes: [...s.nodes, newGroupNode, ...newImageNodes],
          edges: [...s.edges, sourceEdge],
        }
      })
    },
    [hasPrimaryImage, id, nodeWidth, uploadEditedImageBlob],
  )

  const handleGeneratePanoramic = React.useCallback(async () => {
    const sourceUrl = primaryImageUrl
    if (!sourceUrl || panoramicGenerating) return
    const selectedPanoramicModel = resolveImageEditModelForAction()
    if (!selectedPanoramicModel) return
    setPanoramicGenerating(true)
    const imageOperationSpec = createPresetImageOperation({
      presetKey: 'panorama-720',
      sourceNodeId: id,
      sourceUrl,
      sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
    })
    const sourceNode = useRFStore.getState().nodes.find((n) => n.id === id)
    const sx = sourceNode ? Number(sourceNode.position.x) : 0
    const sy = sourceNode ? Number(sourceNode.position.y) : 0
    const newNodeId = `pano-${Date.now()}`
    useRFStore.setState((s: any) => ({
      nodes: [
        ...s.nodes,
        {
          id: newNodeId,
          type: 'taskNode',
          position: { x: sx + nodeWidth + 96, y: sy },
          data: {
            label: '720°全景图',
            kind: 'image',
            status: 'running',
            isPanoramic: true,
            imageOperationSpec,
            imageOperationState: {
              ...createImageOperationState(imageOperationSpec, 'running'),
              attempt: 1,
              progress: 5,
              startedAt: new Date().toISOString(),
            },
            imageOperationRevision: 1,
            libTvImagePresetKey: 'panorama-720',
            libTvImageOperationKey: 'panorama-720',
          },
          style: { width: 400, height: 200 },
        },
      ],
      edges: [
        ...s.edges,
        { id: `e-pano-derive-${id}-${newNodeId}`, source: id, target: newNodeId, type: 'default' },
      ],
    }))
    try {
      let result = await runTaskByVendor('auto', withCanvasGenerationContext({
        kind: 'image_edit',
        prompt: `Convert this image into a 360-degree equirectangular panorama with 2:1 aspect ratio. Seamless horizontal wrap-around, spherical projection compatible, no visible seams at the edges. ${prompt || 'Preserve the original style and atmosphere.'}`,
        extras: {
          modelKey: selectedPanoramicModel,
          referenceImages: [sourceUrl],
          aspectRatio: '2:1',
          resolution: '4k',
          count: 1,
          imageOperationSpec,
          imageOperation: imageOperationSpec.kind,
        },
      }, useUIStore.getState(), newNodeId))
      // 同步图片任务现在会被后端包装成 storedResultReady 的 queued 壳（assets 为空），需轮询 /tasks/result 取最终图。
      let assets: any[] = Array.isArray((result as any)?.assets) ? (result as any).assets : []
      if (assets.length === 0 && (result as any)?.id) {
        const taskId = (result as any).id
        const deadline = Date.now() + 3 * 60 * 1000
        while (result.status !== 'succeeded' && result.status !== 'failed' && Date.now() < deadline) {
          await sleep3d(2000)
          const res = await fetchPublicTaskResultWithAuth({ taskId, taskKind: 'image_edit', prompt })
          result = res.result
        }
        if (result.status === 'failed') throw new Error('全景图生成失败')
        if (result.status !== 'succeeded') throw new Error('全景图生成超时，请稍后重试')
        assets = Array.isArray((result as any)?.assets) ? (result as any).assets : []
      }
      const firstImage = assets.find((a: any) => a?.type === 'image' && a?.url)
      if (firstImage?.url) {
        useRFStore.setState((s: any) => ({
          nodes: s.nodes.map((n: any) =>
            n.id === newNodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    imageUrl: firstImage.url,
                    imageResults: [{ url: firstImage.url, title: '720°全景图' }],
                    imagePrimaryIndex: 0,
                    status: 'success',
                    isPanoramic: true,
                    imageOperationState: {
                      ...createImageOperationState(imageOperationSpec, 'succeeded'),
                      attempt: 1,
                      progress: 100,
                      startedAt: imageOperationSpec.createdAt,
                      finishedAt: new Date().toISOString(),
                      resultAssets: [{ role: 'result' as const, url: firstImage.url }],
                    },
                    imageOperationRevision: imageOperationSpec.sourceRevision + 1,
                  },
                }
              : n,
          ),
        }))
        notifyAssetRefresh()
      } else {
        throw new Error('未返回全景图')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '全景图生成失败'
      toast(msg, 'error')
      useRFStore.setState((s: any) => ({
        nodes: s.nodes.map((n: any) =>
          n.id === newNodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  status: 'error',
                  lastError: msg,
                  imageOperationState: {
                    ...createImageOperationState(imageOperationSpec, 'failed'),
                    attempt: 1,
                    progress: 0,
                    finishedAt: new Date().toISOString(),
                    error: { code: 'panorama_generation_failed', message: msg, retryable: true },
                  },
                },
              }
            : n,
        ),
      }))
    } finally {
      setPanoramicGenerating(false)
    }
  }, [data, id, nodeWidth, panoramicGenerating, primaryImageUrl, prompt, resolveImageEditModelForAction, sleep3d])

  const toolbarBaseWidth = useMediaFocusToolbar ? 660 : 380
  const toolbarMinScale = 220 / toolbarBaseWidth
  // React Flow 的 NodeToolbar 本身已保持屏幕尺寸；媒体生成卡不再叠加画布缩放，
  // 否则缩放/平移后会从 LibTV 的固定 660px 卡片缩成不可操作的小条。
  const toolbarScale = useMediaFocusToolbar ? 1 : Math.max(toolbarMinScale, canvasZoom)
  const toolbarWidthCss = `min(${toolbarBaseWidth}px, calc((100vw - 48px) / ${toolbarScale}))`
  const toolbarMaxHeightCss = `calc(60vh / ${toolbarScale})`
  const textNodeHeight = isPlainTextNode
    ? (textNodeSize?.height ?? TEXT_NODE_DEFAULT_HEIGHT)
    : null

  const variantsOpen = Boolean((data as any)?.variantsOpen)
  const variantsBaseWidthRaw = Number((data as any)?.variantsBaseWidth)
  const variantsBaseHeightRaw = Number((data as any)?.variantsBaseHeight)
  const variantsBaseWidth = Number.isFinite(variantsBaseWidthRaw) && variantsBaseWidthRaw > 0 ? variantsBaseWidthRaw : null
  const variantsBaseHeight = Number.isFinite(variantsBaseHeightRaw) && variantsBaseHeightRaw > 0 ? variantsBaseHeightRaw : null

  const isNovelStoryboardNode = (data as Record<string, unknown>).kind === 'novelStoryboard'
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
        // Mark as user-sized so auto-normalization (fitVisualSizeToNatural) never overrides it.
        nodeSizeManual: true,
      })
    },
    [clampFinite, id, nodeHeight, nodeWidth, updateNodeData, visualNodeDefaults.height, visualNodeDefaults.maxHeight, visualNodeDefaults.maxWidth, visualNodeDefaults.minHeight, visualNodeDefaults.minWidth],
  )

  const handleMediaNaturalSize = React.useCallback(
    (size: MediaNaturalSize) => {
      const naturalWidth = Number(size.width)
      const naturalHeight = Number(size.height)
      const naturalUrl = String(size.url || '').trim()
      if (!naturalUrl || !Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) return

      // Manually-resized nodes keep their explicit size — never auto-normalize them.
      if ((data as any)?.nodeSizeManual === true) return

      const currentWidth = nodeWidth
      const currentHeight = nodeHeight ?? visualNodeDefaults.height
      // Normalize to the unified target size (fit natural ratio at the kind's target area) — shared
      // with the lightweight shell so before/after-focus boxes are identical. Driven by size delta
      // (not just ratio) so same-aspect-but-undersized legacy nodes also snap to the unified size.
      const { width: fittedWidth, height: fittedHeight } = fitVisualSizeToNatural(
        currentWidth, currentHeight, naturalWidth, naturalHeight, visualNodeDefaults,
      )
      if (Math.abs(fittedWidth - currentWidth) <= 1 && Math.abs(fittedHeight - currentHeight) <= 1) return

      updateNodeData(id, {
        nodeWidth: fittedWidth,
        nodeHeight: fittedHeight,
        mediaNaturalSize: {
          width: Math.round(naturalWidth),
          height: Math.round(naturalHeight),
          url: naturalUrl,
        },
      })
      // Sync RF node style so NodeToolbar at Position.Bottom uses the updated height
      rf.updateNode(id, (node) => ({
        style: { ...node.style, width: fittedWidth, height: fittedHeight },
      }))
      // Refit parent group so it doesn't overflow when images load and resize nodes
      const parentGroupId = String((rf.getNode(id) as any)?.parentId || '').trim()
      if (parentGroupId) {
        setTimeout(() => useRFStore.getState().fitGroupToChildren(parentGroupId), 80)
      }
    },
    [data, id, nodeHeight, nodeWidth, updateNodeData, visualNodeDefaults],
  )

  const handleVideoEmptyAction = React.useCallback((action: MediaEmptyAction) => {
    if (action === 'long-video') {
      const ultraLongLimit = videoModelConfig?.maxUltraLongDurationSeconds ?? 0
      if (ultraLongLimit < 300) {
        toast('当前视频模型不支持 5 分钟超长视频，请先切换支持该能力的模型', 'warning')
        return
      }
      handleToolbarDurationChange(300)
      return
    }
    if (action === 'first-last-frame-video') {
      if (videoModelConfig?.supportsFirstLastFrame !== true) {
        toast('当前视频模型不支持首尾帧生成，请先切换支持该能力的模型', 'warning')
        return
      }
      setContinueVeoSelectionToLastFrame(true)
      openVeoModal('first')
      return
    }
    if (action === 'first-frame-video') {
      if (videoModelConfig?.supportsReferenceImages !== true && resolvedVideoVendor !== 'veo') {
        toast('当前视频模型不支持首帧参考，请先切换支持该能力的模型', 'warning')
        return
      }
      setContinueVeoSelectionToLastFrame(false)
      openVeoModal('first')
    }
  }, [handleToolbarDurationChange, openVeoModal, resolvedVideoVendor, videoModelConfig])

  const handleSegmentRemakeConfirm = React.useCallback(async (ranges: SegmentRemakeRange[], nextPrompt: string) => {
    updateNodeData(id, {
      prompt: nextPrompt,
      segmentRemakeRanges: ranges,
      segmentRemakeSubmittedAt: new Date().toISOString(),
      status: 'queued',
    })
    requestVideoClipAgentAction({
      nodeId: id,
      action: 'revise_clip',
      runId: readVideoClipRunId(data),
      clipIndex: readVideoClipIndex(data),
    })
  }, [data, id, updateNodeData])

  const segmentRemakeRanges = React.useMemo<SegmentRemakeRange[]>(() => {
    const raw = (data as Record<string, unknown>).segmentRemakeRanges
    if (!Array.isArray(raw)) return []
    return raw.flatMap((value): SegmentRemakeRange[] => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
      const record = value as Record<string, unknown>
      const start = Number(record.start)
      const end = Number(record.end)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []
      return [{ start, end }]
    }).slice(0, 5)
  }, [data])

	  const videoContent = !isVideoNode
	    ? null
	    : isSegmentRemakeNode
	      ? (
	        <LazySegmentRemakeContent
	          videoUrl={videoResults[videoPrimaryIndex]?.url || videoUrl || ''}
          videoDuration={activeVideoDuration ?? (Number((data as Record<string, unknown>).videoDuration) || 0)}
          videoTitle={videoTitle}
          initialRanges={segmentRemakeRanges}
	          prompt={prompt}
	          onPromptChange={(value) => { setPrompt(value); updateNodeData(id, { prompt: value }) }}
	          onConfirm={handleSegmentRemakeConfirm}
          onReference={() => setVideoExpanded(true)}
          onCharacterLibrary={() => setCharacterLibraryOpen(true)}
          onFullscreen={() => setVideoExpanded(true)}
          quickActions={() => (
            <LazyLibTvMediaQuickActions
              kind="video"
              disabled={nodeReadOnly || isRunning}
              referenceActive={canvasReferencePickerActive}
              markerActive={videoMarkers.length > 0 || videoMarkerOpen}
              onReference={handleToggleCanvasReferencePicker}
              onMarker={handleOpenMediaMarker}
              onEffect={() => setMediaPromptLibraryKind('effect')}
              onCharacters={() => setCharacterLibraryOpen(true)}
              onCameraMovement={() => setMediaPromptLibraryKind('camera')}
              onFocus={handleFocusNode}
            />
          )}
          modelValue={videoModel}
          modelOptions={modelMenuOptions.map((option) => ({ value: option.value, label: option.label }))}
          onModelChange={handleToolbarModelChange}
          resolutionValue={effectiveVideoResolution}
          resolutionOptions={configuredVideoResolutionOptions}
          onResolutionChange={handleToolbarVideoResolutionChange}
          runCount={runCount}
          onRunCountChange={(value) => updateNodeData(id, { runCount: value })}
          readOnly={nodeReadOnly}
        />
      )
	    : (
	      <LazyVideoContent
        nodeId={id}
        videoResults={videoResults}
        videoPrimaryIndex={videoPrimaryIndex}
        videoUrl={videoUrl}
        videoThumbnailUrl={videoThumbnailUrl}
        videoTitle={videoTitle}
        mediaOverlayBackground={mediaOverlayBackground}
        mediaOverlayText={mediaOverlayText}
        mediaFallbackSurface={mediaFallbackSurface}
        mediaFallbackText={mediaFallbackText}
		        inlineDividerColor={inlineDividerColor}
		        accentPrimary={accentPrimary}
		        rgba={rgba}
		        videoSurface={videoSurface}
		        onOpenVideoModal={() => setVideoExpanded(true)}
		        onMediaNaturalSize={handleMediaNaturalSize}
		        onUpload={viewOnly ? undefined : handleVideoUpload}
		        uploading={videoUploading}
		        onEmptyAction={viewOnly ? undefined : handleVideoEmptyAction}
	      />
	    )


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
    () => {
      const record = data as Record<string, unknown>
      const chunkId = typeof record.storyboardChunkId === 'string' ? record.storyboardChunkId.trim() : ''
      return (
        !!novelStoryboardProgressMeta &&
        status === 'success' &&
        record.storyboardMetadataStatus === 'persisted' &&
        chunkId.length > 0
      )
    },
    [data, novelStoryboardProgressMeta, status],
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
      const { runNovelStoryboardContinuation } = await import('./taskNode/novelStoryboardContinuation')
      await runNovelStoryboardContinuation({
        progressMeta: novelStoryboardProgressMeta,
        data: data as Record<string, unknown>,
        nodeId: id,
        addNode,
        appendLog,
        resolveImageEditModelForAction,
        setNodeStatus,
        updateNodeData,
      })
    } finally {
      setNovelStoryboardContinueLoading(false)
    }
  }, [
    addNode,
    appendLog,
    data,
    id,
    novelStoryboardContinueLoading,
    novelStoryboardProgressMeta,
    resolveImageEditModelForAction,
    setNodeStatus,
    updateNodeData,
  ])

  React.useEffect(() => {
    if (!isNovelStoryboardNode || !novelStoryboardProgressMeta || !novelStoryboardSessionId) return
    const record = data as Record<string, unknown>
    const pipelineStatus = typeof record.storyboardPipelineStatus === 'string'
      ? record.storyboardPipelineStatus.trim()
      : ''
    if ((status === 'running' || status === 'queued') && pipelineStatus !== 'succeeded') {
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
    if (pipelineStatus === 'succeeded' && status === 'queued') {
      syncCreationSessionCheckpoint({
        id: novelStoryboardSessionId,
        title: novelStoryboardProgressMeta.chapter > 0 ? `AI 创作 · 第${novelStoryboardProgressMeta.chapter}章` : 'AI 创作',
        status: 'paused',
        unitType: 'storyboard_chunk',
        currentIndex: Math.max(0, novelStoryboardCurrentIndex),
        total: novelStoryboardTotalUnits,
        currentNodeId: id,
        currentTaskId: novelStoryboardProgressMeta.taskId,
        summary: '本组分镜脚本已通过语义审查，等待生成真实画面与尾帧后再继续下一单元。',
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
    if (status === 'success' && record.storyboardMetadataStatus === 'failed') {
      syncCreationSessionCheckpoint({
        id: novelStoryboardSessionId,
        title: novelStoryboardProgressMeta.chapter > 0 ? `AI 创作 · 第${novelStoryboardProgressMeta.chapter}章` : 'AI 创作',
        status: 'paused',
        unitType: 'storyboard_chunk',
        currentIndex: Math.max(0, novelStoryboardCurrentIndex),
        total: novelStoryboardTotalUnits,
        currentNodeId: id,
        currentTaskId: novelStoryboardProgressMeta.taskId,
        summary: typeof record.storyboardMetadataError === 'string' && record.storyboardMetadataError.trim()
          ? record.storyboardMetadataError.trim()
          : '画面已生成并保留，但章节分镜元数据写入失败；修复落库后才能继续下一单元。',
        updatedAt: Date.now(),
      })
      return
    }
    if (status === 'error') {
      failCreationSession(String(record.lastError || '创作单元执行失败'))
    }
  }, [
    data,
    failCreationSession,
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
  const handleGridSplitCellClick = React.useCallback((key: string, shift: boolean) => {
    setGridSplitSelectedCells((prev) => {
      const next = new Set(prev)
      if (shift) {
        if (next.has(key)) next.delete(key)
        else next.add(key)
      } else {
        if (next.has(key) && next.size === 1) next.clear()
        else { next.clear(); next.add(key) }
      }
      return next
    })
  }, [])

  const handleRotateDragStart = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const nodeEl = e.currentTarget.closest('.tc-task-node') as HTMLElement | null
    if (!nodeEl) return
    const rect = nodeEl.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const startPointerAngle = Math.atan2(e.clientX - cx, -(e.clientY - cy)) * 180 / Math.PI
    const startRotation = rotatePrevAngle
    const onMove = (me: PointerEvent) => {
      const pAngle = Math.atan2(me.clientX - cx, -(me.clientY - cy)) * 180 / Math.PI
      let newAngle = startRotation + (pAngle - startPointerAngle)
      newAngle = ((newAngle + 540) % 360) - 180
      setRotatePrevAngle(Math.round(newAngle))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [rotatePrevAngle])

  const handleRotatePrevConfirm = React.useCallback(async () => {
    if (!primaryImageUrl) return
    setRotateSaving(true)
    try {
      // Prefer the already-downloaded resource from ManagedImage cache (blob: / ImageBitmap)
      // to avoid CORS. Only fall back to a fresh fetch when the cache misses.
      const resId = resourceManager.buildResourceId({ url: primaryImageUrl, kind: 'image' })
      const cached = resId ? useResourceRuntimeStore.getState().imageEntries[resId]?.decoded : null

      let drawSource: CanvasImageSource
      let srcW: number
      let srcH: number
      let tempObjUrl: string | null = null

      if (cached?.imageBitmap) {
        drawSource = cached.imageBitmap
        srcW = cached.imageBitmap.width
        srcH = cached.imageBitmap.height
      } else {
        let imgSrc: string
        if (cached?.objectUrl) {
          imgSrc = cached.objectUrl
        } else {
          const blob = await fetchProxiedImageBlob(primaryImageUrl)
          tempObjUrl = URL.createObjectURL(blob)
          imgSrc = tempObjUrl
        }
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image()
          el.crossOrigin = 'anonymous'
          el.onload = () => resolve(el)
          el.onerror = reject
          el.src = imgSrc
        })
        drawSource = img
        srcW = img.naturalWidth
        srcH = img.naturalHeight
      }

      const rad = (rotatePrevAngle * Math.PI) / 180
      const sin = Math.abs(Math.sin(rad))
      const cos = Math.abs(Math.cos(rad))
      const w = Math.round(srcW * cos + srcH * sin)
      const h = Math.round(srcW * sin + srcH * cos)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.translate(w / 2, h / 2)
      ctx.scale(rotatePrevFlipH ? -1 : 1, rotatePrevFlipV ? -1 : 1)
      ctx.rotate(rad)
      ctx.drawImage(drawSource, -srcW / 2, -srcH / 2)
      if (tempObjUrl) URL.revokeObjectURL(tempObjUrl)

      // Upload to OSS to avoid storing a large data: URL in node data (which would
      // cause ManagedImage to load it into the resource store, potentially triggering
      // trimToBudget and evicting other nodes' cached images).
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('canvas.toBlob failed')), 'image/jpeg', 0.95))
      const fileName = `rotate-${id}-${Date.now()}.jpg`
      const projectId = typeof currentProject?.id === 'string' ? currentProject.id.trim() : ''
      const hosted = await uploadServerAssetFile(new File([blob], fileName, { type: 'image/jpeg' }), fileName, {
        ...(projectId ? { projectId } : {}),
        ownerNodeId: id,
      })
      const ossUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
      if (!ossUrl) throw new Error('旋转图片已处理，但上传 OSS 失败')
      const rotatePreview = (data as Record<string, unknown>)._rotatePreview
      const rotatePreviewRecord = rotatePreview && typeof rotatePreview === 'object' && !Array.isArray(rotatePreview)
        ? rotatePreview as Record<string, unknown>
        : null
      const sourceNodeId = typeof rotatePreviewRecord?.sourceId === 'string' && rotatePreviewRecord.sourceId.trim()
        ? rotatePreviewRecord.sourceId.trim()
        : id
      const imageOperationSpec = createImageOperationForSource({
        kind: 'rotate',
        execution: 'local-transform',
        sourceNodeId,
        sourceUrl: primaryImageUrl,
        sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
        parameters: {
          angleDeg: rotatePrevAngle,
          flipHorizontal: rotatePrevFlipH,
          flipVertical: rotatePrevFlipV,
          sourceSize: { width: srcW, height: srcH },
          outputSize: { width: w, height: h },
        },
      })
      updateNodeData(id, {
        imageUrl: ossUrl,
        imageResults: [{ url: ossUrl }],
        serverAssetId: hosted.id,
        _rotatePreview: undefined,
        status: 'done',
        imageOperationSpec,
        imageOperationState: {
          ...createImageOperationState(imageOperationSpec, 'succeeded'),
          attempt: 1,
          progress: 100,
          startedAt: imageOperationSpec.createdAt,
          finishedAt: new Date().toISOString(),
          resultAssets: [{ role: 'result' as const, url: ossUrl, assetId: hosted.id }],
        },
        imageOperationRevision: imageOperationSpec.sourceRevision + 1,
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : '旋转失败', 'error')
    } finally {
      setRotateSaving(false)
    }
  }, [currentProject?.id, data, id, primaryImageUrl, rotatePrevAngle, rotatePrevFlipH, rotatePrevFlipV, updateNodeData])

  const handleRotatePrevClose = React.useCallback(() => {
    useRFStore.getState().deleteNode(id)
  }, [id])

  // Stable callbacks so the React.memo'd <ImageContent> can actually bail out: imageProps is spread
  // prop-by-prop, and in the common (non-panoramic, non-rotating) case the only otherwise-unstable
  // entries are these two inline arrows. With them stabilized, ImageContent skips re-render on every
  // parent re-render whose image data is unchanged (typing prompts, store ticks, sibling updates).
  const handleSelectPrimaryImage = React.useCallback((idx: number, url: string) => {
    setImagePrimaryIndex(idx)
    updateNodeData(id, { imageUrl: url, imagePrimaryIndex: idx })
  }, [id, setImagePrimaryIndex, updateNodeData])
  const handleUpdateNodeDataPatch = React.useCallback(
    (patch: Record<string, any>) => updateNodeData(id, patch),
    [id, updateNodeData],
  )
  const handleImageEmptyAction = React.useCallback((action: MediaEmptyAction) => {
    if (action !== 'image-to-image' && action !== 'image-upscale') return
    pendingImageUploadActionRef.current = action
    const input = fileRef.current
    if (!input) {
      pendingImageUploadActionRef.current = null
      toast('图片选择器尚未就绪，请重新点击', 'error')
      return
    }
    const clearCanceledAction = () => {
      window.setTimeout(() => {
        if (input.files?.length) return
        if (pendingImageUploadActionRef.current === action) {
          pendingImageUploadActionRef.current = null
        }
      }, 250)
    }
    window.addEventListener('focus', clearCanceledAction, { once: true })
    input.click()
  }, [])
  React.useLayoutEffect(() => {
    const pendingAction = consumeMediaEmptyAction(id)
    if (!pendingAction) return
    handleImageEmptyAction(pendingAction)
  }, [handleImageEmptyAction, id])
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
    isGenerating: status === 'running' || status === 'queued',
    canUpload: supportsImageUpload && status !== 'running' && status !== 'queued',
    uploading: isUploadingImage,
    onUpload: handleImageUpload,
    onEmptyAction: handleImageEmptyAction,
    onSelectPrimary: handleSelectPrimaryImage,
    compact: hideImageMeta,
    showStateOverlay: showImageStateOverlay,
    stateLabel: imageStateLabel,
    onUpdateNodeData: handleUpdateNodeDataPatch,
    nodeShellText,
    darkCardShadow,
    mediaOverlayText,
    subtleOverlayBackground,
    imageUrl,
    themeWhite: themeWhite,
    onMediaNaturalSize: handleMediaNaturalSize,
    isPanoramic,
    panoramicSphereMode,
    panoramicCamera,
    panoramicGridVisible,
    panoramicViewerRef,
    onPanoramicCameraChange: handlePanoramicCameraChange,
    onEnterSphereMode: isPanoramic ? () => setPanoramicSphereMode(true) : undefined,
    gridSplitMode: gridSplitOpen && !isPanoramic,
    gridSplitRows: gridSplitOpen ? gridSplitRows : undefined,
    gridSplitCols: gridSplitOpen ? gridSplitCols : undefined,
    gridSplitSelected: gridSplitSelectedCells,
    gridSplitHovered: gridSplitHoveredCell,
    onGridCellHover: setGridSplitHoveredCell,
    onGridCellClick: handleGridSplitCellClick,
    isGridSplitCell: Boolean((data as any)?.isGridSplitCell),
    rotatePreview: isRotatePreview ? { angle: rotatePrevAngle, flipH: rotatePrevFlipH, flipV: rotatePrevFlipV } : undefined,
    onRotateDragStart: isRotatePreview ? handleRotateDragStart : undefined,
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

  const [toolbarDownloading, setToolbarDownloading] = React.useState(false)
  const handleDownload = React.useCallback(async () => {
    if (!toolbarPreview.url) return
    if (toolbarDownloading) return
    const filename = appendDownloadSuffix(data?.label || kind || 'node', Date.now())
    // 优先复用 ManagedImage 已下好的同源 blob:URL —— 跨域的 TOS 链接会让浏览器
    // 忽略 <a download> 属性、转而新开 tab 打开图片。同源 blob: 链接则必定触发直接下载。
    // 缓存未命中再走 downloadUrl 的跨域 fetch + 同源代理逻辑。
    if (toolbarPreview.kind === 'image') {
      const resId = resourceManager.buildResourceId({ url: toolbarPreview.url, kind: 'image' })
      const cachedObjectUrl = resId
        ? useResourceRuntimeStore.getState().imageEntries[resId]?.decoded?.objectUrl
        : null
      if (cachedObjectUrl) {
        void downloadUrl({ url: cachedObjectUrl, filename, preferBlob: false, fallbackTarget: '_self' })
        return
      }
    }
    setToolbarDownloading(true)
    try {
      await downloadUrl({
        url: toolbarPreview.url,
        filename,
        proxyBlob: fetchAssetDownloadBlob,
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : '下载失败，请稍后重试', 'error')
    } finally {
      setToolbarDownloading(false)
    }
  }, [data?.label, kind, toolbarPreview, toolbarDownloading])

  const composedVideoUrl = isVideoComposeNode ? ((data as any)?.videoUrl as string | undefined) || null : null

  const handleComposeDone = React.useCallback(async (blob: Blob) => {
    if (isOrchestratedVideoClip) {
      requestVideoClipAgentAction({
        nodeId: id,
        action: 'revise_clip',
        runId: readVideoClipRunId(data),
        clipIndex: readVideoClipIndex(data),
      })
      return
    }
    // 1) 立即用 blob: URL 写回画布——合成即可见,不被上传阻塞(修复 bfeb2ada8 回归:
    //    旧实现先 await 上传 TOS 再写回,上传慢/卡住时「合成后加不到画布」)。
    const blobUrl = URL.createObjectURL(blob)
    const uploadToken = crypto.randomUUID()
    updateNodeData(id, buildComposeInitialPatch((data as any)?.videoResults, blobUrl, uploadToken))

    // 2) 后台把成片转存 TOS,成功后把临时 blob: URL 换成持久 URL;失败则保留 blob:(本会话仍可播)。
    try {
      const projectId = String(currentProject?.id || '').trim()
      const file = new File([blob], `compose-${Date.now()}.mp4`, { type: 'video/mp4' })
      const asset = await uploadServerAssetFile(file, `成片-${id}`, {
        projectId: projectId || undefined,
        taskKind: 'composeVideo',
      })
      // 注意:上传结果的真实 URL 在 asset.data.url(与全站其它调用一致),不是 asset.url。
      // 原回归代码误用 asset.url(undefined),上传成功反而把 videoUrl 写成空 → 加不到画布。
      const durableUrl =
        typeof (asset as any)?.data?.url === 'string' ? String((asset as any).data.url).trim() : ''
      if (durableUrl) {
        const fresh = useRFStore.getState().nodes.find((n) => n.id === id)
        const patch = buildComposeUrlSwapPatch(fresh?.data, blobUrl, durableUrl, uploadToken)
        if (patch) updateNodeData(id, patch)
      }
    } catch (error: unknown) {
      toast(`成片已在当前会话生成，但持久化上传失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }, [currentProject?.id, data, id, isOrchestratedVideoClip, updateNodeData])

  // 2026-07-17 用户拍板：clips_ready 不再自动触发浏览器合成——合成是用户分步操控的动作，
  // 由用户在成片节点手动点「合成视频」发起（clips_ready 语义不变＝段齐+连线完成，等用户合成）。

  const [composeDownloading, setComposeDownloading] = React.useState(false)
  const handleDownloadComposed = React.useCallback(async () => {
    if (!composedVideoUrl) return
    if (composeDownloading) return
    setComposeDownloading(true)
    try {
      await downloadUrl({ url: composedVideoUrl, filename: appendDownloadSuffix((data as any)?.label || '合成视频', Date.now()), proxyBlob: fetchAssetDownloadBlob })
    } catch (e) {
      toast(e instanceof Error ? e.message : '下载失败，请稍后重试', 'error')
    } finally {
      setComposeDownloading(false)
    }
  }, [composedVideoUrl, data, composeDownloading])

  const videoComposeProps = React.useMemo(
    () =>
      isVideoComposeNode
        ? {
            upstreamVideos,
            composedVideoUrl,
            videoSurface,
            mediaFallbackText,
            nodeHeight: nodeHeight ?? undefined,
            orchestrated: isOrchestratedVideoClip,
            prompt: typeof (data as any)?.prompt === 'string' ? (data as any).prompt : '',
            onPromptChange: (value: string) => updateNodeData(id, { prompt: value }),
            onAddReference: () => openCanvasReferencePicker({ targetNodeId: id }),
            onOpenEditor: () => setComposeEditorOpen(true),
            onDownload: handleDownloadComposed,
            downloading: composeDownloading,
          }
        : undefined,
    [isOrchestratedVideoClip, isVideoComposeNode, upstreamVideos, composedVideoUrl, videoSurface, mediaFallbackText, nodeHeight, handleDownloadComposed, composeDownloading, data, id, updateNodeData, openCanvasReferencePicker],
  )

  const audioType: 'speech' | 'music' = (data as any)?.audioType === 'music' ? 'music' : 'speech'
  const audioSpeechModelOptions = React.useMemo(
    () => modelMenuOptions.filter((option) => isCatalogAudioType(option, 'speech')),
    [modelMenuOptions],
  )
  const audioMusicModelOptions = React.useMemo(
    () => modelMenuOptions.filter((option) => isCatalogAudioType(option, 'music')),
    [modelMenuOptions],
  )
  const activeAudioModelOptions = audioType === 'music' ? audioMusicModelOptions : audioSpeechModelOptions
  React.useEffect(() => {
    if (!isAudioNode || viewOnly || modelListLoading || modelListError || storedAudioModel) return
    const firstValue = String(activeAudioModelOptions[0]?.value || '').trim()
    if (!firstValue) return
    updateNodeData(id, { audioModel: firstValue })
  }, [
    activeAudioModelOptions,
    id,
    isAudioNode,
    modelListError,
    modelListLoading,
    storedAudioModel,
    updateNodeData,
    viewOnly,
  ])
  // 音频参数走 ControlChips 通用芯片（与图片节点底部工具栏同一套样式）
  type AudioControl = {
    key: string
    title: string
    summary: string
    options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
    onChange: (value: string) => void
    render?: React.ReactNode
  }
  const mappedAudioControls = React.useMemo<ReadonlyArray<AudioControl>>(() => {
    if (!isAudioNode) return []
    const audioModel = storedAudioModel
    const selectedAudioOption = findModelOptionByIdentifier(activeAudioModelOptions, audioModel)
    const isDoubao = Boolean(
      selectedAudioOption && readCatalogTags(selectedAudioOption).includes('tapcanvas:audio-engine=doubao'),
    )

    // MiniMax 音色/情绪/语速
    const voiceId =
      (typeof (data as any)?.voiceId === 'string' && ((data as any).voiceId as string).trim()) ||
      'male-qn-qingse'
    const emotion = typeof (data as any)?.emotion === 'string' ? ((data as any).emotion as string) : ''
    const speed = typeof (data as any)?.speed === 'number' ? ((data as any).speed as number) : 1
    // 豆包语音参数
    const doubaoVoiceId =
      typeof (data as any)?.doubaoVoiceId === 'string' ? ((data as any).doubaoVoiceId as string) : ''
    const speechRate = typeof (data as any)?.speechRate === 'number' ? ((data as any).speechRate as number) : 0
    const pitchRate = typeof (data as any)?.pitchRate === 'number' ? ((data as any).pitchRate as number) : 0
    const loudnessRate =
      typeof (data as any)?.loudnessRate === 'number' ? ((data as any).loudnessRate as number) : 0
    const lyricsMode =
      (data as any)?.lyricsMode === 'auto' || (data as any)?.lyricsMode === 'custom'
        ? ((data as any).lyricsMode as 'auto' | 'custom')
        : 'instrumental'

    const modelOptions = activeAudioModelOptions

    const controls: AudioControl[] = [
      {
        key: 'audioType',
        title: '类型',
        summary: audioType === 'music' ? '音乐' : '语音',
        options: [
          { value: 'speech', label: '语音' },
          { value: 'music', label: '音乐' },
        ],
        onChange: (value) => {
          const nextType = value === 'music' ? 'music' : 'speech'
          const nextOptions = nextType === 'music' ? audioMusicModelOptions : audioSpeechModelOptions
          const nextModel = String(nextOptions[0]?.value || '').trim()
          if (!nextModel) {
            toast(`${nextType === 'music' ? '音乐' : '语音'}模型目录为空，请先在系统模型管理中配置渠道、协议与价格`, 'error')
          }
          updateNodeData(id, {
            audioType: nextType,
            audioModel: nextModel || null,
          })
        },
      },
      {
        key: 'audioModel',
        title: '模型',
        summary: selectedAudioOption?.label || (audioModel ? `不可用：${audioModel}` : '未选择模型'),
        options: modelOptions,
        onChange: (value) => {
          if (!findModelOptionByIdentifier(modelOptions, value)) {
            toast(`音频模型 ${value} 不在当前系统模型目录中`, 'error')
            return
          }
          updateNodeData(id, { audioModel: value })
        },
      },
    ]
    if (audioType === 'speech') {
      if (isDoubao) {
        // 豆包语音：富音色选择器（render）+ 语速/音调/响度
        controls.push(
          {
            key: 'doubaoVoiceId',
            title: '音色',
            summary: '',
            options: [],
            onChange: () => {},
            render: (
              <LazyDoubaoVoicePicker
                key="doubaoVoiceId"
                compact
                value={doubaoVoiceId}
                onChange={(vid, vname) => {
                  // 配音卡三字段同步（2026-07-17 根治）：改音色必须连带 voiceLabel 与
                  // 「配音卡｜角色·音色名」label 后缀一起更新，否则卡面标签与真实音色脱钩。
                  const patch: Record<string, unknown> = { doubaoVoiceId: vid }
                  const isVoiceCard =
                    String((data as any)?.audioType ?? '').toLowerCase() === 'voice_card'
                  if (isVoiceCard) {
                    patch.voiceLabel = vname || ''
                    const role =
                      (typeof (data as any)?.voiceCharacter === 'string' &&
                        ((data as any).voiceCharacter as string).trim()) ||
                      (typeof (data as any)?.roleName === 'string' &&
                        ((data as any).roleName as string).trim()) ||
                      ''
                    if (role) patch.label = vname ? `配音卡｜${role}·${vname}` : `配音卡｜${role}`
                  }
                  updateNodeData(id, patch)
                }}
                stopNodeDrag={(e) => e.stopPropagation()}
              />
            ),
          },
          {
            key: 'speechRate',
            title: '语速',
            summary:
              (DOUBAO_SPEECH_RATE_OPTIONS as readonly { value: string; label: string }[]).find(
                (o) => Number(o.value) === speechRate,
              )?.label || `${speechRate}`,
            options: DOUBAO_SPEECH_RATE_OPTIONS as unknown as { value: string; label: string }[],
            onChange: (value) => updateNodeData(id, { speechRate: Number(value) || 0 }),
          },
          {
            key: 'pitchRate',
            title: '音调',
            summary:
              (DOUBAO_PITCH_RATE_OPTIONS as readonly { value: string; label: string }[]).find(
                (o) => Number(o.value) === pitchRate,
              )?.label || `${pitchRate}`,
            options: DOUBAO_PITCH_RATE_OPTIONS as unknown as { value: string; label: string }[],
            onChange: (value) => updateNodeData(id, { pitchRate: Number(value) || 0 }),
          },
          {
            key: 'loudnessRate',
            title: '响度',
            summary:
              (DOUBAO_LOUDNESS_RATE_OPTIONS as readonly { value: string; label: string }[]).find(
                (o) => Number(o.value) === loudnessRate,
              )?.label || `${loudnessRate}`,
            options: DOUBAO_LOUDNESS_RATE_OPTIONS as unknown as { value: string; label: string }[],
            onChange: (value) => updateNodeData(id, { loudnessRate: Number(value) || 0 }),
          },
        )
      } else {
        controls.push(
          {
            key: 'voiceId',
            title: '音色',
            summary:
              (AUDIO_VOICE_OPTIONS as readonly { value: string; label: string }[]).find(
                (o) => o.value === voiceId,
              )?.label || voiceId,
            options: AUDIO_VOICE_OPTIONS as unknown as { value: string; label: string }[],
            onChange: (value) => updateNodeData(id, { voiceId: value }),
          },
          {
            key: 'emotion',
            title: '情绪',
            summary:
              (AUDIO_EMOTION_OPTIONS as readonly { value: string; label: string }[]).find(
                (o) => o.value === emotion,
              )?.label || '默认',
            options: [
              { value: '', label: '默认' },
              ...(AUDIO_EMOTION_OPTIONS as unknown as { value: string; label: string }[]),
            ],
            onChange: (value) => updateNodeData(id, { emotion: value }),
          },
          {
            key: 'speed',
            title: '语速',
            summary: `${speed.toFixed(1)}x`,
            options: ['0.5', '0.8', '1', '1.2', '1.5', '2'].map((v) => ({
              value: v,
              label: `${Number(v).toFixed(1)}x`,
            })),
            onChange: (value) => updateNodeData(id, { speed: Number(value) || 1 }),
          },
        )
      }
    } else {
      controls.push({
        key: 'lyricsMode',
        title: '歌词',
        summary:
          (AUDIO_LYRICS_MODE_OPTIONS as readonly { value: string; label: string }[]).find(
            (o) => o.value === lyricsMode,
          )?.label || '纯音乐',
        options: AUDIO_LYRICS_MODE_OPTIONS as unknown as { value: string; label: string }[],
        onChange: (value) => updateNodeData(id, { lyricsMode: value }),
      })
    }
    return controls
  }, [
    activeAudioModelOptions,
    audioMusicModelOptions,
    audioSpeechModelOptions,
    audioType,
    data,
    id,
    isAudioNode,
    storedAudioModel,
    updateNodeData,
  ])

  const handleAudioUpload = React.useCallback(
    async (file: File) => {
      if (!isAudioNode || nodeReadOnly) return
      if (!file.type.startsWith('audio/')) {
        toast('请选择音频文件', 'error')
        return
      }
      const title = file.name.replace(/\.[a-z0-9]+$/i, '').trim() || '上传音频'
      const projectId = typeof currentProject?.id === 'string' ? currentProject.id.trim() : ''
      updateNodeData(id, { status: 'running', errorMessage: null })
      try {
        const hosted = await uploadServerAssetFile(file, title, {
          ownerNodeId: id,
          ...(projectId ? { projectId } : {}),
        })
        const url = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
        if (!url) {
          throw new Error('音频已上传，但 Assets 未返回可用链接')
        }
        updateNodeData(id, {
          audioUrl: url,
          assetId: hosted.id,
          serverAssetId: hosted.id,
          audioResults: [{ url, assetId: hosted.id }],
          assetRegistrationStatus: 'ready',
          audioDurationSec: null,
          status: 'success',
          errorMessage: null,
        })
        notifyAssetRefresh()
        toast('音频已上传到 Assets', 'success')
      } catch (error: unknown) {
        const msg = error instanceof Error && error.message ? error.message : '音频上传失败'
        updateNodeData(id, { status: 'failed', errorMessage: msg })
        toast(msg, 'error')
      }
    },
    [currentProject?.id, isAudioNode, nodeReadOnly, id, updateNodeData],
  )

  const audioProps = React.useMemo(
    () =>
      isAudioNode
        ? {
            audioUrl:
              typeof (data as any)?.audioUrl === 'string' && ((data as any).audioUrl as string).trim()
                ? ((data as any).audioUrl as string)
                : null,
            audioDurationSec:
              typeof (data as any)?.audioDurationSec === 'number'
                ? ((data as any).audioDurationSec as number)
                : null,
            isRunning,
            readOnly: nodeReadOnly,
            nodeHeight: nodeHeight ?? undefined,
            onUpload: (file: File) => {
              void handleAudioUpload(file)
            },
          }
        : undefined,
    [isAudioNode, data, isRunning, nodeReadOnly, nodeHeight, handleAudioUpload],
  )

  const videoAnalysisProps = React.useMemo(
    () => isVideoAnalysisNode
      ? {
          nodeId: id,
          data: data as Record<string, unknown>,
          readOnly: nodeReadOnly,
          nodeWidth,
          nodeHeight: nodeHeight ?? visualNodeDefaults.height,
        }
      : undefined,
    [data, id, isVideoAnalysisNode, nodeHeight, nodeReadOnly, nodeWidth, visualNodeDefaults.height],
  )

  const shotTableProps = React.useMemo(
    () => isShotTableNode
      ? {
          nodeId: id,
          data: data as Record<string, unknown>,
          readOnly: nodeReadOnly,
          nodeHeight: nodeHeight ?? visualNodeDefaults.height,
          assetReferences: shotTableAssetReferences,
        }
      : undefined,
    [data, id, isShotTableNode, nodeHeight, nodeReadOnly, shotTableAssetReferences, visualNodeDefaults.height],
  )

  const workflowStageProps = React.useMemo(
    () => isWorkflowStageNode
      ? {
          nodeId: id,
          data: data as Record<string, unknown>,
          readOnly: nodeReadOnly,
        }
      : undefined,
    [data, id, isWorkflowStageNode, nodeReadOnly],
  )

  const workflowTriggerProps = React.useMemo(
    () => isWorkflowTriggerNode
      ? {
          nodeId: id,
          data: data as Record<string, unknown>,
          readOnly: nodeReadOnly,
        }
      : undefined,
    [data, id, isWorkflowTriggerNode, nodeReadOnly],
  )

  const featureBlocks = renderFeatureBlocks(schema.features, {
    videoContent,
    imageProps,
    storyboardEditorProps,
    videoComposeProps,
    audioProps,
    videoAnalysisProps,
    shotTableProps,
    workflowStageProps,
    workflowTriggerProps,
  })

  // 上游音频节点（配音/BGM 轨）：只在「视频合成」节点消费，合成时自动混入。
  const upstreamComposeAudioTracks = React.useMemo(() => {
    if (!isVideoComposeNode || isOrchestratedVideoClip) return []
    const state = useRFStore.getState()
    return collectUpstreamComposeAudioTracks(id, state.nodes as any, state.edges as any)
    // data 依赖触发边/上游变化后的重算（store 快照读取，避免订阅放大渲染）
  }, [isOrchestratedVideoClip, isVideoComposeNode, id, data])
  const [saveToLibraryOpen, setSaveToLibraryOpen] = React.useState(false)
	  const [mentionOpen, setMentionOpen] = React.useState(false)
	  const [mentionFilter, setMentionFilter] = React.useState('')
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
        assetUrl: ref.assetUrl || null,
      }))
      .sort((a, b) => Number(b.connected) - Number(a.connected))
  }, [characterRefMap, edgesForCharacters, id, mergedCharacterRefs])
  const connectedCharacterOptions = React.useMemo(() => {
    const withUsername = autoCharacterOptions.filter((opt) => opt.username)
    const direct = withUsername.filter((opt) => opt.connected)
    return direct.length > 0 ? direct : withUsername
  }, [autoCharacterOptions])
  const upstreamReferenceMentionRefs = useStableRFStoreSelection(
    React.useCallback((s): CharacterRef[] => {
      if (!wantsCharacterRefs) return EMPTY_CHARACTER_REFS
      return collectDynamicUpstreamReferenceEntriesForNode(s.nodes, s.edges, id)
        .flatMap((entry): CharacterRef[] => {
          const username = toMentionUsername(entry.label)
          if (!username) return []
          const assetUrl = typeof entry.url === 'string' ? entry.url.trim() : ''
          const assetId = typeof entry.assetId === 'string' ? entry.assetId.trim() : ''
          const displayName = String(entry.name || entry.label).trim() || username
          return [{
            nodeId: `upstream-ref:${id}:${username}`,
            username,
            displayName,
            rawLabel: displayName,
            source: 'character',
            assetUrl: assetUrl || null,
            assetId: assetId || null,
            assetRefId: username,
            assetName: displayName,
            isConnected: true,
          } satisfies CharacterRef]
        })
    }, [id, wantsCharacterRefs]),
    areCharacterRefsEqual,
  )
  const persistedAssetInputMentionRefs = React.useMemo<CharacterRef[]>(() => {
    const nodeData = data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : {}
    return buildPersistedPromptAssetMentionRefs(id, nodeData.assetInputs)
  }, [data, id])
  const mentionSuggestionOptions = React.useMemo(() => {
    const byUsername = new Map<string, CharacterRef>()
      const push = (item: {
        nodeId?: string | null
        username?: string
        displayName?: string
        rawLabel?: string
        source?: 'character' | 'asset'
        assetUrl?: string | null
        assetId?: string | null
        assetRefId?: string | null
        assetName?: string | null
        mentionAliases?: readonly string[]
        assetRole?: 'style' | 'reference'
        isConnected?: boolean
      }) => {
      const username = toMentionUsername(item.username)
      if (!username) return
      const key = username.toLowerCase()
      const existing = byUsername.get(key)
      if (existing) {
        if (!existing.assetUrl && item.assetUrl) existing.assetUrl = item.assetUrl
        if (!existing.assetId && item.assetId) existing.assetId = item.assetId
        if (!existing.assetRefId && item.assetRefId) existing.assetRefId = item.assetRefId
        if (!existing.assetName && item.assetName) existing.assetName = item.assetName
        if (item.mentionAliases?.length) {
          existing.mentionAliases = Array.from(new Set([...(existing.mentionAliases || []), ...item.mentionAliases]))
        }
        if (!existing.assetRole && item.assetRole) existing.assetRole = item.assetRole
        if (!existing.isConnected && item.isConnected) existing.isConnected = true
        return
      }
      const displayName = String(item.displayName || '').trim() || username
      byUsername.set(key, {
        nodeId: item.nodeId || `mention:${key}`,
        username,
        displayName,
        rawLabel: String(item.rawLabel || displayName).trim() || displayName,
        source: item.source === 'asset' ? 'asset' : 'character',
        assetUrl: item.assetUrl || null,
        assetId: item.assetId || null,
        assetRefId: item.assetRefId || null,
        assetName: item.assetName || null,
        mentionAliases: item.mentionAliases || [],
        assetRole: item.assetRole,
        isConnected: item.isConnected === true,
      })
    }
    connectedCharacterOptions.forEach((opt) => push({
      nodeId: opt.value,
      username: opt.username,
      displayName: opt.displayName,
      rawLabel: opt.rawLabel,
      source: 'character',
      assetUrl: opt.assetUrl || null,
      isConnected: opt.connected,
    }))
    upstreamReferenceMentionRefs.forEach(push)
    persistedAssetInputMentionRefs.forEach(push)
    canvasAssetMentionRefs.forEach(push)
    projectAssetMentionRefs.forEach(push)
    const lockedStyle = projectImageSettings.lockedStyle
    if (lockedStyle?.referenceImageUrl) {
      const styleId = String(lockedStyle.styleId || '').trim()
      const materialId = styleId.startsWith('material:') ? styleId.slice('material:'.length) : styleId
      const styleName = String(lockedStyle.styleName || '').trim() || materialId || 'style'
      const username = materialId || toMentionUsername(styleName)
      if (username) {
        push({
          nodeId: `mention:style-lock:${styleId || username}`,
          username,
          displayName: styleName,
          rawLabel: styleName,
          source: 'asset',
          assetUrl: String(lockedStyle.referenceImageUrl).trim(),
          assetId: materialId || null,
          assetRefId: styleId || materialId || username,
          assetName: styleName,
          mentionAliases: [styleId, materialId],
          assetRole: 'style',
          isConnected: true,
        })
      }
    }
    return Array.from(byUsername.values())
  }, [
    canvasAssetMentionRefs,
    connectedCharacterOptions,
    projectAssetMentionRefs,
    projectImageSettings.lockedStyle,
    persistedAssetInputMentionRefs,
    upstreamReferenceMentionRefs,
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
      if (!apiKey && !hasAuthSession()) {
        toast('请先登录后再试', 'error')
        return
      }
      const vendorCandidates = Array.isArray(ui.publicVendorCandidates) ? ui.publicVendorCandidates : []
      const promptRefineModelKey = resolvePromptRefineModelKey()
      const taskRes = await runPublicTask(apiKey, {
        vendor: 'auto',
        ...(vendorCandidates.length ? { vendorCandidates } : {}),
        request: {
          kind: 'prompt_refine',
          prompt: promptText,
          extras: {
            systemPrompt,
            ...(promptRefineModelKey ? { modelKey: promptRefineModelKey } : {}),
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
    resolvePromptRefineModelKey,
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
      '请在保持原文语气、事实、对白、内容和结构不变的前提下，完成以下操作：',
      '1. 只有在上下文能够确认某个称呼确实指向上述角色时，才替换为对应的 @username；',
      '2. 原文没有出现的角色不得补写，身份证据不足的称呼保持原样；',
      '3. 只输出替换后的脚本正文，不要添加解释、前缀或 Markdown；',
      '4. 全文保持中文；',
      '5. 确保每个 @username 前后至少保留一个空格，避免紧贴其他字符。',
      '',
      '【原始脚本】',
      basePrompt,
    ].join('\n')
    const systemPrompt =
      '你是一个提示词修订助手。只在上下文能确认人物身份时替换角色引用；不得补写原文未出现的角色，不得修改对白或剧情事实。只输出修改后的脚本文本，并确保每个 @username 前后至少保留一个空格。'
    const ui = useUIStore.getState()
    const apiKey = (ui.publicApiKey || '').trim()
    if (!apiKey && !hasAuthSession()) {
      throw new Error('未登录：请先登录后再试')
    }
    const vendorCandidates = Array.isArray(ui.publicVendorCandidates) ? ui.publicVendorCandidates : []
    const persist = ui.assetPersistenceEnabled
    const taskRes = await runPublicTask(apiKey, {
      vendor: 'auto',
      ...(vendorCandidates.length ? { vendorCandidates } : {}),
      request: {
        kind: 'prompt_refine',
        prompt: instructions,
        extras: { systemPrompt, modelKey: modelValue, persistAssets: persist },
      },
    })
    const text = extractTextFromTaskResult(taskRes.result)
    return text.trim()
  },
  [],
)

  const [translatePromptLoading, setTranslatePromptLoading] = React.useState(false)
  const handleTranslatePrompt = React.useCallback(async () => {
    if (translatePromptLoading || viewOnly) return
    const promptText = (prompt || '').trim()
    if (!promptText) { toast('请先填写提示词再翻译', 'warning'); return }
    setTranslatePromptLoading(true)
    try {
      const translated = await llmChat({
        model: 'gpt-5.4',
        systemPrompt: '你是一个提示词翻译助手。如果用户输入的是中文，请完整翻译成英文（图片/视频生成 prompt 格式保持不变，时间轴标记如 [0s] 等原样保留）；如果是英文，请完整翻译成中文。只输出翻译结果，不要添加任何解释、前缀或 Markdown。禁止截断，必须翻译全部内容。',
        userPrompt: promptText,
        temperature: 0.3,
        maxTokens: 4096,
      })
      if (!translated) { toast('模型未返回翻译结果，请稍后重试', 'error'); return }
      setPrompt(translated)
      updateNodeData(id, { prompt: translated })
      toast('翻译完成', 'success')
    } catch (error: any) {
      const message = typeof error?.message === 'string' ? error.message : '翻译失败'
      toast(message, 'error')
    } finally {
      setTranslatePromptLoading(false)
    }
  }, [translatePromptLoading, viewOnly, prompt, id, setPrompt, updateNodeData])

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

    if (!prompt.trim()) {
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
      const nextText = (await rewritePromptWithCharacters({
        basePrompt: prompt,
        roles,
        modelValue: characterRewriteModel,
      })).trim()
      if (!nextText) throw new Error('角色引用修订未返回文本')
      setPrompt(nextText)
      updateNodeData(id, { prompt: nextText })
    } catch (err) {
      console.warn('[TaskNode] character reference rewrite failed', err)
      setCharacterRewriteError(err instanceof Error ? err.message : '角色引用修订失败，原文本未修改')
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

  const hasUpstreamConnections = React.useMemo(() => {
    const isImgKind = kind === 'image' || kind === 'imageEdit'
    const isVideoKind = kind === 'video'
    if (!isImgKind && !isVideoKind && !hasImageResults) return false
    return canvasEdges.some((edge) => edge.target === id)
  }, [canvasEdges, hasImageResults, id, kind])

  const [imagePresetConfirmKey, setImagePresetConfirmKey] = React.useState<string | null>(null)
  const rf = useReactFlow()

  const handleFocusNode = React.useCallback(() => {
    void rf.fitView({
      nodes: [{ id }],
      padding: 0.18,
      duration: 220,
      minZoom: 0.1,
      maxZoom: 1.15,
    })
  }, [id, rf])

  React.useEffect(() => {
    if (!imagePresetConfirmKey) return
    const nodePos = useRFStore.getState().nodes.find((n) => n.id === id)?.position
    const nx = nodePos?.x ?? 0
    const ny = nodePos?.y ?? 0
    const nw = nodeWidth
    const nh = nodeHeight ?? visualNodeDefaults.height
    const { zoom } = rf.getViewport()
    const targetZoom = Math.min(Math.max(zoom, 0.7), 1.4)
    rf.setCenter?.(nx + nw / 2, ny + nh / 2, { zoom: targetZoom, duration: 320 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagePresetConfirmKey])

  React.useEffect(() => {
    if (!gridSplitOpen) {
      setGridSplitSelectedCells(new Set())
      setGridSplitHoveredCell(null)
      return
    }
    // padding 0.35 留出顶部宫格工具栏空间；maxZoom 1.2 防止图片太大撑出屏幕
    rf.fitView?.({ nodes: [{ id }], padding: 0.35, duration: 380, maxZoom: 1.2 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridSplitOpen])

  // While grid split is active, keep this node selected (lock interaction to this node)
  React.useEffect(() => {
    if (!gridSplitOpen || selected) return
    useRFStore.setState((s) => {
      const target = s.nodes.find((node) => node.id === id)
      const needsSelectionSync = s.nodes.some((node) => node.selected !== (node.id === id))
      if (!target || !needsSelectionSync) return s
      return {
        nodes: s.nodes.map((node) => ({
          ...node,
          selected: node.id === id,
        })),
      }
    })
  }, [gridSplitOpen, selected, id])

  // 图片编辑覆盖层开启时只锁定画布平移/缩放。LibTV 不会在打开编辑器时
  // 改变用户当前视角；自动 fitView 会把节点放大并把编辑器挤出视口。
  React.useEffect(() => {
    if (canvasViewLockEditorOpen) {
      setCanvasViewLocked(true)
    } else {
      setCanvasViewLocked(false)
    }
    return () => { setCanvasViewLocked(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasViewLockEditorOpen])

  // 当 primaryImageUrl 变化时获取图片自然尺寸（供覆盖层编辑器使用）
  React.useEffect(() => {
    if (!primaryImageUrl) { setImageNaturalSize(null); return }
    const img = new Image()
    // 编辑器后续会读取像素；尺寸探测必须从第一次请求起使用同一匿名 CORS 身份，
    // 避免先把无 ACAO 的普通图片响应写进缓存，再污染裁剪/重绘/标注请求。
    img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.onload = () => setImageNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => setImageNaturalSize(null)
    img.src = primaryImageUrl
  }, [primaryImageUrl])

  // 抠图 / 分层：在画布上派生一个图像子节点（imageEdit），连线但不自动执行——由调用方对「终端
  // 节点」调 runNodeDagToTarget，串联节点会按依赖顺序被一并执行。
  // forceTaskKind='image_remove_bg' 时该节点走像素级分割引擎（remove.bg 代理 / 本地 ONNX），
  // 否则走默认彩色编辑模型（Gemini 3.1）做生成式重绘（提纯 / 提取文字 / 去文字 / 去主体）。
  const spawnImageNode = React.useCallback((opts: {
    label: string
    prompt?: string
    forceTaskKind?: 'image_remove_bg'
    model?: string
    parentId?: string          // 连线的上游节点；默认当前源节点
    parentHasImage?: boolean    // 上游已有成图时显式注入 referenceImages（仅当上游=当前源节点时为真）
    col?: number                // 相对源节点的横向列偏移（默认 1）
    rowOffset?: number          // 纵向行偏移（多层分层时错开）
    imageOperationSpec?: ImageOperationSpec
  }): string | null => {
    const parentId = opts.parentId ?? id
    const model = resolveImageEditModelForAction(opts.model || null)
    if (!model) return null
    const beforeIds = new Set(useRFStore.getState().nodes.map(n => n.id))
    const nodeData: Record<string, unknown> = {
      kind: 'imageEdit',
      imageModel: model,
      imageModelVendor: null,
    }
    if (opts.prompt != null) nodeData.prompt = opts.prompt
    if (opts.forceTaskKind) nodeData.forceTaskKind = opts.forceTaskKind
    // 串联到「尚未执行」的中间节点时不预置 referenceImages，靠画布连线在运行时收集上游产物。
    if (opts.parentHasImage && primaryImageUrl) nodeData.referenceImages = [primaryImageUrl]
    if (opts.imageOperationSpec) {
      nodeData.imageOperationSpec = opts.imageOperationSpec
      nodeData.imageOperationState = createImageOperationState(opts.imageOperationSpec)
      nodeData.imageOperationRevision = 1
    }
    addNode('taskNode', opts.label, nodeData)
    const afterAdd = useRFStore.getState()
    const newNode = afterAdd.nodes.find(n => !beforeIds.has(n.id))
    if (!newNode) return null
    const sourceNode = afterAdd.nodes.find(n => n.id === id)
    const colGap = nodeWidth + 80
    const rowGap = 260
    afterAdd.onNodesChange([{
      id: newNode.id, type: 'position' as const,
      position: {
        x: (sourceNode?.position?.x ?? 0) + (opts.col ?? 1) * colGap,
        y: (sourceNode?.position?.y ?? 0) + (opts.rowOffset ?? 0) * rowGap,
      },
      dragging: false,
    }])
    afterAdd.onConnect({ source: parentId, sourceHandle: 'out-image', target: newNode.id, targetHandle: 'in-image' })
    return newNode.id
  }, [addNode, id, nodeWidth, primaryImageUrl, resolveImageEditModelForAction])

  // 执行一批终端节点（各自连带上游链按依赖顺序运行），统一收敛失败提示。
  const runCutoutTerminals = React.useCallback((ids: Array<string | null>, label: string): Promise<void> => {
    const targets = ids.filter((v): v is string => Boolean(v))
    if (!targets.length) return Promise.reject(new Error(`${label}结果节点创建失败`))
    return Promise.allSettled(
      targets.map(t => runNodeDagToTarget(t, useRFStore.getState, useRFStore.setState, { concurrency: 1 })),
    ).then(results => {
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed) toast(`${label}部分失败（${failed}/${targets.length}）`, 'error')
    })
  }, [])

  // 极速抠图：原图直接走像素级分割（remove.bg/ONNX），输出透明 PNG。
  const handleFastCutout = React.useCallback(() => {
    if (!primaryImageUrl || extractLoading) return
    setExtractLoading(true)
    const imageOperationSpec = createImageOperationForSource({
      kind: 'cutout',
      execution: 'remove-background',
      sourceNodeId: id,
      sourceUrl: primaryImageUrl,
      sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
      parameters: { preserveSubject: true, preserveFineEdges: true, outputAlpha: true },
      output: { mediaType: 'image', count: 1, format: 'png', transparent: true },
    })
    const cut = spawnImageNode({
      label: '极速抠图',
      forceTaskKind: 'image_remove_bg',
      parentHasImage: true,
      prompt: '像素级抠图：去除背景，保留主体，输出带透明通道的 PNG。',
      imageOperationSpec,
    })
    runCutoutTerminals([cut], '极速抠图')
      .catch((error: unknown) => toast(error instanceof Error ? error.message : '极速抠图启动失败', 'error'))
      .finally(() => setExtractLoading(false))
  }, [data, extractLoading, id, primaryImageUrl, spawnImageNode, runCutoutTerminals])

  // 智能抠图：先 Gemini 把背景换成纯色（提纯主体），再像素级分割，边缘更干净。
  const handleSmartCutout = React.useCallback(() => {
    if (!primaryImageUrl || smartCutoutLoading) return
    setSmartCutoutLoading(true)
    const clean = spawnImageNode({
      label: '智能抠图·提纯',
      prompt: '只保留完整的主体，背景换成纯色（纯白），主体保持不变。',
      parentHasImage: true,
      col: 1,
    })
    const cut = clean
      ? spawnImageNode({
          label: '智能抠图',
          forceTaskKind: 'image_remove_bg',
          parentId: clean,
          col: 2,
        })
      : null
    runCutoutTerminals([cut], '智能抠图')
      .catch((error: unknown) => toast(error instanceof Error ? error.message : '智能抠图启动失败', 'error'))
      .finally(() => setSmartCutoutLoading(false))
  }, [smartCutoutLoading, primaryImageUrl, spawnImageNode, runCutoutTerminals])

  // 一键分层：调用真实 RGBA 分层模型。每个返回图层都由服务端先托管到 OSS，
  // 再落成可独立移动、编辑和连线的图片节点；普通重绘模型不允许冒充图层分离。
  const handleLayerSplit = React.useCallback(async () => {
    if (!primaryImageUrl || layerLoading) return
    setLayerLoading(true)
    try {
      const { runImageLayerSplit } = await import('./taskNode/imageLayerActions')
      await runImageLayerSplit({
        data: data as Record<string, unknown>,
        nodeId: id,
        nodeWidth,
        primaryImageUrl,
        resolveImageEditModel: resolveImageEditModelForAction,
        sleep: sleep3d,
      })
    } finally {
      setLayerLoading(false)
    }
  }, [data, id, layerLoading, nodeWidth, primaryImageUrl, resolveImageEditModelForAction, sleep3d])

  const handleLayerRecompose = React.useCallback(async () => {
    const { runImageLayerRecompose } = await import('./taskNode/imageLayerActions')
    await runImageLayerRecompose({
      data: data as Record<string, unknown>,
      nodeId: id,
      nodeWidth,
      uploadEditedImageBlob,
    })
  }, [data, id, nodeWidth, uploadEditedImageBlob])

  // 一键去噪：以当前图为参考图，用固定去噪/增强提示词生成新节点（复用 spawnImageNode 链路）
  const handleDenoise = React.useCallback((mode: 'clean' | 'enhance') => {
    if (!primaryImageUrl || denoiseLoading) return
    setDenoiseLoading(true)
    const editableModel = String(imageModel || '').trim() || undefined
    const label = mode === 'enhance' ? '8K 增强' : '去噪'
    const prompt = mode === 'enhance'
      ? '保持构图与所有物体位置不变，极度增强画面细节并提升至 8K 超高清质感；C4D+Octane 渲染器风格，电影级写实 CG，大师级光影，完美构图，film-like depth；仅优化质感，保持原有颜色与冷暖比例。'
      : '对图片进行去噪与画质增强：消除噪点、涂抹感与压缩伪影，提升细节锐度、材质与光影质感；严格保持原有构图、物体位置、颜色、亮度与冷暖比例不变，不新增高光或色彩，不改变主体形态。'
    const newNodeId = spawnImageNode({ label, prompt, parentHasImage: true, model: editableModel })
    if (!newNodeId) { setDenoiseLoading(false); return }
    runNodeDagToTarget(newNodeId, useRFStore.getState, useRFStore.setState, { concurrency: 1 })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : '去噪生成失败', 'error'))
      .finally(() => setDenoiseLoading(false))
  }, [denoiseLoading, imageModel, primaryImageUrl, spawnImageNode])

  const handleCreateRotatePreview = React.useCallback(() => {
    if (!primaryImageUrl) return
    setHdPanelOpen(false)
    setExpandPanelOpen(false)
    const beforeIds = new Set(useRFStore.getState().nodes.map((node) => node.id))
    addNode('taskNode', '旋转与镜像', {
      kind: 'image',
      imageUrl: primaryImageUrl,
      serverAssetId: imageServerAssetId,
      status: 'done',
      autoLabel: false,
      _rotatePreview: { sourceId: id, angle: 0, flipH: false, flipV: false },
    })
    const store = useRFStore.getState()
    const newNode = store.nodes.find((node) => !beforeIds.has(node.id))
    if (!newNode) {
      toast('旋转预览节点创建失败', 'error')
      return
    }
    const sourceNode = store.nodes.find((node) => node.id === id)
    store.onNodesChange([{
      id: newNode.id,
      type: 'position' as const,
      position: {
        x: (sourceNode?.position?.x ?? 0) + nodeWidth + 80,
        y: sourceNode?.position?.y ?? 0,
      },
      dragging: false,
    }])
    store.onConnect({ source: id, sourceHandle: 'out-image', target: newNode.id, targetHandle: 'in-image' })
    store.onNodesChange([
      { id, type: 'select' as const, selected: false },
      { id: newNode.id, type: 'select' as const, selected: true },
    ])
    setRotatePreviewNodeId(newNode.id)
  }, [addNode, id, imageServerAssetId, nodeWidth, primaryImageUrl])

  const handleCreateVideoAnalysis = React.useCallback(() => {
    const url = videoResults[videoPrimaryIndex]?.url || videoUrl
    if (!url) return
    const beforeIds = new Set(useRFStore.getState().nodes.map((node) => node.id))
    addNode('taskNode', '逐帧拉片', {
      kind: 'videoAnalysis',
      sourceVideoNodeId: id,
      sourceVideoUrl: url,
      sourceVideoDurationSeconds: activeVideoDuration,
      videoAnalysisDimensions: ['storyboard', 'motion', 'music'],
      videoAnalysisAutoStart: false,
      status: 'idle',
    })
    const afterAdd = useRFStore.getState()
    const newNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
    if (!newNode) {
      toast('视频分析节点创建失败', 'error')
      return
    }
    const sourceNode = afterAdd.nodes.find((node) => node.id === id)
    afterAdd.onNodesChange([
      {
        id: newNode.id,
        type: 'position' as const,
        position: {
          x: (sourceNode?.position?.x ?? 0) + nodeWidth + 80,
          y: sourceNode?.position?.y ?? 0,
        },
        dragging: false,
      },
    ])
    afterAdd.onConnect({ source: id, sourceHandle: 'out-video', target: newNode.id, targetHandle: 'in-video' })
    afterAdd.clearPendingFocusNodeId()
  }, [activeVideoDuration, addNode, id, nodeWidth, videoPrimaryIndex, videoResults, videoUrl])

  const handleCreateSmartVideoEdit = React.useCallback(() => {
    const sourceUrl = videoResults[videoPrimaryIndex]?.url || videoUrl
    if (!sourceUrl) return
    const beforeIds = new Set(useRFStore.getState().nodes.map((node) => node.id))
    addNode('taskNode', '智能剪辑', {
      kind: 'videoCompose',
      prompt: '',
      smartEdit: true,
      sourceVideoNodeId: id,
      // 智能剪辑节点是用户显式打开编辑器后才执行的编辑动作，不能在创建时被 DAG 自动合成。
      status: 'idle',
    })
    const afterAdd = useRFStore.getState()
    const newNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
    if (!newNode) {
      toast('智能剪辑节点创建失败', 'error')
      return
    }
    const sourceNode = afterAdd.nodes.find((node) => node.id === id)
    afterAdd.onNodesChange([
      {
        id: newNode.id,
        type: 'position' as const,
        position: {
          x: (sourceNode?.position?.x ?? 0) + nodeWidth + 80,
          y: sourceNode?.position?.y ?? 0,
        },
        dragging: false,
      },
    ])
    afterAdd.onConnect({ source: id, sourceHandle: 'out-video', target: newNode.id, targetHandle: 'in-any' })
    afterAdd.clearPendingFocusNodeId()
    toast('已创建智能剪辑节点，可输入剪辑描述并打开编辑器', 'success')
  }, [addNode, id, nodeWidth, videoPrimaryIndex, videoResults, videoUrl])

  const handleCreateSegmentRemake = React.useCallback(() => {
    const sourceUrl = videoResults[videoPrimaryIndex]?.url || videoUrl
    if (!sourceUrl) return
    const beforeIds = new Set(useRFStore.getState().nodes.map((node) => node.id))
    const sourceData = data as Record<string, unknown>
    addNode('taskNode', `${String(sourceData.label || '当前视频')}-片段重拍`, {
      kind: 'video',
      nodeWidth: 610,
      nodeHeight: 350,
      segmentRemake: true,
      sourceVideoNodeId: id,
      sourcePrevVideoNodeId: id,
      sourceVideoUrl: sourceUrl,
      videoUrl: sourceUrl,
      videoResults: [{
        url: sourceUrl,
        title: typeof sourceData.videoTitle === 'string' ? sourceData.videoTitle : String(sourceData.label || '源视频'),
        duration: activeVideoDuration ?? undefined,
      }],
      videoPrimaryIndex: 0,
      videoDuration: activeVideoDuration ?? undefined,
      segmentRemakeRanges: [],
      prompt: '',
      status: 'idle',
    })
    const afterAdd = useRFStore.getState()
    const newNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
    if (!newNode) {
      toast('片段重拍节点创建失败', 'error')
      return
    }
    const sourceNode = afterAdd.nodes.find((node) => node.id === id)
    afterAdd.onNodesChange([
      {
        id: newNode.id,
        type: 'position' as const,
        position: { x: (sourceNode?.position?.x ?? 0) + nodeWidth + 80, y: sourceNode?.position?.y ?? 0 },
        dragging: false,
      },
    ])
    afterAdd.onConnect({ source: id, sourceHandle: 'out-video', target: newNode.id, targetHandle: 'in-video' })
    afterAdd.clearPendingFocusNodeId()
    toast('已创建片段重拍节点，可标记 5 个片段后确认', 'success')
  }, [activeVideoDuration, addNode, data, id, nodeWidth, videoPrimaryIndex, videoResults, videoUrl])

  const handleCreateVideoContinuation = React.useCallback(async (input: VideoContinuationSubmit) => {
    const sourceUrl = videoResults[videoPrimaryIndex]?.url || videoUrl
    if (!sourceUrl || !input.prompt.trim()) return

    const selectedDuration = input.sourceRange.end - input.sourceRange.start
    if (!Number.isFinite(selectedDuration) || selectedDuration <= 0) {
      toast('续写前置片段时长无效', 'error')
      return
    }

    let continuationUrl = sourceUrl
    let continuationAssetId: string | undefined
    const knownSourceDuration = Number.isFinite(input.sourceDurationSeconds) && input.sourceDurationSeconds > 0
      ? input.sourceDurationSeconds
      : activeVideoDuration ?? undefined
    const isPartialSelection = knownSourceDuration !== undefined
      && (input.sourceRange.start > 0.05 || input.sourceRange.end < knownSourceDuration - 0.05)

    try {
      if (isPartialSelection) {
        const { sliceVideo } = await import('../../utils/ffmpegTrim')
        const clip = await sliceVideo(sourceUrl, input.sourceRange.start, input.sourceRange.end)
        const extension = sourceUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'mp4'
        const hosted = await uploadServerAssetFile(
          new File([clip], `continuation-${input.sourceRange.start.toFixed(1)}-${input.sourceRange.end.toFixed(1)}.${extension}`, { type: clip.type }),
          `续写前置片段 ${selectedDuration.toFixed(1)}s`,
          { ownerNodeId: id },
        )
        const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
        if (!hostedUrl) throw new Error('续写前置片段上传失败：未获取到真实资产链接')
        continuationUrl = hostedUrl
        continuationAssetId = hosted.id
      }

      const beforeIds = new Set(useRFStore.getState().nodes.map((node) => node.id))
      const sourceData = data as Record<string, unknown>
      addNode('taskNode', '智能续写', {
        kind: 'video',
        prompt: input.prompt.trim(),
        sourcePrevVideoNodeId: id,
        sourceVideoUrl: continuationUrl,
        continuationSourceOriginalUrl: sourceUrl,
        continuationSourceAssetId: continuationAssetId,
        referenceVideoDurationSeconds: selectedDuration,
        continuationSourceRangeStartSeconds: input.sourceRange.start,
        continuationSourceRangeEndSeconds: input.sourceRange.end,
        continuationMode: 'extend',
        videoDuration: input.durationSeconds,
        videoModel: sourceData.videoModel,
        videoModelVendor: sourceData.videoModelVendor,
        videoSize: sourceData.videoSize,
        videoResolution: sourceData.videoResolution,
        aspect: sourceData.aspect,
        videoGenerateAudio: sourceData.videoGenerateAudio,
        status: 'queued',
      })
      const afterAdd = useRFStore.getState()
      const newNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
      if (!newNode) throw new Error('智能续写节点创建失败')
      const sourceNode = afterAdd.nodes.find((node) => node.id === id)
      afterAdd.onNodesChange([
        {
          id: newNode.id,
          type: 'position' as const,
          position: { x: (sourceNode?.position?.x ?? 0) + nodeWidth + 80, y: (sourceNode?.position?.y ?? 0) + 180 },
          dragging: false,
        },
      ])
      afterAdd.onConnect({ source: id, sourceHandle: 'out-video', target: newNode.id, targetHandle: 'in-video' })
      afterAdd.clearPendingFocusNodeId()
      setVideoContinuationOpen(false)
      void runNodeDagToTarget(newNode.id, useRFStore.getState, useRFStore.setState, { concurrency: 1 }).catch((error: unknown) => {
        toast(error instanceof Error ? `智能续写失败：${error.message}` : '智能续写失败', 'error')
      })
      toast('已创建智能续写节点并开始生成', 'success')
    } catch (error) {
      toast(error instanceof Error ? `智能续写前置片段处理失败：${error.message}` : '智能续写前置片段处理失败', 'error')
    }
  }, [activeVideoDuration, addNode, data, id, nodeWidth, runNodeDagToTarget, videoPrimaryIndex, videoResults, videoUrl])

  const handleSeparateVideo = React.useCallback(async (output: VideoSeparationOutput) => {
    const sourceUrl = (videoResults[videoPrimaryIndex]?.url || videoUrl || '').trim()
    if (!sourceUrl) throw new Error('当前节点没有可分离的视频资产')
    const sourceData = data as Record<string, unknown>
    const sourceLabel = typeof sourceData.label === 'string' && sourceData.label.trim() ? sourceData.label.trim() : '源视频'
    const projectId = typeof currentProject?.id === 'string' ? currentProject.id.trim() : ''
    const sourceDuration = activeVideoDuration ?? (typeof sourceData.videoDuration === 'number' ? sourceData.videoDuration : undefined)
    const { runVideoSeparation } = await import('./taskNode/videoSeparation')
    await runVideoSeparation({
      nodeId: id,
      nodeWidth,
      output,
      projectId,
      sourceDuration,
      sourceLabel,
      sourceUrl,
      onPlaceholdersCreated: () => setVideoToolEditorMode(null),
    })
  }, [activeVideoDuration, currentProject?.id, data, id, nodeWidth, videoPrimaryIndex, videoResults, videoUrl])

  const createConfiguredImageDerivativeNode = React.useCallback((draft: {
    label: string
    prompt: string
    presetKey?: string
    operationKey?: string
    operationKind: ImageOperationKind
    execution?: ImageOperationExecution
    parameters?: Readonly<Record<string, unknown>>
    output?: ImageOperationSpec['output']
    panoramic?: boolean
  }): string | null => {
    const normalizedBaseImageUrl = String(basePoseImage || '').trim()
    if (!normalizedBaseImageUrl) {
      toast(`${draft.label}缺少可执行的真实源图片`, 'error')
      return null
    }
    const editableModel = resolveImageEditModelForAction('gpt-image-2')
    if (!editableModel) return null
    const imageOperationSpec = createImageOperationForSource({
      kind: draft.operationKind,
      execution: draft.execution ?? 'image-edit',
      sourceNodeId: id,
      sourceUrl: normalizedBaseImageUrl,
      sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
      parameters: draft.parameters,
      output: draft.output,
    })
    const beforeIds = new Set(useRFStore.getState().nodes.map((node) => node.id))
    addNode('taskNode', draft.label, {
      kind: 'imageEdit',
      prompt: draft.prompt,
      imageModel: editableModel,
      imageModelVendor: null,
      referenceImages: normalizedBaseImageUrl ? [normalizedBaseImageUrl] : [],
      suppressUpstreamPrompts: true,
      ...(draft.presetKey ? { libTvImagePresetKey: draft.presetKey } : {}),
      ...(draft.operationKey ? { libTvImageOperationKey: draft.operationKey } : {}),
      imageOperationSpec,
      imageOperationState: createImageOperationState(imageOperationSpec),
      imageOperationRevision: 1,
      ...(draft.panoramic
        ? {
          isPanoramic: true,
          aspect: '2:1',
          aspectRatio: '2:1',
          imageResolution: '4k',
          resolution: '4k',
        }
        : {}),
      sampleCount: 1,
      status: 'idle',
    })
    const afterAdd = useRFStore.getState()
    const newNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
    if (!newNode) {
      toast(`${draft.label}节点创建失败`, 'error')
      return null
    }
    const sourceNode = afterAdd.nodes.find((node) => node.id === id)
    afterAdd.onNodesChange([
      {
        id: newNode.id,
        type: 'position',
        position: {
          x: (sourceNode?.position?.x ?? 0) + ((sourceNode?.measured?.width as number | undefined) ?? nodeWidth) + 40,
          y: sourceNode?.position?.y ?? 0,
        },
        dragging: false,
      },
      { id, type: 'select' as const, selected: false },
      { id: newNode.id, type: 'select', selected: true },
    ])
    afterAdd.onConnect({
      source: id,
      sourceHandle: 'out-image',
      target: newNode.id,
      targetHandle: 'in-image',
    })
    return newNode.id
  }, [addNode, basePoseImage, data, id, nodeWidth, resolveImageEditModelForAction])

  const openPortraitTextureEditor = React.useCallback(() => {
    const sourceImageUrl = String(primaryImageUrl || basePoseImage || '').trim()
    if (!sourceImageUrl) {
      toast('当前节点没有可用于人像调节的真实图片资产', 'error')
      return
    }
    const editableModel = resolveImageEditModelForAction('gpt-image-2')
    if (!editableModel) return
    const beforeIds = new Set(useRFStore.getState().nodes.map((node) => node.id))
    addNode('taskNode', '人像质感调节', {
      kind: 'imageEdit',
      prompt: '',
      imageModel: editableModel,
      imageModelVendor: null,
      referenceImages: [sourceImageUrl],
      suppressUpstreamPrompts: true,
      libTvImagePresetKey: 'portrait-texture',
      libTvImageOperationKey: 'portrait-adjust',
      portraitTextureSelectionStatus: 'selecting',
      portraitTextureStrength: PORTRAIT_TEXTURE_DEFAULT_STRENGTH,
      sampleCount: 1,
      status: 'idle',
    })
    const afterAdd = useRFStore.getState()
    const outputNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
    if (!outputNode) {
      toast('人像质感调节结果节点创建失败', 'error')
      return
    }
    const sourceNode = afterAdd.nodes.find((node) => node.id === id)
    afterAdd.onNodesChange([
      {
        id: outputNode.id,
        type: 'position',
        position: {
          x: (sourceNode?.position?.x ?? 0) + ((sourceNode?.measured?.width as number | undefined) ?? nodeWidth) + 40,
          y: sourceNode?.position?.y ?? 0,
        },
        dragging: false,
      },
      { id, type: 'select', selected: true },
      { id: outputNode.id, type: 'select', selected: false },
    ])
    afterAdd.onConnect({
      source: id,
      sourceHandle: 'out-image',
      target: outputNode.id,
      targetHandle: 'in-image',
    })
    setPortraitTextureEditorOutputNodeId(outputNode.id)
  }, [addNode, basePoseImage, id, nodeWidth, primaryImageUrl, resolveImageEditModelForAction])

  const closePortraitTextureEditor = React.useCallback(() => {
    if (portraitTextureEditorOutputNodeId) {
      updateNodeData(portraitTextureEditorOutputNodeId, {
        portraitTextureSelectionStatus: 'cancelled',
      })
    }
    setPortraitTextureEditorOutputNodeId(null)
  }, [portraitTextureEditorOutputNodeId, updateNodeData])

  const openEmotionPersonSelector = React.useCallback((manual = false) => {
    const sourceImageUrl = String(primaryImageUrl || basePoseImage || '').trim()
    if (!sourceImageUrl) {
      toast('当前节点没有可用于情绪调节的真实图片资产', 'error')
      return
    }
    setEmotionError(null)
    setEmotionPanelOpen(false)
    setEmotionSelectorManual(manual)
    setEmotionPersonSelectorOpen(true)
  }, [basePoseImage, primaryImageUrl])

  const handleEmotionSelectionConfirm = React.useCallback(async (selection: PortraitTextureSelection) => {
    setEmotionSelection(selection)
    setEmotionPersonSelectorOpen(false)
    setEmotionError(null)
    setEmotionPanelOpen(true)
  }, [])

  const handlePortraitTextureSelectionConfirm = React.useCallback(async (selection: PortraitTextureSelection) => {
    const outputNodeId = portraitTextureEditorOutputNodeId
    const sourceImageUrl = String(primaryImageUrl || basePoseImage || '').trim()
    if (!outputNodeId) throw new Error('人像质感调节结果节点不存在')
    if (!sourceImageUrl) throw new Error('当前节点没有可编辑的真实图片资产')
    const outputNode = useRFStore.getState().nodes.find((node) => node.id === outputNodeId)
    if (!outputNode) throw new Error('人像质感调节结果节点已被移除')

    const sourcePng = await createMaskEditSourcePng(sourceImageUrl)
    const [hostedSource, hostedMask] = await Promise.all([
      uploadEditedImageBlob({
        blob: sourcePng.blob,
        label: '人像质感调节源图',
        filePrefix: 'portrait-texture-source',
      }),
      uploadEditedImageBlob({
        blob: selection.maskBlob,
        label: '人像质感调节区域蒙版',
        filePrefix: 'portrait-texture-mask',
      }),
    ])
    const outputNodeData = (outputNode.data ?? {}) as Record<string, unknown>
    const strength = normalizePortraitTextureStrength(outputNodeData.portraitTextureStrength)
    const imageOperationSpec = createImageOperationForSource({
      kind: 'portrait_adjust',
      execution: 'image-edit',
      sourceNodeId: id,
      sourceUrl: hostedSource.url,
      sourceAssetId: hostedSource.assetId,
      sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
      parameters: {
        strength,
        selectionSource: selection.source,
        selectionRect: selection.rect,
        preserveIdentity: true,
        preservePose: true,
        preserveComposition: true,
        maskPolarity: 'transparent-is-edit',
        originalSourceUrl: sourceImageUrl,
      },
      additionalInputs: [{
        role: 'mask',
        url: hostedMask.url,
        assetId: hostedMask.assetId,
        mimeType: 'image/png',
        width: selection.imageWidth,
        height: selection.imageHeight,
      }],
    })
    updateNodeData(outputNodeId, {
      referenceImages: [hostedSource.url],
      maskUrl: hostedMask.url,
      portraitTextureMaskAssetId: hostedMask.assetId,
      portraitTextureSourceNodeId: id,
      portraitTextureSelectionStatus: 'confirmed',
      portraitTextureSelectionSource: selection.source,
      portraitTextureSelectionRect: selection.rect,
      portraitTextureSourceSize: {
        width: selection.imageWidth,
        height: selection.imageHeight,
      },
      imageOperationSpec,
      imageOperationState: createImageOperationState(imageOperationSpec),
      imageOperationRevision: 1,
    })
    const store = useRFStore.getState()
    store.onNodesChange([
      { id, type: 'select', selected: false },
      { id: outputNodeId, type: 'select', selected: true },
    ])
    store.clearPendingFocusNodeId()
    setPortraitTextureEditorOutputNodeId(null)
    toast('已选择人物，可调整参数后生成', 'success')
  }, [basePoseImage, data, id, portraitTextureEditorOutputNodeId, primaryImageUrl, updateNodeData, uploadEditedImageBlob])

  const createConfiguredImagePresetNode = React.useCallback((presetKey: string): string | null => {
    const preset = findLibTvImagePreset(presetKey)
    if (!preset || preset.execution === 'character-fission') return null
    const sourceUrl = String(basePoseImage || '').trim()
    if (!sourceUrl) {
      toast(`${preset.label}缺少可执行的真实源图片`, 'error')
      return null
    }
    const imageOperationSpec = createPresetImageOperation({
      presetKey: preset.key,
      sourceNodeId: id,
      sourceUrl,
      sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
    })
    const newNodeId = createConfiguredImageDerivativeNode({
      label: preset.label,
      prompt: preset.prompt,
      presetKey: preset.key,
      operationKind: imageOperationSpec.kind,
      execution: imageOperationSpec.execution,
      parameters: imageOperationSpec.parameters,
      output: imageOperationSpec.output,
      panoramic: preset.execution === 'panorama',
    })
    return newNodeId
  }, [basePoseImage, createConfiguredImageDerivativeNode, data, id])

  const handleImagePresetExecute = React.useCallback((presetKey: string) => {
    const preset = findLibTvImagePreset(presetKey)
    if (!preset || preset.execution === 'character-fission') return
    if (preset.key === 'portrait-texture') {
      setImagePresetConfirmKey(null)
      openPortraitTextureEditor()
      return
    }
    const newNodeId = createConfiguredImagePresetNode(presetKey)
    setImagePresetConfirmKey(null)
    if (!newNodeId) return
    runNodeDagToTarget(newNodeId, useRFStore.getState, useRFStore.setState, { concurrency: 1 }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : `${preset.label}生成启动失败`
      console.error('LibTV image preset execution failed', error)
      toast(message, 'error')
    })
  }, [createConfiguredImagePresetNode, openPortraitTextureEditor])

  // Define node-specific tools and overflow calculation
  const uniqueDefs = React.useMemo(() => {
    const isImgContext = hasImageResults || hasUpstreamConnections || (isVideoNode && hasPrimaryVideo)
    if (isImgContext) {
      // 球形模式下 uniqueDefs 为空，操作全在 toolbarMetaActions
      if (isPanoramic && panoramicSphereMode) return []

      const tools: { key: string; label: string; icon: JSX.Element; onClick: () => void; loading?: boolean; disabled?: boolean; showLabel?: boolean; badge?: React.ReactNode; menuItems?: ToolbarMenuItem[]; active?: boolean; tooltip?: string }[] = []

      if (!isPanoramic && (kind === 'image' || kind === 'imageEdit') && hasImageResults) {
        const gridSplitMenuItems: ToolbarMenuItem[] = [
          ...LIBTV_IMAGE_GRID_SPLIT_ACTIONS.map((item) => ({
            key: item.key,
            label: item.label,
            onClick: () => {
              setGridSplitRows(item.rows)
              setGridSplitCols(item.cols)
              setGridSplitOpen(true)
            },
          })),
          {
            key: 'custom',
            label: '自定义',
            onClick: () => {},
            subMenuContent: (
              <LazyGridCustomPicker
                isDarkUi={isDarkUi}
                onSelect={(cols, rows) => {
                  setGridSplitCols(cols)
                  setGridSplitRows(rows)
                  setGridSplitOpen(true)
                }}
              />
            ),
          },
        ]
        const moreMenuItems: ToolbarMenuItem[] = []
        if ((data as Record<string, unknown>).isImageLayer === true) {
          moreMenuItems.push({
            key: 'layer-recompose',
            label: '按当前图层重新合成',
            icon: <IconApps size={14} />,
            onClick: () => { void handleLayerRecompose() },
          })
        }
        if (supportsReversePrompt) {
          moreMenuItems.push({
            key: 'reverse',
            label: '反推提示词',
            icon: <IconPhotoSearch size={14} />,
            loading: reversePromptLoading,
            disabled: reversePromptLoading,
            onClick: onReversePrompt,
          })
        }
        moreMenuItems.push(
          { key: 'denoise-clean', label: '精简去噪 · 保构图', icon: <IconSparkles size={14} />, onClick: () => handleDenoise('clean') },
          { key: 'denoise-8k', label: '8K 极致增强', icon: <IconSparkles size={14} />, onClick: () => handleDenoise('enhance') },
          { key: 'smart-cutout', label: '智能抠图', icon: <IconScissors size={14} />, onClick: handleSmartCutout },
          { key: 'save-to-library', label: '保存到素材库', icon: <IconFolderPlus size={14} />, onClick: () => setSaveToLibraryOpen(true) },
        )
        const nineGridMenuItems: ToolbarMenuItem[] = LIBTV_IMAGE_NINE_GRID_PRESET_KEYS.flatMap((presetKey) => {
          const preset = findLibTvImagePreset(presetKey)
          return preset
            ? [{
              key: preset.key,
              label: preset.label,
              icon: <LibTvImageToolbarIcon name={LIBTV_IMAGE_NINE_GRID_ICONS[preset.key] ?? 'nine-grid'} size={16} />,
              onClick: () => setImagePresetConfirmKey(preset.key),
            }]
            : []
        })
        const imageIntentDefs = INTENT_ACTIONS.filter((definition) => definition.applicableTo({ kind }))
        const resolveIntentContext = () => resolveIntentChapterContext({
          sourceNodeId: id,
          nodes: useRFStore.getState().nodes,
          edges: useRFStore.getState().edges,
        })
        const thisNodeIntents = runningNodeIntents.get(id)
        for (const definition of imageIntentDefs) {
          const IntentIcon = definition.icon
          const thisLoading = Boolean(thisNodeIntents?.has(definition.intent))
          moreMenuItems.push({
            key: definition.key,
            label: definition.label,
            icon: <IntentIcon size={14} />,
            loading: thisLoading,
            disabled: thisLoading,
            onClick: () => {
              if (thisLoading) return
              const chapterContext = resolveIntentContext()
              if (!chapterContext) {
                toast('当前画布上下文未就绪，请稍后重试', 'error')
                return
              }
              if (definition.requiresConfig) {
                setPendingIntentConfig({ intent: definition.intent, chapterContext })
              } else {
                void dispatchIntent(definition.intent, id, {
                  chapterContext,
                  variantParams: definition.variantParams,
                })
              }
            },
          })
        }
        if (hasUpstreamConnections) {
          moreMenuItems.push({
            key: 'inherit-upstream',
            label: '继承上游',
            icon: <IconArrowMergeBoth size={14} />,
            onClick: () => inheritUpstreamConnections(id),
          })
        }

        tools.push(
          {
            key: 'portrait-texture',
            label: '人像质感调节',
            showLabel: true,
            icon: <LibTvImageToolbarIcon name="portrait" size={16} />,
            tooltip: '人像质感与情绪调节',
            onClick: openPortraitTextureEditor,
            badge: <span className="tc-image-toolbar-new-badge">NEW</span>,
            menuItems: LIBTV_IMAGE_PORTRAIT_ACTIONS.map((item) =>
              item.key === 'portrait-adjust'
                ? {
                key: item.key,
                label: item.label,
                icon: <LibTvImageToolbarIcon name={item.icon} size={16} />,
                onClick: openPortraitTextureEditor,
              }
                : {
                key: item.key,
                label: item.label,
                icon: <LibTvImageToolbarIcon name={item.icon} size={16} />,
                onClick: () => openEmotionPersonSelector(false),
              }),
          },
          {
            key: 'panoramic',
            label: '全景',
            showLabel: true,
            icon: <LibTvImageToolbarIcon name="panorama" size={16} />,
            tooltip: '基于当前场景创建720°全景图',
            onClick: () => setPanoramicConfirm(true),
          },
          {
            key: 'camera-angle',
            label: '多角度',
            showLabel: true,
            icon: <LibTvImageToolbarIcon name="multi-angle" size={16} />,
            tooltip: '从不同摄影机角度查看并生成当前画面',
            onClick: () => { closeLightingEditor(); setImageNodeMultiAngleOpen(true) },
          },
          {
            key: 'lighting-edit',
            label: '打光',
            showLabel: true,
            icon: <LibTvImageToolbarIcon name="lighting" size={16} />,
            tooltip: '调整当前画面的灯光方向、强度与氛围',
            onClick: () => { setImageNodeMultiAngleOpen(false); openLightingEditor() },
          },
          {
            key: 'nine-grid',
            label: '九宫格',
            showLabel: true,
            icon: <LibTvImageToolbarIcon name="nine-grid" size={16} />,
            tooltip: '基于当前图片生成设定图、分镜或画面推演',
            onClick: () => setImagePresetConfirmKey('multi-camera-9'),
            menuItems: nineGridMenuItems,
          },
          {
            key: 'hd',
            label: '高清',
            showLabel: true,
            icon: <LibTvImageToolbarIcon name="hd" size={16} />,
            tooltip: '高清、扩图、重绘、擦除、抠图与裁剪',
            onClick: () => setHdPanelOpen(true),
            menuItems: LIBTV_IMAGE_HD_ACTIONS.map((item) => {
              if (item.key === 'upscale') return {
                key: item.key,
                label: item.label,
                icon: <LibTvImageToolbarIcon name={item.icon} size={14} />,
                onClick: () => setHdPanelOpen(true),
              }
              if (item.key === 'expand') return {
                key: item.key,
                label: item.label,
                icon: <LibTvImageToolbarIcon name={item.icon} size={14} />,
                onClick: () => setExpandPanelOpen(true),
              }
              if (item.key === 'repaint') return {
                key: item.key,
                label: item.label,
                icon: <LibTvImageToolbarIcon name={item.icon} size={14} />,
                onClick: () => { setMaskMode('repaint'); setCropOpen(false); setAnnotateOpen(false) },
              }
              if (item.key === 'erase') return {
                key: item.key,
                label: item.label,
                icon: <LibTvImageToolbarIcon name={item.icon} size={14} />,
                onClick: () => { setMaskMode('erase'); setCropOpen(false); setAnnotateOpen(false) },
              }
              if (item.key === 'cutout') return {
                key: item.key,
                label: item.label,
                icon: <LibTvImageToolbarIcon name={item.icon} size={14} />,
                loading: extractLoading,
                disabled: extractLoading,
                onClick: handleFastCutout,
              }
              return {
                key: item.key,
                label: item.label,
                icon: <LibTvImageToolbarIcon name={item.icon} size={14} />,
                onClick: () => { setCropOpen(true); setAnnotateOpen(false); setMaskMode(null) },
              }
            }),
          },
          {
            key: 'element-edit',
            label: '元素编辑',
            showLabel: true,
            icon: <LibTvImageToolbarIcon name="element-edit" size={16} />,
            tooltip: '识别并修改、移动画面中的元素',
            onClick: () => {
              setElementEditOpen(true)
              setCropOpen(false)
              setAnnotateOpen(false)
              setMaskMode(null)
            },
          },
          {
            key: 'layer-split',
            label: '图层分离',
            showLabel: true,
            icon: <LibTvImageToolbarIcon name="layer-split" size={16} />,
            tooltip: '将当前图片拆分为可独立编辑的图层',
            loading: layerLoading,
            disabled: layerLoading,
            onClick: handleLayerSplit,
          },
          {
            key: 'grid-split',
            label: '宫格切分',
            showLabel: true,
            icon: <LibTvImageToolbarIcon name="grid-split" size={16} />,
            tooltip: '按固定或自定义行列切分当前图片',
            onClick: () => {
              setGridSplitRows(3)
              setGridSplitCols(3)
              setGridSplitOpen(true)
            },
            menuItems: gridSplitMenuItems,
          },
          {
            key: 'annotate',
            label: '标注',
            icon: <LibTvImageToolbarIcon name="annotate" size={18} />,
            tooltip: '在当前图片上绘制标注',
            onClick: () => { setAnnotateOpen((open) => !open); setCropOpen(false); setMaskMode(null) },
            active: annotateOpen,
          },
          {
            key: 'rotate',
            label: '旋转',
            icon: <LibTvImageToolbarIcon name="rotate" size={16} />,
            tooltip: '创建当前图片的旋转预览',
            onClick: handleCreateRotatePreview,
            active: Boolean(rotatePreviewNodeId),
          },
          {
            key: 'more',
            label: '更多',
            icon: <IconDots size={18} />,
            onClick: () => {},
            menuItems: moreMenuItems,
          },
        )
        return tools
      }

      // 全景平铺模式：不展示普通图片编辑操作，避免混乱
      if (!isPanoramic) {
        if ((kind === 'image' || kind === 'imageEdit') && hasImageResults) {
          tools.push(
            {
              key: 'camera-angle',
              label: '多角度',
              showLabel: true,
              icon: <IconCamera size={18} />,
              onClick: () => { closeLightingEditor(); setImageNodeMultiAngleOpen(true) },
            },
            {
              key: 'lighting-edit',
              label: '打光',
              showLabel: true,
              icon: <IconBulb size={18} />,
              onClick: () => { setImageNodeMultiAngleOpen(false); openLightingEditor() },
            },
          )
        }
        if (supportsReversePrompt && hasImageResults) {
          tools.push({
            key: 'reverse',
            label: '反推提示词',
            showLabel: true,
            icon: <IconPhotoSearch size={18} />,
            onClick: () => onReversePrompt(),
            loading: reversePromptLoading,
            disabled: reversePromptLoading,
          })
        }
        if (isImageNode) {
          const imageIntentDefs = INTENT_ACTIONS.filter((a) => a.applicableTo({ kind }))
          if (imageIntentDefs.length > 0) {
            const resolveCtx = () => resolveIntentChapterContext({ sourceNodeId: id, nodes: useRFStore.getState().nodes, edges: useRFStore.getState().edges })
            // Only show loading for THIS node's running intents, not global ones.
            const thisNodeIntents = runningNodeIntents.get(id)
            const parentLoading = imageIntentDefs.some((a) => thisNodeIntents?.has(a.intent))
            tools.push({
              key: 'text-creation',
              label: '文本创作',
              icon: <IconMovie size={18} />,
              showLabel: true,
              loading: parentLoading,
              onClick: () => {},
              menuItems: imageIntentDefs.map((a) => {
                const Icon = a.icon
                const thisLoading = Boolean(thisNodeIntents?.has(a.intent))
                return {
                  key: a.key,
                  label: a.label,
                  icon: <Icon size={14} />,
                  loading: thisLoading,
                  // Allow concurrent dispatches from different source nodes —
                  // only disable if THIS exact intent is already running from THIS node.
                  disabled: thisLoading,
                  onClick: () => {
                    if (thisLoading) return
                    const chapterContext = resolveCtx()
                    if (!chapterContext) {
                      toast('当前画布上下文未就绪，请稍后重试', 'error')
                      return
                    }
                    if (a.requiresConfig) {
                      setPendingIntentConfig({ intent: a.intent, chapterContext })
                    } else {
                      void dispatchIntent(a.intent, id, { chapterContext, variantParams: a.variantParams })
                    }
                  },
                }
              }),
            })
          }
        }
        if ((kind === 'image' || kind === 'imageEdit') && hasImageResults) {
          tools.push({
            key: 'denoise',
            label: '一键去噪',
            showLabel: true,
            icon: <IconSparkles size={18} />,
            loading: denoiseLoading,
            onClick: () => {},
            menuItems: [
              { key: 'denoise-clean', label: '精简去噪 · 保构图', onClick: () => handleDenoise('clean') },
              { key: 'denoise-8k',    label: '8K 极致增强',      onClick: () => handleDenoise('enhance') },
            ] as ToolbarMenuItem[],
          })
        }
        if ((kind === 'image' || kind === 'imageEdit') && hasImageResults) {
          tools.push({
            key: 'grid-split',
            label: '宫格切分',
            showLabel: true,
            icon: <IconBorderAll size={18} />,
            onClick: () => {},
            menuItems: [
              { key: '2x2', label: '4宫格 (2×2)', onClick: () => { setGridSplitRows(2); setGridSplitCols(2); setGridSplitOpen(true) } },
              { key: '3x3', label: '9宫格 (3×3)', onClick: () => { setGridSplitRows(3); setGridSplitCols(3); setGridSplitOpen(true) } },
              { key: '4x4', label: '16宫格 (4×4)', onClick: () => { setGridSplitRows(4); setGridSplitCols(4); setGridSplitOpen(true) } },
              { key: '5x5', label: '25宫格 (5×5)', onClick: () => { setGridSplitRows(5); setGridSplitCols(5); setGridSplitOpen(true) } },
              {
                key: 'custom',
                label: '自定义',
                onClick: () => {},
                subMenuContent: (
                  <LazyGridCustomPicker
                    isDarkUi={isDarkUi}
                    onSelect={(cols, rows) => {
                      setGridSplitCols(cols)
                      setGridSplitRows(rows)
                      setGridSplitOpen(true)
                    }}
                  />
                ),
              },
            ] as ToolbarMenuItem[],
          })
        }
        // 裁剪下拉菜单 + 标注 + 旋转
        if ((kind === 'image' || kind === 'imageEdit') && hasImageResults) {
          tools.push({
            key: 'image-edit-menu',
            label: '裁剪',
            showLabel: true,
            icon: <IconCrop size={18} />,
            onClick: () => {},
            menuItems: [
              { key: 'hd',      label: '高清',  onClick: () => { setHdPanelOpen(o => !o); setExpandPanelOpen(false) } },
              { key: 'expand',  label: '扩图',  onClick: () => { setExpandPanelOpen(o => !o); setHdPanelOpen(false) } },
              { key: 'repaint', label: '重绘',  onClick: () => { setMaskMode('repaint'); setCropOpen(false); setAnnotateOpen(false) } },
              { key: 'erase',   label: '擦除',  onClick: () => { setMaskMode('erase'); setCropOpen(false); setAnnotateOpen(false) } },
              { key: 'crop',    label: '裁剪',  onClick: () => { setCropOpen(true); setAnnotateOpen(false); setMaskMode(null) } },
            ] as ToolbarMenuItem[],
          })
          // 抠图 / 分层下拉菜单：一键抠图 / 智能抠图 / 一键分层，产物均为新生节点
          tools.push({
            key: 'cutout-menu',
            label: '抠图',
            showLabel: true,
            icon: <IconScissors size={18} />,
            loading: extractLoading || smartCutoutLoading || layerLoading,
            onClick: () => {},
            menuItems: [
              { key: 'fast-cutout',  label: '极速抠图', onClick: handleFastCutout },
              { key: 'smart-cutout', label: '智能抠图', onClick: handleSmartCutout },
              { key: 'layer-split',  label: '一键分层', onClick: handleLayerSplit },
            ] as ToolbarMenuItem[],
          })
          // 标注
          tools.push({
            key: 'annotate',
            label: '标注',
            showLabel: false,
            icon: <IconPencil size={18} />,
            onClick: () => { setAnnotateOpen(o => !o); setCropOpen(false); setMaskMode(null) },
            active: annotateOpen,
          })
          // 旋转
          tools.push({
            key: 'rotate',
            label: '旋转',
            showLabel: false,
            icon: <IconRotate size={18} />,
            onClick: handleCreateRotatePreview,
            active: !!rotatePreviewNodeId,
          })
        }
        if ((kind === 'image' || kind === 'imageEdit') && hasImageResults) {
          tools.push({
            key: 'panoramic',
            label: '生成720°全景图',
            icon: <IconPanoramaHorizontal size={18} />,
            onClick: () => { setPanoramicConfirm(true) },
            loading: panoramicGenerating,
          })
        }
        if ((kind === 'image' || kind === 'imageEdit') && hasImageResults) {
          tools.push({
            key: 'emotion',
            label: '情绪调节',
            icon: <IconMoodSmile size={18} />,
            onClick: () => {
              if (emotionPanelOpen || emotionPersonSelectorOpen) {
                setEmotionPanelOpen(false)
                setEmotionPersonSelectorOpen(false)
                return
              }
              openEmotionPersonSelector(false)
            },
            loading: emotionLoading,
            active: emotionPanelOpen || emotionPersonSelectorOpen,
          })
        }
        // 视频工具栏（与 LibTV 参考页同步）。生成、分析、续写、剪辑、抽帧、音视频分离
        // 和字幕/主体处理都走真实执行器；模型目录只按已发布能力展示可用模型。
        if (isVideoNode && hasPrimaryVideo) {
          tools.push({
            key: 'video-enhance',
            label: '高清',
            showLabel: true,
            icon: <IconBadgeHd size={16} />,
            active: showEnhancePanel,
            onClick: () => setShowEnhancePanel(true),
          })
          tools.push({
            key: 'video-retake',
            label: '片段重拍',
            showLabel: true,
            icon: <IconRepeat size={16} />,
            onClick: handleCreateSegmentRemake,
            menuItems: [
              {
                key: 'retake-current',
                label: '片段重拍',
                icon: <IconRepeat size={14} />,
                onClick: handleCreateSegmentRemake,
              },
              {
                key: 'smart-continue-current',
                label: '智能续写',
                icon: <IconRepeat size={14} />,
                onClick: () => setVideoContinuationOpen(true),
              },
              {
                key: 'smart-edit-current',
                label: '智能剪辑',
                icon: <IconScissors size={14} />,
                onClick: handleCreateSmartVideoEdit,
              },
            ] as ToolbarMenuItem[],
          })
          tools.push({
            key: 'video-analysis',
            label: '逐帧拉片',
            showLabel: true,
            icon: <IconTimeline size={16} />,
            disabled: !hasPrimaryVideo,
            onClick: handleCreateVideoAnalysis,
            menuItems: [
              {
                key: 'analysis-structured',
                label: '创建逐帧拉片节点',
                icon: <IconTimeline size={14} />,
                onClick: handleCreateVideoAnalysis,
              },
            ],
          })
          tools.push({
            key: 'video-remove-subtitles',
            label: '智能去字幕',
            showLabel: true,
            icon: <IconSubtitlesOff size={16} />,
            onClick: () => setVideoToolEditorMode('subtitle'),
            menuItems: [
              {
                key: 'remove-subtitles-auto',
                label: '智能去字幕',
                icon: <IconSubtitlesOff size={14} />,
                onClick: () => setVideoToolEditorMode('subtitle-auto'),
              },
              {
                key: 'remove-subtitles-select',
                label: '框选去字幕',
                icon: <IconSubtitlesOff size={14} />,
                onClick: () => setVideoToolEditorMode('subtitle'),
              },
            ],
          })
          tools.push({
            key: 'video-audio-separation',
            label: '音视频分离',
            showLabel: true,
            icon: <IconArrowsSplit size={16} />,
            onClick: () => setVideoToolEditorMode('separation'),
            menuItems: [
              {
                key: 'audio-separation-open',
                label: '分离为无声视频与音轨',
                icon: <IconArrowsSplit size={14} />,
                onClick: () => setVideoToolEditorMode('separation'),
              },
            ],
          })
          tools.push({
            key: 'video-subject-remove',
            label: '主体消除',
            showLabel: true,
            icon: <IconUserOff size={16} />,
            onClick: () => setVideoToolEditorMode('subject'),
            menuItems: [
              {
                key: 'subject-remove-select',
                label: '框选要消除的主体',
                icon: <IconUserOff size={14} />,
                onClick: () => setVideoToolEditorMode('subject'),
              },
            ],
          })
          tools.push({
            key: 'video-first-frame',
            label: '截取首帧',
            showLabel: true,
            icon: <IconScreenshot size={16} />,
            onClick: () => { void handleCaptureVideoFirstFrame() },
            menuItems: [
              {
                key: 'capture-first-frame',
                label: '截取首帧',
                icon: <IconScreenshot size={14} />,
                onClick: () => { void handleCaptureVideoFrame('first') },
              },
              {
                key: 'capture-last-frame',
                label: '截取尾帧',
                icon: <IconScreenshot size={14} />,
                onClick: () => { void handleCaptureVideoFrame('last') },
              },
              {
                key: 'capture-current-frame',
                label: '截取当前帧',
                icon: <IconScreenshot size={14} />,
                onClick: () => { void handleCaptureVideoFrame('current') },
              },
            ] as ToolbarMenuItem[],
          })
        }

        // 项目节点已天然属于项目素材域；此动作仅复制到个人/团队跨项目收藏库。
        if (hasImageResults && primaryImageUrl) {
          tools.push({
            key: 'save-to-library',
            label: '保存到素材库',
            showLabel: false,
            icon: <IconFolderPlus size={18} />,
            onClick: () => setSaveToLibraryOpen(true),
          })
        }

        // 继承上游
        if (hasUpstreamConnections) {
          tools.push({
            key: 'inherit-upstream',
            label: '继承上游',
            showLabel: true,
            icon: <IconArrowMergeBoth size={16} />,
            onClick: () => inheritUpstreamConnections(id),
          })
        }
      }
      return tools
    }
    // Other node kinds must not expose a generic action without a real execution contract.
    return []
  }, [
    handleGeneratePanoramic,
    hasImageResults,
    hasUpstreamConnections,
    isPanoramic,
    panoramicSphereMode,
    kind,
    openCameraEditor,
    closeLightingEditor,
    panoramicGenerating,
    openLightingEditor,
    onReversePrompt,
    reversePromptLoading,
    supportsReversePrompt,
    setGridSplitOpen,
    setGridSplitRows,
    setGridSplitCols,
    isDarkUi,
    annotateOpen,
    hdLoading,
    expandLoading,
    emotionLoading,
    rotatePreviewNodeId,
    setHdPanelOpen,
    setExpandPanelOpen,
    setMaskMode,
    setCropOpen,
    setAnnotateOpen,
    extractLoading,
    smartCutoutLoading,
    layerLoading,
    handleFastCutout,
    handleSmartCutout,
    handleLayerSplit,
    handleDenoise,
    handleCreateRotatePreview,
    openPortraitTextureEditor,
    handleLayerRecompose,
    denoiseLoading,
    primaryImageUrl,
    imageModel,
    nodeWidth,
    addNode,
    id,
    isImageNode,
    activeIntent,
    runningNodeIntents,
    setPendingIntentConfig,
    isVideoNode,
    hasPrimaryVideo,
    videoUrl,
    viewOnly,
    data,
    showEnhancePanel,
    setShowEnhancePanel,
    handleCreateVideoAnalysis,
    handleCreateSmartVideoEdit,
    handleCreateSegmentRemake,
    setTrimOpen,
    inheritUpstreamConnections,
    setSaveToLibraryOpen,
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



  // mention catalog is a pure projection of current canvas/project/persisted bindings.
  // Keeping it synchronous is required for PromptSection mount: an effect-driven empty
  // first frame renders persisted @tokens as plain text and loses their chip styling.
  const mentionItems = React.useMemo<MentionSuggestionItem[]>(() => {
    const q = mentionOpen ? (mentionFilter || '').trim().toLowerCase() : ''
    const filteredOptions = mentionSuggestionOptions
      .filter((opt) => {
        const username = String(opt.username || '').toLowerCase()
        const displayName = String(opt.displayName || '').toLowerCase()
        return !q || username.includes(q) || displayName.includes(q)
      })
    const visibleOptions = mentionOpen ? filteredOptions.slice(0, 12) : filteredOptions
    return visibleOptions.map((opt): MentionSuggestionItem => ({
        username: opt.username,
        display_name: opt.displayName,
        profile_picture_url: opt.assetUrl || null,
        source: opt.source,
        nodeId: opt.nodeId || null,
        mentionAliases: opt.mentionAliases || [],
        isConnected: opt.isConnected === true,
        ...(opt.source === 'asset' && opt.assetUrl
          ? {
              assetBinding: {
                url: opt.assetUrl,
                assetId: opt.assetId || null,
                assetRefId: opt.assetRefId || opt.username,
                assetName: opt.assetName || opt.displayName,
                role: opt.assetRole || 'reference',
              },
            }
          : null),
      }))
  }, [mentionFilter, mentionOpen, mentionSuggestionOptions])

  const hasContent = React.useMemo(() => {
    if (hasImageResults) return Boolean(imageUrl || imageResults.length)
    // Video results are the canonical output list for generated/processed
    // clips.  Do not hide the LibTV toolbar merely because a provider wrote
    // the URL into `videoResults[primaryIndex]` without duplicating it onto
    // the legacy node-level `videoUrl` field.
    if (isVideoNode || hasVideoResults) return hasPrimaryVideo
    if (isAudioNode) return Boolean((data as any)?.audioUrl)
    return false
  }, [hasImageResults, isVideoNode, hasVideoResults, isAudioNode, imageUrl, imageResults.length, data, hasPrimaryVideo])

  const hasGenerationContext = hasContent || hasUpstreamConnections

  const defaultLabel = React.useMemo(() => {
    if (hasVideo || hasVideoResults || schema.category === 'video') return '文生视频'
    if (hasImageResults) return '图像节点'
    if (isAudioNode) return '音频节点'
    if (isSubtitleNode) return '字幕节点'
    return 'Task'
  }, [hasImageResults, hasVideo, hasVideoResults, isAudioNode, isSubtitleNode, schema.category])
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

  const handleCharacterFissionExecute = React.useCallback((draft: CharacterFissionDraft) => {
    const editableModel = resolveImageEditModelForAction('gpt-image-2')
    if (!editableModel) return
    let nodeDraft: ReturnType<typeof buildCharacterFissionNodeDraft>
    try {
      nodeDraft = buildCharacterFissionNodeDraft({
        sourceNodeId: id,
        sourceData: data as Record<string, unknown>,
        referenceImageUrl: String(basePoseImage || ''),
        imageModel: editableModel,
        draft,
      })
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '角色裂变配置无效', 'error')
      return
    }
    const sourceUrl = String(basePoseImage || '').trim()
    const imageOperationSpec = createImageOperationForSource({
      kind: 'character_fission',
      execution: 'image-edit',
      sourceNodeId: id,
      sourceUrl,
      sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
      parameters: {
        direction: draft.direction,
        additionalPrompt: draft.additionalPrompt,
        variantCount: 4,
        preserveIdentity: true,
        independentCandidates: true,
      },
      output: { mediaType: 'image', count: 4 },
    })

    const beforeIds = new Set(useRFStore.getState().nodes.map((node) => node.id))
    addNode('taskNode', nodeDraft.label, {
      ...nodeDraft.data,
      imageOperationSpec,
      imageOperationState: createImageOperationState(imageOperationSpec),
      imageOperationRevision: 1,
      libTvImageOperationKey: 'character-fission',
    })
    const afterAdd = useRFStore.getState()
    const newNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
    if (!newNode) {
      toast('角色裂变候选节点创建失败', 'error')
      return
    }
    const sourceNode = afterAdd.nodes.find((node) => node.id === id)
    afterAdd.onNodesChange([
      {
        id: newNode.id,
        type: 'position',
        position: {
          x: (sourceNode?.position?.x ?? 0) + nodeWidth + 80,
          y: sourceNode?.position?.y ?? 0,
        },
        dragging: false,
      },
      { id, type: 'select' as const, selected: false },
      { id: newNode.id, type: 'select', selected: true },
    ])
    afterAdd.onConnect({
      source: id,
      sourceHandle: 'out-image',
      target: newNode.id,
      targetHandle: 'in-image',
    })
    setImagePresetConfirmKey(null)
    runNodeDagToTarget(newNode.id, useRFStore.getState, useRFStore.setState, { concurrency: 1 }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '角色裂变生成启动失败'
      console.error('Character fission execution failed', error)
      toast(message, 'error')
    })
  }, [addNode, basePoseImage, data, id, nodeWidth, resolveImageEditModelForAction])

  const handleSelectLibTvPreset = React.useCallback((preset: LibTvImagePreset) => {
    if (preset.key === 'portrait-texture') {
      openPortraitTextureEditor()
      return
    }
    if (preset.execution === 'panorama') {
      setPanoramicConfirm(true)
      return
    }
    if (preset.execution === 'character-fission' && !isCharacterReferenceNode) {
      toast('角色裂变只能从结构化角色参考资产发起', 'error')
      return
    }
    setImagePresetConfirmKey(preset.key)
  }, [isCharacterReferenceNode, openPortraitTextureEditor])

  const addConnectedHostedImageNode = React.useCallback((
    label: string,
    asset: HostedEditedImageAsset,
    sourceHandle: 'out-image' | 'out-video' = 'out-image',
    imageOperationSpec?: ImageOperationSpec,
  ): string | null => {
    const imageResult = buildHostedImageResult(asset, label)
    const beforeIds = new Set(useRFStore.getState().nodes.map((node) => node.id))
    addNode('taskNode', label, {
      kind: 'image',
      imageUrl: asset.url,
      imageResults: [imageResult],
      imagePrimaryIndex: 0,
      serverAssetId: asset.assetId,
      status: 'done',
      ...(imageOperationSpec
        ? {
            imageOperationSpec,
            imageOperationState: {
              ...createImageOperationState(imageOperationSpec, 'succeeded'),
              attempt: 1,
              progress: 100,
              startedAt: imageOperationSpec.createdAt,
              finishedAt: new Date().toISOString(),
              resultAssets: [{ role: 'result' as const, url: asset.url, assetId: asset.assetId }],
            },
            imageOperationRevision: imageOperationSpec.sourceRevision + 1,
          }
        : {}),
    })
    const afterAdd = useRFStore.getState()
    const newNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
    if (!newNode) return null
    const sourceNode = afterAdd.nodes.find((node) => node.id === id)
    afterAdd.onNodesChange([{
      id: newNode.id,
      type: 'position' as const,
      position: { x: (sourceNode?.position?.x ?? 0) + nodeWidth + 80, y: sourceNode?.position?.y ?? 0 },
      dragging: false,
    }])
    afterAdd.onConnect({ source: id, sourceHandle, target: newNode.id, targetHandle: 'in-image' })
    afterAdd.clearPendingFocusNodeId()
    return newNode.id
  }, [addNode, id, nodeWidth])

  // 参考页的“截取首帧/尾帧/当前帧”都是确定性的本地媒体动作：从真实视频
  // URL 读取目标帧，上传到托管资产后在源节点右侧落一个可复用图片节点。
  const handleCaptureVideoFrame = React.useCallback(async (mode: 'first' | 'last' | 'current' = 'first') => {
    const sourceUrl = (videoResults[videoPrimaryIndex]?.url || videoUrl || '').trim()
    if (!sourceUrl) {
      toast('当前没有可截取的真实视频资产', 'error')
      return
    }
    let frameObjectUrl: string | null = null
    try {
      const playback = readRetainedVideoPlaybackSnapshot(buildRetainedVideoSurfaceKey(id, sourceUrl))
      const currentTime = playback?.currentTime ?? videoMarkerPlayback.currentTime
      const targetTime = mode === 'first'
        ? 0
        : mode === 'last'
          ? (activeVideoDuration && activeVideoDuration > 0 ? Math.max(0, activeVideoDuration - 0.05) : Number.MAX_SAFE_INTEGER)
          : Math.max(0, currentTime)
      const label = mode === 'first' ? '视频首帧' : mode === 'last' ? '视频尾帧' : '视频当前帧'
      const filePrefix = mode === 'first' ? 'video-first-frame' : mode === 'last' ? 'video-last-frame' : 'video-current-frame'
      const { frames } = await captureFramesAtTimes(
        { type: 'url', url: sourceUrl },
        [targetTime],
        { mimeType: 'image/jpeg', quality: 0.92 },
      )
      const frame = frames[0]
      if (!frame) throw new Error('视频没有可用帧')
      frameObjectUrl = frame.objectUrl
      const hosted = await uploadCanvasImageBlob({
        blob: frame.blob,
        label,
        filePrefix,
        ownerNodeId: id,
        projectId: typeof currentProject?.id === 'string' ? currentProject.id : undefined,
      })
      const newNodeId = addConnectedHostedImageNode(label, hosted, 'out-video')
      if (!newNodeId) throw new Error('帧图片节点创建失败')
      toast(`已截取${mode === 'first' ? '首' : mode === 'last' ? '尾' : '当前'}帧并生成图片节点`, 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '截取视频帧失败', 'error')
    } finally {
      if (frameObjectUrl) URL.revokeObjectURL(frameObjectUrl)
    }
  }, [activeVideoDuration, addConnectedHostedImageNode, currentProject?.id, id, videoMarkerPlayback.currentTime, videoPrimaryIndex, videoResults, videoUrl])

  const handleCaptureVideoFirstFrame = React.useCallback(() => handleCaptureVideoFrame('first'), [handleCaptureVideoFrame])

  const showVideoCapabilityGap = React.useCallback((label: string, plan: string) => {
    toast(`${label}暂不可用（能力缺口）。方案：${plan}`, 'warning')
  }, [])

  // ── Grid Split ──────────────────────────────────────────────────────────────
  const handleGridSplitCreate = React.useCallback(async (
    cells: GridSplitCell[],
  ) => {
    if (!primaryImageUrl) return
    const rows = gridSplitRows
    const cols = gridSplitCols
    const orderedCells = sortGridSplitCells(cells)
    const sourceNode = useRFStore.getState().nodes.find((n) => n.id === id)
    const sx = (sourceNode?.position?.x ?? 0) + nodeWidth + 60
    const sy = sourceNode?.position?.y ?? 0

    const newNodeIds: string[] = []
    let loadedSource: { image: HTMLImageElement; objectUrl: string } | null = null
    try {
      loadedSource = await loadImageElementFromBlob(await fetchProxiedImageBlob(primaryImageUrl))
      for (const cell of orderedCells) {
        const label = `宫格切分 ${cell.row + 1}-${cell.col + 1}`
        try {
          const croppedBlob = await cropGridSplitCellBlob({
            image: loadedSource.image,
            rows,
            cols,
            cell,
          })
          const hosted = await uploadEditedImageBlob({
            blob: croppedBlob,
            label,
            filePrefix: `grid-split-${cell.row + 1}-${cell.col + 1}`,
          })
          const imageResult = buildHostedImageResult(hosted, label)
          const imageOperationSpec = createImageOperationForSource({
            kind: 'grid_split',
            execution: 'local-transform',
            sourceNodeId: id,
            sourceUrl: primaryImageUrl,
            sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
            parameters: { rows, cols, cell, selectedCellCount: orderedCells.length },
            output: { mediaType: 'image', count: 1 },
          })
          const beforeIds = new Set(useRFStore.getState().nodes.map((n) => n.id))
          addNode('taskNode', label, {
            kind: 'image',
            imageUrl: hosted.url,
            imageResults: [imageResult],
            imagePrimaryIndex: 0,
            serverAssetId: hosted.assetId,
            status: 'done',
            isGridSplitCell: true,
            gridSplitRows: rows,
            gridSplitCols: cols,
            gridSplitCell: cell,
            imageOperationSpec,
            imageOperationState: {
              ...createImageOperationState(imageOperationSpec, 'succeeded'),
              attempt: 1,
              progress: 100,
              startedAt: imageOperationSpec.createdAt,
              finishedAt: new Date().toISOString(),
              resultAssets: [{ role: 'cell' as const, url: hosted.url, assetId: hosted.assetId }],
            },
            imageOperationRevision: imageOperationSpec.sourceRevision + 1,
          })
          const storeAfterCell = useRFStore.getState()
          const newNode = storeAfterCell.nodes.find((n) => !beforeIds.has(n.id))
          if (newNode) {
            const outputIndex = newNodeIds.length
            newNodeIds.push(newNode.id)
            storeAfterCell.onNodesChange([{
              id: newNode.id,
              type: 'position' as const,
              position: {
                x: sx + (outputIndex % cols) * (nodeWidth + 32),
                y: sy + Math.floor(outputIndex / cols) * 260,
              },
              dragging: false,
            }])
            storeAfterCell.onConnect({
              source: id,
              sourceHandle: 'out-image',
              target: newNode.id,
              targetHandle: 'in-image',
            })
            storeAfterCell.clearPendingFocusNodeId()
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '处理失败'
          toast(`宫格 ${cell.row + 1}-${cell.col + 1} 处理失败：${message}`, 'error')
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '宫格裁剪失败'
      toast(message, 'error')
    } finally {
      if (loadedSource) URL.revokeObjectURL(loadedSource.objectUrl)
    }

    if (newNodeIds.length > 1) {
      useRFStore.getState().createGroupForNodeIds(newNodeIds, `宫格切分组 (${newNodeIds.length}张)`, { preserveLayout: true })
    }
    setGridSplitOpen(false)
  }, [addNode, data, gridSplitCols, gridSplitRows, id, nodeWidth, primaryImageUrl, uploadEditedImageBlob])

  const handleGridSplitHD = React.useCallback(async (
    cells: GridSplitCell[],
    scale: number,
  ) => {
    if (!primaryImageUrl) return
    const rows = gridSplitRows
    const cols = gridSplitCols
    const orderedCells = sortGridSplitCells(cells)
    const editableModel = resolveImageEditModelForAction('gpt-image-2')
    if (!editableModel) return
    const sourceNode = useRFStore.getState().nodes.find((node) => node.id === id)
    const sx = (sourceNode?.position?.x ?? 0) + nodeWidth + 60
    const sy = sourceNode?.position?.y ?? 0
    const newNodeIds: string[] = []

    let loadedSource: { image: HTMLImageElement; objectUrl: string } | null = null
    try {
      loadedSource = await loadImageElementFromBlob(await fetchProxiedImageBlob(primaryImageUrl))
      for (const cell of orderedCells) {
        const label = `高清宫格 ${cell.row + 1}-${cell.col + 1}`
        try {
          const croppedBlob = await cropGridSplitCellBlob({
            image: loadedSource.image,
            rows,
            cols,
            cell,
          })
          const hosted = await uploadEditedImageBlob({
            blob: croppedBlob,
            label,
            filePrefix: `grid-split-hd-${cell.row + 1}-${cell.col + 1}`,
          })
          const imageResult = buildHostedImageResult(hosted, label)
          const imageOperationSpec = createImageOperationForSource({
            kind: 'upscale',
            execution: 'image-edit',
            sourceNodeId: id,
            sourceUrl: hosted.url,
            sourceAssetId: hosted.assetId,
            sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
            parameters: {
              scale,
              sourceGrid: { rows, cols, cell },
              preserveComposition: true,
              preserveText: true,
            },
          })
          const beforeIds = new Set(useRFStore.getState().nodes.map((n) => n.id))
          addNode('taskNode', label, {
            kind: 'imageEdit',
            imageUrl: hosted.url,
            imageResults: [imageResult],
            imagePrimaryIndex: 0,
            serverAssetId: hosted.assetId,
            referenceImages: [hosted.url],
            isGridSplitCell: true,
            imageModel: editableModel,
            imageModelVendor: null,
            status: 'queued',
            prompt: `将图片进行${scale}倍高清放大，保持画面细节锐利清晰`,
            imageOperationSpec,
            imageOperationState: createImageOperationState(imageOperationSpec, 'queued'),
            imageOperationRevision: 1,
            libTvImageOperationKey: 'upscale',
          })
          const newNode = useRFStore.getState().nodes.find((n) => !beforeIds.has(n.id))
          if (!newNode) continue
          const outputIndex = newNodeIds.length
          newNodeIds.push(newNode.id)
          const storeAfterCell = useRFStore.getState()
          storeAfterCell.onNodesChange([{
            id: newNode.id,
            type: 'position' as const,
            position: {
              x: sx + (outputIndex % cols) * (nodeWidth + 32),
              y: sy + Math.floor(outputIndex / cols) * 260,
            },
            dragging: false,
          }])
          storeAfterCell.onConnect({
            source: id,
            sourceHandle: 'out-image',
            target: newNode.id,
            targetHandle: 'in-image',
          })
          storeAfterCell.clearPendingFocusNodeId()
          runNodeDagToTarget(newNode.id, useRFStore.getState, useRFStore.setState, { concurrency: 1 }).catch((err: unknown) => {
            toast(`高清宫格 ${cell.row + 1}-${cell.col + 1} 生成失败`, 'error')
            console.error(err)
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : '处理失败'
          toast(`高清宫格 ${cell.row + 1}-${cell.col + 1} 处理失败：${message}`, 'error')
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '宫格裁剪失败'
      toast(message, 'error')
    } finally {
      if (loadedSource) URL.revokeObjectURL(loadedSource.objectUrl)
    }
    if (newNodeIds.length > 1) {
      useRFStore.getState().createGroupForNodeIds(
        newNodeIds,
        `高清宫格组 (${newNodeIds.length}张)`,
        { preserveLayout: true },
      )
    }
    setGridSplitOpen(false)
  }, [addNode, data, gridSplitCols, gridSplitRows, id, nodeWidth, primaryImageUrl, resolveImageEditModelForAction, uploadEditedImageBlob])

  const handleGridSplitCreateOverlay = React.useCallback(async () => {
    if (!gridSplitSelectedCells.size || gridSplitCreating) return
    const cells = parseGridSplitSelectedCells(gridSplitSelectedCells)
    if (!cells.length) return
    setGridSplitCreating(true)
    try { await handleGridSplitCreate(cells) } finally { setGridSplitCreating(false) }
  }, [gridSplitSelectedCells, gridSplitCreating, handleGridSplitCreate])

  const handleGridSplitHDOverlay = React.useCallback(async () => {
    if (!gridSplitSelectedCells.size || gridSplitCreatingHD) return
    const cells = parseGridSplitSelectedCells(gridSplitSelectedCells)
    if (!cells.length) return
    setGridSplitCreatingHD(true)
    try { await handleGridSplitHD(cells, gridSplitScale) } finally { setGridSplitCreatingHD(false) }
  }, [gridSplitSelectedCells, gridSplitCreatingHD, gridSplitScale, handleGridSplitHD])

  // ─── 图片编辑器 callbacks ──────────────────────────────────────────────────
  const handleCropConfirm = React.useCallback(async (blob: Blob, cropW: number, cropH: number) => {
    if (!primaryImageUrl) return
    try {
      const hosted = await uploadEditedImageBlob({ blob, label: '裁剪', filePrefix: 'crop' })
      const imageOperationSpec = createImageOperationForSource({
        kind: 'crop',
        execution: 'local-transform',
        sourceNodeId: id,
        sourceUrl: primaryImageUrl,
        sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
        parameters: { outputSize: { width: cropW, height: cropH }, preservePixels: true },
      })
      const newNodeId = addConnectedHostedImageNode('裁剪', hosted, 'out-image', imageOperationSpec)
      if (!newNodeId) throw new Error('裁剪节点创建失败')
      setCropOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : '裁剪上传失败'
      toast(message, 'error')
    }
  }, [addConnectedHostedImageNode, data, id, primaryImageUrl, uploadEditedImageBlob])

  const handleTrimConfirm = React.useCallback(async (blob: Blob, startTime: number, endTime: number) => {
    const activeVideoUrl = videoResults[videoPrimaryIndex]?.url || videoUrl || ''
    if (!activeVideoUrl) return
    const duration = endTime - startTime
    const label = `剪辑 ${duration.toFixed(1)}s`
    const beforeIds = new Set(useRFStore.getState().nodes.map((n) => n.id))
    addNode('taskNode', label, {
      kind: 'video',
      videoResults: [],
      videoPrimaryIndex: 0,
      videoDuration: duration,
      sourceVideoNodeId: id,
      sourceVideoUrl: activeVideoUrl,
      trimStartSeconds: startTime,
      trimEndSeconds: endTime,
      status: 'queued',
      progress: 0,
    })
    const afterAdd = useRFStore.getState()
    const newNode = afterAdd.nodes.find((n) => !beforeIds.has(n.id))
    if (!newNode) {
      toast('剪辑占位节点创建失败', 'error')
      return
    }
    const sourceNode = afterAdd.nodes.find((n) => n.id === id)
    afterAdd.onNodesChange([{
      id: newNode.id,
      type: 'position' as const,
      position: {
        x: (sourceNode?.position?.x ?? 0) + nodeWidth + 80,
        y: sourceNode?.position?.y ?? 0,
      },
      dragging: false,
    }])
    afterAdd.onConnect({ source: id, sourceHandle: 'out-video', target: newNode.id, targetHandle: 'in-video' })
    afterAdd.clearPendingFocusNodeId()
    setTrimOpen(false)
    setNodeStatus(newNode.id, 'running', { progress: 10 })
    try {
      const ext = activeVideoUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'mp4'
      const file = new File([blob], `trim.${ext}`, { type: blob.type })
      const hosted = await uploadServerAssetFile(file, label, { ownerNodeId: id })
      const url = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
      if (!url) throw new Error('上传失败：未获取到链接')
      updateNodeData(newNode.id, {
        videoUrl: url,
        videoResults: [{ url, title: label, thumbnailUrl: null, duration }],
        videoPrimaryIndex: 0,
        serverAssetId: hosted.id,
      })
      setNodeStatus(newNode.id, 'success', { progress: 100 })
      notifyAssetRefresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : '视频剪辑失败'
      setNodeStatus(newNode.id, 'error', { lastError: message })
      toast(message, 'error')
    }
  }, [addNode, id, nodeWidth, setNodeStatus, updateNodeData, videoResults, videoPrimaryIndex, videoUrl])

  const handleMaskConfirm = React.useCallback(async (maskBlob: Blob, prompt: string) => {
    setMaskMode(null)
    if (!primaryImageUrl) return
    const editableModel = resolveImageEditModelForAction('gpt-image-2')
    if (!editableModel) return
    const operationKind: ImageOperationKind = maskMode === 'erase' ? 'erase' : 'inpaint'
    let hostedSource: HostedEditedImageAsset
    let hostedMask: HostedEditedImageAsset
    try {
      const sourcePng = await createMaskEditSourcePng(primaryImageUrl)
      const uploadedAssets = await Promise.all([
        uploadEditedImageBlob({
          blob: sourcePng.blob,
          label: maskMode === 'erase' ? '擦除源图' : '重绘源图',
          filePrefix: maskMode === 'erase' ? 'erase-source' : 'repaint-source',
        }),
        uploadEditedImageBlob({
          blob: maskBlob,
          label: maskMode === 'erase' ? '擦除区域蒙版' : '重绘区域蒙版',
          filePrefix: maskMode === 'erase' ? 'erase-mask' : 'repaint-mask',
        }),
      ])
      hostedSource = uploadedAssets[0]
      hostedMask = uploadedAssets[1]
    } catch (error) {
      const message = error instanceof Error ? error.message : '独立蒙版上传失败'
      toast(message, 'error')
      return
    }
    const imageOperationSpec = createImageOperationForSource({
      kind: operationKind,
      execution: 'image-edit',
      sourceNodeId: id,
      sourceUrl: hostedSource.url,
      sourceAssetId: hostedSource.assetId,
      sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
      parameters: {
        maskPolarity: 'transparent-is-edit',
        preserveUnmaskedPixels: true,
        originalSourceUrl: primaryImageUrl,
        ...(maskMode === 'erase' ? { fillMode: 'context-aware-background' } : {}),
      },
      additionalInputs: [{
        role: 'mask',
        url: hostedMask.url,
        assetId: hostedMask.assetId,
        mimeType: 'image/png',
      }],
      output: { mediaType: 'image', count: 1 },
    })
    const beforeIds = new Set(useRFStore.getState().nodes.map(n => n.id))
    addNode('taskNode', maskMode === 'erase' ? '擦除' : '重绘', {
      kind: 'imageEdit',
      prompt,
      imageModel: editableModel,
      imageModelVendor: null,
      referenceImages: [hostedSource.url],
      maskUrl: hostedMask.url,
      maskAssetId: hostedMask.assetId,
      maskPolarity: 'transparent-is-edit',
      imageOperationSpec,
      imageOperationState: createImageOperationState(imageOperationSpec),
      imageOperationRevision: 1,
      libTvImageOperationKey: maskMode === 'erase' ? 'erase' : 'repaint',
    })
    const afterAdd = useRFStore.getState()
    const newNode = afterAdd.nodes.find(n => !beforeIds.has(n.id))
    if (!newNode) return
    const sourceNode = afterAdd.nodes.find(n => n.id === id)
    afterAdd.onNodesChange([{
      id: newNode.id, type: 'position' as const,
      position: { x: (sourceNode?.position?.x ?? 0) + nodeWidth + 80, y: sourceNode?.position?.y ?? 0 },
      dragging: false,
    }])
    afterAdd.onConnect({ source: id, sourceHandle: 'out-image', target: newNode.id, targetHandle: 'in-image' })
    runNodeDagToTarget(newNode.id, useRFStore.getState, useRFStore.setState, { concurrency: 1 })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : '生成失败', 'error'))
  }, [addNode, data, id, maskMode, nodeWidth, primaryImageUrl, resolveImageEditModelForAction, uploadEditedImageBlob])

  const handleElementEditConfirm = React.useCallback(async (submit: ElementEditSubmit) => {
    if (!primaryImageUrl) throw new Error('当前节点没有可编辑的真实图片资产')
    const editableModel = resolveImageEditModelForAction('gpt-image-2')
    if (!editableModel) throw new Error('当前没有可用的图片编辑模型')

    const sourcePng = await createMaskEditSourcePng(primaryImageUrl)
    const [hostedSource, hostedMask] = await Promise.all([
      uploadEditedImageBlob({
        blob: sourcePng.blob,
        label: submit.action === 'move' ? '元素移动源图' : '元素修改源图',
        filePrefix: submit.action === 'move' ? 'element-move-source' : 'element-edit-source',
      }),
      uploadEditedImageBlob({
        blob: submit.maskBlob,
        label: submit.action === 'move' ? '元素移动区域蒙版' : '元素修改区域蒙版',
        filePrefix: submit.action === 'move' ? 'element-move-mask' : 'element-edit-mask',
      }),
    ])
    const imageOperationSpec = createImageOperationForSource({
      kind: 'element_edit',
      execution: 'image-edit',
      sourceNodeId: id,
      sourceUrl: hostedSource.url,
      sourceAssetId: hostedSource.assetId,
      sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
      parameters: {
        action: submit.action,
        label: submit.label,
        selections: submit.selections,
        moveTarget: submit.moveTarget,
        maskPolarity: 'transparent-is-edit',
        preserveUnmaskedPixels: true,
        originalSourceUrl: primaryImageUrl,
      },
      additionalInputs: [{
        role: 'mask',
        url: hostedMask.url,
        assetId: hostedMask.assetId,
        mimeType: 'image/png',
      }],
      output: { mediaType: 'image', count: 1 },
    })
    const beforeIds = new Set(useRFStore.getState().nodes.map((node) => node.id))
    const outputLabel = submit.action === 'move' ? `移动·${submit.label}` : `修改·${submit.label}`
    addNode('taskNode', outputLabel, {
      kind: 'imageEdit',
      prompt: submit.prompt,
      imageModel: editableModel,
      imageModelVendor: null,
      referenceImages: [hostedSource.url],
      maskUrl: hostedMask.url,
      maskAssetId: hostedMask.assetId,
      maskPolarity: 'transparent-is-edit',
      imageOperationSpec,
      imageOperationState: createImageOperationState(imageOperationSpec),
      imageOperationRevision: 1,
      libTvImageOperationKey: 'element-edit',
      elementEditAction: submit.action,
      elementEditLabel: submit.label,
      elementEditSelectionCount: submit.selectionCount,
      elementEditSourceNodeId: id,
      elementEditMaskAssetId: hostedMask.assetId,
    })
    const afterAdd = useRFStore.getState()
    const newNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
    if (!newNode) throw new Error('元素编辑结果节点创建失败')
    const sourceNode = afterAdd.nodes.find((node) => node.id === id)
    afterAdd.onNodesChange([{
      id: newNode.id,
      type: 'position' as const,
      position: {
        x: (sourceNode?.position?.x ?? 0) + nodeWidth + 80,
        y: sourceNode?.position?.y ?? 0,
      },
      dragging: false,
    }])
    afterAdd.onConnect({ source: id, sourceHandle: 'out-image', target: newNode.id, targetHandle: 'in-image' })
    afterAdd.clearPendingFocusNodeId()
    setElementEditOpen(false)
    runNodeDagToTarget(newNode.id, useRFStore.getState, useRFStore.setState, { concurrency: 1 }).catch((error: unknown) => {
      toast(error instanceof Error ? error.message : '元素编辑生成失败', 'error')
    })
  }, [addNode, data, id, nodeWidth, primaryImageUrl, resolveImageEditModelForAction, uploadEditedImageBlob])

  const handleAnnotateSave = React.useCallback(async (blob: Blob) => {
    try {
      const hosted = await uploadEditedImageBlob({ blob, label: '标注', filePrefix: 'annotate' })
      if (!primaryImageUrl) throw new Error('当前节点没有可标注的真实图片资产')
      const imageOperationSpec = createImageOperationForSource({
        kind: 'annotate',
        execution: 'local-transform',
        sourceNodeId: id,
        sourceUrl: primaryImageUrl,
        sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
        parameters: { flattenedAnnotation: true, preserveSourceResolution: true },
      })
      const newNodeId = addConnectedHostedImageNode('标注', hosted, 'out-image', imageOperationSpec)
      if (!newNodeId) throw new Error('标注节点创建失败')
      setAnnotateOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : '标注上传失败'
      toast(message, 'error')
    }
  }, [addConnectedHostedImageNode, data, id, primaryImageUrl, uploadEditedImageBlob])

  const handleHdApply = React.useCallback((scale: 2 | 4) => {
    if (!primaryImageUrl || hdLoading) return
    const editableModel = resolveImageEditModelForAction('gpt-image-2')
    if (!editableModel) return
    setHdLoading(true)
    setHdPanelOpen(false)
    const targetResolution = scale === 4 ? '4K' : '2K'
    const imageOperationSpec = createImageOperationForSource({
      kind: 'upscale',
      execution: 'image-edit',
      sourceNodeId: id,
      sourceUrl: primaryImageUrl,
      sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
      parameters: {
        scale,
        targetResolution,
        preserveComposition: true,
        preserveText: true,
        repairCompressionArtifacts: true,
      },
    })
    const beforeIds = new Set(useRFStore.getState().nodes.map(n => n.id))
    addNode('taskNode', `高清 ${scale}×`, {
      kind: 'imageEdit',
      prompt: `将图片进行${scale}倍高清放大，保持画面细节锐利清晰`,
      imageModel: editableModel,
      imageModelVendor: null,
      referenceImages: [primaryImageUrl],
      imageSize: targetResolution,
      imageResolution: targetResolution,
      resolution: targetResolution,
      imageOperationSpec,
      imageOperationState: createImageOperationState(imageOperationSpec),
      imageOperationRevision: 1,
      libTvImageOperationKey: 'upscale',
    })
    const afterAdd = useRFStore.getState()
    const newNode = afterAdd.nodes.find(n => !beforeIds.has(n.id))
    if (!newNode) { setHdLoading(false); return }
    const sourceNode = afterAdd.nodes.find(n => n.id === id)
    afterAdd.onNodesChange([{
      id: newNode.id, type: 'position' as const,
      position: { x: (sourceNode?.position?.x ?? 0) + nodeWidth + 80, y: sourceNode?.position?.y ?? 0 },
      dragging: false,
    }])
    afterAdd.onConnect({ source: id, sourceHandle: 'out-image', target: newNode.id, targetHandle: 'in-image' })
    runNodeDagToTarget(newNode.id, useRFStore.getState, useRFStore.setState, { concurrency: 1 })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : '高清生成失败', 'error'))
      .finally(() => setHdLoading(false))
  }, [addNode, data, hdLoading, id, nodeWidth, primaryImageUrl, resolveImageEditModelForAction])

  const handleEmotionApply = React.useCallback(async (request: EmotionApplyRequest) => {
    const sourceImageUrl = String(primaryImageUrl || basePoseImage || '').trim()
    if (!sourceImageUrl) throw new Error('当前节点没有可用于情绪调节的真实图片资产')
    if (!emotionSelection) throw new Error('请先选择要调节情绪的人物')
    if (emotionLoading) return
    const editableModel = resolveImageEditModelForAction('gpt-image-2')
    if (!editableModel) return
    setEmotionLoading(true)
    setEmotionError(null)
    try {
      const sourcePng = await createMaskEditSourcePng(sourceImageUrl)
      const roleCropBlob = await cropImageBlobToNormalizedRect({
        imageBlob: sourcePng.blob,
        rect: emotionSelection.rect,
      })
      const faceBoundingBox = normalizedRectToPixelBoundingBox({
        rect: emotionSelection.rect,
        imageWidth: emotionSelection.imageWidth,
        imageHeight: emotionSelection.imageHeight,
      })
      const [hostedSource, hostedRole, hostedMask] = await Promise.all([
        uploadEditedImageBlob({
          blob: sourcePng.blob,
          label: '情绪调节源图',
          filePrefix: 'emotion-source',
        }),
        uploadEditedImageBlob({
          blob: roleCropBlob,
          label: '情绪调节人物参考图',
          filePrefix: 'emotion-role',
        }),
        uploadEditedImageBlob({
          blob: emotionSelection.maskBlob,
          label: '情绪调节人物蒙版',
          filePrefix: 'emotion-mask',
        }),
      ])
      const { cell, resolution, sampleCount: emotionSampleCount } = request
      const executionPrompt = buildLibTvEmotionPrompt({ expression: cell.zh, faceBoundingBox })
      const imageOperationSpec = createImageOperationForSource({
        kind: 'emotion_adjust',
        execution: 'image-edit',
        sourceNodeId: id,
        sourceUrl: hostedSource.url,
        sourceAssetId: hostedSource.assetId,
        sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
        parameters: {
          scene: 'expression_adjustment',
          modeType: 'image2image',
          selectedExpression: [cell.zh],
          faceList: [faceBoundingBox],
          prompt: executionPrompt,
          x: cell.x,
          y: cell.y,
          label: cell.zh,
          expressionDescription: cell.cn,
          resolution,
          sampleCount: emotionSampleCount,
          selectionSource: emotionSelection.source,
          selectionRect: emotionSelection.rect,
          preserveIdentity: true,
          preserveHair: true,
          preserveClothing: true,
          preservePose: true,
          preserveComposition: true,
          faceOnly: true,
          maskPolarity: 'transparent-is-edit',
          originalSourceUrl: sourceImageUrl,
        },
        additionalInputs: [
          {
            role: 'reference',
            url: hostedRole.url,
            assetId: hostedRole.assetId,
            mimeType: 'image/png',
          },
          {
            role: 'mask',
            url: hostedMask.url,
            assetId: hostedMask.assetId,
            mimeType: 'image/png',
            width: emotionSelection.imageWidth,
            height: emotionSelection.imageHeight,
          },
        ],
      })
      const beforeIds = new Set(useRFStore.getState().nodes.map((node) => node.id))
      addNode('taskNode', `情绪·${cell.zh}`, {
        kind: 'imageEdit',
        prompt: executionPrompt,
        imageModel: editableModel,
        imageModelVendor: null,
        referenceImages: [hostedSource.url, hostedRole.url],
        maskUrl: hostedMask.url,
        imageSize: resolution,
        imageResolution: resolution,
        sampleCount: emotionSampleCount,
        emotionSelectionRect: emotionSelection.rect,
        emotionSelectionSource: emotionSelection.source,
        emotionMaskAssetId: hostedMask.assetId,
        emotionRoleAssetId: hostedRole.assetId,
        emotionFaceBoundingBox: faceBoundingBox,
        imageOperationSpec,
        imageOperationState: createImageOperationState(imageOperationSpec),
        imageOperationRevision: 1,
        libTvImageOperationKey: 'emotion-adjust',
      })
      const afterAdd = useRFStore.getState()
      const newNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
      if (!newNode) throw new Error('情绪调节结果节点创建失败')
      const sourceNode = afterAdd.nodes.find((node) => node.id === id)
      afterAdd.onNodesChange([
        {
          id: newNode.id,
          type: 'position' as const,
          position: { x: (sourceNode?.position?.x ?? 0) + nodeWidth + 80, y: sourceNode?.position?.y ?? 0 },
          dragging: false,
        },
        { id, type: 'select' as const, selected: false },
        { id: newNode.id, type: 'select' as const, selected: true },
      ])
      afterAdd.onConnect({ source: id, sourceHandle: 'out-image', target: newNode.id, targetHandle: 'in-image' })
      setEmotionPanelOpen(false)
      await runNodeDagToTarget(newNode.id, useRFStore.getState, useRFStore.setState, { concurrency: 1 })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '情绪图生成失败'
      setEmotionError(message)
      toast(message, 'error')
    } finally {
      setEmotionLoading(false)
    }
  }, [addNode, basePoseImage, data, emotionLoading, emotionSelection, id, nodeWidth, primaryImageUrl, resolveImageEditModelForAction, uploadEditedImageBlob])

  const handleExpandApply = React.useCallback(async (scale: number) => {
    if (!primaryImageUrl || expandLoading) return
    const editableModel = resolveImageEditModelForAction('gpt-image-2')
    if (!editableModel) return
    setExpandLoading(true)
    setExpandPanelOpen(false)
    try {
      const assets = await createCenteredOutpaintAssets(primaryImageUrl, scale)
      const [hostedExpandedSource, hostedMask] = await Promise.all([
        uploadEditedImageBlob({
          blob: assets.expandedSourceBlob,
          label: `扩图 ${scale}× 底图`,
          filePrefix: 'outpaint-source',
        }),
        uploadEditedImageBlob({
          blob: assets.maskBlob,
          label: `扩图 ${scale}× 蒙版`,
          filePrefix: 'outpaint-mask',
        }),
      ])
      const imageOperationSpec = createImageOperationForSource({
        kind: 'outpaint',
        execution: 'image-edit',
        sourceNodeId: id,
        sourceUrl: hostedExpandedSource.url,
        sourceRevision: readImageOperationSourceRevision((data as Record<string, unknown>).imageOperationRevision),
        sourceAssetId: hostedExpandedSource.assetId,
        parameters: {
          scale,
          anchor: 'center',
          sourceRect: {
            x: assets.offsetX,
            y: assets.offsetY,
            width: assets.sourceWidth,
            height: assets.sourceHeight,
          },
          targetSize: { width: assets.targetWidth, height: assets.targetHeight },
          maskPolarity: 'transparent-is-edit',
          preserveSourcePixels: true,
        },
        additionalInputs: [
          { role: 'mask', url: hostedMask.url, assetId: hostedMask.assetId, mimeType: 'image/png' },
          { role: 'reference', url: primaryImageUrl, nodeId: id },
        ],
      })
      const beforeIds = new Set(useRFStore.getState().nodes.map(n => n.id))
      addNode('taskNode', `扩图 ${scale}×`, {
        kind: 'imageEdit',
        prompt: `在完整保留中央原图像素、主体身份、构图、透视和光线的前提下，自然补全四周新增区域；新增内容与原画连续，不拉伸、不复制主体。`,
        imageModel: editableModel,
        imageModelVendor: null,
        referenceImages: [hostedExpandedSource.url],
        maskUrl: hostedMask.url,
        maskAssetId: hostedMask.assetId,
        imageEditSize: `${assets.targetWidth}x${assets.targetHeight}`,
        imageOperationSpec,
        imageOperationState: createImageOperationState(imageOperationSpec),
        imageOperationRevision: 1,
        libTvImageOperationKey: 'outpaint',
      })
      const afterAdd = useRFStore.getState()
      const newNode = afterAdd.nodes.find(n => !beforeIds.has(n.id))
      if (!newNode) throw new Error('扩图结果节点创建失败')
      const sourceNode = afterAdd.nodes.find(n => n.id === id)
      afterAdd.onNodesChange([{
        id: newNode.id, type: 'position' as const,
        position: { x: (sourceNode?.position?.x ?? 0) + nodeWidth + 80, y: sourceNode?.position?.y ?? 0 },
        dragging: false,
      }])
      afterAdd.onConnect({ source: id, sourceHandle: 'out-image', target: newNode.id, targetHandle: 'in-image' })
      await runNodeDagToTarget(newNode.id, useRFStore.getState, useRFStore.setState, { concurrency: 1 })
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '扩图生成失败', 'error')
    } finally {
      setExpandLoading(false)
    }
  }, [addNode, data, expandLoading, id, nodeWidth, primaryImageUrl, resolveImageEditModelForAction, uploadEditedImageBlob])

  const shellOutline = 'none'
  const subtitle = schema.label || defaultLabel
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
  const toolbarMetaActions: ToolbarMetaAction[] = [
    ...(isPanoramic && panoramicSphereMode
      ? [
          { key: 'pano-exit', label: '退出球形', icon: <IconArrowNarrowLeft size={18} />, onClick: () => setPanoramicSphereMode(false) },
          { key: 'pano-screenshot', label: '截图', icon: <IconScreenshot size={16} />, onClick: handlePanoramicScreenshot },
          { key: 'pano-4view', label: '4视角', icon: <IconFocusCentered size={16} />, onClick: () => handlePanoramicMultiView(4) },
          { key: 'pano-12view', label: '12视角', icon: <IconLayoutGrid size={16} />, onClick: () => handlePanoramicMultiView(12) },
          { key: 'pano-grid', label: panoramicGridVisible ? '隐藏网格' : '显示网格', icon: <IconGrid3x3 size={16} />, active: panoramicGridVisible, onClick: () => updateNodeData(id, { panoramicGridVisible: !panoramicGridVisible }) },
          { key: 'pano-fullscreen', label: '全屏预览', icon: <IconMaximize size={16} />, onClick: () => setPanoramicFullscreenOpen(true) },
          { key: 'pano-reset', label: '重置视角', icon: <IconRefresh size={16} />, onClick: () => updateNodeData(id, { panoramicCamera: PANORAMIC_DEFAULT_CAMERA }) },
        ] satisfies ToolbarMetaAction[]
      : []),
    ...(isNovelStoryboardNode
      ? [
          {
            key: 'novel-storyboard-next-chunk',
            label: novelStoryboardCanGenerateNext ? '继续下一组 25 镜' : '先完成本组画面与元数据',
            icon: <IconSparkles size={16} />,
            onClick: () => { void handleGenerateNovelStoryboardNextChunk() },
            loading: novelStoryboardContinueLoading,
            disabled: !novelStoryboardCanGenerateNext || novelStoryboardContinueLoading,
            showLabel: true,
          },
        ] satisfies ToolbarMetaAction[]
      : []),
  ]

  const visibleDefs = uniqueDefs

  // 暗色主题用科技灰，与左侧资产抽屉（.asset-manager-drawer）背景渐变完全一致，
  // 让节点卡片从近黑画布背景中区分出来。
  const shellBackground = isDarkUi
    ? 'linear-gradient(180deg, rgba(24,24,27,0.98), rgba(18,18,21,0.98))'
    : 'rgba(255,255,255,0.98)'
  const shellBorder = isDarkUi ? '1px solid rgba(255,255,255,0.07)' : nodeShellBorder
  const resolvedShellBorder = isStructuredWorkflowNode && selected
    ? '1px solid var(--tc-color-border-strong, rgba(198, 203, 211, 0.42))'
    : shellBorder
  const draftBorderOverride: React.CSSProperties = draftByAgent
    ? {
        border: '2px dashed rgba(255, 196, 0, 0.7)',
        filter: 'saturate(0.75)',
      }
    : {}
  // 审核失败（内容审核未通过 / ARK 拒绝）：整节点标红，方便在画布上一眼定位。
  // 两种来源：①本节点任务因审核报错(status=error)；②本图作为视频参考图被 ARK 拒，
  // 服务端把 moderationRejected 标到图片节点 data 上（此时节点本身仍是 success 的图）。
  const moderationFailed =
    Boolean((data as any)?.moderationRejected) ||
    isModerationFailure(status, (data as any)?.lastError)
  const moderationBorderOverride: React.CSSProperties = moderationFailed
    ? {
        border: '2px solid #ef4444',
        boxShadow: '0 0 0 1px rgba(239,68,68,0.45), 0 12px 32px rgba(239,68,68,0.28)',
      }
    : {}
  const shellShadowResolved = isStructuredWorkflowNode && selected
    ? '0 0 0 1px rgba(238, 240, 244, 0.08), 0 12px 28px rgba(0, 0, 0, 0.24)'
    : isDarkUi ? 'none' : nodeShellShadow
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
  const textEditorRef = React.useRef<HTMLDivElement>(null)
  const textComposingRef = React.useRef(false)
  const textResizeRequestedRef = React.useRef(false)
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
  // TEXT_COLOR_PRESETS and TEXT_BG_PRESETS imported from constants
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
  const textBackgroundTint = withTextNodeAlpha(textBackgroundColor, 0.125)
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
    // 聚焦只负责把轻量只读壳切换为编辑能力，不能顺带改变节点几何。
    // 文本尺寸测量仅响应本轮真实编辑；这与 libTv 媒体节点的“聚焦不跳尺寸”合同一致。
    if (!textResizeRequestedRef.current) return
    textResizeRequestedRef.current = false
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
    textResizeRequestedRef.current = true
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
  const modelCatalogNotice = !viewOnly && (hasModelSelect || isAudioNode) && (
    modelListError || (!modelListLoading && Boolean(activeModelKey) && !selectedActiveModelOption)
  ) ? (
    <Group className="tc-task-node__model-catalog-notice" gap={6} wrap="nowrap">
      <Text className="tc-task-node__model-catalog-notice-text" size="xs" c="red">
        {modelListError
          ? `模型目录加载失败：${modelListError.message}`
          : `模型 ${activeModelKey} 当前不可用，请重新选择`}
      </Text>
      {modelListError ? (
        <ActionIcon
          className="tc-task-node__model-catalog-retry"
          aria-label="重新加载模型目录"
          size="xs"
          variant="subtle"
          color="red"
          onClick={retryModelList}
        >
          <IconRefresh className="tc-task-node__model-catalog-retry-icon" size={13} />
        </ActionIcon>
      ) : null}
    </Group>
  ) : null
  const controlChipsNode = !isPlainTextNode ? (
    <LazyControlChips
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
        // 同步 imageResolution / resolution，否则 buildImageBillingSpecKeyForOption
        // 优先读 imageResolution，导致切换分辨率时 spec key 不更新、积分显示僵在初值。
        setImageResolution(value)
        updateNodeData(id, { imageSize: value, imageResolution: value, resolution: value })
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
      showRunCountMenu={isVideoNode || coreKind === 'image'}
      runCount={runCount}
      onRunCountChange={(value) => {
        setRunCount(value)
        updateNodeData(id, { runCount: value })
      }}
      mappedControls={isVideoNode ? mappedVideoControls : isAudioNode ? mappedAudioControls : mappedImageControls}
      showStyleChip={showStyleChip}
      styleImageCount={styleImages.length}
      onStyleClick={() => setStyleImagePickerOpen(true)}
      onStyleClear={handleStyleClear}
      showCameraChip={showCameraChip}
      cameraChipLabel={cameraChipLabel}
      cameraChipActive={!!imageCinematicCamera?.enabled}
      cameraChipOpen={cameraControlOpen}
      onCameraChipChange={setCameraControlOpen}
      onCameraClear={handleCameraClear}
      cameraChipContent={
        <LazyCameraControlPanel
          value={imageCinematicCamera}
          onChange={handleCinematicCameraChange}
          onClose={() => setCameraControlOpen(false)}
        />
      }
      presetLibrary={
        isImageNode && hasImageResults && !isPanoramic
          ? (
              <LazyLibTvPresetLibrary
                onSelect={handleSelectLibTvPreset}
                disabled={isRunning || viewOnly}
                characterFissionEnabled={isCharacterReferenceNode && Boolean(primaryImageUrl)}
              />
            )
          : null
      }
      isCharacterNode={isCharacterNode}
      isRunning={isRunning}
      smartAction={smartVideoPromptAction}
      requiredCreditsLabel={requiredCreditsLabel}
      onCancelRun={handleCancelRun}
      onRun={runNode}
      onTranslate={handleTranslatePrompt}
      translateLoading={translatePromptLoading}
      show3dChip={isImageNode}
      on3dClick={() => setShow3dPanel(true)}
      showEnhanceChip={isVideoNode}
      onEnhanceClick={() => setShowEnhancePanel(true)}
    />
  ) : null
  const mediaFocusControlChipsNode = useMediaFocusToolbar && !isPlainTextNode ? (
    <LazyControlChips
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
        // 同步 imageResolution / resolution，否则 buildImageBillingSpecKeyForOption
        // 优先读 imageResolution，导致切换分辨率时 spec key 不更新、积分显示僵在初值。
        setImageResolution(value)
        updateNodeData(id, { imageSize: value, imageResolution: value, resolution: value })
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
      showRunCountMenu={isVideoNode || coreKind === 'image'}
      runCount={runCount}
      onRunCountChange={(value) => {
        setRunCount(value)
        updateNodeData(id, { runCount: value })
      }}
      mappedControls={isVideoNode ? mappedVideoControls : isAudioNode ? mappedAudioControls : mappedImageControls}
      showStyleChip={false}
      styleImageCount={styleImages.length}
      onStyleClick={() => setStyleImagePickerOpen(true)}
      onStyleClear={handleStyleClear}
      showCameraChip={showCameraChip}
      cameraChipLabel={cameraChipLabel}
      cameraChipActive={!!imageCinematicCamera?.enabled}
      cameraChipOpen={cameraControlOpen}
      onCameraChipChange={setCameraControlOpen}
      onCameraClear={handleCameraClear}
      cameraChipContent={
        <LazyCameraControlPanel
          value={imageCinematicCamera}
          onChange={handleCinematicCameraChange}
          onClose={() => setCameraControlOpen(false)}
        />
      }
      presetLibrary={
        isImageNode && !isPanoramic
          ? (
              <LazyLibTvPresetLibrary
                onSelect={handleSelectLibTvPreset}
                disabled={isRunning || viewOnly}
                characterFissionEnabled={isCharacterReferenceNode && Boolean(primaryImageUrl)}
              />
            )
          : null
      }
      isCharacterNode={isCharacterNode}
      isRunning={isRunning}
      smartAction={smartVideoPromptAction}
      requiredCreditsLabel={requiredCreditsLabel}
      onCancelRun={handleCancelRun}
      onRun={runNode}
      onTranslate={handleTranslatePrompt}
      translateLoading={translatePromptLoading}
      show3dChip={false}
      on3dClick={() => setShow3dPanel(true)}
      showEnhanceChip={false}
      onEnhanceClick={() => setShowEnhancePanel(true)}
      generationSettings={mediaGenerationSettings}
    />
  ) : null
  const showVeoImageControls = Boolean(isVideoNode && resolvedVideoVendor === 'veo')
  const showMediaFocusSettings = Boolean(
    useMediaFocusToolbar
      && (
        showVeoImageControls
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
                <Badge className="tc-task-node__media-focus-settings-badge" size="xs" color="gray">
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
                        <ManagedImage
                          className="tc-task-node__media-focus-settings-preview-image nodrag nopan"
                          src={trimmedFirstFrameUrl}
                          alt="首帧"
                          priority="visible"
                          ownerNodeId={id}
                          ownerSurface="task-node-candidate"
                          ownerRequestKey={`task-node-video-first-frame:${id}:${trimmedFirstFrameUrl}`}
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
                        <ManagedImage
                          className="tc-task-node__media-focus-settings-preview-image nodrag nopan"
                          src={trimmedLastFrameUrl}
                          alt="尾帧"
                          priority="visible"
                          ownerNodeId={id}
                          ownerSurface="task-node-candidate"
                          ownerRequestKey={`task-node-video-last-frame:${id}:${trimmedLastFrameUrl}`}
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
      className={[
        'tc-task-node',
        isWorkflowStageNode || isWorkflowTriggerNode ? 'tc-task-node--workflow' : '',
        isPlainTextNode ? 'tc-task-node--plain-text' : '',
      ].filter(Boolean).join(' ')}
      data-workflow-kind={isWorkflowStageNode ? 'stage' : isWorkflowTriggerNode ? 'trigger' : undefined}
      data-workflow-selected={isStructuredWorkflowNode ? selected : undefined}
      data-aspect-transitioning={isAspectTransitioning || undefined}
      onClick={isWorkflowStageNode || isWorkflowTriggerNode
        ? (event) => {
            event.stopPropagation()
            useWorkflowNodeInspectorStore.getState().openNode(id)
          }
        : undefined}
      style={{
        position: 'relative',
        boxSizing: 'border-box',
        width: isResizableVisualNode ? nodeWidth : nodeWidth + 2 * HANDLE_HORIZONTAL_OFFSET,
        paddingLeft: isResizableVisualNode ? 0 : HANDLE_HORIZONTAL_OFFSET,
        paddingRight: isResizableVisualNode ? 0 : HANDLE_HORIZONTAL_OFFSET,
        ...(isPlainTextNode && textNodeHeight ? { height: textNodeHeight } : null),
        ...(isResizableVisualNode && nodeHeight ? { height: nodeHeight } : null),
      } as React.CSSProperties}
    >
      {(isImageNode || isAudioNode || isVideoNode) && (
        <div
          className="tc-task-node__image-meta-bar nodrag"
          style={{
            position: 'absolute',
            top: -30,
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            height: 24,
            minHeight: 24,
            pointerEvents: 'auto',
            userSelect: 'none',
          }}
        >
          <div
            className="tc-task-node__image-meta-bar-label"
            style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}
          >
            <NodeIcon size={13} style={{ flexShrink: 0, opacity: 0.55 }} />
            {editing ? (
              <TextInput
                className="tc-task-node__image-meta-bar-input nodrag"
                ref={labelInputRef}
                size="xs"
                value={labelDraft}
                autoFocus
                onChange={(e) => setLabelDraft(e.currentTarget.value)}
                onBlur={commitLabel}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitLabel() }
                  else if (e.key === 'Escape') { setLabelDraft(currentLabel); setEditing(false) }
                }}
                styles={{ input: { fontSize: 12, padding: '2px 6px', height: 24, minHeight: 24 } }}
                style={{ flex: 1, minWidth: 0 }}
              />
            ) : (
              <Text
                className="tc-task-node__image-meta-bar-name"
                size="xs"
                style={{
                  fontSize: 12,
                  lineHeight: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  cursor: nodeReadOnly ? 'default' : 'text',
                }}
                onDoubleClick={() => { if (!nodeReadOnly) setEditing(true) }}
              >
                {currentLabel}
              </Text>
            )}
          </div>
          {mediaNaturalSize && (
            <Text
              className="tc-task-node__image-meta-bar-dimensions"
              size="xs"
              style={{
                fontSize: 12,
                lineHeight: 1,
                flexShrink: 0,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {mediaNaturalSize.width} × {mediaNaturalSize.height}
            </Text>
          )}
        </div>
      )}
      <div
        className={'tc-task-node__card' + (isWorkflowStageNode || isWorkflowTriggerNode ? ' tc-task-node__card--workflow' : '')}
        onPointerDownCapture={blurActiveEditableElement}
        style={{
          border: (isImageNode && hasPrimaryImage) || isPlainTextNode ? 'none' : resolvedShellBorder,
          ...draftBorderOverride,
          borderRadius: isStructuredWorkflowNode ? 10 : 12,
          padding: shellPadding,
          // 普通文本节点去掉多余外框背景：内层文本面板自带底色，外壳保持透明，工具/标题贴在其上方
          background: (isImageNode && hasPrimaryImage) || isPlainTextNode ? 'transparent' : shellBackground,
          color: nodeShellText,
          boxShadow: (isImageNode && hasPrimaryImage) || isPlainTextNode ? 'none' : shellShadowResolved,
          backdropFilter: shellBackdrop,
          transition: 'box-shadow 180ms ease',
          position: 'relative',
          outline: shellOutline,
          boxSizing: 'border-box',
          display: isPlainTextNode || isVideoNode || isStructuredWorkflowNode ? 'flex' : undefined,
          flexDirection: isPlainTextNode || isVideoNode || isStructuredWorkflowNode ? 'column' : undefined,
          width: '100%',
          maxWidth: isResizableVisualNode ? undefined : 720,
          ...(isPlainTextNode && textNodeHeight ? { height: '100%' } : null),
          ...(isResizableVisualNode && nodeHeight ? { height: '100%' } : null),
          // 审核失败标红需覆盖上面的 border/boxShadow（含图片节点的 none），放最后生效
          ...moderationBorderOverride,
        } as React.CSSProperties}
      >
      {draftByAgent && !showGenerationOverlay && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            useRFStore.getState().updateNodeData(id, { draftByAgent: false })
            runNode()
          }}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            background: 'rgba(255, 196, 0, 0.9)',
            color: '#000',
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 4,
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            zIndex: 1,
          }}
        >
          AI 规划 · 点击生成
        </button>
      )}
      <GenerationOverlay
        visible={showGenerationOverlay}
        status={status}
        progress={(data as any)?.progress}
        label={isVideoAnalysisNode && status === 'running' ? '视频分析中' : undefined}
      />
      {isImageNode && show3dPanel && (
        <LazyImage3DPanel onRun={handleRun3d} onClose={() => setShow3dPanel(false)} />
      )}
      {isVideoNode && showEnhancePanel && (
        <LazyVideoEnhancePanel onRun={handleRunEnhance} onClose={() => setShowEnhancePanel(false)} />
      )}
      {isImageNode && (data as any)?.model3dUrl && (data as any)?.model3dView && (
        <LazyModel3DOverlay modelUrl={(data as any).model3dUrl} visible />
      )}
      {isImageNode && (data as any)?.model3dUrl && (
        <button
          type="button"
          className="tc-task-node__view-toggle"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            zIndex: 6,
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 8,
            border: 'none',
            background: 'rgba(17,18,21,0.7)',
            color: '#fff',
            cursor: 'pointer',
          }}
          onClick={() => updateNodeData(id, { model3dView: !(data as any).model3dView })}
        >
          {(data as any).model3dView ? '看图片' : '看 3D'}
        </button>
      )}
      {imagePresetConfirmKey && (() => {
        const preset = findLibTvImagePreset(imagePresetConfirmKey)
        if (!preset) return null
        if (preset.execution === 'character-fission') {
          return (
            <LazyCharacterFissionEditorPortal
              nodeId={id}
              nodeWidth={nodeWidth}
              nodeHeight={nodeHeight ?? undefined}
              defaultHeight={visualNodeDefaults.height}
              requiredGenerationCredits={characterFissionCreditsPerVariant}
              onClose={() => setImagePresetConfirmKey(null)}
              onExecute={handleCharacterFissionExecute}
            />
          )
        }
        return (
          <ImagePresetConfirmPortal
            preset={preset}
            nodeId={id}
            nodeWidth={nodeWidth}
            nodeHeight={nodeHeight ?? undefined}
            defaultHeight={visualNodeDefaults.height}
            requiredGenerationCredits={requiredGenerationCredits}
            onClose={() => setImagePresetConfirmKey(null)}
            onExecute={handleImagePresetExecute}
          />
        )
      })()}
      {panoramicConfirm && (
        <PanoramicConfirmPortal
          nodeId={id}
          nodeWidth={nodeWidth}
          nodeHeight={nodeHeight ?? undefined}
          defaultHeight={visualNodeDefaults.height}
          panoramicCredits={panoramicCredits}
          onClose={() => setPanoramicConfirm(false)}
          onExecute={() => { setPanoramicConfirm(false); void handleGeneratePanoramic() }}
        />
      )}
      {!hideImageMeta && !isCanvasMediaNode && !isStoryboardEditorNode && !isWorkflowStageNode && !isWorkflowTriggerNode && (
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
          titleBadge={productionMetadata || sbaPresentation ? (
            <span className="tc-task-node__title-badges" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {productionMetadata ? <ChapterGroundedBadge metadata={productionMetadata} /> : null}
              {sbaPresentation ? (
                <Badge
                  className="tc-task-node__sba-selection-badge"
                  size="xs"
                  radius="md"
                  color={sbaPresentation.nodeStatus === 'archived' ? 'gray' : sbaPresentation.selectionStatus === 'selected' ? 'teal' : 'gray'}
                  variant={sbaPresentation.nodeStatus === 'archived' ? 'outline' : 'light'}
                >
                  {sbaPresentation.nodeStatus === 'archived'
                    ? '非正史'
                    : sbaPresentation.selectionStatus === 'selected'
                      ? '已选择'
                      : sbaPresentation.selectionStatus === 'superseded'
                        ? '已替代'
                        : '候选'}
                </Badge>
              ) : null}
              {sbaPresentation && sbaPresentation.basisStatus !== 'current' ? (
                <Badge
                  className="tc-task-node__sba-basis-badge"
                  size="xs"
                  radius="md"
                  color={sbaPresentation.basisStatus === 'stale' ? 'yellow' : 'gray'}
                  variant="outline"
                >
                  {sbaPresentation.basisStatus === 'stale' ? '正史已变化' : '来源未核验'}
                </Badge>
              ) : null}
            </span>
          ) : undefined}
          trailingContent={textIntentActions ?? imageDimensionTrailing}
          showMeta={false}
          showIcon={isPlainTextNode}
          showStatus={false}
          onLabelDraftChange={setLabelDraft}
          onCommitLabel={commitLabel}
          onCancelEdit={() => {
            setLabelDraft(currentLabel)
            setEditing(false)
          }}
          onStartEdit={() => {
            if (nodeReadOnly) return
            setEditing(true)
          }}
          labelInputRef={labelInputRef}
        />
      )}
      <TopToolbar
        isVisible={isSingleSelectionActive && !gridSplitOpen && !anyImageEditorOpen}
        hasContent={hasContent}
        hasGenerationContext={hasGenerationContext}
        toolbarBackground={toolbarBackground}
        toolbarShadow={toolbarShadow}
        toolbarActionIconStyles={toolbarActionIconStyles}
        inlineDividerColor={inlineDividerColor}
        visibleDefs={visibleDefs}
        extraActions={toolbarMetaActions}
        toolbarOffset={isImageNode ? 0 : undefined}
        hideUtilButtons={isPanoramic}
        utilitiesAtEnd={isImageNode || isVideoNode}
        libtvVideoMode={isVideoNode}
        libtvImageMode={isImageNode && !isPanoramic}
        onPreview={handlePreview}
        onDownload={() => { void handleDownload() }}
        downloading={toolbarDownloading}
      />

      {/* Grid split mode toolbar — always visible while grid split is open */}
      {gridSplitOpen && !isPanoramic && (
        <NodeToolbar
          className="tc-grid-split-toolbar nodrag nopan"
          isVisible={true}
          position={Position.Top}
          align="center"
          offset={42}
        >
          <div
            className="tc-grid-split-toolbar__content"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 999,
              background: toolbarBackground,
              boxShadow: toolbarShadow,
              maxWidth: 'min(92vw, 900px)',
            }}
          >
            {/* Back */}
            <button
              onClick={() => setGridSplitOpen(false)}
              style={{
                width: 30, height: 30, borderRadius: 8, border: 'none',
                background: 'var(--mantine-color-dark-6)', color: 'var(--mantine-color-gray-3)',
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              <IconArrowNarrowLeft size={16} />
            </button>

            <div style={{ width: 1, height: 20, background: inlineDividerColor, flexShrink: 0 }} />
            <IconLayoutGrid size={15} style={{ color: 'var(--mantine-color-gray-5)', flexShrink: 0 }} />

            {/* Status */}
            <span style={{
              fontSize: 13,
              color: gridSplitSelectedCells.size > 0 ? nodeShellText : 'var(--mantine-color-gray-5)',
              minWidth: 120, flexShrink: 0,
            }}>
              {gridSplitSelectedCells.size > 0 ? `已选 ${gridSplitSelectedCells.size} 个宫格` : '请选择宫格进行操作'}
            </span>

            <div style={{ width: 1, height: 20, background: inlineDividerColor, flexShrink: 0 }} />

            {/* Create nodes */}
            <Tooltip label="创建生图节点" position="bottom" withArrow>
              <ActionIcon
                variant="subtle"
                size="sm"
                disabled={!gridSplitSelectedCells.size || gridSplitCreating || gridSplitCreatingHD}
                loading={gridSplitCreating}
                onClick={() => { void handleGridSplitCreateOverlay() }}
              >
                <IconApps size={15} />
              </ActionIcon>
            </Tooltip>

            {/* HD generate */}
            <Tooltip label="生成高清图片" position="bottom" withArrow>
              <ActionIcon
                variant="subtle"
                size="sm"
                disabled={!gridSplitSelectedCells.size || gridSplitCreating || gridSplitCreatingHD}
                loading={gridSplitCreatingHD}
                onClick={() => { void handleGridSplitHDOverlay() }}
              >
                <IconPhotoSpark size={15} />
              </ActionIcon>
            </Tooltip>

            {/* Scale selector */}
            <select
              value={gridSplitScale}
              onChange={(e) => setGridSplitScale(Number(e.target.value))}
              style={{
                background: 'var(--mantine-color-dark-5)', color: nodeShellText,
                border: 'none', borderRadius: 8, padding: '5px 10px', fontSize: 13, cursor: 'pointer',
              }}
            >
              <option value={2}>2倍</option>
              <option value={4}>4倍</option>
            </select>
          </div>
        </NodeToolbar>
      )}

      {/* ── HD 面板 ── */}
      {hdPanelOpen ? (
        <LazyHdUpscalePanel
          isOpen
          isDarkUi={isDarkUi}
          inlineDividerColor={inlineDividerColor}
          onClose={() => setHdPanelOpen(false)}
          onApply={handleHdApply}
          loading={hdLoading}
        />
      ) : null}

      {/* ── 情绪调节面板 ── */}
      {emotionPanelOpen && emotionSelection ? (
        <LazyEmotionPanel
          isOpen={emotionPanelOpen}
          isDarkUi={isDarkUi}
          sourceImageUrl={String(primaryImageUrl || basePoseImage || '')}
          selection={emotionSelection}
          onClose={() => setEmotionPanelOpen(false)}
          onReplacePerson={() => openEmotionPersonSelector(true)}
          onApply={handleEmotionApply}
          loading={emotionLoading}
          error={emotionError}
        />
      ) : null}

      {/* ── 扩图面板 ── */}
      {expandPanelOpen ? (
        <LazyExpandPanel
          isOpen
          isDarkUi={isDarkUi}
          onClose={() => setExpandPanelOpen(false)}
          onApply={handleExpandApply}
          loading={expandLoading}
        />
      ) : null}

      {/* ── 旋转与镜像预览面板（仅在预览节点上渲染）── */}
      {isRotatePreview && (
        <LazyRotatePanel
          isOpen={true}
          isDarkUi={isDarkUi}
          angle={rotatePrevAngle}
          flipH={rotatePrevFlipH}
          flipV={rotatePrevFlipV}
          saving={rotateSaving}
          onAngleChange={setRotatePrevAngle}
          onFlipHChange={setRotatePrevFlipH}
          onFlipVChange={setRotatePrevFlipV}
          onSave={() => { void handleRotatePrevConfirm() }}
          onClose={handleRotatePrevClose}
        />
      )}

      {/* ── 裁剪覆盖层 ── */}
      {cropOpen && primaryImageUrl && imageNaturalSize && (
        <LazyCropOverlayEditor
          imageUrl={primaryImageUrl}
          displayWidth={nodeWidth}
          displayHeight={nodeHeight ?? nodeWidth * 0.75}
          naturalWidth={imageNaturalSize.w}
          naturalHeight={imageNaturalSize.h}
          isDarkUi={isDarkUi}
          onClose={() => setCropOpen(false)}
          onConfirm={handleCropConfirm}
        />
      )}

      {/* ── 视频剪辑覆盖层 ── */}
      {trimOpen && isVideoNode && activeVideoDuration !== null && (
        <LazyVideoTrimEditor
          videoUrl={videoResults[videoPrimaryIndex]?.url || videoUrl || ''}
          videoDuration={activeVideoDuration}
          isDarkUi={isDarkUi}
          onClose={() => setTrimOpen(false)}
          onConfirm={handleTrimConfirm}
        />
      )}

      {isVideoNode && hasPrimaryVideo && videoContinuationOpen && (
        <LazyVideoContinuationPanel
          opened
          readOnly={nodeReadOnly}
          sourceVideoUrl={videoResults[videoPrimaryIndex]?.url || videoUrl || ''}
          sourceDurationSeconds={activeVideoDuration}
          referenceMaxSeconds={videoModelConfig?.maxReferenceVideoDurationSeconds}
          continuationDurationOptions={continuationDurationOptions}
          onClose={() => setVideoContinuationOpen(false)}
          onSubmit={handleCreateVideoContinuation}
        />
      )}

      {isVideoNode && hasPrimaryVideo && videoToolEditorMode !== null && (
        <LazyVideoToolEditorPanel
          opened
          mode={videoToolEditorMode}
          videoUrl={videoResults[videoPrimaryIndex]?.url || videoUrl || ''}
          readOnly={nodeReadOnly}
          onSeparate={handleSeparateVideo}
          editModelValue={videoEditModel}
          editModelOptions={videoToolEditorMode === 'subject' ? videoSubjectRemovalModelOptions : videoSubtitleRemovalModelOptions}
          editModelLoading={videoActionModelListLoading}
          editModelError={videoActionModelListError?.message ?? null}
          editExecutorAvailable={videoToolEditorMode === 'subject' ? videoSubjectRemovalModelOptions.length > 0 : videoSubtitleRemovalModelOptions.length > 0}
          onEditModelChange={setVideoEditModel}
          onEditSubmit={handleVideoEditSubmit}
          onClose={() => setVideoToolEditorMode(null)}
          onUnavailable={(mode) => {
            if (mode === 'separation') {
              showVideoCapabilityGap('音视频分离', '扩展媒体 worker 的 demux 导出合同：输出无声 MP4 与独立音频文件，分别上传 Assets，再创建 video/audio 子节点')
              return
            }
            showVideoCapabilityGap(
              mode === 'subject' ? '主体消除' : mode === 'subtitle-auto' ? '智能去字幕' : '框选去字幕',
              mode === 'subject'
                ? '当前模型目录没有发布主体消除能力；请在 new-api 配置 wan2.7-videoedit，或接入视频修复/时序 inpainting 执行器。'
                : mode === 'subtitle-auto'
                  ? '当前模型目录没有发布 volc-erase-video-subtitle；请在 new-api 配置 MediaKit 自动字幕擦除模型与价格。'
                  : '当前模型目录没有发布 volc-erase-video-subtitle-pro；请在 new-api 配置 MediaKit 框选字幕擦除模型与价格.',
            )
          }}
        />
      )}

      {/* ── 元素编辑（点选/框选/画笔 + 修改/移动）── */}
      {elementEditOpen && primaryImageUrl && (
        <LazyElementEditEditor
          imageUrl={primaryImageUrl}
          isDarkUi={isDarkUi}
          onClose={() => setElementEditOpen(false)}
          onConfirm={handleElementEditConfirm}
        />
      )}

      {/* ── 人像质感调节（人物识别/手动框选 → 专用结果节点）── */}
      {portraitTextureEditorOpen && primaryImageUrl && (
        <LazyPortraitTextureEditor
          imageUrl={primaryImageUrl}
          isDarkUi={isDarkUi}
          onClose={closePortraitTextureEditor}
          onConfirm={handlePortraitTextureSelectionConfirm}
        />
      )}

      {/* ── 情绪调节人物选择（真实人物识别/像素蒙版）── */}
      {emotionPersonSelectorOpen && primaryImageUrl && (
        <LazyPortraitTextureEditor
          imageUrl={primaryImageUrl}
          isDarkUi={isDarkUi}
          purpose="emotion"
          initialManualMode={emotionSelectorManual}
          onClose={() => setEmotionPersonSelectorOpen(false)}
          onConfirm={handleEmotionSelectionConfirm}
        />
      )}

      {/* ── 蒙版画笔（重绘/擦除）── */}
      {maskMode && primaryImageUrl && imageNaturalSize && (
        <LazyMaskDrawingEditor
          imageUrl={primaryImageUrl}
          naturalWidth={imageNaturalSize.w}
          naturalHeight={imageNaturalSize.h}
          mode={maskMode}
          isDarkUi={isDarkUi}
          onClose={() => setMaskMode(null)}
          onConfirm={handleMaskConfirm}
        />
      )}

      {/* ── 标注覆盖层 ── */}
      {annotateOpen && primaryImageUrl && imageNaturalSize && (
        <LazyAnnotationEditor
          imageUrl={primaryImageUrl}
          naturalWidth={imageNaturalSize.w}
          naturalHeight={imageNaturalSize.h}
          isDarkUi={isDarkUi}
          onClose={() => setAnnotateOpen(false)}
          onSave={handleAnnotateSave}
        />
      )}

      {isPlainTextNode && isSingleSelectionActive && !nodeReadOnly && !imagePresetConfirmKey && (
        <LazyTaskNodeTextInlineToolbar
          toolbarBackground={toolbarBackground}
          toolbarShadow={toolbarShadow}
          inlineDividerColor={inlineDividerColor}
          applyHeading={applyHeading}
          runRichCommand={runRichCommand}
          applyList={applyList}
          insertDivider={insertDivider}
          textColorPickerOpen={textColorPickerOpen}
          setTextColorPickerOpen={setTextColorPickerOpen}
          textColor={textColor}
          textBgPickerOpen={textBgPickerOpen}
          setTextBgPickerOpen={setTextBgPickerOpen}
          updateNodeData={updateNodeData}
          nodeId={id}
        />
      )}
      <TaskNodeHandles
        targets={targets}
        sources={sources}
        layout={handleLayoutMap}
        defaultInputType={defaultInputType}
        defaultOutputType={defaultOutputType}
        wideHandleBase={wideHandleBase}
        showHandles
        showWideHandles={!isWorkflowStageNode && !isWorkflowTriggerNode}
      />
      {isResizableVisualNode && isSingleSelectionActive && !variantsOpen && !isRotatePreview && (
        <NodeResizeControl
          className="tc-task-node__media-resize nodrag"
          position="bottom-right"
          keepAspectRatio={!isStoryboardEditorNode && !isVideoComposeNode && !isStructuredWorkflowNode}
          minWidth={visualNodeDefaults.minWidth}
          minHeight={visualNodeDefaults.minHeight}
          onResizeEnd={handleMediaResizeEnd}
        >
          <div className="tc-task-node__media-resize-handle" />
        </NodeResizeControl>
      )}
      {isWorkflowPresetSelectorNode && (
        <LazyWorkflowPresetSelector
          nodeId={id}
          data={data as Record<string, unknown>}
          readOnly={nodeReadOnly || isRunning}
        />
      )}
      {isPlainTextNode && (
        <LazyTextContent
          selected={isSingleSelectionActive}
          textEditorFocused={textEditorFocused}
          textBackgroundTint={textBackgroundTint}
          textColor={textColor}
          textFontSize={textFontSize}
          textFontWeight={textFontWeight as React.CSSProperties['fontWeight']}
          editorRef={textEditorRef}
          readOnly={nodeReadOnly || isRunning}
          onFocus={() => {
            setTextEditorFocused(true)
          }}
          onInput={() => {
            if (textComposingRef.current) return
            if (nodeReadOnly) return
            textResizeRequestedRef.current = true
            syncTextNodeContent()
          }}
          onCompositionStart={() => {
            textComposingRef.current = true
          }}
          onCompositionEnd={() => {
            textComposingRef.current = false
            if (nodeReadOnly) return
            textResizeRequestedRef.current = true
            syncTextNodeContent()
          }}
          onBlur={() => {
            setTextEditorFocused(false)
            if (nodeReadOnly) return
            syncTextNodeContent()
          }}
        />
      )}
      {/* Content Area for Character/Image/Video/Text kinds */}
      {featureBlocks}
      {isVideoComposeNode && upstreamComposeAudioTracks.length > 0 ? (
        <Group
          className="nodrag"
          gap={6}
          wrap="nowrap"
          style={{
            marginTop: 6,
            padding: '4px 8px',
            borderRadius: 8,
            background: 'rgba(16,185,129,0.08)',
            border: '1px solid rgba(16,185,129,0.25)',
          }}
        >
          <IconMusic size={13} style={{ color: '#10B981', flexShrink: 0 }} />
          <Text size="xs" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            已连接 {upstreamComposeAudioTracks.length} 条音轨，合成时自动混入
          </Text>
        </Group>
      ) : null}
      {isVideoComposeNode && !isOrchestratedVideoClip && composeEditorOpen && (
        <LazyVideoComposeEditorModal
          opened
          onClose={() => setComposeEditorOpen(false)}
          upstreamVideos={upstreamVideos}
          upstreamAudioTracks={upstreamComposeAudioTracks}
          onComposeDone={handleComposeDone}
          title={(data as any)?.smartEdit === true ? '智能剪辑' : '视频合成'}
          initialSubtitles={(data as any)?.composeSubtitles}
          onSubtitlesChange={(s) => updateNodeData(id, { composeSubtitles: s })}
        />
      )}
      {/* remove bottom kind text for all nodes */}
      {/* Removed bottom tag list; top-left label identifies node type */}
      {/* Bottom detail panel near node */}
      {showBottomToolbar && !imagePresetConfirmKey && !imageViewEditorOpen && (
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
              overflowY: useMediaFocusToolbar ? 'hidden' : 'auto',
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
                  {modelCatalogNotice}
                  {controlChipsNode}
                </div>
              ) : null}

              <div className="tc-task-node__toolbar-body">
                {!useMediaFocusToolbar && (
                  <StatusBanner status={status} lastError={(data as any)?.lastError} httpStatus={(data as any)?.httpStatus} />
                )}

                {isOrchestratedVideoClip && (
                  <LazyVideoContinuityInspector nodeId={id} data={data} />
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

                {useMediaFocusToolbar && (isImageNode || isVideoNode) && !isPortraitTextureNode ? (
                  <LazyLibTvMediaQuickActions
                    kind={isVideoNode ? 'video' : 'image'}
                    disabled={nodeReadOnly || isRunning}
                    referenceActive={canvasReferencePickerActive}
                    markerActive={isVideoNode ? videoMarkers.length > 0 || videoMarkerOpen : annotateOpen}
                    onReference={handleToggleCanvasReferencePicker}
                    onMarker={handleOpenMediaMarker}
                    onStyle={isImageNode ? () => setStyleImagePickerOpen(true) : undefined}
                    onEffect={isVideoNode ? () => setMediaPromptLibraryKind('effect') : undefined}
                    onCharacters={isVideoNode ? () => setCharacterLibraryOpen(true) : undefined}
                    onCameraMovement={isVideoNode ? () => setMediaPromptLibraryKind('camera') : undefined}
                    onFocus={handleFocusNode}
                  />
                ) : null}

                {isPortraitTextureNode ? (
                  <LazyPortraitTextureControls
                    strength={normalizePortraitTextureStrength((data as Record<string, unknown>).portraitTextureStrength)}
                    selectionConfirmed={(data as Record<string, unknown>).portraitTextureSelectionStatus === 'confirmed'}
                    onStrengthChange={(strength) => {
                      const normalizedStrength = normalizePortraitTextureStrength(strength)
                      const currentOperationSpec = (data as Record<string, unknown>).imageOperationSpec
                      updateNodeData(id, {
                        portraitTextureStrength: normalizedStrength,
                        ...(currentOperationSpec
                          ? {
                            imageOperationSpec: updateImageOperationParameters(currentOperationSpec, {
                              strength: normalizedStrength,
                            }),
                          }
                          : {}),
                      })
                    }}
                  />
                ) : null}


                {isPlainTextNode || isVideoComposeNode ? null : isStructuredPromptMode ? (
                  <LazyStructuredPromptSection
                    structuredValue={structuredPromptValue}
                    loading={structuredPromptRefineLoading}
                    externalError={structuredPromptErrorMessage}
                    readOnly={isOrchestratedVideoClip}
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
                  <LazyPromptSection
                    layout={useMediaFocusToolbar ? 'media-focus' : 'default'}
                    hideBrainButton={useMediaFocusToolbar || isVideoNode}
                    readOnly={nodeReadOnly || isRunning || isOrchestratedVideoClip}
                    prompt={prompt}
                    setPrompt={setPrompt}
                    onUpdateNodeData={(patch) => updateNodeData(id, patch)}
                    placeholder={
                      (data as Record<string, unknown>).libTvImageOperationKey === 'portrait-adjust'
                        ? '上传图片或输入补充描述，选择质感强度，让人物更自然、更真实'
                        : isVideoNode
                        ? '描述你想要生成的画面内容，@引用素材'
                        : isImageNode
                          ? '可直接文字生图，或上传图片输入文字指令对图片进行编辑，如：将背景改为雪夜'
                          : undefined
                    }
                    minRows={2}
                    mentionOpen={mentionOpen}
                    mentionItems={mentionItems}
                    setMentionFilter={setMentionFilter}
                    setMentionOpen={setMentionOpen}
                    mentionMetaRef={mentionMetaRef}
                    onMentionApplied={handleMentionApplied}
                    onPickFromLibrary={useMediaFocusToolbar ? undefined : handlePickFromLibrary}
                    isDarkUi={isDarkUi}
                    nodeShellText={nodeShellText}
                    onOpenPromptSamples={
                      useMediaFocusToolbar
                        ? undefined
                        : () => setPromptSamplesOpen(true)
                    }
                    promptLibraryMediaType={
                      isVideoNode
                        ? 'video'
                        : isImageNode || kind === 'imageEdit'
                          ? 'image'
                          : undefined
                    }
                    onSelectPromptLibraryPrompt={
                      isVideoNode || isImageNode || kind === 'imageEdit'
                        ? handleApplyPromptLibraryEntry
                        : undefined
                    }
                    promptInputMinHeight={
                      typeof (data as any).promptInputMinHeight === 'number'
                        ? (data as any).promptInputMinHeight
                        : undefined
                    }
                    canvasScale={toolbarScale}
                    projectId={String(currentProject?.id || '')}
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
                          {modelCatalogNotice}
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
      {pendingIntentConfig !== null ? (
        <LazyIntentConfigModal
          opened
          onCancel={() => setPendingIntentConfig(null)}
          onConfirm={({ imageModel, imageSize }) => {
            if (!pendingIntentConfig) return
            persistRecentGenerationPrefs({ imageModel, imageSize })
            void dispatchIntent(pendingIntentConfig.intent, id, {
              chapterContext: pendingIntentConfig.chapterContext,
              generationConfig: { imageModel, imageSize },
            })
            setPendingIntentConfig(null)
          }}
        />
      ) : null}
      {promptSamplesOpen ? (
        <LazyPromptSampleDrawer
          opened
          nodeKind={kind}
          onClose={() => setPromptSamplesOpen(false)}
          onApplySample={handleApplyPromptSample}
        />
      ) : null}
      {stylePickerOpen ? (
        <LazyImagePickerModal
          opened
          onClose={() => setStylePickerOpen(false)}
          onSelect={handleStylePickerSelect}
        />
      ) : null}
      {styleImagePickerOpen ? (
        <LazyStyleImagePickerModal
          opened
          onClose={() => setStyleImagePickerOpen(false)}
          onConfirm={handleStyleImageConfirm}
          projectId={currentProject?.id ?? null}
          teamId={currentProject?.teamId ?? null}
          currentStyleImages={styleImages}
          onRemoveCurrent={handleStyleImageRemove}
        />
      ) : null}
      {mediaPromptLibraryKind ? (
        <LazyMediaPromptLibraryModal
          opened
          kind={mediaPromptLibraryKind}
          onClose={() => setMediaPromptLibraryKind(null)}
          onSelect={handleSelectMediaPromptLibraryItem}
        />
      ) : null}
      {characterLibraryOpen ? (
        <LazyAiCharacterLibraryModal
          opened
          onClose={() => setCharacterLibraryOpen(false)}
          onApplyToCanvas={handleApplyCharacterFromLibrary}
        />
      ) : null}
      {veoImageModalMode && (
        <LazyVeoImageModal
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
          continueToLastFrame={continueVeoSelectionToLastFrame}
          onContinueToLastFrame={() => {
            setContinueVeoSelectionToLastFrame(false)
            setVeoImageModalMode('last')
          }}
        />
      )}

      {isVideoNode && videoMarkerOpen ? (
        <LazyVideoMarkerToolbar
          opened
          currentTimeSeconds={videoMarkerPlayback.currentTime}
          durationSeconds={videoMarkerPlayback.duration}
          markerCount={videoMarkers.length}
          saving={videoMarkerSaving}
          onClose={() => setVideoMarkerOpen(false)}
          onSave={(draft) => { void handleSaveVideoMarker(draft) }}
        />
      ) : null}

      {imageViewEditorModal}
      {imageViewLightingToolbar}

      {isVideoNode && videoExpanded && (
        <LazyVideoResultModal
          opened
          onClose={() => setVideoExpanded(false)}
          videos={videoResults}
          primaryIndex={videoPrimaryIndex}
          onSelectPrimary={handleSetPrimaryVideo}
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
        />
      )}

      {/* Multi-angle editor for regular image nodes (NodeToolbar, attaches below node) */}
      {!isPanoramic && (kind === 'image' || kind === 'imageEdit') && imageNodeMultiAngleOpen && (
        <PanoramicMultiAngleEditor
          isOpen={true}
          imageUrl={primaryImageUrl}
          camera={imageNodeCamera}
          viewerRef={null}
          prompt={imageNodeMultiAnglePrompt}
          onCameraChange={setImageNodeCamera}
          onPromptChange={setImageNodeMultiAnglePrompt}
          onCapture={handleImageNodeMultiAngleCapture}
          onClose={() => setImageNodeMultiAngleOpen(false)}
          loading={imageNodeMultiAngleGenerating}
          creditCost={panoramicCredits > 0 ? panoramicCredits : undefined}
        />
      )}

      {/* Grid split mode: overlay is rendered inside ImageContent, toolbar above via NodeToolbar */}

      {isPanoramic && panoramicFullscreenOpen && createPortal(
        <div
          className="nodrag nopan"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 8900,
            background: '#000',
          }}
        >
          <PanoramicViewer
            imageUrl={primaryImageUrl}
            camera={panoramicCamera}
            showGrid={panoramicGridVisible}
            onCameraChange={handlePanoramicCameraChange}
          />
          <button
            onClick={() => setPanoramicFullscreenOpen(false)}
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              zIndex: 1,
              background: 'rgba(0,0,0,0.6)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              borderRadius: 8,
              padding: '6px 14px',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            关闭全屏
          </button>
        </div>,
        document.body,
      )}

      {saveToLibraryOpen ? (
        <LazySaveToLibraryModal
          open
          onClose={() => setSaveToLibraryOpen(false)}
          projectId={String(currentProject?.id || '')}
          imageUrl={primaryImageUrl || ''}
          nodeName={currentLabel}
          teamId={currentProject?.teamId ?? null}
        />
      ) : null}

      </div>
    </div>
  )
}

// Default export is the HEAVY interactive body, loaded as a lazy chunk by TaskNodeCard (the eager
// node-type entry registered with React Flow). Only TaskNodeCard should reference it, via
// React.lazy(() => import('./TaskNode')); importing it directly pulls in the full ~10k-line editor.
export default React.memo(TaskNodeInner, areTaskNodePropsEqual)
