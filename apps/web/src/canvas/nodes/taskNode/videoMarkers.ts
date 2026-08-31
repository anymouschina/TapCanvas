export type VideoMarker = {
  id: string
  sourceVideoUrl: string
  startSeconds: number
  endSeconds: number
  frameUrl: string
  frameAssetId: string
  note: string
  createdAt: string
}

type VideoMarkerInput = Omit<VideoMarker, 'id' | 'createdAt'> & {
  id?: string
  createdAt?: string
}

function readFiniteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRemoteUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export function validateVideoMarkerRange(input: {
  startSeconds: number
  endSeconds: number
  durationSeconds: number | null
}): string {
  if (!Number.isFinite(input.startSeconds) || input.startSeconds < 0) return '起始时间必须是非负数'
  if (!Number.isFinite(input.endSeconds) || input.endSeconds < input.startSeconds) return '结束时间不能早于起始时间'
  if (input.durationSeconds !== null && input.endSeconds > input.durationSeconds) {
    return `结束时间不能超过视频时长 ${input.durationSeconds.toFixed(2)} 秒`
  }
  return ''
}

export function createVideoMarker(input: VideoMarkerInput): VideoMarker {
  const sourceVideoUrl = input.sourceVideoUrl.trim()
  const frameUrl = input.frameUrl.trim()
  const frameAssetId = input.frameAssetId.trim()
  if (!isRemoteUrl(sourceVideoUrl)) throw new Error('视频标记必须绑定真实的 http/https 视频资产')
  if (!isRemoteUrl(frameUrl) || !frameAssetId) throw new Error('视频标记必须保留真实截帧资产')
  const rangeError = validateVideoMarkerRange({
    startSeconds: input.startSeconds,
    endSeconds: input.endSeconds,
    durationSeconds: null,
  })
  if (rangeError) throw new Error(rangeError)
  if (!globalThis.crypto?.randomUUID && !input.id) throw new Error('当前浏览器无法生成可追溯的视频标记标识')
  return {
    id: input.id?.trim() || `video-marker-${globalThis.crypto.randomUUID()}`,
    sourceVideoUrl,
    startSeconds: input.startSeconds,
    endSeconds: input.endSeconds,
    frameUrl,
    frameAssetId,
    note: input.note.trim(),
    createdAt: input.createdAt?.trim() || new Date().toISOString(),
  }
}

export function normalizeVideoMarkers(value: unknown): VideoMarker[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const record = candidate as Record<string, unknown>
    const startSeconds = readFiniteNonNegative(record.startSeconds)
    const endSeconds = readFiniteNonNegative(record.endSeconds)
    const id = readText(record.id)
    const sourceVideoUrl = readText(record.sourceVideoUrl)
    const frameUrl = readText(record.frameUrl)
    const frameAssetId = readText(record.frameAssetId)
    const createdAt = readText(record.createdAt)
    if (
      startSeconds === null
      || endSeconds === null
      || endSeconds < startSeconds
      || !id
      || !isRemoteUrl(sourceVideoUrl)
      || !isRemoteUrl(frameUrl)
      || !frameAssetId
      || !createdAt
    ) return []
    return [{
      id,
      sourceVideoUrl,
      startSeconds,
      endSeconds,
      frameUrl,
      frameAssetId,
      note: readText(record.note),
      createdAt,
    }]
  })
}
