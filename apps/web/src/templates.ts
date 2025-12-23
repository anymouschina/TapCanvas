import type { Edge, Node } from '@xyflow/react'
import { useRFStore } from './canvas/store'

export type FlowData = { nodes: Node[]; edges: Edge[] }

const KEY = 'tapcanvas-templates'

function readTemplates(): Record<string, FlowData> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function writeTemplates(obj: Record<string, FlowData>) {
  localStorage.setItem(KEY, JSON.stringify(obj))
}

export function listTemplateNames(): string[] {
  return Object.keys(readTemplates())
}

export function saveTemplate(name: string, data: FlowData) {
  const all = readTemplates()
  all[name] = data
  writeTemplates(all)
}

export function deleteTemplate(name: string) {
  const all = readTemplates()
  if (all[name]) {
    delete all[name]
    writeTemplates(all)
  }
}

export function renameTemplate(oldName: string, newName: string) {
  const all = readTemplates()
  if (!all[oldName]) return
  all[newName] = all[oldName]
  delete all[oldName]
  writeTemplates(all)
}

export function captureCurrentSelection(): FlowData | null {
  const s = useRFStore.getState()
  const nodes = s.nodes.filter(n => n.selected)
  if (!nodes.length) return null
  const setIds = new Set(nodes.map(n => n.id))
  const edges = s.edges.filter(e => setIds.has(e.source) && setIds.has(e.target))
  return { nodes, edges }
}

export function applyTemplate(name: string) {
  const tpl = readTemplates()[name]
  if (!tpl) return
  const s = useRFStore.getState()
  const baseNext = s.nextId
  let counter = 0
  const idMap = new Map<string, string>()
  const offset = { x: 48, y: 48 }

  const newNodes: Node[] = tpl.nodes.map((n) => {
    const newId = `n${baseNext + counter++}`
    idMap.set(n.id, newId)
    return { ...n, id: newId, selected: false, position: { x: n.position.x + offset.x, y: n.position.y + offset.y } }
  })
  const newEdges: Edge[] = tpl.edges.map((e) => ({
    ...e,
    id: `${idMap.get(e.source)}-${idMap.get(e.target)}-${Math.random().toString(36).slice(2, 6)}`,
    source: idMap.get(e.source) || e.source,
    target: idMap.get(e.target) || e.target,
    selected: false,
  }))

  useRFStore.setState((state) => ({
    nodes: [...state.nodes, ...newNodes],
    edges: [...state.edges, ...newEdges],
    nextId: baseNext + counter,
  }))
}

export function applyTemplateAt(name: string, pos: { x: number; y: number }) {
  const tpl = readTemplates()[name]
  if (!tpl) return
  const s = useRFStore.getState()
  const baseNext = s.nextId
  let counter = 0
  const idMap = new Map<string, string>()
  const minX = Math.min(...tpl.nodes.map(n => n.position.x))
  const minY = Math.min(...tpl.nodes.map(n => n.position.y))
  const shift = { x: pos.x - minX, y: pos.y - minY }

  const newNodes: Node[] = tpl.nodes.map((n) => {
    const newId = `n${baseNext + counter++}`
    idMap.set(n.id, newId)
    return { ...n, id: newId, selected: false, position: { x: n.position.x + shift.x, y: n.position.y + shift.y } }
  })
  const newEdges: Edge[] = tpl.edges.map((e) => ({
    ...e,
    id: `${idMap.get(e.source)}-${idMap.get(e.target)}-${Math.random().toString(36).slice(2, 6)}`,
    source: idMap.get(e.source) || e.source,
    target: idMap.get(e.target) || e.target,
    selected: false,
  }))

  useRFStore.setState((state) => ({
    nodes: [...state.nodes, ...newNodes],
    edges: [...state.edges, ...newEdges],
    nextId: baseNext + counter,
  }))
}
