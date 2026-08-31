import type { Edge, Node } from '@xyflow/react'
import {
  isAdminWorkflowGraphNode,
  projectWorkflowGraphForViewer,
} from '@tapcanvas/workflow-kernel-protocol'

export function isAdminWorkflowCanvasNode(node: Node): boolean {
  return isAdminWorkflowGraphNode(node)
}

export function filterAdminWorkflowCanvasGraph(
  nodes: readonly Node[],
  edges: readonly Edge[],
  isAdmin: boolean,
): { nodes: readonly Node[]; edges: readonly Edge[] } {
  const projected = projectWorkflowGraphForViewer({ nodes, edges }, isAdmin)
  if (!projected || typeof projected !== 'object' || Array.isArray(projected)) {
    throw new Error('工作流可见性投影未返回有效图结构')
  }
  const graph = projected as Record<string, unknown>
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('工作流可见性投影缺少节点或边')
  }
  return { nodes: graph.nodes as Node[], edges: graph.edges as Edge[] }
}
