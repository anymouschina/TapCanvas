import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ReactFlow, Background, Controls, MiniMap, ReactFlowProvider, ConnectionLineType, addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import TaskNode from '../canvas/nodes/TaskNode'
import { type FlowIO } from './registry'
import { listServerFlows, getServerFlow, saveServerFlow, deleteServerFlow, listFlowVersions, rollbackFlow, type FlowDto } from '../api/server'
import { Button, Group, Title, TextInput, Stack, Text, Divider, Select, Modal } from '@mantine/core'

type Props = { flowId: string; onClose: () => void }

export default function LibraryEditor({ flowId, onClose }: Props) {
  const [currentId, setCurrentId] = useState<string>(flowId)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [name, setName] = useState('')
  const [io, setIo] = useState<FlowIO>({ inputs: [], outputs: [] })
  const [serverList, setServerList] = useState<FlowDto[]>([])
  const [versions, setVersions] = useState<Array<{ id: string; createdAt: string; name: string }>>([])
  const [showHistory, setShowHistory] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Load initial
  useEffect(() => {
    (async () => {
      try {
        const r = await getServerFlow(flowId)
        const data = (r?.data || {}) as any
        setNodes(Array.isArray(data.nodes) ? data.nodes : [])
        setEdges(Array.isArray(data.edges) ? data.edges : [])
        setName(r?.name || '')
        setIo({ inputs: [], outputs: [] })
        setCurrentId(flowId)
        setDirty(false)
        try { setVersions(await listFlowVersions(flowId)) } catch { setVersions([]) }
      } catch {}
    })()
  }, [flowId])

  // Load lists when open
  useEffect(() => { listServerFlows().then(setServerList).catch(()=>setServerList([])) }, [])

  useEffect(() => { setDirty(true) }, [nodes, edges, name])

  const onNodesChange = useCallback((changes: any[]) => setNodes((nds) => applyNodeChanges(changes, nds)), [])
  const onEdgesChange = useCallback((changes: any[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), [])
  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge({ ...c, type: 'smoothstep', animated: true }, eds)), [])

  const saveAll = async () => {
    const saved = await saveServerFlow({ id: currentId, name, nodes, edges })
    setServerList(await listServerFlows())
    setCurrentId(saved.id)
    setDirty(false)
    onClose()
  }

  const saveAs = async () => {
    // 另存为（创建新ID）
    const v = validateNoCycle(currentId)
    if (!v.ok) { alert(v.reason || '存在引用环，请先移除环再另存'); return }
    if (source === 'local') {
      const saved = saveFlow({ name, nodes, edges, io })
      setLocalList(listFlows())
      setCurrentId(saved.id)
      alert('已另存为本地工作流: ' + saved.name)
    } else {
      const saved = await saveServerFlow({ name, nodes, edges })
      setServerList(await listServerFlows())
      setCurrentId(saved.id)
      alert('已另存为服务端工作流: ' + saved.name)
    }
  }

  const removeCurrent = async () => {
    if (!currentId) return
    if (!confirm('确定删除当前工作流吗？')) return
    await deleteServerFlow(currentId); setServerList(await listServerFlows())
    setDirty(false)
    onClose()
  }

  const loadById = async (id: string) => {
    setCurrentId(id)
    const r = await getServerFlow(id)
    const data = (r?.data || {}) as any
    setNodes(Array.isArray(data.nodes) ? data.nodes : [])
    setEdges(Array.isArray(data.edges) ? data.edges : [])
    setName(r?.name || '')
    setIo({ inputs: [], outputs: [] })
    try { setVersions(await listFlowVersions(id)) } catch { setVersions([]) }
  }

  const addPort = (dir: 'inputs'|'outputs') => {
    const label = prompt('端口名称：')?.trim(); if (!label) return
    const type = prompt('端口类型（image/audio/subtitle/video/any）：', 'any')?.trim() as any
    setIo((prev) => ({ ...prev, [dir]: [...prev[dir], { id: `${dir}-${Date.now().toString(36)}`, label, type }] }))
  }
  const removePort = (dir: 'inputs'|'outputs', id: string) => setIo((prev)=>({ ...prev, [dir]: prev[dir].filter(p=>p.id !== id) }))

  return (
    <div className="tc-library-editor" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="tc-library-editor__panel" style={{ width: '92%', height: '92%', background: 'var(--mantine-color-default)', color: 'inherit', borderRadius: 12, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,.35)', display: 'grid', gridTemplateColumns: '1fr 320px', border: '1px solid rgba(127,127,127,.25)' }}>
        <div className="tc-library-editor__main" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="tc-library-editor__header" style={{ padding: 10, borderBottom: '1px solid rgba(127,127,127,.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Title className="tc-library-editor__title" order={5}>工作流编辑</Title>
            <Group className="tc-library-editor__actions" gap="xs">
              <Select className="tc-library-editor__select" size="xs" placeholder="选择服务端工作流" data={serverList.map(f=>({ value: f.id, label: f.name }))} value={currentId} onChange={(v)=> v && loadById(v)} searchable clearable style={{ width: 260 }} />
              <Button className="tc-library-editor__action" size="xs" onClick={saveAll}>保存</Button>
              <Button className="tc-library-editor__action" size="xs" variant="light" onClick={saveAs}>另存为</Button>
              <Button className="tc-library-editor__action" size="xs" variant="light" onClick={async ()=>{ setShowHistory(true); try { setVersions(await listFlowVersions(currentId)) } catch { setVersions([]) } }}>历史</Button>
              <Button className="tc-library-editor__action" size="xs" variant="light" color="red" onClick={removeCurrent}>删除</Button>
              <Button className="tc-library-editor__action" size="xs" variant="light" onClick={()=>{ if (dirty && !confirm('有未保存更改，确定关闭？')) return; onClose() }}>关闭</Button>
            </Group>
          </div>
          <div className="tc-library-editor__canvas" style={{ height: '100%' }}>
            <ReactFlowProvider>
              <ReactFlow
                className="tc-library-editor__flow"
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={{ taskNode: TaskNode }}
                fitView
                connectionLineType={ConnectionLineType.SmoothStep}
              >
                <MiniMap className="tc-library-editor__minimap" />
                <Controls className="tc-library-editor__controls" position="bottom-left" />
                <Background className="tc-library-editor__background" gap={16} size={1} color="#2a2f3a" variant="dots" />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
        </div>
        <div className="tc-library-editor__side" style={{ borderLeft: '1px solid rgba(127,127,127,.2)', padding: 12, overflow: 'auto' }}>
          <Title className="tc-library-editor__section-title" order={6}>配置</Title>
          <TextInput className="tc-library-editor__input" label="名称" value={name} onChange={(e)=>setName(e.currentTarget.value)} />
          <Divider className="tc-library-editor__divider" my={10} />
          <Title className="tc-library-editor__section-title" order={6}>IO 端口</Title>
          <Text className="tc-library-editor__section-label" size="xs" c="dimmed">Inputs</Text>
          {io.inputs.length === 0 && <Text className="tc-library-editor__empty" size="xs" c="dimmed">无</Text>}
          <Stack className="tc-library-editor__list" gap={6}>
            {io.inputs.map(p => (
              <Group className="tc-library-editor__row" key={p.id} justify="space-between">
                <Text className="tc-library-editor__row-text" size="sm">{p.label} <Text className="tc-library-editor__row-meta" span c="dimmed">({p.type})</Text></Text>
                <Button className="tc-library-editor__row-action" size="xs" color="red" variant="subtle" onClick={()=>removePort('inputs', p.id)}>删除</Button>
              </Group>
            ))}
          </Stack>
          <Button className="tc-library-editor__add" mt={6} variant="subtle" onClick={()=>addPort('inputs')}>+ 添加输入</Button>

          <Divider className="tc-library-editor__divider" my={10} />
          <Text className="tc-library-editor__section-label" size="xs" c="dimmed">Outputs</Text>
          {io.outputs.length === 0 && <Text className="tc-library-editor__empty" size="xs" c="dimmed">无</Text>}
          <Stack className="tc-library-editor__list" gap={6}>
            {io.outputs.map(p => (
              <Group className="tc-library-editor__row" key={p.id} justify="space-between">
                <Text className="tc-library-editor__row-text" size="sm">{p.label} <Text className="tc-library-editor__row-meta" span c="dimmed">({p.type})</Text></Text>
                <Button className="tc-library-editor__row-action" size="xs" color="red" variant="subtle" onClick={()=>removePort('outputs', p.id)}>删除</Button>
              </Group>
            ))}
          </Stack>
          <Button className="tc-library-editor__add" mt={6} variant="subtle" onClick={()=>addPort('outputs')}>+ 添加输出</Button>
        </div>
      </div>
      <Modal className="tc-library-editor__modal" opened={showHistory} onClose={()=>setShowHistory(false)} title="保存历史" size="lg" centered>
        <Stack className="tc-library-editor__modal-stack">
          {versions.length === 0 && <Text className="tc-library-editor__empty" size="sm" c="dimmed">暂无历史</Text>}
          {versions.map(v => (
            <Group className="tc-library-editor__row" key={v.id} justify="space-between">
              <Text className="tc-library-editor__row-text" size="sm">{new Date(v.createdAt).toLocaleString()} - {v.name}</Text>
              <Button className="tc-library-editor__row-action" size="xs" variant="light" onClick={async ()=>{
                if (!confirm('回滚到该版本？当前更改将丢失')) return
                await rollbackFlow(currentId, v.id)
                const r = await getServerFlow(currentId)
                const data = (r?.data || {}) as any
                setNodes(Array.isArray(data.nodes) ? data.nodes : [])
                setEdges(Array.isArray(data.edges) ? data.edges : [])
                setName(r?.name || '')
                setShowHistory(false)
              }}>回滚</Button>
            </Group>
          ))}
        </Stack>
      </Modal>
    </div>
  )
}
