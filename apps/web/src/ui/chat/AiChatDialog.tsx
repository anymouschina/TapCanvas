import React from 'react'
import { ActionIcon, Badge, Button, Group, Menu, Modal, Paper, ScrollArea, Stack, Text, Textarea, Tooltip } from '@mantine/core'
import { IconArrowsMaximize, IconArrowsMinimize, IconBook2, IconChevronDown, IconChevronUp, IconMessageCircle, IconMessagePlus, IconPaperclip, IconPhoto, IconSend2, IconSparkles, IconTrash, IconUpload, IconX } from '@tabler/icons-react'
import ReactMarkdown from 'react-markdown'
import {
  normalizeStoryboardSelectionContext,
  type StoryboardSelectionContext,
} from '@tapcanvas/storyboard-selection-protocol'
import { $ } from '../../canvas/i18n'
import {
  API_BASE,
  agentsChatStream,
  getServerFlow,
  getMemoryContext,
  listProjectMaterials,
  listPublicAgentSkills,
  type AgentsChatRequestDto,
  type AgentsChatToolStreamPayload,
  uploadServerAssetFile,
  type AgentSkillDto,
  type MemoryConversationItemDto,
  type AgentsChatResponseDto,
} from '../../api/server'
import { toast } from '../toast'
import { resolveNonOverlappingPosition, useRFStore } from '../../canvas/store'
import { isImageKind } from '../../canvas/utils/edgeRules'
import type { Node } from '@xyflow/react'
import { useUIStore } from '../uiStore'
import { useLiveChatRunStore } from './liveChatRunStore'
import { formatAgentsStreamErrorMessage } from './agentsStreamError'
import { executeCanvasPlan, parseCanvasPlanFromReply } from './canvasPlan'
import { autoRunAiChatCanvasNodes, autoRunAiChatPatchedCanvasNodes } from './autoRunCanvasNodes'
import { resolveAiChatReloadAutoRunPlan } from './canvasMutation'
import { resolveChatCanvasInsertionScope } from './canvasInsertion'
import {
  buildEffectiveChatSessionKey,
  resolveChatSessionLane,
  type ChatSessionLane,
} from './chatSessionKey'
import {
  buildSelectedImageAssetInputs,
  resolveChatRequestExecution,
  type ChatAssetInput,
  type ChatAssetInputRole,
} from './chatRequestPayload'
import {
  formatChatTurnVerdictSummary,
  formatTurnVerdictSummary,
  isFailedChatTurn,
  readChatTurnVerdict,
  shouldAutoAddAssistantAssetsToCanvas,
  shouldShowMissingCanvasPlanError,
} from './replyDisposition'
import { AI_CHAT_TUTORIAL_CONTENT } from './tutorialContent'
import { buildChatInspirationQuickActions, type ChatQuickActionPreset } from './quickActions'
import { PanelCard } from '../PanelCard'
import {
  getNodeProductionMeta,
  resolveChapterGroundedProductionMetadataForNode,
} from '../../canvas/productionMeta'
import {
  normalizePublicFlowAnchorBindings,
  type PublicFlowAnchorBinding,
} from '@tapcanvas/flow-anchor-bindings'
import {
  resolvePrimarySemanticAnchorBinding,
  resolveSemanticNodeAnchorBindings,
  resolveSemanticNodeRoleBinding,
} from '../../canvas/utils/semanticBindings'

type ChatRole = 'assistant' | 'user'

type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  ts: string
  phase?: 'thinking' | 'final'
  kind?: 'progress' | 'result' | 'error'
  assets?: Array<{ title: string; url: string; thumbnailUrl?: string }>
  progressLines?: string[]
  turnVerdict?: {
    status: 'satisfied' | 'partial' | 'failed'
    reasons: string[]
  }
  diagnosticFlags?: Array<{
    code: string
    severity: 'high' | 'medium'
    title: string
    detail: string
  }>
  todoSnapshot?: ChatTodoItem[]
}

const CHAT_STREAM_ABORT_ERROR = '__tapcanvas_ai_chat_aborted__'
const CHAT_ABORTED_MESSAGE = '已中断本次对话。'
const AUTO_SCROLL_BOTTOM_THRESHOLD_MIN_PX = 72
const AUTO_SCROLL_BOTTOM_THRESHOLD_MAX_PX = 160
const AUTO_SCROLL_BOTTOM_THRESHOLD_RATIO = 0.18

type SendOptions = {
  text?: string
  skill?: AgentSkillDto | null
  attachCanvasContext?: boolean
}

type UploadedReferenceAssetMeta = {
  assetId?: string
  name?: string
}

type ProjectTextMaterialState = {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  count: number
  error: string
}

type InspirationQuickAction = ChatQuickActionPreset & {
  skill: AgentSkillDto | null
}

const CHAT_SESSION_STORAGE_KEY = 'tapcanvas.aiChat.sessionBaseKey.v1'
const AI_CHAT_LAYOUT_PREFERENCE_STORAGE_KEY = 'tapcanvas.aiChat.layoutPreference.v1'
const AI_CHAT_MODE_TRANSITION_MS = 220

type AiChatPreferenceMode = 'compact' | 'expanded'

type AiChatLayoutPreference = {
  dockRight: boolean
  mode: AiChatPreferenceMode
}

const DEFAULT_AI_CHAT_LAYOUT_PREFERENCE: AiChatLayoutPreference = {
  dockRight: true,
  mode: 'compact',
}

const AI_CHAT_LAYOUT_RESERVED_WIDTH_EXPANDED = 'calc(min(480px, calc(100vw - 32px)) + 24px)'
const AI_CHAT_LAYOUT_RESERVED_WIDTH_COMPACT = '96px'
const AI_CHAT_LAYOUT_RESERVED_WIDTH_NONE = '0px'

function normalizeAiChatPreferenceMode(value: unknown): AiChatPreferenceMode {
  return value === 'expanded' ? 'expanded' : 'compact'
}

function readAiChatLayoutPreference(): AiChatLayoutPreference {
  if (typeof window === 'undefined') return DEFAULT_AI_CHAT_LAYOUT_PREFERENCE
  try {
    const raw = window.localStorage.getItem(AI_CHAT_LAYOUT_PREFERENCE_STORAGE_KEY) || ''
    if (!raw.trim()) return DEFAULT_AI_CHAT_LAYOUT_PREFERENCE
    const parsed = JSON.parse(raw) as Partial<AiChatLayoutPreference>
    return {
      dockRight: typeof parsed.dockRight === 'boolean' ? parsed.dockRight : DEFAULT_AI_CHAT_LAYOUT_PREFERENCE.dockRight,
      mode: normalizeAiChatPreferenceMode(parsed.mode),
    }
  } catch {
    return DEFAULT_AI_CHAT_LAYOUT_PREFERENCE
  }
}

function writeAiChatLayoutPreference(next: AiChatLayoutPreference) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AI_CHAT_LAYOUT_PREFERENCE_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

function resolveInitialBubbleVisualState(preference: AiChatLayoutPreference): 'bubble' | 'panel' {
  return preference.mode === 'compact' ? 'bubble' : 'panel'
}

function formatNowTime(): string {
  try {
    const d = new Date()
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  } catch {
    return ''
  }
}

function formatMessageTime(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return formatNowTime()
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return formatNowTime()
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function createChatSessionBaseKey(): string {
  const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `canvas-${seed}`
}

function persistChatSessionBaseKey(nextKey: string): string {
  const next = String(nextKey || '').trim() || createChatSessionBaseKey()
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, next)
    }
  } catch {
    // ignore
  }
  return next
}

function readOrCreateChatSessionBaseKey(): string {
  try {
    if (typeof window === 'undefined') return createChatSessionBaseKey()
    const existing = String(window.localStorage.getItem(CHAT_SESSION_STORAGE_KEY) || '').trim()
    if (existing) return existing
    const created = createChatSessionBaseKey()
    window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, created)
    return created
  } catch {
    return createChatSessionBaseKey()
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeComparableKind(value: unknown): string {
  return readTrimmedString(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function inferSelectedImageAssetRole(node: Node): ChatAssetInputRole {
  const data = asRecord(node.data)
  const source = readTrimmedString(data?.source)
  const primaryAnchor = resolvePrimarySemanticAnchorBinding(data)
  const semanticRoleBinding = resolveSemanticNodeRoleBinding(data)
  const roleCardId = readTrimmedString(data?.roleCardId) || String(semanticRoleBinding.roleCardId || '').trim()
  const roleName = readTrimmedString(data?.roleName) || String(semanticRoleBinding.roleName || '').trim()
  if (primaryAnchor?.kind === 'scene') return 'scene'
  if (primaryAnchor?.kind === 'prop') return 'prop'
  if (primaryAnchor?.kind && primaryAnchor.kind !== 'character') return 'context'
  if (
    roleCardId ||
    (roleName && (source === 'role_card_library' || source === 'chapter_assets_confirm'))
  ) {
    return 'character'
  }
  const kind = normalizeComparableKind(data?.kind)
  const productionMeta = getNodeProductionMeta(node)
  if (
    kind === 'storyboardshot' ||
    kind === 'storyboardimage' ||
    kind === 'novelstoryboard' ||
    productionMeta.productionLayer === 'anchors' ||
    productionMeta.creationStage === 'shot_anchor_lock'
  ) {
    return 'context'
  }
  return 'reference'
}

function buildSelectedImageAssetNote(node: Node, role: ChatAssetInputRole): string {
  const data = asRecord(node.data)
  const source = readTrimmedString(data?.source)
  if (role === 'character') {
    if (source === 'chapter_assets_confirm') return '章节已确认角色卡锚点'
    if (source === 'role_card_library') return '角色卡库锚点'
    return '角色锚点'
  }
  if (role === 'scene') return '场景锚点'
  if (role === 'prop') return '道具锚点'
  if (role === 'context') return '场景/镜头锚点'
  return ''
}

function buildSelectedImageAssetCandidate(node: Node, url: string): {
  assetId?: string
  assetRefId?: string
  url: string
  role: ChatAssetInputRole
  note?: string
  name?: string
} {
  const data = asRecord(node.data)
  const primaryResult = readCurrentCanvasNodeImageResult(node)
  const assetId = readTrimmedString(primaryResult?.assetId || data?.assetId)
  const assetRefId = readTrimmedString(primaryResult?.assetRefId || data?.assetRefId)
  const role = inferSelectedImageAssetRole(node)
  const note = buildSelectedImageAssetNote(node, role)
  const primaryAnchor = resolvePrimarySemanticAnchorBinding(data)
  const roleName = readTrimmedString(primaryAnchor?.label || data?.roleName || primaryResult?.assetName || primaryResult?.assetRefId)
  return {
    ...(assetId ? { assetId } : {}),
    ...(assetRefId ? { assetRefId } : {}),
    url,
    role,
    ...(note ? { note } : {}),
    ...(role === 'character' && roleName ? { name: roleName } : {}),
  }
}

type CanvasNodeImageResult = {
  url: string | null
  title: string | null
  assetId: string | null
  assetRefId: string | null
  assetName: string | null
  prompt: string | null
  storyboardScript: string | null
  storyboardShotPrompt: string | null
  shotNo: number | null
  storyboardSelectionContext: StoryboardSelectionContext | null
}

function readCanvasNodeImageResults(node: Node | undefined): CanvasNodeImageResult[] {
  const data = node ? asRecord(node.data) : null
  if (!data) return []
  const rawResults = Array.isArray(data.imageResults) ? data.imageResults : []
  return rawResults
    .map((item): CanvasNodeImageResult | null => {
      const record = asRecord(item)
      if (!record) return null
      const url = typeof record.url === 'string' && record.url.trim() ? record.url.trim() : null
      if (!url) return null
      const shotNoRaw = typeof record.shotNo === 'number' ? record.shotNo : Number(record.shotNo)
      return {
        url,
        title: typeof record.title === 'string' && record.title.trim() ? record.title.trim() : null,
        assetId: typeof record.assetId === 'string' && record.assetId.trim() ? record.assetId.trim() : null,
        assetRefId: typeof record.assetRefId === 'string' && record.assetRefId.trim() ? record.assetRefId.trim() : null,
        assetName:
          typeof record.assetName === 'string' && record.assetName.trim()
            ? record.assetName.trim()
            : typeof record.title === 'string' && record.title.trim()
              ? record.title.trim()
              : null,
        prompt: typeof record.prompt === 'string' && record.prompt.trim() ? record.prompt.trim() : null,
        storyboardScript: typeof record.storyboardScript === 'string' && record.storyboardScript.trim() ? record.storyboardScript.trim() : null,
        storyboardShotPrompt:
          typeof record.storyboardShotPrompt === 'string' && record.storyboardShotPrompt.trim()
            ? record.storyboardShotPrompt.trim()
            : typeof record.shotPrompt === 'string' && record.shotPrompt.trim()
              ? record.shotPrompt.trim()
            : null,
        shotNo:
          Number.isFinite(shotNoRaw) && shotNoRaw > 0
            ? Math.trunc(shotNoRaw)
            : null,
        storyboardSelectionContext: normalizeStoryboardSelectionContext(record.storyboardSelectionContext),
      }
    })
    .filter((item): item is CanvasNodeImageResult => Boolean(item))
}

function readCurrentCanvasNodeImageResult(node: Node | undefined): CanvasNodeImageResult | null {
  if (!node) return null
  const data = asRecord(node.data)
  if (!data) return null
  const imageResults = readCanvasNodeImageResults(node)
  if (!imageResults.length) return null
  const primaryIndexRaw = typeof data.imagePrimaryIndex === 'number' ? data.imagePrimaryIndex : Number(data.imagePrimaryIndex)
  const primaryIndex =
    Number.isFinite(primaryIndexRaw) && primaryIndexRaw >= 0 && primaryIndexRaw < imageResults.length
      ? Math.trunc(primaryIndexRaw)
      : 0
  return imageResults[primaryIndex] || imageResults[0] || null
}

function readStoryboardSelectionContextFromCanvasNode(node: Node | undefined): StoryboardSelectionContext | null {
  if (!node) return null
  const fromPrimaryImage = readCurrentCanvasNodeImageResult(node)?.storyboardSelectionContext
  if (fromPrimaryImage) return fromPrimaryImage
  const data = asRecord(node.data)
  if (!data) return null
  return normalizeStoryboardSelectionContext(data.storyboardSelectionContext)
}

function readImageUrlFromCanvasNode(node: Node | undefined): string {
  if (!node) return ''
  const data = asRecord(node.data)
  if (!data) return ''

  const directImageUrl = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''
  if (directImageUrl) return directImageUrl

  const imageResults = Array.isArray(data.imageResults) ? data.imageResults : []
  const primaryIndexRaw = typeof data.imagePrimaryIndex === 'number' ? data.imagePrimaryIndex : Number(data.imagePrimaryIndex)
  const primaryIndex =
    Number.isFinite(primaryIndexRaw) && primaryIndexRaw >= 0 && primaryIndexRaw < imageResults.length
      ? Math.trunc(primaryIndexRaw)
      : 0
  const primaryItem = asRecord(imageResults[primaryIndex])
  if (primaryItem && typeof primaryItem.url === 'string' && primaryItem.url.trim()) {
    return primaryItem.url.trim()
  }
  const fallbackItem = imageResults
    .map((item) => asRecord(item))
    .find((item) => item && typeof item.url === 'string' && item.url.trim())
  return fallbackItem && typeof fallbackItem.url === 'string' ? fallbackItem.url.trim() : ''
}

function pickPrimaryCreationNodeId(nodeIds: string[]): string {
  const nodes = useRFStore.getState().nodes
  const rankByKind = (kind: string): number => {
    if (kind === 'video') return 4
    if (kind === 'image') return 2
    if (kind === 'text') return 1
    return 0
  }
  const created = nodeIds
    .map((id) => nodes.find((node) => String(node.id || '').trim() === String(id || '').trim()))
    .filter(Boolean)
  const primaryWithImage = created.find((node) => Boolean(readImageUrlFromCanvasNode(node)))
  if (primaryWithImage?.id) return String(primaryWithImage.id)
  const primary = created
    .slice()
    .sort((left, right) => {
      const leftKind = String(((left as { data?: { kind?: unknown } }).data?.kind) || '').trim()
      const rightKind = String(((right as { data?: { kind?: unknown } }).data?.kind) || '').trim()
      return rankByKind(rightKind) - rankByKind(leftKind)
    })[0]
  return primary?.id ? String(primary.id) : ''
}

function buildSceneCreationSummary(reply: string, nextIndex: number): string {
  const normalized = String(reply || '').trim()
  if (!normalized) return `第 ${nextIndex} 个场景已生成。`
  const firstLine = normalized
    .split('\n')
    .map((line) => line.trim())
    .find((line) => {
      if (!line) return false
      if (/^plan_only[:：]/i.test(line)) return false
      if (/^以下为规划/i.test(line)) return false
      if (/^不代表已执行/i.test(line)) return false
      return true
    }) || ''
  return firstLine ? `第 ${nextIndex} 个场景已生成：${firstLine}` : `第 ${nextIndex} 个场景已生成。`
}

function pickPrimaryImageUrlFromNode(node: Node): string {
  const data: any = node?.data || {}
  const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''
  if (imageUrl) return imageUrl
  const results = Array.isArray(data.imageResults) ? data.imageResults : []
  const idx =
    typeof data.imagePrimaryIndex === 'number' && data.imagePrimaryIndex >= 0 && data.imagePrimaryIndex < results.length
      ? data.imagePrimaryIndex
      : 0
  const fromResults = typeof results[idx]?.url === 'string' ? String(results[idx].url).trim() : ''
  return fromResults || ''
}

function toAbsoluteApiUrl(rawUrl: string): string | null {
  const trimmed = String(rawUrl || '').trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/')) {
    const base = String(API_BASE || '').trim().replace(/\/+$/, '')
    if (base) return `${base}${trimmed}`
    try {
      const origin = typeof window !== 'undefined' ? String(window.location?.origin || '').trim() : ''
      if (origin) return `${origin}${trimmed}`
    } catch {
      // ignore
    }
  }
  return null
}

function isPlaceholderAssetUrl(rawUrl: string): boolean {
  const value = String(rawUrl || '').trim()
  if (!value) return true
  if (!/^https?:\/\//i.test(value)) return true
  try {
    const u = new URL(value)
    const host = String(u.hostname || '').toLowerCase()
    return (
      host === 'example.com' ||
      host === 'www.example.com' ||
      host === 'example.org' ||
      host === 'www.example.org' ||
      host === 'example.net' ||
      host === 'www.example.net' ||
      host === 'localhost' ||
      host === '127.0.0.1'
    )
  } catch {
    return true
  }
}

const blobReferenceImageResolutionCache = new Map<string, string>()
const blobReferenceImageResolutionInflight = new Map<string, Promise<string | null>>()

async function resolveReferenceImageUrl(rawUrl: string): Promise<string | null> {
  const trimmed = String(rawUrl || '').trim()
  if (!trimmed) return null

  const abs = toAbsoluteApiUrl(trimmed)
  if (abs) return abs

  if (trimmed.startsWith('blob:')) {
    const cached = blobReferenceImageResolutionCache.get(trimmed)
    if (cached) return cached

    const inflight = blobReferenceImageResolutionInflight.get(trimmed)
    if (inflight) return inflight

    const resolvePromise = (async (): Promise<string | null> => {
    try {
      const res = await fetch(trimmed)
      if (!res.ok) return null
      const blob = await res.blob()
      const mime = blob.type || 'image/png'
      const ext =
        mime.includes('jpeg') || mime.includes('jpg')
          ? 'jpg'
          : mime.includes('webp')
            ? 'webp'
            : 'png'
      const stableBlobId = `${blob.size}-${mime.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'image'}`
      const fileName = `selection-${stableBlobId}.${ext}`
      const file = new File([blob], fileName, { type: mime, lastModified: 0 })
      const hosted = await uploadServerAssetFile(file, fileName, { taskKind: 'image_edit' })
      const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
      const resolved = hostedUrl ? toAbsoluteApiUrl(hostedUrl) : null
      if (resolved) {
        blobReferenceImageResolutionCache.set(trimmed, resolved)
      }
      return resolved
    } catch {
      return null
    } finally {
      blobReferenceImageResolutionInflight.delete(trimmed)
    }
    })()

    blobReferenceImageResolutionInflight.set(trimmed, resolvePromise)
    return resolvePromise
  }

  return null
}

type TapCanvasAutoGeneratedImage = { title: string; url: string }
type AssistantAsset = { title: string; url: string; thumbnailUrl?: string; mediaType: 'image' | 'video' }

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getScrollDistanceToBottom(element: HTMLDivElement): number {
  return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight)
}

function getAutoScrollBottomThreshold(element: HTMLDivElement): number {
  return clampNumber(
    Math.round(element.clientHeight * AUTO_SCROLL_BOTTOM_THRESHOLD_RATIO),
    AUTO_SCROLL_BOTTOM_THRESHOLD_MIN_PX,
    AUTO_SCROLL_BOTTOM_THRESHOLD_MAX_PX,
  )
}

function isViewportNearBottom(element: HTMLDivElement): boolean {
  return getScrollDistanceToBottom(element) <= getAutoScrollBottomThreshold(element)
}

function extractTapCanvasAutoGeneratedImages(replyText: string): TapCanvasAutoGeneratedImage[] {
  const raw = String(replyText || '')
  const startTag = '<tapcanvas_auto_json>'
  const endTag = '</tapcanvas_auto_json>'
  const start = raw.indexOf(startTag)
  const end = raw.indexOf(endTag)
  if (start < 0 || end < 0 || end <= start) return []
  const jsonText = raw.slice(start + startTag.length, end).trim()
  if (!jsonText) return []
  try {
    const parsed: unknown = JSON.parse(jsonText)
    const items =
      parsed && typeof parsed === 'object' && Array.isArray((parsed as { generatedImages?: unknown }).generatedImages)
        ? (parsed as { generatedImages: Array<{ title?: unknown; url?: unknown }> }).generatedImages
        : []
    const out: TapCanvasAutoGeneratedImage[] = []
    const seen = new Set<string>()
    for (const item of items) {
      const urlRaw = typeof item?.url === 'string' ? item.url.trim() : ''
      const url = urlRaw ? (toAbsoluteApiUrl(urlRaw) || urlRaw) : ''
      if (!url || !/^https?:\/\//i.test(url) || isPlaceholderAssetUrl(url) || seen.has(url)) continue
      seen.add(url)
      const title = typeof item?.title === 'string' ? item.title.trim() : ''
      out.push({ title, url })
      if (out.length >= 12) break
    }
    return out
  } catch {
    return []
  }
}

function mergeAssistantAssets(
  base: AssistantAsset[],
  extraImages: TapCanvasAutoGeneratedImage[],
): AssistantAsset[] {
  const out: AssistantAsset[] = []
  const seen = new Set<string>()

  for (const asset of Array.isArray(base) ? base : []) {
    const url = String(asset?.url || '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(asset)
  }

  for (const image of Array.isArray(extraImages) ? extraImages : []) {
    const url = String(image?.url || '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({
      title: String(image?.title || '').trim() || `生成图-${out.length + 1}`,
      url,
      mediaType: 'image',
    })
  }

  return out.slice(0, 12)
}

function addAutoGeneratedImagesToCanvas(images: TapCanvasAutoGeneratedImage[]) {
  if (!images.length) return
  const store = useRFStore.getState()
  if (images.length === 1) {
    const imageSize = { w: 420, h: 280 }
    const insertion = resolveChatCanvasInsertionScope(imageSize)
    images.forEach((img, idx) => {
      const liveNodes = useRFStore.getState().nodes
      const position = resolveNonOverlappingPosition(
        liveNodes,
        {
          x: insertion.anchor.x,
          y: insertion.anchor.y + idx * 240,
        },
        imageSize,
        null,
      )
      store.addNode('taskNode', img.title || `生成图-${idx + 1}`, {
        kind: 'image',
        imageUrl: img.url,
        status: 'success',
        position,
        autoLabel: false,
      })
    })
  } else {
    const genId = (): string => {
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID()
        }
      } catch {
        // ignore
      }
      return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    }
    useRFStore.setState((s) => {
      const usedIds = new Set((s.nodes || []).map((n) => String(n.id || '').trim()).filter(Boolean))
      let groupNo = Math.max(1, Number(s.nextGroupId || 1))
      let groupId = `g${groupNo}`
      while (usedIds.has(groupId)) {
        groupNo += 1
        groupId = `g${groupNo}`
      }

      const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(images.length))))
      const cardW = 180
      const cardH = 140
      const gapX = 12
      const gapY = 12
      const padding = 16
      const rows = Math.ceil(images.length / cols)
      const groupW = Math.max(560, padding * 2 + cols * cardW + Math.max(0, cols - 1) * gapX)
      const groupH = Math.max(220, padding * 2 + rows * cardH + Math.max(0, rows - 1) * gapY)
      const insertion = resolveChatCanvasInsertionScope({ w: groupW, h: groupH })

      const children: Node[] = images.map((img, idx) => {
        const col = idx % cols
        const row = Math.floor(idx / cols)
        const label = String(img.title || '').trim() || `生成图-${idx + 1}`
        return {
          id: genId(),
          type: 'taskNode' as any,
          parentId: groupId,
          position: {
            x: padding + col * (cardW + gapX),
            y: padding + row * (cardH + gapY),
          },
          data: {
            label,
            kind: 'image',
            imageUrl: img.url,
            status: 'success',
            nodeWidth: cardW,
            nodeHeight: cardH,
          },
          selected: false,
        } as Node
      })
      const groupNode: Node = {
        id: groupId,
        type: 'groupNode' as any,
        position: insertion.anchor,
        data: {
          label: `AI多图-${images.length}张`,
          isGroup: true,
          groupKind: 'ai_chat_multi_images',
        },
        style: {
          width: groupW,
          height: groupH,
        },
        selected: true,
      } as Node

      const nextNodes = [
        ...s.nodes.map((n) => ({ ...n, selected: false })),
        groupNode,
        ...children,
      ]
      return {
        nodes: nextNodes,
        edges: s.edges.map((e) => ({ ...e, selected: false })),
        nextGroupId: groupNo + 1,
      }
    })
  }

  try {
    const nextStore = useRFStore.getState()
    const byUrl = new Set(images.map((img) => String(img.url || '').trim()).filter(Boolean))
    const matchedIds = nextStore.nodes
      .filter((node) => {
        const data: any = node?.data || {}
        const url = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''
        return isImageKind(String(data.kind || '')) && !!url && byUrl.has(url)
      })
      .map((node) => node.id)

    if (matchedIds.length >= 1) {
      const idSet = new Set(matchedIds)
      const parentGroup = nextStore.nodes.find((node: any) => {
        if (node?.type !== 'groupNode') return false
        const groupId = String(node?.id || '').trim()
        if (!groupId) return false
        const children = nextStore.nodes.filter((n: any) => String(n?.parentId || '').trim() === groupId)
        if (!children.length) return false
        return children.every((n) => idSet.has(String(n?.id || '').trim()))
      })
      const finalSelection = parentGroup?.id ? new Set([String(parentGroup.id)]) : idSet
      useRFStore.setState((s) => ({
        nodes: s.nodes.map((n) => ({ ...n, selected: finalSelection.has(n.id) })),
        edges: s.edges.map((e) => ({ ...e, selected: false })),
      }))
    }
  } catch {
    // ignore selection errors
  }
}

function addAssistantAssetsToCanvasAsImages(
  assets: AssistantAsset[],
) {
  const images = assets
    .filter((asset) => asset.mediaType === 'image')
    .map((asset) => ({ title: asset.title, url: asset.url }))
  if (!images.length) return
  addAutoGeneratedImagesToCanvas(images)
}

function countAssistantAssetsByMediaType(assets: AssistantAsset[]): { imageCount: number; videoCount: number } {
  let imageCount = 0
  let videoCount = 0
  for (const asset of Array.isArray(assets) ? assets : []) {
    if (asset.mediaType === 'image') imageCount += 1
    if (asset.mediaType === 'video') videoCount += 1
  }
  return { imageCount, videoCount }
}

function addAssistantAssetsToCanvas(assets: AssistantAsset[]): { imageCount: number; videoCount: number } {
  const { imageCount, videoCount } = countAssistantAssetsByMediaType(assets)
  if (imageCount > 0) addAssistantAssetsToCanvasAsImages(assets)
  if (videoCount > 0) addAssistantVideoAssetsToCanvas(assets)
  return { imageCount, videoCount }
}

function addAssistantVideoAssetsToCanvas(
  assets: AssistantAsset[],
) {
  const videos = assets.filter((asset) => asset.mediaType === 'video')
  if (!videos.length) return

  const store = useRFStore.getState()
  const videoSize = { w: 460, h: 260 }
  const insertion = resolveChatCanvasInsertionScope({
    w: videoSize.w,
    h: Math.max(videoSize.h, videos.length * 280),
  })

  videos.forEach((asset, idx) => {
    const url = String(asset.url || '').trim()
    if (!url) return
    const thumbnailUrl = String(asset.thumbnailUrl || '').trim()
    const liveNodes = useRFStore.getState().nodes
    const position = resolveNonOverlappingPosition(
      liveNodes,
      {
        x: insertion.anchor.x,
        y: insertion.anchor.y + idx * 280,
      },
      videoSize,
      null,
    )
    store.addNode('taskNode', asset.title || `视频-${idx + 1}`, {
      kind: 'video',
      videoUrl: url,
      videoResults: [{
        url,
        ...(thumbnailUrl ? { thumbnailUrl } : null),
        title: asset.title || `视频-${idx + 1}`,
      }],
      videoPrimaryIndex: 0,
      status: 'success',
      position,
      autoLabel: false,
    })
  })
}

function normalizeAssistantAssets(input: any): AssistantAsset[] {
  const items = Array.isArray(input) ? input : []
  const out: AssistantAsset[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const rawUrl = typeof item?.url === 'string' ? item.url.trim() : ''
    const absUrl = rawUrl ? (toAbsoluteApiUrl(rawUrl) || rawUrl) : ''
    if (!absUrl || !/^https?:\/\//i.test(absUrl) || isPlaceholderAssetUrl(absUrl) || seen.has(absUrl)) continue
    seen.add(absUrl)

    const rawThumb = typeof item?.thumbnailUrl === 'string' ? item.thumbnailUrl.trim() : ''
    const absThumb = rawThumb ? (toAbsoluteApiUrl(rawThumb) || rawThumb) : ''
    const rawType = typeof item?.type === 'string' ? item.type.trim().toLowerCase() : ''
    const mediaType: 'image' | 'video' =
      rawType.includes('video') || /\.(mp4|mov|webm|mkv)(\?|$)/i.test(absUrl)
        ? 'video'
        : 'image'
    const title =
      typeof item?.title === 'string' && item.title.trim()
        ? item.title.trim()
        : `${mediaType === 'video' ? '生成视频' : '生成图'}-${out.length + 1}`

    out.push({
      title,
      url: absUrl,
      mediaType,
      ...(absThumb ? { thumbnailUrl: absThumb } : null),
    })
    if (out.length >= 12) break
  }
  return out
}

function normalizeChatRole(input: string): ChatRole | null {
  if (input === 'user' || input === 'assistant') return input
  return null
}

function mapMemoryConversationItemToChatMessage(item: MemoryConversationItemDto, index: number): ChatMessage | null {
  const role = normalizeChatRole(String(item.role || '').trim())
  const content = String(item.content || '').trim()
  if (!role || !content) return null
  const createdAt = String(item.createdAt || '').trim()
  return {
    id: `m_history_${createdAt || 'na'}_${index}`,
    role,
    content,
    ts: formatMessageTime(createdAt),
    phase: 'final',
    kind: 'result',
    ...(role === 'assistant'
      ? { assets: normalizeAssistantAssets(item.assets) }
      : null),
  }
}

function buildChatMessageMergeSignature(message: ChatMessage): string {
  const assetSignature = Array.isArray(message.assets)
    ? message.assets
        .map((asset) => `${String(asset.title || '').trim()}|${String(asset.url || '').trim()}|${String(asset.thumbnailUrl || '').trim()}`)
        .join('||')
    : ''
  return [
    message.role,
    String(message.content || '').trim(),
    message.phase || 'final',
    message.kind || 'result',
    assetSignature,
    Array.isArray(message.todoSnapshot)
      ? message.todoSnapshot.map((item) => `${item.status}:${item.content}`).join('|')
      : '',
  ].join('::')
}

function mergeLoadedHistoryWithLocalMessages(history: ChatMessage[], localMessages: ChatMessage[]): ChatMessage[] {
  if (!localMessages.length) return history

  const historySignatures = new Set(history.map(buildChatMessageMergeSignature))
  const localOnlyMessages = localMessages.filter((message) => {
    if (message.phase === 'thinking') return true
    const signature = buildChatMessageMergeSignature(message)
    if (historySignatures.has(signature)) return false
    historySignatures.add(signature)
    return true
  })

  return history.concat(localOnlyMessages)
}

function patchChatMessageById(
  messages: ChatMessage[],
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  let changed = false
  const next = messages.map((message) => {
    if (message.id !== messageId) return message
    changed = true
    return updater(message)
  })
  return changed ? next : messages
}

function isChatAbortError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof DOMException) return error.name === 'AbortError'
  if (error instanceof Error) {
    return error.message === CHAT_STREAM_ABORT_ERROR || error.name === 'AbortError'
  }
  return false
}

type ChatTodoItem = {
  status: 'pending' | 'in_progress' | 'completed'
  content: string
}

function normalizeChatTodoItems(
  value: unknown,
): ChatTodoItem[] {
  if (!Array.isArray(value)) return []
  const items: ChatTodoItem[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const content = String(record.text || '').trim()
    if (!content) continue
    const statusRaw = String(record.status || '').trim()
    const status: ChatTodoItem['status'] =
      statusRaw === 'completed' || statusRaw === 'in_progress' || statusRaw === 'pending'
        ? statusRaw
        : record.completed === true
          ? 'completed'
          : 'pending'
    items.push({ status, content })
    if (items.length >= 20) break
  }
  return items
}

function extractLatestTodoBlock(content: string): { markdownText: string; todoItems: ChatTodoItem[] } {
  const raw = String(content || '')
  if (!raw.trim()) return { markdownText: '', todoItems: [] }

  const marker = '\nTodo\n'
  const normalized = raw.startsWith('Todo\n') ? `\n${raw}` : raw
  const startIndex = normalized.lastIndexOf(marker)
  if (startIndex < 0) return { markdownText: raw.trim(), todoItems: [] }

  const todoText = normalized.slice(startIndex + 1).trim()
  const todoLines = todoText.split('\n')
  if (todoLines[0] !== 'Todo') return { markdownText: raw.trim(), todoItems: [] }

  const todoItems: ChatTodoItem[] = []
  for (const line of todoLines.slice(1)) {
    const trimmed = line.trim()
    if (!trimmed || /^\(\d+\/\d+\s+done\)$/i.test(trimmed) || /^note:/i.test(trimmed)) continue
    const match = trimmed.match(/^\[( |>|x)\]\s+(.+)$/i)
    if (!match) continue
    todoItems.push({
      status: match[1] === 'x' ? 'completed' : match[1] === '>' ? 'in_progress' : 'pending',
      content: match[2]!.trim(),
    })
  }

  if (!todoItems.length) return { markdownText: raw.trim(), todoItems: [] }

  const markdownText = normalized.slice(0, startIndex).trim()
  return { markdownText, todoItems }
}

function summarizeThinkingText(content: string): string {
  const raw = String(content || '').trim()
  if (!raw) return '正在处理你的请求'
  const { todoItems } = extractLatestTodoBlock(raw)
  if (todoItems.length > 0) {
    const completedCount = countCompletedTodoItems(todoItems)
    const activeItem = findInProgressTodoItem(todoItems)
    if (activeItem) return `正在执行：${activeItem.content}`
    return `正在整理任务清单（${completedCount}/${todoItems.length}）`
  }
  const firstLine = raw
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine || '正在处理你的请求'
}

type ReloadCanvasFlowResult = {
  reloaded: boolean
  newNodeIds: string[]
}

function focusCanvasNodeAfterReload(nodeIds: string[]): void {
  const targetNodeId = pickPrimaryCreationNodeId(nodeIds)
  if (!targetNodeId || typeof window === 'undefined') return

  const focus = () => {
    const focusNode = (window as Window & { __tcFocusNode?: (id: string) => void }).__tcFocusNode
    focusNode?.(targetNodeId)
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(focus)
  })
}

async function reloadCanvasFlowFromServer(input: {
  flowId: string
  expectedProjectId?: string
  expectedFlowId?: string
}): Promise<ReloadCanvasFlowResult> {
  const flowId = String(input.flowId || '').trim()
  if (!flowId) {
    return { reloaded: false, newNodeIds: [] }
  }

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

function dedupeProgressLines(lines: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const normalized = String(line || '').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out.slice(-4)
}

function formatToolProgressLine(tool: AgentsChatToolStreamPayload): string {
  const toolName = String(tool.toolName || '').trim() || 'tool'
  if (tool.phase === 'started') {
    return `工具启动：${toolName}`
  }
  const status = String(tool.status || '').trim().toLowerCase()
  if (status === 'succeeded') return `工具完成：${toolName}`
  if (status === 'failed') return `工具失败：${toolName}`
  if (status === 'denied') return `工具拒绝：${toolName}`
  if (status === 'blocked') return `工具阻塞：${toolName}`
  return `工具更新：${toolName}`
}

function countCompletedTodoItems(items: ChatTodoItem[]): number {
  return items.filter((item) => item.status === 'completed').length
}

function findInProgressTodoItem(items: ChatTodoItem[]): ChatTodoItem | null {
  return items.find((item) => item.status === 'in_progress') ?? null
}

type FocusedNodeResourceContext = {
  nodeId: string
  label: string
  kind: string | null
  imageCandidates: string[]
}

type SelectedCanvasNodeContext = {
  nodeId: string
  label: string
  kind: string | null
  anchorBindings: PublicFlowAnchorBinding[]
  roleName: string | null
  roleCardId: string | null
  textPreview: string | null
  imageUrl: string | null
  sourceUrl: string | null
  bookId: string | null
  chapterId: string | null
  shotNo: number | null
  productionLayer: string | null
  creationStage: string | null
  approvalStatus: string | null
  authorityBaseFrameNodeId: string | null
  authorityBaseFrameStatus: 'planned' | 'confirmed' | null
  storyboardSelectionContext: StoryboardSelectionContext | null
  hasInlinePromptText: boolean
  hasUpstreamTextEvidence: boolean
  hasDownstreamComposeVideo: boolean
}

type AgentsChatSelectedReferencePayload = NonNullable<NonNullable<AgentsChatRequestDto['chatContext']>['selectedReference']>
type AgentsChatSelectedReferenceAnchorBinding =
  NonNullable<AgentsChatSelectedReferencePayload['anchorBindings']>[number]

function normalizeSelectedReferenceAnchorBindings(
  bindings: readonly PublicFlowAnchorBinding[],
): AgentsChatSelectedReferencePayload['anchorBindings'] {
  const normalizedBindings = normalizePublicFlowAnchorBindings(bindings)
  if (!normalizedBindings.length) return undefined
  return normalizedBindings.map((binding): AgentsChatSelectedReferenceAnchorBinding => ({
    kind: binding.kind,
    ...(readTrimmedString(binding.refId) ? { refId: readTrimmedString(binding.refId) } : {}),
    ...(readTrimmedString(binding.entityId) ? { entityId: readTrimmedString(binding.entityId) } : {}),
    ...(readTrimmedString(binding.label) ? { label: readTrimmedString(binding.label) } : {}),
    ...(readTrimmedString(binding.sourceBookId) ? { sourceBookId: readTrimmedString(binding.sourceBookId) } : {}),
    ...(readTrimmedString(binding.sourceNodeId) ? { sourceNodeId: readTrimmedString(binding.sourceNodeId) } : {}),
    ...(readTrimmedString(binding.assetId) ? { assetId: readTrimmedString(binding.assetId) } : {}),
    ...(readTrimmedString(binding.assetRefId) ? { assetRefId: readTrimmedString(binding.assetRefId) } : {}),
    ...(readTrimmedString(binding.imageUrl) ? { imageUrl: readTrimmedString(binding.imageUrl) } : {}),
    ...(binding.referenceView ? { referenceView: binding.referenceView } : {}),
    ...(readTrimmedString(binding.category) ? { category: readTrimmedString(binding.category) } : {}),
    ...(readTrimmedString(binding.note) ? { note: readTrimmedString(binding.note) } : {}),
  }))
}

type ImplicitChatRequest = {
  prompt: string
  displayText: string
}

const SELECTED_NODE_TEXT_PREVIEW_MAX_CHARS = 1200

function clipChatPreview(value: string, maxChars: number): string {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  if (normalized.length <= maxChars) return normalized
  if (maxChars <= 1) return normalized.slice(0, maxChars)
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`
}

function readTrimmedNodeStringField(node: Node, field: string): string | null {
  const data = node.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const value = (data as Record<string, unknown>)[field]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readFiniteNodeNumberField(node: Node, field: string): number | null {
  const data = node.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const value = (data as Record<string, unknown>)[field]
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.trunc(numeric)
}

function readLatestNodeTextResult(node: Node): string | null {
  const data = asRecord(node.data)
  if (!data) return null
  const textResults = Array.isArray(data.textResults) ? data.textResults : []
  const latest = textResults.length > 0 ? asRecord(textResults[textResults.length - 1]) : null
  if (!latest) return null
  const text = typeof latest.text === 'string' ? latest.text.trim() : ''
  return text || null
}

function extractSelectedNodeTextPreview(node: Node): string | null {
  const data = asRecord(node.data)
  if (!data) return null
  const kind = typeof data.kind === 'string' ? data.kind.trim().toLowerCase() : ''
  const lastResult = asRecord(data.lastResult)
  const selectedStoryboardContext = readStoryboardSelectionContextFromCanvasNode(node)
  const currentImageResult = readCurrentCanvasNodeImageResult(node)
  const orderedCandidates =
    kind === 'text' || kind === 'storyboardscript' || kind === 'scriptdoc'
      ? [
          typeof data.text === 'string' ? data.text : '',
          typeof data.content === 'string' ? data.content : '',
          readLatestNodeTextResult(node) || '',
          typeof data.prompt === 'string' ? data.prompt : '',
          typeof lastResult?.text === 'string' ? lastResult.text : '',
        ]
      : [
          selectedStoryboardContext?.shotPrompt || '',
          currentImageResult?.storyboardShotPrompt || '',
          currentImageResult?.storyboardScript || '',
          typeof data.prompt === 'string' ? data.prompt : '',
          typeof data.text === 'string' ? data.text : '',
          typeof data.content === 'string' ? data.content : '',
          readLatestNodeTextResult(node) || '',
          typeof lastResult?.text === 'string' ? lastResult.text : '',
        ]
  const firstNonEmpty = orderedCandidates
    .map((value) => String(value || '').trim())
    .find(Boolean)
  if (!firstNonEmpty) return null
  const clipped = clipChatPreview(firstNonEmpty, SELECTED_NODE_TEXT_PREVIEW_MAX_CHARS)
  return clipped || null
}

function extractFocusedNodeResourceContext(node: Node): FocusedNodeResourceContext | null {
  const data: any = node?.data || {}
  const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : String(node?.id || '').trim() || '节点'
  const kind = typeof data.kind === 'string' && data.kind.trim() ? data.kind.trim() : null

  const imageCandidates = (() => {
    const out: string[] = []
    const seen = new Set<string>()
    const push = (value: unknown) => {
      if (typeof value !== 'string') return
      const trimmed = value.trim()
      if (!trimmed || seen.has(trimmed)) return
      seen.add(trimmed)
      out.push(trimmed)
    }

    push(pickPrimaryImageUrlFromNode(node))
    push(data.imageUrl)
    const imageResults = Array.isArray(data.imageResults) ? data.imageResults : []
    imageResults.forEach((img: any) => push(img?.url))

    push(data.videoThumbnailUrl)
    const videoResults = Array.isArray(data.videoResults) ? data.videoResults : []
    videoResults.forEach((video: any) => push(video?.thumbnailUrl))

    return out.slice(0, 8)
  })()

  if (!imageCandidates.length) return null

  return {
    nodeId: String(node?.id || '').trim(),
    label,
    kind,
    imageCandidates,
  }
}

function extractSelectedCanvasNodeContext(node: Node): SelectedCanvasNodeContext | null {
  const normalizedNodeId = String(node?.id || '').trim()
  if (!normalizedNodeId) return null
  const data = (node?.data || {}) as { label?: unknown; kind?: unknown }
  const label =
    typeof data.label === 'string' && data.label.trim()
      ? data.label.trim()
      : normalizedNodeId
  const kind = typeof data.kind === 'string' && data.kind.trim() ? data.kind.trim() : null
  const productionMeta = getNodeProductionMeta(node)
  const storyboardSelectionContext = readStoryboardSelectionContextFromCanvasNode(node)
  const selectedImageResult = readCurrentCanvasNodeImageResult(node)
  const anchorBindings = resolveSemanticNodeAnchorBindings(data)
  const semanticRoleBinding = resolveSemanticNodeRoleBinding(data)
  return {
    nodeId: normalizedNodeId,
    label,
    kind,
    anchorBindings,
    roleName: readTrimmedNodeStringField(node, 'roleName') || semanticRoleBinding.roleName,
    roleCardId: readTrimmedNodeStringField(node, 'roleCardId') || semanticRoleBinding.roleCardId,
    textPreview: extractSelectedNodeTextPreview(node),
    imageUrl: readImageUrlFromCanvasNode(node) || storyboardSelectionContext?.imageUrl || null,
    sourceUrl: readTrimmedNodeStringField(node, 'sourceUrl'),
    bookId:
      readTrimmedNodeStringField(node, 'sourceBookId')
      || readTrimmedNodeStringField(node, 'bookId')
      || storyboardSelectionContext?.sourceBookId
      || null,
    chapterId:
      readTrimmedNodeStringField(node, 'chapterId')
      || (() => {
        const chapter = readFiniteNodeNumberField(node, 'materialChapter') ?? readFiniteNodeNumberField(node, 'chapter')
        return typeof chapter === 'number' ? String(chapter) : null
      })()
      || (typeof storyboardSelectionContext?.materialChapter === 'number' ? String(storyboardSelectionContext.materialChapter) : null),
    shotNo:
      readFiniteNodeNumberField(node, 'shotNo')
      ?? selectedImageResult?.shotNo
      ?? storyboardSelectionContext?.shotNo
      ?? null,
    productionLayer: productionMeta.productionLayer ?? null,
    creationStage: productionMeta.creationStage ?? null,
    approvalStatus: productionMeta.approvalStatus ?? null,
    authorityBaseFrameNodeId: null,
    authorityBaseFrameStatus: null,
    storyboardSelectionContext,
    hasInlinePromptText: Boolean(
      storyboardSelectionContext?.shotPrompt
      || selectedImageResult?.storyboardShotPrompt
      || selectedImageResult?.prompt
      || selectedImageResult?.storyboardScript
      ||
      readTrimmedNodeStringField(node, 'prompt')
      || readTrimmedNodeStringField(node, 'text')
      || readTrimmedNodeStringField(node, 'content'),
    ),
    hasUpstreamTextEvidence: false,
    hasDownstreamComposeVideo: false,
  }
}

function normalizeNodeKind(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isTextEvidenceNodeKind(kind: string): boolean {
  return kind === 'text' || kind === 'storyboardscript' || kind === 'scriptdoc'
}

function isComposeVideoNodeKind(kind: string): boolean {
  return kind === 'composevideo' || kind === 'video' || kind === 'storyboard'
}

function extractSelectedCanvasNodeContextFromGraph(
  node: Node,
  nodes: Node[],
  edges: Array<{ source?: string | null; target?: string | null }>,
): SelectedCanvasNodeContext | null {
  const base = extractSelectedCanvasNodeContext(node)
  if (!base) return null
  const nodeId = String(node.id || '').trim()
  if (!nodeId) return base

  const nodeMap = new Map<string, Node>(
    nodes.map((item) => [String(item.id || '').trim(), item] as const).filter(([id]) => Boolean(id)),
  )

  const incomingSourceKinds = edges
    .filter((edge) => String(edge.target || '').trim() === nodeId)
    .map((edge) => nodeMap.get(String(edge.source || '').trim()))
    .filter((item): item is Node => Boolean(item))
    .map((item) => normalizeNodeKind((item.data as { kind?: unknown } | undefined)?.kind))
    .filter(Boolean)

  const outgoingTargetKinds = edges
    .filter((edge) => String(edge.source || '').trim() === nodeId)
    .map((edge) => nodeMap.get(String(edge.target || '').trim()))
    .filter((item): item is Node => Boolean(item))
    .map((item) => normalizeNodeKind((item.data as { kind?: unknown } | undefined)?.kind))
    .filter(Boolean)

  const chapterGroundedMetadata = resolveChapterGroundedProductionMetadataForNode({
    selectedNode: node as Node<Record<string, unknown>>,
    nodes: nodes as Array<Node<Record<string, unknown>>>,
    edges: edges as Array<import('@xyflow/react').Edge<Record<string, unknown>>>,
  })
  const nodeData = asRecord(node.data)
  const anchorBindings = resolveSemanticNodeAnchorBindings(nodeData)
  const semanticRoleBinding = resolveSemanticNodeRoleBinding(nodeData)

  return {
    ...base,
    anchorBindings,
    roleName: readTrimmedString(nodeData?.roleName) || semanticRoleBinding.roleName,
    roleCardId: readTrimmedString(nodeData?.roleCardId) || semanticRoleBinding.roleCardId,
    authorityBaseFrameNodeId: chapterGroundedMetadata?.metadata.authorityBaseFrame.nodeId ?? null,
    authorityBaseFrameStatus: chapterGroundedMetadata?.metadata.authorityBaseFrame.status ?? null,
    hasUpstreamTextEvidence: incomingSourceKinds.some(isTextEvidenceNodeKind),
    hasDownstreamComposeVideo: outgoingTargetKinds.some(isComposeVideoNodeKind),
  }
}

function shouldShowProjectTextMaterialHint(input: {
  currentProjectId: string
  projectTextMaterialState: ProjectTextMaterialState
  selectedCanvasNodeContext: SelectedCanvasNodeContext | null
}): boolean {
  if (!input.currentProjectId) return false
  if (input.projectTextMaterialState.status !== 'ready') return false
  if (input.projectTextMaterialState.count <= 1) return false
  const selected = input.selectedCanvasNodeContext
  if (!selected) return true
  if (selected.hasInlinePromptText) return false
  if (selected.hasUpstreamTextEvidence) return false
  if (selected.bookId || selected.chapterId) return false
  if (typeof selected.shotNo === 'number') return false
  return true
}

function buildImplicitChatRequest(input: {
  selectedCanvasNodeContext: SelectedCanvasNodeContext | null
  referenceImageCount: number
  hasTargetImage: boolean
  activeSkillName: string | null
}): ImplicitChatRequest | null {
  const contextLabels: string[] = []
  if (input.selectedCanvasNodeContext?.nodeId) contextLabels.push('当前选中节点')
  if (input.referenceImageCount > 0) contextLabels.push(`参考图 ${input.referenceImageCount} 张`)
  if (input.hasTargetImage) contextLabels.push('目标效果图')
  if (input.activeSkillName) contextLabels.push(`已启用能力 ${input.activeSkillName}`)
  if (contextLabels.length === 0) return null

  const displayText = input.selectedCanvasNodeContext?.label
    ? `基于「${clipChatPreview(input.selectedCanvasNodeContext.label, 24)}」继续`
    : input.referenceImageCount > 0 || input.hasTargetImage
      ? '基于当前参考继续'
      : input.activeSkillName
        ? `基于「${clipChatPreview(input.activeSkillName, 24)}」继续`
        : '基于当前上下文继续'

  const lines = [
    '用户本轮没有额外输入文本，但主动发送了当前上下文。',
    `当前可用上下文：${contextLabels.join('、')}。`,
    '请先基于本轮真实上下文做最小必要取证，然后：',
    '1. 简要说明你当前确认到的上下文事实；',
    '2. 明确指出你建议的下一步，或仍然缺少的关键信息；',
    '3. 若这是显式、确定性的画布改动且证据已经充分，可以直接执行；否则不要臆造用户意图。',
  ]

  return {
    prompt: lines.join('\n'),
    displayText,
  }
}

type AttachMenuTargetProps = React.ComponentPropsWithoutRef<typeof ActionIcon> & {
  tooltip: string
}

const AttachMenuTarget = React.forwardRef<HTMLButtonElement, AttachMenuTargetProps>(function AttachMenuTarget(
  { tooltip, ...props },
  ref,
): JSX.Element {
  return (
    <Tooltip className="tc-ai-chat__tooltip" label={tooltip} withArrow>
      <ActionIcon ref={ref} className="tc-ai-chat__attach" variant="subtle" aria-label="参考图" {...props}>
        <IconPaperclip className="tc-ai-chat__attach-icon" size={16} />
      </ActionIcon>
    </Tooltip>
  )
})

function ReferenceImagesStrip({
  urls,
  onClear,
  disabled,
  className,
}: {
  urls: string[]
  onClear: () => void
  disabled?: boolean
  className?: string
}): JSX.Element | null {
  if (!urls.length) return null

  const refsClassName = ['tc-ai-chat__refs', className].filter(Boolean).join(' ')

  return (
    <Group className={refsClassName} gap={8} mt={8} align="center" wrap="wrap">
      {urls.map((url, idx) => (
        <div key={url} className="tc-ai-chat__ref">
          <button
            type="button"
            className="tc-ai-chat__ref-button"
            aria-label={`参考图-${idx + 1}`}
            onClick={() => {
              try {
                window.open(url, '_blank', 'noopener,noreferrer')
              } catch {
                // ignore
              }
            }}
            disabled={disabled}
          >
            <img className="tc-ai-chat__ref-thumb" src={url} alt={`参考图-${idx + 1}`} loading="lazy" />
          </button>
        </div>
      ))}

      <ActionIcon
        className="tc-ai-chat__refs-clear"
        size={42}
        radius="xs"
        variant="subtle"
        aria-label={$('清空参考图')}
        onClick={onClear}
        disabled={disabled}
      >
        <IconTrash className="tc-ai-chat__refs-clear-icon" size={14} />
      </ActionIcon>
    </Group>
  )
}

function ChatBubble({ message }: { message: ChatMessage }): JSX.Element {
  const isUser = message.role === 'user'
  const { markdownText, todoItems } = React.useMemo(
    () => extractLatestTodoBlock(message.content),
    [message.content],
  )
  const thinkingSummary = React.useMemo(() => summarizeThinkingText(message.content), [message.content])
  const progressLines = React.useMemo(
    () => dedupeProgressLines(Array.isArray(message.progressLines) ? message.progressLines : []),
    [message.progressLines],
  )
  const verdictSummary = React.useMemo(
    () => formatTurnVerdictSummary(message.turnVerdict ?? null),
    [message.turnVerdict],
  )
  const diagnosticFlags = React.useMemo(
    () => Array.isArray(message.diagnosticFlags) ? message.diagnosticFlags : [],
    [message.diagnosticFlags],
  )
  const shouldRenderMarkdown = Boolean(String(markdownText || '').trim())
  const wrapClassName = [
    'tc-ai-chat-bubble',
    isUser ? 'tc-ai-chat-bubble--user' : 'tc-ai-chat-bubble--assistant',
  ].join(' ')

  return (
    <Group className={wrapClassName} justify={isUser ? 'flex-end' : 'flex-start'} align="flex-start" gap={10} wrap="nowrap">
      <PanelCard className="tc-ai-chat-bubble__card" padding="compact">
        <Group className="tc-ai-chat-bubble__meta" justify="space-between" align="center" gap={10} mb={6} wrap="nowrap">
          <Group className="tc-ai-chat-bubble__meta-left" gap={6} align="center" wrap="nowrap">
            <Badge className="tc-ai-chat-bubble__role" size="xs" radius="sm" variant="light" color={isUser ? 'gray' : 'blue'}>
              {isUser ? $('你') : $('AI')}
            </Badge>
            {!isUser && message.turnVerdict?.status === 'partial' ? (
              <Badge className="tc-ai-chat-bubble__verdict-badge" size="xs" radius="sm" variant="light" color="yellow">
                {$('部分完成')}
              </Badge>
            ) : null}
            {!isUser && message.turnVerdict?.status === 'failed' ? (
              <Badge className="tc-ai-chat-bubble__verdict-badge" size="xs" radius="sm" variant="light" color="red">
                {$('结构失败')}
              </Badge>
            ) : null}
          </Group>
          <Text className="tc-ai-chat-bubble__time" size="xs" c="dimmed">
            {message.ts}
          </Text>
        </Group>
        {!isUser && verdictSummary ? (
          <div className="tc-ai-chat-bubble__verdict">
            <Text className="tc-ai-chat-bubble__verdict-text" size="xs" c={message.turnVerdict?.status === 'failed' ? 'red' : 'yellow'}>
              {verdictSummary}
            </Text>
          </div>
        ) : null}
        {message.phase === 'thinking' && !isUser ? (
          <div className="tc-ai-chat-thinking" aria-label="ai-chat-thinking">
            <div className="tc-ai-chat-thinking__header">
              <Text className="tc-ai-chat-thinking__title">正在处理</Text>
            </div>
            <div className="tc-ai-chat-thinking__progress" aria-hidden="true">
              <div className="tc-ai-chat-thinking__progress-bar" />
            </div>
            <div className="tc-ai-chat-thinking__lines">
              <p className="tc-ai-chat-thinking__line" style={{ opacity: 1, transform: 'translateY(0)' }}>
                {thinkingSummary}
              </p>
              {progressLines.map((line, index) => (
                <p
                  key={`${message.id}-progress-${index}`}
                  className="tc-ai-chat-thinking__line"
                  style={{ opacity: 0.82, transform: 'translateY(0)' }}
                >
                  {line}
                </p>
              ))}
            </div>
            <p className="tc-ai-chat-thinking__comfort">处理细节已收起，完成后会给你最终结果。</p>
          </div>
        ) : (
          <div className="tc-ai-chat-bubble__content tc-ai-chat-markdown">
            {shouldRenderMarkdown ? (
              <ReactMarkdown
                components={{
                  p: ({ node: _node, ...props }) => <p className="tc-ai-chat-markdown__paragraph" {...props} />,
                  a: ({ node: _node, ...props }) => <a className="tc-ai-chat-markdown__link" target="_blank" rel="noreferrer" {...props} />,
                  ul: ({ node: _node, ...props }) => <ul className="tc-ai-chat-markdown__list tc-ai-chat-markdown__list--unordered" {...props} />,
                  ol: ({ node: _node, ...props }) => <ol className="tc-ai-chat-markdown__list tc-ai-chat-markdown__list--ordered" {...props} />,
                  li: ({ node: _node, ...props }) => <li className="tc-ai-chat-markdown__list-item" {...props} />,
                  blockquote: ({ node: _node, ...props }) => <blockquote className="tc-ai-chat-markdown__blockquote" {...props} />,
                  img: ({ node: _node, ...props }) => <img className="tc-ai-chat-markdown__image" loading="lazy" referrerPolicy="no-referrer" {...props} />,
                  h1: ({ node: _node, ...props }) => <h1 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h1" {...props} />,
                  h2: ({ node: _node, ...props }) => <h2 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h2" {...props} />,
                  h3: ({ node: _node, ...props }) => <h3 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h3" {...props} />,
                  h4: ({ node: _node, ...props }) => <h4 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h4" {...props} />,
                  code: ({ node: _node, className, children, ...props }) => {
                    const isInline = !String(className || '').includes('language-')
                    if (isInline) {
                      return <code className="tc-ai-chat-markdown__code tc-ai-chat-markdown__code--inline" {...props}>{children}</code>
                    }
                    return <code className={`tc-ai-chat-markdown__code tc-ai-chat-markdown__code--block ${className || ''}`.trim()} {...props}>{children}</code>
                  },
                  pre: ({ node: _node, ...props }) => <pre className="tc-ai-chat-markdown__pre" {...props} />,
                  hr: ({ node: _node, ...props }) => <hr className="tc-ai-chat-markdown__divider" {...props} />,
                  table: ({ node: _node, ...props }) => <table className="tc-ai-chat-markdown__table" {...props} />,
                  thead: ({ node: _node, ...props }) => <thead className="tc-ai-chat-markdown__table-head" {...props} />,
                  tbody: ({ node: _node, ...props }) => <tbody className="tc-ai-chat-markdown__table-body" {...props} />,
                  tr: ({ node: _node, ...props }) => <tr className="tc-ai-chat-markdown__table-row" {...props} />,
                  th: ({ node: _node, ...props }) => <th className="tc-ai-chat-markdown__table-cell tc-ai-chat-markdown__table-cell--head" {...props} />,
                  td: ({ node: _node, ...props }) => <td className="tc-ai-chat-markdown__table-cell tc-ai-chat-markdown__table-cell--body" {...props} />,
                }}
              >
                {markdownText}
              </ReactMarkdown>
            ) : null}
          </div>
        )}
        {!isUser && todoItems.length > 0 ? (
          <div className="tc-ai-chat-bubble__todo" aria-label="todo-write">
            <Group className="tc-ai-chat-bubble__todo-header" justify="space-between" align="center" gap={8} mb={8} wrap="nowrap">
              <Text className="tc-ai-chat-bubble__todo-title" size="xs" fw={700}>
                Todo
              </Text>
              <Badge className="tc-ai-chat-bubble__todo-badge" size="xs" radius="sm" variant="light" color="orange">
                {todoItems.filter((item) => item.status === 'completed').length}/{todoItems.length}
              </Badge>
            </Group>
            <Stack className="tc-ai-chat-bubble__todo-list" gap={6}>
              {todoItems.map((item, index) => (
                <Group key={`${message.id}_todo_${index}`} className="tc-ai-chat-bubble__todo-item" gap={8} align="flex-start" wrap="nowrap">
                  <span className={`tc-ai-chat-bubble__todo-mark tc-ai-chat-bubble__todo-mark--${item.status}`} aria-hidden="true">
                    {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '•' : ''}
                  </span>
                  <Text className="tc-ai-chat-bubble__todo-text" size="sm">
                    {item.content}
                  </Text>
                </Group>
              ))}
            </Stack>
          </div>
        ) : null}
        {!isUser && diagnosticFlags.length > 0 ? (
          <div className="tc-ai-chat-bubble__diagnostics" aria-label="chat-diagnostics">
            <Stack className="tc-ai-chat-bubble__diagnostics-list" gap={6} mt={8}>
              {diagnosticFlags.map((flag, index) => (
                <div key={`${message.id}_diagnostic_${flag.code}_${index}`} className="tc-ai-chat-bubble__diagnostic-item">
                  <Group className="tc-ai-chat-bubble__diagnostic-header" gap={8} align="center" wrap="nowrap">
                    <Badge
                      className="tc-ai-chat-bubble__diagnostic-badge"
                      size="xs"
                      radius="sm"
                      variant="light"
                      color={flag.severity === 'high' ? 'red' : 'yellow'}
                    >
                      {flag.severity === 'high' ? $('高风险') : $('提示')}
                    </Badge>
                    <Text className="tc-ai-chat-bubble__diagnostic-title" size="xs" fw={700}>
                      {flag.title}
                    </Text>
                  </Group>
                  <Text className="tc-ai-chat-bubble__diagnostic-detail" size="xs" c="dimmed">
                    {flag.detail}
                  </Text>
                </div>
              ))}
            </Stack>
          </div>
        ) : null}
        {Array.isArray(message.assets) && message.assets.length > 0 ? (
          <Group className="tc-ai-chat-bubble__assets" gap={8} mt={8} align="flex-start" wrap="wrap">
            {message.assets.map((asset, idx) => {
              const url = String(asset?.url || '').trim()
              if (!url) return null
              const preview = String(asset?.thumbnailUrl || url).trim()
              return (
                <a
                  key={`${message.id}_asset_${idx}`}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="tc-ai-chat-bubble__asset-link"
                >
                  <img
                    className="tc-ai-chat-bubble__asset-image"
                    src={preview}
                    alt={asset.title || `asset-${idx + 1}`}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                </a>
              )
            })}
          </Group>
        ) : null}
      </PanelCard>
    </Group>
  )
}

export default function AiChatDialog({ className }: { className?: string }): JSX.Element | null {
  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const initialLayoutPreference = React.useMemo(() => readAiChatLayoutPreference(), [])
  const [mode, setMode] = React.useState<'compact' | 'expanded' | 'maximized'>(initialLayoutPreference.mode)
  const [bubbleVisualState, setBubbleVisualState] = React.useState<'bubble' | 'panel'>(() => resolveInitialBubbleVisualState(initialLayoutPreference))
  const modeBeforeMaximizeRef = React.useRef<'compact' | 'expanded'>(initialLayoutPreference.mode)
  const previousModeRef = React.useRef<'compact' | 'expanded' | 'maximized'>(initialLayoutPreference.mode)
  const bubbleTransitionTimerRef = React.useRef<number | null>(null)
  const dockRight = true
  const [manualReferenceImages, setManualReferenceImages] = React.useState<string[]>(() => [])
  const manualReferenceImagesRef = React.useRef<string[]>([])
  const [autoReferenceImages, setAutoReferenceImages] = React.useState<string[]>(() => [])
  const [hiddenAutoReferenceUrls, setHiddenAutoReferenceUrls] = React.useState<string[]>(() => [])
  const referenceImagesRef = React.useRef<string[]>([])
  const uploadedReferenceAssetMetaRef = React.useRef<Record<string, UploadedReferenceAssetMeta>>({})
  const autoReferenceResolveCacheRef = React.useRef<Map<string, string>>(new Map())
  const [refsLoading, setRefsLoading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const targetFileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [replicateTargetImage, setReplicateTargetImage] = React.useState<string>('')
  const [replicatePickerOpened, setReplicatePickerOpened] = React.useState(false)

  const [draft, setDraft] = React.useState('')
  const [messages, setMessages] = React.useState<ChatMessage[]>(() => [])
  const [sending, setSending] = React.useState(false)

  const [agentLoading, setAgentLoading] = React.useState(false)
  const [agentSkills, setAgentSkills] = React.useState<AgentSkillDto[]>([])
  const [activeSkill, setActiveSkill] = React.useState<AgentSkillDto | null>(null)
  const [chatSessionBaseKey, setChatSessionBaseKey] = React.useState<string>(() => readOrCreateChatSessionBaseKey())
  const [chatSessionLane, setChatSessionLane] = React.useState<ChatSessionLane>('general')
  const [tutorialOpened, setTutorialOpened] = React.useState(false)
  const activePanel = useUIStore((s) => s.activePanel)
  const currentProjectId = useUIStore((s) => (s.currentProject?.id ? String(s.currentProject.id).trim() : ''))
  const currentProjectName = useUIStore((s) => (s.currentProject?.name ? String(s.currentProject.name).trim() : ''))
  const currentFlowId = useUIStore((s) => (s.currentFlow?.id ? String(s.currentFlow.id).trim() : ''))
  const aiChatWatchAssetsEnabled = useUIStore((s) => s.aiChatWatchAssetsEnabled)
  const setAiChatWatchAssetsEnabled = useUIStore((s) => s.setAiChatWatchAssetsEnabled)
  const clearCreationSession = useUIStore((s) => s.clearCreationSession)
  const startLiveChatRun = useLiveChatRunStore((s) => s.startRun)
  const recordLiveChatRunEvent = useLiveChatRunStore((s) => s.recordEvent)
  const completeLiveChatRun = useLiveChatRunStore((s) => s.completeRun)
  const failLiveChatRun = useLiveChatRunStore((s) => s.failRun)
  const [projectTextMaterialState, setProjectTextMaterialState] = React.useState<ProjectTextMaterialState>({
    status: 'idle',
    count: 0,
    error: '',
  })
  const refreshProjectTextMaterialState = React.useCallback(async (projectId: string) => {
    const normalizedProjectId = String(projectId || '').trim()
    if (!normalizedProjectId) {
      setProjectTextMaterialState({ status: 'ready', count: 0, error: '' })
      return
    }
    setProjectTextMaterialState((prev) => ({ ...prev, status: 'loading', error: '' }))
    try {
      const items = await listProjectMaterials(normalizedProjectId)
      setProjectTextMaterialState({
        status: 'ready',
        count: Array.isArray(items) ? items.length : 0,
        error: '',
      })
    } catch (error: unknown) {
      setProjectTextMaterialState({
        status: 'failed',
        count: 0,
        error: error instanceof Error ? error.message : '加载项目文本素材失败',
      })
    }
  }, [])
  React.useEffect(() => {
    void refreshProjectTextMaterialState(currentProjectId)
  }, [currentProjectId, refreshProjectTextMaterialState])

  const selectedCanvasImageSignature = useRFStore(
    React.useCallback((s) => {
      const selectedImages = s.nodes
        .filter((n) => n.selected && isImageKind(String((n.data as { kind?: string } | undefined)?.kind || '')))
        .map((n) => `${String(n.id || '').trim()}:${pickPrimaryImageUrlFromNode(n as Node)}`)
        .filter(Boolean)
      return selectedImages.join('|')
    }, []),
  )
  const canvasImageCandidates = useRFStore(
    React.useCallback((s) => {
      const out: Array<{ id: string; url: string; label: string }> = []
      const seen = new Set<string>()
      for (const node of s.nodes) {
        if (!isImageKind(String((node.data as { kind?: string } | undefined)?.kind || ''))) continue
        const url = pickPrimaryImageUrlFromNode(node as Node)
        const trimmed = String(url || '').trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        const data = (node.data || {}) as { label?: unknown }
        const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : `图片-${out.length + 1}`
        out.push({ id: String(node.id || '').trim(), url: trimmed, label })
        if (out.length >= 120) break
      }
      return out
    }, []),
  )
  const selectedCanvasNodeContext = useRFStore(
    React.useCallback((s) => {
      const selectedNodes = s.nodes.filter((node) => node.selected)
      if (!selectedNodes.length) return null
      const prioritized = selectedNodes.find((node) => String((node.data as { kind?: unknown } | undefined)?.kind || '').trim())
        || selectedNodes[0]
      return extractSelectedCanvasNodeContextFromGraph(prioritized as Node, s.nodes as Node[], s.edges)
    }, []),
  )
  const agentLoadingRef = React.useRef(false)
  const historyLoadVersionRef = React.useRef(0)
  const loadedSessionKeyRef = React.useRef('')
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const messagesContentRef = React.useRef<HTMLDivElement | null>(null)
  const compactInputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const expandedInputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const activeStreamInterruptRef = React.useRef<null | (() => void)>(null)
  const typewriterRunIdRef = React.useRef(0)
  const shouldAutoScrollRef = React.useRef(true)

  const isCompact = mode === 'compact'
  const isMaximized = mode === 'maximized'
  const showDockedBubble = dockRight && bubbleVisualState === 'bubble'
  const canShowHistory = mode === 'expanded' || mode === 'maximized'
  const useScrollableHistory = canShowHistory
  const showProjectTextMaterialHint = shouldShowProjectTextMaterialHint({
    currentProjectId,
    projectTextMaterialState,
    selectedCanvasNodeContext,
  })
  const hasExplicitTargetImage = Boolean(String(replicateTargetImage || '').trim())
  const effectiveChatSessionKey = React.useMemo(() => {
    return buildEffectiveChatSessionKey({
      persistedBaseKey: chatSessionBaseKey,
      projectId: currentProjectId,
      flowId: currentFlowId,
      lane: chatSessionLane,
      skillId: activeSkill?.id ?? null,
    })
  }, [activeSkill?.id, chatSessionBaseKey, chatSessionLane, currentFlowId, currentProjectId])

  React.useEffect(() => {
    if (mode === 'maximized') return
    writeAiChatLayoutPreference({ dockRight: true, mode })
  }, [mode])

  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const rootStyle = document.documentElement.style
    const reservedWidth =
      mode === 'maximized'
        ? AI_CHAT_LAYOUT_RESERVED_WIDTH_NONE
        : mode === 'compact'
          ? AI_CHAT_LAYOUT_RESERVED_WIDTH_NONE
          : AI_CHAT_LAYOUT_RESERVED_WIDTH_EXPANDED
    rootStyle.setProperty('--tc-ai-chat-reserved-width', reservedWidth)
    return () => {
      rootStyle.setProperty('--tc-ai-chat-reserved-width', AI_CHAT_LAYOUT_RESERVED_WIDTH_NONE)
    }
  }, [mode])

  React.useEffect(() => {
    const sessionKey = String(effectiveChatSessionKey || '').trim()
    shouldAutoScrollRef.current = true
    const requestVersion = historyLoadVersionRef.current + 1
    historyLoadVersionRef.current = requestVersion
    const sessionChanged = loadedSessionKeyRef.current !== sessionKey
    loadedSessionKeyRef.current = sessionKey
    if (sessionChanged) {
      typewriterRunIdRef.current += 1
      activeStreamInterruptRef.current?.()
      activeStreamInterruptRef.current = null
      setMessages([])
    }
    if (!sessionKey) {
      setMessages([])
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const response = await getMemoryContext({
          sessionKey,
          recentConversationLimit: 20,
          limitPerScope: 4,
        })
        if (cancelled || historyLoadVersionRef.current !== requestVersion) return
        const history = Array.isArray(response.context.recentConversation)
          ? response.context.recentConversation
              .map((item, index) => mapMemoryConversationItemToChatMessage(item, index))
              .filter((item): item is ChatMessage => Boolean(item))
          : []
        setMessages((prev) => mergeLoadedHistoryWithLocalMessages(history, prev))
      } catch (error: unknown) {
        if (cancelled || historyLoadVersionRef.current !== requestVersion) return
        console.warn('[ai-chat] load conversation history failed', error)
        setMessages([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [effectiveChatSessionKey])

  const scrollToBottom = React.useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    try {
      el.scrollTop = el.scrollHeight
      shouldAutoScrollRef.current = true
    } catch {
      // ignore
    }
  }, [])

  const syncAutoScrollPreference = React.useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    shouldAutoScrollRef.current = isViewportNearBottom(el)
  }, [])

  const messageScrollKey = React.useMemo(
    () => messages.map((message) => `${message.id}:${message.ts}:${message.content}:${message.assets?.map((asset) => `${asset.title}:${asset.url}:${asset.thumbnailUrl || ''}`).join('|') || ''}`).join('\n'),
    [messages],
  )

  React.useLayoutEffect(() => {
    if (!canShowHistory) return
    const raf = window.requestAnimationFrame(() => {
      if (!shouldAutoScrollRef.current) return
      scrollToBottom()
    })
    return () => window.cancelAnimationFrame(raf)
  }, [canShowHistory, messageScrollKey, scrollToBottom])

  React.useEffect(() => {
    if (!canShowHistory) return
    const contentEl = messagesContentRef.current
    if (!contentEl || typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(() => {
      if (!shouldAutoScrollRef.current) return
      scrollToBottom()
    })

    resizeObserver.observe(contentEl)
    return () => {
      resizeObserver.disconnect()
    }
  }, [canShowHistory, scrollToBottom])

  React.useEffect(() => {
    if (!canShowHistory) return
    const viewportEl = viewportRef.current
    if (!viewportEl) return

    shouldAutoScrollRef.current = isViewportNearBottom(viewportEl)
    const handleScroll = () => {
      syncAutoScrollPreference()
    }

    viewportEl.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      viewportEl.removeEventListener('scroll', handleScroll)
    }
  }, [canShowHistory, messageScrollKey, syncAutoScrollPreference])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    if (!canShowHistory) return
    if (messages.length === 0) return
    shouldAutoScrollRef.current = true
    let rafId = 0
    let timeoutId = 0
    rafId = window.requestAnimationFrame(() => {
      scrollToBottom()
      timeoutId = window.setTimeout(() => {
        scrollToBottom()
      }, 40)
    })
    return () => {
      window.cancelAnimationFrame(rafId)
      window.clearTimeout(timeoutId)
    }
  }, [canShowHistory, messages.length, mode, scrollToBottom])

  const reloadAgentSkill = React.useCallback(async () => {
    if (agentLoadingRef.current) return
    agentLoadingRef.current = true
    setAgentLoading(true)
    try {
      const publicSkills = await listPublicAgentSkills()
      const skills: AgentSkillDto[] = publicSkills
        .filter((skill) => skill && skill.enabled !== false && skill.visible !== false)
        .sort((a, b) => {
          const sa = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER
          const sb = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER
          if (sa !== sb) return sa - sb
          return String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''))
        })

      setAgentSkills(skills)
      setActiveSkill((prev) => {
        if (!prev) return null
        const matched = skills.find((skill) => skill.id === prev.id)
        return matched || null
      })
    } catch (err: any) {
      console.warn('[ai-chat] get agent skill failed', err)
      setAgentSkills([])
      setActiveSkill(null)
      toast(err?.message || '加载 Skill 失败', 'error')
    } finally {
      agentLoadingRef.current = false
      setAgentLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reloadAgentSkill()
  }, [reloadAgentSkill])

  React.useEffect(() => {
    manualReferenceImagesRef.current = manualReferenceImages
  }, [manualReferenceImages])

  const visibleAutoReferenceImages = React.useMemo(() => {
    if (!autoReferenceImages.length) return []
    const hidden = new Set(hiddenAutoReferenceUrls)
    return autoReferenceImages.filter((url) => !hidden.has(url))
  }, [autoReferenceImages, hiddenAutoReferenceUrls])

  const referenceImages = React.useMemo(() => {
    const merged: string[] = []
    const seen = new Set<string>()
    const push = (url: string) => {
      const trimmed = String(url || '').trim()
      if (!trimmed || seen.has(trimmed)) return
      seen.add(trimmed)
      merged.push(trimmed)
    }

    visibleAutoReferenceImages.forEach(push)
    manualReferenceImages.forEach(push)
    return merged
  }, [manualReferenceImages, visibleAutoReferenceImages])

  React.useEffect(() => {
    referenceImagesRef.current = referenceImages
  }, [referenceImages])

  React.useEffect(() => {
    const autoSet = new Set(autoReferenceImages)
    setHiddenAutoReferenceUrls((prev) => {
      const next = prev.filter((url) => autoSet.has(url))
      return next.length === prev.length ? prev : next
    })
  }, [autoReferenceImages])

  React.useEffect(() => {
    let cancelled = false

    const loadAutoReferenceImages = async () => {
      const { nodes } = useRFStore.getState()
      const selectedImages = nodes
        .filter((n) => n.selected && isImageKind(String((n.data as { kind?: string } | undefined)?.kind || '')))

      const out: string[] = []
      const seen = new Set<string>()
      for (const node of selectedImages) {
        const raw = pickPrimaryImageUrlFromNode(node as Node)
        if (!raw) continue
        const cached = autoReferenceResolveCacheRef.current.get(raw)
        const resolved = cached || (await resolveReferenceImageUrl(raw))
        if (!resolved || seen.has(resolved)) continue
        autoReferenceResolveCacheRef.current.set(raw, resolved)
        seen.add(resolved)
        out.push(resolved)
      }

      if (!cancelled) {
        setAutoReferenceImages(out)
      }
    }

    void loadAutoReferenceImages()
    return () => {
      cancelled = true
    }
  }, [selectedCanvasImageSignature])

  const addReferenceImagesSafe = React.useCallback((urls: string[], opts?: { source?: string }) => {
    const raw = Array.isArray(urls) ? urls : []
    const incoming = raw.map((u) => String(u || '').trim()).filter(Boolean)
    if (!incoming.length) return

    const prevManual = Array.isArray(manualReferenceImagesRef.current) ? manualReferenceImagesRef.current : []
    const nextManual = [...prevManual]
    const mergedCurrent = Array.isArray(referenceImagesRef.current) ? referenceImagesRef.current : []
    const seen = new Set(mergedCurrent)
    let added = 0

    for (const url of incoming) {
      if (seen.has(url)) continue
      seen.add(url)
      nextManual.push(url)
      added += 1
    }

    manualReferenceImagesRef.current = nextManual
    setManualReferenceImages(nextManual)

    if (added > 0) {
      const sourceLabel = String(opts?.source || '').trim()
      toast(sourceLabel ? `已添加 ${added} 张参考图（${sourceLabel}）` : `已添加 ${added} 张参考图`, 'success')
    }
  }, [])

  const clearReferenceImages = React.useCallback(() => {
    const autoNow = Array.isArray(autoReferenceImages) ? autoReferenceImages : []
    manualReferenceImagesRef.current = []
    uploadedReferenceAssetMetaRef.current = {}
    setManualReferenceImages([])
    setHiddenAutoReferenceUrls(autoNow)
  }, [autoReferenceImages])

  const openReplicateTargetPicker = React.useCallback(() => {
    if (!canvasImageCandidates.length) {
      toast('画布里没有可选图片，请先上传或生成图片', 'error')
      return
    }
    setReplicatePickerOpened(true)
  }, [canvasImageCandidates.length])

  const chooseReplicateTargetFromCanvas = React.useCallback(async (raw: string) => {
    const source = String(raw || '').trim()
    if (!source) return
    if (!raw) {
      toast('选中的目标效果图无效', 'error')
      return
    }
    const resolved = await resolveReferenceImageUrl(source)
    if (!resolved) {
      toast('目标效果图解析失败，请重试或重新上传', 'error')
      return
    }
    setReplicateTargetImage(resolved)
    setReplicatePickerOpened(false)
    toast('已设置目标效果图', 'success')
  }, [])

  const onUploadReplicateTargetFile = React.useCallback(async (files: FileList | null) => {
    const file = files && files[0] ? files[0] : null
    if (!file) return
    try {
      const name = typeof file?.name === 'string' && file.name.trim() ? file.name.trim() : `target-${Date.now()}`
      const hosted = await uploadServerAssetFile(file, name, { taskKind: 'image_edit' })
      const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
      const abs = hostedUrl ? toAbsoluteApiUrl(hostedUrl) : null
      if (!abs) {
        toast('上传目标效果图失败：未获得可用 URL', 'error')
        return
      }
      setReplicateTargetImage(abs)
      toast('目标效果图上传成功', 'success')
    } catch (err: any) {
      toast(err?.message || '上传目标效果图失败', 'error')
    } finally {
      if (targetFileInputRef.current) targetFileInputRef.current.value = ''
    }
  }, [])

  const addSelectedCanvasImagesAsReferences = React.useCallback(async () => {
    if (refsLoading) return
    setRefsLoading(true)
    try {
      const { nodes } = useRFStore.getState()
      const selected = nodes.filter((n) => n.selected)
      const selectedImages = selected.filter((n) => isImageKind(String((n.data as any)?.kind || '')))
      if (!selectedImages.length) {
        toast('请先在画布中选中 1 张图片节点', 'error')
        return
      }

      const resolvedUrls: string[] = []
      for (const node of selectedImages) {
        const primary = pickPrimaryImageUrlFromNode(node as any)
        if (!primary) continue
        const resolved = await resolveReferenceImageUrl(primary)
        if (!resolved) continue
        resolvedUrls.push(resolved)
      }

      if (!resolvedUrls.length) {
        toast('选中的图片节点没有可用的图片 URL（请先上传/生成）', 'error')
        return
      }

      addReferenceImagesSafe(resolvedUrls, { source: '画布' })
    } finally {
      setRefsLoading(false)
    }
  }, [addReferenceImagesSafe, refsLoading])

  const onUploadReferenceFiles = React.useCallback(async (files: FileList | null) => {
    const list = files ? Array.from(files) : []
    if (!list.length) return

    if (refsLoading) return
    setRefsLoading(true)
    try {
      const urls: string[] = []
      for (const file of list) {
        const name = typeof file?.name === 'string' && file.name.trim() ? file.name.trim() : `upload-${Date.now()}`
        const hosted = await uploadServerAssetFile(file, name, { taskKind: 'image_edit' })
        const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
        const abs = hostedUrl ? toAbsoluteApiUrl(hostedUrl) : null
        if (abs) {
          urls.push(abs)
          uploadedReferenceAssetMetaRef.current[abs] = {
            ...(hosted.id ? { assetId: hosted.id } : null),
            ...(name ? { name } : null),
          }
        }
      }

      if (!urls.length) {
        toast('上传失败：未获得图片 URL', 'error')
        return
      }

      addReferenceImagesSafe(urls, { source: '上传' })
    } catch (err: any) {
      toast(err?.message || '上传参考图失败', 'error')
    } finally {
      setRefsLoading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }, [addReferenceImagesSafe, refsLoading])

  const expandChat = React.useCallback(() => {
    setMode((m) => {
      if (m !== 'compact') return m
      return 'expanded'
    })
  }, [])

  const collapseChat = React.useCallback(() => {
    setMode((m) => {
      if (m === 'compact') return m
      return 'compact'
    })
  }, [])

  const toggleMaximized = React.useCallback(() => {
    setMode((m) => {
      if (m === 'maximized') return modeBeforeMaximizeRef.current
      modeBeforeMaximizeRef.current = m === 'expanded' ? 'expanded' : 'compact'
      return 'maximized'
    })
  }, [])

  React.useEffect(() => {
    const previousMode = previousModeRef.current
    previousModeRef.current = mode

    if (typeof window === 'undefined') {
      setBubbleVisualState(mode === 'compact' ? 'bubble' : 'panel')
      return
    }

    if (bubbleTransitionTimerRef.current !== null) {
      window.clearTimeout(bubbleTransitionTimerRef.current)
      bubbleTransitionTimerRef.current = null
    }

    if (mode === 'compact') {
      if (previousMode === 'expanded' || previousMode === 'maximized') {
        setBubbleVisualState('panel')
        bubbleTransitionTimerRef.current = window.setTimeout(() => {
          setBubbleVisualState('bubble')
          bubbleTransitionTimerRef.current = null
        }, AI_CHAT_MODE_TRANSITION_MS)
        return
      }
      setBubbleVisualState('bubble')
      return
    }

    setBubbleVisualState('panel')
  }, [mode])

  React.useEffect(() => {
    return () => {
      if (bubbleTransitionTimerRef.current === null || typeof window === 'undefined') return
      window.clearTimeout(bubbleTransitionTimerRef.current)
    }
  }, [])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    if (mode !== 'expanded' && mode !== 'maximized') return
    const rafId = window.requestAnimationFrame(() => {
      expandedInputRef.current?.focus({ preventScroll: true })
    })
    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [clearCreationSession, mode])

  React.useEffect(() => {
    return () => {
      typewriterRunIdRef.current += 1
      activeStreamInterruptRef.current?.()
      activeStreamInterruptRef.current = null
    }
  }, [])

  const animateAssistantReply = React.useCallback(async (messageId: string, text: string) => {
    const normalized = String(text || '').trim() || '（空响应）'
    const runId = typewriterRunIdRef.current + 1
    typewriterRunIdRef.current = runId

    let visibleLength = 0
    while (visibleLength < normalized.length) {
      if (typewriterRunIdRef.current !== runId) return
      const remaining = normalized.length - visibleLength
      const nextStep = remaining > 160 ? 20 : remaining > 80 ? 10 : remaining > 32 ? 6 : 3
      visibleLength = Math.min(normalized.length, visibleLength + nextStep)
      const partial = normalized.slice(0, visibleLength)
      setMessages((prev) =>
        patchChatMessageById(prev, messageId, (message) => ({
          ...message,
          content: partial,
        })),
      )
      if (visibleLength < normalized.length) {
        await sleepMs(16)
      }
    }
  }, [])

  const interruptActiveChat = React.useCallback(() => {
    activeStreamInterruptRef.current?.()
  }, [])

  const normalizedDraft = React.useMemo(() => String(draft || '').trim(), [draft])
  const activeSkillContextName = React.useMemo(() => {
    const name = String(activeSkill?.name || activeSkill?.key || '').trim()
    return name || null
  }, [activeSkill?.key, activeSkill?.name])
  const implicitSendRequest = React.useMemo<ImplicitChatRequest | null>(() => {
    if (normalizedDraft) return null
    return buildImplicitChatRequest({
      selectedCanvasNodeContext,
      referenceImageCount: referenceImages.length,
      hasTargetImage: hasExplicitTargetImage,
      activeSkillName: activeSkillContextName,
    })
  }, [activeSkillContextName, hasExplicitTargetImage, normalizedDraft, referenceImages.length, selectedCanvasNodeContext])
  const canSendMessage = Boolean(normalizedDraft || implicitSendRequest)

  const send = React.useCallback(async (options?: SendOptions) => {
    if (sending) return
    const explicitText = String(options?.text ?? draft ?? '').trim()
    const requestText = explicitText || implicitSendRequest?.prompt || ''
    const displayText = explicitText || implicitSendRequest?.displayText || ''
    if (!requestText) return
    if (currentProjectId) {
      void (async () => {
        try {
          const materials = await listProjectMaterials(currentProjectId)
          setProjectTextMaterialState({
            status: 'ready',
            count: materials.length,
            error: '',
          })
        } catch (error: unknown) {
          console.warn('[ai-chat] pre-send listProjectMaterials failed, continue sending', error)
          setProjectTextMaterialState((prev) => ({
            status: 'failed',
            count: prev.count,
            error: error instanceof Error ? error.message : '加载项目文本素材失败',
          }))
        }
      })()
    } else {
      setProjectTextMaterialState({ status: 'ready', count: 0, error: '' })
    }
    const effectiveSkill = options?.skill === undefined ? activeSkill : options.skill
    const explicitAttachCanvasContext = options?.attachCanvasContext === true
    const targetEffectUrl = String(replicateTargetImage || '').trim()
    const selectedReplicateMode = Boolean(targetEffectUrl)
    const hasCanvasScope =
      Boolean(currentProjectId) ||
      Boolean(currentFlowId) ||
      Boolean(selectedCanvasNodeContext?.nodeId)
    const shouldAttachCanvasContext =
      explicitAttachCanvasContext ||
      (!explicitText && Boolean(implicitSendRequest)) ||
      selectedReplicateMode ||
      hasCanvasScope
    // Keep chat send path deterministic: project text material hints should not block
    // or alter reference collection unless an explicit isolation rule is introduced.
    const shouldUseProjectTextIsolation = false
    const nextSessionLane = resolveChatSessionLane({
      hasReplicateTarget: selectedReplicateMode,
    })
    const requestSessionKey = buildEffectiveChatSessionKey({
      persistedBaseKey: chatSessionBaseKey,
      projectId: currentProjectId,
      flowId: currentFlowId,
      lane: nextSessionLane,
      skillId: effectiveSkill?.id ?? null,
    })
    const requestProjectId = String(currentProjectId || '').trim()
    const requestFlowId = String(currentFlowId || '').trim()
    if (chatSessionLane !== nextSessionLane) {
      setChatSessionLane(nextSessionLane)
    }
    const requestSelectedCanvasNodeContext = shouldAttachCanvasContext
      ? selectedCanvasNodeContext
      : null

    let pendingId = ''
    setSending(true)
    typewriterRunIdRef.current += 1
    historyLoadVersionRef.current += 1
    try {
      let streamedReply = ''
      const manualReferenceImagesPayload = Array.isArray(referenceImages)
        ? referenceImages.map((u) => String(u || '').trim()).filter(Boolean)
        : []
      const focusedNodeContext = shouldUseProjectTextIsolation ? null : (() => {
        try {
          const { nodes } = useRFStore.getState()
          const selected = nodes.filter((n) => n.selected)
          if (selected.length !== 1) return null
          return extractFocusedNodeResourceContext(selected[0] as any)
        } catch {
          return null
        }
      })()

      const referenceImagesPayloadRaw = await (async (): Promise<string[]> => {
        const merged: string[] = []
        const seen = new Set<string>()
        const push = (url: string) => {
          const trimmed = String(url || '').trim()
          if (!trimmed || seen.has(trimmed)) return
          seen.add(trimmed)
          merged.push(trimmed)
        }

        manualReferenceImagesPayload.forEach(push)
        const rawCandidates = focusedNodeContext?.imageCandidates || []
        if (!rawCandidates.length) return merged
        for (const raw of rawCandidates) {
          const resolved = await resolveReferenceImageUrl(raw)
          if (!resolved) continue
          push(resolved)
        }

        return merged
      })()
      const referenceImagesPayload = selectedReplicateMode && targetEffectUrl
        ? referenceImagesPayloadRaw.filter((u) => u !== targetEffectUrl)
        : referenceImagesPayloadRaw
      const selectedAssetInputs: ChatAssetInput[] = shouldUseProjectTextIsolation ? [] : await (async (): Promise<ChatAssetInput[]> => {
        const { nodes } = useRFStore.getState()
        const selectedImages = nodes
          .filter((n) => n.selected && isImageKind(String((n.data as { kind?: string } | undefined)?.kind || '')))

        const candidates: Array<{
          assetId?: string
          url: string
          role?: ChatAssetInputRole
          note?: string
          name?: string
        }> = []
        for (let i = 0; i < selectedImages.length; i += 1) {
          const node = selectedImages[i]
          const primary = pickPrimaryImageUrlFromNode(node as Node)
          if (!primary) continue
          const resolved = await resolveReferenceImageUrl(primary)
          if (!resolved) continue
          candidates.push(buildSelectedImageAssetCandidate(node as Node, resolved))
        }
        return buildSelectedImageAssetInputs(candidates)
      })()
      const assetInputsPayload = (() => {
        const merged: ChatAssetInput[] = []
        const seenUrl = new Set<string>()
        const push = (item: ChatAssetInput) => {
          const role = String(item?.role || 'reference').trim() as ChatAssetInputRole
          const url = String(item?.url || '').trim()
          if (!url) return
          if (seenUrl.has(url)) return
          seenUrl.add(url)
          merged.push(item)
        }
        selectedAssetInputs.forEach(push)
        referenceImagesPayload.forEach((url) => {
          const uploadedMeta = uploadedReferenceAssetMetaRef.current[url] || null
          push({
            url,
            role: 'reference',
            ...(uploadedMeta?.assetId ? { assetId: uploadedMeta.assetId } : {}),
            ...(uploadedMeta?.name ? { name: uploadedMeta.name } : {}),
          })
        })
        if (selectedReplicateMode && targetEffectUrl) {
          merged.unshift({
            url: targetEffectUrl,
            role: 'target',
            note: '目标效果图：保持版式与模块布局',
          })
        }
        return merged
      })()
      const now = formatNowTime()
      const userMsg: ChatMessage = {
        id: `m_user_${Date.now()}`,
        role: 'user',
        ts: now,
        content: displayText || requestText,
      }
      pendingId = `m_ai_pending_${Date.now() + 1}`
      const pendingMsg: ChatMessage = {
        id: pendingId,
        role: 'assistant',
        ts: now,
        content: '处理中…',
        phase: 'thinking',
        kind: 'progress',
        progressLines: [],
      }

      setMessages((prev) => [...prev, userMsg, pendingMsg])

      setDraft('')
      if (mode === 'compact') setMode('expanded')

      const promptPayload = requestText
      const requestExecution = resolveChatRequestExecution()
      const selectedReferenceAnchorBindings = requestSelectedCanvasNodeContext
        ? normalizeSelectedReferenceAnchorBindings(requestSelectedCanvasNodeContext.anchorBindings)
        : undefined
      const requestPayload: AgentsChatRequestDto = {
        vendor: 'agents',
        prompt: promptPayload,
        ...(displayText && displayText !== requestText ? { displayPrompt: displayText } : {}),
        ...(requestSessionKey ? { sessionKey: requestSessionKey } : {}),
        ...(currentProjectId ? { canvasProjectId: currentProjectId } : {}),
        ...(currentFlowId ? { canvasFlowId: currentFlowId } : {}),
        ...(requestSelectedCanvasNodeContext?.nodeId ? { canvasNodeId: requestSelectedCanvasNodeContext.nodeId } : {}),
        chatContext: {
          ...(effectiveSkill
            ? {
                skill: {
                  ...(effectiveSkill.key ? { key: effectiveSkill.key } : {}),
                  ...(effectiveSkill.name ? { name: effectiveSkill.name } : {}),
                },
              }
            : {}),
          ...(requestSelectedCanvasNodeContext?.kind ? { selectedNodeKind: requestSelectedCanvasNodeContext.kind } : {}),
          ...(requestSelectedCanvasNodeContext
            ? {
                selectedReference: {
                  nodeId: requestSelectedCanvasNodeContext.nodeId,
                  label: requestSelectedCanvasNodeContext.label,
                  ...(requestSelectedCanvasNodeContext.kind ? { kind: requestSelectedCanvasNodeContext.kind } : {}),
                  ...(selectedReferenceAnchorBindings?.length
                    ? { anchorBindings: selectedReferenceAnchorBindings }
                    : {}),
                  ...(requestSelectedCanvasNodeContext.roleName ? { roleName: requestSelectedCanvasNodeContext.roleName } : {}),
                  ...(requestSelectedCanvasNodeContext.roleCardId ? { roleCardId: requestSelectedCanvasNodeContext.roleCardId } : {}),
                  ...(requestSelectedCanvasNodeContext.imageUrl ? { imageUrl: requestSelectedCanvasNodeContext.imageUrl } : {}),
                  ...(requestSelectedCanvasNodeContext.sourceUrl ? { sourceUrl: requestSelectedCanvasNodeContext.sourceUrl } : {}),
                  ...(requestSelectedCanvasNodeContext.bookId ? { bookId: requestSelectedCanvasNodeContext.bookId } : {}),
                  ...(requestSelectedCanvasNodeContext.chapterId ? { chapterId: requestSelectedCanvasNodeContext.chapterId } : {}),
                  ...(typeof requestSelectedCanvasNodeContext.shotNo === 'number' ? { shotNo: requestSelectedCanvasNodeContext.shotNo } : {}),
                  ...(requestSelectedCanvasNodeContext.productionLayer ? { productionLayer: requestSelectedCanvasNodeContext.productionLayer } : {}),
                  ...(requestSelectedCanvasNodeContext.creationStage ? { creationStage: requestSelectedCanvasNodeContext.creationStage } : {}),
                  ...(requestSelectedCanvasNodeContext.approvalStatus ? { approvalStatus: requestSelectedCanvasNodeContext.approvalStatus } : {}),
                  ...(requestSelectedCanvasNodeContext.authorityBaseFrameNodeId
                    ? { authorityBaseFrameNodeId: requestSelectedCanvasNodeContext.authorityBaseFrameNodeId }
                    : {}),
                  ...(requestSelectedCanvasNodeContext.authorityBaseFrameStatus
                    ? { authorityBaseFrameStatus: requestSelectedCanvasNodeContext.authorityBaseFrameStatus }
                    : {}),
                  ...(requestSelectedCanvasNodeContext.hasUpstreamTextEvidence ? { hasUpstreamTextEvidence: true } : {}),
                  ...(requestSelectedCanvasNodeContext.hasDownstreamComposeVideo ? { hasDownstreamComposeVideo: true } : {}),
                  ...(requestSelectedCanvasNodeContext.storyboardSelectionContext
                    ? { storyboardSelectionContext: requestSelectedCanvasNodeContext.storyboardSelectionContext }
                    : {}),
                },
              }
            : {}),
        },
        mode: requestExecution.mode,
        temperature: 0.7,
        ...(referenceImagesPayload.length ? { referenceImages: referenceImagesPayload } : {}),
        ...(assetInputsPayload.length ? { assetInputs: assetInputsPayload } : {}),
      }
      startLiveChatRun({
        runId: pendingId,
        requestText,
        displayText,
        projectId: currentProjectId,
        projectName: currentProjectName,
        flowId: currentFlowId,
        sessionKey: requestSessionKey,
        skillName: effectiveSkill?.name || effectiveSkill?.key || '',
      })
      const resp = await new Promise<AgentsChatResponseDto>((resolve, reject) => {
        let stopStream: (() => void) | null = null
        let settled = false
        let resultReceived = false
        let latestThinkingSummary = '正在处理你的请求'
        const updatePendingProgressLine = (line: string) => {
          const normalized = String(line || '').trim()
          if (!normalized) return
          setMessages((prev) =>
            patchChatMessageById(prev, pendingId, (message) => ({
              ...message,
              progressLines: dedupeProgressLines([...(message.progressLines || []), normalized]),
            })),
          )
        }
        const updatePendingSummary = (summary: string) => {
          const nextSummary = summarizeThinkingText(summary)
          if (!nextSummary || nextSummary === latestThinkingSummary) return
          latestThinkingSummary = nextSummary
          setMessages((prev) =>
            patchChatMessageById(prev, pendingId, (message) => ({
              ...message,
              content: nextSummary,
            })),
          )
        }

        const finalize = (resolver: () => void) => {
          if (settled) return
          settled = true
          activeStreamInterruptRef.current = null
          if (stopStream) stopStream()
          resolver()
        }

        activeStreamInterruptRef.current = () => {
          finalize(() => reject(new Error(CHAT_STREAM_ABORT_ERROR)))
        }

        void agentsChatStream(requestPayload, {
          onEvent: (event) => {
            if (settled) return
            recordLiveChatRunEvent(event)
            if (event.event === 'thinking') {
              const line = String(event.data.text || '').trim()
              if (!line) return
              if (streamedReply) return
              updatePendingSummary(line)
              return
            }
            if (event.event === 'tool') {
              const line = formatToolProgressLine(event.data)
              updatePendingProgressLine(line)
              if (!streamedReply) {
                updatePendingSummary(line)
              }
              return
            }
            if (event.event === 'todo_list') {
              const todoItems = normalizeChatTodoItems(event.data.items)
              if (!todoItems.length) return
              const activeItem = findInProgressTodoItem(todoItems)
              const summary = activeItem
                ? `正在执行：${activeItem.content}`
                : `正在整理任务清单（${countCompletedTodoItems(todoItems)}/${todoItems.length}）`
              setMessages((prev) =>
                patchChatMessageById(prev, pendingId, (message) => ({
                  ...message,
                  todoSnapshot: todoItems,
                })),
              )
              if (!streamedReply) {
                updatePendingSummary(summary)
              }
              return
            }
            if (event.event === 'content') {
              const delta = String(event.data.delta || '')
              if (!delta) return
              streamedReply += delta
              updatePendingSummary('正在整理最终结果')
              return
            }
            if (event.event === 'result') {
              resultReceived = true
              finalize(() => resolve(event.data.response))
              return
            }
            if (event.event === 'error') {
              finalize(() => reject(new Error(formatAgentsStreamErrorMessage(event.data))))
              return
            }
            if (event.event === 'done') {
              if (resultReceived) return
              const reason = String(event.data.reason || '').trim()
              const message =
                reason === 'error'
                  ? '对话流异常结束'
                  : '对话流已结束，但未返回最终结果'
              finalize(() => reject(new Error(message)))
            }
          },
          onError: (error) => {
            finalize(() => reject(error))
          },
        })
          .then((abort) => {
            if (settled) {
              abort()
              return
            }
            stopStream = abort
          })
          .catch((error) => {
            finalize(() => reject(error instanceof Error ? error : new Error('对话流失败')))
          })
      })
      const rawReply = typeof resp?.text === 'string' ? resp.text.trim() : ''
      const { displayText: parsedReply, plan: canvasPlan } = parseCanvasPlanFromReply(rawReply)
      const hasWrongCanvasPlanTag = /<tcanvas_canvas_plan>/i.test(rawReply) || /tcanvas_canvas_plan/i.test(rawReply)
      const turnVerdict = readChatTurnVerdict(resp)
      const turnVerdictSummary = formatChatTurnVerdictSummary(resp)
      const failedTurn = isFailedChatTurn(resp)
      const failedTurnMessage = turnVerdictSummary || '结构失败：本轮没有形成有效结果'
      const missingCanvasPlan = shouldShowMissingCanvasPlanError({
        hasCanvasPlan: Boolean(canvasPlan),
        hasWrongCanvasPlanTag,
        response: resp,
      })
      const reply = parsedReply || rawReply || '（空响应）'
      const parsedAutoImages = extractTapCanvasAutoGeneratedImages(reply)
      const assistantAssetsRaw = normalizeAssistantAssets((resp as any)?.assets)
      const assistantAssets = mergeAssistantAssets(assistantAssetsRaw, parsedAutoImages)
      let canvasPlanExecuted = false
      let failedTurnHandled = false
      const backendWroteCanvas =
        resp.agentDecision?.canvasAction === 'write_canvas' ||
        resp.trace?.toolEvidence?.wroteCanvas === true
      if (canvasPlan) {
        setMessages((prev) =>
          patchChatMessageById(prev, pendingId, (message) => ({
            ...message,
            content: '正在应用节点方案',
          })),
        )
        try {
          const executed = await executeCanvasPlan(canvasPlan)
          canvasPlanExecuted = executed.createdNodeIds.length > 0
          if (!failedTurn && executed.createdNodeIds.length > 0) {
            autoRunAiChatCanvasNodes(executed.createdNodeIds)
          }
          const executedPrimaryNodeId = pickPrimaryCreationNodeId(
            executed.createdNodeIds.length > 0 ? executed.createdNodeIds : executed.resolvedNodeIds,
          )
          if (typeof window !== 'undefined' && typeof (window as unknown as { silentSaveProject?: () => void }).silentSaveProject === 'function') {
            ;(window as unknown as { silentSaveProject: () => void }).silentSaveProject()
          }
        } catch (error: unknown) {
          void error
        }
      } else if (missingCanvasPlan) {
        failedTurnHandled = true
      }
      if (failedTurn && !failedTurnHandled) failedTurnHandled = true
      if (!canvasPlanExecuted && backendWroteCanvas && requestFlowId) {
        try {
          const reloaded = await reloadCanvasFlowFromServer({
            flowId: requestFlowId,
            expectedProjectId: requestProjectId,
            expectedFlowId: requestFlowId,
          })
          const reloadAutoRunPlan = resolveAiChatReloadAutoRunPlan({
            newNodeIds: reloaded.newNodeIds,
            traceCanvasMutation: resp.trace?.canvasMutation,
            failedTurn,
          })
          if (reloaded.reloaded) {
            if (reloadAutoRunPlan.focusNodeIds.length > 0) {
              focusCanvasNodeAfterReload(reloadAutoRunPlan.focusNodeIds)
            }
            if (reloadAutoRunPlan.autoRunNewNodeIds.length > 0) {
              autoRunAiChatCanvasNodes(reloadAutoRunPlan.autoRunNewNodeIds)
            }
            if (reloadAutoRunPlan.autoRunPatchedNodeIds.length > 0) {
              autoRunAiChatPatchedCanvasNodes(reloadAutoRunPlan.autoRunPatchedNodeIds)
            }
          }
        } catch (error: unknown) {
          console.warn('[ai-chat] reload flow after backend canvas write failed', error)
        }
      }
      const shouldWatchAssets = shouldAutoAddAssistantAssetsToCanvas({
        canvasPlanExecuted,
        aiChatWatchAssetsEnabled,
        assistantAssetCount: assistantAssets.length,
        response: resp,
      })
      if (shouldWatchAssets) {
        setMessages((prev) =>
          patchChatMessageById(prev, pendingId, (message) => ({
            ...message,
            content: '正在整理最终结果',
          })),
        )
        addAssistantAssetsToCanvas(assistantAssets)
      }
      if (!streamedReply) {
        await animateAssistantReply(pendingId, reply || '（空响应）')
      }
      setMessages((prev) =>
        patchChatMessageById(prev, pendingId, (message) => ({
          ...message,
          content: reply || '（空响应）',
          assets: assistantAssets,
          ts: formatNowTime(),
          phase: 'final',
          kind: 'result',
          ...(Array.isArray(resp.trace?.todoList?.items)
            ? { todoSnapshot: normalizeChatTodoItems(resp.trace.todoList.items) }
            : null),
          ...(turnVerdict ? { turnVerdict } : null),
          ...(Array.isArray(resp.trace?.diagnosticFlags) ? { diagnosticFlags: resp.trace?.diagnosticFlags } : null),
        })),
      )
      completeLiveChatRun(resp, reply || '（空响应）')
    } catch (err: unknown) {
      activeStreamInterruptRef.current = null
      const msg = err instanceof Error ? err.message : '对话失败'
      if (isChatAbortError(err)) {
        failLiveChatRun(CHAT_ABORTED_MESSAGE)
        setMessages((prev) =>
          patchChatMessageById(prev, pendingId, (message) => ({
            ...message,
            content: CHAT_ABORTED_MESSAGE,
            phase: 'final',
            kind: 'error',
          })),
        )
        return
      }
      failLiveChatRun(msg)
      if (pendingId) {
        setMessages((prev) =>
          patchChatMessageById(prev, pendingId, (message) => ({
            ...message,
            content: `（错误）${msg}`,
            ts: formatNowTime(),
            phase: 'final',
            kind: 'error',
          })),
        )
      }
    } finally {
      activeStreamInterruptRef.current = null
      setSending(false)
    }
  }, [activeSkill, aiChatWatchAssetsEnabled, animateAssistantReply, chatSessionBaseKey, chatSessionLane, completeLiveChatRun, currentFlowId, currentProjectId, currentProjectName, draft, failLiveChatRun, implicitSendRequest, messages, mode, recordLiveChatRunEvent, referenceImages, replicateTargetImage, selectedCanvasNodeContext, sending, startLiveChatRun])

  const resetConversationState = React.useCallback((nextSkill: AgentSkillDto | null) => {
    historyLoadVersionRef.current += 1
    clearCreationSession()
    setActiveSkill(nextSkill)
    setChatSessionLane('general')
    setDraft('')
    setMessages([])
    setReplicateTargetImage('')
    setChatSessionBaseKey(persistChatSessionBaseKey(createChatSessionBaseKey()))
    if (mode === 'compact') setMode('expanded')
  }, [clearCreationSession, mode])

  const selectSkillById = React.useCallback((skillId: string) => {
    const id = String(skillId || '').trim()
    if (!id) return
    const skill = agentSkills.find((item) => item.id === id)
    if (!skill) {
      toast('暂无可用 Skill（请在后台设置为可见）', 'error')
      void reloadAgentSkill()
      return
    }

    const nextSkill = activeSkill?.id === id ? null : skill
    resetConversationState(nextSkill)
  }, [activeSkill?.id, agentSkills, reloadAgentSkill, resetConversationState])

  const clearSkill = React.useCallback(() => {
    resetConversationState(null)
  }, [resetConversationState])

  const startNewConversation = React.useCallback(() => {
    historyLoadVersionRef.current += 1
    clearCreationSession()
    setChatSessionLane('general')
    setDraft('')
    setMessages([])
    setChatSessionBaseKey(persistChatSessionBaseKey(createChatSessionBaseKey()))
    toast('已开启新对话', 'success')
  }, [clearCreationSession])

  const applyTutorialPrompt = React.useCallback((prompt: string) => {
    setDraft(String(prompt || '').trim())
    setTutorialOpened(false)
    if (mode === 'compact') {
      setMode('expanded')
      return
    }
    const targetInput = mode === 'maximized' ? expandedInputRef.current : expandedInputRef.current || compactInputRef.current
    targetInput?.focus()
  }, [mode])

  const inspirationQuickActions = React.useMemo<InspirationQuickAction[]>(() => {
    return buildChatInspirationQuickActions({
      currentProjectId,
      currentProjectName,
      hasFocusedReference: Boolean(selectedCanvasNodeContext?.nodeId || referenceImages.length > 0),
      selectedNodeLabel: selectedCanvasNodeContext?.label || null,
      selectedNodeKind: selectedCanvasNodeContext?.kind || null,
      hasStoryboardContext: Boolean(
        selectedCanvasNodeContext?.storyboardSelectionContext
        || selectedCanvasNodeContext?.bookId
        || selectedCanvasNodeContext?.chapterId
        || typeof selectedCanvasNodeContext?.shotNo === 'number',
      ),
    }, $).map((action) => ({
      ...action,
      skill: null,
    }))
  }, [
    currentProjectId,
    currentProjectName,
    referenceImages.length,
    selectedCanvasNodeContext?.bookId,
    selectedCanvasNodeContext?.chapterId,
    selectedCanvasNodeContext?.kind,
    selectedCanvasNodeContext?.label,
    selectedCanvasNodeContext?.nodeId,
    selectedCanvasNodeContext?.shotNo,
    selectedCanvasNodeContext?.storyboardSelectionContext,
  ])
  const contextQuickActions = React.useMemo(
    () => inspirationQuickActions.filter((action) => action.group === 'context'),
    [inspirationQuickActions],
  )
  const projectQuickActions = React.useMemo(
    () => inspirationQuickActions.filter((action) => action.group === 'project'),
    [inspirationQuickActions],
  )
  const starterQuickActions = React.useMemo(
    () => inspirationQuickActions.filter((action) => action.group === 'starter'),
    [inspirationQuickActions],
  )

  const isEmptyConversation = messages.length === 0
  const headerStatusLabel = React.useMemo(() => {
    if (activeSkill) return $('Agent')
    return $('AUTO')
  }, [activeSkill])
  const headerTitle = isEmptyConversation ? $('新对话') : $('AI 对话')
  const headerSubtitle = React.useMemo(() => {
    if (sending) return $('正在处理当前请求')
    if (isEmptyConversation) return $('从一句创意开始，先整理思路，再决定执行方式')
    return $('继续基于当前画布与项目上下文协作')
  }, [isEmptyConversation, sending])
  const taskEntryLabel = React.useMemo(() => {
    const skillName = String(activeSkill?.name || activeSkill?.key || '').trim()
    return skillName || $('任务')
  }, [activeSkill])

  const runQuickPreset = React.useCallback(async (preset: {
    prompt: string
    skill: AgentSkillDto | null
    group: ChatQuickActionPreset['group']
  }) => {
    const nextSkill = preset.skill
    resetConversationState(nextSkill)
    await send({
      text: preset.prompt,
      skill: nextSkill,
      attachCanvasContext: preset.group === 'context',
    })
  }, [resetConversationState, send])

  const onRootKeyDownCapture = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    if (mode === 'maximized') {
      e.preventDefault()
      e.stopPropagation()
      toggleMaximized()
    }
  }, [mode, toggleMaximized])

  const onRootKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (mode !== 'maximized') return
    e.stopPropagation()
  }, [mode])

  const rootClassName = [
    'tc-ai-chat',
    `tc-ai-chat--${mode}`,
    dockRight ? 'tc-ai-chat--dock-right' : '',
    className,
  ].filter(Boolean).join(' ')

  const auraClassName = [
    'tc-ai-chat__aura',
    mode === 'compact' ? 'tc-ai-chat__aura--compact' : '',
    mode === 'maximized' ? 'tc-ai-chat__aura--maximized' : '',
  ].filter(Boolean).join(' ')
  const composerShellClassName = [
    'tc-ai-chat__composer-shell',
    referenceImages.length > 0 ? 'tc-ai-chat__composer-shell--with-refs' : '',
  ].filter(Boolean).join(' ')

  const attachMenu = (
    <Menu className="tc-ai-chat__attach-menu" position="top-start" zIndex={10050}>
      <Menu.Target>
        <AttachMenuTarget tooltip={$('添加参考图（从画布选择或上传）')} />
      </Menu.Target>
      <Menu.Dropdown className="tc-ai-chat__attach-dropdown">
        <Menu.Label className="tc-ai-chat__attach-label">{$('参考图')}</Menu.Label>
        <Menu.Item
          className="tc-ai-chat__attach-item"
          leftSection={<IconPhoto className="tc-ai-chat__attach-item-icon" size={16} />}
          onClick={() => void addSelectedCanvasImagesAsReferences()}
          disabled={sending || refsLoading}
        >
          {$('使用画布选中图片')}
        </Menu.Item>
        <Menu.Item
          className="tc-ai-chat__attach-item"
          leftSection={<IconUpload className="tc-ai-chat__attach-item-icon" size={16} />}
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || refsLoading}
        >
          {$('上传参考图')}
        </Menu.Item>
        <Menu.Divider className="tc-ai-chat__attach-divider" />
        <Menu.Item
          className="tc-ai-chat__attach-item"
          leftSection={<IconTrash className="tc-ai-chat__attach-item-icon" size={16} />}
          onClick={clearReferenceImages}
          disabled={sending || refsLoading || referenceImages.length === 0}
        >
          {$('清空参考图')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )

  const taskEntryMenuButton = (
    <Menu className="tc-ai-chat__experience-menu" withinPortal position="top-start" shadow="md" zIndex={10050}>
      <Menu.Target>
        <Tooltip className="tc-ai-chat__tooltip" label={$('选择快捷任务或能力')} withArrow>
          <Button
            className="tc-ai-chat__experience-toggle"
            size="xs"
            radius="sm"
            variant="light"
            color={activeSkill ? 'blue' : 'gray'}
            rightSection={<IconChevronDown className="tc-ai-chat__experience-toggle-icon" size={14} />}
            disabled={sending || agentLoading}
          >
            <IconBook2 className="tc-ai-chat__experience-toggle-spark" size={14} />
            {taskEntryLabel}
          </Button>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {contextQuickActions.length > 0 ? (
          <>
            <Menu.Label>{$('当前上下文')}</Menu.Label>
            {contextQuickActions.map((action) => (
              <Menu.Item
                key={action.key}
                className="tc-ai-chat__experience-menu-item"
                onClick={() => { void runQuickPreset(action) }}
                disabled={sending || action.disabled === true}
              >
                <div className="tc-ai-chat__experience-menu-content">
                  <span className="tc-ai-chat__experience-menu-title">{action.label}</span>
                  <span className="tc-ai-chat__experience-menu-description">{action.description}</span>
                </div>
              </Menu.Item>
            ))}
          </>
        ) : null}
        {projectQuickActions.length > 0 ? (
          <>
            {contextQuickActions.length > 0 ? <Menu.Divider /> : null}
            <Menu.Label>{$('项目任务')}</Menu.Label>
            {projectQuickActions.map((action) => (
              <Menu.Item
                key={action.key}
                className="tc-ai-chat__experience-menu-item"
                onClick={() => { void runQuickPreset(action) }}
                disabled={sending || action.disabled === true}
              >
                <div className="tc-ai-chat__experience-menu-content">
                  <span className="tc-ai-chat__experience-menu-title">{action.label}</span>
                  <span className="tc-ai-chat__experience-menu-description">{action.description}</span>
                </div>
              </Menu.Item>
            ))}
          </>
        ) : null}
        {starterQuickActions.length > 0 ? (
          <>
            {(contextQuickActions.length > 0 || projectQuickActions.length > 0) ? <Menu.Divider /> : null}
            <Menu.Label>{$('起步建议')}</Menu.Label>
            {starterQuickActions.map((action) => (
              <Menu.Item
                key={action.key}
                className="tc-ai-chat__experience-menu-item"
                onClick={() => { void runQuickPreset(action) }}
                disabled={sending || action.disabled === true}
              >
                <div className="tc-ai-chat__experience-menu-content">
                  <span className="tc-ai-chat__experience-menu-title">{action.label}</span>
                  <span className="tc-ai-chat__experience-menu-description">{action.description}</span>
                </div>
              </Menu.Item>
            ))}
          </>
        ) : null}
        {(contextQuickActions.length > 0 || projectQuickActions.length > 0 || starterQuickActions.length > 0) ? <Menu.Divider /> : null}
        <Menu.Label>{$('能力')}</Menu.Label>
        <Menu.Item
          className="tc-ai-chat__experience-menu-item"
          onClick={clearSkill}
          disabled={sending || agentLoading || !activeSkill}
        >
          <div className="tc-ai-chat__experience-menu-content">
            <span className="tc-ai-chat__experience-menu-title">{$('关闭当前能力')}</span>
            <span className="tc-ai-chat__experience-menu-description">{$('回到普通对话，不保留当前能力上下文')}</span>
          </div>
        </Menu.Item>
        {agentSkills.map((skill) => {
          const selected = activeSkill?.id === skill.id
          return (
            <Menu.Item
              key={skill.id}
              className="tc-ai-chat__experience-menu-item"
              onClick={() => selectSkillById(skill.id)}
              disabled={sending || agentLoading}
            >
              <div className="tc-ai-chat__experience-menu-content">
                <span className="tc-ai-chat__experience-menu-title">{selected ? `✓ ${skill.name || skill.key || '能力'}` : (skill.name || skill.key || '能力')}</span>
                <span className="tc-ai-chat__experience-menu-description">{skill.description || $('启用后后续对话将优先按该能力处理')}</span>
              </div>
            </Menu.Item>
          )
        })}
      </Menu.Dropdown>
    </Menu>
  )

  if (activePanel === 'nanoComic') {
    return null
  }

  return (
    <div className={rootClassName} data-ux-floating onKeyDownCapture={onRootKeyDownCapture} onKeyDown={onRootKeyDown}>
      <input
        ref={fileInputRef}
        className="tc-ai-chat__file-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => void onUploadReferenceFiles(e.currentTarget.files)}
      />
      <input
        ref={targetFileInputRef}
        className="tc-ai-chat__file-input tc-ai-chat__target-file-input"
        type="file"
        accept="image/*"
        onChange={(e) => void onUploadReplicateTargetFile(e.currentTarget.files)}
      />
      <Modal
        opened={replicatePickerOpened}
        onClose={() => setReplicatePickerOpened(false)}
        centered
        title={$('从画布中选择目标效果图')}
        size="lg"
      >
        <div className="tc-ai-chat__replicate-picker-grid">
          {canvasImageCandidates.map((item) => {
            const selected = replicateTargetImage === item.url
            return (
              <button
                key={`${item.id}_${item.url}`}
                type="button"
                className={`tc-ai-chat__replicate-picker-item${selected ? ' tc-ai-chat__replicate-picker-item--selected' : ''}`}
                onClick={() => void chooseReplicateTargetFromCanvas(item.url)}
              >
                <img className="tc-ai-chat__replicate-picker-thumb" src={item.url} alt={item.label} />
                <span className="tc-ai-chat__replicate-picker-label">{item.label}</span>
              </button>
            )
          })}
        </div>
      </Modal>
      <Modal
        opened={tutorialOpened}
        onClose={() => setTutorialOpened(false)}
        centered
        size="xl"
        title={$('AI 创作教程')}
      >
        <Stack className="tc-ai-chat__tutorial" gap="md">
          <PanelCard className="tc-ai-chat__tutorial-intro">
            <Stack className="tc-ai-chat__tutorial-intro-stack" gap={8}>
              <Text className="tc-ai-chat__tutorial-title" size="sm" fw={700}>
                {AI_CHAT_TUTORIAL_CONTENT.sourceTitle}
              </Text>
              <Text className="tc-ai-chat__tutorial-summary" size="sm" c="dimmed">
                {AI_CHAT_TUTORIAL_CONTENT.sourceSummary}
              </Text>
              <Stack className="tc-ai-chat__tutorial-methods" gap={6}>
                {AI_CHAT_TUTORIAL_CONTENT.methodology.map((item) => (
                  <Text key={item} className="tc-ai-chat__tutorial-method" size="sm">
                    {`• ${item}`}
                  </Text>
                ))}
              </Stack>
            </Stack>
          </PanelCard>

          {AI_CHAT_TUTORIAL_CONTENT.steps.map((step, index) => (
            <PanelCard key={step.id} className="tc-ai-chat__tutorial-card">
              <Stack className="tc-ai-chat__tutorial-card-stack" gap="sm">
                <Group className="tc-ai-chat__tutorial-card-header" justify="space-between" align="flex-start" wrap="nowrap">
                  <Stack className="tc-ai-chat__tutorial-card-heading" gap={6}>
                    <Group className="tc-ai-chat__tutorial-badges" gap={8}>
                      <Badge className="tc-ai-chat__tutorial-index" variant="light" radius="sm" color="blue">
                        {`演示 ${index + 1}`}
                      </Badge>
                      <Badge className="tc-ai-chat__tutorial-level" variant="outline" radius="sm" color="gray">
                        {step.difficulty}
                      </Badge>
                    </Group>
                    <Text className="tc-ai-chat__tutorial-card-title" size="sm" fw={700}>
                      {step.title}
                    </Text>
                    <Text className="tc-ai-chat__tutorial-card-summary" size="sm" c="dimmed">
                      {step.summary}
                    </Text>
                  </Stack>

                  <Button
                    className="tc-ai-chat__tutorial-apply"
                    variant="light"
                    size="xs"
                    onClick={() => applyTutorialPrompt(step.promptStarter)}
                  >
                    {$('试试这个')}
                  </Button>
                </Group>

                <Group className="tc-ai-chat__tutorial-meta" gap={8}>
                  <Badge className="tc-ai-chat__tutorial-scene" variant="light" radius="sm" color="violet">
                    {step.sceneType}
                  </Badge>
                  <Badge className="tc-ai-chat__tutorial-action" variant="outline" radius="sm" color="cyan">
                    {step.coreAction}
                  </Badge>
                </Group>

                <Text className="tc-ai-chat__tutorial-scene-description" size="sm">
                  {step.sceneDescription}
                </Text>
                <Text className="tc-ai-chat__tutorial-why" size="sm">
                  {step.whyThisStep}
                </Text>

                <div className="tc-ai-chat__tutorial-grid">
                  <div className="tc-ai-chat__tutorial-panel">
                    <Text className="tc-ai-chat__tutorial-panel-title" size="xs" fw={700}>
                      {$('本步先检查')}
                    </Text>
                    <Stack className="tc-ai-chat__tutorial-list" gap={4} mt={6}>
                      {step.statesToCheck.map((item) => (
                        <Text key={item} className="tc-ai-chat__tutorial-list-item" size="sm">
                          {`• ${item}`}
                        </Text>
                      ))}
                    </Stack>
                  </div>

                  <div className="tc-ai-chat__tutorial-panel">
                    <Text className="tc-ai-chat__tutorial-panel-title" size="xs" fw={700}>
                      {$('成功信号')}
                    </Text>
                    <Stack className="tc-ai-chat__tutorial-list" gap={4} mt={6}>
                      {step.successSignals.map((item) => (
                        <Text key={item} className="tc-ai-chat__tutorial-list-item" size="sm">
                          {`• ${item}`}
                        </Text>
                      ))}
                    </Stack>
                  </div>
                </div>

                <div className="tc-ai-chat__tutorial-panel tc-ai-chat__tutorial-panel--prompt">
                  <Text className="tc-ai-chat__tutorial-panel-title" size="xs" fw={700}>
                    {$('示例提示词')}
                  </Text>
                  <Text className="tc-ai-chat__tutorial-prompt" size="sm" mt={6}>
                    {step.promptStarter}
                  </Text>
                </div>

                <Text className="tc-ai-chat__tutorial-next" size="xs" c="dimmed">
                  {`下一步建议：${step.nextStep}`}
                </Text>
              </Stack>
            </PanelCard>
          ))}
        </Stack>
      </Modal>
      {isMaximized && (
        <div
          aria-hidden="true"
          className="tc-ai-chat__backdrop"
          onMouseDown={(e) => {
            e.preventDefault()
            toggleMaximized()
          }}
        />
      )}
      <div aria-hidden="true" className={auraClassName} />
      <Paper
        ref={cardRef}
        className={[
          'tc-ai-chat__card',
          showDockedBubble ? 'tc-ai-chat__card--bubble' : '',
        ].filter(Boolean).join(' ')}
        radius="sm"
        p={showDockedBubble ? 0 : isCompact ? 'sm' : 'md'}
      >
        {!showDockedBubble && (
          <button
            type="button"
            className="tc-ai-chat__handle"
            aria-label={$('展开对话')}
            title={$('点击展开')}
            onClick={expandChat}
          >
            <span className="tc-ai-chat__handle-pill" />
          </button>
        )}

        {isCompact ? (
          <>
            {showDockedBubble ? (
              <Tooltip className="tc-ai-chat__tooltip" label={sending ? $('AI 对话中…点击展开') : $('展开 AI 对话')} withArrow position="left">
                <button
                  type="button"
                  className="tc-ai-chat__bubble-button"
                  aria-label={$('展开 AI 对话')}
                  onClick={expandChat}
                >
                  <span className="tc-ai-chat__bubble-core">
                    <IconMessageCircle className="tc-ai-chat__bubble-icon" size={24} />
                    {sending && <span className="tc-ai-chat__bubble-status" aria-hidden="true" />}
                  </span>
                </button>
              </Tooltip>
            ) : (
              <>
                <ReferenceImagesStrip
                  className="tc-ai-chat__refs--compact-corner"
                  urls={referenceImages}
                  onClear={clearReferenceImages}
                  disabled={sending || refsLoading}
                />
                <Group
                  className="tc-ai-chat__compact-row"
                  justify="space-between"
                  align="center"
                  gap={10}
                  wrap="nowrap"
                  mt={referenceImages.length > 0 ? 50 : 0}
                >
                  <button
                    type="button"
                    className="tc-ai-chat__title-button"
                    aria-label={$('展开对话')}
                    onClick={expandChat}
                  >
                    <Group className="tc-ai-chat__title-group tc-ai-chat__compact-left" gap={10} align="center" wrap="nowrap">
                      <IconMessageCircle className="tc-ai-chat__title-icon" size={18} />
                      <Text className="tc-ai-chat__title" size="sm" fw={700}>
                        {$('AI 对话')}
                      </Text>
                    </Group>
                  </button>

                  <div className={composerShellClassName}>
                    <PanelCard className="tc-ai-chat__compact-composer tc-ai-chat__composer" padding="compact">
                      <Group className="tc-ai-chat__composer-row" gap={10} align="center" wrap="nowrap">
                        <div className="tc-ai-chat__composer-tools">
                          {attachMenu}
                          {taskEntryMenuButton}
                        </div>

                        <div className="tc-ai-chat__input-slot">
                          <Textarea
                            ref={compactInputRef}
                            className="tc-ai-chat__input"
                            autosize
                            minRows={1}
                            maxRows={4}
                            placeholder={$('请输入你的设计需求')}
                            value={draft}
                            onChange={(e) => setDraft(e.currentTarget.value)}
                            disabled={sending}
                            onFocus={() => {
                              if (mode !== 'compact') return
                              setMode('expanded')
                            }}
                          />
                        </div>

                        <div className="tc-ai-chat__composer-actions">
                          <Tooltip className="tc-ai-chat__tooltip" label={sending ? $('中断') : $('发送')} withArrow>
                            <ActionIcon
                              className="tc-ai-chat__send"
                              variant="light"
                              color={sending ? 'red' : undefined}
                              aria-label={sending ? '中断' : '发送'}
                              onClick={sending ? interruptActiveChat : () => void send()}
                              disabled={sending ? false : !canSendMessage}
                            >
                              {sending ? <IconX className="tc-ai-chat__send-icon" size={18} /> : <IconSend2 className="tc-ai-chat__send-icon" size={18} />}
                            </ActionIcon>
                          </Tooltip>
                        </div>
                      </Group>
                    </PanelCard>
                  </div>

                  <Group className="tc-ai-chat__compact-right" gap={6} align="center" wrap="nowrap">
                    <Tooltip className="tc-ai-chat__tooltip" label={$('开启新对话')} withArrow>
                      <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="开启新对话" onClick={startNewConversation}>
                        <IconMessagePlus className="tc-ai-chat__icon-svg" size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip className="tc-ai-chat__tooltip" label={$('教程')} withArrow>
                      <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="教程" onClick={() => setTutorialOpened(true)}>
                        <IconBook2 className="tc-ai-chat__icon-svg" size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip className="tc-ai-chat__tooltip" label={$('展开')} withArrow>
                      <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="展开" onClick={expandChat}>
                        <IconChevronUp className="tc-ai-chat__icon-svg" size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip className="tc-ai-chat__tooltip" label={$('聚焦')} withArrow>
                      <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="聚焦" onClick={toggleMaximized}>
                        <IconArrowsMaximize className="tc-ai-chat__icon-svg" size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
              </>
            )}
          </>
        ) : (
          <>
            <Group className="tc-ai-chat__header" justify="space-between" align="center" gap={10} wrap="nowrap">
              <button
                type="button"
                className="tc-ai-chat__title-button"
                aria-label={$('AI 对话')}
                onClick={expandChat}
              >
                <Group className="tc-ai-chat__title-group tc-ai-chat__header-left" gap={12} align="center" wrap="nowrap">
                  <span className="tc-ai-chat__title-icon-shell" aria-hidden="true">
                    <IconMessageCircle className="tc-ai-chat__title-icon" size={18} />
                  </span>
                  <Stack className="tc-ai-chat__title-copy" gap={2}>
                    <Group className="tc-ai-chat__title-topline" gap={8} align="center" wrap="nowrap">
                      <Text className="tc-ai-chat__title" size="sm" fw={700}>
                        {headerTitle}
                      </Text>
                      <Badge className="tc-ai-chat__title-badge" size="xs" radius="sm" variant="light" color="gray">
                        {headerStatusLabel}
                      </Badge>
                    </Group>
                    <Text className="tc-ai-chat__title-subtitle" size="xs" c="dimmed" lineClamp={1}>
                      {headerSubtitle}
                    </Text>
                  </Stack>
                </Group>
              </button>

              <Group className="tc-ai-chat__header-right" gap={6} align="center" wrap="nowrap">
                <Tooltip className="tc-ai-chat__tooltip" label={$('开启新对话')} withArrow>
                  <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="开启新对话" onClick={startNewConversation}>
                    <IconMessagePlus className="tc-ai-chat__icon-svg" size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip className="tc-ai-chat__tooltip" label={$('教程')} withArrow>
                  <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="教程" onClick={() => setTutorialOpened(true)}>
                    <IconBook2 className="tc-ai-chat__icon-svg" size={16} />
                  </ActionIcon>
                </Tooltip>
                {!isMaximized && (
                  <Tooltip className="tc-ai-chat__tooltip" label={$('收起')} withArrow>
                    <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="收起" onClick={collapseChat}>
                      <IconChevronDown className="tc-ai-chat__icon-svg" size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
                <Tooltip className="tc-ai-chat__tooltip" label={mode === 'maximized' ? $('退出聚焦') : $('聚焦')} withArrow>
                  <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label={mode === 'maximized' ? '退出聚焦' : '聚焦'} onClick={toggleMaximized}>
                    {mode === 'maximized' ? (
                      <IconArrowsMinimize className="tc-ai-chat__icon-svg" size={16} />
                    ) : (
                      <IconArrowsMaximize className="tc-ai-chat__icon-svg" size={16} />
                    )}
                  </ActionIcon>
                </Tooltip>
                {isMaximized && (
                  <Tooltip className="tc-ai-chat__tooltip" label={$('关闭')} withArrow>
                    <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="关闭" onClick={collapseChat}>
                      <IconX className="tc-ai-chat__icon-svg" size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
            </Group>

            <div className={['tc-ai-chat__body', isEmptyConversation ? 'tc-ai-chat__body--empty' : ''].filter(Boolean).join(' ')}>
              {canShowHistory && (
                isEmptyConversation ? (
                  <div className="tc-ai-chat__empty-state">
                    <div className="tc-ai-chat__empty-state-orb" aria-hidden="true">
                      <IconSparkles className="tc-ai-chat__empty-state-orb-icon" size={26} />
                    </div>
                    <Stack className="tc-ai-chat__empty-state-copy" gap={8} align="center">
                      <Badge className="tc-ai-chat__empty-state-badge" size="sm" radius="sm" variant="light" color="gray">
                        {headerStatusLabel}
                      </Badge>
                      <Text className="tc-ai-chat__empty-state-title" size="lg" fw={700}>
                        {$('开始创作')}
                      </Text>
                      <Text className="tc-ai-chat__empty-state-description" size="sm" c="dimmed">
                        {$('我可以帮你设计、优化和执行创意工作流')}
                      </Text>
                    </Stack>
                  </div>
                ) : useScrollableHistory ? (
                  <ScrollArea className="tc-ai-chat__messages-scroll" viewportRef={viewportRef} type="auto" scrollbarSize={8}>
                    <Stack ref={messagesContentRef} className="tc-ai-chat__messages" gap={10}>
                      {messages.map((message) => (
                        <ChatBubble key={message.id} message={message} />
                      ))}
                    </Stack>
                  </ScrollArea>
                ) : (
                  <Stack ref={messagesContentRef} className="tc-ai-chat__messages tc-ai-chat__messages--expanded" gap={10}>
                    {messages.map((message) => (
                      <ChatBubble key={message.id} message={message} />
                    ))}
                  </Stack>
                )
              )}

            </div>

            <div className={composerShellClassName}>
              <ReferenceImagesStrip urls={referenceImages} onClear={clearReferenceImages} disabled={sending || refsLoading} />
              <PanelCard className="tc-ai-chat__composer" padding="compact">
                {showProjectTextMaterialHint ? (
                  <Text className="tc-ai-chat__creation-warning" size="xs" c="yellow" mb={8}>
                    当前项目检测到 {projectTextMaterialState.count} 个文本素材。AI 对话不会因此被拦截；如果你希望基于某一份文本继续，优先在消息里说明书名/章节，或先选中关联节点。
                  </Text>
                ) : null}
                {currentProjectId && projectTextMaterialState.status === 'failed' ? (
                  <Text className="tc-ai-chat__creation-warning" size="xs" c="red" mb={8}>
                    {projectTextMaterialState.error || '项目文本素材状态读取失败'}
                  </Text>
                ) : null}
                {activeSkill && (
                  <Group className="tc-ai-chat__active-skill" justify="space-between" align="center" gap={10} mb={8} wrap="nowrap">
                    <Group className="tc-ai-chat__active-skill-left" gap={8} align="center" wrap="nowrap">
                      <Badge className="tc-ai-chat__active-skill-badge" size="sm" radius="sm" variant="light" color="blue">
                        {activeSkill.name || activeSkill.key || 'Skill'}
                      </Badge>
                      <Text className="tc-ai-chat__active-skill-hint" size="xs" c="dimmed" lineClamp={1}>
                        {activeSkill.description || $('当前能力已启用，后续对话将优先按该能力处理')}
                      </Text>
                    </Group>
                    <Tooltip className="tc-ai-chat__active-skill-clear-tooltip" label={$('关闭当前能力')} withArrow>
                      <ActionIcon
                        className="tc-ai-chat__active-skill-clear"
                        size="sm"
                        variant="subtle"
                        aria-label="clear-skill"
                        onClick={clearSkill}
                      >
                        <IconX className="tc-ai-chat__active-skill-clear-icon" size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                )}
                {activeSkill ? (
                  <div className="tc-ai-chat__replicate-panel">
                    <Text className="tc-ai-chat__replicate-title" size="xs" fw={700}>
                      {$('目标效果图（可选，1张）')}
                    </Text>
                    <Group className="tc-ai-chat__replicate-row" gap={8} mt={6} align="center" wrap="nowrap">
                      {replicateTargetImage ? (
                        <button
                          type="button"
                          className="tc-ai-chat__replicate-target-btn"
                          onClick={() => window.open(replicateTargetImage, '_blank', 'noopener,noreferrer')}
                        >
                          <img className="tc-ai-chat__replicate-target-thumb" src={replicateTargetImage} alt="replicate-target" />
                        </button>
                      ) : (
                        <div className="tc-ai-chat__replicate-target-placeholder">
                          {$('未设置目标效果图')}
                        </div>
                      )}
                      <Group className="tc-ai-chat__replicate-actions" gap={6} wrap="wrap">
                        <Button className="tc-ai-chat__replicate-action" size="xs" variant="light" onClick={openReplicateTargetPicker}>
                          {$('从画布中选择')}
                        </Button>
                        <Button className="tc-ai-chat__replicate-action" size="xs" variant="light" onClick={() => targetFileInputRef.current?.click()}>
                          {$('上传目标图')}
                        </Button>
                        <Button className="tc-ai-chat__replicate-action" size="xs" variant="subtle" color="red" onClick={() => setReplicateTargetImage('')}>
                          {$('清空')}
                        </Button>
                      </Group>
                    </Group>
                    <Text className="tc-ai-chat__replicate-hint" size="xs" c="dimmed" mt={6}>
                      {$(`参考图可多张：${referenceImages.length} 张；如果你显式设置目标效果图，本轮会把它作为 target 资产传给 agents。`)}
                    </Text>
                  </div>
                ) : null}
                <Group className="tc-ai-chat__composer-row" gap={10} align="flex-end" wrap="nowrap">
                  <div className="tc-ai-chat__composer-tools">
                    {attachMenu}
                    {taskEntryMenuButton}
                  </div>

                  <div className="tc-ai-chat__input-slot">
                    <Textarea
                      ref={expandedInputRef}
                      className="tc-ai-chat__input"
                      autosize
                      minRows={2}
                      maxRows={6}
                      placeholder={$('请输入你的设计需求')}
                      value={draft}
                      onChange={(e) => setDraft(e.currentTarget.value)}
                      disabled={sending}
                    />
                  </div>

                  <div className="tc-ai-chat__composer-actions">
                    <Tooltip className="tc-ai-chat__tooltip" label={sending ? $('中断') : $('发送')} withArrow>
                      <ActionIcon
                        className="tc-ai-chat__send"
                        variant="light"
                        color={sending ? 'red' : undefined}
                        aria-label={sending ? '中断' : '发送'}
                        onClick={sending ? interruptActiveChat : () => void send()}
                        disabled={sending ? false : !canSendMessage}
                      >
                        {sending ? <IconX className="tc-ai-chat__send-icon" size={18} /> : <IconSend2 className="tc-ai-chat__send-icon" size={18} />}
                      </ActionIcon>
                    </Tooltip>
                  </div>
                </Group>

                <Group className="tc-ai-chat__hint" justify="space-between" align="center" gap={10} mt={8} wrap="nowrap">
                  <Text className="tc-ai-chat__hint-text" size="xs" c="dimmed" lineClamp={1}>
                    {sending ? $('对话中…点击右侧可中断') : $('仅支持点击发送，Enter 可换行')}
                  </Text>
                  <Badge className="tc-ai-chat__hint-badge" size="xs" radius="sm" variant="outline" color="gray">
                    {activeSkill ? $('Agent') : $('Chat')}
                  </Badge>
                </Group>
              </PanelCard>
            </div>
          </>
        )}
      </Paper>
    </div>
  )
}
