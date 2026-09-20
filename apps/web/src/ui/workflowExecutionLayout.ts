import type { Edge, Node } from '@xyflow/react'
import { computeWorkflowFlowLayout } from '../canvas/workflowFlowLayout'

/** Presentation-only layout of the frozen execution DAG; never rewrites its data. */
export function layoutExecutionWorkflowNodes<T extends Node>(nodes: readonly T[], edges: readonly Edge[]): T[] {
  const groups = new Map<string | undefined, T[]>()
  for (const node of nodes) {
    if (node.data.kind !== 'workflowStage' && node.data.kind !== 'workflowTrigger') continue
    const scope = typeof node.data.workflowInstanceId === "string" ? node.data.workflowInstanceId : node.parentId
    const siblings = groups.get(scope) ?? []
    siblings.push(node)
    groups.set(scope, siblings)
  }
  const positions = new Map<string, { x: number; y: number }>()
  const parents = new Map<string, string | undefined>()
  const groupSizes = new Map<string, { width: number; height: number }>()
  for (const [scope, siblings] of groups) {
    const parentId = nodes.find(node => node.type === "groupNode" && (node.id === scope || (scope !== undefined && node.data.workflowInstanceId === scope)))?.id
    if (siblings.length < 2) continue
    // Reserve room below each operation for its runtime agent/skill satellites.
    const layout = computeWorkflowFlowLayout(siblings.map(node => ({
      id: node.id, position: node.position, size: { width: 112, height: 200 },
    })), edges, 104, 100)
    let width = 0
    let height = 0
    for (const [id, point] of layout) {
      parents.set(id, parentId)
      positions.set(id, { x: point.x + 64, y: point.y + 80 })
      width = Math.max(width, point.x + 240)
      height = Math.max(height, point.y + 340)
    }
    if (parentId) groupSizes.set(parentId, { width, height })
  }
  return nodes.map(node => {
    const position = positions.get(node.id)
    const size = groupSizes.get(node.id)
    if (position) return { ...node, position, parentId: parents.get(node.id) }
    if (size) return { ...node, ...size, style: { ...node.style, ...size } }
    return node
  })
}
