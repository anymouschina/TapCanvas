import React from 'react'
import { ActionIcon } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useStore,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import { useRFStore } from '../store'
import { useUIStore } from '../../ui/uiStore'
import { useEdgeVisuals } from './useEdgeVisuals'
import { CanvasLODContext } from '../CanvasLODContext'
import { useEdgeInteractionContext } from './EdgeInteractionContext'
import { shouldShowEdgeDeleteAction } from './edgeDeleteVisibility'
import {
  isWorkflowCanvasEdge,
  WorkflowEdgeDirectionMarker,
  workflowEdgeMarkerId,
} from './WorkflowEdgeDirectionMarker'
import {
  resolveWorkflowEdgeExecutionState,
  resolveWorkflowEdgeVisualStyle,
} from './workflowEdgeVisuals'
import { WORKFLOW_EDGE_ROUTE_OFFSET } from '../workflowNodeGeometry'
import { useWorkflowEdgeRoute } from './useWorkflowEdgeRoute'

function inferType(sourceHandle?: string | null, targetHandle?: string | null) {
  if (sourceHandle && sourceHandle.startsWith('out-')) return sourceHandle.slice(4)
  if (targetHandle && targetHandle.startsWith('in-')) return targetHandle.slice(3)
  return 'any'
}

type TypedCanvasEdge = Edge<Record<string, unknown>, 'typed'>

const TypedEdge = React.memo(function TypedEdge(props: EdgeProps<TypedCanvasEdge>) {
  const explicitEdgeType = typeof props.data?.edgeType === 'string' ? props.data.edgeType : null
  const t = explicitEdgeType || inferType(props.sourceHandleId, props.targetHandleId)
  const { edgeStyle, isLight } = useEdgeVisuals(t)
  const deleteEdge = useRFStore(s => s.deleteEdge)
  const viewOnly = useUIStore(s => s.viewOnly)
  const { isBoxSelecting, selectedEdgeCount, selectedNodeCount } = useEdgeInteractionContext()
  const showDelete = shouldShowEdgeDeleteAction({
    edgeSelected: Boolean(props.selected),
    selectedNodeCount,
    selectedEdgeCount,
    isBoxSelecting,
  })
  // 重画布降级：拉远到 overview 尺度时，仅跳过删除按钮的 label 子树——这个尺度下
  // 既看不清也点不中。连线始终走贝塞尔曲线（曲线计算本身廉价，不参与降级）。
  const degraded = React.useContext(CanvasLODContext)
  const isWorkflowEdge = isWorkflowCanvasEdge(props.sourceHandleId, props.targetHandleId)
  const executionState = useStore((state) => {
    if (!isWorkflowEdge) return 'idle'
    const source = state.nodes.find((node) => node.id === props.source)
    const target = state.nodes.find((node) => node.id === props.target)
    return resolveWorkflowEdgeExecutionState(source?.data, target?.data)
  })
  const workflowMarkerId = isWorkflowEdge ? workflowEdgeMarkerId(props.id) : null
  const renderedEdgeStyle = isWorkflowEdge
    ? {
        ...edgeStyle,
        ...resolveWorkflowEdgeVisualStyle({
          isLight,
          active: Boolean(props.selected),
          executionState,
        }),
      }
    : edgeStyle
  const markerColor = typeof renderedEdgeStyle.stroke === 'string' ? renderedEdgeStyle.stroke : 'currentColor'
  const workflowRoute = useWorkflowEdgeRoute({
    enabled: isWorkflowEdge,
    edgeId: props.id,
    sourceId: props.source,
    targetId: props.target,
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    routeOffset: WORKFLOW_EDGE_ROUTE_OFFSET,
  })

  const [edgePath, labelX, labelY] = workflowRoute
    ? [workflowRoute.path, workflowRoute.labelX, workflowRoute.labelY]
    : getBezierPath({
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        sourcePosition: props.sourcePosition,
        targetX: props.targetX,
        targetY: props.targetY,
        targetPosition: props.targetPosition,
        curvature: 0.35,
      })

  return (
    <>
      {workflowMarkerId ? (
        <WorkflowEdgeDirectionMarker markerId={workflowMarkerId} color={markerColor} />
      ) : null}
      <BaseEdge
        className={`typed-edge-path${isWorkflowEdge ? ` typed-edge-path--workflow typed-edge-path--${executionState}` : ''}`}
        id={props.id}
        path={edgePath}
        // strokeWidth 恒取 edgeStyle：历史边持久化过 defaultEdgeOptions 的 strokeWidth:2，
        // 不强制会新旧边粗细不一；选中/过滤高亮只经 props.style 动 opacity/stroke 色，不受影响。
        style={{ ...renderedEdgeStyle, ...(props.style || {}), strokeWidth: renderedEdgeStyle.strokeWidth }}
        markerEnd={props.markerEnd ?? (workflowMarkerId ? `url(#${workflowMarkerId})` : undefined)}
        markerStart={props.markerStart}
        interactionWidth={props.interactionWidth}
      />
      <EdgeLabelRenderer>
        {!degraded && !viewOnly && showDelete && (
          <div
            className="typed-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'auto',
            }}
          >
            <ActionIcon
              className="typed-edge-delete"
              size="sm"
              radius="md"
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
})

export default TypedEdge
