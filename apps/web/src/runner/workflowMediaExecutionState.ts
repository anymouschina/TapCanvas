import type { Node } from '@xyflow/react'
import { isWorkflowMediaOutput } from './manualMediaDerivative'

/** Preallocated effect/task identities are not provider acceptance receipts. */
export function isUnsubmittedWorkflowMedia(node: Node): boolean {
  const data = node.data
  return isWorkflowMediaOutput(node) && data.workflowPreparedOnly === true
    && data.status === 'idle'
    && ![data.taskId, data.imageTaskId, data.videoTaskId, data.remoteTaskId,
      data.workflowSubmissionState, data.workflowSubmissionClaimedAt,
      data.providerAcceptedAt, data.imageUrl, data.videoUrl].some(Boolean)
    && ![data.imageResults, data.videoResults].some(results => Array.isArray(results) && results.length > 0)
}

export function usesPreparedWorkflowMediaSubmission(node: Node): boolean {
  return isUnsubmittedWorkflowMedia(node)
    || (isWorkflowMediaOutput(node) && node.data.mediaTaskExecutionOwner === 'canvas_prepared')
}

export function requiresWorkflowMediaRecovery(node: Node): boolean {
  return isWorkflowMediaOutput(node) && !usesPreparedWorkflowMediaSubmission(node)
}
