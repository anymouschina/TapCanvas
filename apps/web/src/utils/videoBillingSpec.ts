export function normalizeVideoResolution(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, '').toLowerCase()
}

export function buildVideoBillingSpecKey(resolution: unknown, durationSeconds: number): string {
  const normalizedResolution = normalizeVideoResolution(resolution)
  const normalizedDuration = Number.isFinite(durationSeconds) ? Math.trunc(durationSeconds) : 0
  if (!normalizedResolution || normalizedDuration <= 0) return ''
  return `video:${normalizedResolution}:${normalizedDuration}s`
}
