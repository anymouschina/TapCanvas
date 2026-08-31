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
  Badge,
  Modal,
  useMantineColorScheme,
  Select,
  TextInput,
  Divider,
  Skeleton,
  Box,
  Paper,
  Menu,
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
  IconMusic,
  IconUpload,
  IconEye,
  IconSearch,
  IconSortDescending,
  IconFolderOpen,
  IconX,
  IconFileText,
  IconFileUpload,
  IconDots,
  IconArrowRight,
} from '@tabler/icons-react'
import { useRFStore } from '../canvas/store'
import { hostedAssetUrl } from '../config/objectStorageAssets'
import { useProjectImageSettingsStore } from '../canvas/projectImageSettingsStore'
import { loadChaptersAsGroups } from '../canvas/chapterGroupImport'
import {
  useUIStore,
  type AssetPanelFocusRequest,
} from './uiStore'
import { ASSET_REFRESH_EVENT } from './assetEvents'
import { bottomBarPanelStyle, bottomBarSafeMaxHeight } from './utils/panelPosition'
import { toast } from './toast'
import { PanelCard } from './PanelCard'
import {
  confirmProjectBookStyle,
  createProjectChapter,
  createAgentPipelineRun,
  deleteMaterialAsset,
  deleteProjectBook,
  deleteServerAsset,
  executeAgentPipelineRun,
  ensureProjectBookMetadataWindow,
  getProjectBookChapter,
  getProjectBookIndex,
  getProjectBookUploadJob,
  getLatestProjectBookUploadJob,
  listLlmNodePresets,
  listMaterialAssets,
  listProjectBooks,
  listProjectChapters,
  listServerAssets,
  renameServerAsset,
  publicVisionWithAuth,
  updateChapter,
  updateMaterialAsset,
  uploadServerAssetFile,
  type ChapterDto,
  type LlmNodePresetDto,
  type MaterialAssetDto,
  type ProjectBookIndexDto,
  type ProjectBookListItemDto,
  type ProjectBookUploadJobDto,
  type ServerAssetDto,
} from '../api/server'
import { extractFirstFrame } from './videoThumb'
import { setTapImageDragData } from '../canvas/dnd/setTapImageDragData'
import { CharacterGraph3D } from './utils/CharacterGraph3D'
import { getNodeAbsPosition, getNodeSize } from '../canvas/utils/nodeBounds'
import { upsertSemanticNodeAnchorBinding } from '../canvas/utils/semanticBindings'
import { runNodeRemote } from '../runner/remoteRunner'
import ProjectAssetsViewer from '../projects/ProjectAssetsViewer'
import { syncProjectChaptersFromPrimaryBook } from '../projects/projectChapterBootstrap'
import { pickPrimaryProjectBook, sortProjectBooksByUpdatedAt } from './projectBooks'
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
import {
  STYLE_REFERENCE_BASE_LIMIT,
  STYLE_REFERENCE_CATEGORY_OPTIONS,
  STYLE_REFERENCE_SOURCE_OPTIONS,
  STYLE_REFERENCE_USER_LIMIT,
  filterStyleReferencePresets,
  getPrimaryStyleReferenceCategoryLabel,
  inheritBaseStyleReferencesForUserPresets,
  type StyleReferenceCategoryKey,
  type StyleReferenceSourceFilter,
} from './styleReferenceFacets'
import { stopPanelWheelPropagation } from './utils/panelWheel'
import { buildProjectChapterCanvasUrl } from '../utils/appRoutes'
import { spaNavigate } from '../utils/spaNavigate'
import styles from '../styles.css'
import { ManagedImage } from '../domain/resource-runtime'
import { StatePanel } from './StatePanel'
import { useScopedProjectResource } from './useScopedProjectResource'
import {
  ManualChapterEditor,
  type ManualChapterDraftInput,
} from './chapter/ManualChapterEditor'
import { dispatchChapterMetaUpdate } from '../projects/chapterMetaEvents'

type GenerationAssetData = {
  kind?: string
  type?: 'image' | 'video' | 'audio'
  url?: string
  thumbnailUrl?: string | null
  prompt?: string | null
  vendor?: string | null
  taskKind?: string | null
  modelKey?: string | null
  durationSec?: number | null
}

type ProjectMaterialAssetData = {
  kind?: 'novelDoc' | 'scriptDoc'
  content?: string
  prompt?: string | null
  chapter?: number | null
  source?: string
}
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

const loadSortedProjectBooks = async (projectId: string): Promise<ProjectBookListItemDto[]> => (
  sortProjectBooksByUpdatedAt(await listProjectBooks(projectId))
)

function PlaceholderImage({ label }: { label: string }) {
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'
  const start = isDark ? '#1d1d20' : '#cfd8e3'
  const end = isDark ? '#0b0b0d' : '#f6f7f8'
  const textColor = isDark ? '#e5e7eb' : '#131316'
  const svg = encodeURIComponent(
    `<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0%' stop-color='${start}'/><stop offset='100%' stop-color='${end}'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><text x='50%' y='50%' fill='${textColor}' dominant-baseline='middle' text-anchor='middle' font-size='16' font-family='system-ui'>${label}</text></svg>`,
  )
  return <Image className="asset-panel-placeholder" src={`data:image/svg+xml;charset=UTF-8,${svg}`} alt={label} radius="sm" />
}

function getGenerationData(asset: ServerAssetDto): GenerationAssetData {
  const data = asset.data && typeof asset.data === 'object' && !Array.isArray(asset.data)
    ? asset.data as Record<string, unknown>
    : {}
  const rawType = typeof data.type === 'string' ? data.type.toLowerCase() : ''
  const type = rawType === 'image' || rawType === 'video' || rawType === 'audio' ? rawType : undefined
  return {
    kind: typeof data.kind === 'string' ? data.kind : undefined,
    type: type === 'image' || type === 'video' ? type : undefined,
    url: typeof data.url === 'string' ? data.url : undefined,
    thumbnailUrl: typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : null,
    prompt: typeof data.prompt === 'string' ? data.prompt : undefined,
    vendor: typeof data.vendor === 'string' ? data.vendor : undefined,
    taskKind: typeof data.taskKind === 'string' ? data.taskKind : undefined,
    modelKey: typeof data.modelKey === 'string' ? data.modelKey : undefined,
    durationSec: typeof data.durationSec === 'number' && Number.isFinite(data.durationSec) ? data.durationSec : null,
  }
}

function isGenerationAsset(asset: ServerAssetDto): boolean {
  const data = getGenerationData(asset)
  return !!data.url && (
    data.type === 'image' || data.type === 'video' || data.type === 'audio' || data.kind === 'generation'
  )
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

const ASSET_FULLSCREEN_ICON_URL = hostedAssetUrl('ui/icons/asset-fullscreen-icon-v2-20260511.png')

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

export default function AssetPanel({ variant = 'floating' }: { variant?: 'floating' | 'drawer' | 'catalog' } = {}): JSX.Element | null {
  // catalog = 抽屉「目录」tab：仅复用章节列表与上传文本用于切章。
  const isCatalog = variant === 'catalog'
  const isDrawer = variant === 'drawer' || variant === 'catalog'
  const active = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const assetManagerOpen = useUIStore((s) => s.assetManagerOpen)
  const assetManagerTab = useUIStore((s) => s.assetManagerTab)
  const closeAssetManager = useUIStore((s) => s.closeAssetManager)
  const setActiveStyleBible = useUIStore((s) => s.setActiveStyleBible)
  const activeStyleBible = useUIStore((s) => s.activeStyleBible)
  const seedLockedStyleIfEmpty = useProjectImageSettingsStore((s) => s.seedLockedStyleIfEmpty)
  const currentProject = useUIStore((s) => s.currentProject)
  const anchorX = useUIStore((s) => s.panelAnchorX)
  const openPreview = useUIStore((s) => s.openPreview)
  const preferredTab = useUIStore((s) => s.assetPanelTab)
  const setPreferredTab = useUIStore((s) => s.setAssetPanelTab)
  const preferredMaterialCategory = useUIStore((s) => s.assetPanelMaterialCategory)
  const setPreferredMaterialCategory = useUIStore((s) => s.setAssetPanelMaterialCategory)
  const assetPanelFocusRequest = useUIStore((s) => s.assetPanelFocusRequest)
  const clearAssetPanelFocusRequest = useUIStore((s) => s.clearAssetPanelFocusRequest)
  const styleReferenceRequest = useUIStore((s) => s.styleReferenceRequest)
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'
  const addNode = useRFStore((s) => s.addNode)
  const addNodesAsGroup = useRFStore((s) => s.addNodesAsGroup)
  const deleteNode = useRFStore((s) => s.deleteNode)
  const updateNodeData = useRFStore((s) => s.updateNodeData)
  const arrangeGroupChildren = useRFStore((s) => s.arrangeGroupChildren)
  const setNodeStatus = useRFStore((s) => s.setNodeStatus)
  const appendLog = useRFStore((s) => s.appendLog)
  const canvasNodes = useRFStore((s) => s.nodes)
  const mounted = isCatalog
    ? (assetManagerOpen && assetManagerTab === 'catalog')
    : variant === 'drawer'
      ? (assetManagerOpen && assetManagerTab === 'assets')
      : active === 'assets'
  const [assets, setAssets] = React.useState<ServerAssetDto[]>([])
  const [assetCursor, setAssetCursor] = React.useState<string | null>(null)
  const [hasMoreAssets, setHasMoreAssets] = React.useState(true)
  const [tab, setTab] = React.useState<'generated' | 'materials'>(preferredTab as 'generated' | 'materials')
  const [mediaFilter, setMediaFilter] = React.useState<'all' | 'image' | 'video' | 'audio'>('video')
  const [loading, setLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [visibleGenerationCount, setVisibleGenerationCount] = React.useState(10)
  const [materialChapterFilter, setMaterialChapterFilter] = React.useState<string>('all')
  const [materialCategory, setMaterialCategory] = React.useState<'docs' | 'texts' | 'all'>(preferredMaterialCategory as 'docs' | 'texts' | 'all')
  const [textAssets, setTextAssets] = React.useState<MaterialAssetDto[]>([])
  const [textAssetsLoading, setTextAssetsLoading] = React.useState(false)
  const [textAssetRenaming, setTextAssetRenaming] = React.useState<string | null>(null)
  const [textAssetRenameValue, setTextAssetRenameValue] = React.useState('')
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
  const projectId = String(currentProject?.id || '').trim() || null
  const {
    items: books,
    status: booksStatus,
    loading: bookLoading,
    error: booksError,
    reload: reloadBooks,
    setItems: setBooks,
  } = useScopedProjectResource<ProjectBookListItemDto>({
    enabled: mounted,
    projectId,
    load: loadSortedProjectBooks,
    invalidResponseMessage: '书籍目录响应结构无效',
  })
  const [selectedBookId, setSelectedBookId] = React.useState<string>('')
  const [selectedBookIndex, setSelectedBookIndex] = React.useState<ProjectBookIndexDto | null>(null)
  const [selectedBookChapter, setSelectedBookChapter] = React.useState<string>('1')
  const [bookFilterType, setBookFilterType] = React.useState<'all' | 'characters' | 'props' | 'scenes' | 'locations' | 'keywords'>('all')
  const [bookFilterKeyword, setBookFilterKeyword] = React.useState<string>('')
  const [chapterResyncing, setChapterResyncing] = React.useState(false)
  const [styleReferenceUploading, setStyleReferenceUploading] = React.useState(false)
  const [styleReferencePickerOpen, setStyleReferencePickerOpen] = React.useState(false)
  const [styleReferencePickerAssets, setStyleReferencePickerAssets] = React.useState<LlmNodePresetDto[]>([])
  const [styleReferencePickerQuery, setStyleReferencePickerQuery] = React.useState('')
  const [styleReferencePickerCategory, setStyleReferencePickerCategory] = React.useState<StyleReferenceCategoryKey>('all')
  const [styleReferencePickerSource, setStyleReferencePickerSource] = React.useState<StyleReferenceSourceFilter>('all')
  const [styleReferencePickerLoading, setStyleReferencePickerLoading] = React.useState(false)
  const [graphRebuilding, setGraphRebuilding] = React.useState(false)
  const [graph3DOpened, setGraph3DOpened] = React.useState(false)
  const [projectAssetsViewerOpen, setProjectAssetsViewerOpen] = React.useState(false)
  const {
    items: chapters,
    loading: chaptersLoading,
    error: chaptersError,
    reload: reloadChapters,
  } = useScopedProjectResource<ChapterDto>({
    enabled: mounted,
    projectId,
    load: listProjectChapters,
    invalidResponseMessage: '章节目录响应结构无效',
  })
  const [chapterQuery, setChapterQuery] = React.useState('')
  const [manualChapterEditor, setManualChapterEditor] = React.useState<
    | { mode: 'create'; identity: string }
    | { mode: 'edit'; identity: string; chapter: ChapterDto }
    | null
  >(null)
  const [manualChapterSaving, setManualChapterSaving] = React.useState(false)
  // 当前所在章节（章节画布页设置）：URL 不匹配时的高亮 + 滚动定位兜底。
  const currentChapterId = useUIStore((s) => s.currentChapter?.chapterId ?? null)
  const [activeChapterId, setActiveChapterId] = React.useState<string | null>(null)
  const chapterListRef = React.useRef<HTMLDivElement>(null)
  const [generatedThumbs, setGeneratedThumbs] = React.useState<Record<string, string | null>>({})
  const thumbStatusRef = React.useRef<Record<string, 'pending' | 'running' | 'done'>>({})
  const activeThumbJobsRef = React.useRef(0)
  const showGraphMaintenancePanel = false
  const showExtraAssetTabs = false

  const PAGE_SIZE = 10
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

  React.useEffect(() => {
    setManualChapterEditor(null)
    setManualChapterSaving(false)
  }, [projectId])

  const reloadAssets = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await listServerAssets({
        limit: PAGE_SIZE,
        projectId: currentProject?.id || undefined,
      })
      setAssets(data.items || [])
      setAssetCursor(data.cursor ?? null)
      setHasMoreAssets(Boolean(data.cursor))
    } catch (err: unknown) {
      console.error(err)
      toast(err instanceof Error ? err.message : '加载资产失败', 'error')
      setAssets([])
      setAssetCursor(null)
      setHasMoreAssets(false)
    } finally {
      setLoading(false)
    }
  }, [currentProject?.id])

  const reloadTextAssets = React.useCallback(async () => {
    if (!currentProject?.id) { setTextAssets([]); return }
    setTextAssetsLoading(true)
    try {
      const items = await listMaterialAssets({ kind: 'text' })
      setTextAssets(Array.isArray(items) ? items : [])
    } catch {
      setTextAssets([])
    } finally {
      setTextAssetsLoading(false)
    }
  }, [currentProject?.id])

  React.useEffect(() => {
    if (materialCategory === 'texts') void reloadTextAssets()
  }, [materialCategory, reloadTextAssets])

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
        setSelectedBookId(bookId)
        const [idx] = await Promise.all([
          getProjectBookIndex(currentProject.id!, bookId).catch(() => null),
          reloadBooks(),
          reloadChapters(),
        ])
        if (idx) setSelectedBookIndex(idx)
        await reloadAssets()
      } catch {
        // ignore follow-up refresh failure
      }
    })()
  }, [bookUploadJob, currentProject?.id, mounted, reloadAssets, reloadBooks, reloadChapters])

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
    // 目录 tab 只渲染章节列表（走 listProjectChapters），不展示 selectedBookIndex 的实体索引，
    // 而该索引往往数百 KB，切到目录时无谓拉取。仅在完整素材管理器（非 catalog）里加载。
    if (isCatalog) {
      setSelectedBookIndex(null)
      return
    }
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
  }, [mounted, currentProject?.id, selectedBookId, isCatalog])

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
    // 目录 tab 不展示资产列表，无需按视口高度自动翻页（否则会多打好几次 assets?cursor）。
    if (isCatalog) return
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
  }, [mounted, assets.length, hasMoreAssets, loading, tab, mediaFilter, loadMoreAssets, isCatalog])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      if (!mounted) return
      reloadAssets().catch(() => {})
    }
    window.addEventListener(ASSET_REFRESH_EVENT, handler)
    return () => window.removeEventListener(ASSET_REFRESH_EVENT, handler)
  }, [mounted, reloadAssets])

  React.useEffect(() => {
    if (!mounted) return
    const read = () => {
      try {
        const match = /^\/projects\/[^/]+\/chapters\/([^/?#]+)(?:\/|$|\?|#)/.exec(
          typeof window !== 'undefined' ? window.location.pathname : '',
        )
        setActiveChapterId(match ? decodeURIComponent(match[1]) : null)
      } catch {
        setActiveChapterId(null)
      }
    }
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [mounted])

  const filteredChapters = React.useMemo(() => {
    const q = chapterQuery.trim().toLowerCase()
    if (!q) return chapters
    return chapters.filter((ch) => {
      const title = String(ch.title || '').toLowerCase()
      const idx = String(ch.index ?? '')
      return title.includes(q) || idx === q || idx.startsWith(q)
    })
  }, [chapters, chapterQuery])

  // URL 优先，回退到 store 的当前章节，保证章节画布页能高亮/定位到正在编辑的章节。
  const resolvedActiveChapterId = activeChapterId || currentChapterId

  React.useEffect(() => {
    if (!mounted || !resolvedActiveChapterId || chapters.length === 0 || chapterQuery) return
    // rAF 等列表渲染完成再定位（打开「目录」tab 时列表才挂载，否则旧逻辑早已跑过抓不到 DOM）。
    const raf = requestAnimationFrame(() => {
      const listEl = chapterListRef.current
      if (!listEl) return
      const activeEl = listEl.querySelector('[data-chapter-active="true"]') as HTMLElement | null
      if (!activeEl) return
      // catalog 模式下列表本身不可滚动（maxHeight 未限定），真正滚动的是外层 body 容器；
      // inline 模式则是列表自身。用 getBoundingClientRect 计算增量，兼容两种滚动容器。
      const scrollEl = (isCatalog ? bodyScrollRef.current : listEl) ?? listEl
      const scrollRect = scrollEl.getBoundingClientRect()
      const activeRect = activeEl.getBoundingClientRect()
      // 居中显示当前章节
      const delta = (activeRect.top - scrollRect.top) - (scrollEl.clientHeight / 2 - activeEl.clientHeight / 2)
      scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + delta)
    })
    return () => cancelAnimationFrame(raf)
  }, [mounted, resolvedActiveChapterId, chapters, chapterQuery, filteredChapters])

  const generationAssets = React.useMemo(() => assets.filter(isGenerationAsset), [assets])
  const currentProjectTextAsset = React.useMemo(() => pickCurrentProjectTextAsset(assets), [assets])
  const projectMaterialAssets = React.useMemo(
    () => (currentProjectTextAsset ? [currentProjectTextAsset] : []),
    [currentProjectTextAsset],
  )
  const activeBook = React.useMemo(
    () => books.find((item) => item.bookId === selectedBookId) || pickPrimaryProjectBook(books),
    [books, selectedBookId],
  )
  const currentProjectTextActionLabel = '导入书籍'
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
  const selectedChapterMeta = React.useMemo(() => {
    const chapter = Number(selectedBookChapter)
    if (!selectedBookIndex || !Number.isFinite(chapter) || chapter <= 0) return null
    return (selectedBookIndex.chapters || []).find((it) => it.chapter === Math.trunc(chapter)) || null
  }, [selectedBookChapter, selectedBookIndex])
  const availableCharacterPool = React.useMemo(
    () => buildAvailableCharacterPool({ selectedBookIndex, selectedChapterMeta }),
    [selectedBookIndex, selectedChapterMeta],
  )
  const selectedStyleBible = React.useMemo(() => {
    const data = (selectedBookIndex as any)?.assets?.styleBible
    if (!data || typeof data !== 'object') return null
    return data as StyleBibleForCanvas
  }, [selectedBookIndex])
  const selectedStyleReferenceImages = React.useMemo(() => {
    const source = selectedStyleBible ?? activeStyleBible
    const input = Array.isArray(source?.referenceImages) ? source.referenceImages : []
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
  }, [activeStyleBible, selectedStyleBible])
  const canvasStyleReferenceCandidates = React.useMemo(
    () => listCanvasStyleReferenceCandidates(canvasNodes),
    [canvasNodes],
  )
  const visibleStyleReferencePickerAssets = React.useMemo(
    () => filterStyleReferencePresets({
      presets: styleReferencePickerAssets,
      source: styleReferencePickerSource,
      category: styleReferencePickerCategory,
      query: styleReferencePickerQuery,
    }),
    [
      styleReferencePickerAssets,
      styleReferencePickerCategory,
      styleReferencePickerQuery,
      styleReferencePickerSource,
    ],
  )

  // Sync active style bible to uiStore so intent context builder can include it as globalStyleGuide.
  // activeStyleBible 严格从当前所选书的服务端 styleBible 派生（不再读写 localStorage）：
  // - 有参考图：写入 activeStyleBible，供 AI 生成作为全局画风。
  // - 无参考图 / 未选书 / 切换到新建空白项目：清空，确保「新增项目不继承」上个项目的参考图。
  // 依赖 currentProject?.id，使切换到无 styleBible 的新项目时也能触发清空。
  // 书/章 styleBible 作为项目「初始全局风格」种子：仅当项目尚无锁定风格时本地播种到 lockedStyle，
  // 之后由顶部工具栏 GlobalStyleChip 派生出 activeStyleBible（单一真相源）。用户在 chip 里改过即以用户为准。
  React.useEffect(() => {
    const pid = String(currentProject?.id || '').trim()
    if (!pid) return
    const refs = Array.isArray(selectedStyleBible?.referenceImages)
      ? selectedStyleBible.referenceImages.map((u) => String(u || '').trim()).filter(Boolean)
      : []
    if (selectedStyleBible && refs.length) {
      seedLockedStyleIfEmpty(pid, {
        styleId: `book:${selectedStyleBible.styleName || 'style'}`,
        styleName: selectedStyleBible.styleName || '已锁定风格',
        referenceImageUrl: refs[0],
        stylePrompt: '',
      })
    }
  }, [currentProject?.id, selectedStyleBible, seedLockedStyleIfEmpty])

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

  const maxHeight = isDrawer
    ? (typeof window !== 'undefined' ? window.innerHeight - 120 : 640)
    : bottomBarSafeMaxHeight()
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
    mediaType: 'image' | 'video' | 'audio'
    assetId: string
    data: ReturnType<typeof getGenerationData>
  }) => {
    const { label, mediaType, assetId, data } = input
    const isVideo = mediaType === 'video'
    const isAudio = mediaType === 'audio'
    return {
      kind: mediaType,
      autoLabel: false,
      prompt: data.prompt || '',
      assetId,
      serverAssetId: assetId,
      imageUrl: mediaType === 'image' ? data.url : undefined,
      videoUrl: isVideo ? data.url : undefined,
      audioUrl: isAudio ? data.url : undefined,
      videoThumbnailUrl: isVideo ? data.thumbnailUrl || undefined : undefined,
      imageResults: mediaType === 'image' && data.url ? [{ url: data.url, assetId }] : undefined,
      videoResults: isVideo && data.url ? [{ url: data.url, assetId, thumbnailUrl: data.thumbnailUrl || undefined }] : undefined,
      audioResults: isAudio && data.url ? [{ url: data.url, assetId, duration: data.durationSec || undefined }] : undefined,
      audioDurationSec: isAudio ? data.durationSec || undefined : undefined,
      modelKey: data.modelKey,
      source: data.vendor || 'asset',
    }
  }

  const renderGenerationMedia = (input: {
    mediaType: 'image' | 'video' | 'audio'
    data: ReturnType<typeof getGenerationData>
    cover: string | null
    label: string
  }) => {
    const { mediaType, data, cover, label } = input
    if (mediaType === 'video') {
      if (!data.url) return <PlaceholderImage label="视频" />
      return (
        <div className="asset-panel-card-media">
          <video
            className="asset-panel-card-video"
            src={data.url}
            poster={cover || undefined}
            crossOrigin="anonymous"
            controls
            playsInline
          />
        </div>
      )
    }
    if (mediaType === 'audio') {
      if (!data.url) return <PlaceholderImage label="音频" />
      return (
        <div className="asset-panel-card-media asset-panel-card-audio-shell">
          <IconMusic className="asset-panel-card-audio-icon" size={32} />
          <audio className="asset-panel-card-audio" src={data.url} controls preload="metadata" />
        </div>
      )
    }
    if (cover) {
      return (
        <ManagedImage
          className="asset-panel-card-image"
          src={cover}
          alt={label}
          draggable
          onDragStart={(evt) => setTapImageDragData(evt, cover)}
        />
      )
    }
    return <PlaceholderImage label={label} />
  }

  const renderGenerationCardActions = (input: {
    asset: ServerAssetDto
    data: ReturnType<typeof getGenerationData>
    mediaType: 'image' | 'video' | 'audio'
    label: string
  }) => {
    const { asset, data, mediaType, label } = input
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
              openPreview({ url: data.url, kind: mediaType, name: asset.name })
            }}
          >
            {mediaType === 'video'
              ? <IconPlayerPlay className="asset-panel-card-preview-icon" size={16} />
              : mediaType === 'audio'
                ? <IconMusic className="asset-panel-card-preview-icon" size={16} />
                : <IconPhoto className="asset-panel-card-preview-icon" size={16} />}
          </ActionIcon>
        </Tooltip>
        {hasUrl && (
          <Tooltip className="asset-panel-card-add-tooltip" label="加入画布" withArrow>
            <ActionIcon
              className="asset-panel-card-add-action"
              size="sm"
              variant="light"
              onClick={() => {
                addNode('taskNode', label, buildGenerationNodePayload({ label, mediaType, assetId: asset.id, data }))
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
    const mediaType = data.type || 'image'
    const isVideo = mediaType === 'video'
    const isAudio = mediaType === 'audio'
    const generated = generatedThumbs[asset.id] || null
    const cover: string | null = isVideo
      ? generated || data.thumbnailUrl || null
      : isAudio
        ? null
        : data.thumbnailUrl || data.url || null
    const label = asset.name || (isVideo ? '视频' : isAudio ? '音频' : '图片')
    return (
      <PanelCard className="asset-panel-card" key={asset.id}>
        {renderGenerationMedia({ mediaType, data, cover, label })}
        <Stack className="asset-panel-card-body" gap={6} mt="sm">
          <Group className="asset-panel-card-badges" gap="xs">
            <Badge
              className="asset-panel-card-type"
              size="xs"
              color={isVideo ? 'violet' : isAudio ? 'orange' : 'teal'}
              leftSection={isVideo
                ? <IconVideo className="asset-panel-card-type-icon" size={12} />
                : isAudio
                  ? <IconMusic className="asset-panel-card-type-icon" size={12} />
                  : <IconPhoto className="asset-panel-card-type-icon" size={12} />}
            >
              {isVideo ? '视频' : isAudio ? '音频' : '图片'}
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
          {renderGenerationCardActions({ asset, data, mediaType, label })}
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
            <Badge className="asset-panel-card-type" size="xs" color="gray" variant="light">
              {kindLabel}
            </Badge>
            {typeof data.chapter === 'number' && data.chapter > 0 && (
              <Badge className="asset-panel-card-chapter" size="xs" color="gray" variant="light">
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
  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const indexPromise = currentProject?.id && selectedBookId
        ? getProjectBookIndex(currentProject.id, selectedBookId).catch(() => null)
        : Promise.resolve(null)
      const [, , , idx] = await Promise.all([
        reloadAssets(),
        reloadBooks(),
        reloadChapters(),
        indexPromise,
      ])
      if (idx) setSelectedBookIndex(idx)
      toast('已刷新项目素材与文本索引', 'success')
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : '刷新失败', 'error')
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

  const handleSelectChapter = React.useCallback((chapterId: string) => {
    if (!currentProject?.id) return
    spaNavigate(buildProjectChapterCanvasUrl(currentProject.id, chapterId))
  }, [currentProject?.id])

  const handleSaveManualChapter = React.useCallback(async (input: ManualChapterDraftInput) => {
    const activeProjectId = String(currentProject?.id || '').trim()
    if (!activeProjectId || !manualChapterEditor || manualChapterSaving) return
    setManualChapterSaving(true)
    try {
      const chapter = manualChapterEditor.mode === 'create'
        ? await createProjectChapter(activeProjectId, {
            title: input.title,
            ...(input.summary ? { summary: input.summary } : {}),
          })
        : await updateChapter(manualChapterEditor.chapter.id, {
            title: input.title,
            summary: input.summary,
          })
      dispatchChapterMetaUpdate({
        chapterId: chapter.id,
        title: chapter.title,
        summary: chapter.summary || '',
      })
      setManualChapterEditor(null)
      let refreshError: string | null = null
      try {
        await reloadChapters()
      } catch (error: unknown) {
        refreshError = error instanceof Error ? error.message : '未知错误'
      }
      if (manualChapterEditor.mode === 'create') {
        toast(
          refreshError
            ? `章节已创建，但目录刷新失败：${refreshError}`
            : '章节已创建，已进入本章画布',
          refreshError ? 'warning' : 'success',
        )
        spaNavigate(buildProjectChapterCanvasUrl(activeProjectId, chapter.id))
      } else {
        toast(
          refreshError
            ? `本章构思已保存，但目录刷新失败：${refreshError}`
            : '本章构思已保存',
          refreshError ? 'warning' : 'success',
        )
      }
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '章节保存失败', 'error')
    } finally {
      setManualChapterSaving(false)
    }
  }, [currentProject?.id, manualChapterEditor, manualChapterSaving, reloadChapters])

  // 按需把单个章节画布装载进项目画布（自动打组）；已装载过的章节跳过。
  const [chapterLoadingId, setChapterLoadingId] = React.useState<string | null>(null)
  const handleLoadChapterToCanvas = React.useCallback(async (ch: ChapterDto) => {
    if (chapterLoadingId) return
    if ((window as any).__TAPCANVAS_CURRENT_CHAPTER__) {
      toast('当前在章节画布，请回到项目画布再装载章节内容', 'warning')
      return
    }
    setChapterLoadingId(ch.id)
    try {
      const summary = await loadChaptersAsGroups([ch])
      const label = ch.title || `第${ch.index}章`
      if (summary.imported > 0) {
        toast(`已把「${label}」装载为画布上的组`, 'success')
      } else if (summary.skippedExisting > 0) {
        toast(`「${label}」已在画布上，已跳过`, 'info')
      } else if (summary.skippedEmpty > 0) {
        toast(`「${label}」的章节画布为空，无可装载内容`, 'info')
      } else {
        toast(`装载「${label}」失败，请稍后重试`, 'error')
      }
    } catch (e: any) {
      toast(`装载章节失败：${e?.message || String(e)}`, 'error')
    } finally {
      setChapterLoadingId(null)
    }
  }, [chapterLoadingId])

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
        onChunkProgress: (completed, total) => {
          if (completed % 5 === 0 || completed === total) {
            toast(`分块上传进度：${completed}/${total}`, 'info')
          }
        },
      })
      toast('书籍源文件上传完成，已进入异步解析队列', 'info')
      setBookUploadJob(result.job)
      await reloadAssets()
      void reloadBooks().catch(() => undefined)
      void reloadChapters().catch(() => undefined)
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : '素材上传失败', 'error')
    } finally {
      setMaterialUploading(false)
    }
  }, [isBookUploadLocked, currentProject?.id, currentProject?.name, reloadAssets, reloadBooks, reloadChapters])

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
    if (!currentProject?.id) {
      toast('请先选择项目', 'warning')
      return
    }
    const url = String(referenceUrl || '').trim()
    if (!url) {
      toast('未找到可用参考图', 'warning')
      return
    }
    if (!selectedBookId) {
      setActiveStyleBible({ referenceImages: [url] })
      toast(sourceLabel ? `画风参考图已更新（来自${sourceLabel}）` : '画风参考图已更新', 'success')
      setStyleReferencePickerOpen(false)
      useUIStore.getState().resolveStyleReferenceRequest([url])
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
    toast('已根据参考图自动提炼并更新项目风格规则', 'info')
    // 同步把参考图写进全局 activeStyleBible，确保挂起请求（如故事板 getState 读 activeStyleBible）
    // 在 resolve 后立刻能通过闸门，不必等 selectedBookIndex→activeStyleBible 的同步 effect（异步）。
    const bookRefs = Array.isArray((next as any)?.assets?.styleBible?.referenceImages)
      ? ((next as any).assets.styleBible.referenceImages as unknown[]).map((u) => String(u || '').trim()).filter(Boolean)
      : [url]
    setActiveStyleBible({ styleName: (next as any)?.assets?.styleBible?.styleName, referenceImages: bookRefs.length ? bookRefs : [url] })
    setStyleReferencePickerOpen(false)
    useUIStore.getState().resolveStyleReferenceRequest([url])
  }, [currentProject?.id, deriveStyleHintsFromReferenceImage, selectedBookId, setActiveStyleBible])

  const handleStyleReferenceUploadInputChange = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files || [])
    e.currentTarget.value = ''
    if (!files.length) return
    if (!currentProject?.id) {
      toast('请先选择项目', 'warning')
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
    if (!currentProject?.id) {
      toast('请先选择项目', 'warning')
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

  const handleClearStyleReference = React.useCallback(async () => {
    if (styleReferenceUploading) return
    // 未选书的项目：参考图仅存内存，直接清空 activeStyleBible 即可。
    if (!currentProject?.id || !selectedBookId) {
      setActiveStyleBible(null)
      toast('风格参考图已删除', 'success')
      return
    }
    setStyleReferenceUploading(true)
    try {
      // 传空数组清空服务端 styleBible.referenceImages（styleName 等由后端保留）。
      const next = await confirmProjectBookStyle(currentProject.id, selectedBookId, {
        referenceImages: [],
      })
      setSelectedBookIndex(next)
      setActiveStyleBible(null)
      toast('风格参考图已删除', 'success')
    } catch (err: any) {
      toast(err?.message || '删除风格参考图失败', 'error')
    } finally {
      setStyleReferenceUploading(false)
    }
  }, [currentProject?.id, selectedBookId, setActiveStyleBible, styleReferenceUploading])

  const handleOpenStyleReferencePicker = React.useCallback(async () => {
    setStyleReferencePickerOpen(true)
    setStyleReferencePickerQuery('')
    setStyleReferencePickerCategory('all')
    setStyleReferencePickerSource('all')
    setStyleReferencePickerLoading(true)
    try {
      const [basePresets, userPresets] = await Promise.all([
        listLlmNodePresets({ type: 'image', scope: 'base', limit: STYLE_REFERENCE_BASE_LIMIT }),
        listLlmNodePresets({ type: 'image', scope: 'user', limit: STYLE_REFERENCE_USER_LIMIT }),
      ])
      const enrichedUserPresets = inheritBaseStyleReferencesForUserPresets({ basePresets, userPresets })
      setStyleReferencePickerAssets([...basePresets, ...enrichedUserPresets].filter((p) => Boolean(p.referenceImageUrl)))
    } catch {
      toast('加载素材库失败', 'error')
    } finally {
      setStyleReferencePickerLoading(false)
    }
  }, [])

  const handlePickStyleReferenceAsset = React.useCallback(async (preset: LlmNodePresetDto) => {
    const url = preset.referenceImageUrl?.trim() || ''
    if (!url) {
      toast('该素材暂无可用图片地址', 'warning')
      return
    }
    setStyleReferencePickerOpen(false)
    setStyleReferenceUploading(true)
    try {
      await persistStyleReferenceImage(url, `素材「${preset.title}」`)
    } catch (err: any) {
      toast(err?.message || '应用参考图失败', 'error')
    } finally {
      setStyleReferenceUploading(false)
    }
  }, [persistStyleReferenceImage])

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
    let deletionSucceeded = false
    try {
      await deleteProjectBook(currentProject.id, selectedBookId)
      deletionSucceeded = true
      const latest = await reloadBooks()
      const nextBooks = latest.filter((book) => book.bookId !== selectedBookId)
      setBooks(nextBooks)
      const nextId = pickPrimaryProjectBook(nextBooks)?.bookId || ''
      setSelectedBookId(nextId)
      if (!nextId) setSelectedBookIndex(null)
      else {
        const idx = await getProjectBookIndex(currentProject.id, nextId).catch(() => null)
        setSelectedBookIndex(idx)
      }
      if (latest.some((book) => book.bookId === selectedBookId)) {
        toast('删除请求已提交，但服务端列表仍包含当前文本，请稍后刷新重试', 'warning')
      } else {
        toast('当前文本已删除', 'success')
      }
      await reloadAssets()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '未知错误'
      toast(
        deletionSucceeded
          ? `当前文本已删除，但目录刷新失败：${message}`
          : `删除当前文本失败：${message}`,
        deletionSucceeded ? 'warning' : 'error',
      )
    }
  }, [books, currentProject?.id, reloadAssets, reloadBooks, selectedBookId, setBooks])

  const handleResyncProjectChapters = React.useCallback(async () => {
    const projectId = String(currentProject?.id || '').trim()
    const bookId = String(selectedBookId || activeBook?.bookId || '').trim()
    if (!projectId || !bookId) {
      toast(PROJECT_TEXT_REQUIRED_MESSAGE, 'warning')
      return
    }
    if (chapterResyncing) return
    setChapterResyncing(true)
    try {
      const result = await syncProjectChaptersFromPrimaryBook(projectId)
      const [, latestBookIndex] = await Promise.all([
        reloadChapters(),
        getProjectBookIndex(projectId, bookId, { bypassThrottle: true }).catch(() => null),
      ])
      setSelectedBookIndex(latestBookIndex)
      if (result.createdCount > 0) {
        toast(`已重新同步并补齐 ${result.createdCount} 个章节。`, 'success')
      } else {
        toast('项目章节已与原文目录同步，无新增缺失章节。', 'info')
      }
    } catch (err: unknown) {
      console.error('重新同步项目章节失败', err)
      toast(err instanceof Error ? err.message : '重新同步项目章节失败', 'error')
    } finally {
      setChapterResyncing(false)
    }
  }, [activeBook?.bookId, chapterResyncing, currentProject?.id, reloadChapters, selectedBookId])

  return (
    <div
      className={isDrawer ? 'asset-panel-anchor asset-panel-anchor--drawer' : 'asset-panel-anchor'}
      style={isDrawer ? undefined : bottomBarPanelStyle(anchorX, { zIndex: 200, halfWidth: 330 })}
      data-ux-panel
    >
      <Transition className="asset-panel-transition" mounted={mounted} transition={isDrawer ? 'fade' : 'pop'} duration={isDrawer ? 0 : 140} timingFunction="ease">
        {(styles) => (
          <div className="asset-panel-transition-inner" style={isDrawer ? { ...styles, height: '100%' } : styles}>
            <PanelCard
              className={isDrawer ? 'glass asset-panel-shell asset-panel-shell--drawer' : 'glass asset-panel-shell'}
              style={isDrawer ? { height: '100%', display: 'flex' } : { maxHeight: `${maxHeight}px`, height: `${maxHeight}px`, display:'flex' }}
              onWheelCapture={stopPanelWheelPropagation}
              data-ux-panel
            >
              {isDrawer ? null : <div className="asset-panel-arrow panel-arrow" />}
              <Tabs className="asset-panel-tabs" value={isCatalog ? 'materials' : tab} onChange={(v) => setTab((v as any) || 'materials')} style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
                {/* 抽屉模式下控件由抽屉头部/底部统一承载，隐藏浮动控件行（含关闭按钮） */}
                {!isDrawer && (
                <div className="asset-panel-header">
                  <Group className="asset-panel-header-actions" gap="xs">
                    <Tooltip className="asset-panel-fullscreen-tooltip" label="弹窗查看当前项目素材" withArrow>
                      <ActionIcon
                        className="asset-panel-fullscreen-action"
                        size="sm"
                        variant="subtle"
                        aria-label="弹窗查看当前项目素材"
                        onClick={openProjectMaterialsFullscreen}
                      >
                        <ManagedImage
                          className="asset-panel-fullscreen-icon"
                          src={ASSET_FULLSCREEN_ICON_URL}
                          alt="弹窗查看当前项目素材"
                          priority="critical"
                          ownerSurface="asset-library"
                          style={{ width: 20, height: 20, flexShrink: 0 }}
                        />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip className="asset-panel-refresh-tooltip" label="刷新" withArrow>
                      <ActionIcon className="asset-panel-refresh-action" size="sm" variant="subtle" onClick={handleRefresh} loading={refreshing || loading}>
                        <IconRefresh className="asset-panel-refresh-icon" size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <ActionIcon className="asset-panel-close" variant="subtle" radius="md" size={28} onClick={() => setActivePanel(null)} aria-label="关闭">
                      <IconX size={15} />
                    </ActionIcon>
                  </Group>
                </div>
                )}
              <div className="asset-panel-body" ref={bodyScrollRef} onScroll={handleScroll}>
                <input
                  className="asset-panel-upload-input asset-panel-hidden-input"
                  ref={materialUploadInputRef}
                  type="file"
                  accept=".txt,.text,.md,.markdown,.docx,.epub"
                  onChange={handleMaterialUploadInputChange}
                />
                  <Tabs.Panel className="asset-panel-tab-panel" value="materials" pt="xs">
                    <Stack className={isCatalog ? 'asset-panel-section asset-panel-section--catalog' : 'asset-panel-section'} gap="sm">
                      {/* 目录模式：既支持导入整本书，也支持原创连载逐章追加。 */}
                      {isCatalog && (
                        <>
                          <Group className="asset-panel-catalog-actions" gap={6} grow wrap="nowrap">
                            <Button
                              className="asset-panel-catalog-import"
                              size="sm"
                              variant="light"
                              leftSection={<IconFileUpload size={16} />}
                              loading={materialUploading}
                              disabled={materialUploading || isBookUploadLocked || manualChapterSaving}
                              onClick={() => openMaterialUpload()}
                            >
                              导入整本
                            </Button>
                            <Button
                              className="asset-panel-catalog-create-chapter"
                              size="sm"
                              variant="default"
                              leftSection={<IconPlus size={16} />}
                              disabled={!currentProject?.id || materialUploading || manualChapterSaving}
                              onClick={() => setManualChapterEditor({
                                mode: 'create',
                                identity: `create:${currentProject?.id || ''}`,
                              })}
                            >
                              新建一章
                            </Button>
                          </Group>
                          {manualChapterEditor ? (
                            <ManualChapterEditor
                              mode={manualChapterEditor.mode}
                              identity={manualChapterEditor.identity}
                              initialTitle={manualChapterEditor.mode === 'edit' ? manualChapterEditor.chapter.title : ''}
                              initialSummary={manualChapterEditor.mode === 'edit' ? manualChapterEditor.chapter.summary || '' : ''}
                              saving={manualChapterSaving}
                              onCancel={() => setManualChapterEditor(null)}
                              onSubmit={(input) => { void handleSaveManualChapter(input) }}
                            />
                          ) : null}
                        </>
                      )}
                      {bookLoading && books.length === 0 ? (
                        <StatePanel
                          className="asset-panel-catalog-state"
                          title="正在读取书籍目录…"
                          tone="loading"
                        />
                      ) : null}
                      {booksError ? (
                        <StatePanel
                          className="asset-panel-catalog-state asset-panel-catalog-state--error"
                          title="书籍目录加载失败"
                          description={`无法读取当前项目的书籍索引：${booksError}。现有小说不会被当作空目录。`}
                          tone="error"
                          actions={(
                            <Button
                              className="asset-panel-catalog-retry"
                              size="compact-xs"
                              variant="subtle"
                              leftSection={<IconRefresh className="asset-panel-catalog-retry-icon" size={14} />}
                              loading={bookLoading}
                              onClick={() => void reloadBooks().catch(() => undefined)}
                            >
                              重新加载
                            </Button>
                          )}
                        />
                      ) : null}
                      {booksStatus === 'ready' && books.length === 0 && chapters.length === 0 && !chaptersLoading && !chaptersError ? (
                        <StatePanel
                          className="asset-panel-catalog-state"
                          title="还没有章节"
                          description="可以先新建一章，从一句构思开始；也可以导入整本小说或剧本。"
                        />
                      ) : null}
                      {!isCatalog && (
                      <Text className="asset-panel-section-desc" size="sm" c="dimmed">
                        {currentProject?.id
                          ? `当前项目素材：${currentProject.name || currentProject.id}`
                          : '当前显示全部项目素材（建议先选择项目）'}
                      </Text>
                      )}
                      {currentProject?.id ? (
                        <Stack className="asset-panel-chapter-switcher" gap="xs">
                          {!isCatalog && (
                          <Group justify="space-between" align="center">
                            <Text size="xs" fw={600} c="dimmed">章节</Text>
                            {chaptersLoading ? <Loader size="xs" /> : null}
                          </Group>
                          )}
                          <TextInput
                            className={isCatalog ? 'asset-manager-drawer__search' : undefined}
                            size="xs"
                            leftSection={<IconSearch size={12} />}
                            placeholder="搜索章节"
                            value={chapterQuery}
                            onChange={(e) => setChapterQuery(e.currentTarget.value)}
                          />
                          {chaptersError ? (
                            <StatePanel
                              className="asset-panel-catalog-state asset-panel-catalog-state--error"
                              title="章节目录加载失败"
                              description={`书籍仍然存在，但章节列表暂时无法读取：${chaptersError}`}
                              tone="error"
                              actions={(
                                <Button
                                  className="asset-panel-catalog-retry"
                                  size="compact-xs"
                                  variant="subtle"
                                  leftSection={<IconRefresh className="asset-panel-catalog-retry-icon" size={14} />}
                                  loading={chaptersLoading}
                                  onClick={() => void reloadChapters().catch(() => undefined)}
                                >
                                  重新加载
                                </Button>
                              )}
                            />
                          ) : null}
                          {chaptersLoading && chapters.length === 0 ? (
                            <StatePanel
                              className="asset-panel-catalog-state"
                              title="正在读取章节目录…"
                              tone="loading"
                            />
                          ) : null}
                          <div
                            ref={chapterListRef}
                            className="asset-panel-chapter-list"
                            style={{ position: 'relative', maxHeight: isCatalog ? undefined : 220, overflowY: 'auto', border: isCatalog ? undefined : '1px solid var(--mantine-color-default-border)', borderRadius: isCatalog ? undefined : 6 }}
                          >
                            {(chaptersLoading || chaptersError) && chapters.length === 0 ? null : filteredChapters.length === 0 ? (
                              <Text size="xs" c="dimmed" p="xs">{chapters.length === 0 ? '暂无章节' : '无匹配章节'}</Text>
                            ) : (
                              filteredChapters.map((ch) => {
                                const isActive = ch.id === resolvedActiveChapterId
                                return (
                                  <div
                                    key={ch.id}
                                    data-chapter-active={isActive || undefined}
                                    onClick={isCatalog ? () => handleSelectChapter(ch.id) : undefined}
                                    title={isCatalog ? `第 ${ch.index} 章 · ${ch.title || '未命名'}（点击跳转）` : undefined}
                                    style={{
                                      padding: isCatalog ? '8px 10px' : '6px 8px',
                                      cursor: isCatalog ? 'pointer' : undefined,
                                      background: isActive ? 'var(--mantine-color-blue-light)' : 'transparent',
                                      borderBottom: isCatalog ? undefined : '1px solid var(--mantine-color-default-border)',
                                    }}
                                  >
                                    <Group gap={8} wrap="nowrap" align="center">
                                      {isCatalog && (
                                        <span className="asset-panel-chapter-file-icon">
                                          <IconFileText size={15} stroke={1.6} />
                                        </span>
                                      )}
                                      <Text size="xs" fw={isActive ? 600 : 400} truncate style={{ flex: 1, minWidth: 0 }}>
                                        第 {ch.index} 章 · {ch.title || '未命名'}
                                      </Text>
                                      {isCatalog ? (
                                        <span
                                          className="asset-panel-chapter-row-menu"
                                          onClick={(e) => e.stopPropagation()}
                                          style={{ display: 'inline-flex', flexShrink: 0 }}
                                        >
                                          <Menu shadow="md" position="bottom-end" withinPortal zIndex={500}>
                                            <Menu.Target>
                                              <ActionIcon size="sm" variant="subtle" color="gray" aria-label="章节操作">
                                                {chapterLoadingId === ch.id ? <Loader size={14} /> : <IconDots size={16} />}
                                              </ActionIcon>
                                            </Menu.Target>
                                            <Menu.Dropdown>
                                              <Menu.Item
                                                leftSection={<IconArrowRight size={14} />}
                                                onClick={() => handleSelectChapter(ch.id)}
                                              >
                                                跳转本章
                                              </Menu.Item>
                                              {!ch.sourceBookId ? (
                                                <Menu.Item
                                                  leftSection={<IconPencil size={14} />}
                                                  onClick={() => setManualChapterEditor({
                                                    mode: 'edit',
                                                    identity: `edit:${ch.id}:${ch.updatedAt}`,
                                                    chapter: ch,
                                                  })}
                                                >
                                                  编辑本章构思
                                                </Menu.Item>
                                              ) : null}
                                              <Menu.Item
                                                leftSection={<IconFolderOpen size={14} />}
                                                disabled={chapterLoadingId != null && chapterLoadingId !== ch.id}
                                                onClick={() => void handleLoadChapterToCanvas(ch)}
                                              >
                                                {chapterLoadingId === ch.id ? '载入中…' : '载入本章画布'}
                                              </Menu.Item>
                                            </Menu.Dropdown>
                                          </Menu>
                                        </span>
                                      ) : (
                                        <Group gap={4} wrap="nowrap">
                                          <Button
                                            size="compact-xs"
                                            variant="subtle"
                                            onClick={() => handleSelectChapter(ch.id)}
                                          >
                                            跳转章节
                                          </Button>
                                          <Tooltip label="把该章节画布内容装载进项目画布（自动打成一个组，已装载过会跳过）" withArrow>
                                            <Button
                                              size="compact-xs"
                                              variant="subtle"
                                              loading={chapterLoadingId === ch.id}
                                              disabled={chapterLoadingId != null && chapterLoadingId !== ch.id}
                                              onClick={() => void handleLoadChapterToCanvas(ch)}
                                            >
                                              载入章节
                                            </Button>
                                          </Tooltip>
                                        </Group>
                                      )}
                                    </Group>
                                  </div>
                                )
                              })
                            )}
                          </div>
                          {isCatalog ? (
                            <div className="asset-manager-drawer__count">
                              <Text size="xs" c="dimmed">共 {chapters.length} 章节</Text>
                            </div>
                          ) : (
                            <Divider my="xs" />
                          )}
                        </Stack>
                      ) : null}
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
                      {/* Actions row */}
                      <Group className="asset-panel-material-actions" gap="xs" justify="space-between" wrap="nowrap">
                        {/* 目录模式上传按钮已常驻头部，这里只在非目录模式展示 */}
                        {!isCatalog && (
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
                        )}
                      </Group>

                      {!isCatalog && (<>
                      {/* Category filter pills */}
                      <div className="tc-pill-filter-row asset-panel-category-pills" style={{ padding: 0, paddingBottom: 4 }}>
                        {([['docs', '文档素材'], ['texts', '创作文本'], ['all', '全部']] as const).map(([val, label]) => (
                          <button
                            key={val}
                            className="tc-pill-filter-btn"
                            data-active={materialCategory === val}
                            onClick={() => setMaterialCategory(val as any)}
                          >
                            {label}
                          </button>
                        ))}
                        {materialChapterOptions.length > 0 && (
                          <>
                            <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.12)', margin: '0 4px', flexShrink: 0 }} />
                            {([['all', '全部章节'], ...materialChapterOptions.slice(0, 5).map((c) => [String(c), `第${c}章`])] as [string, string][]).map(([val, label]) => (
                              <button
                                key={val}
                                className="tc-pill-filter-btn"
                                data-active={materialChapterFilter === val}
                                onClick={() => setMaterialChapterFilter(val)}
                              >
                                {label}
                              </button>
                            ))}
                          </>
                        )}
                      </div>

                      {/* Book info + management */}
                      <Group className="asset-panel-book-actions" gap={6} wrap="wrap" align="center">
                        <Text
                          className="asset-panel-book-summary"
                          size="xs"
                          c="dimmed"
                          style={{ flex: 1, minWidth: 0 }}
                          lineClamp={1}
                          title={activeBook ? `${activeBook.title || '未命名文本'} · ${activeBook.chapterCount}章` : '未上传'}
                        >
                          {activeBook
                            ? `当前文本：${activeBook.title || '未命名文本'} · ${activeBook.chapterCount}章`
                            : '当前文本：未上传'}
                        </Text>
                        <Tooltip label="重新同步章节" withArrow>
                          <ActionIcon
                            className="asset-panel-book-resync"
                            size="sm"
                            variant="subtle"
                            loading={chapterResyncing}
                            disabled={!activeBook?.bookId || isBookUploadLocked || graphRebuilding}
                            onClick={() => { void handleResyncProjectChapters() }}
                          >
                            <IconRefresh size={13} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="删除当前文本" withArrow>
                          <ActionIcon
                            className="asset-panel-book-delete"
                            size="sm"
                            variant="subtle"
                            color="red"
                            disabled={!activeBook?.bookId || graphRebuilding}
                            onClick={() => { void handleDeleteBook() }}
                          >
                            <IconTrash size={13} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>

                      {/* Chapter match filter */}
                      <Group className="asset-panel-book-filter-row" gap={6} wrap="wrap" align="center">
                        <select
                          className="asset-panel-book-filter-type asset-panel-native-select asset-panel-native-control"
                          style={{ flex: '0 0 auto', minWidth: 110 }}
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
                        {bookFilterType !== 'all' && (
                          <select
                            className="asset-panel-book-filter-keyword asset-panel-native-select asset-panel-native-control"
                            style={{ flex: 1, minWidth: 0 }}
                            value={bookFilterKeyword}
                            onChange={(e) => setBookFilterKeyword(e.currentTarget.value)}
                            disabled={!selectedBookIndex}
                          >
                            <option value="">选择关键字</option>
                            {bookQuickFilterOptions.map((item) => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                        )}
                        {bookFilterType !== 'all' && (
                          <input
                            className="asset-panel-book-filter-input asset-panel-native-input asset-panel-native-control"
                            style={{ flex: 1, minWidth: 0 }}
                            value={bookFilterKeyword}
                            onChange={(e) => setBookFilterKeyword(e.currentTarget.value)}
                            disabled={!selectedBookIndex}
                            placeholder="模糊搜索关键词"
                          />
                        )}
                      </Group>

                      {/* Stats line */}
                      <Text className="asset-panel-book-stats" size="xs" c="dimmed">
                        匹配 {filteredBookChapters.length}/{selectedBookIndex?.chapters?.length || 0} · 识别角色 {availableCharacterPool.length}
                      </Text>
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
                      ) : materialCategory === 'texts' ? (
                        textAssetsLoading ? (
                          <Center h={80}><Loader size="sm" /></Center>
                        ) : textAssets.length === 0 ? (
                          <Text className="asset-panel-empty" size="xs" c="dimmed">
                            暂无创作文本，AI 创作后点「↗ 入画布」即可同步
                          </Text>
                        ) : (
                          <Stack gap="xs">
                            {textAssets.map((asset) => {
                              const content = String((asset.latestVersion?.data as Record<string, unknown> | undefined)?.content || '').trim()
                              const isRenaming = textAssetRenaming === asset.id
                              return (
                                <Paper key={asset.id} p="xs" withBorder style={{ position: 'relative' }}>
                                  {isRenaming ? (
                                    <Group gap="xs" wrap="nowrap">
                                      <input
                                        className="asset-panel-native-input asset-panel-native-control"
                                        style={{ flex: 1 }}
                                        value={textAssetRenameValue}
                                        autoFocus
                                        onChange={(e) => setTextAssetRenameValue(e.currentTarget.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            const name = textAssetRenameValue.trim()
                                            if (name) {
                                              void updateMaterialAsset(asset.id, { name }).then((updated) => {
                                                setTextAssets((prev) => prev.map((a) => a.id === updated.id ? updated : a))
                                              }).catch(() => toast('重命名失败', 'error'))
                                            }
                                            setTextAssetRenaming(null)
                                          } else if (e.key === 'Escape') {
                                            setTextAssetRenaming(null)
                                          }
                                        }}
                                      />
                                      <ActionIcon size="xs" variant="subtle" onClick={() => setTextAssetRenaming(null)}>
                                        <IconX size={12} />
                                      </ActionIcon>
                                    </Group>
                                  ) : (
                                    <Group gap="xs" wrap="nowrap" justify="space-between">
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <Text size="xs" fw={600} truncate>{asset.name}</Text>
                                        {content ? (
                                          <Text size="xs" c="dimmed" lineClamp={2} style={{ marginTop: 2 }}>{content}</Text>
                                        ) : null}
                                      </div>
                                      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                                        <Tooltip label="重命名" withArrow>
                                          <ActionIcon size="xs" variant="subtle" onClick={() => {
                                            setTextAssetRenameValue(asset.name)
                                            setTextAssetRenaming(asset.id)
                                          }}>
                                            <IconPencil size={12} />
                                          </ActionIcon>
                                        </Tooltip>
                                        <Tooltip label="删除" withArrow>
                                          <ActionIcon size="xs" variant="subtle" color="red" onClick={() => {
                                            void deleteMaterialAsset(asset.id).then(() => {
                                              setTextAssets((prev) => prev.filter((a) => a.id !== asset.id))
                                            }).catch(() => toast('删除失败', 'error'))
                                          }}>
                                            <IconTrash size={12} />
                                          </ActionIcon>
                                        </Tooltip>
                                      </Group>
                                    </Group>
                                  )}
                                </Paper>
                              )
                            })}
                          </Stack>
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
                      ) : filteredProjectMaterialAssets.length === 0 ? (
                        <Text className="asset-panel-empty" size="xs" c="dimmed">
                          暂无项目素材
                        </Text>
                      ) : (
                        <SimpleGrid className="asset-panel-grid" cols={{ base: 1, sm: 2 }} spacing="sm">
                          {renderLazyGridItems({
                            items: filteredProjectMaterialAssets,
                            rootRef: bodyScrollRef,
                            placeholderHeight: 220,
                            keyFor: (asset) => `material:${asset.id}`,
                            renderItem: renderMaterialCard,
                          })}
                        </SimpleGrid>
                      )}
                      </>)}
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
                          <div className="tc-pill-filter-row asset-panel-filter" style={{ padding: 0, flexWrap: 'nowrap' }}>
                            {([['video', '视频'], ['audio', '音频'], ['image', '图片'], ['all', '全部']] as const).map(([val, label]) => (
                              <button
                                key={val}
                                className="tc-pill-filter-btn"
                                data-active={mediaFilter === val}
                                onClick={() => setMediaFilter(val)}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
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
              </div>
              </Tabs>
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
    </div>
  )
}

const STYLE_REF_COLS = 4
const STYLE_REF_ITEM_HEIGHT = 150
const STYLE_REF_ROW_GAP = 8
const STYLE_REF_ROW_HEIGHT = STYLE_REF_ITEM_HEIGHT + STYLE_REF_ROW_GAP
const STYLE_REF_CONTAINER_H = 480
const STYLE_REF_OVERSCAN = 3

function StyleRefVirtualGrid({
  assets,
  onSelect,
}: {
  assets: LlmNodePresetDto[]
  onSelect: (p: LlmNodePresetDto) => void
}) {
  const [scrollTop, setScrollTop] = React.useState(0)

  const rows = React.useMemo<LlmNodePresetDto[][]>(() => {
    const out: LlmNodePresetDto[][] = []
    for (let i = 0; i < assets.length; i += STYLE_REF_COLS) {
      out.push(assets.slice(i, i + STYLE_REF_COLS))
    }
    return out
  }, [assets])

  const totalHeight = rows.length * STYLE_REF_ROW_HEIGHT
  const startRow = Math.max(0, Math.floor(scrollTop / STYLE_REF_ROW_HEIGHT) - STYLE_REF_OVERSCAN)
  const endRow = Math.min(
    rows.length - 1,
    Math.ceil((scrollTop + STYLE_REF_CONTAINER_H) / STYLE_REF_ROW_HEIGHT) + STYLE_REF_OVERSCAN,
  )

  return (
    <div
      className="asset-panel-style-reference-virtual-grid"
      style={{ height: STYLE_REF_CONTAINER_H, overflowY: 'auto' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="asset-panel-style-reference-virtual-grid-spacer" style={{ height: totalHeight, position: 'relative' }}>
        <div className="asset-panel-style-reference-virtual-grid-window" style={{ position: 'absolute', top: startRow * STYLE_REF_ROW_HEIGHT, left: 0, right: 0 }}>
          {rows.slice(startRow, endRow + 1).map((row, i) => (
            <div
              className="asset-panel-style-reference-virtual-grid-row"
              key={startRow + i}
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${STYLE_REF_COLS}, 1fr)`,
                gap: STYLE_REF_ROW_GAP,
                marginBottom: STYLE_REF_ROW_GAP,
              }}
            >
              {row.map((preset) => (
                <StyleRefPickerCard key={preset.id} preset={preset} onSelect={onSelect} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StyleRefPickerCard({
  preset,
  onSelect,
}: {
  preset: LlmNodePresetDto
  onSelect: (p: LlmNodePresetDto) => void
}) {
  const [loaded, setLoaded] = React.useState(false)
  return (
    <Stack
      className="asset-panel-style-reference-picker-card"
      gap={4}
      style={{ cursor: 'pointer' }}
      onClick={() => { void onSelect(preset) }}
    >
      <Box className="asset-panel-style-reference-picker-card-preview" style={{ position: 'relative', height: 112, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--mantine-color-gray-3)' }}>
        {!loaded && <Skeleton style={{ position: 'absolute', inset: 0 }} radius={0} />}
        <ManagedImage
          className="asset-panel-style-reference-picker-card-image"
          src={preset.referenceImageUrl ?? ''}
          alt={preset.title}
          priority="visible"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
        />
      </Box>
      <Group className="asset-panel-style-reference-picker-card-meta" gap={4} wrap="nowrap">
        <Badge className="asset-panel-style-reference-picker-card-source" size="xs" variant="light" color={preset.scope === 'user' ? 'yellow' : 'blue'}>
          {preset.scope === 'user' ? '收藏' : '官方'}
        </Badge>
        <Badge className="asset-panel-style-reference-picker-card-category" size="xs" variant="outline">
          {getPrimaryStyleReferenceCategoryLabel(preset)}
        </Badge>
      </Group>
      <Text className="asset-panel-style-reference-picker-card-title" size="xs" lineClamp={1} c="dimmed">{preset.title}</Text>
    </Stack>
  )
}
