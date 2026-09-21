/** Deterministic model parameters shared by quotation and execution. */
export function resolveImageQuality(input: {
  quality?: string | null
  qualityOptions: readonly string[]
  defaultQuality?: string | null
}): string | undefined {
  // An empty catalog dimension is unsupported, not an unrestricted string.
  if (input.qualityOptions.length === 0) return undefined
  const requested = (input.quality?.trim() || input.defaultQuality?.trim() || '').toLowerCase()
  if (!requested) throw new Error('当前模型要求选择画质，但未提供画质或目录默认值')
  const selected = input.qualityOptions.find((value) => value.toLowerCase() === requested)
  if (!selected) throw new Error(`当前模型不支持画质 ${requested}`)
  return selected
}

function segment(value?: string | null): string {
  return (value || '').trim().toLowerCase().replace(/:/g, '_').replace(/[^a-z0-9_.-]+/g, '_')
}

export function resolveImageBillingSpec(input: {
  resolution?: string | null
  imageSize?: string | null
  aspectRatio?: string | null
  quality?: string | null
  specKeys: readonly string[]
}): string | null {
  const resolution = segment(input.resolution) || segment(input.imageSize)
  if (!resolution) return null
  const quality = segment(input.quality)
  const aspect = segment(input.aspectRatio)
  const canonical = ['image', resolution, quality].filter(Boolean).join(':')
  const candidates = [canonical]
  if (aspect) candidates.push(`image:${aspect}:${resolution}:${quality || 'auto'}`)
  // Quality is a paid dimension: never substitute a resolution-only price.
  for (const candidate of candidates) {
    const published = input.specKeys.find((key) => key.trim().toLowerCase() === candidate)
    if (published) return published
  }
  // Preserve the requested dimensions for an explicit missing-price error.
  return canonical
}
