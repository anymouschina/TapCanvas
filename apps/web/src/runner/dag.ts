import type { Node, Edge } from '@xyflow/react'
import { runNodeMock } from './mockRunner'
import { runNodeRemote } from './remoteRunner'
import { runNodeAudio } from './audioRunner'
import { getNodeAbsPosition } from '../canvas/utils/nodeBounds'
import { getTaskNodeCoreType, normalizeTaskNodeKind } from '../canvas/nodes/taskNodeSchema'
import { resolveUpstreamRefs } from './resolveUpstreamRefs'
import { collectUpstreamComposeSources, collectUpstreamComposeAudioTracks } from './collectUpstreamComposeSources'
import { isReferenceOnlyCanvasEdge } from '@tapcanvas/canvas-edge-semantics'

type Getter = () => any
type Setter = (fn: (s: any) => any) => void

type Graph = {
  adj: Map<string, string[]>
  indeg: Map<string, number>
  upstream: Map<string, string[]>
  nodes: Map<string, Node>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function hasResolvedAssetUrl(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasResolvedAssetList(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.some((item) => {
    const record = asRecord(item)
    return Boolean(record && hasResolvedAssetUrl(record.url))
  })
}

function hasResolvedStoryboardCells(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.some((item) => {
    const record = asRecord(item)
    return Boolean(record && hasResolvedAssetUrl(record.imageUrl))
  })
}

/**
 * 纯函数：为带 firstFrameFromNodeId / sourcePrevVideoNodeId 的 video 节点
 * 计算需要 patch 进 data 的字段。
 * 仅当目标字段尚未显式设置时才填入，避免覆盖已有值。
 */
export function buildVideoUpstreamRefPatch(
  node: { id: string; data?: Record<string, unknown> },
  nodes: { id: string; data?: Record<string, unknown> }[],
): Record<string, string | number> | null {
  const d = node.data ?? {}
  if (!d.firstFrameFromNodeId && !d.sourcePrevVideoNodeId) return null
  const refs = resolveUpstreamRefs(node, nodes)
  const patch: Record<string, string | number> = {}
  if (refs.firstFrameUrl && !d.firstFrameUrl) patch.firstFrameUrl = refs.firstFrameUrl
  if (refs.sourceVideoUrl && !d.sourceVideoUrl) patch.sourceVideoUrl = refs.sourceVideoUrl
  if (refs.sourcePrevTaskId && !d.sourcePrevTaskId) patch.sourcePrevTaskId = refs.sourcePrevTaskId
  if (refs.referenceVideoDurationSeconds && !d.referenceVideoDurationSeconds) {
    patch.referenceVideoDurationSeconds = refs.referenceVideoDurationSeconds
  }
  return Object.keys(patch).length > 0 ? patch : null
}

/**
 * 在执行 video 节点前，将上游首帧/续写 URL/续写 taskId 注入到节点 data。
 * 仅对带 firstFrameFromNodeId 或 sourcePrevVideoNodeId 的 video 节点生效。
 */
function injectVideoUpstreamRefsIfNeeded(id: string, get: Getter, set: Setter): void {
  const nodes = (get().nodes ?? []) as Node[]
  const node = nodes.find((n) => n.id === id)
  if (!node) return
  const patch = buildVideoUpstreamRefPatch(
    node as { id: string; data?: Record<string, unknown> },
    nodes as { id: string; data?: Record<string, unknown> }[],
  )
  if (!patch) return
  set((state: any) => ({
    nodes: (state.nodes as Node[]).map((n) =>
      n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as Node) : n,
    ),
  }))
}

function isExecutableTaskNode(node: Node | null | undefined): boolean {
  if (!node || node.type !== 'taskNode') return false
  const data = asRecord(node.data)
  const kind = typeof data?.kind === 'string' ? data.kind.trim() : ''
  const coreType = getTaskNodeCoreType(kind)
  if (coreType === 'text') return false
  if (kind === 'workflowInput' || kind === 'workflowOutput') return false
  if (data?.skipDagRun === true) return false
  if (data?.promptNeedsFill === true) return false // 等小T 逐段写 prompt
  return true
}

export function hasExecutableNodeAsset(node: Node | null | undefined): boolean {
  if (!node) return false
  const data = asRecord(node.data)
  if (!data) return false
  return (
    hasResolvedAssetUrl(data.imageUrl) ||
    hasResolvedAssetUrl(data.videoUrl) ||
    hasResolvedAssetUrl(data.audioUrl) ||
    hasResolvedAssetList(data.imageResults) ||
    hasResolvedAssetList(data.videoResults) ||
    hasResolvedAssetList(data.audioResults) ||
    hasResolvedAssetList(data.results) ||
    hasResolvedAssetList(data.assets) ||
    hasResolvedAssetList(data.outputs) ||
    hasResolvedStoryboardCells(data.storyboardEditorCells)
  )
}

function buildGraph(nodes: Node[], edges: Edge[]): Graph {
  const adj = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  const upstream = new Map<string, string[]>()
  const nodesMap = new Map<string, Node>(nodes.map(n => [n.id, n]))

  nodes.forEach(n => {
    adj.set(n.id, [])
    indeg.set(n.id, 0)
    upstream.set(n.id, [])
  })
  edges.forEach(e => {
    if (isReferenceOnlyCanvasEdge(e)) return
    if (!e.source || !e.target) return
    if (!nodesMap.has(e.source) || !nodesMap.has(e.target)) return
    adj.get(e.source)!.push(e.target)
    indeg.set(e.target, (indeg.get(e.target) || 0) + 1)
    upstream.get(e.target)!.push(e.source)
  })
  return { adj, indeg, upstream, nodes: nodesMap }
}

function hasCycle(g: Graph): boolean {
  const indegCopy = new Map(g.indeg)
  const q: string[] = []
  indegCopy.forEach((v, k) => { if (v === 0) q.push(k) })
  let visited = 0
  while (q.length) {
    const u = q.shift()!
    visited++
    for (const v of g.adj.get(u) || []) {
      const nv = (indegCopy.get(v) || 0) - 1
      indegCopy.set(v, nv)
      if (nv === 0) q.push(v)
    }
  }
  return visited !== g.nodes.size
}

/**
 * videoCompose 节点的浏览器本地拼接执行器。
 *
 * 收集上游视频 → 调用 composeVideosToBlob（动态 import，避免 av-cliper 在非浏览器测试环境加载）
 * → 以 URL.createObjectURL(blob) 回写节点，与 TaskNode.tsx handleComposeDone 保持一致。
 */
async function runVideoComposeLocal(id: string, get: Getter, set: Setter): Promise<void> {
  const state = get()
  const allNodes = state.nodes as Node[]
  const allEdges = state.edges as Edge[]

  const sources = collectUpstreamComposeSources(id, allNodes, allEdges)

  // 标记为 running
  set((s: any) => ({
    nodes: (s.nodes as Node[]).map((n: Node) =>
      n.id === id ? ({ ...n, data: { ...n.data, status: 'running', progress: 0 } } as Node) : n,
    ),
  }))

  try {
    if (sources.length < 1) {
      throw new Error(`videoCompose 节点需要至少 1 个上游视频，当前只有 ${sources.length} 个`)
    }

    // 动态 import，避免 @webav/av-cliper 在非浏览器（测试/SSR）环境下静态加载失败
    const { composeVideosToBlob } = await import(
      '../canvas/nodes/taskNode/components/composeVideosCore'
    )

    const audioTracks = collectUpstreamComposeAudioTracks(id, allNodes, allEdges)
    const blob = await composeVideosToBlob(sources, {
      audioTracks,
      onProgress: (p) =>
        set((s: any) => ({
          nodes: (s.nodes as Node[]).map((n: Node) =>
            n.id === id ? ({ ...n, data: { ...n.data, progress: p } } as Node) : n,
          ),
        })),
    })

    // 回写结果——与 TaskNode.tsx handleComposeDone (line 6808) 保持一致：
    //   URL.createObjectURL(blob) 生成浏览器内存 blob URL（仅当前会话有效，无需上传）
    const blobUrl = URL.createObjectURL(blob)

    // 读取最新 node data（拼接耗时较长，state 可能已刷新）
    const freshNode = (get().nodes as Node[]).find((n) => n.id === id)
    const existingResults: any[] = Array.isArray((freshNode?.data as any)?.videoResults)
      ? (freshNode!.data as any).videoResults
      : []

    set((s: any) => ({
      nodes: (s.nodes as Node[]).map((n: Node) =>
        n.id === id
          ? ({
              ...n,
              data: {
                ...n.data,
                videoUrl: blobUrl,
                videoResults: [...existingResults, { url: blobUrl, title: '合成视频' }],
                videoPrimaryIndex: existingResults.length,
                status: 'success',
                progress: 100,
              },
            } as Node)
          : n,
      ),
    }))
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    set((s: any) => ({
      nodes: (s.nodes as Node[]).map((n: Node) =>
        n.id === id
          ? ({
              ...n,
              data: { ...n.data, status: 'error', lastError: message },
            } as Node)
          : n,
      ),
    }))
    throw err // 让 DAG 调度器感知失败，阻塞下游节点
  }
}

export async function runFlowDag(
  concurrency: number,
  get: Getter,
  set: Setter,
  options?: { only?: Set<string> }
) {
  const s = get()
  const only = options?.only
  const nodesInScope = only ? s.nodes.filter((n: Node) => only.has(n.id)) : s.nodes
  const nodes = nodesInScope.filter((n: Node) => {
    if (n.type !== 'taskNode') return false
    const kind = String((n.data as any)?.kind || '').trim().toLowerCase()
    // Text/document nodes are prompt/context carriers and should not be executed as tasks in DAG runs.
    if (kind === 'text') return false
    // Workflow IO nodes are structural; they should not execute.
    if (kind === 'workflowinput' || kind === 'workflowoutput') return false
    // Reference-only nodes can opt out of DAG execution while still feeding downstream refs.
    if (Boolean((n.data as any)?.skipDagRun)) return false
    if (Boolean((n.data as any)?.promptNeedsFill)) return false // 等小T 填 prompt
    return true
  })
  const nodeIdSet = new Set(nodes.map((n: Node) => n.id))
  if (!nodeIdSet.size) return

  const edges = (only ? s.edges.filter((e: Edge) => e.source && e.target && only.has(e.source) && only.has(e.target)) : s.edges)
    .filter((e: Edge) => e.source && e.target && nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
  const graph = buildGraph(nodes, edges)

  const nodesById = new Map<string, Node>((s.nodes as Node[]).map((n) => [n.id, n]))
  const absPosById = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    absPosById.set(n.id, getNodeAbsPosition(n, nodesById))
  }

  // initialize states
  set((state: any) => ({
    nodes: state.nodes.map((n: Node) =>
      nodeIdSet.has(n.id)
        ? ({ ...n, data: { ...n.data, status: 'queued', progress: 0 } })
        : n
    )
  }))

  if (hasCycle(graph)) {
    // mark all as error due to cycle
    set((state: any) => ({
      nodes: state.nodes.map((n: Node) =>
        nodeIdSet.has(n.id)
          ? ({ ...n, data: { ...n.data, status: 'error', lastError: 'Cycle detected in graph' } })
          : n
      )
    }))
    return
  }

  // track ready queue where all upstream succeeded
  const inDeg = new Map(graph.indeg)
  const blocked = new Set<string>() // downstream of failed nodes
  const done = new Set<string>()

  const ready: string[] = []
  const pushReady = (id: string) => {
    ready.push(id)
    // 稳定排序：先按「绝对 y」后按「绝对 x」，保证打组/嵌套后依然按画布视觉顺序执行
    ready.sort((a, b) => {
      const pa = absPosById.get(a) || { x: 0, y: 0 }
      const pb = absPosById.get(b) || { x: 0, y: 0 }
      const ay = Number.isFinite(pa.y) ? pa.y : 0
      const by = Number.isFinite(pb.y) ? pb.y : 0
      if (ay !== by) return ay - by
      const ax = Number.isFinite(pa.x) ? pa.x : 0
      const bx = Number.isFinite(pb.x) ? pb.x : 0
      if (ax !== bx) return ax - bx
      return a.localeCompare(b)
    })
  }
  inDeg.forEach((v, k) => { if (v === 0) pushReady(k) })

  let running = 0
  const schedule = async (): Promise<void> => {
    while (running < concurrency && ready.length) {
      const id = ready.shift()!
      if (blocked.has(id)) {
        // Skip execution but still behave like a completed node:
        // - mark this node as error (blocked)
        // - propagate "blocked" to children
        // - decrement inDeg for children so they only become runnable after ALL upstream are done
        set((state: any) => ({
          nodes: state.nodes.map((n: Node) =>
            n.id === id
              ? ({
                  ...n,
                  data: {
                    ...n.data,
                    status: 'error',
                    lastError: (n.data as any)?.lastError || '前置节点失败，已阻塞',
                  },
                } as Node)
              : n
          ),
        }))
        for (const v of graph.adj.get(id) || []) {
          blocked.add(v)
          inDeg.set(v, (inDeg.get(v) || 1) - 1)
          if (inDeg.get(v) === 0) pushReady(v)
        }
        done.add(id)
        continue
      }
      running++
      // run the node（按节点类型选择真实/模拟执行）
      // eslint-disable-next-line no-void
      void (async () => {
        try {
          const nodeMeta = graph.nodes.get(id)
          const kind = (nodeMeta?.data as any)?.kind
          const normalizedKind = normalizeTaskNodeKind(typeof kind === 'string' ? kind : undefined)
          const coreType = getTaskNodeCoreType(typeof kind === 'string' ? kind : null)
          const shouldRemote = coreType === 'image' || coreType === 'video'
          if (normalizedKind === 'videoCompose') {
            // 本地浏览器拼接，不走远程生成
            await runVideoComposeLocal(id, get, set)
          } else if (coreType === 'audio') {
            await runNodeAudio(id, get, set)
          } else if (shouldRemote) {
            if (coreType === 'video') injectVideoUpstreamRefsIfNeeded(id, get, set)
            await runNodeRemote(id, get, set)
          } else {
            await runNodeMock(id, get, set)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          set((state: any) => ({
            nodes: state.nodes.map((n: Node) =>
              n.id === id
                ? ({
                    ...n,
                    data: {
                      ...n.data,
                      status: 'error',
                      lastError: message || 'Execution failed',
                    },
                  } as Node)
                : n,
            ),
          }))
        } finally {
          running--
          done.add(id)
          const executed = get().nodes.find((n: Node) => n.id === id)
          const ok = (executed?.data as any)?.status === 'success'
          if (!ok) {
            // mark children as blocked
            for (const v of graph.adj.get(id) || []) blocked.add(v)
          }
          for (const v of graph.adj.get(id) || []) {
            inDeg.set(v, (inDeg.get(v) || 1) - 1)
            if (inDeg.get(v) === 0) pushReady(v)
          }
          await schedule()
        }
      })()
    }
  }

  await schedule()
  // wait until finished
  while (done.size < graph.nodes.size) {
    await new Promise(r => setTimeout(r, 50))
  }
}

/** 一次「跑到目标节点」的执行计划：哪些节点要跑、哪些因已有资产被跳过。 */
export interface DagRunPlan {
  /** 实际会执行的节点（含 target；增量模式下不含已生成的上游）。 */
  requiredNodeIds: Set<string>
  /** 因已有资产而被跳过的上游可执行节点（force=true 时为空）。 */
  skippedNodeIds: Set<string>
}

/**
 * 从 target 反向 BFS 收集执行计划。
 * - 默认（force 未设）：跳过已有资产的上游节点（增量/续跑，只补缺失）。
 * - force=true：所有可执行上游节点都纳入（全部重跑）。
 * target 本身始终纳入。纯函数，供出片确认弹窗预估与实际执行复用。
 */
export function collectDagRunPlan(
  targetId: string,
  allNodes: Node[],
  allEdges: Edge[],
  options?: { force?: boolean },
): DagRunPlan {
  const force = options?.force === true
  const fullGraph = buildGraph(allNodes, allEdges)
  const requiredNodeIds = new Set<string>()
  const skippedNodeIds = new Set<string>()
  const queue: string[] = [targetId]
  const visited = new Set<string>()

  while (queue.length) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)

    const currentNode = fullGraph.nodes.get(currentId)
    if (!currentNode) continue
    if (currentId === targetId) {
      requiredNodeIds.add(currentId)
    } else if (isExecutableTaskNode(currentNode)) {
      if (force || !hasExecutableNodeAsset(currentNode)) requiredNodeIds.add(currentId)
      else skippedNodeIds.add(currentId)
    }

    const upstreamIds = fullGraph.upstream.get(currentId) || []
    upstreamIds.forEach((upstreamId) => {
      if (!visited.has(upstreamId)) queue.push(upstreamId)
    })
  }

  if (requiredNodeIds.size === 0) {
    requiredNodeIds.add(targetId)
  }

  return { requiredNodeIds, skippedNodeIds }
}

export async function runNodeDagToTarget(
  targetId: string,
  get: Getter,
  set: Setter,
  options?: { concurrency?: number; force?: boolean },
) {
  const state = get()
  const allNodes = state.nodes as Node[]
  const allEdges = state.edges as Edge[]
  const targetNode = allNodes.find((node) => node.id === targetId)
  if (!targetNode) throw new Error('节点不存在，无法执行')
  if (!isExecutableTaskNode(targetNode)) {
    const kind = String((asRecord(targetNode.data)?.kind as string | undefined) || '').trim()
    const coreType = getTaskNodeCoreType(kind)
    if (coreType === 'image' || coreType === 'video' || coreType === 'storyboard') {
      if (coreType === 'video') injectVideoUpstreamRefsIfNeeded(targetId, get, set)
      await runNodeRemote(targetId, get, set)
      return
    }
    if (coreType === 'audio') {
      await runNodeAudio(targetId, get, set)
      return
    }
    await runNodeMock(targetId, get, set)
    return
  }

  const { requiredNodeIds } = collectDagRunPlan(targetId, allNodes, allEdges, { force: options?.force })

  await runFlowDag(
    Math.max(1, Math.min(8, Math.floor(options?.concurrency || 1))),
    get,
    set,
    { only: requiredNodeIds },
  )
}
