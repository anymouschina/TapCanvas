export function sanitizeVideoDuration(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export function resolveComparisonDuration(durations: readonly number[]): number {
  return durations.reduce((maximum, duration) => Math.max(maximum, sanitizeVideoDuration(duration)), 0)
}

export function clampComparisonTime(timeSeconds: number, durationSeconds: number): number {
  const duration = sanitizeVideoDuration(durationSeconds)
  if (duration === 0) return 0
  if (!Number.isFinite(timeSeconds)) return 0
  return Math.max(0, Math.min(duration, timeSeconds))
}

export function resolveCorrespondingVideoTime(
  sharedTimeSeconds: number,
  videoDurationSeconds: number,
): number {
  return clampComparisonTime(sharedTimeSeconds, videoDurationSeconds)
}

export function formatVideoCompareTime(timeSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(timeSeconds) ? timeSeconds : 0)
  const minutes = Math.floor(safe / 60)
  const seconds = Math.floor(safe % 60)
  const tenths = Math.floor((safe - Math.floor(safe)) * 10)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
}

export function resolveTimelineTickStep(pxPerSecond: number): number {
  const safeDensity = Math.max(1, Number.isFinite(pxPerSecond) ? pxPerSecond : 1)
  const targetSeconds = 72 / safeDensity
  return [0.25, 0.5, 1, 2, 5, 10, 30, 60].find((step) => step >= targetSeconds) ?? 60
}
