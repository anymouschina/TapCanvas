export const WORKFLOW_EXECUTION_REQUEST_EVENT = 'tapcanvas:workflow-execution-request'
export const WORKFLOW_EXECUTION_SYNC_REQUEST_EVENT = 'tapcanvas:workflow-execution-sync-request'
export const WORKFLOW_EXECUTION_SNAPSHOT_REQUEST_EVENT = 'tapcanvas:workflow-execution-snapshot-request'

export type WorkflowExecutionSnapshotRequestDetail = Readonly<{
  executionId: string
}>

/**
 * Requests the global workflow-execution snapshot dialog for a durable
 * execution. Canvas placeholder nodes dispatch this when clicked, so a
 * 小T-triggered execution can be inspected without a manual run path.
 */
export function requestWorkflowExecutionSnapshot(executionId: string): void {
  const normalizedExecutionId = executionId.trim()
  if (!normalizedExecutionId) throw new Error('工作流执行快照请求缺少执行身份')
  window.dispatchEvent(new CustomEvent<WorkflowExecutionSnapshotRequestDetail>(
    WORKFLOW_EXECUTION_SNAPSHOT_REQUEST_EVENT,
    { detail: { executionId: normalizedExecutionId } },
  ))
}

export type WorkflowExecutionRequestDetail = Readonly<{
  triggerNodeId: string
  stopAfterNodeId?: string
  replayFromExecutionId?: string
  startFromNodeId?: string
}>

export function requestWorkflowExecution(
  triggerNodeId: string,
  stopAfterNodeId?: string,
  replay?: Readonly<{ sourceExecutionId: string; startFromNodeId: string }>,
): void {
  const normalizedTriggerNodeId = triggerNodeId.trim()
  if (!normalizedTriggerNodeId) throw new Error('工作流执行请求缺少触发器节点身份')
  const normalizedStopAfterNodeId = stopAfterNodeId?.trim() ?? ''
  if (normalizedStopAfterNodeId === normalizedTriggerNodeId) throw new Error('执行截止节点不能是触发器本身')
  const replayFromExecutionId = replay?.sourceExecutionId.trim() ?? ''
  const startFromNodeId = replay?.startFromNodeId.trim() ?? ''
  if (Boolean(replayFromExecutionId) !== Boolean(startFromNodeId)) {
    throw new Error('局部重放必须同时提供来源执行和起始节点')
  }
  if (startFromNodeId === normalizedTriggerNodeId) throw new Error('触发器没有可复用的上游节点')
  window.dispatchEvent(new CustomEvent<WorkflowExecutionRequestDetail>(
    WORKFLOW_EXECUTION_REQUEST_EVENT,
    {
      detail: {
        triggerNodeId: normalizedTriggerNodeId,
        ...(normalizedStopAfterNodeId ? { stopAfterNodeId: normalizedStopAfterNodeId } : {}),
        ...(replayFromExecutionId && startFromNodeId
          ? { replayFromExecutionId, startFromNodeId }
          : {}),
      },
    },
  ))
}

/**
 * Requests a read-only projection refresh from the durable execution store.
 * Node inspectors use this after reading history so the canvas and the log drawer
 * cannot disagree about the newest terminal state.
 */
export function requestWorkflowExecutionSync(): void {
  window.dispatchEvent(new Event(WORKFLOW_EXECUTION_SYNC_REQUEST_EVENT))
}
