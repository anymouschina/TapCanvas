import { create } from 'zustand'
import type { ChapterCreativeOverride } from '../api/server'

const PUBLIC_API_KEY_STORAGE_KEY = 'tapcanvas_public_api_key'
const PUBLIC_VENDOR_CANDIDATES_STORAGE_KEY = 'tapcanvas_public_vendor_candidates'
const STORYBOARD_GENERATE_MODE_STORAGE_KEY = 'tapcanvas_storyboard_generate_mode'
const STORYBOARD_GENERATE_GRID_STORAGE_KEY = 'tapcanvas_storyboard_generate_grid'
const STORYBOARD_OUTPUT_ASPECT_RATIO_STORAGE_KEY = 'tapcanvas_storyboard_output_aspect_ratio'
const AI_CHAT_WATCH_ASSETS_STORAGE_KEY = 'tapcanvas_ai_chat_watch_assets'

function getInitialAssetPersistence(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const v = window.localStorage.getItem('tapcanvas_asset_persist')
    if (v === '0') return false
  } catch {
    // ignore
  }
  return true
}

function readStoredPublicApiKey(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(PUBLIC_API_KEY_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function writeStoredPublicApiKey(next: string) {
  if (typeof window === 'undefined') return
  try {
    if (next) window.localStorage.setItem(PUBLIC_API_KEY_STORAGE_KEY, next)
    else window.localStorage.removeItem(PUBLIC_API_KEY_STORAGE_KEY)
  } catch {
    // ignore
  }
}

function readStoredPublicVendorCandidates(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(PUBLIC_VENDOR_CANDIDATES_STORAGE_KEY) || ''
    if (!raw.trim()) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

function writeStoredPublicVendorCandidates(next: string[]) {
  if (typeof window === 'undefined') return
  try {
    if (next.length) {
      window.localStorage.setItem(PUBLIC_VENDOR_CANDIDATES_STORAGE_KEY, JSON.stringify(next))
    } else {
      window.localStorage.removeItem(PUBLIC_VENDOR_CANDIDATES_STORAGE_KEY)
    }
  } catch {
    // ignore
  }
}

function readStoredStoryboardGenerateMode(): 'single' | 'full' {
  if (typeof window === 'undefined') return 'single'
  try {
    const v = String(window.localStorage.getItem(STORYBOARD_GENERATE_MODE_STORAGE_KEY) || '').trim().toLowerCase()
    return v === 'full' ? 'full' : 'single'
  } catch {
    return 'single'
  }
}

function writeStoredStoryboardGenerateMode(next: 'single' | 'full') {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORYBOARD_GENERATE_MODE_STORAGE_KEY, next)
  } catch {
    // ignore
  }
}

function readStoredStoryboardGenerateGrid(): 4 | 9 {
  if (typeof window === 'undefined') return 4
  try {
    const raw = Number(window.localStorage.getItem(STORYBOARD_GENERATE_GRID_STORAGE_KEY) || '4')
    return raw === 9 ? 9 : 4
  } catch {
    return 4
  }
}

function writeStoredStoryboardGenerateGrid(next: 4 | 9) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORYBOARD_GENERATE_GRID_STORAGE_KEY, String(next))
  } catch {
    // ignore
  }
}

function normalizeStoryboardOutputAspectRatio(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '16:9'
  const allowed = new Set(['16:9', '9:16', '4:3', '3:4', '1:1'])
  return allowed.has(raw) ? raw : '16:9'
}

function readStoredStoryboardOutputAspectRatio(): string {
  if (typeof window === 'undefined') return '16:9'
  try {
    const raw = window.localStorage.getItem(STORYBOARD_OUTPUT_ASPECT_RATIO_STORAGE_KEY) || ''
    return normalizeStoryboardOutputAspectRatio(raw)
  } catch {
    return '16:9'
  }
}

function writeStoredStoryboardOutputAspectRatio(next: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORYBOARD_OUTPUT_ASPECT_RATIO_STORAGE_KEY,
      normalizeStoryboardOutputAspectRatio(next),
    )
  } catch {
    // ignore
  }
}

function readStoredAiChatWatchAssets(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const raw = String(window.localStorage.getItem(AI_CHAT_WATCH_ASSETS_STORAGE_KEY) || '').trim()
    if (raw === '0') return false
  } catch {
    // ignore
  }
  return true
}

function writeStoredAiChatWatchAssets(next: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AI_CHAT_WATCH_ASSETS_STORAGE_KEY, next ? '1' : '0')
  } catch {
    // ignore
  }
}

export type CreationSessionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed'
export type CreationUnitType = 'scene' | 'storyboard_chunk' | 'shot' | 'clip'

export type CreationSessionHistoryItem = {
  index: number
  summary: string
  nodeId: string
  confirmedAt: number
}

export type CreationSession = {
  id: string
  title: string
  status: CreationSessionStatus
  unitType: CreationUnitType
  currentIndex: number
  total: number
  currentNodeId: string
  currentTaskId: string
  summary: string
  lastError: string
  history: CreationSessionHistoryItem[]
  updatedAt: number
}

export type PersistedCreationSession = {
  id: string
  title: string
  status: CreationSessionStatus
  unitType: CreationUnitType
  currentIndex: number
  total: number
  currentNodeId: string
  currentTaskId: string
  summary: string
  lastError: string
  history: CreationSessionHistoryItem[]
  updatedAt: number
}

export type AssetPanelTab = 'generated' | 'materials'

export type ActivePanel =
  | 'add'
  | 'template'
  | 'style-library'
  | 'character-library'
  | 'assets'
  | 'assets-library'
  | 'tapshow'
  | 'project'
  | 'models'
  | 'history'
  | 'generation-history'
  | 'task-inbox'
  | 'runs'
  | 'feishu'
  | 'project-materials'
  | null

export type AssetPanelMaterialCategory = 'docs' | 'texts' | 'all'

export type AssetPanelFocusRequest = {
  requestKey: string
  bookId?: string
  chapter?: number
  tab?: AssetPanelTab
  materialCategory?: AssetPanelMaterialCategory
  scrollTarget?: 'top' | 'styleReference'
}

export type AssetPanelStoryboardRunRequest = {
  requestKey: string
  mode: 'single' | 'full'
  bookId?: string
  chapter?: number
  startFromFirst?: boolean
  forceWholeChapterRegenerate?: boolean
}

export type CanvasReferencePickerState = {
  targetNodeId: string
  blockedSourceNodeIds: string[]
}

export type CapabilityBayOpenRequest = {
  requestKey: string
  flowId: string
}


type CreationSessionCheckpoint = {
  id: string
  title?: string
  status?: CreationSessionStatus
  unitType: CreationUnitType
  currentIndex: number
  total?: number
  currentNodeId?: string
  currentTaskId?: string
  summary?: string
  lastError?: string
  updatedAt?: number
}

type CommitCreationSessionUnitInput = {
  id: string
  unitType: CreationUnitType
  index: number
  total?: number
  nodeId?: string
  summary?: string
  status?: CreationSessionStatus
}

type UIState = {
  viewOnly: boolean
  setViewOnly: (v: boolean) => void
  subflowNodeId: string | null
  openSubflow: (nodeId: string) => void
  closeSubflow: () => void
  libraryFlowId: string | null
  openLibraryFlow: (flowId: string) => void
  closeLibraryFlow: () => void
  compact: boolean
  toggleCompact: () => void
  addPanelOpen: boolean
  setAddPanelOpen: (v: boolean) => void
  templatePanelOpen: boolean
  setTemplatePanelOpen: (v: boolean) => void
  capabilityBayOpenRequest: CapabilityBayOpenRequest | null
  requestCapabilityBayForFlow: (flowId: string) => void
  clearCapabilityBayOpenRequest: () => void
  activePanel: ActivePanel
  setActivePanel: (p: ActivePanel) => void
  // AI 对话开合状态（由 AiChatDialog 同步，供底部工具栏入口高亮 + toggle）。
  aiChatOpen: boolean
  setAiChatOpen: (v: boolean) => void
  // 导演台内会话作用域：打开导演台时由 Modal 写入其 nodeId，AiChatDialog 据此切到 director lane
  // （会话与项目主对话隔离，按节点独立线程）；关闭导演台清空 → 回到 general。
  directorChatScopeNodeId: string | null
  setDirectorChatScopeNodeId: (id: string | null) => void
  // 左下「资产管理」抽屉：画布元素列表 + 资产库，两 tab。由左下角入口按钮唤起，可收起。
  assetManagerOpen: boolean
  assetManagerTab: 'canvas' | 'assets' | 'catalog'
  toggleAssetManager: () => void
  openAssetManager: (tab?: 'canvas' | 'assets' | 'catalog') => void
  closeAssetManager: () => void
  setAssetManagerTab: (tab: 'canvas' | 'assets' | 'catalog') => void
  assetPanelTab: AssetPanelTab
  setAssetPanelTab: (tab: AssetPanelTab) => void
  assetPanelMaterialCategory: AssetPanelMaterialCategory
  setAssetPanelMaterialCategory: (category: AssetPanelMaterialCategory) => void
  assetPanelFocusRequest: AssetPanelFocusRequest | null
  requestAssetPanelFocus: (request: Omit<AssetPanelFocusRequest, 'requestKey'>) => void
  clearAssetPanelFocusRequest: () => void
  assetPanelStoryboardRunRequest: AssetPanelStoryboardRunRequest | null
  requestAssetPanelStoryboardRun: (request: Omit<AssetPanelStoryboardRunRequest, 'requestKey'>) => void
  clearAssetPanelStoryboardRunRequest: () => void
  canvasReferencePicker: CanvasReferencePickerState | null
  openCanvasReferencePicker: (payload: { targetNodeId: string; blockedSourceNodeIds?: string[] }) => void
  closeCanvasReferencePicker: () => void
  panelAnchorY: number | null
  setPanelAnchorY: (y: number | null) => void
  // 底部居中工具栏（FloatingNav 横向化）上方弹出面板时，记录触发项的水平中心，面板据此居中。
  panelAnchorX: number | null
  setPanelAnchorX: (x: number | null) => void
  paramNodeId: string | null
  openParamFor: (id: string) => void
  closeParam: () => void
  preview: { url: string; kind: 'image'|'video'|'audio'; name?: string } | null
  openPreview: (m: { url: string; kind: 'image'|'video'|'audio'; name?: string }) => void
  closePreview: () => void
  edgeRoute: 'smooth' | 'orth'
  toggleEdgeRoute: () => void
  currentFlow: { id?: string|null; name: string; source: 'local'|'server'; ownerType?: 'project'|'chapter'|'shot'|null; ownerId?: string|null }
  setCurrentFlow: (patch: Partial<{ id?: string|null; name: string; source: 'local'|'server'; ownerType?: 'project'|'chapter'|'shot'|null; ownerId?: string|null }>) => void
  // 当前章节画布的权威上下文（由 ChapterCanvasPage 设置）。非章节画布为 null。
  // 聊天会话 key 用它做章节级隔离，避免取滞后的 currentProject/currentFlow 造成跨项目/章节串台。
  currentChapter: { projectId: string; bookId: string | null; chapterId: string; chapterTitle?: string } | null
  setCurrentChapter: (v: { projectId: string; bookId: string | null; chapterId: string; chapterTitle?: string } | null) => void
  currentChapterCreativeOverride: ChapterCreativeOverride | null
  setCurrentChapterCreativeOverride: (value: ChapterCreativeOverride | null) => void
  canvasViewport: { x: number; y: number; zoom: number } | null
  setCanvasViewport: (v: { x: number; y: number; zoom: number } | null) => void
  restoreViewport: { x: number; y: number; zoom: number } | null
  setRestoreViewport: (v: { x: number; y: number; zoom: number } | null) => void
  isDirty: boolean
  setDirty: (v: boolean) => void
  currentProject: { id?: string | null; name: string; owner?: string | null; ownerId?: string | null; ownerName?: string | null; isPublic?: boolean | null; teamId?: string | null; projectKind?: 'creative' | 'ai_workflow' } | null
  setCurrentProject: (p: { id?: string | null; name: string; owner?: string | null; ownerId?: string | null; ownerName?: string | null; isPublic?: boolean | null; teamId?: string | null; projectKind?: 'creative' | 'ai_workflow' } | null) => void
  activeWorkflow: string | null
  setActiveWorkflow: (workflow: string | null) => void
  assetPersistenceEnabled: boolean
  setAssetPersistenceEnabled: (v: boolean) => void
  publicApiKey: string
  setPublicApiKey: (v: string) => void
  publicVendorCandidates: string[]
  setPublicVendorCandidates: (v: string[]) => void
  storyboardGenerateMode: 'single' | 'full'
  setStoryboardGenerateMode: (v: 'single' | 'full') => void
  storyboardGenerateGrid: 4 | 9
  setStoryboardGenerateGrid: (v: 4 | 9) => void
  storyboardOutputAspectRatio: string
  setStoryboardOutputAspectRatio: (v: string) => void
  aiChatWatchAssetsEnabled: boolean
  setAiChatWatchAssetsEnabled: (v: boolean) => void
  creationSession: CreationSession | null
  restoreCreationSession: (payload: unknown) => void
  syncCreationSessionCheckpoint: (payload: CreationSessionCheckpoint) => void
  commitCreationSessionUnit: (payload: CommitCreationSessionUnitInput) => void
  rollbackCreationSessionLastUnit: () => void
  pauseCreationSession: () => void
  completeCreationSession: (summary?: string) => void
  failCreationSession: (message: string) => void
  clearCreationSession: () => void
  activeStyleBibleReferenceImages: string[]
  setActiveStyleBibleReferenceImages: (images: string[]) => void
  activeStyleBible: { styleName: string; referenceImages: string[] } | null
  setActiveStyleBible: (bible: { styleName?: string; referenceImages?: string[] } | null) => void
  // 全局「选择风格素材」请求：任意入口（角色卡/故事板）缺画风参考时唤起统一弹窗，
  // 用户选/传完素材后回调 onResolved（携带最新参考图 URL）以自动继续原操作。token 仅用于触发刷新。
  styleReferenceRequest: { reason: string; onResolved?: (refs: string[]) => void; token: number } | null
  requestStyleReference: (req: { reason: string; onResolved?: (refs: string[]) => void }) => void
  resolveStyleReferenceRequest: (refs: string[]) => void
  cancelStyleReferenceRequest: () => void
}

function normalizePersistedCreationSession(value: unknown): PersistedCreationSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return null
  const statusRaw = typeof raw.status === 'string' ? raw.status.trim() : ''
  const status: CreationSessionStatus =
    statusRaw === 'running' ||
    statusRaw === 'paused' ||
    statusRaw === 'completed' ||
    statusRaw === 'failed'
      ? statusRaw
      : statusRaw === 'awaiting_confirmation'
        ? 'paused'
      : 'idle'
  const unitTypeRaw = typeof raw.unitType === 'string' ? raw.unitType.trim() : ''
  const unitType: CreationUnitType =
    unitTypeRaw === 'storyboard_chunk' || unitTypeRaw === 'shot' || unitTypeRaw === 'clip'
      ? unitTypeRaw
      : 'scene'
  const toInt = (input: unknown, fallback: number): number => {
    const value = Number(input)
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback
  }
  const updatedAtRaw = Number(raw.updatedAt)
  const normalizeHistoryItem = (item: unknown): CreationSessionHistoryItem | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const rawItem = item as Record<string, unknown>
    const index = toInt(rawItem.index, 0)
    if (index <= 0) return null
    const confirmedAtRaw = Number(rawItem.confirmedAt)
    return {
      index,
      summary: typeof rawItem.summary === 'string' ? rawItem.summary.trim() : '',
      nodeId: typeof rawItem.nodeId === 'string' ? rawItem.nodeId.trim() : '',
      confirmedAt: Number.isFinite(confirmedAtRaw) ? confirmedAtRaw : Date.now(),
    }
  }
  const history = Array.isArray(raw.history)
    ? raw.history.map((item) => normalizeHistoryItem(item)).filter((item): item is CreationSessionHistoryItem => item !== null).slice(-12)
    : []
  return {
    id,
    title: typeof raw.title === 'string' ? raw.title.trim() : 'AI 创作',
    status,
    unitType,
    currentIndex: toInt(raw.currentIndex, 0),
    total: toInt(raw.total, 0),
    currentNodeId: typeof raw.currentNodeId === 'string' ? raw.currentNodeId.trim() : '',
    currentTaskId: typeof raw.currentTaskId === 'string' ? raw.currentTaskId.trim() : '',
    summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
    lastError: typeof raw.lastError === 'string' ? raw.lastError.trim() : '',
    history,
    updatedAt: Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now(),
  }
}

export function serializeCreationSessionForPersistence(session: CreationSession | null): PersistedCreationSession | null {
  if (!session) return null
  if (session.unitType !== 'scene') return null
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    unitType: session.unitType,
    currentIndex: Math.max(0, Math.trunc(session.currentIndex)),
    total: Math.max(0, Math.trunc(session.total)),
    currentNodeId: String(session.currentNodeId || '').trim(),
    currentTaskId: String(session.currentTaskId || '').trim(),
    summary: String(session.summary || '').trim(),
    lastError: String(session.lastError || '').trim(),
    history: Array.isArray(session.history)
      ? session.history
        .map((item) => ({
          index: Math.max(0, Math.trunc(item.index)),
          summary: String(item.summary || '').trim(),
          nodeId: String(item.nodeId || '').trim(),
          confirmedAt: Number.isFinite(item.confirmedAt) ? item.confirmedAt : Date.now(),
        }))
        .filter((item) => item.index > 0)
        .slice(-12)
      : [],
    updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : Date.now(),
  }
}

export const useUIStore = create<UIState>((set, get) => ({
  viewOnly: false,
  setViewOnly: (v) => set({ viewOnly: v }),
  subflowNodeId: null,
  openSubflow: (nodeId) => set({ subflowNodeId: nodeId }),
  closeSubflow: () => set({ subflowNodeId: null }),
  libraryFlowId: null,
  openLibraryFlow: (flowId) => set({ libraryFlowId: flowId }),
  closeLibraryFlow: () => set({ libraryFlowId: null }),
  compact: false,
  toggleCompact: () => set((s) => ({ compact: !s.compact })),
  addPanelOpen: false,
  setAddPanelOpen: (v) => set({ addPanelOpen: v }),
  templatePanelOpen: false,
  setTemplatePanelOpen: (v) => set({ templatePanelOpen: v }),
  capabilityBayOpenRequest: null,
  requestCapabilityBayForFlow: (flowId) => {
    const normalizedFlowId = String(flowId || '').trim()
    if (!normalizedFlowId) return
    set({
      capabilityBayOpenRequest: {
        requestKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        flowId: normalizedFlowId,
      },
    })
  },
  clearCapabilityBayOpenRequest: () => set({ capabilityBayOpenRequest: null }),
  activePanel: null,
  setActivePanel: (p) => set((state) => (state.activePanel === p ? state : { activePanel: p })),
  aiChatOpen: false,
  setAiChatOpen: (v) => set((s) => (s.aiChatOpen === v ? s : { aiChatOpen: v })),
  directorChatScopeNodeId: null,
  setDirectorChatScopeNodeId: (id) => set((s) => (s.directorChatScopeNodeId === id ? s : { directorChatScopeNodeId: id })),
  assetManagerOpen: false,
  assetManagerTab: 'canvas',
  toggleAssetManager: () => set((s) => ({ assetManagerOpen: !s.assetManagerOpen })),
  openAssetManager: (tab) => set((s) => ({ assetManagerOpen: true, assetManagerTab: tab ?? s.assetManagerTab })),
  closeAssetManager: () => set({ assetManagerOpen: false }),
  setAssetManagerTab: (tab) => set((s) => (s.assetManagerTab === tab ? s : { assetManagerTab: tab })),
  assetPanelTab: 'materials',
  setAssetPanelTab: (tab) => set({ assetPanelTab: tab }),
  assetPanelMaterialCategory: 'docs',
  setAssetPanelMaterialCategory: (category) => set({ assetPanelMaterialCategory: category }),
  assetPanelFocusRequest: null,
  requestAssetPanelFocus: (request) =>
    set({
      assetPanelFocusRequest: {
        ...request,
        requestKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
    }),
  clearAssetPanelFocusRequest: () => set({ assetPanelFocusRequest: null }),
  assetPanelStoryboardRunRequest: null,
  requestAssetPanelStoryboardRun: (request) =>
    set({
      assetPanelStoryboardRunRequest: {
        ...request,
        requestKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
    }),
  clearAssetPanelStoryboardRunRequest: () => set({ assetPanelStoryboardRunRequest: null }),
  canvasReferencePicker: null,
  openCanvasReferencePicker: (payload) => {
    const targetNodeId = String(payload.targetNodeId || '').trim()
    if (!targetNodeId) return
    const blockedSourceNodeIds = Array.from(
      new Set(
        (Array.isArray(payload.blockedSourceNodeIds) ? payload.blockedSourceNodeIds : [])
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean),
      ),
    )
    set({
      canvasReferencePicker: {
        targetNodeId,
        blockedSourceNodeIds,
      },
    })
  },
  closeCanvasReferencePicker: () => set({ canvasReferencePicker: null }),
  panelAnchorY: null,
  setPanelAnchorY: (y) => set((state) => {
    const next = typeof y === 'number' && Number.isFinite(y) ? y : null
    return state.panelAnchorY === next ? state : { panelAnchorY: next }
  }),
  panelAnchorX: null,
  setPanelAnchorX: (x) => set((state) => {
    const next = typeof x === 'number' && Number.isFinite(x) ? x : null
    return state.panelAnchorX === next ? state : { panelAnchorX: next }
  }),
  paramNodeId: null,
  openParamFor: (id) => set({ paramNodeId: id }),
  closeParam: () => set({ paramNodeId: null }),
  preview: null,
  openPreview: (m) => set({ preview: m }),
  closePreview: () => set({ preview: null }),
  edgeRoute: 'smooth',
  toggleEdgeRoute: () => set((s) => ({ edgeRoute: s.edgeRoute === 'smooth' ? 'orth' : 'smooth' })),
  currentFlow: { id: null, name: '未命名', source: 'local', ownerType: 'project', ownerId: null },
  setCurrentFlow: (patch) => set((s) => ({ currentFlow: { ...s.currentFlow, ...(patch||{}) } })),
  currentChapter: null,
  setCurrentChapter: (v) => set({ currentChapter: v }),
  currentChapterCreativeOverride: null,
  setCurrentChapterCreativeOverride: (value) => set({ currentChapterCreativeOverride: value }),
  canvasViewport: null,
  setCanvasViewport: (v) => set({ canvasViewport: v }),
  restoreViewport: null,
  setRestoreViewport: (v) => set({ restoreViewport: v }),
  isDirty: false,
  setDirty: (v) => set((state) => (state.isDirty === v ? state : { isDirty: v })),
  currentProject: null,
  setCurrentProject: (p) => set({ currentProject: p }),
  activeWorkflow: null,
  setActiveWorkflow: (workflow) => set({ activeWorkflow: workflow }),
  assetPersistenceEnabled: getInitialAssetPersistence(),
  setAssetPersistenceEnabled: (v) => {
    set({ assetPersistenceEnabled: v })
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('tapcanvas_asset_persist', v ? '1' : '0')
      } catch {
        // ignore
      }
    }
  },
  publicApiKey: readStoredPublicApiKey(),
  setPublicApiKey: (v) => {
    const next = String(v || '').trim()
    set({ publicApiKey: next })
    writeStoredPublicApiKey(next)
  },
  publicVendorCandidates: readStoredPublicVendorCandidates(),
  setPublicVendorCandidates: (v) => {
    const next = Array.from(
      new Set((Array.isArray(v) ? v : []).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)),
    )
    set({ publicVendorCandidates: next })
    writeStoredPublicVendorCandidates(next)
  },
  storyboardGenerateMode: readStoredStoryboardGenerateMode(),
  setStoryboardGenerateMode: (v) => {
    const next: 'single' | 'full' = v === 'full' ? 'full' : 'single'
    set({ storyboardGenerateMode: next })
    writeStoredStoryboardGenerateMode(next)
  },
  storyboardGenerateGrid: readStoredStoryboardGenerateGrid(),
  setStoryboardGenerateGrid: (v) => {
    const next: 4 | 9 = v === 9 ? 9 : 4
    set({ storyboardGenerateGrid: next })
    writeStoredStoryboardGenerateGrid(next)
  },
  storyboardOutputAspectRatio: readStoredStoryboardOutputAspectRatio(),
  setStoryboardOutputAspectRatio: (v) => {
    const next = normalizeStoryboardOutputAspectRatio(v)
    set({ storyboardOutputAspectRatio: next })
    writeStoredStoryboardOutputAspectRatio(next)
  },
  aiChatWatchAssetsEnabled: readStoredAiChatWatchAssets(),
  setAiChatWatchAssetsEnabled: (v) => {
    set({ aiChatWatchAssetsEnabled: v })
    writeStoredAiChatWatchAssets(v)
  },
  creationSession: null,
  restoreCreationSession: (payload) => {
    const restored = normalizePersistedCreationSession(payload)
    set({
      creationSession: restored,
    })
  },
  syncCreationSessionCheckpoint: (payload) => {
    const nextUpdatedAt = Number.isFinite(payload.updatedAt) ? Number(payload.updatedAt) : Date.now()
    const nextIndex = Math.max(0, Math.trunc(payload.currentIndex))
    const nextTotalRaw = Number(payload.total)
    const nextTotal = Number.isFinite(nextTotalRaw)
      ? Math.max(nextIndex, Math.trunc(nextTotalRaw))
      : nextIndex
    const current = get().creationSession
    const shouldReplace = !current
      || current.id !== payload.id
      || nextIndex > current.currentIndex
      || (nextIndex === current.currentIndex && nextUpdatedAt >= current.updatedAt)
    if (!shouldReplace) return
    set({
      creationSession: {
        id: payload.id,
        title: String(payload.title || '').trim() || current?.title || 'AI 创作',
        status: payload.status || current?.status || 'running',
        unitType: payload.unitType,
        currentIndex: nextIndex,
        total: nextTotal,
        currentNodeId: String(payload.currentNodeId || '').trim(),
        currentTaskId: String(payload.currentTaskId || '').trim(),
        summary: String(payload.summary || '').trim(),
        lastError: String(payload.lastError || '').trim(),
        history: current?.history ?? [],
        updatedAt: nextUpdatedAt,
      },
    })
  },
  commitCreationSessionUnit: (payload) => {
    const current = get().creationSession
    if (!current || current.id !== payload.id) return
    const committedIndex = Math.max(0, Math.trunc(payload.index))
    const nextTotalRaw = typeof payload.total === 'number' && Number.isFinite(payload.total)
      ? Math.max(committedIndex, Math.trunc(payload.total))
      : Math.max(current.total, committedIndex)
    const nextSummary = String(payload.summary || '').trim() || current.summary || '创作进度已保存'
    const nextNodeId = String(payload.nodeId || current.currentNodeId || '').trim()
    const nextStatus = payload.status || (payload.unitType === 'scene' ? 'paused' : 'running')
    const nextHistory =
      committedIndex > 0
        ? [
            ...(current.history || []).filter((item) => item.index !== committedIndex),
            {
              index: committedIndex,
              summary: nextSummary,
              nodeId: nextNodeId,
              confirmedAt: Date.now(),
            },
          ].slice(-12)
        : current.history
    set(() => ({
      creationSession: {
        ...current,
        unitType: payload.unitType,
        status: nextStatus,
        currentIndex: committedIndex,
        total: nextTotalRaw,
        currentNodeId: nextNodeId,
        summary: nextSummary,
        lastError: '',
        history: nextHistory,
        updatedAt: Date.now(),
      },
    }))
  },
  rollbackCreationSessionLastUnit: () => {
    const state = get()
    const current = state.creationSession
    if (!current || current.unitType !== 'scene') return
    const sortedHistory = [...(current.history || [])].sort((left, right) => left.index - right.index)
    if (!sortedHistory.length) return
    const removed = sortedHistory[sortedHistory.length - 1]
    const remainingHistory = sortedHistory.slice(0, -1)
    const latestRemaining = remainingHistory[remainingHistory.length - 1] || null
    const nextCurrentIndex = latestRemaining ? latestRemaining.index : 0
    const nextNodeId = latestRemaining?.nodeId ? String(latestRemaining.nodeId).trim() : ''
    const nextSummary = latestRemaining
      ? `已回退到场景 ${latestRemaining.index}。可继续下一场景，或重做当前结果。`
      : '已回退到起点。可重新开始当前场景创作。'
    set({
      creationSession: {
        ...current,
        status: 'paused',
        currentIndex: nextCurrentIndex,
        total: nextCurrentIndex,
        currentNodeId: nextNodeId,
        summary: nextSummary,
        lastError: '',
        history: remainingHistory,
        updatedAt: Date.now(),
      },
    })
  },
  pauseCreationSession: () => {
    const current = get().creationSession
    if (!current) return
    set({
      creationSession: {
        ...current,
        status: 'paused',
        summary: current.summary || '创作已暂停',
        updatedAt: Date.now(),
      },
    })
  },
  completeCreationSession: (summary) => {
    const current = get().creationSession
    if (!current) return
    const nextSummary = String(summary || '').trim() || current.summary || '创作已完成'
    const completedWithoutProgress =
      current.currentIndex <= 0 &&
      current.total <= 0 &&
      !String(current.lastError || '').trim()
    // If nothing was created, don't pin a large progress card.
    if (completedWithoutProgress && nextSummary.includes('未生成新的画布场景')) {
      set({
        creationSession: null,
      })
      return
    }
    set({
      creationSession: {
        ...current,
        status: 'completed',
        summary: nextSummary,
        updatedAt: Date.now(),
      },
    })
  },
  failCreationSession: (message) => {
    const current = get().creationSession
    if (!current) return
    set({
      creationSession: {
        ...current,
        status: 'failed',
        lastError: String(message || '').trim(),
        summary: '创作失败',
        updatedAt: Date.now(),
      },
    })
  },
  clearCreationSession: () => set({
    creationSession: null,
  }),
  activeStyleBibleReferenceImages: [],
  setActiveStyleBibleReferenceImages: (images) => {
    const next = (Array.isArray(images) ? images : [])
      .map((u) => (typeof u === 'string' ? u.trim() : ''))
      .filter(Boolean)
    set((state) => {
      if (
        state.activeStyleBibleReferenceImages.length === next.length &&
        state.activeStyleBibleReferenceImages.every((u, i) => u === next[i])
      ) return state
      return { activeStyleBibleReferenceImages: next }
    })
  },
  // 风格参考图不再持久化到浏览器 localStorage：activeStyleBible 仅存内存，
  // 由当前所选书的服务端 styleBible 派生，避免跨项目串味（新建项目自然为空）。
  activeStyleBible: null,
  setActiveStyleBible: (bible) => {
    if (!bible) {
      set({ activeStyleBible: null })
      return
    }
    const refs = (Array.isArray(bible.referenceImages) ? bible.referenceImages : [])
      .map((u) => (typeof u === 'string' ? u.trim() : ''))
      .filter(Boolean)
    if (refs.length === 0) {
      set({ activeStyleBible: null })
      return
    }
    const styleName = typeof bible.styleName === 'string' && bible.styleName.trim()
      ? bible.styleName.trim()
      : ''
    const next = { styleName, referenceImages: refs }
    set({ activeStyleBible: next })
  },
  styleReferenceRequest: null,
  requestStyleReference: (req) => {
    const token = get().styleReferenceRequest ? get().styleReferenceRequest!.token + 1 : 1
    set({ styleReferenceRequest: { reason: req.reason, onResolved: req.onResolved, token } })
  },
  resolveStyleReferenceRequest: (refs) => {
    const cur = get().styleReferenceRequest
    set({ styleReferenceRequest: null })
    if (cur?.onResolved) cur.onResolved(Array.isArray(refs) ? refs : [])
  },
  cancelStyleReferenceRequest: () => set({ styleReferenceRequest: null }),
}))
