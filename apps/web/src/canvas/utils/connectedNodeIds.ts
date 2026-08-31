import type { Edge } from '@xyflow/react'

type EdgeEndpoints = Pick<Edge, 'source' | 'target'>

export function getConnectedNodeIds(edges: readonly EdgeEndpoints[]): string[] {
  const connectedNodeIds = new Set<string>()

  for (const edge of edges) {
    connectedNodeIds.add(edge.source)
    connectedNodeIds.add(edge.target)
  }

  return [...connectedNodeIds]
}
