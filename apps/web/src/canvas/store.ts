import { create } from 'zustand'
import type { Edge, Node, OnConnect, OnEdgesChange, OnNodesChange, Connection } from 'reactflow'
import { addEdge, applyEdgeChanges, applyNodeChanges } from 'reactflow'
import { runNodeMock } from '../runner/mockRunner'
import { runFlowDag } from '../runner/dag'

type GroupRec = { id: string; name: string; nodeIds: string[] }

type RFState = {
  nodes: Node[]
  edges: Edge[]
  nextId: number
  groups: GroupRec[]
  nextGroupId: number
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  addNode: (type: string, label?: string, extra?: Record<string, any>) => void
  reset: () => void
  load: (data: { nodes: Node[]; edges: Edge[] } | null) => void
  removeSelected: () => void
  updateNodeLabel: (id: string, label: string) => void
  updateNodeData: (id: string, patch: Record<string, any>) => void
  copySelected: () => void
  pasteFromClipboard: () => void
  clipboard: { nodes: Node[]; edges: Edge[] } | null
  // history
  historyPast: { nodes: Node[]; edges: Edge[] }[]
  historyFuture: { nodes: Node[]; edges: Edge[] }[]
  undo: () => void
  redo: () => void
  // mock run
  runSelected: () => Promise<void>
  runAll: () => Promise<void>
  runDag: (concurrency: number) => Promise<void>
  setNodeStatus: (id: string, status: 'idle'|'queued'|'running'|'success'|'error', patch?: Partial<any>) => void
  appendLog: (id: string, line: string) => void
  beginRunToken: (id: string) => void
  endRunToken: (id: string) => void
  cancelNode: (id: string) => void
  isCanceled: (id: string) => boolean
  cancelAll: () => void
  retryFailed: () => void
  deleteNode: (id: string) => void
  deleteEdge: (id: string) => void
  duplicateNode: (id: string) => void
  pasteFromClipboardAt: (pos: { x: number; y: number }) => void
  selectAll: () => void
  clearSelection: () => void
  invertSelection: () => void
  // groups
  addGroupForSelection: (name?: string) => void
  removeGroupById: (id: string) => void
  findGroupMatchingSelection: () => GroupRec | null
  renameGroup: (id: string, name: string) => void
}

function genId(prefix: string, n: number) {
  return `${prefix}${n}`
}

function cloneGraph(nodes: Node[], edges: Edge[]) {
  return JSON.parse(JSON.stringify({ nodes, edges })) as { nodes: Node[]; edges: Edge[] }
}

export const useRFStore = create<RFState>((set, get) => ({
  nodes: [],
  edges: [],
  nextId: 1,
  groups: [],
  nextGroupId: 1,
  historyPast: [],
  historyFuture: [],
  clipboard: null,
  onNodesChange: (changes) => set((s) => {
    const updated = applyNodeChanges(changes, s.nodes)
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: updated, historyPast: past, historyFuture: [] }
  }),
  onEdgesChange: (changes) => set((s) => {
    const updated = applyEdgeChanges(changes, s.edges)
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { edges: updated, historyPast: past, historyFuture: [] }
  }),
  onConnect: (connection: Connection) => set((s) => {
    const exists = s.edges.some((e) =>
      e.source === connection.source &&
      e.target === connection.target &&
      e.sourceHandle === connection.sourceHandle &&
      e.targetHandle === connection.targetHandle
    )
    const next = exists ? s.edges : addEdge({ ...connection, animated: true, type: 'smoothstep' }, s.edges)
    const past = exists ? s.historyPast : [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return exists ? { edges: next } : { edges: next, historyPast: past, historyFuture: [] }
  }),
  addNode: (type, label, extra) => set((s) => {
    const id = genId('n', s.nextId)
    const node: Node = {
      id,
      type: type as any,
      position: { x: 80 + (s.nextId % 6) * 40, y: 80 + (s.nextId % 5) * 30 },
      data: { label: label ?? type, ...(extra || {}) },
    }
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: [...s.nodes, node], nextId: s.nextId + 1, historyPast: past, historyFuture: [] }
  }),
  reset: () => set({ nodes: [], edges: [], nextId: 1 }),
  load: (data) => {
    if (!data) return
    // support optional groups in payload
    const anyData = data as any
    set((s) => ({
      nodes: data.nodes,
      edges: data.edges,
      nextId: data.nodes.length + 1,
      groups: Array.isArray(anyData.groups) ? anyData.groups : [],
      nextGroupId: Array.isArray(anyData.groups) ? anyData.groups.length + 1 : 1,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }))
  },
  removeSelected: () => set((s) => ({
    nodes: s.nodes.filter((n) => !n.selected),
    edges: s.edges.filter((e) => !e.selected),
    historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
    historyFuture: [],
  })),
  updateNodeLabel: (id, label) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)),
    historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
    historyFuture: [],
  })),
  updateNodeData: (id, patch) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
    historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
    historyFuture: [],
  })),
  setNodeStatus: (id, status, patch) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, status, ...(patch||{}) } } : n))
  })),
  appendLog: (id, line) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, logs: [...((n.data as any)?.logs || []), line] } } : n))
  })),
  beginRunToken: (id) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, canceled: false } } : n))
  })),
  endRunToken: (id) => set((s) => s),
  cancelNode: (id) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, canceled: true } } : n))
  })),
  isCanceled: (id) => {
    const n = get().nodes.find((x) => x.id === id)
    return Boolean((n?.data as any)?.canceled)
  },
  runSelected: async () => {
    const s = get()
    const selected = s.nodes.find((n) => n.selected)
    if (!selected) return
    await runNodeMock(selected.id, get, set)
  },
  runAll: async () => {
    const s = get()
    for (const n of s.nodes) {
      // skip if already success recently
      await runNodeMock(n.id, get, set)
    }
  },
  runDag: async (concurrency: number) => {
    await runFlowDag(Math.max(1, Math.min(8, Math.floor(concurrency || 2))), get, set)
  },
  copySelected: () => set((s) => {
    const selNodes = s.nodes.filter((n) => n.selected)
    if (!selNodes.length) return { clipboard: null }
    const selIds = new Set(selNodes.map((n) => n.id))
    const selEdges = s.edges.filter((e) => selIds.has(e.source) && selIds.has(e.target) && e.selected)
    return { clipboard: { nodes: selNodes, edges: selEdges } }
  }),
  pasteFromClipboard: () => set((s) => {
    if (!s.clipboard || !s.clipboard.nodes.length) return {}
    const offset = { x: 24, y: 24 }
    const idMap = new Map<string, string>()
    const baseNext = s.nextId
    let counter = 0
    const newNodes: Node[] = s.clipboard.nodes.map((n) => {
      const newId = genId('n', baseNext + counter++)
      idMap.set(n.id, newId)
      return {
        ...n,
        id: newId,
        selected: false,
        position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
      }
    })
    const newEdges: Edge[] = s.clipboard.edges
      .map((e) => ({
        ...e,
        id: `${idMap.get(e.source)}-${idMap.get(e.target)}-${Math.random().toString(36).slice(2, 6)}`,
        source: idMap.get(e.source) || e.source,
        target: idMap.get(e.target) || e.target,
        selected: false,
      }))
      .filter((e) => e.source !== e.target)

    return {
      nodes: [...s.nodes, ...newNodes],
      edges: [...s.edges, ...newEdges],
      nextId: baseNext + counter,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  undo: () => set((s) => {
    if (!s.historyPast.length) return {}
    const previous = s.historyPast[s.historyPast.length - 1]
    const rest = s.historyPast.slice(0, -1)
    const future = [cloneGraph(s.nodes, s.edges), ...s.historyFuture].slice(0, 50)
    return { nodes: previous.nodes, edges: previous.edges, historyPast: rest, historyFuture: future }
  }),
  redo: () => set((s) => {
    if (!s.historyFuture.length) return {}
    const next = s.historyFuture[0]
    const future = s.historyFuture.slice(1)
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: next.nodes, edges: next.edges, historyPast: past, historyFuture: future }
  }),
  cancelAll: () => set((s) => ({
    nodes: s.nodes.map((n) => ({ ...n, data: { ...n.data, canceled: true } }))
  })),
  retryFailed: () => set((s) => ({
    nodes: s.nodes.map((n) => {
      const st = (n.data as any)?.status
      if (st === 'error' || st === 'canceled') {
        const { logs, lastError, progress, status, ...rest } = (n.data as any) || {}
        return { ...n, data: { ...rest, status: 'idle', progress: 0 } }
      }
      return n
    })
  })),
  deleteNode: (id) => set((s) => ({
    nodes: s.nodes.filter(n => n.id !== id),
    edges: s.edges.filter(e => e.source !== id && e.target !== id),
    historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
    historyFuture: [],
  })),
  deleteEdge: (id) => set((s) => ({
    edges: s.edges.filter(e => e.id !== id),
    historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
    historyFuture: [],
  })),
  duplicateNode: (id) => set((s) => {
    const n = s.nodes.find(n => n.id === id)
    if (!n) return {}
    const newId = genId('n', s.nextId)
    const dup: Node = {
      ...n,
      id: newId,
      position: { x: n.position.x + 24, y: n.position.y + 24 },
      selected: false,
    }
    return { nodes: [...s.nodes, dup], nextId: s.nextId + 1, historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50), historyFuture: [] }
  }),
  pasteFromClipboardAt: (pos) => set((s) => {
    if (!s.clipboard || !s.clipboard.nodes.length) return {}
    const minX = Math.min(...s.clipboard.nodes.map(n => n.position.x))
    const minY = Math.min(...s.clipboard.nodes.map(n => n.position.y))
    const shift = { x: pos.x - minX, y: pos.y - minY }
    const idMap = new Map<string, string>()
    const baseNext = s.nextId
    let counter = 0
    const newNodes: Node[] = s.clipboard.nodes.map((n) => {
      const newId = genId('n', baseNext + counter++)
      idMap.set(n.id, newId)
      return { ...n, id: newId, selected: false, position: { x: n.position.x + shift.x, y: n.position.y + shift.y } }
    })
    const newEdges: Edge[] = s.clipboard.edges.map((e) => ({
      ...e,
      id: `${idMap.get(e.source)}-${idMap.get(e.target)}-${Math.random().toString(36).slice(2, 6)}`,
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
      selected: false,
    }))
    return {
      nodes: [...s.nodes, ...newNodes],
      edges: [...s.edges, ...newEdges],
      nextId: baseNext + counter,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
  selectAll: () => set((s) => ({
    nodes: s.nodes.map(n => ({ ...n, selected: true })),
    edges: s.edges.map(e => ({ ...e, selected: true })),
  })),
  clearSelection: () => set((s) => ({
    nodes: s.nodes.map(n => ({ ...n, selected: false })),
    edges: s.edges.map(e => ({ ...e, selected: false })),
  })),
  invertSelection: () => set((s) => ({
    nodes: s.nodes.map(n => ({ ...n, selected: !n.selected })),
    edges: s.edges.map(e => ({ ...e, selected: !e.selected })),
  })),
  addGroupForSelection: (name) => set((s) => {
    const selected = s.nodes.filter(n => n.selected).map(n => n.id)
    if (selected.length < 2) return {}
    // block partial overlaps: if any group intersects but is not exactly equal, do nothing
    const selSet = new Set(selected)
    for (const g of s.groups) {
      const interCount = g.nodeIds.filter(id => selSet.has(id)).length
      if (interCount > 0 && (interCount !== g.nodeIds.length || g.nodeIds.length !== selected.length)) {
        return {}
      }
      // also prevent grouping if selection is a superset of a group's nodes
      if (g.nodeIds.every(id => selSet.has(id)) && g.nodeIds.length < selected.length) {
        return {}
      }
    }
    const exists = s.groups.find(g => g.nodeIds.length === selected.length && g.nodeIds.every(id => selSet.has(id)))
    if (exists) return {}
    const id = `g${s.nextGroupId}`
    const rec: GroupRec = { id, name: name || '新建组', nodeIds: selected }
    return { groups: [...s.groups, rec], nextGroupId: s.nextGroupId + 1 }
  }),
  removeGroupById: (id) => set((s) => ({ groups: s.groups.filter(g => g.id !== id) })),
  findGroupMatchingSelection: () => {
    const s = get()
    const selected = s.nodes.filter(n => n.selected).map(n => n.id)
    if (selected.length < 2) return null
    return s.groups.find(g => g.nodeIds.length === selected.length && g.nodeIds.every(id => selected.includes(id))) || null
  },
  renameGroup: (id, name) => set((s) => ({ groups: s.groups.map(g => g.id === id ? { ...g, name } : g) })),
}))

export function persistToLocalStorage(key = 'tapcanvas-flow') {
  const state = useRFStore.getState()
  const payload = JSON.stringify({ nodes: state.nodes, edges: state.edges, groups: state.groups })
  localStorage.setItem(key, payload)
}

export function restoreFromLocalStorage(key = 'tapcanvas-flow') {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as { nodes: Node[]; edges: Edge[]; groups?: GroupRec[] }
  } catch {
    return null
  }
}
