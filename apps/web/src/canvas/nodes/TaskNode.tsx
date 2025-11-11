import React from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position } from 'reactflow'

export default function TaskNode({ data }: NodeProps<{ label: string }>): JSX.Element {
  return (
    <div style={{
      border: '1px solid rgba(127,127,127,.35)',
      borderRadius: 12,
      padding: '10px 12px',
      background: 'rgba(127,127,127,.08)'
    }}>
      <Handle type="target" position={Position.Left} style={{ left: -6 }} />
      <strong>{data?.label ?? 'Task'}</strong>
      <div style={{ fontSize: 12, opacity: .8 }}>节点</div>
      <Handle type="source" position={Position.Right} style={{ right: -6 }} />
    </div>
  )
}
