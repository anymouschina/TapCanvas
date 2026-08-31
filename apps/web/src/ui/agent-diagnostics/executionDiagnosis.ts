import type {
  AgentDiagnosticAssessmentV1,
  AgentDiagnosticIssueV1,
  AgentDiagnosticStateV1,
} from '@tapcanvas/agent-observability'
import type { AgentDiagnosticsTraceDto } from '../../api/server'
import type { LiveChatRunRecord } from '../chat/liveChatRunStore'
import type { ExecutionGraph, ExecutionGraphNode, ExecutionGraphNodeKind } from './executionGraph.types'

type ExecutionGraphProjection = Omit<ExecutionGraph, 'diagnosis'>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  const value = record?.[key]
  return typeof value === 'boolean' ? value : null
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readRecords(record: Record<string, unknown> | null, key: string): Record<string, unknown>[] {
  const value = record?.[key]
  if (!Array.isArray(value)) return []
  return value.map(asRecord).filter((item): item is Record<string, unknown> => item !== null)
}

function readStrings(record: Record<string, unknown> | null, key: string): string[] {
  const value = record?.[key]
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

function dedupe(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function nodeFor(
  graph: ExecutionGraphProjection,
  kinds: readonly ExecutionGraphNodeKind[],
  preferredStatuses: readonly ExecutionGraphNode['status'][] = [],
): string | null {
  const preferred = graph.nodes.find((node) => kinds.includes(node.kind) && preferredStatuses.includes(node.status))
  if (preferred) return preferred.id
  return graph.nodes.find((node) => kinds.includes(node.kind))?.id ?? null
}

function fallbackFocusNode(graph: ExecutionGraphProjection): string | null {
  return graph.nodes.find((node) => node.status === 'failed')?.id
    ?? graph.nodes.find((node) => node.status === 'warning')?.id
    ?? graph.nodes.find((node) => node.status === 'running')?.id
    ?? graph.nodes[0]?.id
    ?? null
}

function issue(input: AgentDiagnosticIssueV1): AgentDiagnosticIssueV1 {
  return {
    ...input,
    evidenceRefs: dedupe(input.evidenceRefs),
  }
}

function stateHeadline(state: AgentDiagnosticStateV1): string {
  if (state === 'healthy') return '本轮交付已经闭环'
  if (state === 'running') return '本轮仍在执行'
  if (state === 'waiting') return '已取得进度，正在等待新证据'
  if (state === 'needs_input') return '继续执行需要用户输入或授权'
  if (state === 'repair_required') return '用户目标尚未满足，需要同链修复'
  if (state === 'failed') return '当前安全执行路径已经失败'
  return '现有记录不足以形成可靠诊断'
}

function historicalState(input: {
  trace: AgentDiagnosticsTraceDto
  graph: ExecutionGraphProjection
  requestTerminal: Record<string, unknown> | null
  completionTrace: Record<string, unknown> | null
  deliveryVerification: Record<string, unknown> | null
}): AgentDiagnosticStateV1 {
  const terminalStatus = readString(input.requestTerminal, 'status')
  const verificationStatus = readString(input.deliveryVerification, 'status')
  const completionTerminal = readString(input.completionTrace, 'terminal')
  if (terminalStatus === 'needs_input') return 'needs_input'
  if (terminalStatus === 'suspended') return completionTerminal === 'failure' ? 'repair_required' : 'waiting'
  if (terminalStatus === 'failed' || completionTerminal === 'failure' || input.trace.status === 'failed') return 'failed'
  if (verificationStatus === 'unsatisfied') return 'repair_required'
  if (terminalStatus === 'succeeded' && verificationStatus !== 'unsatisfied') return 'healthy'
  if (input.graph.status === 'running' || input.trace.status === 'running' || input.trace.status === 'waiting_async') return 'running'
  if (input.graph.status === 'failed') return 'failed'
  if (input.graph.status === 'warning') return 'waiting'
  if (input.graph.status === 'succeeded') return 'healthy'
  return 'unverifiable'
}

function diagnosticFlagIssues(meta: Record<string, unknown>, graph: ExecutionGraphProjection): AgentDiagnosticIssueV1[] {
  return readRecords(meta, 'diagnosticFlags').map((flag) => issue({
    code: readString(flag, 'code') || 'runtime_diagnostic_flag',
    severity: readString(flag, 'severity') === 'high' ? 'error' : 'warning',
    stage: 'observability',
    title: readString(flag, 'title') || '运行时诊断标记',
    detail: readString(flag, 'detail') || '运行时未提供更多说明。',
    nodeId: fallbackFocusNode(graph),
    evidenceRefs: [],
  }))
}

export function buildHistoricalExecutionDiagnosis(
  trace: AgentDiagnosticsTraceDto,
  graph: ExecutionGraphProjection,
): AgentDiagnosticAssessmentV1 {
  const meta = asRecord(trace.meta) ?? {}
  const completionTrace = asRecord(meta.completionTrace)
  const toolExecutionIssues = asRecord(meta.toolExecutionIssues)
  const deliveryVerification = asRecord(meta.deliveryVerification)
  const requestTerminal = asRecord(meta.requestTerminal)
  const expectedDelivery = asRecord(meta.expectedDelivery)
  const criteria = readRecords(deliveryVerification, 'criteria')
  const unresolvedCriteria = criteria.filter((criterion) => {
    const status = readString(criterion, 'status')
    return status === 'conflict' || status === 'unresolved'
  })
  const completionMissingCriteria = readStrings(completionTrace, 'missingCriteria')
  const missingCriteria = dedupe([
    ...completionMissingCriteria,
    ...unresolvedCriteria.map((criterion) => readString(criterion, 'requirementId')),
  ])
  const requiredActions = dedupe(readStrings(completionTrace, 'requiredActions'))
  const evidenceRefs = dedupe(criteria.flatMap((criterion) => readStrings(criterion, 'evidenceIds')))
  const issues: AgentDiagnosticIssueV1[] = []

  if (trace.errorCode || trace.errorDetail) {
    issues.push(issue({
      code: trace.errorCode || 'execution_trace_failed',
      severity: 'error',
      stage: 'terminal',
      title: '执行记录包含明确错误',
      detail: trace.errorDetail || trace.resultSummary || '执行记录未提供错误详情。',
      nodeId: nodeFor(graph, ['result'], ['failed']),
      evidenceRefs: [trace.id],
    }))
  }

  if (readBoolean(completionTrace, 'allowFinish') === false) {
    issues.push(issue({
      code: readString(completionTrace, 'failureReason') || 'completion_not_allowed',
      severity: readString(completionTrace, 'terminal') === 'failure' ? 'error' : 'warning',
      stage: 'delivery',
      title: '完成裁决尚未允许结束',
      detail: readString(completionTrace, 'rationale') || '完成裁决未提供原因。',
      nodeId: nodeFor(graph, ['verification', 'result'], ['failed', 'warning']),
      evidenceRefs,
    }))
  }

  if (readString(deliveryVerification, 'status') === 'unsatisfied') {
    issues.push(issue({
      code: 'delivery_verification_unsatisfied',
      severity: readString(requestTerminal, 'status') === 'failed' ? 'error' : 'warning',
      stage: 'delivery',
      title: '交付证据尚未闭环',
      detail: unresolvedCriteria.length > 0
        ? `${unresolvedCriteria.length} 项交付标准仍为 conflict / unresolved。`
        : '交付验证为 unsatisfied，但没有提供逐项未满足标准。',
      nodeId: nodeFor(graph, ['verification'], ['failed', 'warning', 'unavailable']),
      evidenceRefs,
    }))
  }

  if (readBoolean(toolExecutionIssues, 'hasExecutionIssues') === true) {
    const unresolvedToolCalls = readNumber(toolExecutionIssues, 'unresolvedToolCalls') ?? 0
    issues.push(issue({
      code: 'tool_execution_issues_unresolved',
      severity: 'error',
      stage: 'execution',
      title: '仍有未解决的工具执行问题',
      detail: `${unresolvedToolCalls} 次工具问题未被成功重试或真实交付证据覆盖。`,
      nodeId: nodeFor(graph, ['tool'], ['failed', 'warning']),
      evidenceRefs: trace.toolCalls.flatMap((call) => {
        const status = readString(call, 'status')
        if (status !== 'failed' && status !== 'blocked' && status !== 'denied') return []
        return [readString(call, 'toolCallId') || readString(call, 'id')].filter(Boolean)
      }),
    }))
  }

  issues.push(...diagnosticFlagIssues(meta, graph))

  if (graph.provenanceState !== 'complete') {
    issues.push(issue({
      code: graph.provenanceState === 'partial' ? 'execution_provenance_partial' : 'execution_provenance_unavailable',
      severity: 'info',
      stage: 'observability',
      title: '执行来源证据不完整',
      detail: graph.provenanceState === 'partial'
        ? '当前记录仅能追溯部分 Skill 或知识来源。'
        : '当前历史记录无法追溯完整 Skill、知识和模型来源。',
      nodeId: nodeFor(graph, ['context'], ['unavailable', 'warning']),
      evidenceRefs: [],
    }))
  }

  const state = historicalState({ trace, graph, requestTerminal, completionTrace, deliveryVerification })
  const primaryIssue = issues.find((item) => item.severity === 'error')
    ?? issues.find((item) => item.severity === 'warning')
    ?? issues[0]
  const terminalReason = readString(requestTerminal, 'reason')
  const summary = readString(completionTrace, 'rationale')
    || primaryIssue?.detail
    || terminalReason
    || (state === 'healthy'
      ? `${readString(expectedDelivery, 'kind') || '当前请求'}已通过结构化交付验收。`
      : stateHeadline(state))
  const focusNodeId = primaryIssue?.nodeId ?? fallbackFocusNode(graph)
  const sourcePaths = dedupe([
    completionTrace ? 'meta.completionTrace' : '',
    toolExecutionIssues ? 'meta.toolExecutionIssues' : '',
    deliveryVerification ? 'meta.deliveryVerification' : '',
    requestTerminal ? 'meta.requestTerminal' : '',
    'trace.toolCalls',
  ])

  return {
    version: 1,
    state,
    headline: stateHeadline(state),
    summary,
    focusNodeId,
    missingCriteria,
    requiredActions,
    evidenceRefs,
    issues,
    sourcePaths,
    actionable: requiredActions.length > 0,
  }
}

export function buildLiveExecutionDiagnosis(
  run: LiveChatRunRecord,
  graph: ExecutionGraphProjection,
): AgentDiagnosticAssessmentV1 {
  const failedArtifacts = (run.asyncArtifacts ?? []).filter((artifact) => artifact.status === 'failed')
  const failedToolLogs = run.logs.filter((log) => {
    const status = log.toolActivity?.status
    return status === 'failed' || status === 'blocked' || status === 'denied'
  })
  const issues: AgentDiagnosticIssueV1[] = []
  if (run.status === 'failed' || run.errorMessage) {
    issues.push(issue({
      code: run.doneReason || 'live_run_failed',
      severity: 'error',
      stage: 'terminal',
      title: '当前物理运行失败',
      detail: run.errorMessage || run.doneReason || '运行失败但没有返回更多原因。',
      nodeId: nodeFor(graph, ['result'], ['failed']),
      evidenceRefs: [run.requestId, run.runId],
    }))
  }
  if (failedToolLogs.length > 0) {
    issues.push(issue({
      code: 'live_tool_execution_issue',
      severity: run.status === 'active' ? 'warning' : 'error',
      stage: 'execution',
      title: '本轮发生工具执行问题',
      detail: `${failedToolLogs.length} 次工具调用返回 failed / blocked / denied；任务是否恢复以最终交付证据为准。`,
      nodeId: nodeFor(graph, ['tool'], ['warning', 'failed', 'running']),
      evidenceRefs: failedToolLogs.map((log) => log.toolActivity?.toolCallId ?? '').filter(Boolean),
    }))
  }
  if (failedArtifacts.length > 0) {
    issues.push(issue({
      code: 'live_artifact_materialization_failed',
      severity: 'error',
      stage: 'evidence',
      title: '异步资产物化失败',
      detail: `${failedArtifacts.length} 项已受理资产返回失败状态；已成功资产不受影响。`,
      nodeId: nodeFor(graph, ['verification'], ['failed', 'warning']),
      evidenceRefs: failedArtifacts.flatMap((artifact) => [artifact.toolCallId, artifact.taskId, artifact.nodeId]),
    }))
  }

  const state: AgentDiagnosticStateV1 = run.status === 'active'
    ? 'running'
    : run.status === 'succeeded'
      ? 'healthy'
      : run.status === 'waiting_input'
        ? 'needs_input'
        : run.status === 'waiting_external'
          ? 'waiting'
          : 'failed'
  const primaryIssue = issues.find((item) => item.severity === 'error') ?? issues[0]
  return {
    version: 1,
    state,
    headline: stateHeadline(state),
    summary: primaryIssue?.detail || run.doneReason || (state === 'running' ? '当前仅展示已确认的流式执行事实。' : stateHeadline(state)),
    focusNodeId: primaryIssue?.nodeId ?? fallbackFocusNode(graph),
    missingCriteria: [],
    requiredActions: [],
    evidenceRefs: dedupe([run.requestId, run.runId, ...issues.flatMap((item) => item.evidenceRefs)]),
    issues,
    sourcePaths: ['liveRun.status', 'liveRun.logs', 'liveRun.asyncArtifacts'],
    actionable: false,
  }
}
