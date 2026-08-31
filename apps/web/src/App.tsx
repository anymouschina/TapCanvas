import React from 'react'
import { AppShell, ActionIcon, Group, Box, Button, Badge, Text, Tooltip, UnstyledButton } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCoins, IconChartBar, IconBooks } from '@tabler/icons-react'
import Canvas from './canvas/Canvas'
import GithubGate from './auth/GithubGate'
import { isCanvasNodeDragActive, sanitizeGraphForCanvas, useRFStore } from './canvas/store'
import { isSelectionOnlyNodeDiff } from './canvas/persistence/isSelectionOnlyNodeDiff'
import { persistedGraphContentKey } from './canvas/persistence/persistedGraphContentKey'
import { exportCanvasAsJSON, importCanvasFromFile, filterNodesForPersistence } from './canvas/utils/serialization'
import { createReusableWorkflowGraph, readReusableWorkflowGraph } from './canvas/reusableWorkflowGraph'
import KeyboardShortcuts from './KeyboardShortcuts'
import { applyTemplate, captureCurrentSelection, deleteTemplate, listTemplateNames, saveTemplate, renameTemplate } from './templates'
import { ToastHost, toast } from './ui/toast'
import {
  serializeCreationSessionForPersistence,
  useUIStore,
} from './ui/uiStore'
import {
  listChapterFlows,
  saveProjectFlow,
  saveChapterFlow,
  saveShotFlow,
  runWorkflowExecution,
  listProjects,
  listProjectFlows,
  getServerFlow,
  listShotFlows,
  getMyTeam,
  upsertProject,
  pingActivity,
  API_BASE,
  type FlowDto,
  type FlowSaveReceipt,
  type ProjectDto,
  type TeamDto,
} from './api/server'
import { useAuth } from './auth/store'
import { useIsAdmin } from './auth/isAdmin'
import { getActiveTeamId, setActiveTeamId } from './ui/team/TeamManagementModal'
import { $, $t } from './canvas/i18n'
import SubflowEditor from './subflow/Editor'
import LibraryEditor from './flows/LibraryEditor'
import { listFlows, saveFlow, deleteFlow as deleteLibraryFlow, renameFlow, scanCycles } from './flows/registry'
import FloatingNav from './ui/FloatingNav'
import { ProjectConfigChip } from './ui/projectConfig/ProjectConfigChip'
import BodyPortal from './ui/BodyPortal'
import { CanvasLoadingScreen } from './ui/CanvasLoadingScreen'
import { StatePanel } from './ui/StatePanel'
import AddNodePanel from './ui/AddNodePanel'
import TemplatePanel from './ui/TemplatePanel'
import ProjectPanel from './ui/ProjectPanel'
import AssetManagerDrawer from './ui/AssetManagerDrawer'
import CanvasStyleLibraryPanel from './ui/styleLibrary/CanvasStyleLibraryPanel'
import CanvasCharacterLibraryPanel from './ui/assets/CanvasCharacterLibraryPanel'
import TapshowPanel from './ui/TapshowPanel'
import PendingUploadsBar from './ui/PendingUploadsBar'
import ModelPanel from './ui/ModelPanel'
import HistoryPanel from './ui/HistoryPanel'
import GenerationHistoryPanel from './ui/GenerationHistoryPanel'
import TaskInboxPanel from './ui/TaskInboxPanel'
import FeishuPanel from './ui/FeishuPanel'
import ExecutionPanel from './ui/ExecutionPanel'
import ParamModal from './ui/ParamModal'
import PreviewModal from './ui/PreviewModal'
import { PublishModal } from './ui/PublishModal'
import { LoginModal } from './auth/LoginModal'
import TapshowDetailPage from './ui/TapshowDetailPage'
import TapshowAuthorPage from './ui/TapshowAuthorPage'
import ShareFullPage from './ui/ShareFullPage'
import StatsFullPage from './ui/stats/StatsFullPage'
import McpDocPage from './ui/docs/McpDocPage'
import AiChatDialog from './ui/chat/AiChatDialog'
import { PendingSkillLaunchConsumer } from './ui/chat/PendingSkillLaunchConsumer'
import { runNodeRemote } from './runner/remoteRunner'
import { Background } from '@xyflow/react'
import { FeatureTour, type FeatureTourStep } from './ui/tour/FeatureTour'
import { ExecutionLogModal } from './ui/ExecutionLogModal'
import { WorkflowExecutionSnapshotHost } from './ui/WorkflowExecutionSnapshotHost'
import ProjectChapterRouteRedirectPage from './projects/ProjectChapterRouteRedirectPage'
import ChapterCanvasFullPage from './projects/ChapterCanvasFullPage'
import ProjectEntryRedirectPage from './projects/ProjectEntryRedirectPage'
import AgentAdminWorkbenchPanel from './ui/AgentAdminWorkbenchPanel'
import { useAgentCanvasDeepLink } from './ui/agent-task-execution/useAgentCanvasDeepLink'
import { IntentProgressToast } from './ui/IntentProgressToast'
import { StudioProjectNameEditor } from './ui/StudioProjectNameEditor'
import { PortalAccountMenu } from './portal/PortalAccountMenu'
import { compileAgentWorkflow } from './canvas/agentWorkflowExecution'
import { compileVideoWorkflow } from './canvas/videoWorkflowExecution'
import { AGENT_WORKFLOW_KEY } from '@tapcanvas/workflow-kernel-protocol'
import { VIDEO_PRODUCTION_WORKFLOW_KEY } from '@tapcanvas/video-orchestrator-protocol'
import {
  applyWorkflowNodeRuns,
  loadLatestWorkflowExecutionProjection,
  loadWorkflowExecutionProjection,
  waitForWorkflowExecutionProjectionMatch,
  watchWorkflowExecution,
  ensureWorkflowExecutionPlaceholderNode,
} from './canvas/workflowExecutionProjection'
import {
  buildWorkflowAgentVisibleGraph,
} from './canvas/workflowAgentReferenceProjection'
import {
  WORKFLOW_EXECUTION_REQUEST_EVENT,
  WORKFLOW_EXECUTION_SYNC_REQUEST_EVENT,
  type WorkflowExecutionRequestDetail,
} from './canvas/workflowExecutionRequest'
import {
  withoutWorkflowExecutionProjectionEdges,
  withoutWorkflowExecutionProjectionNodes,
  workflowExecutionProjectionGuard,
} from './canvas/workflowExecutionProjectionData'
import { hasPendingUploads } from './ui/pendingUploadGuard'
import { buildStudioUrl, isDocsMcpRoute, isGithubOauthCallbackRoute, isStudioRoute, type StudioOwnerType } from './utils/appRoutes'
import { navigateBackOr, spaNavigate, spaReplace } from './utils/spaNavigate'
import {
  EMPTY_STUDIO_ROUTE_SCOPE,
  parseStudioRouteScope,
  selectStudioProject,
  type StudioRouteScope,
} from './utils/studioRouteScope'
import { TapCanvasMark } from './ui/brand/TapCanvasMark'
import { preloadModelOptions } from './config/useModelOptions'
import { useCanvasSync, type SyncPatch } from './canvas/sync/useCanvasSync'
import { derivedApplyGuard, remoteApplyGuard } from './canvas/sync/remoteApplyGuard'
import { hasCreationSessionProgressChanged } from './canvas/persistence/creationSessionPersistence'
import { applyCanvasGraphPatch } from './canvas/sync/applyCanvasGraphPatch'
import { useYjsCanvasSync } from './canvas/sync/yjs/useYjsCanvasSync'
import { getYjsMode } from './canvas/sync/yjs/yjsFlags'
import { saveWithConflictRebase } from './canvas/persistence/saveWithConflictRebase'
import { CanvasEmptyOverlay } from './canvas/components/CanvasEmptyOverlay'
import { StoryboardOnboardingWizard } from './canvas/components/StoryboardOnboardingWizard'
import { VideoRunIndicator } from './canvas/components/VideoRunIndicator'
import { useReferralCampaign } from './promo/useReferralCampaign'
import ReferralInfoModal from './promo/ReferralInfoModal'
import CanvasPerformanceHarness from './canvas/performance/CanvasPerformanceHarness'
import DirectorPetLauncher from './ui/DirectorPetLauncher'
import { CanvasShareTransferMenu } from './ui/CanvasShareTransferMenu'

const WorkflowDevelopmentHarnessLazy = import.meta.env.DEV
  ? React.lazy(() => import('./canvas/development/WorkflowDevelopmentHarness'))
  : null

const FEATURE_TOUR_VERSION = 'v2'

type CanvasGraphNode = ReturnType<typeof useRFStore.getState>['nodes'][number]
type CanvasGraphEdge = ReturnType<typeof useRFStore.getState>['edges'][number]

function buildNodeLabelById(nodes: readonly CanvasGraphNode[]): Record<string, string> {
  const next: Record<string, string> = {}
  for (const node of nodes) {
    const data = typeof node.data === 'object' && node.data !== null
      ? node.data as Record<string, unknown>
      : null
    const label =
      (typeof data?.label === 'string' && data.label.trim()) ||
      (typeof data?.name === 'string' && data.name.trim()) ||
      (typeof node.type === 'string' && node.type) ||
      ''
    if (node.id && label) {
      next[node.id] = label
    }
  }
  return next
}

function areNodeLabelMapsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

function didNodeLabelsChange(
  prevNodes: readonly CanvasGraphNode[],
  nextNodes: readonly CanvasGraphNode[],
): boolean {
  if (prevNodes.length !== nextNodes.length) return true

  for (let index = 0; index < nextNodes.length; index += 1) {
    const prevNode = prevNodes[index]
    const nextNode = nextNodes[index]
    if (prevNode === nextNode) continue
    if (prevNode?.id !== nextNode?.id) return true

    const prevData = typeof prevNode?.data === 'object' && prevNode.data !== null
      ? prevNode.data as Record<string, unknown>
      : null
    const nextData = typeof nextNode?.data === 'object' && nextNode.data !== null
      ? nextNode.data as Record<string, unknown>
      : null

    const prevLabel = typeof prevData?.label === 'string' ? prevData.label.trim() : ''
    const nextLabel = typeof nextData?.label === 'string' ? nextData.label.trim() : ''
    if (prevLabel !== nextLabel) return true

    const prevName = typeof prevData?.name === 'string' ? prevData.name.trim() : ''
    const nextName = typeof nextData?.name === 'string' ? nextData.name.trim() : ''
    if (prevName !== nextName) return true

    if ((prevNode?.type || '') !== (nextNode?.type || '')) return true
  }

  return false
}

function isEmptyGraphSnapshot(payload: { nodes: readonly unknown[]; edges: readonly unknown[] }): boolean {
  return payload.nodes.length === 0 && payload.edges.length === 0
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return fallback
}

function resolveCanvasLoadErrorMessage(error: unknown): string {
  const errorRecord = error && typeof error === 'object'
    ? error as { code?: unknown }
    : null
  if (errorRecord?.code === 'flow_scope_metadata_missing') {
    return '检测到项目内画布的归属数据缺失，已停止自动创建空画布。请先修复归属数据后重新加载。'
  }
  return resolveErrorMessage(error, '网络或服务器错误')
}

type StudioOwnerContext = {
  ownerType: StudioOwnerType
  ownerId: string
}

function hasFlowCanvasContent(flow: FlowDto | null | undefined): boolean {
  if (!flow || !flow.data) return false
  return (Array.isArray(flow.data.nodes) && flow.data.nodes.length > 0)
    || (Array.isArray(flow.data.edges) && flow.data.edges.length > 0)
}

function sortFlowsByPriority(flows: FlowDto[]): FlowDto[] {
  return [...flows].sort((left, right) => {
    const leftHasContent = hasFlowCanvasContent(left) ? 1 : 0
    const rightHasContent = hasFlowCanvasContent(right) ? 1 : 0
    if (leftHasContent !== rightHasContent) return rightHasContent - leftHasContent
    const leftTs = Date.parse(String(left.updatedAt || left.createdAt || ''))
    const rightTs = Date.parse(String(right.updatedAt || right.createdAt || ''))
    return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0)
  })
}

// 【画布多 tab 版本号防覆盖·2026-07-15】当前打开画布（flows 表·入口 A）的 canvas_revision。
// 用 window 全局做单一真相源：App.tsx 的加载/保存点在此写读，深层 Canvas.tsx 的出片存盘点也读同一个值，
// 无需跨组件 prop 透传或改动 uiStore（提交只动 App.tsx / Canvas.tsx 两文件）。仅同 tab 内存态，不持久化。
const FLOW_REVISION_GLOBAL_KEY = '__TAPCANVAS_FLOW_REVISION__'
function getLocalFlowRevision(): number {
  if (typeof window === 'undefined') return 0
  const v = (window as unknown as Record<string, unknown>)[FLOW_REVISION_GLOBAL_KEY]
  return typeof v === 'number' ? v : 0
}
function setLocalFlowRevision(n: number | null | undefined): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, unknown>)[FLOW_REVISION_GLOBAL_KEY] = typeof n === 'number' ? n : 0
}

function CanvasApp({
  routeKey,
  studioRouteScope,
}: {
  routeKey?: string
  studioRouteScope: StudioRouteScope
}): JSX.Element {
  const addNode = useRFStore((s) => s.addNode)
  const subflowNodeId = useUIStore(s => s.subflowNodeId)
  const closeSubflow = useUIStore(s => s.closeSubflow)
  const libraryFlowId = useUIStore(s => s.libraryFlowId)
  const closeLibraryFlow = useUIStore(s => s.closeLibraryFlow)
  const [refresh, setRefresh] = React.useState(0)
  const [featureTourOpen, setFeatureTourOpen] = React.useState(false)
  const [execLogOpen, setExecLogOpen] = React.useState(false)
  const [publishModalOpen, setPublishModalOpen] = React.useState(false)
  const [canvasLoginModalOpen, setCanvasLoginModalOpen] = React.useState(false)
  const [execId, setExecId] = React.useState<string | null>(null)
  const pinnedWorkflowExecutionId = useRFStore(s => s.nodes.flatMap((node) => {
    const data = node.data && typeof node.data === 'object' && !Array.isArray(node.data)
      ? node.data as Record<string, unknown>
      : null
    if (data?.managedProjection !== 'workflow_execution') return []
    const executionId = typeof data.workflowExecutionId === 'string'
      ? data.workflowExecutionId.trim()
      : ''
    return executionId ? [executionId] : []
  })[0] ?? '')
  const [execStarting, setExecStarting] = React.useState(false)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const currentFlow = useUIStore(s => s.currentFlow)
  // 上次由服务端确认的完整快照。409 时只把此基线之后的真实本地变化重放到最新服务端图，
  // 避免多标签或 agent 并发写入时覆盖对方，也不会把服务端已删除的旧节点复活。
  const acknowledgedFlowRef = React.useRef<FlowDto['data']>({ nodes: [], edges: [] })
  const isDirty = useUIStore(s => s.isDirty)
  const currentProject = useUIStore(s => s.currentProject)
  const setCurrentProject = useUIStore(s => s.setCurrentProject)
  const [projects, setProjects] = React.useState<ProjectDto[]>([])
  const setDirty = useUIStore(s => s.setDirty)
  const setCurrentFlow = useUIStore(s => s.setCurrentFlow)
  const restoreCreationSession = useUIStore(s => s.restoreCreationSession)
  const creationSession = useUIStore(s => s.creationSession)
  const auth = useAuth()
  const isAdmin = useIsAdmin()
  const isProjectOwner = Boolean(currentProject?.owner && auth.user?.login && currentProject.owner === auth.user.login)
  const [saving, setSaving] = React.useState(false)
  // 每一次非视图型画布变更都递增。保存完成时只有快照仍是最新版本，
  // 才能清除脏标记；这避免保存请求期间的后续编辑被误判为已持久化。
  const canvasMutationRevisionRef = React.useRef(0)
  const loadProjectRequestSeq = React.useRef(0)
  // CanvasApp survives query-only SPA navigation, while its graph lives in a
  // process-wide store. This epoch invalidates every async writer from the
  // previous route before the next route is allowed to paint or mutate state.
  const canvasSessionEpochRef = React.useRef(0)
  const canvasAppMountedRef = React.useRef(false)
  const skipNextProjectFlowLoadRef = React.useRef<string | null>(null)
  const isHydratingProjectFlowRef = React.useRef(false)
  const lastSilentSaveErrorRef = React.useRef('')
  const restoredWorkflowProjectionFlowIdRef = React.useRef('')
  const [projectSelectionReady, setProjectSelectionReady] = React.useState(false)
  const [projectSelectionError, setProjectSelectionError] = React.useState<string | null>(null)
  const routeProjectId = studioRouteScope.projectId
  const studioOwnerContext = React.useMemo<StudioOwnerContext | null>(() => (
    studioRouteScope.ownerType && studioRouteScope.ownerId
      ? { ownerType: studioRouteScope.ownerType, ownerId: studioRouteScope.ownerId }
      : null
  ), [studioRouteScope.ownerId, studioRouteScope.ownerType])
  const studioFlowId = studioRouteScope.flowId || ''
  const [headerTeam, setHeaderTeam] = React.useState<TeamDto | null>(null)
  const [headerPointsLoading, setHeaderPointsLoading] = React.useState(false)
  const [annotationModeActive, setAnnotationModeActive] = React.useState(false)
  const [headerAdminWorkbenchOpen, setHeaderAdminWorkbenchOpen] = React.useState(false)
  const [referralModalOpen, setReferralModalOpen] = React.useState(false)
  const { data: referralCampaign } = useReferralCampaign()
  const [hasCanvasNodes, setHasCanvasNodes] = React.useState(() => useRFStore.getState().nodes.length > 0)
  const [storyboardWizardOpen, setStoryboardWizardOpen] = React.useState(false)
  const [nodeLabelById, setNodeLabelById] = React.useState<Record<string, string>>(() => buildNodeLabelById(useRFStore.getState().nodes))

  useAgentCanvasDeepLink({
    projectId: currentProject?.id ?? routeProjectId,
    flowId: currentFlow.id ?? studioFlowId,
    routeKey: routeKey ?? '',
    onOpenExecutionWorkbench: () => setHeaderAdminWorkbenchOpen(true),
  })

  // A project/owner/flow change can reuse this component instance. Clear the
  // active graph in a layout effect so the old resource is gone before the
  // browser paints the new route; the passive loader below then hydrates only
  // the requested resource.
  React.useLayoutEffect(() => {
    canvasAppMountedRef.current = true
    canvasSessionEpochRef.current += 1
    loadProjectRequestSeq.current += 1
    isHydratingProjectFlowRef.current = true
    useRFStore.getState().reset()
    useUIStore.setState({
      currentFlow: { id: null, name: '未命名', source: 'local', ownerType: null, ownerId: null },
      restoreViewport: null,
      canvasViewport: null,
      creationSession: null,
      isDirty: false,
    })
    setHasCanvasNodes(false)
    setNodeLabelById({})
    canvasMutationRevisionRef.current = 0
    restoredWorkflowProjectionFlowIdRef.current = ''
    lastSilentSaveErrorRef.current = ''
    acknowledgedFlowRef.current = { nodes: [], edges: [] }
    setLocalFlowRevision(0)
    isHydratingProjectFlowRef.current = false
    setCurrentProject(null)
    setProjectSelectionReady(false)
    setProjectSelectionError(null)
  }, [routeKey, setCurrentProject])

  // 项目画布实时协同：只在 project 类型、server 来源时启用
  const syncOwnerId = currentFlow.ownerType === 'project' && currentFlow.source === 'server'
    ? (currentFlow.ownerId ?? null)
    : null
  // Yjs 灰度：VITE_CANVAS_YJS=local|ws 时切到 Yjs 通道（房间=flowId），并停用旧 SSE；默认 off 时维持 SSE。
  const yjsMode = getYjsMode()
  const yjsFlowId = String(currentFlow.id || studioFlowId || '').trim()
  const handleProjectRemoteCanvasPatch = React.useCallback((patch: SyncPatch) => {
    const currentNodeById = new Map(
      acknowledgedFlowRef.current.nodes.map((node) => [node.id, node]),
    )
    const currentEdgeById = new Map(
      acknowledgedFlowRef.current.edges.map((edge) => [edge.id, edge]),
    )
    acknowledgedFlowRef.current = {
      ...acknowledgedFlowRef.current,
      ...applyCanvasGraphPatch({
        nodes: acknowledgedFlowRef.current.nodes,
        edges: acknowledgedFlowRef.current.edges,
        patch: {
          upsertNodes: patch.upsertNodes?.map((node) => ({
            ...currentNodeById.get(node.id),
            ...node,
          } as CanvasGraphNode)),
          removeNodeIds: patch.removeNodeIds,
          upsertEdges: patch.upsertEdges?.map((edge) => ({
            ...currentEdgeById.get(edge.id),
            ...edge,
          } as CanvasGraphEdge)),
          removeEdgeIds: patch.removeEdgeIds,
        },
      }),
    }
    if (typeof patch.revision === 'number' && patch.revision > getLocalFlowRevision()) {
      setLocalFlowRevision(patch.revision)
    }
  }, [])
  useCanvasSync(syncOwnerId ?? '', Boolean(syncOwnerId) && yjsMode === 'off', '/projects', {
    onRemoteCanvasPatch: handleProjectRemoteCanvasPatch,
  })
  useYjsCanvasSync(yjsFlowId, yjsMode !== 'off' && Boolean(yjsFlowId))


  const detachCurrentFlowFromProject = React.useCallback(() => {
    const uiState = useUIStore.getState()
    const nextFlowName = String(uiState.currentFlow.name || uiState.currentProject?.name || '未命名').trim() || '未命名'
    if (!uiState.currentFlow.id && uiState.currentFlow.source === 'local' && uiState.currentFlow.name === nextFlowName) {
      return
    }
    setCurrentFlow({ id: null, name: nextFlowName, source: 'local', ownerType: null, ownerId: null })
  }, [setCurrentFlow])

  const notifySilentSaveError = React.useCallback((error: unknown) => {
    const typedError = error as { message?: unknown; code?: unknown; status?: unknown }
    const code = typeof typedError?.code === 'string' ? typedError.code.trim() : ''
    const status = typeof typedError?.status === 'number' ? typedError.status : Number(typedError?.status)
    const message =
      code === 'project_not_found' || status === 404
        ? '当前项目已不存在，自动保存失败。请重新选择项目或新建项目。'
        : typeof typedError?.message === 'string' && typedError.message.trim()
          ? typedError.message.trim()
          : '自动保存失败'
    if (lastSilentSaveErrorRef.current === message) return
    lastSilentSaveErrorRef.current = message
    toast(message, 'error')
  }, [])

  React.useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      const state = useUIStore.getState()
      if (state.isDirty || hasPendingUploads()) {
        e.preventDefault(); e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  React.useEffect(() => {
    if (!auth.user) return
    void pingActivity()
    void Promise.all([
      preloadModelOptions('text'),
      preloadModelOptions('image'),
      preloadModelOptions('imageEdit'),
    ]).catch((error: unknown) => {
      console.warn('[App] preload model options failed', error)
    })
  }, [auth.user?.sub])

  // URL is the sole project-selection authority. An explicit missing project
  // is an error; an unbound Studio route stays unbound until the user saves.
  React.useEffect(() => {
    setProjectSelectionReady(false)
    setProjectSelectionError(null)
    // 根据当前登录用户加载其项目；退出登录时清空项目和画布
    if (!auth.user) {
      setProjects([])
      setCurrentProject(null)
      acknowledgedFlowRef.current = { nodes: [], edges: [] }
      setLocalFlowRevision(0)
      useRFStore.getState().reset()
      restoreCreationSession(null)
        setCurrentFlow({ id: null, name: '未命名', source: 'local', ownerType: null, ownerId: null })
      setDirty(false)
      setProjectSelectionReady(true)
      return
    }
    let cancelled = false
    const loadProjects = async () => {
      try {
        const normalizedProjects = await listProjects()
        if (cancelled) return
        setProjects(normalizedProjects)
        const selection = selectStudioProject(normalizedProjects, routeProjectId)

        if (selection.kind === 'selected') {
          const fromUrl = selection.project
          setCurrentProject({
            id: fromUrl.id,
            name: fromUrl.name,
            owner: fromUrl.owner ?? null,
            ownerName: fromUrl.ownerName ?? null,
            isPublic: fromUrl.isPublic ?? null,
            teamId: fromUrl.teamId ?? null,
            projectKind: fromUrl.projectKind,
          })
          // C 方案：进项目即把 X-Team-Id 对齐到项目归属（个人项目→personal、团队项目→该团队），
          // 让扣费(resolveBillingTeamId)/积分展示/可见性三者同源于项目，杜绝"显示个人却扣测试团队"。
          setActiveTeamId(fromUrl.teamId ?? 'personal', fromUrl.teamId ? undefined : '个人账户')
          return
        }

        setCurrentProject(null)
        detachCurrentFlowFromProject()
        if (selection.kind === 'missing') {
          setProjectSelectionError(`地址指定的项目 ${selection.projectId} 当前不存在或你无权访问。系统没有切换到其他项目。`)
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setCurrentProject(null)
          detachCurrentFlowFromProject()
          setProjectSelectionError(resolveErrorMessage(error, '项目列表加载失败'))
          notifications.show({
            title: '项目初始化失败',
            message: resolveErrorMessage(error, '网络或服务器错误'),
            color: 'red',
          })
        }
      } finally {
        if (!cancelled) {
          setProjectSelectionReady(true)
        }
      }
    }
    void loadProjects()
    return () => {
      cancelled = true
    }
  }, [auth.user?.sub, detachCurrentFlowFromProject, routeKey, routeProjectId, setCurrentProject, setCurrentFlow, setDirty])

  const refreshHeaderCredits = React.useCallback(async () => {
    const user = auth.user
    if (!user || user.guest) {
      setHeaderTeam(null)
      setHeaderPointsLoading(false)
      return
    }
    setHeaderPointsLoading(true)
    try {
      const membership = await getMyTeam()
      setHeaderTeam(membership?.team || null)
    } catch {
      setHeaderTeam(null)
    } finally {
      setHeaderPointsLoading(false)
    }
  }, [auth.user])

  // 切换团队时刷新积分显示
  React.useEffect(() => {
    const handler = () => { void refreshHeaderCredits() }
    window.addEventListener('tapcanvas:team-changed', handler)
    return () => window.removeEventListener('tapcanvas:team-changed', handler)
  }, [refreshHeaderCredits])

  // 标注模式：隐藏 header 操作区，避免与标注工具栏重叠
  React.useEffect(() => {
    const handler = (e: Event) => {
      setAnnotationModeActive((e as CustomEvent<{ active: boolean }>).detail.active)
    }
    window.addEventListener('tapcanvas:annotation-mode', handler)
    return () => window.removeEventListener('tapcanvas:annotation-mode', handler)
  }, [])

  React.useEffect(() => {
    void refreshHeaderCredits()
  }, [refreshHeaderCredits])

  const autoResumePendingTasks = React.useCallback(() => {
    try {
      const state = useRFStore.getState()
      const nodes = (state.nodes || []) as any[]
      if (!nodes.length) return
      const globalAny = window as any
      if (!globalAny.__tcAutoResumedTaskNodes) {
        globalAny.__tcAutoResumedTaskNodes = new Set<string>()
      }
      const resumed: Set<string> = globalAny.__tcAutoResumedTaskNodes

      nodes.forEach((n) => {
        const data: any = n.data || {}
        const status = (data.status as string | undefined) || ''
        const isPendingStatus = status === 'running' || status === 'queued'
        if (!isPendingStatus) return

        const videoTaskId = typeof data.videoTaskId === 'string' ? data.videoTaskId.trim() : ''
        const imageTaskId = typeof data.imageTaskId === 'string' ? data.imageTaskId.trim() : ''
        // 已有 taskId：交给 Canvas 的 tick（syncGenericVideoNodeOnce / syncImageNodeOnce）续接，不重新提交
        if (videoTaskId || imageTaskId) return
        // 无 taskId 但仍处于 running/queued（刷新前正在初始化请求）：重新触发任务
        if (resumed.has(n.id)) return
        resumed.add(n.id)
        void runNodeRemote(n.id, useRFStore.getState, useRFStore.setState)
      })
    } catch {
      // ignore auto-resume errors
    }
  }, [])

  // 离开画布页时清空（浏览器前进/后退等 spaNavigate 未覆盖的路径的兜底）
  React.useLayoutEffect(() => {
    canvasAppMountedRef.current = true
    return () => {
      canvasAppMountedRef.current = false
      canvasSessionEpochRef.current += 1
      loadProjectRequestSeq.current += 1
      isHydratingProjectFlowRef.current = true
      useRFStore.getState().reset()
      useUIStore.setState({
        currentFlow: { id: null, name: '未命名', source: 'local', ownerType: null, ownerId: null },
        currentProject: null,
        currentChapter: null,
        currentChapterCreativeOverride: null,
        restoreViewport: null,
        canvasViewport: null,
        creationSession: null,
        isDirty: false,
      })
      canvasMutationRevisionRef.current = 0
      restoredWorkflowProjectionFlowIdRef.current = ''
      lastSilentSaveErrorRef.current = ''
      acknowledgedFlowRef.current = { nodes: [], edges: [] }
      setLocalFlowRevision(0)
    }
  }, [])

  const loadLatestProjectFlow = React.useCallback(
    async (
      projectId: string,
      projectName?: string,
      options?: Readonly<{ resumePendingTasks?: boolean }>,
    ) => {
      const seq = ++loadProjectRequestSeq.current
      isHydratingProjectFlowRef.current = true

      // 先清空画布，避免异步加载期间把上个项目的图误保存到当前项目
      // 归属置空：加载窗口内任何自动保存都会被 silentSave 守卫挡下，直到下方落定本 flow 归属
      useRFStore.getState().reset()
      useUIStore.getState().setRestoreViewport(null)
      restoreCreationSession(null)
      setCurrentFlow({
        id: null,
        name: projectName || '未命名',
        source: 'server',
        ownerType: studioOwnerContext?.ownerType || 'project',
        ownerId: studioOwnerContext?.ownerId || projectId,
      })
      setDirty(false)
      // 切换项目/画布：清空上一个画布的 revision，避免旧值当作新画布的 expectedRevision 误挡。
      acknowledgedFlowRef.current = { nodes: [], edges: [] }
      setLocalFlowRevision(0)

      try {
        const list = studioOwnerContext?.ownerType === 'chapter'
          ? await listChapterFlows(projectId, studioOwnerContext.ownerId)
          : studioOwnerContext?.ownerType === 'shot'
            ? await listShotFlows(projectId, studioOwnerContext.ownerId)
            : await listProjectFlows(projectId)
        const activeProjectId = String(useUIStore.getState().currentProject?.id || '')
        if (loadProjectRequestSeq.current !== seq) return
        if (!activeProjectId || activeProjectId !== String(projectId)) return

        const prioritizedFlows = sortFlowsByPriority(list)
        const preferredFlow = studioFlowId
          ? prioritizedFlows.find((item) => item.id === studioFlowId) || null
          : null
        if (studioFlowId && !preferredFlow) {
          throw new Error(`指定画布 ${studioFlowId} 不在当前项目或归属范围内，已停止自动选择其他画布。`)
        }
        const f = preferredFlow || prioritizedFlows[0] || null

        if (f) {
          // 记录后端 canvas_revision 为本地 localRevision，后续用户保存据此带 expectedRevision 做乐观锁。
          setLocalFlowRevision(f.canvasRevision ?? 0)
          const data = f.data || { nodes: [], edges: [] }
          const viewport = data?.viewport
          const sanitized = sanitizeGraphForCanvas({
            nodes: Array.isArray(data.nodes) ? data.nodes : [],
            edges: Array.isArray(data.edges) ? data.edges : [],
          })
          const nextNodes = sanitized.nodes
          const nextEdges = sanitized.edges
          acknowledgedFlowRef.current = {
            nodes: nextNodes,
            edges: nextEdges,
            viewport: viewport && typeof viewport.zoom === 'number' ? viewport : null,
            sceneCreationProgress: data?.sceneCreationProgress,
          }
          const nextGroupId =
            nextNodes.reduce((max, node) => {
              if (!node || node.type !== 'groupNode') return max
              const match = /^g(\d+)$/.exec(String(node.id || ''))
              if (!match) return max
              const value = Number.parseInt(match[1], 10)
              return Number.isFinite(value) ? Math.max(max, value) : max
            }, 0) + 1

          workflowExecutionProjectionGuard.run(() => {
            const visibleGraph = buildWorkflowAgentVisibleGraph({
              nodes: nextNodes,
              edges: nextEdges,
              workflowExecutionId: 'workflow-configuration',
              outputRefsByAgentNodeId: new Map<string, unknown>(),
              readOnly: false,
            })
            useRFStore.setState({
              nodes: visibleGraph.nodes,
              edges: visibleGraph.edges,
              // `nextId` 用于生成新节点ID与默认排布；需要随加载数据同步，避免ID冲突导致节点“被覆盖/消失”
              nextId: nextNodes.length + 1,
              nextGroupId,
              // 标记画布归属为本 flow，供 silentSave 校验，防止上一资源（章节/别的 flow）
              // 的陈旧内容被整图自动保存固化进当前 flow。
              graphProvenanceKey: `flow:${f.id}`,
            })
          })
          useUIStore.getState().setRestoreViewport(viewport && typeof viewport.zoom === 'number' ? viewport : null)
          restoreCreationSession(data?.sceneCreationProgress)
          setCurrentFlow({
            id: f.id,
            name: f.name,
            source: 'server',
            ownerType: f.ownerType || studioOwnerContext?.ownerType || 'project',
            ownerId: f.ownerId || studioOwnerContext?.ownerId || projectId,
          })
          setDirty(false)
        } else {
          const emptyFlowName = String(projectName || '未命名').trim() || '未命名'
          const created = studioOwnerContext?.ownerType === 'chapter'
            ? await saveChapterFlow({
              projectId,
              chapterId: studioOwnerContext.ownerId,
              name: emptyFlowName,
              nodes: [],
              edges: [],
              expectedRevision: getLocalFlowRevision(),
            })
            : studioOwnerContext?.ownerType === 'shot'
              ? await saveShotFlow({
                projectId,
                shotId: studioOwnerContext.ownerId,
                name: emptyFlowName,
                nodes: [],
                edges: [],
                expectedRevision: getLocalFlowRevision(),
              })
              : await saveProjectFlow({
                projectId,
                name: emptyFlowName,
                nodes: [],
                edges: [],
                expectedRevision: getLocalFlowRevision(),
              })
          // 新建空画布：记录后端返回的初始 revision（通常 0）。
          setLocalFlowRevision(created.canvasRevision ?? 0)
          acknowledgedFlowRef.current = { nodes: [], edges: [] }
          const latestProjectId = String(useUIStore.getState().currentProject?.id || '')
          if (loadProjectRequestSeq.current !== seq) return
          if (!latestProjectId || latestProjectId !== String(projectId)) return

          useRFStore.setState({ nodes: [], edges: [], nextId: 1, nextGroupId: 1, graphProvenanceKey: `flow:${created.id}` })
          useUIStore.getState().setRestoreViewport(null)
          restoreCreationSession(null)
          setCurrentFlow({
            id: created.id,
            name: created.name,
            source: 'server',
            ownerType: created.ownerType || studioOwnerContext?.ownerType || 'project',
            ownerId: created.ownerId || studioOwnerContext?.ownerId || projectId,
          })
          setDirty(false)
        }

        notifications.hide(`canvas-load:${projectId}`)
        // 项目流加载完成后，自动恢复未完成的远程任务（queued/running）
        if (options?.resumePendingTasks !== false) autoResumePendingTasks()
      } catch (error: unknown) {
        // 保持清空状态以避免跨项目污染；失败必须显式呈现，且不得把失败当成“无 flow”自动创建。
        if (loadProjectRequestSeq.current === seq) {
          notifications.show({
            id: `canvas-load:${projectId}`,
            title: '画布加载失败',
            message: resolveCanvasLoadErrorMessage(error),
            color: 'red',
            autoClose: false,
            withCloseButton: true,
          })
        }
      } finally {
        if (loadProjectRequestSeq.current === seq) {
          isHydratingProjectFlowRef.current = false
        }
      }
    },
    [autoResumePendingTasks, restoreCreationSession, setCurrentFlow, setDirty, studioFlowId, studioOwnerContext],
  )

  // 页面 onload + 项目切换时都拉取当前项目最新工作流
  React.useEffect(() => {
    if (!auth.user) return
    const pid = currentProject?.id
    if (!pid) return
    if (skipNextProjectFlowLoadRef.current && skipNextProjectFlowLoadRef.current === pid) {
      skipNextProjectFlowLoadRef.current = null
      return
    }
    void loadLatestProjectFlow(pid, currentProject?.name)
  }, [auth.user?.sub, currentProject?.id, loadLatestProjectFlow, routeKey])

  React.useEffect(() => {
    return useRFStore.subscribe((state, prevState) => {
      if (state.nodes === prevState.nodes && state.edges === prevState.edges) return
      // Node count is a view fact, not persisted-content dirtiness. Runtime projections can be the
      // first node on an empty canvas, so update this before the persisted graph equality fast path.
      const nextHasCanvasNodes = state.nodes.length > 0
      setHasCanvasNodes((prev) => (prev === nextHasCanvasNodes ? prev : nextHasCanvasNodes))
      // 选中态不入库也不影响节点数/标题，但它会换掉节点引用。若不提前返回，点一下节点就把
      // 项目标记为「未保存」（并触发下游存盘链路），纯视图操作不应产生脏标记。
      if (state.edges === prevState.edges && isSelectionOnlyNodeDiff(prevState.nodes, state.nodes)) return

      // 引用变化但持久化内容未变（运行时投影刷新/SSE 重放等）不应标脏：
      // 否则会形成「投影刷新 → 标脏 → 整图保存 → 再投影」的版本风暴，
      // 单个 flow 可积累数万条内容相同的版本，并让能力装配等版本敏感操作失效。
      // 拖动期间位置是真实内容变化，保留既有标脏语义，避免在热路径上做全量签名。
      if (!isCanvasNodeDragActive() &&
          persistedGraphContentKey(prevState.nodes, prevState.edges) ===
            persistedGraphContentKey(state.nodes, state.edges)) {
        return
      }

      // Position-only drag frames cannot change labels. Drag stop clears the
      // lifecycle flag and performs one final comparison.
      if (!isCanvasNodeDragActive() && didNodeLabelsChange(prevState.nodes, state.nodes)) {
        const nextNodeLabelById = buildNodeLabelById(state.nodes)
        setNodeLabelById((prev) => (areNodeLabelMapsEqual(prev, nextNodeLabelById) ? prev : nextNodeLabelById))
      }

      if (
        !isHydratingProjectFlowRef.current
        && !workflowExecutionProjectionGuard.active
        && !derivedApplyGuard.active
      ) {
        canvasMutationRevisionRef.current += 1
        if (!useUIStore.getState().isDirty) {
          useUIStore.getState().setDirty(true)
        }
      }
    })
  }, [])

  const syncLatestWorkflowExecutionProjection = React.useCallback(async (): Promise<void> => {
    const flowId = String(currentFlow.id || '').trim()
    if (currentFlow.source !== 'server' || !flowId) return
    const projectionRequestKey = `${flowId}:${pinnedWorkflowExecutionId || 'latest'}`
    if (restoredWorkflowProjectionFlowIdRef.current === projectionRequestKey) return

    // 占位节点不受模板节点匹配限制：小T 触发的一键成片等执行即使画布没有
    // workflowStage/workflowTrigger 模板节点，也要回显单个执行占位（转圈/绿/红）。
    // 内容项目恢复最新执行；工作流定义项目只恢复仍在推进的执行。
    restoredWorkflowProjectionFlowIdRef.current = projectionRequestKey
    try {
      const projection = pinnedWorkflowExecutionId
        ? await loadWorkflowExecutionProjection(pinnedWorkflowExecutionId)
        : await loadLatestWorkflowExecutionProjection(flowId, {
          // 工作流项目打开的是可重复执行的定义，不是上一次运行的结果页。
          // 只恢复仍在推进的真实执行；已结束执行保留在历史面板，不再把
          // authoring canvas 染成永久完成态。普通内容项目维持既有回显语义。
          activeOnly: currentProject?.projectKind === 'ai_workflow',
        })
      if (!projection || String(useUIStore.getState().currentFlow.id || '').trim() !== flowId) return
      ensureWorkflowExecutionPlaceholderNode(projection.executionId, projection.runs)
      const hasAdminWorkflow = useRFStore.getState().nodes.some((node) => {
        const data = node.data && typeof node.data === 'object' && !Array.isArray(node.data)
          ? node.data as Record<string, unknown>
          : {}
        return data.adminWorkflow === true
          && (data.kind === 'workflowTrigger' || data.kind === 'workflowStage')
      })
      if (!hasAdminWorkflow) return
      const matches = await waitForWorkflowExecutionProjectionMatch(projection.runs)
      if (!matches || String(useUIStore.getState().currentFlow.id || '').trim() !== flowId) return
      isHydratingProjectFlowRef.current = true
      try {
        applyWorkflowNodeRuns(projection.executionId, projection.runs)
      } finally {
        isHydratingProjectFlowRef.current = false
      }
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '无法同步工作流执行状态', 'error')
    } finally {
      if (restoredWorkflowProjectionFlowIdRef.current === projectionRequestKey) {
        restoredWorkflowProjectionFlowIdRef.current = ''
      }
    }
  }, [currentFlow.id, currentFlow.source, currentProject?.projectKind, pinnedWorkflowExecutionId])

  React.useEffect(() => {
    void syncLatestWorkflowExecutionProjection()
    const handleFocus = (): void => {
      void syncLatestWorkflowExecutionProjection()
    }
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void syncLatestWorkflowExecutionProjection()
    }
    window.addEventListener('focus', handleFocus)
    window.addEventListener(WORKFLOW_EXECUTION_SYNC_REQUEST_EVENT, handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener(WORKFLOW_EXECUTION_SYNC_REQUEST_EVENT, handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [syncLatestWorkflowExecutionProjection])

  const persistFlowSnapshot = async (input: {
    flowId: string | null
    projectId: string
    ownerType: 'project' | 'chapter' | 'shot' | null
    ownerId: string | null
    name: string
    snapshot: FlowDto['data']
  }): Promise<FlowSaveReceipt> => {
    const sessionEpoch = canvasSessionEpochRef.current
    const saveAtRevision = (snapshot: FlowDto['data'], expectedRevision: number): Promise<FlowSaveReceipt> => {
      const authoringSnapshot: FlowDto['data'] = {
        ...snapshot,
        nodes: withoutWorkflowExecutionProjectionNodes(snapshot.nodes),
        edges: withoutWorkflowExecutionProjectionEdges(snapshot.edges),
      }
      if (input.ownerType === 'chapter' && input.ownerId) {
        return saveChapterFlow({
          id: input.flowId || undefined,
          projectId: input.projectId,
          chapterId: input.ownerId,
          name: input.name,
          ...authoringSnapshot,
          expectedRevision,
        })
      }
      if (input.ownerType === 'shot' && input.ownerId) {
        return saveShotFlow({
          id: input.flowId || undefined,
          projectId: input.projectId,
          shotId: input.ownerId,
          name: input.name,
          ...authoringSnapshot,
          expectedRevision,
        })
      }
      return saveProjectFlow({
        id: input.flowId || undefined,
        projectId: input.projectId,
        name: input.name,
        ...authoringSnapshot,
        expectedRevision,
      })
    }

    const expectedRevision = getLocalFlowRevision()
    const result = input.flowId
      ? await saveWithConflictRebase({
        base: acknowledgedFlowRef.current,
        local: input.snapshot,
        expectedRevision,
        save: saveAtRevision,
        loadLatest: () => getServerFlow(input.flowId as string),
      })
      : {
        flow: await saveAtRevision(input.snapshot, expectedRevision),
        snapshot: input.snapshot,
        rebased: false,
      }

    // The save itself remains valid after navigation, but its completion must
    // not repopulate the now-unmounted canvas runtime with the old snapshot.
    if (!canvasAppMountedRef.current || canvasSessionEpochRef.current !== sessionEpoch) {
      return result.flow
    }

    setLocalFlowRevision(result.flow.canvasRevision ?? expectedRevision + 1)
    acknowledgedFlowRef.current = result.snapshot

    if (result.rebased) {
      const currentProvenance = useRFStore.getState().graphProvenanceKey
      if (!input.flowId || !currentProvenance || currentProvenance === `flow:${input.flowId}`) {
        const sanitized = sanitizeGraphForCanvas(result.snapshot)
        remoteApplyGuard.run(() => {
          workflowExecutionProjectionGuard.run(() => {
            // A conflict rebase restores the persisted authoring graph, which
            // intentionally excludes runtime-only Skill/knowledge reference
            // nodes. Publish the authoring graph and its derived mounts as one
            // atomic store replacement so the canvas never observes a
            // partially projected graph.
            const visibleGraph = buildWorkflowAgentVisibleGraph({
              nodes: sanitized.nodes,
              edges: sanitized.edges,
              workflowExecutionId: 'workflow-configuration',
              outputRefsByAgentNodeId: new Map<string, unknown>(),
              readOnly: false,
            })
            useRFStore.setState({ nodes: visibleGraph.nodes, edges: visibleGraph.edges })
          })
        })
        restoreCreationSession(result.snapshot.sceneCreationProgress)
      }
    }

    return result.flow
  }

  const doSave = async (): Promise<boolean> => {
    if (saving) return false
    const sessionEpoch = canvasSessionEpochRef.current
    const readUiSnapshot = () => {
      const uiState = useUIStore.getState()
      return {
        currentProject: uiState.currentProject,
        currentFlow: uiState.currentFlow,
        canvasViewport: uiState.canvasViewport,
      }
    }

    // 确保项目存在；若无则直接在此创建（沿用当前活动团队上下文）
    let { currentProject: proj } = readUiSnapshot()
    let createdProjectId: string | null = null
    if (!proj?.id) {
      const name = (readUiSnapshot().currentProject?.name || `未命名项目 ${new Date().toLocaleString()}`).trim()
      try {
        const p = await upsertProject({ name, teamId: getActiveTeamId() ?? undefined })
        if (!canvasAppMountedRef.current || canvasSessionEpochRef.current !== sessionEpoch) return false
        setProjects(prev => [p, ...prev])
        skipNextProjectFlowLoadRef.current = p.id
        setCurrentProject({
          id: p.id,
          name: p.name,
          owner: p.owner ?? null,
          ownerName: p.ownerName ?? null,
          isPublic: p.isPublic ?? null,
          teamId: p.teamId ?? null,
          projectKind: p.projectKind,
        })
        setCurrentFlow({
          id: null,
          name: p.name,
          source: 'local',
          ownerType: studioOwnerContext?.ownerType || 'project',
          ownerId: studioOwnerContext?.ownerId || p.id,
        })
        createdProjectId = p.id
        proj = { id: p.id, name: p.name }
      } catch (error: unknown) {
        notifications.show({ title: '创建项目失败', message: resolveErrorMessage(error, '网络或服务器错误'), color: 'red' })
        return false
      }
    }
    const projectId = typeof proj.id === 'string' ? proj.id.trim() : ''
    if (!projectId) {
      notifications.show({ title: '保存失败', message: '当前项目缺少有效 ID', color: 'red' })
      return false
    }
    // 项目即工作流：名称使用项目名
    const flowName = proj!.name || '未命名'
    const savingMutationRevision = canvasMutationRevisionRef.current
    const { nodes, edges } = filterNodesForPersistence(
      useRFStore.getState().nodes,
      useRFStore.getState().edges,
    )
    const { currentFlow: flow, canvasViewport: viewport } = readUiSnapshot()
    const sceneCreationProgress = serializeCreationSessionForPersistence(useUIStore.getState().creationSession)
    const nid = 'saving-' + Date.now()
    notifications.show({ id: nid, title: $('保存中'), message: $('正在保存当前项目…'), loading: true, autoClose: false, withCloseButton: false })
    setSaving(true)
    try {
      const saved = await persistFlowSnapshot({
        flowId: flow.id ?? null,
        projectId,
        ownerType: flow.ownerType ?? null,
        ownerId: flow.ownerId ?? null,
        name: flowName,
        snapshot: { nodes, edges, viewport, sceneCreationProgress },
      })
      if (!canvasAppMountedRef.current || canvasSessionEpochRef.current !== sessionEpoch) return true
      setCurrentFlow({
        id: saved.id,
        name: flowName,
        source: 'server',
        ownerType: saved.ownerType || flow.ownerType || studioOwnerContext?.ownerType || 'project',
        ownerId: saved.ownerId || flow.ownerId || studioOwnerContext?.ownerId || proj!.id!,
      })
      if (saved.id && useRFStore.getState().graphProvenanceKey == null) {
        useRFStore.getState().setGraphProvenance(`flow:${saved.id}`)
      }
      setDirty(canvasMutationRevisionRef.current !== savingMutationRevision)
      lastSilentSaveErrorRef.current = ''
      notifications.update({ id: nid, title: $('已保存'), message: $t('项目「{{name}}」已保存', { name: proj!.name }), loading: false, autoClose: 1500, color: 'green' })
      if (createdProjectId) {
        spaReplace(buildStudioUrl({
          projectId: createdProjectId,
          ownerType: 'project',
          ownerId: createdProjectId,
          flowId: saved.id,
        }))
      }
      return true
    } catch (error: unknown) {
      notifications.update({ id: nid, title: $('保存失败'), message: resolveErrorMessage(error, $('网络或服务器错误')), loading: false, autoClose: 3000, color: 'red' })
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleRunWorkflow = async (
    requestedTriggerNodeId?: string,
    stopAfterNodeId?: string,
    replay?: Readonly<{ sourceExecutionId: string; startFromNodeId: string }>,
  ) => {
    if (execStarting || saving) return
    setExecStarting(true)
    try {
      const nodes = useRFStore.getState().nodes
      const triggerCandidates = nodes.filter((node) => {
        const data = node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {}
        return data.kind === 'workflowTrigger' && data.adminWorkflow === true
      })
      const selectedCandidates = triggerCandidates.filter((node) => node.selected)
      const triggerNodeId = requestedTriggerNodeId?.trim()
        || (selectedCandidates.length === 1 ? selectedCandidates[0]?.id : '')
        || (triggerCandidates.length === 1 ? triggerCandidates[0]?.id : '')
      if (!triggerNodeId) {
        throw new Error('请选中一个智能体工作流触发器后再运行')
      }
      const triggerNode = triggerCandidates.find((node) => node.id === triggerNodeId)
      const triggerData = triggerNode?.data && typeof triggerNode.data === 'object'
        ? triggerNode.data as Record<string, unknown>
        : {}
      if (triggerData.workflowKey === AGENT_WORKFLOW_KEY) {
        compileAgentWorkflow(triggerNodeId, stopAfterNodeId)
      } else if (triggerData.workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY) {
        if (stopAfterNodeId || replay) throw new Error('一键成片当前只允许从触发器启动完整持久工作流')
        compileVideoWorkflow(triggerNodeId)
      } else {
        throw new Error('触发器缺少已注册的工作流身份')
      }

      if (isDirty || !useUIStore.getState().currentFlow.id) {
        const saved = await doSave()
        if (!saved) return
      }
      const flowId = useUIStore.getState().currentFlow.id
      if (!flowId) {
        notifications.show({ title: '无法运行', message: '请先保存当前项目', color: 'red' })
        return
      }

      const nid = `exec-${Date.now()}`
      notifications.show({
        id: nid,
        title: replay ? '从所选节点重放' : stopAfterNodeId ? '执行到所选节点' : '开始运行',
        message: replay
          ? '正在校验并复用未变化的持久上游输出…'
          : stopAfterNodeId
            ? '正在启动上游依赖链…'
            : '正在启动完整工作流执行…',
        loading: true,
        autoClose: false,
        withCloseButton: false,
      })
      const exec = await runWorkflowExecution({
        flowId,
        triggerNodeId,
        ...(stopAfterNodeId ? { stopAfterNodeId } : {}),
        ...(replay
          ? {
            replayFromExecutionId: replay.sourceExecutionId,
            startFromNodeId: replay.startFromNodeId,
          }
          : {}),
        concurrency: 1,
      })
      setExecId(exec.id)
      setExecLogOpen(true)
      void watchWorkflowExecution(exec.id, (message) => {
        notifications.show({ title: '工作流执行失败', message, color: 'red' })
      })
      notifications.update({
        id: nid,
        title: '已启动',
        message: replay
          ? '未变化上游将引用来源输出，所选节点及下游会重新执行'
          : stopAfterNodeId
            ? '将执行到所选节点后停止'
            : '完整运行日志已打开',
        loading: false,
        autoClose: 1200,
        color: 'green',
      })
    } catch (error: unknown) {
      notifications.show({
        title: '启动失败',
        message: error instanceof Error ? error.message : '网络或服务器错误',
        color: 'red',
      })
    } finally {
      setExecStarting(false)
    }
  }

  React.useEffect(() => {
    const handleExecutionRequest = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowExecutionRequestDetail>).detail
      if (!detail?.triggerNodeId) return
      void handleRunWorkflow(
        detail.triggerNodeId,
        detail.stopAfterNodeId,
        detail.replayFromExecutionId && detail.startFromNodeId
          ? {
            sourceExecutionId: detail.replayFromExecutionId,
            startFromNodeId: detail.startFromNodeId,
          }
          : undefined,
      )
    }
    window.addEventListener(WORKFLOW_EXECUTION_REQUEST_EVENT, handleExecutionRequest)
    return () => window.removeEventListener(WORKFLOW_EXECUTION_REQUEST_EVENT, handleExecutionRequest)
  })

  // 静默保存函数，不显示通知
  const silentSave = async (): Promise<boolean> => {
    if (saving) return false
    const sessionEpoch = canvasSessionEpochRef.current
    const readUiSnapshot = () => {
      const uiState = useUIStore.getState()
      return {
        currentProject: uiState.currentProject,
        currentFlow: uiState.currentFlow,
        canvasViewport: uiState.canvasViewport,
      }
    }
    if (isHydratingProjectFlowRef.current) return false

    // 确保项目存在（沿用当前活动团队上下文）
    let { currentProject: proj } = readUiSnapshot()
    let createdProjectId: string | null = null
    if (!proj?.id) {
      const name = (readUiSnapshot().currentProject?.name || `未命名项目 ${new Date().toLocaleString()}`).trim()
      try {
        const p = await upsertProject({ name, teamId: getActiveTeamId() ?? undefined })
        if (!canvasAppMountedRef.current || canvasSessionEpochRef.current !== sessionEpoch) return false
        setProjects(prev => [p, ...prev])
        skipNextProjectFlowLoadRef.current = p.id
        setCurrentProject({
          id: p.id,
          name: p.name,
          owner: p.owner ?? null,
          ownerName: p.ownerName ?? null,
          isPublic: p.isPublic ?? null,
          teamId: p.teamId ?? null,
          projectKind: p.projectKind,
        })
        setCurrentFlow({
          id: null,
          name: p.name,
          source: 'local',
          ownerType: studioOwnerContext?.ownerType || 'project',
          ownerId: studioOwnerContext?.ownerId || p.id,
        })
        createdProjectId = p.id
        proj = { id: p.id, name: p.name }
      } catch (error) {
        notifySilentSaveError(error)
        return false
      }
    }

    const projectId = typeof proj.id === 'string' ? proj.id.trim() : ''
    if (!projectId) {
      notifySilentSaveError(new Error('当前项目缺少有效 ID'))
      return false
    }
    const flowName = proj!.name || '未命名'
    const savingMutationRevision = canvasMutationRevisionRef.current
    const nodes = useRFStore.getState().nodes
    const edges = useRFStore.getState().edges
    const { currentFlow: flow, canvasViewport: viewport } = readUiSnapshot()
    // 归属守卫：要保存到 flow.id，但全局 store 当前可能残留别的资源（章节全屏画布 / 别的 flow）
    // 的内容（SPA 导航 + 共享 useRFStore + 晚到回调）。归属明确指向另一资源时直接放弃本次保存，
    // 否则就把章节内容固化进项目 flow（即「项目首页乱添加章节信息」的数据面根因）。
    if (flow.id) {
      const prov = useRFStore.getState().graphProvenanceKey
      if (prov && prov !== `flow:${flow.id}`) return false
    }
    if (flow.id && isEmptyGraphSnapshot({ nodes, edges })) return true
    const sceneCreationProgress = serializeCreationSessionForPersistence(useUIStore.getState().creationSession)
    try {
      const saved = await persistFlowSnapshot({
        flowId: flow.id ?? null,
        projectId,
        ownerType: flow.ownerType ?? null,
        ownerId: flow.ownerId ?? null,
        name: flowName,
        snapshot: { nodes, edges, viewport, sceneCreationProgress },
      })
      if (!canvasAppMountedRef.current || canvasSessionEpochRef.current !== sessionEpoch) return true
      setCurrentFlow({
        id: saved.id,
        name: flowName,
        source: 'server',
        ownerType: saved.ownerType || flow.ownerType || studioOwnerContext?.ownerType || 'project',
        ownerId: saved.ownerId || flow.ownerId || studioOwnerContext?.ownerId || proj!.id!,
      })
      // 保存成功后落定归属（首次保存创建 flow 时此前 store 归属为空）
      if (saved.id && useRFStore.getState().graphProvenanceKey == null) {
        useRFStore.getState().setGraphProvenance(`flow:${saved.id}`)
      }
      setDirty(canvasMutationRevisionRef.current !== savingMutationRevision)
      lastSilentSaveErrorRef.current = ''
      if (createdProjectId) {
        spaReplace(buildStudioUrl({
          projectId: createdProjectId,
          ownerType: 'project',
          ownerId: createdProjectId,
          flowId: saved.id,
        }))
      }
      return true
    } catch (error) {
      notifySilentSaveError(error)
      return false
    }
  }

  // 导出静默保存函数供其他组件使用
  React.useEffect(() => {
    const target = window as unknown as { silentSaveProject?: () => Promise<boolean> }
    target.silentSaveProject = silentSave
    return () => {
      if (target.silentSaveProject === silentSave) delete target.silentSaveProject
    }
  }, [saving, currentFlow, currentProject, studioOwnerContext])

  // 普通节点编辑没有额外的“提交”动作，必须由项目级画布自动落盘。
  // `isDirty` 在保存成功前保持为真；若保存期间又发生编辑，revision 守卫会
  // 保留脏状态，下一轮再写入，确保重新进入项目时恢复最后一次已确认的画布。
  React.useEffect(() => {
    if (!isDirty || saving || isHydratingProjectFlowRef.current) return
    const timer = window.setTimeout(() => {
      void silentSave()
    }, 800)
    return () => {
      window.clearTimeout(timer)
    }
  }, [isDirty, saving, silentSave])

  const persistedSceneProgressKey = React.useMemo(() => {
    const current = serializeCreationSessionForPersistence(creationSession)
    return JSON.stringify(current)
  }, [creationSession])

  // 创作进度与节点编辑共用同一条“标脏 -> 修订保护 -> 自动保存”链路。
  // 这里不能直接调用 silentSave：保存开始/结束会改变 saving，若 effect 依赖 saving，
  // 就会在没有任何本地变化时形成完整快照保存循环，并可能用延迟的旧画布覆盖远端 patch。
  React.useEffect(() => {
    if (!currentProject?.id) return
    if (!currentFlow.source || currentFlow.source !== 'server') return
    if (!currentFlow.id) return
    if (isHydratingProjectFlowRef.current) return
    if (!hasCreationSessionProgressChanged(
      persistedSceneProgressKey,
      acknowledgedFlowRef.current.sceneCreationProgress,
    )) return
    canvasMutationRevisionRef.current += 1
    if (!useUIStore.getState().isDirty) {
      useUIStore.getState().setDirty(true)
    }
  }, [currentFlow.id, currentFlow.source, currentProject?.id, persistedSceneProgressKey])

  const tourSeenKey = React.useMemo(() => {
    const sub = auth.user?.sub
    if (sub === undefined || sub === null) return null
    return `tapcanvas-feature-tour-seen:${FEATURE_TOUR_VERSION}:${String(sub)}`
  }, [auth.user?.sub])

  React.useEffect(() => {
    if (!auth.user) return
    if (!tourSeenKey) return
    try {
      const seen = localStorage.getItem(tourSeenKey) === '1'
      if (!seen) setFeatureTourOpen(true)
    } catch {
      setFeatureTourOpen(true)
    }
  }, [auth.user?.sub, tourSeenKey])

  const closeFeatureTour = React.useCallback(() => {
    setFeatureTourOpen(false)
    if (!tourSeenKey) return
    try {
      localStorage.setItem(tourSeenKey, '1')
    } catch {
      // ignore
    }
  }, [tourSeenKey])

  const featureTourSteps: FeatureTourStep[] = React.useMemo(() => {
    const steps: FeatureTourStep[] = [
      {
        id: 'floating-nav',
        target: 'floating-nav',
        title: $('浮动菜单'),
        description: $('底部是主要入口：把鼠标移到图标上会在上方展开对应面板。点击“+”可以快速添加节点。'),
      },
      {
        id: 'add-node',
        target: 'add-button',
        title: $('添加节点'),
        description: $('悬停“+”打开添加面板，先加 image / 视频等节点，然后在画布上连线组合成工作流。'),
      },
      {
        id: 'canvas',
        target: 'canvas',
        title: $('画布操作'),
        description: $('拖拽移动节点，拖出连线建立依赖。框选多个节点后按 ⌘/Ctrl+G 打组，按 ⌘/Ctrl+Enter 运行选中。'),
      },
    ]

    if (!hasCanvasNodes) {
      steps.push({
        id: 'quick-start',
        target: 'empty-quickstart',
        title: $('快速起步'),
        description: $('空画布中间会先让你选择目标，比如一句话出图、首帧转视频、分镜草案，或先上传项目文本再从文本开场景。选一个后会直接进入对应 Starter 或入口。'),
      })
    }

    steps.push(
      {
        id: 'run-workflow',
        target: 'run-workflow',
        title: $('一键运行'),
        description: $('右上角“运行”会执行当前工作流，执行面板可查看进度和日志。'),
      },
      {
        id: 'project',
        target: 'project-name',
        title: $('项目保存'),
        description: $('左上角聚焦项目名即可编辑，失焦后自动保存。'),
      },
      {
        id: 'help',
        target: 'help-tour',
        title: $('随时重开引导'),
        description: $('点右上角“帮助”图标可随时重新打开本引导浮层。'),
      },
    )

    return steps
  }, [hasCanvasNodes])

  const headerHeight = 0
  const currentOwnerType = currentFlow.ownerType || studioOwnerContext?.ownerType || 'project'
  const currentOwnerId = String(currentFlow.ownerId || studioOwnerContext?.ownerId || currentProject?.id || '').trim()
  const studioHostDescription = currentOwnerType === 'chapter'
    ? `当前画布只保存到章节宿主 ${currentOwnerId || '未绑定'}`
    : currentOwnerType === 'shot'
      ? `当前画布只保存到镜头宿主 ${currentOwnerId || '未绑定'}`
      : `当前画布保存到项目宿主 ${currentProject?.name || currentOwnerId || '未绑定'}`

  const saveProjectName = React.useCallback(async (projectId: string, name: string): Promise<string> => {
    const updated = await upsertProject({ id: projectId, name })
    setProjects((current) => current.map((project) => (project.id === updated.id ? updated : project)))

    const activeProject = useUIStore.getState().currentProject
    if (activeProject?.id === updated.id) {
      setCurrentProject({
        ...activeProject,
        name: updated.name,
        owner: updated.owner ?? activeProject.owner ?? null,
        ownerName: updated.ownerName ?? activeProject.ownerName ?? null,
        isPublic: updated.isPublic ?? activeProject.isPublic ?? null,
        teamId: updated.teamId ?? activeProject.teamId ?? null,
        projectKind: updated.projectKind ?? activeProject.projectKind,
      })
    }
    window.dispatchEvent(new CustomEvent('tapcanvas:project-updated', {
      detail: { projectId: updated.id, name: updated.name },
    }))
    return updated.name
  }, [setCurrentProject])

  const handleExportCanvas = React.useCallback(() => {
    try {
      const { nodes, edges } = useRFStore.getState()
      const viewport = useUIStore.getState().canvasViewport
      const titleRaw =
        (useUIStore.getState().currentProject?.name || useUIStore.getState().currentFlow?.name || '').trim() ||
        'canvas'
      const safeBase = titleRaw
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim() || 'canvas'
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `${safeBase}-${ts}.json`
      exportCanvasAsJSON(nodes, edges, filename, {
        ...(viewport ? { viewport } : {}),
        metadata: { title: titleRaw },
      })
      toast($('已导出'), 'success')
    } catch (err: any) {
      console.error(err)
      toast(err?.message || $('导出失败'), 'error')
    }
  }, [])

  const importFileInputRef = React.useRef<HTMLInputElement | null>(null)
  const workflowImportFileInputRef = React.useRef<HTMLInputElement | null>(null)

  const handleImportCanvas = React.useCallback(() => {
    importFileInputRef.current?.click()
  }, [])

  const handleExportWorkflow = React.useCallback(() => {
    try {
      const store = useRFStore.getState()
      const workflow = createReusableWorkflowGraph(store.nodes, store.edges)
      const safeBase = workflow.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'workflow'
      exportCanvasAsJSON(workflow.nodes, workflow.edges, `${safeBase}.workflow.json`, {
        metadata: {
          title: workflow.name,
          description: 'TapCanvas 可复用工作流；插入时会生成新的节点与工作流实例身份。',
          tags: ['tapcanvas-workflow'],
        },
      })
      toast('已导出可复用工作流', 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '工作流导出失败', 'error')
    }
  }, [])

  const handleImportWorkflow = React.useCallback(() => {
    workflowImportFileInputRef.current?.click()
  }, [])

  const handleWorkflowImportFileChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    try {
      const canvasData = await importCanvasFromFile(file)
      const workflow = readReusableWorkflowGraph(canvasData)
      useRFStore.getState().importWorkflow({ nodes: workflow.nodes, edges: workflow.edges })
      useUIStore.getState().setDirty(true)
      toast(`已插入工作流：${workflow.name}`, 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '工作流插入失败', 'error')
    }
  }, [])

  const handleImportFileChange = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const canvasData = await importCanvasFromFile(file)
      const nodes = Array.isArray(canvasData.nodes) ? canvasData.nodes : []
      const edges = Array.isArray(canvasData.edges) ? canvasData.edges : []
      useRFStore.setState({ nodes, edges })
      useUIStore.getState().setDirty(true)
      toast($('导入成功'), 'success')
    } catch (err: any) {
      console.error(err)
      toast(err?.message || $('导入失败'), 'error')
    }
  }, [])

  const handleCopyShareLink = React.useCallback(() => {
    const pid = currentProject?.id
    if (!pid) { toast('请先保存项目', 'info'); return }
    const url = `${window.location.origin}/share?projectId=${pid}`
    navigator.clipboard.writeText(url).then(
      () => toast('链接已复制', 'success'),
      () => toast(`请手动复制：${url}`, 'info'),
    )
  }, [currentProject?.id])

  if (!projectSelectionReady) {
    return <CanvasLoadingScreen fixed />
  }

  if (projectSelectionError) {
    return (
      <StudioRouteFailurePage
        title="无法打开指定项目"
        description={projectSelectionError}
      />
    )
  }

  return (
    <>
    <AppShell
      data-compact={'false'}
      header={{ height: headerHeight, offset: false }}
      padding={0}
      styles={{
        main: { paddingTop: 0, paddingLeft: 0, paddingRight: 0, background: 'var(--mantine-color-body)', overflow: 'hidden' }
      }}
    >
      <AppShell.Header className="app-shell-header" />

      {/* 移除左侧固定栏，改为悬浮灵动岛样式 */}

      <AppShell.Main className="app-shell-main">
        <Box className="app-shell-main-box" onClick={(e)=>{
          const el = e.target as HTMLElement
          if (!el.closest('[data-ux-floating]') && !el.closest('[data-ux-panel]')) {
            setActivePanel(null)
          }
        }}>
          <GithubGate className="app-github-gate">
            <Canvas className="app-canvas" />
            <div
              style={{
                position: 'absolute',
                left: 16,
                top: 100,
                zIndex: 30,
                pointerEvents: 'none',
              }}
            >
              <VideoRunIndicator />
            </div>
            {!hasCanvasNodes && (
              <CanvasEmptyOverlay
                onStartStoryboardWizard={() => setStoryboardWizardOpen(true)}
                onOpenNovelImport={() => useUIStore.getState().openAssetManager('catalog')}
              />
            )}
          </GithubGate>
          <StoryboardOnboardingWizard
            opened={storyboardWizardOpen}
            onClose={() => setStoryboardWizardOpen(false)}
          />
        </Box>
      </AppShell.Main>

      {/* 右侧属性栏已移除：节点采取顶部操作条 + 参数弹窗 */}

      <KeyboardShortcuts className="app-keyboard-shortcuts" />
      <ToastHost className="app-toast-host" />
      <IntentProgressToast />
      <ExecutionLogModal className="app-exec-log-modal" opened={execLogOpen} executionId={execId} onClose={() => setExecLogOpen(false)} />
      <WorkflowExecutionSnapshotHost
        onOpenLog={(id) => {
          setExecId(id)
          setExecLogOpen(true)
        }}
      />
      <FeatureTour className="app-feature-tour" opened={featureTourOpen} steps={featureTourSteps} onClose={closeFeatureTour} />
      <BodyPortal>
        <div className="app-header-overlay">
          <Group className="app-header" justify="space-between" p="sm" wrap="nowrap">
            <Group className="app-header-left" wrap="nowrap">
              <Tooltip label="返回上一页" position="bottom" withArrow>
                <UnstyledButton
                  className="app-home-logo"
                  aria-label="返回上一页"
                  onClick={() => navigateBackOr('/')}
                  style={{ display: 'inline-flex', alignItems: 'center' }}
                >
                  <TapCanvasMark
                    className="app-home-logo-img"
                    alt="TapCanvas"
                    size={28}
                  />
                </UnstyledButton>
              </Tooltip>
              {currentOwnerType === 'project' && currentProject?.id ? (
                <StudioProjectNameEditor
                  key={currentProject.id}
                  project={{ id: currentProject.id, name: currentProject.name }}
                  onSave={saveProjectName}
                />
              ) : (
                <Text className="app-studio-host-description" size="xs" c="dimmed" visibleFrom="md">{studioHostDescription}</Text>
              )}
              {isDirty && (<Badge className="app-dirty-badge" color="red" variant="light">{$('未保存')}</Badge>)}
            </Group>
            <Group className="app-header-actions" gap="xs" wrap="nowrap" style={{ visibility: annotationModeActive ? 'hidden' : undefined, pointerEvents: annotationModeActive ? 'none' : undefined }}>
              {auth.user && !auth.user.guest ? (
                <>
                  {isAdmin || isProjectOwner ? (
                    <Button
                      className="app-ai-admin-workbench-entry"
                      size="xs"
                      variant="light"
                      onClick={() => setHeaderAdminWorkbenchOpen(true)}
                    >
                      AI 执行台
                    </Button>
                  ) : null}
                  {isAdmin ? (
                    <Tooltip className="app-stats-entry-tooltip" label="看板" withArrow>
                      <ActionIcon
                        className="app-stats-entry-action"
                        size="sm"
                        variant="subtle"
                        aria-label="看板"
                        onClick={() => window.open('/stats', '_blank', 'noopener,noreferrer')}
                      >
                        <IconChartBar className="app-stats-entry-icon" size={16} />
                      </ActionIcon>
                    </Tooltip>
                  ) : null}
					<Badge
						className="app-credit-balance"
						variant="light"
						leftSection={<IconCoins size={13} />}
					>
						{headerPointsLoading ? '…' : String(Math.max(0, Number(headerTeam?.creditsAvailable || 0)))}
					</Badge>
                </>
              ) : null}
              <Tooltip label="章节画布" withArrow>
                <ActionIcon
                  className="app-chapter-canvas-entry"
                  size="sm"
                  variant="subtle"
                  aria-label="打开章节画布列表"
                  onClick={() => useUIStore.getState().openAssetManager('catalog')}
                >
                  <IconBooks size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="按文本 / 图片 / 视频等节点类型自动分列；工作流组按执行链对齐" withArrow>
                <Button
                  className="app-tidy-button"
                  size="xs"
                  variant="default"
                  onClick={() => useRFStore.getState().tidyByCategory({ arrangeWorkflowGroups: true })}
                  disabled={!hasCanvasNodes}
                >
                  {$('一键整理')}
                </Button>
              </Tooltip>
              <Button className="app-save-button" size="xs" onClick={doSave} disabled={!isDirty} loading={saving} data-tour="save-button">{$('保存')}</Button>
              <CanvasShareTransferMenu
                onPublish={() => {
                  if (!auth.token) {
                    setCanvasLoginModalOpen(true)
                    return
                  }
                  setPublishModalOpen(true)
                }}
                onCopyShareLink={handleCopyShareLink}
                onExportCanvas={handleExportCanvas}
                onImportCanvas={handleImportCanvas}
                onExportWorkflow={handleExportWorkflow}
                onImportWorkflow={handleImportWorkflow}
              />
              <input
                className="app-canvas-import-input"
                ref={importFileInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={handleImportFileChange}
              />
              <input
                className="app-workflow-import-input"
                ref={workflowImportFileInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={handleWorkflowImportFileChange}
              />
              <ProjectConfigChip showRoleSkillConfig={Boolean(auth.user)} />
              {auth.token ? (
                <PortalAccountMenu onRequestLogin={() => setCanvasLoginModalOpen(true)} />
              ) : (
                <Button
                  className="app-account-login"
                  size="xs"
                  variant="subtle"
                  onClick={() => setCanvasLoginModalOpen(true)}
                >
                  登录
                </Button>
              )}
            </Group>
          </Group>
        </div>
        <FloatingNav className="app-floating-nav" />
        <AddNodePanel className="app-add-node-panel" />
        <TemplatePanel className="app-template-panel" />
        <CanvasStyleLibraryPanel />
        <CanvasCharacterLibraryPanel />
        <ProjectPanel />
        <AssetManagerDrawer />
        <TapshowPanel />
        <PendingUploadsBar />
        <ModelPanel />
        <HistoryPanel
          onOpenLog={(id) => {
            setExecId(id)
            setExecLogOpen(true)
          }}
          onFocusNode={(nodeId) => {
            const target = window as unknown as { __tcFocusNode?: (id: string) => void }
            target.__tcFocusNode?.(nodeId)
          }}
          onVersionRestored={async () => {
            const project = useUIStore.getState().currentProject
            if (!project?.id) throw new Error('当前项目上下文已失效，无法刷新恢复后的画布')
            await loadLatestProjectFlow(project.id, project.name, { resumePendingTasks: false })
          }}
        />
        <GenerationHistoryPanel />
        <TaskInboxPanel />
        <FeishuPanel />
        <ExecutionPanel
          onOpenLog={(id) => {
            setExecId(id)
            setExecLogOpen(true)
          }}
          onRun={handleRunWorkflow}
          onFocusNode={(nodeId) => {
            const target = window as unknown as { __tcFocusNode?: (id: string) => void }
            target.__tcFocusNode?.(nodeId)
          }}
          nodeLabelById={nodeLabelById}
        />
        {auth.user && (
          <>
            <DirectorPetLauncher />
            <PendingSkillLaunchConsumer
              currentProjectId={currentProject?.id || null}
              projectReady={Boolean(
                projectSelectionReady &&
                currentProject?.id &&
                currentFlow.id &&
                currentFlow.source === 'server' &&
                currentFlow.ownerType === 'project' &&
                currentFlow.ownerId === currentProject.id
              )}
            />
            <AiChatDialog className="app-ai-chat-dialog" />
          </>
        )}
      </BodyPortal>
      <ParamModal />
      <ReferralInfoModal
        opened={referralModalOpen}
        onClose={() => setReferralModalOpen(false)}
      />
      <AgentAdminWorkbenchPanel
        className="app-agent-admin-workbench-panel"
        opened={headerAdminWorkbenchOpen}
        projectId={currentProject?.id || null}
        flowId={currentFlow.id || null}
        canEditGlobal={isAdmin}
        canEditProject={isAdmin || isProjectOwner}
        adminCapabilities={isAdmin}
        onClose={() => setHeaderAdminWorkbenchOpen(false)}
      />
      <PublishModal
        opened={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        projectId={currentProject?.id || null}
        projectName={currentProject?.name || '未命名'}
        ownerType={studioOwnerContext?.ownerType === 'project' || studioOwnerContext?.ownerType === 'chapter'
          ? studioOwnerContext.ownerType
          : currentProject?.id ? 'project' : null}
        ownerId={studioOwnerContext?.ownerType === 'project' || studioOwnerContext?.ownerType === 'chapter'
          ? studioOwnerContext.ownerId
          : currentProject?.id ?? null}
      />
      <LoginModal
        opened={canvasLoginModalOpen}
        onClose={() => setCanvasLoginModalOpen(false)}
      />
      {subflowNodeId && (<SubflowEditor nodeId={subflowNodeId} onClose={closeSubflow} />)}
      {libraryFlowId && (<LibraryEditor flowId={libraryFlowId} onClose={closeLibraryFlow} />)}
    </AppShell>
    <PreviewModal />
    </>
  )
}

/** /work/:projectId 作品详情页（排除作者主页 /work/u/:login）。社区能力并入工作空间后的规范路径。 */
function matchWorkDetailRoute(): { projectId: string } | null {
  if (typeof window === 'undefined') return null
  const m = (window.location.pathname || '').match(/^\/work\/(?!u\/)([^/]+)\/?$/)
  return m ? { projectId: decodeURIComponent(m[1]) } : null
}

/** /work/u/:login 作者主页。 */
function matchWorkAuthorRoute(): { login: string } | null {
  if (typeof window === 'undefined') return null
  const m = (window.location.pathname || '').match(/^\/work\/u\/([^/]+)\/?$/)
  return m ? { login: decodeURIComponent(m[1]) } : null
}

/** 旧 /tapshow* 链接重定向到新路径（独立 /tapshow 页已下线，能力并入工作空间）。 */
function legacyTapshowRedirectTarget(): string | null {
  if (typeof window === 'undefined') return null
  const path = window.location.pathname || ''
  if (path === '/tapshow' || path === '/tapshow/') return '/'
  const author = path.match(/^\/tapshow\/u\/([^/]+)\/?$/)
  if (author) return `/work/u/${author[1]}`
  const detail = path.match(/^\/tapshow\/([^/]+)\/?$/)
  if (detail) return `/work/${detail[1]}`
  return null
}

function isShareRoute(): boolean {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname || ''
  return path === '/share' || path.startsWith('/share/')
}

function isStatsRoute(): boolean {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname || ''
  return path === '/stats' || path.startsWith('/stats/')
}

function isAgentsCliAuthRoute(): boolean {
  if (typeof window === 'undefined') return false
  return (window.location.pathname || '') === '/auth/agents-cli/approve'
}

function matchProjectChapterWorkbenchRoute(): {
  projectId: string
  chapterId: string
  shotId?: string
} | null {
  if (typeof window === 'undefined') return null
  const path = window.location.pathname || ''
  const shotMatch = path.match(/^\/projects\/([^/]+)\/chapters\/([^/]+)\/shots\/([^/]+)\/?$/)
  if (shotMatch) {
    return {
      projectId: decodeURIComponent(shotMatch[1]),
      chapterId: decodeURIComponent(shotMatch[2]),
      shotId: decodeURIComponent(shotMatch[3]),
    }
  }
  const chapterMatch = path.match(/^\/projects\/([^/]+)\/chapters\/([^/]+)\/?$/)
  if (chapterMatch) {
    return {
      projectId: decodeURIComponent(chapterMatch[1]),
      chapterId: decodeURIComponent(chapterMatch[2]),
    }
  }
  return null
}

function matchChapterCanvasRoute(): {
  projectId: string
  bookId: string | null
  chapterId: string
} | null {
  if (typeof window === 'undefined') return null
  const path = window.location.pathname || ''
  const bookMatch = path.match(/^\/projects\/([^/]+)\/books\/([^/]+)\/chapters\/([^/]+)\/canvas\/?$/)
  if (bookMatch) {
    return {
      projectId: decodeURIComponent(bookMatch[1]),
      bookId: bookMatch[2] === '-' ? null : decodeURIComponent(bookMatch[2]),
      chapterId: decodeURIComponent(bookMatch[3]),
    }
  }
  const plainMatch = path.match(/^\/projects\/([^/]+)\/chapters\/([^/]+)\/canvas\/?$/)
  if (plainMatch) {
    return {
      projectId: decodeURIComponent(plainMatch[1]),
      bookId: null,
      chapterId: decodeURIComponent(plainMatch[2]),
    }
  }
  return null
}

function matchBareStudioProjectEntry(): string | null {
  if (typeof window === 'undefined' || !isStudioRoute()) return null
  try {
    const url = new URL(window.location.href)
    const projectId = String(url.searchParams.get('projectId') || '').trim()
    if (!projectId) return null
    if (url.searchParams.has('ownerType') || url.searchParams.has('ownerId') || url.searchParams.has('flowId')) {
      return null
    }
    return projectId
  } catch {
    return null
  }
}

function RedirectToRoot(): JSX.Element {
  React.useEffect(() => spaReplace('/'), [])
  return <CanvasLoadingScreen fixed />
}

function StudioRouteFailurePage({
  title,
  description,
}: {
  title: string
  description: string
}): JSX.Element {
  return (
    <AppShell className="studio-route-failure" padding="md">
      <AppShell.Main className="studio-route-failure__main">
        <Box
          className="studio-route-failure__content"
          style={{ maxWidth: 520, margin: '12vh auto 0' }}
        >
          <StatePanel
            className="studio-route-failure__panel"
            title={title}
            description={description}
            tone="error"
          />
          <Button
            className="studio-route-failure__action"
            mt="md"
            variant="subtle"
            onClick={() => spaNavigate('/projects')}
          >
            返回项目列表
          </Button>
        </Box>
      </AppShell.Main>
    </AppShell>
  )
}

export default function App(): JSX.Element {
  // Re-render on SPA navigation.
  const [, forceRender] = React.useState(0)
  const routeKey = typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : ''
  const auth = useAuth()
  React.useEffect(() => {
    const onPop = () => forceRender((x) => x + 1)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const performanceHarnessEnabled = import.meta.env.DEV
    || import.meta.env.VITE_ENABLE_CANVAS_PERFORMANCE_HARNESS === '1'
  if (performanceHarnessEnabled && window.location.pathname === '/__canvas-performance') {
    return <CanvasPerformanceHarness />
  }
  if (WorkflowDevelopmentHarnessLazy && window.location.pathname === '/__workflow-development') {
    return (
      <React.Suspense fallback={<CanvasLoadingScreen fixed />}>
        <WorkflowDevelopmentHarnessLazy />
      </React.Suspense>
    )
  }

  // 旧 /tapshow* 链接同步重写到 /work*（再由下方 work 匹配渲染），bare /tapshow → 首页
  const legacyRedirect = legacyTapshowRedirectTarget()
  if (legacyRedirect) {
    spaReplace(legacyRedirect)
  }
  const workAuthorRoute = matchWorkAuthorRoute()
  if (workAuthorRoute) {
    return <TapshowAuthorPage login={workAuthorRoute.login} />
  }
  const workDetailRoute = matchWorkDetailRoute()
  if (workDetailRoute) {
    return <TapshowDetailPage id={workDetailRoute.projectId} />
  }
  if (isShareRoute()) {
    return <ShareFullPage />
  }
  if (isDocsMcpRoute()) {
    return <McpDocPage />
  }
  if (isGithubOauthCallbackRoute()) {
    return <CanvasApp routeKey={routeKey} studioRouteScope={EMPTY_STUDIO_ROUTE_SCOPE} />
  }
  if (!auth.user) {
    return <RedirectToRoot />
  }
  if (isStatsRoute()) {
    return <StatsFullPage />
  }
  if (isAgentsCliAuthRoute()) {
    window.location.href = `${API_BASE}${window.location.pathname}${window.location.search}`
    return (
      <AppShell padding="md">
        <AppShell.Main>
          <Group justify="center" align="center" style={{ minHeight: '100vh' }}>
            <Badge variant="light" color="grape">正在打开授权确认页…</Badge>
          </Group>
        </AppShell.Main>
      </AppShell>
    )
  }
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/workspace')) {
    const workspaceRedirectUrl = `${buildStudioUrl()}${window.location.search || ''}`
    spaReplace(workspaceRedirectUrl)
    return (
      <AppShell padding="md">
        <AppShell.Main>
          <Group justify="center" align="center" style={{ minHeight: '100vh' }}>
            <Badge variant="light" color="gray">正在进入画布…</Badge>
          </Group>
        </AppShell.Main>
      </AppShell>
    )
  }
  const chapterCanvasRoute = matchChapterCanvasRoute()
  if (chapterCanvasRoute) {
    return (
      <React.Suspense fallback={<CanvasLoadingScreen fixed />}>
        <ChapterCanvasFullPageLazy
          projectId={chapterCanvasRoute.projectId}
          bookId={chapterCanvasRoute.bookId}
          chapterId={chapterCanvasRoute.chapterId}
        />
      </React.Suspense>
    )
  }
  const chapterWorkbenchRoute = matchProjectChapterWorkbenchRoute()
  if (chapterWorkbenchRoute) {
    return (
      <ProjectChapterRouteRedirectPage
        projectId={chapterWorkbenchRoute.projectId}
        chapterId={chapterWorkbenchRoute.chapterId}
        shotId={chapterWorkbenchRoute.shotId}
      />
    )
  }
  const bareStudioProjectEntry = matchBareStudioProjectEntry()
  if (bareStudioProjectEntry) {
    return <ProjectEntryRedirectPage projectId={bareStudioProjectEntry} />
  }
  if (isStudioRoute()) {
    const routeScopeResult = parseStudioRouteScope(window.location.href)
    if (!routeScopeResult.ok) {
      return (
        <StudioRouteFailurePage
          title="Studio 地址无效"
          description={routeScopeResult.message}
        />
      )
    }
    return <CanvasApp routeKey={routeKey} studioRouteScope={routeScopeResult.scope} />
  }
  return <RedirectToRoot />
}

const ChapterCanvasFullPageLazy = React.lazy(async () => ({
  default: ChapterCanvasFullPage,
}))
