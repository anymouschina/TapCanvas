import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Background, Controls, MiniMap, ReactFlowProvider, ConnectionLineType, addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import TaskNode from '../canvas/nodes/TaskNode'
import { useRFStore } from '../canvas/store'
import { Button, Group, Title } from '@mantine/core'
import { usePreventBrowserSwipeNavigation } from '../utils/usePreventBrowserSwipeNavigation'

type Props = { nodeId: string; onClose: () => void }

export default function SubflowEditor({ nodeId, onClose }: Props) {
  const node = useRFStore(s => s.nodes.find(n => n.id === nodeId))
  const updateNodeData = useRFStore(s => s.updateNodeData)
  const [open, setOpen] = useState(true)
  const [nodes, setNodes] = useState<Node[]>(() => (node?.data as any)?.subflow?.nodes || [])
  const [edges, setEdges] = useState<Edge[]>(() => (node?.data as any)?.subflow?.edges || [])
  const rootRef = useRef<HTMLDivElement | null>(null)

  usePreventBrowserSwipeNavigation({ rootRef, withinSelector: '.tc-subflow-editor__flow' })

  const onNodesChange = useCallback((changes: any[]) => setNodes((nds) => applyNodeChanges(changes, nds)), [])
  const onEdgesChange = useCallback((changes: any[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), [])
  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge({ ...c, type: 'smoothstep', animated: true }, eds)), [])

  const save = () => {
    updateNodeData(nodeId, { subflow: { nodes, edges } })
    onClose()
  }

  if (!open) return null
  return (
    <div className="tc-subflow-editor" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="tc-subflow-editor__panel" ref={rootRef} style={{ width: '88%', height: '88%', background: 'var(--mantine-color-default)', color: 'inherit', borderRadius: 12, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,.35)', border: '1px solid rgba(127,127,127,.25)' }}>
        <div className="tc-subflow-editor__header" style={{ padding: 10, borderBottom: '1px solid rgba(127,127,127,.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title className="tc-subflow-editor__title" order={5}>编辑子工作流 - {node?.data?.label || nodeId}</Title>
          <Group className="tc-subflow-editor__actions" gap="xs">
            <Button className="tc-subflow-editor__action" size="xs" onClick={save}>保存</Button>
            <Button className="tc-subflow-editor__action" size="xs" variant="light" onClick={onClose}>关闭</Button>
          </Group>
        </div>
        <div className="tc-subflow-editor__canvas" style={{ height: 'calc(100% - 44px)' }}>
          <ReactFlowProvider>
            <ReactFlow
              className="tc-subflow-editor__flow"
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={{ taskNode: TaskNode }}
              fitView
              connectionLineType={ConnectionLineType.SmoothStep}
            >
              <MiniMap className="tc-subflow-editor__minimap" />
              <Controls className="tc-subflow-editor__controls" position="bottom-left" />
              <Background className="tc-subflow-editor__background" gap={16} size={1} color="#2a2f3a" variant="dots" />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </div>
    </div>
  )
}
