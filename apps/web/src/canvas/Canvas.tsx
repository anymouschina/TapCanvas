import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  useStore,
  NodeTypes,
  ConnectionLineType,
  ReactFlowProvider,
  EdgeTypes,
  getBezierPath,
  type ConnectionLineComponentProps,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import TaskNode from './nodes/TaskNode'
import IONode from './nodes/IONode'
import GroupNode from './nodes/GroupNode'
import { useRFStore } from './store'
import { toast } from '../ui/toast'
import { applyTemplateAt } from '../templates'
import { Paper, Stack, Button, Divider, Group, Text, Modal, TextInput, Textarea, Menu, useMantineColorScheme, useMantineTheme } from '@mantine/core'
import { IconBoxMultiple, IconBrackets, IconLayoutGrid, IconLayoutGridAdd, IconPhoto, IconPlayerPlay, IconTypography, IconVideo } from '@tabler/icons-react'
import { getCurrentLanguage, setLanguage, $, $t } from './i18n'
import TypedEdge from './edges/TypedEdge'
import OrthTypedEdge from './edges/OrthTypedEdge'
import { useUIStore } from '../ui/uiStore'
import { runFlowDag } from '../runner/dag'
import { syncGenericVideoNodeOnce, syncImageNodeOnce } from '../runner/remoteRunner'
import { useInsertMenuStore } from './insertMenuStore'
import { getHandleTypeLabel } from './utils/handleLabels'
import { subscribeTaskProgress, type TaskProgressEventMessage } from '../api/taskProgress'
import { useAuth } from '../auth/store'
import { createServerAsset, listProjectFlows, listProjects, recoverUploadedServerAssetFile, saveProjectFlow, updateProjectTemplate, upsertProject, uploadServerAssetFile, type ProjectDto } from '../api/server'
import { genTaskNodeId } from './nodes/taskNodeHelpers'
import { CANVAS_CONFIG } from './utils/constants'
import { buildEdgeValidator } from './utils/edgeRules'
import { buildCanvasThemeColors } from './utils/canvasTheme'
import {
  getTaskNodeCoreType,
  getTaskNodeSchema,
  listTaskNodeSchemas,
  type TaskNodeHandleConfig,
  type TaskNodeSchema,
} from './nodes/taskNodeSchema'
import { usePreventBrowserSwipeNavigation } from '../utils/usePreventBrowserSwipeNavigation'
import { formatErrorMessage } from './utils/formatErrorMessage'
import { getPointToRectDistance, screenPathIntersectsRect } from './utils/connectionAutoSnap'
import { getNodeAbsPosition, getNodeSize } from './utils/nodeBounds'
import { downloadGroupAssets } from './utils/groupAssetDownload'
import { GroupTemplateModal, type TemplateSaveMode, type TemplateVisibility } from './components/GroupTemplateModal'
import { extractCanvasGraph, type CanvasImportData } from './utils/serialization'
import { getTapImageDragPayload } from './dnd/setTapImageDragData'
import { buildStoryboardEditorPatch, normalizeStoryboardNodeData } from './nodes/taskNode/storyboardEditor'
import { resourceManager } from '../domain/resource-runtime'
import { useUploadRuntimeStore } from '../domain/upload-runtime/store/uploadRuntimeStore'
import { dedupeLocalFiles } from '../utils/localUploadDedup'
import { CanvasRenderContext } from './CanvasRenderContext'
import { PanelCard } from '../ui/PanelCard'
// 限制不同节点类型之间的连接关系；未匹配的类型默认放行，避免阻塞用户操作
const isValidEdgeByType = buildEdgeValidator()

const NODE_TYPES = Object.freeze({
  taskNode: TaskNode,
  ioNode: IONode,
  groupNode: GroupNode,
}) as unknown as NodeTypes

const EDGE_TYPES = Object.freeze({
  typed: TypedEdge,
  orth: OrthTypedEdge,
}) as unknown as EdgeTypes

const INSERT_MENU_EXCLUDED_KINDS = new Set<string>()

type InsertMenuSchemaCandidate = {
  schema: TaskNodeSchema
  targetHandleId: string
}

const joinClassNames = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(' ')

const areStringArraysEqual = (a: string[], b: string[]) => {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

type RFStoreState = ReturnType<typeof useRFStore.getState>

type NodePrimaryImageBinding = {
  imageUrl: string | null
  nodeId: string
}

type SelectedNodeSummary = {
  id: string
  kind: string
  parentId: string
  prompt: string
  text: string
  type: FlowNode['type']
}

const normalizeImageUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const resolveNodePrimaryImageUrl = (node: FlowNode): string | null => {
  if (node.type !== 'taskNode') return null
  const data = (node.data ?? {}) as Record<string, unknown>
  const imageResults = Array.isArray(data.imageResults) ? data.imageResults : []
  const imagePrimaryIndexRaw = typeof data.imagePrimaryIndex === 'number'
    ? data.imagePrimaryIndex
    : Number(data.imagePrimaryIndex)
  const imagePrimaryIndex = Number.isFinite(imagePrimaryIndexRaw)
    ? Math.max(0, Math.floor(imagePrimaryIndexRaw))
    : 0

  const preferredResult = imageResults[imagePrimaryIndex]
  if (preferredResult && typeof preferredResult === 'object') {
    const preferredUrl = normalizeImageUrl((preferredResult as { url?: unknown }).url)
    if (preferredUrl) return preferredUrl
  }

  for (const result of imageResults) {
    if (!result || typeof result !== 'object') continue
    const url = normalizeImageUrl((result as { url?: unknown }).url)
    if (url) return url
  }

  return normalizeImageUrl(data.imageUrl)
}

const selectNodePrimaryImageBindings = (state: RFStoreState): NodePrimaryImageBinding[] =>
  state.nodes.map((node) => ({
    nodeId: String(node.id),
    imageUrl: resolveNodePrimaryImageUrl(node as FlowNode),
  }))

const areNodePrimaryImageBindingsEqual = (a: NodePrimaryImageBinding[], b: NodePrimaryImageBinding[]) => {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (a[index]?.nodeId !== b[index]?.nodeId) return false
    if (a[index]?.imageUrl !== b[index]?.imageUrl) return false
  }
  return true
}

const selectSelectedNodeIds = (state: RFStoreState): string[] =>
  state.nodes.reduce<string[]>((acc, node) => {
    if (node.selected) acc.push(String(node.id))
    return acc
  }, [])

const readSelectedNodeSummary = (node: FlowNode): SelectedNodeSummary => {
  const data = node.data && typeof node.data === 'object'
    ? node.data as Record<string, unknown>
    : null
  return {
    id: String(node.id),
    kind: typeof data?.kind === 'string' ? data.kind.trim() : '',
    parentId: typeof node.parentId === 'string' ? node.parentId.trim() : '',
    prompt: typeof data?.prompt === 'string' ? data.prompt.trim() : '',
    text: typeof data?.text === 'string' ? data.text.trim() : '',
    type: node.type,
  }
}

const selectSelectedNodeSummaries = (state: RFStoreState): SelectedNodeSummary[] =>
  state.nodes.reduce<SelectedNodeSummary[]>((acc, node) => {
    if (node.selected) acc.push(readSelectedNodeSummary(node as FlowNode))
    return acc
  }, [])

const areSelectedNodeSummariesEqual = (a: SelectedNodeSummary[], b: SelectedNodeSummary[]) => {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]
    const right = b[index]
    if (left?.id !== right?.id) return false
    if (left?.type !== right?.type) return false
    if (left?.parentId !== right?.parentId) return false
    if (left?.kind !== right?.kind) return false
    if (left?.prompt !== right?.prompt) return false
    if (left?.text !== right?.text) return false
  }
  return true
}

type PrimaryImageDragPayload = {
  url: string
  label?: string
  prompt?: string
  storyboardScript?: string
  storyboardShotPrompt?: string
  storyboardDialogue?: string
  sourceKind: 'image'
  sourceNodeId: string
  sourceIndex: number
}

const resolveNodePrimaryImagePayload = (node: FlowNode): PrimaryImageDragPayload | null => {
  if (node.type !== 'taskNode') return null
  const data = (node.data ?? {}) as Record<string, unknown>
  const coreType = getTaskNodeCoreType(typeof data.kind === 'string' ? data.kind : undefined)
  if (coreType !== 'image') return null
  const imageResults = Array.isArray(data.imageResults) ? data.imageResults : []
  const imagePrimaryIndexRaw = typeof data.imagePrimaryIndex === 'number'
    ? data.imagePrimaryIndex
    : Number(data.imagePrimaryIndex)
  const imagePrimaryIndex = Number.isFinite(imagePrimaryIndexRaw)
    ? Math.max(0, Math.floor(imagePrimaryIndexRaw))
    : 0
  const result = imageResults[imagePrimaryIndex]
  const url = resolveNodePrimaryImageUrl(node)
  if (!url) return null
  const resultRecord = result && typeof result === 'object' ? result as Record<string, unknown> : null
  const pickText = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed || undefined
  }
  return {
    url,
    ...(pickText(resultRecord?.title ?? data.label) ? { label: pickText(resultRecord?.title ?? data.label) } : null),
    ...(pickText(resultRecord?.prompt ?? data.prompt) ? { prompt: pickText(resultRecord?.prompt ?? data.prompt) } : null),
    ...(pickText(resultRecord?.storyboardScript ?? data.storyboardScript) ? { storyboardScript: pickText(resultRecord?.storyboardScript ?? data.storyboardScript) } : null),
    ...(pickText(resultRecord?.storyboardShotPrompt ?? data.storyboardShotPrompt) ? { storyboardShotPrompt: pickText(resultRecord?.storyboardShotPrompt ?? data.storyboardShotPrompt) } : null),
    ...(pickText(resultRecord?.storyboardDialogue ?? data.storyboardDialogue) ? { storyboardDialogue: pickText(resultRecord?.storyboardDialogue ?? data.storyboardDialogue) } : null),
    sourceKind: 'image',
    sourceNodeId: String(node.id),
    sourceIndex: imagePrimaryIndex,
  }
}

const isCanvasReferencePickerCandidateNode = (node: FlowNode, targetNodeId: string): boolean => {
  if (node.id === targetNodeId || node.type !== 'taskNode') return false
  const data = (node.data ?? {}) as Record<string, unknown>
  const kind = typeof data.kind === 'string' ? data.kind : undefined
  return getTaskNodeCoreType(kind) === 'image' && Boolean(resolveNodePrimaryImageUrl(node))
}

type CanvasInnerProps = {
  className?: string
}

type CanvasStyle = React.CSSProperties & Record<'--tc-spotlight-grid-color' | '--tc-spotlight-radius', string>
type CanvasMiniMapProps = React.ComponentProps<typeof MiniMap>
type CanvasMiniMapClick = NonNullable<CanvasMiniMapProps['onClick']>
type CanvasMiniMapNodeClick = NonNullable<CanvasMiniMapProps['onNodeClick']>

const CANVAS_CONTEXT_ADDABLE_KINDS = ['text', 'image', 'storyboard', 'video'] as const
const NODE_VISIBILITY_FILTERS = ['text', 'image', 'storyboard', 'video'] as const
const HEAVY_SELECTION_DRAG_THRESHOLD = 6

type NodeVisibilityFilter = (typeof NODE_VISIBILITY_FILTERS)[number]
type NodeVisibilityState = Record<NodeVisibilityFilter, boolean>

type WorkflowNameDialogState = {
  mode: 'asset' | 'template'
  groupId: string
  title: string
  confirmLabel: string
  initialName: string
  initialDescription: string
  initialCoverUrl: string
  previewUrl: string | null
}

const DEFAULT_NODE_VISIBILITY: NodeVisibilityState = {
  text: true,
  image: true,
  storyboard: true,
  video: true,
}

type SelectionActionAnchor = {
  centerX: number
  selectedCount: number
  topY: number
}

const getNodeVisibilityFilter = (node: FlowNode): NodeVisibilityFilter | null => {
  if (node.type !== 'taskNode') return null
  const data = node.data
  if (!data || typeof data !== 'object') return 'text'
  const kind = typeof (data as Record<string, unknown>).kind === 'string'
    ? (data as Record<string, unknown>).kind as string
    : undefined
  const coreType = getTaskNodeCoreType(kind)
  if (coreType === 'video') return 'video'
  if (coreType === 'storyboard') return 'storyboard'
  if (coreType === 'image') return 'image'
  return 'text'
}

const isNodeVisibleByFilter = (node: FlowNode, visibility: NodeVisibilityState): boolean => {
  const filter = getNodeVisibilityFilter(node)
  if (!filter) return true
  return visibility[filter]
}

const buildNodeVisibilityLabel = (filter: NodeVisibilityFilter): string => {
  if (filter === 'text') return '文本'
  if (filter === 'image') return '图片'
  if (filter === 'storyboard') return '分镜'
  return '视频'
}

const getNodeVisibilityIcon = (filter: NodeVisibilityFilter) => {
  if (filter === 'text') return IconTypography
  if (filter === 'image') return IconPhoto
  if (filter === 'storyboard') return IconLayoutGrid
  return IconVideo
}

const getStaticTargetHandles = (schema: TaskNodeSchema): TaskNodeHandleConfig[] => {
  const handles = schema.handles
  if (!handles || ('dynamic' in handles && handles.dynamic)) return []
  return Array.isArray(handles.targets) ? handles.targets : []
}

function CanvasInner({ className }: CanvasInnerProps): JSX.Element {
  const nodes = useRFStore((s) => s.nodes)
  const edges = useRFStore((s) => s.edges)
  const nodePrimaryImageBindings = useRFStore(selectNodePrimaryImageBindings, areNodePrimaryImageBindingsEqual)
  const selectedNodeIds = useRFStore(selectSelectedNodeIds, areStringArraysEqual)
  const selectedNodeSummaries = useRFStore(selectSelectedNodeSummaries, areSelectedNodeSummariesEqual)
  const onNodesChange = useRFStore((s) => s.onNodesChange)
  const onEdgesChange = useRFStore((s) => s.onEdgesChange)
  const onConnect = useRFStore((s) => s.onConnect)
  const load = useRFStore((s) => s.load)
  const focusedNodeId = useUIStore(s => s.focusedNodeId)
  const viewOnly = useUIStore(s => s.viewOnly)
  const edgeRoute = useUIStore(s => s.edgeRoute)
  const currentProject = useUIStore(s => s.currentProject)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const setPanelAnchorY = useUIStore(s => s.setPanelAnchorY)
  const focusNodeSubgraph = useUIStore(s => s.focusNodeSubgraph)
  const clearFocusedSubgraph = useUIStore(s => s.clearFocusedSubgraph)
  const setCanvasViewport = useUIStore(s => s.setCanvasViewport)
  const restoreViewport = useUIStore(s => s.restoreViewport)
  const setRestoreViewport = useUIStore(s => s.setRestoreViewport)
  const canvasReferencePicker = useUIStore((s) => s.canvasReferencePicker)
  const closeCanvasReferencePicker = useUIStore((s) => s.closeCanvasReferencePicker)
  const deleteNode = useRFStore(s => s.deleteNode)
  const deleteEdge = useRFStore(s => s.deleteEdge)
  const duplicateNode = useRFStore(s => s.duplicateNode)
  const pasteFromClipboardAt = useRFStore(s => s.pasteFromClipboardAt)
  const importWorkflow = useRFStore(s => s.importWorkflow)
  const addGroupForSelection = useRFStore(s => s.addGroupForSelection)
  const createScriptBundleFromSelection = useRFStore(s => s.createScriptBundleFromSelection)
  const ungroupGroupNode = useRFStore(s => s.ungroupGroupNode)
  const arrangeGroupChildren = useRFStore(s => s.arrangeGroupChildren)
  const formatTree = useRFStore(s => s.formatTree)
  const cancelNode = useRFStore(s => s.cancelNode)
  const setNodeStatus = useRFStore(s => s.setNodeStatus)
  const addNode = useRFStore(s => s.addNode)
  const rf = useReactFlow()
  const theme = useMantineTheme()
  const previousNodeImageMapRef = useRef<Map<string, string | null>>(new Map())

  useEffect(() => {
    const previousMap = previousNodeImageMapRef.current
    const nextMap = new Map<string, string | null>()
    for (const binding of nodePrimaryImageBindings) {
      nextMap.set(binding.nodeId, binding.imageUrl)
    }
    for (const [nodeId, previousUrl] of previousMap.entries()) {
      if (!nextMap.has(nodeId)) {
        resourceManager.releaseNodeResources(nodeId)
        continue
      }
      const nextUrl = nextMap.get(nodeId) ?? null
      if (previousUrl && nextUrl && previousUrl !== nextUrl) {
        const previousResourceId = resourceManager.buildResourceId({
          url: previousUrl,
          kind: 'image',
          variantKey: 'original',
        })
        resourceManager.releaseImage(previousResourceId)
      }
    }
    previousNodeImageMapRef.current = nextMap
  }, [nodePrimaryImageBindings])
  const { colorScheme } = useMantineColorScheme()
  const resolvedColorScheme = colorScheme === 'auto' ? 'dark' : colorScheme
  const isDarkCanvas = resolvedColorScheme === 'dark'
  const { backgroundGridColor } = buildCanvasThemeColors(theme, resolvedColorScheme)
  const spotlightGridColor = isDarkCanvas ? 'rgba(255,255,255,0.82)' : 'rgba(15,23,42,0.58)'
  const canvasStyle = useMemo<CanvasStyle>(() => ({
    height: '100%',
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    '--tc-spotlight-grid-color': spotlightGridColor,
    '--tc-spotlight-radius': isDarkCanvas ? '180px' : '168px',
  }), [isDarkCanvas, spotlightGridColor])
  const connectionLineStyle = useMemo(() => ({
    stroke: isDarkCanvas ? 'rgba(255,255,255,0.32)' : 'rgba(15,23,42,0.82)',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
  }), [isDarkCanvas])
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectingType, setConnectingType] = useState<string | null>(null)
  const lastReason = useRef<string | null>(null)
  const connectFromRef = useRef<{ nodeId: string; handleId: string | null } | null>(null)
  const didConnectRef = useRef(false)
  const [tapConnectSource, setTapConnectSource] = useState<{ nodeId: string } | null>(null)
  const [mouse, setMouse] = useState<{x:number;y:number}>({x:0,y:0})
  const [menu, setMenu] = useState<{ show: boolean; x: number; y: number; type: 'node'|'edge'|'canvas'; id?: string } | null>(null)
  const [guides, setGuides] = useState<{ vx?: number; hy?: number } | null>(null)
  const lastGuidesRef = useRef<{ vx?: number; hy?: number } | null>(null)
  const [longSelect, setLongSelect] = useState(false)
  const downPos = useRef<{x:number;y:number}|null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const viewportMoving = useStore((state) => state.paneDragging)
  const [stitchingGroupId, setStitchingGroupId] = useState<string | null>(null)
  const [runningGroupId, setRunningGroupId] = useState<string | null>(null)
  const [savingWorkflowGroupId, setSavingWorkflowGroupId] = useState<string | null>(null)
  const [publishingTemplateGroupId, setPublishingTemplateGroupId] = useState<string | null>(null)
  const [downloadingGroupAssetsId, setDownloadingGroupAssetsId] = useState<string | null>(null)
  const [workflowNameDialog, setWorkflowNameDialog] = useState<WorkflowNameDialogState | null>(null)
  const [workflowNameInput, setWorkflowNameInput] = useState('')
  const [workflowDescriptionInput, setWorkflowDescriptionInput] = useState('')
  const [workflowCoverUrlInput, setWorkflowCoverUrlInput] = useState('')
  const [templateSaveMode, setTemplateSaveMode] = useState<TemplateSaveMode>('create')
  const [templateVisibility, setTemplateVisibility] = useState<TemplateVisibility>('private')
  const [templateProjects, setTemplateProjects] = useState<ProjectDto[]>([])
  const [selectedTemplateProjectId, setSelectedTemplateProjectId] = useState('')
  const [templateCoverUploading, setTemplateCoverUploading] = useState(false)
  const [currentLang, setCurrentLangState] = useState(getCurrentLanguage())
  const insertMenu = useInsertMenuStore(s => ({ open: s.open, x: s.x, y: s.y, edgeId: s.edgeId, fromNodeId: s.fromNodeId, fromHandle: s.fromHandle }))
  const closeInsertMenu = useInsertMenuStore(s => s.closeMenu)
  const authToken = useAuth(s => s.token)
  const templateCoverUploadInputRef = useRef<HTMLInputElement | null>(null)
  const viewOnlyFormattedOnceRef = useRef(false)
  const soraSyncingRef = useRef<Set<string>>(new Set())
  const imageSyncingRef = useRef<Set<string>>(new Set())
  const rootRef = useRef<HTMLDivElement | null>(null)
  const spotlightFrameRef = useRef<number | null>(null)
  const spotlightClientPointRef = useRef<{ x: number; y: number } | null>(null)
  const lastMeasuredCanvasWidthRef = useRef<number | null>(null)
  const initialFitAppliedRef = useRef(false)
  const restoreAppliedRef = useRef(false)
  const lastPointerScreenRef = useRef<{ x: number; y: number } | null>(null)
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null)
  const pendingImageUploadScreenRef = useRef<{ x: number; y: number } | null>(null)
  const [nodeVisibility, setNodeVisibility] = useState<NodeVisibilityState>(DEFAULT_NODE_VISIBILITY)

  usePreventBrowserSwipeNavigation({ rootRef, withinSelector: '.tc-canvas__flow' })

  const isImageFile = (file: File) => Boolean(file?.type?.startsWith('image/'))

  const setSpotlightVisible = useCallback((visible: boolean) => {
    const root = rootRef.current
    if (!root) return
    root.style.setProperty('--tc-spotlight-opacity', visible ? '1' : '0')
  }, [])

  const flushSpotlightPosition = useCallback(() => {
    spotlightFrameRef.current = null
    const root = rootRef.current
    const point = spotlightClientPointRef.current
    if (!root || !point) return
    const rect = root.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const localX = Math.max(0, Math.min(rect.width, point.x - rect.left))
    const localY = Math.max(0, Math.min(rect.height, point.y - rect.top))
    root.style.setProperty('--tc-spotlight-x', `${Math.round(localX)}px`)
    root.style.setProperty('--tc-spotlight-y', `${Math.round(localY)}px`)
  }, [])

  const queueSpotlightPosition = useCallback((clientX: number, clientY: number) => {
    spotlightClientPointRef.current = { x: clientX, y: clientY }
    if (spotlightFrameRef.current !== null) return
    spotlightFrameRef.current = window.requestAnimationFrame(flushSpotlightPosition)
  }, [flushSpotlightPosition])

  useEffect(() => () => {
    if (spotlightFrameRef.current !== null) {
      window.cancelAnimationFrame(spotlightFrameRef.current)
    }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (viewportMoving) {
      root.setAttribute('data-canvas-viewport-moving', 'true')
      setSpotlightVisible(false)
      resourceManager.setViewportMoving(true)
    } else {
      root.removeAttribute('data-canvas-viewport-moving')
      resourceManager.setViewportMoving(false)
    }
    return () => {
      root.removeAttribute('data-canvas-viewport-moving')
      resourceManager.setViewportMoving(false)
    }
  }, [setSpotlightVisible, viewportMoving])

  const deriveLabelFromFileName = (name: string): string => {
    const trimmed = (name || '').trim()
    if (!trimmed) return 'Image'
    const base = trimmed.replace(/\.[a-z0-9]+$/i, '').trim()
    return base || 'Image'
  }

  const getFallbackScreenPoint = useCallback((): { x: number; y: number } => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  }, [])

  const importImagesFromFiles = useCallback(async (files: File[], basePosFlow?: { x: number; y: number }) => {
    if (viewOnly) return
    const images = (files || []).filter(isImageFile)
    if (!images.length) return

    const deduped = dedupeLocalFiles(images, (file) => deriveLabelFromFileName(file.name))
    if (deduped.skippedCount > 0) {
      useUploadRuntimeStore.getState().recordDuplicateBlocked(deduped.skippedCount)
      toast(`已跳过 ${deduped.skippedCount} 个同批次重复文件`, 'info')
    }

    const MAX_BYTES = 30 * 1024 * 1024
    const tooLarge = deduped.uniqueFiles.filter((f) => (typeof f.size === 'number' ? f.size : 0) > MAX_BYTES)
    if (tooLarge.length) {
      toast(`有 ${tooLarge.length} 张图片超过 30MB，已跳过`, 'error')
    }
    const valid = deduped.uniqueFiles.filter((f) => (typeof f.size === 'number' ? f.size : 0) <= MAX_BYTES)
    if (!valid.length) return

    const base = basePosFlow ?? rf.screenToFlowPosition(lastPointerScreenRef.current ?? getFallbackScreenPoint())
    const cols = 3
    const spacingX = CANVAS_CONFIG.NODE_SPACING_X + 60
    const spacingY = CANVAS_CONFIG.NODE_SPACING_Y + 40
    const snapshotGraph = (nodes: any[], edges: any[]) => JSON.parse(JSON.stringify({ nodes, edges })) as { nodes: any[]; edges: any[] }

    const prepared = valid.map((file, idx) => {
      const id = genTaskNodeId()
      const label = deriveLabelFromFileName(file.name)
      const localUrl = URL.createObjectURL(file)
      const position = {
        x: base.x + (idx % cols) * spacingX,
        y: base.y + Math.floor(idx / cols) * spacingY,
      }
      return { id, file, label, localUrl, position }
    })

    useRFStore.setState((s) => {
      const newNodes = prepared.map(({ id, label, localUrl, position }) => ({
        id,
        type: 'taskNode' as const,
        position,
        data: {
          label,
          kind: 'image',
          imageUrl: localUrl,
          nodeWidth: 120,
          nodeHeight: 210,
        },
        selected: false,
      }))
      return { nodes: [...s.nodes, ...newNodes], nextId: s.nextId + newNodes.length }
    })

    const { updateNodeData } = useRFStore.getState()
    let successCount = 0
    let hostingFailedCount = 0
    for (const { id, file, localUrl, label } of prepared) {
      try {
        let hostedUrl: string | null = null
        let hostedAssetId: string | null = null
        try {
          const hosted = await uploadServerAssetFile(file, label, { ownerNodeId: id })
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

        if (hostedUrl) successCount += 1
        else hostingFailedCount += 1

        const bestUrl = hostedUrl || localUrl

        updateNodeData(id, {
          imageUrl: bestUrl,
          serverAssetId: hostedAssetId,
        })
        if (bestUrl !== localUrl) {
          URL.revokeObjectURL(localUrl)
        }
      } catch (error) {
        console.error('Failed to process pasted image:', error)
        toast('处理粘贴图片失败，请稍后再试', 'error')
      }
    }

    if (hostingFailedCount > 0) {
      if (successCount > 0) {
        toast(`有 ${hostingFailedCount} 张图片未能托管到 OSS/R2，已使用本地预览`, 'info')
      } else {
        toast('图片已添加到画布，但未能托管到 OSS/R2，将使用本地预览（远程任务需要可访问链接）', 'error')
      }
    }

    if (successCount > 0 && prepared.length > 1) {
      useRFStore.setState((s) => {
        const ids = new Set(prepared.map((p) => p.id))
        const ordered = prepared.map((p, idx) => ({
          id: p.id,
          position: {
            x: base.x + (idx % cols) * spacingX,
            y: base.y + Math.floor(idx / cols) * spacingY,
          },
        }))
        const posById = new Map(ordered.map((o) => [o.id, o.position] as const))
        const past = [...s.historyPast, snapshotGraph(s.nodes, s.edges)].slice(-50)
        return {
          nodes: s.nodes.map((n) => (ids.has(n.id) ? { ...n, position: posById.get(n.id)! } : n)),
          historyPast: past,
          historyFuture: [],
        }
      })
    }
  }, [getFallbackScreenPoint, rf, viewOnly])

  const importImageNodeFromDraggedFrame = useCallback(async (
    payload: { url?: string; remoteUrl?: string | null; time?: number },
    posFlow: { x: number; y: number },
  ) => {
    if (viewOnly) return
    const remoteUrl = typeof payload?.remoteUrl === 'string' ? payload.remoteUrl.trim() : ''
    const srcUrl = typeof payload?.url === 'string' ? payload.url.trim() : ''
    const preferred = remoteUrl || srcUrl
    if (!preferred) return

    if (!preferred.startsWith('blob:')) {
      const nodeId = genTaskNodeId()
      useRFStore.setState((s) => {
        const time = typeof payload?.time === 'number' && Number.isFinite(payload.time) ? payload.time : null
        const label = time !== null ? `Frame ${time.toFixed(2)}s` : 'Frame'
        const node = {
          id: nodeId,
          type: 'taskNode' as const,
          position: posFlow,
          data: {
            label,
            kind: 'image',
            imageUrl: preferred,
            imageResults: [{ url: preferred }],
            imagePrimaryIndex: 0,
            nodeWidth: 120,
            nodeHeight: 210,
          },
          selected: false,
        }
        return { nodes: [...s.nodes, node], nextId: s.nextId + 1 }
      })
      if ((window as any).silentSaveProject) {
        (window as any).silentSaveProject()
      }
      return
    }

    let blob: Blob
    try {
      const res = await fetch(preferred)
      if (!res.ok) {
        toast('读取帧图片失败，请稍后重试', 'error')
        return
      }
      blob = await res.blob()
    } catch (error) {
      console.error('Failed to fetch dragged frame:', error)
      toast('读取帧图片失败，请稍后重试', 'error')
      return
    }

    const MAX_BYTES = 30 * 1024 * 1024
    const size = typeof (blob as any)?.size === 'number' ? (blob as any).size : 0
    if (size > MAX_BYTES) {
      toast('该帧图片超过 30MB，已取消导入', 'error')
      return
    }

    const time = typeof payload?.time === 'number' && Number.isFinite(payload.time) ? payload.time : null
    const ms = Math.max(0, Math.round((time ?? 0) * 1000))
    const mime = blob.type || 'image/png'
    const ext = mime.includes('jpeg') || mime.includes('jpg')
      ? 'jpg'
      : mime.includes('webp')
        ? 'webp'
        : 'png'
    const fileName = `frame-${ms || Date.now()}.${ext}`
    const label = time !== null ? `Frame ${time.toFixed(2)}s` : 'Frame'
    const file = new File([blob], fileName, { type: mime })

    const nodeId = genTaskNodeId()
    const localUrl = URL.createObjectURL(file)

    useRFStore.setState((s) => {
      const node = {
        id: nodeId,
        type: 'taskNode' as const,
        position: posFlow,
        data: {
          label,
          kind: 'image',
          imageUrl: localUrl,
          nodeWidth: 120,
          nodeHeight: 210,
        },
        selected: false,
      }
      return { nodes: [...s.nodes, node], nextId: s.nextId + 1 }
    })

    const { updateNodeData } = useRFStore.getState()
    try {
      let hostedUrl: string | null = null
      let hostedAssetId: string | null = null
      try {
        const hosted = await uploadServerAssetFile(file, deriveLabelFromFileName(fileName), { ownerNodeId: nodeId })
        const url = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
        if (url) {
          hostedUrl = url
          hostedAssetId = hosted.id
        }
      } catch (error) {
        console.error('Failed to upload frame to OSS:', error)
      }

      const bestUrl = hostedUrl || localUrl

      updateNodeData(nodeId, {
        imageUrl: bestUrl,
        serverAssetId: hostedAssetId,
      })

      if (bestUrl !== localUrl) {
        URL.revokeObjectURL(localUrl)
      }
      if ((window as any).silentSaveProject) {
        (window as any).silentSaveProject()
      }
    } catch (error) {
      console.error('Failed to process dragged frame:', error)
      toast('处理帧图片失败，请稍后再试', 'error')
    }
  }, [deriveLabelFromFileName, viewOnly])

  const handleTaskProgress = useCallback((event: TaskProgressEventMessage) => {
    if (!event || !event.nodeId) return
    const { setNodeStatus, appendLog } = useRFStore.getState()
    const rawProgress = typeof event.progress === 'number' && Number.isFinite(event.progress)
      ? Math.max(0, Math.min(100, Math.round(event.progress)))
      : undefined
    const message = formatErrorMessage(event.message).trim()
    if (message) {
      const label = new Date(event.timestamp ?? Date.now()).toLocaleTimeString()
      appendLog(event.nodeId, `[${label}] ${message}`)
    }
    const progressPatch = rawProgress !== undefined ? { progress: rawProgress } : {}
    switch (event.status) {
      case 'queued':
        setNodeStatus(event.nodeId, 'queued', progressPatch)
        break
      case 'running':
        setNodeStatus(event.nodeId, 'running', progressPatch)
        break
      case 'succeeded':
        setNodeStatus(event.nodeId, 'success', rawProgress !== undefined ? progressPatch : { progress: 100 })
        break
      case 'failed':
        setNodeStatus(event.nodeId, 'error', {
          ...progressPatch,
          lastError: message || '任务执行失败',
        })
        break
      default:
        break
    }
  }, [])

  useEffect(() => {
    if (!authToken) return
    const unsubscribe = subscribeTaskProgress({
      token: authToken,
      onEvent: handleTaskProgress,
      onError: (err) => console.error('task progress stream error', err),
    })
    return () => {
      unsubscribe()
    }
  }, [authToken, handleTaskProgress])

  useEffect(() => {
    if (!authToken) return
    if (viewOnly) return

    const tick = () => {
      const state = useRFStore.getState()
      const list = (state.nodes || []) as any[]
      for (const n of list) {
        const data: any = n?.data || {}
        const kind = String(data.kind || '')
        const status = String(data.status || '')
        if (status !== 'running' && status !== 'queued') continue

        const nodeId = String(n.id || '')
        if (!nodeId) continue

        if (kind === 'video') {
          const vendor = String(data.videoModelVendor || data.videoVendor || '').toLowerCase()
          const taskId = typeof data.videoTaskId === 'string' ? data.videoTaskId.trim() : ''
          if (!taskId) continue

          if (soraSyncingRef.current.has(nodeId)) continue
          soraSyncingRef.current.add(nodeId)
          void syncGenericVideoNodeOnce(nodeId, useRFStore.getState).finally(() => {
            soraSyncingRef.current.delete(nodeId)
          })
          continue
        }

        const imageTaskId = typeof data.imageTaskId === 'string' ? data.imageTaskId.trim() : ''
        if (imageTaskId) {
          if (imageSyncingRef.current.has(nodeId)) continue
          imageSyncingRef.current.add(nodeId)
          void syncImageNodeOnce(nodeId, useRFStore.getState).finally(() => {
            imageSyncingRef.current.delete(nodeId)
          })
        }
      }
    }

    tick()
    const t = window.setInterval(tick, 4000)
    return () => window.clearInterval(t)
  }, [authToken, viewOnly])

  useEffect(() => {
    // initial: no local restore, rely on explicit load from server via UI
    setTimeout(() => rf.fitView?.({ padding: 0.2 }), 50)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return

    const syncViewportWithWidth = (width: number) => {
      if (!Number.isFinite(width) || width <= 0) return
      const nextWidth = Math.round(width)
      const prevWidth = lastMeasuredCanvasWidthRef.current
      lastMeasuredCanvasWidthRef.current = nextWidth
      if (prevWidth === null || prevWidth === nextWidth) return

      const viewport = rf.getViewport?.()
      const zoom = viewport?.zoom
      if (!viewport || !Number.isFinite(zoom) || zoom <= 0) return

      const deltaWidth = nextWidth - prevWidth
      const nextViewport = {
        x: viewport.x + deltaWidth / 2,
        y: viewport.y,
        zoom,
      }
      rf.setViewport?.(nextViewport, { duration: 220 })
      setCanvasViewport(nextViewport)
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      syncViewportWithWidth(entry.contentRect.width)
    })

    observer.observe(root)
    return () => {
      observer.disconnect()
    }
  }, [rf, setCanvasViewport])

  useEffect(() => {
    ;(window as any).__tcFocusNode = (nodeId: string) => {
      try {
        if (!nodeId) return
        // ensure node is visible
        useUIStore.getState().clearFocusedSubgraph()

        useRFStore.setState((s) => ({
          nodes: (s.nodes || []).map((n) => ({ ...n, selected: n.id === nodeId })),
        }))

        const allNodes = useRFStore.getState().nodes || []
        const node = allNodes.find((n) => n.id === nodeId)
        if (!node) return
        const nodesById = new Map(allNodes.map((n) => [n.id, n] as const))
        const abs = getNodeAbsPosition(node, nodesById)
        const size = getNodeSize(node)
        const x = abs.x + Math.max(1, size.w) / 2
        const y = abs.y + Math.max(1, size.h) / 2
        rf.setCenter?.(x, y, { zoom: Math.max((rf.getViewport?.().zoom ?? 1), 0.8), duration: 250 })
      } catch {
        // ignore
      }
    }
    return () => {
      try {
        if ((window as any).__tcFocusNode) delete (window as any).__tcFocusNode
      } catch {
        // ignore
      }
    }
  }, [rf])

  const applyDefaultZoom = useCallback(() => {
    const afterFit = rf.getViewport?.().zoom ?? 1
    const targetZoom = Math.max(Math.min(afterFit * DEFAULT_ZOOM_MULTIPLIER, MAX_ZOOM), MIN_ZOOM)
    rf.zoomTo?.(targetZoom, { duration: 0 })
    requestAnimationFrame(() => {
      const vp = rf.getViewport?.()
      if (vp) setCanvasViewport(vp)
    })
  }, [rf, setCanvasViewport])

  const onInit = useCallback(() => {
    if (!nodes.length) {
      requestAnimationFrame(() => {
        applyDefaultZoom()
      })
      return
    }
    rf.fitView?.({ padding: 0.2 })
    requestAnimationFrame(() => {
      applyDefaultZoom()
      initialFitAppliedRef.current = true
    })
  }, [applyDefaultZoom, nodes.length, rf])

  useEffect(() => {
    if (!restoreViewport) return
    rf.setViewport?.(restoreViewport, { duration: 0 })
    setCanvasViewport(restoreViewport)
    setRestoreViewport(null)
    restoreAppliedRef.current = true
    initialFitAppliedRef.current = true
  }, [restoreViewport, rf, setCanvasViewport, setRestoreViewport])

  // Backward-compat: some persisted canvases may include `dragHandle` on nodes, which restricts
  // dragging to a selector and can make nodes appear "undraggable". Strip it on mount.
  useEffect(() => {
    useRFStore.setState((s) => {
      const hasDragHandle = (s.nodes || []).some((n: any) => typeof n?.dragHandle !== 'undefined')
      if (!hasDragHandle) return {}
      const nodes = (s.nodes || []).map((n: any) => {
        if (!n || typeof n !== 'object') return n
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { dragHandle: _dragHandle, ...rest } = n
        return rest
      })
      return { nodes }
    })
  }, [])

  const onDragOver = useCallback((evt: React.DragEvent) => {
    evt.preventDefault()
    const types = Array.from(evt.dataTransfer.types || [])
    const hasFiles = types.includes('Files')
    const hasTapImage = types.includes('application/tap-image-url') || types.includes('application/tap-frame-sample')
    evt.dataTransfer.dropEffect = (hasFiles || hasTapImage) ? 'copy' : 'move'
  }, [])

  const onDrop = useCallback((evt: React.DragEvent) => {
    evt.preventDefault()
    // Dropping external files can end with a mouseup event inside the canvas.
    // If a stale "connecting" state exists (e.g. an interrupted connect gesture),
    // it may accidentally auto-snap to another node. Always cancel connecting on drop.
    setIsConnecting(false)
    setConnectingType(null)
    setTapConnectSource(null)
    connectFromRef.current = null
    didConnectRef.current = false
    lastReason.current = null
    const tplName = evt.dataTransfer.getData('application/tap-template')
    const rfdata = evt.dataTransfer.getData('application/reactflow')
    const flowRef = evt.dataTransfer.getData('application/tapflow')
    const tapImageUrl = evt.dataTransfer.getData('application/tap-image-url')
    const tapFrameSample = evt.dataTransfer.getData('application/tap-frame-sample')
    const pos = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY })
    const imageFiles = Array.from(evt.dataTransfer.files || []).filter(isImageFile)
    if (imageFiles.length) {
      void importImagesFromFiles(imageFiles, pos)
      return
    }
    if (tapFrameSample) {
      try {
        const payload = JSON.parse(tapFrameSample) as { url?: string; remoteUrl?: string | null; time?: number }
        void importImageNodeFromDraggedFrame(payload, pos)
        return
      } catch {
        // fallthrough
      }
    }
    if (tapImageUrl) {
      const payload = getTapImageDragPayload(evt.dataTransfer)
      const trimmed = typeof payload?.url === 'string' ? payload.url.trim() : ''
      if (trimmed) {
        if (trimmed.startsWith('blob:')) {
          void importImageNodeFromDraggedFrame({ url: trimmed, remoteUrl: null }, pos)
          return
        }
        useRFStore.setState((s) => {
          const trimText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
          const label = trimText(payload?.label) || 'Image'
          const basePrompt = trimText(payload?.prompt)
          const shotPrompt = trimText(payload?.storyboardShotPrompt)
          const script = trimText(payload?.storyboardScript)
          const dialogue = trimText(payload?.storyboardDialogue)
          const combinedPrompt = [basePrompt, shotPrompt ? `镜头剧本：${shotPrompt}` : '', dialogue ? `人物台词：${dialogue}` : '']
            .map((text) => text.trim())
            .filter(Boolean)
            .join('\n\n')
          const nodePrompt = combinedPrompt || basePrompt
          const sourceKind = trimText(payload?.sourceKind)
          const sourceNodeId = trimText(payload?.sourceNodeId)
          const sourceIndexRaw = Number(payload?.sourceIndex)
          const shotNoRaw = Number(payload?.shotNo)
          const sourceIndex = Number.isFinite(sourceIndexRaw) ? Math.max(0, Math.trunc(sourceIndexRaw)) : null
          const shotNo = Number.isFinite(shotNoRaw) ? Math.max(1, Math.trunc(shotNoRaw)) : null
          const imageResultItem = {
            url: trimmed,
            ...(label ? { title: label } : {}),
            ...(basePrompt ? { prompt: basePrompt } : {}),
            ...(script ? { storyboardScript: script } : {}),
            ...(shotPrompt ? { storyboardShotPrompt: shotPrompt } : {}),
            ...(dialogue ? { storyboardDialogue: dialogue } : {}),
            ...(shotNo !== null ? { shotNo } : {}),
          }
          const id = genTaskNodeId()
          const node = {
            id,
            type: 'taskNode' as const,
            position: pos,
            data: {
              label,
              kind: 'image',
              imageUrl: trimmed,
              imageResults: [imageResultItem],
              imagePrimaryIndex: 0,
              ...(nodePrompt ? { prompt: nodePrompt } : {}),
              ...(script ? { storyboardScript: script } : {}),
              ...(shotPrompt ? { storyboardShotPrompt: shotPrompt } : {}),
              ...(dialogue ? { storyboardDialogue: dialogue } : {}),
              ...(sourceKind ? { dragSourceKind: sourceKind } : {}),
              ...(sourceNodeId ? { dragSourceNodeId: sourceNodeId } : {}),
              ...(sourceIndex !== null ? { dragSourceIndex: sourceIndex } : {}),
              ...(shotNo !== null ? { storyboardShotNo: shotNo } : {}),
              nodeWidth: 120,
              nodeHeight: 210,
            },
          }
          return { nodes: [...s.nodes, node], nextId: s.nextId + 1 }
        })
        return
      }
    }
    if (tplName) {
      applyTemplateAt(tplName, pos)
      return
    }
    if (flowRef) {
      try {
        JSON.parse(flowRef) as { id: string; name: string }
        toast('子流程任务节点已移除，请改用文本/图片/视频节点组合表达流程', 'warning')
      } catch {
        toast('子流程数据无效，无法导入', 'error')
      }
      return
    }
    if (rfdata) {
      const data = JSON.parse(rfdata) as { type: string; label?: string; kind?: string }
      // create node via store but place at computed position
      useRFStore.setState((s) => {
        const id = genTaskNodeId()
        const node = {
          id,
          type: data.type as any,
          position: pos,
          data: { label: data.label ?? data.type, kind: data.kind },
        }
        return { nodes: [...s.nodes, node], nextId: s.nextId + 1 }
      })
    }
  }, [importImageNodeFromDraggedFrame, importImagesFromFiles, isImageFile, rf])

  const createsCycle = useCallback((proposed: { source?: string|null; target?: string|null }) => {
    const sId = proposed.source
    const tId = proposed.target
    if (!sId || !tId) return false
    // Align with runner: ignore dangling edges that reference non-existent nodes
    const nodeIds = new Set(nodes.map(n => n.id))
    if (!nodeIds.has(sId) || !nodeIds.has(tId)) return false

    // Build adjacency including proposed edge
    const adj = new Map<string, string[]>()
    nodes.forEach(n => adj.set(n.id, []))
    edges.forEach(e => {
      if (!e.source || !e.target) return
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) return
      adj.get(e.source)!.push(e.target)
    })
    adj.get(sId)!.push(tId)
    // DFS from target to see if we can reach source
    const seen = new Set<string>()
    const stack = [tId]
    while (stack.length) {
      const u = stack.pop()!
      if (u === sId) return true
      if (seen.has(u)) continue
      seen.add(u)
      for (const v of adj.get(u) || []) stack.push(v)
    }
    return false
  }, [nodes, edges])

  type SnapTarget = {
    el: HTMLElement
    targetNodeId: string
    targetHandleId: string
    screen: { x: number; y: number }
    flow: { x: number; y: number }
    score: number
  }

  const suppressContextMenuRef = useRef(false)
  const rightDragRef = useRef<{ startX: number; startY: number } | null>(null)
  const snapTargetRef = useRef<SnapTarget | null>(null)
  const snapHandleElRef = useRef<HTMLElement | null>(null)
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null)

  const clearSnapTarget = useCallback(() => {
    const prev = snapHandleElRef.current
    if (prev) prev.classList.remove('tc-handle--snap')
    snapHandleElRef.current = null
    snapTargetRef.current = null
    setSnapTarget(null)
  }, [])

  const getHandleMeta = useCallback((handleEl: HTMLElement | null) => {
    if (!handleEl) return null
    const targetHandleId = handleEl.getAttribute('data-handleid') || handleEl.getAttribute('id') || undefined
    const targetNodeId =
      (handleEl.getAttribute('data-nodeid') || undefined) ||
      (handleEl.closest('.react-flow__node') as HTMLElement | null)?.getAttribute('data-id') ||
      undefined
    if (!targetHandleId || !targetNodeId) return null
    return { targetNodeId, targetHandleId }
  }, [])

  const isCompatibleTargetHandle = useCallback((meta: { targetNodeId: string; targetHandleId: string }, opts?: { silent?: boolean }) => {
    const from = connectFromRef.current
    if (!from) return false

    const sourceNodeId = from.nodeId
    if (sourceNodeId === meta.targetNodeId) return false
    if (edges.some(e => e.source === sourceNodeId && e.target === meta.targetNodeId)) return false
    if (createsCycle({ source: sourceNodeId, target: meta.targetNodeId })) return false

    const sNode = nodes.find(n => n.id === sourceNodeId)
    const tNode = nodes.find(n => n.id === meta.targetNodeId)
    if (!sNode || !tNode) return false
    const sKind = (sNode.data as any)?.kind
    const tKind = (tNode.data as any)?.kind
    if (String(tKind || '').toLowerCase() === 'text') return false
    if (!isValidEdgeByType(sKind, tKind)) return false
    return true
  }, [createsCycle, edges, nodes])

  const handleConnect = useCallback((c: any) => {
    lastReason.current = null
    didConnectRef.current = true
    onConnect({ ...c, type: edgeRoute === 'orth' ? 'orth' : 'typed' })
  }, [edgeRoute, onConnect])

  const onConnectStart = useCallback((_evt: any, params: { nodeId?: string|null; handleId?: string|null; handleType?: 'source'|'target'|null }) => {
    didConnectRef.current = false
    if (tapConnectSource) {
      setTapConnectSource(null)
    }
    setIsConnecting(true)
    const h = params.handleId || ''
    const inferredHandleType = params.handleType ?? (
      h.startsWith('out-') ? 'source'
      : h.startsWith('in-') ? 'target'
      : undefined
    )
    // if source handle like out-image -> type=image
    if (inferredHandleType === 'source' && h.startsWith('out-')) {
      setConnectingType(h.slice(4))
    } else if (inferredHandleType === 'target' && h.startsWith('in-')) {
      setConnectingType(h.slice(3))
    } else {
      setConnectingType(null)
    }

    // 记录从哪个节点的哪个端口开始连接，用于松手后弹出插入菜单
    if (inferredHandleType === 'source' && params.nodeId) {
      connectFromRef.current = { nodeId: params.nodeId, handleId: params.handleId || null }
    } else {
      connectFromRef.current = null
    }
  }, [tapConnectSource])

  const SNAP_DISTANCE = 96
  const NODE_SNAP_DISTANCE = 200
  const MIN_ZOOM = 0.3 // 允许缩小，但避免过度拉远导致节点与连线失去可读性
  const MAX_ZOOM = 1 // 放大上限保持克制，避免轻易进入“单节点占满屏幕”的状态
  const DEFAULT_ZOOM_MULTIPLIER = 0.32 // 首屏默认在 fitView 基础上再退一档，优先保证整体结构先可见

  const onConnectEnd = useCallback((evt: any) => {
    const from = connectFromRef.current
    const release =
      (evt && typeof evt.clientX === 'number' && typeof evt.clientY === 'number'
        ? { x: evt.clientX as number, y: evt.clientY as number }
        : null) ??
      lastPointerScreenRef.current ??
      { x: mouse.x, y: mouse.y }

    // Auto-snap to nearest compatible target handle / node
    const autoSnap = () => {
      if (!from) return false

      const tryConnectWithHandle = (handleEl: HTMLElement | null, opts?: { silent?: boolean }) => {
        if (!handleEl) return false
        // Wide handles are kept only for legacy edge anchoring; never use them for new connections.
        if (handleEl.classList.contains('tc-handle--wide')) return false
        const meta = getHandleMeta(handleEl)
        if (!meta) return false
        const sourceNodeId = from.nodeId
        const sourceHandleId = from.handleId || 'out-any'
        if (!isCompatibleTargetHandle(meta, opts)) return false

        handleConnect({
          source: sourceNodeId,
          sourceHandle: sourceHandleId,
          target: meta.targetNodeId,
          targetHandle: meta.targetHandleId,
        })
        return true
      }

      const pickHandleForNode = (nodeEl: HTMLElement | null) => {
        if (!nodeEl) return null
        const handlesInNode = Array.from(
          nodeEl.querySelectorAll('.tc-handle.react-flow__handle-target, .react-flow__handle-target'),
        ).filter((el) => !el.classList.contains('tc-handle--wide')) as HTMLElement[]
        if (!handlesInNode.length) return null
        if (!connectingType) return handlesInNode[0]
        const exact = handlesInNode.find(el => (el.getAttribute('data-handle-type') || '') === connectingType)
        if (exact) return exact
        const anyHandle = handlesInNode.find(el => {
          const type = el.getAttribute('data-handle-type')
          return !type || type === 'any'
        })
        return anyHandle || handlesInNode[0]
      }

      const tryConnectViaNode = (nodeEl: HTMLElement | null) => {
        if (!nodeEl) return false
        const handleEl = pickHandleForNode(nodeEl)
        if (!handleEl) return false
        return tryConnectWithHandle(handleEl)
      }

      const hoveredElement = document.elementFromPoint(release.x, release.y) as HTMLElement | null
      if (hoveredElement) {
        const hoveredHandle = hoveredElement.closest('.react-flow__handle-target') as HTMLElement | null
        if (tryConnectWithHandle(hoveredHandle)) return true
        const hoveredNode = hoveredElement.closest('.react-flow__node') as HTMLElement | null
        if (tryConnectViaNode(hoveredNode)) return true
      }

      // Prefer the live snap preview if we have one.
      if (snapTargetRef.current) {
        if (tryConnectWithHandle(snapTargetRef.current.el)) return true
      }

      const connectionPath = document.querySelector('.tc-connection-line__path')
      if (connectionPath instanceof SVGPathElement) {
        const intersectedNodes: { el: HTMLElement; dist: number }[] = []
        const nodeEls = Array.from(document.querySelectorAll('.react-flow__node')) as HTMLElement[]
        for (const el of nodeEls) {
          const nodeId = el.getAttribute('data-id')
          if (!nodeId || nodeId === from.nodeId) continue
          const rect = el.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) continue
          if (!screenPathIntersectsRect(connectionPath, rect)) continue
          intersectedNodes.push({
            el,
            dist: getPointToRectDistance(release, rect),
          })
        }
        intersectedNodes.sort((a, b) => a.dist - b.dist)
        for (const { el } of intersectedNodes) {
          if (tryConnectViaNode(el)) return true
        }
      }

      const handles = Array.from(document.querySelectorAll('.react-flow__handle-target'))
        .filter((el) => !(el as HTMLElement).classList.contains('tc-handle--wide')) as HTMLElement[]
      if (!handles.length) return false

      const scored: { el: HTMLElement; dist: number }[] = []
      for (const el of handles) {
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        const dist = Math.hypot(cx - release.x, cy - release.y)
        scored.push({ el, dist })
      }
      scored.sort((a, b) => a.dist - b.dist)

      // Try near handles first; fall back to farther ones if needed (but stay compatible).
      for (const { el, dist } of scored) {
        if (dist > SNAP_DISTANCE) break
        if (tryConnectWithHandle(el, { silent: true })) return true
      }

      // If still not found, try snapping to the nearest node body
      {
        const nodeEls = Array.from(document.querySelectorAll('.react-flow__node')) as HTMLElement[]
        let bestNode: { el: HTMLElement; dist: number } | null = null
        for (const el of nodeEls) {
          const nodeId = el.getAttribute('data-id')
          if (!nodeId || nodeId === from.nodeId) continue
          const rect = el.getBoundingClientRect()
          const dist = getPointToRectDistance(release, rect)
          if (dist > NODE_SNAP_DISTANCE && !(release.x >= rect.left && release.x <= rect.right && release.y >= rect.top && release.y <= rect.bottom)) continue
          if (!bestNode || dist < bestNode.dist) bestNode = { el, dist }
        }
        if (bestNode) {
          if (tryConnectViaNode(bestNode.el)) {
            return true
          }
        }
      }
      return false
    }

    if (!didConnectRef.current && from) {
      const snapped = autoSnap()
      if (!snapped) {
        // 从 text 节点拖出并松手在空白处：打开插入菜单
        useInsertMenuStore.getState().openMenu({
          x: release.x,
          y: release.y,
          fromNodeId: from.nodeId,
          fromHandle: from.handleId || 'out-any',
        })
      }
    }
    setConnectingType(null)
    setIsConnecting(false)
    lastReason.current = null
    connectFromRef.current = null
    didConnectRef.current = false
    clearSnapTarget()
  }, [clearSnapTarget, connectingType, getHandleMeta, handleConnect, isCompatibleTargetHandle, mouse.x, mouse.y])

  // removed pane mouse handlers (not supported by current reactflow typings). Root listeners are used instead.

  const onPaneContextMenu = useCallback((evt: MouseEvent | React.MouseEvent<Element, MouseEvent>) => {
    evt.preventDefault()
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false
      return
    }
    setMenu({ show: true, x: evt.clientX, y: evt.clientY, type: 'canvas' })
  }, [])

  const onPaneClick = useCallback(() => {
    setTapConnectSource(null)
    setConnectingType(null)
  }, [])

  const onNodeContextMenu = useCallback((evt: React.MouseEvent, node: any) => {
    evt.preventDefault()
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false
      return
    }
    setMenu({ show: true, x: evt.clientX, y: evt.clientY, type: 'node', id: node.id })
  }, [])

  const onEdgeContextMenu = useCallback((evt: React.MouseEvent, edge: any) => {
    evt.preventDefault()
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false
      return
    }
    setMenu({ show: true, x: evt.clientX, y: evt.clientY, type: 'edge', id: edge.id })
  }, [])

  const screenToFlow = useCallback((p: { x: number; y: number }) => rf.screenToFlowPosition ? rf.screenToFlowPosition(p) : p, [rf])

  const createTaskNodeAtMenu = useCallback((kind: string) => {
    const menuState = menu
    if (!menuState || menuState.type !== 'canvas') return
    const normalizedKind = kind === 'character' ? 'image' : kind
    useRFStore.getState().addNode('taskNode', undefined, {
      kind: normalizedKind,
      position: screenToFlow({ x: menuState.x, y: menuState.y }),
    })
    setMenu(null)
  }, [menu, screenToFlow])

  const insertMenuRef = useRef<HTMLDivElement | null>(null)

  type DragSnapIndex = { xs: number[]; ys: number[] }

  const dragSnapIndexRef = useRef<DragSnapIndex | null>(null)
  const dragSnapExcludeKeyRef = useRef<string>('')
  const dragExcludeIdsRef = useRef<Set<string>>(new Set())

  const buildExcludeIdsForDragStart = (dragNodeId?: string | null) => {
    const state = useRFStore.getState()
    const selected = state.nodes.filter(n => n.selected).map(n => n.id)
    if (selected.length) return new Set(selected)
    return new Set<string>(dragNodeId ? [dragNodeId] : [])
  }

  const toStableIdKey = (ids: Set<string>) => {
    if (!ids.size) return ''
    return Array.from(ids).sort().join('|')
  }

  const buildDragSnapIndex = (allNodes: any[], excludeIds: Set<string>): DragSnapIndex => {
    const xs: number[] = []
    const ys: number[] = []
    for (const n of allNodes) {
      if (!n?.id || excludeIds.has(n.id)) continue
      const x = Number(n.position?.x)
      const y = Number(n.position?.y)
      if (Number.isFinite(x)) xs.push(x)
      if (Number.isFinite(y)) ys.push(y)
    }
    xs.sort((a, b) => a - b)
    ys.sort((a, b) => a - b)
    return { xs, ys }
  }

  const setDragSnapIndex = (excludeIds: Set<string>) => {
    dragExcludeIdsRef.current = excludeIds
    dragSnapIndexRef.current = buildDragSnapIndex(useRFStore.getState().nodes, excludeIds)
    dragSnapExcludeKeyRef.current = toStableIdKey(excludeIds)
  }

  const lowerBound = (sorted: number[], value: number) => {
    let lo = 0
    let hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] < value) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  const findNearestWithin = (sorted: number[], value: number, threshold: number): number | undefined => {
    if (!sorted.length) return undefined
    const idx = lowerBound(sorted, value)
    const candA = idx > 0 ? sorted[idx - 1] : undefined
    const candB = idx < sorted.length ? sorted[idx] : undefined
    const da = candA === undefined ? Number.POSITIVE_INFINITY : Math.abs(candA - value)
    const db = candB === undefined ? Number.POSITIVE_INFINITY : Math.abs(candB - value)
    const best = da <= db ? candA : candB
    const dist = da <= db ? da : db
    return dist <= threshold ? best : undefined
  }

  const ensureDragSnapIndex = (excludeIds: Set<string>) => {
    const key = toStableIdKey(excludeIds)
    if (dragSnapIndexRef.current && dragSnapExcludeKeyRef.current === key) return dragSnapIndexRef.current
    const next = buildDragSnapIndex(useRFStore.getState().nodes, excludeIds)
    dragSnapIndexRef.current = next
    dragSnapExcludeKeyRef.current = key
    return next
  }

  const onNodeDragStart = useCallback((_evt: any, node: any) => {
    setDragging(true)
    resourceManager.setNodeDragging(true)
    const id = typeof node?.id === 'string' ? node.id : null
    const excludeIds = buildExcludeIdsForDragStart(id)
    setDragSnapIndex(excludeIds)
  }, [])

  const onNodeDrag = useCallback((_evt: any, node: any) => {
    // simple align guides to other nodes positions (perf: O(logN) query on a frozen snapshot built at drag start)
    const threshold = 5
    const id = typeof node?.id === 'string' ? node.id : null
    const excludeIds =
      dragExcludeIdsRef.current.size
        ? dragExcludeIdsRef.current
        : new Set<string>(id ? [id] : [])
    const index = dragSnapIndexRef.current ?? ensureDragSnapIndex(excludeIds)

    const px = Number(node?.position?.x)
    const py = Number(node?.position?.y)
    const vx = Number.isFinite(px) ? findNearestWithin(index.xs, px, threshold) : undefined
    const hy = Number.isFinite(py) ? findNearestWithin(index.ys, py, threshold) : undefined

    const prev = lastGuidesRef.current
    if (prev?.vx !== vx || prev?.hy !== hy) {
      const next = { vx, hy }
      lastGuidesRef.current = next
      setGuides(next)
    }

    // If dragging IO summary nodes in focus mode, persist relative position into group node data
    if (node?.type === 'ioNode' && (node as any)?.parentId) {
      const groupId = (node as any).parentId as string
      const isIn = (node?.data as any)?.kind === 'io-in'
      const ioSize = { w: 96, h: 28 }
      const grp = useRFStore.getState().nodes.find(n => n.id === groupId)
      if (grp) {
        const gW = (grp as any).width || (grp.style as any)?.width || 240
        const gH = (grp as any).height || (grp.style as any)?.height || 160
        const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
        const rel = { x: clamp(node.position.x, 0, Math.max(0, gW - ioSize.w)), y: clamp(node.position.y, 0, Math.max(0, gH - ioSize.h)) }
        useRFStore.setState(s => ({
          nodes: s.nodes.map(n => n.id === groupId ? { ...n, data: { ...(n.data||{}), [isIn ? 'ioInPos' : 'ioOutPos']: rel } } : n)
        }))
      }
    }
  }, [])

  const absorbImageNodeIntoStoryboardCell = useCallback((input: {
    sourceNodeId: string
    targetNodeId: string
    cellIndex: number
    payload: PrimaryImageDragPayload
  }) => {
    const { sourceNodeId, targetNodeId, cellIndex, payload } = input
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return
    useRFStore.setState((state) => {
      const sourceNode = state.nodes.find((node) => node.id === sourceNodeId)
      const targetNode = state.nodes.find((node) => node.id === targetNodeId)
      if (!sourceNode || !targetNode || targetNode.type !== 'taskNode') return {}

      const currentData = targetNode.data && typeof targetNode.data === 'object'
        ? targetNode.data as Record<string, unknown>
        : {}
      const storyboardPatch = buildStoryboardEditorPatch({
        cells: currentData.storyboardEditorCells,
        grid: currentData.storyboardEditorGrid,
        aspect: currentData.storyboardEditorAspect,
        editMode: currentData.storyboardEditorEditMode,
        collapsed: currentData.storyboardEditorCollapsed,
      })
      if (cellIndex < 0 || cellIndex >= storyboardPatch.storyboardEditorCells.length) return {}

      const nextCells = storyboardPatch.storyboardEditorCells.map((cell, index) => (
        index === cellIndex
          ? {
              ...cell,
              imageUrl: payload.url,
              label: payload.label,
              prompt: payload.prompt,
              sourceKind: payload.sourceKind,
              sourceNodeId: payload.sourceNodeId,
              sourceIndex: payload.sourceIndex,
              shotNo: payload.sourceIndex + 1,
            }
          : cell
      ))

      const previousSnapshot =
        typeof structuredClone === 'function'
          ? structuredClone({ nodes: state.nodes, edges: state.edges }) as { nodes: FlowNode[]; edges: FlowEdge[] }
          : JSON.parse(JSON.stringify({ nodes: state.nodes, edges: state.edges })) as { nodes: FlowNode[]; edges: FlowEdge[] }

      const nextNodes = state.nodes
        .filter((node) => node.id !== sourceNodeId)
        .map((node) => {
          if (node.id !== targetNodeId) return node
          const targetData = node.data && typeof node.data === 'object'
            ? node.data as Record<string, unknown>
            : {}
          return {
            ...node,
            data: {
              ...normalizeStoryboardNodeData({
                ...targetData,
                storyboardEditorCells: nextCells,
                kind: 'storyboard',
              }),
            },
          }
        })

      const nextEdges = state.edges.filter((edge) => edge.source !== sourceNodeId && edge.target !== sourceNodeId)
      return {
        nodes: nextNodes,
        edges: nextEdges,
        historyPast: [...state.historyPast, previousSnapshot].slice(-50),
        historyFuture: [],
      }
    })
  }, [])

  const onNodeDragStop = useCallback((evt: MouseEvent | TouchEvent, node: any) => {
    const sourceNodeId = typeof node?.id === 'string' ? node.id : ''
    const payload = sourceNodeId ? resolveNodePrimaryImagePayload(node as FlowNode) : null
    if (payload && evt && 'clientX' in evt && 'clientY' in evt) {
      const hitCell = Array.from(document.querySelectorAll<HTMLElement>('.tc-storyboard-editor__cell[data-storyboard-node-id][data-cell-index]'))
        .map((element) => {
          const rect = element.getBoundingClientRect()
          const targetNodeId = element.dataset.storyboardNodeId?.trim() || ''
          const cellIndexRaw = Number(element.dataset.cellIndex)
          return {
            targetNodeId,
            cellIndex: Number.isFinite(cellIndexRaw) ? Math.max(0, Math.floor(cellIndexRaw)) : -1,
            rect,
          }
        })
        .find((entry) =>
          entry.targetNodeId &&
          entry.cellIndex >= 0 &&
          evt.clientX >= entry.rect.left &&
          evt.clientX <= entry.rect.right &&
          evt.clientY >= entry.rect.top &&
          evt.clientY <= entry.rect.bottom,
        )

      if (hitCell && hitCell.targetNodeId !== sourceNodeId) {
        absorbImageNodeIntoStoryboardCell({
          sourceNodeId,
          targetNodeId: hitCell.targetNodeId,
          cellIndex: hitCell.cellIndex,
          payload,
        })
      }
    }
    lastGuidesRef.current = null
    setGuides(null)
    setDragging(false)
    resourceManager.setNodeDragging(false)
    dragSnapIndexRef.current = null
    dragSnapExcludeKeyRef.current = ''
    dragExcludeIdsRef.current = new Set()
  }, [absorbImageNodeIntoStoryboardCell])

  // Note: group size is user-controlled by default; arrange actions may trigger explicit auto-fit.

  const handleNodesChange = useCallback((changes: any[]) => {
    // React Flow may occasionally emit transient `remove` changes during complex drag/update
    // sequences. We use explicit delete actions elsewhere, so ignore these to prevent accidental loss.
    const safeChanges = (changes || []).filter((ch) => ch?.type !== 'remove')
    if (safeChanges.length === 0) return

    // Some drag sequences can emit position changes without an explicit `dragging` flag.
    // Normalize them while the local drag lifecycle is active so store-side history and
    // layout logic do not misclassify drag ticks as ordinary position updates.
    const normalizedChanges = dragging
      ? safeChanges.map((ch) => {
        if (ch?.type !== 'position' || !ch?.position || typeof ch?.dragging === 'boolean') return ch
        return { ...ch, dragging: true }
      })
      : safeChanges

    const threshold = 6
    const positionChanges = normalizedChanges.filter((ch) => ch?.type === 'position' && ch?.position)
    if (positionChanges.length === 0) {
      onNodesChange(normalizedChanges)
      return
    }

    const movedIds = new Set<string>()
    for (const ch of positionChanges) {
      const id = typeof ch?.id === 'string' ? ch.id : ''
      if (id) movedIds.add(id)
    }

    const draggingTick = positionChanges.some((ch) => (ch as any)?.dragging === true)
    const index = draggingTick
      ? (dragSnapIndexRef.current ?? (() => {
          const excludeIds = movedIds.size ? movedIds : dragExcludeIdsRef.current
          setDragSnapIndex(excludeIds.size ? excludeIds : new Set())
          return dragSnapIndexRef.current ?? { xs: [], ys: [] }
        })())
      : buildDragSnapIndex(useRFStore.getState().nodes, movedIds)

    const stateNodesById = new Map(useRFStore.getState().nodes.map((n) => [n.id, n] as const))
    const snapped = normalizedChanges.map((ch) => {
      if (ch.type === 'position' && ch.position) {
        const node = typeof ch.id === 'string' ? stateNodesById.get(ch.id) : undefined
        const isGroupNode = node?.type === 'groupNode'
        const isChildNode = Boolean((node as any)?.parentId)
        // Group / child dragging should stay stable and not be pulled by global snap anchors.
        if (isGroupNode || isChildNode) return ch
        const sx = findNearestWithin(index.xs, Number(ch.position.x), threshold) ?? ch.position.x
        const sy = findNearestWithin(index.ys, Number(ch.position.y), threshold) ?? ch.position.y
        return { ...ch, position: { x: sx, y: sy } }
      }
      return ch
    })
    const compacted = snapped.filter((ch) => {
      if (ch?.type !== 'position' || !ch?.position) return true
      const draggingFlag = (ch as any)?.dragging
      // Keep explicit drag lifecycle changes so store can track boundaries.
      if (draggingFlag === true || draggingFlag === false) return true
      const node = typeof ch.id === 'string' ? stateNodesById.get(ch.id) : undefined
      if (!node) return true
      const curX = Number(node.position?.x)
      const curY = Number(node.position?.y)
      const nextX = Number(ch.position?.x)
      const nextY = Number(ch.position?.y)
      if (![curX, curY, nextX, nextY].every((n) => Number.isFinite(n))) return true
      return Math.abs(curX - nextX) > 0.001 || Math.abs(curY - nextY) > 0.001
    })
    if (!compacted.length) return
    onNodesChange(compacted)
  }, [dragging, onNodesChange])

  const computeBestSnapTarget = useCallback((client: { x: number; y: number }): SnapTarget | null => {
    const from = connectFromRef.current
    if (!from) return null

    const targetHandles = Array.from(document.querySelectorAll('.react-flow__handle-target'))
      .filter((el) => !(el as HTMLElement).classList.contains('tc-handle--wide')) as HTMLElement[]
    if (!targetHandles.length) return null

    const candidates: SnapTarget[] = []
    for (const el of targetHandles) {
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      const meta = getHandleMeta(el)
      if (!meta) continue
      if (meta.targetNodeId === from.nodeId) continue
      if (!isCompatibleTargetHandle(meta, { silent: true })) continue

      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dist = Math.hypot(cx - client.x, cy - client.y)

      const handleType = (el.getAttribute('data-handle-type') || '').toLowerCase()
      const want = (connectingType || '').toLowerCase()
      const typePenalty = !want || handleType === want || handleType === 'any' || handleType === '' ? 0 : 120

      candidates.push({
        el,
        targetNodeId: meta.targetNodeId,
        targetHandleId: meta.targetHandleId,
        screen: { x: cx, y: cy },
        flow: screenToFlow({ x: cx, y: cy }),
        score: dist + typePenalty,
      })
    }

    if (!candidates.length) return null
    candidates.sort((a, b) => a.score - b.score)
    return candidates[0]
  }, [connectingType, getHandleMeta, isCompatibleTargetHandle, screenToFlow])

  useEffect(() => {
    const hasNode = (id?: string | null) => !!id && nodes.some(n => n.id === id)
    if (tapConnectSource && !hasNode(tapConnectSource.nodeId)) {
      setTapConnectSource(null)
      setConnectingType(null)
    }
    if (connectFromRef.current && !hasNode(connectFromRef.current.nodeId)) {
      connectFromRef.current = null
      setConnectingType(null)
      setIsConnecting(false)
      clearSnapTarget()
    }
  }, [clearSnapTarget, nodes, tapConnectSource])

  // While connecting, preview magnetic snap to the nearest compatible target handle.
  useEffect(() => {
    if (!isConnecting) {
      clearSnapTarget()
      return
    }
    if (!connectFromRef.current) return

    let raf = 0
    raf = window.requestAnimationFrame(() => {
      const best = computeBestSnapTarget({ x: mouse.x, y: mouse.y })
      if (!best) {
        clearSnapTarget()
        return
      }

      // Only snap when close enough; otherwise keep visuals clean.
      const SNAP_PREVIEW_RADIUS = 96
      const dist = Math.hypot(best.screen.x - mouse.x, best.screen.y - mouse.y)
      if (dist > SNAP_PREVIEW_RADIUS) {
        clearSnapTarget()
        return
      }

      snapTargetRef.current = best
      setSnapTarget(best)

      const prev = snapHandleElRef.current
      if (prev && prev !== best.el) prev.classList.remove('tc-handle--snap')
      best.el.classList.add('tc-handle--snap')
      snapHandleElRef.current = best.el
    })

    return () => {
      window.cancelAnimationFrame(raf)
    }
  }, [clearSnapTarget, computeBestSnapTarget, isConnecting, mouse.x, mouse.y])

  const MagneticConnectionLine = useCallback((props: ConnectionLineComponentProps) => {
    const tx = snapTarget?.flow?.x ?? props.toX
    const ty = snapTarget?.flow?.y ?? props.toY
    const [path] = getBezierPath({
      sourceX: props.fromX,
      sourceY: props.fromY,
      sourcePosition: props.fromPosition,
      targetX: tx,
      targetY: ty,
      targetPosition: props.toPosition,
      curvature: 0.35,
    })
    return (
      <g className="tc-connection-line">
        <path className="tc-connection-line__path" d={path} style={props.connectionLineStyle} fill="none" />
        {snapTarget && (
          <circle
            className="tc-connection-line__snap-dot"
            cx={tx}
            cy={ty}
            r={4}
            fill={String((props.connectionLineStyle as any)?.stroke || '#93c5fd')}
            opacity={0.9}
          />
        )}
      </g>
    )
  }, [snapTarget])

  const pickDefaultSourceHandle = useCallback((kind?: string | null) => {
    if (!kind) return 'out-any'
    const k = getTaskNodeCoreType(kind)
    if (k === 'image') return 'out-image'
    if (k === 'video') return 'out-video'
    if (k === 'text') return 'out-text'
    return 'out-any'
  }, [])

  const pickDefaultTargetHandle = useCallback((targetKind?: string | null, sourceKind?: string | null) => {
    const tk = targetKind ? getTaskNodeCoreType(targetKind) : ''
    if (tk === 'video') return 'in-any'
    if (tk === 'image') return 'in-image'
    if (tk === 'text') return 'in-text'
    return 'in-any'
  }, [])

  const resolveCompatibleTargetHandleId = useCallback((targetKind?: string | null, sourceKind?: string | null) => {
    const schema = getTaskNodeSchema(targetKind)
    const targetHandles = getStaticTargetHandles(schema)
    if (!targetHandles.length) return null

    const preferredHandleId = pickDefaultTargetHandle(schema.kind, sourceKind)
    const preferredHandle = targetHandles.find((handle) => handle.id === preferredHandleId)
    if (preferredHandle) return preferredHandle.id

    const anyHandle = targetHandles.find((handle) => String(handle.type || '').toLowerCase() === 'any')
    if (anyHandle) return anyHandle.id

    return targetHandles[0]?.id ?? null
  }, [pickDefaultTargetHandle])

  const quickConnectNodes = useCallback((sourceId: string, targetId: string, opts?: { showInvalidToast?: boolean }) => {
    const showInvalidToast = opts?.showInvalidToast !== false
    if (sourceId === targetId) {
      if (showInvalidToast) toast('不能连接到自身', 'warning')
      return false
    }
    const sourceNode = nodes.find(n => n.id === sourceId)
    const targetNode = nodes.find(n => n.id === targetId)
    if (!sourceNode || !targetNode) {
      setTapConnectSource(null)
      setConnectingType(null)
      return false
    }
    if (edges.some(e => e.source === sourceId && e.target === targetId)) {
      if (showInvalidToast) toast('节点之间已存在连接', 'info')
      return false
    }
    if (createsCycle({ source: sourceId, target: targetId })) {
      return false
    }
    const sKind = (sourceNode.data as any)?.kind
    const tKind = (targetNode.data as any)?.kind
    if (String(tKind || '').toLowerCase() === 'text') {
      if (showInvalidToast) toast('文本节点仅支持作为提示词来源，不支持作为目标节点', 'warning')
      return false
    }
    if (!isValidEdgeByType(sKind, tKind)) {
      if (showInvalidToast) toast('当前两种节点类型不支持直连', 'warning')
      return false
    }
    handleConnect({
      source: sourceId,
      sourceHandle: pickDefaultSourceHandle(sKind),
      target: targetId,
      targetHandle: pickDefaultTargetHandle(tKind, sKind),
    })
    return true
  }, [createsCycle, edges, handleConnect, nodes, pickDefaultSourceHandle, pickDefaultTargetHandle])

  const referencePickerTargetId = canvasReferencePicker?.targetNodeId ?? ''
  const referencePickerBlockedSourceIds = useMemo(() => {
    if (!referencePickerTargetId) return new Set<string>()
    const blocked = new Set<string>(canvasReferencePicker?.blockedSourceNodeIds ?? [])
    edges.forEach((edge) => {
      if (edge.target === referencePickerTargetId) blocked.add(edge.source)
    })
    return blocked
  }, [canvasReferencePicker?.blockedSourceNodeIds, edges, referencePickerTargetId])

  const onNodeClick = useCallback((evt: React.MouseEvent, node: any) => {
    if (!node?.id) return
    if (referencePickerTargetId) {
      if (node.id === referencePickerTargetId) return
      if (!isCanvasReferencePickerCandidateNode(node as FlowNode, referencePickerTargetId)) return
      if (referencePickerBlockedSourceIds.has(node.id)) return
      const connected = quickConnectNodes(String(node.id), referencePickerTargetId, { showInvalidToast: false })
      if (connected) closeCanvasReferencePicker()
      return
    }
    // “点击节点两步连线”容易误触（尤其在刚创建新节点后点击查看参数时）。
    // 仅在按住 Alt/Option 时启用该模式；普通点击将视为取消待连线状态。
    if (!evt.altKey) {
      if (tapConnectSource) {
        setTapConnectSource(null)
        setConnectingType(null)
      }
      return
    }
    const pending = tapConnectSource
    if (pending?.nodeId === node.id) {
      setTapConnectSource(null)
      setConnectingType(null)
      return
    }
    if (pending && pending.nodeId !== node.id) {
      quickConnectNodes(pending.nodeId, node.id, { showInvalidToast: false })
      setTapConnectSource(null)
      setConnectingType(null)
      return
    }
    const kind = String(node?.data?.kind || '').toLowerCase()
    const derivedType =
      kind === 'image' ? 'image'
      : kind === 'video' ? 'video'
      : kind === 'text' ? 'text'
      : null
    setTapConnectSource({ nodeId: node.id })
    setConnectingType(derivedType)
  }, [closeCanvasReferencePicker, quickConnectNodes, referencePickerBlockedSourceIds, referencePickerTargetId, tapConnectSource])

  const onNodeDoubleClick = useCallback((_evt: React.MouseEvent, node: FlowNode) => {
    if (!node?.id) return
    if (node.type === 'groupNode') return
    focusNodeSubgraph(node.id)
    setTimeout(() => rf.fitView?.({ padding: 0.2 }), 50)
  }, [focusNodeSubgraph, rf])
  const selectedNonGroupNodes = useMemo(
    () => selectedNodeSummaries.filter((node) => node.type !== 'groupNode'),
    [selectedNodeSummaries],
  )
  const selectedGroupIds = useMemo(
    () => selectedNodeSummaries.filter((node) => node.type === 'groupNode').map((node) => node.id),
    [selectedNodeSummaries],
  )
  const selectedNodeCount = selectedNodeIds.length
  const heavySelectionActive = selectedNodeCount > 1 || selectedGroupIds.length > 0
  const heavySelectionDragging = dragging && selectedNodeCount >= HEAVY_SELECTION_DRAG_THRESHOLD
  const shouldHighlightSelectedEdges = selectedNodeCount === 1 && selectedGroupIds.length === 0
  const canvasRenderContextValue = useMemo(
    () => ({
      heavySelectionActive,
      heavySelectionDragging,
      selectedNodeCount,
    }),
    [heavySelectionActive, heavySelectionDragging, selectedNodeCount],
  )
  const canCreateScriptBundleFromSelection = useMemo(() => {
    if (dragging) return false
    if (selectedNonGroupNodes.length < 2) return false
    const textualNodes = selectedNonGroupNodes.filter((node) => node.kind === 'text' && Boolean(node.prompt || node.text))
    return textualNodes.length >= 2
  }, [dragging, selectedNonGroupNodes])
  const canCreateGroupFromSelection = useMemo(() => {
    if (dragging) return false
    if (selectedNonGroupNodes.length < 2) return false
    const parentKeys = new Set(
      selectedNonGroupNodes.map((node) => node.parentId || ''),
    )
    if (parentKeys.size !== 1) return false
    const parentId = Array.from(parentKeys)[0]
    if (!parentId) return true
    const selectedIds = new Set(selectedNonGroupNodes.map((node) => node.id))
    const childIds = nodes
      .filter((node) => (typeof node.parentId === 'string' ? node.parentId.trim() : '') === parentId)
      .map((node) => node.id)
    if (childIds.length !== selectedIds.size) return true
    return !childIds.every((id) => selectedIds.has(id))
  }, [dragging, nodes, selectedNonGroupNodes])
  const selectionMatchedGroupId = useMemo(() => {
    if (dragging) return null
    if (!selectedNonGroupNodes.length) return null
    const selectedIds = new Set(selectedNonGroupNodes.map((node) => node.id))
    const parentKeys = new Set(
      selectedNonGroupNodes.map((node) => node.parentId || ''),
    )
    if (parentKeys.size !== 1) return null
    const parentId = Array.from(parentKeys)[0]
    if (!parentId) return null
    const parentNode = nodes.find((node) => node.id === parentId && node.type === 'groupNode')
    if (!parentNode) return null
    const childIds = nodes
      .filter((node) => (typeof node.parentId === 'string' ? node.parentId.trim() : '') === parentId)
      .map((node) => node.id)
    if (childIds.length !== selectedIds.size) return null
    if (!childIds.every((id) => selectedIds.has(id))) return null
    return parentId
  }, [dragging, nodes, selectedNonGroupNodes])
  const canUngroupSelection = selectedGroupIds.length > 0 || Boolean(selectionMatchedGroupId)
  const runUngroupSelection = useCallback(() => {
    if (selectedGroupIds.length > 0) {
      selectedGroupIds.forEach((id) => ungroupGroupNode(id))
      return
    }
    if (selectionMatchedGroupId) ungroupGroupNode(selectionMatchedGroupId)
  }, [selectionMatchedGroupId, selectedGroupIds, ungroupGroupNode])
  const layoutScope = useMemo(() => {
    if (dragging) return null
    if (selectedGroupIds.length === 1) {
      return { groupId: selectedGroupIds[0], nodeIds: undefined as string[] | undefined }
    }
    if (selectedNonGroupNodes.length < 2) return null
    const parentKeys = new Set(
      selectedNonGroupNodes.map((node) => node.parentId || ''),
    )
    if (parentKeys.size !== 1) return null
    const groupId = Array.from(parentKeys)[0]
    if (!groupId) return null
    const group = nodes.find((node) => node.id === groupId && node.type === 'groupNode')
    if (!group) return null
    return {
      groupId,
      nodeIds: selectedNonGroupNodes.map((node) => node.id),
    }
  }, [dragging, nodes, selectedGroupIds, selectedNonGroupNodes])
  const canLayoutSelection = Boolean(layoutScope)
  const runLayoutSelection = useCallback((direction: 'grid' | 'column' | 'flow') => {
    if (!layoutScope) return
    arrangeGroupChildren(layoutScope.groupId, direction, layoutScope.nodeIds)
  }, [arrangeGroupChildren, layoutScope])

  const canStitchSelectedGroup = useMemo(
    () => selectedGroupIds.length === 1 && !stitchingGroupId,
    [selectedGroupIds.length, stitchingGroupId],
  )
  const canRunSelectedGroup = useMemo(
    () => selectedGroupIds.length === 1 && !runningGroupId,
    [selectedGroupIds.length, runningGroupId],
  )
  const canSaveSelectedGroupWorkflow = useMemo(
    () => selectedGroupIds.length === 1 && !savingWorkflowGroupId,
    [savingWorkflowGroupId, selectedGroupIds.length],
  )
  const canPublishSelectedGroupTemplate = useMemo(
    () => selectedGroupIds.length === 1 && !publishingTemplateGroupId,
    [publishingTemplateGroupId, selectedGroupIds.length],
  )
  const downloadAssetsGroupId = useMemo(() => {
    if (selectedGroupIds.length === 1) return selectedGroupIds[0]
    if (selectionMatchedGroupId) return selectionMatchedGroupId
    return null
  }, [selectedGroupIds, selectionMatchedGroupId])
  const canDownloadSelectedGroupAssets = useMemo(
    () => Boolean(downloadAssetsGroupId) && downloadingGroupAssetsId === null,
    [downloadAssetsGroupId, downloadingGroupAssetsId],
  )
  const runDownloadSelectedGroupAssets = useCallback(async () => {
    if (!downloadAssetsGroupId) return
    if (downloadingGroupAssetsId !== null) return

    const groupNode = nodes.find((n) => n.id === downloadAssetsGroupId && n.type === 'groupNode')
    const groupData = groupNode?.data && typeof groupNode.data === 'object'
      ? (groupNode.data as Record<string, unknown>)
      : null
    const groupLabel = typeof groupData?.label === 'string' ? groupData.label.trim() : ''
    const resolvedGroupLabel = groupLabel || `组-${downloadAssetsGroupId}`

    setDownloadingGroupAssetsId(downloadAssetsGroupId)
    toast('即将触发多文件下载；浏览器可能会提示“允许多个文件下载”', 'info')
    try {
      await downloadGroupAssets({
        nodes,
        groupId: downloadAssetsGroupId,
        groupLabel: resolvedGroupLabel,
      })
      toast('已触发组内素材下载', 'success')
    } catch (err) {
      toast(formatErrorMessage(err), 'error')
    } finally {
      setDownloadingGroupAssetsId(null)
    }
  }, [downloadAssetsGroupId, downloadingGroupAssetsId, nodes])
  const hasSelectionOverflowActions = useMemo(
    () => (
      canLayoutSelection ||
      canStitchSelectedGroup ||
      canSaveSelectedGroupWorkflow ||
      Boolean(downloadAssetsGroupId)
    ),
    [
      canLayoutSelection,
      canStitchSelectedGroup,
      canSaveSelectedGroupWorkflow,
      downloadAssetsGroupId,
    ],
  )
  const isStitchingSelectedGroup = useMemo(
    () => selectedGroupIds.length === 1 && stitchingGroupId === selectedGroupIds[0],
    [selectedGroupIds, stitchingGroupId],
  )
  const isRunningSelectedGroup = useMemo(
    () => selectedGroupIds.length === 1 && runningGroupId === selectedGroupIds[0],
    [runningGroupId, selectedGroupIds],
  )
  const isSavingSelectedGroupWorkflow = useMemo(
    () => selectedGroupIds.length === 1 && savingWorkflowGroupId === selectedGroupIds[0],
    [savingWorkflowGroupId, selectedGroupIds],
  )
  const isPublishingSelectedGroupTemplate = useMemo(
    () => selectedGroupIds.length === 1 && publishingTemplateGroupId === selectedGroupIds[0],
    [publishingTemplateGroupId, selectedGroupIds],
  )

  const collectGroupTaskNodeIds = useCallback((groupId: string): string[] => {
    const stateNodes = useRFStore.getState().nodes
    const nodeById = new Map<string, FlowNode>(stateNodes.map((node) => [String(node.id), node]))
    const childrenByParent = new Map<string, string[]>()

    for (const node of stateNodes) {
      const parentId = typeof node.parentId === 'string' ? node.parentId.trim() : ''
      if (!parentId) continue
      const list = childrenByParent.get(parentId)
      if (list) {
        list.push(String(node.id))
        continue
      }
      childrenByParent.set(parentId, [String(node.id)])
    }

    const queue: string[] = [groupId]
    const visited = new Set<string>()
    const taskIds: string[] = []

    while (queue.length) {
      const currentGroupId = queue.shift()
      if (!currentGroupId) continue
      const childIds = childrenByParent.get(currentGroupId) || []
      for (const childId of childIds) {
        if (visited.has(childId)) continue
        visited.add(childId)
        const childNode = nodeById.get(childId)
        if (!childNode) continue
        if (childNode.type === 'taskNode') taskIds.push(childId)
        if (childNode.type === 'groupNode') queue.push(childId)
      }
    }

    return taskIds
  }, [])

  const runGroupNodes = useCallback(async (groupId: string) => {
    if (!groupId || runningGroupId) return
    const stateNodes = useRFStore.getState().nodes
    const group = stateNodes.find((n) => n.id === groupId && n.type === 'groupNode')
    if (!group) {
      toast('未找到目标分组', 'error')
      return
    }
    const nodeIds = collectGroupTaskNodeIds(groupId)
    if (!nodeIds.length) {
      toast('组内没有可执行任务节点', 'info')
      return
    }
    setRunningGroupId(groupId)
    try {
      await runFlowDag(1, useRFStore.getState, useRFStore.setState, { only: new Set(nodeIds) })
      toast(`已触发组内 ${nodeIds.length} 个节点执行`, 'success')
    } catch (err) {
      console.error(err)
      toast('组内一键执行失败', 'error')
    } finally {
      setRunningGroupId(null)
    }
  }, [collectGroupTaskNodeIds, runningGroupId])

  const collectGroupSubgraph = useCallback((groupId: string): { nodes: any[]; edges: any[]; groupLabel: string } | null => {
    const state = useRFStore.getState()
    const stateNodes = state.nodes
    const stateEdges = state.edges
    const rootGroup = stateNodes.find((n) => n.id === groupId && n.type === 'groupNode')
    if (!rootGroup) return null

    const includedNodeIds = new Set<string>([groupId])
    const queue: string[] = [groupId]
    while (queue.length) {
      const current = queue.shift()
      if (!current) continue
      for (const node of stateNodes) {
        const parentId = typeof node.parentId === 'string' ? node.parentId.trim() : ''
        if (!parentId || parentId !== current || includedNodeIds.has(node.id)) continue
        includedNodeIds.add(node.id)
        if (node.type === 'groupNode') queue.push(node.id)
      }
    }

    const nodes = stateNodes
      .filter((node) => includedNodeIds.has(node.id))
      .map((node) => ({
        ...node,
        selected: false,
        dragging: false,
      }))
    const edges = stateEdges
      .filter((edge) => includedNodeIds.has(edge.source) && includedNodeIds.has(edge.target))
      .map((edge) => ({
        ...edge,
        selected: false,
        animated: false,
      }))

    const groupLabel = String((rootGroup.data as any)?.label || groupId).trim() || groupId
    return { nodes, edges, groupLabel }
  }, [])

  const resolveSubgraphPreviewImageUrl = useCallback((groupId: string): string | null => {
    const subgraph = collectGroupSubgraph(groupId)
    if (!subgraph) return null
    for (const node of subgraph.nodes) {
      const imageUrl = resolveNodePrimaryImageUrl(node as FlowNode)
      if (imageUrl) return imageUrl
    }
    return null
  }, [collectGroupSubgraph])

  const openWorkflowNameDialog = useCallback((state: WorkflowNameDialogState) => {
    setWorkflowNameDialog(state)
    setWorkflowNameInput(state.initialName)
    setWorkflowDescriptionInput(state.initialDescription)
    setWorkflowCoverUrlInput(state.initialCoverUrl)
    if (state.mode === 'template') {
      setTemplateSaveMode('create')
      setTemplateVisibility('private')
      setTemplateProjects([])
      setSelectedTemplateProjectId('')
    }
  }, [])

  const closeWorkflowNameDialog = useCallback(() => {
    setWorkflowNameDialog(null)
    setWorkflowNameInput('')
    setWorkflowDescriptionInput('')
    setWorkflowCoverUrlInput('')
    setTemplateSaveMode('create')
    setTemplateVisibility('private')
    setTemplateProjects([])
    setSelectedTemplateProjectId('')
    setTemplateCoverUploading(false)
  }, [])

  useEffect(() => {
    if (workflowNameDialog?.mode !== 'template') return
    let cancelled = false

    void listProjects()
      .then((projects) => {
        if (cancelled) return
        setTemplateProjects(projects)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('加载模板项目失败:', error)
        setTemplateProjects([])
      })

    return () => {
      cancelled = true
    }
  }, [workflowNameDialog])

  useEffect(() => {
    if (workflowNameDialog?.mode !== 'template') return
    if (templateSaveMode !== 'update') return
    if (!selectedTemplateProjectId && templateProjects.length > 0) {
      setSelectedTemplateProjectId(templateProjects[0].id)
      return
    }
    const selectedProject = templateProjects.find((project) => project.id === selectedTemplateProjectId) ?? null
    if (!selectedProject) return

    setWorkflowNameInput((selectedProject.templateTitle || selectedProject.name || '').trim())
    setWorkflowDescriptionInput((selectedProject.templateDescription || '').trim())
    setWorkflowCoverUrlInput((selectedProject.templateCoverUrl || '').trim())
    setTemplateVisibility(selectedProject.isPublic ? 'public' : 'private')
  }, [selectedTemplateProjectId, templateProjects, templateSaveMode, workflowNameDialog])

  const triggerTemplateCoverUpload = useCallback(() => {
    if (templateCoverUploading) return
    templateCoverUploadInputRef.current?.click()
  }, [templateCoverUploading])

  const handleTemplateCoverUploadInputChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || [])
    event.currentTarget.value = ''
    const imageFile = files.find((file) => String(file.type || '').startsWith('image/'))
    if (!imageFile) {
      toast('请选择图片文件', 'warning')
      return
    }

    const uploadProjectId = (() => {
      if (templateSaveMode === 'update') {
        const targetId = selectedTemplateProjectId.trim()
        if (targetId) return targetId
      }
      const currentId = String(currentProject?.id || '').trim()
      return currentId || undefined
    })()

    setTemplateCoverUploading(true)
    try {
      const uploaded = await uploadServerAssetFile(imageFile, imageFile.name, {
        projectId: uploadProjectId,
        taskKind: 'image',
      })
      const url =
        String((uploaded as { data?: { url?: unknown } })?.data?.url || '').trim()
        || String((uploaded as { data?: { imageUrl?: unknown } })?.data?.imageUrl || '').trim()
        || String((uploaded as { data?: { thumbnailUrl?: unknown } })?.data?.thumbnailUrl || '').trim()
      if (!url) throw new Error('上传成功但未返回可用图片地址')
      setWorkflowCoverUrlInput(url)
      toast('模板封面上传成功', 'success')
    } catch (error: unknown) {
      console.error(error)
      toast(formatErrorMessage(error), 'error')
    } finally {
      setTemplateCoverUploading(false)
    }
  }, [currentProject?.id, selectedTemplateProjectId, templateSaveMode])

  const saveSelectedGroupAsWorkflowAsset = useCallback(async () => {
    if (selectedGroupIds.length !== 1) {
      toast('请先选择一个分组', 'info')
      return
    }
    const groupId = selectedGroupIds[0]
    const projectId = String(currentProject?.id || '').trim()
    if (!projectId) {
      toast('请先选择项目后再保存工作流资产', 'warning')
      return
    }

    const subgraph = collectGroupSubgraph(groupId)
    if (!subgraph || subgraph.nodes.length <= 1) {
      toast('组内没有可保存的工作流节点', 'warning')
      return
    }

    openWorkflowNameDialog({
      mode: 'asset',
      groupId,
      title: '保存为资产',
      confirmLabel: '保存',
      initialName: `工作流片段 · ${subgraph.groupLabel}`,
      initialDescription: '',
      initialCoverUrl: '',
      previewUrl: resolveSubgraphPreviewImageUrl(groupId),
    })
  }, [collectGroupSubgraph, currentProject?.id, openWorkflowNameDialog, resolveSubgraphPreviewImageUrl, selectedGroupIds])

  const publishSelectedGroupAsTemplate = useCallback(async (explicitGroupId?: string) => {
    const groupId = explicitGroupId || selectedGroupIds[0]
    if (!groupId) {
      toast('请先选择一个分组', 'info')
      return
    }
    const subgraph = collectGroupSubgraph(groupId)
    if (!subgraph || subgraph.nodes.length <= 1) {
      toast('组内没有可发布的工作流节点', 'warning')
      return
    }

    openWorkflowNameDialog({
      mode: 'template',
      groupId,
      title: '创建模板',
      confirmLabel: '确认',
      initialName: `模板 · ${subgraph.groupLabel}`,
      initialDescription: '',
      initialCoverUrl: '',
      previewUrl: resolveSubgraphPreviewImageUrl(groupId),
    })
  }, [collectGroupSubgraph, openWorkflowNameDialog, resolveSubgraphPreviewImageUrl, selectedGroupIds])

  const submitWorkflowNameDialog = useCallback(async () => {
    const dialog = workflowNameDialog
    if (!dialog) return
    const name = workflowNameInput.trim()
    const description = workflowDescriptionInput.trim()
    if (!name) {
      toast('请输入名称', 'warning')
      return
    }

    const projectId = String(currentProject?.id || '').trim()
    if (!projectId) {
      toast('请先选择项目', 'warning')
      return
    }

    const subgraph = collectGroupSubgraph(dialog.groupId)
    if (!subgraph || subgraph.nodes.length <= 1) {
      toast('组内没有可保存的工作流节点', 'warning')
      closeWorkflowNameDialog()
      return
    }

    if (dialog.mode === 'asset') {
      const coverUrl = workflowCoverUrlInput.trim() || dialog.previewUrl || ''
      setSavingWorkflowGroupId(dialog.groupId)
      try {
        await createServerAsset({
          name,
          projectId,
          data: {
            kind: 'workflow',
            source: 'group_workflow_asset',
            groupId: dialog.groupId,
            title: name,
            description,
            coverUrl,
            nodes: subgraph.nodes,
            edges: subgraph.edges,
            savedAt: new Date().toISOString(),
          },
        })
        toast('已保存为个人工作流资产', 'success')
        closeWorkflowNameDialog()
      } catch (error: unknown) {
        console.error(error)
        toast(formatErrorMessage(error), 'error')
      } finally {
        setSavingWorkflowGroupId(null)
      }
      return
    }

    setPublishingTemplateGroupId(dialog.groupId)
    try {
      const isPublicTemplate = templateVisibility === 'public'
      const templateCoverUrl = workflowCoverUrlInput.trim() || dialog.previewUrl || ''
      const targetProjectId = templateSaveMode === 'update'
        ? selectedTemplateProjectId.trim()
        : ''
      if (templateSaveMode === 'update' && !targetProjectId) {
        toast('请选择要更新的模板', 'warning')
        return
      }

      const project = templateSaveMode === 'update'
        ? await upsertProject({ id: targetProjectId, name })
        : await upsertProject({ name })
      const flows = await listProjectFlows(project.id)
      const targetFlow = flows[0] ?? null
      await saveProjectFlow({
        id: targetFlow?.id,
        projectId: project.id,
        name,
        nodes: subgraph.nodes,
        edges: subgraph.edges,
      })
      await updateProjectTemplate(project.id, {
        templateTitle: name,
        templateDescription: description,
        templateCoverUrl,
        isPublic: isPublicTemplate,
      })
      toast(
        templateSaveMode === 'update'
          ? `模板已更新为${isPublicTemplate ? '公共' : '私有'}模板`
          : `已保存为${isPublicTemplate ? '公共' : '私有'}模板`,
        'success',
      )
      closeWorkflowNameDialog()
    } catch (error: unknown) {
      console.error(error)
      toast(formatErrorMessage(error), 'error')
    } finally {
      setPublishingTemplateGroupId(null)
    }
  }, [
    closeWorkflowNameDialog,
    collectGroupSubgraph,
    currentProject?.id,
    selectedTemplateProjectId,
    templateSaveMode,
    templateVisibility,
    workflowDescriptionInput,
    workflowCoverUrlInput,
    workflowNameDialog,
    workflowNameInput,
  ])

  const fetchImageBlob = useCallback(async (url: string): Promise<Blob> => {
    const direct = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit' }).catch(() => null)
    if (direct && direct.ok) return await direct.blob()

    throw new Error('image-fetch-failed')
  }, [])

  const loadImageFromBlob = useCallback((blob: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob)
    const ImageCtor = (typeof window !== 'undefined' ? window.Image : (globalThis as any)?.Image) as
      | (new () => HTMLImageElement)
      | undefined
    if (typeof ImageCtor !== 'function') {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('image-constructor-unavailable'))
      return
    }
    const img = new ImageCtor()
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('image-decode-failed'))
    }
    img.src = objectUrl
  }), [])








  const stitchGroupToLongImage = useCallback(async (groupId: string) => {
    if (stitchingGroupId) return
    setStitchingGroupId(groupId)
    const stateNodes = useRFStore.getState().nodes
    const group = stateNodes.find((n) => n.id === groupId && n.type === 'groupNode')
    if (!group) {
      toast('未找到目标组', 'error')
      setStitchingGroupId(null)
      return
    }

    const children = stateNodes
      .filter((n) => (n as any)?.parentId === groupId)
      .sort((a, b) => {
        const ay = Number(a?.position?.y ?? 0)
        const by = Number(b?.position?.y ?? 0)
        if (Math.abs(ay - by) > 1) return ay - by
        const ax = Number(a?.position?.x ?? 0)
        const bx = Number(b?.position?.x ?? 0)
        return ax - bx
      })

    const imageUrls = children
      .map((node) => resolveNodePrimaryImageUrl(node as FlowNode))
      .filter((url): url is string => Boolean(url))

    if (!imageUrls.length) {
      toast('组内没有可拼接的图片节点', 'info')
      setStitchingGroupId(null)
      return
    }

    try {
      const images = await Promise.all(
        imageUrls.map(async (url) => {
          const blob = await fetchImageBlob(url)
          const img = await loadImageFromBlob(blob)
          return img
        }),
      )
      if (!images.length) {
        toast('未获取到可拼接的图片', 'error')
        return
      }

      const maxWidth = Math.max(...images.map((img) => Math.max(1, img.naturalWidth || img.width || 1)))
      const totalHeight = images.reduce((sum, img) => sum + Math.max(1, img.naturalHeight || img.height || 1), 0)
      const canvas = document.createElement('canvas')
      canvas.width = maxWidth
      canvas.height = Math.max(1, totalHeight)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        toast('创建画布失败', 'error')
        return
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      let cursorY = 0
      for (const img of images) {
        const w = Math.max(1, img.naturalWidth || img.width || 1)
        const h = Math.max(1, img.naturalHeight || img.height || 1)
        const x = Math.floor((maxWidth - w) / 2)
        ctx.drawImage(img, x, cursorY, w, h)
        cursorY += h
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 0.95))
      if (!blob) {
        toast('长图导出失败', 'error')
        return
      }

      const href = URL.createObjectURL(blob)
      const groupLabel = String((group.data as any)?.label || groupId).trim() || groupId
      const filenameSafe = groupLabel.replace(/[\\/:*?"<>|]+/g, '_')
      const a = document.createElement('a')
      a.href = href
      a.download = `${filenameSafe}-long-${Date.now()}.png`
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(href)
      toast(`已生成长图（${images.length} 张）`, 'success')
    } catch (error) {
      console.error('Failed to stitch group images:', error)
      toast('生成长图失败，请确认组内图片可访问', 'error')
    } finally {
      setStitchingGroupId(null)
    }
  }, [fetchImageBlob, loadImageFromBlob, stitchingGroupId])

  const selectionActionAnchor = useMemo<SelectionActionAnchor | null>(() => {
    if (dragging || viewportMoving) return null
    const shouldShow = selectedNodeIds.length >= 2 || selectedGroupIds.length >= 1
    if (!shouldShow) return null
    const nodesById = new Map(nodes.map((n) => [n.id, n] as const))
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const nodeId of selectedNodeIds) {
      const node = nodesById.get(nodeId)
      if (!node) continue
      const abs = getNodeAbsPosition(node, nodesById)
      const { w, h } = getNodeSize(node)
      minX = Math.min(minX, abs.x)
      minY = Math.min(minY, abs.y)
      maxX = Math.max(maxX, abs.x + w)
      maxY = Math.max(maxY, abs.y + h)
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null
    return {
      centerX: (minX + maxX) / 2,
      selectedCount: selectedNodeIds.length,
      topY: minY,
    }
  }, [dragging, nodes, selectedGroupIds, selectedNodeIds, viewportMoving])

  const focusedNodeSummary = useMemo(() => {
    if (!focusedNodeId) return null
    const focusedNode = nodes.find((node) => node.id === focusedNodeId)
    if (!focusedNode) return null
    const data = focusedNode.data as Record<string, unknown> | undefined
    const label =
      typeof data?.label === 'string' && data.label.trim()
        ? data.label.trim()
        : focusedNode.id
    return { id: focusedNode.id, label }
  }, [focusedNodeId, nodes])

  // Apply focus filtering (node upstream/downstream subgraph mode)
  const focusFiltered = useMemo(() => {
    if (!focusedNodeId) return { nodes, edges }
    const focusedNode = nodes.find((node) => node.id === focusedNodeId)
    if (!focusedNode) return { nodes, edges }

    const outgoingBySource = new Map<string, FlowEdge[]>()
    const incomingByTarget = new Map<string, FlowEdge[]>()

    for (const edge of edges) {
      const sourceEdges = outgoingBySource.get(edge.source) ?? []
      sourceEdges.push(edge)
      outgoingBySource.set(edge.source, sourceEdges)

      const targetEdges = incomingByTarget.get(edge.target) ?? []
      targetEdges.push(edge)
      incomingByTarget.set(edge.target, targetEdges)
    }

    const collectReachableNodeIds = (
      startId: string,
      adjacency: Map<string, FlowEdge[]>,
      getNextId: (edge: FlowEdge) => string,
    ) => {
      const visited = new Set<string>([startId])
      const queue: string[] = [startId]
      while (queue.length > 0) {
        const currentId = queue.shift()
        if (!currentId) break
        const relatedEdges = adjacency.get(currentId) ?? []
        for (const edge of relatedEdges) {
          const nextId = getNextId(edge)
          if (visited.has(nextId)) continue
          visited.add(nextId)
          queue.push(nextId)
        }
      }
      return visited
    }

    const upstreamIds = collectReachableNodeIds(focusedNodeId, incomingByTarget, (edge) => edge.source)
    const downstreamIds = collectReachableNodeIds(focusedNodeId, outgoingBySource, (edge) => edge.target)
    const visibleNodeIds = new Set<string>([...upstreamIds, ...downstreamIds])

    const nodesById = new Map(nodes.map((node) => [node.id, node] as const))
    for (const nodeId of Array.from(visibleNodeIds)) {
      let parentId = nodesById.get(nodeId)?.parentId
      while (typeof parentId === 'string' && parentId.trim()) {
        visibleNodeIds.add(parentId)
        parentId = nodesById.get(parentId)?.parentId
      }
    }

    return {
      nodes: nodes.filter((node) => visibleNodeIds.has(node.id)),
      edges: edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    }
  }, [focusedNodeId, nodes, edges])

  const hasVisibilityFilter = useMemo(
    () => NODE_VISIBILITY_FILTERS.some((filter) => !nodeVisibility[filter]),
    [nodeVisibility],
  )

  const styledViewNodes = useMemo(() => {
    if (dragging && focusedNodeId === null && !hasVisibilityFilter && !viewOnly && !referencePickerTargetId) {
      return focusFiltered.nodes
    }
    return focusFiltered.nodes.map((node) => {
    const isReferencePickerCandidate = Boolean(
      referencePickerTargetId && isCanvasReferencePickerCandidateNode(node, referencePickerTargetId),
    )
    const isReferencePickerBlocked = isReferencePickerCandidate && referencePickerBlockedSourceIds.has(node.id)
    const dragHandle = node.type === 'groupNode' ? '.tc-group-node__shell' : node.dragHandle
    const visible = isNodeVisibleByFilter(node, nodeVisibility)
    const needsDisplayStyling =
      focusedNodeId !== null || hasVisibilityFilter || viewOnly || isReferencePickerBlocked
    if (!needsDisplayStyling) {
      if (node.type === 'groupNode' && node.dragHandle !== dragHandle) {
        return {
          ...node,
          dragHandle,
        }
      }
      return node
    }

    if (visible) {
      return {
        ...node,
        dragHandle,
        draggable: node.type === 'ioNode' ? node.draggable : (!viewOnly && !referencePickerTargetId),
        selectable: !viewOnly && !referencePickerTargetId,
        focusable: !viewOnly && !referencePickerTargetId,
        connectable: !viewOnly && !referencePickerTargetId,
        style: {
          ...(node.style || {}),
          opacity: isReferencePickerBlocked ? 0.3 : 1,
          filter: isReferencePickerBlocked ? 'grayscale(1) saturate(0.2)' : 'none',
          transition: 'opacity 160ms ease, filter 160ms ease',
        },
      }
    }

    return {
      ...node,
      dragHandle,
      draggable: false,
      selectable: false,
      focusable: false,
      connectable: false,
      style: {
        ...(node.style || {}),
        opacity: 0.12,
        filter: 'grayscale(1) saturate(0.2)',
        transition: 'opacity 160ms ease, filter 160ms ease',
      },
    }
    })
  }, [dragging, focusFiltered.nodes, focusedNodeId, hasVisibilityFilter, nodeVisibility, referencePickerBlockedSourceIds, referencePickerTargetId, viewOnly])

  useEffect(() => {
    if (!referencePickerTargetId) return
    const targetExists = nodes.some((node) => node.id === referencePickerTargetId)
    if (!targetExists) closeCanvasReferencePicker()
  }, [closeCanvasReferencePicker, nodes, referencePickerTargetId])

  // Edge highlight when connected to a selected node
  const selectedIds = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])
  const dragViewEdges = useMemo(() => {
    const base = focusFiltered.edges
    const needsDragRewrite = base.some((edge) => edge.type !== 'typed' || edge.interactionWidth == null)
    if (!needsDragRewrite) return base
    return base.map((edge) => ({
      ...edge,
      type: 'typed' as const,
      interactionWidth: edge.interactionWidth ?? 40,
    }))
  }, [focusFiltered.edges])
  const viewEdges = useMemo(() => {
    if (dragging || viewportMoving) {
      return dragViewEdges
    }
    const base = focusFiltered.edges
    const displayRouteType: FlowEdge['type'] = edgeRoute === 'orth' ? 'orth' : 'typed'
    const routed = base.map((edge) => {
      const nextType = edge.type === 'typed' || edge.type === 'orth'
        ? displayRouteType
        : displayRouteType
      if (edge.type === nextType && edge.interactionWidth != null) {
        return edge
      }
      return {
        ...edge,
        type: nextType,
        interactionWidth: edge.interactionWidth ?? 40,
      }
    })
    if (!shouldHighlightSelectedEdges && !hasVisibilityFilter) {
      return routed
    }
    const nodesById = new Map(focusFiltered.nodes.map((node) => [node.id, node] as const))
    const edgeTransition = heavySelectionActive ? 'none' : 'opacity 160ms ease'
    return routed.map((e) => {
      const sourceNode = nodesById.get(e.source)
      const targetNode = nodesById.get(e.target)
      const sourceVisible = sourceNode ? isNodeVisibleByFilter(sourceNode, nodeVisibility) : true
      const targetVisible = targetNode ? isNodeVisibleByFilter(targetNode, nodeVisibility) : true
      const isMuted = !sourceVisible || !targetVisible
      const active = shouldHighlightSelectedEdges && (selectedIds.has(e.source) || selectedIds.has(e.target))
      return active
        ? {
            ...e,
            style: {
              ...(e.style || {}),
              opacity: isMuted ? 0.08 : 1,
              stroke: isDarkCanvas ? '#e5e7eb' : '#111827',
              transition: edgeTransition,
            },
          }
        : {
            ...e,
            style: {
              ...(e.style || {}),
              opacity: isMuted ? 0.05 : 0.5,
              transition: edgeTransition,
            },
          }
    })
  }, [dragViewEdges, dragging, edgeRoute, focusFiltered.edges, focusFiltered.nodes, hasVisibilityFilter, heavySelectionActive, isDarkCanvas, nodeVisibility, selectedIds, shouldHighlightSelectedEdges, viewportMoving])

  // 使用多选拖拽（内置），不自定义组拖拽，避免与画布交互冲突

  // 旧的宫格/水平布局已合并为“格式化”（树形，自上而下，32px 间距）

  const parseHandleTypeFromId = (handleId?: string | null): string => {
    const raw = String(handleId || '')
    if (raw.startsWith('out-')) return raw.slice(4).split('-')[0] || 'any'
    if (raw.startsWith('in-')) return raw.slice(3).split('-')[0] || 'any'
    return 'any'
  }

  const handleInsertNodeAt = (
    targetKind: string,
    menuState: { x: number; y: number; fromNodeId?: string; fromHandle?: string | null; targetHandleId?: string | null },
  ) => {
    const posFlow = screenToFlow({ x: menuState.x, y: menuState.y })
    const upstreamNode = menuState.fromNodeId
      ? useRFStore.getState().nodes.find(n => n.id === menuState.fromNodeId)
      : undefined
    const upstreamPrompt = upstreamNode ? ((upstreamNode.data as any)?.prompt as string | undefined) : undefined
    const sourceKind = upstreamNode ? ((upstreamNode.data as any)?.kind as string | undefined) : undefined

    useRFStore.setState(s => {
      const id = genTaskNodeId()
      const schema = getTaskNodeSchema(targetKind)
      const label = schema.label || schema.kind || 'Node'
      const data: any = { label, kind: schema.kind }
      if (upstreamPrompt && schema.features?.includes('prompt')) data.prompt = upstreamPrompt

      const node = { id, type: 'taskNode' as const, position: posFlow, data }

      let edgesNext = s.edges
      if (menuState.fromNodeId) {
        const fromHandle = menuState.fromHandle || pickDefaultSourceHandle(sourceKind)
        const edgeId = `e-${menuState.fromNodeId}-${id}-${Date.now().toString(36)}`
        const edge: any = {
          id: edgeId,
          source: menuState.fromNodeId,
          target: id,
          sourceHandle: fromHandle,
          targetHandle: menuState.targetHandleId || pickDefaultTargetHandle(schema.kind, sourceKind),
          type: (edgeRoute === 'orth' ? 'orth' : 'typed') as any,
          animated: false,
        }
        edgesNext = [...edgesNext, edge]
      }

      return { nodes: [...s.nodes, node], edges: edgesNext, nextId: s.nextId + 1 }
    })

    closeInsertMenu()
  }

  const insertMenuContent = useMemo(() => {
    if (!insertMenu.open) return null

    const fromNode = nodes.find((node) => node.id === insertMenu.fromNodeId)
    const fromData = fromNode?.data
    const fromRecord = fromData && typeof fromData === 'object' ? fromData as Record<string, unknown> : null
    const fromKind = typeof fromRecord?.kind === 'string' ? fromRecord.kind : undefined
    const fromLabel = typeof fromRecord?.label === 'string' ? fromRecord.label.trim() : ''
    const sourceType = parseHandleTypeFromId(insertMenu.fromHandle)
    const title = fromLabel
      ? `从「${fromLabel}」继续（${getHandleTypeLabel(sourceType)}）`
      : `继续（${getHandleTypeLabel(sourceType)}）`

    const schemaCandidates = listTaskNodeSchemas()
      .map((schema) => {
        if (INSERT_MENU_EXCLUDED_KINDS.has(schema.kind)) return null
        if (fromKind && !isValidEdgeByType(fromKind, schema.kind)) return null
        const targetHandleId = resolveCompatibleTargetHandleId(schema.kind, fromKind)
        if (!targetHandleId) return null
        return { schema, targetHandleId }
      })
      .filter((candidate): candidate is InsertMenuSchemaCandidate => Boolean(candidate))
      .sort((a, b) => {
        const order: Record<string, number> = { image: 10, storyboard: 15, video: 20, document: 30, generic: 100 }
        const ai = order[a.schema.category] ?? 999
        const bi = order[b.schema.category] ?? 999
        if (ai !== bi) return ai - bi
        return String(a.schema.label || a.schema.kind).localeCompare(String(b.schema.label || b.schema.kind))
      })

    return {
      title,
      schemaCandidates,
    }
  }, [
    insertMenu.fromHandle,
    insertMenu.open,
    resolveCompatibleTargetHandleId,
  ])

  const focusNodeFromMiniMap = useCallback((node: FlowNode) => {
    useRFStore.setState((state) => ({
      nodes: state.nodes.map((currentNode) => ({
        ...currentNode,
        selected: currentNode.id === node.id,
      })),
    }))
    const nodesById = new Map(useRFStore.getState().nodes.map((currentNode) => [currentNode.id, currentNode] as const))
    const targetNode = nodesById.get(node.id) ?? node
    const absolutePosition = getNodeAbsPosition(targetNode, nodesById)
    const { w, h } = getNodeSize(targetNode)
    const currentZoom = rf.getViewport?.().zoom ?? 1
    rf.setCenter?.(absolutePosition.x + w / 2, absolutePosition.y + h / 2, { zoom: currentZoom, duration: 260 })
  }, [rf])

  const handleMiniMapClick = useCallback<CanvasMiniMapClick>((event, position) => {
    event.preventDefault()
    event.stopPropagation()
    const currentZoom = rf.getViewport?.().zoom ?? 1
    rf.setCenter?.(position.x, position.y, { zoom: currentZoom, duration: 180 })
  }, [rf])

  const handleMiniMapNodeClick = useCallback<CanvasMiniMapNodeClick>((event, node) => {
    event.preventDefault()
    event.stopPropagation()
    focusNodeFromMiniMap(node as FlowNode)
  }, [focusNodeFromMiniMap])

  // Right-button drag: use as pan gesture and suppress context menu when dragging.
  useEffect(() => {
    const threshold = 6
    const onMove = (ev: MouseEvent) => {
      if (!rightDragRef.current) return
      const dx = ev.clientX - rightDragRef.current.startX
      const dy = ev.clientY - rightDragRef.current.startY
      if (Math.hypot(dx, dy) >= threshold) {
        suppressContextMenuRef.current = true
      }
    }
    const onUp = () => {
      rightDragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      root.removeEventListener('wheel', onWheel)
    }
  }, [])

  useEffect(() => {
    const shouldBlockGesture = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false
      const root = rootRef.current
      return Boolean(root && root.contains(target))
    }
    const blockGesture = (event: Event) => {
      if (!shouldBlockGesture(event.target)) return
      event.preventDefault()
    }
    window.addEventListener('gesturestart', blockGesture, { passive: false } as AddEventListenerOptions)
    window.addEventListener('gesturechange', blockGesture, { passive: false } as AddEventListenerOptions)
    window.addEventListener('gestureend', blockGesture, { passive: false } as AddEventListenerOptions)
    return () => {
      window.removeEventListener('gesturestart', blockGesture as EventListener)
      window.removeEventListener('gesturechange', blockGesture as EventListener)
      window.removeEventListener('gestureend', blockGesture as EventListener)
    }
  }, [])

  // Share/view-only: format the whole graph once after initial load, and avoid selection side effects.
  useEffect(() => {
    if (!viewOnly) {
      viewOnlyFormattedOnceRef.current = false
      return
    }
    if (viewOnlyFormattedOnceRef.current) return
    if (restoreAppliedRef.current) return
    if (!nodes.length) return
    viewOnlyFormattedOnceRef.current = true
    useRFStore.getState().autoLayoutAllDagVertical()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rf.fitView?.({ padding: 0.2, duration: 250 })
      })
    })
  }, [nodes.length, rf, viewOnly])

  useEffect(() => {
    if (!viewOnly) return
    const anySelected = nodes.some((n: any) => !!n?.selected) || edges.some((e: any) => !!e?.selected)
    if (!anySelected) return
    useRFStore.setState((s) => ({
      nodes: s.nodes.map((n: any) => (n?.selected ? { ...n, selected: false } : n)),
      edges: s.edges.map((e: any) => (e?.selected ? { ...e, selected: false } : e)),
    }))
  }, [edges, nodes, viewOnly])

  useEffect(() => {
    if (viewOnly) return
    if (initialFitAppliedRef.current) return
    if (!nodes.length) return
    rf.fitView?.({ padding: 0.2 })
    requestAnimationFrame(() => {
      applyDefaultZoom()
      initialFitAppliedRef.current = true
    })
  }, [applyDefaultZoom, nodes.length, rf, viewOnly])

  useEffect(() => {
    if (!insertMenu.open) return
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null
      if (!target) return
      if (insertMenuRef.current && insertMenuRef.current.contains(target)) return
      closeInsertMenu()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [closeInsertMenu, insertMenu.open])

  return (
    <CanvasRenderContext.Provider value={canvasRenderContextValue}>
      <div className={joinClassNames('tc-canvas', className)}
        style={canvasStyle}
        data-connecting={connectingType || ''}
        data-connecting-active={(isConnecting || !!tapConnectSource) ? 'true' : 'false'}
        data-dragging={dragging ? 'true' : 'false'}
        data-heavy-selection={heavySelectionActive ? 'true' : 'false'}
        data-heavy-selection-dragging={heavySelectionDragging ? 'true' : 'false'}
        data-viewport-moving={viewportMoving ? 'true' : 'false'}
        data-tour="canvas"
        ref={rootRef}
        onMouseEnter={(e) => {
          queueSpotlightPosition(e.clientX, e.clientY)
          setSpotlightVisible(true)
        }}
        onMouseLeave={() => {
          setSpotlightVisible(false)
        }}
        onMouseMove={(e) => {
          lastPointerScreenRef.current = { x: e.clientX, y: e.clientY }
          if (!viewportMoving) {
            queueSpotlightPosition(e.clientX, e.clientY)
          }
          if (isConnecting) setMouse({ x: e.clientX, y: e.clientY })
        }}
        onDrop={viewOnly ? undefined : onDrop}
        onDragOver={viewOnly ? undefined : onDragOver}
        onMouseDown={viewOnly ? undefined : (e) => {
          if (e.button === 2) {
            rightDragRef.current = { startX: e.clientX, startY: e.clientY }
          }
        }}
        onDoubleClick={(e) => {
          if (viewOnly) return
          // double-click blank to go up one level in focus mode
          const target = e.target as HTMLElement
          if (!target.closest('.react-flow__node') && focusedNodeId) {
            clearFocusedSubgraph()
            setTimeout(() => rf.fitView?.({ padding: 0.2 }), 50)
          }
        }}
        onKeyDown={(e) => {
          if (viewOnly) return
          // 处理键盘删除事件 - 检查是否在输入框中
          function isTextInputElement(target: EventTarget | null) {
            if (!(target instanceof HTMLElement)) return false
            const tagName = target.tagName
            if (tagName === 'INPUT' || tagName === 'TEXTAREA') return true
            if (target.getAttribute('contenteditable') === 'true') return true
            if (target.closest('input') || target.closest('textarea')) return true
            if (target.closest('[contenteditable="true"]')) return true
            return false
          }

          const focusTarget = document.activeElement as HTMLElement | null
          const isTextInput = isTextInputElement(e.target) || isTextInputElement(focusTarget)

          if (e.key === 'Escape' && focusedNodeId && !isTextInput) {
            e.preventDefault()
            clearFocusedSubgraph()
            setTimeout(() => rf.fitView?.({ padding: 0.2 }), 50)
            return
          }

          if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextInput) {
            e.preventDefault()
            useRFStore.getState().removeSelected()
          }
        }}
        tabIndex={0} // 使div可以接收键盘事件
        onPaste={(e) => {
          if (viewOnly) return
          const isTextInputElement = (target: EventTarget | null) => {
            if (!(target instanceof HTMLElement)) return false
            const tagName = target.tagName
            if (tagName === 'INPUT' || tagName === 'TEXTAREA') return true
            if (target.getAttribute('contenteditable') === 'true') return true
            if (target.closest('input') || target.closest('textarea')) return true
            if (target.closest('[contenteditable="true"]')) return true
            return false
          }
          if (isTextInputElement(e.target) || isTextInputElement(document.activeElement)) return
          const filesFromClipboard: File[] = []
          const items = Array.from(e.clipboardData?.items || [])
          for (const item of items) {
            if (item.kind !== 'file') continue
            const f = item.getAsFile()
            if (f && isImageFile(f)) filesFromClipboard.push(f)
          }
          const pos = rf.screenToFlowPosition(lastPointerScreenRef.current ?? getFallbackScreenPoint())
          let handled = false
          if (filesFromClipboard.length) {
            e.preventDefault()
            e.stopPropagation()
            ;(window as any).__tcLastImagePasteAt = Date.now()
            void importImagesFromFiles(filesFromClipboard, pos)
            toast(`已导入 ${filesFromClipboard.length} 张图片`, 'success')
            handled = true
          }
          const text = e.clipboardData?.getData('text/plain')?.trim()
          if (text) {
            try {
              const data = JSON.parse(text) as CanvasImportData
              const extracted = extractCanvasGraph(data)
              if (extracted?.nodes.length) {
                e.preventDefault()
                e.stopPropagation()
                ;(window as any).__tcLastWorkflowPasteAt = Date.now()
                importWorkflow(data, pos)
                toast('已导入工作流', 'success')
                handled = true
              }
            } catch {
              if (!handled && (text.startsWith('{') || text.startsWith('['))) {
                toast('剪贴板不是有效的工作流 JSON', 'error')
              }
            }
          }
          if (!handled) return
        }}
      >
      <input className="tc-canvas__image-input"
        ref={imageUploadInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const picked = Array.from(e.currentTarget.files || [])
          e.currentTarget.value = ''
          if (!picked.length) return
          const screen = pendingImageUploadScreenRef.current
          pendingImageUploadScreenRef.current = null
          const pos = screen ? screenToFlow({ x: screen.x, y: screen.y }) : undefined
          void importImagesFromFiles(picked, pos)
        }}
      />
      <ReactFlow className="tc-canvas__flow"
        nodes={styledViewNodes}
        edges={viewEdges}
        onNodesChange={viewOnly ? undefined : handleNodesChange}
        onEdgesChange={viewOnly ? undefined : onEdgesChange}
        onConnect={viewOnly ? undefined : handleConnect}
        onEdgeMouseEnter={viewOnly ? undefined : (_evt, edge) => useUIStore.getState().hoverEdge(edge.id)}
        onEdgeMouseLeave={viewOnly ? undefined : () => useUIStore.getState().unhoverEdgeSoon()}
        onConnectStart={viewOnly ? undefined : onConnectStart}
        onConnectEnd={viewOnly ? undefined : onConnectEnd}
        onNodeDragStart={viewOnly ? undefined : onNodeDragStart}
        onPaneContextMenu={viewOnly ? undefined : onPaneContextMenu}
        onPaneClick={viewOnly ? undefined : onPaneClick}
        onNodeContextMenu={viewOnly ? undefined : onNodeContextMenu}
        onEdgeContextMenu={viewOnly ? undefined : onEdgeContextMenu}
        onNodeDrag={viewOnly ? undefined : onNodeDrag}
        onNodeDragStop={viewOnly ? undefined : onNodeDragStop}
        onNodeClick={viewOnly ? undefined : onNodeClick}
        onNodeDoubleClick={viewOnly ? undefined : onNodeDoubleClick}
        onMoveEnd={(_evt, vp) => {
          setCanvasViewport(vp)
          const lastPointer = lastPointerScreenRef.current
          if (lastPointer) {
            queueSpotlightPosition(lastPointer.x, lastPointer.y)
          }
          setSpotlightVisible(true)
        }}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onInit={onInit}
        selectionOnDrag={!viewOnly}
        // Edit mode: middle-button and right-button drag pan the canvas; left drag keeps selection box.
        panOnDrag={viewOnly ? true : ([1, 2] as any)}
        panOnScroll
        zoomOnPinch
        zoomOnScroll
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        nodesDraggable={!viewOnly}
        nodesConnectable={!viewOnly}
        elementsSelectable={!viewOnly}
        proOptions={{ hideAttribution: true }}
        isValidConnection={(c) => {
          if (viewOnly) return false
          if (!c.source || !c.target) return false
          if (c.source === c.target) return false
          if (createsCycle({ source: c.source, target: c.target })) { lastReason.current = $('连接会导致环'); return false }
          const dup = edges.some(e => e.source === c.source && e.target === c.target)
          if (dup) { lastReason.current = $('重复连接'); return false }
          // 不做 feature/类型校验，仅阻止自连、重复和环路
          lastReason.current = null
          return true
        }}
        snapToGrid
        snapGrid={[16, 16]}
        connectionRadius={28}
        defaultEdgeOptions={{
          animated: false,
          type: (edgeRoute === 'orth' ? 'orth' : 'typed') as any,
          style: { strokeWidth: 2, strokeLinecap: 'round' },
          interactionWidth: 1,
        }}
        connectionLineComponent={MagneticConnectionLine}
        connectionLineType={ConnectionLineType.SimpleBezier}
        connectionLineStyle={connectionLineStyle}
      >
        <MiniMap
          className="tc-canvas__minimap"
          position="bottom-left"
          style={{ width: 160, height: 110 }}
          pannable
          zoomable={false}
          onClick={handleMiniMapClick}
          onNodeClick={handleMiniMapNodeClick}
        />
        <Controls className="tc-canvas__controls" position="bottom-left" />
        <Background id="tc-canvas-grid-base" className="tc-canvas__background" gap={16} size={1} color={backgroundGridColor} />
        <Background
          id="tc-canvas-grid-spotlight"
          className="tc-canvas__background tc-canvas__background--spotlight"
          gap={16}
          size={1}
          color="var(--tc-spotlight-grid-color)"
        />
      </ReactFlow>
      {!viewOnly && (() => {
        const slot = typeof document !== 'undefined' ? document.getElementById('tc-canvas-visibility-slot') : null
        const panel = (
          <PanelCard
            className="tc-canvas__visibility-panel"
            padding="compact"
            style={{
              position: slot ? 'relative' : 'absolute',
              right: slot ? undefined : 12,
              top: slot ? undefined : 12,
              background: isDarkCanvas ? 'rgba(15, 23, 42, 0.7)' : 'rgba(255, 255, 255, 0.82)',
              borderColor: isDarkCanvas ? 'rgba(148, 163, 184, 0.16)' : 'rgba(15, 23, 42, 0.06)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <Group className="tc-canvas__visibility-panel-group" gap={4} wrap="nowrap">
              {NODE_VISIBILITY_FILTERS.map((filter) => {
                const active = nodeVisibility[filter]
                const Icon = getNodeVisibilityIcon(filter)
                return (
                  <Button
                    key={filter}
                    className="tc-canvas__visibility-panel-tag"
                    size="compact-xs"
                    radius="xs"
                    variant="subtle"
                    leftSection={<Icon className="tc-canvas__visibility-panel-tag-icon" size={12} stroke={1.9} />}
                    styles={{
                      root: {
                        height: 24,
                        paddingInline: 8,
                        border: `1px solid ${active
                          ? (isDarkCanvas ? 'rgba(148, 163, 184, 0.26)' : 'rgba(15, 23, 42, 0.12)')
                          : 'transparent'}`,
                        background: active
                          ? (isDarkCanvas ? 'rgba(51, 65, 85, 0.78)' : 'rgba(248, 250, 252, 0.92)')
                          : 'transparent',
                        color: active
                          ? (isDarkCanvas ? 'rgba(241, 245, 249, 0.96)' : 'rgba(15, 23, 42, 0.92)')
                          : (isDarkCanvas ? 'rgba(148, 163, 184, 0.46)' : 'rgba(15, 23, 42, 0.38)'),
                        boxShadow: active ? (isDarkCanvas ? 'inset 0 0 0 1px rgba(255,255,255,0.02)' : 'none') : 'none',
                        transition: 'all 160ms ease',
                      },
                      section: {
                        marginRight: 4,
                      },
                      label: {
                        fontWeight: 600,
                        fontSize: 11,
                        lineHeight: '24px',
                      },
                    }}
                    onClick={() => {
                      setNodeVisibility((current) => ({ ...current, [filter]: !current[filter] }))
                    }}
                  >
                    {buildNodeVisibilityLabel(filter)}
                  </Button>
                )
              })}
            </Group>
          </PanelCard>
        )
        return slot ? createPortal(panel, slot) : panel
      })()}
      {/* Focus mode breadcrumb with hierarchy */}
      {!viewOnly && focusedNodeSummary && (() => {
        const slot = typeof document !== 'undefined' ? document.getElementById('tc-canvas-breadcrumb-slot') : null
        const breadcrumb = (
          <PanelCard
            className="tc-canvas__breadcrumb"
            padding="compact"
            style={{
              position: slot ? 'relative' : 'absolute',
              left: slot ? undefined : 12,
              top: slot ? undefined : 12,
              zIndex: slot ? undefined : 340,
              pointerEvents: 'auto',
            }}
          >
            <Group className="tc-canvas__breadcrumb-group" gap={8} style={{ flexWrap: 'nowrap' }}>
              <Text className="tc-canvas__breadcrumb-label" size="sm" fw={600}>{$('聚焦节点')}:</Text>
              <Button className="tc-canvas__breadcrumb-button" size="xs" variant="filled">
                {focusedNodeSummary.label}
              </Button>
              <Divider className="tc-canvas__breadcrumb-divider" orientation="vertical" style={{ height: 16 }} />
              <Button className="tc-canvas__breadcrumb-action" size="xs" variant="subtle" onClick={()=>{ clearFocusedSubgraph(); setTimeout(()=> rf.fitView?.({ padding: 0.2 }), 50) }}>退出聚焦</Button>
            </Group>
          </PanelCard>
        )
        return slot ? createPortal(breadcrumb, slot) : breadcrumb
      })()}
      {!viewOnly && referencePickerTargetId && (
        <PanelCard
          className="tc-canvas__reference-picker-bar"
          padding="compact"
          style={{
            position: 'absolute',
            left: '50%',
            top: 16,
            transform: 'translateX(-50%)',
            zIndex: 340,
            pointerEvents: 'auto',
          }}
        >
          <Group className="tc-canvas__reference-picker-bar-group" gap={8} wrap="nowrap">
            <Text className="tc-canvas__reference-picker-bar-title" size="sm" fw={700}>
              从画布选择参考
            </Text>
            <Text className="tc-canvas__reference-picker-bar-meta" size="xs" c="dimmed">
              点击未连接到当前节点的图片后直接连线
            </Text>
            <Divider className="tc-canvas__reference-picker-bar-divider" orientation="vertical" style={{ height: 16 }} />
            <Button
              className="tc-canvas__reference-picker-bar-exit"
              size="xs"
              variant="subtle"
              onClick={() => closeCanvasReferencePicker()}
            >
              退出
            </Button>
          </Group>
        </PanelCard>
      )}
      {(guides?.vx !== undefined || guides?.hy !== undefined) && (
        <CanvasViewportOverlays
          guides={guides}
        />
      )}
      {selectionActionAnchor && !viewOnly && !dragging && !viewportMoving && (
        <CanvasSelectionActionBar anchor={selectionActionAnchor}>
          <PanelCard
            className="tc-canvas__selection-action-bar-card"
            padding="compact"
            style={{
              background: 'rgba(28, 28, 30, 0.94)',
              borderColor: 'rgba(255,255,255,0.1)',
              boxShadow: '0 20px 48px rgba(0,0,0,0.32)',
            }}
          >
            <Group className="tc-canvas__selection-action-bar-group" gap={6} style={{ flexWrap: 'nowrap' }}>
              <Button
                className="tc-canvas__selection-action-bar-action"
                size="xs"
                radius="xs"
                variant="subtle"
                color="gray"
                leftSection={<IconBoxMultiple className="tc-canvas__selection-action-bar-icon" size={14} />}
                styles={{ root: { color: '#f5f5f7', fontWeight: 600 } }}
              >
                {selectionActionAnchor.selectedCount}
              </Button>
              {canCreateScriptBundleFromSelection && (
                <Button
                  className="tc-canvas__selection-action-bar-action"
                  size="xs"
                  radius="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconLayoutGridAdd className="tc-canvas__selection-action-bar-icon" size={14} />}
                  styles={{ root: { color: '#f5f5f7', fontWeight: 600 } }}
                  onClick={() => createScriptBundleFromSelection()}
                >
                  拼接脚本
                </Button>
              )}
              {canCreateGroupFromSelection && (
                <Button
                  className="tc-canvas__selection-action-bar-action"
                  size="xs"
                  radius="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconLayoutGridAdd className="tc-canvas__selection-action-bar-icon" size={14} />}
                  styles={{ root: { color: '#f5f5f7', fontWeight: 600 } }}
                  onClick={() => addGroupForSelection()}
                >
                  打组
                </Button>
              )}
              {canRunSelectedGroup && (
                <Button
                  className="tc-canvas__selection-action-bar-action"
                  size="xs"
                  radius="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconPlayerPlay className="tc-canvas__selection-action-bar-icon" size={14} />}
                  styles={{ root: { color: '#f5f5f7', fontWeight: 600 } }}
                  loading={isRunningSelectedGroup}
                  disabled={!canRunSelectedGroup}
                  onClick={() => {
                    if (selectedGroupIds.length !== 1) return
                    void runGroupNodes(selectedGroupIds[0])
                  }}
                >
                  {isRunningSelectedGroup ? '执行中…' : '整组执行'}
                </Button>
              )}
              {canPublishSelectedGroupTemplate && (
                <Button
                  className="tc-canvas__selection-action-bar-action"
                  size="xs"
                  radius="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconLayoutGridAdd className="tc-canvas__selection-action-bar-icon" size={14} />}
                  styles={{ root: { color: '#f5f5f7', fontWeight: 600 } }}
                  onClick={() => { void publishSelectedGroupAsTemplate() }}
                >
                  创建模板
                </Button>
              )}
              {canUngroupSelection && (
                <Button
                  className="tc-canvas__selection-action-bar-action"
                  size="xs"
                  radius="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconBrackets className="tc-canvas__selection-action-bar-icon" size={14} />}
                  styles={{ root: { color: '#f5f5f7', fontWeight: 600 } }}
                  onClick={() => runUngroupSelection()}
                >
                  解组
                </Button>
              )}
              {hasSelectionOverflowActions && (
                <Menu shadow="md" width={180} withinPortal position="bottom-end">
                  <Menu.Target>
                    <Button
                      className="tc-canvas__selection-action-bar-action"
                      size="xs"
                      radius="xs"
                      variant="subtle"
                      color="gray"
                      styles={{ root: { color: '#f5f5f7', fontWeight: 600 } }}
                    >
                      更多
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {canLayoutSelection && (
                      <>
                        <Menu.Item onClick={() => runLayoutSelection('grid')}>
                          紧凑排序
                        </Menu.Item>
                        <Menu.Item onClick={() => runLayoutSelection('flow')}>
                          链路排序
                        </Menu.Item>
                        <Menu.Item onClick={() => runLayoutSelection('column')}>
                          单列排序
                        </Menu.Item>
                      </>
                    )}
                    {canStitchSelectedGroup && (
                      <Menu.Item onClick={() => {
                        if (selectedGroupIds.length !== 1) return
                        void stitchGroupToLongImage(selectedGroupIds[0])
                      }}>
                        {stitchingGroupId ? '生成长图中…' : '生成长图'}
                      </Menu.Item>
                    )}
                    {downloadAssetsGroupId && (
                      <Menu.Item
                        disabled={!canDownloadSelectedGroupAssets}
                        onClick={() => { void runDownloadSelectedGroupAssets() }}
                      >
                        {downloadingGroupAssetsId ? '下载中…' : '下载组内素材'}
                      </Menu.Item>
                    )}
                    {canSaveSelectedGroupWorkflow && (
                      <Menu.Item onClick={() => { void saveSelectedGroupAsWorkflowAsset() }}>
                        保存为资产
                      </Menu.Item>
                    )}
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
          </PanelCard>
        </CanvasSelectionActionBar>
      )}
      {menu?.show && (
        <PanelCard
          className="tc-canvas__context-menu"
          padding="compact"
          onMouseLeave={() => setMenu(null)}
          style={{
            position: 'fixed',
            left: Math.max(8, Math.min(menu.x, Math.max(8, window.innerWidth - 280))),
            top: Math.max(8, Math.min(menu.y, Math.max(8, window.innerHeight - 420))),
            zIndex: 60,
            minWidth: 220,
            maxHeight: 'min(72vh, 520px)',
            overflowY: 'auto',
          }}
        >
          <Stack className="tc-canvas__context-menu-stack" gap={4} p="xs">
            {menu.type === 'canvas' && (
              <>
                {CANVAS_CONTEXT_ADDABLE_KINDS.map((kind) => {
                  const schema = getTaskNodeSchema(kind)
                  return (
                    <Button
                      key={kind}
                      className="tc-canvas__context-menu-action"
                      variant="subtle"
                      onClick={() => createTaskNodeAtMenu(kind)}
                    >
                      新建{schema.label || kind}
                    </Button>
                  )
                })}
              </>
            )}
            {menu.type === 'node' && menu.id && (() => {
              const menuNode = nodes.find((n) => n.id === menu.id)
              const nodeIsGroup = menuNode?.type === 'groupNode'
              return (
                <>
                  {nodeIsGroup && (
                    <>
                      <Button
                        className="tc-canvas__context-menu-action"
                        variant="subtle"
                        loading={runningGroupId === menu.id}
                        disabled={Boolean(runningGroupId)}
                        onClick={() => {
                          void runGroupNodes(menu.id!)
                          setMenu(null)
                        }}
                      >
                        {runningGroupId === menu.id ? '执行中…' : '一键执行组内节点'}
                      </Button>
                      <Button
                        className="tc-canvas__context-menu-action"
                        variant="subtle"
                        loading={stitchingGroupId === menu.id}
                        disabled={Boolean(stitchingGroupId)}
                        onClick={() => {
                          void stitchGroupToLongImage(menu.id!)
                          setMenu(null)
                        }}
                      >
                        {stitchingGroupId ? '生成中…' : '生成长图'}
                      </Button>
                      <Button
                        className="tc-canvas__context-menu-action"
                        variant="subtle"
                        loading={publishingTemplateGroupId === menu.id}
                        disabled={Boolean(publishingTemplateGroupId)}
                        onClick={() => {
                          void publishSelectedGroupAsTemplate(menu.id!)
                          setMenu(null)
                        }}
                      >
                        {publishingTemplateGroupId === menu.id ? '保存模板中…' : '创建模板'}
                      </Button>
                      <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { ungroupGroupNode(menu.id!); setMenu(null) }}>
                        解组
                      </Button>
                      <Divider className="tc-canvas__context-menu-divider" my={2} />
                    </>
                  )}
                  {!nodeIsGroup && canCreateGroupFromSelection && (
                    <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { addGroupForSelection(); setMenu(null) }}>
                      打组
                    </Button>
                  )}
                  {!nodeIsGroup && canCreateScriptBundleFromSelection && (
                    <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { createScriptBundleFromSelection(); setMenu(null) }}>
                      拼接脚本
                    </Button>
                  )}
                  {!nodeIsGroup && canUngroupSelection && (
                    <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { runUngroupSelection(); setMenu(null) }}>
                      解组
                    </Button>
                  )}
                  {!nodeIsGroup && (canCreateGroupFromSelection || canCreateScriptBundleFromSelection || canUngroupSelection) && <Divider className="tc-canvas__context-menu-divider" my={2} />}
                  <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { duplicateNode(menu.id!); setMenu(null) }}>复制一份</Button>
                  <Button className="tc-canvas__context-menu-action" variant="subtle" color="red" onClick={() => { deleteNode(menu.id!); setMenu(null) }}>删除</Button>
                  <Divider className="tc-canvas__context-menu-divider" my={2} />
                  <Button
                    className="tc-canvas__context-menu-action"
                    variant="subtle"
                    onClick={async () => {
                      await runFlowDag(2, useRFStore.getState, useRFStore.setState, { only: new Set([menu.id!]) })
                      setMenu(null)
                    }}
                  >
                    运行该节点
                  </Button>
                  <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { cancelNode(menu.id!); setNodeStatus(menu.id!, 'error', { progress: 0, lastError: '任务已取消' }); setMenu(null) }}>停止该节点</Button>
                </>
              )
            })()}
            {menu.type === 'edge' && menu.id && (
              <Button className="tc-canvas__context-menu-action" variant="subtle" color="red" onClick={() => { deleteEdge(menu.id!); setMenu(null) }}>删除连线</Button>
            )}
          </Stack>
        </PanelCard>
      )}
      {insertMenuContent && (
          <PanelCard
            className="tc-canvas__insert-menu"
            padding="compact"
            style={{
              position: 'fixed',
              left: insertMenu.x,
              top: insertMenu.y,
              zIndex: 70,
              minWidth: 220,
              transform: 'translate(10px, 10px)',
            }}
            ref={insertMenuRef}
          >
            <Stack className="tc-canvas__insert-menu-stack" gap={6} p="xs">
              <Group className="tc-canvas__insert-menu-header" justify="space-between" gap={8} wrap="nowrap">
                <Text className="tc-canvas__insert-menu-title" size="xs" c="dimmed" lineClamp={1} title={insertMenuContent.title}>
                  {insertMenuContent.title}
                </Text>
                <Button className="tc-canvas__insert-menu-close" variant="subtle" size="xs" onClick={closeInsertMenu}>
                  关闭
                </Button>
              </Group>
              {insertMenuContent.schemaCandidates.length > 0 && (
                <>
                  <Text className="tc-canvas__insert-menu-section" size="xs" c="dimmed">
                    新建并连接
                  </Text>
                  {insertMenuContent.schemaCandidates.map(({ schema, targetHandleId }) => (
                    <Button
                      key={schema.kind}
                      className="tc-canvas__insert-menu-action"
                      variant="subtle"
                      size="xs"
                      onClick={() => {
                        handleInsertNodeAt(schema.kind, {
                          x: insertMenu.x,
                          y: insertMenu.y,
                          fromNodeId: insertMenu.fromNodeId,
                          fromHandle: insertMenu.fromHandle,
                          targetHandleId,
                        })
                      }}
                    >
                      {schema.label || schema.kind}
                    </Button>
                  ))}
                </>
              )}
              {insertMenuContent.schemaCandidates.length === 0 ? (
                <Text className="tc-canvas__insert-menu-empty" size="xs" c="dimmed">
                  暂无可用选项
                </Text>
              ) : null}
            </Stack>
          </PanelCard>
      )}
      {connectingType && (
        <div className="tc-canvas__connecting-tooltip" style={{ position: 'fixed', left: mouse.x + 12, top: mouse.y + 12, pointerEvents: 'none', fontSize: 12, background: 'rgba(17,24,39,.85)', color: '#e5e7eb', padding: '4px 8px', borderRadius: 6 }}>
          {$t('连接类型: {type}，拖到兼容端口', { type: getHandleTypeLabel(connectingType) })}
        </div>
      )}
      {workflowNameDialog?.mode === 'template' ? (
        <GroupTemplateModal
          opened
          loading={Boolean(publishingTemplateGroupId)}
          coverUploading={templateCoverUploading}
          previewUrl={workflowNameDialog.previewUrl}
          coverUrl={workflowCoverUrlInput}
          saveMode={templateSaveMode}
          visibility={templateVisibility}
          name={workflowNameInput}
          description={workflowDescriptionInput}
          templateProjects={templateProjects}
          selectedTemplateProjectId={selectedTemplateProjectId}
          onClose={closeWorkflowNameDialog}
          onSubmit={() => { void submitWorkflowNameDialog() }}
          onSaveModeChange={(value) => {
            setTemplateSaveMode(value)
            if (value === 'create') {
              setWorkflowNameInput(workflowNameDialog.initialName)
              setWorkflowDescriptionInput(workflowNameDialog.initialDescription)
              setWorkflowCoverUrlInput(workflowNameDialog.initialCoverUrl)
              setTemplateVisibility('private')
              setSelectedTemplateProjectId('')
              return
            }
            if (templateProjects.length > 0) {
              setSelectedTemplateProjectId(templateProjects[0].id)
            }
          }}
          onVisibilityChange={setTemplateVisibility}
          onNameChange={setWorkflowNameInput}
          onDescriptionChange={setWorkflowDescriptionInput}
          onSelectedTemplateProjectIdChange={setSelectedTemplateProjectId}
          onTriggerCoverUpload={triggerTemplateCoverUpload}
        />
      ) : (
        <Modal
          className="tc-canvas__workflow-name-modal"
          opened={Boolean(workflowNameDialog)}
          onClose={closeWorkflowNameDialog}
          title={workflowNameDialog?.title || '输入名称'}
          centered
        >
          <Stack className="tc-canvas__workflow-name-modal-stack" gap="sm">
            <TextInput
              className="tc-canvas__workflow-name-modal-input"
              label="名称"
              value={workflowNameInput}
              onChange={(event) => setWorkflowNameInput(event.currentTarget.value)}
              placeholder="请输入名称"
              autoFocus
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                void submitWorkflowNameDialog()
              }}
            />
            <Textarea
              className="tc-canvas__workflow-name-modal-description"
              label="描述"
              value={workflowDescriptionInput}
              onChange={(event) => setWorkflowDescriptionInput(event.currentTarget.value)}
              placeholder="可选：一句话说明这个工作流用途"
              minRows={2}
              maxRows={4}
            />
            <TextInput
              className="tc-canvas__workflow-name-modal-cover"
              label="封面 URL"
              value={workflowCoverUrlInput}
              onChange={(event) => setWorkflowCoverUrlInput(event.currentTarget.value)}
              placeholder="可选：https://..."
            />
            <Group className="tc-canvas__workflow-name-modal-actions" justify="flex-end" gap="xs">
              <Button className="tc-canvas__workflow-name-modal-cancel" variant="subtle" onClick={closeWorkflowNameDialog}>
                取消
              </Button>
              <Button
                className="tc-canvas__workflow-name-modal-confirm"
                onClick={() => { void submitWorkflowNameDialog() }}
                loading={Boolean(savingWorkflowGroupId)}
              >
                {workflowNameDialog?.confirmLabel || '确定'}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
      <input
        ref={templateCoverUploadInputRef}
        className="tc-canvas__template-cover-upload-input"
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleTemplateCoverUploadInputChange}
      />
      </div>
    </CanvasRenderContext.Provider>
  )
}

function CanvasViewportOverlays({
  guides,
}: {
  guides: { vx?: number; hy?: number } | null
}): JSX.Element | null {
  const [tx, ty, zoom] = useStore((s) => s.transform)
  const flowToScreen = useCallback((p: { x: number; y: number }) => ({ x: p.x * zoom + tx, y: p.y * zoom + ty }), [tx, ty, zoom])

  return (
    <>
      {guides?.vx !== undefined && (
        <div className="tc-canvas__guide-vertical" style={{ position: 'absolute', left: flowToScreen({ x: guides.vx!, y: 0 }).x, top: 0, width: 1, height: '100%', background: 'rgba(59,130,246,.5)' }} />
      )}
      {guides?.hy !== undefined && (
        <div className="tc-canvas__guide-horizontal" style={{ position: 'absolute', left: 0, top: flowToScreen({ x: 0, y: guides.hy! }).y, width: '100%', height: 1, background: 'rgba(16,185,129,.5)' }} />
      )}
    </>
  )
}

const CanvasSelectionActionBar = React.memo(function CanvasSelectionActionBar({
  anchor,
  children,
}: {
  anchor: SelectionActionAnchor
  children: React.ReactNode
}): JSX.Element {
  const [tx, ty, zoom] = useStore((s) => s.transform)

  return (
    <div
      className="tc-canvas__selection-action-bar"
      style={{
        position: 'absolute',
        left: anchor.centerX * zoom + tx,
        top: Math.max(8, anchor.topY * zoom + ty - 44),
        transform: 'translateX(-50%)',
        zIndex: 80,
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label="框选操作栏"
    >
      {children}
    </div>
  )
})

const ReactFlowProviderWithClass =
  ReactFlowProvider as unknown as React.FC<React.PropsWithChildren<{ className?: string }>>

export default function Canvas({ className }: { className?: string }): JSX.Element {
  const innerClassName = ['tc-canvas-inner', className].filter(Boolean).join(' ')

  return (
    <ReactFlowProviderWithClass className="tc-canvas-provider">
      <CanvasInner className={innerClassName} />
    </ReactFlowProviderWithClass>
  )
}
