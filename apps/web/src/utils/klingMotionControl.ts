// Frontend helper for Kling motion-control models.
// Mirrors apps/hono-api/src/modules/task/task.kling-motion-control.ts so the
// model list, normalization rules, and duration limits stay aligned.

const KLING_MOTION_CONTROL_MODELS = new Set([
  'kling-v2-6-motion-control',
  'kling-v3-motion-control',
  'kling-motion-control',
])

export type KlingMotionMode = 'std' | 'pro'
export type KlingCharacterOrientation = 'image' | 'video'

export const KLING_MOTION_CONTROL_DEFAULT_MODEL = 'kling-v2-6-motion-control'

function trimmedLower(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function stripVendorSuffix(model: string): string {
  return model.replace(/-(apimart|suchuang|all)$/i, '')
}

export function isKlingMotionControlModel(model: unknown): boolean {
  const normalized = stripVendorSuffix(trimmedLower(model))
  return KLING_MOTION_CONTROL_MODELS.has(normalized)
}

export function normalizeKlingMotionMode(value: unknown): KlingMotionMode {
  return trimmedLower(value) === 'pro' ? 'pro' : 'std'
}

export function normalizeKlingCharacterOrientation(value: unknown): KlingCharacterOrientation {
  return trimmedLower(value) === 'video' ? 'video' : 'image'
}

export function normalizeKlingKeepOriginalSound(value: unknown): 'yes' | 'no' {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  const normalized = trimmedLower(value)
  return normalized === 'no' || normalized === 'false' || normalized === '0' ? 'no' : 'yes'
}

export function getKlingMotionDurationLimits(
  orientation: KlingCharacterOrientation,
): { min: number; max: number } {
  return orientation === 'video' ? { min: 3, max: 30 } : { min: 3, max: 10 }
}

export function clampKlingMotionDuration(input: {
  orientation: KlingCharacterOrientation
  durationSeconds: number
}): number {
  const { min, max } = getKlingMotionDurationLimits(input.orientation)
  const truncated = Math.trunc(input.durationSeconds)
  if (!Number.isFinite(truncated) || truncated < min) return min
  if (truncated > max) return max
  return truncated
}

// Build the motion-control specific extras from raw node data. Returns an
// object that should be merged into the standard video extras.
export function buildKlingMotionControlExtras(input: {
  data: Record<string, unknown> | null | undefined
  durationSeconds: number
}): {
  characterOrientation: KlingCharacterOrientation
  motionMode: KlingMotionMode
  keepOriginalSound: 'yes' | 'no'
  watermarkEnabled: boolean
  durationSeconds: number
} {
  const data = input.data || {}
  const orientation = normalizeKlingCharacterOrientation(
    data.characterOrientation ?? data.character_orientation ?? data.motionOrientation,
  )
  const mode = normalizeKlingMotionMode(
    data.motionMode ?? data.videoResolution ?? data.resolution,
  )
  const keepOriginalSound = normalizeKlingKeepOriginalSound(
    data.keepOriginalSound ?? data.keep_original_sound,
  )
  const watermarkEnabled = data.watermarkEnabled === true || data.watermark_enabled === true
  const duration = clampKlingMotionDuration({
    orientation,
    durationSeconds: input.durationSeconds,
  })
  return {
    characterOrientation: orientation,
    motionMode: mode,
    keepOriginalSound,
    watermarkEnabled,
    durationSeconds: duration,
  }
}
