import React from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position, NodeToolbar } from 'reactflow'
import { useRFStore } from '../store'
import { useUIStore } from '../../ui/uiStore'
import { ActionIcon, Group, Paper, Textarea, Menu, Button, Text, Modal, Stack, TextInput, Select, Loader, NumberInput, Badge, Tooltip, useMantineColorScheme, useMantineTheme } from '@mantine/core'
import {
  IconMaximize,
  IconDownload,
  IconArrowsDiagonal2,
  IconBrush,
  IconDots,
  IconAdjustments,
  IconUpload,
  IconPlayerPlay,
  IconPlayerStop,
  IconTexture,
  IconVideo,
  IconScissors,
  IconPhotoEdit,
  IconPhotoSearch,
  IconClock,
  IconChevronDown,
  IconBrain,
  IconBulb,
  IconRefresh,
  IconUsers,
  IconPlus,
  IconTrash,
  IconMovie,
  IconUserPlus,
} from '@tabler/icons-react'
import { listSoraMentions, markDraftPromptUsed, suggestDraftPrompts, uploadSoraImage, listModelProviders, listModelTokens, listSoraCharacters, runTaskByVendor, type ModelTokenDto, type PromptSampleDto, type TaskResultDto } from '../../api/server'
import {
  getDefaultModel,
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
import { getTaskNodeSchema, type TaskNodeHandlesConfig, type TaskNodeFeature } from './taskNodeSchema'
import { PromptSampleDrawer } from '../components/PromptSampleDrawer'
import { toast } from '../../ui/toast'
import { DEFAULT_REVERSE_PROMPT_INSTRUCTION } from '../constants'
import { SystemPromptPanel } from '../components/SystemPromptPanel'
import { getHandleTypeLabel } from '../utils/handleLabels'
import { captureFramesAtTimes } from '../../utils/videoFrameExtractor'

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

const REMOTE_IMAGE_URL_REGEX = /^https?:\/\//i
const HANDLE_HORIZONTAL_OFFSET = 36
const HANDLE_VERTICAL_OFFSET = 36

const MAX_VEO_REFERENCE_IMAGES = 3

function normalizeVeoReferenceUrls(values: any): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= MAX_VEO_REFERENCE_IMAGES) break
  }
  return result
}

type HandleLayout = { id: string; pos: Position }

const computeHandleLayout = (handles: HandleLayout[]) => {
  const layout = new Map<string, { top?: string; left?: string }>()
  const grouped = new Map<Position, HandleLayout[]>()

  handles.forEach((handle) => {
    const key = handle.pos ?? Position.Left
    const group = grouped.get(key) || []
    group.push(handle)
    grouped.set(key, group)
  })

  grouped.forEach((group, pos) => {
    const total = group.length
    group.forEach((handle, index) => {
      if (pos === Position.Left || pos === Position.Right) {
        const topPercent = total === 1 ? 50 : ((index + 1) / (total + 1)) * 100
        layout.set(handle.id, { top: `${topPercent}%` })
      } else if (pos === Position.Top || pos === Position.Bottom) {
        const leftPercent = total === 1 ? 50 : ((index + 1) / (total + 1)) * 100
        layout.set(handle.id, { left: `${leftPercent}%` })
      }
    })
  })

  return layout
}

const getHandlePositionName = (pos?: Position) => {
  if (pos === Position.Right) return 'right'
  if (pos === Position.Top) return 'top'
  if (pos === Position.Bottom) return 'bottom'
  return 'left'
}

const buildHandleStyle = (handle: HandleLayout, layout: Map<string, { top?: string; left?: string }>) => {
  const pos = handle.pos ?? Position.Left
  const coords = layout.get(handle.id) || {}
  const style: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'auto',
  }

  if (pos === Position.Left) {
    style.left = -HANDLE_HORIZONTAL_OFFSET
    style.top = coords.top ?? '50%'
  } else if (pos === Position.Right) {
    style.right = -HANDLE_HORIZONTAL_OFFSET
    style.top = coords.top ?? '50%'
  } else if (pos === Position.Top) {
    style.top = -HANDLE_VERTICAL_OFFSET
    style.left = coords.left ?? '50%'
  } else if (pos === Position.Bottom) {
    style.bottom = -HANDLE_VERTICAL_OFFSET
    style.left = coords.left ?? '50%'
  } else {
    style.top = coords.top ?? '50%'
    style.left = coords.left ?? '50%'
  }

  return style
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result
      resolve(typeof result === 'string' ? result : '')
    }
    reader.onerror = () => reject(new Error('Failed to convert blob to data URL'))
    reader.readAsDataURL(blob)
  })
}

async function resolveImageForReversePrompt(url: string): Promise<{ imageUrl?: string; imageData?: string }> {
  const normalized = (url || '').trim()
  if (!normalized) return {}
  if (REMOTE_IMAGE_URL_REGEX.test(normalized) || normalized.startsWith('data:')) {
    return { imageUrl: normalized }
  }
  if (normalized.startsWith('blob:')) {
    try {
      const res = await fetch(normalized)
      if (!res.ok) {
        throw new Error('Failed to fetch blob URL')
      }
      const blob = await res.blob()
      const dataUrl = await blobToDataUrl(blob)
      if (dataUrl) {
        return { imageData: dataUrl }
      }
    } catch (error) {
      console.error('resolveImageForReversePrompt: failed to read blob URL', error)
      return {}
    }
  }
  return {}
}

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

const collectTextFromParts = (parts?: any): string => {
  if (!Array.isArray(parts)) return ''
  const buffer: string[] = []
  const pushPart = (part: any) => {
    if (!part) return
    if (typeof part === 'string' && part.trim()) {
      buffer.push(part.trim())
      return
    }
    const candidates: (string | undefined)[] = [
      typeof part.text === 'string' ? part.text : undefined,
      typeof part.content === 'string' ? part.content : undefined,
      typeof part.output_text === 'string' ? part.output_text : undefined,
      typeof part.value === 'string' ? part.value : undefined,
    ]
    candidates.forEach((text) => {
      if (text && text.trim()) {
        buffer.push(text.trim())
      }
    })
    if (Array.isArray(part.content)) {
      part.content.forEach(pushPart)
    }
  }
  parts.forEach(pushPart)
  return buffer.join('').trim()
}

const extractTextFromResponsePayload = (payload: any): string => {
  if (!payload || typeof payload !== 'object') return ''

  if (typeof payload.text === 'string' && payload.text.trim()) {
    return payload.text.trim()
  }

  if (Array.isArray(payload.output_text)) {
    const merged = payload.output_text
      .map((entry: any) => (typeof entry === 'string' ? entry : ''))
      .join('')
      .trim()
    if (merged) return merged
  }

  if (Array.isArray(payload.output)) {
    const merged = payload.output
      .map((entry: any) => collectTextFromParts(entry?.content))
      .filter(Boolean)
      .join('\n')
      .trim()
    if (merged) return merged
  }

  if (Array.isArray(payload.content)) {
    const merged = collectTextFromParts(payload.content)
    if (merged) return merged
  }

  const choices = payload.choices
  if (Array.isArray(choices) && choices.length > 0) {
    const message = choices[0]?.message
    const choiceText =
      (typeof message?.content === 'string' && message.content.trim()) ||
      collectTextFromParts(message?.content) ||
      (typeof choices[0]?.text === 'string' ? choices[0].text.trim() : '')
    if (choiceText) return choiceText
  }

  const candidates = payload.candidates
  if (Array.isArray(candidates) && candidates.length > 0) {
    const merged = collectTextFromParts(candidates[0]?.content?.parts || candidates[0]?.content)
    if (merged) return merged
  }

  if (payload.result) {
    const nested = extractTextFromResponsePayload(payload.result)
    if (nested) return nested
  }

  return ''
}

const extractTextFromTaskResult = (task?: TaskResultDto | null): string => {
  if (!task) return ''
  const raw = task.raw as any
  if (raw && typeof raw.text === 'string' && raw.text.trim()) {
    return raw.text.trim()
  }
  const fromResponse = extractTextFromResponsePayload(raw?.response || raw)
  if (fromResponse) return fromResponse
  return ''
}

type FrameCompareSummary = {
  same: boolean | 'unknown'
  reason?: string
  tags?: string[]
  frames?: Array<{ time?: number; desc?: string }>
}

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

const MAX_FRAME_ANALYSIS_SAMPLES = 60
const CHARACTER_CLIP_MIN = 1.2
const CHARACTER_CLIP_MAX = 3

const tryParseJsonLike = (value: string): any | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const candidates: string[] = []
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i)
  if (codeBlock && codeBlock[1].trim()) {
    candidates.push(codeBlock[1].trim())
  }
  const braceStart = trimmed.indexOf('{')
  const braceEnd = trimmed.lastIndexOf('}')
  if (braceStart !== -1 && braceEnd > braceStart) {
    candidates.push(trimmed.slice(braceStart, braceEnd + 1))
  }
  candidates.push(trimmed)
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // ignore parse error and try next candidate
    }
  }
  return null
}

const parseFrameCompareSummary = (value?: string | null): FrameCompareSummary | null => {
  if (!value) return null
  const parsed = tryParseJsonLike(value)
  if (!parsed || typeof parsed !== 'object') return null

  const normalizedSame = (() => {
    const rawSame = (parsed as any).same
    if (typeof rawSame === 'boolean') return rawSame
    if (typeof rawSame === 'string') {
      const lowered = rawSame.toLowerCase()
      if (lowered === 'true' || lowered === 'yes') return true
      if (lowered === 'false' || lowered === 'no') return false
      if (lowered === 'unknown' || lowered === 'uncertain') return 'unknown'
    }
    return 'unknown'
  })()

  const tags = Array.isArray((parsed as any).tags)
    ? (parsed as any).tags
        .map((tag: any) => (typeof tag === 'string' ? tag.trim() : ''))
        .filter((tag: string) => Boolean(tag))
    : undefined

  const frames = Array.isArray((parsed as any).frames)
    ? (parsed as any).frames
        .map((frame: any) => {
          const timeValue = typeof frame?.time === 'number' ? frame.time : Number(frame?.time)
          return {
            time: Number.isFinite(timeValue) ? timeValue : undefined,
            desc: typeof frame?.desc === 'string' ? frame.desc : undefined,
          }
        })
        .filter((frame: { time?: number; desc?: string }) => typeof frame.time === 'number' || Boolean(frame.desc))
    : undefined

  const summary: FrameCompareSummary = {
    same: normalizedSame,
    reason: typeof (parsed as any).reason === 'string' ? (parsed as any).reason.trim() : undefined,
    tags: tags && tags.length > 0 ? tags : undefined,
    frames: frames && frames.length > 0 ? frames : undefined,
  }

  if (summary.same === 'unknown' && !summary.reason && !summary.tags && !summary.frames) {
    return null
  }
  return summary
}

type CharacterCardJson = {
  characters: Array<{
    name?: string
    summary?: string
    tags?: string[]
    frames?: Array<{ time?: number; desc?: string }>
    keyframes?: { start?: number; end?: number }
  }>
}

const parseCharacterCardResult = (value?: string | null): CharacterCardJson | null => {
  if (!value) return null
  const parsed = tryParseJsonLike(value)
  if (!parsed) return null
  const characters = Array.isArray((parsed as any).characters)
    ? (parsed as any).characters
    : Array.isArray(parsed)
      ? parsed
      : null
  if (!characters || characters.length === 0) return null
  return { characters }
}

const clampCharacterClipWindow = (frames: Array<{ time: number }>, totalDuration?: number | null) => {
  if (!frames.length) {
    return { start: 0, end: CHARACTER_CLIP_MIN }
  }
  const safeDuration = typeof totalDuration === 'number' && Number.isFinite(totalDuration) && totalDuration > 0
    ? totalDuration
    : null
  let start = Number.isFinite(frames[0].time) ? frames[0].time : 0
  let end = Number.isFinite(frames[frames.length - 1].time) ? frames[frames.length - 1].time : start
  if (end < start) {
    const tmp = start
    start = end
    end = tmp
  }
  if (end - start < CHARACTER_CLIP_MIN) {
    end = start + CHARACTER_CLIP_MIN
  }
  if (end - start > CHARACTER_CLIP_MAX) {
    end = start + CHARACTER_CLIP_MAX
  }
  if (safeDuration !== null && end > safeDuration) {
    const delta = end - safeDuration
    end = safeDuration
    start = Math.max(0, start - delta)
  }
  if (start < 0) {
    const delta = -start
    start = 0
    end = safeDuration !== null ? Math.min(safeDuration, end + delta) : end + delta
  }
  if (end - start < CHARACTER_CLIP_MIN) {
    end = Math.min(start + CHARACTER_CLIP_MIN, safeDuration ?? start + CHARACTER_CLIP_MIN)
  }
  return { start, end }
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
  const nodeShellMuted = isDarkUi ? rgba(theme.white, 0.65) : rgba(theme.colors.gray?.[7] || '#475569', 0.85)
  const quickActionBackgroundActive = isDarkUi ? rgba(accentPrimary, 0.25) : rgba(accentPrimary, 0.12)
  const quickActionIconColor = rgba(nodeShellText, 0.55)
  const quickActionIconActive = accentPrimary
  const quickActionHint = rgba(nodeShellText, 0.55)
  const mediaCardBackground = isDarkUi ? 'rgba(7, 12, 26, 0.92)' : 'rgba(255,255,255,0.95)'
  const mediaOverlayBackground = isDarkUi ? 'rgba(4, 7, 16, 0.92)' : 'rgba(246, 248, 255, 0.95)'
  const mediaOverlayText = nodeShellText
  const toolbarBackground = isDarkUi ? 'rgba(4, 7, 16, 0.9)' : 'rgba(255,255,255,0.96)'
  const toolbarShadow = isDarkUi ? '0 22px 45px rgba(0,0,0,0.6)' : '0 22px 50px rgba(15,23,42,0.14)'
  const subtleOverlayBackground = isDarkUi ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.05)'
  const mediaFallbackSurface = isDarkUi ? 'rgba(3,6,12,0.92)' : 'rgba(244,247,255,0.95)'
  const mediaFallbackText = isDarkUi ? rgba(theme.colors.gray?.[4] || '#94a3b8', 0.85) : rgba(theme.colors.gray?.[6] || '#64748b', 0.85)
  const videoSurface = isDarkUi ? 'rgba(11, 16, 28, 0.9)' : 'rgba(236, 241, 255, 0.9)'
  const summaryChipAccent = accentPrimary
  const controlLabelColor = rgba(nodeShellText, 0.5)
  const inlineDividerColor = rgba(nodeShellText, 0.12)
  const summaryChipBorderColor = rgba(nodeShellText, 0.15)
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
  }), [isDarkUi, nodeShellText, summaryChipBorderColor])
  const controlLabelStyle = React.useMemo(() => ({
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: controlLabelColor,
  }), [controlLabelColor])
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
  const overlayIconButton = React.useMemo(() => ({
    width: 30,
    height: 30,
    borderRadius: 12,
    background: isDarkUi ? 'rgba(2,6,18,0.85)' : 'rgba(15,23,42,0.65)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
  }), [isDarkUi])
  const galleryCardBackground = isDarkUi ? 'rgba(7,12,24,0.96)' : 'rgba(255,255,255,0.96)'

  const suggestionHighlight = rgba(accentPrimary, isDarkUi ? 0.4 : 0.3)
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
  const schemaFeatures = React.useMemo<Set<TaskNodeFeature>>(
    () => new Set(schema.features),
    [schema],
  )
  const isStoryboardNode = schema.category === 'storyboard'
  const isComposerNode = schema.category === 'composer' || isStoryboardNode
  const hasVideoOutputs = schemaFeatures.has('video') || schemaFeatures.has('videoResults')
  const isVideoNode = hasVideoOutputs || isComposerNode
  const isStandaloneVideoNode = hasVideoOutputs && !isComposerNode
  const isImageNode =
    schema.category === 'image' || schemaFeatures.has('image') || schemaFeatures.has('imageResults')
  const isCharacterNode = schema.category === 'character' || schemaFeatures.has('character')
  const isAudioNode = schema.category === 'audio' || schemaFeatures.has('audio')
  const isSubtitleNode = schema.category === 'subtitle' || schemaFeatures.has('subtitle')
  const supportsSubflowHandles = schemaFeatures.has('subflow')
  const supportsImageUpload = schemaFeatures.has('imageUpload')
  const supportsReversePrompt = schemaFeatures.has('reversePrompt')
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

  const [editing, setEditing] = React.useState(false)
  const updateNodeLabel = useRFStore(s => s.updateNodeLabel)
  const openSubflow = useUIStore(s => s.openSubflow)
  const openParamFor = useUIStore(s => s.openParamFor)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const edgeRoute = useUIStore(s => s.edgeRoute)
  const requestCharacterCreator = useUIStore(s => s.requestCharacterCreator)
  const runSelected = useRFStore(s => s.runSelected)
  const cancelNodeExecution = useRFStore(s => s.cancelNode)
  const setNodeStatus = useRFStore(s => s.setNodeStatus)
  const updateNodeData = useRFStore(s => s.updateNodeData)
  const addNode = useRFStore(s => s.addNode)
  const addEdge = useRFStore(s => s.onConnect)
  const rawPrompt = (data as any)?.prompt as string | undefined
  const [prompt, setPrompt] = React.useState<string>(rawPrompt || '')

  // 当节点数据中的 prompt 发生变化（例如由 AI 自动生成）时，同步到本地输入框状态
  React.useEffect(() => {
    if (typeof rawPrompt === 'string' && rawPrompt !== prompt) {
      setPrompt(rawPrompt)
    }
  }, [rawPrompt])
  const applyVideoRealismSnippet = React.useCallback(
    (snippet: string) => {
      const block = (snippet || '').trim()
      if (!block) return
      const base = (prompt || '').trim()
      const merged = base ? `${base}\n\n${block}` : block
      setPrompt(merged)
      updateNodeData(id, { prompt: merged })
    },
    [id, prompt, updateNodeData]
  )
  const [aspect, setAspect] = React.useState<string>((data as any)?.aspect || '16:9')
  const previewAspectRatio = React.useMemo(() => {
    if (!isImageNode) return null
    const [w, h] = (aspect || '').split(':').map((part) => Number(part))
    if (!w || !h) return null
    return `${w} / ${h}`
  }, [aspect, isImageNode])
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
    return '你是一个提示词优化助手。请在保持核心意图不变的前提下润色、缩短并结构化下面的提示词，用于后续多模态生成。'
  })

  const rawShowSystemPrompt = (data as any)?.showSystemPrompt as boolean | undefined
  const [showSystemPrompt, setShowSystemPrompt] = React.useState<boolean>(() => {
    if (typeof rawShowSystemPrompt === 'boolean') return rawShowSystemPrompt
    return isImageNode || isVideoNode
  })

  React.useEffect(() => {
    if (typeof rawSystemPrompt === 'string') {
      setSystemPrompt(rawSystemPrompt)
    }
  }, [rawSystemPrompt])

  React.useEffect(() => {
    if (typeof rawShowSystemPrompt === 'boolean') {
      setShowSystemPrompt(rawShowSystemPrompt)
      return
    }
    if (rawShowSystemPrompt === undefined) {
      setShowSystemPrompt(isImageNode || isVideoNode)
    }
  }, [rawShowSystemPrompt, isImageNode, isVideoNode])

  React.useEffect(() => {
    const previous = typeof rawSystemPrompt === 'string' ? rawSystemPrompt : ''
    if ((previous || '') !== (systemPrompt || '')) {
      updateNodeData(id, { systemPrompt })
    }
  }, [rawSystemPrompt, systemPrompt, id, updateNodeData])

  React.useEffect(() => {
    if (typeof rawShowSystemPrompt === 'boolean') {
      if (rawShowSystemPrompt !== showSystemPrompt) {
        updateNodeData(id, { showSystemPrompt })
      }
      return
    }
    updateNodeData(id, { showSystemPrompt })
  }, [rawShowSystemPrompt, showSystemPrompt, id, updateNodeData])

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
  const videoUrl = (data as any)?.videoUrl as string | undefined
  const videoThumbnailUrl = (data as any)?.videoThumbnailUrl as string | undefined
  const videoTitle = (data as any)?.videoTitle as string | undefined
  const videoPrompt = (data as any)?.videoPrompt as string | undefined
  const videoTokenId = ((data as any)?.videoTokenId as string | undefined) || null

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
  const hasPrimaryVideo = Boolean(videoResults[videoPrimaryIndex]?.url || videoUrl)
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
  const [characterCreatorModalOpen, setCharacterCreatorModalOpen] = React.useState(false)
  const [characterCreatorCard, setCharacterCreatorCard] = React.useState<CharacterCard | null>(null)
  const [characterCreatorTokenId, setCharacterCreatorTokenId] = React.useState<string | null>(null)
  const [characterCreatorSource, setCharacterCreatorSource] = React.useState<{
    videoUrl?: string | null
    videoTitle?: string | null
    videoTokenId?: string | null
  } | null>(null)
  const characterCreatorClipPreview = React.useMemo(() => {
    if (!characterCreatorCard?.clipRange) return null
    const start = Math.max(0, characterCreatorCard.clipRange.start)
    const rawEnd = Math.max(start, characterCreatorCard.clipRange.end)
    const end = Math.min(rawEnd, start + CHARACTER_CLIP_MAX)
    return { start, end }
  }, [characterCreatorCard])
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
        const task = await runTaskByVendor('openai', {
          kind: 'image_to_prompt',
          prompt: '用简短中文描述画面中的人物外观、性别、年龄段、发型、服饰、表情、动作。不要写场景或镜头信息。',
          extras: {
            imageUrl: remoteUrl,
            systemPrompt:
              '你是人物识别助手。请用中文一两句话只描述人物的外观（性别、年龄段、脸型、发型、服饰颜色款式、表情、动作），不要写镜头、背景、光线。',
            nodeId: id,
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

      const judgeTask = await runTaskByVendor('openai', {
        kind: 'prompt_refine',
        prompt: judgePrompt,
        extras: {
          systemPrompt:
            '你是一个严谨的镜头角色判定助手。只输出 JSON，键使用英文，内容使用中文，避免幻觉，不确定则 same="unknown".',
          modelKey: 'gpt-5.1',
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
  const characterTokenOptions = React.useMemo(() => {
    const options = characterTokens.map((t) => ({
      value: t.id,
      label: `${t.label || '未命名'}${t.shared ? '（共享）' : ''}`,
    }))
    if (
      characterCreatorTokenId &&
      !options.some((opt) => opt.value === characterCreatorTokenId)
    ) {
      options.push({ value: characterCreatorTokenId, label: '当前视频 Token（共享）' })
    }
    return options
  }, [characterTokens, characterCreatorTokenId])
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
    return isStoryboardNode ? STORYBOARD_MAX_TOTAL_DURATION : 10
  })
  const [orientation, setOrientation] = React.useState<'portrait' | 'landscape'>(
    (data as any)?.orientation || 'landscape'
  )
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
                modelKey: 'gpt-5.1',
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
          modelKey: 'gpt-5.1',
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

  const activeModelKey = isImageNode
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
  const resolvedVideoVendor = existingVideoVendor || findVendorForModel(videoModel)
  const isSoraVideoNode = isVideoNode && resolvedVideoVendor === 'sora'

  const handleOpenCharacterCreatorModal = React.useCallback(
    (card: CharacterCard) => {
      setCharacterCreatorCard(card)
      setCharacterCreatorSource(null)
      setCharacterCreatorModalOpen(true)
      if (selectedCharacterTokenId) {
        setCharacterCreatorTokenId(selectedCharacterTokenId)
      } else if (characterTokens.length > 0) {
        setCharacterCreatorTokenId(characterTokens[0].id)
      } else {
        setCharacterCreatorTokenId(null)
      }
    },
    [characterTokens, selectedCharacterTokenId],
  )

  const handleQuickCreateCharacter = React.useCallback(() => {
    if (!isVideoNode || resolvedVideoVendor !== 'sora') {
      toast('该功能仅支持 Sora 视频节点', 'error')
      return
    }
    if (!videoTokenId) {
      toast('当前视频缺少 Sora Token 信息，请重新生成或绑定密钥', 'error')
      return
    }
    const activeVideo = videoResults[videoPrimaryIndex] || null
    const primaryUrl = activeVideo?.url || videoUrl || null
    if (!primaryUrl) {
      toast('暂无可用的视频结果，无法创建角色', 'error')
      return
    }
    const displayTitle = activeVideo?.title || videoTitle || 'Sora 角色'
    const rawDuration = activeVideo?.duration ?? activeVideoDuration ?? videoDuration
    const normalizedDuration = typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0
      ? rawDuration
      : CHARACTER_CLIP_MAX
    const clipEnd = normalizedDuration >= CHARACTER_CLIP_MIN
      ? Math.min(normalizedDuration, CHARACTER_CLIP_MAX)
      : normalizedDuration
    const quickCard: CharacterCard = {
      id: `video-${Date.now().toString(36)}`,
      name: displayTitle,
      summary: videoPrompt || prompt || undefined,
      frames: [],
      clipRange: { start: 0, end: clipEnd },
    }
    setCharacterCreatorCard(quickCard)
    setCharacterCreatorSource({
      videoUrl: primaryUrl,
      videoTitle: displayTitle,
      videoTokenId,
    })
    setCharacterCreatorModalOpen(true)
    setCharacterCreatorTokenId(videoTokenId)
  }, [
    isVideoNode,
    resolvedVideoVendor,
    videoTokenId,
    videoResults,
    videoPrimaryIndex,
    videoUrl,
    videoTitle,
    videoPrompt,
    prompt,
    activeVideoDuration,
    videoDuration,
    setCharacterCreatorCard,
    setCharacterCreatorModalOpen,
    setCharacterCreatorSource,
    setCharacterCreatorTokenId,
    toast,
  ])

  const closeCharacterCreatorModal = React.useCallback(() => {
    setCharacterCreatorModalOpen(false)
    setCharacterCreatorCard(null)
    setCharacterCreatorTokenId(null)
    setCharacterCreatorSource(null)
  }, [])

  const handleConfirmCharacterCreatorModal = React.useCallback(() => {
    if (!characterCreatorCard) return
    const effectiveTokenId = characterCreatorTokenId || characterCreatorSource?.videoTokenId || null
    if (!effectiveTokenId) {
      toast('暂无可用的 Sora Token，请先前往资产面板绑定', 'error')
      return
    }
    requestCharacterCreator({
      source: characterCreatorSource ? 'video-node' : 'character-card',
      name: characterCreatorCard.name,
      summary: characterCreatorCard.summary,
      tags: characterCreatorCard.tags,
      soraTokenId: effectiveTokenId,
      videoTokenId: effectiveTokenId,
      videoUrl: characterCreatorSource?.videoUrl || undefined,
      videoTitle: characterCreatorSource?.videoTitle || undefined,
      clipRange: characterCreatorCard.clipRange
        ? {
            start: characterCreatorCard.clipRange.start,
            end: characterCreatorCard.clipRange.end,
          }
        : undefined,
    })
    setActivePanel('assets')
    closeCharacterCreatorModal()
  }, [characterCreatorCard, characterCreatorTokenId, characterCreatorSource, closeCharacterCreatorModal, requestCharacterCreator, setActivePanel])

  React.useEffect(() => {
    if (!characterCreatorModalOpen) return
    if (characterCreatorTokenId) return
    if (characterCreatorSource?.videoTokenId) {
      setCharacterCreatorTokenId(characterCreatorSource.videoTokenId)
      return
    }
    if (selectedCharacterTokenId) {
      setCharacterCreatorTokenId(selectedCharacterTokenId)
      return
    }
    if (videoTokenId) {
      setCharacterCreatorTokenId(videoTokenId)
      return
    }
    if (characterTokens.length > 0) {
      setCharacterCreatorTokenId(characterTokens[0].id)
    }
  }, [characterCreatorModalOpen, characterCreatorTokenId, selectedCharacterTokenId, characterTokens, videoTokenId, characterCreatorSource])

  const rewriteModelOptions = useModelOptions('text')
  const showTimeMenu = isVideoNode
  const showResolutionMenu = isVideoNode || isImageNode
  const showOrientationMenu = isVideoNode
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
    if (!isImageNode) return
    if (existingImageVendor || !imageModel) return
    const vendor = findVendorForModel(imageModel)
    if (vendor) {
      updateNodeData(id, { imageModelVendor: vendor })
    }
  }, [existingImageVendor, imageModel, findVendorForModel, updateNodeData, id, isImageNode])

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
      patch.imageModelVendor = findVendorForModel(imageModel)
      patch.sampleCount = sampleCount
    }
    if (isComposerNode) {
      patch.sampleCount = sampleCount
      patch.videoModel = videoModel
      patch.videoModelVendor = findVendorForModel(videoModel)
      patch.videoDurationSeconds = videoDuration
      patch.orientation = orientation
      // Include upstream Sora file_id if available
      if (upstreamSoraFileId) {
        patch.inpaintFileId = upstreamSoraFileId
      }
    }
    if (isStandaloneVideoNode) {
      patch.orientation = orientation
      // Include upstream Sora file_id if available
      if (upstreamSoraFileId) {
        patch.inpaintFileId = upstreamSoraFileId
      }
    }
    if (isImageNode) {
      setPrompt(nextPrompt)
    }
    patch.modelVendor = findVendorForModel(modelKey)
    updateNodeData(id, patch)
    runSelected()
  }
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
    const uText = sourceIsImageNode
      ? (sd.prompt as string | undefined) || (sd.label as string | undefined) || null
      : null

    // 获取最新的主图片 URL
    let uImg = null
    let uSoraFileId = null
    if (sourceIsImageNode) {
      uImg = (sd.imageUrl as string | undefined) || null
      uSoraFileId = (sd.soraFileId as string | undefined) || null
    } else if (sourceHasVideoResults && sd.videoResults && sd.videoResults.length > 0 && sd.videoPrimaryIndex !== undefined) {
      // 对于 video 节点，优先获取主视频的缩略图作为上游图片
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
    if (!isCharacterNode && !characterCreatorModalOpen) return
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
  }, [isCharacterNode, characterCreatorModalOpen])

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
    if (isAudioNode) return Boolean((data as any)?.audioUrl)
    if (isCharacterNode) return Boolean(characterPrimaryImage)
    return false
  }, [isImageNode, isVideoNode, isAudioNode, isCharacterNode, imageUrl, data, characterPrimaryImage])

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
    if (!supportsImageUpload) return

    try {
      setUploading(true)

      // First, create a local URL for immediate preview
      const localUrl = URL.createObjectURL(file)
      let localDataUrl: string | undefined
      try {
        localDataUrl = await blobToDataUrl(file)
      } catch {
        localDataUrl = undefined
      }
      updateNodeData(id, { imageUrl: localUrl, reverseImageData: localDataUrl })

      // Then upload to Sora to get file_id
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

        // 静默保存项目状态
        if ((window as any).silentSaveProject) {
          (window as any).silentSaveProject()
        }
      }
    } catch (error) {
      console.error('Failed to upload image to Sora:', error)
      toast('上传图片到 Sora 失败，请稍后再试', 'error')
      // Keep the local URL even if upload fails
    } finally {
      setUploading(false)
    }
  }

  const handleReversePrompt = React.useCallback(async () => {
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
      const task = await runTaskByVendor('openai', {
        kind: 'image_to_prompt',
        prompt: DEFAULT_REVERSE_PROMPT_INSTRUCTION,
        extras: {
          ...imagePayload,
          nodeId: id,
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
  }, [supportsReversePrompt, imageResults, imagePrimaryIndex, id, updateNodeData, setPrompt, data])
  const defaultLabel = React.useMemo(() => {
    if (isComposerNode || schema.category === 'video') return '文生视频'
    if (isImageNode) return '图像节点'
    if (isAudioNode) return '音频节点'
    if (isSubtitleNode) return '字幕节点'
    return 'Task'
  }, [isComposerNode, isImageNode, isAudioNode, isSubtitleNode, schema.category])
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
        ...(fixedWidth ? { width: fixedWidth } : {}),
      } as React.CSSProperties}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              background: iconBadgeBackground,
              boxShadow: iconBadgeShadow,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: '#fff',
            }}
          >
            <NodeIcon size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
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
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Text
                    size="sm"
                    fw={600}
                    style={{ color: nodeShellText, lineHeight: 1.2, cursor: 'pointer', flex: 1 }}
                    title="双击重命名"
                    onDoubleClick={() => setEditing(true)}
                  >
                    {currentLabel}
                  </Text>
                  <ActionIcon size="sm" variant="subtle" color="gray" title="重命名" onClick={() => setEditing(true)}>
                    <IconBrush size={12} />
                  </ActionIcon>
                </div>
                <Text size="xs" c="dimmed" style={{ marginTop: 2 }}>
                  {subtitle}
                </Text>
              </>
            )}
          </div>
        </div>
        {statusLabel?.trim() && (
          <div
            style={{
              ...sleekChipBase,
              color,
              fontSize: 12,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
            <span>{statusLabel}</span>
          </div>
        )}
      </div>
      {/* Top floating toolbar anchored to node */}
      <NodeToolbar isVisible={!!selected && selectedCount === 1 && hasContent} position={Position.Top} align="center">
        <div ref={moreRef} style={{ position: 'relative', display: 'inline-block' }} data-more-root>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderRadius: 999,
              background: toolbarBackground,
              boxShadow: toolbarShadow,
              backdropFilter: 'blur(18px)',
            }}
          >
            <ActionIcon
              variant="transparent"
              radius={0}
              size="sm"
              title="放大预览"
              styles={toolbarActionIconStyles}
              onClick={() => {
                const url =
                  isCharacterNode
                    ? characterPrimaryImage || undefined
                    : isImageNode
                      ? imageUrl || (data as any)?.imageUrl
                      : isVideoNode
                        ? (data as any)?.videoUrl
                        : isAudioNode
                          ? (data as any)?.audioUrl
                          : undefined
                const k: any =
                  isCharacterNode
                    ? 'image'
                    : isAudioNode
                      ? 'audio'
                      : isVideoNode
                        ? 'video'
                        : 'image'
                if (url) useUIStore.getState().openPreview({ url, kind: k, name: data?.label })
              }}
            >
              <IconMaximize size={16} />
            </ActionIcon>
            <ActionIcon
              variant="transparent"
              radius={0}
              size="sm"
              styles={toolbarActionIconStyles}
              title="下载"
              onClick={() => {
                const url =
                  isCharacterNode
                    ? characterPrimaryImage || undefined
                    : isImageNode
                      ? imageUrl || (data as any)?.imageUrl
                      : isVideoNode
                        ? (data as any)?.videoUrl
                        : isAudioNode
                          ? (data as any)?.audioUrl
                          : undefined
                if (!url) return
                const a = document.createElement('a')
                a.href = url
                a.download = `${(data?.label || kind)}-${Date.now()}`
                document.body.appendChild(a)
                a.click()
                a.remove()
              }}
            >
              <IconDownload size={16} />
            </ActionIcon>
            {visibleDefs.length > 0 && (
              <div style={{ width: 1, height: 24, background: inlineDividerColor }} />
            )}
            {visibleDefs.map((d) => (
              <Button
                key={d.key}
                type="button"
                variant="transparent"
                radius={0}
                size="compact-sm"
                onClick={d.onClick}
                style={toolbarTextButtonStyle}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {d.icon}
                  <span>{d.label}</span>
                </span>
              </Button>
            ))}
            {extraDefs.length > 0 && (
              <ActionIcon
                variant="transparent"
                radius={0}
                size="sm"
                title="更多"
                styles={toolbarActionIconStyles}
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMore((v) => !v)
                }}
              >
                <IconDots size={16} />
              </ActionIcon>
            )}
          </div>
          {showMore && (
            <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 2 }}>
              <Paper shadow="md" radius="md" className="glass" p="xs" style={{ width: 260 }}>
                <Text size="xs" c="dimmed" mb={6}>
                  更多
                </Text>
                <Group wrap="wrap" gap={6}>
                  {extraDefs.map((d) => (
                    <Button
                      key={d.key}
                      size="xs"
                      variant="subtle"
                      leftSection={<>{d.icon}</>}
                      onClick={() => {
                        setShowMore(false)
                        d.onClick()
                      }}
                    >
                      {d.label}
                    </Button>
                  ))}
                </Group>
              </Paper>
            </div>
          )}
        </div>
      </NodeToolbar>
      <div className="tc-handle-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {targets.map((h) => {
          const handleLabel = getHandleTypeLabel(h.type)
          const handlePositionName = getHandlePositionName(h.pos)
          return (
            <Handle
              key={h.id}
              id={h.id}
              className="tc-handle"
              type="target"
              position={h.pos}
              style={buildHandleStyle(h, handleLayoutMap)}
              data-handle-type={h.type}
              data-handle-position={handlePositionName}
              title={`输入: ${handleLabel}`}
              aria-label={`输入: ${handleLabel}`}
            />
          )
        })}
        {sources.map((h) => {
          const handleLabel = getHandleTypeLabel(h.type)
          const handlePositionName = getHandlePositionName(h.pos)
          return (
            <Handle
              key={h.id}
              id={h.id}
              className="tc-handle"
              type="source"
              position={h.pos}
              style={buildHandleStyle(h, handleLayoutMap)}
              data-handle-type={h.type}
              data-handle-position={handlePositionName}
              title={`输出: ${handleLabel}`}
              aria-label={`输出: ${handleLabel}`}
            />
          )
        })}
      </div>
      {/* Content Area for Character/Image/Video/Text kinds */}
      {isCharacterNode && (
        <div style={{ position: 'relative', marginTop: 6 }}>
          {characterPrimaryImage ? (
            <div
              style={{
                borderRadius: 10,
                overflow: 'hidden',
                border: 'none',
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
          {!hasPrimaryImage ? (
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
                        <div style={{ width: 12, height: 12 }} />
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
                  background: mediaFallbackSurface,
                }}
              >
                <img
                  src={primaryImageUrl || imageResults[imagePrimaryIndex]?.url || ''}
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
                {supportsReversePrompt && primaryImageUrl && (
                  <Button
                    type="button"
                    variant="transparent"
                    radius={0}
                    size="compact-xs"
                    onClick={handleReversePrompt}
                    disabled={reversePromptLoading}
                    style={{
                      position: 'absolute',
                      left: 8,
                      bottom: 8,
                      padding: 0,
                      borderRadius: 0,
                      border: 'none',
                      background: 'transparent',
                      color: mediaOverlayText,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: reversePromptLoading ? 'not-allowed' : 'pointer',
                      transition: 'opacity .12s ease',
                      opacity: reversePromptLoading ? 0.7 : 0.95,
                    }}
                  >
                    {reversePromptLoading ? (
                      <Loader size="xs" color={mediaOverlayText} />
                    ) : (
                      <IconPhotoSearch size={12} />
                    )}
                    <span style={{ fontSize: 11, color: mediaOverlayText }}>反推提示词</span>
                  </Button>
                )}
                {/* 数量 + 展开标签 */}
                {imageResults.length > 1 && (
                  <Button
                    type="button"
                    variant="transparent"
                    radius={0}
                    size="compact-xs"
                    onClick={() => setImageExpanded(true)}
                    style={{
                      position: 'absolute',
                      right: 8,
                      bottom: 8,
                      padding: 0,
                      borderRadius: 0,
                      border: 'none',
                      background: 'transparent',
                      color: mediaOverlayText,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                    }}
                  >
                    <span>{imageResults.length}</span>
                    <IconChevronDown size={12} />
                  </Button>
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
                border: 'none',
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
          <Group gap={6} justify="space-between">
            <Button
              size="compact-xs"
              variant="light"
              leftSection={<IconPhotoSearch size={12} />}
              loading={frameCaptureLoading}
              onClick={handleCaptureVideoFrames}
            >
              抽帧预览
            </Button>
            {frameSamples.length > 0 && (
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={cleanupFrameSamples}
              >
                清空帧
              </Button>
            )}
          </Group>
          {frameSamples.length > 0 && (
            <Group gap={6} justify="space-between">
              <Button
                size="compact-xs"
                variant="default"
                loading={frameCompareLoading}
                onClick={handleCompareCharacters}
              >
                AI 判同人
              </Button>
              <Button
                size="compact-xs"
                variant="light"
                loading={characterCardLoading}
                onClick={handleGenerateCharacterCards}
              >
                生成角色卡
              </Button>
            </Group>
          )}
          {isSoraVideoNode && (
            <Button
              size="compact-xs"
              variant="outline"
              leftSection={<IconUserPlus size={12} />}
              onClick={handleQuickCreateCharacter}
              disabled={!hasPrimaryVideo}
            >
              一键创建角色
            </Button>
          )}

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
          {frameSamples.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 6 }}>
              {frameSamples.map((f) => {
                const active = frameCompareTimes.includes(f.time)
                return (
                  <div
                    key={`${f.url}-${f.time}`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer' }}
                    onClick={() => toggleFrameCompare(f.time)}
                    title={active ? '已加入对比，点击取消' : '加入对比'}
                  >
                    <div
                      style={{
                        borderRadius: 8,
                        overflow: 'hidden',
                        background: mediaFallbackSurface,
                        border: active ? `2px solid ${accentPrimary}` : `1px solid ${inlineDividerColor}`,
                        width: '100%',
                        aspectRatio: '4 / 3',
                        boxShadow: active ? `0 0 0 2px ${rgba(accentPrimary, 0.2)}` : 'none',
                      }}
                    >
                      <img
                        src={f.url}
                        alt={`frame-${f.time.toFixed(2)}s`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    </div>
                    <Tooltip
                      label={(!f.describing && f.description) ? f.description : undefined}
                      disabled={!f.description || f.describing}
                      withinPortal
                      multiline
                      maw={280}
                      position="top"
                      withArrow
                    >
                      <Text size="xs" c="dimmed">
                        {f.time.toFixed(2)}s
                      </Text>
                    </Tooltip>
                    {f.describing && (
                      <Text size="xs" c="dimmed">
                        解析中...
                      </Text>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {frameCompareTimes.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Group justify="space-between" gap={6}>
                <Text size="xs" fw={600}>
                  对比视图（{frameCompareTimes.length}）
                </Text>
                <Button size="compact-xs" variant="subtle" onClick={() => setFrameCompareTimes([])}>
                  清空对比
                </Button>
              </Group>
              <div style={{ display: 'grid', gridTemplateColumns: frameCompareTimes.length > 1 ? 'repeat(auto-fit, minmax(120px, 1fr))' : '1fr', gap: 8 }}>
                {frameCompareTimes.map((t) => {
                  const f = frameSamples.find((fs) => fs.time === t)
                  if (!f) return null
                  return (
                    <div key={`compare-${t}`} style={{ border: `1px solid ${inlineDividerColor}`, borderRadius: 10, overflow: 'hidden', background: mediaFallbackSurface }}>
                      <img src={f.url} alt={`compare-${t}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      <div style={{ padding: '6px 8px' }}>
                        <Text size="xs" c="dimmed">
                          {t.toFixed(2)}s
                        </Text>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {frameCompareResult && (
            <Paper shadow="xs" radius="md" withBorder p="sm" style={{ marginTop: 8, background: mediaOverlayBackground, color: mediaOverlayText }}>
              <Group justify="space-between" gap={6} mb={4}>
                <Text size="xs" fw={600}>
                  AI 判定
                </Text>
                {frameCompareVerdict && (
                  <Badge size="xs" color={frameCompareVerdict.color} variant="filled">
                    {frameCompareVerdict.label}
                  </Badge>
                )}
              </Group>
              {frameCompareSummary ? (
                <>
                  {frameCompareSummary.reason && (
                    <Text size="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      理由：{frameCompareSummary.reason}
                    </Text>
                  )}
                  {frameCompareSummary.tags && frameCompareSummary.tags.length > 0 && (
                    <Group gap={4} mt={frameCompareSummary.reason ? 6 : 0} wrap="wrap">
                      {frameCompareSummary.tags.map((tag) => (
                        <Badge key={tag} size="xs" variant="light" color="blue">
                          {tag}
                        </Badge>
                      ))}
                    </Group>
                  )}
                  {frameCompareSummary.frames && frameCompareSummary.frames.length > 0 && (
                    <Stack gap={4} mt={frameCompareSummary.tags && frameCompareSummary.tags.length > 0 ? 6 : 10}>
                      {frameCompareSummary.frames.map((frame, idx) => (
                        <Group key={`frame-summary-${frame.time ?? idx}`} gap={6} align="flex-start" wrap="nowrap">
                          <Badge size="xs" variant="outline" color="gray">
                            {typeof frame.time === 'number' ? `${frame.time.toFixed(2)}s` : `帧 ${idx + 1}`}
                          </Badge>
                          <Text size="xs" style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {frame.desc || '无描述'}
                          </Text>
                        </Group>
                      ))}
                    </Stack>
                  )}
                </>
              ) : (
                <Text size="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {frameCompareResult}
                </Text>
              )}
            </Paper>
          )}
          {characterCardLoading && (
            <Text size="xs" c="dimmed" mt={8}>
              正在生成角色卡… (已解析 {describedFrameCount} 帧)
            </Text>
          )}
          {characterCardError && (
            <Text size="xs" c="red" mt={4}>
              {characterCardError}
            </Text>
          )}
          {characterCards.length > 0 && (
            <Stack gap={6} mt={8}>
              <Text size="xs" fw={600}>
                角色卡（{characterCards.length}）
              </Text>
              <Stack gap={8}>
                {characterCards.map((card) => (
                  <Paper key={card.id} withBorder radius="md" p="sm" style={{ background: mediaOverlayBackground, color: mediaOverlayText }}>
                    <Group justify="space-between" gap={6} mb={6} align="flex-start">
                      <div>
                        <Text size="sm" fw={600}>
                          {card.name}
                        </Text>
                        {card.summary && (
                          <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
                            {card.summary}
                          </Text>
                        )}
                        {card.clipRange && (
                          <Text size="xs" c="dimmed">
                            片段 {card.clipRange.start.toFixed(2)}s - {card.clipRange.end.toFixed(2)}s（{(card.clipRange.end - card.clipRange.start).toFixed(2)}s）
                          </Text>
                        )}
                      </div>
                      {card.tags && card.tags.length > 0 && (
                        <Group gap={4} wrap="wrap" justify="flex-end">
                          {card.tags.map((tag) => (
                            <Badge key={`${card.id}-${tag}`} size="xs" variant="light" color="blue">
                              {tag}
                            </Badge>
                          ))}
                        </Group>
                      )}
                    </Group>
                      {(card.startFrame || card.endFrame) && (
                        <Group gap={8} mb={6} align="stretch">
                        {card.startFrame && (
                          <div style={{ flex: 1 }}>
                            <Text size="xs" c="dimmed" mb={2}>
                              首次出现 {card.startFrame.time.toFixed(2)}s
                            </Text>
                            <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${inlineDividerColor}` }}>
                              <img src={card.startFrame.url} alt={`${card.name}-start`} style={{ width: '100%', display: 'block' }} />
                            </div>
                          </div>
                        )}
                        {card.endFrame && (
                          <div style={{ flex: 1 }}>
                            <Text size="xs" c="dimmed" mb={2}>
                              最后出现 {card.endFrame.time.toFixed(2)}s
                            </Text>
                            <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${inlineDividerColor}` }}>
                              <img src={card.endFrame.url} alt={`${card.name}-end`} style={{ width: '100%', display: 'block' }} />
                            </div>
                          </div>
                        )}
                      </Group>
                    )}
                    <Stack gap={4}>
                      {card.frames.map((frame) => (
                        <Group key={`${card.id}-${frame.time}`} gap={6} align="flex-start">
                          <Badge size="xs" variant="outline" color="gray">
                            {frame.time.toFixed(2)}s
                          </Badge>
                          <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
                            {frame.desc}
                          </Text>
                        </Group>
                      ))}
                    </Stack>
                    <Group justify="flex-end" gap={6} mt={8}>
                      <Tooltip label="打开创建角色弹窗" withArrow>
                        <Button
                          size="compact-xs"
                          variant="outline"
                          leftSection={<IconUserPlus size={12} />}
                          onClick={() => handleOpenCharacterCreatorModal(card)}
                        >
                          一键创建角色
                        </Button>
                      </Tooltip>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </Stack>
          )}
        </div>
      )}
      {isVideoNode && resolvedVideoVendor === 'veo' && (
        <Paper radius="md" withBorder p="sm" style={{ marginTop: 8, width: 296 }}>
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
           <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Menu withinPortal position="bottom-start" transition="pop-top-left">
                <Menu.Target>
                  <Button
                    type="button"
                    variant="transparent"
                    radius={0}
                    size="compact-sm"
                    style={{
                      ...summaryChipStyles,
                      minWidth: 0,
                      maxWidth: 220,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={`模型 · ${summaryModelLabel}`}
                  >
                    <span style={controlValueStyle}>{summaryModelLabel}</span>
                  </Button>
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
                          modelVendor: option.vendor || null,
                          imageModelVendor: option.vendor || null,
                          videoModelVendor: option.vendor || null,
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
                  <Button
                    type="button"
                    variant="transparent"
                    radius={0}
                    size="compact-sm"
                    style={{
                      ...summaryChipStyles,
                      minWidth: 0,
                    }}
                    title="时长"
                  >
                    <span style={controlValueStyle}>{summaryDuration}</span>
                  </Button>
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
                  <Button
                    type="button"
                    variant="transparent"
                    radius={0}
                    size="compact-sm"
                    style={summaryChipStyles}
                    title="分辨率"
                  >
                    <span style={controlValueStyle}>{summaryResolution}</span>
                  </Button>
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
                  <Button
                    type="button"
                    variant="transparent"
                    radius={0}
                    size="compact-sm"
                    style={{
                      ...summaryChipStyles,
                      minWidth: 0,
                    }}
                    title="方向"
                  >
                    <span style={controlValueStyle}>{orientation === 'portrait' ? '竖屏' : '横屏'}</span>
                  </Button>
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
                  <Button
                    type="button"
                    variant="transparent"
                    radius={0}
                    size="compact-sm"
                    style={{
                      ...summaryChipStyles,
                      minWidth: 0,
                    }}
                    title="生成次数"
                  >
                    <span style={controlValueStyle}>{summaryExec}</span>
                  </Button>
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
              {!isCharacterNode && (
                <>
                  {isRunning && (
                    <ActionIcon
                      size="md"
                      variant="light"
                      color="red"
                      title="停止当前任务"
                      onClick={handleCancelRun}
                    >
                      <IconPlayerStop size={16} />
                    </ActionIcon>
                  )}
                  <ActionIcon
                    size="md"
                    title="执行节点"
                    loading={isRunning}
                    disabled={isRunning}
                    onClick={runNode}
                    radius="md"
                    style={{
                      width: 20,
                      height: 20,
                      background: 'linear-gradient(135deg, #4c6ef5, #60a5fa)',
                      boxShadow: '0 18px 30px rgba(76, 110, 245, 0.35)',
                    }}
                  >
                    <IconPlayerPlay size={18} />
                  </ActionIcon>
                </>
              )}
            </div>
          </div>
          {isCharacterNode ? (
            <Text size="xs" c="dimmed" mb={6}>挑选或创建角色，供后续节点通过 @角色名 自动引用。</Text>
          ) : (
            <Text size="xs" c="dimmed" mb={6}>{isComposerNode ? '分镜/脚本（支持多镜头，当前为实验功能）' : ''}</Text>
          )}

          {!isCharacterNode && status === 'error' && (data as any)?.lastError && (
            <Paper
              radius="md"
              p="xs"
              mb="xs"
              style={{
                background: 'rgba(239,68,68,0.1)',
                borderColor: 'rgba(239,68,68,0.3)',
                border: 'none',
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
                        radius="md"
                        p="xs"
                        style={{ background: lightContentBackground }}
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
                    title="打开提示词支持共享配置"
                      style={{
                        border: 'none',
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
                        border: 'none',
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
              {(isImageNode || isVideoNode) && (
                <SystemPromptPanel
                  target={isImageNode ? 'image' : 'video'}
                  enabled={showSystemPrompt}
                  value={systemPrompt}
                  onEnabledChange={handleSystemPromptToggle}
                  onChange={handleSystemPromptChange}
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

      <Modal
        opened={characterCreatorModalOpen}
        onClose={closeCharacterCreatorModal}
        title="一键创建角色"
        centered
        withinPortal
        zIndex={12010}
      >
        <Stack gap="sm">
          {characterCreatorCard ? (
            <div>
              <Text size="sm" fw={500}>{characterCreatorCard.name}</Text>
              {characterCreatorCard.summary && (
                <Text size="xs" c="dimmed" mt={4} style={{ whiteSpace: 'pre-wrap' }}>
                  {characterCreatorCard.summary}
                </Text>
              )}
              {characterCreatorSource?.videoUrl && (
                <Text size="xs" c="dimmed" mt={4}>
                  将自动使用当前 Sora 视频片段创建角色。
                </Text>
              )}
              <Text size="xs" c="dimmed" mt={6}>
                {characterCreatorClipPreview
                  ? `默认截取 ${characterCreatorClipPreview.start.toFixed(2)}s - ${characterCreatorClipPreview.end.toFixed(2)}s，最长 ${CHARACTER_CLIP_MAX}s`
                  : `默认截取 ${CHARACTER_CLIP_MAX}s 片段，可在下一步微调`}
              </Text>
            </div>
          ) : (
            <Text size="sm" c="dimmed">
              请选择需要创建的角色卡
            </Text>
          )}

          {characterTokensLoading ? (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">正在加载 Sora Token…</Text>
            </Group>
          ) : characterTokenOptions.length > 0 ? (
            <>
              <Select
                label="Sora Token"
                placeholder="请选择 Token"
                data={characterTokenOptions}
                value={characterCreatorTokenId}
                onChange={(value) => setCharacterCreatorTokenId(value)}
                withinPortal
                size="xs"
              />
              {characterTokens.length === 0 && characterCreatorTokenId && (
                <Text size="xs" c="dimmed">
                  将使用当前视频任务关联的 Sora Token。
                </Text>
              )}
            </>
          ) : (
            <Stack gap={4}>
              <Text size="xs" c="red">
                暂无可用的 Sora Token
              </Text>
              <Text size="xs" c="dimmed">
                请先前往资产面板绑定密钥，再尝试创建角色。
              </Text>
            </Stack>
          )}
          {characterTokenError && (
            <Text size="xs" c="red">
              {characterTokenError}
            </Text>
          )}
          <Group justify="flex-end" mt="xs">
            {characterTokens.length === 0 && (
              <Button
                variant="subtle"
                size="xs"
                onClick={() => {
                  setActivePanel('assets')
                  closeCharacterCreatorModal()
                }}
              >
                管理 Token
              </Button>
            )}
            <Button variant="default" onClick={closeCharacterCreatorModal}>
              取消
            </Button>
            <Button
              onClick={handleConfirmCharacterCreatorModal}
              disabled={!characterCreatorCard || !characterCreatorTokenId}
            >
              开始创建
            </Button>
          </Group>
        </Stack>
      </Modal>
      {veoImageModalMode && (
        <Modal
          opened={true}
          onClose={closeVeoModal}
          title={
            veoImageModalMode === 'first'
              ? '选择首帧图片'
              : veoImageModalMode === 'last'
                ? '选择尾帧图片'
                : '管理参考图'
          }
          size="lg"
          centered
          withinPortal
          zIndex={8200}
        >
          <Stack gap="sm">
            {veoImageModalMode === 'reference' && (
              <>
                {firstFrameLocked && (
                  <Text size="xs" c="red">
                    已设置首帧时无法添加或选择参考图。请先清空首帧 URL。
                  </Text>
                )}
                <Group gap="xs" align="flex-end">
                  <TextInput
                    label="添加参考图"
                    placeholder="https://example.com/ref.png"
                    value={veoCustomImageInput}
                    onChange={(e) => setVeoCustomImageInput(e.currentTarget.value)}
                    style={{ flex: 1 }}
                    disabled={firstFrameLocked}
                  />
                  <Button
                    size="xs"
                    onClick={handleAddCustomReferenceImage}
                    disabled={firstFrameLocked || !veoCustomImageInput.trim() || veoReferenceLimitReached}
                  >
                    添加
                  </Button>
                </Group>
                {veoReferenceImages.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    未选择参考图。
                  </Text>
                ) : (
                  <Group gap={6} wrap="wrap">
                    {veoReferenceImages.map((url) => (
                      <Paper key={url} radius="md" p="xs" withBorder style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
              </>
            )}
            {veoCandidateImages.length === 0 ? (
              <Text size="sm" c="dimmed">
                暂无可用图片，试着连接图像节点。
              </Text>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: 12,
                }}
              >
                {veoCandidateImages.map((candidate) => {
                  const isSelected = veoReferenceImages.includes(candidate.url)
                  const isFirstFrame = firstFrameLocked && trimmedFirstFrameUrl === candidate.url
                  const isLastFrame = firstFrameLocked && trimmedLastFrameUrl === candidate.url
                  const isImageSource = candidate.sourceType === 'image'
                  const borderColor = isFirstFrame || isLastFrame || isSelected ? color : inlineDividerColor
                  return (
                    <Paper key={`${candidate.url}-${candidate.label}`} radius="md" p="xs" withBorder style={{ borderColor }}>
                      <div
                        style={{
                          borderRadius: 6,
                          overflow: 'hidden',
                          marginBottom: 6,
                          border: `1px solid ${inlineDividerColor}`,
                          background: mediaFallbackSurface,
                        }}
                      >
                        <img src={candidate.url} alt={candidate.label} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
                      </div>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {candidate.label}
                      </Text>
                      <Group gap={4} mt={6} wrap="wrap">
                        {veoImageModalMode === 'first' && (
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            disabled={!isImageSource}
                            onClick={() => {
                              handleSetFirstFrameUrl(candidate.url)
                              closeVeoModal()
                            }}
                          >
                            {isFirstFrame ? '已设首帧' : '设为首帧'}
                          </Button>
                        )}
                        {veoImageModalMode === 'last' && (
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            disabled={!firstFrameLocked || !isImageSource}
                            onClick={() => {
                              handleSetLastFrameUrl(candidate.url)
                              closeVeoModal()
                            }}
                          >
                            {isLastFrame ? '已设尾帧' : '设为尾帧'}
                          </Button>
                        )}
                        {veoImageModalMode === 'reference' && (
                          <Button
                            size="compact-xs"
                            variant={isSelected ? 'filled' : 'subtle'}
                            disabled={firstFrameLocked || (!isSelected && veoReferenceLimitReached)}
                            onClick={() => handleReferenceToggle(candidate.url)}
                          >
                            {isSelected ? '已选参考' : '添加参考'}
                          </Button>
                        )}
                      </Group>
                    </Paper>
                  )
                })}
              </div>
            )}
            {veoImageModalMode === 'first' && trimmedFirstFrameUrl && (
              <Button variant="subtle" size="xs" onClick={() => handleSetFirstFrameUrl('')}>
                清除首帧
              </Button>
            )}
            {veoImageModalMode === 'last' && trimmedLastFrameUrl && (
              <Button variant="subtle" size="xs" onClick={() => handleSetLastFrameUrl('')} disabled={!firstFrameLocked}>
                清除尾帧
              </Button>
            )}
          </Stack>
        </Modal>
      )}

      {/* 图片结果弹窗：选择主图 + 全屏预览 */}
      {isImageNode && imageResults.length > 1 && (
        <Modal
          opened={imageExpanded}
          onClose={() => setImageExpanded(false)}
          title="选择主图"
          centered
          size="xl"
          withinPortal
          zIndex={300}
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
                          border: 'none',
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
                                updateNodeData(id, { imageUrl: img.url, imagePrimaryIndex: idx })
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
          zIndex={300}
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
                          border: 'none',
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
