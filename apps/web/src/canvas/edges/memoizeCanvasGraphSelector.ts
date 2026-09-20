import type { ReactFlowState } from '@xyflow/react'

type CanvasGraph = Pick<ReactFlowState, 'nodes' | 'edges'>

/** Viewport changes notify every store selector. Graph projections must only
 * rebuild when graph inputs change, not once per edge per animation frame. */
export function memoizeCanvasGraphSelector<Result>(project: (graph: CanvasGraph) => Result) {
  let cached: { nodes: CanvasGraph['nodes']; edges: CanvasGraph['edges']; result: Result } | undefined
  return (graph: CanvasGraph): Result => {
    if (cached && cached.nodes === graph.nodes && cached.edges === graph.edges) return cached.result
    const result = project(graph)
    cached = { nodes: graph.nodes, edges: graph.edges, result }
    return result
  }
}
