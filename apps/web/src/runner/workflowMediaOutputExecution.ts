import type { Node } from '@xyflow/react'
import {
  getWorkflowExecution,
  getWorkflowExecutionFamily,
  listWorkflowNodeRuns,
  resumeWorkflowExecution,
  type WorkflowMediaRetryRequestDto,
  type WorkflowNodeRunDto,
} from '../api/server'
import { resolveWorkflowMediaOutputSlot, type WorkflowMediaOutputSlot } from '../canvas/workflowMediaAttemptProjection'

type JsonRecord = Record<string, unknown>

export type WorkflowMediaRetryPlan = Readonly<{
  nodeId: string
  mediaRetries?: readonly WorkflowMediaRetryRequestDto[]
}>

export class WorkflowMediaExecutionStillActiveError extends Error {
  readonly executionId: string
  readonly executionStatus: string
  readonly attemptStatus: string
  readonly hasProviderTaskReceipt: boolean
  readonly submissionState: string | null

  constructor(input: Readonly<{
    executionId: string
    executionStatus: string
    attempt: WorkflowMediaOutputSlot['activeAttempt']
  }>) {
    const hasProviderTaskReceipt = Boolean(input.attempt.taskId)
    const orphanedImage = input.attempt.kind !== 'video'
      && normalizeMediaStatus(input.attempt.status) === 'failed'
      && !hasProviderTaskReceipt
      && input.attempt.assetUrls.length === 0
    const imagePreUpstreamRejected = input.attempt.kind !== 'video'
      && normalizeMediaStatus(input.attempt.status) === 'failed'
      && !hasProviderTaskReceipt
      && input.attempt.submissionState === 'rejected_pre_upstream'
    const message = imagePreUpstreamRejected
      ? `工作流执行 ${input.executionId} 仍标记为“${input.executionStatus}”；当前图片有上游提交前拒绝记录，但执行尚未结束，暂不能追加安全重试。已打开执行快照查看持久执行状态。`
      : orphanedImage
      ? `工作流执行 ${input.executionId} 仍标记为“${input.executionStatus}”；当前图片占位没有供应商 task 回执，无法确认供应商是否已受理，因此本次未重提。已打开执行快照查看持久执行状态。`
      : `工作流执行 ${input.executionId} 仍标记为“${input.executionStatus}”；本次没有提交新的媒体任务。已打开执行快照查看执行状态。`
    super(message)
    this.name = 'WorkflowMediaExecutionStillActiveError'
    this.executionId = input.executionId
    this.executionStatus = input.executionStatus
    this.attemptStatus = input.attempt.status
    this.hasProviderTaskReceipt = hasProviderTaskReceipt
    this.submissionState = input.attempt.submissionState
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeMediaStatus(value: string): string {
  if (value === 'error') return 'failed'
  if (value === 'succeeded') return 'success'
  if (value === 'cancelled') return 'canceled'
  return value
}

function hasExactInputContractRejection(run: WorkflowNodeRunDto): boolean {
  if (!isRecord(run.outputRefs) || !isRecord(run.outputRefs.evidence)) return false
  const rejection = run.outputRefs.evidence.inputContractRejection
  if (!isRecord(rejection)
    || rejection.protocolVersion !== 'workflow.input-contract-rejection/v1'
    || readString(rejection.consumerNodeId) !== run.nodeId
    || !Array.isArray(rejection.rejectedBindings)
    || rejection.rejectedBindings.length === 0) return false
  return rejection.rejectedBindings.every((binding) => isRecord(binding)
    && readString(binding.targetPortId) !== null
    && readString(binding.sourceNodeId) !== null
    && readString(binding.sourceNodeRunId) !== null
    && readString(binding.sourcePortId) !== null
    && isRecord(binding.expectedContract)
    && Array.isArray(binding.artifacts))
}

function parentNodeIdForRuntime(runtimeNodeId: string): string {
  const itemMarker = '::item::'
  const markerIndex = runtimeNodeId.lastIndexOf(itemMarker)
  return markerIndex >= 0 ? runtimeNodeId.slice(0, markerIndex) : runtimeNodeId
}

function failedItemRetries(
  run: WorkflowNodeRunDto,
  slot: WorkflowMediaOutputSlot,
): readonly WorkflowMediaRetryRequestDto[] {
  const expectedExecutor = slot.activeAttempt.kind === 'video'
    ? 'tapcanvas.video.generate/v1'
    : 'tapcanvas.image.generate/v1'
  if (!isRecord(run.outputRefs) || run.outputRefs.executionMode !== 'each'
    || run.outputRefs.nodeId !== run.nodeId || run.outputRefs.executorRef !== expectedExecutor
    || !Array.isArray(run.outputRefs.itemRuns)) return []
  const activeCanvasNodeId = slot.activeAttempt.canvasNodeId
  const logicalRuntimeNodeId = isRecord(slot.node.data) ? readString(slot.node.data.workflowRuntimeNodeId) : null
  return run.outputRefs.itemRuns.flatMap((value) => {
    if (!isRecord(value) || value.status !== 'failed') return []
    const itemId = readString(value.itemId)
    const itemRuntimeNodeId = readString(value.runtimeNodeId)
    const evidence = isRecord(value.evidence) ? value.evidence : null
    if (!itemId || !evidence
      || itemRuntimeNodeId !== logicalRuntimeNodeId
      || readString(evidence.canvasNodeId) !== activeCanvasNodeId) return []
    const taskId = readString(evidence.taskId)
    const preUpstreamVideoFailure = slot.activeAttempt.kind === 'video'
      && evidence.taskId === null
      && evidence.workflowSubmissionState === 'rejected_pre_upstream'
    const preUpstreamImageFailure = slot.activeAttempt.kind !== 'video'
      && evidence.taskId === null
      && evidence.providerStatus === 'failed'
      && evidence.workflowSubmissionState === 'rejected_pre_upstream'
      && Boolean(slot.activeAttempt.workflowTaskId)
      && readString(evidence.workflowTaskId) === slot.activeAttempt.workflowTaskId
    if (evidence.providerStatus !== 'failed'
      && !preUpstreamVideoFailure) return []
    if (slot.activeAttempt.assetUrls.length > 0) return []
    if (taskId === null && !preUpstreamVideoFailure && !preUpstreamImageFailure) return []
    return [{ nodeId: run.nodeId, itemId, taskId }]
  })
}

function failedSingleNodeRetry(
  run: WorkflowNodeRunDto,
  slot: WorkflowMediaOutputSlot,
): WorkflowMediaRetryRequestDto | null {
  const rawOutput = run.outputRefs
  if (!isRecord(rawOutput) || rawOutput.executionMode !== 'once' || rawOutput.nodeId !== run.nodeId) return null
  const evidenceValue = rawOutput.evidence
  if (!isRecord(evidenceValue)) return null
  const output = rawOutput
  const evidence = evidenceValue
  const activeAttempt = slot.activeAttempt
  const canvasNodeId = readString(evidence.canvasNodeId)
  const expectedExecutor = activeAttempt.kind === 'video'
    ? 'tapcanvas.video.generate/v1'
    : 'tapcanvas.image.generate/v1'
  if (output.executorRef !== expectedExecutor || canvasNodeId !== activeAttempt.canvasNodeId
    || !Object.prototype.hasOwnProperty.call(evidence, 'taskId') || activeAttempt.assetUrls.length > 0) return null
  const taskIdValue = evidence.taskId
  const taskId = readString(taskIdValue)
  if (taskIdValue !== null && !taskId) return null
  const preUpstreamVideoFailure = activeAttempt.kind === 'video'
    && evidence.workflowSubmissionState === 'rejected_pre_upstream'
    && activeAttempt.submissionState === 'rejected_pre_upstream'
  const preUpstreamImageFailure = activeAttempt.kind !== 'video'
    && taskIdValue === null
    && evidence.providerStatus === 'failed'
    && evidence.workflowSubmissionState === 'rejected_pre_upstream'
    && Boolean(activeAttempt.workflowTaskId)
    && readString(evidence.workflowTaskId) === activeAttempt.workflowTaskId
  if (evidence.providerStatus !== 'failed' && !preUpstreamVideoFailure) return null
  if (taskId === null && !preUpstreamVideoFailure && !preUpstreamImageFailure) return null
  if (activeAttempt.assetUrls.length > 0) return null
  return { nodeId: run.nodeId, itemId: null, taskId }
}

export function planWorkflowMediaOutputRetry(input: Readonly<{
  slot: WorkflowMediaOutputSlot
  run: WorkflowNodeRunDto
}>): WorkflowMediaRetryPlan {
  const { slot, run } = input
  if (run.status !== 'failed' && run.status !== 'success') {
    throw new Error(`工作流节点当前状态为“${run.status}”，没有可验证的失败节点回执；本次未提交重试。`)
  }
  if (normalizeMediaStatus(slot.activeAttempt.status) !== 'failed') {
    throw new Error('此逻辑卡位的当前尝试没有处于失败状态；已有结果与回执保持不变。')
  }
  if (run.status === 'failed' && hasExactInputContractRejection(run)) {
    return { nodeId: run.nodeId }
  }
  const mediaRetries = failedItemRetries(run, slot)
  if (mediaRetries.length === 1) return { nodeId: run.nodeId, mediaRetries }
  if (mediaRetries.length > 1) {
    throw new Error('此画布卡位对应多个失败媒体项，无法从单卡点击安全推断目标项；请在执行快照中逐项选择重试。')
  }
  const singleNodeRetry = failedSingleNodeRetry(run, slot)
  if (singleNodeRetry && run.status === 'failed') return { nodeId: run.nodeId, mediaRetries: [singleNodeRetry] }
  throw new Error('没有找到与此画布尝试完全匹配的失败媒体回执；为避免重复提交或扣费，本次未重试。')
}

function resolveLatestFailedRun(
  runs: readonly WorkflowNodeRunDto[],
  slot: WorkflowMediaOutputSlot,
): WorkflowNodeRunDto {
  const runtimeNodeId = isRecord(slot.node.data) ? readString(slot.node.data.workflowRuntimeNodeId) : null
  const candidates = runs.flatMap((run): WorkflowNodeRunDto[] => {
    const output = isRecord(run.outputRefs) ? run.outputRefs : null
    if (!output || !Array.isArray(output.itemRuns)) return [run]
    const nested = output.itemRuns.flatMap((outerItem): WorkflowNodeRunDto[] => {
      if (!isRecord(outerItem) || !isRecord(outerItem.evidence)) return []
      const pipelineState = outerItem.evidence.pipelineState
      if (!isRecord(pipelineState) || !isRecord(pipelineState.steps)) return []
      return Object.values(pipelineState.steps).flatMap((step): WorkflowNodeRunDto[] => {
        if (!isRecord(step) || !isRecord(step.outputRefs)
          || (step.status !== 'success' && step.status !== 'failed')) return []
        const nodeId = readString(step.outputRefs.nodeId)
        if (!nodeId || !nodeId.startsWith(`${readString(outerItem.runtimeNodeId)}::step::`)) return []
        return [{ ...run, nodeId, status: step.status, outputRefs: step.outputRefs }]
      })
    })
    return [run, ...nested]
  })
  const matching = candidates.filter((run) => {
    if (!runtimeNodeId) return false
    const itemRunMatches = isRecord(run.outputRefs)
      && run.outputRefs.executionMode === 'each'
      && run.outputRefs.nodeId === run.nodeId
      && Array.isArray(run.outputRefs.itemRuns)
      && run.outputRefs.itemRuns.some((value) => isRecord(value)
        && value.status === 'failed'
        && readString(value.runtimeNodeId) === runtimeNodeId
        && isRecord(value.evidence)
        && (readString(value.evidence.canvasNodeId) === slot.activeAttempt.canvasNodeId
          || hasExactInputContractRejection(run)))
    const singleNodeMediaMatches = isRecord(run.outputRefs)
      && run.status === 'failed'
      && run.outputRefs.executionMode === 'once'
      && run.outputRefs.nodeId === run.nodeId
      && isRecord(run.outputRefs.evidence)
      && readString(run.outputRefs.evidence.canvasNodeId) === slot.activeAttempt.canvasNodeId
    const inputContractMatches = hasExactInputContractRejection(run)
      && run.nodeId === parentNodeIdForRuntime(runtimeNodeId)
    return itemRunMatches || singleNodeMediaMatches || inputContractMatches
  })
  const failed = matching[matching.length - 1]
  if (!failed) {
    throw new Error(runtimeNodeId
      ? `最新工作流执行中找不到与画布尝试“${slot.activeAttempt.canvasNodeId}”匹配的失败 item 回执（runtimeNodeId=${runtimeNodeId}）；没有提交重试。`
      : `画布尝试“${slot.activeAttempt.canvasNodeId}”缺少 runtimeNodeId；没有提交重试。`)
  }
  return failed
}

function statusReason(status: string): string {
  if (status === 'success') return '该工作流执行已经成功，已有生成结果保留；如需新版本，请从工作流发起新执行。'
  if (status === 'canceled') return '该工作流执行已取消；请从工作流恢复入口处理，媒体卡不会覆盖原执行记录。'
  return `该工作流执行状态为“${status}”，当前没有可安全重试的失败回执。`
}

/** Resume a durable workflow from the exact failed media receipt behind a visible logical slot. */
export async function resumeWorkflowMediaOutputs(
  nodes: readonly Node[], targetNodeIds: readonly string[], options?: { exactMediaRetriesOnly?: boolean },
) {
  if (targetNodeIds.length === 0) throw new Error('缺少要恢复的媒体节点。')
  const slots = targetNodeIds.map((targetNodeId) => {
    const slot = resolveWorkflowMediaOutputSlot(nodes, targetNodeId)
    if (!slot) throw new Error(`节点 ${targetNodeId} 不是带持久工作流身份的图片/视频输出节点。`)
    const data = isRecord(slot.node.data) ? slot.node.data : {}
    const sourceExecutionId = readString(data.workflowExecutionId)
    const runtimeNodeId = readString(data.workflowRuntimeNodeId)
    const familyId = readString(data.workflowExecutionFamilyId)
    if (!sourceExecutionId || !runtimeNodeId || !familyId) {
      throw new Error('工作流媒体输出缺少 executionId、familyId 或 runtimeNodeId，无法安全定位原执行。')
    }
    return { slot, sourceExecutionId, familyId }
  })
  if (new Set(slots.map((item) => item.familyId)).size !== 1) {
    throw new Error('上游媒体属于不同工作流执行族，无法作为一次恢复提交。')
  }
  const family = await getWorkflowExecutionFamily(slots[0]!.sourceExecutionId, 200)
  const latestExecution = await getWorkflowExecution(family.latestExecutionId)
  if (latestExecution.status === 'queued' || latestExecution.status === 'running') {
    throw new WorkflowMediaExecutionStillActiveError({
      executionId: latestExecution.id,
      executionStatus: latestExecution.status,
      attempt: slots[0]!.slot.activeAttempt,
    })
  }
  if (latestExecution.status !== 'failed' && latestExecution.status !== 'success') {
    throw new Error(statusReason(latestExecution.status))
  }

  const runs = await listWorkflowNodeRuns(latestExecution.id)
  const plans = slots.map(({ slot }) => planWorkflowMediaOutputRetry({ slot, run: resolveLatestFailedRun(runs, slot) }))
  const mediaRetries = plans.flatMap((plan) => plan.mediaRetries ?? [])
  if (options?.exactMediaRetriesOnly && plans.some((plan) => !plan.mediaRetries)) {
    throw new Error('视频上游图片缺少精确失败媒体 item 回执，不能扩大恢复范围。')
  }
  if (mediaRetries.length > 0 && plans.some((plan) => !plan.mediaRetries)) {
    throw new Error('上游媒体恢复请求包含不同类型的失败回执，无法作为一次恢复提交。')
  }
  const retryFrontiers = new Set(mediaRetries.map((retry) => retry.nodeId.split('::item::', 1)[0]))
  if (retryFrontiers.size > 1) throw new Error('上游媒体分属不同的恢复节点，无法作为一次恢复提交。')
  const exactRetries = [...new Map(mediaRetries.map((retry) => [JSON.stringify([retry.nodeId, retry.itemId]), retry])).values()]
  return resumeWorkflowExecution(latestExecution.id, {
    ...(exactRetries.length > 0 ? { mediaRetries: exactRetries } : { nodeId: plans[0]!.nodeId }),
  })
}

/** Resume a durable workflow from the exact failed media receipt behind a visible logical slot. */
export async function resumeWorkflowMediaOutput(nodes: readonly Node[], targetNodeId: string) {
  return resumeWorkflowMediaOutputs(nodes, [targetNodeId])
}
