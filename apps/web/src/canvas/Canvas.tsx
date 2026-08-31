import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useProjectImageSettingsStore } from './projectImageSettingsStore'
import {
  ReactFlow,
  Background,
  MiniMap,
  applyNodeChanges,
  useReactFlow,
  useStore,
  useStoreApi,
  useUpdateNodeInternals,
  ConnectionLineType,
  ReactFlowProvider,
  getBezierPath,
  type ConnectionLineComponentProps,
  type Connection,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeChange,
  type OnConnectEnd,
  type OnConnectStart,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './CanvasInteractionPerformance.css'
import { CanvasVirtualizationContext } from './CanvasVirtualizationContext'
import { CanvasLODContext } from './CanvasLODContext'
import { CanvasBottomControls } from './CanvasBottomControls'
import { CanvasDevPerfPanel } from './components/CanvasDevPerfPanel'
import { CanvasIntentInputDialog } from './CanvasIntentInputDialog'

import { DirectorCaptureRunner } from './nodes/directorConsole/DirectorCaptureRunner'
import { applyTidyPosition, beginCanvasNodeDrag, clearCanvasNodeDragActivity, isCanvasNodeDragActive, registerCanvasTidyExecutor, useRFStore } from './store'
import { useFocusStore } from './focusStore'
import { toast } from '../ui/toast'
import { applyTemplateAt } from '../templates'
import { Stack, Button, Divider, Group, Select, Text, Modal, TextInput, Textarea, Menu, useMantineColorScheme, useMantineTheme } from '@mantine/core'
import { IconAlertTriangle, IconBoxMultiple, IconBrackets, IconLayoutGridAdd, IconMovie, IconPlayerPlay, IconPlugConnected, IconPlus, IconX } from '@tabler/icons-react'
import { $, $t } from './i18n'
import { CANVAS_EDGE_TYPES, CANVAS_NODE_TYPES } from './canvasElementTypes'
import { useUIStore } from '../ui/uiStore'
import { getActiveTeamId } from '../ui/team/TeamManagementModal'
import { runFlowDag } from '../runner/dag'
import { syncGenericVideoNodeOnce, syncImageNodeOnce } from '../runner/remoteRunner'
import { isWorkflowOwnedMediaNodeData } from '../runner/mediaTaskRuntime'
import { useInsertMenuStore } from './insertMenuStore'
import { getHandleTypeLabel } from './utils/handleLabels'
import { isCanvasTextInteractionTarget } from './utils/isCanvasTextInteractionTarget'
import { useAuth } from '../auth/store'
import { useIsAdmin } from '../auth/isAdmin'
import { createFlowVersionSnapshot, generateWorkflowCapabilityDescription as requestWorkflowCapabilityDescription, getProjectDirectorPersona, listDirectorPersonas, listProjectFlows, listProjects, recoverUploadedServerAssetFile, saveProjectCoverMeta, saveProjectFlow, setProjectDirectorPersona, updateProjectTemplate, upsertProject, uploadServerAssetFile, type DirectorPersonaSummary, type ProjectDto } from '../api/server'
import { genTaskNodeId } from './nodes/taskNodeHelpers'
import { CANVAS_CONFIG } from './utils/constants'
import { buildEdgeValidator } from './utils/edgeRules'
import { buildCanvasThemeColors } from './utils/canvasTheme'
import {
  createTaskNodeInitialData,
  getTaskNodeCoreType,
  getTaskNodeSchema,
  listTaskNodeSchemas,
  type TaskNodeHandleConfig,
  type TaskNodeSchema,
} from './nodes/taskNodeSchema'
import { usePreventBrowserSwipeNavigation } from '../utils/usePreventBrowserSwipeNavigation'
import { formatErrorMessage } from './utils/formatErrorMessage'
import { getPointToRectDistance, isPointInsideRect, screenPathIntersectsRect } from './utils/connectionAutoSnap'
import { normalizeCanvasNodeChanges } from './utils/normalizeCanvasNodeChanges'
import { accumulateSelectionChanges } from './utils/accumulateSelectionChanges'
import { shouldHideEdgesAtZoom } from './utils/extremeZoomEdgeVisibility'
import { getConnectedNodeIds } from './utils/connectedNodeIds'
import { computeTidyByCategoryLayout } from './tidyByCategory'
import { getNodeAbsPosition, getNodeSize } from './utils/nodeBounds'
import { downloadGroupAssets } from './utils/groupAssetDownload'
import { GroupTemplateModal, type TemplateSaveMode, type TemplateVisibility } from './components/GroupTemplateModal'
import { WorkflowCapabilityDescriptionModal } from './components/WorkflowCapabilityDescriptionModal'
import {
  buildWorkflowDescriptionContext,
} from './workflowCapabilityDescription'
import { StoryboardRecipePicker } from './components/StoryboardRecipePicker'
import { VideoProfileConfirmCard } from './components/VideoProfileConfirmCard'
import { isVideoProfileRoutingEnabled } from './videoProfileFlags'
import { extractCanvasGraph, type CanvasImportData } from './utils/serialization'
import { getTapImageDragPayload } from './dnd/setTapImageDragData'
import { buildStoryboardEditorPatch, normalizeStoryboardNodeData } from './nodes/taskNode/storyboardEditor'
import { resourceManager } from '../domain/resource-runtime'
import {
  setCanvasNodeDragging,
  setCanvasViewportMoving,
} from '../domain/resource-runtime/hooks/useViewportVisibility'
import {
  CANVAS_MIN_ZOOM,
  shouldUseCanvasOverviewLod,
  shouldVirtualizeCanvas,
} from './canvasPerformancePolicy'
import type { CanvasPerformanceApi } from './performance/canvasPerformanceApi'
import { applyActiveNodeDragFrame } from './applyActiveNodeDragFrame'
import { useUploadRuntimeStore } from '../domain/upload-runtime/store/uploadRuntimeStore'
import { dedupeLocalFiles } from '../utils/localUploadDedup'
import { CanvasRenderContext } from './CanvasRenderContext'
import { EdgeInteractionContext } from './edges/EdgeInteractionContext'
import { PanelCard } from '../ui/PanelCard'
import { InlinePanel } from '../ui/InlinePanel'
import { buildCanvasNodeFilmChatText, CANVAS_NODE_FILM_CHAT_DISPLAY_TEXT } from './filmChatCommand'
import { buildOneClickFilmChatText, ONE_CLICK_FILM_CHAT_DISPLAY_TEXT } from './oneClickFilmChatCommand'
import { emitDirectorPersonaChanged } from '../ui/DirectorPersonaChip'
import { startScriptToAssets } from './scriptToAssetsOrchestrator'
import { usePresenceStore } from './sync/presenceStore'
import { CanvasCursorOverlay } from './sync/CanvasCursorOverlay'
import { useChatCommandStore } from '../ui/chat/chatCommandStore'
import { VIDEO_PRODUCTION_WORKFLOW_KEY } from '@tapcanvas/video-orchestrator-protocol'
import { AGENT_WORKFLOW_KEY } from '@tapcanvas/workflow-kernel-protocol'
import { useFlowTabPresence } from './hooks/useFlowTabPresence'
import { useViewportAnchoredElement } from './hooks/useViewportAnchoredElement'
import { VideoCompareModal } from './videoCompare/VideoCompareModal'
import { useVideoCompareStore } from './videoCompare/videoCompareStore'
import { resolveVideoCompareSelection } from './videoCompare/videoCompareSelection'
import { filterAdminWorkflowCanvasGraph } from './adminWorkflowVisibility'
import { VideoCompareSelectionAction } from './videoCompare/VideoCompareSelectionAction'
import { saveCurrentCanvasSnapshot } from './persistence/saveCurrentCanvasSnapshot'
import { useModelOptionsState } from '../config/useModelOptions'
import {
  readStoredChatModelValue,
  requireSelectedChatModelRequest,
} from '../ui/chat/chatModelSelection'
import { WorkflowNodeInspectorPanel } from './components/WorkflowNodeInspectorPanel'
import { useWorkflowNodeInspectorStore } from './workflowNodeInspectorStore'
import { runAgentWorkflow } from './agentWorkflowExecution'
import { runVideoWorkflow } from './videoWorkflowExecution'
import {
  isWorkflowGroup,
  resolveWorkflowGroupTrigger,
  validateWorkflowCapabilitySelection,
} from './workflowGroupExecution'
import { isWorkflowAgentReferenceEdge } from './workflowAgentReferenceProjection'

// 限制不同节点类型之间的连接关系；未匹配的类型默认放行，避免阻塞用户操作
const isValidEdgeByType = buildEdgeValidator()

const INSERT_MENU_EXCLUDED_KINDS = new Set<string>()

type InsertMenuSchemaCandidate = {
  schema: TaskNodeSchema
  targetHandleId: string
  disabled: boolean
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

let primaryImageBindingsSource: RFStoreState['nodes'] | null = null
let primaryImageBindingsCache: NodePrimaryImageBinding[] = []

const selectNodePrimaryImageBindings = (state: RFStoreState): NodePrimaryImageBinding[] => {
  if (isCanvasNodeDragActive() && primaryImageBindingsSource) return primaryImageBindingsCache
  if (state.nodes === primaryImageBindingsSource) return primaryImageBindingsCache
  primaryImageBindingsSource = state.nodes
  primaryImageBindingsCache = state.nodes.map((node) => ({
    nodeId: String(node.id),
    imageUrl: resolveNodePrimaryImageUrl(node as FlowNode),
  }))
  return primaryImageBindingsCache
}

const areNodePrimaryImageBindingsEqual = (a: NodePrimaryImageBinding[], b: NodePrimaryImageBinding[]) => {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (a[index]?.nodeId !== b[index]?.nodeId) return false
    if (a[index]?.imageUrl !== b[index]?.imageUrl) return false
  }
  return true
}

let selectedNodeIdsSource: RFStoreState['nodes'] | null = null
let selectedNodeIdsCache: string[] = []

const selectSelectedNodeIds = (state: RFStoreState): string[] => {
  if (isCanvasNodeDragActive() && selectedNodeIdsSource) return selectedNodeIdsCache
  if (state.nodes === selectedNodeIdsSource) return selectedNodeIdsCache
  selectedNodeIdsSource = state.nodes
  selectedNodeIdsCache = state.nodes.reduce<string[]>((acc, node) => {
    if (node.selected) acc.push(String(node.id))
    return acc
  }, [])
  return selectedNodeIdsCache
}

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

let selectedNodeSummariesSource: RFStoreState['nodes'] | null = null
let selectedNodeSummariesCache: SelectedNodeSummary[] = []

const selectSelectedNodeSummaries = (state: RFStoreState): SelectedNodeSummary[] => {
  if (isCanvasNodeDragActive() && selectedNodeSummariesSource) return selectedNodeSummariesCache
  if (state.nodes === selectedNodeSummariesSource) return selectedNodeSummariesCache
  selectedNodeSummariesSource = state.nodes
  selectedNodeSummariesCache = state.nodes.reduce<SelectedNodeSummary[]>((acc, node) => {
    if (node.selected) acc.push(readSelectedNodeSummary(node as FlowNode))
    return acc
  }, [])
  return selectedNodeSummariesCache
}

// Sole-selected node id read off React Flow's INTERNAL store (see the focusedNodeId derivation for
// why focus can't wait for the app store's debounced commit). Reference-cached on the internal
// `nodes` array the same way the app-store selectors above are: this selector runs on EVERY internal
// store update (transform changes on every pan/zoom frame included), and `nodes` only changes
// identity when node data actually changes — unlike `nodeLookup`, which React Flow mutates in place
// and so cannot be used as a cache key.
let rfSoleSelectedSource: unknown = null
let rfSoleSelectedCache: string | null = null

const selectRfSoleSelectedNodeId = (state: { nodes: FlowNode[] }): string | null => {
  if (state.nodes === rfSoleSelectedSource) return rfSoleSelectedCache
  rfSoleSelectedSource = state.nodes
  let soleId: string | null = null
  for (const node of state.nodes) {
    if (!node.selected) continue
    // A group anywhere in the selection (alone or alongside nodes) means no single focus, matching
    // the previous app-store derivation (selectedGroupIds.length === 0).
    if (soleId !== null || node.type === 'groupNode') {
      soleId = null
      break
    }
    soleId = String(node.id)
  }
  rfSoleSelectedCache = soleId
  return rfSoleSelectedCache
}

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
  hideDevPerformancePanel?: boolean
  onPerformanceApiReady?: (api: CanvasPerformanceApi | null) => void
}

type CanvasStyle = React.CSSProperties & Record<'--tc-spotlight-radius', string>
type CanvasMiniMapProps = React.ComponentProps<typeof MiniMap>
type CanvasMiniMapClick = NonNullable<CanvasMiniMapProps['onClick']>
type CanvasMiniMapNodeClick = NonNullable<CanvasMiniMapProps['onNodeClick']>

const CANVAS_CONTEXT_ADDABLE_KINDS = [
  'text',
  'image',
  'storyboard',
  'video',
  'videoAnalysis',
  'shotTable',
  'audio',
  'videoCompose',
] as const
const HEAVY_SELECTION_DRAG_THRESHOLD = 6

type WorkflowNameDialogState = {
  mode: 'template'
  groupId: string
  title: string
  confirmLabel: string
  initialName: string
  initialDescription: string
  initialCoverUrl: string
  previewUrl: string | null
}

type WorkflowCapabilityDescriptionDialogState = {
  groupId: string
  triggerNodeId: string
  workflowName: string
}

type SelectionActionAnchor = {
  centerX: number
  maxX: number
  centerY: number
  selectedCount: number
  topY: number
}

const getStaticTargetHandles = (schema: TaskNodeSchema): TaskNodeHandleConfig[] => {
  const handles = schema.handles
  if (!handles || ('dynamic' in handles && handles.dynamic)) return []
  return Array.isArray(handles.targets) ? handles.targets : []
}

function CanvasInner({
  className,
  hideDevPerformancePanel = false,
  onPerformanceApiReady,
}: CanvasInnerProps): JSX.Element {
  const nodes = useRFStore((s) => s.nodes)
  const edges = useRFStore((s) => s.edges)
  const updateNodeInternals = useUpdateNodeInternals()
  const connectedNodeIds = useMemo(() => getConnectedNodeIds(edges), [edges])

  useLayoutEffect(() => {
    if (connectedNodeIds.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      updateNodeInternals(connectedNodeIds)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [connectedNodeIds, updateNodeInternals])
  const nodePrimaryImageBindings = useRFStore(selectNodePrimaryImageBindings, areNodePrimaryImageBindingsEqual)
  const selectedNodeIds = useRFStore(selectSelectedNodeIds, areStringArraysEqual)
  const selectedNodeSummaries = useRFStore(selectSelectedNodeSummaries, areSelectedNodeSummariesEqual)
  const onNodesChange = useRFStore((s) => s.onNodesChange)
  const onEdgesChange = useRFStore((s) => s.onEdgesChange)
  const onConnect = useRFStore((s) => s.onConnect)
  const viewOnly = useUIStore(s => s.viewOnly)
  const edgeRoute = useUIStore(s => s.edgeRoute)
  const currentProject = useUIStore(s => s.currentProject)
  const currentFlowId = useUIStore(s => s.currentFlow.id)
  const currentFlowOwnerType = useUIStore(s => s.currentFlow.ownerType)
  const currentFlowOwnerId = useUIStore(s => s.currentFlow.ownerId)
  const otherTabActive = useFlowTabPresence(
    viewOnly
      ? null
      : {
        projectId: currentProject?.id,
        ownerType: currentFlowOwnerType,
        ownerId: currentFlowOwnerId,
        flowId: currentFlowId,
      },
  )
  // 进项目时从服务端 hydrate 全局风格图（每项目每会话一次）：让节点风格选择跨设备/会话一致，
  // 并能反映 agent set-style 工具写入的全局风格。
  useEffect(() => {
    // 只读浏览（分享/制作过程，未登录）下跳过 hydrate：该接口 owner-scoped、未登录会 401，
    // 且按访客 userId 取不到原作者的 canvas-index，读了也无意义。
    if (viewOnly) return
    const pid = String(currentProject?.id || '').trim()
    if (pid) useProjectImageSettingsStore.getState().ensureHydratedStyleImages(pid)
  }, [currentProject?.id, viewOnly])
  const setCanvasViewport = useUIStore(s => s.setCanvasViewport)
  const restoreViewport = useUIStore(s => s.restoreViewport)
  const setRestoreViewport = useUIStore(s => s.setRestoreViewport)
  const canvasReferencePicker = useUIStore((s) => s.canvasReferencePicker)
  const closeCanvasReferencePicker = useUIStore((s) => s.closeCanvasReferencePicker)
  const deleteNode = useRFStore(s => s.deleteNode)
  const deleteEdge = useRFStore(s => s.deleteEdge)
  const duplicateNode = useRFStore(s => s.duplicateNode)
  const copyNode = useRFStore(s => s.copyNode)
  const clipboard = useRFStore(s => s.clipboard)
  const pasteFromClipboardAt = useRFStore(s => s.pasteFromClipboardAt)
  const importWorkflow = useRFStore(s => s.importWorkflow)
  const addGroupForSelection = useRFStore(s => s.addGroupForSelection)
  const createScriptBundleFromSelection = useRFStore(s => s.createScriptBundleFromSelection)
  const ungroupGroupNode = useRFStore(s => s.ungroupGroupNode)
  const arrangeGroupChildren = useRFStore(s => s.arrangeGroupChildren)
  const cancelNode = useRFStore(s => s.cancelNode)
  const setNodeStatus = useRFStore(s => s.setNodeStatus)
  const canvasViewLocked = useRFStore(s => s.canvasViewLocked)
  const pendingFocusNodeId = useRFStore(s => s.pendingFocusNodeId)
  const clearPendingFocusNodeId = useRFStore(s => s.clearPendingFocusNodeId)
  const rf = useReactFlow()
  const reactFlowStore = useStoreApi<FlowNode, FlowEdge>()
  const theme = useMantineTheme()
  const previousNodeImageMapRef = useRef<Map<string, string | null>>(new Map())

  useEffect(() => {
    if (!pendingFocusNodeId) return
    clearPendingFocusNodeId()
    const nodesById = new Map(useRFStore.getState().nodes.map((n) => [n.id, n] as const))
    const target = nodesById.get(pendingFocusNodeId)
    if (!target) return
    const absPos = getNodeAbsPosition(target, nodesById)
    const { w, h } = getNodeSize(target)
    const currentZoom = rf.getViewport?.().zoom ?? 1
    rf.setCenter?.(absPos.x + w / 2, absPos.y + h / 2, { zoom: currentZoom, duration: 300 })
  }, [pendingFocusNodeId, clearPendingFocusNodeId, rf])

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
  const canvasStyle = useMemo<CanvasStyle>(() => ({
    height: '100%',
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    '--tc-spotlight-radius': isDarkCanvas ? '180px' : '168px',
  }), [isDarkCanvas])
  const connectionLineStyle = useMemo(() => ({
    stroke: isDarkCanvas ? 'rgba(255,255,255,0.32)' : 'rgba(17,18,21,0.82)',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
  }), [isDarkCanvas])
  const [showMinimap, setShowMinimap] = useState(true)
  const [showGrid, setShowGrid] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectingType, setConnectingType] = useState<string | null>(null)
  const lastReason = useRef<string | null>(null)
  const connectFromRef = useRef<{ nodeId: string; handleId: string | null } | null>(null)
  const didConnectRef = useRef(false)
  const [tapConnectSource, setTapConnectSource] = useState<{ nodeId: string } | null>(null)
  const [mouse, setMouse] = useState<{x:number;y:number}>({x:0,y:0})
  const [menu, setMenu] = useState<{ show: boolean; x: number; y: number; type: 'node'|'edge'|'canvas'; id?: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [focusRequestedNodeId, setFocusRequestedNodeId] = useState<string | null>(null)
  const nodeDragActiveRef = useRef(false)
  const pendingSelectionChangesRef = useRef<NodeChange<FlowNode>[]>([])
  const selectionCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragCommitIdleRef = useRef<number | null>(null)
  const pendingDragCommitRef = useRef<NodeChange<FlowNode>[] | null>(null)
  const activeDragElementCacheRef = useRef<Map<string, HTMLElement>>(new Map())
  const tidyLayoutRunRef = useRef(0)
  const tidyCommitIdleRef = useRef<number | null>(null)
  // paneDragging only fires for mouse-drag pan; onMoveStart/onMoveEnd covers all viewport changes (scroll zoom, pinch, etc.)
  const vpMovingEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const edgesHiddenForExtremeZoomRef = useRef(false)
  const isBoxSelecting = useStore((state) => state.userSelectionActive)
  const [stitchingGroupId, setStitchingGroupId] = useState<string | null>(null)
  const [runningGroupId, setRunningGroupId] = useState<string | null>(null)
  const [publishingTemplateGroupId, setPublishingTemplateGroupId] = useState<string | null>(null)
  const [openingCapabilityBayGroupId, setOpeningCapabilityBayGroupId] = useState<string | null>(null)
  const [downloadingGroupAssetsId, setDownloadingGroupAssetsId] = useState<string | null>(null)
  const [storyboardPickerGroupId, setStoryboardPickerGroupId] = useState<string | null>(null)
  // 视频领域档案确认卡（VIDEO_PROFILE_ROUTING=ON）。recipe 选定后、派发前先识别领域并让用户确认，
  // 确认后把 videoProfileId 确定性钉到组 data。flag OFF 时此 state 永远为 null（逐字等价现状）。
  const [videoProfilePending, setVideoProfilePending] = useState<
    { groupId: string; recipeId: string; opts: { durationSeconds: number; aspect?: string; videoModel?: string } } | null
  >(null)
  const [pendingOcvNodeId, setPendingOcvNodeId] = useState<string | null>(null)
  // 一键出片弹窗内的可选「选导演」阶段：人格池来自 knowledge/作者导演美学 知识卡，
  // 选定后项目级持久化（canvas-index.json directorPersona），agents-bridge 每轮注入锁定块。
  const [directorPersonaPool, setDirectorPersonaPool] = useState<DirectorPersonaSummary[]>([])
  const [directorPersonaValue, setDirectorPersonaValue] = useState<string>('')
  useEffect(() => {
    if (pendingOcvNodeId === null) return
    const projectId = String(currentProject?.id || '').trim()
    void listDirectorPersonas()
      .then(setDirectorPersonaPool)
      .catch(() => setDirectorPersonaPool([]))
    if (projectId) {
      void getProjectDirectorPersona(projectId)
        .then((p) => setDirectorPersonaValue(p?.personaId ?? ''))
        .catch(() => setDirectorPersonaValue(''))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOcvNodeId])
  const [workflowNameDialog, setWorkflowNameDialog] = useState<WorkflowNameDialogState | null>(null)
  const [workflowNameInput, setWorkflowNameInput] = useState('')
  const [workflowDescriptionInput, setWorkflowDescriptionInput] = useState('')
  const [workflowCoverUrlInput, setWorkflowCoverUrlInput] = useState('')
  const [templateSaveMode, setTemplateSaveMode] = useState<TemplateSaveMode>('create')
  const [templateVisibility, setTemplateVisibility] = useState<TemplateVisibility>('private')
  const [templateProjects, setTemplateProjects] = useState<ProjectDto[]>([])
  const [selectedTemplateProjectId, setSelectedTemplateProjectId] = useState('')
  const [templateCoverUploading, setTemplateCoverUploading] = useState(false)
  const [workflowCapabilityDescriptionDialog, setWorkflowCapabilityDescriptionDialog] = useState<WorkflowCapabilityDescriptionDialogState | null>(null)
  const [workflowCapabilityDescriptionInput, setWorkflowCapabilityDescriptionInput] = useState('')
  const [workflowCapabilityDescriptionGenerating, setWorkflowCapabilityDescriptionGenerating] = useState(false)
  const workflowDescriptionModelCatalog = useModelOptionsState('text', {
    enabled: workflowCapabilityDescriptionDialog !== null,
  })
  const insertMenu = useInsertMenuStore(s => ({ open: s.open, x: s.x, y: s.y, edgeId: s.edgeId, fromNodeId: s.fromNodeId, fromHandle: s.fromHandle }))
  const closeInsertMenu = useInsertMenuStore(s => s.closeMenu)
  const [multiSelectSourceKinds, setMultiSelectSourceKinds] = useState<string[]>([])
  const [multiDragLine, setMultiDragLine] = useState<{ fromX: number; fromY: number; toX: number; toY: number } | null>(null)
  const authToken = useAuth(s => s.token)
  const isAdmin = useIsAdmin()
  const templateCoverUploadInputRef = useRef<HTMLInputElement | null>(null)
  const viewOnlyFormattedOnceRef = useRef(false)
  const soraSyncingRef = useRef<Set<string>>(new Set())
  const imageSyncingRef = useRef<Set<string>>(new Set())
  const rootRef = useRef<HTMLDivElement | null>(null)
  const viewportMovingRef = useRef(false)
  const spotlightCircleRef = useRef<HTMLDivElement | null>(null)
  const spotlightFrameRef = useRef<number | null>(null)
  const spotlightClientPointRef = useRef<{ x: number; y: number } | null>(null)
  const lastMeasuredCanvasWidthRef = useRef<number | null>(null)
  const multiSourceNodeIdsRef = useRef<string[]>([])
  const initialFitAppliedRef = useRef(false)
  const restoreAppliedRef = useRef(false)
  const lastPointerScreenRef = useRef<{ x: number; y: number } | null>(null)
  const previewLineRafRef = React.useRef(0)
  const lastSavedCoverRef = React.useRef<string>('')
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null)
  const pendingImageUploadScreenRef = useRef<{ x: number; y: number } | null>(null)
  usePreventBrowserSwipeNavigation({ rootRef, withinSelector: '.tc-canvas__flow' })

  // Ctrl/Cmd+A 全选交由 KeyboardShortcuts 的 selectAll() 处理（不再在画布捕获阶段拦截）。
  useEffect(() => {
    return () => {
      cancelAnimationFrame(previewLineRafRef.current)
    }
  }, [])

  const isImageFile = (file: File) => Boolean(file?.type?.startsWith('image/'))
  const isVideoFile = (file: File) => Boolean(file?.type?.startsWith('video/'))

  // spotlight 圆形 div 通过 ref 直接访问，CSS variables 写入该元素，
  // 配合 @property { inherits: false } 令变量变更仅触发该单个元素的样式重算
  const getSpotlightEl = useCallback((): HTMLElement | null => {
    return spotlightCircleRef.current
  }, [])

  const setSpotlightVisible = useCallback((visible: boolean) => {
    const el = getSpotlightEl()
    if (!el) return
    el.style.setProperty('--tc-spotlight-opacity', visible ? '1' : '0')
  }, [getSpotlightEl])

  const flushSpotlightPosition = useCallback(() => {
    spotlightFrameRef.current = null
    if (viewportMovingRef.current) return
    const root = rootRef.current
    const el = getSpotlightEl()
    const point = spotlightClientPointRef.current
    if (!root || !el || !point) return
    const rect = root.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const localX = Math.max(0, Math.min(rect.width, point.x - rect.left))
    const localY = Math.max(0, Math.min(rect.height, point.y - rect.top))
    el.style.setProperty('--tc-spotlight-x', `${Math.round(localX)}px`)
    el.style.setProperty('--tc-spotlight-y', `${Math.round(localY)}px`)
  }, [getSpotlightEl])

  const queueSpotlightPosition = useCallback((clientX: number, clientY: number) => {
    spotlightClientPointRef.current = { x: clientX, y: clientY }
    if (spotlightFrameRef.current !== null) return
    spotlightFrameRef.current = window.requestAnimationFrame(flushSpotlightPosition)
  }, [flushSpotlightPosition])

  // Large canvases use one coherent rendering path: React Flow owns visible-node
  // virtualization, while the node layer owns low-zoom LOD. Keeping culling inside
  // the framework avoids reconciling a second 1000-item array of custom hidden flags.
  const heavyCanvas = shouldVirtualizeCanvas(nodes.length)
  // 重画布（>24 节点）默认关 minimap：React Flow 的 MiniMap 每次渲染遍历全量节点、
  // 不吃虚拟化，重画布下是恒定开销。只在首次进入重状态时自动关一次，用户手动重开后不再干预。
  const minimapAutoOffRef = useRef(false)
  useEffect(() => {
    if (heavyCanvas && !minimapAutoOffRef.current) {
      minimapAutoOffRef.current = true
      setShowMinimap(false)
    }
  }, [heavyCanvas])
  const [lodDegraded, setLodDegraded] = useState(false)
  const lodDegradedRef = useRef(false)
  const heavyCanvasRef = useRef(heavyCanvas)
  heavyCanvasRef.current = heavyCanvas
  // 仅在跨越降级阈值时 setState（避免缩放过程中每帧重渲染所有节点）。
  const applyLodForZoom = useCallback((zoom: number) => {
    const next = shouldUseCanvasOverviewLod({
      heavyCanvas: heavyCanvasRef.current,
      zoom,
      currentlyOverview: lodDegradedRef.current,
    })
    if (next !== lodDegradedRef.current) {
      lodDegradedRef.current = next
      // 跨 LOD 阈值时所有已挂节点(数百个 context 消费者)会一次性重渲染。放进 transition 让
      // 这次大提交可中断、不阻塞缩放手势帧(实测该重渲染是缩放时 ~166ms 长任务)。
      // 后台标签页没有手势帧需要保护，低优先级 transition 反而可能长期饥饿，令全量重节点
      // 一直驻留；后台直接提交，前台才使用可中断 transition。
      if (document.visibilityState === 'hidden') setLodDegraded(next)
      else React.startTransition(() => setLodDegraded(next))
    }
  }, [])
  const applyExtremeZoomEdgeVisibility = useCallback((zoom: number) => {
    const currentlyHidden = edgesHiddenForExtremeZoomRef.current
    const shouldHide = shouldHideEdgesAtZoom(zoom, currentlyHidden)
    if (shouldHide === currentlyHidden) return
    const edgeLayer = rootRef.current?.querySelector<SVGGElement>('.react-flow__edges')
    if (!edgeLayer) return
    edgesHiddenForExtremeZoomRef.current = shouldHide
    edgeLayer.style.visibility = shouldHide ? 'hidden' : 'visible'
    edgeLayer.style.pointerEvents = shouldHide ? 'none' : ''
  }, [])
  // 缩放过程中实时评估（onMove 每帧触发，但 applyLodForZoom 只在跨阈值时 setState）。
  const onCanvasMove = useCallback((_evt: MouseEvent | TouchEvent | null, vp: Viewport) => {
    applyLodForZoom(vp.zoom)
    applyExtremeZoomEdgeVisibility(vp.zoom)
  }, [applyExtremeZoomEdgeVisibility, applyLodForZoom])
  // 节点/连线数量变化跨越「重」阈值时，用当前缩放重新评估。
  useEffect(() => {
    applyLodForZoom(rf.getViewport?.().zoom ?? 1)
  }, [heavyCanvas, applyLodForZoom, rf])

  // dev 性能面板的数据源：面板按 500ms 轮询，全部读 ref/store 快照，不新增订阅
  const getPerfStats = useCallback(() => {
    const s = useRFStore.getState()
    return {
      zoom: rf.getViewport?.().zoom ?? 1,
      lodDegraded: lodDegradedRef.current,
      heavyCanvas: heavyCanvasRef.current,
      nodeCount: s.nodes.length,
      edgeCount: s.edges.length,
      virtualized: heavyCanvasRef.current,
    }
  }, [rf])

  const onCanvasMoveStart = useCallback(() => {
    if (vpMovingEndTimerRef.current) {
      clearTimeout(vpMovingEndTimerRef.current)
      vpMovingEndTimerRef.current = null
    }
    viewportMovingRef.current = true
    rootRef.current?.setAttribute('data-viewport-moving', 'true')
    setCanvasViewportMoving(true)
    resourceManager.setViewportMoving(true)
    setSpotlightVisible(false)
  }, [setSpotlightVisible])

  const onCanvasMoveEnd = useCallback((_evt: MouseEvent | TouchEvent | null, vp: Viewport) => {
    setCanvasViewport(vp)
    resourceManager.setViewportZoom(vp.zoom)
    setSpotlightVisible(true)
    vpMovingEndTimerRef.current = setTimeout(() => {
      viewportMovingRef.current = false
      rootRef.current?.setAttribute('data-viewport-moving', 'false')
      resourceManager.setViewportMoving(false)
      // Correctness-critical resource visibility must settle independently of
      // the next paint. Chromium can throttle or postpone requestAnimationFrame
      // while the tab is occluded or its compositor is under pressure; keeping
      // this notification inside rAF strands newly virtualized images on their
      // transparent placeholder and presents as local black blocks.
      setCanvasViewportMoving(false)
      requestAnimationFrame(() => {
        const lastPointer = lastPointerScreenRef.current
        if (lastPointer) queueSpotlightPosition(lastPointer.x, lastPointer.y)
      })
    }, 200)
  }, [setCanvasViewport, queueSpotlightPosition, setSpotlightVisible])

  useEffect(() => () => {
    if (spotlightFrameRef.current !== null) {
      window.cancelAnimationFrame(spotlightFrameRef.current)
    }
    if (vpMovingEndTimerRef.current !== null) {
      clearTimeout(vpMovingEndTimerRef.current)
    }
  }, [])

  // cleanup: unmount 时确保 DOM 属性/状态归零（事件回调已处理主路径）
  useEffect(() => {
    return () => {
      viewportMovingRef.current = false
      rootRef.current?.removeAttribute('data-viewport-moving')
      spotlightCircleRef.current = null
      setCanvasViewportMoving(false)
      setCanvasNodeDragging(false)
      resourceManager.setViewportMoving(false)
    }
  }, [])

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
        useUploadRuntimeStore.getState().beginNodeImageUpload(id)
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
      } finally {
        useUploadRuntimeStore.getState().finishNodeImageUpload(id)
      }
    }

    if (hostingFailedCount > 0) {
      if (successCount > 0) {
        toast(`有 ${hostingFailedCount} 张图片未能托管到 TOS，已使用本地预览`, 'info')
      } else {
        toast('图片已添加到画布，但未能托管到 TOS，将使用本地预览（远程任务需要可访问链接）', 'error')
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

  const importVideosFromFiles = useCallback(async (files: File[], basePosFlow?: { x: number; y: number }) => {
    if (viewOnly) return
    const videos = (files || []).filter(isVideoFile)
    if (!videos.length) return

    const MAX_BYTES = 500 * 1024 * 1024
    const tooLarge = videos.filter((f) => f.size > MAX_BYTES)
    if (tooLarge.length) {
      toast(`有 ${tooLarge.length} 个视频超过 500MB，已跳过`, 'error')
    }
    const valid = videos.filter((f) => f.size <= MAX_BYTES)
    if (!valid.length) return

    const base = basePosFlow ?? rf.screenToFlowPosition(lastPointerScreenRef.current ?? getFallbackScreenPoint())
    const cols = 3
    const spacingX = CANVAS_CONFIG.NODE_SPACING_X + 60
    const spacingY = CANVAS_CONFIG.NODE_SPACING_Y + 40

    const prepared = valid.map((file, idx) => {
      const id = genTaskNodeId()
      const label = file.name.replace(/\.[a-z0-9]+$/i, '').trim() || 'Video'
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
          kind: 'video',
          videoUrl: localUrl,
          nodeWidth: 240,
          nodeHeight: 280,
        },
        selected: false,
      }))
      return { nodes: [...s.nodes, ...newNodes], nextId: s.nextId + newNodes.length }
    })

    const { updateNodeData } = useRFStore.getState()
    for (const { id, file, label, localUrl } of prepared) {
      try {
        const hosted = await uploadServerAssetFile(file, label, { ownerNodeId: id })
        const url = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
        if (url) {
          updateNodeData(id, {
            videoUrl: url,
            videoResults: [{ url, title: label }],
            videoPrimaryIndex: 0,
            serverAssetId: hosted.id,
          })
          URL.revokeObjectURL(localUrl)
        } else {
          toast('视频已添加到画布，但未能获取托管链接，将使用本地预览', 'error')
        }
      } catch (error) {
        console.error('Failed to upload video:', error)
        toast('视频上传失败，请稍后再试', 'error')
      }
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
      if (!(await saveCurrentCanvasSnapshot())) {
        toast('帧已导入，但画布保存失败', 'error')
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
    const size = typeof blob.size === 'number' ? blob.size : 0
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
      if (!(await saveCurrentCanvasSnapshot())) {
        toast('帧已导入，但画布保存失败', 'error')
      }
    } catch (error) {
      console.error('Failed to process dragged frame:', error)
      toast('处理帧图片失败，请稍后再试', 'error')
    }
  }, [deriveLabelFromFileName, viewOnly])

  // 页面刷新恢复：图像节点（imageTaskId）由下方的定时 tick 通过 syncImageNodeOnce 接管，无需单独注册

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

        // Workflow-created media is owned by the durable execution reconciler.
        // The generic browser poller is only for manually submitted media nodes.
        if (isWorkflowOwnedMediaNodeData(data)) continue

        const nodeId = String(n.id || '')
        if (!nodeId) continue

        if (kind === 'video') {
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

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const width = entry.contentRect.width
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => { syncViewportWithWidth(width) }, 100)
    })

    observer.observe(root)
    return () => {
      observer.disconnect()
      if (resizeTimer) clearTimeout(resizeTimer)
    }
  }, [rf, setCanvasViewport])

  useEffect(() => {
    ;(window as any).__tcFocusNode = (nodeId: string) => {
      try {
        if (!nodeId) return
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
    ;(window as any).__tcFitView = (nodeIds?: string[]) => {
      try {
        const ids = Array.isArray(nodeIds) ? nodeIds.map((id) => String(id || '').trim()).filter(Boolean) : []
        rf.fitView?.({
          ...(ids.length ? { nodes: ids.map((id) => ({ id })) } : {}),
          padding: 0.3,
          maxZoom: 1,
          duration: 250,
        })
      } catch {
        // ignore
      }
    }
    return () => {
      try {
        if ((window as any).__tcFocusNode) delete (window as any).__tcFocusNode
        if ((window as any).__tcFitView) delete (window as any).__tcFitView
      } catch {
        // ignore
      }
    }
  }, [rf])

  const applyDefaultZoom = useCallback(() => {
    const afterFit = rf.getViewport?.().zoom ?? 1
    const targetZoom = Math.max(Math.min(afterFit * DEFAULT_ZOOM_MULTIPLIER, MAX_ZOOM), CANVAS_MIN_ZOOM)
    rf.zoomTo?.(targetZoom, { duration: 0 })
    requestAnimationFrame(() => {
      const vp = rf.getViewport?.()
      if (vp) setCanvasViewport(vp)
      // 程序化缩放(首屏 fitView/默认退档)必须同步重评 LOD——否则深链/恢复到 <0.35 的
      // 缩略视口时 lodDegraded 停在 false，整章视频节点全挂 <video> 解码器压垮主线程。
      // onMove 只在用户手动平移/缩放时触发，覆盖不到这条程序化路径。
      applyLodForZoom(vp?.zoom ?? targetZoom)
      applyExtremeZoomEdgeVisibility(vp?.zoom ?? targetZoom)
    })
  }, [rf, setCanvasViewport, applyExtremeZoomEdgeVisibility, applyLodForZoom])

  // 初载遮罩（对齐 Neowow workflow-loading）：盖住首屏挂载/fitView/首批解码的抖动，
  // 就绪或 2.5s 兜底后 0.4s 淡出。只跑一次（章节切换走 __tcReframeForChapter 不重放）。
  const [canvasRevealed, setCanvasRevealed] = useState(false)
  const revealTimerRef = useRef<number | null>(null)
  const revealCanvas = useCallback(() => {
    if (revealTimerRef.current !== null) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null }
    setCanvasRevealed(true)
  }, [])
  useEffect(() => {
    // 2.5s 硬兜底：无论媒体是否就绪都揭幕，遮罩绝不能变成新的等待。
    revealTimerRef.current = window.setTimeout(() => setCanvasRevealed(true), 2500)
    return () => { if (revealTimerRef.current !== null) clearTimeout(revealTimerRef.current) }
  }, [])

  const onInit = useCallback(() => {
    if (!nodes.length) {
      requestAnimationFrame(() => {
        applyDefaultZoom()
        // 空画布：视口就位即揭幕。
        requestAnimationFrame(() => revealCanvas())
      })
      return
    }
    rf.fitView?.({ padding: 0.2 })
    requestAnimationFrame(() => {
      applyDefaultZoom()
      initialFitAppliedRef.current = true
      // fitView + 退档后再等两帧：让首批可见节点完成 commit + 首绘，遮罩后揭幕无抖动。
      requestAnimationFrame(() => requestAnimationFrame(() => revealCanvas()))
    })
  }, [applyDefaultZoom, nodes.length, rf, revealCanvas])

  // 章节切换重框：章节画布切章时 Canvas 不再重挂（消除闪烁的代价），而 onInit 的首屏
  // fitView + 退档 + LOD 降级只在首次挂载跑一次。切到「节点坐标不同」的章节后，视口会停在
  // 上一章位置（空白），且不降级 LOD → 数百节点全量渲染冻结主线程。这里暴露一个与 onInit
  // 完全同序的重框钩子（fitView → applyDefaultZoom，后者内部 applyLodForZoom 会按退档后的
  // 低缩放把节点降级成总览轻卡 → 便宜），供 ChapterCanvasPage 载入新章后调用。
  useEffect(() => {
    ;(window as any).__tcReframeForChapter = () => {
      try {
        const count = useRFStore.getState().nodes.length
        if (!count) { applyDefaultZoom(); return }
        rf.fitView?.({ padding: 0.2 })
        requestAnimationFrame(() => { applyDefaultZoom() })
      } catch { /* ignore */ }
    }
    return () => {
      try { if ((window as any).__tcReframeForChapter) delete (window as any).__tcReframeForChapter } catch { /* ignore */ }
    }
  }, [rf, applyDefaultZoom])

  useEffect(() => {
    if (!restoreViewport) return
    rf.setViewport?.(restoreViewport, { duration: 0 })
    setCanvasViewport(restoreViewport)
    // 恢复持久化视口同样是程序化缩放：立刻按恢复后的 zoom 重评 LOD，避免恢复到低缩放时
    // 视频节点全量挂载解码器（见 applyDefaultZoom 处同因）。
    applyLodForZoom(restoreViewport.zoom)
    setRestoreViewport(null)
    restoreAppliedRef.current = true
    initialFitAppliedRef.current = true
  }, [restoreViewport, rf, setCanvasViewport, setRestoreViewport, applyLodForZoom])

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
    const hasTapImage = types.includes('application/tap-image-url')
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
    const pos = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY })
    const droppedFiles = Array.from(evt.dataTransfer.files || [])
    const videoFiles = droppedFiles.filter(isVideoFile)
    const imageFiles = droppedFiles.filter(isImageFile)
    if (videoFiles.length) void importVideosFromFiles(videoFiles, pos)
    if (imageFiles.length) void importImagesFromFiles(imageFiles, pos)
    if (videoFiles.length || imageFiles.length) return
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
  }, [importImageNodeFromDraggedFrame, importImagesFromFiles, importVideosFromFiles, isImageFile, isVideoFile, rf])

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

  const isCompatibleTargetHandle = useCallback((meta: { targetNodeId: string; targetHandleId: string }) => {
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

  const handleConnect = useCallback((c: Connection) => {
    lastReason.current = null
    didConnectRef.current = true
    const nextConnection = { ...c, type: edgeRoute === 'orth' ? 'orth' : 'typed' }
    onConnect(nextConnection)
  }, [edgeRoute, onConnect])

  const onConnectStart = useCallback<OnConnectStart>((_evt, params) => {
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
  const MAX_ZOOM = 1.8 // 放大上限保持克制，避免轻易进入“单节点占满屏幕”的状态
  const DEFAULT_ZOOM_MULTIPLIER = 0.32 // 首屏默认在 fitView 基础上再退一档，优先保证整体结构先可见

  const onConnectEnd = useCallback<OnConnectEnd>((evt) => {
    const from = connectFromRef.current
    const eventPoint = 'changedTouches' in evt
      ? evt.changedTouches.length > 0
        ? { x: evt.changedTouches[0]!.clientX, y: evt.changedTouches[0]!.clientY }
        : null
      : { x: evt.clientX, y: evt.clientY }
    const release =
      eventPoint ??
      lastPointerScreenRef.current ??
      { x: mouse.x, y: mouse.y }

    // Auto-snap to nearest compatible target handle / node
    const autoSnap = () => {
      if (!from) return false

      const tryConnectWithHandle = (handleEl: HTMLElement | null) => {
        if (!handleEl) return false
        // Wide handles are kept only for legacy edge anchoring; never use them for new connections.
        if (handleEl.classList.contains('tc-handle--wide')) return false
        const meta = getHandleMeta(handleEl)
        if (!meta) return false
        const sourceNodeId = from.nodeId
        const sourceHandleId = from.handleId || 'out-any'
        if (!isCompatibleTargetHandle(meta)) return false

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

      const nodeEls = Array.from(document.querySelectorAll('.react-flow__node')) as HTMLElement[]
      const nodesAtRelease = () => {
        const candidates: HTMLElement[] = []
        const seenNodeIds = new Set<string>()
        const addCandidate = (nodeEl: HTMLElement | null) => {
          const nodeId = nodeEl?.getAttribute('data-id')
          if (!nodeEl || !nodeId || nodeId === from.nodeId || seenNodeIds.has(nodeId)) return
          seenNodeIds.add(nodeId)
          candidates.push(nodeEl)
        }

        if (typeof document.elementsFromPoint === 'function') {
          for (const element of document.elementsFromPoint(release.x, release.y)) {
            addCandidate(element.closest('.react-flow__node') as HTMLElement | null)
          }
        } else {
          addCandidate(document.elementFromPoint(release.x, release.y)?.closest('.react-flow__node') as HTMLElement | null)
        }

        // The pointer can land on a child overlay whose hit testing hides the node wrapper.
        // Geometry is the authoritative fallback for a release inside the node body.
        for (const nodeEl of nodeEls) {
          if (isPointInsideRect(release, nodeEl.getBoundingClientRect())) addCandidate(nodeEl)
        }
        return candidates
      }

      // A release inside a node body has an unambiguous target. Resolve it before global
      // handle snapping so a nearby endpoint cannot steal a connection intended for this node.
      for (const nodeEl of nodesAtRelease()) {
        if (tryConnectViaNode(nodeEl)) return true
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
        if (tryConnectWithHandle(el)) return true
      }

      // If still not found, try snapping to the nearest node body
      {
        let bestNode: { el: HTMLElement; dist: number } | null = null
        for (const el of nodeEls) {
          const nodeId = el.getAttribute('data-id')
          if (!nodeId || nodeId === from.nodeId) continue
          const rect = el.getBoundingClientRect()
          const dist = getPointToRectDistance(release, rect)
          if (dist > NODE_SNAP_DISTANCE && !isPointInsideRect(release, rect)) continue
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
    // Clear visual focus in the same event as the pane click. Waiting for the
    // React Flow selection commit leaves the previous node hydrated for one
    // extra render and makes deselection feel sticky.
    useFocusStore.getState().setFocusedNodeId(null)
    setFocusRequestedNodeId(null)
    useWorkflowNodeInspectorStore.getState().close()
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

  const flushPendingDragCommit = useCallback(() => {
    if (dragCommitIdleRef.current !== null) {
      window.cancelIdleCallback(dragCommitIdleRef.current)
      dragCommitIdleRef.current = null
    }
    const pending = pendingDragCommitRef.current
    pendingDragCommitRef.current = null
    if (pending?.length) onNodesChange(pending)
  }, [onNodesChange])

  const onNodeDragStart = useCallback((_evt: any, node: any) => {
    // A rapid second drag must first persist the previous drag's final visual
    // position; otherwise the controlled business graph could overwrite it.
    flushPendingDragCommit()
    nodeDragActiveRef.current = true
    activeDragElementCacheRef.current.clear()
    if (selectionCommitTimerRef.current) {
      clearTimeout(selectionCommitTimerRef.current)
      selectionCommitTimerRef.current = null
    }
    const nodeId = typeof node?.id === 'string' ? node.id : ''
    if (nodeId) beginCanvasNodeDrag(nodeId)
    rootRef.current?.setAttribute('data-dragging', 'true')
    setCanvasNodeDragging(true)
    const selectedCount = useRFStore.getState().nodes.reduce(
      (count, candidate) => count + (candidate.selected ? 1 : 0),
      0,
    )
    if (selectedCount >= HEAVY_SELECTION_DRAG_THRESHOLD) {
      React.startTransition(() => setDragging(true))
    }
    resourceManager.setNodeDragging(true)
  }, [flushPendingDragCommit])

  const cancelTidyLayout = useCallback(() => {
    tidyLayoutRunRef.current += 1
    if (tidyCommitIdleRef.current !== null) {
      window.cancelIdleCallback(tidyCommitIdleRef.current)
      tidyCommitIdleRef.current = null
    }
  }, [])

  const executeTidyLayout = useCallback((options?: Readonly<{ arrangeWorkflowGroups?: boolean }>) => {
    cancelTidyLayout()
    const runId = tidyLayoutRunRef.current
    if (options?.arrangeWorkflowGroups) {
      const workflowGroupIds = useRFStore.getState().nodes
        .filter((node) => isWorkflowGroup(node))
        .map((node) => node.id)
      for (const groupId of workflowGroupIds) {
        useRFStore.getState().arrangeGroupChildren(groupId, 'flow')
      }
    }
    const state = useRFStore.getState()
    const { positions } = computeTidyByCategoryLayout(state.nodes, state.edges)
    if (!positions.size) return

    const nodeIds = Array.from(positions.keys())
    const finalNodes = state.nodes.map((node) => {
      const position = positions.get(node.id)
      if (!position) return node
      const finalNode = applyTidyPosition(node, position) as FlowNode
      return finalNode
    })
    const applyLayout = () => {
      if (runId !== tidyLayoutRunRef.current) return
      const internalState = reactFlowStore.getState()
      const positionChanges: NodeChange<FlowNode>[] = nodeIds.map((id) => ({
        id,
        type: 'position',
        position: positions.get(id),
        dragging: false,
      }))
      // Keep React Flow's internal node object as the source and change only its
      // position. Replacing it with a business-store node drops measured/internal
      // render state, briefly remounting image/video surfaces as a black shell.
      internalState.setNodes(applyNodeChanges(positionChanges, internalState.nodes))
      tidyCommitIdleRef.current = window.requestIdleCallback(() => {
        tidyCommitIdleRef.current = null
        if (runId !== tidyLayoutRunRef.current) return
        useRFStore.getState().commitTidyNodes(finalNodes, nodeIds)
      }, { timeout: 250 })
    }

    // Apply the visual layout atomically. Incremental per-node presentation
    // leaves the canvas in mixed old/new layouts for dozens of frames, causing
    // transient node overlap and visibly corrupted text stacking.
    window.requestAnimationFrame(applyLayout)
  }, [cancelTidyLayout, reactFlowStore])

  useLayoutEffect(
    () => registerCanvasTidyExecutor({ run: executeTidyLayout, cancel: cancelTidyLayout }),
    [cancelTidyLayout, executeTidyLayout],
  )

  const onNodeDrag = useCallback((_evt: any, _node: any) => {
    // ioNode relative position is persisted on dragStop, not per-frame,
    // to avoid 60fps store mutations that re-render all subscribed components.
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
    // Persist ioNode relative position once on drop (moved from per-frame onNodeDrag)
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
    // React Flow normally emits dragging:false before this callback. Clear the
    // store lifecycle fact explicitly as well so a cancelled/missing terminal
    // position change can never leave position-independent selectors frozen.
    clearCanvasNodeDragActivity()
    nodeDragActiveRef.current = false
    activeDragElementCacheRef.current.clear()
    rootRef.current?.setAttribute('data-dragging', 'false')
    setCanvasNodeDragging(false)
    React.startTransition(() => setDragging(false))
    resourceManager.setNodeDragging(false)
  }, [absorbImageNodeIntoStoryboardCell])

  // Note: group size is user-controlled by default; arrange actions may trigger explicit auto-fit.

  const handleNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    const normalizedChanges = normalizeCanvasNodeChanges(changes, nodeDragActiveRef.current)
    if (normalizedChanges.length === 0) return

    const isPureSelectionChange = normalizedChanges.every((change) => change.type === 'select')
    if (isPureSelectionChange && !nodeDragActiveRef.current) {
      const internalState = reactFlowStore.getState()
      internalState.setNodes(applyNodeChanges(normalizedChanges, internalState.nodes))
      // 必须累积而非覆盖：框选是逐帧增量下发的（每帧只含本帧翻转的节点），直接赋值会让
      // 防抖窗口内的前几帧丢失，业务 store 只拿到最后一帧 → 视觉框中一片、store 里只有一两个。
      pendingSelectionChangesRef.current = accumulateSelectionChanges(
        pendingSelectionChangesRef.current,
        normalizedChanges,
      )
      if (selectionCommitTimerRef.current) clearTimeout(selectionCommitTimerRef.current)
      selectionCommitTimerRef.current = setTimeout(() => {
        selectionCommitTimerRef.current = null
        if (nodeDragActiveRef.current) return
        const pending = pendingSelectionChangesRef.current
        pendingSelectionChangesRef.current = []
        if (pending.length) onNodesChange(pending)
      }, 120)
      return
    }

    const isPureActiveDragFrame =
      nodeDragActiveRef.current &&
      normalizedChanges.every((change) =>
        change.type === 'position' &&
        Boolean(change.position) &&
        change.dragging === true,
      )
    if (isPureActiveDragFrame) {
      // Update only the dragged node(s). Applying changes to the controlled
      // 1000-node array here turns every pointer frame into O(N) work.
      const internalState = reactFlowStore.getState()
      applyActiveNodeDragFrame({
        changes: normalizedChanges,
        nodeLookup: internalState.nodeLookup,
        canvasRoot: rootRef.current,
        elementCache: activeDragElementCacheRef.current,
      })
      return
    }

    const pendingSelectionChanges = pendingSelectionChangesRef.current
    pendingSelectionChangesRef.current = []
    if (selectionCommitTimerRef.current) {
      clearTimeout(selectionCommitTimerRef.current)
      selectionCommitTimerRef.current = null
    }
    const committedChanges = pendingSelectionChanges.length
      ? [...pendingSelectionChanges, ...normalizedChanges]
      : normalizedChanges
    const isDragStopCommit = committedChanges.some((change) =>
      change.type === 'position' && change.dragging === false,
    )
    if (isDragStopCommit) {
      const internalState = reactFlowStore.getState()
      internalState.setNodes(applyNodeChanges(committedChanges, internalState.nodes))
      if (dragCommitIdleRef.current !== null) {
        window.cancelIdleCallback(dragCommitIdleRef.current)
      }
      pendingDragCommitRef.current = committedChanges
      dragCommitIdleRef.current = window.requestIdleCallback(() => {
        dragCommitIdleRef.current = null
        const pending = pendingDragCommitRef.current
        pendingDragCommitRef.current = null
        if (pending?.length) onNodesChange(pending)
      }, { timeout: 250 })
      return
    }
    onNodesChange(committedChanges)
  }, [onNodesChange, reactFlowStore])

  useLayoutEffect(() => {
    if (!onPerformanceApiReady) return
    const getNode = (nodeId: string): FlowNode | null => (
      reactFlowStore.getState().nodes.find((node) => node.id === nodeId) ?? null
    )
    const api: CanvasPerformanceApi = {
      getViewport: () => {
        const [x, y, zoom] = reactFlowStore.getState().transform
        return { x, y, zoom }
      },
      getViewportSize: () => {
        const root = rootRef.current
        if (!root) throw new Error('Canvas performance API is unavailable before the canvas root mounts')
        const rect = root.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      },
      beginViewportMove: onCanvasMoveStart,
      setViewport: (viewport) => {
        reactFlowStore.setState({ transform: [viewport.x, viewport.y, viewport.zoom] })
        onCanvasMove(null, viewport)
      },
      endViewportMove: (viewport) => onCanvasMoveEnd(null, viewport),
      getNodePosition: (nodeId) => {
        const node = getNode(nodeId)
        return node ? { ...node.position } : null
      },
      beginNodeDrag: (nodeId) => {
        const node = getNode(nodeId)
        if (!node) return false
        onNodeDragStart(null, node)
        return true
      },
      setNodeDragPosition: (nodeId, position) => {
        handleNodesChange([{ id: nodeId, type: 'position', position, dragging: true }])
      },
      endNodeDrag: (nodeId, position) => {
        handleNodesChange([{ id: nodeId, type: 'position', position, dragging: false }])
        const node = getNode(nodeId)
        if (!node) throw new Error(`Cannot finish performance drag for missing node: ${nodeId}`)
        onNodeDragStop(new MouseEvent('mouseup'), { ...node, position })
      },
    }
    onPerformanceApiReady(api)
    return () => onPerformanceApiReady(null)
  }, [
    handleNodesChange,
    onCanvasMove,
    onCanvasMoveEnd,
    onCanvasMoveStart,
    onNodeDragStart,
    onNodeDragStop,
    onPerformanceApiReady,
    reactFlowStore,
  ])

  useEffect(() => () => {
    if (selectionCommitTimerRef.current) clearTimeout(selectionCommitTimerRef.current)
    flushPendingDragCommit()
  }, [flushPendingDragCommit])

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
      if (!isCompatibleTargetHandle(meta)) continue

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
            fill={String((props.connectionLineStyle as any)?.stroke || '#c8ccd4')}
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

  const pickDefaultTargetHandle = useCallback((targetKind?: string | null) => {
    const tk = targetKind ? getTaskNodeCoreType(targetKind) : ''
    if (tk === 'video') return 'in-any'
    if (tk === 'image') return 'in-image'
    if (tk === 'text') return 'in-text'
    return 'in-any'
  }, [])

  const resolveCompatibleTargetHandleId = useCallback((targetKind?: string | null) => {
    const schema = getTaskNodeSchema(targetKind)
    const targetHandles = getStaticTargetHandles(schema)
    if (!targetHandles.length) return null

    const preferredHandleId = pickDefaultTargetHandle(schema.kind)
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
      targetHandle: pickDefaultTargetHandle(tKind),
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
      // React Flow suppresses onNodeClick after an actual drag. Consequently
      // this is a confirmed click, not merely the pointer-down selection that
      // precedes every drag gesture. Only confirmed clicks mount the heavy
      // interactive TaskNode body.
      const clickedNodeId = String(node.id)
      const hasSelectionModifier = evt.shiftKey || evt.metaKey || evt.ctrlKey
      const soleSelectedNodeId = selectRfSoleSelectedNodeId(reactFlowStore.getState())
      const canFocusImmediately =
        !hasSelectionModifier && node.type !== 'groupNode' && soleSelectedNodeId === clickedNodeId
      // React Flow's internal selection is already updated by the time this
      // confirmed click callback runs. Publish it directly to the focus store so
      // the shell can hydrate on this click, without waiting for the debounced
      // app-store commit or a state/effect round trip.
      useFocusStore.getState().setFocusedNodeId(canFocusImmediately ? clickedNodeId : null)
      setFocusRequestedNodeId(clickedNodeId)
      const clickedData = node.data && typeof node.data === 'object'
        ? node.data as Record<string, unknown>
        : {}
      if (
        clickedData.adminWorkflow === true
        && (clickedData.kind === 'workflowStage' || clickedData.kind === 'workflowTrigger')
      ) {
        useWorkflowNodeInspectorStore.getState().openNode(clickedNodeId)
      } else {
        useWorkflowNodeInspectorStore.getState().close()
      }
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
  }, [closeCanvasReferencePicker, quickConnectNodes, reactFlowStore, referencePickerBlockedSourceIds, referencePickerTargetId, tapConnectSource])

  const selectedNonGroupNodes = useMemo(
    () => selectedNodeSummaries.filter((node) => node.type !== 'groupNode'),
    [selectedNodeSummaries],
  )
  const videoCompareSelectionResolution = useMemo(() => {
    if (selectedNodeIds.length !== 2) return resolveVideoCompareSelection([])
    const selectedIds = new Set(selectedNodeIds)
    return resolveVideoCompareSelection(nodes.filter((node) => selectedIds.has(node.id)))
  }, [nodes, selectedNodeIds])
  const selectedGroupIds = useMemo(
    () => selectedNodeSummaries.filter((node) => node.type === 'groupNode').map((node) => node.id),
    [selectedNodeSummaries],
  )
  const selectedNodeCount = selectedNodeIds.length
  const selectedEdgeCount = useMemo(
    () => edges.reduce((count, edge) => count + (edge.selected ? 1 : 0), 0),
    [edges],
  )
  // Single-focus model: the sole selected (non-group) node is "focused" and mounts the full heavy
  // body; everything else stays a lightweight thumbnail shell. Multi-select / group-select / empty
  // selection → no focus, all shells. Published to the focus store so each node reads it in O(1).
  //
  // Selection is read from React Flow's INTERNAL store, not the app store. handleNodesChange applies
  // pure-select changes to the internal store synchronously but debounces the app-store commit by
  // 120ms (that debounce exists to keep the O(N) whole-graph rebuild off the click path). Deriving
  // focus from the app store therefore added a hard 120ms floor to "click → body mounts" for no
  // benefit; the internal store already has the authoritative selection by the time onNodeClick runs.
  const rfSoleSelectedNodeId = useStore(selectRfSoleSelectedNodeId)
  const focusedNodeId =
    rfSoleSelectedNodeId !== null && focusRequestedNodeId === rfSoleSelectedNodeId
      ? rfSoleSelectedNodeId
      : null
  useLayoutEffect(() => {
    const fs = useFocusStore.getState()
    // View-only: nothing is selectable, so render every (visible) node full — readers need real
    // content, not thumbnails. Edit mode: only a confirmed click focuses a
    // sole-selected node; pointer-down selection during drag stays a shell.
    fs.setAllFull(viewOnly)
    fs.setFocusedNodeId(viewOnly ? null : focusedNodeId)
  }, [focusedNodeId, viewOnly])
  const heavySelectionActive = selectedNodeCount > 1 || selectedGroupIds.length > 0
  const heavySelectionDragging = dragging && selectedNodeCount >= HEAVY_SELECTION_DRAG_THRESHOLD
  const shouldHighlightSelectedEdges = selectedNodeCount === 1 && selectedGroupIds.length === 0
  const canvasRenderContextValue = useMemo(
    () => ({
      heavySelectionActive,
      heavySelectionDragging,
      selectedNodeCount,
      isBoxSelecting,
      viewOnly,
      edgeRoute,
      currentProject,
    }),
    [heavySelectionActive, heavySelectionDragging, isBoxSelecting, selectedNodeCount, viewOnly, edgeRoute, currentProject],
  )
  const edgeInteractionContextValue = useMemo(
    () => ({ selectedNodeCount, selectedEdgeCount, isBoxSelecting }),
    [isBoxSelecting, selectedEdgeCount, selectedNodeCount],
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
  const selectedGroupRunsWorkflow = useMemo(
    () => selectedGroupIds.length === 1
      && isWorkflowGroup(nodes.find((node) => node.id === selectedGroupIds[0])),
    [nodes, selectedGroupIds],
  )
  const selectedWorkflowCapabilityValidation = useMemo(
    () => selectedGroupIds.length === 1
      ? validateWorkflowCapabilitySelection(selectedGroupIds[0], nodes)
      : null,
    [nodes, selectedGroupIds],
  )
  const selectedGroupCanOpenCapabilityBay = selectedWorkflowCapabilityValidation?.eligible === true
  const openSelectedWorkflowInCapabilityBay = useCallback((groupId: string): void => {
    if (openingCapabilityBayGroupId) return
    const validation = validateWorkflowCapabilitySelection(groupId, nodes)
    if (!validation.eligible) {
      toast(validation.reason, 'error')
      return
    }
    const triggerNode = nodes.find((node) => node.id === validation.triggerNodeId)
    const triggerData = triggerNode?.data && typeof triggerNode.data === 'object'
      ? triggerNode.data as Record<string, unknown>
      : {}
    const existingDescription = typeof triggerData.workflowCapabilityDescription === 'string'
      ? triggerData.workflowCapabilityDescription.trim()
      : ''
    const currentFlowName = String(useUIStore.getState().currentFlow.name || '').trim()
    const groupData = nodes.find((node) => node.id === groupId)?.data
    const groupLabel = groupData && typeof groupData === 'object'
      ? String((groupData as Record<string, unknown>).label || '').trim()
      : ''
    setWorkflowCapabilityDescriptionInput(existingDescription)
    setWorkflowCapabilityDescriptionDialog({
      groupId,
      triggerNodeId: validation.triggerNodeId,
      workflowName: currentFlowName || groupLabel || '未命名工作流',
    })
  }, [nodes, openingCapabilityBayGroupId])
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
      (canPublishSelectedGroupTemplate && selectedGroupCanOpenCapabilityBay) ||
      Boolean(downloadAssetsGroupId)
    ),
    [
      canLayoutSelection,
      canPublishSelectedGroupTemplate,
      canStitchSelectedGroup,
      downloadAssetsGroupId,
      selectedGroupCanOpenCapabilityBay,
    ],
  )
  const isRunningSelectedGroup = useMemo(
    () => selectedGroupIds.length === 1 && runningGroupId === selectedGroupIds[0],
    [runningGroupId, selectedGroupIds],
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
    setRunningGroupId(groupId)
    try {
      const workflowTriggerNodeId = resolveWorkflowGroupTrigger(groupId, stateNodes)
      if (workflowTriggerNodeId) {
        const triggerNode = stateNodes.find((node) => node.id === workflowTriggerNodeId)
        const triggerData = triggerNode?.data && typeof triggerNode.data === 'object'
          ? triggerNode.data as Record<string, unknown>
          : {}
        if (triggerData.workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY) {
          runVideoWorkflow(workflowTriggerNodeId)
        } else if (triggerData.workflowKey === AGENT_WORKFLOW_KEY) {
          runAgentWorkflow(workflowTriggerNodeId)
        } else {
          throw new Error('工作流触发器缺少已注册的执行身份')
        }
        return
      }
      const nodeIds = collectGroupTaskNodeIds(groupId)
      if (!nodeIds.length) {
        toast('组内没有可执行任务节点', 'info')
        return
      }
      await runFlowDag(1, useRFStore.getState, useRFStore.setState, { only: new Set(nodeIds) })
      toast(`已触发组内 ${nodeIds.length} 个节点执行`, 'success')
    } catch (err) {
      console.error(err)
      toast('组内一键执行失败', 'error')
    } finally {
      setRunningGroupId(null)
    }
  }, [collectGroupTaskNodeIds, runningGroupId])

  const collectGroupSubgraph = useCallback((groupId: string): { nodes: FlowNode[]; edges: FlowEdge[]; groupLabel: string } | null => {
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

    const rootData = rootGroup.data && typeof rootGroup.data === 'object'
      ? rootGroup.data as Record<string, unknown>
      : {}
    const groupLabel = String(rootData.label || groupId).trim() || groupId
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

  const generateWorkflowDescription = useCallback(async (): Promise<void> => {
    const dialog = workflowCapabilityDescriptionDialog
    if (!dialog || workflowCapabilityDescriptionGenerating) return
    const subgraph = collectGroupSubgraph(dialog.groupId)
    if (!subgraph || subgraph.nodes.length <= 1) {
      toast('组内没有可生成说明的工作流节点', 'warning')
      return
    }
    setWorkflowCapabilityDescriptionGenerating(true)
    try {
      if (workflowDescriptionModelCatalog.loading) {
        throw new Error('小T 语言模型目录仍在加载，请稍后重试。')
      }
      if (workflowDescriptionModelCatalog.error) {
        throw new Error(`小T 语言模型目录加载失败：${workflowDescriptionModelCatalog.error.message}`)
      }
      const selectedModel = requireSelectedChatModelRequest(
        workflowDescriptionModelCatalog.options,
        readStoredChatModelValue(),
      )
      const context = buildWorkflowDescriptionContext({
        name: dialog.workflowName,
        nodes: subgraph.nodes,
        edges: subgraph.edges,
      })
      const response = await requestWorkflowCapabilityDescription({
        model: selectedModel.model,
        workflow: context,
      })
      setWorkflowCapabilityDescriptionInput(response.description)
      toast('工作流能力说明已生成，可确认后装载', 'success')
    } catch (error: unknown) {
      console.error(error)
      toast(formatErrorMessage(error), 'error')
    } finally {
      setWorkflowCapabilityDescriptionGenerating(false)
    }
  }, [
    collectGroupSubgraph,
    workflowCapabilityDescriptionDialog,
    workflowCapabilityDescriptionGenerating,
    workflowDescriptionModelCatalog.error,
    workflowDescriptionModelCatalog.loading,
    workflowDescriptionModelCatalog.options,
  ])

  const closeWorkflowCapabilityDescriptionDialog = useCallback((): void => {
    if (openingCapabilityBayGroupId || workflowCapabilityDescriptionGenerating) return
    setWorkflowCapabilityDescriptionDialog(null)
    setWorkflowCapabilityDescriptionInput('')
  }, [openingCapabilityBayGroupId, workflowCapabilityDescriptionGenerating])

  const confirmWorkflowCapabilityDescription = useCallback(async (): Promise<void> => {
    const dialog = workflowCapabilityDescriptionDialog
    if (!dialog || openingCapabilityBayGroupId) return
    const description = workflowCapabilityDescriptionInput.trim()
    if (!description) {
      toast('请先智能生成或填写工作流能力说明', 'warning')
      return
    }

    setOpeningCapabilityBayGroupId(dialog.groupId)
    try {
      useRFStore.getState().updateNodeData(dialog.triggerNodeId, {
        workflowCapabilityDescription: description,
      })
      const saved = await saveCurrentCanvasSnapshot()
      if (!saved) {
        throw new Error('工作流版本保存失败；能力说明尚未装载，请确认当前画布仍可编辑后重试')
      }
      const state = useUIStore.getState()
      const savedFlowId = String(state.currentFlow.id || '').trim()
      const savedProjectId = String(state.currentProject?.id || '').trim()
      if (!savedFlowId || !savedProjectId) {
        throw new Error('工作流版本已保存，但缺少可装载的工作流或项目信息')
      }
      await createFlowVersionSnapshot(savedFlowId)
      setWorkflowCapabilityDescriptionDialog(null)
      setWorkflowCapabilityDescriptionInput('')
      state.requestCapabilityBayForFlow(savedFlowId)
    } catch (error: unknown) {
      toast(formatErrorMessage(error), 'error')
    } finally {
      setOpeningCapabilityBayGroupId(null)
    }
  }, [openingCapabilityBayGroupId, workflowCapabilityDescriptionDialog, workflowCapabilityDescriptionInput])

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
        : await upsertProject({ name, teamId: getActiveTeamId() ?? undefined })
      const flows = await listProjectFlows(project.id)
      const targetFlow = flows[0] ?? null
      await saveProjectFlow({
        id: targetFlow?.id,
        projectId: project.id,
        name,
        nodes: subgraph.nodes,
        edges: subgraph.edges,
        // 保存的是模板目标项目的 flow（非当前画布），带该 flow 自身的 revision 做乐观锁。
        expectedRevision: targetFlow?.canvasRevision,
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

  const generateGroupStoryboard = useCallback(async (groupId: string, recipeId: string, opts: { durationSeconds: number; aspect?: string; videoModel?: string }, profileId?: string) => {
    setStoryboardPickerGroupId(null)
    // 故事板依赖全局参考画风：缺画风时不再静默降级/直接开跑，唤起统一的风格素材选择器（资产面板），
    // 用户选/传完后自动续跑本函数。getState 读最新，resolve 后即可通过本闸。取消选择则不生成。
    const styleRefs = useUIStore.getState().activeStyleBible?.referenceImages ?? []
    if (!styleRefs.length) {
      useUIStore.getState().requestStyleReference({
        reason: '生成故事板',
        onResolved: (refs) => { if (refs.length) void generateGroupStoryboard(groupId, recipeId, opts, profileId) },
      })
      return
    }
    // 【VIDEO_PROFILE_ROUTING=ON】recipe 选定后、派发前先出领域档案确认卡。
    // 用户确认后会带 profileId 再次调用本函数（继续往下派发）。flag OFF 或已确认时直接跳过。
    if (isVideoProfileRoutingEnabled() && !profileId) {
      setVideoProfilePending({ groupId, recipeId, opts })
      return
    }
    const projectId = String(currentProject?.id || '').trim()
    // 一键出片入口只收集并持久化用户确认的结构事实；具体创作与生产步骤由 agents Skill 决定。
    const flowId = String(useUIStore.getState().currentFlow?.id || '').trim()
    // 章节画布：没有 flows 表 flow，靠 window.__TAPCANVAS_CURRENT_CHAPTER__ 标识，走章节存盘/派发。
    const chapterCtx = (window as unknown as {
      __TAPCANVAS_CURRENT_CHAPTER__?: { chapterId?: string }
    }).__TAPCANVAS_CURRENT_CHAPTER__
    const chapterId = String(chapterCtx?.chapterId || '').trim()
    if (!flowId && !chapterId) { toast('未找到当前画布，无法生成', 'error'); return }
    // 章节=项目子级；派发经 chatCommandStore→AiChatDialog 自动附带 chapterId。
    const aspect = opts.aspect || '9:16'
    const videoModel = opts.videoModel || 'auto'
    // 用户在确认卡明确选择的配方、时长、比例、模型和领域档位属于确定性入口参数，先写入 group。
    useRFStore.getState().updateNodeData(groupId, {
      sourceRecipeId: recipeId,
      targetDurationSeconds: opts.durationSeconds,
      videoAspect: aspect,
      ...(videoModel !== 'auto' ? { videoModel } : {}),
      // 领域档案路由（VIDEO_PROFILE_ROUTING=ON）：把确认卡选定的档位确定性钉到组 data，
      // 与 sourceRecipeId / videoModel / videoAspect 同级。骨架/orchestrator 续写/重跑读它保证全片一致。
      ...(profileId && profileId !== 'default' ? { videoProfileId: profileId } : {}),
    })
    // 触发前先把当前画布(含刚打的组/新加节点)存盘到 flows.data。
    // canvas-patches 只做实时广播、不落库；agent 走 flow_get 读的是 flows.data 快照，
    // 不先存盘会导致 agents 读取不到当前群组与素材事实。
    const rf = useRFStore.getState()
    try {
      // 章节画布走章节保存；项目画布走 App 的 revision CAS + 三方重放入口。
      if (!(await saveCurrentCanvasSnapshot())) {
        throw new Error('current canvas save failed')
      }
    } catch {
      toast('画布存盘失败，无法开始编排（请先点击右上角「保存」后重试）', 'error')
      return
    }
    // 提取组内真实图片节点 ID 与用户文本；图片身份只传 nodeId，真实 URL 由服务端在付费边界 fresh-read。
    const groupChildren = rf.nodes.filter((n) =>
      n?.parentId === groupId ||
      (n as FlowNode & { parentNode?: string | null }).parentNode === groupId ||
      n?.data?.parentId === groupId,
    )
    const referenceImageNodeIds = groupChildren
      .filter((n) => {
        const kind = typeof n?.data?.kind === 'string' ? n.data.kind : ''
        return kind === 'image' || kind === 'imageEdit' || kind === 'storyboardImage' || kind === 'storyboard'
      })
      .map((n) => String(n.id || '').trim())
      .filter(Boolean)
    const briefText = groupChildren
      // 文本节点内容存在 data.prompt（features:['prompt']，textNodeContent 优先级 prompt>content>text）；
      // 旧代码只看 text/content 漏了 prompt，导致组内文字"完全没被读取"。只对 text 类节点取 prompt，
      // 避免把图片/视频节点的生成 prompt 也卷进简报。
      .map((n) => {
        const d = n?.data ?? {}
        const isTextNode = String(d.kind || '') === 'text'
        return String((isTextNode ? d.prompt : '') || d.text || d.content || (isTextNode ? d.latestTextResult : '') || '').trim()
      })
      .filter(Boolean)
      .join('\n')
    // 内部执行合同完整派发给 agent；右侧对话只投影简短 displayText，避免把机器合同
    // 当作用户自然语言展示。编排过程仍在同一主对话中持续更新。
    const promptText = buildOneClickFilmChatText({
      groupId,
      projectId: projectId || null,
      flowId: flowId || null,
      chapterId: chapterId || null,
      recipeId,
      targetDurationSeconds: opts.durationSeconds,
      videoAspect: aspect,
      requestedVideoModel: videoModel === 'auto' ? null : videoModel,
      videoProfileId: profileId && profileId !== 'default' ? profileId : null,
      userBrief: briefText || null,
      referenceImageNodeIds,
    })
    useChatCommandStore.getState().dispatchSend({
      text: promptText,
      displayText: ONE_CLICK_FILM_CHAT_DISPLAY_TEXT,
      requiredSkills: ['tapcanvas-video-workflow'],
      attachCanvasContext: true,
      freshConversation: true,
      workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
    })
    toast('已把一键成片任务和真实画布事实发给小T，编排过程在右侧对话显示', 'info')
  }, [currentProject?.id])


  // 一键合成组内视频：收集组内已生成的视频节点（按画布 x 从左到右作播放顺序），创建一个
  // videoCompose 节点并把这些视频全连进去（out-video → in-any），用户在合成节点点「合成视频」即可拼接。
  // 这是显式的人工剪辑动作，不属于一键成片编排；不自动触发拼接（避免误扣费/误拼）。
  const composeGroupVideos = useCallback((groupId: string) => {
    const rf = useRFStore.getState()
    const groupVideos = rf.nodes
      .filter((n: any) =>
        n?.parentId === groupId || (n as any)?.parentNode === groupId || n?.data?.parentId === groupId,
      )
      .filter((n: any) => {
        const d = n?.data ?? {}
        const url =
          d.videoUrl ||
          (Array.isArray(d.videoResults) && d.videoResults[0] && (d.videoResults[0] as any).url) ||
          ''
        // 只收真实成片视频，排除合成节点自身（videoCompose）避免自我嵌套
        return d.kind !== 'videoCompose' && typeof url === 'string' && /^https?:\/\//.test(url)
      })
      .sort((a: any, b: any) => (a?.position?.x ?? 0) - (b?.position?.x ?? 0))
    if (groupVideos.length < 2) {
      toast('组内需要至少 2 个已生成的视频节点才能合成', 'info')
      return
    }
    const videoIds = groupVideos.map((n: any) => n.id)
    const group = rf.nodes.find((n) => n.id === groupId)
    const composeX = (group?.position?.x ?? 0) + ((group as any)?.width ?? 400) + 80
    const composeY = group?.position?.y ?? 0
    const before = new Set(useRFStore.getState().nodes.map((n) => n.id))
    useRFStore.getState().addNode('taskNode', '视频合成', {
      position: { x: composeX, y: composeY },
      kind: 'videoCompose',
      draftByAgent: false,
    })
    const composeId = useRFStore.getState().nodes.map((n) => n.id).find((id) => !before.has(id))
    if (!composeId) {
      toast('视频合成节点创建失败', 'error')
      return
    }
    useRFStore.setState((s) => ({
      ...s,
      edges: [
        ...s.edges,
        ...videoIds.map((vid: string, i: number) => ({
          id: `e-${vid}-${composeId}-${i}`,
          source: vid,
          target: composeId,
          sourceHandle: 'out-video',
          targetHandle: 'in-any',
          type: 'typed' as const,
          animated: false,
        })),
      ],
    }))
    toast(`已创建视频合成节点并连接 ${videoIds.length} 个视频，点节点上「合成视频」即可拼接`, 'success')
  }, [])

  const selectionActionAnchor = useMemo<SelectionActionAnchor | null>(() => {
    if (dragging || isBoxSelecting) return null
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
      maxX,
      centerY: (minY + maxY) / 2,
      selectedCount: selectedNodeIds.length,
      topY: minY,
    }
  }, [dragging, isBoxSelecting, nodes, selectedGroupIds, selectedNodeIds])

  const adminVisibleGraph = useMemo(
    () => filterAdminWorkflowCanvasGraph(nodes, edges, isAdmin),
    [edges, isAdmin, nodes],
  )
  const renderNodes = adminVisibleGraph.nodes as FlowNode[]
  const renderEdges = adminVisibleGraph.edges as FlowEdge[]

  const styledViewNodes = useMemo(() => {
    if (dragging && !viewOnly && !referencePickerTargetId) {
      return renderNodes
    }
    // 稳定引用快速路径：无任何显示模式（只读 / 参考选择）时，只有「归档态」
    // 和「groupNode 拖拽把手未归一」两种情况需要逐节点改造。二者都不存在时直接返回原 nodes
    // 引用——否则 nodes.map 每次都新建外层数组，令 React Flow 在 Canvas 因任意无关状态
    // 重渲染时都要整表 reconcile 一遍节点（本组件状态源极多）。返回同引用即让其整段跳过。
    // 行为与走完整 map 完全等价（该情形下 map 本就对每个节点返回同引用）。
    if (!viewOnly && !referencePickerTargetId) {
      let needsPerNode = false
      for (const node of renderNodes) {
        if (node.type === 'groupNode' && node.dragHandle !== '.tc-group-node__shell') { needsPerNode = true; break }
        if ((node.data as Record<string, unknown>)?.sbaStatus === 'archived') { needsPerNode = true; break }
      }
      if (!needsPerNode) return renderNodes
    }
    return renderNodes.map((node) => {
    const isReferencePickerCandidate = Boolean(
      referencePickerTargetId && isCanvasReferencePickerCandidateNode(node, referencePickerTargetId),
    )
    const isReferencePickerBlocked = isReferencePickerCandidate && referencePickerBlockedSourceIds.has(node.id)
    const dragHandle = node.type === 'groupNode' ? '.tc-group-node__shell' : node.dragHandle
    const isSbaArchived = (node.data as Record<string, unknown>)?.sbaStatus === 'archived'
    const needsDisplayStyling = viewOnly || isReferencePickerBlocked || isSbaArchived
    if (!needsDisplayStyling) {
      if (node.type === 'groupNode' && node.dragHandle !== dragHandle) {
        return {
          ...node,
          dragHandle,
        }
      }
      return node
    }

    return {
      ...node,
      dragHandle,
      draggable: node.type === 'ioNode' ? node.draggable : (!viewOnly && !referencePickerTargetId),
      selectable: !viewOnly && !referencePickerTargetId,
      focusable: !viewOnly && !referencePickerTargetId,
      connectable: !viewOnly && !referencePickerTargetId,
      style: {
        ...(node.style || {}),
        opacity: isReferencePickerBlocked ? 0.3 : isSbaArchived ? 0.35 : 1,
        filter: isReferencePickerBlocked ? 'grayscale(1) saturate(0.2)' : isSbaArchived ? 'grayscale(0.6) saturate(0.4)' : 'none',
        transition: 'opacity 160ms ease, filter 160ms ease',
      },
    }
    })
  }, [dragging, referencePickerBlockedSourceIds, referencePickerTargetId, renderNodes, viewOnly])

  useEffect(() => {
    if (!referencePickerTargetId) return
    const targetExists = nodes.some((node) => node.id === referencePickerTargetId)
    if (!targetExists) closeCanvasReferencePicker()
  }, [closeCanvasReferencePicker, nodes, referencePickerTargetId])

  // Edge highlight when connected to a selected node
  const selectedIds = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])
  const dragViewEdges = useMemo(() => {
    const base = renderEdges
    const needsDragRewrite = base.some((edge) => (
      edge.type !== (isWorkflowAgentReferenceEdge(edge) ? 'orth' : 'typed')
      || edge.interactionWidth == null
    ))
    if (!needsDragRewrite) return base
    return base.map((edge) => ({
      ...edge,
      type: (isWorkflowAgentReferenceEdge(edge) ? 'orth' : 'typed') as FlowEdge['type'],
      interactionWidth: edge.interactionWidth ?? 40,
    }))
  }, [renderEdges])
  // routedEdges：仅处理路由类型切换，不依赖 nodes，节点数据变化时不重算
  const routedEdges = useMemo(() => {
    if (dragging) return dragViewEdges
    const displayRouteType: FlowEdge['type'] = edgeRoute === 'orth' ? 'orth' : 'typed'
    return renderEdges.map((edge) => {
      const resolvedRouteType: FlowEdge['type'] = isWorkflowAgentReferenceEdge(edge) ? 'orth' : displayRouteType
      if (edge.type === resolvedRouteType && edge.interactionWidth != null) return edge
      return { ...edge, type: resolvedRouteType, interactionWidth: edge.interactionWidth ?? 40 }
    })
  }, [dragViewEdges, dragging, edgeRoute, renderEdges])
  // viewEdges：在 routedEdges 基础上叠加选中样式；nodes 仅在需要时使用
  // Edge transition is controlled by stable CSS and heavy-selection state.
  // 无需 JS 状态驱动，消除 pan 边界因 edgeTransitionReady/viewportMoving 引发的额外 re-render
  // 上一帧的样式化边缓存（按 edge id），用于跨帧复用未变化的边对象引用，避免单选重渲全部边。
  const styledEdgeCacheRef = useRef<Map<string, { src: FlowEdge; active: boolean; opacity: number; stroke: string | undefined; edge: FlowEdge }>>(new Map())
  const viewEdges = useMemo(() => {
    if (!shouldHighlightSelectedEdges) {
      if (styledEdgeCacheRef.current.size) styledEdgeCacheRef.current = new Map()
      return routedEdges
    }
    // 拖拽期间跳过样式计算，保持与 routedEdges 一致的轻量路径
    if (dragging) {
      if (styledEdgeCacheRef.current.size) styledEdgeCacheRef.current = new Map()
      return routedEdges
    }
    const nodesById = new Map(renderNodes.map((node) => [node.id, node] as const))
    // 选中单个节点时本 memo 会因 selectedIds 变化重算。原实现给「每一条」边都 spread 出新对象，
    // 导致一次单选就让全部 59 条边重渲（只有连着选中节点的几条边视觉真的变了）。这里按 id 缓存
    // 上一帧产物：当某条边的 base 引用与计算结果（active/opacity/stroke）都没变时，复用旧对象引用，
    // React Flow 便会跳过这条边的重渲——单选的边重渲从「全部」降到「仅连着选中/取消选中节点的那几条」。
    const prev = styledEdgeCacheRef.current
    const nextCache = new Map<string, { src: FlowEdge; active: boolean; opacity: number; stroke: string | undefined; edge: FlowEdge }>()
    const result = routedEdges.map((e) => {
      const targetNode = nodesById.get(e.target)
      const active = shouldHighlightSelectedEdges && (selectedIds.has(e.source) || selectedIds.has(e.target))
      const opacity = active ? 1 : 0.5
      // 选中相邻边规格对齐 Neowow：白 50% / 2.5px（.vue-flow__edge.selected 同款）。
      const stroke = active ? (isDarkCanvas ? 'rgba(255,255,255,0.5)' : '#141416') : undefined
      // 生成中流光（对齐 Neowow edge comet）：目标节点 running 时边加流动 dash 类。
      const flowing = (targetNode?.data as { status?: string } | undefined)?.status === 'running'
      const cached = prev.get(e.id)
      if (cached && cached.src === e && cached.active === active && cached.opacity === opacity && cached.stroke === stroke && (cached.edge.className === 'tc-edge-flowing') === flowing) {
        nextCache.set(e.id, cached)
        return cached.edge
      }
      const edge: FlowEdge = active
        ? { ...e, className: flowing ? 'tc-edge-flowing' : undefined, style: { ...(e.style || {}), opacity, stroke, strokeWidth: 2.5 } }
        : { ...e, className: flowing ? 'tc-edge-flowing' : undefined, style: { ...(e.style || {}), opacity } }
      nextCache.set(e.id, { src: e, active, opacity, stroke, edge })
      return edge
    })
    styledEdgeCacheRef.current = nextCache
    return result
  }, [routedEdges, renderNodes, isDarkCanvas, selectedIds, shouldHighlightSelectedEdges, dragging])

  // 使用多选拖拽（内置），不自定义组拖拽，避免与画布交互冲突

  // 旧的宫格/水平布局已合并为“格式化”（树形，自上而下，32px 间距）

  const handleInsertNodeAt = (
    targetKind: string,
    menuState: { x: number; y: number; fromNodeId?: string; fromHandle?: string | null; targetHandleId?: string | null },
  ) => {
    const posFlow = screenToFlow({ x: menuState.x, y: menuState.y })
    const upstreamNode = menuState.fromNodeId
      ? useRFStore.getState().nodes.find(n => n.id === menuState.fromNodeId)
      : undefined
    const sourceKind = upstreamNode ? ((upstreamNode.data as any)?.kind as string | undefined) : undefined

    const extraSourceIds = multiSourceNodeIdsRef.current.slice()
    multiSourceNodeIdsRef.current = []

    useRFStore.setState(s => {
      const id = genTaskNodeId()
      const schema = getTaskNodeSchema(targetKind)
      const label = schema.label || schema.kind || 'Node'
      const data = {
        ...createTaskNodeInitialData(schema.kind),
        label,
        kind: schema.kind,
      }

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
          targetHandle: menuState.targetHandleId || pickDefaultTargetHandle(schema.kind),
          type: (edgeRoute === 'orth' ? 'orth' : 'typed') as any,
          animated: false,
        }
        edgesNext = [...edgesNext, edge]
      }

      for (const extraId of extraSourceIds) {
        const extraNode = s.nodes.find(n => n.id === extraId)
        const extraKind = extraNode ? ((extraNode.data as any)?.kind as string | undefined) : undefined
        const extraFromHandle = pickDefaultSourceHandle(extraKind)
        const extraEdge: any = {
          id: `e-${extraId}-${id}-${Date.now().toString(36)}-x`,
          source: extraId,
          target: id,
          sourceHandle: extraFromHandle,
          targetHandle: menuState.targetHandleId || pickDefaultTargetHandle(schema.kind),
          type: (edgeRoute === 'orth' ? 'orth' : 'typed') as any,
          animated: false,
        }
        edgesNext = [...edgesNext, extraEdge]
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

    const hasVideoInSources = multiSelectSourceKinds.length > 0
      && multiSelectSourceKinds.some(k => getTaskNodeCoreType(k) === 'video')

    const schemaCandidates: InsertMenuSchemaCandidate[] = listTaskNodeSchemas()
      .flatMap((schema): InsertMenuSchemaCandidate[] => {
        if (INSERT_MENU_EXCLUDED_KINDS.has(schema.kind)) return []
        if (fromKind && !isValidEdgeByType(fromKind, schema.kind)) return []
        const targetHandleId = resolveCompatibleTargetHandleId(schema.kind)
        if (!targetHandleId) return []
        const coreType = getTaskNodeCoreType(schema.kind)
        const disabled = hasVideoInSources && (coreType === 'text' || coreType === 'image')
        return [{ schema, targetHandleId, disabled }]
      })
      .sort((a, b) => {
        const order: Record<string, number> = { image: 10, storyboard: 15, video: 20, document: 30, generic: 100 }
        const ai = order[a.schema.category] ?? 999
        const bi = order[b.schema.category] ?? 999
        if (ai !== bi) return ai - bi
        return String(a.schema.label || a.schema.kind).localeCompare(String(b.schema.label || b.schema.kind))
      })

    const textContent = typeof fromRecord?.prompt === 'string' ? fromRecord.prompt.trim() : ''
    const showOneClickVideo = fromKind === 'text' && textContent.length > 0

    return { schemaCandidates, showOneClickVideo }
  }, [
    insertMenu.fromHandle,
    insertMenu.open,
    multiSelectSourceKinds,
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

  // Sticky drag fix: D3 drag installs a capture-phase mouseup listener on window.
  // If the user releases the mouse outside the browser window, that mouseup never fires,
  // leaving D3's drag gesture stuck. Detect the stale state via event.buttons === 0
  // on the next mousemove and fire a synthetic mouseup so D3 can clean up.
  useEffect(() => {
    if (!dragging) return
    const cancelStuckDrag = (event: MouseEvent) => {
      if (event.buttons !== 0) return
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: 0,
        buttons: 0,
      }))
    }
    window.addEventListener('mousemove', cancelStuckDrag)
    return () => window.removeEventListener('mousemove', cancelStuckDrag)
  }, [dragging])

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

  const firstNodeImageUrl = React.useMemo(
    () => nodes.map((n) => String((n.data as any)?.imageUrl || '').trim()).find((url) => url.length > 0) || '',
    [nodes],
  )

  React.useEffect(() => {
    // 只读画布（分享页等）不回写封面：观看者无权也不该写项目数据（未登录还会 401）
    if (viewOnly) return
    const projectId = String(currentProject?.id || '').trim()
    if (!projectId || !firstNodeImageUrl || firstNodeImageUrl === lastSavedCoverRef.current) return
    lastSavedCoverRef.current = firstNodeImageUrl
    void saveProjectCoverMeta(projectId, firstNodeImageUrl)
  }, [firstNodeImageUrl, currentProject, viewOnly])

  useEffect(() => {
    if (!insertMenu.open) {
      setMultiSelectSourceKinds([])
      return
    }
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
      <DirectorCaptureRunner />
      <div className={joinClassNames('tc-canvas', className)}
        style={canvasStyle}
        data-connecting={connectingType || ''}
        data-connecting-active={(isConnecting || !!tapConnectSource) ? 'true' : 'false'}
        data-dragging={dragging ? 'true' : 'false'}
        data-large-canvas={heavyCanvas ? 'true' : 'false'}
        data-lod-overview={lodDegraded ? 'true' : 'false'}
        data-heavy-selection={heavySelectionActive ? 'true' : 'false'}
        data-heavy-selection-dragging={heavySelectionDragging ? 'true' : 'false'}
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
          cancelAnimationFrame(previewLineRafRef.current)
          const x = e.clientX, y = e.clientY
          previewLineRafRef.current = requestAnimationFrame(() => {
            lastPointerScreenRef.current = { x, y }
            if (!viewportMovingRef.current) {
              queueSpotlightPosition(x, y)
            }
            if (isConnecting) setMouse({ x, y })
            const sc = usePresenceStore.getState().sendCursor
            if (sc) {
              const fp = rf.screenToFlowPosition({ x, y })
              sc(fp.x, fp.y)
            }
          })
        }}
        onDrop={viewOnly ? undefined : onDrop}
        onDragOver={viewOnly ? undefined : onDragOver}
        onMouseDown={viewOnly ? undefined : (e) => {
          if (e.button === 2) {
            rightDragRef.current = { startX: e.clientX, startY: e.clientY }
          }
        }}
        onKeyDown={(e) => {
          if (viewOnly) return
          const focusTarget = document.activeElement as HTMLElement | null
          const isTextInput =
            isCanvasTextInteractionTarget(e.target) ||
            isCanvasTextInteractionTarget(focusTarget)

          if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextInput) {
            e.preventDefault()
            useRFStore.getState().removeSelected()
          }
        }}
        tabIndex={0} // 使div可以接收键盘事件
        onPaste={(e) => {
          if (viewOnly) return
          if (
            isCanvasTextInteractionTarget(e.target) ||
            isCanvasTextInteractionTarget(document.activeElement)
          ) return
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
            // 本会话内复制的节点：copySelected/copyNode 会把同一份 JSON 写进系统剪贴板。
            // 命中时按"节点粘贴"语义在光标处贴回（pasteFromClipboardAt），而不是走 importWorkflow
            // 的导入/清洗路径——避免出现「已导入工作流」提示及语义不一致。
            const ownClip = useRFStore.getState().clipboard
            const isOwnNodeCopy = !!ownClip && ownClip.nodes.length > 0 && text === JSON.stringify(ownClip, null, 2)
            if (isOwnNodeCopy) {
              e.preventDefault()
              e.stopPropagation()
              ;(window as any).__tcLastWorkflowPasteAt = Date.now()
              pasteFromClipboardAt(pos)
              handled = true
            } else {
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
          }
          if (!handled) return
        }}
      >
        {otherTabActive && !viewOnly ? (
          <InlinePanel
            className="tc-canvas__multi-tab-notice"
            data-emphasis="strong"
            role="status"
            aria-live="polite"
          >
            <Group className="tc-canvas__multi-tab-notice-content" gap={8} wrap="nowrap">
              <IconAlertTriangle className="tc-canvas__multi-tab-notice-icon" size={16} aria-hidden />
              <Text className="tc-canvas__multi-tab-notice-text" size="xs" fw={600}>
                另一个标签页已打开此画布。保存会按版本合并本地改动；请避免同时修改同一节点。
              </Text>
            </Group>
          </InlinePanel>
        ) : null}
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
      <CanvasVirtualizationContext.Provider value={heavyCanvas}>
      <CanvasLODContext.Provider value={lodDegraded}>
      <EdgeInteractionContext.Provider value={edgeInteractionContextValue}>
      <ReactFlow className="tc-canvas__flow"
        nodes={styledViewNodes}
        edges={viewEdges}
        onNodesChange={viewOnly ? undefined : handleNodesChange}
        onEdgesChange={viewOnly ? undefined : onEdgesChange}
        onConnect={viewOnly ? undefined : handleConnect}
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
        onNodeDoubleClick={viewOnly ? undefined : (_evt, node) => {
          const data = node.data as Record<string, unknown>
          if (data?.sbaRole === 'moment-board') {
            const sbaPath = String(data.sbaPath || '')
            window.dispatchEvent(new CustomEvent('tc-sba-rewind', { detail: { nodeId: node.id, sbaPath } }))
            return
          }
          if (node.type === 'groupNode') return
          void rf.fitView({
            nodes: [node],
            padding: 0.18,
            duration: 220,
            minZoom: 0.1,
            maxZoom: 1.15,
          })
        }}
        onMoveStart={onCanvasMoveStart}
        onMove={onCanvasMove}
        onMoveEnd={onCanvasMoveEnd}
        nodeTypes={CANVAS_NODE_TYPES}
        edgeTypes={CANVAS_EDGE_TYPES}
        // Above the measured large-canvas threshold, React Flow is the sole owner
        // of visible-node culling. Do not layer a second hidden-node array on top.
        onlyRenderVisibleElements={heavyCanvas}
        onInit={onInit}
        selectionOnDrag={!viewOnly && !canvasViewLocked}
        // Edit mode: middle-button and right-button drag pan the canvas; left drag keeps selection box.
        panOnDrag={canvasViewLocked ? false : (viewOnly ? true : ([1, 2] as any))}
        panOnScroll={!canvasViewLocked}
        zoomOnPinch={!canvasViewLocked}
        zoomOnScroll={!canvasViewLocked}
        zoomOnDoubleClick={false}
        minZoom={CANVAS_MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        nodesDraggable={!viewOnly && !canvasViewLocked}
        nodesConnectable={!viewOnly}
        elementsSelectable={!viewOnly}
        autoPanOnConnect={false}
        autoPanOnNodeDrag={false}
        // @xyflow 12.11 新增，默认 true：框选拖到视口边缘会自动平移。本画布虚拟化 + culling，
        // 任何自动平移都会触发屏幕外节点 pop-in，故与上面两个 auto-pan 一致显式关闭，
        // 保持升级前（12.10.x 无此 feature）的行为。
        autoPanOnSelection={false}
        elevateNodesOnSelect
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
        connectionRadius={28}
        defaultEdgeOptions={{
          animated: false,
          type: (edgeRoute === 'orth' ? 'orth' : 'typed') as any,
          style: { strokeWidth: 1.25, strokeLinecap: 'round' },
          interactionWidth: 1,
        }}
        connectionLineComponent={MagneticConnectionLine}
        connectionLineType={ConnectionLineType.SimpleBezier}
        connectionLineStyle={connectionLineStyle}
      >
        <CanvasBottomControls
          showMinimap={showMinimap}
          showGrid={showGrid}
          onToggleMinimap={() => setShowMinimap((v) => !v)}
          onToggleGrid={() => setShowGrid((v) => !v)}
          onMiniMapClick={handleMiniMapClick}
          onMiniMapNodeClick={handleMiniMapNodeClick}
          isDarkCanvas={isDarkCanvas}
        />
        {showGrid && (
          <Background id="tc-canvas-grid-base" className="tc-canvas__background" gap={24} size={1} color={backgroundGridColor} />
        )}
        <CanvasCursorOverlay />
      </ReactFlow>
      {!viewOnly ? <WorkflowNodeInspectorPanel readOnly={viewOnly} /> : null}
      </EdgeInteractionContext.Provider>
      </CanvasLODContext.Provider>
      </CanvasVirtualizationContext.Provider>
      {/* 初载遮罩：常驻 div 用类切换淡出（免二段式卸载），透明后 pointer-events:none 不挡交互。 */}
      <div className={`tc-canvas-loading${canvasRevealed ? ' tc-canvas-loading--hidden' : ''}`} aria-hidden>
        <div className="tc-canvas-loading__spinner" />
        <div className="tc-canvas-loading__text">加载中…</div>
      </div>
      {import.meta.env.DEV && !viewOnly && !hideDevPerformancePanel && <CanvasDevPerfPanel getStats={getPerfStats} />}
      {/* 顶部节点可见性过滤栏（文本/图片/分镜/视频）已移除：与「智能创作」进度面板重叠且使用率低。 */}
      {!viewOnly && referencePickerTargetId && (
        <PanelCard
          className="tc-canvas__reference-picker-bar"
          padding="compact"
          style={{
            position: 'absolute',
            left: '50%',
            top: 60,
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
      {selectionActionAnchor && !viewOnly && !dragging && !storyboardPickerGroupId && (
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
              <VideoCompareSelectionAction
                className="tc-canvas__video-compare-selection-action"
                resolution={videoCompareSelectionResolution}
                onCompare={({ source, target }) => {
                  useVideoCompareStore.getState().openComparison(source, target)
                }}
                onMissingAssets={(nodeIds) => {
                  toast(
                    `无法对比：${nodeIds.length} 个视频节点还没有真实视频资产。请生成完成后重试。`,
                    'warning',
                  )
                }}
              />
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
                  {isRunningSelectedGroup
                    ? '执行中…'
                    : selectedGroupCanOpenCapabilityBay
                      ? '运行工作流'
                      : '整组执行'}
                </Button>
              )}
              {selectedGroupCanOpenCapabilityBay && (
                <Button
                  className="tc-canvas__selection-action-bar-action"
                  size="xs"
                  radius="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconPlugConnected className="tc-canvas__selection-action-bar-icon" size={14} />}
                  styles={{ root: { color: '#f5f5f7', fontWeight: 600 } }}
                  loading={Boolean(openingCapabilityBayGroupId)}
                  disabled={Boolean(openingCapabilityBayGroupId)}
                  onClick={() => {
                    if (selectedGroupIds.length !== 1) return
                    openSelectedWorkflowInCapabilityBay(selectedGroupIds[0])
                  }}
                >
                  {openingCapabilityBayGroupId ? '正在准备装载…' : '装载到小T'}
                </Button>
              )}
              {canPublishSelectedGroupTemplate && !selectedGroupCanOpenCapabilityBay && (
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
                    {selectedGroupIds.length === 1 && (
                      <Menu.Item onClick={() => setStoryboardPickerGroupId(selectedGroupIds[0])}>
                        故事板生成
                      </Menu.Item>
                    )}
                    {selectedGroupIds.length === 1 && (
                      <Menu.Item onClick={() => composeGroupVideos(selectedGroupIds[0])}>
                        合成组内视频
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
                    {canPublishSelectedGroupTemplate && selectedGroupCanOpenCapabilityBay && (
                      <>
                        <Menu.Divider className="tc-canvas__selection-action-menu-divider" />
                        <Menu.Item
                          className="tc-canvas__selection-action-menu-item"
                          leftSection={<IconLayoutGridAdd className="tc-canvas__selection-action-menu-icon" size={15} />}
                          disabled={Boolean(publishingTemplateGroupId)}
                          onClick={() => { void publishSelectedGroupAsTemplate() }}
                        >
                          {publishingTemplateGroupId ? '正在创建模板…' : '创建模板'}
                        </Menu.Item>
                      </>
                    )}
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
          </PanelCard>
        </CanvasSelectionActionBar>
      )}
      {selectionActionAnchor && !viewOnly && !dragging && selectedNodeIds.length >= 2 && (
        <CanvasSelectionConnectButton
          anchor={selectionActionAnchor}
          onConnect={(screenX, screenY) => {
            const allIds = selectedNodeIds
            const allKinds = allIds.map(id => {
              const nd = useRFStore.getState().nodes.find(n => n.id === id)
              return (nd?.data as any)?.kind as string || ''
            })
            multiSourceNodeIdsRef.current = allIds.slice(1)
            setMultiSelectSourceKinds(allKinds)
            useInsertMenuStore.getState().openMenu({
              x: screenX,
              y: screenY,
              fromNodeId: allIds[0],
            })
          }}
          onDragLine={setMultiDragLine}
        />
      )}
      {multiDragLine && (
        <svg
          style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 79 }}
          aria-hidden
        >
          <path
            d={`M${multiDragLine.fromX},${multiDragLine.fromY} C${multiDragLine.fromX + 80},${multiDragLine.fromY} ${multiDragLine.toX - 80},${multiDragLine.toY} ${multiDragLine.toX},${multiDragLine.toY}`}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
            strokeDasharray="6 4"
          />
          <circle cx={multiDragLine.toX} cy={multiDragLine.toY} r={4} fill="rgba(255,255,255,0.5)" />
        </svg>
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
                <Button
                  className="tc-canvas__context-menu-action"
                  variant="subtle"
                  onClick={() => {
                    const menuState = menu
                    if (!menuState || menuState.type !== 'canvas') return
                    useRFStore.getState().addDirectorConsoleNode({ position: screenToFlow({ x: menuState.x, y: menuState.y }) })
                    setMenu(null)
                  }}
                >
                  新建导演台
                </Button>
                {clipboard && clipboard.nodes.length > 0 && (
                  <Button
                    className="tc-canvas__context-menu-action"
                    variant="subtle"
                    onClick={() => {
                      const menuState = menu
                      if (!menuState || menuState.type !== 'canvas') return
                      pasteFromClipboardAt(screenToFlow({ x: menuState.x, y: menuState.y }))
                      setMenu(null)
                    }}
                  >
                    粘贴{clipboard.nodes.length > 1 ? `（${clipboard.nodes.length}）` : ''}
                  </Button>
                )}
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
                        {runningGroupId === menu.id
                          ? '执行中…'
                          : isWorkflowGroup(menuNode)
                            ? '运行工作流'
                            : '一键执行组内节点'}
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
                      {validateWorkflowCapabilitySelection(menu.id!, nodes).eligible && (
                        <Button
                          className="tc-canvas__context-menu-action"
                          variant="subtle"
                          leftSection={<IconPlugConnected className="tc-canvas__context-menu-action-icon" size={15} />}
                          loading={openingCapabilityBayGroupId === menu.id}
                          disabled={Boolean(openingCapabilityBayGroupId)}
                          onClick={() => {
                            void openSelectedWorkflowInCapabilityBay(menu.id!)
                            setMenu(null)
                          }}
                        >
                          添加到 Agent 配置
                        </Button>
                      )}
                      <Button className="tc-canvas__context-menu-action" variant="subtle"
                        onClick={() => { setStoryboardPickerGroupId(menu.id!); setMenu(null) }}>
                        故事板生成
                      </Button>
                      <Button className="tc-canvas__context-menu-action" variant="subtle"
                        onClick={() => { composeGroupVideos(menu.id!); setMenu(null) }}>
                        合成组内视频
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
                  <Button className="tc-canvas__context-menu-action" variant="subtle" onClick={() => { copyNode(menu.id!); setMenu(null) }}>复制</Button>
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
        <div
          className="tc-canvas__insert-menu"
          ref={insertMenuRef}
          style={{
            position: 'fixed',
            left: insertMenu.x,
            top: insertMenu.y,
            zIndex: 70,
            transform: 'translate(10px, 10px)',
          }}
        >
          <div className="tc-canvas__insert-menu-header">
            <span className="tc-canvas__insert-menu-title">引用该节点生成</span>
            <button className="tc-canvas__insert-menu-close" onClick={closeInsertMenu}>
              <IconX size={14} />
            </button>
          </div>
          {insertMenuContent.schemaCandidates.length > 0 || insertMenuContent.showOneClickVideo ? (
            <div className="tc-canvas__insert-menu-list">
              {insertMenuContent.schemaCandidates.map(({ schema, targetHandleId, disabled }) => {
                const IconComp = schema.icon
                return (
                  <button
                    key={schema.kind}
                    className={`tc-canvas__insert-menu-action${disabled ? ' tc-canvas__insert-menu-action--disabled' : ''}`}
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return
                      handleInsertNodeAt(schema.kind, {
                        x: insertMenu.x,
                        y: insertMenu.y,
                        fromNodeId: insertMenu.fromNodeId,
                        fromHandle: insertMenu.fromHandle,
                        targetHandleId,
                      })
                    }}
                  >
                    <span className="tc-canvas__insert-menu-icon">
                      {IconComp && <IconComp size={22} />}
                    </span>
                    <span className="tc-canvas__insert-menu-label">{schema.label || schema.kind}</span>
                  </button>
                )
              })}
              {insertMenuContent.showOneClickVideo && (
                <button
                  className="tc-canvas__insert-menu-action"
                  onClick={() => {
                    const nodeId = insertMenu.fromNodeId
                    if (!nodeId) return
                    closeInsertMenu()
                    setPendingOcvNodeId(nodeId)
                  }}
                >
                  <span className="tc-canvas__insert-menu-icon">
                    <IconMovie size={22} />
                  </span>
                  <span className="tc-canvas__insert-menu-label">一键出片</span>
                </button>
              )}
            </div>
          ) : (
            <p className="tc-canvas__insert-menu-empty">暂无可用选项</p>
          )}
        </div>
      )}
      {connectingType && (
        <div className="tc-canvas__connecting-tooltip" style={{ position: 'fixed', left: mouse.x + 12, top: mouse.y + 12, pointerEvents: 'none', fontSize: 12, background: 'rgba(16,16,19,.85)', color: '#e5e7eb', padding: '4px 8px', borderRadius: 6 }}>
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
                loading={Boolean(publishingTemplateGroupId)}
              >
                {workflowNameDialog?.confirmLabel || '确定'}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
      <WorkflowCapabilityDescriptionModal
        opened={workflowCapabilityDescriptionDialog !== null}
        workflowName={workflowCapabilityDescriptionDialog?.workflowName ?? ''}
        description={workflowCapabilityDescriptionInput}
        generating={workflowCapabilityDescriptionGenerating}
        saving={Boolean(openingCapabilityBayGroupId)}
        onClose={closeWorkflowCapabilityDescriptionDialog}
        onDescriptionChange={setWorkflowCapabilityDescriptionInput}
        onGenerate={() => { void generateWorkflowDescription() }}
        onConfirm={() => { void confirmWorkflowCapabilityDescription() }}
      />
      <input
        ref={templateCoverUploadInputRef}
        className="tc-canvas__template-cover-upload-input"
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleTemplateCoverUploadInputChange}
      />
      <CanvasIntentInputDialog />
      <VideoCompareModal className="tc-canvas__video-compare-modal" />
      {storyboardPickerGroupId && (
        <StoryboardRecipePicker
          groupId={storyboardPickerGroupId}
          onPick={(recipeId, opts) => void generateGroupStoryboard(storyboardPickerGroupId, recipeId, opts)}
          onClose={() => setStoryboardPickerGroupId(null)}
        />
      )}
      {videoProfilePending && (
        <VideoProfileConfirmCard
          groupId={videoProfilePending.groupId}
          projectId={String(currentProject?.id || '') || undefined}
          onConfirm={(profileId) => {
            const pending = videoProfilePending
            setVideoProfilePending(null)
            void generateGroupStoryboard(pending.groupId, pending.recipeId, pending.opts, profileId)
          }}
          onClose={() => setVideoProfilePending(null)}
        />
      )}
      <Modal
        opened={pendingOcvNodeId !== null}
        onClose={() => setPendingOcvNodeId(null)}
        title="一键成片"
        centered
        size="xs"
        withCloseButton
      >
        <Stack gap="sm">
          <Select
            label="导演风格（可选 · 项目级锁定）"
            description="选定后小T 按该导演的人格卡定整片视听基调，跨章保持；不选则由小T自行选型"
            placeholder="由小T自选"
            searchable
            clearable
            value={directorPersonaValue || null}
            data={directorPersonaPool.map((p) => ({
              value: p.id,
              label: p.description ? `${p.name} · ${p.description}` : p.name,
            }))}
            onChange={(v) => {
              const projectId = String(currentProject?.id || '').trim()
              const next = v ?? ''
              setDirectorPersonaValue(next)
              if (!projectId) return
              const persona = next
                ? { personaId: next, personaName: directorPersonaPool.find((p) => p.id === next)?.name ?? next }
                : null
              void setProjectDirectorPersona(projectId, persona)
                .then(() => emitDirectorPersonaChanged(persona))
                .catch((err) => {
                  console.warn('保存导演风格失败', err)
                })
            }}
          />
          <Button
            fullWidth
            color="grape"
            onClick={() => {
              const nodeId = pendingOcvNodeId
              setPendingOcvNodeId(null)
              if (!nodeId) return
              useChatCommandStore.getState().dispatchSend({
                text: buildCanvasNodeFilmChatText(nodeId),
                displayText: CANVAS_NODE_FILM_CHAT_DISPLAY_TEXT,
                requiredSkills: ['tapcanvas-video-workflow'],
                attachCanvasContext: true,
                freshConversation: true,
                workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
              })
              toast('已发起后台成片编排，提交后由任务事件自动推进', 'info')
            }}
          >
            一键成片（后台管线 · 推荐）
            <Text component="span" size="xs" c="gray.3" ml={6}>已授权自动到成片</Text>
          </Button>
          <Divider label="或只铺资产库" labelPosition="center" />
          <Button
            fullWidth
            variant="light"
            color="grape"
            onClick={() => {
              const nodeId = pendingOcvNodeId
              setPendingOcvNodeId(null)
              if (nodeId) void startScriptToAssets(nodeId)
            }}
          >
            剧本 → 资产画布 <Text component="span" size="xs" c="dimmed" ml={4}>角色卡 + 场景卡</Text>
          </Button>
        </Stack>
      </Modal>
      </div>
    </CanvasRenderContext.Provider>
  )
}

const CanvasSelectionActionBar = React.memo(function CanvasSelectionActionBar({
  anchor,
  children,
}: {
  anchor: SelectionActionAnchor
  children: React.ReactNode
}): JSX.Element {
  const elementRef = useRef<HTMLDivElement>(null)
  useViewportAnchoredElement(elementRef, {
    kind: 'center-above',
    x: anchor.centerX,
    y: anchor.topY,
    offsetY: 44,
    minimumY: 8,
  })

  return (
    <div
      ref={elementRef}
      className="tc-canvas__selection-action-bar"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
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

const CanvasSelectionConnectButton = React.memo(function CanvasSelectionConnectButton({
  anchor,
  onConnect,
  onDragLine,
}: {
  anchor: SelectionActionAnchor
  onConnect: (screenX: number, screenY: number) => void
  onDragLine: (line: { fromX: number; fromY: number; toX: number; toY: number } | null) => void
}): JSX.Element {
  const btnRef = useRef<HTMLDivElement>(null)
  useViewportAnchoredElement(btnRef, {
    kind: 'right-center',
    x: anchor.maxX,
    y: anchor.centerY,
    offsetX: 12,
  })
  const isDraggingRef = useRef(false)
  const startPosRef = useRef<{ x: number; y: number } | null>(null)
  const dragLineRafRef = React.useRef(0)

  React.useEffect(() => {
    return () => {
      cancelAnimationFrame(dragLineRafRef.current)
    }
  }, [])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    isDraggingRef.current = false
    startPosRef.current = { x: e.clientX, y: e.clientY }
    btnRef.current?.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!btnRef.current?.hasPointerCapture(e.pointerId)) return
    const clientX = e.clientX, clientY = e.clientY
    cancelAnimationFrame(dragLineRafRef.current)
    dragLineRafRef.current = requestAnimationFrame(() => {
      const dx = clientX - (startPosRef.current?.x ?? clientX)
      const dy = clientY - (startPosRef.current?.y ?? clientY)
      if (!isDraggingRef.current && Math.hypot(dx, dy) > 4) {
        isDraggingRef.current = true
        const rect = btnRef.current?.getBoundingClientRect()
        const fromX = rect ? rect.left + rect.width / 2 : clientX
        const fromY = rect ? rect.top + rect.height / 2 : clientY
        onDragLine({ fromX, fromY, toX: clientX, toY: clientY })
      } else if (isDraggingRef.current) {
        const rect = btnRef.current?.getBoundingClientRect()
        const fromX = rect ? rect.left + rect.width / 2 : startPosRef.current?.x ?? clientX
        const fromY = rect ? rect.top + rect.height / 2 : startPosRef.current?.y ?? clientY
        onDragLine({ fromX, fromY, toX: clientX, toY: clientY })
      }
    })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    btnRef.current?.releasePointerCapture(e.pointerId)
    onDragLine(null)
    if (isDraggingRef.current) {
      isDraggingRef.current = false
      onConnect(e.clientX, e.clientY)
    } else {
      onConnect(e.clientX, e.clientY)
    }
  }

  return (
    <div
      className="tc-canvas__selection-connect-btn"
      ref={btnRef}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        zIndex: 80,
        pointerEvents: 'auto',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'rgba(28, 28, 30, 0.94)',
          border: '1.5px solid rgba(255,255,255,0.18)',
          color: '#f5f5f7',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'crosshair',
          boxShadow: '0 4px 16px rgba(0,0,0,0.32)',
          userSelect: 'none',
        }}
        title="拖动连接并创建新节点"
      >
        <IconPlus size={14} stroke={2.5} />
      </div>
    </div>
  )
})

const ReactFlowProviderWithClass =
  ReactFlowProvider as unknown as React.FC<React.PropsWithChildren<{ className?: string }>>

export default function Canvas({
  className,
  hideDevPerformancePanel,
  onPerformanceApiReady,
}: CanvasInnerProps): JSX.Element {
  const innerClassName = ['tc-canvas-inner', className].filter(Boolean).join(' ')

  return (
    <ReactFlowProviderWithClass className="tc-canvas-provider">
      <CanvasInner
        className={innerClassName}
        hideDevPerformancePanel={hideDevPerformancePanel}
        onPerformanceApiReady={onPerformanceApiReady}
      />
    </ReactFlowProviderWithClass>
  )
}
