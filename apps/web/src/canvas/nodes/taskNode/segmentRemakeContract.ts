export type SegmentRemakeRange = {
  start: number
  end: number
}

export type SegmentRemakeMarkerInput = Readonly<{
  id: string
  sourceVideoUrl: string
  startSeconds: number
  endSeconds: number
  frameUrl: string
  note: string
}>

export type SegmentRemakeDraft = Readonly<{
  ranges: SegmentRemakeRange[]
  prompt: string
  referenceImages: string[]
  markerIds: string[]
}>

export const MAX_SEGMENT_REMAKE_RANGES = 5

export function normalizeSegmentRemakeRanges(
  ranges: readonly SegmentRemakeRange[],
  duration: number,
): SegmentRemakeRange[] {
  const maximum = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY
  const ordered = ranges
    .flatMap((range): SegmentRemakeRange[] => {
      const start = Math.max(0, Number(range.start))
      const end = Math.min(maximum, Number(range.end))
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.1) return []
      return [{ start, end }]
    })
    .sort((left, right) => left.start - right.start || left.end - right.end)

  const merged: SegmentRemakeRange[] = []
  for (const range of ordered) {
    const previous = merged[merged.length - 1]
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
      continue
    }
    merged.push({ ...range })
    if (merged.length >= MAX_SEGMENT_REMAKE_RANGES) break
  }
  return merged
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Converts explicit markers saved on a source video into the initial state of a
 * segment-remake node. Range markers become executable ranges; frame markers
 * remain visual references. Notes are copied verbatim instead of being
 * semantically rewritten in the client.
 */
export function createSegmentRemakeDraftFromMarkers(input: {
  markers: readonly SegmentRemakeMarkerInput[]
  sourceVideoUrl: string
  duration: number
  referenceImageLimit: number
}): SegmentRemakeDraft {
  const sourceVideoUrl = input.sourceVideoUrl.trim()
  const matchingMarkers = input.markers.filter((marker) => (
    marker.sourceVideoUrl.trim() === sourceVideoUrl
    && marker.id.trim().length > 0
  ))
  const ranges = normalizeSegmentRemakeRanges(
    matchingMarkers.map((marker) => ({
      start: marker.startSeconds,
      end: marker.endSeconds,
    })),
    input.duration,
  )
  const prompt = matchingMarkers
    .map((marker) => marker.note.trim())
    .filter((note, index, all) => note.length > 0 && all.indexOf(note) === index)
    .join('\n')
  const referenceImageLimit = Number.isFinite(input.referenceImageLimit)
    ? Math.max(0, Math.trunc(input.referenceImageLimit))
    : 0
  const referenceImages = matchingMarkers
    .map((marker) => marker.frameUrl.trim())
    .filter((url, index, all) => isHttpUrl(url) && all.indexOf(url) === index)
    .slice(0, referenceImageLimit)

  return {
    ranges,
    prompt,
    referenceImages,
    markerIds: matchingMarkers.map((marker) => marker.id.trim()),
  }
}
