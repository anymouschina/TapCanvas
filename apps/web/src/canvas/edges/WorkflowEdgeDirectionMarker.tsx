import React from 'react'
import './workflowEdgeVisuals.css'

type WorkflowEdgeDirectionMarkerProps = Readonly<{
  markerId: string
  color: string
}>

export function isWorkflowCanvasEdge(
  sourceHandleId: string | null | undefined,
  targetHandleId: string | null | undefined,
): boolean {
  return sourceHandleId?.startsWith('out-workflow:') === true
    && targetHandleId?.startsWith('in-workflow:') === true
}

export function workflowEdgeMarkerId(edgeId: string): string {
  return `tc-workflow-arrow-${edgeId.replace(/[^a-zA-Z0-9_-]/gu, '-')}`
}

export function WorkflowEdgeDirectionMarker(
  props: WorkflowEdgeDirectionMarkerProps,
): React.JSX.Element {
  return (
    <defs className="workflow-edge-direction-marker__definitions">
      <marker
        className="workflow-edge-direction-marker"
        id={props.markerId}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto"
        markerUnits="userSpaceOnUse"
      >
        <path
          className="workflow-edge-direction-marker__arrow"
          d="M 0 0 L 10 5 L 0 10 z"
          fill={props.color}
        />
      </marker>
    </defs>
  )
}
