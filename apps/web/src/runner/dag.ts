import type { Node, Edge } from 'reactflow'
import { runNodeMock } from './mockRunner'

type Getter = () => any
type Setter = (fn: (s: any) => any) => void

type Graph = {
  adj: Map<string, string[]>
  indeg: Map<string, number>
  upstream: Map<string, string[]>
  nodes: Map<string, Node>
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
  const nodes = only ? s.nodes.filter((n: Node) => only.has(n.id)) : s.nodes
  const edges = only
    ? s.edges.filter((e: Edge) => e.source && e.target && only.has(e.source) && only.has(e.target))
    : s.edges
  const graph = buildGraph(nodes, edges)

  // initialize states
  set((state: any) => ({
    nodes: state.nodes.map((n: Node) =>
      (!only || only.has(n.id))
        ? ({ ...n, data: { ...n.data, status: 'queued', progress: 0 } })
        : n
    )
  }))

  if (hasCycle(graph)) {
    // mark all as error due to cycle
    set((state: any) => ({
      nodes: state.nodes.map((n: Node) =>
        (!only || only.has(n.id))
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
  inDeg.forEach((v, k) => { if (v === 0) ready.push(k) })

  let running = 0
  const schedule = async (): Promise<void> => {
    while (running < concurrency && ready.length) {
      const id = ready.shift()!
      if (blocked.has(id)) {
        // skip but propagate block to children
        for (const v of graph.adj.get(id) || []) {
          blocked.add(v)
          ready.push(v)
        }
        done.add(id)
        continue
      }
      running++
      // run the node
      // eslint-disable-next-line no-void
      void (async () => {
        await runNodeMock(id, get, set)
        running--
        done.add(id)
        const node = get().nodes.find((n: Node) => n.id === id)
        const ok = (node?.data as any)?.status === 'success'
        if (!ok) {
          // mark children as blocked
          for (const v of graph.adj.get(id) || []) blocked.add(v)
        }
        for (const v of graph.adj.get(id) || []) {
          inDeg.set(v, (inDeg.get(v) || 1) - 1)
          if (inDeg.get(v) === 0) ready.push(v)
        }
        await schedule()
      })()
    }
  }

  await schedule()
  // wait until finished
  while (done.size < graph.nodes.size) {
    await new Promise(r => setTimeout(r, 50))
  }
}
