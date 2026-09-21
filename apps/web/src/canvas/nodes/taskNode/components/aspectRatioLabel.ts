type AspectPair = {
  width: number
  height: number
}

const COMMON_ASPECT_RATIOS: ReadonlyArray<{ width: number; height: number; label: string }> = [
  { width: 16, height: 9, label: '16:9' },
  { width: 9, height: 16, label: '9:16' },
  { width: 4, height: 3, label: '4:3' },
  { width: 3, height: 4, label: '3:4' },
  { width: 1, height: 1, label: '1:1' },
  { width: 3, height: 2, label: '3:2' },
  { width: 2, height: 3, label: '2:3' },
  { width: 5, height: 4, label: '5:4' },
  { width: 4, height: 5, label: '4:5' },
  { width: 21, height: 9, label: '21:9' },
]

function parseAspectPair(value: string): AspectPair | null {
  const normalized = value.trim().toLowerCase().replace('×', 'x')
  const separator = normalized.includes(':') ? ':' : normalized.includes('x') ? 'x' : null
  if (!separator) return null
  const parts = normalized.split(separator)
  if (parts.length !== 2) return null
  const width = Number(parts[0])
  const height = Number(parts[1])
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b !== 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a || 1
}

function canonicalAspectRatio(pair: AspectPair): string {
  const ratio = pair.width / pair.height
  const common = COMMON_ASPECT_RATIOS.find(
    (candidate) => Math.abs(ratio - candidate.width / candidate.height) < 0.015,
  )
  if (common) return common.label
  const divisor = greatestCommonDivisor(pair.width, pair.height)
  return `${pair.width / divisor}:${pair.height / divisor}`
}

/**
 * Converts provider-facing pixel sizes into the compact ratio shown in the UI.
 * The original value remains the option value and is still sent to the provider.
 */
export function formatAspectOptionLabel(value: string, fallbackLabel = value): string {
  const pair = parseAspectPair(value)
  if (pair) return canonicalAspectRatio(pair)
  const fallbackPair = parseAspectPair(fallbackLabel)
  return fallbackPair ? canonicalAspectRatio(fallbackPair) : fallbackLabel
}

