import type { Node } from '@xyflow/react'
import { computeContextAwarePosition, resolveNonOverlappingPosition, useRFStore } from '../../canvas/store'
import { getNodeAbsPosition, getNodeSize, type NodeSize, type XY } from '../../canvas/utils/nodeBounds'

type CanvasInsertionScope = {
  anchor: XY
  anchorNodeId: string | null
}

function getAnchorNode(nodes: Node[]): Node | null {
  return nodes.find((node) => node.selected) ?? null
}

export function resolveChatCanvasInsertionScope(preferredSize: NodeSize): CanvasInsertionScope {
  const nodes = useRFStore.getState().nodes
  const anchorNode = getAnchorNode(nodes)
  if (!anchorNode) {
    return {
      anchor: computeContextAwarePosition(nodes, preferredSize),
      anchorNodeId: null,
    }
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node] as const))
  const anchorPosition = getNodeAbsPosition(anchorNode, nodesById)
  const anchorSize = getNodeSize(anchorNode)
  const preferredAnchor = {
    x: anchorPosition.x + anchorSize.w + 96,
    y: anchorPosition.y,
  }

  return {
    anchor: resolveNonOverlappingPosition(nodes, preferredAnchor, preferredSize, null),
    anchorNodeId: String(anchorNode.id || '').trim() || null,
  }
}
