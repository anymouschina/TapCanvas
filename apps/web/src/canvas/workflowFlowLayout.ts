export type WorkflowFlowLayoutNode = Readonly<{
  id: string
  position: Readonly<{ x: number; y: number }>
  size: Readonly<{ width: number; height: number }>
}>

export type WorkflowFlowLayoutEdge = Readonly<{
  source: string
  target: string
}>

export type WorkflowFlowLayoutPoint = Readonly<{ x: number; y: number }>

type WorkflowGraph = Readonly<{
  incoming: ReadonlyMap<string, readonly string[]>
  outgoing: ReadonlyMap<string, readonly string[]>
  degree: ReadonlyMap<string, number>
}>

const ISOLATED_GRID_ROW_LIMIT = 3
const ORDERING_SWEEP_COUNT = 6

function compareNodeId(left: WorkflowFlowLayoutNode, right: WorkflowFlowLayoutNode): number {
  return left.id.localeCompare(right.id)
}

function buildWorkflowGraph(
  nodes: readonly WorkflowFlowLayoutNode[],
  edges: readonly WorkflowFlowLayoutEdge[],
): WorkflowGraph {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const incoming = new Map(nodes.map((node) => [node.id, [] as string[]] as const))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]] as const))

  for (const edge of edges) {
    if (edge.source === edge.target) continue
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
    const targets = outgoing.get(edge.source)
    const sources = incoming.get(edge.target)
    if (!targets || !sources || targets.includes(edge.target)) continue
    targets.push(edge.target)
    sources.push(edge.source)
  }

  incoming.forEach((sources) => sources.sort((left, right) => left.localeCompare(right)))
  outgoing.forEach((targets) => targets.sort((left, right) => left.localeCompare(right)))

  return {
    incoming,
    outgoing,
    degree: new Map(nodes.map((node) => [
      node.id,
      (incoming.get(node.id)?.length ?? 0) + (outgoing.get(node.id)?.length ?? 0),
    ] as const)),
  }
}

function assignConnectedDepths(
  nodes: readonly WorkflowFlowLayoutNode[],
  graph: WorkflowGraph,
): Readonly<{
  depthById: Map<string, number>
  processed: ReadonlySet<string>
}> {
  const connectedNodes = nodes.filter((node) => (graph.degree.get(node.id) ?? 0) > 0)
  const remainingIncoming = new Map(connectedNodes.map((node) => [
    node.id,
    graph.incoming.get(node.id)?.length ?? 0,
  ] as const))
  const depthById = new Map<string, number>()
  const queue = connectedNodes
    .filter((node) => (remainingIncoming.get(node.id) ?? 0) === 0)
    .sort(compareNodeId)
    .map((node) => node.id)
  const processed = new Set<string>()

  while (queue.length > 0) {
    const nodeId = queue.shift()
    if (!nodeId || processed.has(nodeId)) continue
    processed.add(nodeId)
    const nextDepth = (depthById.get(nodeId) ?? 0) + 1

    for (const targetId of graph.outgoing.get(nodeId) ?? []) {
      depthById.set(targetId, Math.max(depthById.get(targetId) ?? 0, nextDepth))
      const nextIncoming = (remainingIncoming.get(targetId) ?? 0) - 1
      remainingIncoming.set(targetId, nextIncoming)
      if (nextIncoming !== 0) continue
      queue.push(targetId)
      queue.sort((left, right) => left.localeCompare(right))
    }
  }

  return { depthById, processed }
}

function placeUnresolvedAndIsolatedNodes(
  nodes: readonly WorkflowFlowLayoutNode[],
  graph: WorkflowGraph,
  depthById: Map<string, number>,
  processed: ReadonlySet<string>,
): void {
  let nextDepth = Math.max(-1, ...Array.from(depthById.values())) + 1
  const unresolved = nodes
    .filter((node) => (graph.degree.get(node.id) ?? 0) > 0 && !processed.has(node.id))
    .sort(compareNodeId)

  // Cyclic or otherwise malformed connected nodes are kept visible in successive columns. A bad
  // edge must not collapse the rest of the workflow into one vertical stack.
  for (const node of unresolved) {
    depthById.set(node.id, nextDepth)
    nextDepth += 1
  }

  const isolated = nodes
    .filter((node) => (graph.degree.get(node.id) ?? 0) === 0)
    .sort(compareNodeId)
  for (let index = 0; index < isolated.length; index += 1) {
    const columnOffset = Math.floor(index / ISOLATED_GRID_ROW_LIMIT)
    depthById.set(isolated[index].id, nextDepth + columnOffset)
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

function reorderColumn(
  column: WorkflowFlowLayoutNode[],
  neighborsById: ReadonlyMap<string, readonly string[]>,
  neighborOrder: ReadonlyMap<string, number>,
): void {
  const previousOrder = new Map(column.map((node, index) => [node.id, index] as const))
  column.sort((left, right) => {
    const leftMedian = median(
      (neighborsById.get(left.id) ?? [])
        .map((id) => neighborOrder.get(id))
        .filter((value): value is number => value !== undefined),
    )
    const rightMedian = median(
      (neighborsById.get(right.id) ?? [])
        .map((id) => neighborOrder.get(id))
        .filter((value): value is number => value !== undefined),
    )
    if (leftMedian !== null && rightMedian !== null && leftMedian !== rightMedian) {
      return leftMedian - rightMedian
    }
    if (leftMedian !== null && rightMedian === null) return -1
    if (leftMedian === null && rightMedian !== null) return 1
    return (previousOrder.get(left.id) ?? 0) - (previousOrder.get(right.id) ?? 0)
      || left.id.localeCompare(right.id)
  })
}

function minimizeLayerCrossings(
  nodesByDepth: Map<number, WorkflowFlowLayoutNode[]>,
  depths: readonly number[],
  graph: WorkflowGraph,
): void {
  const orderAtDepth = (depth: number): Map<string, number> => new Map(
    (nodesByDepth.get(depth) ?? []).map((node, index) => [node.id, index] as const),
  )

  for (let sweep = 0; sweep < ORDERING_SWEEP_COUNT; sweep += 1) {
    for (let index = 1; index < depths.length; index += 1) {
      const depth = depths[index]
      reorderColumn(
        nodesByDepth.get(depth) ?? [],
        graph.incoming,
        orderAtDepth(depths[index - 1]),
      )
    }
    for (let index = depths.length - 2; index >= 0; index -= 1) {
      const depth = depths[index]
      reorderColumn(
        nodesByDepth.get(depth) ?? [],
        graph.outgoing,
        orderAtDepth(depths[index + 1]),
      )
    }
  }
}

/**
 * Deterministic left-to-right layered DAG layout.
 *
 * Node order is derived from graph structure and stable ids, never from the already-corrupted
 * canvas coordinates. Barycentric sweeps keep fan-out/fan-in ordering consistent across adjacent
 * layers. Isolated nodes use a compact grid so incomplete edge data cannot form a giant column.
 */
export function computeWorkflowFlowLayout(
  nodes: readonly WorkflowFlowLayoutNode[],
  edges: readonly WorkflowFlowLayoutEdge[],
  gapX: number,
  gapY: number,
): Map<string, WorkflowFlowLayoutPoint> {
  if (nodes.length === 0) return new Map()

  const graph = buildWorkflowGraph(nodes, edges)
  const { depthById, processed } = assignConnectedDepths(nodes, graph)
  placeUnresolvedAndIsolatedNodes(nodes, graph, depthById, processed)

  const nodesByDepth = new Map<number, WorkflowFlowLayoutNode[]>()
  for (const node of nodes) {
    const depth = depthById.get(node.id) ?? 0
    const column = nodesByDepth.get(depth) ?? []
    column.push(node)
    nodesByDepth.set(depth, column)
  }
  nodesByDepth.forEach((column) => column.sort(compareNodeId))

  const depths = Array.from(nodesByDepth.keys()).sort((left, right) => left - right)
  minimizeLayerCrossings(nodesByDepth, depths, graph)

  const columnWidthByDepth = new Map<number, number>()
  const columnHeightByDepth = new Map<number, number>()
  for (const depth of depths) {
    const column = nodesByDepth.get(depth) ?? []
    columnWidthByDepth.set(depth, Math.max(0, ...column.map((node) => node.size.width)))
    columnHeightByDepth.set(
      depth,
      column.reduce((sum, node) => sum + node.size.height, 0)
        + gapY * Math.max(0, column.length - 1),
    )
  }

  const sharedFlowHeight = Math.max(0, ...Array.from(columnHeightByDepth.values()))
  const positions = new Map<string, WorkflowFlowLayoutPoint>()
  let cursorX = 0
  for (const depth of depths) {
    const column = nodesByDepth.get(depth) ?? []
    const columnWidth = columnWidthByDepth.get(depth) ?? 0
    const columnHeight = columnHeightByDepth.get(depth) ?? 0
    let cursorY = (sharedFlowHeight - columnHeight) / 2

    for (const node of column) {
      positions.set(node.id, {
        x: cursorX + (columnWidth - node.size.width) / 2,
        y: cursorY,
      })
      cursorY += node.size.height + gapY
    }
    cursorX += columnWidth + gapX
  }

  return positions
}
