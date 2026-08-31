export type WorkflowAgentProgress = Readonly<{
  label: string
  detail: string
}>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function heartbeatDetail(deliveryEvidence: Record<string, unknown> | null): string {
  const lastConfirmedAt = readString(deliveryEvidence?.lastConfirmedAt)
  if (!lastConfirmedAt) return ''
  const timestamp = Date.parse(lastConfirmedAt)
  if (!Number.isFinite(timestamp)) return ''
  return `最近心跳 ${new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })}`
}

export function workflowAgentProgress(evidenceValue: unknown): WorkflowAgentProgress | null {
  const evidence = asRecord(evidenceValue)
  if (!evidence || evidence.executorCompleted === true) return null
  const deliveryEvidence = asRecord(evidence.deliveryEvidence)
  const requestTerminal = asRecord(evidence.requestTerminal)
  const reason = readString(evidence.continuationReason) || readString(requestTerminal?.reason)
  const heartbeat = heartbeatDetail(deliveryEvidence)

  if (reason === 'workflow_agent_same_task_continuation_scheduled') {
    return { label: '同链续跑中', detail: heartbeat || '恢复检查点已保存' }
  }
  if (reason === 'workflow_agent_same_task_continuation_pending') {
    return { label: '等待续跑', detail: heartbeat || '等待持久执行器恢复' }
  }
  if (reason === 'workflow_agent_transport_recovery_pending') {
    return { label: '连接恢复中', detail: heartbeat || '等待 Agent 连接恢复' }
  }
  if (reason === 'workflow_agent_turn_still_running' || readString(deliveryEvidence?.state) === 'running') {
    return { label: 'Agent 生成中', detail: heartbeat || 'Agent 正在生成节点产物' }
  }
  return null
}
