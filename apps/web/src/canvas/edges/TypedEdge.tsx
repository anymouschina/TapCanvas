import React from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from 'reactflow'

function colorFor(t?: string) {
  switch (t) {
    case 'image': return '#3b82f6' // blue-500
    case 'audio': return '#10b981' // emerald-500
    case 'subtitle': return '#f59e0b' // amber-500
    case 'video': return '#8b5cf6' // violet-500
    default: return '#9ca3af' // gray-400
  }
}

function inferType(sourceHandle?: string | null, targetHandle?: string | null) {
  if (sourceHandle && sourceHandle.startsWith('out-')) return sourceHandle.slice(4)
  if (targetHandle && targetHandle.startsWith('in-')) return targetHandle.slice(3)
  return 'any'
}

export default function TypedEdge(props: EdgeProps<any>) {
  const t = (props.data && (props.data as any).edgeType) || inferType(props.sourceHandle, props.targetHandle)
  const stroke = colorFor(t)

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })

  return (
    <>
      <BaseEdge id={props.id} path={edgePath} style={{ stroke, strokeWidth: 2 }} />
      <EdgeLabelRenderer>
        <div style={{
          position: 'absolute',
          transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          pointerEvents: 'none',
          fontSize: 10,
          color: stroke,
          background: 'rgba(255,255,255,.75)',
          WebkitBackdropFilter: 'blur(2px)',
          backdropFilter: 'blur(2px)',
          padding: '2px 6px',
          borderRadius: 999,
          border: `1px solid ${stroke}33`,
        }}>
          {t}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

