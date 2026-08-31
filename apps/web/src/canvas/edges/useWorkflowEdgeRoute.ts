import { useStore } from '@xyflow/react'
import { getNodeAbsPosition, getNodeSize } from '../utils/nodeBounds'
import {
  computeWorkflowEdgeRoute,
  type WorkflowEdgeRoute,
  type WorkflowRouteEdge,
  type WorkflowRouteNode,
} from '../workflowEdgeRouting'

type WorkflowRoutingGraph = Readonly<{
  nodes: readonly WorkflowRouteNode[]
  edges: readonly WorkflowRouteEdge[]
}>

type UseWorkflowEdgeRouteInput = Readonly<{
  enabled: boolean
  edgeId: string
  sourceId: string
  targetId: string
  sourceX: number
  sourceY: number
  sourcePosition: Parameters<typeof computeWorkflowEdgeRoute>[0]['sourcePosition']
  targetX: number
  targetY: number
  targetPosition: Parameters<typeof computeWorkflowEdgeRoute>[0]['targetPosition']
  routeOffset: number
}>

const EMPTY_ROUTING_GRAPH: WorkflowRoutingGraph = Object.freeze({ nodes: [], edges: [] })

function nodeParentId(node: Readonly<{ parentId?: string }>): string | null {
  const parentId = typeof node.parentId === 'string' ? node.parentId.trim() : ''
  return parentId || null
}

function sameRoutingGraph(left: WorkflowRoutingGraph, right: WorkflowRoutingGraph): boolean {
  if (left === right) return true
  if (left.nodes.length !== right.nodes.length || left.edges.length !== right.edges.length) return false
  for (let index = 0; index < left.nodes.length; index += 1) {
    const leftNode = left.nodes[index]
    const rightNode = right.nodes[index]
    if (
      leftNode.id !== rightNode.id
      || leftNode.x !== rightNode.x
      || leftNode.y !== rightNode.y
      || leftNode.width !== rightNode.width
      || leftNode.height !== rightNode.height
    ) return false
  }
  for (let index = 0; index < left.edges.length; index += 1) {
    const leftEdge = left.edges[index]
    const rightEdge = right.edges[index]
    if (
      leftEdge.id !== rightEdge.id
      || leftEdge.source !== rightEdge.source
      || leftEdge.target !== rightEdge.target
    ) return false
  }
  return true
}

export function useWorkflowEdgeRoute(input: UseWorkflowEdgeRouteInput): WorkflowEdgeRoute | null {
  // Edge renderers can run in more than one React Flow instance at the same time
  // (the editable project canvas and a read-only execution snapshot modal).  The
  // routing graph must therefore come from the nearest ReactFlowProvider, not
  // the application's singleton editable-canvas store.  Reading the singleton
  // made snapshot skip-edges look adjacent and collapsed every detour onto the
  // horizontal main line.
  const graph = useStore((state): WorkflowRoutingGraph => {
    if (!input.enabled) return EMPTY_ROUTING_GRAPH
    const nodesById = new Map(state.nodes.map((node) => [node.id, node] as const))
    const sourceGroupId = nodeParentId(nodesById.get(input.sourceId) ?? {})
    const nodes = state.nodes
      .filter((node) => {
        if (nodeParentId(node) !== sourceGroupId) return false
        const data = node.data && typeof node.data === 'object'
          ? node.data as Record<string, unknown>
          : {}
        return data.kind === 'workflowStage' || data.kind === 'workflowTrigger'
      })
      .map((node): WorkflowRouteNode => {
        const position = getNodeAbsPosition(node, nodesById)
        const size = getNodeSize(node, { w: 56, h: 56 })
        return {
          id: node.id,
          x: position.x,
          y: position.y,
          width: size.w,
          height: size.h,
        }
      })
      .sort((left, right) => left.id.localeCompare(right.id))
    const workflowNodeIds = new Set(nodes.map((node) => node.id))
    const edges = state.edges
      .filter((edge) => (
        workflowNodeIds.has(edge.source)
        && workflowNodeIds.has(edge.target)
        && edge.sourceHandle?.startsWith('out-workflow:') === true
        && edge.targetHandle?.startsWith('in-workflow:') === true
      ))
      .map((edge): WorkflowRouteEdge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
    return { nodes, edges }
  }, sameRoutingGraph)

  if (!input.enabled) return null
  return computeWorkflowEdgeRoute({
    edgeId: input.edgeId,
    sourceId: input.sourceId,
    targetId: input.targetId,
    sourceX: input.sourceX,
    sourceY: input.sourceY,
    sourcePosition: input.sourcePosition,
    targetX: input.targetX,
    targetY: input.targetY,
    targetPosition: input.targetPosition,
    nodes: graph.nodes,
    edges: graph.edges,
    routeOffset: input.routeOffset,
  })
}
