import type { EdgeTypes, NodeTypes } from '@xyflow/react'
import TaskNode from './nodes/TaskNodeCard'
import IONode from './nodes/IONode'
import GroupNode from './nodes/GroupNode'
import { DirectorConsoleNode } from './nodes/directorConsole/DirectorConsoleNode'
import { WorkflowExecutionPlaceholderNode } from './nodes/WorkflowExecutionPlaceholderNode'
import TypedEdge from './edges/TypedEdge'
import OrthTypedEdge from './edges/OrthTypedEdge'

/**
 * The only React Flow renderer registry used by TapCanvas canvases.
 *
 * Authoring, read-only project snapshots, and workflow execution snapshots all
 * render through these exact components. Read-only behavior belongs to node
 * data/component contracts, not to a parallel snapshot renderer tree.
 */
const canvasNodeTypeComponents = Object.freeze({
  taskNode: TaskNode,
  ioNode: IONode,
  groupNode: GroupNode,
  directorConsole: DirectorConsoleNode,
  workflowExecutionNode: WorkflowExecutionPlaceholderNode,
})

const canvasEdgeTypeComponents = Object.freeze({
  typed: TypedEdge,
  orth: OrthTypedEdge,
})

export type CanvasNodeTypeName = keyof typeof canvasNodeTypeComponents
export type CanvasEdgeTypeName = keyof typeof canvasEdgeTypeComponents

export const CANVAS_NODE_TYPES = canvasNodeTypeComponents as unknown as NodeTypes
export const CANVAS_EDGE_TYPES = canvasEdgeTypeComponents as unknown as EdgeTypes

export function isCanvasNodeTypeName(value: string): value is CanvasNodeTypeName {
  return Object.prototype.hasOwnProperty.call(canvasNodeTypeComponents, value)
}

export function isCanvasEdgeTypeName(value: string): value is CanvasEdgeTypeName {
  return Object.prototype.hasOwnProperty.call(canvasEdgeTypeComponents, value)
}
