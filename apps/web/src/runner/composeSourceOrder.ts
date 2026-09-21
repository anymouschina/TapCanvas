import type { Node } from '@xyflow/react'

function sequencePosition(node: Node): { sequence: string; index: number } | null {
  const data = node.data
  const sequence = data.workflowExecutionFamilyId || data.clipRunId || data.workflowExecutionId
  if (typeof sequence !== 'string' || !sequence) return null
  if (Number.isInteger(data.clipIndex) && Number(data.clipIndex) >= 0) {
    return { sequence, index: Number(data.clipIndex) }
  }
  // Workflow item identity carries the canonical clip ID even without a display index.
  if (typeof data.workflowRuntimeNodeId !== 'string') return null
  const encodedItem = data.workflowRuntimeNodeId.split('::item::')[1]
  if (!encodedItem) return null
  let itemId: string
  try { itemId = decodeURIComponent(encodedItem) } catch { return null }
  const separator = itemId.lastIndexOf(':clip:')
  if (separator < 0) return null
  const token = itemId.slice(separator + ':clip:'.length)
  const index = Number(token)
  if (!Number.isSafeInteger(index) || index < 0 || String(index) !== token) return null
  return { sequence, index }
}

/** Only reorder slots belonging to the same sequence; unrelated sources keep their slots. */
export function orderComposeSourceNodes(nodes: Node[]): Node[] {
  const groups = new Map<string, Array<{ node: Node; index: number }>>()
  for (const node of nodes) {
    const position = sequencePosition(node)
    if (!position) continue
    const group = groups.get(position.sequence) || []
    group.push({ node, index: position.index })
    groups.set(position.sequence, group)
  }
  for (const group of groups.values()) group.sort((a, b) => a.index - b.index)
  const cursors = new Map<string, number>()
  return nodes.map(node => {
    const position = sequencePosition(node)
    if (!position) return node
    const cursor = cursors.get(position.sequence) || 0
    cursors.set(position.sequence, cursor + 1)
    return groups.get(position.sequence)![cursor]!.node
  })
}
