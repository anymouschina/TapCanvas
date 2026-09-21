const MAX_RETRY_AFTER_MS = 2_147_000_000

export function readRetryAfterMilliseconds(value: string | null, now = Date.now()): number | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (/^[0-9]+$/.test(raw)) {
    const seconds = Number(raw)
    if (!Number.isSafeInteger(seconds)) return null
    return Math.min(MAX_RETRY_AFTER_MS, seconds * 1000)
  }
  const date = Date.parse(raw)
  if (!Number.isFinite(date)) return null
  return Math.max(0, Math.min(MAX_RETRY_AFTER_MS, date - now))
}

export function isRetryableChatTransportError(error: unknown): boolean {
  if (error instanceof Error && error.message.startsWith('agents_chat_stream_')) return false
  if (!error || typeof error !== 'object') return true
  const statusValue = Number((error as { status?: unknown }).status)
  if (!Number.isFinite(statusValue) || statusValue <= 0) return true
  return statusValue === 408
    || statusValue === 425
    || statusValue === 429
    || statusValue >= 500
}
