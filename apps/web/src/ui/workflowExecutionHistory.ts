import type { WorkflowExecutionDto, WorkflowNodeRunDto } from '../api/server'
import { resolveWorkflowWaitingReason } from '../canvas/workflowWaitingReason'

const FOCUS_PRIORITY: Readonly<Record<WorkflowNodeRunDto['status'], number>> = {
  failed: 0,
  waiting_external: 1,
  running: 2,
  queued: 3,
  canceled: 4,
  success: 5,
  skipped: 6,
  not_selected: 7,
}

export function workflowExecutionStatusLabel(status: WorkflowExecutionDto['status']): string {
  if (status === 'success') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'running') return '运行中'
  if (status === 'queued') return '排队中'
  return '已取消'
}

export function workflowNodeRunStatusLabel(
  status: WorkflowNodeRunDto['status'],
  outputRefs?: unknown,
): string {
  if (status === 'success') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'waiting_external') return resolveWorkflowWaitingReason(outputRefs)?.label || '等待外部结果'
  if (status === 'running') return '正在执行'
  if (status === 'queued') return '等待执行'
  if (status === 'canceled') return '已取消'
  if (status === 'not_selected') return '分支未选择'
  return '已跳过'
}

export function workflowFocusNodePrefix(status: WorkflowNodeRunDto['status']): string {
  if (status === 'failed') return '失败于'
  if (status === 'waiting_external') return '等待在'
  if (status === 'running') return '执行到'
  if (status === 'queued') return '即将执行'
  return '节点'
}

export function resolveWorkflowExecutionFocusNode(
  nodeRuns: readonly WorkflowNodeRunDto[],
): WorkflowNodeRunDto | null {
  const focus = [...nodeRuns].sort((left, right) => {
    const priorityDelta = FOCUS_PRIORITY[left.status] - FOCUS_PRIORITY[right.status]
    if (priorityDelta !== 0) return priorityDelta
    return left.createdAt.localeCompare(right.createdAt)
  })[0]
  return focus && FOCUS_PRIORITY[focus.status] <= FOCUS_PRIORITY.queued ? focus : null
}

export function formatWorkflowExecutionDuration(execution: WorkflowExecutionDto): string {
  const start = Date.parse(execution.startedAt ?? execution.createdAt)
  const finish = Date.parse(execution.finishedAt ?? '')
  if (!Number.isFinite(start)) return '耗时未知'
  if (!Number.isFinite(finish)) return execution.status === 'running' ? '运行中' : '耗时未知'
  const durationMs = Math.max(0, finish - start)
  if (durationMs < 1_000) return `${durationMs} ms`
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} 秒`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.floor((durationMs % 60_000) / 1_000)
  return `${minutes} 分 ${seconds} 秒`
}
