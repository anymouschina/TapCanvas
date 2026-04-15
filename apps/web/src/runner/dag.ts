import type { Node, Edge } from '@xyflow/react'
import { runNodeMock } from './mockRunner'
import { runNodeRemote } from './remoteRunner'
import { getNodeAbsPosition } from '../canvas/utils/nodeBounds'
import { getTaskNodeCoreType } from '../canvas/nodes/taskNodeSchema'

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

function isExecutableTaskNode(node: Node | null | undefined): boolean {
  if (!node || node.type !== 'taskNode') return false
  const data = asRecord(node.data)
  const kind = typeof data?.kind === 'string' ? data.kind.trim() : ''
  const coreType = getTaskNodeCoreType(kind)
  if (coreType === 'text') return false
  if (kind === 'workflowInput' || kind === 'workflowOutput') return false
  if (data?.skipDagRun === true) return false
  return true
}

function hasExecutableNodeAsset(node: Node | null | undefined): boolean {
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
          const coreType = getTaskNodeCoreType(typeof kind === 'string' ? kind : null)
          const shouldRemote = coreType === 'image' || coreType === 'video'
          if (shouldRemote) {
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

export async function runNodeDagToTarget(
  targetId: string,
  get: Getter,
  set: Setter,
  options?: { concurrency?: number },
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
      await runNodeRemote(targetId, get, set)
      return
    }
    await runNodeMock(targetId, get, set)
    return
  }

  const fullGraph = buildGraph(allNodes, allEdges)
  const requiredNodeIds = new Set<string>()
  const queue: string[] = [targetId]
  const visited = new Set<string>()

  while (queue.length) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)

    const currentNode = fullGraph.nodes.get(currentId)
    if (!currentNode) continue
    if (currentId === targetId || (isExecutableTaskNode(currentNode) && !hasExecutableNodeAsset(currentNode))) {
      requiredNodeIds.add(currentId)
    }

    const upstreamIds = fullGraph.upstream.get(currentId) || []
    upstreamIds.forEach((upstreamId) => {
      if (!visited.has(upstreamId)) queue.push(upstreamId)
    })
  }

  if (requiredNodeIds.size === 0) {
    requiredNodeIds.add(targetId)
  }

  await runFlowDag(
    Math.max(1, Math.min(8, Math.floor(options?.concurrency || 1))),
    get,
    set,
    { only: requiredNodeIds },
  )
}
