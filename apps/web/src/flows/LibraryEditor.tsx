import React, { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, { Background, Controls, MiniMap, ReactFlowProvider, ConnectionLineType, addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type Node } from 'reactflow'
import 'reactflow/dist/style.css'
import TaskNode from '../canvas/nodes/TaskNode'
import { getFlow, saveFlow, type FlowIO, validateNoCycle } from './registry'
import { Button, Group, Title, TextInput, Stack, Text, Divider } from '@mantine/core'

type Props = { flowId: string; onClose: () => void }

export default function LibraryEditor({ flowId, onClose }: Props) {
  const rec = getFlow(flowId)
  const [nodes, setNodes] = useState<Node[]>(rec?.nodes || [])
  const [edges, setEdges] = useState<Edge[]>(rec?.edges || [])
  const [name, setName] = useState(rec?.name || '')
  const [io, setIo] = useState<FlowIO>(rec?.io || { inputs: [], outputs: [] })

  useEffect(() => {
    const r = getFlow(flowId)
    if (r) {
      setNodes(r.nodes); setEdges(r.edges); setName(r.name); setIo(r.io || { inputs: [], outputs: [] })
    }
  }, [flowId])

  const onNodesChange = useCallback((changes: any[]) => setNodes((nds) => applyNodeChanges(changes, nds)), [])
  const onEdgesChange = useCallback((changes: any[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), [])
  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge({ ...c, type: 'smoothstep', animated: true }, eds)), [])

  const saveAll = () => {
    const v = validateNoCycle(flowId)
    if (!v.ok) { alert(v.reason || '存在引用环，请先移除环再保存'); return }
    saveFlow({ id: flowId, name, nodes, edges, io })
    onClose()
  }

  const addPort = (dir: 'inputs'|'outputs') => {
    const label = prompt('端口名称：')?.trim(); if (!label) return
    const type = prompt('端口类型（image/audio/subtitle/video/any）：', 'any')?.trim() as any
    setIo((prev) => ({ ...prev, [dir]: [...prev[dir], { id: `${dir}-${Date.now().toString(36)}`, label, type }] }))
  }
  const removePort = (dir: 'inputs'|'outputs', id: string) => setIo((prev)=>({ ...prev, [dir]: prev[dir].filter(p=>p.id !== id) }))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '92%', height: '92%', background: 'var(--mantine-color-default)', color: 'inherit', borderRadius: 12, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,.35)', display: 'grid', gridTemplateColumns: '1fr 320px', border: '1px solid rgba(127,127,127,.25)' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 10, borderBottom: '1px solid rgba(127,127,127,.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Title order={5}>工作流编辑</Title>
            <Group gap="xs">
              <Button size="xs" onClick={saveAll}>保存</Button>
              <Button size="xs" variant="light" onClick={onClose}>关闭</Button>
            </Group>
          </div>
          <div style={{ height: '100%' }}>
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={{ taskNode: TaskNode }}
                fitView
                connectionLineType={ConnectionLineType.SmoothStep}
              >
                <MiniMap />
                <Controls />
                <Background gap={16} size={1} color="#2a2f3a" variant="dots" />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
        </div>
        <div style={{ borderLeft: '1px solid rgba(127,127,127,.2)', padding: 12, overflow: 'auto' }}>
          <Title order={6}>配置</Title>
          <TextInput label="名称" value={name} onChange={(e)=>setName(e.currentTarget.value)} />
          <Divider my={10} />
          <Title order={6}>IO 端口</Title>
          <Text size="xs" c="dimmed">Inputs</Text>
          {io.inputs.length === 0 && <Text size="xs" c="dimmed">无</Text>}
          <Stack gap={6}>
            {io.inputs.map(p => (
              <Group key={p.id} justify="space-between">
                <Text size="sm">{p.label} <Text span c="dimmed">({p.type})</Text></Text>
                <Button size="xs" color="red" variant="subtle" onClick={()=>removePort('inputs', p.id)}>删除</Button>
              </Group>
            ))}
          </Stack>
          <Button mt={6} variant="subtle" onClick={()=>addPort('inputs')}>+ 添加输入</Button>

          <Divider my={10} />
          <Text size="xs" c="dimmed">Outputs</Text>
          {io.outputs.length === 0 && <Text size="xs" c="dimmed">无</Text>}
          <Stack gap={6}>
            {io.outputs.map(p => (
              <Group key={p.id} justify="space-between">
                <Text size="sm">{p.label} <Text span c="dimmed">({p.type})</Text></Text>
                <Button size="xs" color="red" variant="subtle" onClick={()=>removePort('outputs', p.id)}>删除</Button>
              </Group>
            ))}
          </Stack>
          <Button mt={6} variant="subtle" onClick={()=>addPort('outputs')}>+ 添加输出</Button>
        </div>
      </div>
    </div>
  )
}
