import React from 'react'
import { ActionIcon } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react'
import { useRFStore } from '../store'
import { useUIStore } from '../../ui/uiStore'
import { useEdgeVisuals } from './useEdgeVisuals'

function inferType(sourceHandle?: string | null, targetHandle?: string | null) {
  if (sourceHandle && sourceHandle.startsWith('out-')) return sourceHandle.slice(4)
  if (targetHandle && targetHandle.startsWith('in-')) return targetHandle.slice(3)
  return 'any'
}

export default function TypedEdge(props: EdgeProps<any>) {
  const t = (props.data && (props.data as any).edgeType) || inferType(props.sourceHandle, props.targetHandle)
  const { edgeStyle } = useEdgeVisuals(t)
  const deleteEdge = useRFStore(s => s.deleteEdge)
  const viewOnly = useUIStore(s => s.viewOnly)
  const showDelete = useUIStore(s => s.hoveredEdgeId === props.id) || props.selected

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
      <BaseEdge
        className="typed-edge-path"
        id={props.id}
        path={edgePath}
        style={{ ...edgeStyle, ...(props.style || {}) }}
        markerEnd={props.markerEnd}
        markerStart={props.markerStart}
        interactionWidth={props.interactionWidth}
      />
      <EdgeLabelRenderer className="typed-edge-label-root">
        {!viewOnly && showDelete && (
          <div
            className="typed-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'auto',
            }}
            onMouseEnter={() => useUIStore.getState().hoverEdge(props.id)}
            onMouseLeave={() => useUIStore.getState().unhoverEdgeSoon()}
          >
            <ActionIcon
              className="typed-edge-delete"
              size="sm"
              radius="xl"
              variant="light"
              color="red"
              aria-label="删除连线"
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                deleteEdge(props.id)
              }}
            >
              <IconTrash className="typed-edge-delete-icon" size={14} />
            </ActionIcon>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
}
