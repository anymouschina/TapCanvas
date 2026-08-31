type CanvasNodeLike = { id?: unknown }
type CanvasEdgeLike = { id?: unknown; source?: unknown; target?: unknown }

export type CanvasGraphPatch<N, E> = {
  upsertNodes?: N[]
  removeNodeIds?: string[]
  upsertEdges?: E[]
  removeEdgeIds?: string[]
}

function readId(value: unknown): string {
  return String(value ?? '').trim()
}

export function removeDanglingCanvasEdges<
  N extends CanvasNodeLike,
  E extends CanvasEdgeLike,
>(nodes: readonly N[], edges: readonly E[]): E[] {
  const nodeIds = new Set(nodes.map((node) => readId(node.id)).filter(Boolean))
  return edges.filter((edge) => {
    const source = readId(edge.source)
    const target = readId(edge.target)
    return Boolean(source && target && nodeIds.has(source) && nodeIds.has(target))
  })
}

export function applyCanvasGraphPatch<
  N extends CanvasNodeLike,
  E extends CanvasEdgeLike,
>(input: {
  nodes: readonly N[]
  edges: readonly E[]
  patch: CanvasGraphPatch<N, E>
}): { nodes: N[]; edges: E[] } {
  const nodeById = new Map(input.nodes.map((node) => [readId(node.id), node]))
  for (const node of input.patch.upsertNodes ?? []) nodeById.set(readId(node.id), node)
  for (const id of input.patch.removeNodeIds ?? []) nodeById.delete(readId(id))

  const edgeById = new Map(input.edges.map((edge) => [readId(edge.id), edge]))
  for (const edge of input.patch.upsertEdges ?? []) edgeById.set(readId(edge.id), edge)
  for (const id of input.patch.removeEdgeIds ?? []) edgeById.delete(readId(id))

  const nodes = [...nodeById.values()]
  return {
    nodes,
    edges: removeDanglingCanvasEdges(nodes, [...edgeById.values()]),
  }
}
