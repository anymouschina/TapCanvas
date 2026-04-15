function toPositiveInteger(value: unknown): number | null {
  const normalized = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(normalized) || normalized <= 0) return null
  return Math.floor(normalized)
}

export function parseVideoDurationFromSpecKey(value: unknown): number | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null

  const parts = raw.split(':')
  if (parts.length < 3) return null

  const durationToken = parts[parts.length - 1]?.trim().toLowerCase() ?? ''
  if (!durationToken.endsWith('s')) return null
  return toPositiveInteger(durationToken.slice(0, -1))
}

export function readVideoDurationSeconds(
  data: Readonly<Record<string, unknown>>,
  fallback: number,
): number {
  const fromVideoDuration = toPositiveInteger(data.videoDurationSeconds)
  const fromDuration = toPositiveInteger(data.durationSeconds)
  const fromVideoSpecKey = parseVideoDurationFromSpecKey(data.videoSpecKey)
  const fromSpecKey = parseVideoDurationFromSpecKey(data.specKey)

  const matchingSpecDuration =
    [fromVideoSpecKey, fromSpecKey].find((candidate) => (
      candidate !== null &&
      (candidate === fromVideoDuration || candidate === fromDuration)
    )) ?? null

  if (matchingSpecDuration !== null) return matchingSpecDuration
  if (fromVideoDuration !== null) return fromVideoDuration
  if (fromDuration !== null) return fromDuration
  if (fromVideoSpecKey !== null) return fromVideoSpecKey
  if (fromSpecKey !== null) return fromSpecKey

  const normalizedFallback = toPositiveInteger(fallback)
  return normalizedFallback ?? 5
}

export function buildVideoDurationPatch(durationSeconds: number): {
  videoDurationSeconds: number
  durationSeconds: number
} {
  const normalized = toPositiveInteger(durationSeconds) ?? 5
  return {
    videoDurationSeconds: normalized,
    durationSeconds: normalized,
  }
}
