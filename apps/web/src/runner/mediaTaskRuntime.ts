export type ProviderTaskFailure = Readonly<{
  message: string
  code: string | null
}>

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readFailureCandidate(value: unknown): ProviderTaskFailure | null {
  const directMessage = readText(value)
  if (directMessage) return { message: directMessage, code: null }

  const record = readRecord(value)
  if (!record) return null
  const message = readText(record.message) || readText(record.error) || readText(record.failureReason)
  if (!message) return null
  return {
    message,
    code: readText(record.code) || null,
  }
}

export function isWorkflowOwnedMediaNodeData(value: unknown): boolean {
  const data = readRecord(value)
  if (!data) return false
  return [data.workflowExecutionId, data.workflowEffectId, data.workflowRuntimeNodeId]
    .some((identity) => Boolean(readText(identity)))
}

export function resolveProviderTaskFailure(
  raw: unknown,
  fallbackMessage: string,
): ProviderTaskFailure {
  const record = readRecord(raw)
  const response = readRecord(record?.response)
  const candidates = [
    record?.failureReason,
    response?.error,
    response?.message,
    record?.error,
    record?.message,
  ]
  for (const candidate of candidates) {
    const failure = readFailureCandidate(candidate)
    if (!failure) continue
    return {
      message: failure.message,
      code: failure.code || readText(response?.code) || readText(record?.code) || null,
    }
  }
  return {
    message: fallbackMessage.trim() || '媒体任务失败',
    code: readText(response?.code) || readText(record?.code) || null,
  }
}
