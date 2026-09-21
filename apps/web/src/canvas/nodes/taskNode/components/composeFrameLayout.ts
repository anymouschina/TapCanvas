export type ComposeAspect = 'auto' | '16:9' | '9:16' | '1:1'
export type FrameSize = { width: number; height: number }
type FrameSource = FrameSize & { duration: number }

function validateSize(size: FrameSize) {
  if (![size.width, size.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('视频尺寸无效，无法确定合成画幅')
  }
}

/** Output size is independent of connection order; durations are after trimming. */
export function resolveComposeFrame(sources: FrameSource[], aspect: ComposeAspect = 'auto'): FrameSize {
  if (aspect === '16:9') return { width: 1920, height: 1080 }
  if (aspect === '9:16') return { width: 1080, height: 1920 }
  if (aspect === '1:1') return { width: 1080, height: 1080 }
  const groups = new Map<number, { duration: number; size: FrameSize }>()
  for (const source of sources) {
    validateSize(source)
    if (!Number.isFinite(source.duration) || source.duration <= 0) continue
    const ratio = source.width / source.height
    const group = groups.get(ratio)
    const size = !group || source.width * source.height > group.size.width * group.size.height
      ? { width: source.width, height: source.height } : group.size
    groups.set(ratio, { duration: (group?.duration || 0) + source.duration, size })
  }
  const selected = [...groups.values()].sort((a, b) => b.duration - a.duration
    || b.size.width * b.size.height - a.size.width * a.size.height
    || b.size.width - a.size.width)[0]
  if (!selected) throw new Error('没有可合成的有效视频时长')
  return { width: Math.ceil(selected.size.width / 2) * 2, height: Math.ceil(selected.size.height / 2) * 2 }
}

export function containComposeFrame(source: FrameSize, output: FrameSize) {
  validateSize(source)
  validateSize(output)
  const scale = Math.min(output.width / source.width, output.height / source.height)
  const w = source.width * scale
  const h = source.height * scale
  return { x: (output.width - w) / 2, y: (output.height - h) / 2, w, h }
}
