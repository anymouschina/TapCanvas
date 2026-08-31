import type { Edge, Node } from '@xyflow/react'

export type ReachableWorkflowGraph = Readonly<{
  nodes: readonly Node[]
  edges: readonly Edge[]
}>

export function compileReachableWorkflowGraph(input: Readonly<{
  triggerNodeId: string
  stopAfterNodeId?: string
  nodes: readonly Node[]
  edges: readonly Edge[]
  isEligibleNode: (node: Node) => boolean
}>): ReachableWorkflowGraph {
  const eligibleNodes = input.nodes.filter(input.isEligibleNode)
  const eligibleIds = new Set(eligibleNodes.map((node) => node.id))
  if (!eligibleIds.has(input.triggerNodeId)) throw new Error('触发器不属于当前工作流执行图')

  const outgoing = new Map<string, string[]>()
  const eligibleEdges = input.edges.filter((edge) => eligibleIds.has(edge.source) && eligibleIds.has(edge.target))
  for (const edge of eligibleEdges) {
    const targets = outgoing.get(edge.source) ?? []
    targets.push(edge.target)
    outgoing.set(edge.source, targets)
  }

  const reachableIds = new Set<string>([input.triggerNodeId])
  const pending = [input.triggerNodeId]
  while (pending.length > 0) {
    const current = pending.shift()
    if (!current) continue
    for (const target of outgoing.get(current) ?? []) {
      if (reachableIds.has(target)) continue
      reachableIds.add(target)
      pending.push(target)
    }
  }

  const normalizedStopAfterNodeId = input.stopAfterNodeId?.trim() ?? ''
  let executionIds = reachableIds
  if (normalizedStopAfterNodeId) {
    if (normalizedStopAfterNodeId === input.triggerNodeId) {
      throw new Error('执行截止节点必须是触发器之后的原子节点')
    }
    if (!reachableIds.has(normalizedStopAfterNodeId)) {
      throw new Error('执行截止节点不在当前触发器的可达工作流中')
    }
    const stopNode = eligibleNodes.find((node) => node.id === normalizedStopAfterNodeId)
    const stopData = stopNode?.data
    if (!stopData || typeof stopData !== 'object' || Array.isArray(stopData) || stopData.kind !== 'workflowStage') {
      throw new Error('执行截止节点必须是原子工作流节点')
    }
    const incoming = new Map<string, string[]>()
    for (const edge of eligibleEdges) {
      const sources = incoming.get(edge.target) ?? []
      sources.push(edge.source)
      incoming.set(edge.target, sources)
    }
    const ancestors = new Set<string>([normalizedStopAfterNodeId])
    const ancestorQueue = [normalizedStopAfterNodeId]
    while (ancestorQueue.length > 0) {
      const current = ancestorQueue.shift()
      if (!current) continue
      for (const source of incoming.get(current) ?? []) {
        if (!reachableIds.has(source) || ancestors.has(source)) continue
        ancestors.add(source)
        ancestorQueue.push(source)
      }
    }
    if (!ancestors.has(input.triggerNodeId)) throw new Error('执行截止节点没有来自当前触发器的依赖路径')
    executionIds = ancestors
  }

  const reachableNodes = eligibleNodes.filter((node) => executionIds.has(node.id))
  const reachableEdges = eligibleEdges.filter((edge) => executionIds.has(edge.source) && executionIds.has(edge.target))
  const indegree = new Map<string, number>(reachableNodes.map((node) => [node.id, 0]))
  for (const edge of reachableEdges) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)

  const queue = reachableNodes.filter((node) => indegree.get(node.id) === 0)
  const ordered: Node[] = []
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    ordered.push(current)
    for (const target of outgoing.get(current.id) ?? []) {
      if (!executionIds.has(target)) continue
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)
      if (next === 0) {
        const node = reachableNodes.find((candidate) => candidate.id === target)
        if (node) queue.push(node)
      }
    }
  }
  if (ordered.length !== reachableNodes.length) throw new Error('工作流存在循环连线，请先移除循环后再运行')
  return { nodes: ordered, edges: reachableEdges }
}
