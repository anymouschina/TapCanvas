import type { Position } from '@xyflow/react'

export type WorkflowRouteNode = Readonly<{
  id: string
  x: number
  y: number
  width: number
  height: number
}>

export type WorkflowRouteEdge = Readonly<{
  id: string
  source: string
  target: string
}>

export type WorkflowEdgeRoute = Readonly<{
  path: string
  labelX: number
  labelY: number
  points: readonly Readonly<{ x: number; y: number }>[]
  detourSide: 'top' | 'bottom' | null
}>

export type WorkflowEdgeRouteInput = Readonly<{
  edgeId: string
  sourceId: string
  targetId: string
  sourceX: number
  sourceY: number
  sourcePosition: Position
  targetX: number
  targetY: number
  targetPosition: Position
  nodes: readonly WorkflowRouteNode[]
  edges: readonly WorkflowRouteEdge[]
  routeOffset: number
}>

const ROUTE_LANE_GAP = 20
const ROUTE_OUTER_MARGIN = 18
const ROUTE_CORNER_RADIUS = 8

function centerX(node: WorkflowRouteNode): number {
  return node.x + node.width / 2
}

function isNodeBetween(
  node: WorkflowRouteNode,
  source: WorkflowRouteNode,
  target: WorkflowRouteNode,
): boolean {
  if (node.id === source.id || node.id === target.id) return false
  const left = Math.min(centerX(source), centerX(target))
  const right = Math.max(centerX(source), centerX(target))
  const nodeCenter = centerX(node)
  return nodeCenter > left + 1 && nodeCenter < right - 1
}

function isLongEdge(
  edge: WorkflowRouteEdge,
  nodeById: ReadonlyMap<string, WorkflowRouteNode>,
  nodes: readonly WorkflowRouteNode[],
): boolean {
  const source = nodeById.get(edge.source)
  const target = nodeById.get(edge.target)
  if (!source || !target) return false
  return nodes.some((node) => isNodeBetween(node, source, target))
}

function compactPoints(
  points: readonly Readonly<{ x: number; y: number }>[],
): ReadonlyArray<Readonly<{ x: number; y: number }>> {
  const deduplicated: Array<Readonly<{ x: number; y: number }>> = []
  for (const point of points) {
    const previous = deduplicated[deduplicated.length - 1]
    if (previous && previous.x === point.x && previous.y === point.y) continue
    deduplicated.push(point)
  }

  const compacted: Array<Readonly<{ x: number; y: number }>> = []
  for (const point of deduplicated) {
    const beforePrevious = compacted[compacted.length - 2]
    const previous = compacted[compacted.length - 1]
    if (beforePrevious && previous) {
      const sameHorizontal = beforePrevious.y === previous.y && previous.y === point.y
      const sameVertical = beforePrevious.x === previous.x && previous.x === point.x
      if (sameHorizontal || sameVertical) {
        compacted[compacted.length - 1] = point
        continue
      }
    }
    compacted.push(point)
  }
  return compacted
}

function roundedOrthogonalPath(
  rawPoints: readonly Readonly<{ x: number; y: number }>[],
): string {
  const points = compactPoints(rawPoints)
  const first = points[0]
  if (!first) return ''
  if (points.length === 1) return `M ${first.x},${first.y}`

  const commands = [`M ${first.x},${first.y}`]
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const next = points[index + 1]
    const incomingLength = Math.hypot(current.x - previous.x, current.y - previous.y)
    const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y)
    const radius = Math.min(ROUTE_CORNER_RADIUS, incomingLength / 2, outgoingLength / 2)
    const beforeCorner = {
      x: current.x - Math.sign(current.x - previous.x) * radius,
      y: current.y - Math.sign(current.y - previous.y) * radius,
    }
    const afterCorner = {
      x: current.x + Math.sign(next.x - current.x) * radius,
      y: current.y + Math.sign(next.y - current.y) * radius,
    }
    commands.push(`L ${beforeCorner.x},${beforeCorner.y}`)
    commands.push(`Q ${current.x},${current.y} ${afterCorner.x},${afterCorner.y}`)
  }

  const last = points[points.length - 1]
  commands.push(`L ${last.x},${last.y}`)
  return commands.join(' ')
}

function routeBounds(nodes: readonly WorkflowRouteNode[]): Readonly<{
  top: number
  bottom: number
}> {
  return {
    top: Math.min(...nodes.map((node) => node.y)),
    bottom: Math.max(...nodes.map((node) => node.y + node.height)),
  }
}

function directRoute(input: WorkflowEdgeRouteInput): WorkflowEdgeRoute {
  // Adjacent dependencies stay on the main-flow corridor. A straight segment is
  // intentional here: the layered layout may place the two endpoints on
  // neighboring rows, and inserting an elbow would make a local edge look like
  // a skip-layer detour. Long dependencies are routed through outer rails below.
  const points = [
    { x: input.sourceX, y: input.sourceY },
    { x: input.targetX, y: input.targetY },
  ]
  return {
    path: roundedOrthogonalPath(points),
    labelX: (input.sourceX + input.targetX) / 2,
    labelY: (input.sourceY + input.targetY) / 2,
    points,
    detourSide: null,
  }
}

/**
 * Route adjacent layers directly and move every skip-layer dependency onto its own outer rail.
 * Alternating rails keep interleaving dependencies on opposite sides of the main flow. A unique
 * lane per edge prevents the long horizontal overlaps produced by React Flow's default midpoint.
 */
export function computeWorkflowEdgeRoute(input: WorkflowEdgeRouteInput): WorkflowEdgeRoute {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node] as const))
  const current = input.edges.find((edge) => edge.id === input.edgeId)
    ?? { id: input.edgeId, source: input.sourceId, target: input.targetId }
  if (!isLongEdge(current, nodeById, input.nodes)) return directRoute(input)

  const longEdges = input.edges
    .filter((edge) => isLongEdge(edge, nodeById, input.nodes))
    .sort((left, right) => {
      const leftSource = nodeById.get(left.source)
      const rightSource = nodeById.get(right.source)
      const leftTarget = nodeById.get(left.target)
      const rightTarget = nodeById.get(right.target)
      return (leftSource ? centerX(leftSource) : 0) - (rightSource ? centerX(rightSource) : 0)
        || (leftTarget ? centerX(leftTarget) : 0) - (rightTarget ? centerX(rightTarget) : 0)
        || left.id.localeCompare(right.id)
    })
  const routeIndex = Math.max(0, longEdges.findIndex((edge) => edge.id === input.edgeId))
  const detourSide = routeIndex % 2 === 0 ? 'top' : 'bottom'
  const sideLane = Math.floor(routeIndex / 2) + 1
  const bounds = routeBounds(input.nodes)
  const laneY = detourSide === 'top'
    ? bounds.top - ROUTE_OUTER_MARGIN - sideLane * ROUTE_LANE_GAP
    : bounds.bottom + ROUTE_OUTER_MARGIN + sideLane * ROUTE_LANE_GAP
  const direction = input.sourceX <= input.targetX ? 1 : -1
  const sourceLeadX = input.sourceX + direction * input.routeOffset
  const targetLeadX = input.targetX - direction * input.routeOffset
  const points = compactPoints([
    { x: input.sourceX, y: input.sourceY },
    { x: sourceLeadX, y: input.sourceY },
    { x: sourceLeadX, y: laneY },
    { x: targetLeadX, y: laneY },
    { x: targetLeadX, y: input.targetY },
    { x: input.targetX, y: input.targetY },
  ])

  return {
    path: roundedOrthogonalPath(points),
    labelX: (sourceLeadX + targetLeadX) / 2,
    labelY: laneY,
    points,
    detourSide,
  }
}
