import { create } from 'zustand'
import type { Edge, Node, OnConnect, OnEdgesChange, OnNodesChange, Connection } from 'reactflow'
import { addEdge, applyEdgeChanges, applyNodeChanges } from 'reactflow'
import { runNodeMock } from '../runner/mockRunner'
import { runNodeRemote } from '../runner/remoteRunner'
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
  ungroupGroupNode: (id: string) => void
  layoutGridSelected: () => void
  layoutHorizontalSelected: () => void
  runSelectedGroup: () => Promise<void>
  renameSelectedGroup: () => void
  autoLayoutSelectedDag: () => void
  autoLayoutAllDag: () => void
  autoLayoutForParent: (parentId: string|null) => void
}

// 生成节点唯一 ID，优先使用浏览器原生 UUID
function genNodeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID() as string
  }
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function genGroupId(n: number) {
  return `g${n}`
}

function cloneGraph(nodes: Node[], edges: Edge[]) {
  return JSON.parse(JSON.stringify({ nodes, edges })) as { nodes: Node[]; edges: Edge[] }
}

function getRemixTargetIdFromNode(node?: Node) {
  const data = node?.data as any
  if (!data) return null
  const model = String(data.videoModel || '').toLowerCase()
  const normalized = model.replace('_', '-')
  if (normalized && !['sora-2', 'sy-8', 'sy_8'].includes(model) && !['sora-2', 'sy-8', 'sy_8'].includes(normalized)) return null
  const candidates = [
    data.videoPostId,
    data.videoDraftId,
    data.videoTaskId,
    data.soraVideoTask?.generation_id,
    data.soraVideoTask?.id,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
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
    const nextEdges = exists ? s.edges : addEdge({ ...connection, animated: true, type: 'smoothstep' }, s.edges)
    const past = exists ? s.historyPast : [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    if (exists) {
      return { edges: nextEdges }
    }

    let updatedNodes = s.nodes
    if (
      connection.target &&
      connection.source &&
      connection.targetHandle === 'in-video'
    ) {
      const targetNode = s.nodes.find((n) => n.id === connection.target)
      const sourceNode = s.nodes.find((n) => n.id === connection.source)
      if (
        targetNode &&
        ['composeVideo', 'video'].includes(String((targetNode.data as any)?.kind))
      ) {
        const remixId = getRemixTargetIdFromNode(sourceNode)
        if (remixId) {
          updatedNodes = s.nodes.map((n) =>
            n.id === connection.target
              ? { ...n, data: { ...n.data, remixTargetId: remixId } }
              : n,
          )
        }
      }
    }

    return {
      nodes: updatedNodes,
      edges: nextEdges,
      historyPast: past,
      historyFuture: [],
    }
  }),
  addNode: (type, label, extra) => set((s) => {
    const id = genNodeId()
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
  removeSelected: () => set((s) => {
    const selectedNodes = s.nodes.filter(n => n.selected)
    const selectedIds = new Set(selectedNodes.map(n => n.id))

    // 收集所有需要删除的节点ID：包括选中的节点和它们的子节点
    const idsToDelete = new Set<string>()
    selectedIds.forEach(id => {
      idsToDelete.add(id)

      // 如果选中的是组节点，添加所有子节点
      const node = selectedNodes.find(n => n.id === id)
      if (node?.type === 'groupNode') {
        const childNodes = s.nodes.filter(n => n.parentNode === id)
        childNodes.forEach(child => idsToDelete.add(child.id))
      }
    })

    // 如果选中的是子节点，也检查是否需要删除父节点（如果父节点的所有子节点都被选中）
    const selectedChildNodes = selectedNodes.filter(n => n.parentNode && selectedIds.has(n.parentNode))
    selectedChildNodes.forEach(child => {
      const parentNode = s.nodes.find(n => n.id === child.parentNode)
      if (parentNode && parentNode.type === 'groupNode') {
        const allChildren = s.nodes.filter(n => n.parentNode === parentNode.id)
        const allChildrenSelected = allChildren.every(child => selectedIds.has(child.id))

        // 如果所有子节点都被选中，也删除父节点
        if (allChildrenSelected) {
          idsToDelete.add(parentNode.id)
        }
      }
    })

    // 删除节点和相关边
    const remainingNodes = s.nodes.filter(n => !idsToDelete.has(n.id))
    const remainingEdges = s.edges.filter(e =>
      !idsToDelete.has(e.source) && !idsToDelete.has(e.target)
    )

    return {
      nodes: remainingNodes,
      edges: remainingEdges,
      historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
      historyFuture: [],
    }
  }),
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
    const kind = (selected.data as any)?.kind as string | undefined
    if (kind === 'textToImage' || kind === 'composeVideo' || kind === 'tts' || kind === 'subtitleAlign' || kind === 'image') {
      await runNodeRemote(selected.id, get, set)
    } else {
      await runNodeMock(selected.id, get, set)
    }
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
    const graph = { nodes: selNodes, edges: selEdges }
    // 尝试同时复制到系统剪贴板，便于粘贴到外部文档
    try {
      const text = JSON.stringify(graph, null, 2)
      void navigator.clipboard?.writeText(text)
    } catch {
      // ignore clipboard errors
    }
    return { clipboard: graph }
  }),
  pasteFromClipboard: () => set((s) => {
    if (!s.clipboard || !s.clipboard.nodes.length) return {}
    const offset = { x: 24, y: 24 }
    const idMap = new Map<string, string>()
    const newNodes: Node[] = s.clipboard.nodes.map((n) => {
      const newId = genNodeId()
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
      nextId: s.nextId + newNodes.length,
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
    const newId = genNodeId()
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
    const newNodes: Node[] = s.clipboard.nodes.map((n) => {
      const newId = genNodeId()
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
      nextId: s.nextId + newNodes.length,
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
    const selectedNodes = s.nodes.filter(n => n.selected && n.type !== 'groupNode')
    if (selectedNodes.length < 2) return {}
    // ensure all selected share same parent (or no parent)
    const parents = new Set(selectedNodes.map(n => n.parentNode || ''))
    if (parents.size > 1) return {}
    // compute bbox in absolute coordinates (assume current parent is same)
    const padding = 8
    const minX = Math.min(...selectedNodes.map(n => n.position.x + (0)))
    const minY = Math.min(...selectedNodes.map(n => n.position.y + (0)))
    const defaultW = 180, defaultH = 96
    const maxX = Math.max(...selectedNodes.map(n => n.position.x + (((n as any).width) || defaultW)))
    const maxY = Math.max(...selectedNodes.map(n => n.position.y + (((n as any).height) || defaultH)))
    const gid = genGroupId(s.nextGroupId)
    const groupNode: Node = {
      id: gid,
      type: 'groupNode' as any,
      position: { x: minX - padding, y: minY - padding },
      data: { label: name || '新建组' },
      style: { width: (maxX - minX) + padding * 2, height: (maxY - minY) + padding * 2, zIndex: 0, background: 'transparent' },
      draggable: true,
      selectable: true,
    }
    // reparent children to this group; convert positions to relative
    const members = new Set(selectedNodes.map(n => n.id))
    const newNodes: Node[] = s.nodes.map((n) => {
      if (!members.has(n.id)) return n
      const rel = { x: n.position.x - groupNode.position.x, y: n.position.y - groupNode.position.y }
      return { ...n, parentNode: gid, position: rel, extent: 'parent' as any, selected: false }
    })
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: [...newNodes, groupNode].map(n => n.id === gid ? { ...n, selected: true } : n), nextGroupId: s.nextGroupId + 1, historyPast: past, historyFuture: [] }
  }),
  removeGroupById: (id) => set((s) => {
    // if it's a legacy record, drop it; if there's a group node, ungroup it
    const hasGroupNode = s.nodes.some(n => n.id === id && n.type === 'groupNode')
    if (hasGroupNode) {
      const group = s.nodes.find(n => n.id === id)!
      const children = s.nodes.filter(n => n.parentNode === id)
      const restored = s.nodes
        .filter(n => n.id !== id)
        .map(n => n.parentNode === id ? { ...n, parentNode: undefined, extent: undefined, position: { x: (group.position as any).x + n.position.x, y: (group.position as any).y + n.position.y } } : n)
      const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
      return { nodes: restored, historyPast: past, historyFuture: [] }
    }
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { groups: s.groups.filter(g => g.id !== id), historyPast: past, historyFuture: [] }
  }),
  findGroupMatchingSelection: () => {
    const s = get()
    const selected = s.nodes.filter(n => n.selected).map(n => n.id)
    if (selected.length < 2) return null
    return s.groups.find(g => g.nodeIds.length === selected.length && g.nodeIds.every(id => selected.includes(id))) || null
  },
  renameGroup: (id, name) => set((s) => ({ groups: s.groups.map(g => g.id === id ? { ...g, name } : g) })),
  ungroupGroupNode: (id) => set((s) => {
    const group = s.nodes.find(n => n.id === id && n.type === 'groupNode')
    if (!group) return {}
    const children = s.nodes.filter(n => n.parentNode === id)
    const restored = s.nodes
      .filter(n => n.id !== id)
      .map(n => n.parentNode === id ? { ...n, parentNode: undefined, extent: undefined, position: { x: (group.position as any).x + n.position.x, y: (group.position as any).y + n.position.y } } : n)
    // select children after ungroup
    const childIds = new Set(children.map(c => c.id))
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: restored.map(n => ({ ...n, selected: childIds.has(n.id) })), historyPast: past, historyFuture: [] }
  }),
  // DAG auto layout for selected nodes (per parent container)
  autoLayoutSelectedDag: () => set((s) => {
    const sel = s.nodes.filter(n => n.selected)
    if (sel.length < 2) return {}
    const byParent = new Map<string, typeof sel>()
    sel.forEach(n => {
      const p = (n.parentNode as string) || ''
      if (!byParent.has(p)) byParent.set(p, [])
      byParent.get(p)!.push(n)
    })
    const edgesBySel = s.edges.filter(e => sel.some(n=>n.id===e.source) && sel.some(n=>n.id===e.target))
    const updated = [...s.nodes]
    const gapX = 280, gapY = 140
    byParent.forEach(nodesInParent => {
      const idSet = new Set(nodesInParent.map(n=>n.id))
      const adj = new Map<string,string[]>()
      const indeg = new Map<string,number>()
      nodesInParent.forEach(n=>{ adj.set(n.id, []); indeg.set(n.id, 0) })
      edgesBySel.forEach(e=>{ if(idSet.has(e.source) && idSet.has(e.target)) { adj.get(e.source)!.push(e.target); indeg.set(e.target, (indeg.get(e.target)||0)+1) } })
      const q:string[]=[]; indeg.forEach((v,k)=>{ if(v===0) q.push(k) })
      const layers: string[][] = []
      const layerOf = new Map<string,number>()
      while(q.length){
        const levelSize = q.length
        const layer: string[] = []
        for(let i=0;i<levelSize;i++){
          const u = q.shift()!
          layer.push(u); layerOf.set(u, layers.length)
          for(const v of adj.get(u)||[]){ const nv=(indeg.get(v)||0)-1; indeg.set(v,nv); if(nv===0) q.push(v) }
        }
        layers.push(layer)
      }
      const minX = Math.min(...nodesInParent.map(n=>n.position.x))
      const minY = Math.min(...nodesInParent.map(n=>n.position.y))
      layers.forEach((layer, li) => {
        const sorted = layer.map(id => nodesInParent.find(n=>n.id===id)!).filter(Boolean).sort((a,b)=> a.position.y-b.position.y)
        sorted.forEach((n, idx) => {
          const i = updated.findIndex(x=>x.id===n.id)
          if (i>=0) updated[i] = { ...updated[i], position: { x: minX + li*gapX, y: minY + idx*gapY } }
        })
      })
    })
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: updated, historyPast: past, historyFuture: [] }
  }),
  // DAG auto layout for the whole graph, per parent container
  autoLayoutAllDag: () => set((s) => {
    const byParent = new Map<string, Node[]>()
    s.nodes.forEach(n => { const p=(n.parentNode as string)||''; if(!byParent.has(p)) byParent.set(p, []); byParent.get(p)!.push(n) })
    const updated = [...s.nodes]
    const gapX = 280, gapY = 140
    byParent.forEach(nodesInParent => {
      const idSet = new Set(nodesInParent.map(n=>n.id))
      const adj = new Map<string,string[]>()
      const indeg = new Map<string,number>()
      nodesInParent.forEach(n=>{ adj.set(n.id, []); indeg.set(n.id, 0) })
      s.edges.forEach(e=>{ if(idSet.has(e.source) && idSet.has(e.target)) { adj.get(e.source)!.push(e.target); indeg.set(e.target, (indeg.get(e.target)||0)+1) } })
      const q:string[]=[]; indeg.forEach((v,k)=>{ if(v===0) q.push(k) })
      const layers: string[][] = []
      while(q.length){
        const levelSize = q.length
        const layer: string[] = []
        for(let i=0;i<levelSize;i++){
          const u = q.shift()!
          layer.push(u)
          for(const v of adj.get(u)||[]){ const nv=(indeg.get(v)||0)-1; indeg.set(v,nv); if(nv===0) q.push(v) }
        }
        layers.push(layer)
      }
      const minX = Math.min(...nodesInParent.map(n=>n.position.x))
      const minY = Math.min(...nodesInParent.map(n=>n.position.y))
      layers.forEach((layer, li) => {
        const sorted = layer.map(id => nodesInParent.find(n=>n.id===id)!).filter(Boolean).sort((a,b)=> a.position.y-b.position.y)
        sorted.forEach((n, idx) => {
          const i = updated.findIndex(x=>x.id===n.id)
          if (i>=0) updated[i] = { ...updated[i], position: { x: minX + li*gapX, y: minY + idx*gapY } }
        })
      })
    })
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: updated, historyPast: past, historyFuture: [] }
  }),
  autoLayoutForParent: (parentId) => set((s) => {
    const nodesInParent = s.nodes.filter(n => (n.parentNode||null) === parentId)
    if (!nodesInParent.length) return {}
    const idSet = new Set(nodesInParent.map(n=>n.id))
    const adj = new Map<string,string[]>()
    const indeg = new Map<string,number>()
    nodesInParent.forEach(n=>{ adj.set(n.id, []); indeg.set(n.id, 0) })
    s.edges.forEach(e=>{ if(idSet.has(e.source) && idSet.has(e.target)) { adj.get(e.source)!.push(e.target); indeg.set(e.target, (indeg.get(e.target)||0)+1) } })
    const q:string[]=[]; indeg.forEach((v,k)=>{ if(v===0) q.push(k) })
    const layers: string[][] = []
    while(q.length){
      const levelSize = q.length
      const layer: string[] = []
      for(let i=0;i<levelSize;i++){
        const u = q.shift()!
        layer.push(u)
        for(const v of adj.get(u)||[]){ const nv=(indeg.get(v)||0)-1; indeg.set(v,nv); if(nv===0) q.push(v) }
      }
      layers.push(layer)
    }
    const updated = [...s.nodes]
    const gapX = 260, gapY = 120
    const minX = Math.min(...nodesInParent.map(n=>n.position.x))
    const minY = Math.min(...nodesInParent.map(n=>n.position.y))
    layers.forEach((layer, li) => {
      const sorted = layer.map(id => nodesInParent.find(n=>n.id===id)!).filter(Boolean).sort((a,b)=> a.position.y-b.position.y)
      sorted.forEach((n, idx) => {
        const i = updated.findIndex(x=>x.id===n.id)
        if (i>=0) updated[i] = { ...updated[i], position: { x: minX + li*gapX, y: minY + idx*gapY } }
      })
    })
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: updated, historyPast: past, historyFuture: [] }
  }),
  layoutGridSelected: () => set((s) => {
    const sel = s.nodes.filter(n => n.selected)
    if (sel.length < 2) return {}
    const byParent = new Map<string, typeof sel>()
    sel.forEach(n => {
      const p = (n.parentNode as string) || ''
      if (!byParent.has(p)) byParent.set(p, [])
      byParent.get(p)!.push(n)
    })
    const gapX = 220, gapY = 140
    const updated = s.nodes.map(n => {
      if (!n.selected) return n
      const parent = (n.parentNode as string) || ''
      const group = byParent.get(parent) || []
      const nodesSorted = [...group].sort((a,b)=> (a.position.y-b.position.y) || (a.position.x-b.position.x))
      const cols = Math.ceil(Math.sqrt(nodesSorted.length))
      const minX = Math.min(...nodesSorted.map(x=>x.position.x))
      const minY = Math.min(...nodesSorted.map(x=>x.position.y))
      const idx = nodesSorted.findIndex(m => m.id === n.id)
      const r = Math.floor(idx / cols)
      const c = idx % cols
      return { ...n, position: { x: minX + c*gapX, y: minY + r*gapY } }
    })
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: updated, historyPast: past, historyFuture: [] }
  }),
  layoutHorizontalSelected: () => set((s) => {
    const sel = s.nodes.filter(n => n.selected)
    if (sel.length < 2) return {}
    const byParent = new Map<string, typeof sel>()
    sel.forEach(n => {
      const p = (n.parentNode as string) || ''
      if (!byParent.has(p)) byParent.set(p, [])
      byParent.get(p)!.push(n)
    })
    const gapX = 220
    const updated = s.nodes.map(n => {
      if (!n.selected) return n
      const parent = (n.parentNode as string) || ''
      const group = byParent.get(parent) || []
      const nodesSorted = [...group].sort((a,b)=> a.position.x - b.position.x)
      const minX = Math.min(...nodesSorted.map(x=>x.position.x))
      const minY = Math.min(...nodesSorted.map(x=>x.position.y))
      const idx = nodesSorted.findIndex(m => m.id === n.id)
      return { ...n, position: { x: minX + idx*gapX, y: minY } }
    })
    const past = [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50)
    return { nodes: updated, historyPast: past, historyFuture: [] }
  }),
  runSelectedGroup: async () => {
    const s = get()
    const g = s.nodes.find((n: any) => n.type === 'groupNode' && n.selected)
    if (!g) return
    const only = new Set(s.nodes.filter((n: any) => n.parentNode === g.id).map((n:any)=>n.id))
    await runFlowDag(2, get, set, { only })
  },
  renameSelectedGroup: () => set((s) => {
    const g = s.nodes.find((n: any) => n.type === 'groupNode' && n.selected)
    if (!g) return {}
    return { nodes: s.nodes.map(n => n.id === g.id ? { ...n, data: { ...(n.data||{}), editing: true } } : n) }
  }),
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
