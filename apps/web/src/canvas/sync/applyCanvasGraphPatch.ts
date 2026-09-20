type CanvasNodeLike = { id?: unknown }
type CanvasEdgeLike = { id?: unknown; source?: unknown; target?: unknown }

export type CanvasGraphPatch<N, E> = {
  upsertNodes?: readonly N[]
  removeNodeIds?: string[]
  upsertEdges?: readonly E[]
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
  nodes: N[]
  edges: E[]
  patch: CanvasGraphPatch<N, E>
}): { nodes: N[]; edges: E[] } {
  const nodeById = new Map(input.nodes.map((node) => [readId(node.id), node]))
  for (const node of input.patch.upsertNodes ?? []) {
    const id = readId(node.id)
    const old = nodeById.get(id)
    if (old !== node && (!old || JSON.stringify(old) !== JSON.stringify(node))) nodeById.set(id, node)
  }
  for (const id of input.patch.removeNodeIds ?? []) nodeById.delete(readId(id))

  const edgeById = new Map(input.edges.map((edge) => [readId(edge.id), edge]))
  for (const edge of input.patch.upsertEdges ?? []) {
    const id = readId(edge.id)
    const old = edgeById.get(id)
    if (old !== edge && (!old || JSON.stringify(old) !== JSON.stringify(edge))) edgeById.set(id, edge)
  }
  for (const id of input.patch.removeEdgeIds ?? []) edgeById.delete(readId(id))

  const nodes = [...nodeById.values()]
  const edges = removeDanglingCanvasEdges(nodes, [...edgeById.values()])
  return {
    nodes: nodes.length === input.nodes.length && nodes.every((node, index) => node === input.nodes[index]) ? input.nodes : nodes,
    edges: edges.length === input.edges.length && edges.every((edge, index) => edge === input.edges[index]) ? input.edges : edges,
  }
}
