import type { Node, Edge } from '@xyflow/react'
import { getTaskNodeSchema, normalizeTaskNodeKind } from '../canvas/nodes/taskNodeSchema'
import type { ComposeVideoSource } from '../canvas/nodes/taskNode/components/useVideoCompose'
import type { ComposeAudioTrack } from '../canvas/nodes/taskNode/components/composeVideosCore'
import { isReferenceOnlyCanvasEdge } from '@tapcanvas/canvas-edge-semantics'

/**
 * 纯函数：从 DAG 图中收集指定节点的上游视频源列表。
 *
 * 规则与 TaskNode.tsx upstreamVideos selector 完全一致：
 * - 只收 incoming edge 对端 schema.category === 'video' 的节点
 * - 优先读 videoResults[videoPrimaryIndex ?? 0].url，次之 videoUrl
 * - 若既无 videoResults 也无 videoUrl，则跳过该节点
 */
export function collectUpstreamComposeSources(
  nodeId: string,
  nodes: Node[],
  edges: Edge[],
): ComposeVideoSource[] {
  const incoming = edges.filter((e) => e.target === nodeId && !isReferenceOnlyCanvasEdge(e))
  const results: ComposeVideoSource[] = []

  for (const edge of incoming) {
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) continue

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const srcData: any = srcNode.data || {}
    const srcSchema = getTaskNodeSchema(srcData?.kind)
    if (srcSchema.category !== 'video') continue

    const vr = Array.isArray(srcData.videoResults) ? srcData.videoResults : []
    const idx = typeof srcData.videoPrimaryIndex === 'number' ? srcData.videoPrimaryIndex : 0
    const primary = vr[idx] || vr[0]
    const url: string | undefined = primary?.url || srcData.videoUrl

    if (url) {
      results.push({
        url,
        title: primary?.title || (srcData.label as string | undefined) || undefined,
        thumbnailUrl: (primary?.thumbnailUrl as string | undefined) || undefined,
        dialoguePrompt: typeof srcData.prompt === 'string' && srcData.prompt.trim() ? srcData.prompt : undefined,
      })
    }
  }

  // 【cut 模式无连线兜底】成片节点与 N 段 clip 仅靠 clipRunId 关联、无 edge 时，按 clipRunId 收齐同 run 的
  // video 节点、按 clipIndex 排序（与 TaskNode.tsx upstreamVideos selector 一致）。
  if (results.length < 2) {
    const selfNode = nodes.find((n) => n.id === nodeId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runId = (selfNode?.data as any)?.clipRunId
    if (runId) {
      const byRun: ComposeVideoSource[] = []
      nodes
        .filter((n) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d: any = n.data || {}
          return (
            n.id !== nodeId &&
            d.clipRunId === runId &&
            typeof d.clipIndex === 'number' &&
            getTaskNodeSchema(d?.kind).category === 'video'
          )
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .sort((a, b) => ((a.data as any)?.clipIndex ?? 0) - ((b.data as any)?.clipIndex ?? 0))
        .forEach((n) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d: any = n.data || {}
          const vr = Array.isArray(d.videoResults) ? d.videoResults : []
          const idx = typeof d.videoPrimaryIndex === 'number' ? d.videoPrimaryIndex : 0
          const primary = vr[idx] || vr[0]
          const url: string | undefined = primary?.url || d.videoUrl
          if (url) {
            byRun.push({
              url,
              title: primary?.title || (d.label as string | undefined) || undefined,
              thumbnailUrl: (primary?.thumbnailUrl as string | undefined) || undefined,
              dialoguePrompt: typeof d.prompt === 'string' && d.prompt.trim() ? d.prompt : undefined,
            })
          }
        })
      if (byRun.length > results.length) return byRun
    }
  }

  return results
}

/**
 * 收集视频合成节点上游直连的音频节点（配音/BGM 轨）。
 * 只收 kind 归一化为 audio 且已有 audioUrl 的节点；音量/循环读节点 data。
 */
export function collectUpstreamComposeAudioTracks(
  nodeId: string,
  nodes: Node[],
  edges: Edge[],
): ComposeAudioTrack[] {
  const incoming = edges.filter((e) => e.target === nodeId && !isReferenceOnlyCanvasEdge(e))
  const results: ComposeAudioTrack[] = []
  for (const edge of incoming) {
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode || srcNode.type !== 'taskNode') continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const srcData: any = srcNode.data || {}
    if (normalizeTaskNodeKind(String(srcData?.kind || '')) !== 'audio') continue
    const url = typeof srcData.audioUrl === 'string' ? srcData.audioUrl.trim() : ''
    if (!url) continue
    results.push({
      url,
      title: (srcData.label as string | undefined) || undefined,
      volume: typeof srcData.audioVolume === 'number' ? srcData.audioVolume : 1,
      // 音乐默认循环铺底（BGM 语义），语音配音不循环
      loop: srcData.audioLoop === true || srcData.audioType === 'music',
    })
  }
  return results
}
