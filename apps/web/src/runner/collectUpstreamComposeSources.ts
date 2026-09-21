import type { Node, Edge } from '@xyflow/react'
import { getTaskNodeSchema, normalizeTaskNodeKind } from '../canvas/nodes/taskNodeSchema'
import type { ComposeVideoSource } from '../canvas/nodes/taskNode/components/useVideoCompose'
import type { ComposeAudioTrack } from '../canvas/nodes/taskNode/components/composeVideosCore'
import { isReferenceOnlyCanvasEdge } from '@tapcanvas/canvas-edge-semantics'

import { orderComposeSourceNodes } from './composeSourceOrder'

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function sourceFromNode(node: Node): ComposeVideoSource | null {
  const data = node.data
  if (getTaskNodeSchema(String(data.kind || '')).category !== 'video') return null
  const results: unknown[] = Array.isArray(data.videoResults) ? data.videoResults : []
  const index = typeof data.videoPrimaryIndex === 'number' ? data.videoPrimaryIndex : 0
  const value = results[index] || results[0]
  const primary = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const url = text(primary.url) || text(data.videoUrl)
  if (!url) return null
  return {
    url, title: text(primary.title) || text(data.label),
    thumbnailUrl: text(primary.thumbnailUrl),
    durationSec: typeof primary.duration === 'number' ? primary.duration
      : typeof data.videoDuration === 'number' ? data.videoDuration
      : typeof data.durationSeconds === 'number' ? data.durationSeconds : undefined,
    dialoguePrompt: text(data.prompt),
  }
}

/** Shared by the canvas preview, editor and execution. Explicit connections own membership. */
export function collectUpstreamComposeSources(nodeId: string, nodes: Node[], edges: Edge[]): ComposeVideoSource[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const incoming = edges.filter(edge => edge.target === nodeId && !isReferenceOnlyCanvasEdge(edge))
  const seen = new Set<string>()
  let sources = incoming.flatMap(edge => {
    const node = byId.get(edge.source)
    if (!node || seen.has(node.id)) return []
    seen.add(node.id)
    return [node]
  })
  const runId = byId.get(nodeId)?.data.clipRunId
  // Run membership is used only when the composition has no explicit input edges.
  if (incoming.length === 0 && typeof runId === 'string' && runId) {
    sources = nodes.filter(node => node.id !== nodeId && node.data.clipRunId === runId)
  }
  return orderComposeSourceNodes(sources).flatMap(node => {
    const source = sourceFromNode(node)
    return source ? [source] : []
  })
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
    const srcData = srcNode.data
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
