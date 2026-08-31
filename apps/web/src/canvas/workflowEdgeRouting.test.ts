import { Position } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import {
  VIDEO_ATOMIC_WORKFLOW_EDGES,
  VIDEO_ATOMIC_WORKFLOW_NODES,
} from './videoWorkflowCanvasTemplate'
import { computeWorkflowEdgeRoute, type WorkflowRouteNode } from './workflowEdgeRouting'
import { computeWorkflowFlowLayout } from './workflowFlowLayout'
import {
  WORKFLOW_EDGE_ROUTE_OFFSET,
  WORKFLOW_ICON_NODE_FLOW_GAP_X,
  WORKFLOW_ICON_NODE_FLOW_GAP_Y,
  WORKFLOW_ICON_NODE_SIZE,
} from './workflowNodeGeometry'

const workflowNodeIds = [
  'manual-trigger',
  ...VIDEO_ATOMIC_WORKFLOW_NODES.map((node) => node.nodeId),
]
const workflowEdges = VIDEO_ATOMIC_WORKFLOW_EDGES.map((edge, index) => ({
  id: `edge-${index}`,
  source: edge.sourceNodeId,
  target: edge.targetNodeId,
}))
const layoutNodes = workflowNodeIds.map((id) => ({
  id,
  position: { x: 0, y: 0 },
  size: { width: WORKFLOW_ICON_NODE_SIZE, height: WORKFLOW_ICON_NODE_SIZE },
}))
const positions = computeWorkflowFlowLayout(
  layoutNodes,
  workflowEdges,
  WORKFLOW_ICON_NODE_FLOW_GAP_X,
  WORKFLOW_ICON_NODE_FLOW_GAP_Y,
)
const routeNodes: WorkflowRouteNode[] = workflowNodeIds.map((id) => ({
  id,
  x: positions.get(id)!.x,
  y: positions.get(id)!.y,
  width: WORKFLOW_ICON_NODE_SIZE,
  height: WORKFLOW_ICON_NODE_SIZE,
}))

function routeFor(source: string, target: string) {
  const edge = workflowEdges.find((candidate) => (
    candidate.source === source && candidate.target === target
  ))
  if (!edge) throw new Error(`测试边不存在: ${source} -> ${target}`)
  const sourceNode = routeNodes.find((node) => node.id === source)
  const targetNode = routeNodes.find((node) => node.id === target)
  if (!sourceNode || !targetNode) throw new Error('测试节点不存在')
  return computeWorkflowEdgeRoute({
    edgeId: edge.id,
    sourceId: source,
    targetId: target,
    sourceX: sourceNode.x + sourceNode.width + WORKFLOW_EDGE_ROUTE_OFFSET,
    sourceY: sourceNode.y + sourceNode.height / 2,
    sourcePosition: Position.Right,
    targetX: targetNode.x - WORKFLOW_EDGE_ROUTE_OFFSET,
    targetY: targetNode.y + targetNode.height / 2,
    targetPosition: Position.Left,
    nodes: routeNodes,
    edges: workflowEdges,
    routeOffset: WORKFLOW_EDGE_ROUTE_OFFSET,
  })
}

describe('workflow edge routing', () => {
  it('keeps an adjacent dependency on the direct main-flow corridor', () => {
    const route = routeFor('manual-trigger', 'canvas-source')

    expect(route.detourSide).toBeNull()
    expect(route.points).toHaveLength(2)
  })

  it('moves skip-layer dependencies onto unique outer rails on both sides', () => {
    const skipRoutes = [
      routeFor('beat-sheet-format', 'asset-fan-out'),
      routeFor('delivery-contract', 'clip-fan-out'),
      routeFor('prompt-package', 'production-handoff'),
      routeFor('cost-estimate', 'concat'),
    ]
    const railYs = skipRoutes.map((route) => route.labelY)

    const sides = skipRoutes.map((route) => route.detourSide)
    expect(sides.every((side) => side === 'top' || side === 'bottom')).toBe(true)
    expect(new Set(sides)).toEqual(new Set(['top', 'bottom']))
    expect(new Set(railYs).size).toBe(skipRoutes.length)
    const topBound = Math.min(...routeNodes.map((node) => node.y))
    const bottomBound = Math.max(...routeNodes.map((node) => node.y + node.height))
    for (const route of skipRoutes) {
      if (route.detourSide === 'top') expect(route.labelY).toBeLessThan(topBound)
      if (route.detourSide === 'bottom') expect(route.labelY).toBeGreaterThan(bottomBound)
    }
  })

  it('keeps every outer rail outside all node rectangles', () => {
    for (const route of workflowEdges.map((edge) => routeFor(edge.source, edge.target))) {
      if (route.detourSide === null) continue
      for (const node of routeNodes) {
        expect(route.labelY > node.y && route.labelY < node.y + node.height).toBe(false)
      }
    }
  })
})
