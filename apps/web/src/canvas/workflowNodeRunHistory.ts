import type { WorkflowNodeRunHistoryDto } from '../api/server'
import {
  parseWorkflowMediaAssetV1,
  parseWorkflowNodeProvenanceV1,
  type WorkflowMediaAssetV1,
  type WorkflowNodeProvenanceV1,
} from '@tapcanvas/workflow-kernel-protocol'
import { readWorkflowItemRuns, type WorkflowItemRunView } from './workflowItemRuns'
import { resolveWorkflowWaitingReason } from './workflowWaitingReason'

export type WorkflowNodeRunHistoryView = Readonly<{
  id: string
  executionId: string
  status: WorkflowNodeRunHistoryDto['status']
  executionStatus: WorkflowNodeRunHistoryDto['executionStatus']
  createdAt: string
  finishedAt: string | null
  errorMessage: string | null
  outputRefs: unknown
  output: unknown
  evidence: unknown
  artifactIds: readonly string[]
  mediaAssets: readonly WorkflowMediaAssetV1[]
  provenance: WorkflowNodeProvenanceV1 | null
  itemRuns: readonly WorkflowItemRunView[]
  itemRunPayload: readonly unknown[]
  completedItems: number
  failedItems: number
  waitingItems: number
  totalItems: number
	configuredItemConcurrency: number
	activeItems: number
	peakActiveItems: number
	startedItems: number
  videoItems: readonly WorkflowItemRunView[]
  textItems: readonly WorkflowItemRunView[]
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readItemRunPayload(outputRefs: unknown): readonly unknown[] {
  if (!isRecord(outputRefs) || !Array.isArray(outputRefs.itemRuns)) return []
  return outputRefs.itemRuns
}

function readOutputRefs(outputRefs: unknown): Record<string, unknown> {
  return isRecord(outputRefs) ? outputRefs : {}
}

function readArtifactIds(outputRefs: Record<string, unknown>): readonly string[] {
  if (!Array.isArray(outputRefs.artifacts)) return []
  return outputRefs.artifacts.flatMap((artifact) => {
    if (!isRecord(artifact) || typeof artifact.identity !== 'string') return []
    const identity = artifact.identity.trim()
    return identity ? [identity] : []
  })
}

function readMediaAssets(outputRefs: Record<string, unknown>): readonly WorkflowMediaAssetV1[] {
  if (!Array.isArray(outputRefs.artifacts)) return []
  return outputRefs.artifacts.flatMap((artifact) => {
    if (!isRecord(artifact) || artifact.media === undefined) return []
    return [parseWorkflowMediaAssetV1(artifact.media)]
  })
}

function readProvenance(evidence: Record<string, unknown>): WorkflowNodeProvenanceV1 | null {
  return evidence.workflowProvenance === undefined
    ? null
    : parseWorkflowNodeProvenanceV1(evidence.workflowProvenance)
}

function readNonNegativeInteger(
  value: unknown,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : fallback
}

export function toWorkflowNodeRunHistoryView(
  run: WorkflowNodeRunHistoryDto,
): WorkflowNodeRunHistoryView {
  const itemRunPayload = readItemRunPayload(run.outputRefs)
  const itemRuns = readWorkflowItemRuns(itemRunPayload)
  const outputRefs = readOutputRefs(run.outputRefs)
  const evidence = isRecord(outputRefs.evidence) ? outputRefs.evidence : {}
  return {
    id: run.id,
    executionId: run.executionId,
    status: run.status,
    executionStatus: run.executionStatus,
    createdAt: run.executionCreatedAt || run.createdAt,
    finishedAt: run.executionFinishedAt ?? run.finishedAt ?? null,
    errorMessage: typeof run.errorMessage === 'string' && run.errorMessage.trim()
      ? run.errorMessage.trim()
      : null,
    outputRefs: run.outputRefs,
    output: outputRefs.ports,
    evidence: outputRefs.evidence,
    artifactIds: readArtifactIds(outputRefs),
    mediaAssets: readMediaAssets(outputRefs),
    provenance: readProvenance(evidence),
    itemRuns,
    itemRunPayload,
    completedItems: itemRuns.filter((item) => item.status === 'success').length,
    failedItems: itemRuns.filter((item) => item.status === 'failed').length,
    waitingItems: itemRuns.filter((item) => item.status === 'waiting_external').length,
    totalItems: readNonNegativeInteger(evidence.totalItems, itemRuns.length),
		configuredItemConcurrency: readNonNegativeInteger(evidence.configuredItemConcurrency, 0),
		activeItems: readNonNegativeInteger(evidence.activeItems, 0),
		peakActiveItems: readNonNegativeInteger(evidence.peakActiveItems, 0),
		startedItems: readNonNegativeInteger(evidence.startedItems, itemRuns.length),
    videoItems: itemRuns.filter((item) => item.videoUrl !== null),
    textItems: itemRuns.filter((item) => item.textOutput !== null),
  }
}

export function workflowNodeRunStatusLabel(
  status: WorkflowNodeRunHistoryDto['status'],
  outputRefs?: unknown,
): string {
  if (status === 'success') return '完成'
  if (status === 'failed') return '失败'
  if (status === 'waiting_external') return resolveWorkflowWaitingReason(outputRefs)?.label || '等待外部结果'
  if (status === 'running') return '运行中'
  if (status === 'queued') return '排队中'
  if (status === 'canceled') return '已取消'
  if (status === 'not_selected') return '分支未选择'
  return '已跳过'
}

export function workflowNodeEmptyOutputMessage(
  run: WorkflowNodeRunHistoryView | null,
  loading: boolean,
): string {
  if (loading) return '正在读取最近一次持久输出…'
  if (!run) return '这个节点还没有正式工作流执行记录。'
  if (run.status === 'failed' || run.status === 'canceled' || run.status === 'skipped') {
    return '本次运行未产生输出；请查看下方运行错误。'
  }
  if (run.status === 'not_selected') return '该节点所在分支未被条件选中，因此没有执行。'
  if (run.status === 'queued' || run.status === 'running' || run.status === 'waiting_external') {
    return '节点尚未完成，当前没有可展示输出。'
  }
  return '节点执行成功，但执行器没有声明输出端口。'
}
