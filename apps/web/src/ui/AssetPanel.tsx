import React from 'react'
import {
  Title,
  SimpleGrid,
  Image,
  Text,
  Button,
  Group,
  Stack,
  Transition,
  Tabs,
  ActionIcon,
  Tooltip,
  Loader,
  Center,
  SegmentedControl,
  Badge,
  Modal,
  useMantineColorScheme,
  Select,
  TextInput,
  Divider,

} from '@mantine/core'
import {
  IconPlayerPlay,
  IconTrash,
  IconPencil,
  IconCopy,
  IconRefresh,
  IconPlus,
  IconPhoto,
  IconVideo,
  IconUpload,
  IconEye,
  IconLayoutGrid,
  IconSearch,
  IconSortDescending,
  IconCircleCheck,
} from '@tabler/icons-react'
import { useRFStore } from '../canvas/store'
import {
  useUIStore,
  type AssetPanelFocusRequest,
} from './uiStore'
import { ASSET_REFRESH_EVENT } from './assetEvents'
import { calculateSafeMaxHeight } from './utils/panelPosition'
import { toast } from './toast'
import { PanelCard } from './PanelCard'
import {
  confirmProjectBookStyle,
  confirmProjectBookRoleCard,
  createAgentPipelineRun,
  deleteProjectBook,
  deleteProjectBookRoleCard,
  deleteServerAsset,
  executeAgentPipelineRun,
  ensureProjectBookMetadataWindow,
  getProjectBookChapter,
  getProjectBookIndex,
  getProjectBookUploadJob,
  getLatestProjectBookUploadJob,
  listProjectBooks,
  listProjectRoleCardAssets,
  listServerAssets,
  renameServerAsset,
  publicVisionWithAuth,
  uploadServerAssetFile,
  upsertProjectBookRoleCard,
  type AiCharacterLibraryCharacterDto,
  type ProjectBookIndexDto,
  type ProjectBookListItemDto,
  type ProjectBookUploadJobDto,
  type ServerAssetDto,
} from '../api/server'
import type { Node } from '@xyflow/react'
import { extractFirstFrame } from './videoThumb'
import { setTapImageDragData } from '../canvas/dnd/setTapImageDragData'
import { CharacterGraph3D } from './utils/CharacterGraph3D'
import { getNodeAbsPosition, getNodeSize } from '../canvas/utils/nodeBounds'
import {
  resolveSemanticNodeRoleBinding,
  resolveSemanticNodeVisualReferenceBinding,
  upsertSemanticNodeAnchorBinding,
} from '../canvas/utils/semanticBindings'
import { runNodeRemote } from '../runner/remoteRunner'
import ProjectAssetsViewer from '../projects/ProjectAssetsViewer'
import { pickPrimaryProjectBook, sortProjectBooksByUpdatedAt } from './projectBooks'
import { AiCharacterLibraryModal } from './assets/AiCharacterLibraryModal'
import { ViewportLazyMount } from './assets/ViewportLazyMount'
import {
  pickCurrentProjectTextAsset,
  uploadProjectText,
} from './projectTextUpload'
import {
  deriveStyleHintsFromReferenceImage as deriveStyleHintsFromReferenceImageShared,
  listCanvasStyleReferenceCandidates,
  persistStyleReferenceImage as persistStyleReferenceImageShared,
} from './styleReference'
import { stopPanelWheelPropagation } from './utils/panelWheel'
import styles from '../styles.css'

type GenerationAssetData = {
  kind?: string
  type?: 'image' | 'video'
  url?: string
  thumbnailUrl?: string | null
  prompt?: string | null
  vendor?: string | null
  taskKind?: string | null
  modelKey?: string | null
}

type ProjectMaterialAssetData = {
  kind?: 'novelDoc' | 'scriptDoc'
  content?: string
  prompt?: string | null
  chapter?: number | null
  source?: string
}
type RoleCardAssetData = {
  assetId?: string
  cardId: string
  roleId?: string
  roleName: string
  stateDescription?: string
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
  confirmedAt?: string | null
  confirmedBy?: string | null
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
}
type VisualRefAssetData = NonNullable<NonNullable<ProjectBookIndexDto['assets']>['visualRefs']>[number]
type RoleProfileForCanvas = {
  id?: string
  name: string
  description?: string
  importance?: 'main' | 'supporting' | 'minor'
  chapterSpan?: number[]
  stageForms?: Array<{
    stage: string
    look?: string
    costume?: string
    props?: string[]
    emotion?: string
    chapterHints?: number[]
  }>
}
type CharacterGraphNodeForCanvas = {
  id: string
  name: string
  importance?: 'main' | 'supporting' | 'minor'
  firstChapter?: number
  lastChapter?: number
  chapterSpan?: number[]
  unlockChapter?: number
}
type CharacterGraphEdgeForCanvas = {
  sourceId: string
  targetId: string
  relation: string
  weight: number
  chapterHints: number[]
}
type StyleBibleForCanvas = {
  styleName?: string
  styleLocked?: boolean
  mainCharacterCardsConfirmedAt?: string | null
  mainCharacterCardsConfirmedBy?: string | null
  confirmedAt?: string | null
  confirmedBy?: string | null
  visualDirectives?: string[]
  consistencyRules?: string[]
  negativeDirectives?: string[]
  referenceImages?: string[]
}
type ErrorWithCodeAndDetails = Error & {
  code?: string
  details?: unknown
}

function renderLazyGridItems<T>(input: {
  items: readonly T[]
  rootRef: React.RefObject<HTMLDivElement | null>
  placeholderHeight: number
  keyFor: (item: T) => string
  renderItem: (item: T) => React.ReactNode
}) {
  const { items, rootRef, placeholderHeight, keyFor, renderItem } = input
  return items.map((item) => (
    <ViewportLazyMount
      key={keyFor(item)}
      className="asset-panel-lazy-item"
      placeholderClassName="asset-panel-lazy-placeholder"
      rootRef={rootRef}
      minHeight={placeholderHeight}
    >
      {renderItem(item)}
    </ViewportLazyMount>
  ))
}

function buildMainRoleCardPrompt(input: {
  roleName: string
  roleDesc?: string
  stagePrompt?: string
  extraPrompt?: string
}): string {
  return withRoleStylePrefix([
    `主角角色卡，角色名：${input.roleName}`,
    input.roleDesc ? `角色设定：${input.roleDesc}` : '',
    input.stagePrompt || '',
    '要求：仅人物，背景必须为空白或纯色，不得出现任何场景/道具背景元素，无文字水印。',
    '三视图要求：同一输出中必须给出角色正面、侧面、背面三视图（无遮挡，轮廓完整）。',
    '用于全书画风确认阶段，强调角色脸部/发型/服装一致性。',
    input.extraPrompt ? `补充要求：${input.extraPrompt}` : '',
  ].filter(Boolean).join('\n'))
}

function normalizeDirectiveTextToList(value: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of String(value || '').split('\n')) {
    const text = item.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length >= 12) break
  }
  return out
}

function formatDirectiveListToText(list: string[] | undefined): string {
  if (!Array.isArray(list)) return ''
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const text = String(item || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length >= 12) break
  }
  return out.join('\n')
}

function withRoleStylePrefix(prompt: string): string {
  const prefix = [
    '延续画风',
    '角色卡风格锁定：严格继承 referenceImages 提供的画风锚点（线条/材质/光影/色温/颗粒），禁止切换到其他画风。',
    '当文字描述与参考图冲突时，以 referenceImages 的风格一致性为准。',
  ].join('\n')
  const body = String(prompt || '').trim()
  if (!body) return prefix
  if (body.startsWith(prefix)) return body
  return `${prefix}\n${body}`
}

function buildRoleCardStateDescription(input: {
  chapterNo: number
  chapterTitle?: string
  chapterSummary?: string
  coreConflict?: string
  roleName: string
  roleDescription?: string
  stagePrompt?: string
}): string {
  return [
    `角色：${input.roleName}`,
    `章节：第${input.chapterNo}章${input.chapterTitle ? ` · ${input.chapterTitle}` : ''}`,
    input.roleDescription ? `角色当前状态：${input.roleDescription}` : '',
    input.stagePrompt ? `阶段约束：${input.stagePrompt}` : '',
    input.chapterSummary ? `章节摘要：${input.chapterSummary}` : '',
    input.coreConflict ? `核心冲突：${input.coreConflict}` : '',
  ].filter(Boolean).join('\n')
}

function isRoleCardApplicableToChapter(card: RoleCardAssetData | null | undefined, chapterNo: number | null): boolean {
  if (!card) return false
  if (!chapterNo || !Number.isFinite(chapterNo) || chapterNo <= 0) return true
  const chapterSpan = Array.isArray(card.chapterSpan)
    ? card.chapterSpan
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
        .map((x) => Math.trunc(x))
    : []
  if (chapterSpan.length) return chapterSpan.includes(Math.trunc(chapterNo))
  const chapterStart = Number(card.chapterStart)
  const chapterEnd = Number(card.chapterEnd)
  if (Number.isFinite(chapterStart) && chapterStart > 0) {
    const start = Math.trunc(chapterStart)
    const end = Number.isFinite(chapterEnd) && chapterEnd > 0 ? Math.trunc(chapterEnd) : start
    const c = Math.trunc(chapterNo)
    return c >= start && c <= end
  }
  const chapter = Number(card.chapter)
  if (Number.isFinite(chapter) && chapter > 0) return Math.trunc(chapterNo) === Math.trunc(chapter)
  return true
}

function hasUsableRoleCardImage(card: RoleCardAssetData | null | undefined, chapterNo: number | null): boolean {
  if (!card) return false
  const imageUrl = String(card.threeViewImageUrl || card.imageUrl || '').trim()
  if (!imageUrl) return false
  return isRoleCardApplicableToChapter(card, chapterNo)
}

function resolveRoleCardExecutableImageUrl(card: RoleCardAssetData | null | undefined): string {
  if (!card) return ''
  return String(card.threeViewImageUrl || card.imageUrl || '').trim()
}

function hasConfirmedTimestamp(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function isVisualRefApplicableToChapter(
  ref: VisualRefAssetData | null | undefined,
  chapterNo: number | null,
): boolean {
  if (!ref) return false
  if (!chapterNo || !Number.isFinite(chapterNo) || chapterNo <= 0) return true
  const chapterSpan = Array.isArray(ref.chapterSpan)
    ? ref.chapterSpan
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
        .map((x) => Math.trunc(x))
    : []
  if (chapterSpan.length) return chapterSpan.includes(Math.trunc(chapterNo))
  const chapterStart = Number(ref.chapterStart)
  const chapterEnd = Number(ref.chapterEnd)
  if (Number.isFinite(chapterStart) && chapterStart > 0) {
    const start = Math.trunc(chapterStart)
    const end = Number.isFinite(chapterEnd) && chapterEnd > 0 ? Math.trunc(chapterEnd) : start
    const c = Math.trunc(chapterNo)
    return c >= start && c <= end
  }
  const chapter = Number(ref.chapter)
  if (Number.isFinite(chapter) && chapter > 0) return Math.trunc(chapterNo) === Math.trunc(chapter)
  return true
}

function collectRoleCardReferenceImages(input: {
  cards?: RoleCardAssetData[]
  currentRoleName?: string
  currentImageUrl?: string
  limit?: number
}): string[] {
  const cards = Array.isArray(input.cards) ? input.cards : []
  const currentRoleKey = String(input.currentRoleName || '').trim().toLowerCase()
  const limit = Math.max(1, Math.trunc(Number(input.limit || 8)))
  const output: string[] = []
  const seen = new Set<string>()
  const push = (url: string) => {
    const value = String(url || '').trim()
    if (!value || seen.has(value)) return
    seen.add(value)
    output.push(value)
  }
  push(String(input.currentImageUrl || '').trim())
  for (const card of cards) {
    if (output.length >= limit) break
    const roleName = String(card?.roleName || '').trim().toLowerCase()
    const imageUrl = resolveRoleCardExecutableImageUrl(card)
    if (!imageUrl) continue
    if (currentRoleKey && roleName === currentRoleKey) continue
    push(imageUrl)
  }
  return output.slice(0, limit)
}

function listRolesFromBookIndex(bookIndex: ProjectBookIndexDto | null): RoleProfileForCanvas[] {
  const profiles = Array.isArray((bookIndex as any)?.assets?.characterProfiles)
    ? (((bookIndex as any).assets.characterProfiles || []) as RoleProfileForCanvas[])
    : []
  const graphNodes = Array.isArray((bookIndex as any)?.assets?.characterGraph?.nodes)
    ? (((bookIndex as any).assets.characterGraph.nodes || []) as CharacterGraphNodeForCanvas[])
    : []
  const graphIdByName = new Map<string, string>()
  for (const node of graphNodes) {
    const nameKey = String(node?.name || '').trim().toLowerCase()
    const id = String(node?.id || '').trim()
    if (!nameKey || !id) continue
    graphIdByName.set(nameKey, id)
  }
  const unique = new Map<string, RoleProfileForCanvas>()
  const sorted = profiles
    .slice()
    .sort((a, b) => {
      const rank = (x?: string) => (x === 'main' ? 0 : x === 'supporting' ? 1 : 2)
      return rank(a?.importance) - rank(b?.importance)
    })
  for (const role of sorted) {
    const name = String(role?.name || '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (unique.has(key)) continue
    unique.set(key, {
      ...role,
      name,
      id: graphIdByName.get(key) || role.id || '',
    })
  }
  return Array.from(unique.values())
}

function PlaceholderImage({ label }: { label: string }) {
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'
  const start = isDark ? '#1f2937' : '#cfd8e3'
  const end = isDark ? '#0b0b0d' : '#f8fafc'
  const textColor = isDark ? '#e5e7eb' : '#0f172a'
  const svg = encodeURIComponent(
    `<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0%' stop-color='${start}'/><stop offset='100%' stop-color='${end}'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><text x='50%' y='50%' fill='${textColor}' dominant-baseline='middle' text-anchor='middle' font-size='16' font-family='system-ui'>${label}</text></svg>`,
  )
  return <Image className="asset-panel-placeholder" src={`data:image/svg+xml;charset=UTF-8,${svg}`} alt={label} radius="sm" />
}

function getGenerationData(asset: ServerAssetDto): GenerationAssetData {
  const data = (asset.data || {}) as any
  const type = typeof data.type === 'string' ? (data.type.toLowerCase() as 'image' | 'video') : undefined
  return {
    kind: typeof data.kind === 'string' ? data.kind : undefined,
    type: type === 'image' || type === 'video' ? type : undefined,
    url: typeof data.url === 'string' ? data.url : undefined,
    thumbnailUrl: typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : null,
    prompt: typeof data.prompt === 'string' ? data.prompt : undefined,
    vendor: typeof data.vendor === 'string' ? data.vendor : undefined,
    taskKind: typeof data.taskKind === 'string' ? data.taskKind : undefined,
    modelKey: typeof data.modelKey === 'string' ? data.modelKey : undefined,
  }
}

function isGenerationAsset(asset: ServerAssetDto): boolean {
  const data = getGenerationData(asset)
  return !!data.url && (data.type === 'image' || data.type === 'video' || data.kind === 'generation')
}

function isWorkflowAsset(asset: ServerAssetDto): boolean {
  const data = asset.data || {}
  return Array.isArray((data as any).nodes) && Array.isArray((data as any).edges)
}

function getWorkflowAssetMeta(asset: ServerAssetDto): { title: string; description: string; coverUrl: string } {
  const data = (asset?.data || {}) as Record<string, unknown>
  const title = String(data?.title || asset?.name || '').trim() || asset.name || '未命名工作流'
  const description = String(data?.description || '').trim()
  const coverUrl = String(data?.coverUrl || '').trim()
  return { title, description, coverUrl }
}

function getProjectMaterialData(asset: ServerAssetDto): ProjectMaterialAssetData {
  const data = (asset.data || {}) as any
  const kind = typeof data.kind === 'string' ? data.kind : undefined
  const content =
    typeof data.content === 'string'
      ? data.content
      : Array.isArray(data.textResults) && data.textResults.length > 0 && typeof data.textResults[data.textResults.length - 1]?.text === 'string'
        ? String(data.textResults[data.textResults.length - 1].text)
        : typeof data.prompt === 'string'
          ? data.prompt
          : undefined
  return {
    kind: kind as any,
    content,
    prompt: typeof data.prompt === 'string' ? data.prompt : undefined,
    chapter: typeof data.chapter === 'number' && Number.isFinite(data.chapter) ? Math.trunc(data.chapter) : null,
    source: typeof data.source === 'string' ? data.source : undefined,
  }
}

const PROJECT_TEXT_REQUIRED_MESSAGE = '当前项目还没有上传文本，请先上传或替换项目文本。'
const PROJECT_TEXT_INVALID_MESSAGE = '当前项目文本索引不存在或已失效，请重新上传项目文本后再操作。'

function summarizeUserFacingText(raw: string, maxLines = 3): string {
  const normalizedLines = String(raw || '')
    .split(/\r?\n/)
    .map((line) => normalizeShotPrompt(line))
    .map((line) => line.trim())
    .filter(Boolean)

  const usefulLines = normalizedLines.filter((line) => !isNoisePrompt(line))
  const picked = (usefulLines.length ? usefulLines : normalizedLines).slice(0, maxLines)
  return picked.join(' ')
}

function isProjectMaterialAsset(asset: ServerAssetDto): boolean {
  const kind = getProjectMaterialData(asset).kind
  return kind === 'novelDoc' || kind === 'scriptDoc'
}

function normalizeProjectRoleCardAssetForPanel(asset: ServerAssetDto): RoleCardAssetData | null {
  const data = (asset?.data || {}) as Record<string, unknown>
  if (String(data.kind || '').trim() !== 'projectRoleCard') return null
  const roleName = String(data.roleName || '').trim()
  if (!roleName) return null
  const cardId = String(data.cardId || asset.id || '').trim()
  if (!cardId) return null
  const parseChapterValue = (value: unknown): number | undefined => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined
  }
  const chapterSpan = Array.isArray(data.chapterSpan)
    ? data.chapterSpan
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
        .map((x) => Math.trunc(x))
    : undefined
  const statusRaw = String(data.status || '').trim().toLowerCase()
  return {
    assetId: String(asset.id || '').trim() || undefined,
    cardId,
    roleId: String(data.roleId || '').trim() || undefined,
    roleName,
    stateDescription: String(data.stateDescription || '').trim() || undefined,
    chapter: parseChapterValue(data.chapter),
    chapterStart: parseChapterValue(data.chapterStart),
    chapterEnd: parseChapterValue(data.chapterEnd),
    chapterSpan: chapterSpan && chapterSpan.length ? chapterSpan : undefined,
    nodeId: String(data.nodeId || '').trim() || undefined,
    prompt: String(data.prompt || '').trim() || undefined,
    status: statusRaw === 'draft' ? 'draft' : 'generated',
    modelKey: String(data.modelKey || '').trim() || undefined,
    imageUrl: String(data.imageUrl || '').trim() || undefined,
    confirmedAt: hasConfirmedTimestamp(data.confirmedAt) ? String(data.confirmedAt || '').trim() : null,
    confirmedBy: hasConfirmedTimestamp(data.confirmedBy) ? String(data.confirmedBy || '').trim() : null,
    createdAt: String(data.createdAt || asset.createdAt || '').trim() || asset.createdAt,
    updatedAt: String(data.updatedAt || asset.updatedAt || '').trim() || asset.updatedAt,
    createdBy: String(data.createdBy || asset.userId || '').trim() || String(asset.userId || ''),
    updatedBy: String(data.updatedBy || asset.userId || '').trim() || String(asset.userId || ''),
  }
}

function formatDate(ts: string) {
  const date = new Date(ts)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

function normalizeShotPrompt(raw: string): string {
  const line = String(raw || '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim()
  if (!line) return ''
  const cnMatch = line.match(/(?:^|[\s-])CN\s*[：:]\s*(.+)$/i)
  if (cnMatch?.[1]) return String(cnMatch[1]).trim()
  const enMatch = line.match(/(?:^|[\s-])EN\s*[：:]\s*(.+)$/i)
  if (enMatch?.[1]) return String(enMatch[1]).trim()
  if (!line.startsWith('|')) return line
  const cells = line
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean)
  if (!cells.length) return ''
  const separatorOnly = cells.every((x) => /^-+$/.test(x.replace(/:/g, '')))
  if (separatorOnly) return ''
  if (cells.length >= 3 && /^S?\d{1,3}$/i.test(cells[0] || '')) {
    const scene = cells[1] || ''
    const camera = cells[2] || ''
    return [scene, camera].filter(Boolean).join('；').trim()
  }
  return cells.slice(0, 3).join('；').trim()
}

function isNoisePrompt(raw: string): boolean {
  const v = String(raw || '').trim()
  if (!v) return true
  const directNoiseRules = [
    /^\d+\s*[-~到]\s*\d+\s*秒\s*[：:]/,
    /^\d+\s*秒\s*[：:]/,
    /^S\d{1,3}$/i,
    /^#{1,6}\s+/,
    /^[-*_]{3,}$/,
    /^>{1,2}\s*/,
    /^`{1,3}.*`{1,3}$/,
    /^\|(?:\s*-+:?\s*\|)+\s*$/,
    /^(plan|说明|note|tips?)[:：]?$/i,
    /同时标注内容分级|避免露骨|整合\s*\d+\s*-\s*\d+\s*连续可执行稿/i,
    /加载\s*TapCanvas\s*能力技能|基于小说正文与已完成|产出新增镜头|避免重复/i,
    /先做关键帧|可并行镜头|并行策略|QC红线|质检要点|production advice|parallel/i,
    /^角色一致性固定串/i,
    /^(?:-|•)?\s*(?:唯|萧夜|真宫寺唯|鸣神素子|萧羽)\s*[：:]/i,
    /^(?:-|•)?\s*(?:风格|style)\s*[：:]/i,
    /^(每镜头图像提示词|每镜头视频提示词|生产建议|统一参数|统一尾缀|全镜头通用约束)\b/i,
  ]
  if (directNoiseRules.some((re) => re.test(v))) return true
  const metaHintRe =
    /(结构化|图像提示词|视频提示词|生产建议|统一参数|全镜头通用约束|可投产|升级稿|按你要求|输出[一二三四五六七八九十0-9]+部分|我将|直接给你|plan|prompt list|shot list)/i
  const visualHintRe =
    /(特写|近景|中景|远景|构图|光线|光影|逆光|侧光|俯拍|仰拍|平视|推镜|拉镜|摇镜|移镜|跟拍|街|巷|室内|酒吧|学校|教室|走廊|餐厅|雨夜|清晨|夜色|人物|角色|少女|男子|女人|男人|表情|动作|奔跑|拥抱|对峙|落泪|站立|坐|close[- ]?up|wide shot|medium shot|lighting|cinematic|character|running|embrace|confront|street|room|bar|school|classroom|hallway|restaurant|night|morning)/i
  if (metaHintRe.test(v) && !visualHintRe.test(v)) return true
  return false
}

function buildRoleCardGenerationPrompt(input: {
  roleName: string
  roleDescription?: string
  importance?: string
  chapterHint?: string
  styleBible?: StyleBibleForCanvas | null
  stage?: {
    stage?: string
    look?: string
    costume?: string
    emotion?: string
    props?: string[]
  } | null
  sceneHints?: string[]
  propHints?: string[]
}): string {
  const roleName = String(input.roleName || '').trim()
  const roleDescription = String(input.roleDescription || '').trim()
  const chapterHint = String(input.chapterHint || '').trim()
  const importanceHint = String(input.importance || '').trim()
  const styleBible = input.styleBible || null
  const stage = input.stage || null
  const sceneHints = Array.isArray(input.sceneHints)
    ? input.sceneHints.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4)
    : []
  const propHints = Array.isArray(input.propHints)
    ? input.propHints.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4)
    : []
  const stageLine = stage?.stage ? `角色阶段：${stage.stage}` : ''
  const stageLook = stage?.look ? `外观特征：${stage.look}` : ''
  const stageCostume = stage?.costume ? `服装细节：${stage.costume}` : ''
  const stageEmotion = stage?.emotion ? `神态与情绪：${stage.emotion}` : ''
  const stageProps = Array.isArray(stage?.props) && stage?.props?.length
    ? `关键道具：${stage!.props!.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4).join('、')}`
    : ''
  return [
    `角色参考图生成任务（角色名：${roleName}）`,
    styleBible?.styleName ? `参考图画风：${styleBible.styleName}` : '',
    styleBible?.styleLocked ? '画风锁定：仅继承参考图的美术风格（色调/材质/光影），不得套用其他角色外观。' : '',
    chapterHint ? `章节上下文：${chapterHint}` : '',
    importanceHint ? `角色级别：${importanceHint}` : '',
    roleDescription ? `角色设定：${roleDescription}` : '角色设定：待补充（请完善角色档案）',
    stageLine,
    stageLook,
    stageCostume,
    stageEmotion,
    stageProps,
    sceneHints.length ? `常见场景：${sceneHints.join('、')}` : '',
    propHints.length ? `关联道具：${propHints.join('、')}` : '',
    '构图要求：单角色、全身优先、保留足够服装与道具细节，不要裁切头顶与手部。',
    '背景要求：背景必须为空白或纯色，禁止场景背景、装饰元素、文字和 logo。',
    '三视图要求：必须输出角色正面、侧面、背面三视图（可同图排版），便于后续角色一致性。',
    '质量要求：影视写实，皮肤质感自然，光影统一。',
  ].filter(Boolean).join('\n')
}

function getGraphNodesFromBookIndex(selectedBookIndex: any): CharacterGraphNodeForCanvas[] {
  return Array.isArray(selectedBookIndex?.assets?.characterGraph?.nodes)
    ? ((selectedBookIndex.assets.characterGraph.nodes || []) as CharacterGraphNodeForCanvas[])
    : []
}

function getProfileSourceFromBookIndex(selectedBookIndex: any): RoleProfileForCanvas[] {
  return Array.isArray(selectedBookIndex?.assets?.characterProfiles)
    ? ((selectedBookIndex.assets.characterProfiles || []) as RoleProfileForCanvas[])
    : []
}

function buildCharacterGraphMaps(graphNodes: CharacterGraphNodeForCanvas[]): {
  unlockMap: Map<string, number>
  graphIdByName: Map<string, string>
} {
  const unlockMap = new Map<string, number>()
  const graphIdByName = new Map<string, string>()
  for (const node of graphNodes) {
    const key = String(node?.name || '').trim().toLowerCase()
    if (!key) continue
    const gid = String(node?.id || '').trim()
    if (gid) graphIdByName.set(key, gid)
    const unlockChapter = Number((node as any)?.unlockChapter)
    if (Number.isFinite(unlockChapter) && unlockChapter > 0) {
      unlockMap.set(key, Math.trunc(unlockChapter))
    }
  }
  return { unlockMap, graphIdByName }
}

function filterProfilesByChapter(profiles: RoleProfileForCanvas[], chapterNo: number): RoleProfileForCanvas[] {
  return profiles.filter((role) => {
    if (!Number.isFinite(chapterNo) || chapterNo <= 0) return true
    const span = Array.isArray(role?.chapterSpan) ? role.chapterSpan : []
    if (span.includes(Math.trunc(chapterNo))) return true
    const stages = Array.isArray(role?.stageForms) ? role.stageForms : []
    return stages.some((s) => Array.isArray(s?.chapterHints) && s.chapterHints.includes(Math.trunc(chapterNo)))
  })
}

function sortProfilesByImportance(profiles: RoleProfileForCanvas[]): RoleProfileForCanvas[] {
  return profiles.slice().sort((a, b) => {
    const rank = (x?: string) => (x === 'main' ? 0 : x === 'supporting' ? 1 : 2)
    return rank(a?.importance) - rank(b?.importance)
  })
}

function resolveCharacterSource(input: {
  selectedBookIndex: any
  selectedChapterMeta: any
  chapterNo: number
}): RoleProfileForCanvas[] {
  const profileSource = getProfileSourceFromBookIndex(input.selectedBookIndex)
  const fromProfiles = sortProfilesByImportance(filterProfilesByChapter(profileSource, input.chapterNo))
  const fromChapter = Array.isArray(input.selectedChapterMeta?.characters)
    ? (input.selectedChapterMeta.characters as Array<{ name: string; description?: string }>)
    : []
  const fromBook = Array.isArray(input.selectedBookIndex?.assets?.characters)
    ? ((input.selectedBookIndex.assets.characters || []) as Array<{ name: string; description?: string }>)
    : []
  return fromProfiles.length ? fromProfiles : fromChapter.length ? fromChapter : fromBook
}

function buildAvailableCharacterPool(input: {
  selectedBookIndex: any
  selectedChapterMeta: any
}): RoleProfileForCanvas[] {
  const chapterNo = Number(input.selectedChapterMeta?.chapter || 0)
  const graphNodes = getGraphNodesFromBookIndex(input.selectedBookIndex)
  const { unlockMap, graphIdByName } = buildCharacterGraphMaps(graphNodes)
  const source = resolveCharacterSource({
    selectedBookIndex: input.selectedBookIndex,
    selectedChapterMeta: input.selectedChapterMeta,
    chapterNo,
  })
  const out: RoleProfileForCanvas[] = []
  const seen = new Set<string>()
  for (const item of source) {
    const name = String(item?.name || '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    if (Number.isFinite(chapterNo) && chapterNo > 0) {
      const unlockChapter = unlockMap.get(key)
      if (typeof unlockChapter === 'number' && unlockChapter > Math.trunc(chapterNo)) continue
    }
    seen.add(key)
    const description = String(item?.description || '').trim()
    const importance = (item as any)?.importance
    const chapterSpan = Array.isArray((item as any)?.chapterSpan) ? (item as any).chapterSpan : undefined
    const stageForms = Array.isArray((item as any)?.stageForms) ? (item as any).stageForms : undefined
    out.push({
      id: graphIdByName.get(key) || (item as any)?.id || undefined,
      name,
      ...(description ? { description } : null),
      ...(importance ? { importance } : null),
      ...(chapterSpan ? { chapterSpan } : null),
      ...(stageForms ? { stageForms } : null),
    })
    if (out.length >= 40) break
  }
  return out
}

const ASSET_PANEL_BOOK_PROGRESS_STORAGE_KEY = 'tapcanvas:asset-panel:book-progress:v1'
const ASSET_PANEL_UPLOAD_TOAST_SEEN_STORAGE_KEY = 'tapcanvas:asset-panel:upload-toast-seen:v1'

type AssetPanelBookProgress = {
  projectId: string
  selectedBookId?: string
  chapterByBook?: Record<string, string>
}

function readAssetPanelBookProgress(projectId: string): AssetPanelBookProgress | null {
  if (typeof window === 'undefined') return null
  const pid = String(projectId || '').trim()
  if (!pid) return null
  try {
    const raw = window.localStorage.getItem(ASSET_PANEL_BOOK_PROGRESS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as any
    if (!Array.isArray(parsed)) return null
    const item = parsed.find((x) => String(x?.projectId || '').trim() === pid)
    if (!item || typeof item !== 'object') return null
    return {
      projectId: pid,
      selectedBookId: typeof item.selectedBookId === 'string' ? item.selectedBookId : undefined,
      chapterByBook: item.chapterByBook && typeof item.chapterByBook === 'object' ? item.chapterByBook : undefined,
    }
  } catch {
    return null
  }
}

function writeAssetPanelBookProgress(projectId: string, patch: {
  selectedBookId?: string
  chapterByBookPatch?: Record<string, string>
}): void {
  if (typeof window === 'undefined') return
  const pid = String(projectId || '').trim()
  if (!pid) return
  try {
    const raw = window.localStorage.getItem(ASSET_PANEL_BOOK_PROGRESS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    const list = Array.isArray(parsed) ? (parsed as any[]) : []
    const next = list.filter((x) => String(x?.projectId || '').trim() !== pid)
    const previous = list.find((x) => String(x?.projectId || '').trim() === pid) || {}
    const nextEntry = {
      projectId: pid,
      selectedBookId:
        typeof patch.selectedBookId === 'string'
          ? patch.selectedBookId
          : (typeof previous.selectedBookId === 'string' ? previous.selectedBookId : ''),
      chapterByBook: {
        ...((previous.chapterByBook && typeof previous.chapterByBook === 'object') ? previous.chapterByBook : {}),
        ...(patch.chapterByBookPatch || {}),
      },
    }
    next.push(nextEntry)
    window.localStorage.setItem(ASSET_PANEL_BOOK_PROGRESS_STORAGE_KEY, JSON.stringify(next.slice(-30)))
  } catch {
    // ignore persistence failures
  }
}

function readAssetPanelSeenUploadToastJobId(projectId: string): string {
  if (typeof window === 'undefined') return ''
  const pid = String(projectId || '').trim()
  if (!pid) return ''
  try {
    const raw = window.localStorage.getItem(ASSET_PANEL_UPLOAD_TOAST_SEEN_STORAGE_KEY)
    if (!raw) return ''
    const parsed = JSON.parse(raw) as any
    if (!Array.isArray(parsed)) return ''
    const item = parsed.find((x) => String(x?.projectId || '').trim() === pid)
    return typeof item?.jobId === 'string' ? String(item.jobId).trim() : ''
  } catch {
    return ''
  }
}

function writeAssetPanelSeenUploadToastJobId(projectId: string, jobId: string): void {
  if (typeof window === 'undefined') return
  const pid = String(projectId || '').trim()
  const jid = String(jobId || '').trim()
  if (!pid || !jid) return
  try {
    const raw = window.localStorage.getItem(ASSET_PANEL_UPLOAD_TOAST_SEEN_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    const list = Array.isArray(parsed) ? (parsed as any[]) : []
    const next = list.filter((x) => String(x?.projectId || '').trim() !== pid)
    next.push({ projectId: pid, jobId: jid })
    window.localStorage.setItem(ASSET_PANEL_UPLOAD_TOAST_SEEN_STORAGE_KEY, JSON.stringify(next.slice(-30)))
  } catch {
    // ignore persistence failures
  }
}

export default function AssetPanel(): JSX.Element | null {
  const active = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const currentProject = useUIStore((s) => s.currentProject)
  const anchorY = useUIStore((s) => s.panelAnchorY)
  const openPreview = useUIStore((s) => s.openPreview)
  const preferredTab = useUIStore((s) => s.assetPanelTab)
  const setPreferredTab = useUIStore((s) => s.setAssetPanelTab)
  const preferredMaterialCategory = useUIStore((s) => s.assetPanelMaterialCategory)
  const setPreferredMaterialCategory = useUIStore((s) => s.setAssetPanelMaterialCategory)
  const assetPanelFocusRequest = useUIStore((s) => s.assetPanelFocusRequest)
  const clearAssetPanelFocusRequest = useUIStore((s) => s.clearAssetPanelFocusRequest)
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'
  const addNode = useRFStore((s) => s.addNode)
  const deleteNode = useRFStore((s) => s.deleteNode)
  const updateNodeData = useRFStore((s) => s.updateNodeData)
  const arrangeGroupChildren = useRFStore((s) => s.arrangeGroupChildren)
  const setNodeStatus = useRFStore((s) => s.setNodeStatus)
  const appendLog = useRFStore((s) => s.appendLog)
  const canvasNodes = useRFStore((s) => s.nodes)
  const mounted = active === 'assets'
  const [assets, setAssets] = React.useState<ServerAssetDto[]>([])
  const [workflowLibraryAssets, setWorkflowLibraryAssets] = React.useState<ServerAssetDto[]>([])
  const [projectRoleCardAssets, setProjectRoleCardAssets] = React.useState<RoleCardAssetData[]>([])
  const [assetCursor, setAssetCursor] = React.useState<string | null>(null)
  const [hasMoreAssets, setHasMoreAssets] = React.useState(true)
  const [tab, setTab] = React.useState<'generated' | 'workflow' | 'materials'>(preferredTab)
  const [mediaFilter, setMediaFilter] = React.useState<'all' | 'image' | 'video'>('video')
  const [loading, setLoading] = React.useState(false)
  const [workflowLibraryLoading, setWorkflowLibraryLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [visibleGenerationCount, setVisibleGenerationCount] = React.useState(10)
  const [materialChapterFilter, setMaterialChapterFilter] = React.useState<string>('all')
  const [materialCategory, setMaterialCategory] = React.useState<'roleCards' | 'docs' | 'all'>(preferredMaterialCategory)
  const [roleCardKeyword, setRoleCardKeyword] = React.useState<string>('')
  const [assetQuery, setAssetQuery] = React.useState<string>('')
  const [assetSort, setAssetSort] = React.useState<'updated_desc' | 'created_desc' | 'name_asc'>('updated_desc')
  const [materialUploading, setMaterialUploading] = React.useState(false)
  const [bookUploadJob, setBookUploadJob] = React.useState<ProjectBookUploadJobDto | null>(null)
  const handledBookUploadJobIdsRef = React.useRef<Set<string>>(new Set())
  const pendingFocusRequestRef = React.useRef<AssetPanelFocusRequest | null>(null)
  const pendingScrollTargetRef = React.useRef<'top' | 'styleReference' | null>(null)
  const materialUploadInputRef = React.useRef<HTMLInputElement | null>(null)
  const styleReferenceUploadInputRef = React.useRef<HTMLInputElement | null>(null)
  const bodyScrollRef = React.useRef<HTMLDivElement | null>(null)
  const styleReferenceSectionRef = React.useRef<HTMLDivElement | null>(null)
  const previousStyleReferenceCountRef = React.useRef(0)
  const [books, setBooks] = React.useState<ProjectBookListItemDto[]>([])
  const [selectedBookId, setSelectedBookId] = React.useState<string>('')
  const [selectedBookIndex, setSelectedBookIndex] = React.useState<ProjectBookIndexDto | null>(null)
  const [selectedBookChapter, setSelectedBookChapter] = React.useState<string>('1')
  const [bookFilterType, setBookFilterType] = React.useState<'all' | 'characters' | 'props' | 'scenes' | 'locations' | 'keywords'>('all')
  const [bookFilterKeyword, setBookFilterKeyword] = React.useState<string>('')
  const [bookLoading, setBookLoading] = React.useState(false)
  const [roleCardGenerating, setRoleCardGenerating] = React.useState(false)
  const [styleReferenceUploading, setStyleReferenceUploading] = React.useState(false)
  const [graphRebuilding, setGraphRebuilding] = React.useState(false)
  const [assetConfirming, setAssetConfirming] = React.useState(false)
  const [graph3DOpened, setGraph3DOpened] = React.useState(false)
  const [projectAssetsViewerOpen, setProjectAssetsViewerOpen] = React.useState(false)
  const [aiCharacterLibraryOpened, setAiCharacterLibraryOpened] = React.useState(false)
  const [generatedThumbs, setGeneratedThumbs] = React.useState<Record<string, string | null>>({})
  const thumbStatusRef = React.useRef<Record<string, 'pending' | 'running' | 'done'>>({})
  const activeThumbJobsRef = React.useRef(0)
  const autoGenerateChapterRoleCardsRef = React.useRef<(input: {
    chapterNo: number
    roleNames: string[]
    reason: string
  }) => Promise<number>>(async () => 0)
  const collectPendingRoleCardNodeIdsByChapterRef = React.useRef<(input: {
    chapterNo: number
    roleNames: string[]
  }) => string[]>(() => [])
  const runRoleCardNodesInBatchesRef = React.useRef<(nodeIds: string[], concurrency?: number) => Promise<void>>(async () => {})
  const showGraphMaintenancePanel = false
  const showExtraAssetTabs = true

  const PAGE_SIZE = 10
  const WORKFLOW_LIBRARY_PAGE_SIZE = 100
  const isBookUploadLocked = Boolean(
    currentProject?.id
      && bookUploadJob
      && (bookUploadJob.status === 'queued' || bookUploadJob.status === 'running')
      && String(bookUploadJob.projectId || '') === String(currentProject.id || ''),
  )

  React.useEffect(() => {
    if (!mounted) return
    setTab(preferredTab)
  }, [mounted, preferredTab])

  React.useEffect(() => {
    if (!mounted) return
    setMaterialCategory(preferredMaterialCategory)
  }, [mounted, preferredMaterialCategory])

  React.useEffect(() => {
    if (!mounted || !assetPanelFocusRequest) return
    if (assetPanelFocusRequest.tab) {
      setTab(assetPanelFocusRequest.tab)
    }
    if (assetPanelFocusRequest.materialCategory) {
      setMaterialCategory(assetPanelFocusRequest.materialCategory)
    }
    const nextBookId = typeof assetPanelFocusRequest.bookId === 'string' ? assetPanelFocusRequest.bookId.trim() : ''
    const nextChapterRaw = Number(assetPanelFocusRequest.chapter)
    const nextChapter =
      Number.isFinite(nextChapterRaw) && nextChapterRaw > 0 ? Math.trunc(nextChapterRaw) : null
    if (nextBookId) {
      setSelectedBookId(nextBookId)
    }
    if (nextChapter) {
      setMaterialChapterFilter(String(nextChapter))
      pendingFocusRequestRef.current = {
        ...assetPanelFocusRequest,
        bookId: nextBookId || String(selectedBookId || '').trim(),
        chapter: nextChapter,
      }
    } else {
      pendingFocusRequestRef.current = null
    }
    pendingScrollTargetRef.current = assetPanelFocusRequest.scrollTarget || null
    clearAssetPanelFocusRequest()
  }, [assetPanelFocusRequest, clearAssetPanelFocusRequest, mounted, selectedBookId])

  React.useEffect(() => {
    setPreferredTab(tab)
  }, [setPreferredTab, tab])

  React.useEffect(() => {
    setPreferredMaterialCategory(materialCategory)
  }, [materialCategory, setPreferredMaterialCategory])

  const reloadAssets = React.useCallback(async () => {
    setLoading(true)
    try {
      const [data, roleCardRows] = await Promise.all([
        listServerAssets({
          limit: PAGE_SIZE,
          projectId: currentProject?.id || undefined,
        }),
        currentProject?.id ? listProjectRoleCardAssets(currentProject.id) : Promise.resolve([]),
      ])
      setAssets(data.items || [])
      setProjectRoleCardAssets(
        (Array.isArray(roleCardRows) ? roleCardRows : [])
          .map((asset) => normalizeProjectRoleCardAssetForPanel(asset as unknown as ServerAssetDto))
          .filter(Boolean) as RoleCardAssetData[],
      )
      setAssetCursor(data.cursor ?? null)
      setHasMoreAssets(Boolean(data.cursor))
    } catch (err: unknown) {
      console.error(err)
      toast(err instanceof Error ? err.message : '加载资产失败', 'error')
      setAssets([])
      setProjectRoleCardAssets([])
      setAssetCursor(null)
      setHasMoreAssets(false)
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  const reloadWorkflowLibrary = React.useCallback(async () => {
    setWorkflowLibraryLoading(true)
    try {
      const allItems: ServerAssetDto[] = []
      let cursor: string | null = null
      for (let i = 0; i < 20; i += 1) {
        const listed = await listServerAssets({
          limit: WORKFLOW_LIBRARY_PAGE_SIZE,
          cursor,
        })
        const batch = Array.isArray(listed?.items) ? listed.items : []
        allItems.push(...batch)
        cursor = listed?.cursor ?? null
        if (!cursor) break
      }
      const next = allItems
        .filter((asset) => isWorkflowAsset(asset))
        .sort((a, b) => Date.parse(String(b?.updatedAt || '')) - Date.parse(String(a?.updatedAt || '')))
      setWorkflowLibraryAssets(next)
    } catch (err) {
      console.error(err)
      setWorkflowLibraryAssets([])
    } finally {
      setWorkflowLibraryLoading(false)
    }
  }, [])

  const loadMoreAssets = React.useCallback(async () => {
    if (!hasMoreAssets || loading) return
    try {
      const data = await listServerAssets({
        limit: PAGE_SIZE,
        cursor: assetCursor,
        projectId: currentProject?.id || undefined,
      })
      setAssets((prev) => [...prev, ...(data.items || [])])
      setAssetCursor(data.cursor ?? null)
      setHasMoreAssets(Boolean(data.cursor))
    } catch (err) {
      console.error(err)
      setHasMoreAssets(false)
    }
  }, [assetCursor, currentProject?.id, hasMoreAssets, loading])

  React.useEffect(() => {
    if (!mounted) return
    reloadAssets().catch(() => {})
  }, [mounted, reloadAssets])

  React.useEffect(() => {
    if (!mounted || !showExtraAssetTabs) return
    if (tab !== 'workflow') return
    reloadWorkflowLibrary().catch(() => {})
  }, [mounted, reloadWorkflowLibrary, showExtraAssetTabs, tab])

  React.useEffect(() => {
    if (!mounted) return
    if (!currentProject?.id) {
      setBookUploadJob(null)
      return
    }
    let cancelled = false
    getLatestProjectBookUploadJob(currentProject.id)
      .then((payload) => {
        if (cancelled) return
        setBookUploadJob(payload?.job || null)
      })
      .catch(() => {
        if (cancelled) return
        setBookUploadJob(null)
      })
    return () => {
      cancelled = true
    }
  }, [mounted, currentProject?.id])

  React.useEffect(() => {
    if (!mounted) return
    if (!currentProject?.id) return
    if (!bookUploadJob?.id) return
    if (bookUploadJob.status !== 'queued' && bookUploadJob.status !== 'running') return
    let cancelled = false
    const poll = async () => {
      try {
        const payload = await getProjectBookUploadJob(currentProject.id!, bookUploadJob.id)
        if (cancelled) return
        setBookUploadJob(payload?.job || null)
      } catch {
        // swallow polling failures; next tick retries
      }
    }
    const timer = window.setInterval(() => {
      void poll()
    }, 2500)
    void poll()
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [mounted, currentProject?.id, bookUploadJob?.id, bookUploadJob?.status])

  React.useEffect(() => {
    if (!mounted) return
    if (!currentProject?.id) return
    const job = bookUploadJob
    if (!job?.id) return
    if (job.status !== 'succeeded' && job.status !== 'failed') return
    const persistedHandledJobId = readAssetPanelSeenUploadToastJobId(currentProject.id)
    if (persistedHandledJobId && persistedHandledJobId === job.id) {
      handledBookUploadJobIdsRef.current.add(job.id)
      return
    }
    if (handledBookUploadJobIdsRef.current.has(job.id)) return
    handledBookUploadJobIdsRef.current.add(job.id)
    writeAssetPanelSeenUploadToastJobId(currentProject.id, job.id)
    if (job.status === 'failed') {
      toast(String(job.error?.message || '小说解析任务失败'), 'error')
      return
    }
    const bookId = String(job.result?.bookId || '').trim()
    if (!bookId) return
    void (async () => {
      try {
        const list = await listProjectBooks(currentProject.id!).catch(() => [])
        setBooks(sortProjectBooksByUpdatedAt(Array.isArray(list) ? list : []))
        setSelectedBookId(bookId)
        const idx = await getProjectBookIndex(currentProject.id!, bookId).catch(() => null)
        if (idx) setSelectedBookIndex(idx)
        await reloadAssets()
      } catch {
        // ignore follow-up refresh failure
      }
    })()
  }, [bookUploadJob, currentProject?.id, mounted, reloadAssets])

  React.useEffect(() => {
    if (!mounted) return
    if (!currentProject?.id) {
      setBooks([])
      setSelectedBookId('')
      setSelectedBookIndex(null)
      return
    }
    setBookLoading(true)
    listProjectBooks(currentProject.id)
      .then((list) => {
        const next = sortProjectBooksByUpdatedAt(Array.isArray(list) ? list : [])
        setBooks(next)
        if (!next.length) {
          setSelectedBookId('')
          setSelectedBookIndex(null)
          return
        }
        setSelectedBookId(pickPrimaryProjectBook(next)?.bookId || '')
      })
      .catch(() => {
        setBooks([])
      })
      .finally(() => setBookLoading(false))
  }, [mounted, currentProject?.id])

  React.useEffect(() => {
    if (!mounted) return
    if (!books.length) {
      if (selectedBookId) setSelectedBookId('')
      return
    }
    const selectedExists = books.some((item) => item.bookId === selectedBookId)
    if (selectedExists) return
    const primaryBookId = pickPrimaryProjectBook(books)?.bookId || ''
    if (primaryBookId !== selectedBookId) {
      setSelectedBookId(primaryBookId)
    }
  }, [books, mounted, selectedBookId])

  React.useEffect(() => {
    if (!mounted) return
    if (!currentProject?.id || !selectedBookId) {
      setSelectedBookIndex(null)
      return
    }
    getProjectBookIndex(currentProject.id, selectedBookId)
      .then((idx) => {
        setSelectedBookIndex(idx)
        const chapters = Array.isArray(idx?.chapters) ? idx.chapters : []
        const firstChapter = chapters.length > 0 ? chapters[0].chapter : 1
        const chapterSet = new Set(
          chapters
            .map((x) => Number(x?.chapter))
            .filter((x) => Number.isFinite(x) && x > 0)
            .map((x) => Math.trunc(x)),
        )
        const remembered = readAssetPanelBookProgress(currentProject.id!)
        const rememberedRaw = remembered?.chapterByBook?.[selectedBookId]
        const rememberedNo = Math.trunc(Number(rememberedRaw || 0))
        setSelectedBookChapter((prev) => {
          const currentNo = Math.trunc(Number(prev || 0))
          if (chapterSet.has(currentNo)) return prev
          if (chapterSet.has(rememberedNo)) return String(rememberedNo)
          return String(firstChapter)
        })
      })
      .catch(() => {
        setSelectedBookIndex(null)
      })
  }, [mounted, currentProject?.id, selectedBookId])

  React.useEffect(() => {
    if (!mounted) return
    const pending = pendingFocusRequestRef.current
    if (!pending) return
    const focusBookId = String(pending.bookId || '').trim()
    const activeBookId = String(selectedBookId || '').trim()
    if (!focusBookId || activeBookId !== focusBookId) return
    const focusChapter = Math.trunc(Number(pending.chapter || 0))
    if (!Number.isFinite(focusChapter) || focusChapter <= 0) {
      pendingFocusRequestRef.current = null
      return
    }
    const chapterExists = (selectedBookIndex?.chapters || []).some(
      (chapter) => Math.trunc(Number(chapter.chapter || 0)) === focusChapter,
    )
    if (!chapterExists) return
    setSelectedBookChapter(String(focusChapter))
    pendingFocusRequestRef.current = null
  }, [mounted, selectedBookId, selectedBookIndex])

  React.useEffect(() => {
    if (!mounted) return
    const target = pendingScrollTargetRef.current
    if (!target) return
    const container = bodyScrollRef.current
    if (!container) return
    const scrollToTop = () => {
      container.scrollTo({
        top: 0,
        behavior: 'smooth',
      })
      pendingScrollTargetRef.current = null
    }
    if (target === 'top') {
      const timer = window.setTimeout(scrollToTop, 40)
      return () => window.clearTimeout(timer)
    }
    if (tab !== 'materials') return
    const section = styleReferenceSectionRef.current
    if (!section) return
    const timer = window.setTimeout(() => {
      const containerRect = container.getBoundingClientRect()
      const sectionRect = section.getBoundingClientRect()
      const margin = 16
      const topDelta = sectionRect.top - containerRect.top
      const targetTop = container.scrollTop + topDelta - margin
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      })
      pendingScrollTargetRef.current = null
    }, 40)
    return () => window.clearTimeout(timer)
  }, [mounted, selectedBookId, selectedBookIndex, tab])

  const ensureActiveBookForMutation = React.useCallback((): boolean => {
    const projectId = String(currentProject?.id || '').trim()
    const bookId = String(selectedBookId || '').trim()
    if (!projectId || !bookId) {
      toast(PROJECT_TEXT_REQUIRED_MESSAGE, 'warning')
      return false
    }
    const existsInList = books.some((item) => String(item?.bookId || '').trim() === bookId)
    const indexBookId = String(selectedBookIndex?.bookId || '').trim()
    if (!existsInList || !indexBookId || indexBookId !== bookId) {
      toast(PROJECT_TEXT_INVALID_MESSAGE, 'warning')
      return false
    }
    return true
  }, [books, currentProject?.id, selectedBookId, selectedBookIndex?.bookId])

  React.useEffect(() => {
    if (!mounted) return
    const projectId = String(currentProject?.id || '').trim()
    const bookId = String(selectedBookId || '').trim()
    if (!projectId || !bookId) return
    const chapterNo = Math.trunc(Number(selectedBookChapter || 0))
    if (!Number.isFinite(chapterNo) || chapterNo <= 0) return
    writeAssetPanelBookProgress(projectId, {
      selectedBookId: bookId,
      chapterByBookPatch: { [bookId]: String(chapterNo) },
    })
  }, [mounted, currentProject?.id, selectedBookChapter, selectedBookId])
  React.useEffect(() => {
    if (!selectedBookIndex) return
    const chapter = Number(selectedBookChapter)
    if (!Number.isFinite(chapter) || chapter <= 0) return
    const chapters = Array.isArray(selectedBookIndex.chapters) ? selectedBookIndex.chapters : []
    if (chapters.some((x) => x.chapter === Math.trunc(chapter))) return
    const firstChapter = chapters[0]?.chapter
    if (typeof firstChapter === 'number' && firstChapter > 0) {
      setSelectedBookChapter(String(firstChapter))
    }
  }, [selectedBookChapter, selectedBookIndex])

  // 当内容不足以滚动时，自动预取更多页
  React.useEffect(() => {
    if (!mounted) return
    if (!hasMoreAssets || loading) return
    // defer to allow layout
    const timer = window.setTimeout(() => {
      const el = bodyScrollRef.current
      if (!el) return
      if (el.scrollHeight <= el.clientHeight + 40) {
        loadMoreAssets().catch(() => {})
      }
    }, 80)
    return () => window.clearTimeout(timer)
  }, [mounted, assets.length, hasMoreAssets, loading, tab, mediaFilter, loadMoreAssets])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      if (!mounted) return
      reloadAssets().catch(() => {})
    }
    window.addEventListener(ASSET_REFRESH_EVENT, handler)
    return () => window.removeEventListener(ASSET_REFRESH_EVENT, handler)
  }, [mounted, reloadAssets])

  const generationAssets = React.useMemo(() => assets.filter(isGenerationAsset), [assets])
  const workflowAssets = React.useMemo(() => {
    if (workflowLibraryAssets.length > 0) return workflowLibraryAssets
    return assets.filter(isWorkflowAsset)
  }, [assets, workflowLibraryAssets])
  const currentProjectTextAsset = React.useMemo(() => pickCurrentProjectTextAsset(assets), [assets])
  const projectMaterialAssets = React.useMemo(
    () => (currentProjectTextAsset ? [currentProjectTextAsset] : []),
    [currentProjectTextAsset],
  )
  const hasCurrentProjectText = React.useMemo(() => {
    if (!currentProjectTextAsset) return false
    const content = String(getProjectMaterialData(currentProjectTextAsset).content || '').trim()
    return content.length > 0
  }, [currentProjectTextAsset])
  const activeBook = React.useMemo(
    () => books.find((item) => item.bookId === selectedBookId) || pickPrimaryProjectBook(books),
    [books, selectedBookId],
  )
  const currentProjectTextActionLabel = hasCurrentProjectText ? '替换文本' : '上传文本'
  const materialChapterOptions = React.useMemo(() => {
    const set = new Set<number>()
    for (const asset of projectMaterialAssets) {
      const chapter = getProjectMaterialData(asset).chapter
      if (typeof chapter === 'number' && Number.isFinite(chapter) && chapter > 0) {
        set.add(Math.trunc(chapter))
      }
    }
    return Array.from(set).sort((a, b) => a - b)
  }, [projectMaterialAssets])
  const filteredProjectMaterialAssets = React.useMemo(() => {
    if (materialChapterFilter === 'all') return projectMaterialAssets
    const chapter = Number(materialChapterFilter)
    if (!Number.isFinite(chapter) || chapter <= 0) return projectMaterialAssets
    return projectMaterialAssets.filter((asset) => {
      const chapterValue = getProjectMaterialData(asset).chapter
      return typeof chapterValue === 'number' && chapterValue === Math.trunc(chapter)
    })
  }, [projectMaterialAssets, materialChapterFilter])
  const roleCardAssets = React.useMemo(() => {
    return projectRoleCardAssets
      .slice()
      .sort((a, b) => Date.parse(String(b?.updatedAt || '')) - Date.parse(String(a?.updatedAt || '')))
  }, [projectRoleCardAssets])
  const bookRoleCards = React.useMemo(() => {
    return Array.isArray(selectedBookIndex?.assets?.roleCards) ? selectedBookIndex.assets.roleCards : []
  }, [selectedBookIndex?.assets?.roleCards])
  const roleCardDisplayAssets = React.useMemo(() => {
    const merged = new Map<string, RoleCardAssetData>()
    const makeKey = (card: RoleCardAssetData): string => {
      const cardId = String(card?.cardId || '').trim()
      if (cardId) return `card:${cardId}`
      const roleName = String(card?.roleName || '').trim().toLowerCase()
      const chapter = Math.trunc(Number(card?.chapter || 0))
      return `role:${roleName}#${chapter > 0 ? chapter : 'na'}`
    }
    const put = (card: RoleCardAssetData) => {
      const key = makeKey(card)
      const prev = merged.get(key)
      if (!prev) {
        merged.set(key, card)
        return
      }
      const prevTs = Date.parse(String(prev?.updatedAt || ''))
      const nextTs = Date.parse(String(card?.updatedAt || ''))
      if ((Number.isFinite(nextTs) ? nextTs : 0) >= (Number.isFinite(prevTs) ? prevTs : 0)) {
        merged.set(key, card)
      }
    }
    for (const card of bookRoleCards) put(card as RoleCardAssetData)
    for (const card of roleCardAssets) put(card)
    return Array.from(merged.values()).sort(
      (a, b) => Date.parse(String(b?.updatedAt || '')) - Date.parse(String(a?.updatedAt || '')),
    )
  }, [bookRoleCards, roleCardAssets])
  const latestRoleCardMap = React.useMemo(() => {
    const map = new Map<string, RoleCardAssetData>()
    for (const card of roleCardAssets) {
      const roleId = String(card?.roleId || '').trim().toLowerCase()
      const roleName = String(card?.roleName || '').trim().toLowerCase()
      if (roleId && !map.has(`id:${roleId}`)) map.set(`id:${roleId}`, card)
      if (roleName && !map.has(`name:${roleName}`)) map.set(`name:${roleName}`, card)
    }
    return map
  }, [roleCardAssets])
  const filteredRoleCardAssets = React.useMemo(() => {
    const q = roleCardKeyword.trim().toLowerCase()
    if (!q) return roleCardDisplayAssets
    return roleCardDisplayAssets.filter((x) => {
      const role = String(x?.roleName || '').toLowerCase()
      const prompt = String(x?.prompt || '').toLowerCase()
      return role.includes(q) || prompt.includes(q)
    })
  }, [roleCardDisplayAssets, roleCardKeyword])
  const selectedChapterMeta = React.useMemo(() => {
    const chapter = Number(selectedBookChapter)
    if (!selectedBookIndex || !Number.isFinite(chapter) || chapter <= 0) return null
    return (selectedBookIndex.chapters || []).find((it) => it.chapter === Math.trunc(chapter)) || null
  }, [selectedBookChapter, selectedBookIndex])
  const availableCharacterPool = React.useMemo(
    () => buildAvailableCharacterPool({ selectedBookIndex, selectedChapterMeta }),
    [selectedBookIndex, selectedChapterMeta],
  )
  const mainRoleCandidates = React.useMemo(() => {
    const profiles = Array.isArray((selectedBookIndex as any)?.assets?.characterProfiles)
      ? (((selectedBookIndex as any).assets.characterProfiles || []) as RoleProfileForCanvas[])
      : []
    const graphNodes = Array.isArray((selectedBookIndex as any)?.assets?.characterGraph?.nodes)
      ? (((selectedBookIndex as any).assets.characterGraph.nodes || []) as CharacterGraphNodeForCanvas[])
      : []
    const graphIdByName = new Map<string, string>()
    for (const node of graphNodes) {
      const nameKey = String(node?.name || '').trim().toLowerCase()
      const id = String(node?.id || '').trim()
      if (!nameKey || !id) continue
      graphIdByName.set(nameKey, id)
    }
    return profiles
      .filter((x) => x?.importance === 'main')
      .slice(0, 12)
      .map((x) => {
        const name = String(x?.name || '').trim()
        return {
          ...x,
          name,
          id: graphIdByName.get(name.toLowerCase()) || x.id || '',
        }
      })
      .filter((x) => x.name)
  }, [selectedBookIndex])
  const allRoleCardSyncTargets = React.useMemo(() => {
    const roles = listRolesFromBookIndex(selectedBookIndex)
    const out: Array<{
      roleId?: string
      roleName: string
      roleDesc?: string
      chapterSpan?: number[]
      existingCard: RoleCardAssetData | null
    }> = []
    const seen = new Set<string>()

    for (const role of roles) {
      const roleName = String(role?.name || '').trim()
      if (!roleName) continue
      const roleId = String(role?.id || '').trim()
      const key = roleId ? `id:${roleId.toLowerCase()}` : `name:${roleName.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      const existingCard =
        latestRoleCardMap.get(`id:${roleId.toLowerCase()}`) ||
        latestRoleCardMap.get(`name:${roleName.toLowerCase()}`) ||
        null
      out.push({
        roleId: roleId || undefined,
        roleName,
        roleDesc: String(role?.description || '').trim() || undefined,
        chapterSpan: Array.isArray((role as any)?.chapterSpan) ? (role as any).chapterSpan : undefined,
        existingCard,
      })
    }

    for (const card of roleCardAssets) {
      const roleName = String(card?.roleName || '').trim()
      if (!roleName) continue
      const roleId = String(card?.roleId || '').trim()
      const key = roleId ? `id:${roleId.toLowerCase()}` : `name:${roleName.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        roleId: roleId || undefined,
        roleName,
        chapterSpan: undefined,
        existingCard: card,
      })
    }

    return out
  }, [latestRoleCardMap, roleCardAssets, selectedBookIndex])

  const selectedStyleBible = React.useMemo(() => {
    const data = (selectedBookIndex as any)?.assets?.styleBible
    if (!data || typeof data !== 'object') return null
    return data as StyleBibleForCanvas
  }, [selectedBookIndex])
  const selectedStyleReferenceImages = React.useMemo(() => {
    const input = Array.isArray(selectedStyleBible?.referenceImages) ? selectedStyleBible.referenceImages : []
    const out: string[] = []
    const seen = new Set<string>()
    for (const item of input) {
      const url = String(item || '').trim()
      if (!url || seen.has(url)) continue
      seen.add(url)
      out.push(url)
      if (out.length >= 8) break
    }
    return out
  }, [selectedStyleBible?.referenceImages])
  const canvasStyleReferenceCandidates = React.useMemo(
    () => listCanvasStyleReferenceCandidates(canvasNodes),
    [canvasNodes],
  )

  React.useEffect(() => {
    if (!mounted) return
    const previousCount = previousStyleReferenceCountRef.current
    const nextCount = selectedStyleReferenceImages.length
    previousStyleReferenceCountRef.current = nextCount
    if (nextCount === 0 || nextCount <= previousCount) return
    const container = bodyScrollRef.current
    const section = styleReferenceSectionRef.current
    if (!container || !section) return
    const timer = window.setTimeout(() => {
      const containerRect = container.getBoundingClientRect()
      const sectionRect = section.getBoundingClientRect()
      const margin = 16
      const isAbove = sectionRect.top < containerRect.top + margin
      const isBelow = sectionRect.bottom > containerRect.bottom - margin
      if (!isAbove && !isBelow) return
      const topDelta = sectionRect.top - containerRect.top
      const targetTop = container.scrollTop + topDelta - margin
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      })
    }, 40)
    return () => window.clearTimeout(timer)
  }, [mounted, selectedStyleReferenceImages.length])
  const roleCardImageMap = React.useMemo(() => {
    const chapterRaw = Number(selectedBookChapter)
    const currentChapterNo = Number.isFinite(chapterRaw) && chapterRaw > 0 ? Math.trunc(chapterRaw) : null
    const map = new Map<string, string>()
    const usableCards = roleCardAssets
      .filter((card) => hasUsableRoleCardImage(card as RoleCardAssetData, currentChapterNo))
      .sort((a, b) => {
        const tb = Date.parse(String((b as any)?.updatedAt || ''))
        const ta = Date.parse(String((a as any)?.updatedAt || ''))
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
      }) as RoleCardAssetData[]
    for (const card of usableCards) {
      const roleName = String(card?.roleName || '').trim()
      const imageUrl = String(card?.imageUrl || '').trim()
      if (!roleName || !imageUrl) continue
      map.set(roleName.toLowerCase(), imageUrl)
    }
    return map
  }, [roleCardAssets, selectedBookChapter])
  const getVisibleFlowRect = React.useCallback(() => {
    const parseViewportTransform = (): { tx: number; ty: number; zoom: number } => {
      const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement | null
      if (!viewportEl || typeof window === 'undefined') return { tx: 0, ty: 0, zoom: 1 }
      const transform = window.getComputedStyle(viewportEl).transform
      if (!transform || transform === 'none') return { tx: 0, ty: 0, zoom: 1 }
      const matrixMatch = transform.match(/^matrix\((.+)\)$/)
      if (matrixMatch?.[1]) {
        const values = matrixMatch[1].split(',').map((x) => Number.parseFloat(x.trim()))
        if (values.length >= 6 && values.every((n) => Number.isFinite(n))) {
          return { tx: values[4], ty: values[5], zoom: values[0] || 1 }
        }
      }
      const matrix3dMatch = transform.match(/^matrix3d\((.+)\)$/)
      if (matrix3dMatch?.[1]) {
        const values = matrix3dMatch[1].split(',').map((x) => Number.parseFloat(x.trim()))
        if (values.length >= 16 && values.every((n) => Number.isFinite(n))) {
          return { tx: values[12], ty: values[13], zoom: values[0] || 1 }
        }
      }
      return { tx: 0, ty: 0, zoom: 1 }
    }

    const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement | null
    const host = (viewportEl?.parentElement as HTMLElement | null) || viewportEl
    const rect = host?.getBoundingClientRect()
    const width = rect?.width && Number.isFinite(rect.width) && rect.width > 0 ? rect.width : window.innerWidth
    const height = rect?.height && Number.isFinite(rect.height) && rect.height > 0 ? rect.height : window.innerHeight
    const { tx, ty, zoom } = parseViewportTransform()
    const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
    const left = -tx / safeZoom
    const top = -ty / safeZoom
    return {
      left,
      top,
      right: left + width / safeZoom,
      bottom: top + height / safeZoom,
      width: width / safeZoom,
      height: height / safeZoom,
    }
  }, [])

  const resolveRoleCardsGroupPosition = React.useCallback((nodes: Node[], groupSize: { w: number; h: number }) => {
    const view = getVisibleFlowRect()
    const margin = 24
    const gap = 28
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
    const nodesById = new Map(nodes.map((n) => [n.id, n] as const))
    const rects = nodes
      .filter((n) => n.type !== 'groupNode')
      .map((n) => {
        const p = getNodeAbsPosition(n as any, nodesById as any)
        const s = getNodeSize(n as any)
        return { x: p.x, y: p.y, w: s.w, h: s.h }
      })
      .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h))
    const visibleRects = rects.filter((r) => !(r.x + r.w < view.left || r.x > view.right || r.y + r.h < view.top || r.y > view.bottom))

    if (!visibleRects.length) {
      return {
        x: clamp(view.left + view.width * 0.58, view.left + margin, view.right - groupSize.w - margin),
        y: clamp(view.top + margin, view.top + margin, view.bottom - groupSize.h - margin),
      }
    }
    const source = visibleRects
    const minX = Math.min(...source.map((r) => r.x))
    const minY = Math.min(...source.map((r) => r.y))
    const maxX = Math.max(...source.map((r) => r.x + r.w))
    const maxY = Math.max(...source.map((r) => r.y + r.h))

    const canRight = maxX + gap + groupSize.w <= view.right - margin
    const canBelow = maxY + gap + groupSize.h <= view.bottom - margin
    if (canRight) {
      return {
        x: clamp(maxX + gap, view.left + margin, view.right - groupSize.w - margin),
        y: clamp(minY, view.top + margin, view.bottom - groupSize.h - margin),
      }
    }
    if (canBelow) {
      return {
        x: clamp(minX, view.left + margin, view.right - groupSize.w - margin),
        y: clamp(maxY + gap, view.top + margin, view.bottom - groupSize.h - margin),
      }
    }
    return {
      x: clamp(view.right - groupSize.w - margin, view.left + margin, view.right - groupSize.w - margin),
      y: clamp(view.bottom - groupSize.h - margin, view.top + margin, view.bottom - groupSize.h - margin),
    }
  }, [getVisibleFlowRect])
  const handleApplyAiCharacterLibraryToCanvas = React.useCallback(async (character: AiCharacterLibraryCharacterDto) => {
    const roleName = String(character.identity_hint || character.character_id || 'AI角色').trim() || 'AI角色'
    const basePosition = resolveRoleCardsGroupPosition(useRFStore.getState().nodes, { w: 1080, h: 760 })
    const items = [
      { slot: 'full-body', label: '角色立绘', url: String(character.full_body_image_url || '').trim() },
      { slot: 'closeup', label: '肖像特写', url: String(character.closeup_image_url || '').trim() },
      { slot: 'expression', label: '表情九宫格', url: String(character.expression_image_url || '').trim() },
      { slot: 'three-view', label: '三视图', url: String(character.three_view_image_url || '').trim() },
    ].filter((item) => item.url)

    if (!items.length) {
      throw new Error('当前角色没有可用图片，无法应用到画布')
    }

    const promptBase = [
      `AI角色库角色：${roleName}`,
      character.filter_worldview ? `世界观：${character.filter_worldview}` : '',
      character.filter_theme ? `主题：${character.filter_theme}` : '',
      character.cultural_region ? `文化区域：${character.cultural_region}` : '',
      character.time_period ? `时代：${character.time_period}` : '',
      character.scene ? `场景：${character.scene}` : '',
      character.outfit ? `着装：${character.outfit}` : '',
      character.distinctive_features ? `辨识特征：${character.distinctive_features}` : '',
    ].filter(Boolean).join('\n')

    const positions = [
      { x: basePosition.x, y: basePosition.y },
      { x: basePosition.x + 360, y: basePosition.y },
      { x: basePosition.x + 720, y: basePosition.y },
      { x: basePosition.x, y: basePosition.y + 320 },
    ]

    items.forEach((item, index) => {
      addNode('taskNode', roleName, {
        kind: 'image',
        autoLabel: false,
        position: positions[index] || positions[0],
        prompt: `${promptBase}\n资源类型：${item.label}`,
        imageUrl: item.url,
        imageResults: [{ url: item.url, title: item.label }],
        imagePrimaryIndex: 0,
        status: 'success',
        source: 'ai_character_library',
        roleName,
        characterLibraryCharacterId: character.id,
        characterLibraryAssetSlot: item.slot,
        characterLibraryAssetLabel: item.label,
      })
    })

    toast(`AI角色库已加入画布：${roleName}（${items.length} 张）`, 'success')
    setActivePanel(null)
  }, [addNode, resolveRoleCardsGroupPosition, setActivePanel])
  const graphPreviewChapterNo = React.useMemo(() => {
    const n = Number(selectedBookChapter)
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null
  }, [selectedBookChapter])
  const graphNodes = React.useMemo(() => {
    const nodes = Array.isArray((selectedBookIndex as any)?.assets?.characterGraph?.nodes)
      ? (((selectedBookIndex as any).assets.characterGraph.nodes || []) as CharacterGraphNodeForCanvas[])
      : []
    return nodes.slice(0, 180)
  }, [selectedBookIndex])
  const graphEdges = React.useMemo(() => {
    const edges = Array.isArray((selectedBookIndex as any)?.assets?.characterGraph?.edges)
      ? (((selectedBookIndex as any).assets.characterGraph.edges || []) as CharacterGraphEdgeForCanvas[])
      : []
    return edges.slice(0, 360)
  }, [selectedBookIndex])
  const filteredGraphNodes = React.useMemo(() => {
    return graphNodes.filter((node) => {
      if (typeof graphPreviewChapterNo === 'number') {
        const unlock = Number(node.unlockChapter)
        if (Number.isFinite(unlock) && unlock > graphPreviewChapterNo) return false
      }
      return true
    })
  }, [graphNodes, graphPreviewChapterNo])
  const filteredGraphEdges = React.useMemo(() => {
    const visibleIds = new Set(filteredGraphNodes.map((x) => String(x.id || '').trim().toLowerCase()).filter(Boolean))
    return graphEdges.filter((edge) => {
      const sourceId = String(edge.sourceId || '').trim().toLowerCase()
      const targetId = String(edge.targetId || '').trim().toLowerCase()
      if (!visibleIds.has(sourceId) || !visibleIds.has(targetId)) return false
      return true
    })
  }, [filteredGraphNodes, graphEdges])
  const chapterMetadataProgress = React.useMemo(() => {
    const chapters = Array.isArray(selectedBookIndex?.chapters) ? selectedBookIndex.chapters : []
    const isChapterMetadataComplete = (chapter: any): boolean => {
      const title = String(chapter?.title || '').trim()
      const summary = String(chapter?.summary || '').trim()
      const coreConflict = String(chapter?.coreConflict || '').trim()
      return (
        !!title &&
        !!summary &&
        !!coreConflict &&
        Array.isArray(chapter?.keywords) &&
        chapter.keywords.length > 0 &&
        Array.isArray(chapter?.characters) &&
        Array.isArray(chapter?.props) &&
        Array.isArray(chapter?.scenes) &&
        Array.isArray(chapter?.locations)
      )
    }
    const total = chapters.length
    const complete = chapters.filter((chapter) => isChapterMetadataComplete(chapter)).length
    const firstIncomplete = chapters.find((chapter) => !isChapterMetadataComplete(chapter)) || null
    const nextWindowStart = firstIncomplete
      ? Math.max(1, Math.trunc(Number((firstIncomplete as any)?.chapter || 1)))
      : null
    const nextWindowEnd = nextWindowStart ? Math.min(total, nextWindowStart + 100 - 1) : null
    return {
      total,
      complete,
      firstIncomplete,
      nextWindowStart,
      nextWindowEnd,
      done: total > 0 && complete >= total,
    }
  }, [selectedBookIndex])
  const bookFilterKeywordNorm = React.useMemo(() => bookFilterKeyword.trim().toLowerCase(), [bookFilterKeyword])
  const filteredBookChapters = React.useMemo(() => {
    const chapters = Array.isArray(selectedBookIndex?.chapters) ? selectedBookIndex!.chapters : []
    if (!chapters.length) return []
    if (bookFilterType === 'all' || !bookFilterKeywordNorm) return chapters
    const includesText = (value: string) => String(value || '').toLowerCase().includes(bookFilterKeywordNorm)
    return chapters.filter((ch) => {
      if (bookFilterType === 'keywords') {
        const words = Array.isArray(ch.keywords) ? ch.keywords : []
        return words.some((w) => includesText(String(w)))
      }
      const list = (ch as any)?.[bookFilterType]
      if (!Array.isArray(list)) return false
      return list.some((it: any) => includesText(it?.name || '') || includesText(it?.description || ''))
    })
  }, [bookFilterKeywordNorm, bookFilterType, selectedBookIndex])
  const bookQuickFilterOptions = React.useMemo(() => {
    if (!selectedBookIndex || bookFilterType === 'all') return []
    if (bookFilterType === 'keywords') {
      const words = new Set<string>()
      for (const ch of selectedBookIndex.chapters || []) {
        for (const kw of ch.keywords || []) {
          const text = String(kw || '').trim()
          if (text) words.add(text)
          if (words.size >= 60) break
        }
        if (words.size >= 60) break
      }
      return Array.from(words)
    }
    const pool = ((selectedBookIndex as any)?.assets?.[bookFilterType] || []) as Array<{ name?: string }>
    return pool
      .map((x) => String(x?.name || '').trim())
      .filter(Boolean)
      .slice(0, 60)
  }, [bookFilterType, selectedBookIndex])

  React.useEffect(() => {
    if (!selectedBookIndex) return
    const chapter = Number(selectedBookChapter)
    if (!Number.isFinite(chapter) || chapter <= 0) return
    if (filteredBookChapters.some((x) => x.chapter === Math.trunc(chapter))) return
    const next = filteredBookChapters[0]?.chapter
    if (typeof next === 'number' && next > 0) {
      setSelectedBookChapter(String(next))
    }
  }, [filteredBookChapters, selectedBookChapter, selectedBookIndex])

  const filteredGenerationAssets = React.useMemo(() => {
    const q = String(assetQuery || '').trim().toLowerCase()
    const byQuery = (asset: ServerAssetDto) => {
      if (!q) return true
      const data = getGenerationData(asset)
      const hay = [asset?.name, data?.vendor, data?.modelKey, data?.taskKind, data?.type, data?.kind, data?.url]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return hay.includes(q)
    }

    const byType = (asset: ServerAssetDto) => {
      if (mediaFilter === 'all') return true
      return getGenerationData(asset).type === mediaFilter
    }

    const sortKey = (asset: ServerAssetDto) => {
      const name = String(asset?.name || '').toLowerCase()
      const updated = Date.parse(String((asset as any)?.updatedAt || (asset as any)?.updated_at || '')) || 0
      const created = Date.parse(String((asset as any)?.createdAt || (asset as any)?.created_at || '')) || 0
      return { name, updated, created }
    }

    return generationAssets
      .filter((a) => byType(a) && byQuery(a))
      .slice()
      .sort((a, b) => {
        const ka = sortKey(a)
        const kb = sortKey(b)
        if (assetSort === 'name_asc') return ka.name.localeCompare(kb.name)
        if (assetSort === 'created_desc') return kb.created - ka.created
        return kb.updated - ka.updated
      })
  }, [assetQuery, assetSort, generationAssets, mediaFilter])
  const visibleGenerationAssets = React.useMemo(
    () => filteredGenerationAssets.slice(0, Math.max(10, visibleGenerationCount)),
    [filteredGenerationAssets, visibleGenerationCount],
  )

  const MAX_THUMB_JOBS = 2

  React.useEffect(() => {
    // 重置生成内容的可见数量，避免切换过滤后还停留在末尾
    setVisibleGenerationCount(10)
  }, [mediaFilter])

  const runNextThumbJob = React.useCallback(() => {
    if (activeThumbJobsRef.current >= MAX_THUMB_JOBS) return
    const entries = Object.entries(thumbStatusRef.current)
    const nextEntry = entries.find(([, status]) => status === 'pending')
    if (!nextEntry) return
    const [assetId] = nextEntry
    const asset = generationAssets.find((a) => a.id === assetId)
    if (!asset) {
      thumbStatusRef.current[assetId] = 'done'
      return
    }
    const data = getGenerationData(asset)
    if (data.type !== 'video' || !data.url) {
      thumbStatusRef.current[assetId] = 'done'
      return
    }
    thumbStatusRef.current[assetId] = 'running'
    activeThumbJobsRef.current += 1

    extractFirstFrame(data.url)
      .then((thumb) => {
        if (thumb) {
          setGeneratedThumbs((prev) => {
            if (prev[assetId]) return prev
            return { ...prev, [assetId]: thumb }
          })
        } else {
          setGeneratedThumbs((prev) => (prev[assetId] ? prev : { ...prev, [assetId]: null }))
        }
      })
      .catch(() => {
        setGeneratedThumbs((prev) => (prev[assetId] ? prev : { ...prev, [assetId]: null }))
      })
      .finally(() => {
        activeThumbJobsRef.current -= 1
        thumbStatusRef.current[assetId] = 'done'
        // 尝试继续处理队列中的下一个任务
        runNextThumbJob()
      })
  }, [generationAssets])

  React.useEffect(() => {
    if (!mounted) return
    // 收集需要生成缩略图的视频资产
    generationAssets.forEach((asset) => {
      const data = getGenerationData(asset)
      if (data.type !== 'video') return
      if (!data.url) return
      if (data.thumbnailUrl) return
      if (generatedThumbs[asset.id] !== undefined) return
      if (!thumbStatusRef.current[asset.id]) {
        thumbStatusRef.current[asset.id] = 'pending'
      }
    })
    runNextThumbJob()
  }, [mounted, generationAssets, generatedThumbs, runNextThumbJob])

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('已复制链接', 'success')
    } catch (err) {
      console.error(err)
      toast('复制失败，请手动复制', 'error')
    }
  }

  const handleDelete = async (asset: ServerAssetDto) => {
    if (!confirm(`确定删除「${asset.name}」吗？`)) return
    try {
      await deleteServerAsset(asset.id)
      setAssets((prev) => prev.filter((a) => a.id !== asset.id))
    } catch (err: any) {
      console.error(err)
      toast(err?.message || '删除失败', 'error')
    }
  }

  const handleRename = async (asset: ServerAssetDto) => {
    const next = prompt('重命名：', asset.name)?.trim()
    if (!next || next === asset.name) return
    try {
      await renameServerAsset(asset.id, next)
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, name: next } : a)))
    } catch (err: any) {
      console.error(err)
      toast(err?.message || '重命名失败', 'error')
    }
  }

  const applyAssetAt = (assetId: string, pos: { x: number; y: number }) => {
    const rec = workflowAssets.find((a) => a.id === assetId) || assets.find((a) => a.id === assetId)
    if (!rec) return

    const data: any = rec.data || { nodes: [], edges: [] }
    if (!data.nodes || data.nodes.length === 0) return

    const validNodes = data.nodes.filter((n: any) => {
      return (
        n &&
        n.id &&
        n.type &&
        n.position &&
        typeof n.position.x === 'number' &&
        typeof n.position.y === 'number'
      )
    })

    const validEdges = (data.edges || []).filter((e: any) => {
      return (
        e &&
        e.id &&
        e.source &&
        e.target &&
        validNodes.some((n: any) => n.id === e.source) &&
        validNodes.some((n: any) => n.id === e.target)
      )
    })

    if (validNodes.length === 0) return

    const minX = Math.min(...validNodes.map((n: any) => n.position.x))
    const minY = Math.min(...validNodes.map((n: any) => n.position.y))
    const dx = pos.x - minX
    const dy = pos.y - minY

    const idMap: Record<string, string> = {}
    validNodes.forEach((n: any) => {
      const timestamp = Date.now()
      const random = Math.random().toString(36).slice(2, 10)
      const newId = `n${timestamp}_${random}`
      idMap[n.id] = newId
    })

    const nodes = validNodes.map((n: any) => {
      const parentId = typeof n.parentId === 'string' ? n.parentId.trim() : ''
      const mappedParentId = parentId && idMap[parentId] ? idMap[parentId] : undefined

      return {
        id: idMap[n.id] || n.id,
        type: n.type,
        position: { x: n.position.x + dx, y: n.position.y + dy },
        ...(mappedParentId ? { parentId: mappedParentId } : null),
        data: {
          ...(n.data || {}),
          status: undefined,
          taskId: undefined,
          imageResults: undefined,
          videoResults: undefined,
          audioUrl: undefined,
          imageUrl: undefined,
          videoUrl: undefined,
          videoThumbnailUrl: undefined,
          videoTitle: undefined,
          videoDurationSeconds: undefined,
          lastText: undefined,
          textResults: undefined,
          lastError: undefined,
          progress: undefined,
        },
        selected: false,
        dragging: false,
        hidden: false,
        deletable: true,
        selectable: true,
        dragHandle: undefined,
        zIndex: 1,
        focusable: true,
        connectable: true,
      }
    })

    const edges = validEdges.map((e: any) => {
      const timestamp = Date.now()
      const random = Math.random().toString(36).slice(2, 10)
      const newEdgeId = `e${timestamp}_${random}`

      return {
        id: newEdgeId,
        source: idMap[e.source] || e.source,
        target: idMap[e.target] || e.target,
        type: e.type || 'default',
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        animated: false,
        selected: false,
        hidden: false,
        data: e.data || {},
        deletable: true,
        selectable: true,
        focusable: true,
        updatable: true,
      }
    })

    const currentNodes = useRFStore.getState().nodes
    const currentEdges = useRFStore.getState().edges

    const validCurrentNodes = currentNodes.filter((n: any) => {
      if (n.parentId) {
        return currentNodes.some((parent: any) => parent.id === n.parentId)
      }
      return true
    })

    const validCurrentEdges = currentEdges.filter((e: any) => {
      return currentNodes.some((n: any) => n.id === e.source) && currentNodes.some((n: any) => n.id === e.target)
    })

    const newNodes = [...validCurrentNodes, ...nodes]
    const newEdges = [...validCurrentEdges, ...edges]

    const maxId = Math.max(
      ...newNodes.map((n: any) => {
        const match = n.id.match(/\d+/)
        return match ? parseInt(match[0], 10) : 0
      }),
    )

    useRFStore.setState({
      nodes: newNodes,
      edges: newEdges,
      nextId: maxId + 1,
    })
  }

  const maxHeight = calculateSafeMaxHeight(anchorY, 150)
  const handleScroll: React.UIEventHandler<HTMLDivElement> = (event) => {
    const el = event.currentTarget
    const threshold = 80
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
      if (tab === 'generated') {
        if (visibleGenerationCount < filteredGenerationAssets.length) {
          setVisibleGenerationCount((prev) => Math.min(prev + 10, filteredGenerationAssets.length))
          return
        }
      }
      if (hasMoreAssets) {
        loadMoreAssets().catch(() => {})
      }
    }
  }

  const buildGenerationNodePayload = (input: {
    label: string
    isVideo: boolean
    data: ReturnType<typeof getGenerationData>
  }) => {
    const { label, isVideo, data } = input
    return {
      kind: isVideo ? 'video' : 'image',
      autoLabel: false,
      prompt: data.prompt || '',
      imageUrl: !isVideo ? data.url : undefined,
      videoUrl: isVideo ? data.url : undefined,
      videoThumbnailUrl: isVideo ? data.thumbnailUrl || undefined : undefined,
      imageResults: !isVideo && data.url ? [{ url: data.url }] : undefined,
      videoResults: isVideo && data.url ? [{ url: data.url, thumbnailUrl: data.thumbnailUrl || undefined }] : undefined,
      modelKey: data.modelKey,
      source: data.vendor || 'asset',
    }
  }

  const renderGenerationMedia = (input: {
    isVideo: boolean
    data: ReturnType<typeof getGenerationData>
    cover: string | null
    label: string
  }) => {
    const { isVideo, data, cover, label } = input
    if (isVideo) {
      if (!data.url) return <PlaceholderImage label="视频" />
      return (
        <div className="asset-panel-card-media">
          <video
            className="asset-panel-card-video"
            src={data.url}
            poster={cover || undefined}
            controls
            playsInline
          />
        </div>
      )
    }
    if (cover) {
      return (
        <Image
          className="asset-panel-card-image"
          src={cover}
          alt={label}
          radius="sm"
          height={160}
          fit="cover"
          draggable
          onDragStart={(evt) => setTapImageDragData(evt as any, cover)}
        />
      )
    }
    return <PlaceholderImage label={label} />
  }

  const renderGenerationCardActions = (input: {
    asset: ServerAssetDto
    data: ReturnType<typeof getGenerationData>
    isVideo: boolean
    label: string
  }) => {
    const { asset, data, isVideo, label } = input
    const hasUrl = Boolean(data.url)
    return (
      <Group className="asset-panel-card-actions" justify="flex-end" gap={4}>
        <Tooltip className="asset-panel-card-preview-tooltip" label="预览" withArrow>
          <ActionIcon
            className="asset-panel-card-preview-action"
            size="sm"
            variant="subtle"
            onClick={() => {
              if (!data.url) return
              openPreview({ url: data.url, kind: isVideo ? 'video' : 'image', name: asset.name })
            }}
          >
            {isVideo ? <IconPlayerPlay className="asset-panel-card-preview-icon" size={16} /> : <IconPhoto className="asset-panel-card-preview-icon" size={16} />}
          </ActionIcon>
        </Tooltip>
        {hasUrl && (
          <Tooltip className="asset-panel-card-add-tooltip" label="加入画布" withArrow>
            <ActionIcon
              className="asset-panel-card-add-action"
              size="sm"
              variant="light"
              onClick={() => {
                addNode('taskNode', label, buildGenerationNodePayload({ label, isVideo, data }))
                setActivePanel(null)
              }}
            >
              <IconPlus className="asset-panel-card-add-icon" size={16} />
            </ActionIcon>
          </Tooltip>
        )}
        {hasUrl && (
          <Tooltip className="asset-panel-card-copy-tooltip" label="复制链接" withArrow>
            <ActionIcon className="asset-panel-card-copy-action" size="sm" variant="subtle" onClick={() => handleCopy(data.url || '')}>
              <IconCopy className="asset-panel-card-copy-icon" size={16} />
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip className="asset-panel-card-rename-tooltip" label="重命名" withArrow>
          <ActionIcon className="asset-panel-card-rename-action" size="sm" variant="subtle" onClick={() => handleRename(asset)}>
            <IconPencil className="asset-panel-card-rename-icon" size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip className="asset-panel-card-delete-tooltip" label="删除" withArrow>
          <ActionIcon className="asset-panel-card-delete-action" size="sm" variant="subtle" color="red" onClick={() => handleDelete(asset)}>
            <IconTrash className="asset-panel-card-delete-icon" size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    )
  }

  const renderGenerationCard = (asset: ServerAssetDto) => {
    const data = getGenerationData(asset)
    const isVideo = data.type === 'video'
    const generated = generatedThumbs[asset.id] || null
    const cover: string | null = isVideo ? generated || data.thumbnailUrl || null : data.thumbnailUrl || data.url || null
    const label = asset.name || (isVideo ? '视频' : '图片')
    return (
      <PanelCard className="asset-panel-card" key={asset.id}>
        {renderGenerationMedia({ isVideo, data, cover, label })}
        <Stack className="asset-panel-card-body" gap={6} mt="sm">
          <Group className="asset-panel-card-badges" gap="xs">
            <Badge className="asset-panel-card-type" size="xs" color={isVideo ? 'violet' : 'teal'} leftSection={isVideo ? <IconVideo className="asset-panel-card-type-icon" size={12} /> : <IconPhoto className="asset-panel-card-type-icon" size={12} />}>
              {isVideo ? '视频' : '图片'}
            </Badge>
            {data.vendor && (
              <Badge className="asset-panel-card-vendor" size="xs" variant="light">
                {data.vendor}
              </Badge>
            )}
            {data.modelKey && (
              <Badge className="asset-panel-card-model" size="xs" variant="outline">
                {data.modelKey}
              </Badge>
            )}
          </Group>
          <Text className="asset-panel-card-title" size="sm" fw={600} lineClamp={1}>
            {label}
          </Text>
          {data.prompt && (
            <Text className="asset-panel-card-prompt" size="xs" c="dimmed" lineClamp={2}>
              {data.prompt}
            </Text>
          )}
          <Text className="asset-panel-card-date" size="xs" c="dimmed">
            {formatDate(asset.createdAt)}
          </Text>
          {renderGenerationCardActions({ asset, data, isVideo, label })}
        </Stack>
      </PanelCard>
    )
  }

  const renderWorkflowCard = (asset: ServerAssetDto) => {
    const meta = getWorkflowAssetMeta(asset)
    return (
    <PanelCard className="asset-panel-card" key={asset.id}>
      {meta.coverUrl ? (
        <Image className="asset-panel-card-image" src={meta.coverUrl} alt={meta.title} radius="sm" />
      ) : (
        <PlaceholderImage label={meta.title} />
      )}
      <Stack className="asset-panel-card-body" gap={6} mt="sm">
        <Text className="asset-panel-card-title" size="sm" fw={600} lineClamp={1}>
          {meta.title}
        </Text>
        {meta.description ? (
          <Text className="asset-panel-card-prompt" size="xs" c="dimmed" lineClamp={2}>
            {meta.description}
          </Text>
        ) : null}
        <Text className="asset-panel-card-date" size="xs" c="dimmed">
          {formatDate(asset.updatedAt)}
        </Text>
        <Group className="asset-panel-card-actions" justify="flex-end" gap={4}>
          <Tooltip className="asset-panel-card-add-tooltip" label="添加到画布" withArrow>
            <ActionIcon
              className="asset-panel-card-add-action"
              size="sm"
              variant="light"
              onClick={() => {
                const pos = { x: 200, y: anchorY || 200 }
                applyAssetAt(asset.id, pos)
                setActivePanel(null)
              }}
            >
              <IconPlus className="asset-panel-card-add-icon" size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip className="asset-panel-card-rename-tooltip" label="重命名" withArrow>
            <ActionIcon className="asset-panel-card-rename-action" size="sm" variant="subtle" onClick={() => handleRename(asset)}>
              <IconPencil className="asset-panel-card-rename-icon" size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip className="asset-panel-card-delete-tooltip" label="删除" withArrow>
            <ActionIcon className="asset-panel-card-delete-action" size="sm" variant="subtle" color="red" onClick={() => handleDelete(asset)}>
              <IconTrash className="asset-panel-card-delete-icon" size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Stack>
    </PanelCard>
  )
  }

  const renderMaterialCard = (asset: ServerAssetDto) => {
    const data = getProjectMaterialData(asset)
    const kindLabel =
      data.kind === 'novelDoc'
        ? '小说'
        : data.kind === 'scriptDoc'
          ? '剧本'
          : '文档'
    const content = (data.content || data.prompt || '').trim()
    const summary = summarizeUserFacingText(content)
    return (
      <PanelCard className="asset-panel-card" key={asset.id}>
        <Stack className="asset-panel-card-body" gap={6}>
          <Group className="asset-panel-card-badges" gap="xs">
            <Badge className="asset-panel-card-type" size="xs" color="indigo" variant="light">
              {kindLabel}
            </Badge>
            {typeof data.chapter === 'number' && data.chapter > 0 && (
              <Badge className="asset-panel-card-chapter" size="xs" color="violet" variant="light">
                第{data.chapter}章
              </Badge>
            )}
          </Group>
          <Text className="asset-panel-card-title" size="sm" fw={600} lineClamp={1}>
            {asset.name}
          </Text>
          <Text className="asset-panel-card-prompt asset-panel-card-material-summary" size="xs" c="dimmed" lineClamp={4}>
            {summary || '暂无可展示内容'}
          </Text>
          <Text className="asset-panel-card-date" size="xs" c="dimmed">
            {formatDate(asset.updatedAt)}
          </Text>
          <Group className="asset-panel-card-actions" justify="flex-end" gap={4}>
            {content && (
              <Tooltip className="asset-panel-card-copy-tooltip" label="复制内容" withArrow>
                <ActionIcon className="asset-panel-card-copy-action" size="sm" variant="subtle" onClick={() => handleCopy(content)}>
                  <IconCopy className="asset-panel-card-copy-icon" size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip className="asset-panel-card-add-tooltip" label="加入画布" withArrow>
              <ActionIcon
                className="asset-panel-card-add-action"
                size="sm"
                variant="light"
                onClick={() => {
                  addNode('taskNode', asset.name || kindLabel, {
                    kind: data.kind || 'scriptDoc',
                    autoLabel: false,
                    prompt: content || '',
                    textResults: content ? [{ text: content }] : undefined,
                    materialAssetId: asset.id,
                    materialChapter: data.chapter ?? null,
                    chapter: data.chapter ?? null,
                  })
                  setActivePanel(null)
                }}
              >
                <IconPlus className="asset-panel-card-add-icon" size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip className="asset-panel-card-rename-tooltip" label="重命名" withArrow>
              <ActionIcon className="asset-panel-card-rename-action" size="sm" variant="subtle" onClick={() => handleRename(asset)}>
                <IconPencil className="asset-panel-card-rename-icon" size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip className="asset-panel-card-delete-tooltip" label="删除" withArrow>
              <ActionIcon className="asset-panel-card-delete-action" size="sm" variant="subtle" color="red" onClick={() => handleDelete(asset)}>
                <IconTrash className="asset-panel-card-delete-icon" size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Stack>
      </PanelCard>
    )
  }
  const renderRoleCard = (card: RoleCardAssetData) => {
    const roleName = String(card?.roleName || '').trim() || '未命名角色'
    const imageUrl = resolveRoleCardExecutableImageUrl(card)
    const prompt = String(card?.prompt || '').trim()
    const summary = summarizeUserFacingText(prompt, 2)
    const status = String(card?.status || '').trim().toLowerCase() === 'generated' ? 'generated' : 'draft'
    const linkedBookCard = bookRoleCards.find((x) => {
      const xCardId = String(x?.cardId || '').trim()
      if (xCardId && xCardId === String(card?.cardId || '').trim()) return true
      return String(x?.roleName || '').trim().toLowerCase() === roleName.toLowerCase()
    }) || null
    const confirmedAt =
      linkedBookCard && hasConfirmedTimestamp(linkedBookCard.confirmedAt)
        ? String(linkedBookCard.confirmedAt || '').trim()
        : (hasConfirmedTimestamp(card?.confirmedAt) ? String(card?.confirmedAt || '').trim() : '')
    const isConfirmed = !!confirmedAt
    return (
      <PanelCard className="asset-panel-card asset-panel-role-card" key={card.cardId}>
        {imageUrl ? (
          <Image className="asset-panel-role-card-image" src={imageUrl} alt={roleName} radius="sm" h={92} fit="cover" />
        ) : (
          <PlaceholderImage label={`角色卡 · ${roleName}`} />
        )}
        <Stack className="asset-panel-card-body" gap={6} mt="sm">
          <Group className="asset-panel-card-badges" gap="xs">
            <Badge className="asset-panel-card-type" size="xs" color="grape" variant="light">
              角色卡
            </Badge>
            <Badge className="asset-panel-card-role-status" size="xs" color={status === 'generated' ? 'teal' : 'orange'} variant="light">
              {status === 'generated' ? '已生成' : '待生成'}
            </Badge>
            <Badge className="asset-panel-card-role-confirm-status" size="xs" color={isConfirmed ? 'green' : 'yellow'} variant="light">
              {isConfirmed ? '已确认' : '未确认'}
            </Badge>
          </Group>
          <Text className="asset-panel-card-title" size="sm" fw={600} lineClamp={1}>
            {roleName}
          </Text>
          <Text className="asset-panel-card-prompt asset-panel-card-role-summary" size="xs" c="dimmed" lineClamp={2}>
            {summary || '角色设定信息已保存'}
          </Text>
          <Text className="asset-panel-card-date" size="xs" c="dimmed">
            {formatDate(card.updatedAt)}
          </Text>
          <Group className="asset-panel-card-actions" justify="flex-end" gap={4}>
            {imageUrl && (
              <Tooltip className="asset-panel-card-preview-tooltip" label="预览角色卡" withArrow>
                <ActionIcon
                  className="asset-panel-card-preview-action"
                  size="sm"
                  variant="light"
                  onClick={() => openPreview({ url: imageUrl, kind: 'image', name: `角色卡 · ${roleName}` })}
                >
                  <IconEye className="asset-panel-card-preview-icon" size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            {prompt && (
              <Tooltip className="asset-panel-card-copy-tooltip" label="复制提示词" withArrow>
                <ActionIcon className="asset-panel-card-copy-action" size="sm" variant="subtle" onClick={() => handleCopy(prompt)}>
                  <IconCopy className="asset-panel-card-copy-icon" size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip className="asset-panel-card-add-tooltip" label="加入画布" withArrow>
              <ActionIcon
                className="asset-panel-card-add-action"
                size="sm"
                variant="light"
                onClick={() => {
                  const references = collectRoleCardReferenceImages({
                    cards: roleCardAssets,
                    currentRoleName: roleName,
                    currentImageUrl: imageUrl || '',
                  })
                  const mergedReferences = Array.from(new Set([...selectedStyleReferenceImages, ...references])).slice(0, 12)
                  addNode('taskNode', `角色卡 · ${roleName}`, {
                    kind: 'image',
                    autoLabel: false,
                    prompt: withRoleStylePrefix(
                      prompt ||
                        [
                          `角色卡，角色名：${roleName}`,
                          '背景要求：空白或纯色背景，无场景元素、无文字、无 logo。',
                          '三视图要求：正面/侧面/背面三视图。',
                        ].join('\n'),
                    ),
                    roleId: card.roleId || undefined,
                    roleName,
                    referenceView: 'three_view',
                    anchorBindings: upsertSemanticNodeAnchorBinding({
                      existing: [],
                      next: {
                        kind: 'character',
                        refId: card.cardId || null,
                        entityId: card.roleId || null,
                        label: roleName,
                        sourceBookId: selectedBookId || null,
                        imageUrl: imageUrl || null,
                        referenceView: 'three_view',
                      },
                    }),
                    sourceBookId: selectedBookId || undefined,
                    imageUrl: imageUrl || undefined,
                    imageResults: imageUrl ? [{ url: imageUrl }] : undefined,
                    imagePrimaryIndex: imageUrl ? 0 : undefined,
                    status: imageUrl ? 'success' : undefined,
                    roleCardReferenceImages: mergedReferences,
                    source: 'role_card_library',
                  })
                  setActivePanel(null)
                }}
              >
                <IconPlus className="asset-panel-card-add-icon" size={16} />
              </ActionIcon>
            </Tooltip>
            {status === 'generated' && (
              <Tooltip className="asset-panel-card-confirm-tooltip" label={isConfirmed ? '取消确认' : '确认角色卡'} withArrow>
                <ActionIcon
                  className="asset-panel-card-confirm-action"
                  size="sm"
                  variant={isConfirmed ? 'subtle' : 'light'}
                  color={isConfirmed ? 'gray' : 'green'}
                  disabled={assetConfirming}
                  onClick={() => { void handleToggleRoleCardConfirm(card) }}
                >
                  <IconCircleCheck className="asset-panel-card-confirm-icon" size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip className="asset-panel-card-delete-tooltip" label="删除角色卡" withArrow>
              <ActionIcon
                className="asset-panel-card-delete-action"
                size="sm"
                variant="subtle"
                color="red"
                onClick={() => { void handleDeleteRoleCard(card) }}
              >
                <IconTrash className="asset-panel-card-delete-icon" size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Stack>
      </PanelCard>
    )
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      if (currentProject?.id && selectedBookId) {
        const idx = await getProjectBookIndex(currentProject.id, selectedBookId).catch(() => null)
        if (idx) setSelectedBookIndex(idx)
      }
      await reloadAssets()
      if (currentProject?.id) {
        const list = await listProjectBooks(currentProject.id).catch(() => [])
        setBooks(sortProjectBooksByUpdatedAt(Array.isArray(list) ? list : []))
      }
      if (showExtraAssetTabs && tab === 'workflow') await reloadWorkflowLibrary()
      toast('已刷新项目素材与文本索引', 'success')
    } catch (err: any) {
      toast(err?.message || '刷新失败', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const openProjectMaterialsFullscreen = React.useCallback(() => {
    const projectId = String(currentProject?.id || '').trim()
    if (!projectId) {
      toast('请先选择项目', 'warning')
      return
    }
    setProjectAssetsViewerOpen(true)
  }, [currentProject?.id])

  const openMaterialUpload = React.useCallback(() => {
    if (!currentProject?.id) {
      toast('请先选择项目，再上传项目素材', 'warning')
      return
    }
    if (isBookUploadLocked) {
      toast('当前项目有小说上传任务进行中，请等待完成后再上传', 'warning')
      return
    }
    materialUploadInputRef.current?.click()
  }, [currentProject?.id, isBookUploadLocked])

  const addBookRoleCardsToCanvas = React.useCallback(async (input: {
    projectId: string
    bookId: string
    bookIndex: ProjectBookIndexDto
  }): Promise<{ createdCount: number; nextIndex: ProjectBookIndexDto }> => {
    const roles = listRolesFromBookIndex(input.bookIndex)
    if (!roles.length) {
      throw new Error('全书深度重建完成，但未识别到角色档案')
    }
    const latestMap = new Map<string, RoleCardAssetData>()
    const existingCards = Array.isArray((input.bookIndex as any)?.assets?.roleCards)
      ? (((input.bookIndex as any).assets.roleCards || []) as RoleCardAssetData[])
      : []
    for (const card of existingCards) {
      const roleId = String(card?.roleId || '').trim().toLowerCase()
      const roleName = String(card?.roleName || '').trim().toLowerCase()
      if (roleId && !latestMap.has(`id:${roleId}`)) latestMap.set(`id:${roleId}`, card)
      if (roleName && !latestMap.has(`name:${roleName}`)) latestMap.set(`name:${roleName}`, card)
    }
    const styleBible = ((input.bookIndex as any)?.assets?.styleBible || null) as StyleBibleForCanvas | null
    let createdCount = 0
    let nextIndex = input.bookIndex
    for (const role of roles) {
      const roleName = String(role.name || '').trim()
      if (!roleName) continue
      const roleDesc = String(role.description || '').trim()
      const stage = Array.isArray(role.stageForms) && role.stageForms.length ? role.stageForms[0] : null
      const roleChapter = Array.isArray(role.chapterSpan) && role.chapterSpan.length
        ? Math.trunc(Number(role.chapterSpan[0] || 0)) || undefined
        : undefined
      const roleChapterSpan = Array.isArray(role.chapterSpan)
        ? role.chapterSpan.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0).map((x) => Math.trunc(x))
        : []
      const chapterMetaForPrompt = Array.isArray((input.bookIndex as any)?.chapters)
        ? (((input.bookIndex as any).chapters || []) as any[]).find((ch) => Number(ch?.chapter) === Number(roleChapter))
        : null
      const chapterHint = Number.isFinite(Number(roleChapter)) && Number(roleChapter) > 0
        ? `第${Math.trunc(Number(roleChapter))}章`
        : ''
      const importanceHint = role.importance ? `角色级别：${role.importance}` : ''
      const rolePrompt = buildRoleCardGenerationPrompt({
        roleName,
        roleDescription: roleDesc,
        importance: importanceHint,
        chapterHint,
        styleBible,
        stage: stage
          ? {
              stage: stage.stage,
              look: stage.look,
              costume: stage.costume,
              emotion: stage.emotion,
              props: stage.props || [],
            }
          : null,
        sceneHints: Array.isArray(chapterMetaForPrompt?.scenes)
          ? (chapterMetaForPrompt.scenes as any[]).map((x) => String(x?.name || '').trim()).filter(Boolean)
          : [],
        propHints: Array.isArray(chapterMetaForPrompt?.props)
          ? (chapterMetaForPrompt.props as any[]).map((x) => String(x?.name || '').trim()).filter(Boolean)
          : [],
      })
      const existingCard =
        latestMap.get(`id:${String(role.id || '').trim().toLowerCase()}`) ||
        latestMap.get(`name:${roleName.toLowerCase()}`) ||
        null
      const referenceImages = collectRoleCardReferenceImages({
        cards: existingCards,
        currentRoleName: roleName,
        currentImageUrl: resolveRoleCardExecutableImageUrl(existingCard),
      })
      const mergedReferenceImages = Array.from(new Set([...selectedStyleReferenceImages, ...referenceImages])).slice(0, 12)
      const beforeCount = useRFStore.getState().nodes.length
      addNode('taskNode', `角色设定 · ${roleName}`, {
        kind: 'image',
        autoLabel: false,
        prompt: withRoleStylePrefix(rolePrompt),
        modelKey: 'nano-banana-pro',
        roleCardId: existingCard?.cardId || undefined,
        roleId: role.id || undefined,
        roleName,
        referenceView: 'three_view',
        anchorBindings: upsertSemanticNodeAnchorBinding({
          existing: [],
          next: {
            kind: 'character',
            refId: existingCard?.cardId || null,
            entityId: role.id || null,
            label: roleName,
            sourceBookId: input.bookId,
            imageUrl: resolveRoleCardExecutableImageUrl(existingCard) || null,
            referenceView: 'three_view',
          },
        }),
        roleDescription: roleDesc || undefined,
        sourceBookId: input.bookId,
        imageUrl: resolveRoleCardExecutableImageUrl(existingCard) || undefined,
        imageResults: resolveRoleCardExecutableImageUrl(existingCard) ? [{ url: resolveRoleCardExecutableImageUrl(existingCard) }] : undefined,
        imagePrimaryIndex: resolveRoleCardExecutableImageUrl(existingCard) ? 0 : undefined,
        status: 'running',
        progress: 5,
        roleCardReferenceImages: mergedReferenceImages.length ? mergedReferenceImages : undefined,
        source: 'novel_upload_autoflow',
      })
      const createdNodes = useRFStore.getState().nodes
      const nodeId =
        createdNodes.length > beforeCount
          ? String(createdNodes[createdNodes.length - 1]?.id || '').trim()
          : ''
      if (nodeId) {
        setNodeStatus(nodeId, 'running', { progress: 5 })
        appendLog(nodeId, `[${new Date().toLocaleTimeString()}] 自动角色卡入画布开始`)
      }
      const saved = await upsertProjectBookRoleCard(input.projectId, input.bookId, {
        cardId: existingCard?.cardId || undefined,
        roleId: String(role.id || '').trim() || undefined,
        roleName,
        stateDescription: buildRoleCardStateDescription({
          chapterNo: Number(roleChapter || 0) > 0 ? Math.trunc(Number(roleChapter)) : 1,
          chapterTitle: String(chapterMetaForPrompt?.title || '').trim() || undefined,
          chapterSummary: String(chapterMetaForPrompt?.summary || '').trim() || undefined,
          coreConflict: String(chapterMetaForPrompt?.coreConflict || '').trim() || undefined,
          roleName,
          roleDescription: roleDesc || undefined,
          stagePrompt: stage?.stage ? `角色阶段：${stage.stage}` : undefined,
        }),
        chapter: roleChapter,
        chapterStart: roleChapterSpan.length ? roleChapterSpan[0] : roleChapter,
        chapterEnd: roleChapterSpan.length ? roleChapterSpan[roleChapterSpan.length - 1] : roleChapter,
        chapterSpan: roleChapterSpan.length ? roleChapterSpan : undefined,
        nodeId: nodeId || undefined,
        prompt: withRoleStylePrefix(rolePrompt),
        status: resolveRoleCardExecutableImageUrl(existingCard) ? 'generated' : 'draft',
        modelKey: 'nano-banana-pro',
        imageUrl: resolveRoleCardExecutableImageUrl(existingCard) || undefined,
        ...(resolveRoleCardExecutableImageUrl(existingCard) ? { threeViewImageUrl: resolveRoleCardExecutableImageUrl(existingCard) } : null),
      })
      if (saved?.cardId && nodeId) {
        updateNodeData(nodeId, {
          roleCardId: saved.cardId,
          status: 'success',
          progress: 100,
          anchorBindings: upsertSemanticNodeAnchorBinding({
            existing: (useRFStore.getState().nodes.find((node) => String(node.id || '').trim() === nodeId)?.data as Record<string, unknown> | undefined)?.anchorBindings,
            next: {
              kind: 'character',
              refId: saved.cardId,
              label: roleName,
              sourceBookId: input.bookId,
              referenceView: 'three_view',
            },
          }),
        })
        setNodeStatus(nodeId, 'success', { progress: 100 })
        appendLog(nodeId, `[${new Date().toLocaleTimeString()}] 自动角色卡入画布完成`)
      }
      if (Array.isArray(saved?.roleCards)) {
        nextIndex = {
          ...nextIndex,
          assets: {
            ...(nextIndex.assets || { characters: [] }),
            roleCards: saved.roleCards,
          },
        } as ProjectBookIndexDto
        for (const card of saved.roleCards as RoleCardAssetData[]) {
          const rid = String(card?.roleId || '').trim().toLowerCase()
          const rname = String(card?.roleName || '').trim().toLowerCase()
          if (rid) latestMap.set(`id:${rid}`, card)
          if (rname) latestMap.set(`name:${rname}`, card)
        }
      }
      createdCount += 1
    }
    return { createdCount, nextIndex }
  }, [addNode, appendLog, selectedStyleReferenceImages, setNodeStatus, updateNodeData])

  const handleMaterialUploadInputChange = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0]
    e.currentTarget.value = ''
    if (!file) return
    if (!currentProject?.id) {
      toast('请先选择项目', 'warning')
      return
    }
    setMaterialUploading(true)
    try {
      const result = await uploadProjectText({
        projectId: currentProject.id,
        projectName: currentProject.name,
        file,
        isBookUploadLocked,
        uploadMode: 'auto',
        onChunkProgress: (completed, total) => {
          if (completed % 5 === 0 || completed === total) {
            toast(`分块上传进度：${completed}/${total}`, 'info')
          }
        },
      })
      if (result.mode === 'book') {
        toast('小说上传成功，开始分块上传并进入异步任务队列…', 'info')
        setBookUploadJob(result.job)
        toast('已进入后台队列，正在拆分任务处理小说…', 'info')
        toast('已开始处理小说', 'success')
        await reloadAssets()
        if (currentProject?.id) {
          const list = await listProjectBooks(currentProject.id).catch(() => [])
          setBooks(sortProjectBooksByUpdatedAt(Array.isArray(list) ? list : []))
        }
        return
      }
      toast('已替换当前项目文本', 'success')
      await reloadAssets()
      if (currentProject?.id) {
        const list = await listProjectBooks(currentProject.id).catch(() => [])
        setBooks(sortProjectBooksByUpdatedAt(Array.isArray(list) ? list : []))
      }
    } catch (err: any) {
      toast(err?.message || '素材上传失败', 'error')
    } finally {
      setMaterialUploading(false)
    }
  }, [isBookUploadLocked, currentProject?.id, reloadAssets])

  const handleAddBookChapterToCanvas = React.useCallback(async () => {
    if (!currentProject?.id || !selectedBookId) {
      toast(PROJECT_TEXT_REQUIRED_MESSAGE, 'warning')
      return
    }
    const chapter = Number(selectedBookChapter)
    if (!Number.isFinite(chapter) || chapter <= 0) {
      toast('请选择章节', 'warning')
      return
    }
    try {
      const payload = await getProjectBookChapter(currentProject.id, selectedBookId, Math.trunc(chapter))
      const chapterTitle = payload?.title || `第${Math.trunc(chapter)}章`
      addNode('taskNode', chapterTitle, {
        kind: 'novelDoc',
        autoLabel: false,
        prompt: payload?.content || '',
        textResults: payload?.content ? [{ text: payload.content }] : undefined,
        chapter: Math.trunc(chapter),
        materialChapter: Math.trunc(chapter),
        sourceBookId: selectedBookId,
        chapterSummary: payload?.summary || selectedChapterMeta?.summary || '',
        chapterKeywords: Array.isArray(payload?.keywords) ? payload.keywords : (selectedChapterMeta?.keywords || []),
        chapterAssets: {
          characters: Array.isArray(payload?.characters) ? payload.characters : (selectedChapterMeta?.characters || []),
          props: Array.isArray(payload?.props) ? payload.props : (selectedChapterMeta?.props || []),
          scenes: Array.isArray(payload?.scenes) ? payload.scenes : (selectedChapterMeta?.scenes || []),
          locations: Array.isArray(payload?.locations) ? payload.locations : (selectedChapterMeta?.locations || []),
        },
      })
      setActivePanel(null)
    } catch (err: any) {
      toast(err?.message || '读取章节失败', 'error')
    }
  }, [addNode, currentProject?.id, selectedBookChapter, selectedBookId, selectedChapterMeta, setActivePanel])

  const deriveStyleHintsFromReferenceImage = React.useCallback(async (referenceUrl: string): Promise<{
    styleName?: string
    visualDirectives?: string[]
    consistencyRules?: string[]
    negativeDirectives?: string[]
  } | null> => {
    return deriveStyleHintsFromReferenceImageShared(referenceUrl, publicVisionWithAuth)
  }, [])

  const persistStyleReferenceImage = React.useCallback(async (
    referenceUrl: string,
    sourceLabel?: string,
  ) => {
    if (!currentProject?.id || !selectedBookId) {
      toast(PROJECT_TEXT_REQUIRED_MESSAGE, 'warning')
      return
    }
    const url = String(referenceUrl || '').trim()
    if (!url) {
      toast('未找到可用参考图', 'warning')
      return
    }
    const next = await persistStyleReferenceImageShared({
      projectId: currentProject.id,
      bookId: selectedBookId,
      referenceUrl: url,
      sourceLabel,
      deriveStyleHints: deriveStyleHintsFromReferenceImage,
      confirmProjectBookStyle,
    })
    setSelectedBookIndex(next)
    toast(sourceLabel ? `画风参考图已更新（来自${sourceLabel}）` : '画风参考图已更新', 'success')
    toast('已根据参考图自动提炼风格规则，并应用到角色卡', 'info')
  }, [currentProject?.id, deriveStyleHintsFromReferenceImage, selectedBookId])

  const handleStyleReferenceUploadInputChange = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files || [])
    e.currentTarget.value = ''
    if (!files.length) return
    if (!currentProject?.id || !selectedBookId) {
      toast(PROJECT_TEXT_REQUIRED_MESSAGE, 'warning')
      return
    }
    const imageFile = files.find((file) => String(file.type || '').startsWith('image/'))
    if (!imageFile) {
      toast('请选择图片文件', 'warning')
      return
    }
    setStyleReferenceUploading(true)
    try {
      const uploaded = await uploadServerAssetFile(imageFile, imageFile.name, {
        projectId: currentProject.id,
        taskKind: 'style_reference',
      })
      const url =
        String((uploaded as any)?.data?.url || '').trim()
        || String((uploaded as any)?.data?.imageUrl || '').trim()
        || String((uploaded as any)?.data?.thumbnailUrl || '').trim()
      if (!url) throw new Error('上传成功但未返回可用图片地址')
      await persistStyleReferenceImage(url)
    } catch (err: any) {
      toast(err?.message || '上传画风参考图失败', 'error')
    } finally {
      setStyleReferenceUploading(false)
    }
  }, [currentProject?.id, persistStyleReferenceImage, selectedBookId])


  const handleUseCanvasGeneratedStyleReference = React.useCallback(async () => {
    if (styleReferenceUploading) return
    if (!currentProject?.id || !selectedBookId) {
      toast(PROJECT_TEXT_REQUIRED_MESSAGE, 'warning')
      return
    }
    const candidate = canvasStyleReferenceCandidates[0]
    if (!candidate?.url) {
      toast('画布里还没有可用图片，请先生成一张图', 'warning')
      return
    }
    setStyleReferenceUploading(true)
    try {
      await persistStyleReferenceImage(candidate.url, `画布「${candidate.label}」`)
    } catch (err: any) {
      toast(err?.message || '使用画布图片失败', 'error')
    } finally {
      setStyleReferenceUploading(false)
    }
  }, [
    canvasStyleReferenceCandidates,
    currentProject?.id,
    persistStyleReferenceImage,
    selectedBookId,
    styleReferenceUploading,
  ])


  const syncConfirmedAssetsToCanvas = React.useCallback((input: {
    roleCards: RoleCardAssetData[]
    sceneRefs: VisualRefAssetData[]
  }): { created: number; updated: number } => {
    const bookId = String(selectedBookId || '').trim()
    if (!bookId) return { created: 0, updated: 0 }
    let created = 0
    let updated = 0
    const readNodeData = (node: Node): Record<string, unknown> => {
      const data = node?.data
      return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
    }

    for (const card of input.roleCards) {
      const cardId = String(card?.cardId || '').trim()
      const roleName = String(card?.roleName || '').trim()
      if (!roleName) continue
      const imageUrl = resolveRoleCardExecutableImageUrl(card)
      const prompt = String(card?.prompt || '').trim()
      const references = collectRoleCardReferenceImages({
        cards: roleCardAssets,
        currentRoleName: roleName,
        currentImageUrl: imageUrl,
      })
      const mergedReferences = Array.from(new Set([...selectedStyleReferenceImages, ...references])).slice(0, 12)
      const existingNode = useRFStore.getState().nodes.find((node) => {
        const data = readNodeData(node)
        const semanticRoleBinding = resolveSemanticNodeRoleBinding(data)
        const nodeCardId = String(data.roleCardId || semanticRoleBinding.roleCardId || '').trim()
        if (cardId && nodeCardId === cardId) return true
        const nodeRoleName = String(data.roleName || semanticRoleBinding.roleName || '').trim().toLowerCase()
        const nodeBookId = String(data.sourceBookId || '').trim()
        return !!nodeRoleName && nodeRoleName === roleName.toLowerCase() && nodeBookId === bookId
      })
      const rolePrompt = withRoleStylePrefix(
        prompt || [
          `角色卡，角色名：${roleName}`,
          '背景要求：空白或纯色背景，无场景元素、无文字、无 logo。',
          '三视图要求：正面/侧面/背面三视图。',
        ].join('\n'),
      )
      if (existingNode?.id) {
        updateNodeData(String(existingNode.id), {
          kind: 'image',
          autoLabel: false,
          prompt: rolePrompt,
          modelKey: card?.modelKey || 'nano-banana-pro',
          roleCardId: cardId || undefined,
          roleId: card?.roleId || undefined,
          roleName,
          referenceView: 'three_view',
          anchorBindings: upsertSemanticNodeAnchorBinding({
            existing: readNodeData(existingNode).anchorBindings,
            next: {
              kind: 'character',
              refId: cardId || null,
              entityId: card?.roleId || null,
              label: roleName,
              sourceBookId: bookId,
              imageUrl: imageUrl || null,
              referenceView: 'three_view',
            },
          }),
          sourceBookId: bookId,
          imageUrl: imageUrl || undefined,
          imageResults: imageUrl ? [{ url: imageUrl }] : undefined,
          imagePrimaryIndex: imageUrl ? 0 : undefined,
          status: imageUrl ? 'success' : undefined,
          roleCardReferenceImages: mergedReferences,
          source: 'chapter_assets_confirm',
        })
        updated += 1
        continue
      }
      const beforeIds = new Set(useRFStore.getState().nodes.map((node) => String(node.id || '').trim()))
      addNode('taskNode', `角色卡 · ${roleName}`, {
        kind: 'image',
        autoLabel: false,
        prompt: rolePrompt,
        modelKey: card?.modelKey || 'nano-banana-pro',
        roleCardId: cardId || undefined,
        roleId: card?.roleId || undefined,
        roleName,
        referenceView: 'three_view',
        anchorBindings: upsertSemanticNodeAnchorBinding({
          existing: [],
          next: {
            kind: 'character',
            refId: cardId || null,
            entityId: card?.roleId || null,
            label: roleName,
            sourceBookId: bookId,
            imageUrl: imageUrl || null,
            referenceView: 'three_view',
          },
        }),
        sourceBookId: bookId,
        imageUrl: imageUrl || undefined,
        imageResults: imageUrl ? [{ url: imageUrl }] : undefined,
        imagePrimaryIndex: imageUrl ? 0 : undefined,
        status: imageUrl ? 'success' : undefined,
        roleCardReferenceImages: mergedReferences,
        source: 'chapter_assets_confirm',
      })
      const createdNode = useRFStore
        .getState()
        .nodes
        .find((node) => !beforeIds.has(String(node.id || '').trim()))
      if (createdNode?.id) created += 1
    }

    for (const ref of input.sceneRefs) {
      const refId = String(ref?.refId || '').trim()
      const refName = String(ref?.name || '').trim() || refId
      if (!refId) continue
      const imageUrl = String(ref?.imageUrl || '').trim()
      const existingNode = useRFStore.getState().nodes.find((node) => {
        const data = readNodeData(node)
        const semanticVisualBinding = resolveSemanticNodeVisualReferenceBinding(data)
        const nodeRefId = String(data.scenePropRefId || data.visualRefId || semanticVisualBinding.refId || '').trim()
        if (nodeRefId && nodeRefId === refId) return true
        const nodeName = String(data.scenePropRefName || data.visualRefName || semanticVisualBinding.refName || '').trim().toLowerCase()
        const nodeBookId = String(data.sourceBookId || '').trim()
        return !!nodeName && nodeName === refName.toLowerCase() && nodeBookId === bookId
      })
      const chapterStart = Math.max(1, Math.trunc(Number(ref?.chapterStart || ref?.chapter || 1)))
      const chapterEnd = Math.max(chapterStart, Math.trunc(Number(ref?.chapterEnd || ref?.chapter || chapterStart)))
      const scenePrompt = [
        `场景/道具参考图，名称：${refName}`,
        `章节范围：${chapterStart}-${chapterEnd}章`,
        '要求：保持构图与主要视觉元素稳定，适合作为后续视觉生成的场景锚点。',
      ].join('\n')
      if (existingNode?.id) {
        updateNodeData(String(existingNode.id), {
          kind: 'image',
          autoLabel: false,
          prompt: scenePrompt,
          modelKey: String(ref?.modelKey || '').trim() || 'nano-banana-pro',
          sourceBookId: bookId,
          scenePropRefId: refId,
          scenePropRefName: refName,
          visualRefId: refId,
          visualRefName: refName,
          visualRefCategory: ref.category,
          anchorBindings: upsertSemanticNodeAnchorBinding({
            existing: readNodeData(existingNode).anchorBindings,
            next: {
              kind: 'scene',
              refId,
              label: refName,
              sourceBookId: bookId,
              imageUrl: imageUrl || null,
              category: ref.category || 'scene_prop',
            },
            replaceKinds: ['scene', 'prop'],
          }),
          imageUrl: imageUrl || undefined,
          imageResults: imageUrl ? [{ url: imageUrl }] : undefined,
          imagePrimaryIndex: imageUrl ? 0 : undefined,
          status: imageUrl ? 'success' : undefined,
          source: 'chapter_assets_confirm',
        })
        updated += 1
        continue
      }
      const beforeIds = new Set(useRFStore.getState().nodes.map((node) => String(node.id || '').trim()))
      addNode('taskNode', `场景参考 · ${refName}`, {
        kind: 'image',
        autoLabel: false,
        prompt: scenePrompt,
        modelKey: String(ref?.modelKey || '').trim() || 'nano-banana-pro',
        sourceBookId: bookId,
        scenePropRefId: refId,
        scenePropRefName: refName,
        visualRefId: refId,
        visualRefName: refName,
        visualRefCategory: ref.category,
        anchorBindings: upsertSemanticNodeAnchorBinding({
          existing: [],
          next: {
            kind: 'scene',
            refId,
            label: refName,
            sourceBookId: bookId,
            imageUrl: imageUrl || null,
            category: ref.category || 'scene_prop',
          },
          replaceKinds: ['scene', 'prop'],
        }),
        imageUrl: imageUrl || undefined,
        imageResults: imageUrl ? [{ url: imageUrl }] : undefined,
        imagePrimaryIndex: imageUrl ? 0 : undefined,
        status: imageUrl ? 'success' : undefined,
        source: 'chapter_assets_confirm',
      })
      const createdNode = useRFStore
        .getState()
        .nodes
        .find((node) => !beforeIds.has(String(node.id || '').trim()))
      if (createdNode?.id) created += 1
    }

    return { created, updated }
  }, [addNode, roleCardAssets, selectedBookId, selectedStyleReferenceImages, updateNodeData])

  const handleToggleRoleCardConfirm = React.useCallback(async (card: RoleCardAssetData) => {
    if (!ensureActiveBookForMutation() || !selectedBookIndex) {
      return
    }
    const projectId = String(currentProject?.id || '').trim()
    if (!projectId) return
    const cardId = String(card?.cardId || '').trim()
    if (!cardId) {
      toast('角色卡ID缺失，无法确认', 'error')
      return
    }
    if (assetConfirming) return
    const nextConfirmed = !hasConfirmedTimestamp(card?.confirmedAt)
    setAssetConfirming(true)
    try {
      const result = await confirmProjectBookRoleCard(projectId, selectedBookId, cardId, { confirmed: nextConfirmed })
      const nextRoleCards = Array.isArray(result?.roleCards) ? result.roleCards : []
      const syncStats = nextConfirmed
        ? syncConfirmedAssetsToCanvas({ roleCards: [card], sceneRefs: [] })
        : { created: 0, updated: 0 }
      setSelectedBookIndex((prev) => {
        if (!prev || !prev.assets) return prev
        return {
          ...prev,
          assets: {
            ...prev.assets,
            roleCards: nextRoleCards,
          },
        }
      })
      const syncMsg =
        nextConfirmed && (syncStats.created > 0 || syncStats.updated > 0)
          ? `，已同步到画布（新增 ${syncStats.created}，更新 ${syncStats.updated}）`
          : ''
      toast(nextConfirmed ? `角色卡已确认${syncMsg}` : '角色卡已取消确认', 'success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '角色卡确认失败'
      toast(msg, 'error')
    } finally {
      setAssetConfirming(false)
    }
  }, [assetConfirming, currentProject?.id, ensureActiveBookForMutation, selectedBookId, selectedBookIndex, syncConfirmedAssetsToCanvas])

  const handleRebuildCharacterGraphByAi = React.useCallback(async () => {
    if (!currentProject?.id || !selectedBookId) {
      toast(PROJECT_TEXT_REQUIRED_MESSAGE, 'warning')
      return
    }
    if (graphRebuilding) return
    setGraphRebuilding(true)
    try {
      const isChapterMetadataComplete = (chapter: any): boolean => {
        const title = String(chapter?.title || '').trim()
        const summary = String(chapter?.summary || '').trim()
        const coreConflict = String(chapter?.coreConflict || '').trim()
        return (
          !!title &&
          !!summary &&
          !!coreConflict &&
          Array.isArray(chapter?.keywords) &&
          chapter.keywords.length > 0 &&
          Array.isArray(chapter?.characters) &&
          Array.isArray(chapter?.props) &&
          Array.isArray(chapter?.scenes) &&
          Array.isArray(chapter?.locations)
        )
      }
      let idx = selectedBookIndex || (await getProjectBookIndex(currentProject.id, selectedBookId).catch(() => null))
      if (!idx) throw new Error('读取项目文本索引失败，请重试')
      let chapters = Array.isArray((idx as any)?.chapters) ? ((idx as any).chapters as any[]) : []
      if (!chapters.length) throw new Error('小说章节为空，无法完善角色关系')
      const selectedChapterNo = Math.max(1, Math.trunc(Number(selectedBookChapter || 1)))
      const selectedChapter = chapters.find((chapter) => Number((chapter as any)?.chapter) === selectedChapterNo) || null
      const firstIncomplete = chapters.find((chapter) => !isChapterMetadataComplete(chapter)) || null
      const targetChapter = selectedChapter && !isChapterMetadataComplete(selectedChapter)
        ? selectedChapter
        : firstIncomplete
      if (!targetChapter) {
        toast('章节元数据已完善，无需继续处理', 'success')
        const latest = await getProjectBookIndex(currentProject.id, selectedBookId).catch(() => null)
        if (latest) setSelectedBookIndex(latest)
        return
      }
      const chapterNo = Math.max(1, Math.trunc(Number((targetChapter as any).chapter || 1)))
      await ensureProjectBookMetadataWindow(currentProject.id, selectedBookId, {
        chapter: chapterNo,
        mode: 'standard',
        windowSize: 1,
      })
      const latest = await getProjectBookIndex(currentProject.id, selectedBookId).catch(() => null)
      if (latest) setSelectedBookIndex(latest)
      toast(`已完善第${chapterNo}章元数据与角色关系`, 'success')
    } catch (err: unknown) {
      const errorCode = typeof err === 'object' && err && 'code' in err && typeof err.code === 'string'
        ? err.code
        : ''
      const message = err instanceof Error ? err.message : ''
      if (errorCode === 'BOOK_METADATA_ENSURE_WINDOW_BUSY') {
        toast('当前项目文本已有完善任务在执行，请稍候再试', 'info')
      } else {
        toast(message || '完善角色关系失败', 'error')
      }
    } finally {
      setGraphRebuilding(false)
    }
  }, [currentProject?.id, graphRebuilding, selectedBookChapter, selectedBookId, selectedBookIndex])

  const handleDeleteBook = React.useCallback(async () => {
    if (!currentProject?.id || !selectedBookId) {
      toast(PROJECT_TEXT_REQUIRED_MESSAGE, 'warning')
      return
    }
    const selected = books.find((b) => b.bookId === selectedBookId)
    const title = selected?.title || selectedBookId
    if (!window.confirm(`确定删除当前文本「${title}」吗？会同时删除该文本的索引与关系网。`)) return
    try {
      await deleteProjectBook(currentProject.id, selectedBookId)
      const latest = await listProjectBooks(currentProject.id).catch(() => [])
      const nextBooks = sortProjectBooksByUpdatedAt((Array.isArray(latest) ? latest : []).filter((b) => b.bookId !== selectedBookId))
      setBooks(nextBooks)
      const nextId = pickPrimaryProjectBook(nextBooks)?.bookId || ''
      setSelectedBookId(nextId)
      if (!nextId) setSelectedBookIndex(null)
      else {
        const idx = await getProjectBookIndex(currentProject.id, nextId).catch(() => null)
        setSelectedBookIndex(idx)
      }
      if ((Array.isArray(latest) ? latest : []).some((b) => b.bookId === selectedBookId)) {
        toast('删除请求已提交，但服务端列表仍包含当前文本，请稍后刷新重试', 'warning')
      } else {
        toast('当前文本已删除', 'success')
      }
      await reloadAssets()
    } catch (err: any) {
      toast(err?.message || '删除当前文本失败', 'error')
    }
  }, [currentProject?.id, reloadAssets, selectedBookId])

  const handleDeleteRoleCard = React.useCallback(async (card: RoleCardAssetData) => {
    if (!currentProject?.id) {
      toast('请先选择项目', 'warning')
      return
    }
    const roleName = String(card?.roleName || '').trim() || card.cardId
    if (!window.confirm(`确定删除角色卡「${roleName}」吗？`)) return
    try {
      const projectId = String(currentProject.id || '').trim()
      const targetAssetId = String(card?.assetId || '').trim()
      const targetCardId = String(card?.cardId || '').trim()
      const canDeleteBookCard = !!(selectedBookId && targetCardId && bookRoleCards.some((item) => String(item?.cardId || '').trim() === targetCardId))
      if (!targetAssetId && !canDeleteBookCard) {
        throw new Error('角色卡既没有项目资产ID，也没有书籍角色卡ID，无法删除')
      }
      if (canDeleteBookCard) {
        const result = await deleteProjectBookRoleCard(projectId, selectedBookId, targetCardId)
        const nextRoleCards = Array.isArray(result?.roleCards) ? result.roleCards : []
        setSelectedBookIndex((prev) => {
          if (!prev || !prev.assets) return prev
          return {
            ...prev,
            assets: {
              ...prev.assets,
              roleCards: nextRoleCards,
            },
          }
        })
      }
      if (targetAssetId) {
        await deleteServerAsset(targetAssetId)
        setProjectRoleCardAssets((prev) =>
          (Array.isArray(prev) ? prev : []).filter((item) => String(item?.assetId || '').trim() !== targetAssetId),
        )
        setAssets((prev) =>
          (Array.isArray(prev) ? prev : []).filter((item) => String(item?.id || '').trim() !== targetAssetId),
        )
      }
      await reloadAssets()
      toast('角色卡已删除', 'success')
    } catch (err: any) {
      toast(err?.message || '删除角色卡失败', 'error')
    }
  }, [bookRoleCards, currentProject?.id, reloadAssets, selectedBookId])

  const handleGenerateRoleCards = React.useCallback(async () => {
    if (!currentProject?.id || !selectedBookId || !selectedBookIndex) {
      toast(PROJECT_TEXT_REQUIRED_MESSAGE, 'warning')
      return
    }
    if (!selectedStyleReferenceImages.length) {
      toast('请先上传至少 1 张风格参考图，再生成角色卡', 'warning')
      return
    }
    if (roleCardGenerating) return
    const roles = availableCharacterPool
    if (!roles.length) {
      toast('当前没有可用角色元数据（请先上传并解析项目文本）', 'warning')
      return
    }
    const maxCount = 12
    const targets = roles.slice(0, maxCount)
    const scope = selectedChapterMeta?.chapter ? `第${selectedChapterMeta.chapter}章` : '全书'
    if (!window.confirm(`将为${scope}生成 ${targets.length} 个角色图像节点，继续吗？`)) {
      return
    }
    setRoleCardGenerating(true)
    try {
      const chapterHint = selectedChapterMeta?.chapter ? `第${selectedChapterMeta.chapter}章` : ''
      for (const role of targets) {
        const roleName = String(role.name || '').trim()
        if (!roleName) continue
        const roleDesc = String(role.description || '').trim()
        const stageForms = Array.isArray(role.stageForms) ? role.stageForms : []
        const chapterNo = Number(selectedChapterMeta?.chapter || 0)
        const matchedStage = stageForms.find((s) => {
          const hints = Array.isArray(s?.chapterHints) ? s.chapterHints : []
          return Number.isFinite(chapterNo) && chapterNo > 0 && hints.includes(Math.trunc(chapterNo))
        }) || stageForms[0] || null
        const chapterFromSelection = Number(selectedChapterMeta?.chapter || 0)
        const chapterForRoleCard = Number.isFinite(chapterFromSelection) && chapterFromSelection > 0
          ? Math.trunc(chapterFromSelection)
          : (Array.isArray(role.chapterSpan) && role.chapterSpan.length
              ? Math.trunc(Number(role.chapterSpan[0] || 0)) || undefined
              : undefined)
        const chapterMetaForPrompt = Array.isArray((selectedBookIndex as any)?.chapters)
          ? (((selectedBookIndex as any).chapters || []) as any[]).find((ch) => Number(ch?.chapter) === Number(chapterForRoleCard || chapterFromSelection))
          : null
        const importanceHint = role.importance ? `角色级别：${role.importance}` : ''
        const rolePrompt = buildRoleCardGenerationPrompt({
          roleName,
          roleDescription: roleDesc,
          importance: importanceHint,
          chapterHint: chapterHint || (chapterForRoleCard ? `第${chapterForRoleCard}章` : ''),
          styleBible: selectedStyleBible || null,
          stage: matchedStage
            ? {
                stage: matchedStage.stage,
                look: matchedStage.look,
                costume: matchedStage.costume,
                emotion: matchedStage.emotion,
                props: matchedStage.props || [],
              }
            : null,
          sceneHints: Array.isArray(chapterMetaForPrompt?.scenes)
            ? (chapterMetaForPrompt.scenes as any[]).map((x) => String(x?.name || '').trim()).filter(Boolean)
            : [],
          propHints: Array.isArray(chapterMetaForPrompt?.props)
            ? (chapterMetaForPrompt.props as any[]).map((x) => String(x?.name || '').trim()).filter(Boolean)
            : [],
        })
        const existingCard =
          latestRoleCardMap.get(`id:${String(role.id || '').trim().toLowerCase()}`) ||
          latestRoleCardMap.get(`name:${roleName.toLowerCase()}`) ||
          null
        const knownCards = Array.isArray((selectedBookIndex as any)?.assets?.roleCards)
          ? (((selectedBookIndex as any).assets.roleCards || []) as RoleCardAssetData[])
          : []
        const referenceImages = collectRoleCardReferenceImages({
          cards: knownCards,
          currentRoleName: roleName,
          currentImageUrl: resolveRoleCardExecutableImageUrl(existingCard),
        })
        const mergedReferenceImages = Array.from(new Set([...selectedStyleReferenceImages, ...referenceImages])).slice(0, 12)
        const beforeCount = useRFStore.getState().nodes.length
        addNode('taskNode', `角色设定 · ${roleName}`, {
          kind: 'image',
          autoLabel: false,
          prompt: withRoleStylePrefix(rolePrompt),
          modelKey: 'nano-banana-pro',
          roleCardId: existingCard?.cardId || undefined,
          roleId: role.id || undefined,
          roleName,
          referenceView: 'three_view',
          anchorBindings: upsertSemanticNodeAnchorBinding({
            existing: [],
            next: {
              kind: 'character',
              refId: existingCard?.cardId || null,
              entityId: role.id || null,
              label: roleName,
              sourceBookId: selectedBookId,
              imageUrl: resolveRoleCardExecutableImageUrl(existingCard) || null,
              referenceView: 'three_view',
            },
          }),
          roleDescription: roleDesc || undefined,
          sourceBookId: selectedBookId,
          imageUrl: resolveRoleCardExecutableImageUrl(existingCard) || undefined,
          imageResults: resolveRoleCardExecutableImageUrl(existingCard) ? [{ url: resolveRoleCardExecutableImageUrl(existingCard) }] : undefined,
          imagePrimaryIndex: resolveRoleCardExecutableImageUrl(existingCard) ? 0 : undefined,
          status: resolveRoleCardExecutableImageUrl(existingCard) ? 'success' : undefined,
          roleCardReferenceImages: mergedReferenceImages.length ? mergedReferenceImages : undefined,
          chapter: selectedChapterMeta?.chapter ?? null,
          materialChapter: selectedChapterMeta?.chapter ?? null,
          source: 'novel_character_meta',
        })
        const createdNodes = useRFStore.getState().nodes
        const nodeId =
          createdNodes.length > beforeCount
            ? String(createdNodes[createdNodes.length - 1]?.id || '').trim()
            : ''
        const saved = await upsertProjectBookRoleCard(currentProject.id, selectedBookId, {
          cardId: existingCard?.cardId || undefined,
          roleId: String(role.id || '').trim() || undefined,
          roleName,
          stateDescription: buildRoleCardStateDescription({
            chapterNo: Number(chapterForRoleCard || chapterFromSelection || 0) > 0
              ? Math.trunc(Number(chapterForRoleCard || chapterFromSelection))
              : 1,
            chapterTitle: String(chapterMetaForPrompt?.title || '').trim() || undefined,
            chapterSummary: String(chapterMetaForPrompt?.summary || '').trim() || undefined,
            coreConflict: String(chapterMetaForPrompt?.coreConflict || '').trim() || undefined,
            roleName,
            roleDescription: roleDesc || undefined,
            stagePrompt: matchedStage?.stage ? `角色阶段：${matchedStage.stage}` : undefined,
          }),
          chapter: chapterForRoleCard,
          chapterStart: Array.isArray(role.chapterSpan) && role.chapterSpan.length
            ? Math.trunc(Number(role.chapterSpan[0] || 0)) || chapterForRoleCard
            : chapterForRoleCard,
          chapterEnd: Array.isArray(role.chapterSpan) && role.chapterSpan.length
            ? Math.trunc(Number(role.chapterSpan[role.chapterSpan.length - 1] || 0)) || chapterForRoleCard
            : chapterForRoleCard,
          chapterSpan: Array.isArray(role.chapterSpan) && role.chapterSpan.length
            ? role.chapterSpan.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0).map((x) => Math.trunc(x))
            : undefined,
          nodeId: nodeId || undefined,
          prompt: withRoleStylePrefix(rolePrompt),
          status: 'draft',
          modelKey: 'nano-banana-pro',
          ...(resolveRoleCardExecutableImageUrl(existingCard) ? { threeViewImageUrl: resolveRoleCardExecutableImageUrl(existingCard) } : null),
        }).catch(() => null)
        if (saved?.cardId && nodeId) {
          updateNodeData(nodeId, {
            roleCardId: saved.cardId,
            anchorBindings: upsertSemanticNodeAnchorBinding({
              existing: (useRFStore.getState().nodes.find((node) => String(node.id || '').trim() === nodeId)?.data as Record<string, unknown> | undefined)?.anchorBindings,
              next: {
                kind: 'character',
                refId: saved.cardId,
                label: roleName,
                sourceBookId: selectedBookId,
                referenceView: 'three_view',
              },
            }),
          })
        }
        if (saved?.roleCards) {
          setSelectedBookIndex((prev) => {
            if (!prev || !prev.assets) return prev
            return {
              ...prev,
              assets: {
                ...prev.assets,
                roleCards: saved.roleCards || [],
              },
            }
          })
        }
      }
      setActivePanel(null)
      toast(`已创建 ${targets.length} 个角色图像节点`, 'success')
    } finally {
      setRoleCardGenerating(false)
    }
  }, [addNode, availableCharacterPool, currentProject?.id, latestRoleCardMap, roleCardGenerating, selectedBookId, selectedBookIndex, selectedChapterMeta, selectedStyleBible, selectedStyleReferenceImages, setActivePanel, updateNodeData])

  return (
    <div className="asset-panel-anchor" style={{ top: anchorY ? anchorY - 150 : 140 }} data-ux-panel>
      <Transition className="asset-panel-transition" mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="asset-panel-transition-inner" style={styles}>
            <PanelCard
              className="glass asset-panel-shell"
              style={{ maxHeight: `${maxHeight}px`, height: `${maxHeight}px`, display:'flex' }}
              onWheelCapture={stopPanelWheelPropagation}
              data-ux-panel
            >
              <div className="asset-panel-arrow panel-arrow" />
              <Group className="asset-panel-header" justify="space-between" mb={8}>
                <Title className="asset-panel-title" order={6}>我的资产</Title>
                <Group className="asset-panel-header-actions" gap="xs">
                  <Tooltip className="asset-panel-fullscreen-tooltip" label="弹窗查看当前项目素材" withArrow>
                    <ActionIcon
                      className="asset-panel-fullscreen-action"
                      size="sm"
                      variant="subtle"
                      aria-label="弹窗查看当前项目素材"
                      onClick={openProjectMaterialsFullscreen}
                    >
                      <IconPlayerPlay className="asset-panel-fullscreen-icon" size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip className="asset-panel-refresh-tooltip" label="刷新" withArrow>
                    <ActionIcon className="asset-panel-refresh-action" size="sm" variant="light" onClick={handleRefresh} loading={refreshing || loading}>
                      <IconRefresh className="asset-panel-refresh-icon" size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Button className="asset-panel-close" size="xs" variant="subtle" onClick={() => setActivePanel(null)}>
                    关闭
                  </Button>
                </Group>
              </Group>
              <div className="asset-panel-body" ref={bodyScrollRef} onScroll={handleScroll}>
                <input
                  className="asset-panel-upload-input asset-panel-hidden-input"
                  ref={materialUploadInputRef}
                  type="file"
                  accept=".txt,.md,.markdown,.json"
                  onChange={handleMaterialUploadInputChange}
                />
                <Tabs className="asset-panel-tabs" value={tab} onChange={(v) => setTab((v as any) || 'materials')}>
                  <Tabs.List className="asset-panel-tab-list">
                    <Tabs.Tab className="asset-panel-tab" value="materials">项目素材</Tabs.Tab>
                    {showExtraAssetTabs ? <Tabs.Tab className="asset-panel-tab" value="generated">生成内容</Tabs.Tab> : null}
                    {showExtraAssetTabs ? <Tabs.Tab className="asset-panel-tab" value="workflow">工作流片段</Tabs.Tab> : null}
                  </Tabs.List>
                  <Tabs.Panel className="asset-panel-tab-panel" value="materials" pt="xs">
                    <Stack className="asset-panel-section" gap="sm">
                      <Text className="asset-panel-section-desc" size="sm" c="dimmed">
                        {currentProject?.id
                          ? `当前项目素材：${currentProject.name || currentProject.id}`
                          : '当前显示全部项目素材（建议先选择项目）'}
                      </Text>
                      {isBookUploadLocked ? (
                        <Text className="asset-panel-book-upload-status" size="xs" c="yellow">
                          小说任务进行中（{bookUploadJob?.status === 'queued' ? '排队中' : '处理中'}）
                          {typeof bookUploadJob?.progress?.percent === 'number' ? ` ${bookUploadJob.progress.percent}%` : ''}
                          {typeof bookUploadJob?.progress?.processedChapters === 'number' && typeof bookUploadJob?.progress?.totalChapters === 'number'
                            ? `（章节 ${bookUploadJob.progress.processedChapters}/${bookUploadJob.progress.totalChapters}）`
                            : ''}
                          {bookUploadJob?.progress?.message ? ` ${bookUploadJob.progress.message}` : ''}
                          ，当前项目暂不可再次上传
                        </Text>
                      ) : null}
                      <Group className="asset-panel-material-actions" gap="xs" wrap="wrap">
                        <Button
                          className="asset-panel-material-upload-text"
                          size="xs"
                          variant="light"
                          leftSection={<IconUpload size={14} />}
                          loading={materialUploading}
                          disabled={materialUploading || isBookUploadLocked}
                          onClick={() => openMaterialUpload()}
                        >
                          {currentProjectTextActionLabel}
                        </Button>
                        <Button
                          className="asset-panel-material-workbench-entry"
                          size="xs"
                          variant="default"
                          leftSection={<IconLayoutGrid size={14} />}
                          disabled={!hasCurrentProjectText}
                          onClick={() => setActivePanel('nanoComic')}
                        >
                          工作台
                        </Button>
                        <SegmentedControl
                          className="asset-panel-material-chapter-filter"
                          size="xs"
                          value={materialChapterFilter}
                          onChange={setMaterialChapterFilter}
                          data={[
                            { value: 'all', label: '全部章节' },
                            ...materialChapterOptions.slice(0, 6).map((c) => ({ value: String(c), label: `第${c}章` })),
                          ]}
                        />
                        <SegmentedControl
                          className="asset-panel-material-category-filter"
                          size="xs"
                          value={materialCategory}
                          onChange={(v) => setMaterialCategory((v as any) || 'roleCards')}
                          data={[
                            { value: 'roleCards', label: '角色卡' },
                            { value: 'docs', label: '文档素材' },
                            { value: 'all', label: '全部' },
                          ]}
                        />
                        <input
                          className="asset-panel-material-role-search asset-panel-native-input asset-panel-native-control asset-panel-native-control--180"
                          value={roleCardKeyword}
                          onChange={(e) => setRoleCardKeyword(e.currentTarget.value)}
                          placeholder="筛选角色卡：角色名"
                        />
                        <Button
                          className="asset-panel-ai-character-library-trigger"
                          size="xs"
                          variant="default"
                          leftSection={<IconPhoto size={14} />}
                          onClick={() => setAiCharacterLibraryOpened(true)}
                        >
                          AI角色库
                        </Button>
                      </Group>
                      <Group className="asset-panel-book-actions" gap="xs" wrap="wrap" align="flex-end">
                        <Text
                          className="asset-panel-book-summary"
                          size="sm"
                          c="dimmed"
                          maw={240}
                          lineClamp={1}
                          title={activeBook ? `${activeBook.title || '未命名文本'} · ${activeBook.chapterCount}章` : '未上传'}
                        >
                          {activeBook
                            ? `当前文本：${activeBook.title || '未命名文本'} · ${activeBook.chapterCount}章`
                            : '当前文本：未上传'}
                        </Text>
                        <Button
                          className="asset-panel-book-delete"
                          size="xs"
                          variant="light"
                          color="red"
                          disabled={!activeBook?.bookId || graphRebuilding}
                          onClick={() => {
                            void handleDeleteBook()
                          }}
                        >
                          删除当前文本
                        </Button>
                      </Group>
                      <Group className="asset-panel-book-filter-row" gap="xs" wrap="wrap" align="center">
                        <select
                          className="asset-panel-book-filter-type asset-panel-native-select asset-panel-native-control asset-panel-native-control--140"
                          value={bookFilterType}
                          onChange={(e) => setBookFilterType((e.currentTarget.value as any) || 'all')}
                          disabled={!selectedBookIndex}
                        >
                          <option value="all">筛章：全部</option>
                          <option value="characters">按角色筛章</option>
                          <option value="props">按道具筛章</option>
                          <option value="scenes">按场景筛章</option>
                          <option value="locations">按地点筛章</option>
                          <option value="keywords">按关键词筛章</option>
                        </select>
                        <select
                          className="asset-panel-book-filter-keyword asset-panel-native-select asset-panel-native-control asset-panel-native-control--180"
                          value={bookFilterKeyword}
                          onChange={(e) => setBookFilterKeyword(e.currentTarget.value)}
                          disabled={!selectedBookIndex || bookFilterType === 'all'}
                        >
                          <option value="">选择关键字</option>
                          {bookQuickFilterOptions.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                        <input
                          className="asset-panel-book-filter-input asset-panel-native-input asset-panel-native-control asset-panel-native-control--180"
                          value={bookFilterKeyword}
                          onChange={(e) => setBookFilterKeyword(e.currentTarget.value)}
                          disabled={!selectedBookIndex || bookFilterType === 'all'}
                          placeholder="可直接输入关键词模糊筛章"
                        />
                        <Text className="asset-panel-book-filter-summary" size="xs" c="dimmed">
                          匹配范围：{filteredBookChapters.length}/{selectedBookIndex?.chapters?.length || 0}
                        </Text>
                        <Text className="asset-panel-book-role-summary" size="xs" c="dimmed">
                          角色数：{availableCharacterPool.length}
                        </Text>
                        <Text className="asset-panel-book-role-card-summary" size="xs" c="dimmed">
                          已登记角色卡：{bookRoleCards.length}
                        </Text>
                      </Group>
                      {!!selectedBookIndex && (
                        <Stack className="asset-panel-style-lock-config" gap={6} ref={styleReferenceSectionRef}>
                          <Text className="asset-panel-style-lock-title" size="xs" fw={700}>
                            风格参考图（必填）
                          </Text>
                          <Group className="asset-panel-style-lock-controls" gap="xs" wrap="wrap" align="center">
                            <Button
                              className="asset-panel-style-reference-upload-trigger"
                              size="xs"
                              variant="light"
                              leftSection={<IconUpload size={14} />}
                              loading={styleReferenceUploading}
                              disabled={!selectedBookId || !selectedBookIndex}
                              onClick={() => {
                                styleReferenceUploadInputRef.current?.click()
                              }}
                            >
                              {selectedStyleReferenceImages[0] ? '替换参考图' : '上传参考图'}
                            </Button>
                            <Button
                              className="asset-panel-style-reference-use-canvas-trigger"
                              size="xs"
                              variant="subtle"
                              leftSection={<IconPhoto size={14} />}
                              loading={styleReferenceUploading}
                              disabled={!selectedBookId || !selectedBookIndex || !canvasStyleReferenceCandidates.length}
                              onClick={() => {
                                void handleUseCanvasGeneratedStyleReference()
                              }}
                            >
                              使用画布最近图
                            </Button>
                            <input
                              className="asset-panel-hidden-input"
                              ref={styleReferenceUploadInputRef}
                              type="file"
                              accept="image/*"
                              onChange={handleStyleReferenceUploadInputChange}
                            />
                          </Group>
                          <Text className="asset-panel-style-reference-canvas-hint" size="xs" c="dimmed">
                            画布可用图片：{canvasStyleReferenceCandidates.length}（点击“使用画布最近图”一键设为风格参考）
                          </Text>
                          <Text className="asset-panel-style-reference-summary" size="xs" c="dimmed">
                            已上传：{selectedStyleReferenceImages.length}/1
                          </Text>
                          <Group className="asset-panel-style-reference-list" gap="xs" wrap="wrap">
                            {(() => {
                              const url = selectedStyleReferenceImages[0] || ''
                              return (
                                <div className="asset-panel-style-reference-card asset-panel-style-reference-card--single">
                                  <Stack gap={6}>
                                    {url ? (
                                      <Image className="asset-panel-style-reference-image" src={url} h={72} radius="xs" fit="cover" />
                                    ) : (
                                      <Center className="asset-panel-style-reference-empty" h={72}>
                                        <Text size="xs" c="dimmed">空</Text>
                                      </Center>
                                    )}
                                  </Stack>
                                </div>
                              )
                            })()}
                          </Group>
                        </Stack>
                      )}
                      {!!selectedBookIndex && (
                        <Group className="asset-panel-book-graph-preview-row" gap="xs" align="center">
                          <Button
                            className="asset-panel-book-graph-3d"
                            size="xs"
                            variant="light"
                            disabled={!graphNodes.length}
                            onClick={() => {
                              setGraph3DOpened(true)
                            }}
                          >
                            关系网 3D预览
                          </Button>
                          <Text className="asset-panel-book-graph-preview-summary" size="xs" c="dimmed">
                            全书节点 {graphNodes.length} · 全书关系 {graphEdges.length} · 目标范围可见 {filteredGraphNodes.length}
                          </Text>
                        </Group>
                      )}
                      {!!selectedBookIndex && showGraphMaintenancePanel && (
                        <Stack className="asset-panel-book-graph-editor" gap={6}>
                          <Group className="asset-panel-book-graph-header" gap="xs" justify="space-between">
                            <Text className="asset-panel-book-graph-title" size="xs" fw={700}>
                              角色关系网（AI 自动维护）
                            </Text>
                            <Group className="asset-panel-book-graph-header-actions" gap="xs">
                              <Button
                                className="asset-panel-book-graph-rebuild"
                                size="xs"
                                variant="light"
                                loading={graphRebuilding}
                                disabled={!selectedBookId || chapterMetadataProgress.done}
                                onClick={() => {
                                  void handleRebuildCharacterGraphByAi()
                                }}
                              >
                                {chapterMetadataProgress.done
                                  ? '角色关系已完善'
                                  : chapterMetadataProgress.nextWindowStart && chapterMetadataProgress.nextWindowEnd
                                    ? `自动完善角色关系（从${chapterMetadataProgress.nextWindowStart}-${chapterMetadataProgress.nextWindowEnd}开始）`
                                    : '自动完善角色关系'}
                              </Button>
                              <Button
                                className="asset-panel-book-graph-3d"
                                size="xs"
                                variant="light"
                                disabled={!graphNodes.length}
                                onClick={() => {
                                  setGraph3DOpened(true)
                                }}
                              >
                                3D预览
                              </Button>
                            </Group>
                          </Group>
                          <Text className="asset-panel-book-graph-desc" size="xs" c="dimmed">
                            点击一次会自动连续处理后续 100 章窗口（如 1-100、101-200），直到全书完成或遇到错误。
                          </Text>
                          <Text className="asset-panel-book-graph-progress" size="xs" c="dimmed">
                            章节元数据进度：{chapterMetadataProgress.complete}/{chapterMetadataProgress.total}
                            {chapterMetadataProgress.nextWindowStart && chapterMetadataProgress.nextWindowEnd
                              ? ` · 下一段 ${chapterMetadataProgress.nextWindowStart}-${chapterMetadataProgress.nextWindowEnd}`
                              : ''}
                          </Text>
                          <Group className="asset-panel-book-graph-toolbar" gap="xs" wrap="wrap" align="center">
                            <Text className="asset-panel-book-graph-toolbar-summary" size="xs" c="dimmed">
                              全书节点 {graphNodes.length} · 全书关系 {graphEdges.length} · 目标范围可见 {filteredGraphNodes.length}
                            </Text>
                          </Group>
                        </Stack>
                      )}
                      {!!selectedChapterMeta && (
                        <Stack className="asset-panel-book-meta" gap={4}>
                          <Text className="asset-panel-book-meta-title" size="xs" fw={600}>
                            第{selectedChapterMeta.chapter}章 · {selectedChapterMeta.title}
                          </Text>
                          {!!selectedChapterMeta.summary && (
                            <Text className="asset-panel-book-meta-summary" size="xs" c="dimmed" lineClamp={3}>
                              {selectedChapterMeta.summary}
                            </Text>
                          )}
                          {!!selectedChapterMeta.keywords?.length && (
                            <Text className="asset-panel-book-meta-keywords" size="xs" c="dimmed" lineClamp={2}>
                              关键词：{selectedChapterMeta.keywords.join('、')}
                            </Text>
                          )}
                          {!!selectedChapterMeta.characters?.length && (
                            <Text className="asset-panel-book-meta-characters" size="xs" c="dimmed" lineClamp={2}>
                              角色：{selectedChapterMeta.characters.map((x) => x.name).join('、')}
                            </Text>
                          )}
                          {!!selectedChapterMeta.props?.length && (
                            <Text className="asset-panel-book-meta-props" size="xs" c="dimmed" lineClamp={2}>
                              道具：{selectedChapterMeta.props.map((x) => x.name).join('、')}
                            </Text>
                          )}
                          {!!selectedChapterMeta.scenes?.length && (
                            <Text className="asset-panel-book-meta-scenes" size="xs" c="dimmed" lineClamp={2}>
                              场景：{selectedChapterMeta.scenes.map((x) => x.name).join('、')}
                            </Text>
                          )}
                        </Stack>
                      )}
                      {loading ? (
                        <Center className="asset-panel-loading" py="md">
                          <Group className="asset-panel-loading-group" gap="xs">
                            <Loader className="asset-panel-loading-icon" size="sm" />
                            <Text className="asset-panel-loading-text" size="xs" c="dimmed">
                              加载中…
                            </Text>
                          </Group>
                        </Center>
                      ) : materialCategory === 'roleCards' ? (
                        filteredRoleCardAssets.length === 0 ? (
                          <Text className="asset-panel-empty" size="xs" c="dimmed">
                            暂无角色卡素材
                          </Text>
                        ) : (
                          <SimpleGrid className="asset-panel-grid asset-panel-role-card-grid" cols={{ base: 1, sm: 2, xl: 3 }} spacing="sm">
                            {renderLazyGridItems({
                              items: filteredRoleCardAssets,
                              rootRef: bodyScrollRef,
                              placeholderHeight: 208,
                              keyFor: (card) => card.cardId,
                              renderItem: renderRoleCard,
                            })}
                          </SimpleGrid>
                        )
                      ) : materialCategory === 'docs' ? (
                        filteredProjectMaterialAssets.length === 0 ? (
                          <Text className="asset-panel-empty" size="xs" c="dimmed">
                            暂无文档素材
                          </Text>
                        ) : (
                          <SimpleGrid className="asset-panel-grid" cols={{ base: 1, sm: 2 }} spacing="sm">
                            {renderLazyGridItems({
                              items: filteredProjectMaterialAssets,
                              rootRef: bodyScrollRef,
                              placeholderHeight: 220,
                              keyFor: (asset) => asset.id,
                              renderItem: renderMaterialCard,
                            })}
                          </SimpleGrid>
                        )
                      ) : (filteredRoleCardAssets.length + filteredProjectMaterialAssets.length) === 0 ? (
                        <Text className="asset-panel-empty" size="xs" c="dimmed">
                          暂无项目素材
                        </Text>
                      ) : (
                        <SimpleGrid className="asset-panel-grid asset-panel-role-card-grid" cols={{ base: 1, sm: 2, xl: 3 }} spacing="sm">
                          {renderLazyGridItems({
                            items: filteredRoleCardAssets,
                            rootRef: bodyScrollRef,
                            placeholderHeight: 208,
                            keyFor: (card) => `role:${card.cardId}`,
                            renderItem: renderRoleCard,
                          })}
                          {renderLazyGridItems({
                            items: filteredProjectMaterialAssets,
                            rootRef: bodyScrollRef,
                            placeholderHeight: 220,
                            keyFor: (asset) => `material:${asset.id}`,
                            renderItem: renderMaterialCard,
                          })}
                        </SimpleGrid>
                      )}
                    </Stack>
                  </Tabs.Panel>
                  {showExtraAssetTabs ? (
                  <Tabs.Panel className="asset-panel-tab-panel" value="generated" pt="xs">
                    <Stack className="asset-panel-section" gap="sm">
                      <Group className="asset-panel-section-header" justify="space-between" align="center" wrap="wrap" gap="xs">
                        <Text className="asset-panel-section-desc" size="sm" c="dimmed">
                          已自动保存的生成结果（默认显示视频，可切换图片）
                        </Text>
                        <Group className="asset-panel-generated-toolbar" gap="xs" wrap="wrap" justify="flex-end">
                          <TextInput
                            className="asset-panel-search"
                            size="sm"
                            radius="md"
                            leftSection={<IconSearch size={14} />}
                            placeholder="搜索：名称 / vendor / model / url"
                            value={assetQuery}
                            onChange={(e) => setAssetQuery(e.currentTarget.value)}
                          />
                          <Select
                            className="asset-panel-sort"
                            size="sm"
                            radius="md"
                            leftSection={<IconSortDescending size={14} />}
                            data={[
                              { value: 'updated_desc', label: '按更新时间（新->旧）' },
                              { value: 'created_desc', label: '按创建时间（新->旧）' },
                              { value: 'name_asc', label: '按名称（A->Z）' },
                            ]}
                            value={assetSort}
                            onChange={(v) => setAssetSort((v as any) || 'updated_desc')}
                            allowDeselect={false}
                          />
                          <SegmentedControl
                            className="asset-panel-filter"
                            size="sm"
                            radius="sm"
                            variant="filled"
                            color={isDark ? 'blue' : 'dark'}
                            value={mediaFilter}
                            onChange={(v) => setMediaFilter(v as any)}
                            data={[
                              { value: 'video', label: '视频' },
                              { value: 'image', label: '图片' },
                              { value: 'all', label: '全部' },
                            ]}
                          />
                        </Group>
                      </Group>
                      {loading ? (
                        <Center className="asset-panel-loading" py="md">
                          <Group className="asset-panel-loading-group" gap="xs">
                            <Loader className="asset-panel-loading-icon" size="sm" />
                            <Text className="asset-panel-loading-text" size="xs" c="dimmed">
                              加载中…
                            </Text>
                          </Group>
                        </Center>
                      ) : filteredGenerationAssets.length === 0 ? (
                        <Text className="asset-panel-empty" size="xs" c="dimmed">
                          暂无生成内容
                        </Text>
                      ) : (
                        <SimpleGrid className="asset-panel-grid" cols={{ base: 1, sm: 2 }} spacing="sm">
                          {renderLazyGridItems({
                            items: visibleGenerationAssets,
                            rootRef: bodyScrollRef,
                            placeholderHeight: 316,
                            keyFor: (asset) => asset.id,
                            renderItem: renderGenerationCard,
                          })}
                        </SimpleGrid>
                      )}
                    </Stack>
                  </Tabs.Panel>
                  ) : null}
                  {showExtraAssetTabs ? (
                  <Tabs.Panel className="asset-panel-tab-panel" value="workflow" pt="xs">
                    <Stack className="asset-panel-section" gap="sm">
                      <Text className="asset-panel-section-desc" size="sm" c="dimmed">
                        个人工作流资产（跨项目可复用）
                      </Text>
                      {workflowLibraryLoading ? (
                        <Center className="asset-panel-loading" py="md">
                          <Group className="asset-panel-loading-group" gap="xs">
                            <Loader className="asset-panel-loading-icon" size="sm" />
                            <Text className="asset-panel-loading-text" size="xs" c="dimmed">
                              加载中…
                            </Text>
                          </Group>
                        </Center>
                      ) : workflowAssets.length === 0 ? (
                        <Text className="asset-panel-empty" size="xs" c="dimmed">
                          暂无工作流片段
                        </Text>
                      ) : (
                        <SimpleGrid className="asset-panel-grid" cols={{ base: 1, sm: 2 }} spacing="sm">
                          {renderLazyGridItems({
                            items: workflowAssets,
                            rootRef: bodyScrollRef,
                            placeholderHeight: 286,
                            keyFor: (asset) => asset.id,
                            renderItem: renderWorkflowCard,
                          })}
                        </SimpleGrid>
                      )}
                    </Stack>
                  </Tabs.Panel>
                  ) : null}
                </Tabs>
              </div>
            </PanelCard>
          </div>
        )}
      </Transition>
      <Modal
        className="asset-panel-book-graph-3d-modal"
        opened={graph3DOpened}
        onClose={() => setGraph3DOpened(false)}
        title={`角色关系网 3D 预览${typeof graphPreviewChapterNo === 'number' ? ` · 第${graphPreviewChapterNo}章` : ''}`}
        size="xl"
        centered
      >
        <CharacterGraph3D
          nodes={graphNodes}
          edges={graphEdges}
          isDark={isDark}
          currentChapter={graphPreviewChapterNo}
        />
      </Modal>
      <ProjectAssetsViewer
        opened={projectAssetsViewerOpen}
        projectId={String(currentProject?.id || '').trim()}
        projectName={String(currentProject?.name || '').trim()}
        onClose={() => setProjectAssetsViewerOpen(false)}
      />
      <AiCharacterLibraryModal
        opened={aiCharacterLibraryOpened}
        onClose={() => setAiCharacterLibraryOpened(false)}
        onApplyToCanvas={handleApplyAiCharacterLibraryToCanvas}
      />
    </div>
  )
}
