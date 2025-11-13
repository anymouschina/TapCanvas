import React from 'react'
import type { NodeProps } from 'reactflow'
import { Paper, Group, Button, Divider, Text, TextInput } from '@mantine/core'
import { useRFStore, persistToLocalStorage } from '../store'
import { toast } from '../../ui/toast'
import { runFlowDag } from '../../runner/dag'
import { NodeResizer } from 'reactflow'

type Data = { label?: string }

export default function GroupNode({ id, data, selected }: NodeProps<Data>): JSX.Element {
  const label = data?.label || '新建组'
  const nodes = useRFStore(s => s.nodes)
  const ungroup = useRFStore(s => s.ungroupGroupNode)
  const updateNodeLabel = useRFStore(s => s.updateNodeLabel)
  const [editing, setEditing] = React.useState(false)
  const [name, setName] = React.useState(label)
  React.useEffect(() => { setName(label) }, [label])

  // gather direct children by parentNode
  const childIds = React.useMemo(() => new Set(nodes.filter(n => n.parentNode === id).map(n => n.id)), [nodes, id])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: 'rgba(148,163,184,0.08)', border: selected ? '1.5px solid rgba(148,163,184,0.8)' : '1px solid rgba(148,163,184,0.35)', borderRadius: 12, boxShadow: '0 6px 18px rgba(0,0,0,0.25)', zIndex: 0 }}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={90} handleStyle={{ width: 8, height: 8, borderRadius: 2, background: '#8b5cf6', border: '1px solid rgba(255,255,255,.2)' }} lineStyle={{ borderColor: 'rgba(148,163,184,0.35)' }} />
      {/* Toolbar pinned to top-left of the group (inside the node) */}
      <Paper withBorder shadow="sm" radius="xl" p={4} style={{ position: 'absolute', left: 8, top: -28, pointerEvents: 'auto', whiteSpace: 'nowrap', overflowX: 'auto' }}>
        <Group gap={6} style={{ flexWrap: 'nowrap' }}>
          {editing ? (
            <TextInput size="xs" value={name} onChange={(e)=>setName(e.currentTarget.value)} onKeyDown={(e)=>{ if (e.key === 'Enter') { updateNodeLabel(id, name.trim() || '新建组'); setEditing(false) } }} onBlur={()=>{ updateNodeLabel(id, name.trim() || '新建组'); setEditing(false) }} styles={{ input: { height: 22, paddingTop: 0, paddingBottom: 0 } }} />
          ) : (
            <Text size="xs" c="dimmed" onDoubleClick={()=>setEditing(true)} title="双击重命名">{label}</Text>
          )}
          <Divider orientation="vertical" style={{ height: 16 }} />
          <Button size="xs" color="blue" onClick={async () => {
            await runFlowDag(2, useRFStore.getState, useRFStore.setState, { only: childIds })
          }}>▶ 一键执行</Button>
          <Button size="xs" variant="subtle" onClick={() => { persistToLocalStorage(); toast('已保存到本地', 'success') }}>保存</Button>
          <Button size="xs" variant="subtle" onClick={()=> setEditing(true)}>重命名</Button>
          <Button size="xs" variant="subtle" color="red" onClick={() => ungroup(id)}>解组</Button>
        </Group>
      </Paper>
    </div>
  )
}
