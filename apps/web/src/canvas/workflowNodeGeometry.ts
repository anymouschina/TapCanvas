import { resolveWorkflowMediaPreview } from './workflowMediaPreview'
import {
  WORKFLOW_ICON_NODE_SIZE,
  WORKFLOW_RESULT_NODE_HEIGHT,
  WORKFLOW_RESULT_NODE_WIDTH,
} from './workflowNodeDimensions'

export * from './workflowNodeDimensions'

export type WorkflowNodeCanvasSize = Readonly<{ width: number; height: number }>

export function resolveWorkflowNodeCanvasSize(data: Record<string, unknown>): WorkflowNodeCanvasSize {
  const media = resolveWorkflowMediaPreview(data)
  if (media.kind && media.displayMode === 'result') {
    return { width: WORKFLOW_RESULT_NODE_WIDTH, height: WORKFLOW_RESULT_NODE_HEIGHT }
  }
  return { width: WORKFLOW_ICON_NODE_SIZE, height: WORKFLOW_ICON_NODE_SIZE }
}
