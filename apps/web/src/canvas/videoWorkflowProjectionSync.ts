import {
  parseVideoAtomicWorkflowSnapshot,
  VIDEO_PRODUCTION_WORKFLOW_KEY,
  type VideoAtomicWorkflowNodeId,
  type VideoAtomicWorkflowSnapshot,
} from '@tapcanvas/video-orchestrator-protocol'
import type { AgentDiagnosticsTraceDto } from '../api/server'
import { useRFStore } from './store'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function containsExactString(value: unknown, expected: string, depth = 0): boolean {
  if (depth > 8) return false
  if (typeof value === 'string') return value === expected
  if (Array.isArray(value)) return value.some((item) => containsExactString(item, expected, depth + 1))
  const record = asRecord(value)
  return record ? Object.values(record).some((item) => containsExactString(item, expected, depth + 1)) : false
}

function traceMatchesSourceGroup(trace: AgentDiagnosticsTraceDto, sourceGroupId: string): boolean {
  if (trace.scopeId === sourceGroupId) return true
  return trace.toolCalls.some((call) => containsExactString(call, sourceGroupId))
}

export function findLatestVideoWorkflowSnapshot(
  traces: readonly AgentDiagnosticsTraceDto[],
  sourceGroupId: string,
  requestedAt: string,
): VideoAtomicWorkflowSnapshot | null {
  const requestedAtMs = Date.parse(requestedAt)
  const candidates: VideoAtomicWorkflowSnapshot[] = []
  for (const trace of traces) {
    if (trace.workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY) continue
    if (Number.isFinite(requestedAtMs) && Date.parse(trace.createdAt) < requestedAtMs) continue
    if (!traceMatchesSourceGroup(trace, sourceGroupId)) continue
    const meta = asRecord(trace.meta)
    const runs = Array.isArray(meta?.asyncExecutionRuns) ? meta.asyncExecutionRuns : []
    for (const rawRun of runs) {
      const run = asRecord(rawRun)
      const parsed = parseVideoAtomicWorkflowSnapshot(run?.atomicWorkflow)
      if (parsed.success) candidates.push(parsed.data)
    }
  }
  return candidates.sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt))[0] ?? null
}

export type VideoWorkflowExecutionMode = 'media_delivery' | 'prompt_only'

export function markVideoWorkflowRequested(
  workflowInstanceId: string,
  requestedAt: string,
  executionMode: VideoWorkflowExecutionMode = 'media_delivery',
): void {
  useRFStore.setState((state) => ({
    nodes: state.nodes.map((node) => {
      const data = node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {}
      if (data.workflowInstanceId !== workflowInstanceId) return node
      if (data.kind !== 'workflowTrigger' && data.kind !== 'workflowStage') return node
      return {
        ...node,
        data: {
          ...data,
          workflowRequestedAt: requestedAt,
          workflowExecutionMode: executionMode,
          workflowResultSummary: undefined,
          workflowErrorCode: undefined,
          workflowErrorDetail: undefined,
          previousWorkflowRunId: data.workflowRunId,
          workflowRunId: undefined,
          workflowGeneratedAt: undefined,
          workflowLatestEventSeq: undefined,
          ...(data.kind === 'workflowTrigger'
            ? { triggerStatus: 'requested' }
            : {
                workflowStatus: 'queued',
                workflowCompletedUnits: 0,
                workflowTotalUnits: undefined,
                workflowInputArtifactIds: [],
                workflowOutputArtifactIds: [],
                workflowEffectIds: [],
                workflowErrorCount: 0,
                workflowTiming: undefined,
                workflowLocalTestOutput: undefined,
                workflowExecutionEvidence: undefined,
                workflowItemRuns: [],
              }),
        },
      }
    }),
  }))
}

export function applyVideoWorkflowSnapshot(
  workflowInstanceId: string,
  snapshot: VideoAtomicWorkflowSnapshot,
): void {
  const projectionByNodeId = new Map(snapshot.nodes.map((projection) => [projection.atomicNodeId, projection] as const))
  useRFStore.setState((state) => ({
    nodes: state.nodes.map((node) => {
      const data = node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {}
      if (data.workflowInstanceId !== workflowInstanceId) return node
      if (data.kind === 'workflowTrigger') {
        if (data.workflowGeneratedAt === snapshot.generatedAt && data.workflowLatestEventSeq === snapshot.latestEventSeq) return node
        return {
          ...node,
          data: {
            ...data,
            workflowRunId: snapshot.workflowRunId,
            workflowGeneratedAt: snapshot.generatedAt,
            workflowLatestEventSeq: snapshot.latestEventSeq,
            triggerStatus: 'triggered',
          },
        }
      }
      if (data.kind !== 'workflowStage') return node
      const workflowNodeId = typeof data.workflowNodeId === 'string' ? data.workflowNodeId : ''
      const projection = projectionByNodeId.get(workflowNodeId as VideoAtomicWorkflowNodeId)
      if (!projection) return node
      if (data.workflowGeneratedAt === snapshot.generatedAt && data.workflowLatestEventSeq === snapshot.latestEventSeq) return node
      const historyRunIds = [
        ...(Array.isArray(data.workflowRunHistoryIds)
          ? data.workflowRunHistoryIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          : []),
        ...(typeof data.previousWorkflowRunId === 'string' && data.previousWorkflowRunId.trim()
          ? [data.previousWorkflowRunId.trim()]
          : []),
        snapshot.workflowRunId,
      ].filter((value, index, values) => values.indexOf(value) === index)
      return {
        ...node,
        data: {
          ...data,
          workflowRunId: snapshot.workflowRunId,
          workflowRunHistoryIds: historyRunIds,
          workflowGeneratedAt: snapshot.generatedAt,
          workflowLatestEventSeq: snapshot.latestEventSeq,
          workflowStatus: projection.status,
          workflowCompletedUnits: projection.completedUnits,
          workflowTotalUnits: projection.totalUnits,
          workflowInputArtifactIds: [...projection.inputArtifactIds],
          workflowOutputArtifactIds: [...projection.outputArtifactIds],
          workflowEffectIds: [...projection.effectIds],
          workflowErrorCount: projection.errorCount,
          workflowErrorDetail: projection.errorMessages.join('\n') || undefined,
          workflowTiming: { ...projection.timing },
          workflowLocalTestOutput: { ...projection.outputRefs.ports },
          workflowExecutionEvidence: { ...projection.outputRefs.evidence },
          workflowItemRuns: [...projection.outputRefs.itemRuns],
        },
      }
    }),
  }))
}
