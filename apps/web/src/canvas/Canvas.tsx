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
    const data = JSON.parse(txt) as { type: string; label?: string }
    const pos = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY })
    // create node via store but place at computed position
    useRFStore.setState((s) => {
      const id = `n${s.nextId}`
      const node = {
        id,
        type: data.type as any,
        position: pos,
        data: { label: data.label ?? data.type },
      }
      return { nodes: [...s.nodes, node], nextId: s.nextId + 1 }
    })
  }, [rf])

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
