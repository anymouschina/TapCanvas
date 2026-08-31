import { useEffect, useRef, useState } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { API_BASE } from '../../api/server'
import { useAuth } from '../../auth/store'
import { createSseEventParser } from '../../api/sse'
import { useRFStore } from '../store'
import { usePresenceStore } from './presenceStore'
import { useCanvasPresenceWs } from './useCanvasPresenceWs'
import { useSseChatStore } from './sseChatStore'
import { useResourceRuntimeStore } from '../../domain/resource-runtime'
import {
  upsertVideoRun,
  beginVideoRunSnapshot,
  replaceVideoRunSnapshot,
  selectRunStatusEventsAfterWatermark,
  useVideoRunStore,
  isTerminalRunState,
  resetVideoRuns,
  type VideoRunStatus,
} from '../../runner/videoRunStore'
import {
  parseVideoRunStatusEvent,
  parseVideoRunStatusSnapshot,
} from '@tapcanvas/video-orchestrator-protocol'
import { useChatActivityStore } from '../../ui/chat/chatActivityStore'
import {
  applyWorkflowNodeRuns,
} from '../workflowExecutionProjection'
import { listWorkflowNodeRuns } from '../../api/server'
import { useLiveChatRunStore } from '../../ui/chat/liveChatRunStore'
import { useToolProgressStore } from '../toolProgressStore'
import { derivedApplyGuard, remoteApplyGuard } from './remoteApplyGuard'
import { notifications } from '@mantine/notifications'
import { resolveTeamPresenceId } from './presenceEligibility'
import { applyCanvasGraphPatch } from './applyCanvasGraphPatch'
import { isSelectionOnlyNodeDiff } from '../persistence/isSelectionOnlyNodeDiff'
import { isServerManagedProjectionData } from './serverManagedProjection'
import {
  drainDeferredCanvasPatches,
  type DeferredCanvasPatch,
} from './deferredCanvasPatchQueue'
import {
  isExecutionDoWorkflowNodeData,
  isWorkflowRuntimeReferenceEdgeData,
  isWorkflowRuntimeReferenceNodeData,
  withoutWorkflowExecutionProjectionData,
} from '../workflowExecutionProjectionData'

type PendingUserInput = NonNullable<NonNullable<SyncPatch['chatMessages']>[number]['pendingUserInput']>

function readPendingUserInputFromNodeData(data: unknown): PendingUserInput | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const candidate = (data as { pendingUserInput?: unknown }).pendingUserInput
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
  const record = candidate as { requestId?: unknown; questions?: unknown }
  if (typeof record.requestId !== 'string' || !record.requestId.trim() || !Array.isArray(record.questions)) return null
  const questions = record.questions
    .map((question) => {
      if (!question || typeof question !== 'object' || Array.isArray(question)) return null
      const item = question as { id?: unknown; header?: unknown; question?: unknown; options?: unknown }
      if (typeof item.id !== 'string' || typeof item.header !== 'string' || typeof item.question !== 'string' || !Array.isArray(item.options)) return null
      const options = item.options
        .map((option) => {
          if (!option || typeof option !== 'object' || Array.isArray(option)) return null
          const value = option as { label?: unknown; description?: unknown }
          if (typeof value.label !== 'string' || !value.label.trim()) return null
          return {
            label: value.label,
            ...(typeof value.description === 'string' && value.description.trim() ? { description: value.description } : {}),
          }
        })
        .filter((option): option is { label: string; description?: string } => option !== null)
      return options.length ? { id: item.id, header: item.header, question: item.question, options } : null
    })
    .filter((question): question is PendingUserInput['questions'][number] => question !== null)
  return questions.length ? { status: 'needs_input', requestId: record.requestId, questions } : null
}

function readActiveTeamId(): string | null {
  try { return localStorage.getItem('tapcanvas_active_team_id') } catch { return null }
}

const SEED_PREFIX = 'chapter-seed-'
const DEBOUNCE_MS = 200
const RECONNECT_MS = 3000
const CONN_ID_HEADER = 'X-Canvas-Conn-Id'

export type SyncNodeItem = {
  id: string
  type?: string
  position?: { x: number; y: number }
  data?: unknown
  parentId?: string
  style?: unknown
  width?: number
  height?: number
}

export type SyncEdgeItem = {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  data?: unknown
}

type CursorPresenceItem = {
  userId: string
  name: string
  x: number
  y: number
}

export type SyncPatch = {
  upsertNodes?: SyncNodeItem[]
  removeNodeIds?: string[]
  upsertEdges?: SyncEdgeItem[]
  removeEdgeIds?: string[]
  revision?: number
  presence?: CursorPresenceItem
  chatMessages?: Array<{
    id: string
    turnId?: string
    role: 'user' | 'assistant'
    content: string
    ts: string
    languageModel?: string
    pendingUserInput?: {
      status: 'needs_input'
      requestId: string
      questions: Array<{
        id: string
        header: string
        question: string
        options: Array<{ label: string; description?: string; imageUrl?: string; thumbnailUrl?: string }>
      }>
    }
  }>
  chatSessionKey?: string
}

function getActiveTeamId(): string | null {
  try { return localStorage.getItem('tapcanvas_active_team_id') } catch { return null }
}

function buildHeaders(): Record<string, string> {
  const teamId = getActiveTeamId()
  return {
    ...(teamId ? { 'X-Team-Id': teamId } : {}),
  }
}

function nodeToSyncItem(n: Node): SyncNodeItem {
  const item: SyncNodeItem = {
    id: n.id,
    type: n.type,
    position: n.position,
    parentId: n.parentId,
    style: n.style,
    width: n.width,
    height: n.height,
  }
  // managedProjection.data is a server-owned read model. Browser patches may move/resize the node,
  // but must never echo a stale productionState, prompt or URL back onto the SSE channel.
  if (!isServerManagedProjectionData(n.data)) {
    item.data = isExecutionDoWorkflowNodeData(n.data)
      ? withoutWorkflowExecutionProjectionData(n.data)
      : n.data
  }
  return item
}

function edgeToSyncItem(e: Edge): SyncEdgeItem {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    data: e.data,
  }
}

function diffNodes(
  prev: Node[],
  curr: Node[],
): { upsertNodes: SyncNodeItem[]; removeNodeIds: string[] } {
  const prevMap = new Map(prev.filter((node) => !isWorkflowRuntimeReferenceNodeData(node.data)).map((n) => [n.id, n]))
  const currMap = new Map(curr.filter((node) => !isWorkflowRuntimeReferenceNodeData(node.data)).map((n) => [n.id, n]))

  const upsertNodes: SyncNodeItem[] = []
  for (const n of currMap.values()) {
    if (n.id.startsWith(SEED_PREFIX)) continue
    const p = prevMap.get(n.id)
    // store 全程不可变更新（flush 的引用快速路径依赖同一承诺）：引用相同 ⇒ 内容必未变，
    // 跳过整节点两遍 JSON.stringify——大图上这是每次 diff 的主要主线程成本。
    if (p === n) continue
    const item = nodeToSyncItem(n)
    if (!p || JSON.stringify(nodeToSyncItem(p)) !== JSON.stringify(item)) {
      upsertNodes.push(item)
    }
  }

  const removeNodeIds: string[] = []
  for (const n of prevMap.values()) {
    if (n.id.startsWith(SEED_PREFIX)) continue
    if (isServerManagedProjectionData(n.data)) continue
    if (!currMap.has(n.id)) removeNodeIds.push(n.id)
  }

  return { upsertNodes, removeNodeIds }
}

function diffEdges(
  prev: Edge[],
  curr: Edge[],
): { upsertEdges: SyncEdgeItem[]; removeEdgeIds: string[] } {
  const prevMap = new Map(prev.filter((edge) => !isWorkflowRuntimeReferenceEdgeData(edge.data)).map((e) => [e.id, e]))
  const currMap = new Map(curr.filter((edge) => !isWorkflowRuntimeReferenceEdgeData(edge.data)).map((e) => [e.id, e]))

  const upsertEdges: SyncEdgeItem[] = []
  for (const e of currMap.values()) {
    const p = prevMap.get(e.id)
    // 同 diffNodes：引用相同 ⇒ 内容必未变，跳过 stringify
    if (p === e) continue
    const item = edgeToSyncItem(e)
    if (!p || JSON.stringify(edgeToSyncItem(p)) !== JSON.stringify(item)) {
      upsertEdges.push(item)
    }
  }

  const removeEdgeIds: string[] = []
  for (const e of prevMap.values()) {
    if (!currMap.has(e.id)) removeEdgeIds.push(e.id)
  }

  return { upsertEdges, removeEdgeIds }
}

// SSE patches that arrive while the user is actively interacting (panning the
// canvas, dragging a node) get buffered into pendingPatches and flushed on
// next idle. This avoids jank: a remote patch would otherwise trigger a full
// React render mid-drag, dropping frames.
const pendingPatches: DeferredCanvasPatch<SyncPatch>[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function isUserInteracting(): boolean {
  const s = useResourceRuntimeStore.getState()
  return s.viewportMoving || s.nodeDragging
}

function scheduleFlushPending(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    if (isUserInteracting()) {
      scheduleFlushPending()
      return
    }
    remoteApplyGuard.run(() => {
      drainDeferredCanvasPatches(pendingPatches, applyCanvasPatch)
    })
  }, 100)
}

function applyPatch(
  patch: SyncPatch,
  onCanvasApplied?: (patch: SyncPatch) => void,
): void {
  // Presence and chat updates are cheap — always apply immediately so collab
  // cursors and chat don't lag behind canvas state.
  applyPresenceAndChat(patch)
  const hasCanvasChanges =
    patch.upsertNodes?.length ||
    patch.removeNodeIds?.length ||
    patch.upsertEdges?.length ||
    patch.removeEdgeIds?.length
  if (!hasCanvasChanges) return
  if (isUserInteracting()) {
    pendingPatches.push({
      patch: {
        upsertNodes: patch.upsertNodes,
        removeNodeIds: patch.removeNodeIds,
        upsertEdges: patch.upsertEdges,
        removeEdgeIds: patch.removeEdgeIds,
        revision: patch.revision,
        chatSessionKey: patch.chatSessionKey,
      },
      onApplied: onCanvasApplied,
    })
    scheduleFlushPending()
    return
  }
  applyCanvasPatch(patch)
  onCanvasApplied?.(patch)
}

function applyPresenceAndChat(patch: SyncPatch): void {
  if (patch.chatMessages?.length) {
    const sessionKey = String(patch.chatSessionKey || '').trim()
    if (!sessionKey) {
      console.error('[canvas-sync] rejected unscoped SSE chat messages')
      return
    }
    useSseChatStore.getState().push(sessionKey, patch.chatMessages)
  }
}

function applyCanvasPatch(patch: SyncPatch): void {
  // 检测是否有真正的新节点（不在当前 store 里）
  const existingIds = new Set(useRFStore.getState().nodes.map((n) => n.id))
  const hasNewNodes = patch.upsertNodes?.some((u) => !existingIds.has(u.id)) ?? false

  useRFStore.setState((s) => {
    const currentNodeById = new Map(s.nodes.map((node) => [node.id, node]))
    const currentEdgeById = new Map(s.edges.map((edge) => [edge.id, edge]))
    const graph = applyCanvasGraphPatch({
      nodes: s.nodes,
      edges: s.edges,
      patch: {
        upsertNodes: patch.upsertNodes?.map((node) => ({
          ...currentNodeById.get(node.id),
          ...node,
        } as Node)),
        removeNodeIds: patch.removeNodeIds,
        upsertEdges: patch.upsertEdges?.map((edge) => ({
          ...currentEdgeById.get(edge.id),
          ...edge,
        } as Edge)),
        removeEdgeIds: patch.removeEdgeIds,
      },
    })
    return { ...s, ...graph }
  })

  // 有新节点写入时触发语义分类整理（等价于"一键整理"），消除节点顺序混乱；
  // store 变更后 ChapterCanvasPage 的 subscribe → scheduleSave → flush 管道会自动 patch 回服务端。
  if (hasNewNodes) {
    useRFStore.getState().tidyByCategory()
  }

  // 后台状态机可以在原 chat turn 结束后才进入“需要真人操作”的状态。
  // 将持久化在状态节点上的标准 request_user_input 合同投影回聊天队列，避免用户只看到
  // “回复起跑”的死文字；节点本身仍是刷新后的恢复真源。
  const actionMessages = (patch.upsertNodes ?? [])
    .map((node) => {
      const pendingUserInput = readPendingUserInputFromNodeData(node.data)
      if (!pendingUserInput) return null
      return {
        id: `canvas-action-${node.id}-${pendingUserInput.requestId}`,
        role: 'assistant' as const,
        content: '后台编排已进入需要你确认的阶段。',
        ts: new Date().toISOString(),
        pendingUserInput,
      }
    })
    .filter((message): message is NonNullable<typeof message> => message !== null)
  if (actionMessages.length) {
    const sessionKey = String(patch.chatSessionKey || '').trim()
    if (!sessionKey) {
      console.error('[canvas-sync] rejected unscoped pending user input messages')
      return
    }
    useSseChatStore.getState().push(sessionKey, actionMessages)
  }
}

export function useCanvasSync(
  resourceId: string,
  enabled: boolean,
  pathPrefix = '/chapters',
  options?: {
    onRemoteCanvasPatch?: (patch: SyncPatch) => void
  },
): void {
  const user = useAuth((s) => s.user)
  const userId = String(user?.sub ?? 'unknown')
  const userName = user?.name || user?.login || userId.slice(0, 8)
  const [activeTeamId, setActiveTeamId] = useState(readActiveTeamId)
  const presenceTeamId = resolveTeamPresenceId(activeTeamId)
  const lastKnownRef = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const onRemoteCanvasPatchRef = useRef(options?.onRemoteCanvasPatch)
  onRemoteCanvasPatchRef.current = options?.onRemoteCanvasPatch

  // presence 光标单轨走团队模式：未选中团队工作区时不建 WS（服务端还会二次校验项目是否团队共享）。
  useCanvasPresenceWs({
    resourceId,
    userId,
    userName,
    teamId: presenceTeamId,
    enabled: enabled && presenceTeamId !== null,
  })

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ teamId: string | null }>).detail
      setActiveTeamId(detail?.teamId ?? null)
    }
    window.addEventListener('tapcanvas:team-changed', handler)
    return () => window.removeEventListener('tapcanvas:team-changed', handler)
  }, [])

  // 切换项目/章节（resourceId 变化）时清空后台 run 指示器，避免上个项目的 run 串台；
  // 新连接的握手会回放当前 resource 的活跃 run 重新填充。3s 内部重连不触发本 effect。
  useEffect(() => {
    resetVideoRuns()
  }, [resourceId])

  useEffect(() => {
    if (!enabled) return

    const initial = useRFStore.getState()
    lastKnownRef.current = { nodes: initial.nodes, edges: initial.edges }
    useLiveChatRunStore.getState().reconcileAsyncArtifacts(initial.nodes)

    let connId = ''

    let destroyed = false

    async function connect() {
      while (!destroyed) {
        connId = ''
        // A reconnect has no authoritative active set until the required snapshot arrives.
        // Clear the old projection instead of continuing to present it as a current fact.
        beginVideoRunSnapshot()
        abortRef.current = new AbortController()
        try {
          const res = await fetch(
            `${API_BASE}${pathPrefix}/${resourceId}/canvas-events`,
            {
              headers: buildHeaders(),
              signal: abortRef.current.signal,
              credentials: 'include',
            },
          )

          if (!res.ok || !res.body) {
            await new Promise((r) => setTimeout(r, RECONNECT_MS))
            continue
          }

          const parser = createSseEventParser()
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let runSnapshotApplied = false
          const bufferedRunStatuses: VideoRunStatus[] = []

          const applyRunStatus = (payload: VideoRunStatus): void => {
            const prev = useVideoRunStore.getState().runsById[payload.runId]
            upsertVideoRun(payload)
            // prev 非终态 → 本次终态：弹一次性通知。乱序事件会由 store 的 updatedAt 门禁拒绝。
            const accepted = useVideoRunStore.getState().runsById[payload.runId] === payload
            if (!accepted) return
            if ((!prev || !isTerminalRunState(prev.state)) && isTerminalRunState(payload.state)) {
              if (payload.state === 'concatenated') {
                notifications.show({ title: '视频生成完成', message: '整片已生成，画布已出现成片节点', color: 'green', autoClose: 4000 })
              } else if (payload.state === 'cancelled') {
                notifications.show({ title: '已终止视频生产', message: '当前视频 run 已停止；已受理的单段资产仍会保留并按真实终态回写', color: 'gray', autoClose: 4000 })
              } else {
                notifications.show({ title: '视频生成失败', message: payload.errorMessage || '视频生成失败，请检查画布节点', color: 'red', autoClose: 6000 })
              }
            }
          }

          while (!destroyed) {
            const { value, done } = await reader.read()
            if (done) break
            const events = parser.push(decoder.decode(value, { stream: true }))
            for (const ev of events) {
              // Handle connId handshake event
              if (ev.event === 'conn-id') {
                connId = ev.data.trim()
                continue
              }
              if (ev.event === 'run-status-snapshot') {
                if (!ev.data) continue
                const parsed = parseVideoRunStatusSnapshot(JSON.parse(ev.data))
                if (!parsed.success) {
                  await reader.cancel()
                  throw new Error(`[canvas-sync] invalid run-status snapshot contract: ${parsed.error.message}`)
                }
                const expectedScopeType = pathPrefix === '/chapters' ? 'chapter' : 'project'
                if (parsed.data.scopeType !== expectedScopeType || parsed.data.scopeId !== resourceId) {
                  await reader.cancel()
                  throw new Error('[canvas-sync] run-status snapshot scope mismatch')
                }
                replaceVideoRunSnapshot(parsed.data.runs)
                runSnapshotApplied = true
                selectRunStatusEventsAfterWatermark(
                  bufferedRunStatuses.splice(0),
                  parsed.data.watermarkUpdatedAt,
                )
                  .forEach(applyRunStatus)
                continue
              }
              // durable video_runs 的 run 级状态（同步执行与断连 recovery 共用）
              if (ev.event === 'run-status') {
                if (!ev.data) continue
                try {
                  const parsed = parseVideoRunStatusEvent(JSON.parse(ev.data))
                  if (!parsed.success) {
                    console.error('[canvas-sync] invalid run-status contract', parsed.error.message)
                    continue
                  }
                  const payload: VideoRunStatus = parsed.data
                  if (!runSnapshotApplied) bufferedRunStatuses.push(payload)
                  else applyRunStatus(payload)
                } catch { /* 忽略坏帧 */ }
                continue
              }
              // 工作流执行事件（对齐 DeepSeek Harness 事件驱动投影）：执行引擎每次 committed
              // 事件推 seq，前端收到后增量拉取该执行的 node_runs 折叠到画布（节点状态/资产回填）。
              // 小T 触发的一键成片执行不经手动运行路径，全靠本事件实时回显。
              if (ev.event === 'workflow-execution-event') {
                if (!ev.data) continue
                try {
                  const payload = JSON.parse(ev.data) as { executionId?: unknown; seq?: unknown; eventType?: unknown }
                  const executionId = typeof payload.executionId === 'string' && payload.executionId.trim()
                    ? payload.executionId.trim()
                    : ''
                  if (executionId) {
                    void listWorkflowNodeRuns(executionId)
                      .then((runs) => { applyWorkflowNodeRuns(executionId, runs) })
                      .catch(() => undefined)
                  }
                } catch { /* 忽略坏帧 */ }
                continue
              }
              // 后台 agent 回合活动（"running 状态栏"）：对话流关了/重连后也能收（握手回放）
              if (ev.event === 'agent-activity') {
                if (!ev.data) continue
                try {
                  const payload = JSON.parse(ev.data) as {
                    projectId: string
                    active: boolean
                    roleName: string | null
                    at: string
                  }
                  useChatActivityStore.getState().setActivity({
                    projectId: payload.projectId,
                    active: !!payload.active,
                    roleName: payload.roleName ?? null,
                    at: payload.at,
                  })
                } catch { /* 忽略坏帧 */ }
                continue
              }
              // 批量出图逐张进度（"已完成 3/8 张"）：写 toolProgressStore，聊天对话框按 toolCallId 关联。
              if (ev.event === 'tool-progress') {
                if (!ev.data) continue
                try {
                  const d = JSON.parse(ev.data) as {
                    toolCallId?: unknown
                    toolName?: unknown
                    completed?: unknown
                    total?: unknown
                    failed?: unknown
                  }
                  if (typeof d.toolCallId === 'string' && d.toolCallId) {
                    useToolProgressStore.getState().setToolProgress({
                      toolCallId: d.toolCallId,
                      toolName: typeof d.toolName === 'string' ? d.toolName : '',
                      completed: Number(d.completed ?? 0),
                      total: Number(d.total ?? 0),
                      failed: Number(d.failed ?? 0),
                    })
                  }
                } catch { /* 忽略坏帧 */ }
                continue
              }
              if (!ev.data) continue
              try {
                const patch = JSON.parse(ev.data) as SyncPatch
                const hasCanvas =
                  patch.upsertNodes?.length ||
                  patch.removeNodeIds?.length ||
                  patch.upsertEdges?.length ||
                  patch.removeEdgeIds?.length

                if (hasCanvas) {
                  // 在共享守卫下应用远端 patch:期间触发的 store 订阅(本模块的增量回写、
                  // 以及 ChapterCanvasPage 的整图 autosave)都会识别为「远端变更」而跳过,
                  // 从根上断掉「SSE patch→整图 PUT→409 乒乓」。run() 保证抛错也复位。
                  remoteApplyGuard.run(() => applyPatch(patch, (appliedPatch) => {
                    onRemoteCanvasPatchRef.current?.(appliedPatch)
                    const s = useRFStore.getState()
                    lastKnownRef.current = { nodes: s.nodes, edges: s.edges }
                    useLiveChatRunStore.getState().reconcileAsyncArtifacts(s.nodes)
                  }))
                } else {
                  applyPatch(patch)
                  if (typeof patch.revision === 'number') {
                    onRemoteCanvasPatchRef.current?.(patch)
                  }
                }
              } catch {
                /* 坏帧忽略;守卫已由 run() 复位 */
              }
            }
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') return
          console.error('[canvas-sync] SSE connection failed', err)
        }

        if (!destroyed) {
          await new Promise((r) => setTimeout(r, RECONNECT_MS))
        }
      }
    }

    void connect()

    const unsub = useRFStore.subscribe((state, prev) => {
      // The sync connection can mount before the asynchronous project/chapter
      // loader installs its authoritative graph. Reconcile once when that
      // graph provenance becomes available; position-only updates never enter
      // this branch, so canvas drag remains on the constant-time hot path.
      if (
        state.graphProvenanceKey !== prev.graphProvenanceKey
        && state.graphProvenanceKey !== null
      ) {
        useLiveChatRunStore.getState().reconcileAsyncArtifacts(state.nodes)
      }
      if (remoteApplyGuard.active || derivedApplyGuard.active) return
      if (state.nodes === prev.nodes && state.edges === prev.edges) return
      // selected 不进 SyncNodeItem，纯选中变化 diff 出来必然是空 patch——但它换掉了节点引用，
      // 于是每次点击都排一轮 diff（大图上是两遍整节点 stringify 的主线程成本）。提前返回。
      if (state.edges === prev.edges && isSelectionOnlyNodeDiff(prev.nodes, state.nodes)) return

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        if (remoteApplyGuard.active || derivedApplyGuard.active || !connId) return

        const current = useRFStore.getState()
        const last = lastKnownRef.current

        const { upsertNodes, removeNodeIds } = diffNodes(last.nodes, current.nodes)
        const { upsertEdges, removeEdgeIds } = diffEdges(last.edges, current.edges)

        const patch: SyncPatch = {}
        if (upsertNodes.length) patch.upsertNodes = upsertNodes
        if (removeNodeIds.length) patch.removeNodeIds = removeNodeIds
        if (upsertEdges.length) patch.upsertEdges = upsertEdges
        if (removeEdgeIds.length) patch.removeEdgeIds = removeEdgeIds

        if (!Object.keys(patch).length) return

        lastKnownRef.current = { nodes: current.nodes, edges: current.edges }

        fetch(`${API_BASE}${pathPrefix}/${resourceId}/canvas-patches`, {
          method: 'POST',
          headers: { ...buildHeaders(), 'Content-Type': 'application/json', [CONN_ID_HEADER]: connId },
          credentials: 'include',
          body: JSON.stringify(patch),
        }).catch(() => {})
      }, DEBOUNCE_MS)
    })

    return () => {
      destroyed = true
      abortRef.current?.abort()
      unsub()
      if (debounceRef.current) clearTimeout(debounceRef.current)
      usePresenceStore.getState()._clearAll()
    }
  }, [resourceId, pathPrefix, enabled, user, activeTeamId])
}
