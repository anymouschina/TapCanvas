import { resolveWorkflowMediaPreview } from './workflowMediaPreview'

export const WORKFLOW_ICON_NODE_SIZE = 56
export const WORKFLOW_RESULT_NODE_WIDTH = 240
export const WORKFLOW_RESULT_NODE_HEIGHT = 135
export const WORKFLOW_ICON_NODE_COLUMN_STRIDE = 136
export const WORKFLOW_ICON_NODE_ROW_STRIDE = 112

export type WorkflowNodeCanvasSize = Readonly<{ width: number; height: number }>

export function resolveWorkflowNodeCanvasSize(data: Record<string, unknown>): WorkflowNodeCanvasSize {
  const media = resolveWorkflowMediaPreview(data)
  if (media.kind && media.displayMode === 'result') {
    return { width: WORKFLOW_RESULT_NODE_WIDTH, height: WORKFLOW_RESULT_NODE_HEIGHT }
  }
  return { width: WORKFLOW_ICON_NODE_SIZE, height: WORKFLOW_ICON_NODE_SIZE }
}
// Workflow ports belong visually to the compact icon, not to the generous connection gutter used
// by full-size media/text cards. Keeping them close also leaves a short, readable lead-in before an
// edge enters the left-to-right flow.
export const WORKFLOW_ICON_NODE_HANDLE_OFFSET = 8
// Main workflow depth advances horizontally; nodes on the same depth are vertical branch lanes.
export const WORKFLOW_ICON_NODE_FLOW_GAP_X = 64
export const WORKFLOW_ICON_NODE_FLOW_GAP_Y = 48
export const WORKFLOW_EDGE_ROUTE_OFFSET = 8
// Reserved above and below workflow nodes for two alternating skip-edge rails.
export const WORKFLOW_EDGE_RAIL_GUTTER = 72
