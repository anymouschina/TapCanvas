import type { Node } from '@xyflow/react'
import { getTaskNodeCoreType } from '../nodes/taskNodeSchema'

export type VideoCompareSource = {
  nodeId: string
  label: string
  url: string
  durationSeconds: number | null
}

type VideoCompareNode = Pick<Node, 'id' | 'data'>

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readPlayableVideoUrl(value: unknown): string {
  const url = readNonEmptyString(value)
  if (!url) return ''
  if (url.startsWith('/')) return url
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'blob:' ? url : ''
  } catch {
    return ''
  }
}

function readPositiveDuration(value: unknown): number | null {
  const duration = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(duration) && duration > 0 ? duration : null
}

export function resolveVideoCompareSource(node: VideoCompareNode): VideoCompareSource | null {
  const data = asRecord(node.data)
  if (!data) return null
  const kind = readNonEmptyString(data.kind)
  if (getTaskNodeCoreType(kind) !== 'video') return null

  const results = Array.isArray(data.videoResults)
    ? data.videoResults.map(asRecord).filter((item): item is Record<string, unknown> => item !== null)
    : []
  const requestedIndex = typeof data.videoPrimaryIndex === 'number' && Number.isFinite(data.videoPrimaryIndex)
    ? Math.max(0, Math.trunc(data.videoPrimaryIndex))
    : 0
  const requestedResult = results[requestedIndex] ?? null
  const firstResolvedResult = results.find((result) => Boolean(readPlayableVideoUrl(result.url))) ?? null
  const result = requestedResult && readPlayableVideoUrl(requestedResult.url)
    ? requestedResult
    : firstResolvedResult
  const url = readPlayableVideoUrl(result?.url) || readPlayableVideoUrl(data.videoUrl)
  if (!url) return null

  const label = readNonEmptyString(data.label)
    || readNonEmptyString(result?.title)
    || `视频 ${String(node.id)}`
  const durationSeconds = readPositiveDuration(result?.duration)
    ?? readPositiveDuration(data.videoDuration)

  return {
    nodeId: String(node.id),
    label,
    url,
    durationSeconds,
  }
}
