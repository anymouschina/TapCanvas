export type TaskErrorDisplay = {
  enhancedMsg: string
}

type UnknownRecord = Record<string, unknown>

const MODERATION_ERROR_CODES = new Set([
  'content_filter',
  'image_safety',
  'moderation_rejected',
  'safety_blocked',
])

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function readErrorCodes(error: unknown): string[] {
  const record = asRecord(error)
  if (!record) return []
  const details = asRecord(record.details)
  const upstreamData = asRecord(details?.upstreamData)
  const upstreamError = asRecord(upstreamData?.error)
  return [record.code, upstreamError?.code, upstreamError?.type]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

export function isSafetyBlockedError(error: unknown): boolean {
  return readErrorCodes(error).some((code) => MODERATION_ERROR_CODES.has(code))
}

export function isModerationFailure(status: unknown, lastError: unknown): boolean {
  if (String(status || '') !== 'error') return false
  return isSafetyBlockedError(lastError)
}

export function resolveTaskErrorDisplay(error: unknown, fallbackMsg: string): TaskErrorDisplay {
  const record = asRecord(error)
  const msg = typeof record?.message === 'string' && record.message.trim()
    ? record.message
    : fallbackMsg || '图像模型调用失败'
  return {
    enhancedMsg: msg,
  }
}
