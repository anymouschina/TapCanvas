import React from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position } from 'reactflow'
import { useRFStore } from '../store'

type Data = {
  label: string
  kind?: string
  status?: 'idle' | 'queued' | 'running' | 'success' | 'error' | 'canceled'
  progress?: number
}

export default function TaskNode({ id, data }: NodeProps<Data>): JSX.Element {
  const status = data?.status ?? 'idle'
  const color =
    status === 'success' ? '#16a34a' :
    status === 'error' ? '#ef4444' :
    status === 'canceled' ? '#475569' :
    status === 'running' ? '#8b5cf6' :
    status === 'queued' ? '#f59e0b' : 'rgba(127,127,127,.6)'

  const kind = data?.kind
  const targets: { id: string; type: string; pos: Position }[] = []
  const sources: { id: string; type: string; pos: Position }[] = []

  if (kind === 'composeVideo') {
    targets.push({ id: 'in-image', type: 'image', pos: Position.Left })
    targets.push({ id: 'in-audio', type: 'audio', pos: Position.Left })
    targets.push({ id: 'in-subtitle', type: 'subtitle', pos: Position.Left })
    sources.push({ id: 'out-video', type: 'video', pos: Position.Right })
  } else if (kind === 'textToImage') {
    sources.push({ id: 'out-image', type: 'image', pos: Position.Right })
  } else if (kind === 'tts') {
    sources.push({ id: 'out-audio', type: 'audio', pos: Position.Right })
  } else if (kind === 'subtitleAlign') {
    sources.push({ id: 'out-subtitle', type: 'subtitle', pos: Position.Right })
  } else {
    // generic fallback
    targets.push({ id: 'in-any', type: 'any', pos: Position.Left })
    sources.push({ id: 'out-any', type: 'any', pos: Position.Right })
  }

  const [editing, setEditing] = React.useState(false)
  const updateNodeLabel = useRFStore(s => s.updateNodeLabel)

  return (
    <div style={{
      border: '1px solid rgba(127,127,127,.35)',
      borderRadius: 12,
      padding: '10px 12px',
      background: 'rgba(127,127,127,.08)'
    }}>
      {targets.map(h => (
        <Handle
          key={h.id}
          id={h.id}
          type="target"
          position={h.pos}
          style={{ left: h.pos===Position.Left? -6: undefined, right: h.pos===Position.Right? -6: undefined }}
          data-handle-type={h.type}
          title={`输入: ${h.type}`}
        />
      ))}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {!editing ? (
          <strong
            onDoubleClick={() => setEditing(true)}
            title="双击重命名"
            style={{ cursor: 'text' }}
          >{data?.label ?? 'Task'}</strong>
        ) : (
          <input
            autoFocus
            defaultValue={data?.label ?? ''}
            onBlur={(e) => { updateNodeLabel(id, e.currentTarget.value); setEditing(false) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { updateNodeLabel(id, (e.target as HTMLInputElement).value); setEditing(false) }
              if (e.key === 'Escape') { setEditing(false) }
            }}
            style={{ fontWeight: 700, fontSize: '1em', background: 'transparent', border: '1px solid rgba(127,127,127,.35)', borderRadius: 6, padding: '2px 6px' }}
          />
        )}
        <span style={{
          fontSize: 11,
          color,
          border: `1px solid ${color}`,
          padding: '1px 6px',
          borderRadius: 999,
          background: 'transparent'
        }}>{status}</span>
      </div>
      <div style={{ fontSize: 12, opacity: .8 }}>{data?.kind ?? '节点'}</div>
      {sources.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {sources.map(s => (
            <span key={s.id} style={{ fontSize: 10, opacity: .7, border: '1px solid rgba(127,127,127,.35)', borderRadius: 999, padding: '1px 6px' }}>{s.type}</span>
          ))}
        </div>
      )}
      {status === 'running' && (
        <div style={{ marginTop: 6, height: 6, background: 'rgba(127,127,127,.25)', borderRadius: 4 }}>
          <div style={{ width: `${Math.min(100, Math.max(0, data?.progress ?? 0))}%`, height: '100%', background: color, borderRadius: 4 }} />
        </div>
      )}
      {sources.map(h => (
        <Handle
          key={h.id}
          id={h.id}
          type="source"
          position={h.pos}
          style={{ right: h.pos===Position.Right? -6: undefined, left: h.pos===Position.Left? -6: undefined }}
          data-handle-type={h.type}
          title={`输出: ${h.type}`}
        />
      ))}
    </div>
  )
}
