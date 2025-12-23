import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'

type Data = { label?: string; kind: 'io-in' | 'io-out'; types?: string[] }

export default function IONode({ data, selected }: NodeProps<Data>): JSX.Element {
  const isIn = data.kind === 'io-in'
  const types = Array.isArray(data.types) && data.types.length ? data.types : ['any']
  const bg = 'var(--canvas-io-bg)'
  const br = selected ? '1.5px solid var(--canvas-io-border-selected)' : '1px solid var(--canvas-io-border)'
  const itemH = 14
  const paddingY = 6
  const height = Math.max(22, paddingY * 2 + types.length * itemH)
  const width = 104
  return (
    <div style={{
      width,
      height,
      position: 'relative',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      gap: 6,
      background: bg,
      color: 'var(--canvas-io-text)',
      fontSize: 11,
      borderRadius: 8,
      border: br,
      boxShadow: '0 8px 16px rgba(0,0,0,.2)',
      paddingTop: 4,
    }}>
      <div style={{ position: 'absolute', top: 4, left: 6, fontSize: 10, color: 'var(--canvas-node-subtext)' }}>{isIn ? '入口' : '出口'}</div>
      {types.map((t, idx) => {
        const top = paddingY + idx * itemH
        return isIn ? (
          <Handle key={t} id={`out-${t}`} type="source" position={Position.Right} style={{ top, right: -6, width: 8, height: 8, background: 'var(--canvas-io-handle)' }} />
        ) : (
          <Handle key={t} id={`in-${t}`} type="target" position={Position.Left} style={{ top, left: -6, width: 8, height: 8, background: 'var(--canvas-io-handle)' }} />
        )
      })}
    </div>
  )
}
