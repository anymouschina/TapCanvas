import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { Paper, Group, Button, Divider, Text, TextInput } from '@mantine/core'
import { useRFStore, persistToLocalStorage } from '../store'
import { toast } from '../../ui/toast'
import { runFlowDag } from '../../runner/dag'
import { NodeResizer } from '@xyflow/react'

type Data = { label?: string; editing?: boolean }

export default function GroupNode({ id, data, selected }: NodeProps<Data>): JSX.Element {
  const label = data?.label || '新建组'
  const nodes = useRFStore(s => s.nodes)
  const ungroup = useRFStore(s => s.ungroupGroupNode)
  const updateNodeLabel = useRFStore(s => s.updateNodeLabel)
  const [editing, setEditing] = React.useState(false)
  const [name, setName] = React.useState(label)
  React.useEffect(() => { setName(label) }, [label])
  const updateNodeData = useRFStore(s => s.updateNodeData)
  React.useEffect(() => {
    if (data?.editing && !editing) setEditing(true)
  }, [data?.editing])

  // gather direct children by parentId
  const childIds = React.useMemo(() => new Set(nodes.filter(n => (n as any).parentId === id).map(n => n.id)), [nodes, id])

  return (
    <div className="group-node" style={{
      width: '100%',
      height: '100%',
      position: 'relative',
      background: 'var(--canvas-group-bg)',
      border: selected ? '1.5px solid var(--canvas-group-border-selected)' : '1px solid var(--canvas-group-border)',
      borderRadius: 12,
      boxShadow: '0 10px 24px rgba(0,0,0,0.25)',
      zIndex: 0
    }}>
      <NodeResizer className="group-node-resizer" isVisible={selected} minWidth={160} minHeight={90} handleStyle={{ width: 8, height: 8, borderRadius: 2, background: 'var(--canvas-io-handle)', border: '1px solid rgba(255,255,255,.2)' }} lineStyle={{ borderColor: 'var(--canvas-group-border)' }} />
      {/* Toolbar pinned to top-left of the group (inside the node) */}
      <Paper className="group-node-toolbar" withBorder shadow="sm" radius="xl" p={4} style={{ position: 'absolute', left: 8, top: -28, pointerEvents: 'auto', whiteSpace: 'nowrap', overflowX: 'auto' }}>
        <Group className="group-node-toolbar-row" gap={6} style={{ flexWrap: 'nowrap' }}>
          {editing ? (
            <TextInput
              className="group-node-title-input"
              size="xs"
              autoFocus
              value={name}
              onChange={(e)=>setName(e.currentTarget.value)}
              onKeyDown={(e)=>{ if (e.key === 'Enter') { updateNodeLabel(id, name.trim() || '新建组'); setEditing(false); updateNodeData(id, { editing: false }) } }}
              onBlur={()=>{ updateNodeLabel(id, name.trim() || '新建组'); setEditing(false); updateNodeData(id, { editing: false }) }}
              styles={{ input: { height: 22, paddingTop: 0, paddingBottom: 0 } }}
            />
          ) : (
            <Text className="group-node-title" size="xs" c="dimmed" onDoubleClick={()=>{ setEditing(true); updateNodeData(id, { editing: true }) }} title="双击重命名">{label}</Text>
          )}
          <Divider className="group-node-divider" orientation="vertical" style={{ height: 16 }} />
          <Button className="group-node-run" size="xs" color="blue" onClick={async () => {
            await runFlowDag(2, useRFStore.getState, useRFStore.setState, { only: childIds })
          }}>▶ 一键执行</Button>
          {/* 服务器持久化：本地保存入口移除，避免与项目保存冲突 */}
          <Button className="group-node-rename" size="xs" variant="subtle" onClick={()=> setEditing(true)}>重命名</Button>
          <Button className="group-node-ungroup" size="xs" variant="subtle" color="red" onClick={() => ungroup(id)}>解组</Button>
          {/* Aggregated status */}
          <Group className="group-node-summary" gap={4} style={{ flexWrap: 'nowrap' }}>
            <GroupSummary childIds={childIds} />
          </Group>
        </Group>
      </Paper>
    </div>
  )
}

function GroupSummary({ childIds }: { childIds: Set<string> }) {
  const nodes = useRFStore(s => s.nodes)
  const kids = nodes.filter(n => childIds.has(n.id))
  const total = kids.length || 1
  const counts = kids.reduce((acc, n) => {
    const st = (n.data as any)?.status || 'idle'
    acc[st] = (acc[st] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  const success = counts['success'] || 0
  const running = counts['running'] || 0
  const error = counts['error'] || 0
  const queued = counts['queued'] || 0
  const pct = Math.round((success / total) * 100)
  return (
    <div className="group-node-summary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <div className="group-node-summary-track" style={{ width: 80, height: 6, background: 'rgba(148,163,184,0.25)', borderRadius: 999, overflow: 'hidden' }}>
        <div className="group-node-summary-fill" style={{ width: `${pct}%`, height: '100%', background: '#16a34a' }} />
      </div>
      <span className="group-node-summary-text" style={{ fontSize: 11, color: '#9ca3af' }}>{success}/{total} 成功</span>
      {running > 0 && <span className="group-node-summary-text" style={{ fontSize: 11, color: '#8b5cf6' }}>运行 {running}</span>}
      {queued > 0 && <span className="group-node-summary-text" style={{ fontSize: 11, color: '#f59e0b' }}>排队 {queued}</span>}
      {error > 0 && <span className="group-node-summary-text" style={{ fontSize: 11, color: '#ef4444' }}>失败 {error}</span>}
    </div>
  )
}
