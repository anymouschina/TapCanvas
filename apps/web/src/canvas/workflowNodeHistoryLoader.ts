import { VIDEO_PRODUCTION_WORKFLOW_KEY } from '@tapcanvas/video-orchestrator-protocol'
import {
  fetchAdminVideoAtomicNodeRunHistory,
  listWorkflowNodeRunHistory,
  type WorkflowNodeRunHistoryDto,
} from '../api/server'

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readRunIds(data: Record<string, unknown>): string[] {
  const stored = Array.isArray(data.workflowRunHistoryIds)
    ? data.workflowRunHistoryIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const current = readString(data, 'workflowRunId')
  const previous = readString(data, 'previousWorkflowRunId')
  return [...new Set([...stored, previous, current].filter(Boolean))]
}

/** Routes history to the runtime that actually owns the node execution. */
export async function loadWorkflowNodeRunHistory(input: Readonly<{
  flowId: string
  nodeId: string
  data: Record<string, unknown>
  limit?: number
}>): Promise<WorkflowNodeRunHistoryDto[]> {
  const workflowKey = readString(input.data, 'workflowKey')
  const atomicNodeId = readString(input.data, 'workflowNodeId')
  const runIds = readRunIds(input.data)
  if (workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY && runIds.length > 0 && atomicNodeId) {
    const histories = await Promise.all(runIds.map((workflowRunId) => (
      fetchAdminVideoAtomicNodeRunHistory({ workflowRunId, atomicNodeId })
    )))
    return histories.flat().sort((left, right) => (
      Date.parse(right.executionCreatedAt) - Date.parse(left.executionCreatedAt)
    )).slice(0, input.limit ?? 20)
  }
  return listWorkflowNodeRunHistory({
    flowId: input.flowId,
    nodeId: input.nodeId,
    limit: input.limit,
  })
}
