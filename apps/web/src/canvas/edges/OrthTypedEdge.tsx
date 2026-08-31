import React from 'react'
import { ActionIcon } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  useStore,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import { useRFStore } from '../store'
import { useUIStore } from '../../ui/uiStore'
import { useEdgeVisuals } from './useEdgeVisuals'
import { getNodeAbsPosition, getNodeSize } from '../utils/nodeBounds'
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
  workflowNodeExecutionState,
} from './workflowEdgeVisuals'
import { WORKFLOW_EDGE_ROUTE_OFFSET } from '../workflowNodeGeometry'
import { useWorkflowEdgeRoute } from './useWorkflowEdgeRoute'
import {
  resolveWorkflowReferenceEdgeStyle,
  resolveWorkflowReferenceVisualState,
  type WorkflowReferenceState,
} from './workflowReferenceEdgeVisuals'

function inferType(sourceHandle?: string | null, targetHandle?: string | null) {
  if (sourceHandle && sourceHandle.startsWith('out-')) return sourceHandle.slice(4)
  if (targetHandle && targetHandle.startsWith('in-')) return targetHandle.slice(3)
  return 'any'
}

function orthPathAvoid(sx: number, sy: number, tx: number, ty: number, obstacles: { x: number; y: number; w: number; h: number; id: string }[]) {
  const dir = sx < tx ? 1 : -1
  const steps = [0, 1, -1, 2, -2, 3, -3]
  const blockedVertical = (mx: number, y1: number, y2: number) => {
    const top = Math.min(y1, y2)
    const bottom = Math.max(y1, y2)
    for (const ob of obstacles) {
      if (mx >= ob.x && mx <= ob.x + ob.w) {
        const oy1 = ob.y, oy2 = ob.y + ob.h
        if (!(bottom < oy1 || top > oy2)) return true
      }
    }
    return false
  }
  const centerX = Math.round((sx + tx) / 2)
  // Single-bend try
  for (const s of steps) {
    const mx = centerX + s * 40 * dir
    if (!blockedVertical(mx, sy, ty)) {
      const d1 = `M ${sx},${sy} L ${mx},${sy} L ${mx},${ty} L ${tx},${ty}`
      return [d1, mx, Math.round((sy + ty) / 2)] as const
    }
  }
  // Multi-bend: find two clear verticals near source/target
  let mx1: number | null = null
  let mx2: number | null = null
  for (const s of steps) { const cand = sx + s * 60 * dir; if (!blockedVertical(cand, sy, ty)) { mx1 = cand; break } }
  for (const s of steps) { const cand = tx + s * -60 * dir; if (!blockedVertical(cand, sy, ty)) { mx2 = cand; break } }
  if (mx1 !== null && mx2 !== null) {
    const midY = Math.round((sy + ty) / 2)
    const d2 = `M ${sx},${sy} L ${mx1},${sy} L ${mx1},${midY} L ${mx2},${midY} L ${mx2},${ty} L ${tx},${ty}`
    return [d2, Math.round((mx1 + mx2) / 2), midY] as const
  }
  // Fallback straight orth
  const d = `M ${sx},${sy} L ${centerX},${sy} L ${centerX},${ty} L ${tx},${ty}`
  return [d, centerX, Math.round((sy + ty) / 2)] as const
}

type OrthTypedCanvasEdge = Edge<Record<string, unknown>, 'orth'>

const OrthTypedEdge = React.memo(function OrthTypedEdge(props: EdgeProps<OrthTypedCanvasEdge>) {
  const explicitEdgeType = typeof props.data?.edgeType === 'string' ? props.data.edgeType : null
  const referenceKind = props.data?.relationKind === 'agent_skill_reference'
    ? 'skill'
    : props.data?.relationKind === 'agent_knowledge_reference'
      ? 'knowledge'
      : null
  const isReferenceEdge = props.data?.executionRole === 'reference_only' && referenceKind !== null
  const referenceActualReadCount = typeof props.data?.referenceActualReadCount === 'number'
    ? props.data.referenceActualReadCount
    : 0
  const referenceState: WorkflowReferenceState = 'available'
  const isWorkflowEdge = isWorkflowCanvasEdge(props.sourceHandleId, props.targetHandleId)
  const executionState = useStore((state) => {
    if (!isWorkflowEdge) return 'idle'
    const source = state.nodes.find((node) => node.id === props.source)
    const target = state.nodes.find((node) => node.id === props.target)
    return resolveWorkflowEdgeExecutionState(source?.data, target?.data)
  })
  const targetExecutionState = useStore((state) => {
    if (!isReferenceEdge) return 'idle'
    const target = state.nodes.find((node) => node.id === props.target)
    return workflowNodeExecutionState(target?.data)
  })
  const referenceVisualState = resolveWorkflowReferenceVisualState({
    actualReadCount: referenceActualReadCount,
    referenceState,
    targetExecutionState,
  })
  const t = explicitEdgeType || inferType(props.sourceHandleId, props.targetHandleId)
  const { edgeStyle, isLight } = useEdgeVisuals(t)
  const obstacles = useStore(
    (s) => {
      const nodesById = new Map(s.nodes.map((n) => [n.id, n] as const))
      return s.nodes.map((n) => {
        const pos = getNodeAbsPosition(n, nodesById)
        const { w, h } = getNodeSize(n, { w: 180, h: 96 })
        return { x: pos.x, y: pos.y, w, h, id: n.id }
      })
    },
    (a, b) => {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        if (a[i].id !== b[i].id || a[i].x !== b[i].x || a[i].y !== b[i].y ||
            a[i].w !== b[i].w || a[i].h !== b[i].h) return false
      }
      return true
    },
  )
  const deleteEdge = useRFStore(s => s.deleteEdge)
  const viewOnly = useUIStore(s => s.viewOnly)
  const { isBoxSelecting, selectedEdgeCount, selectedNodeCount } = useEdgeInteractionContext()
  const showDelete = shouldShowEdgeDeleteAction({
    edgeSelected: Boolean(props.selected),
    selectedNodeCount,
    selectedEdgeCount,
    isBoxSelecting,
  })
  // 重画布降级：拉远到 overview 尺度时，跳过逐边的障碍物避让路径计算（最贵的一段），
  // 退化为直线并跳过删除按钮 label 子树。
  const degraded = React.useContext(CanvasLODContext)
  // Skill / Knowledge edges express an attachment relationship, not execution
  // direction. Keep arrows exclusively on executable workflow edges.
  const workflowMarkerId = isWorkflowEdge && !isReferenceEdge ? workflowEdgeMarkerId(props.id) : null
  const referenceStyle = referenceKind
    ? resolveWorkflowReferenceEdgeStyle({
        kind: referenceKind,
        referenceState,
        visualState: referenceVisualState,
      })
    : null
  const renderedEdgeStyle = isReferenceEdge
    ? {
        ...edgeStyle,
        ...referenceStyle,
      }
    : isWorkflowEdge
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

  let edgePath: string
  let labelX: number
  let labelY: number
  if (isReferenceEdge) {
    ;[edgePath, labelX, labelY] = getStraightPath({
      sourceX: props.sourceX, sourceY: props.sourceY,
      targetX: props.targetX, targetY: props.targetY,
    })
  } else if (workflowRoute) {
    edgePath = workflowRoute.path
    labelX = workflowRoute.labelX
    labelY = workflowRoute.labelY
  } else if (degraded) {
    ;[edgePath, labelX, labelY] = getStraightPath({
      sourceX: props.sourceX, sourceY: props.sourceY,
      targetX: props.targetX, targetY: props.targetY,
    })
  } else {
    // Adjust Y near source/target to avoid horizontal overlap with obstacles (except endpoints)
    const ignore = new Set([props.source, props.target])
    const intersectsH = (y: number, x1: number, x2: number) => {
      const minX = Math.min(x1, x2), maxX = Math.max(x1, x2)
      for (const ob of obstacles) {
        if (ignore.has(ob.id)) continue
        const oy1 = ob.y, oy2 = ob.y + ob.h
        const ox1 = ob.x, ox2 = ob.x + ob.w
        if (y >= oy1 && y <= oy2) {
          if (!(maxX < ox1 || minX > ox2)) return true
        }
      }
      return false
    }
    let sy = props.sourceY, ty = props.targetY
    const steps = [0, 1, -1, 2, -2, 3, -3]
    for (const k of steps) { const y = props.sourceY + k * 30; if (!intersectsH(y, props.sourceX, (props.sourceX + props.targetX)/2)) { sy = y; break } }
    for (const k of steps) { const y = props.targetY + k * 30; if (!intersectsH(y, props.targetX, (props.sourceX + props.targetX)/2)) { ty = y; break } }
    ;[edgePath, labelX, labelY] = orthPathAvoid(props.sourceX, sy, props.targetX, ty, obstacles)
  }

  return (
    <>
      {workflowMarkerId ? (
        <WorkflowEdgeDirectionMarker markerId={workflowMarkerId} color={markerColor} />
      ) : null}
      <BaseEdge
        className={`orth-typed-edge-path${isWorkflowEdge ? ` orth-typed-edge-path--workflow orth-typed-edge-path--${executionState}` : ''}${isReferenceEdge ? ` orth-typed-edge-path--reference orth-typed-edge-path--reference-${referenceVisualState}` : ''}`}
        id={props.id}
        path={edgePath}
        // 同 TypedEdge：strokeWidth 恒取 edgeStyle，避免历史边持久化的 strokeWidth:2 造成粗细不一
        style={isWorkflowEdge || isReferenceEdge
          ? { ...(props.style || {}), ...renderedEdgeStyle, strokeWidth: renderedEdgeStyle.strokeWidth }
          : { ...renderedEdgeStyle, ...(props.style || {}) }}
        markerEnd={isReferenceEdge ? undefined : props.markerEnd ?? (workflowMarkerId ? `url(#${workflowMarkerId})` : undefined)}
        markerStart={isReferenceEdge ? undefined : props.markerStart}
        interactionWidth={props.interactionWidth}
      />
      <EdgeLabelRenderer>
        {!degraded && !viewOnly && !isReferenceEdge && showDelete && (
          <div
            className="orth-typed-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'auto',
            }}
          >
            <ActionIcon
              className="orth-typed-edge-delete"
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
              <IconTrash className="orth-typed-edge-delete-icon" size={14} />
            </ActionIcon>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
})

export default OrthTypedEdge
