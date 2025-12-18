import React from 'react'
import type { NodeProps } from 'reactflow'
import { Position, NodeToolbar } from 'reactflow'
import { useRFStore } from '../store'
import { useUIStore } from '../../ui/uiStore'
import { ActionIcon, Group, Paper, Button, Text, Stack, TextInput, Select, Loader, Badge, useMantineColorScheme, useMantineTheme } from '@mantine/core'
import {
  IconArrowsDiagonal2,
  IconAdjustments,
  IconPhotoSearch,
  IconRefresh,
  IconUsers,
  IconTrash,
} from '@tabler/icons-react'
import { listSoraMentions, markDraftPromptUsed, suggestDraftPrompts, uploadSoraImage, listModelProviders, listModelTokens, listSoraCharacters, runTaskByVendor, type ModelTokenDto, type PromptSampleDto } from '../../api/server'
import {
  getDefaultModel,
  getModelLabel,
  getModelProvider,
  isImageEditModel,
  type NodeKind,
} from '../../config/models'
import { useModelOptions } from '../../config/useModelOptions'
import {
  StoryboardScene,
  createScene,
  normalizeStoryboardScenes,
  serializeStoryboardScenes,
  STORYBOARD_MIN_DURATION,
  STORYBOARD_MAX_DURATION,
  STORYBOARD_MAX_TOTAL_DURATION,
  totalStoryboardDuration,
  scenesAreEqual,
  STORYBOARD_DEFAULT_DURATION,
  enforceStoryboardTotalLimit,
} from './storyboardUtils'
import { getTaskNodeSchema } from './taskNodeSchema'
import { buildTaskNodeFeatureFlags, type TaskNodeFeatureFlags } from './taskNode/features'
import {
  applyMentionFallback,
  blobToDataUrl,
  clampCharacterClipWindow,
  computeHandleLayout,
  extractTextFromTaskResult,
  isDynamicHandlesConfig,
  isStaticHandlesConfig,
  MAX_VEO_REFERENCE_IMAGES,
  MAX_FRAME_ANALYSIS_SAMPLES,
  normalizeVeoReferenceUrls,
  parseCharacterCardResult,
  parseFrameCompareSummary,
  resolveImageForReversePrompt,
} from './taskNodeHelpers'
import { PromptSampleDrawer } from '../components/PromptSampleDrawer'
import { toast } from '../../ui/toast'
import { DEFAULT_REVERSE_PROMPT_INSTRUCTION } from '../constants'
import { captureFramesAtTimes } from '../../utils/videoFrameExtractor'
import { normalizeOrientation, type Orientation } from '../../utils/orientation'
import { usePoseEditor } from './taskNode/PoseEditor'
import { ImageResultModal } from './taskNode/ImageResultModal'
import { TaskNodeHandles } from './taskNode/components/TaskNodeHandles'
import { TopToolbar } from './taskNode/components/TopToolbar'
import { TaskNodeHeader } from './taskNode/components/TaskNodeHeader'
import { ControlChips } from './taskNode/components/ControlChips'
import { StatusBanner } from './taskNode/components/StatusBanner'
import { PromptSection } from './taskNode/components/PromptSection'
import { VideoContent } from './taskNode/components/VideoContent'
import { MosaicModal } from './taskNode/components/MosaicModal'
import { VeoImageModal } from './taskNode/components/VeoImageModal'
import { VideoResultModal } from './taskNode/VideoResultModal'
import { StoryboardEditor } from './taskNode/StoryboardEditor'
import { renderFeatureBlocks } from './taskNode/featureRenderers'
import { REMOTE_IMAGE_URL_REGEX } from './taskNode/utils'
import { runNodeRemote } from '../../runner/remoteRunner'

const BASE_DURATION_OPTIONS = [
  { value: '10', label: '10s' },
  { value: '15', label: '15s' },
]
const STORYBOARD_DURATION_OPTION = { value: '25', label: '25s' }

const SAMPLE_OPTIONS = [1, 2, 3, 4, 5]

type FrameSample = {
  url: string
  time: number
  blob: Blob | null
  remoteUrl?: string | null
  description?: string | null
  describing?: boolean
}

type CharacterCard = {
  id: string
  name: string
  summary?: string
  tags?: string[]
  frames: Array<{ time: number; desc: string }>
  startFrame?: { time: number; url: string }
  endFrame?: { time: number; url: string }
  clipRange?: { start: number; end: number }
}

function normalizeClipRange(val: any): { start: number; end: number } | null {
  if (!val || typeof val !== 'object') return null
  const start = Number((val as any)?.start)
  const end = Number((val as any)?.end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (end <= start) return null
  return { start, end }
}
type Data = {
  label: string
  kind?: string
  status?: 'idle' | 'queued' | 'running' | 'success' | 'error' | 'canceled'
  progress?: number
}

export default function TaskNode({ id, data, selected }: NodeProps<Data>): JSX.Element {
  const status = data?.status ?? 'idle'
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
  const lightCards = ['rgba(255,255,255,0.96)', 'rgba(234,241,255,0.98)']
  const darkCards = ['rgba(18,25,48,0.97)', 'rgba(7,11,26,0.95)']
  const nodeShellBackground = isDarkUi
    ? `linear-gradient(155deg, ${darkCards[0]}, ${darkCards[1]})`
    : `linear-gradient(155deg, ${lightCards[0]}, ${lightCards[1]})`
  const nodeShellBorder = 'none'
  const nodeShellShadow = isDarkUi
    ? '0 32px 60px rgba(0, 0, 0, 0.65)'
    : '0 26px 55px rgba(15, 23, 42, 0.16)'
  const nodeShellGlow = `0 0 50px ${rgba(accentPrimary, isDarkUi ? 0.28 : 0.35)}`
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
  const toolbarTextButtonStyle = React.useMemo(() => ({
    borderRadius: 999,
    background: isDarkUi ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.02)',
    color: nodeShellText,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    height: 30,
    cursor: 'pointer',
  }), [isDarkUi, nodeShellText, toolbarButtonBorderColor])
  const galleryCardBackground = isDarkUi ? 'rgba(7,12,24,0.96)' : 'rgba(255,255,255,0.96)'

  const placeholderIconColor = nodeShellText
  const iconBadgeBackground = isDarkUi
    ? `linear-gradient(140deg, ${rgba(accentPrimary, 0.5)}, ${rgba(accentSecondary, 0.45)})`
    : `linear-gradient(140deg, ${rgba(accentPrimary, 0.2)}, ${rgba(accentSecondary, 0.25)})`
  const iconBadgeShadow = isDarkUi ? '0 14px 26px rgba(0,0,0,0.45)' : '0 16px 28px rgba(15,23,42,0.12)'
  const darkContentBackground = isDarkUi ? 'rgba(5,8,16,0.92)' : 'rgba(244,247,255,0.94)'
  const darkCardShadow = isDarkUi ? '0 18px 36px rgba(0, 0, 0, 0.55)' : '0 18px 36px rgba(15, 23, 42, 0.12)'
  const lightContentBackground = isDarkUi ? 'rgba(9,14,28,0.4)' : 'rgba(227,235,255,0.8)'

  const kind = data?.kind
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
    supportsSubflowHandles,
  } = featureFlags
  const isVideoNode = hasVideo || hasVideoResults || isComposerNode
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
  const handleLayoutMap = computeHandleLayout([...targets, ...sources])
  const wideHandleBase: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'auto',
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
  const openParamFor = useUIStore(s => s.openParamFor)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const requestCharacterCreator = useUIStore(s => s.requestCharacterCreator)
  const openVideoTrimModal = useUIStore(s => s.openVideoTrimModal)
  const edgeRoute = useUIStore(s => s.edgeRoute)
  const openCharacterCreatorModal = useUIStore(s => s.openCharacterCreatorModal)
  const runSelected = useRFStore(s => s.runSelected)
  const cancelNodeExecution = useRFStore(s => s.cancelNode)
  const setNodeStatus = useRFStore(s => s.setNodeStatus)
  const updateNodeData = useRFStore(s => s.updateNodeData)
  const addNode = useRFStore(s => s.addNode)
  const allNodes = useRFStore(s => s.nodes)
  const rawPrompt = (data as any)?.prompt as string | undefined
  const [prompt, setPrompt] = React.useState<string>(rawPrompt || '')

  // 当节点数据中的 prompt 发生变化（例如由 AI 自动生成）时，同步到本地输入框状态
  React.useEffect(() => {
    if (typeof rawPrompt === 'string' && rawPrompt !== prompt) {
      setPrompt(rawPrompt)
    }
  }, [rawPrompt])
  const [aspect, setAspect] = React.useState<string>((data as any)?.aspect || 'auto')
  const [imageSize, setImageSize] = React.useState<string>((data as any)?.imageSize || '1K')
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

  // 文本节点的系统提示词状态
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
    return '你是一个提示词优化助手。请在保持核心意图不变的前提下润色、缩短并结构化下面的提示词，用于后续多模态生成；同时避免引入血腥、残酷暴力或肢解等直观血腥描写，可用暗示和留白代替。'
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

  const nodesForCharacters = useRFStore(s => s.nodes)
  const edgesForCharacters = useRFStore(s => s.edges)
  const selectedCount = React.useMemo(() => nodesForCharacters.reduce((acc, n) => acc + (n.selected ? 1 : 0), 0), [nodesForCharacters])
  const fileRef = React.useRef<HTMLInputElement|null>(null)
  const imageUrl = (data as any)?.imageUrl as string | undefined
  const soraFileId = (data as any)?.soraFileId as string | undefined
  const [uploading, setUploading] = React.useState(false)
  const [reversePromptLoading, setReversePromptLoading] = React.useState(false)
  const poseStickmanUrl = (data as any)?.poseStickmanUrl as string | undefined
  const poseReferenceImages = (data as any)?.poseReferenceImages as string[] | undefined
  const imageResults = React.useMemo(() => {
    const raw = (data as any)?.imageResults as { url: string }[] | undefined
    if (raw && Array.isArray(raw) && raw.length > 0) return raw
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

    const targetUrl = imageResults[imagePrimaryIndex]?.url || imageResults[0]?.url || ''
    if (!targetUrl) {
      toast('请先上传或生成图片', 'error')
      return
    }

    if (!REMOTE_IMAGE_URL_REGEX.test(targetUrl)) {
      toast('请先上传图片到 Sora 或提供可访问的线上链接，再使用反推提示词', 'error')
      return
    }

    try {
      setReversePromptLoading(true)
      const imagePayload = await resolveImageForReversePrompt(targetUrl)
      if (!imagePayload.imageUrl) {
        toast('当前图片不可用，请稍后重试', 'error')
        setReversePromptLoading(false)
        return
      }
      const persist = useUIStore.getState().assetPersistenceEnabled
      const task = await runTaskByVendor('openai', {
        kind: 'image_to_prompt',
        prompt: DEFAULT_REVERSE_PROMPT_INSTRUCTION,
        extras: {
          ...imagePayload,
          nodeId: id,
          persistAssets: persist,
        },
      })
      const nextPrompt = extractTextFromTaskResult(task)
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
  }, [supportsReversePrompt, imageResults, imagePrimaryIndex, id, updateNodeData, setPrompt])

  const basePoseImage = React.useMemo(
    () => primaryImageUrl || imageResults[imagePrimaryIndex]?.url || imageResults[0]?.url || '',
    [imagePrimaryIndex, imageResults, primaryImageUrl],
  )

  const videoUrl = (data as any)?.videoUrl as string | undefined
  const videoThumbnailUrl = (data as any)?.videoThumbnailUrl as string | undefined
  const videoTitle = (data as any)?.videoTitle as string | undefined
  const videoPrompt = (data as any)?.videoPrompt as string | undefined
  const videoTokenId = ((data as any)?.videoTokenId as string | undefined) || null

  // Video history results (similar to imageResults)
  const videoResults = React.useMemo(() => {
    const raw = (data as any)?.videoResults as {
      id?: string;
      url: string;
      thumbnailUrl?: string | null;
      title?: string | null;
      duration?: number;
      createdAt?: string;
      clipRange?: { start: number; end: number };
      model?: string | null;
      remixTargetId?: string | null;
    }[] | undefined
    if (raw && Array.isArray(raw) && raw.length > 0) {
      return raw.map((item) => ({
        ...item,
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
  const videoClipRange = React.useMemo(() => {
    const fromResult = normalizeClipRange((videoResults[videoPrimaryIndex] as any)?.clipRange)
    if (fromResult) return fromResult
    return normalizeClipRange((data as any)?.clipRange)
  }, [data, videoPrimaryIndex, videoResults])
  const [videoSelectedIndex, setVideoSelectedIndex] = React.useState(0)
  const frameSampleUrlsRef = React.useRef<string[]>([])
  const frameSampleUploadsRef = React.useRef<Map<string, string>>(new Map())
  const [frameSamples, setFrameSamples] = React.useState<FrameSample[]>([])
  const [frameCaptureLoading, setFrameCaptureLoading] = React.useState(false)
  const [frameCompareTimes, setFrameCompareTimes] = React.useState<number[]>([])
  const [frameCompareResult, setFrameCompareResult] = React.useState<string | null>(null)
  const [frameCompareLoading, setFrameCompareLoading] = React.useState(false)
  const frameCompareSummary = React.useMemo(() => parseFrameCompareSummary(frameCompareResult), [frameCompareResult])
  const frameCompareVerdict = React.useMemo(() => {
    if (!frameCompareSummary) return null
    if (frameCompareSummary.same === true) {
      return { label: '同一角色', color: 'teal' as const }
    }
    if (frameCompareSummary.same === false) {
      return { label: '不同角色', color: 'red' as const }
    }
    return { label: '无法确定', color: 'gray' as const }
  }, [frameCompareSummary])
  const [characterCards, setCharacterCards] = React.useState<CharacterCard[]>([])
  const [characterCardLoading, setCharacterCardLoading] = React.useState(false)
  const [characterCardError, setCharacterCardError] = React.useState<string | null>(null)
  const describedFrameCount = React.useMemo(() => frameSamples.filter((sample) => Boolean(sample.description)).length, [frameSamples])
  const findNearestFrameSample = React.useCallback(
    (time?: number | null): FrameSample | null => {
      if (typeof time !== 'number' || !Number.isFinite(time) || frameSamples.length === 0) return null
      let best: FrameSample | null = null
      let bestDiff = Number.POSITIVE_INFINITY
      frameSamples.forEach((sample) => {
        const diff = Math.abs(sample.time - time)
        if (diff < bestDiff) {
          best = sample
          bestDiff = diff
        }
      })
      return best
    },
    [frameSamples],
  )

  const cleanupFrameSamples = React.useCallback(() => {
    frameSampleUrlsRef.current.forEach((u) => {
      try {
        URL.revokeObjectURL(u)
      } catch {
        // ignore
      }
    })
    frameSampleUrlsRef.current = []
    frameSampleUploadsRef.current.clear()
    setFrameSamples([])
    setFrameCompareTimes([])
    setFrameCompareResult(null)
    setCharacterCards([])
    setCharacterCardError(null)
    setCharacterCardLoading(false)
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
      return [0, 0.5, 1.5]
    })().filter((t, idx, arr) => Number.isFinite(t) && t >= 0 && arr.indexOf(t) === idx)

    setFrameCaptureLoading(true)
    cleanupFrameSamples()
    try {
      const { frames } = await captureFramesAtTimes({ type: 'url', url: src }, sampleTimes)
      frameSampleUrlsRef.current = frames.map((f) => f.objectUrl)
      frameSampleUploadsRef.current.clear()
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

  const toggleFrameCompare = React.useCallback((time: number) => {
    setFrameCompareTimes((prev) =>
      prev.includes(time) ? prev.filter((t) => t !== time) : [...prev, time],
    )
  }, [])

  const uploadImageWithRetry = React.useCallback(async (file: File, maxRetry = 2) => {
    let lastError: any = null
    for (let attempt = 0; attempt <= maxRetry; attempt++) {
      try {
        return await uploadSoraImage(undefined, file)
      } catch (err) {
        lastError = err
        if (attempt === maxRetry) {
          throw err
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
      }
    }
    throw lastError
  }, [])

  const ensureFrameRemoteUrl = React.useCallback(
    async (frame: FrameSample): Promise<string> => {
      const cached = frameSampleUploadsRef.current.get(frame.url)
      if (cached) return cached

      let blob = frame.blob
      if (!blob) {
        const res = await fetch(frame.url)
        if (!res.ok) {
          throw new Error('读取帧数据失败')
        }
        blob = await res.blob()
      }
      const mime = blob.type || 'image/png'
      const ext = mime.includes('jpeg') || mime.includes('jpg')
        ? 'jpg'
        : mime.includes('webp')
          ? 'webp'
          : 'png'
      const fileName = `frame-${Math.round(frame.time * 1000)}.${ext}`
      const file = new File([blob], fileName, { type: mime })
      const result = await uploadImageWithRetry(file)
      const remoteUrl = result.url || result.asset_pointer || (result as any)?.azure_asset_pointer
      if (!remoteUrl) {
        throw new Error('帧上传失败，请稍后重试')
      }
      frameSampleUploadsRef.current.set(frame.url, remoteUrl)
      return remoteUrl
    },
    [uploadImageWithRetry],
  )

  const updateFrameSample = React.useCallback((time: number, patch: Partial<FrameSample>) => {
    setFrameSamples((prev) =>
      prev.map((fs) => (fs.time === time ? { ...fs, ...patch } : fs)),
    )
  }, [])

  const handleCompareCharacters = React.useCallback(async () => {
    const sources = frameCompareTimes.length
      ? frameCompareTimes
          .map((t) => frameSamples.find((f) => f.time === t))
          .filter((f): f is { url: string; time: number } => Boolean(f))
      : frameSamples

    const picks = sources.slice(0, 4)
    if (!picks.length) {
      toast('请先抽帧或选择帧', 'error')
      return
    }

    setFrameCompareLoading(true)
    setFrameCompareResult(null)
    try {
      const descriptions: Array<{ time: number; text: string }> = []
      for (const f of picks) {
        const remoteUrl = await ensureFrameRemoteUrl(f)
        updateFrameSample(f.time, { remoteUrl })
        const persist = useUIStore.getState().assetPersistenceEnabled
        const task = await runTaskByVendor('openai', {
          kind: 'image_to_prompt',
          prompt: '用简短中文描述画面中的人物外观、性别、年龄段、发型、服饰、表情、动作。不要写场景或镜头信息。',
          extras: {
            imageUrl: remoteUrl,
            systemPrompt:
              '你是人物识别助手。请用中文一两句话只描述人物的外观（性别、年龄段、脸型、发型、服饰颜色款式、表情、动作），不要写镜头、背景、光线。',
            nodeId: id,
            persistAssets: persist,
          },
        })
        const text = extractTextFromTaskResult(task)
        descriptions.push({ time: f.time, text: text || '(无描述)' })
      }

      const list = descriptions
        .map((d, idx) => `${idx + 1}. t=${d.time.toFixed(2)}s -> ${d.text}`)
        .join('\n')
      const judgePrompt = [
        '你是镜头连续性助手。下面是同一段视频中不同时间点的帧描述，请判断这些帧中的主体是否为同一角色。',
        '输出严格的 JSON，不要额外文字：',
        '{ "same": true | false | "unknown", "reason": "简要中文理由", "tags": ["外观标签"], "frames": [{"time": number, "desc": "原描述"}]}',
        '判断标准：只有在高度确定是同一人时 same=true；明显不同 same=false；不确定则 same="unknown"。',
        '帧描述列表：',
        list,
      ].join('\n')

      const persistJudge = useUIStore.getState().assetPersistenceEnabled
      const judgeTask = await runTaskByVendor('openai', {
        kind: 'prompt_refine',
        prompt: judgePrompt,
        extras: {
          systemPrompt:
            '你是一个严谨的镜头角色判定助手。只输出 JSON，键使用英文，内容使用中文，避免幻觉，不确定则 same="unknown".',
          modelKey: 'gpt-5.2',
          persistAssets: persistJudge,
        },
      })
      const resultText = extractTextFromTaskResult(judgeTask)
      setFrameCompareResult(resultText?.trim() || '无结果')
    } catch (err: any) {
      console.error('handleCompareCharacters error', err)
      toast(err?.message || '角色判定失败，请稍后重试', 'error')
    } finally {
      setFrameCompareLoading(false)
    }
  }, [frameCompareTimes, frameSamples, ensureFrameRemoteUrl, id, updateFrameSample])


  const [characterTokens, setCharacterTokens] = React.useState<ModelTokenDto[]>([])
  const [characterTokensLoading, setCharacterTokensLoading] = React.useState(false)
  const [characterTokenError, setCharacterTokenError] = React.useState<string | null>(null)
  const [characterList, setCharacterList] = React.useState<any[]>([])
  const [characterCursor, setCharacterCursor] = React.useState<string | null>(null)
  const [characterLoading, setCharacterLoading] = React.useState(false)
  const [characterLoadingMore, setCharacterLoadingMore] = React.useState(false)
  const [characterError, setCharacterError] = React.useState<string | null>(null)
  const persistedCharacterRewriteModel = (data as any)?.characterRewriteModel
  const [characterRewriteModel, setCharacterRewriteModel] = React.useState<string>(() => {
    const stored = persistedCharacterRewriteModel
    return typeof stored === 'string' && stored.trim() ? stored : 'glm-4.6'
  })
  const [characterRewriteLoading, setCharacterRewriteLoading] = React.useState(false)
  const [characterRewriteError, setCharacterRewriteError] = React.useState<string | null>(null)
  const [hovered, setHovered] = React.useState<number|null>(null)
  const [showMore, setShowMore] = React.useState(false)
  const moreRef = React.useRef<HTMLDivElement|null>(null)

  const promptSuggestMode = useUIStore(s => s.promptSuggestMode)
  const [promptSuggestions, setPromptSuggestions] = React.useState<string[]>([])
  const [activeSuggestion, setActiveSuggestion] = React.useState(0)
  const suggestionsAllowed = promptSuggestMode !== 'off'
  const [suggestionsEnabled, setSuggestionsEnabled] = React.useState(() => suggestionsAllowed)
  const [promptSamplesOpen, setPromptSamplesOpen] = React.useState(false)
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
  const [compareOpen, setCompareOpen] = React.useState(false)
  const [modelKey, setModelKey] = React.useState<string>((data as any)?.geminiModel || 'gemini-2.5-flash')
  const [imageModel, setImageModel] = React.useState<string>((data as any)?.imageModel || getDefaultModel('image'))
  const [videoModel, setVideoModel] = React.useState<string>((data as any)?.videoModel || 'sora-2')
  const [videoDuration, setVideoDuration] = React.useState<number>(() => {
    const raw = Number((data as any)?.videoDurationSeconds)
    if (!Number.isNaN(raw) && raw > 0) {
      return raw
    }
    return isStoryboardNode ? STORYBOARD_MAX_TOTAL_DURATION : 15
  })
  const [orientation, setOrientation] = React.useState<Orientation>(() =>
    normalizeOrientation((data as any)?.orientation),
  )
  const orientationRef = React.useRef<Orientation>(orientation)
  React.useEffect(() => {
    const normalized = normalizeOrientation((data as any)?.orientation)
    setOrientation((prev) => (prev === normalized ? prev : normalized))
    orientationRef.current = normalized
  }, [(data as any)?.orientation])
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
    setVeoReferenceImages(normalizeVeoReferenceUrls((data as any)?.veoReferenceImages))
  }, [(data as any)?.veoReferenceImages])

  React.useEffect(() => {
    setVeoFirstFrameUrl(((data as any)?.veoFirstFrameUrl as string | undefined) || '')
  }, [(data as any)?.veoFirstFrameUrl])

  React.useEffect(() => {
    setVeoLastFrameUrl(((data as any)?.veoLastFrameUrl as string | undefined) || '')
  }, [(data as any)?.veoLastFrameUrl])

  const handleGenerateCharacterCards = React.useCallback(async () => {
    if (!frameSamples.length) {
      toast('请先抽帧后再生成角色卡', 'error')
      return
    }

    setCharacterCardLoading(true)
    setCharacterCardError(null)
    setCharacterCards([])
    try {
      const ordered = [...frameSamples].sort((a, b) => a.time - b.time)
      const descriptions: Array<{ time: number; desc: string; remoteUrl: string }> = []

      for (const frame of ordered) {
        try {
          updateFrameSample(frame.time, { describing: true })
          const remoteUrl = await ensureFrameRemoteUrl(frame)
          updateFrameSample(frame.time, { remoteUrl })
          let desc = frame.description?.trim()
          if (!desc) {
            const describeTask = await runTaskByVendor('openai', {
              kind: 'image_to_prompt',
              prompt: '用一句中文总结画面里人物的性别/年龄段/发型/服饰/神态/动作。不要描述背景。',
              extras: {
                imageUrl: remoteUrl,
                systemPrompt:
                  '你是视频角色识别助手。限定用简洁中文，只描述人物的外观特征与动作，不要写镜头或背景。',
                modelKey: 'gpt-5.2',
                nodeId: id,
              },
            })
            desc = extractTextFromTaskResult(describeTask).trim() || '(无描述)'
            updateFrameSample(frame.time, { description: desc })
          }
          descriptions.push({ time: frame.time, desc, remoteUrl })
        } catch (frameErr) {
          console.error('handleGenerateCharacterCards frame error', frameErr)
          const message = frameErr instanceof Error ? frameErr.message : '解析帧失败'
          toast(`帧 ${frame.time.toFixed(2)}s 处理失败：${message}`, 'error')
        } finally {
          updateFrameSample(frame.time, { describing: false })
        }
      }

      if (!descriptions.length) {
        setCharacterCardError('没有可用的帧描述')
        return
      }

      const list = descriptions
        .map((d, idx) => `${idx + 1}. t=${d.time.toFixed(2)}s -> ${d.desc}`)
        .join('\n')
      const cardPrompt = [
        '你是角色卡生成助手，请把下面帧描述按角色聚类。',
        '输出严格 JSON：{ "characters": [ { "name": "string", "summary": "中文概述", "tags": ["特征"], "frames": [{ "time": number, "desc": "原描述" }], "keyframes": { "start": number, "end": number } } ] }',
        '要求：',
        '1. 同一角色至少包含 2 帧；',
        '2. name 可自拟（如 “角色A”），summary 用 1-2 句中文概括外貌/动作/情绪；',
        '3. tags 最多 5 个；',
        '4. keyframes.start/ end 取该角色最早/最晚出现的 time，且片段长度控制在 1.2-3 秒。',
        '帧描述列表：',
        list,
      ].join('\n')

      const cardsTask = await runTaskByVendor('openai', {
        kind: 'prompt_refine',
        prompt: cardPrompt,
        extras: {
          systemPrompt:
            '只输出 JSON，键使用英文，值使用中文，不要加入解释。严格聚类，无法判断时 characters 返回空数组。',
          modelKey: 'gpt-5.2',
        },
      })
      const rawText = extractTextFromTaskResult(cardsTask)
      const parsed = parseCharacterCardResult(rawText)
      if (!parsed) {
        setCharacterCardError('角色卡结果解析失败')
        return
      }

      const cards: CharacterCard[] = parsed.characters
        .map((char: any, idx: number) => {
          const frames = Array.isArray(char?.frames)
            ? char.frames
                .map((frame: any) => {
                  const time = typeof frame?.time === 'number' ? frame.time : Number(frame?.time)
                  const desc = typeof frame?.desc === 'string' ? frame.desc.trim() : ''
                  return Number.isFinite(time) && desc
                    ? { time, desc }
                    : null
                })
                .filter((f: { time: number; desc: string } | null): f is { time: number; desc: string } => Boolean(f))
                .sort((a, b) => a.time - b.time)
            : []
          if (!frames.length) return null
          const clipWindow = clampCharacterClipWindow(frames, activeVideoDuration)
          const clampedFrames = frames.filter((frame) => frame.time >= clipWindow.start - 0.05 && frame.time <= clipWindow.end + 0.05)
          const framesForCard = clampedFrames.length > 0 ? clampedFrames : frames
          const startFrame = findNearestFrameSample(clipWindow.start)
          const endFrame = findNearestFrameSample(clipWindow.end)
          return {
            id: `character-${idx}`,
            name: typeof char?.name === 'string' && char.name.trim() ? char.name.trim() : `角色 ${idx + 1}`,
            summary: typeof char?.summary === 'string' ? char.summary.trim() : undefined,
            tags: Array.isArray(char?.tags)
              ? char.tags
                  .map((tag: any) => (typeof tag === 'string' ? tag.trim() : ''))
                  .filter((tag: string) => Boolean(tag))
                  .slice(0, 5)
              : undefined,
            frames: framesForCard,
            startFrame: startFrame ? { time: clipWindow.start, url: startFrame.url } : undefined,
            endFrame: endFrame ? { time: clipWindow.end, url: endFrame.url } : undefined,
            clipRange: clipWindow,
          }
        })
        .filter((card): card is CharacterCard => Boolean(card))

      if (!cards.length) {
        setCharacterCardError('模型未返回有效的角色卡')
        return
      }
      setCharacterCards(cards)
    } catch (error: any) {
      console.error('handleGenerateCharacterCards error', error)
      setCharacterCardError(error?.message || '角色卡生成失败')
    } finally {
      setCharacterCardLoading(false)
    }
  }, [frameSamples, ensureFrameRemoteUrl, findNearestFrameSample, id, updateFrameSample, activeVideoDuration])

  const selectedCharacterTokenId: string | null = (data as any)?.soraTokenId ?? null
  const selectedCharacter = React.useMemo(() => {
    const payload: any = data || {}
    const id = payload.soraCharacterId || null
    const usernameRaw = payload.soraCharacterUsername || ''
    const username = typeof usernameRaw === 'string' ? usernameRaw.replace(/^@/, '') : ''
    const displayName = payload.characterDisplayName || payload.label || (username ? `@${username}` : '')
    const avatar = payload.characterAvatarUrl || null
    const cover = payload.characterCoverUrl || null
    const description = payload.characterDescription || payload.prompt || ''
    if (!id && !username && !displayName) return null
    return {
      id,
      username,
      displayName: displayName || (username ? `@${username}` : '角色'),
      avatar,
      cover,
      description,
    }
  }, [data])
  const characterPrimaryImage = React.useMemo(() => {
    if (!selectedCharacter) return null
    return selectedCharacter.cover || selectedCharacter.avatar || null
  }, [selectedCharacter])

  const primaryMedia = React.useMemo(() => {
    if (isCharacterNode && characterPrimaryImage) return 'character' as const
    if (hasPrimaryImage || hasImageResults) return 'image' as const
    if (isVideoNode && (videoResults[videoPrimaryIndex]?.url || (data as any)?.videoUrl)) return 'video' as const
    if (isAudioNode && (data as any)?.audioUrl) return 'audio' as const
    return null
  }, [
    isCharacterNode,
    characterPrimaryImage,
    hasPrimaryImage,
    hasImageResults,
    isVideoNode,
    videoResults,
    videoPrimaryIndex,
    data,
    isAudioNode,
  ])
  const characterRefs = React.useMemo(() => {
    return nodesForCharacters
      .filter((node) => {
        const nodeKind = (node.data as any)?.kind
        const nodeSchema = getTaskNodeSchema(nodeKind)
        return nodeSchema.category === 'character' || nodeSchema.features.includes('character')
      })
      .map((node) => {
        const payload: any = node.data || {}
        const usernameRaw = payload.soraCharacterUsername || ''
        const username = typeof usernameRaw === 'string' ? usernameRaw.replace(/^@/, '') : ''
        const displayName = payload.characterDisplayName || payload.label || (username ? `@${username}` : node.id)
        return { nodeId: node.id, username, displayName, rawLabel: payload.label || '' }
      })
      .filter((ref) => ref.username || ref.displayName)
  }, [nodesForCharacters])
  const characterRefMap = React.useMemo(() => {
    const map = new Map<string, { nodeId: string; username: string; displayName: string }>()
    characterRefs.forEach((ref) => map.set(ref.nodeId, ref))
    return map
  }, [characterRefs])
  const primaryMediaUrl = React.useMemo(() => {
    switch (primaryMedia) {
      case 'character':
        return characterPrimaryImage || null
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
    characterPrimaryImage,
    imageResults,
    imagePrimaryIndex,
    imageUrl,
    data,
    videoResults,
    videoPrimaryIndex,
  ])

  const activeModelKey = hasImageResults
    ? imageModel
    : isVideoNode
      ? videoModel
      : modelKey
  const modelList = useModelOptions(kind as NodeKind)
  const findVendorForModel = React.useCallback(
    (value: string | null | undefined) => {
      if (!value) return null
      const match = modelList.find((opt) => opt.value === value)
      return match?.vendor || null
    },
    [modelList],
  )
  const existingModelVendor = (data as any)?.modelVendor
  const existingImageVendor = (data as any)?.imageModelVendor
  const existingVideoVendor = (data as any)?.videoModelVendor
  const resolvedVideoVendor = React.useMemo(() => {
    const normalizedVideoModel = (videoModel || '').toLowerCase()
    if (normalizedVideoModel.startsWith('sora')) {
      return 'sora2api'
    }
    if (existingVideoVendor) return existingVideoVendor
    return findVendorForModel(videoModel)
  }, [existingVideoVendor, findVendorForModel, videoModel])
  const isSoraVideoVendor = resolvedVideoVendor === 'sora' || resolvedVideoVendor === 'sora2api'
  const isSoraVideoNode = isVideoNode && isSoraVideoVendor
  const handlePoseSaved = React.useCallback(
    ({ poseStickmanUrl: stickmanUrl, poseReferenceImages: refs, maskUrl, prompt: posePrompt }: { poseStickmanUrl: string; poseReferenceImages: string[]; baseImageUrl: string; maskUrl?: string | null; prompt?: string }) => {
    const stateBefore = useRFStore.getState()
    const beforeIds = new Set(stateBefore.nodes.map((n) => n.id))
    const targetKind = kind === 'textToImage' ? 'textToImage' : 'image'
    const fallbackModel = getDefaultModel('image')
    const editableModel = isImageEditModel(imageModel) ? imageModel : fallbackModel
    const editableVendor = findVendorForModel(editableModel)
    const normalizedRefs = Array.from(new Set((refs || []).filter(Boolean)))
    const effectivePrompt = (posePrompt || prompt || (data as any)?.prompt || '').trim()

    addNode('taskNode', undefined, {
      kind: targetKind,
      prompt: effectivePrompt,
      aspect,
      sampleCount,
      imageModel: editableModel,
      imageModelVendor: editableVendor,
      poseStickmanUrl: stickmanUrl,
      poseReferenceImages: normalizedRefs,
      ...(maskUrl ? { poseMaskUrl: maskUrl } : {}),
    })

      const afterAdd = useRFStore.getState()
      const newNode = afterAdd.nodes.find((n) => !beforeIds.has(n.id))
      if (!newNode) {
        toast('姿势已保存，但未能创建新图像节点', 'error')
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
        toast('已创建新姿势图节点，请填写提示词后再运行', 'info')
        return
      }

      runNodeRemote(newNode.id, useRFStore.getState, useRFStore.setState).catch((err) => {
        console.error('auto run pose image failed', err)
        toast(err?.message || '新姿势图生成启动失败', 'error')
      })
    },
    [addNode, aspect, data, findVendorForModel, id, imageModel, kind, prompt, sampleCount],
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
    hasImages: imageResults.length > 0,
    isDarkUi,
    inlineDividerColor,
    updateNodeData,
    onPoseSaved: handlePoseSaved,
  })

  const [mosaicModalOpen, setMosaicModalOpen] = React.useState(false)
  const [mosaicInvalidUrls, setMosaicInvalidUrls] = React.useState<string[]>([])
  const [mosaicGrid, setMosaicGrid] = React.useState<number>(() => {
    const stored = (data as any)?.mosaicGrid
    return typeof stored === 'number' && stored >= 1 && stored <= 3 ? stored : 2
  })
  const [mosaicSelected, setMosaicSelected] = React.useState<string[]>(() => {
    const imgs = Array.isArray((data as any)?.mosaicImages)
      ? ((data as any)?.mosaicImages as any[]).map((i) => (typeof i?.url === 'string' ? i.url : null)).filter(Boolean)
      : []
    return imgs.length ? imgs.slice(0, 9) : []
  })
  const mosaicLimit = mosaicGrid * mosaicGrid
  const allImages = React.useMemo(() => {
    const urls: string[] = []
    const push = (url: any) => {
      if (typeof url !== 'string') return
      const t = url.trim()
      if (t) urls.push(t)
    }
    allNodes.forEach((n) => {
      const kd = (n.data as any)?.kind
      if (!kd) return
      const d: any = n.data || {}
      push(d.imageUrl)
      if (Array.isArray(d.imageResults)) {
        d.imageResults.forEach((it: any) => push(it?.url))
      }
    })
    return Array.from(new Set(urls))
  }, [allNodes])
  const availableImages = React.useMemo(() => {
    const filtered = allImages.filter((u) => !mosaicInvalidUrls.includes(u))
    if (mosaicSelected.length) {
      const selSet = new Set(mosaicSelected)
      const rest = filtered.filter((u) => !selSet.has(u))
      return [...mosaicSelected, ...rest]
    }
    return filtered
  }, [allImages, mosaicInvalidUrls, mosaicSelected])
  const [mosaicPreviewUrl, setMosaicPreviewUrl] = React.useState<string | null>(null)
  const [mosaicPreviewError, setMosaicPreviewError] = React.useState<string | null>(null)
  const [mosaicPreviewLoading, setMosaicPreviewLoading] = React.useState(false)
  const buildMosaicPreview = React.useCallback(async (urls: string[], grid: number) => {
    const { buildMosaicCanvas } = await import('../../runner/mosaicRunner')
    setMosaicPreviewLoading(true)
    setMosaicPreviewError(null)
    try {
      const { canvas, failedUrls } = await buildMosaicCanvas(urls, grid || 2)
      setMosaicPreviewUrl(canvas.toDataURL('image/png'))
      if (failedUrls.length) {
        setMosaicPreviewError(`已移除 ${failedUrls.length} 张过期或不可访问的图片`)
        setMosaicSelected((prev) => prev.filter((u) => !failedUrls.includes(u)))
        setMosaicInvalidUrls((prev) => Array.from(new Set([...prev, ...failedUrls])))
      }
    } catch (err: any) {
      console.warn('mosaic preview failed', err)
      setMosaicPreviewUrl(null)
      const failedUrls: string[] = Array.isArray((err as any)?.failedUrls) ? (err as any).failedUrls : []
      if (failedUrls.length) {
        setMosaicSelected((prev) => prev.filter((u) => !failedUrls.includes(u)))
        setMosaicInvalidUrls((prev) => Array.from(new Set([...prev, ...failedUrls])))
      }
      setMosaicPreviewError(err?.message || '预览生成失败，请检查图片是否可跨域访问')
    } finally {
      setMosaicPreviewLoading(false)
    }
  }, [])
  const handleMosaicToggle = React.useCallback(
    (url: string, checked: boolean) => {
      if (!url) return
      if (mosaicInvalidUrls.includes(url)) {
        toast('该图片已失效，请选择其他图片', 'error')
        return
      }
      setMosaicSelected((prev) => {
        if (checked) {
          if (prev.includes(url)) return prev
          const next = [...prev, url]
          if (next.length > mosaicLimit) {
            return prev
          }
          return next
        }
        return prev.filter((u) => u !== url)
      })
    },
    [mosaicInvalidUrls, mosaicLimit],
  )
  const moveMosaicItem = React.useCallback((url: string, dir: number) => {
    setMosaicSelected((prev) => {
      const idx = prev.findIndex((u) => u === url)
      if (idx < 0) return prev
      const nextIdx = idx + dir
      if (nextIdx < 0 || nextIdx >= prev.length) return prev
      const next = [...prev]
      const tmp = next[idx]
      next[idx] = next[nextIdx]
      next[nextIdx] = tmp
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
      const result = mosaicPreviewUrl
        ? { canvas: null, failedUrls: [] as string[] }
        : await buildMosaicCanvas(picked, mosaicGrid)
      if (result.failedUrls.length) {
        setMosaicSelected((prev) => prev.filter((u) => !result.failedUrls.includes(u)))
        setMosaicInvalidUrls((prev) => Array.from(new Set([...prev, ...result.failedUrls])))
        toast(`已移除 ${result.failedUrls.length} 张过期图片，已用剩余图片拼图`, 'info')
      }
      const finalUrl = mosaicPreviewUrl || result.canvas?.toDataURL('image/png') || null
      if (!finalUrl) throw new Error('未生成拼图结果')
      const existing = Array.isArray((data as any)?.imageResults) ? (data as any)?.imageResults : []
      const merged = [...existing, { url: finalUrl, title: '拼图' }]
      const primaryIndex = merged.length - 1
      setNodeStatus(id, 'success', {
        progress: 100,
        imageUrl: finalUrl,
        imageResults: merged,
        imagePrimaryIndex: primaryIndex,
        mosaicImages: picked.map((url) => ({ url })),
        mosaicGrid,
        mosaicLimit,
        lastResult: {
          id,
          at: Date.now(),
          kind: 'mosaic',
          preview: { type: 'image', src: finalUrl },
        },
      })
      setMosaicModalOpen(false)
      toast('拼图已更新', 'success')
    } catch (err: any) {
      toast(err?.message || '拼图生成失败', 'error')
    }
  }, [data, id, mosaicGrid, mosaicLimit, mosaicPreviewUrl, mosaicSelected, setNodeStatus])

  React.useEffect(() => {
    const limit = mosaicGrid * mosaicGrid
    const picked = mosaicSelected.slice(0, limit)
    if (!picked.length) {
      setMosaicPreviewUrl(null)
      setMosaicPreviewError(null)
      return
    }
    buildMosaicPreview(picked, mosaicGrid)
  }, [buildMosaicPreview, mosaicGrid, mosaicSelected])
  React.useEffect(() => {
    const limit = mosaicGrid * mosaicGrid
    setMosaicSelected((prev) => prev.slice(0, limit))
  }, [mosaicGrid])

  React.useEffect(() => {
    if (!mosaicModalOpen) return
    const storedGrid = (data as any)?.mosaicGrid
    const grid = typeof storedGrid === 'number' && storedGrid >= 1 && storedGrid <= 3 ? storedGrid : mosaicGrid
    setMosaicGrid(grid)
    const imgs = Array.isArray((data as any)?.mosaicImages)
      ? ((data as any)?.mosaicImages as any[]).map((i) => (typeof i?.url === 'string' ? i.url : null)).filter(Boolean)
      : []
    if (imgs.length) {
      setMosaicSelected(imgs.slice(0, grid * grid))
    }
  }, [data, mosaicGrid, mosaicModalOpen])

  const handleOpenCharacterCreatorModal = React.useCallback(
    (card: CharacterCard) => {
      if (resolvedVideoVendor === 'sora2api' || resolvedVideoVendor === 'grsai') {
        requestCharacterCreator({
          source: 'character-card',
          name: card.name,
          summary: card.summary,
          tags: card.tags,
          clipRange: card.clipRange,
          videoVendor: resolvedVideoVendor,
          soraTokenId: selectedCharacterTokenId || null,
        })
        toast('已提交角色创建任务', 'info')
        return
      }
      openCharacterCreatorModal({
        source: 'character-card',
        name: card.name,
        summary: card.summary,
        tags: card.tags,
        clipRange: card.clipRange,
        videoVendor: resolvedVideoVendor,
        soraTokenId: selectedCharacterTokenId || null,
      })
      setActivePanel('assets')
    },
    [openCharacterCreatorModal, requestCharacterCreator, resolvedVideoVendor, selectedCharacterTokenId, setActivePanel, toast],
  )

  const handleOpenCharacterCreatorFromVideo = React.useCallback(() => {
    if (!isVideoNode || !isSoraVideoVendor) {
      toast('该功能仅支持 Sora 视频节点', 'error')
      return
    }
    if (!hasPrimaryVideo) {
      toast('暂无可用的视频结果，无法创建角色', 'error')
      return
    }
    const activeVideo = videoResults[videoPrimaryIndex] || null
    const primaryUrl = activeVideo?.url || videoUrl || null
    if (!primaryUrl) {
      toast('暂无可用的视频结果，无法创建角色', 'error')
      return
    }
    const displayTitle = activeVideo?.title || videoTitle || 'Sora 角色'
    const quickCard: CharacterCard = {
      id: `video-${Date.now().toString(36)}`,
      name: displayTitle,
      summary: videoPrompt || prompt || undefined,
      frames: [],
    }
    const effectiveTokenId = selectedCharacterTokenId || videoTokenId || characterTokens[0]?.id || null
    if (resolvedVideoVendor === 'sora2api' || resolvedVideoVendor === 'grsai') {
      const defaultRange =
        videoClipRange ||
        {
          start: 0,
          end: Math.min(3, activeVideoDuration || 3),
        }
      openVideoTrimModal({
        videoUrl: primaryUrl,
        originalDuration: activeVideoDuration || 10,
        thumbnails: [],
        defaultRange,
        onConfirm: async (range) => {
          requestCharacterCreator({
            source: 'video-node',
            name: quickCard.name,
            summary: quickCard.summary,
            tags: quickCard.tags,
            videoVendor: resolvedVideoVendor,
            soraTokenId: effectiveTokenId,
            videoTokenId: videoTokenId || effectiveTokenId,
            videoUrl: primaryUrl,
            videoTitle: displayTitle,
            clipRange: range,
          })
          toast('已提交角色创建任务', 'info')
        },
      })
      return
    }
    openCharacterCreatorModal({
      source: 'video-node',
      name: quickCard.name,
      summary: quickCard.summary,
      tags: quickCard.tags,
      videoVendor: resolvedVideoVendor,
      soraTokenId: effectiveTokenId,
      videoTokenId: videoTokenId || effectiveTokenId,
      videoUrl: primaryUrl,
      videoTitle: displayTitle,
    })
    setActivePanel('assets')
  }, [
    isVideoNode,
    isSoraVideoVendor,
    hasPrimaryVideo,
    videoResults,
    videoPrimaryIndex,
    videoUrl,
    videoTitle,
    videoPrompt,
    prompt,
    videoTokenId,
    selectedCharacterTokenId,
    characterTokens,
    resolvedVideoVendor,
    videoClipRange,
    requestCharacterCreator,
    toast,
  ])

  const rewriteModelOptions = useModelOptions('text')
  const showTimeMenu = hasDuration
  const showResolutionMenu = hasAspect && (isVideoNode || hasImageResults)
  const showOrientationMenu = hasOrientation
  React.useEffect(() => {
    if (!modelList.some((m) => m.value === activeModelKey) && modelList.length) {
      const first = modelList[0]
      setModelKey(first.value)
      setImageModel(first.value)
      setVideoModel(first.value)
      updateNodeData(id, {
        geminiModel: first.value,
        imageModel: first.value,
        videoModel: first.value,
        modelVendor: first.vendor || null,
        imageModelVendor: first.vendor || null,
        videoModelVendor: first.vendor || null,
      })
    }
  }, [activeModelKey, modelList, id, updateNodeData])

  const trimmedFirstFrameUrl = veoFirstFrameUrl.trim()
  const trimmedLastFrameUrl = veoLastFrameUrl.trim()
  const firstFrameLocked = Boolean(trimmedFirstFrameUrl)
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
    if (!hasImageResults) return
    if (existingImageVendor || !imageModel) return
    const vendor = findVendorForModel(imageModel)
    if (vendor) {
      updateNodeData(id, { imageModelVendor: vendor })
    }
  }, [existingImageVendor, hasImageResults, imageModel, findVendorForModel, updateNodeData, id])

  React.useEffect(() => {
    if (!isVideoNode) return
    if (existingVideoVendor || !videoModel) return
    const vendor = findVendorForModel(videoModel)
    if (vendor) {
      updateNodeData(id, { videoModelVendor: vendor })
    }
  }, [existingVideoVendor, videoModel, findVendorForModel, updateNodeData, id, isVideoNode])
  const summaryModelLabel = getModelLabel(kind, activeModelKey)
  const summaryDuration =
    isVideoNode
      ? `${videoDuration}s`
      : `${sampleCount}x`
  const summaryResolution = aspect
  const summaryExec = `${sampleCount} x`
  const durationOptions = React.useMemo(
    () =>
      isStoryboardNode
        ? [...BASE_DURATION_OPTIONS, STORYBOARD_DURATION_OPTION]
        : BASE_DURATION_OPTIONS,
    [isStoryboardNode],
  )
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

  const { upstreamText, upstreamImageUrl, upstreamVideoUrl, upstreamSoraFileId } = useRFStore((s) => {
    const edgesToThis = s.edges.filter((e) => e.target === id)
    if (!edgesToThis.length) {
      return {
        upstreamText: null as string | null,
        upstreamImageUrl: null as string | null,
        upstreamVideoUrl: null as string | null,
        upstreamSoraFileId: null as string | null,
      }
    }
    const last = edgesToThis[edgesToThis.length - 1]
    const src = s.nodes.find((n) => n.id === last.source)
    if (!src) {
      return { upstreamText: null, upstreamImageUrl: null, upstreamVideoUrl: null, upstreamSoraFileId: null }
    }
    const sd: any = src.data || {}
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
          : sourceSchema.category === 'text'
            ? (sd.prompt as string | undefined) || (sd.label as string | undefined) || null
            : null

    // 获取最新的主图片 URL
    let uImg = null
    let uSoraFileId = null
    if (sourceIsImageNode) {
      uImg = (sd.imageUrl as string | undefined) || null
      uSoraFileId = (sd.soraFileId as string | undefined) || null
    } else if (sourceHasVideoResults && sd.videoResults && sd.videoResults.length > 0 && sd.videoPrimaryIndex !== undefined) {
      uImg = sd.videoResults[sd.videoPrimaryIndex]?.thumbnailUrl || sd.videoResults[0]?.thumbnailUrl
    }

    // 获取最新的主视频 URL
    let uVideo = null
    if (sourceHasVideoResults) {
      if (sd.videoResults && sd.videoResults.length > 0 && sd.videoPrimaryIndex !== undefined) {
        uVideo = sd.videoResults[sd.videoPrimaryIndex]?.url || sd.videoResults[0]?.url
      } else {
        uVideo = (sd.videoUrl as string | undefined) || null
      }
    }

    return { upstreamText: uText, upstreamImageUrl: uImg, upstreamVideoUrl: uVideo, upstreamSoraFileId: uSoraFileId }
  })

  const buildFeaturePatch = React.useCallback((nextPrompt: string) => {
    const patch: any = { prompt: nextPrompt }
    if (hasAspect) patch.aspect = aspect
    if (hasImageSize) patch.imageSize = imageSize
    if (hasImageResults) {
      patch.imageModel = imageModel
      patch.imageModelVendor = findVendorForModel(imageModel)
    }
    if (hasSampleCount) patch.sampleCount = sampleCount
    if (isComposerNode || hasVideo || hasVideoResults) {
      patch.videoModel = videoModel
      patch.videoModelVendor = findVendorForModel(videoModel)
      if (hasDuration) patch.videoDurationSeconds = videoDuration
      if (hasOrientation) patch.orientation = orientationRef.current
      if (upstreamSoraFileId) patch.inpaintFileId = upstreamSoraFileId
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
    modelKey,
    sampleCount,
    videoDuration,
    videoModel,
    isComposerNode,
    upstreamSoraFileId,
    orientationRef,
  ])

  const runNode = () => {
    let nextPrompt = (prompt || (data as any)?.prompt || '').trim()
    const patch: any = {}
    if (isStoryboardNode) {
      nextPrompt = serializeStoryboardScenes(storyboardScenes, {
        title: storyboardTitle,
        notes: storyboardNotes,
      })
      patch.storyboardScenes = storyboardScenes
      patch.storyboardNotes = storyboardNotes
      patch.storyboardTitle = storyboardTitle
      patch.storyboard = nextPrompt
    }
    const featurePatch = buildFeaturePatch(nextPrompt)
    Object.assign(patch, featurePatch)
    if (hasImage) {
      setPrompt(nextPrompt)
    }
    updateNodeData(id, patch)
    runSelected()
  }

  const videoContent = !isVideoNode
    ? null
    : (
      <VideoContent
        videoResults={videoResults}
        videoPrimaryIndex={videoPrimaryIndex}
        videoUrl={videoUrl}
        videoThumbnailUrl={videoThumbnailUrl}
        videoTitle={videoTitle}
        hasPrimaryVideo={hasPrimaryVideo}
        isSoraVideoVendor={isSoraVideoVendor}
        isSoraVideoNode={isSoraVideoNode}
        frameCaptureLoading={frameCaptureLoading}
        frameCompareLoading={frameCompareLoading}
        characterCardLoading={characterCardLoading}
        characterCardError={characterCardError}
        frameCompareResult={frameCompareResult}
        frameCompareSummary={frameCompareSummary}
        frameCompareVerdict={frameCompareVerdict}
        frameSamples={frameSamples}
        frameCompareTimes={frameCompareTimes}
        characterCards={characterCards}
        describedFrameCount={describedFrameCount}
        handleCaptureVideoFrames={handleCaptureVideoFrames}
        handleOpenCharacterCreatorFromVideo={handleOpenCharacterCreatorFromVideo}
        handleCompareCharacters={handleCompareCharacters}
        handleGenerateCharacterCards={handleGenerateCharacterCards}
        cleanupFrameSamples={cleanupFrameSamples}
        toggleFrameCompare={toggleFrameCompare}
        setFrameCompareTimes={setFrameCompareTimes}
        mediaOverlayBackground={mediaOverlayBackground}
        mediaOverlayText={mediaOverlayText}
        mediaFallbackSurface={mediaFallbackSurface}
        mediaFallbackText={mediaFallbackText}
        inlineDividerColor={inlineDividerColor}
        accentPrimary={accentPrimary}
        rgba={rgba}
        videoSurface={videoSurface}
        handleOpenCharacterCreatorModal={handleOpenCharacterCreatorModal}
        onOpenVideoModal={() => setVideoExpanded(true)}
      />
    )

  function refreshCharacters() {
    if (!selectedCharacterTokenId) return
    fetchCharacters()
  }

  const characterContentProps = isCharacterNode
    ? {
      characterPrimaryImage,
      selectedCharacter,
      placeholderColor: placeholderIconColor,
      onOpenAssets: () => setActivePanel('assets'),
      onRefresh: refreshCharacters,
      tokenReady: !!selectedCharacterTokenId,
    }
    : null

  const mosaicProps = {
    imageResults,
    imagePrimaryIndex,
    placeholderColor: placeholderIconColor,
    mosaicGrid,
    onOpenModal: () => setMosaicModalOpen(true),
    onSave: handleMosaicSave,
  }

  const handleImageUpload = React.useCallback(async (file: File) => {
    if (!supportsImageUpload) return

    try {
      setUploading(true)

      const localUrl = URL.createObjectURL(file)
      let localDataUrl: string | undefined
      try {
        localDataUrl = await blobToDataUrl(file)
      } catch {
        localDataUrl = undefined
      }
      updateNodeData(id, { imageUrl: localUrl, reverseImageData: localDataUrl })

      const result = await uploadImageWithRetry(file)

      if (result.file_id) {
        const remoteUrl = result.url || result.asset_pointer || (result as any)?.azure_asset_pointer || localUrl
        updateNodeData(id, {
          imageUrl: remoteUrl,
          soraFileId: result.file_id,
          assetPointer: result.asset_pointer,
          reverseImageData: localDataUrl,
        })
        if (remoteUrl !== localUrl) {
          URL.revokeObjectURL(localUrl)
        }

        if ((window as any).silentSaveProject) {
          (window as any).silentSaveProject()
        }
      }
    } catch (error) {
      console.error('Failed to upload image to Sora:', error)
      toast('上传图片到 Sora 失败，请稍后再试', 'error')
    } finally {
      setUploading(false)
    }
  }, [supportsImageUpload, id, updateNodeData, uploadImageWithRetry])

  const connectToRight = (targetKind: string, targetLabel: string) => {
    const all = useRFStore.getState().nodes
    const self = all.find((n) => n.id === id)
    if (!self) return
    const pos = { x: self.position.x + 260, y: self.position.y }
    const newId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? (crypto as any).randomUUID()
        : `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    useRFStore.setState((s: any) => {
      const node = {
        id: newId,
        type: 'taskNode' as const,
        position: pos,
        data: { label: targetLabel, kind: targetKind },
      }
      const edge: any = {
        id: `e-${id}-${newId}-${Date.now().toString(36)}`,
        source: id,
        target: newId,
        sourceHandle: 'out-image',
        targetHandle: 'in-image',
        type: (edgeRoute === 'orth' ? 'orth' : 'typed') as any,
        animated: true,
      }
      return {
        nodes: [...s.nodes, node],
        edges: [...s.edges, edge],
      }
    })
  }

  const imageProps = {
    hasPrimaryImage,
    imageResults,
    imagePrimaryIndex,
    primaryImageUrl,
    fileRef,
    onUpload: supportsImageUpload ? handleImageUpload : undefined,
    connectToRight,
    hovered,
    setHovered,
    quickActionBackgroundActive,
    quickActionIconActive,
    quickActionIconColor,
    quickActionHint,
    nodeShellText,
    darkContentBackground,
    darkCardShadow,
    mediaFallbackSurface,
    mediaOverlayText,
    subtleOverlayBackground,
    soraFileId,
    imageUrl,
    themeWhite: theme.white,
    setImageExpanded,
    upstreamText,
  }

  const toolbarPreview = React.useMemo(() => {
    if (primaryMedia && primaryMediaUrl) {
      const kind = primaryMedia === 'character' ? 'image' : primaryMedia
      return { url: primaryMediaUrl, kind: kind as any }
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
    const a = document.createElement('a')
    a.href = toolbarPreview.url
    a.download = `${(data?.label || kind || 'node')}-${Date.now()}`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }, [data?.label, kind, toolbarPreview])

  const featureBlocks = renderFeatureBlocks(schema.features, {
    featureFlags,
    isMosaicNode,
    videoContent,
    characterProps: characterContentProps,
    mosaicProps,
    imageProps,
  })
  const [mentionOpen, setMentionOpen] = React.useState(false)
  const [mentionFilter, setMentionFilter] = React.useState('')
  const [mentionItems, setMentionItems] = React.useState<any[]>([])
  const [mentionLoading, setMentionLoading] = React.useState(false)
  const mentionMetaRef = React.useRef<{ at: number; caret: number } | null>(null)
  const rewriteRequestIdRef = React.useRef(0)

  const autoCharacterOptions = React.useMemo(() => {
    if (!characterRefs.length) return []
    const connected = new Set<string>()
    edgesForCharacters.forEach((edge) => {
      if (edge.target === id && characterRefMap.has(edge.source)) {
        connected.add(edge.source)
      }
    })
    return characterRefs
      .map((ref) => ({
        value: ref.nodeId,
        label: ref.username ? `${ref.displayName} · @${ref.username}` : ref.displayName,
        connected: connected.has(ref.nodeId),
        username: ref.username,
        displayName: ref.displayName,
        rawLabel: ref.rawLabel,
      }))
      .sort((a, b) => Number(b.connected) - Number(a.connected))
  }, [characterRefs, characterRefMap, edgesForCharacters, id])
  const connectedCharacterOptions = React.useMemo(() => {
    const withUsername = autoCharacterOptions.filter((opt) => opt.username)
    const direct = withUsername.filter((opt) => opt.connected)
    return direct.length > 0 ? direct : withUsername
  }, [autoCharacterOptions])
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
    const provider = getModelProvider(modelValue as any)
    if (!['google', 'anthropic'].includes(provider)) {
      throw new Error('当前模型暂未接入自动替换接口，请选择 Gemini 或 GLM 系列模型')
    }
    const vendor = provider === 'google' ? 'gemini' : 'anthropic'
    const persist = useUIStore.getState().assetPersistenceEnabled
    const task = await runTaskByVendor(vendor, {
      kind: 'prompt_refine',
      prompt: instructions,
      extras: { systemPrompt, modelKey: modelValue, persistAssets: persist },
    })
    const text = extractTextFromTaskResult(task)
    return text.trim()
  },
  [],
)

  const resolveCharacterMeta = React.useCallback((raw: any) => {
    if (!raw || typeof raw !== 'object') return null
    const profile = raw.owner_profile || raw.profile || {}
    const usernameRaw = raw.username || profile.username || ''
    const username = typeof usernameRaw === 'string' ? usernameRaw.replace(/^@/, '') : ''
    const displayName =
      raw.display_name ||
      raw.displayName ||
      profile.display_name ||
      profile.displayName ||
      (username ? `@${username}` : '')
    const cover = raw.cover_image_url || raw.thumbnail_url || raw.preview_image_url || profile.cover_image_url || ''
    const avatar = raw.profile_picture_url || profile.profile_picture_url || cover || ''
    const description = raw.description || profile.description || ''
    const id = raw.user_id || raw.character_id || raw.id || username || ''
    return { id, username, displayName, cover, avatar, description }
  }, [])
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
  const handleCopyCharacterMention = React.useCallback((username?: string | null) => {
    if (!username) return
    const mention = `@${username.replace(/^@/, '')}`
    try {
      void navigator.clipboard?.writeText(mention)
    } catch {
      // ignore clipboard failures
    }
  }, [])
  const handleClearCharacter = React.useCallback(() => {
    updateNodeLabel(id, '角色')
    setPrompt('')
    updateNodeData(id, {
      label: '角色',
      prompt: '',
      soraCharacterId: null,
      soraCharacterUsername: null,
      characterDisplayName: null,
      characterAvatarUrl: null,
      characterCoverUrl: null,
      characterDescription: null,
    })
  }, [id, updateNodeData, updateNodeLabel])
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
  const handleSelectCharacter = React.useCallback(
    (raw: any) => {
      const meta = resolveCharacterMeta(raw)
      if (!meta) return
      const labelText = meta.displayName || (meta.username ? `@${meta.username}` : 'Sora 角色')
      updateNodeLabel(id, labelText)
      const nextPrompt = meta.description || ''
      setPrompt(nextPrompt)
      updateNodeData(id, {
        label: labelText,
        prompt: nextPrompt,
        soraTokenId: selectedCharacterTokenId || null,
        soraCharacterId: meta.id || null,
        soraCharacterUsername: meta.username || null,
        characterDisplayName: meta.displayName || labelText,
        characterAvatarUrl: meta.avatar || null,
        characterCoverUrl: meta.cover || null,
        characterDescription: meta.description || '',
      })
    },
    [id, resolveCharacterMeta, selectedCharacterTokenId, updateNodeData, updateNodeLabel],
  )
  const fetchCharacters = React.useCallback(
    async (options?: { cursor?: string | null; append?: boolean }) => {
      if (!selectedCharacterTokenId) return
      const { cursor, append } = options || {}
      if (append) {
        setCharacterLoadingMore(true)
      } else {
        setCharacterLoading(true)
        setCharacterError(null)
      }
      try {
        const res = await listSoraCharacters(selectedCharacterTokenId, cursor || null, 30)
        const items = Array.isArray(res?.items) ? res.items : []
        setCharacterList((prev) => (append ? [...prev, ...items] : items))
        setCharacterCursor(res?.cursor || null)
      } catch (err: any) {
        setCharacterError(err?.message || '加载角色失败')
        if (!append) setCharacterList([])
        setCharacterCursor(null)
      } finally {
        if (append) {
          setCharacterLoadingMore(false)
        } else {
          setCharacterLoading(false)
        }
      }
    },
    [selectedCharacterTokenId],
  )
  const loadMoreCharacters = React.useCallback(() => {
    if (!selectedCharacterTokenId || !characterCursor) return
    fetchCharacters({ cursor: characterCursor, append: true })
  }, [characterCursor, fetchCharacters, selectedCharacterTokenId])

  // Define node-specific tools and overflow calculation
  const uniqueDefs = React.useMemo(() => {
    if (isCharacterNode) {
      return [
        { key: 'assets', label: '角色库', icon: <IconUsers size={16} />, onClick: () => setActivePanel('assets') },
        { key: 'refresh', label: '刷新', icon: <IconRefresh size={16} />, onClick: () => refreshCharacters() },
      ] as { key: string; label: string; icon: JSX.Element; onClick: () => void }[]
    }
    if (isMosaicNode) {
      return [
        {
          key: 'mosaic',
          label: '拼图设置',
          icon: <IconAdjustments size={16} />,
          onClick: () => setMosaicModalOpen(true),
        },
      ]
    }
    if (hasImageResults) {
      const tools: { key: string; label: string; icon: JSX.Element; onClick: () => void }[] = [
        {
          key: 'pose',
          label: '调整姿势',
          icon: <IconAdjustments size={16} />,
          onClick: () => openPoseEditor(),
        },
      ]
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
      { key: 'params', label: '参数', icon: <IconAdjustments size={16} />, onClick: () => openParamFor(id) },
    ] as { key: string; label: string; icon: JSX.Element; onClick: () => void }[]
  }, [hasImageResults, id, isCharacterNode, onReversePrompt, openParamFor, openPoseEditor, refreshCharacters, setActivePanel, supportsReversePrompt])

  type VeoCandidateImage = { url: string; label: string; sourceType: 'image' | 'video' }
  const veoCandidateImages = useRFStore((s) => {
    const seen = new Set<string>()
    const results: VeoCandidateImage[] = []
    s.nodes.forEach((node) => {
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
  })

  React.useEffect(() => {
    if (!isCharacterNode && !isSoraVideoNode) return
    let canceled = false
    const loadTokens = async () => {
      setCharacterTokensLoading(true)
      setCharacterTokenError(null)
      try {
        const providers = await listModelProviders()
        const sora = providers.find((p) => p.vendor === 'sora')
        if (!sora) {
          if (!canceled) {
            setCharacterTokens([])
            setCharacterTokenError('未配置 Sora Provider')
          }
          return
        }
        const tokens = await listModelTokens(sora.id)
        if (!canceled) {
          setCharacterTokens(tokens)
        }
      } catch (err: any) {
        if (!canceled) {
          setCharacterTokens([])
          setCharacterTokenError(err?.message || '加载 Sora Token 失败')
        }
      } finally {
        if (!canceled) {
          setCharacterTokensLoading(false)
        }
      }
    }
    loadTokens()
    return () => {
      canceled = true
    }
  }, [isCharacterNode, isSoraVideoNode])

  React.useEffect(() => {
    if (!isCharacterNode) return
    setCharacterError(null)
    setCharacterList([])
    setCharacterCursor(null)
    if (!selectedCharacterTokenId) return
    fetchCharacters()
  }, [fetchCharacters, isCharacterNode, selectedCharacterTokenId])

  React.useEffect(() => {
    if (!selected || selectedCount !== 1) setShowMore(false)
  }, [selected, selectedCount])

  React.useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (!showMore) return
      const root = (moreRef.current || document.querySelector('[data-more-root]')) as HTMLElement | null
      if (root && ev.target instanceof HTMLElement && root.contains(ev.target)) return
      setShowMore(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [showMore])

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

  // 输入 @ 时，通过后端转发 Sora search_mentions 接口获取可引用角色（Sora2）
  React.useEffect(() => {
    if (!mentionOpen) return
    const q = (mentionFilter || '').trim()
    let canceled = false
    const timer = window.setTimeout(async () => {
      try {
        setMentionLoading(true)
        const res = await listSoraMentions(q, null, 10)
        if (canceled) return
        const items = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : []
        setMentionItems(items)
      } catch {
        if (!canceled) setMentionItems([])
      } finally {
        if (!canceled) setMentionLoading(false)
      }
    }, 200)
    return () => {
      canceled = true
      window.clearTimeout(timer)
    }
  }, [mentionOpen, mentionFilter])

  const hasContent = React.useMemo(() => {
    if (hasImageResults) return Boolean(imageUrl || imageResults.length)
    if (isVideoNode || hasVideoResults) return Boolean((data as any)?.videoUrl)
    if (isAudioNode) return Boolean((data as any)?.audioUrl)
    if (isCharacterNode) return Boolean(characterPrimaryImage)
    return false
  }, [hasImageResults, isVideoNode, hasVideoResults, isAudioNode, isCharacterNode, imageUrl, imageResults.length, data, characterPrimaryImage])

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
  const isRunning = status === 'running' || status === 'queued'
  const shellOutline = 'none'
  const shellShadow = selected ? `${nodeShellShadow}, ${nodeShellGlow}` : nodeShellShadow
  const subtitle = schema.label || defaultLabel

  const isImageNode = kind === 'image'

  const maxTools = 5
  const commonLen = 2
  const reserveForMore = uniqueDefs.length > (maxTools - commonLen) ? 1 : 0
  const maxUniqueVisible = Math.max(0, maxTools - commonLen - reserveForMore)
  const visibleDefs = uniqueDefs.slice(0, maxUniqueVisible)
  const extraDefs = uniqueDefs.slice(maxUniqueVisible)

  const nodeWidth =
    typeof (data as any)?.nodeWidth === 'number' && Number.isFinite((data as any)?.nodeWidth)
      ? Math.max(320, Math.min(720, Number((data as any)?.nodeWidth)))
      : (kind === 'video' || kind === 'composeVideo' || kind === 'storyboard') ? 460 : 420

  return (
    <div
      style={{
        border: nodeShellBorder,
        borderRadius: 22,
        padding: '20px 22px 22px',
        background: nodeShellBackground,
        color: nodeShellText,
        boxShadow: shellShadow,
        backdropFilter: 'blur(18px)',
        transition: 'box-shadow 180ms ease, transform 180ms ease',
        transform: selected ? 'translateY(-2px)' : 'translateY(0)',
        position: 'relative',
        outline: shellOutline,
        boxSizing: 'border-box',
        width: nodeWidth,
        maxWidth: 720,
      } as React.CSSProperties}
    >
      <TaskNodeHeader
        NodeIcon={NodeIcon}
        editing={editing}
        labelDraft={labelDraft}
        currentLabel={currentLabel}
        subtitle={subtitle}
        statusLabel={statusLabel}
        statusColor={color}
        nodeShellText={nodeShellText}
        iconBadgeBackground={iconBadgeBackground}
        iconBadgeShadow={iconBadgeShadow}
        sleekChipBase={sleekChipBase}
        labelSingleLine={isImageNode}
        onLabelDraftChange={setLabelDraft}
        onCommitLabel={commitLabel}
        onCancelEdit={() => {
          setLabelDraft(currentLabel)
          setEditing(false)
        }}
        onStartEdit={() => setEditing(true)}
        labelInputRef={labelInputRef}
      />
      <TopToolbar
        isVisible={!!selected}
        selectedCount={selectedCount}
        hasContent={hasContent}
        moreRef={moreRef}
        showMore={showMore}
        setShowMore={setShowMore}
        toolbarBackground={toolbarBackground}
        toolbarShadow={toolbarShadow}
        toolbarActionIconStyles={toolbarActionIconStyles}
        toolbarTextButtonStyle={toolbarTextButtonStyle}
        inlineDividerColor={inlineDividerColor}
        visibleDefs={visibleDefs}
        extraDefs={extraDefs}
        onPreview={handlePreview}
        onDownload={handleDownload}
      />
      <TaskNodeHandles
        targets={targets}
        sources={sources}
        layout={handleLayoutMap}
        defaultInputType={defaultInputType}
        defaultOutputType={defaultOutputType}
        wideHandleBase={wideHandleBase}
      />
      {/* Content Area for Character/Image/Video/Text kinds */}
      {featureBlocks}
      {isVideoNode && resolvedVideoVendor === 'veo' && (
        <Paper radius="md" withBorder p="sm" style={{ marginTop: 8, width: '100%' }}>
          <Stack gap="xs">
            <Group justify="space-between" gap={6}>
              <Text size="sm" fw={500}>
                Veo 图像控制
              </Text>
              <Badge size="xs" color="grape">
                Veo3
              </Badge>
            </Group>
            <TextInput
              label="首帧图片 URL"
              placeholder="https://example.com/first.png"
              value={veoFirstFrameUrl}
              onChange={(e) => handleSetFirstFrameUrl(e.currentTarget.value)}
              description="设置后会优先使用该图像作为第一帧，且无法再选择参考图"
              rightSection={
                <Button size="compact-xs" variant="light" onClick={() => openVeoModal('first')}>
                  选择
                </Button>
              }
              rightSectionWidth={70}
            />
            {trimmedFirstFrameUrl && (
              <Paper radius="md" withBorder p="xs">
                <Group gap={8} align="flex-start">
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: `1px solid ${inlineDividerColor}`,
                      background: mediaFallbackSurface,
                    }}
                  >
                      <img src={trimmedFirstFrameUrl} alt="首帧" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <Group gap={4} style={{ flex: 1 }}>
                      <Button size="compact-xs" variant="subtle" onClick={() => openVeoModal('first')}>
                        更换
                      </Button>
                      <Button size="compact-xs" variant="subtle" color="red" onClick={() => handleSetFirstFrameUrl('')}>
                        清除
                      </Button>
                    </Group>
                </Group>
              </Paper>
            )}
            <TextInput
              label="尾帧图片 URL"
              placeholder="https://example.com/last.png"
              value={veoLastFrameUrl}
              onChange={(e) => handleSetLastFrameUrl(e.currentTarget.value)}
              disabled={!firstFrameLocked}
              rightSection={
                <Button size="compact-xs" variant="light" onClick={() => openVeoModal('last')}>
                  选择
                </Button>
              }
              rightSectionWidth={70}
            />
            {trimmedLastFrameUrl && (
              <Paper radius="md" withBorder p="xs">
                <Group gap={8} align="flex-start">
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: `1px solid ${inlineDividerColor}`,
                      background: mediaFallbackSurface,
                    }}
                  >
                      <img src={trimmedLastFrameUrl} alt="尾帧" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <Group gap={4} style={{ flex: 1 }}>
                      <Button size="compact-xs" variant="subtle" onClick={() => openVeoModal('last')}>
                        更换
                      </Button>
                      <Button size="compact-xs" variant="subtle" color="red" onClick={() => handleSetLastFrameUrl('')}>
                        清除
                      </Button>
                    </Group>
                </Group>
              </Paper>
            )}
            <Group gap={6} align="center">
              <Text size="xs" c="dimmed">
                参考图片（最多 {MAX_VEO_REFERENCE_IMAGES} 张）
              </Text>
              <Badge size="xs" color="gray" variant="light">
                {veoReferenceImages.length}/{MAX_VEO_REFERENCE_IMAGES}
              </Badge>
              <Button size="compact-xs" variant="subtle" onClick={() => openVeoModal('reference')}>
                管理
              </Button>
            </Group>
            {veoReferenceImages.length === 0 ? (
              <Text size="xs" c="dimmed">
                未选择参考图。
              </Text>
            ) : (
              <Group gap={6} wrap="wrap">
                {veoReferenceImages.map((url) => (
                  <Paper
                    key={url}
                    radius="md"
                    p="xs"
                    withBorder
                    style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: 220 }}
                  >
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 6,
                        overflow: 'hidden',
                        border: `1px solid ${inlineDividerColor}`,
                        background: mediaFallbackSurface,
                      }}
                    >
                      <img src={url} alt="参考图" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <ActionIcon size="xs" variant="subtle" onClick={() => handleRemoveReferenceImage(url)}>
                      <IconTrash size={12} />
                    </ActionIcon>
                  </Paper>
                ))}
              </Group>
            )}
          </Stack>
        </Paper>
      )}
            {/* remove bottom kind text for all nodes */}
      {/* Removed bottom tag list; top-left label identifies node type */}
      {status === 'running' && (
        <div style={{ marginTop: 6, height: 6, background: 'rgba(127,127,127,.25)', borderRadius: 4 }}>
          <div style={{ width: `${Math.min(100, Math.max(0, data?.progress ?? 0))}%`, height: '100%', background: color, borderRadius: 4 }} />
        </div>
      )}
      {/* Bottom detail panel near node */}
      <NodeToolbar isVisible={!!selected && selectedCount === 1} position={Position.Bottom} align="center" >
        <div
          style={{
            width: 380,
            maxHeight: '60vh',
            overflowY: 'auto',
            overflowX: 'visible',
            transformOrigin: 'top center',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <ControlChips
              summaryChipStyles={summaryChipStyles}
              controlValueStyle={controlValueStyle}
              summaryModelLabel={summaryModelLabel}
              summaryDuration={summaryDuration}
              summaryResolution={summaryResolution}
              summaryExec={summaryExec}
              modelList={modelList}
              onModelChange={(value) => {
                setModelKey(value)
                setImageModel(value)
                setVideoModel(value)
                const option = modelList.find((m) => m.value === value)
                updateNodeData(id, {
                  geminiModel: value,
                  imageModel: value,
                  videoModel: value,
                  modelVendor: option?.vendor || null,
                  imageModelVendor: option?.vendor || null,
                  videoModelVendor: option?.vendor || null,
                })
              }}
              showTimeMenu={showTimeMenu}
              durationOptions={durationOptions}
              onDurationChange={(num) => {
                setVideoDuration(num)
                updateNodeData(id, { videoDurationSeconds: num })
              }}
              showResolutionMenu={showResolutionMenu}
              onAspectChange={(value) => {
                setAspect(value)
                updateNodeData(id, { aspect: value })
              }}
              showImageSizeMenu={hasImageSize}
              imageSize={imageSize}
              onImageSizeChange={(value) => {
                setImageSize(value)
                updateNodeData(id, { imageSize: value })
              }}
              showOrientationMenu={showOrientationMenu}
              orientation={orientation}
              onOrientationChange={(value) => {
                const normalized = normalizeOrientation(value)
                orientationRef.current = normalized
                setOrientation(normalized)
                updateNodeData(id, { orientation: normalized })
              }}
              sampleOptions={SAMPLE_OPTIONS}
              sampleCount={sampleCount}
              onSampleChange={(value) => {
                setSampleCount(value)
                updateNodeData(id, { sampleCount: value })
              }}
              isCharacterNode={isCharacterNode}
              isRunning={isRunning}
              onCancelRun={handleCancelRun}
              onRun={runNode}
            />
          </div>
          {isCharacterNode ? (
            <Text size="xs" c="dimmed" mb={6}>挑选或创建角色，供后续节点通过 @角色名 自动引用。</Text>
          ) : (
            <Text size="xs" c="dimmed" mb={6}>{isComposerNode ? '分镜/脚本（支持多镜头，当前为实验功能）' : ''}</Text>
          )}

          {!isCharacterNode && (
            <StatusBanner status={status} lastError={(data as any)?.lastError} httpStatus={(data as any)?.httpStatus} />
          )}

          {isCharacterNode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Select
                label="Sora Token"
                placeholder={characterTokensLoading ? '正在加载 Token...' : characterTokens.length === 0 ? '暂无可用 Token' : '选择 Token'}
                data={characterTokens.map((t) => ({
                  value: t.id,
                  label: `${t.label || '未命名'}${t.shared ? '（共享）' : ''}`,
                }))}
                value={selectedCharacterTokenId || null}
                onChange={(value) => {
                  updateNodeData(id, { soraTokenId: value || null })
                  setCharacterList([])
                  setCharacterCursor(null)
                }}
                size="xs"
                withinPortal
                clearable
                disabled={characterTokensLoading}
              />
              {characterTokenError && (
                <Text size="xs" c="red">
                  {characterTokenError}
                </Text>
              )}
              <Group gap={6}>
                <Button size="xs" variant="light" onClick={() => setActivePanel('assets')}>
                  打开资产面板
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={refreshCharacters}
                  disabled={!selectedCharacterTokenId}
                  loading={characterLoading}
                >
                  刷新列表
                </Button>
              </Group>
              {selectedCharacter ? (
                <Paper radius="md" p="xs">
                  {selectedCharacter.cover && (
                    <div
                      style={{
                        borderRadius: 8,
                        overflow: 'hidden',
                        border: 'none',
                        marginBottom: 6,
                        background: mediaFallbackSurface,
                      }}
                    >
                      <img
                        src={selectedCharacter.cover}
                        alt={selectedCharacter.displayName}
                        style={{ width: '100%', height: 120, objectFit: 'cover' }}
                      />
                    </div>
                  )}
                  <Group gap={8} align="flex-start">
                    {selectedCharacter.avatar && (
                      <img
                        src={selectedCharacter.avatar}
                        alt={selectedCharacter.displayName}
                        style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <Text size="sm" fw={600}>
                        {selectedCharacter.displayName}
                      </Text>
                      {selectedCharacter.username && (
                        <Text size="xs" c="dimmed">
                          @{selectedCharacter.username}
                        </Text>
                      )}
                    </div>
                  </Group>
                  {selectedCharacter.description && (
                    <Text size="xs" c="dimmed" mt={4} style={{ whiteSpace: 'pre-wrap' }}>
                      {selectedCharacter.description}
                    </Text>
                  )}
                  <Group gap={6} mt={8}>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => handleCopyCharacterMention(selectedCharacter.username)}
                      disabled={!selectedCharacter.username}
                    >
                      复制 @ 引用
                    </Button>
                    <Button size="xs" variant="light" color="red" onClick={handleClearCharacter}>
                      清除
                    </Button>
                  </Group>
                </Paper>
              ) : (
                <Text size="xs" c="dimmed">
                  尚未选择角色，先选择 Token，再从下方列表或资产面板中添加。
                </Text>
              )}
              <div>
                <Group justify="space-between" mb={4}>
                  <Text size="xs" fw={500}>
                    可用角色
                  </Text>
                  {characterLoading && <Loader size="xs" />}
                </Group>
                {!selectedCharacterTokenId && (
                  <Text size="xs" c="dimmed">
                    请选择 Sora Token 以加载角色。
                  </Text>
                )}
                {selectedCharacterTokenId && !characterLoading && characterList.length === 0 && (
                  <Text size="xs" c="dimmed">
                    暂无角色，可前往资产面板创建。
                  </Text>
                )}
                {selectedCharacterTokenId && characterList.length > 0 && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                      gap: 8,
                    }}
                  >
                    {characterList.map((char, idx) => {
                      const meta = resolveCharacterMeta(char)
                      if (!meta) return null
                      const isActive = Boolean(selectedCharacter?.id && meta.id && selectedCharacter.id === meta.id)
                      return (
                        <Paper
                          key={meta.id || meta.username || idx}
                          radius="md"
                          p="xs"
                          style={{
                            border: 'none',
                            background: isActive ? rgba(theme.colors.blue[6], 0.15) : lightContentBackground,
                            cursor: 'pointer',
                          }}
                          onClick={() => handleSelectCharacter(char)}
                        >
                          {meta.cover && (
                            <div
                              style={{
                                borderRadius: 6,
                                overflow: 'hidden',
                                border: 'none',
                                marginBottom: 6,
                                background: mediaFallbackSurface,
                              }}
                            >
                              <img
                                src={meta.cover}
                                alt={meta.displayName}
                                style={{ width: '100%', height: 70, objectFit: 'cover' }}
                              />
                            </div>
                          )}
                          <Text size="xs" fw={500} lineClamp={1}>
                            {meta.displayName || '未命名角色'}
                          </Text>
                          {meta.username && (
                            <Text size="xs" c="dimmed" lineClamp={1}>
                              @{meta.username}
                            </Text>
                          )}
                          {meta.description && (
                            <Text size="xs" c="dimmed" lineClamp={2} mt={4}>
                              {meta.description}
                            </Text>
                          )}
                          <Button
                            size="xs"
                            variant={isActive ? 'filled' : 'subtle'}
                            fullWidth
                            mt={6}
                            onClick={(ev) => {
                              ev.stopPropagation()
                              handleSelectCharacter(char)
                            }}
                          >
                            {isActive ? '已选择' : '选择角色'}
                          </Button>
                        </Paper>
                      )
                    })}
                  </div>
                )}
                {characterCursor && (
                  <Button size="xs" variant="light" mt={8} onClick={loadMoreCharacters} loading={characterLoadingMore}>
                    加载更多
                  </Button>
                )}
                {characterError && (
                  <Text size="xs" c="red" mt={4}>
                    {characterError}
                  </Text>
                )}
              </div>
            </div>
          ) : (
            <>
              {isComposerNode && (upstreamImageUrl || upstreamText) && (
                <div style={{ marginBottom: 8 }}>
                  {upstreamImageUrl && (
                    <div
                      style={{
                        position: 'relative',
                        width: '100%',
                        maxHeight: 180,
                        borderRadius: 8,
                        overflow: 'hidden',
                        marginBottom: upstreamText ? 4 : 0,
                        border: 'none',
                        background: darkContentBackground,
                      }}
                    >
                      <img
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
                      {upstreamSoraFileId && (
                        <div
                          style={{
                            position: 'absolute',
                            left: 8,
                            top: 8,
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: 'rgba(34, 197, 94, 0.9)',
                            color: 'white',
                            fontSize: '10px',
                            fontWeight: 500,
                          }}
                          title={`Using Sora File ID: ${upstreamSoraFileId}`}
                        >
                          ✓ Sora
                        </div>
                      )}
                    </div>
                  )}
                  {upstreamText && (
                    <Text
                      size="xs"
                      c="dimmed"
                      lineClamp={1}
                      title={upstreamText || undefined}
                    >
                      {upstreamText}
                    </Text>
                  )}
                </div>
              )}

              {connectedCharacterOptions.length > 0 && (
                <Paper radius="md" p="xs" mb="xs">
                  <Text size="xs" fw={500} mb={4}>
                    {isUsingWorkflowCharacters ? '可用角色：' : '已连接角色：'}
                    {connectedCharacterOptions.map((opt) => `@${opt.username}`).join('、')}
                  </Text>
                  {isUsingWorkflowCharacters && (
                    <Text size="xs" c="dimmed" mb={4}>
                      当前节点未直接连接角色，已自动引用同一工作流中的全部角色。
                    </Text>
                  )}
                  <Group align="flex-end" gap="xs" wrap="wrap">
                    <Select
                      label="替换模型"
                      size="xs"
                      withinPortal
                      data={rewriteModelOptions.length ? rewriteModelOptions : [{ value: 'glm-4.6', label: 'GLM-4.6' }]}
                      value={characterRewriteModel}
                      onChange={handleRewriteModelChange}
                      style={{ minWidth: 180 }}
                    />
                    <Button
                      size="xs"
                      variant="light"
                      loading={characterRewriteLoading}
                      onClick={() => { void handleApplyCharacterMentions() }}
                    >
                      一键替换 @引用
                    </Button>
                  </Group>
                  {characterRewriteError && (
                    <Text size="xs" c="red" mt={4}>
                      {characterRewriteError}
                    </Text>
                  )}
                </Paper>
              )}

              {isStoryboardNode ? (
                <StoryboardEditor
                  scenes={storyboardScenes}
                  title={storyboardTitle}
                  notes={storyboardNotes}
                  totalDuration={storyboardTotalDuration}
                  lightContentBackground={lightContentBackground}
                  onTitleChange={(value) => setStoryboardTitle(value)}
                  onAddScene={handleAddScene}
                  onRemoveScene={handleRemoveScene}
                  onDurationDelta={handleSceneDurationDelta}
                  onUpdateScene={updateStoryboardScene}
                  onNotesChange={(value) => setStoryboardNotes(value)}
                />
              ) : (
                <PromptSection
                  isCharacterNode={isCharacterNode}
                  isComposerNode={isComposerNode}
                  isStoryboardNode={isStoryboardNode}
                  hasSystemPrompt={hasSystemPrompt && !isMosaicNode}
                  prompt={prompt}
                  setPrompt={setPrompt}
                  onUpdateNodeData={(patch) => updateNodeData(id, patch)}
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
                  showSystemPrompt={showSystemPrompt}
                  systemPrompt={systemPrompt}
                  handleSystemPromptToggle={handleSystemPromptToggle}
                  handleSystemPromptChange={handleSystemPromptChange}
                  isDarkUi={isDarkUi}
                  nodeShellText={nodeShellText}
                  onOpenPromptSamples={() => setPromptSamplesOpen(true)}
                />
              )}
            </>
          )}
        </div>
      </NodeToolbar>
      <PromptSampleDrawer
        opened={promptSamplesOpen}
        nodeKind={kind}
        onClose={() => setPromptSamplesOpen(false)}
        onApplySample={handleApplyPromptSample}
      />
      {isMosaicNode && (
        <MosaicModal
          opened={mosaicModalOpen}
          mosaicGrid={mosaicGrid}
          mosaicLimit={mosaicLimit}
          mosaicSelected={mosaicSelected}
          mosaicPreviewLoading={mosaicPreviewLoading}
          mosaicPreviewUrl={mosaicPreviewUrl}
          mosaicPreviewError={mosaicPreviewError}
          availableImages={availableImages}
          darkCardShadow={darkCardShadow}
          mediaFallbackSurface={mediaFallbackSurface}
          inlineDividerColor={inlineDividerColor}
          accentPrimary={accentPrimary}
          rgba={rgba}
          onClose={() => setMosaicModalOpen(false)}
          onGridChange={(grid) => setMosaicGrid(grid)}
          onMoveItem={moveMosaicItem}
          onToggleImage={handleMosaicToggle}
          onSave={handleMosaicSave}
        />
      )}

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

      {hasImageResults && !isMosaicNode && poseEditorModal}

      {hasImageResults && !isMosaicNode && imageResults.length > 1 && (
        <ImageResultModal
          opened={imageExpanded}
          onClose={() => setImageExpanded(false)}
          images={imageResults}
          primaryIndex={imagePrimaryIndex}
          onSelectPrimary={(idx, url) => {
            setImagePrimaryIndex(idx)
            updateNodeData(id, { imageUrl: url, imagePrimaryIndex: idx })
            setImageExpanded(false)
          }}
          onPreview={(url) => {
            if (!url) return
            const openPreview = useUIStore.getState().openPreview
            openPreview({
              url,
              kind: 'image',
              name: data?.label || 'Image',
            })
          }}
          galleryCardBackground={galleryCardBackground}
          mediaFallbackSurface={mediaFallbackSurface}
        />
      )}

      {isVideoNode && videoExpanded && (
        <VideoResultModal
          opened={videoExpanded}
          onClose={() => setVideoExpanded(false)}
          videos={videoResults}
          primaryIndex={videoPrimaryIndex}
          onSelectPrimary={handleSetPrimaryVideo}
          onPreview={(video) => {
            const openPreview = useUIStore.getState().openPreview
            openPreview({
              url: video.url,
              thumbnailUrl: video.thumbnailUrl,
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
