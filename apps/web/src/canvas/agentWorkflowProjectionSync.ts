import type { AgentDiagnosticsTraceDto } from '../api/server'
import { useRFStore } from './store'

export function findLatestAgentWorkflowTrace(
  traces: readonly AgentDiagnosticsTraceDto[],
  requestedAt: string,
  workflowKey?: string,
): AgentDiagnosticsTraceDto | null {
  const requestedAtMs = Date.parse(requestedAt)
  return traces
    .filter((trace) => !workflowKey || trace.workflowKey === workflowKey)
    .filter((trace) => !Number.isFinite(requestedAtMs) || Date.parse(trace.createdAt) >= requestedAtMs)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null
}

export function applyAgentWorkflowTrace(workflowInstanceId: string, trace: AgentDiagnosticsTraceDto): void {
  useRFStore.setState((state) => ({
    nodes: state.nodes.map((node) => {
      const data = node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {}
      if (data.workflowInstanceId !== workflowInstanceId) return node
      return {
        ...node,
        data: {
          ...data,
          workflowTraceId: trace.id,
          workflowTraceStatus: trace.status,
          workflowTraceUpdatedAt: trace.updatedAt,
          workflowLogicalTaskId: trace.logicalTaskId ?? undefined,
          workflowPhysicalRunId: trace.physicalRunId ?? undefined,
          workflowResultSummary: trace.resultSummary ?? undefined,
          workflowErrorCode: trace.errorCode ?? undefined,
          workflowErrorDetail: trace.errorDetail ?? undefined,
        },
      }
    }),
  }))
}
