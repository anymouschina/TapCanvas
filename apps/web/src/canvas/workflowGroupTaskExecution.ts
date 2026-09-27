import type { Edge, Node } from '@xyflow/react'
import { requiresWorkflowMediaRecovery } from '../runner/workflowMediaExecutionState'
import { resolveWorkflowMediaOutputSlot } from './workflowMediaAttemptProjection'

export type WorkflowGroupTaskExecutionPlan = Readonly<{
  workflowMediaTargets: readonly string[]
  dagTargets: readonly string[]
  deferredTargets: readonly string[]
}>

/** Keep durable workflow media outputs out of generic DAG scheduling. */
export function planWorkflowGroupTaskExecution(
  nodes: readonly Node[],
  edges: readonly Edge[],
  selectedNodeIds: readonly string[],
): WorkflowGroupTaskExecutionPlan {
  const selected = new Set(selectedNodeIds)
  const selectedNodes = nodes.filter((node) => selected.has(node.id))
  const logicalMediaIdByPhysicalId = new Map<string, string>()
  for (const node of nodes) {
    if (!requiresWorkflowMediaRecovery(node)) continue
    const slot = resolveWorkflowMediaOutputSlot(nodes, node.id)
    logicalMediaIdByPhysicalId.set(node.id, slot?.node.id ?? node.id)
  }
  const workflowMediaTargets = [...new Set(selectedNodes
    .filter(requiresWorkflowMediaRecovery)
    .map((node) => logicalMediaIdByPhysicalId.get(node.id) ?? node.id))]
  const allWorkflowMediaIds = new Set(selectedNodes
    .filter(requiresWorkflowMediaRecovery)
    .flatMap((node) => [node.id, logicalMediaIdByPhysicalId.get(node.id) ?? node.id]))
  const downstream = new Set(workflowMediaTargets)
  const queue = [...workflowMediaTargets]
  const childrenBySource = new Map<string, string[]>()
  for (const edge of edges) {
    if (!selected.has(edge.source) || !selected.has(edge.target)) continue
    const sourceId = logicalMediaIdByPhysicalId.get(edge.source) ?? edge.source
    const targetId = logicalMediaIdByPhysicalId.get(edge.target) ?? edge.target
    const children = childrenBySource.get(sourceId) ?? []
    children.push(targetId)
    childrenBySource.set(sourceId, children)
  }
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    for (const childId of childrenBySource.get(current) ?? []) {
      if (downstream.has(childId)) continue
      downstream.add(childId)
      queue.push(childId)
    }
  }

  const deferredTargets = selectedNodes
    .filter((node) => downstream.has(logicalMediaIdByPhysicalId.get(node.id) ?? node.id)
      && !allWorkflowMediaIds.has(node.id))
    .map((node) => node.id)
  const dagTargets = selectedNodes
    .filter((node) => !allWorkflowMediaIds.has(node.id)
      && !downstream.has(logicalMediaIdByPhysicalId.get(node.id) ?? node.id))
    .map((node) => node.id)
  return { workflowMediaTargets, dagTargets, deferredTargets }
}
