import type { Node } from '@xyflow/react'
import { getTaskNodeCoreType, normalizeTaskNodeKind } from '../nodes/taskNodeSchema'
import { pickPrimaryImageFromNode } from '../nodes/taskNode/upstreamReferences'

type ImageCompareSelectableNode = Pick<Node, 'id' | 'data' | 'position'>

export type ImageCompareSource = {
  nodeId: string
  label: string
  url: string
}

export type ImageCompareSelectionResolution =
  | { kind: 'not-image-pair' }
  | { kind: 'missing-assets'; nodeIds: string[] }
  | { kind: 'ready'; before: ImageCompareSource; after: ImageCompareSource }

function readDataRecord(node: ImageCompareSelectableNode): Record<string, unknown> | null {
  const data = node.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

function isImageNode(node: ImageCompareSelectableNode): boolean {
  const rawKind = readDataRecord(node)?.kind
  const normalizedKind = normalizeTaskNodeKind(typeof rawKind === 'string' ? rawKind : null)
  return Boolean(normalizedKind && getTaskNodeCoreType(normalizedKind) === 'image')
}

// 与视频对比一致：按画布视觉顺序（先左后右、再上后下）决定前后，结果稳定可预期。
export function compareCanvasPosition(
  first: ImageCompareSelectableNode,
  second: ImageCompareSelectableNode,
): number {
  const horizontalDifference = first.position.x - second.position.x
  if (Math.abs(horizontalDifference) > 1) return horizontalDifference
  return first.position.y - second.position.y
}

export function resolveImageCompareSource(node: ImageCompareSelectableNode): ImageCompareSource | null {
  const url = pickPrimaryImageFromNode(node as Node)
  if (!url) return null
  const rawLabel = readDataRecord(node)?.label
  const label = typeof rawLabel === 'string' && rawLabel.trim() ? rawLabel.trim() : `图片 ${String(node.id)}`
  return { nodeId: String(node.id), label, url }
}

export function resolveImageCompareSelection(
  selectedNodes: readonly ImageCompareSelectableNode[],
): ImageCompareSelectionResolution {
  if (selectedNodes.length !== 2 || !selectedNodes.every(isImageNode)) {
    return { kind: 'not-image-pair' }
  }

  const orderedNodes = [...selectedNodes].sort(compareCanvasPosition)
  const sources = orderedNodes.map(resolveImageCompareSource)
  const [before, after] = sources
  if (!before || !after) {
    return {
      kind: 'missing-assets',
      nodeIds: orderedNodes.filter((_node, index) => sources[index] === null).map((node) => String(node.id)),
    }
  }
  return { kind: 'ready', before, after }
}

/**
 * 对比节点的输入：入边上游中所有带图片的节点，按画布视觉顺序排列（与框选对比同一规则）。
 * 没有图片的上游（还在生成）直接跳过，等它出图后自动出现。
 */
export function resolveImageCompareInputs(
  upstreamNodes: readonly ImageCompareSelectableNode[],
): ImageCompareSource[] {
  return [...upstreamNodes]
    .sort(compareCanvasPosition)
    .map(resolveImageCompareSource)
    .filter((source): source is ImageCompareSource => source !== null)
}
