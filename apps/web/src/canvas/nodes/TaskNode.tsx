import React from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position, NodeToolbar } from 'reactflow'
import { useRFStore } from '../store'
import { useUIStore } from '../../ui/uiStore'
import { ActionIcon, Group, Paper, Textarea, Menu, Button, Text, Modal, Stack, TextInput, Select, Loader, NumberInput, Badge, useMantineColorScheme, useMantineTheme } from '@mantine/core'
import {
  IconMaximize,
  IconDownload,
  IconArrowsDiagonal2,
  IconBrush,
  IconPhotoUp,
  IconDots,
  IconAdjustments,
  IconUpload,
  IconPlayerPlay,
  IconPlayerStop,
  IconTexture,
  IconVideo,
  IconArrowRight,
  IconScissors,
  IconPhotoEdit,
  IconDeviceTv,
  IconClock,
  IconChevronDown,
  IconBrain,
  IconBulb,
  IconDeviceMobile,
  IconRefresh,
  IconUsers,
  IconPlus,
  IconTrash,
  IconMovie,
} from '@tabler/icons-react'
import { listSoraMentions, markDraftPromptUsed, suggestDraftPrompts, uploadSoraImage, listModelProviders, listModelTokens, listSoraCharacters, runTaskByVendor, type ModelTokenDto, type PromptSampleDto, type TaskResultDto } from '../../api/server'
import {
  getModelLabel,
  getModelProvider,
  type NodeKind,
} from '../../config/models'
import { useModelOptions } from '../../config/useModelOptions'
import {
  StoryboardScene,
  createScene,
  normalizeStoryboardScenes,
  serializeStoryboardScenes,
  STORYBOARD_FRAMING_OPTIONS,
  STORYBOARD_MOVEMENT_OPTIONS,
  STORYBOARD_DURATION_STEP,
  STORYBOARD_MIN_DURATION,
  STORYBOARD_MAX_DURATION,
  STORYBOARD_MAX_TOTAL_DURATION,
  totalStoryboardDuration,
  scenesAreEqual,
  STORYBOARD_DEFAULT_DURATION,
  enforceStoryboardTotalLimit,
} from './storyboardUtils'
import { getTaskNodeSchema, type TaskNodeHandlesConfig } from './taskNodeSchema'
import { PromptSampleDrawer } from '../components/PromptSampleDrawer'
import { toast } from '../../ui/toast'

const RESOLUTION_OPTIONS = [
  { value: '16:9', label: '16:9' },
  { value: '1:1', label: '1:1' },
  { value: '9:16', label: '9:16' },
]

const BASE_DURATION_OPTIONS = [
  { value: '10', label: '10s' },
  { value: '15', label: '15s' },
]
const STORYBOARD_DURATION_OPTION = { value: '25', label: '25s' }

const ORIENTATION_OPTIONS = [
  { value: 'landscape', label: '横屏' },
  { value: 'portrait', label: '竖屏' },
]

const SAMPLE_OPTIONS = [1, 2, 3, 4, 5]

const genTaskNodeId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID()
  }
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const formatMentionInsertion = (full: string, offset: number, matchLength: number, mention: string) => {
  const prevChar = offset > 0 ? full[offset - 1] : ''
  const nextChar = offset + matchLength < full.length ? full[offset + matchLength] : ''
  const needsLeadingSpace = prevChar ? !/\s/.test(prevChar) : false
  const needsTrailingSpace = nextChar ? !/\s/.test(nextChar) : false
  const leading = needsLeadingSpace ? ' ' : ''
  const trailing = needsTrailingSpace ? ' ' : ''
  return `${leading}${mention}${trailing}`
}

const applyMentionFallback = (text: string, mention: string, aliases: string[]) => {
  let result = text
  let replaced = false
  const uniqueAliases = Array.from(new Set(aliases.filter((alias) => alias && alias.trim().length > 0)))
  uniqueAliases.forEach((alias) => {
    const regex = new RegExp(escapeRegExp(alias), 'gi')
    if (regex.test(result)) {
      result = result.replace(regex, (match, offset, full) => {
        const source = typeof full === 'string' ? full : result
        const off = typeof offset === 'number' ? offset : 0
        return formatMentionInsertion(source, off, match.length, mention)
      })
      replaced = true
    }
  })
  if (!replaced && mention) {
    if (!result.includes(mention)) {
      const trimmedEnd = result.replace(/\s+$/, '')
      const needsSpaceBefore = trimmedEnd.length > 0 && !/\s$/.test(trimmedEnd)
      result = `${trimmedEnd}${needsSpaceBefore ? ' ' : ''}${mention} `
      replaced = true
    }
  }
  return { text: result, replaced }
}

const extractTextFromTaskResult = (task?: TaskResultDto | null): string => {
  if (!task) return ''
  const raw = task.raw as any
  if (raw && typeof raw.text === 'string' && raw.text.trim()) {
    return raw.text.trim()
  }
  const candidates = raw?.response?.candidates
  if (Array.isArray(candidates) && candidates.length > 0) {
    const parts = candidates[0]?.content?.parts
    if (Array.isArray(parts)) {
      const combined = parts
        .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
        .join('')
        .trim()
      if (combined) return combined
    }
  }
  return ''
}

const isDynamicHandlesConfig = (
  handles?: TaskNodeHandlesConfig | null,
): handles is { dynamic: true } => Boolean(handles && 'dynamic' in handles && handles.dynamic)

const isStaticHandlesConfig = (
  handles?: TaskNodeHandlesConfig | null,
): handles is Exclude<TaskNodeHandlesConfig, { dynamic: true }> =>
  Boolean(handles && (!('dynamic' in handles) || !handles.dynamic))

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
  const { colorScheme } = useMantineColorScheme()
  const theme = useMantineTheme()
  const isDarkUi = colorScheme === 'dark'
  const rgba = (color: string, alpha: number) => typeof theme.fn?.rgba === 'function' ? theme.fn.rgba(color, alpha) : color
  const nodeShellBackground = isDarkUi ? rgba(theme.colors.dark[7], 0.9) : theme.white
  const nodeShellBorder = `1px solid ${isDarkUi ? theme.colors.dark[4] : theme.colors.gray[3]}`
  const nodeShellText = isDarkUi ? theme.white : theme.colors.gray[8] // 使用更深的颜色提高日间模式对比度
  const nodeShellMuted = isDarkUi ? theme.colors.gray[4] : theme.colors.gray[7] // 提高日间模式下次要文本的对比度
  const quickActionBackgroundActive = isDarkUi ? rgba(theme.white, 0.08) : rgba(theme.colors.gray[1], 0.8)
  const quickActionIconColor = nodeShellMuted
  const quickActionIconActive = nodeShellText
  const quickActionHint = nodeShellMuted
  const quickActionDividerColor = rgba(nodeShellText, 0.65)
  const mediaCardBackground = isDarkUi ? theme.colors.dark[8] : theme.white
  const mediaOverlayBackground = isDarkUi ? rgba(theme.colors.dark[7], 0.85) : rgba(theme.colors.gray[0], 0.95)
  const mediaOverlayText = nodeShellText
  const overlayCardBorder = `1px solid ${isDarkUi ? theme.colors.gray[4] : theme.colors.gray[3]}`
  const subtleOverlayBackground = isDarkUi ? rgba(theme.colors.dark[5], 0.6) : rgba(theme.colors.gray[3], 0.3)
  const mediaFallbackSurface = isDarkUi ? theme.colors.dark[9] : theme.colors.gray[0]
  const mediaFallbackText = isDarkUi ? theme.colors.gray[3] : theme.colors.gray[7] // 提高日间模式下媒体回退文本的对比度
  const videoSurface = isDarkUi ? theme.colors.dark[6] : theme.colors.gray[2]
  const summaryBarBackground = isDarkUi ? theme.colors.dark[8] : theme.colors.gray[0]
  const summaryBarBorder = `1px solid ${isDarkUi ? rgba(theme.white, 0.1) : theme.colors.gray[3]}`
  const summaryChipAccent = theme.colors.violet?.[5] || theme.colors.blue[5]
  const summaryChipBackground = isDarkUi ? rgba(summaryChipAccent, 0.4) : rgba(summaryChipAccent, 0.1)
  const summaryChipBorder = `1px solid ${isDarkUi ? rgba(summaryChipAccent, 0.85) : rgba(summaryChipAccent, 0.4)}`
  const summaryChipShadow = isDarkUi ? '0 12px 25px rgba(0, 0, 0, 0.45)' : '0 6px 16px rgba(84, 58, 255, 0.12)'
  const summaryChipColor = theme.white // 在日间和dark模式下都使用白色文字，保持一致
  const summaryChipStyles = React.useMemo(() => ({
    background: summaryChipBackground,
    borderRadius: 999,
    border: summaryChipBorder,
    color: summaryChipColor,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    boxShadow: summaryChipShadow,
    transition: 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease'
  }), [summaryChipBackground, summaryChipBorder, summaryChipColor, summaryChipShadow])
  const galleryCardBackground = isDarkUi ? rgba(theme.colors.dark[7], 0.95) : theme.white
  const galleryBorderDefault = `1px solid ${isDarkUi ? rgba(theme.white, 0.2) : theme.colors.gray[3]}`
  const galleryBorderActive = `2px solid ${isDarkUi ? theme.colors.blue[4] : theme.colors.blue[6]}`
  const suggestionHighlight = isDarkUi ? rgba(theme.colors.gray[4], 0.35) : rgba(theme.colors.blue[2], 0.35)
  const placeholderIconColor = nodeShellText
  // 主题适配的深色内容块背景
  const darkContentBackground = isDarkUi ? rgba(theme.colors.dark[8], 0.9) : rgba(theme.colors.gray[1], 0.95)
  const darkContentBorder = isDarkUi ? rgba(theme.colors.gray[6], 0.7) : rgba(theme.colors.gray[4], 0.7)
  const darkCardShadow = isDarkUi ? '0 10px 25px rgba(0, 0, 0, 0.55)' : '0 4px 12px rgba(0, 0, 0, 0.1)'
  const lightContentBackground = isDarkUi ? rgba(theme.colors.dark[8], 0.4) : rgba(theme.colors.gray[2], 0.8)
  const lightContentBorder = isDarkUi ? rgba(theme.colors.gray[6], 0.7) : rgba(theme.colors.gray[4], 0.7)

  const kind = data?.kind
  const schema = React.useMemo(() => getTaskNodeSchema(kind), [kind])
  const schemaFeatures = React.useMemo(() => new Set(schema.features), [schema])
  const isStoryboardNode = schema.category === 'storyboard'
  const isComposerNode = schema.category === 'composer' || isStoryboardNode
  const isVideoNode = schemaFeatures.has('video') || isComposerNode
  const isImageNode = schema.category === 'image'
  const isCharacterNode = schema.category === 'character'
  const isAudioNode = kind === 'tts'
  const targets: { id: string; type: string; pos: Position }[] = []
  const sources: { id: string; type: string; pos: Position }[] = []
  const schemaHandles = schema.handles
  if (isDynamicHandlesConfig(schemaHandles)) {
    if (kind === 'subflow') {
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

  const [editing, setEditing] = React.useState(false)
  const updateNodeLabel = useRFStore(s => s.updateNodeLabel)
  const openSubflow = useUIStore(s => s.openSubflow)
  const openParamFor = useUIStore(s => s.openParamFor)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const runSelected = useRFStore(s => s.runSelected)
  const cancelNodeExecution = useRFStore(s => s.cancelNode)
  const setNodeStatus = useRFStore(s => s.setNodeStatus)
  const updateNodeData = useRFStore(s => s.updateNodeData)
  const addNode = useRFStore(s => s.addNode)
  const addEdge = useRFStore(s => s.onConnect)
  const [prompt, setPrompt] = React.useState<string>((data as any)?.prompt || '')
  const [aspect, setAspect] = React.useState<string>((data as any)?.aspect || '16:9')
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

  const [systemPrompt, setSystemPrompt] = React.useState<string>(
    (data as any)?.systemPrompt || '你是一个提示词优化助手。请在保持核心意图不变的前提下润色、缩短并结构化下面的提示词，用于后续多模态生成。',
  )

  const [showSystemPrompt, setShowSystemPrompt] = React.useState<boolean>(
    (data as any)?.showSystemPrompt || false,
  )

  const nodesForCharacters = useRFStore(s => s.nodes)
  const edgesForCharacters = useRFStore(s => s.edges)
  const selectedCount = React.useMemo(() => nodesForCharacters.reduce((acc, n) => acc + (n.selected ? 1 : 0), 0), [nodesForCharacters])
  const fileRef = React.useRef<HTMLInputElement|null>(null)
  const imageUrl = (data as any)?.imageUrl as string | undefined
  const soraFileId = (data as any)?.soraFileId as string | undefined
  const [uploading, setUploading] = React.useState(false)
  const imageResults = React.useMemo(() => {
    const raw = (data as any)?.imageResults as { url: string }[] | undefined
    if (raw && Array.isArray(raw) && raw.length > 0) return raw
    const single = imageUrl || null
    return single ? [{ url: single }] : []
  }, [data, imageUrl])
  const [imageExpanded, setImageExpanded] = React.useState(false)
  const [imagePrimaryIndex, setImagePrimaryIndex] = React.useState(0)
  const [imageSelectedIndex, setImageSelectedIndex] = React.useState(0)
  const videoUrl = (data as any)?.videoUrl as string | undefined
  const videoThumbnailUrl = (data as any)?.videoThumbnailUrl as string | undefined
  const videoTitle = (data as any)?.videoTitle as string | undefined

  // Video history results (similar to imageResults)
  const videoResults = React.useMemo(() => {
    const raw = (data as any)?.videoResults as {
      url: string;
      thumbnailUrl?: string;
      title?: string;
      duration?: number;
      createdAt?: string;
    }[] | undefined
    if (raw && Array.isArray(raw) && raw.length > 0) return raw
    const single = videoUrl ? {
      url: videoUrl,
      thumbnailUrl: videoThumbnailUrl,
      title: videoTitle,
      duration: (data as any)?.videoDuration
    } : null
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
  const [videoSelectedIndex, setVideoSelectedIndex] = React.useState(0)
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
  const [imageModel, setImageModel] = React.useState<string>((data as any)?.imageModel || 'qwen-image-plus')
  const [videoModel, setVideoModel] = React.useState<string>((data as any)?.videoModel || 'sora-2')
  const [videoDuration, setVideoDuration] = React.useState<number>(() => {
    const raw = Number((data as any)?.videoDurationSeconds)
    if (!Number.isNaN(raw) && raw > 0) {
      return raw
    }
    return isStoryboardNode ? STORYBOARD_MAX_TOTAL_DURATION : 10
  })
  const [orientation, setOrientation] = React.useState<'portrait' | 'landscape'>(
    (data as any)?.orientation || 'landscape'
  )

  const activeModelKey = isImageNode
        ? imageModel
        : isVideoNode
          ? videoModel
          : modelKey
  const modelList = useModelOptions(kind as NodeKind)
  const rewriteModelOptions = useModelOptions('text')
  const showTimeMenu = isVideoNode
  const showResolutionMenu = isVideoNode || isImageNode
  const showOrientationMenu = isVideoNode
  React.useEffect(() => {
    if (!modelList.some((m) => m.value === activeModelKey) && modelList.length) {
      const first = modelList[0].value
      setModelKey(first)
      setImageModel(first)
      setVideoModel(first)
      updateNodeData(id, {
        geminiModel: first,
        imageModel: first,
        videoModel: first,
      })
    }
  }, [activeModelKey, modelList, id])
  const summaryModelLabel = getModelLabel(kind, activeModelKey)
  const summaryDuration =
    isVideoNode
      ? `${videoDuration}s`
      : `${sampleCount}x`
  const summaryResolution = aspect
  const summaryExec = `${sampleCount}x`
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
    patch.prompt = nextPrompt
    if (isImageNode || isComposerNode) {
      patch.aspect = aspect
    }
    if (isImageNode) {
      patch.imageModel = imageModel
      patch.sampleCount = sampleCount
    }
    if (isComposerNode) {
      patch.sampleCount = sampleCount
      patch.videoModel = videoModel
      patch.videoDurationSeconds = videoDuration
      patch.orientation = orientation
      // Include upstream Sora file_id if available
      if (upstreamSoraFileId) {
        patch.inpaintFileId = upstreamSoraFileId
      }
    }
    if (schema.kind === 'video') {
      patch.orientation = orientation
      // Include upstream Sora file_id if available
      if (upstreamSoraFileId) {
        patch.inpaintFileId = upstreamSoraFileId
      }
    }
    if (isImageNode) {
      setPrompt(nextPrompt)
    }
    updateNodeData(id, patch)
    runSelected()
  }
  const [mentionOpen, setMentionOpen] = React.useState(false)
  const [mentionFilter, setMentionFilter] = React.useState('')
  const [mentionItems, setMentionItems] = React.useState<any[]>([])
  const [mentionLoading, setMentionLoading] = React.useState(false)
  const mentionMetaRef = React.useRef<{ at: number; caret: number } | null>(null)
  const rewriteRequestIdRef = React.useRef(0)
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
  const characterRefs = React.useMemo(() => {
    return nodesForCharacters
      .filter((node) => (node.data as any)?.kind === 'character')
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
    const task = await runTaskByVendor(vendor, {
      kind: 'prompt_refine',
      prompt: instructions,
      extras: { systemPrompt, modelKey: modelValue },
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
    updateNodeData(id, {
      videoPrimaryIndex: idx,
      videoUrl: target.url,
      videoThumbnailUrl: target.thumbnailUrl,
      videoTitle: target.title,
      videoDuration: target.duration,
    })
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
  const refreshCharacters = React.useCallback(() => {
    if (!selectedCharacterTokenId) return
    fetchCharacters()
  }, [fetchCharacters, selectedCharacterTokenId])
  const loadMoreCharacters = React.useCallback(() => {
    if (!selectedCharacterTokenId || !characterCursor) return
    fetchCharacters({ cursor: characterCursor, append: true })
  }, [characterCursor, fetchCharacters, selectedCharacterTokenId])
  const { upstreamText, upstreamImageUrl, upstreamVideoUrl, upstreamSoraFileId } = useRFStore((s) => {
    const edgesToThis = s.edges.filter((e) => e.target === id)
    if (!edgesToThis.length) return { upstreamText: null as string | null, upstreamImageUrl: null as string | null, upstreamVideoUrl: null as string | null, upstreamSoraFileId: null as string | null }
    const last = edgesToThis[edgesToThis.length - 1]
    const src = s.nodes.find((n) => n.id === last.source)
    if (!src) return { upstreamText: null, upstreamImageUrl: null, upstreamVideoUrl: null, upstreamSoraFileId: null }
    const sd: any = src.data || {}
    const skind: string | undefined = sd.kind
    const uText =
      skind === 'image'
        ? (sd.prompt as string | undefined) || (sd.label as string | undefined) || null
        : null

    // 获取最新的主图片 URL
    let uImg = null
    let uSoraFileId = null
    if (skind === 'image') {
      uImg = (sd.imageUrl as string | undefined) || null
      uSoraFileId = (sd.soraFileId as string | undefined) || null
    } else if ((skind === 'video' || skind === 'composeVideo' || skind === 'storyboard') && sd.videoResults && sd.videoResults.length > 0 && sd.videoPrimaryIndex !== undefined) {
      // 对于video节点，优先获取主视频的缩略图作为上游图片
      uImg = sd.videoResults[sd.videoPrimaryIndex]?.thumbnailUrl || sd.videoResults[0]?.thumbnailUrl
    }

    // 获取最新的主视频 URL
    let uVideo = null
    if (skind === 'video' || skind === 'composeVideo' || skind === 'storyboard') {
      if (sd.videoResults && sd.videoResults.length > 0 && sd.videoPrimaryIndex !== undefined) {
        uVideo = sd.videoResults[sd.videoPrimaryIndex]?.url || sd.videoResults[0]?.url
      } else {
        uVideo = (sd.videoUrl as string | undefined) || null
      }
    }

    return { upstreamText: uText, upstreamImageUrl: uImg, upstreamVideoUrl: uVideo, upstreamSoraFileId: uSoraFileId }
  })

  React.useEffect(() => {
    if (kind !== 'character') {
      setCharacterTokens([])
      setCharacterTokenError(null)
      setCharacterTokensLoading(false)
      return
    }
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
  }, [kind])

  React.useEffect(() => {
    if (kind !== 'character') return
    setCharacterError(null)
    setCharacterList([])
    setCharacterCursor(null)
    if (!selectedCharacterTokenId) return
    fetchCharacters()
  }, [fetchCharacters, kind, selectedCharacterTokenId])

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

  // Define node-specific tools and overflow calculation
  const uniqueDefs = React.useMemo(() => {
    if (isCharacterNode) {
      return [
        { key: 'assets', label: '角色库', icon: <IconUsers size={16} />, onClick: () => setActivePanel('assets') },
        { key: 'refresh', label: '刷新', icon: <IconRefresh size={16} />, onClick: () => refreshCharacters() },
      ] as { key: string; label: string; icon: JSX.Element; onClick: () => void }[]
    }
    if (isImageNode) {
      return [
        // image 节点顶部工具条：只保留节点级的「图片编辑器」操作，避免和结果区工具条重复
        { key: 'editor', label: '图片编辑器', icon: <IconPhotoEdit size={16} />, onClick: () => {} },
      ] as { key: string; label: string; icon: JSX.Element; onClick: () => void }[]
    }
    // default tools for other node kinds (kept minimal)
    return [
      { key: 'extend', label: '扩展', icon: <IconArrowsDiagonal2 size={16} />, onClick: () => {} },
      { key: 'params', label: '参数', icon: <IconAdjustments size={16} />, onClick: () => openParamFor(id) },
    ] as { key: string; label: string; icon: JSX.Element; onClick: () => void }[]
  }, [id, isCharacterNode, isImageNode, openParamFor, refreshCharacters, setActivePanel])

  const maxTools = 5
  const commonLen = 2
  const reserveForMore = uniqueDefs.length > (maxTools - commonLen) ? 1 : 0
  const maxUniqueVisible = Math.max(0, maxTools - commonLen - reserveForMore)
  const visibleDefs = uniqueDefs.slice(0, maxUniqueVisible)
  const extraDefs = uniqueDefs.slice(maxUniqueVisible)

  const hasContent = React.useMemo(() => {
    if (isImageNode) return Boolean(imageUrl)
    if (isVideoNode) return Boolean((data as any)?.videoUrl)
    if (kind === 'tts') return Boolean((data as any)?.audioUrl)
    if (isCharacterNode) return Boolean(characterPrimaryImage)
    return false
  }, [isImageNode, isVideoNode, imageUrl, data, kind, characterPrimaryImage])

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
        nextId: s.nextId + 1,
      }
    })
  }

  const fixedWidth = isImageNode ? 320 : undefined
  const hasPrompt = ((prompt || (data as any)?.prompt || upstreamText || '')).trim().length > 0
  const hasAiText = lastText.trim().length > 0

  const edgeRoute = useUIStore(s => s.edgeRoute)

  const connectFromText = (targetKind: 'image' | 'video') => {
    const all = useRFStore.getState().nodes
    const self = all.find((n: any) => n.id === id)
    if (!self) return
    const pos = { x: self.position.x + 260, y: self.position.y }
    useRFStore.setState((s: any) => {
      const newId = genTaskNodeId()
      const label = targetKind === 'image' ? 'Image' : 'Video'
      const newKind = targetKind === 'image' ? 'image' : 'composeVideo'
      const basePrompt = (self.data as any)?.prompt as string | undefined
      const nodeData: any = {
        label,
        kind: newKind,
        // 继承文本节点的生成次数配置，用于多次生成图像/视频
        sampleCount: (self.data as any)?.sampleCount,
      }
      if (basePrompt && basePrompt.trim()) nodeData.prompt = basePrompt
      const node = { id: newId, type: 'taskNode', position: pos, data: nodeData }
      const edgeId = `e-${id}-${newId}-${Date.now().toString(36)}`
      const targetHandle = 'in-image'
      const edge: any = {
        id: edgeId,
        source: id,
        target: newId,
        sourceHandle: 'out-any',
        targetHandle,
        type: (edgeRoute === 'orth' ? 'orth' : 'typed') as any,
        animated: true,
      }
      return { nodes: [...s.nodes, node], edges: [...s.edges, edge], nextId: s.nextId + 1 }
    })
  }

  // Handle image upload with Sora API
  const handleImageUpload = async (file: File) => {
    if (kind !== 'image') return

    try {
      setUploading(true)

      // First, create a local URL for immediate preview
      const localUrl = URL.createObjectURL(file)
      updateNodeData(id, { imageUrl: localUrl })

      // Then upload to Sora to get file_id
      const result = await uploadSoraImage(undefined, file) // Use default token for now

      if (result.file_id) {
        updateNodeData(id, {
          soraFileId: result.file_id,
          assetPointer: result.asset_pointer
        })

        // 静默保存项目状态
        if ((window as any).silentSaveProject) {
          (window as any).silentSaveProject()
        }
      }
    } catch (error) {
      console.error('Failed to upload image to Sora:', error)
      // Keep the local URL even if upload fails
    } finally {
      setUploading(false)
    }
  }
    const defaultLabel = React.useMemo(() => {
    if (isComposerNode || schema.kind === 'video') return '文生视频'
    if (isImageNode) return '图像节点'
    if (kind === 'audio') return '音频节点'
    if (kind === 'subtitle') return '字幕节点'
    return 'Task'
  }, [kind])
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

  return (
    <div style={{
      border: nodeShellBorder,
      borderRadius: 12,
      padding: '10px 12px',
      background: nodeShellBackground,
      color: nodeShellText,
      width: fixedWidth
    }}>
      {/* Title */}
      <div style={{ fontSize: 12, fontWeight: 600, color: nodeShellText, marginBottom: 6 }}>
        {editing ? (
          <TextInput
            ref={labelInputRef}
            size="xs"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.currentTarget.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                commitLabel()
              } else if (e.key === 'Escape') {
                setLabelDraft(currentLabel)
                setEditing(false)
              }
            }}
          />
        ) : (
          <Group justify="space-between" gap={4}>
            <span onDoubleClick={() => setEditing(true)} title="Double-click to rename">
              {currentLabel}
            </span>
            <ActionIcon size="sm" variant="subtle" color="gray" title="Rename" onClick={() => setEditing(true)}>
              <IconBrush size={12} />
            </ActionIcon>
          </Group>
        )}
      </div>
      {/* Top floating toolbar anchored to node */}
      <NodeToolbar isVisible={!!selected && selectedCount === 1 && hasContent} position={Position.Top} align="center">
        <div ref={moreRef} style={{ position: 'relative', display: 'inline-block' }} data-more-root>
          <Paper withBorder shadow="sm" radius="xl" className="glass" p={4}>
            <Group gap={6}>
            <ActionIcon key="preview" variant="subtle" title="放大预览" onClick={()=>{
              const url =
                isCharacterNode
                  ? characterPrimaryImage || undefined
                  : (isImageNode)
                    ? (imageUrl || (data as any)?.imageUrl)
                    : isVideoNode
                      ? (data as any)?.videoUrl
                      : (isAudioNode ? (data as any)?.audioUrl : undefined)
              const k: any =
                isCharacterNode
                  ? 'image'
                  : isAudioNode
                    ? 'audio'
                    : isVideoNode
                      ? 'video'
                      : 'image'
              if (url) useUIStore.getState().openPreview({ url, kind: k, name: data?.label })
            }}><IconMaximize size={16} /></ActionIcon>
            <ActionIcon key="download" variant="subtle" title="下载" onClick={()=>{
              const url =
                isCharacterNode
                  ? characterPrimaryImage || undefined
                  : (isImageNode )
                    ? (imageUrl || (data as any)?.imageUrl)
                    : isVideoNode
                      ? (data as any)?.videoUrl
                      : (isAudioNode ? (data as any)?.audioUrl : undefined)
              if (!url) return
              const a = document.createElement('a')
              a.href = url
              a.download = `${(data?.label || kind)}-${Date.now()}`
              document.body.appendChild(a)
              a.click()
              a.remove()
            }}><IconDownload size={16} /></ActionIcon>
            {visibleDefs.length > 0 && <span style={{ color: quickActionDividerColor, padding: '0 6px', userSelect: 'none' }}>|</span>}
            {visibleDefs.map(d => (
              <Button key={d.key} size="xs" variant="subtle" leftSection={d.icon} onClick={d.onClick}>{d.label}</Button>
            ))}
            {extraDefs.length > 0 && (
              <ActionIcon variant="subtle" title="更多" onClick={(e)=>{ e.stopPropagation(); setShowMore(v=>!v) }}><IconDots size={16} /></ActionIcon>
            )}
          </Group>
        </Paper>
          {showMore && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 2 }}>
              <Paper withBorder shadow="md" radius="md" className="glass" p="xs" style={{ width: 260 }}>
                <Text size="xs" c="dimmed" mb={6}>更多</Text>
                <Group wrap="wrap" gap={6}>
                  {extraDefs.map(d => (
                    <Button key={d.key} size="xs" variant="subtle" leftSection={<>{d.icon}</>} onClick={()=>{ setShowMore(false); d.onClick() }}>{d.label}</Button>
                  ))}
                </Group>
              </Paper>
            </div>
          )}
        </div>
      </NodeToolbar>
      {targets.map(h => (
        <Handle
          key={h.id}
          id={h.id}
          type="target"
          position={h.pos}
          style={{ left: h.pos===Position.Left? -6: undefined, right: h.pos===Position.Right? -6: undefined }}
          data-handle-type={h.type}
          title={`输入: ${h.type}`}
        />
      ))}
      {/* Content Area for Character/Image/Video/Text kinds */}
      {isCharacterNode && (
        <div style={{ position: 'relative', marginTop: 6 }}>
          {characterPrimaryImage ? (
            <div
              style={{
                borderRadius: 10,
                overflow: 'hidden',
                border: '1px solid rgba(148,163,184,0.5)',
                position: 'relative',
                background: mediaCardBackground,
              }}
            >
              <img
                src={characterPrimaryImage}
                alt={selectedCharacter?.displayName || 'Sora 角色'}
                style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: '12px 12px 10px',
                  background: 'linear-gradient(0deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.0) 80%)',
                  color: '#fff',
                }}
              >
                <Text size="sm" fw={600} style={{ marginBottom: 2 }}>
                  {selectedCharacter?.displayName || 'Sora 角色'}
                </Text>
                {selectedCharacter?.username && (
                  <Text size="xs" c="dimmed">
                    @{selectedCharacter.username}
                  </Text>
                )}
              </div>
              <Button
                size="xs"
                variant="light"
                style={{ position: 'absolute', top: 8, right: 8 }}
                onClick={() => setActivePanel('assets')}
              >
                管理角色
              </Button>
            </div>
          ) : (
            <Paper
              withBorder
              radius="md"
              p="md"
              style={{
                minHeight: 140,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                textAlign: 'center',
              }}
            >
              <IconUsers size={28} style={{ color: placeholderIconColor }} />
              <Text size="sm" c="dimmed">
                选择一个 Sora 角色，封面将显示在此处并可连接到视频节点。
              </Text>
              <Group gap={6}>
                <Button size="xs" variant="light" onClick={() => setActivePanel('assets')}>
                  打开资产面板
                </Button>
                <Button size="xs" variant="subtle" onClick={refreshCharacters} disabled={!selectedCharacterTokenId}>
                  刷新角色
                </Button>
              </Group>
            </Paper>
          )}
        </div>
      )}
      {isImageNode && (
        <div style={{ position: 'relative', marginTop: 6 }}>
          {imageResults.length === 0 ? (
            <>
              {/* 快捷操作列表，增强引导 */}
              <div style={{ width: 296, display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 2px' }} onMouseLeave={()=>setHovered(null)}>
                {[
                  { label: '上传图片并编辑', icon: <IconUpload size={16} />, onClick: () => fileRef.current?.click(), hint: '图片大小不能超过30MB' },
                  { label: '图片换背景', icon: <IconTexture size={16} />, onClick: () => connectToRight('image','Image') },
                  { label: '图生视频', icon: <IconVideo size={16} />, onClick: () => connectToRight('video','Video') },
                                                                          ].map((row, idx) => {
                  const active = hovered === idx
                  const dimOthers = hovered !== null && hovered !== idx
                  return (
                    <div key={row.label}
                      onMouseEnter={()=>setHovered(idx)}
                      onClick={row.onClick}
                      style={{
                        cursor: 'pointer',
                        padding: '8px 10px', borderRadius: 6,
                        background: active ? quickActionBackgroundActive : 'transparent',
                        transition: 'background .12s ease, opacity .12s ease',
                        opacity: dimOthers ? 0.8 : 1,
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ color: active ? quickActionIconActive : quickActionIconColor }}>{row.icon}</div>
                        <div style={{ flex: 1, color: nodeShellText, fontSize: 13 }}>{row.label}</div>
                        <div style={{ color: active ? quickActionIconActive : 'transparent', transition: 'color .12s ease', width: 16, display: 'flex', justifyContent: 'center' }}>
                          <IconArrowRight size={14} />
                        </div>
                      </div>
                      {active && idx === 0 && (
                        <div style={{ marginLeft: 36, marginTop: 4, color: quickActionHint, fontSize: 11 }}>
                          图片大小不能超过30MB
                        </div>
                      )}
                    </div>
                  )
                })}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e)=>{
                  const f = e.currentTarget.files?.[0]
                  if (!f) return
                  await handleImageUpload(f)
                }} />
              </div>
            </>
          ) : (
            <div style={{ position: 'relative', width: 296 }}>
              {/* 背后影子卡片，暗示多图 */}
              {imageResults.length > 1 && (
                <div
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: 8,
                    width: '100%',
                    borderRadius: 10,
                    height: '100%',
                    background: darkContentBackground,
                    border: `1px solid ${darkContentBorder}`,
                    transform: 'translate(4px, 4px)',
                    zIndex: 0,
                  }}
                />
              )}
              <div
                style={{
                  position: 'relative',
                  borderRadius: 10,
                  overflow: 'hidden',
                  boxShadow: darkCardShadow,
                  border: '1px solid rgba(148,163,184,0.8)',
                  background: mediaFallbackSurface,
                }}
              >
                <img
                  src={imageResults[imagePrimaryIndex]?.url}
                  alt="主图"
                  style={{
                    width: '100%',
                    height: 'auto',
                    display: 'block',
                    objectFit: 'cover',
                  }}
                />
                {/* 主图替换按钮 */}
                <ActionIcon
                  size={28}
                  variant="light"
                  style={{ position: 'absolute', right: 8, top: 8 }}
                  title="替换图片"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <div style={{
                      width: 14,
                      height: 14,
                      border: `2px solid ${nodeShellText}`,
                      borderTop: '2px solid transparent',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                    }} />
                  ) : (
                    <IconUpload size={14} />
                  )}
                </ActionIcon>
                {/* Sora file_id indicator */}
                {soraFileId && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 8,
                        top: 8,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(34, 197, 94, 0.9)',
                        color: theme.white,
                        fontSize: '10px',
                        fontWeight: 500,
                      }}
                    title={`Sora File ID: ${soraFileId}`}
                  >
                    ✓ Sora
                  </div>
                )}
                {/* 数量 + 展开标签 */}
                {imageResults.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setImageExpanded(true)}
                    style={{
                      position: 'absolute',
                      right: 8,
                      bottom: 8,
                      padding: '2px 8px',
                      borderRadius: 999,
                      border: 'none',
                      background: mediaOverlayBackground,
                      color: mediaOverlayText,
                      fontSize: 11,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      cursor: 'pointer',
                    }}
                  >
                    <span>{imageResults.length}</span>
                    <IconChevronDown size={12} />
                  </button>
                )}
              </div>
            <input
              ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.currentTarget.files?.[0]
                  if (!f) return
                  await handleImageUpload(f)
                }}
              />
            </div>
          )}
          {!imageUrl && upstreamText && (
            <div
              style={{
                marginTop: 6,
                width: 296,
                maxHeight: 80,
                borderRadius: 8,
                border: '1px dashed rgba(148,163,184,0.6)',
                background: subtleOverlayBackground,
                padding: '6px 8px',
                color: mediaOverlayText,
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                overflowY: 'auto',
              }}
            >
              {upstreamText}
            </div>
          )}
        </div>
      )}
      {isVideoNode && (
        <div
          style={{
            marginTop: 6,
            width: 296,
            minHeight: 160,
            borderRadius: 10,
            border: '1px solid rgba(148,163,184,0.6)',
            background: mediaOverlayBackground,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            color: mediaOverlayText,
          }}
        >
          {/* Video results toolbar */}
          <Group justify="space-between" gap={4}>
            <Text size="xs" c="dimmed">
              {videoResults.length > 0
                ? `共 ${videoResults.length} 个视频${videoPrimaryIndex >= 0 ? ` (主视频: 第 ${videoPrimaryIndex + 1} 个)` : ''}`
                : '视频生成中...'
              }
            </Text>
            <Group gap={2}>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => setVideoExpanded(true)}
                leftSection={<IconClock size={12} />}
              >
                {videoResults.length > 0 ? '选择主视频' : '查看历史'}
              </Button>
            </Group>
          </Group>

          {videoUrl ? (
            <video
              src={videoResults[videoPrimaryIndex]?.url || videoUrl}
              poster={videoResults[videoPrimaryIndex]?.thumbnailUrl || videoThumbnailUrl || undefined}
              controls
              loop
              muted
              playsInline
              style={{
                borderRadius: 8,
                width: '100%',
                height: 160,
                objectFit: 'cover',
                backgroundColor: videoSurface,
              }}
            />
          ) : (
            <div
              style={{
                height: 160,
                borderRadius: 8,
                border: '1px dashed rgba(148,163,184,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: mediaFallbackText,
                fontSize: 12,
              }}
            >
              等待 Sora 视频生成完成…
            </div>
          )}
          {videoTitle && (
            <Text size="xs" lineClamp={1} c="dimmed">
              {videoTitle}
            </Text>
          )}
        </div>
      )}
            {/* remove bottom kind text for all nodes */}
      {/* Removed bottom tag list; top-left label identifies node type */}
      {status === 'running' && (
        <div style={{ marginTop: 6, height: 6, background: 'rgba(127,127,127,.25)', borderRadius: 4 }}>
          <div style={{ width: `${Math.min(100, Math.max(0, data?.progress ?? 0))}%`, height: '100%', background: color, borderRadius: 4 }} />
        </div>
      )}
      {sources.map(h => (
        <Handle
          key={h.id}
          id={h.id}
          type="source"
          position={h.pos}
          style={{ right: h.pos===Position.Right? -6: undefined, left: h.pos===Position.Left? -6: undefined }}
          data-handle-type={h.type}
          title={`输出: ${h.type}`}
        />
      ))}

      {/* Bottom detail panel near node */}
      <NodeToolbar isVisible={!!selected && selectedCount === 1} position={Position.Bottom} align="center">
        <Paper
          withBorder
          shadow="md"
          radius="md"
          className="glass"
          p="sm"
          style={{
            width: 420,
            maxHeight: '60vh',
            overflowY: 'auto',
            overflowX: 'visible',
            transformOrigin: 'top center',
          }}
        >
          <div
            style={{
              background: summaryBarBackground,
              borderRadius: 8,
              padding: '6px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              marginBottom: 8,
              border: summaryBarBorder,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Menu withinPortal position="bottom-start" transition="pop-top-left">
                <Menu.Target>
                  <button
                    type="button"
                    style={{
                      ...summaryChipStyles,
                      minWidth: 150,
                    }}
                  >
                    <IconBrush size={14} />
                    <span>{summaryModelLabel}</span>
                    <IconArrowRight size={12} />
                  </button>
                </Menu.Target>
                <Menu.Dropdown>
                  {modelList.map((option) => (
                    <Menu.Item
                      key={option.value}
                      onClick={() => {
                        setModelKey(option.value)
                        setImageModel(option.value)
                        setVideoModel(option.value)
                        updateNodeData(id, {
                          geminiModel: option.value,
                          imageModel: option.value,
                          videoModel: option.value,
                        })
                      }}
                    >
                      {option.label}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
              {showTimeMenu && (
                <Menu withinPortal position="bottom-start" transition="pop-top-left">
                <Menu.Target>
                  <button
                    type="button"
                    style={{
                      ...summaryChipStyles,
                      minWidth: 100,
                    }}
                  >
                      <IconClock size={14} />
                      <span>{summaryDuration}</span>
                      <IconArrowRight size={12} />
                    </button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {durationOptions.map((option) => (
                      <Menu.Item
                        key={option.value}
                        onClick={() => {
                          const num = Number(option.value)
                          setVideoDuration(num)
                          updateNodeData(id, { videoDurationSeconds: num })
                        }}
                      >
                        {option.label}
                      </Menu.Item>
                    ))}
                  </Menu.Dropdown>
                </Menu>
              )}
              {showResolutionMenu && (
                <Menu withinPortal position="bottom-start" transition="pop-top-left">
                <Menu.Target>
                  <button
                    type="button"
                    style={{
                      ...summaryChipStyles,
                      minWidth: 120,
                    }}
                  >
                      <IconDeviceTv size={14} />
                      <span>{summaryResolution}</span>
                      <IconArrowRight size={12} />
                    </button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {RESOLUTION_OPTIONS.map((option) => (
                      <Menu.Item
                        key={option.value}
                        onClick={() => {
                          setAspect(option.value)
                          updateNodeData(id, { aspect: option.value })
                        }}
                      >
                        {option.label}
                      </Menu.Item>
                    ))}
                  </Menu.Dropdown>
                </Menu>
              )}
              {showOrientationMenu && (
                <Menu withinPortal position="bottom-start" transition="pop-top-left">
                <Menu.Target>
                  <button
                    type="button"
                    style={{
                      ...summaryChipStyles,
                      minWidth: 100,
                    }}
                  >
                      <IconDeviceMobile size={14} />
                      <span>{orientation === 'portrait' ? '竖屏' : '横屏'}</span>
                      <IconArrowRight size={12} />
                    </button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {ORIENTATION_OPTIONS.map((option) => (
                      <Menu.Item
                        key={option.value}
                        onClick={() => {
                          setOrientation(option.value as 'portrait' | 'landscape')
                          updateNodeData(id, { orientation: option.value })
                        }}
                      >
                        {option.label}
                      </Menu.Item>
                    ))}
                  </Menu.Dropdown>
                </Menu>
              )}
              <Menu withinPortal position="bottom-start" transition="pop-top-left">
                <Menu.Target>
                  <button
                    type="button"
                    style={{
                      ...summaryChipStyles,
                      minWidth: 80,
                    }}
                  >
                    <IconAdjustments size={14} />
                    <span>{summaryExec}</span>
                    <IconArrowRight size={12} />
                  </button>
                </Menu.Target>
                <Menu.Dropdown>
                  {SAMPLE_OPTIONS.map((value) => (
                    <Menu.Item
                      key={value}
                      onClick={() => {
                        setSampleCount(value)
                        updateNodeData(id, { sampleCount: value })
                      }}
                    >
                      {value}x
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            </div>
            {!isCharacterNode && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {isRunning && (
                  <ActionIcon
                    size="lg"
                    variant="light"
                    color="red"
                    title="停止当前任务"
                    onClick={handleCancelRun}
                  >
                    <IconPlayerStop size={16} />
                  </ActionIcon>
                )}
                <ActionIcon
                  size="lg"
                  variant="filled"
                  color="blue"
                  title="执行节点"
                  loading={isRunning}
                  disabled={isRunning}
                  onClick={runNode}
                >
                  <IconPlayerPlay size={16} />
                </ActionIcon>
              </div>
            )}
          </div>
          {isCharacterNode ? (
            <Text size="xs" c="dimmed" mb={6}>挑选或创建角色，供后续节点通过 @角色名 自动引用。</Text>
          ) : (
            <Text size="xs" c="dimmed" mb={6}>{isComposerNode ? '分镜/脚本（支持多镜头，当前为实验功能）' : '详情'}</Text>
          )}

          {!isCharacterNode && status === 'error' && (data as any)?.lastError && (
            <Paper
              withBorder
              radius="md"
              p="xs"
              mb="xs"
              style={{
                background: 'rgba(239,68,68,0.1)',
                borderColor: 'rgba(239,68,68,0.3)',
                border: '1px solid',
              }}
            >
              <Text size="xs" c="red.4" style={{ fontWeight: 500 }}>
                执行错误
              </Text>
              <Text size="xs" c="red.3" mt={4} style={{ wordBreak: 'break-word' }}>
                {(data as any).lastError}
              </Text>
              {(data as any)?.httpStatus === 429 && (
                <Text size="xs" c="red.2" mt={4} style={{ fontStyle: 'italic' }}>
                  💡 提示：API 配额已用尽，请稍后重试或升级您的服务计划
                </Text>
              )}
            </Paper>
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
                <Paper withBorder radius="md" p="xs">
                  {selectedCharacter.cover && (
                    <div
                      style={{
                        borderRadius: 8,
                        overflow: 'hidden',
                        border: '1px solid rgba(148,163,184,0.5)',
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
                          withBorder
                          radius="md"
                          p="xs"
                          style={{
                            border: isActive ? `1px solid ${theme.colors.blue[6]}` : `1px solid ${lightContentBorder}`,
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
                                border: '1px solid rgba(148,163,184,0.4)',
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
                        border: '1px solid rgba(148,163,184,0.5)',
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
                <Paper withBorder radius="md" p="xs" mb="xs">
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
                <Stack gap="xs">
                  <TextInput
                    label="分镜标题"
                    placeholder="例如：武侠对决 · 紫禁之巅"
                    value={storyboardTitle}
                    onChange={(e) => setStoryboardTitle(e.currentTarget.value)}
                    size="xs"
                  />
                  <Stack gap="xs">
                    {storyboardScenes.map((scene, idx) => (
                      <Paper
                        key={scene.id}
                        withBorder
                        radius="md"
                        p="xs"
                        style={{ background: lightContentBackground, borderColor: lightContentBorder }}
                      >
                        <Group justify="space-between" align="flex-start" mb={6}>
                          <div>
                            <Text size="sm" fw={600}>{`Scene ${idx + 1}`}</Text>
                            <Text size="xs" c="dimmed">
                              镜头描述与台词
                            </Text>
                          </div>
                          <Group gap={4}>
                            <Badge color="blue" variant="light">
                              {scene.duration.toFixed(1)}s
                            </Badge>
                            <Button
                              size="compact-xs"
                              variant="light"
                              onClick={() => handleSceneDurationDelta(scene.id, 15)}
                              disabled={scene.duration >= STORYBOARD_MAX_DURATION}
                            >
                              +15s
                            </Button>
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color="red"
                              onClick={() => handleRemoveScene(scene.id)}
                              disabled={storyboardScenes.length === 1}
                              title="删除该 Scene"
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Group>
                        </Group>
                        <Textarea
                          autosize
                          minRows={3}
                          maxRows={6}
                          placeholder="描写镜头构图、动作、情绪、台词，以及需要引用的 @角色……"
                          value={scene.description}
                          onChange={(e) =>
                            updateStoryboardScene(scene.id, { description: e.currentTarget.value })
                          }
                        />
                        <Group gap="xs" mt={6} align="flex-end" wrap="wrap">
                          <Select
                            label="镜头景别"
                            placeholder="可选"
                            data={STORYBOARD_FRAMING_OPTIONS}
                            value={scene.framing || null}
                            onChange={(value) =>
                              updateStoryboardScene(scene.id, {
                                framing: (value as StoryboardScene['framing']) || undefined,
                              })
                            }
                            size="xs"
                            withinPortal
                            clearable
                            style={{ minWidth: 120 }}
                          />
                          <Select
                            label="镜头运动"
                            placeholder="可选"
                            data={STORYBOARD_MOVEMENT_OPTIONS}
                            value={scene.movement || null}
                            onChange={(value) =>
                              updateStoryboardScene(scene.id, {
                                movement: (value as StoryboardScene['movement']) || undefined,
                              })
                            }
                            size="xs"
                            withinPortal
                            clearable
                            style={{ minWidth: 120 }}
                          />
                          <NumberInput
                            label="时长 (秒)"
                            size="xs"
                            min={STORYBOARD_MIN_DURATION}
                            max={STORYBOARD_MAX_DURATION}
                            step={STORYBOARD_DURATION_STEP}
                            value={scene.duration}
                            onChange={(value) => {
                              const next = typeof value === 'number' ? value : Number(value) || scene.duration
                              updateStoryboardScene(scene.id, { duration: next })
                            }}
                            style={{ width: 120 }}
                          />
                        </Group>
                      </Paper>
                    ))}
                  </Stack>
                  <Button
                    variant="light"
                    size="xs"
                    leftSection={<IconPlus size={14} />}
                    onClick={handleAddScene}
                  >
                    添加 Scene
                  </Button>
                  <Textarea
                    label="全局风格 / 备注"
                    autosize
                    minRows={2}
                    maxRows={4}
                    placeholder="补充整体风格、镜头节奏、素材要求，或写下 Sora 需要遵循的额外说明。"
                    value={storyboardNotes}
                    onChange={(e) => setStoryboardNotes(e.currentTarget.value)}
                  />
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      当前共 {storyboardScenes.length} 个镜头。You're using {storyboardScenes.length} video gens with current settings.
                    </Text>
                    <Text
                      size="xs"
                      c={storyboardTotalDuration > STORYBOARD_MAX_TOTAL_DURATION ? 'red.4' : 'dimmed'}
                    >
                      总时长 {storyboardTotalDuration.toFixed(1)}s / {STORYBOARD_MAX_TOTAL_DURATION}s
                    </Text>
                  </Group>
                </Stack>
              ) : (
                <div style={{ position: 'relative' }}>
                <div
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    zIndex: 10,
                    display: 'flex',
                    gap: 6,
                  }}
                >
                  <ActionIcon
                    variant="subtle"
                    size="xs"
                    onClick={() => setPromptSamplesOpen(true)}
                    title="打开提示词案例库"
                    style={{
                      border: '1px solid transparent',
                      background: isDarkUi ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)',
                    }}
                  >
                    <IconBulb size={12} style={{ color: nodeShellText }} />
                  </ActionIcon>
                  {prompt.length >= 6 && suggestionsAllowed && (
                    <ActionIcon
                      variant="subtle"
                      size="xs"
                      style={{
                        background: suggestionsEnabled ? 'rgba(59, 130, 246, 0.1)' : 'rgba(107, 114, 128, 0.1)',
                        border: suggestionsEnabled ? '1px solid rgb(59, 130, 246)' : '1px solid transparent',
                      }}
                      onClick={() => setSuggestionsEnabled(!suggestionsEnabled)}
                      title={suggestionsEnabled ? "智能建议已启用 (Ctrl/Cmd+Space 切换)" : "智能建议已禁用 (Ctrl/Cmd+Space 启用)"}
                    >
                      <IconBrain size={12} style={{ color: suggestionsEnabled ? 'rgb(59, 130, 246)' : 'rgb(107, 114, 128)' }} />
                    </ActionIcon>
                  )}
                </div>
                <Textarea
                  autosize
                  minRows={2}
                  maxRows={6}
                  placeholder="在这里输入提示词... (输入6个字符后按 Ctrl/Cmd+Space 激活智能建议)"
                  value={prompt}
                  onChange={(e)=>{
                    const el = e.currentTarget
                    const v = el.value
                    setPrompt(v)
                    updateNodeData(id, { prompt: v })

                    const caret = typeof el.selectionStart === 'number' ? el.selectionStart : v.length
                    const before = v.slice(0, caret)
                    const lastAt = before.lastIndexOf('@')
                    const lastSpace = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'))
                    if (lastAt >= 0 && lastAt >= lastSpace) {
                      const filter = before.slice(lastAt + 1)
                      setMentionFilter(filter)
                      setMentionOpen(true)
                      mentionMetaRef.current = { at: lastAt, caret }
                    } else {
                      setMentionOpen(false)
                      setMentionFilter('')
                      mentionMetaRef.current = null
                    }
                  }}
                  onBlur={() => {
                    setPromptSuggestions([])
                    setMentionOpen(false)
                    setMentionFilter('')
                  }}
                  onKeyDown={(e) => {
                    const isMac = navigator.platform.toLowerCase().includes('mac')
                    const mod = isMac ? e.metaKey : e.ctrlKey

                    if (e.key === 'Escape') {
                      if (mentionOpen) {
                        e.stopPropagation()
                        setMentionOpen(false)
                        setMentionFilter('')
                        mentionMetaRef.current = null
                        return
                      }
                      if (!mentionOpen && promptSuggestions.length > 0) {
                        e.preventDefault()
                        setPromptSuggestions([])
                        setSuggestionsEnabled(false)
                        return
                      }
                    }

                    if ((e.key === ' ' || (isMac && e.key === 'Space' && !e.shiftKey)) && mod) {
                      e.preventDefault()
                      if (!suggestionsAllowed) return
                      const value = prompt.trim()
                      if (value.length >= 6) {
                        setSuggestionsEnabled(true)
                      }
                      return
                    }

                    if (!promptSuggestions.length) return
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setActiveSuggestion((idx) => (idx + 1) % promptSuggestions.length)
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setActiveSuggestion((idx) => (idx - 1 + promptSuggestions.length) % promptSuggestions.length)
                    } else if (e.key === 'Tab') {
                      e.preventDefault()
                      const suggestion = promptSuggestions[activeSuggestion]
                      if (suggestion) {
                        setPrompt(suggestion)
                        setPromptSuggestions([])
                        setSuggestionsEnabled(false)
                        markDraftPromptUsed(suggestion, 'sora').catch(() => {})
                      }
                    } else if (e.key === 'Escape') {
                      setPromptSuggestions([])
                      setSuggestionsEnabled(false)
                    }
                  }}
                />
                {mentionOpen && (
                  <Paper
                    withBorder
                    shadow="sm"
                    radius="md"
                    className="glass"
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: '100%',
                      marginTop: 4,
                      zIndex: 11,
                      maxHeight: 220,
                      overflowY: 'auto',
                    }}
                  >
                    <Text size="xs" c="dimmed" px={8} py={4}>
                      引用角色（仅 Sora2 支持）：输入 @ 后选择
                    </Text>
                    {mentionLoading && (
                      <Text size="xs" c="dimmed" px={8} py={4}>
                        正在加载角色列表…
                      </Text>
                    )}
                    {!mentionLoading && mentionItems.length === 0 && (
                      <Text size="xs" c="dimmed" px={8} py={4}>
                        暂无可引用角色
                      </Text>
                    )}
                    {!mentionLoading &&
                      mentionItems
                        .filter((it) => {
                          const p = (it && (it.profile as any)) || {}
                          if (!p.can_cameo) return false
                          const u = String(p.username || '').toLowerCase()
                          const f = mentionFilter.trim().toLowerCase()
                          if (!f) return true
                          return u.includes(f)
                        })
                        .map((it) => {
                          const p = (it && (it.profile as any)) || {}
                          const username = String(p.username || '').trim()
                          const displayName = String(p.display_name || p.displayName || '').trim()
                          const label = username ? `@${username}` : ''
                          const key = p.user_id || username || it.token || Math.random().toString(36).slice(2)
                          const avatar = String(p.profile_picture_url || '')
                          return (
                            <div
                              key={key}
                              onMouseDown={(ev) => {
                                ev.preventDefault()
                                if (!username) return
                                const value = prompt
                                const meta = mentionMetaRef.current
                                let next = value
                                if (meta) {
                                  const { at, caret } = meta
                                  const beforeAt = value.slice(0, at)
                                  const afterCaret = value.slice(caret)
                                  next = `${beforeAt}@${username}${afterCaret}`
                                } else {
                                  next = `${value}${value.endsWith(' ') || !value ? '' : ' '}@${username} `
                                }
                                setPrompt(next)
                                updateNodeData(id, { prompt: next })
                                setMentionOpen(false)
                                setMentionFilter('')
                                mentionMetaRef.current = null
                              }}
                              style={{
                                padding: '4px 8px',
                                fontSize: 12,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                              }}
                            >
                              {avatar && (
                                <img
                                  src={avatar}
                                  alt={username}
                                  style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: '50%',
                                    objectFit: 'cover',
                                    flexShrink: 0,
                                  }}
                                />
                              )}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <span style={{ color: nodeShellText }}>{label}</span>
                                {displayName && (
                                  <span style={{ color: nodeShellMuted, fontSize: 11 }}>
                                    {displayName}
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                  </Paper>
                )}

                {!mentionOpen && promptSuggestions.length > 0 && (
                  <Paper
                    withBorder
                    shadow="sm"
                    radius="md"
                    className="glass"
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: '100%',
                      marginBottom: 4,
                      zIndex: 10,
                      maxHeight: 180,
                      overflowY: 'auto',
                    }}
                  >
                    {promptSuggestions.map((s, idx) => (
                      <div
                        key={`${idx}-${s.slice(0,16)}`}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setPrompt(s)
                          setPromptSuggestions([])
                          markDraftPromptUsed(s, 'sora').catch(() => {})
                        }}
                        onMouseEnter={() => setActiveSuggestion(idx)}
                        style={{
                          padding: '4px 8px',
                          fontSize: 12,
                          cursor: 'pointer',
                          background: idx === activeSuggestion ? suggestionHighlight : 'transparent',
                          color: nodeShellText,
                        }}
                      >
                        {s}
                      </div>
                    ))}
                  </Paper>
                )}
                </div>
              )}
            </>
          )}
        </Paper>
      </NodeToolbar>
      <PromptSampleDrawer
        opened={promptSamplesOpen}
        nodeKind={kind}
        onClose={() => setPromptSamplesOpen(false)}
        onApplySample={handleApplyPromptSample}
      />

      {/* 图片结果弹窗：选择主图 + 全屏预览 */}
      {kind === 'image' && imageResults.length > 1 && (
        <Modal
          opened={imageExpanded}
          onClose={() => setImageExpanded(false)}
          title="选择主图"
          centered
          size="xl"
          withinPortal
          zIndex={8000}
        >
          <Stack gap="sm">
            <Text size="xs" c="dimmed">
              当前共有 {imageResults.length} 张图片。点击「设为主图」可更新本节点主图，点击「全屏预览」可放大查看。
            </Text>
            <div
              style={{
                maxHeight: '60vh',
                overflowY: 'auto',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 12,
                }}
              >
                {imageResults.map((img, idx) => {
                  const isPrimary = idx === imagePrimaryIndex
                  return (
                    <Paper
                      key={`${idx}-${img.url}`}
                      withBorder
                      radius="md"
                      p="xs"
                      style={{
                        background: galleryCardBackground,
                      }}
                    >
                      <div
                        style={{
                          borderRadius: 8,
                          overflow: 'hidden',
                          border: isPrimary
                            ? galleryBorderActive
                            : galleryBorderDefault,
                          marginBottom: 6,
                          background: mediaFallbackSurface,
                        }}
                      >
                        <img
                          src={img.url}
                          alt={`结果 ${idx + 1}`}
                          style={{
                            width: '100%',
                            height: 180,
                            objectFit: 'cover',
                            display: 'block',
                          }}
                        />
                      </div>
                      <Group justify="space-between">
                        <Text size="xs" c="dimmed">
                          {isPrimary ? `主图 · 第 ${idx + 1} 张` : `第 ${idx + 1} 张`}
                        </Text>
                        <Group gap={4}>
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => {
                              const url = img.url
                              if (!url) return
                              const openPreview = useUIStore
                                .getState()
                                .openPreview
                              openPreview({
                                url,
                                kind: 'image',
                                name: data?.label || 'Image',
                              })
                            }}
                          >
                            全屏预览
                          </Button>
                          {!isPrimary && (
                            <Button
                              size="xs"
                              variant="subtle"
                              onClick={() => {
                                setImagePrimaryIndex(idx)
                                updateNodeData(id, { imageUrl: img.url })
                                setImageExpanded(false)
                              }}
                            >
                              设为主图
                            </Button>
                          )}
                        </Group>
                      </Group>
                    </Paper>
                  )
                })}
              </div>
            </div>
          </Stack>
        </Modal>
      )}

      {/* Video results modal: select primary video + fullscreen preview */}
      {isVideoNode && videoExpanded && (
        <Modal
          opened={videoExpanded}
          onClose={() => setVideoExpanded(false)}
          title={videoResults.length > 0 ? "选择主视频" : "视频历史记录"}
          centered
          size="xl"
          withinPortal
          zIndex={8000}
        >
          <Stack gap="sm">
            {videoResults.length === 0 ? (
              (() => {
                const VideoHistoryIcon = isStoryboardNode ? IconMovie : IconVideo
                return (
                <div
                  style={{
                    padding: '40px 20px',
                    textAlign: 'center',
                    color: mediaFallbackText,
                  }}
                >
                  <VideoHistoryIcon size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
                  <Text size="sm" c="dimmed">
                    暂无视频生成历史
                  </Text>
                  <Text size="xs" c="dimmed" mt={4}>
                    生成视频后，这里将显示所有历史记录，你可以选择效果最好的作为主视频
                  </Text>
                </div>
                )
              })()
            ) : (
              <>
                <Text size="xs" c="dimmed">
                  当前共有 {videoResults.length} 个视频。点击「设为主视频」可更新本节点主视频，点击「全屏预览」可放大查看。
                </Text>
                <div
                  style={{
                    maxHeight: '60vh',
                    overflowY: 'auto',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                      gap: 12,
                    }}
                  >
                    {videoResults.map((video, idx) => {
                  const isPrimary = idx === videoPrimaryIndex
                  return (
                    <Paper
                      key={`${idx}-${video.url}`}
                      withBorder
                      radius="md"
                      p="xs"
                      style={{
                        background: galleryCardBackground,
                      }}
                    >
                      <div
                        style={{
                          borderRadius: 8,
                          overflow: 'hidden',
                          border: isPrimary
                            ? galleryBorderActive
                            : galleryBorderDefault,
                          marginBottom: 6,
                          background: mediaFallbackSurface,
                          position: 'relative',
                        }}
                      >
                        <video
                          src={video.url}
                          poster={video.thumbnailUrl || undefined}
                          muted
                          loop
                          playsInline
                          style={{
                            width: '100%',
                            height: 180,
                            objectFit: 'cover',
                            display: 'block',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.play().catch(() => {})
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.pause()
                            e.currentTarget.currentTime = 0
                          }}
                        />
                        {video.duration && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 4,
                            right: 4,
                            background: 'rgba(0,0,0,0.7)',
                            color: theme.white,
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: 4,
                          }}
                          >
                            {Math.round(video.duration)}s
                          </div>
                        )}
                      </div>
                      <Group justify="space-between">
                        <Text size="xs" c="dimmed">
                          {isPrimary ? `主视频 · 第 ${idx + 1} 个` : `第 ${idx + 1} 个`}
                        </Text>
                        <Group gap={4}>
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => {
                              const url = video.url
                              if (!url) return
                              const openPreview = useUIStore
                                .getState()
                                .openPreview
                              openPreview({
                                url,
                                kind: 'video',
                                name: video.title || data?.label || 'Video',
                              })
                            }}
                          >
                            全屏预览
                          </Button>
                          {!isPrimary && (
                            <Button
                              size="xs"
                              variant="subtle"
                              onClick={() => {
                                handleSetPrimaryVideo(idx)
                              }}
                            >
                              设为主视频
                            </Button>
                          )}
                        </Group>
                      </Group>
                      {video.title && (
                        <Text size="xs" lineClamp={2} c="dimmed" mt={4}>
                          {video.title}
                        </Text>
                      )}
                    </Paper>
                  )
                })}
              </div>
            </div>
              </>
            )}
          </Stack>
        </Modal>
      )}

      {/* More panel rendered directly under the top toolbar with 4px gap */}
    </div>
  )
}
