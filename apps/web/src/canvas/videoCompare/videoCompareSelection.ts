import type { Node } from '@xyflow/react'
import { getTaskNodeCoreType, normalizeTaskNodeKind } from '../nodes/taskNodeSchema'
import { resolveVideoCompareSource, type VideoCompareSource } from './videoCompareSource'

type VideoCompareSelectableNode = Pick<Node, 'id' | 'data' | 'position'>

export type VideoCompareSelectionResolution =
  | { kind: 'not-video-pair' }
  | { kind: 'missing-assets'; nodeIds: string[] }
  | { kind: 'ready'; source: VideoCompareSource; target: VideoCompareSource }

function readNodeKind(node: VideoCompareSelectableNode): string | null {
  const data = node.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const rawKind = (data as Record<string, unknown>).kind
  return typeof rawKind === 'string' ? rawKind : null
}

function isVideoNode(node: VideoCompareSelectableNode): boolean {
  const normalizedKind = normalizeTaskNodeKind(readNodeKind(node))
  return Boolean(normalizedKind && getTaskNodeCoreType(normalizedKind) === 'video')
}

function compareCanvasPosition(
  first: VideoCompareSelectableNode,
  second: VideoCompareSelectableNode,
): number {
  const horizontalDifference = first.position.x - second.position.x
  if (Math.abs(horizontalDifference) > 1) return horizontalDifference
  return first.position.y - second.position.y
}

export function resolveVideoCompareSelection(
  selectedNodes: readonly VideoCompareSelectableNode[],
): VideoCompareSelectionResolution {
  if (selectedNodes.length !== 2 || !selectedNodes.every(isVideoNode)) {
    return { kind: 'not-video-pair' }
  }

  const orderedNodes = [...selectedNodes].sort(compareCanvasPosition)
  const sources = orderedNodes.map(resolveVideoCompareSource)
  const missingNodeIds = orderedNodes
    .filter((_node, index) => sources[index] === null)
    .map((node) => String(node.id))
  if (missingNodeIds.length > 0) {
    return { kind: 'missing-assets', nodeIds: missingNodeIds }
  }

  const source = sources[0]
  const target = sources[1]
  if (!source || !target) return { kind: 'missing-assets', nodeIds: orderedNodes.map((node) => String(node.id)) }
  return { kind: 'ready', source, target }
}
