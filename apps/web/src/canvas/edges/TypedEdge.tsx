import React from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from 'reactflow'

function colorFor(t?: string) {
  switch (t) {
    case 'image': return 'rgba(59,130,246,.7)'
    case 'audio': return 'rgba(16,185,129,.7)'
    case 'subtitle': return 'rgba(234,179,8,.7)'
    case 'video': return 'rgba(139,92,246,.7)'
    default: return 'rgba(156,163,175,.7)'
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
      <BaseEdge id={props.id} path={edgePath} style={{ stroke, strokeWidth: 3, opacity: 0.95 }} />
      <EdgeLabelRenderer>
        <div style={{
          position: 'absolute',
          transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          pointerEvents: 'none',
          fontSize: 10,
          color: stroke,
          background: 'rgba(15,16,20,.8)',
          WebkitBackdropFilter: 'blur(2px)',
          backdropFilter: 'blur(2px)',
          padding: '2px 6px',
          borderRadius: 999,
          border: `1px solid ${stroke}`,
        }}>
          {t}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
