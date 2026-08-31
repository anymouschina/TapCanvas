// resolveUpstreamRefs.ts
type AnyNode = { id: string; data?: Record<string, unknown> }
export type UpstreamRefs = {
  firstFrameUrl?: string
  sourceVideoUrl?: string
  sourcePrevTaskId?: string
  referenceVideoDurationSeconds?: number
}
function nodeById(nodes: AnyNode[], id?: unknown): AnyNode | undefined {
  const sid = typeof id === 'string' ? id.trim() : ''
  return sid ? nodes.find((n) => n.id === sid) : undefined
}
function httpUrl(v: unknown): string | undefined {
  return typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : undefined
}
function positiveDuration(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}
export function resolveUpstreamRefs(node: AnyNode, nodes: AnyNode[]): UpstreamRefs {
  const d = node?.data ?? {}
  const sb = nodeById(nodes, (d as any).firstFrameFromNodeId)
  const prev = nodeById(nodes, (d as any).sourcePrevVideoNodeId)
  const prevData = prev?.data as any
  const prevVr = Array.isArray(prevData?.videoResults) ? prevData.videoResults : []
  const out: UpstreamRefs = {}
  const sbData = sb?.data as any
  const sbImgResults = Array.isArray(sbData?.imageResults) ? sbData.imageResults : []
  const ff = httpUrl(sbData?.imageUrl) || httpUrl(sbImgResults[0]?.url)
  if (ff) out.firstFrameUrl = ff
  const sv = httpUrl(prevData?.videoUrl) || httpUrl(prevVr[0]?.url)
  if (sv) out.sourceVideoUrl = sv
  const duration =
    positiveDuration(prevData?.videoDurationSeconds) ||
    positiveDuration(prevData?.durationSeconds) ||
    positiveDuration(prevVr.find((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      return httpUrl((item as Record<string, unknown>).url) === sv
    })?.duration)
  if (duration) out.referenceVideoDurationSeconds = duration
  const pid = typeof prevData?.taskId === 'string' ? prevData.taskId.trim() : ''
  if (pid) out.sourcePrevTaskId = pid
  return out
}
