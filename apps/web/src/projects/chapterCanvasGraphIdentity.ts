import type { CanvasFlow } from './chapterCanvasFlow.types'

type CanvasGraphIdentityInput = Pick<CanvasFlow, 'nodes' | 'edges'>

/**
 * A chapter revision is only a write-order fence. It is not a content identity:
 * server-side preservation may canonicalize a stale full-graph save before it is
 * persisted. Compare the graph payload as well before reusing a local snapshot.
 */
export function createChapterCanvasGraphIdentity(
  graph: CanvasGraphIdentityInput,
): string {
  return JSON.stringify({ nodes: graph.nodes, edges: graph.edges })
}

export function canReuseChapterCanvasSnapshot(input: {
  snapshotRevision: number
  serverRevision: number
  snapshotGraphIdentity: string
  serverGraphIdentity: string
}): boolean {
  return input.snapshotRevision === input.serverRevision
    && input.snapshotGraphIdentity === input.serverGraphIdentity
}
