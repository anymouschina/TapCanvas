import React, { useCallback, useEffect } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  NodeTypes,
  ConnectionLineType,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'

import TaskNode from './nodes/TaskNode'
import { persistToLocalStorage, restoreFromLocalStorage, useRFStore } from './store'

const nodeTypes: NodeTypes = {
  taskNode: TaskNode,
}

function CanvasInner(): JSX.Element {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, load } = useRFStore()
  const rf = useReactFlow()

  useEffect(() => {
    // initial load
    const restored = restoreFromLocalStorage()
    if (restored && restored.nodes.length) {
      load(restored)
      setTimeout(() => rf.fitView?.({ padding: 0.2 }), 50)
    }
    // autosave
    const h = setInterval(() => persistToLocalStorage(), 1500)
    return () => clearInterval(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onInit = useCallback(() => rf.fitView?.({ padding: 0.2 }), [rf])

  const onDragOver = useCallback((evt: React.DragEvent) => {
    evt.preventDefault()
    evt.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback((evt: React.DragEvent) => {
    evt.preventDefault()
    const txt = evt.dataTransfer.getData('application/reactflow')
    if (!txt) return
    const data = JSON.parse(txt) as { type: string; label?: string; kind?: string }
    const pos = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY })
    // create node via store but place at computed position
    useRFStore.setState((s) => {
      const id = `n${s.nextId}`
      const node = {
        id,
        type: data.type as any,
        position: pos,
        data: { label: data.label ?? data.type, kind: data.kind },
      }
      return { nodes: [...s.nodes, node], nextId: s.nextId + 1 }
    })
  }, [rf])

  const isValidEdgeByType = useCallback((sourceKind?: string, targetKind?: string) => {
    if (!sourceKind || !targetKind) return true
    // Allowed: textToImage -> composeVideo; tts -> composeVideo; subtitleAlign -> composeVideo
    if (targetKind === 'composeVideo') return ['textToImage','tts','subtitleAlign','composeVideo'].includes(sourceKind)
    // composeVideo cannot feed others in this mock
    return false
  }, [])

  const createsCycle = useCallback((proposed: { source?: string|null; target?: string|null }) => {
    const sId = proposed.source
    const tId = proposed.target
    if (!sId || !tId) return false
    // Build adjacency including proposed edge
    const adj = new Map<string, string[]>()
    nodes.forEach(n => adj.set(n.id, []))
    edges.forEach(e => {
      if (e.source && e.target) {
        if (!adj.has(e.source)) adj.set(e.source, [])
        adj.get(e.source)!.push(e.target)
      }
    })
    if (!adj.has(sId)) adj.set(sId, [])
    adj.get(sId)!.push(tId)
    // DFS from target to see if we can reach source
    const seen = new Set<string>()
    const stack = [tId]
    while (stack.length) {
      const u = stack.pop()!
      if (u === sId) return true
      if (seen.has(u)) continue
      seen.add(u)
      for (const v of adj.get(u) || []) stack.push(v)
    }
    return false
  }, [nodes, edges])

  return (
    <div style={{ height: '100%', width: '100%' }} onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        onInit={onInit}
        selectionOnDrag
        panOnScroll
        zoomOnPinch
        zoomOnScroll
        proOptions={{ hideAttribution: true }}
        isValidConnection={(c) => {
          if (!c.source || !c.target) return false
          if (c.source === c.target) return false
          if (createsCycle({ source: c.source, target: c.target })) return false
          const dup = edges.some(e => e.source === c.source && e.target === c.target)
          if (dup) return false
          const sKind = nodes.find(n => n.id === c.source)?.data?.kind as string | undefined
          const tKind = nodes.find(n => n.id === c.target)?.data?.kind as string | undefined
          return isValidEdgeByType(sKind, tKind)
        }}
        snapToGrid
        snapGrid={[16, 16]}
        defaultEdgeOptions={{ animated: true, type: 'smoothstep' }}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#8b5cf6', strokeWidth: 2 }}
      >
        <MiniMap />
        <Controls position="bottom-right" />
        <Background gap={16} size={1} />
      </ReactFlow>
    </div>
  )
}

export default function Canvas(): JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
