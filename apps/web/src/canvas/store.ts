import { create } from 'zustand'
import type { Edge, Node, OnConnect, OnEdgesChange, OnNodesChange, Connection } from 'reactflow'
import { addEdge, applyEdgeChanges, applyNodeChanges } from 'reactflow'

type RFState = {
  nodes: Node[]
  edges: Edge[]
  nextId: number
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  addNode: (type: string, label?: string) => void
  reset: () => void
  load: (data: { nodes: Node[]; edges: Edge[] } | null) => void
  removeSelected: () => void
}

export const useRFStore = create<RFState>((set, get) => ({
  nodes: [],
  edges: [],
  nextId: 1,
  onNodesChange: (changes) => set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),
  onEdgesChange: (changes) => set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),
  onConnect: (connection: Connection) => set((s) => {
    const exists = s.edges.some((e) =>
      e.source === connection.source &&
      e.target === connection.target &&
      e.sourceHandle === connection.sourceHandle &&
      e.targetHandle === connection.targetHandle
    )
    return exists ? { edges: s.edges } : { edges: addEdge({ ...connection, animated: true, type: 'smoothstep' }, s.edges) }
  }),
  addNode: (type, label) => set((s) => {
    const id = `n${s.nextId}`
    const node: Node = {
      id,
      type: type as any,
      position: { x: 80 + (s.nextId % 6) * 40, y: 80 + (s.nextId % 5) * 30 },
      data: { label: label ?? type },
    }
    return { nodes: [...s.nodes, node], nextId: s.nextId + 1 }
  }),
  reset: () => set({ nodes: [], edges: [], nextId: 1 }),
  load: (data) => {
    if (!data) return
    set({ nodes: data.nodes, edges: data.edges, nextId: data.nodes.length + 1 })
  },
  removeSelected: () => set((s) => ({
    nodes: s.nodes.filter((n) => !n.selected),
    edges: s.edges.filter((e) => !e.selected)
  })),
}))

export function persistToLocalStorage(key = 'tapcanvas-flow') {
  const state = useRFStore.getState()
  const payload = JSON.stringify({ nodes: state.nodes, edges: state.edges })
  localStorage.setItem(key, payload)
}

export function restoreFromLocalStorage(key = 'tapcanvas-flow') {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as { nodes: Node[]; edges: Edge[] }
  } catch {
    return null
  }
}
