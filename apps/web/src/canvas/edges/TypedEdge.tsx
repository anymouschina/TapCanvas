import React from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from 'reactflow'
import { useRFStore } from '../store'
import { useEdgeVisuals } from './useEdgeVisuals'

function inferType(sourceHandle?: string | null, targetHandle?: string | null) {
  if (sourceHandle && sourceHandle.startsWith('out-')) return sourceHandle.slice(4)
  if (targetHandle && targetHandle.startsWith('in-')) return targetHandle.slice(3)
  return 'any'
}

export default function TypedEdge(props: EdgeProps<any>) {
  const t = (props.data && (props.data as any).edgeType) || inferType(props.sourceHandle, props.targetHandle)
  const { stroke, edgeStyle, labelStyle, directionChipStyle, startCapColor, endCapColor } = useEdgeVisuals(t)
  const nodes = useRFStore(s => s.nodes)
  const sourceLabel = React.useMemo(() => {
    const found = nodes.find((n) => n.id === props.source)
    const label = typeof (found?.data as any)?.label === 'string' ? (found?.data as any)?.label.trim() : ''
    if (label) return label
    const kind = typeof (found?.data as any)?.kind === 'string' ? (found?.data as any)?.kind.trim() : ''
    return label || kind || props.source
  }, [nodes, props.source])
  const targetLabel = React.useMemo(() => {
    const found = nodes.find((n) => n.id === props.target)
    const label = typeof (found?.data as any)?.label === 'string' ? (found?.data as any)?.label.trim() : ''
    if (label) return label
    const kind = typeof (found?.data as any)?.kind === 'string' ? (found?.data as any)?.kind.trim() : ''
    return label || kind || props.target
  }, [nodes, props.target])

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })

  const directionTextColor = 'rgba(255,255,255,0.95)'
  const typeChip =
    t !== 'any' ? (
      <div
        style={{
          color: labelStyle.color,
          background: labelStyle.background,
          WebkitBackdropFilter: 'blur(2px)',
          backdropFilter: 'blur(2px)',
          padding: '2px 6px',
          borderRadius: 999,
          border: `1px solid ${labelStyle.borderColor}`,
          boxShadow: labelStyle.boxShadow,
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          minWidth: 36,
          textAlign: 'center',
        }}
      >
        {t}
      </div>
    ) : null

  const directionLabel = `${sourceLabel || '来源'} → ${targetLabel || '去向'}`

  return (
    <>
      <BaseEdge id={props.id} path={edgePath} style={edgeStyle} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            minWidth: 120,
          }}
        >
          {typeChip}
          <div
            title={directionLabel}
            style={{
              ...directionChipStyle,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              maxWidth: 240,
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: startCapColor,
                boxShadow: `0 0 12px ${stroke}`,
                opacity: 0.9,
              }}
            />
            <span
              style={{
                color: directionTextColor,
                fontSize: 11,
                fontWeight: 700,
                maxWidth: 90,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {sourceLabel || '来源'}
            </span>
            <span
              style={{
                color: directionTextColor,
                fontSize: 12,
                fontWeight: 800,
                opacity: 0.95,
              }}
            >
              →
            </span>
            <span
              style={{
                color: directionTextColor,
                fontSize: 11,
                fontWeight: 700,
                maxWidth: 90,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {targetLabel || '去向'}
            </span>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: endCapColor,
                boxShadow: `0 0 12px ${stroke}`,
                opacity: 0.9,
              }}
            />
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
