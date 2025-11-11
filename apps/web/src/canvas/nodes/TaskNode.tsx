import React from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position } from 'reactflow'

type Data = {
  label: string
  kind?: string
  status?: 'idle' | 'queued' | 'running' | 'success' | 'error' | 'canceled'
  progress?: number
}

export default function TaskNode({ data }: NodeProps<Data>): JSX.Element {
  const status = data?.status ?? 'idle'
  const color =
    status === 'success' ? '#16a34a' :
    status === 'error' ? '#ef4444' :
    status === 'canceled' ? '#475569' :
    status === 'running' ? '#8b5cf6' :
    status === 'queued' ? '#f59e0b' : 'rgba(127,127,127,.6)'

  return (
    <div style={{
      border: '1px solid rgba(127,127,127,.35)',
      borderRadius: 12,
      padding: '10px 12px',
      background: 'rgba(127,127,127,.08)'
    }}>
      <Handle type="target" position={Position.Left} style={{ left: -6 }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <strong>{data?.label ?? 'Task'}</strong>
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
      {status === 'running' && (
        <div style={{ marginTop: 6, height: 6, background: 'rgba(127,127,127,.25)', borderRadius: 4 }}>
          <div style={{ width: `${Math.min(100, Math.max(0, data?.progress ?? 0))}%`, height: '100%', background: color, borderRadius: 4 }} />
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ right: -6 }} />
    </div>
  )
}
