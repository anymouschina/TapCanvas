import React from 'react'
import { AppShell, ActionIcon, Group, Box, Button, TextInput, Badge, Text, useMantineColorScheme, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconBrandGithub, IconDownload, IconLanguage, IconMoonStars, IconSun, IconHelpCircle } from '@tabler/icons-react'
import Canvas from './canvas/Canvas'
import GithubGate from './auth/GithubGate'
import PhonePasswordSetupModal from './auth/PhonePasswordSetupModal'
import { sanitizeGraphForCanvas, useRFStore } from './canvas/store'
import { exportCanvasAsJSON } from './canvas/utils/serialization'
import './styles.css'
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
  listShotFlows,
  getMyTeam,
  listRechargePackages,
  upsertProject,
  type FlowDto,
  type ProjectDto,
  type TeamDto,
} from './api/server'
import { useAuth } from './auth/store'
import { useIsAdmin } from './auth/isAdmin'
import { getCurrentLanguage, setLanguage, $, $t } from './canvas/i18n'
import SubflowEditor from './subflow/Editor'
import LibraryEditor from './flows/LibraryEditor'
import { listFlows, saveFlow, deleteFlow as deleteLibraryFlow, renameFlow, scanCycles } from './flows/registry'
import FloatingNav from './ui/FloatingNav'
import BodyPortal from './ui/BodyPortal'
import AddNodePanel from './ui/AddNodePanel'
import TemplatePanel from './ui/TemplatePanel'
import AccountPanel from './ui/AccountPanel'
import ProjectPanel from './ui/ProjectPanel'
import AssetPanel from './ui/AssetPanel'
import TapshowPanel from './ui/TapshowPanel'
import PendingUploadsBar from './ui/PendingUploadsBar'
import { WebCutVideoEditModalHost } from './ui/WebCutVideoEditModalHost'
import ModelPanel from './ui/ModelPanel'
import HistoryPanel from './ui/HistoryPanel'
import ExecutionPanel from './ui/ExecutionPanel'
import NanoComicWorkspacePanel from './ui/NanoComicWorkspacePanel'
import ParamModal from './ui/ParamModal'
import PreviewModal from './ui/PreviewModal'
import TapshowFullPage from './ui/TapshowFullPage'
import ShareFullPage from './ui/ShareFullPage'
import StatsFullPage from './ui/stats/StatsFullPage'
import AiChatDialog from './ui/chat/AiChatDialog'
import { runNodeRemote } from './runner/remoteRunner'
import { Background } from '@xyflow/react'
import { FeatureTour, type FeatureTourStep } from './ui/tour/FeatureTour'
import { ExecutionLogModal } from './ui/ExecutionLogModal'
import ProjectManagerPage from './projects/ProjectManagerPage'
import ProjectChapterRouteRedirectPage from './projects/ProjectChapterRouteRedirectPage'
import ProjectDefaultEntryRedirectPage from './projects/ProjectDefaultEntryRedirectPage'
import RechargeModal from './ui/RechargeModal'
import AgentAdminWorkbenchPanel from './ui/AgentAdminWorkbenchPanel'
import { validateWorkflowIoForRun } from './canvas/workflowIo'
import HomePage from './ui/HomePage'
import { hasPendingUploads } from './ui/pendingUploadGuard'
import { buildStudioUrl, isGithubOauthCallbackRoute, isStudioRoute, type StudioOwnerType, type StudioPanel } from './utils/appRoutes'
import { spaReplace } from './utils/spaNavigate'
import { preloadModelOptions } from './config/useModelOptions'

const FEATURE_TOUR_VERSION = 'v2'

type CanvasGraphNode = ReturnType<typeof useRFStore.getState>['nodes'][number]

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

function formatStudioOwnerLabel(ownerType?: StudioOwnerType | null): string {
  if (ownerType === 'chapter') return '章节流程'
  if (ownerType === 'shot') return '镜头流程'
  return '项目流程'
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

function readStudioOwnerContext(): StudioOwnerContext | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    const ownerTypeRaw = String(url.searchParams.get('ownerType') || '').trim()
    const ownerType =
      ownerTypeRaw === 'chapter' || ownerTypeRaw === 'shot' || ownerTypeRaw === 'project'
        ? ownerTypeRaw
        : null
    const ownerId = String(url.searchParams.get('ownerId') || '').trim()
    if (!ownerType || !ownerId) return null
    return { ownerType, ownerId }
  } catch {
    return null
  }
}

function readStudioFlowId(): string {
  if (typeof window === 'undefined') return ''
  try {
    return String(new URL(window.location.href).searchParams.get('flowId') || '').trim()
  } catch {
    return ''
  }
}

function readStudioRequestedPanel(): StudioPanel | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = String(new URL(window.location.href).searchParams.get('panel') || '').trim()
    return raw === 'nanoComic' ? raw : null
  } catch {
    return null
  }
}

function CanvasApp({ routeKey }: { routeKey?: string }): JSX.Element {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  const addNode = useRFStore((s) => s.addNode)
  const subflowNodeId = useUIStore(s => s.subflowNodeId)
  const closeSubflow = useUIStore(s => s.closeSubflow)
  const libraryFlowId = useUIStore(s => s.libraryFlowId)
  const closeLibraryFlow = useUIStore(s => s.closeLibraryFlow)
  const [refresh, setRefresh] = React.useState(0)
  const [featureTourOpen, setFeatureTourOpen] = React.useState(false)
  const [execLogOpen, setExecLogOpen] = React.useState(false)
  const [execId, setExecId] = React.useState<string | null>(null)
  const [execStarting, setExecStarting] = React.useState(false)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const currentFlow = useUIStore(s => s.currentFlow)
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
  const [currentLang, setCurrentLang] = React.useState(getCurrentLanguage())
  const loadProjectRequestSeq = React.useRef(0)
  const skipNextProjectFlowLoadRef = React.useRef<string | null>(null)
  const isHydratingProjectFlowRef = React.useRef(false)
  const lastSilentSaveErrorRef = React.useRef('')
  const [projectSelectionReady, setProjectSelectionReady] = React.useState(false)
  const studioOwnerContext = React.useMemo(() => readStudioOwnerContext(), [routeKey])
  const studioFlowId = React.useMemo(() => readStudioFlowId(), [routeKey])
  const requestedStudioPanel = React.useMemo(() => readStudioRequestedPanel(), [routeKey])
  const [headerTeam, setHeaderTeam] = React.useState<TeamDto | null>(null)
  const [headerPointsLoading, setHeaderPointsLoading] = React.useState(false)
  const [headerRechargeOpen, setHeaderRechargeOpen] = React.useState(false)
  const [headerAdminWorkbenchOpen, setHeaderAdminWorkbenchOpen] = React.useState(false)
  const [headerRechargeLoading, setHeaderRechargeLoading] = React.useState(false)
  const [hasCanvasNodes, setHasCanvasNodes] = React.useState(() => useRFStore.getState().nodes.length > 0)
  const [nodeLabelById, setNodeLabelById] = React.useState<Record<string, string>>(() => buildNodeLabelById(useRFStore.getState().nodes))

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
    if (!isStudioRoute()) return
    if (requestedStudioPanel === 'nanoComic') {
      setActivePanel('nanoComic')
    }
  }, [requestedStudioPanel, setActivePanel])

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
    void Promise.all([
      preloadModelOptions('image'),
      preloadModelOptions('imageEdit'),
    ]).catch((error: unknown) => {
      console.warn('[App] preload image model options failed', error)
    })
  }, [auth.user?.sub])

  // 初始化时：根据 URL 中的 projectId 选择项目；否则默认第一个项目
  React.useEffect(() => {
    setProjectSelectionReady(false)
    // 根据当前登录用户加载其项目；退出登录时清空项目和画布
    if (!auth.user) {
      setProjects([])
      setCurrentProject(null)
      useRFStore.setState({ nodes: [], edges: [], nextId: 1, nextGroupId: 1 })
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
        const existing = useUIStore.getState().currentProject
        const existingStillValid = !!existing && normalizedProjects.some((p) => p.id === existing.id)
        const url = new URL(window.location.href)
        const pidFromUrl = url.searchParams.get('projectId')
        const fromUrl = pidFromUrl ? normalizedProjects.find((p) => p.id === pidFromUrl) : undefined

        if (fromUrl) {
          if (!existing || existing.id !== fromUrl.id) {
            setCurrentProject({ id: fromUrl.id, name: fromUrl.name })
          }
          return
        }
        if (!existingStillValid && normalizedProjects.length) {
          const first = normalizedProjects[0]
          setCurrentProject({ id: first.id, name: first.name })
          return
        }
        if (normalizedProjects.length) return

        setCurrentProject(null)
        detachCurrentFlowFromProject()
      } catch (error: unknown) {
        if (!cancelled) {
          setCurrentProject(null)
          detachCurrentFlowFromProject()
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
  }, [auth.user?.sub, detachCurrentFlowFromProject, setCurrentProject, setCurrentFlow, setDirty])

  // When projectId changes via SPA navigation, update current project selection.
  React.useEffect(() => {
    const onPop = () => {
      try {
        const url = new URL(window.location.href)
        const pidFromUrl = url.searchParams.get('projectId')
        if (!pidFromUrl) return
        const match = projects.find((p) => p.id === pidFromUrl)
        if (match) {
          setCurrentProject({ id: match.id, name: match.name })
        }
      } catch {
        // ignore
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [projects, setCurrentProject])

  // 当 currentProject 变化时，将 projectId 同步到 URL
  React.useEffect(() => {
    if (!projectSelectionReady) return
    const pid = currentProject?.id
    const url = new URL(window.location.href)
    const current = url.searchParams.get('projectId')
    if (pid) {
      if (current !== pid) {
        url.searchParams.set('projectId', pid)
        window.history.replaceState(null, '', url.toString())
      }
    } else if (current) {
      url.searchParams.delete('projectId')
      window.history.replaceState(null, '', url.toString())
    }
  }, [projectSelectionReady, currentProject?.id])

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

  const refreshHeaderRechargePackages = React.useCallback(async () => {
    const user = auth.user
    if (!user || user.guest) {
      setHeaderRechargeLoading(false)
      return
    }
    setHeaderRechargeLoading(true)
    try {
      await listRechargePackages()
    } catch {
      // ignore header warmup failure
    } finally {
      setHeaderRechargeLoading(false)
    }
  }, [auth.user])

  React.useEffect(() => {
    void Promise.all([refreshHeaderCredits(), refreshHeaderRechargePackages()])
  }, [refreshHeaderCredits, refreshHeaderRechargePackages])

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

        const taskIdCandidates = [
          typeof data.videoTaskId === 'string' ? data.videoTaskId.trim() : '',
          typeof data.imageTaskId === 'string' ? data.imageTaskId.trim() : '',
        ].filter(Boolean)
        const taskId = taskIdCandidates[0] || ''
        if (!taskId || !taskId.startsWith('task_')) return
        if (resumed.has(n.id)) return
        resumed.add(n.id)
        // 自动重启该节点的远程任务（runNodeRemote 会内部复用既有 taskId）
        void runNodeRemote(n.id, useRFStore.getState, useRFStore.setState)
      })
    } catch {
      // ignore auto-resume errors
    }
  }, [])

  const loadLatestProjectFlow = React.useCallback(
    async (projectId: string, projectName?: string) => {
      const seq = ++loadProjectRequestSeq.current
      isHydratingProjectFlowRef.current = true

      // 先清空画布，避免异步加载期间把上个项目的图误保存到当前项目
      useRFStore.setState({ nodes: [], edges: [], nextId: 1, nextGroupId: 1 })
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
        const f = preferredFlow || prioritizedFlows[0] || null

        if (f) {
          const data: any = f.data || {}
          const viewport = data?.viewport
          const sanitized = sanitizeGraphForCanvas({
            nodes: Array.isArray(data.nodes) ? data.nodes : [],
            edges: Array.isArray(data.edges) ? data.edges : [],
          })
          const nextNodes = sanitized.nodes
          const nextEdges = sanitized.edges
          const nextGroupId =
            nextNodes.reduce((max, node) => {
              if (!node || node.type !== 'groupNode') return max
              const match = /^g(\d+)$/.exec(String(node.id || ''))
              if (!match) return max
              const value = Number.parseInt(match[1], 10)
              return Number.isFinite(value) ? Math.max(max, value) : max
            }, 0) + 1

          useRFStore.setState({
            nodes: nextNodes,
            edges: nextEdges,
            // `nextId` 用于生成新节点ID与默认排布；需要随加载数据同步，避免ID冲突导致节点“被覆盖/消失”
            nextId: nextNodes.length + 1,
            nextGroupId,
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
          try {
            const created = studioOwnerContext?.ownerType === 'chapter'
              ? await saveChapterFlow({
                projectId,
                chapterId: studioOwnerContext.ownerId,
                name: emptyFlowName,
                nodes: [],
                edges: [],
              })
              : studioOwnerContext?.ownerType === 'shot'
                ? await saveShotFlow({
                  projectId,
                  shotId: studioOwnerContext.ownerId,
                  name: emptyFlowName,
                  nodes: [],
                  edges: [],
                })
                : await saveProjectFlow({
                  projectId,
                  name: emptyFlowName,
                  nodes: [],
                  edges: [],
                })
            const latestProjectId = String(useUIStore.getState().currentProject?.id || '')
            if (loadProjectRequestSeq.current !== seq) return
            if (!latestProjectId || latestProjectId !== String(projectId)) return

            useRFStore.setState({ nodes: [], edges: [], nextId: 1, nextGroupId: 1 })
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
          } catch {
            useRFStore.setState({ nodes: [], edges: [], nextId: 1, nextGroupId: 1 })
            useUIStore.getState().setRestoreViewport(null)
            restoreCreationSession(null)
            setCurrentFlow({
              id: null,
              name: emptyFlowName,
              source: 'server',
              ownerType: studioOwnerContext?.ownerType || 'project',
              ownerId: studioOwnerContext?.ownerId || projectId,
            })
            setDirty(false)
          }
        }

        // 项目流加载完成后，自动恢复未完成的远程任务（queued/running）
        autoResumePendingTasks()
      } catch {
        // keep cleared state on load failure to avoid cross-project contamination
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

      const nextHasCanvasNodes = state.nodes.length > 0
      setHasCanvasNodes((prev) => (prev === nextHasCanvasNodes ? prev : nextHasCanvasNodes))

      if (didNodeLabelsChange(prevState.nodes, state.nodes)) {
        const nextNodeLabelById = buildNodeLabelById(state.nodes)
        setNodeLabelById((prev) => (areNodeLabelMapsEqual(prev, nextNodeLabelById) ? prev : nextNodeLabelById))
      }

      if (!isHydratingProjectFlowRef.current && !useUIStore.getState().isDirty) {
        useUIStore.getState().setDirty(true)
      }
    })
  }, [])

  const doSave = async () => {
    if (saving) return
    const readUiSnapshot = () => {
      const uiState = useUIStore.getState()
      return {
        currentProject: uiState.currentProject,
        currentFlow: uiState.currentFlow,
        canvasViewport: uiState.canvasViewport,
      }
    }

    // 确保项目存在；若无则直接在此创建
    let { currentProject: proj } = readUiSnapshot()
    if (!proj?.id) {
      const name = (readUiSnapshot().currentProject?.name || `未命名项目 ${new Date().toLocaleString()}`).trim()
      try {
        const p = await upsertProject({ name })
        setProjects(prev => [p, ...prev])
        skipNextProjectFlowLoadRef.current = p.id
        setCurrentProject({ id: p.id, name: p.name })
        setCurrentFlow({
          id: null,
          name: p.name,
          source: 'local',
          ownerType: studioOwnerContext?.ownerType || 'project',
          ownerId: studioOwnerContext?.ownerId || p.id,
        })
        proj = { id: p.id, name: p.name }
      } catch (e:any) {
        notifications.show({ title: '创建项目失败', message: e?.message || '网络或服务器错误', color: 'red' })
        return
      }
    }
    // 项目即工作流：名称使用项目名
    const flowName = proj!.name || '未命名'
    const nodes = useRFStore.getState().nodes
    const edges = useRFStore.getState().edges
    const { currentFlow: flow, canvasViewport: viewport } = readUiSnapshot()
    const sceneCreationProgress = serializeCreationSessionForPersistence(useUIStore.getState().creationSession)
    const nid = 'saving-' + Date.now()
    notifications.show({ id: nid, title: $('保存中'), message: $('正在保存当前项目…'), loading: true, autoClose: false, withCloseButton: false })
    setSaving(true)
    try {
      const saved = flow.ownerType === 'chapter' && flow.ownerId
        ? await saveChapterFlow({
          id: flow.id || undefined,
          projectId: proj!.id!,
          chapterId: flow.ownerId,
          name: flowName,
          nodes,
          edges,
          viewport,
          sceneCreationProgress,
        })
        : flow.ownerType === 'shot' && flow.ownerId
          ? await saveShotFlow({
            id: flow.id || undefined,
            projectId: proj!.id!,
            shotId: flow.ownerId,
            name: flowName,
            nodes,
            edges,
            viewport,
            sceneCreationProgress,
          })
          : await saveProjectFlow({
            id: flow.id || undefined,
            projectId: proj!.id!,
            name: flowName,
            nodes,
            edges,
            viewport,
            sceneCreationProgress,
          })
      setCurrentFlow({
        id: saved.id,
        name: flowName,
        source: 'server',
        ownerType: saved.ownerType || flow.ownerType || studioOwnerContext?.ownerType || 'project',
        ownerId: saved.ownerId || flow.ownerId || studioOwnerContext?.ownerId || proj!.id!,
      })
      setDirty(false)
      lastSilentSaveErrorRef.current = ''
      notifications.update({ id: nid, title: $('已保存'), message: $t('项目「{{name}}」已保存', { name: proj!.name }), loading: false, autoClose: 1500, color: 'green' })
    } catch (e: any) {
      notifications.update({ id: nid, title: $('保存失败'), message: e?.message || $('网络或服务器错误'), loading: false, autoClose: 3000, color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const handleRunWorkflow = async () => {
    if (execStarting || saving) return
    setExecStarting(true)
    try {
      const workflowIoValidation = validateWorkflowIoForRun({
        nodes: useRFStore.getState().nodes,
      })
      if (!workflowIoValidation.ok) {
        notifications.show({
          title: '无法运行',
          message: workflowIoValidation.message || '工作流校验失败',
          color: 'red',
        })
        return
      }

      if (isDirty || !useUIStore.getState().currentFlow.id) {
        await doSave()
      }
      const flowId = useUIStore.getState().currentFlow.id
      if (!flowId) {
        notifications.show({ title: '无法运行', message: '请先保存当前项目', color: 'red' })
        return
      }

      const nid = `exec-${Date.now()}`
      notifications.show({ id: nid, title: '开始运行', message: '正在启动工作流执行…', loading: true, autoClose: false, withCloseButton: false })
      const exec = await runWorkflowExecution({ flowId, concurrency: 1 })
      setExecId(exec.id)
      setExecLogOpen(true)
      notifications.update({ id: nid, title: '已启动', message: '运行日志已打开', loading: false, autoClose: 1200, color: 'green' })
    } catch (e: any) {
      notifications.show({ title: '启动失败', message: e?.message || '网络或服务器错误', color: 'red' })
    } finally {
      setExecStarting(false)
    }
  }

  // 静默保存函数，不显示通知
  const silentSave = async () => {
    if (saving) return
    const readUiSnapshot = () => {
      const uiState = useUIStore.getState()
      return {
        currentProject: uiState.currentProject,
        currentFlow: uiState.currentFlow,
        canvasViewport: uiState.canvasViewport,
      }
    }
    if (isHydratingProjectFlowRef.current) return

    // 确保项目存在
    let { currentProject: proj } = readUiSnapshot()
    if (!proj?.id) {
      const name = (readUiSnapshot().currentProject?.name || `未命名项目 ${new Date().toLocaleString()}`).trim()
      try {
        const p = await upsertProject({ name })
        setProjects(prev => [p, ...prev])
        skipNextProjectFlowLoadRef.current = p.id
        setCurrentProject({ id: p.id, name: p.name })
        setCurrentFlow({
          id: null,
          name: p.name,
          source: 'local',
          ownerType: studioOwnerContext?.ownerType || 'project',
          ownerId: studioOwnerContext?.ownerId || p.id,
        })
        proj = { id: p.id, name: p.name }
      } catch (error) {
        notifySilentSaveError(error)
        return
      }
    }

    const flowName = proj!.name || '未命名'
    const nodes = useRFStore.getState().nodes
    const edges = useRFStore.getState().edges
    const { currentFlow: flow, canvasViewport: viewport } = readUiSnapshot()
    if (flow.id && isEmptyGraphSnapshot({ nodes, edges })) return
    const sceneCreationProgress = serializeCreationSessionForPersistence(useUIStore.getState().creationSession)
    try {
      const saved = flow.ownerType === 'chapter' && flow.ownerId
        ? await saveChapterFlow({
          id: flow.id || undefined,
          projectId: proj!.id!,
          chapterId: flow.ownerId,
          name: flowName,
          nodes,
          edges,
          viewport,
          sceneCreationProgress,
        })
        : flow.ownerType === 'shot' && flow.ownerId
          ? await saveShotFlow({
            id: flow.id || undefined,
            projectId: proj!.id!,
            shotId: flow.ownerId,
            name: flowName,
            nodes,
            edges,
            viewport,
            sceneCreationProgress,
          })
          : await saveProjectFlow({
            id: flow.id || undefined,
            projectId: proj!.id!,
            name: flowName,
            nodes,
            edges,
            viewport,
            sceneCreationProgress,
          })
      setCurrentFlow({
        id: saved.id,
        name: flowName,
        source: 'server',
        ownerType: saved.ownerType || flow.ownerType || studioOwnerContext?.ownerType || 'project',
        ownerId: saved.ownerId || flow.ownerId || studioOwnerContext?.ownerId || proj!.id!,
      })
      setDirty(false)
      lastSilentSaveErrorRef.current = ''
    } catch (error) {
      notifySilentSaveError(error)
    }
  }

  // 导出静默保存函数供其他组件使用
  React.useEffect(() => {
    // 将 silentSave 函数挂载到全局，供其他组件调用
    (window as any).silentSaveProject = silentSave
  }, [saving, currentFlow, currentProject, studioOwnerContext])

  const persistedSceneProgressKey = React.useMemo(() => {
    const current = serializeCreationSessionForPersistence(creationSession)
    return JSON.stringify(current)
  }, [creationSession])

  React.useEffect(() => {
    if (!currentProject?.id) return
    if (!currentFlow.source || currentFlow.source !== 'server') return
    if (!currentFlow.id) return
    if (isHydratingProjectFlowRef.current) return
    if (saving) return
    if (typeof window === 'undefined') return
    if (typeof (window as unknown as { silentSaveProject?: () => void }).silentSaveProject !== 'function') return
    const timer = window.setTimeout(() => {
      ;(window as unknown as { silentSaveProject: () => void }).silentSaveProject()
    }, 120)
    return () => {
      window.clearTimeout(timer)
    }
  }, [currentFlow.source, currentProject?.id, persistedSceneProgressKey, saving])

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
        description: $('左侧是主要入口：把鼠标移到图标上会展开对应面板。点击“+”可以快速添加节点。'),
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
        description: $('右上角可以修改项目名并手动保存。保存后可随时继续编辑。'),
      },
      {
        id: 'help',
        target: 'help-tour',
        title: $('随时重开引导'),
        description: $('点右上角“帮助”图标可随时重新打开本引导浮层。'),
      },
    )

    return steps
  }, [currentLang, hasCanvasNodes])

  const headerHeight = 0
  const currentOwnerType = currentFlow.ownerType || studioOwnerContext?.ownerType || 'project'
  const currentOwnerId = String(currentFlow.ownerId || studioOwnerContext?.ownerId || currentProject?.id || '').trim()
  const studioHostDescription = currentOwnerType === 'chapter'
    ? `当前画布只保存到章节宿主 ${currentOwnerId || '未绑定'}`
    : currentOwnerType === 'shot'
      ? `当前画布只保存到镜头宿主 ${currentOwnerId || '未绑定'}`
      : `当前画布保存到项目宿主 ${currentProject?.name || currentOwnerId || '未绑定'}`

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

  return (
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
          </GithubGate>
        </Box>
      </AppShell.Main>

      {/* 右侧属性栏已移除：节点采取顶部操作条 + 参数弹窗 */}

      <KeyboardShortcuts className="app-keyboard-shortcuts" />
      <ToastHost className="app-toast-host" />
      <ExecutionLogModal className="app-exec-log-modal" opened={execLogOpen} executionId={execId} nodeLabelById={nodeLabelById} onClose={() => setExecLogOpen(false)} />
      <FeatureTour className="app-feature-tour" opened={featureTourOpen} steps={featureTourSteps} onClose={closeFeatureTour} />
      <BodyPortal>
        <div className="app-header-overlay">
          <Group className="app-header" justify="space-between" p="sm" wrap="nowrap">
            <Group className="app-header-left" wrap="nowrap">
              <Badge className="app-owner-badge" color={currentOwnerType === 'shot' ? 'orange' : currentOwnerType === 'chapter' ? 'blue' : 'gray'} variant="light">
                {formatStudioOwnerLabel(currentOwnerType)}
              </Badge>
              <Text size="xs" c="dimmed" visibleFrom="md">{studioHostDescription}</Text>
              {isDirty && (<Badge className="app-dirty-badge" color="red" variant="light">{$('未保存')}</Badge>)}
            </Group>
            <Group className="app-header-actions" gap="xs" wrap="nowrap">
              <TextInput
                className="app-project-input"
                size="xs"
                placeholder={$('项目名')}
                value={currentProject?.name || ''}
                onChange={(e)=> setCurrentProject({ ...(currentProject||{}), name: e.currentTarget.value })}
                onBlur={async ()=>{ if (currentProject?.id && currentProject.name) await upsertProject({ id: currentProject.id, name: currentProject.name }) }}
                data-tour="project-name"
              />
              {auth.user && !auth.user.guest ? (
                <>
                  {isAdmin || isProjectOwner ? (
                    <Button
                      className="app-ai-admin-workbench-entry"
                      size="xs"
                      variant="light"
                      onClick={() => setHeaderAdminWorkbenchOpen(true)}
                    >
                      AI 工作台
                    </Button>
                  ) : null}
                  <Tooltip
                    className="app-credit-refresh-tooltip"
                    label={headerPointsLoading ? '积分加载中…' : `当前积分 ${Math.max(0, Number(headerTeam?.creditsAvailable || 0))}`}
                    withArrow
                  >
                    <Button
                      className="app-quick-recharge-button"
                      size="xs"
                      variant="light"
                      loading={headerRechargeLoading || headerPointsLoading}
                      onClick={() => setHeaderRechargeOpen(true)}
                    >
                      充值
                    </Button>
                  </Tooltip>
                </>
              ) : null}
              <Button className="app-save-button" size="xs" onClick={doSave} disabled={!isDirty} loading={saving} data-tour="save-button">{$('保存')}</Button>
              <Tooltip className="app-export-tooltip" label={$('导出画布')}>
                <ActionIcon
                  className="app-export-action"
                  size="lg"
                  variant="subtle"
                  aria-label={$('导出画布')}
                  onClick={handleExportCanvas}
                >
                  <IconDownload className="app-export-icon" size={18} />
                </ActionIcon>
              </Tooltip>
              <Button
                className="app-tapshow-link"
                size="xs"
                variant="subtle"
                component="a"
                href="/tapshow"
                target="_blank"
                rel="noopener noreferrer"
              >
                TapShow
              </Button>
              <ActionIcon
                className="app-theme-toggle"
                variant="subtle"
                aria-label={colorScheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                onClick={() => toggleColorScheme()}
              >
                {colorScheme === 'dark' ? <IconSun className="app-theme-toggle-icon" size={18} /> : <IconMoonStars className="app-theme-toggle-icon" size={18} />}
              </ActionIcon>
              <ActionIcon
                className="app-language-toggle"
                variant="subtle"
                aria-label="Language / 语言"
                onClick={() => {
                  const newLang = currentLang === 'zh' ? 'en' : 'zh'
                  setLanguage(newLang)
                  setCurrentLang(newLang)
                }}
              >
                <IconLanguage className="app-language-toggle-icon" size={18} />
              </ActionIcon>
              <ActionIcon
                className="app-help-toggle"
                variant="subtle"
                aria-label={$('帮助')}
                onClick={() => setFeatureTourOpen(true)}
                data-tour="help-tour"
              >
                <IconHelpCircle className="app-help-toggle-icon" size={18} />
              </ActionIcon>
              <ActionIcon className="app-github-link" component="a" href="https://github.com/anymouschina/TapCanvas" target="_blank" rel="noopener noreferrer" variant="subtle" aria-label="GitHub">
                <IconBrandGithub className="app-github-icon" size={18} />
              </ActionIcon>
            </Group>
          </Group>
          <div className="app-header-secondary-row">
            <div id="tc-canvas-breadcrumb-slot" className="app-header-secondary-slot app-header-secondary-slot--left" />
            <div id="tc-canvas-visibility-slot" className="app-header-secondary-slot app-header-secondary-slot--right app-header-secondary-slot--canvas-visibility"/>
          </div>
        </div>
        <FloatingNav className="app-floating-nav" />
        <AddNodePanel className="app-add-node-panel" />
        <TemplatePanel className="app-template-panel" />
        <ProjectPanel />
        <AccountPanel />
        <AssetPanel />
        <TapshowPanel />
        <PendingUploadsBar />
        <ModelPanel />
        <HistoryPanel />
        <ExecutionPanel
          onOpenLog={(id) => {
            setExecId(id)
            setExecLogOpen(true)
          }}
          onRun={handleRunWorkflow}
          onFocusNode={(nodeId) => {
            try {
              const fn = (window as any).__tcFocusNode as undefined | ((id: string) => void)
              fn?.(nodeId)
            } catch {
              // ignore
            }
          }}
          nodeLabelById={nodeLabelById}
        />
        <NanoComicWorkspacePanel />
        {auth.user && (<AiChatDialog className="app-ai-chat-dialog" />)}
      </BodyPortal>
      <ParamModal />
      <PreviewModal />
      <WebCutVideoEditModalHost />
      <RechargeModal
        opened={headerRechargeOpen}
        onClose={() => setHeaderRechargeOpen(false)}
        onPaid={() => {
          void refreshHeaderCredits()
        }}
      />
      <AgentAdminWorkbenchPanel
        className="app-agent-admin-workbench-panel"
        opened={headerAdminWorkbenchOpen}
        projectId={currentProject?.id || null}
        canEditGlobal={isAdmin}
        canEditProject={isAdmin || isProjectOwner}
        onClose={() => setHeaderAdminWorkbenchOpen(false)}
      />
      <PhonePasswordSetupModal className="app-phone-password-setup-modal" />
      {subflowNodeId && (<SubflowEditor nodeId={subflowNodeId} onClose={closeSubflow} />)}
      {libraryFlowId && (<LibraryEditor flowId={libraryFlowId} onClose={closeLibraryFlow} />)}
    </AppShell>
  )
}

function isTapshowRoute(): boolean {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname || ''
  return path === '/tapshow' || path.startsWith('/tapshow/')
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

function isProjectsRoute(): boolean {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname || ''
  return path === '/projects' || path.startsWith('/projects/')
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

function matchProjectEntryRoute(): { projectId: string } | null {
  if (typeof window === 'undefined') return null
  const path = window.location.pathname || ''
  const projectOnlyMatch = path.match(/^\/projects\/([^/]+)\/?$/)
  if (!projectOnlyMatch) return null
  return {
    projectId: decodeURIComponent(projectOnlyMatch[1]),
  }
}

function RootEntryPage(): JSX.Element {
  const auth = useAuth()
  const [loading, setLoading] = React.useState(Boolean(auth.user))

  React.useEffect(() => {
    if (!auth.user) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    listProjects()
      .catch((error) => {
        console.error('根入口加载项目失败，将直接进入画布', error)
      })
      .finally(() => {
        if (cancelled) return
        spaReplace(buildStudioUrl())
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [auth.user?.sub])

  if (!auth.user) return <HomePage />
  if (!loading) return <HomePage />
  return (
    <AppShell padding="md">
      <AppShell.Main>
        <Group justify="center" align="center" style={{ minHeight: '100vh' }}>
          <Badge variant="light" color="gray">正在进入最近编辑章节…</Badge>
        </Group>
      </AppShell.Main>
    </AppShell>
  )
}

export default function App(): JSX.Element {
  // Re-render on SPA navigation.
  const [, forceRender] = React.useState(0)
  const routeKey = typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : ''
  React.useEffect(() => {
    const onPop = () => forceRender((x) => x + 1)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (isTapshowRoute()) {
    return <TapshowFullPage />
  }
  if (isShareRoute()) {
    return <ShareFullPage />
  }
  if (isStatsRoute()) {
    return <StatsFullPage />
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
  const projectEntryRoute = matchProjectEntryRoute()
  if (projectEntryRoute) {
    return <ProjectDefaultEntryRedirectPage projectId={projectEntryRoute.projectId} />
  }
  if (isProjectsRoute()) {
    return <ProjectManagerPage />
  }
  if (isGithubOauthCallbackRoute()) {
    return <CanvasApp routeKey={routeKey} />
  }
  if (isStudioRoute()) {
    return <CanvasApp routeKey={routeKey} />
  }
  return <RootEntryPage />
}
