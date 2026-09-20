import type { Node } from '@xyflow/react'
import { cancelWorkflowExecution } from '../api/server'
import { toast } from '../ui/toast'

const ACTIVE_EXECUTION_STATUSES = new Set(['queued', 'running', 'waiting_external'])
const ACTIVE_NODE_STATUSES = new Set(['queued', 'running'])
const pendingCancellationIds = new Set<string>()

type CancellationOutcome = 'canceled' | 'already_terminal' | 'still_active'

function nodeData(node: Node): Record<string, unknown> {
  return node.data && typeof node.data === 'object' && !Array.isArray(node.data)
    ? node.data as Record<string, unknown>
    : {}
}

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  return typeof value === 'string' ? value.trim() : ''
}

function isWorkflowAuthoringNode(node: Node): boolean {
  const data = nodeData(node)
  const kind = readString(data, 'kind')
  return data.adminWorkflow === true
    && (kind === 'workflowTrigger' || kind === 'workflowStage' || node.type === 'groupNode')
}

function isActiveWorkflowNode(node: Node): boolean {
  const data = nodeData(node)
  const workflowStatus = readString(data, 'workflowStatus')
  if (ACTIVE_EXECUTION_STATUSES.has(workflowStatus)) return true

  // `partial` is an aggregate status used by the execution placeholder. It is
  // not a normal per-stage status and must not match the static
  // `workflow-configuration` reference projection.
  if (
    workflowStatus === 'partial'
    && (data.managedProjection === 'workflow_execution' || data.kind === 'workflowExecution')
  ) return true

  const kind = readString(data, 'kind')
  const triggerStatus = readString(data, 'triggerStatus')
  if (kind === 'workflowTrigger' && (triggerStatus === 'requested' || triggerStatus === 'triggered')) return true

  return ACTIVE_NODE_STATUSES.has(readString(data, 'status'))
}

function activeExecutionId(node: Node): string | null {
  const data = nodeData(node)
  const executionId = readString(data, 'workflowExecutionId')
  return executionId && isActiveWorkflowNode(node) ? executionId : null
}

/**
 * Resolves durable executions affected by a canvas deletion.
 *
 * A workflow stage can be queued before its own projection receives the
 * execution id. In that case the deleted stage's workflow instance is used to
 * find the id on another projected stage in the same workflow. This keeps the
 * cancellation decision based on persisted runtime facts instead of node
 * labels or workflow-specific names.
 */
export function collectWorkflowExecutionIdsForDeletedNodes(
  nodes: readonly Node[],
  deletedNodeIds: readonly string[],
): string[] {
  const deletedIds = new Set(deletedNodeIds.map((id) => id.trim()).filter(Boolean))
  if (!deletedIds.size) return []

  const deletedNodes = nodes.filter((node) => deletedIds.has(node.id))
  const executionIds = new Set<string>()
  const workflowInstanceIds = new Set<string>()

  for (const node of deletedNodes) {
    const directExecutionId = activeExecutionId(node)
    if (directExecutionId) executionIds.add(directExecutionId)

    if (isWorkflowAuthoringNode(node)) {
      const instanceId = readString(nodeData(node), 'workflowInstanceId')
      if (instanceId) workflowInstanceIds.add(instanceId)
    }
  }

  if (workflowInstanceIds.size) {
    for (const node of nodes) {
      const data = nodeData(node)
      if (!workflowInstanceIds.has(readString(data, 'workflowInstanceId'))) continue
      const executionId = activeExecutionId(node)
      if (executionId) executionIds.add(executionId)
    }
  }

  return [...executionIds]
}

async function cancelOne(executionId: string): Promise<CancellationOutcome> {
  const result = await cancelWorkflowExecution(executionId)
  return result.execution.status === 'canceled'
    ? 'canceled'
    : result.execution.status === 'queued' || result.execution.status === 'running'
      ? 'still_active'
      : 'already_terminal'
}

/**
 * Starts cancellation without delaying the local canvas deletion. The
 * cancellation result is surfaced explicitly; a failed cancellation must not
 * be mistaken for a stopped workflow.
 */
export function requestWorkflowCancellationForDeletedNodes(
  nodes: readonly Node[],
  deletedNodeIds: readonly string[],
): void {
  const executionIds = collectWorkflowExecutionIdsForDeletedNodes(nodes, deletedNodeIds)
    .filter((executionId) => !pendingCancellationIds.has(executionId))
  if (!executionIds.length) return

  executionIds.forEach((executionId) => pendingCancellationIds.add(executionId))
  toast(
    executionIds.length === 1
      ? '节点已删除，正在停止对应工作流…'
      : `节点已删除，正在停止 ${executionIds.length} 个对应工作流…`,
    'info',
  )

  void Promise.allSettled(executionIds.map((executionId) => cancelOne(executionId)))
    .then((results) => {
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      const stillActive = results.filter((result): result is PromiseFulfilledResult<CancellationOutcome> => (
        result.status === 'fulfilled' && result.value === 'still_active'
      ))
      const canceled = results.filter((result): result is PromiseFulfilledResult<CancellationOutcome> => (
        result.status === 'fulfilled' && result.value === 'canceled'
      ))

      if (failures.length || stillActive.length) {
        const firstFailure = failures[0]?.reason
        const reason = firstFailure instanceof Error ? firstFailure.message : ''
        toast(
          reason
            ? `节点已删除，但停止工作流失败：${reason}`
            : '节点已删除，但工作流仍在运行，请从运行日志中断',
          'error',
        )
        return
      }

      if (canceled.length) {
        toast('对应工作流已停止，已完成产物保留', 'success')
      }
    })
    .finally(() => {
      executionIds.forEach((executionId) => pendingCancellationIds.delete(executionId))
    })
}
