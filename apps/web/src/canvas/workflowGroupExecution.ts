import type { Node } from '@xyflow/react'
import { AGENT_WORKFLOW_KEY } from '@tapcanvas/workflow-kernel-protocol'

type WorkflowGroupNode = Pick<Node, 'id' | 'type' | 'parentId' | 'data'>

export type WorkflowCapabilitySelectionValidation =
  | { eligible: true; triggerNodeId: string }
  | { eligible: false; reason: string }

function dataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function isAgentWorkflowGroup(node: WorkflowGroupNode | null | undefined): boolean {
  if (!node || !isWorkflowGroup(node)) return false
  return dataRecord(node.data).workflowKey === AGENT_WORKFLOW_KEY
}

export function isWorkflowGroup(node: WorkflowGroupNode | null | undefined): boolean {
  if (!node || node.type !== 'groupNode') return false
  const data = dataRecord(node.data)
  return data.adminWorkflow === true
    && (readString(data, 'workflowKey').length > 0
      || readString(data, 'workflowInstanceId').length > 0)
}

export function resolveWorkflowGroupTrigger(
  groupId: string,
  nodes: readonly WorkflowGroupNode[],
): string | null {
  const group = nodes.find((node) => node.id === groupId)
  if (!group || !isWorkflowGroup(group)) return null
  const groupData = dataRecord(group.data)
  const workflowInstanceId = readString(groupData, 'workflowInstanceId')
  if (!workflowInstanceId) throw new Error('工作流组缺少实例身份')
  const workflowKey = readString(groupData, 'workflowKey')

  const childIdsByParent = new Map<string, string[]>()
  for (const node of nodes) {
    const parentId = typeof node.parentId === 'string' ? node.parentId.trim() : ''
    if (!parentId) continue
    const childIds = childIdsByParent.get(parentId) ?? []
    childIds.push(node.id)
    childIdsByParent.set(parentId, childIds)
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const descendants: WorkflowGroupNode[] = []
  const queue = [...(childIdsByParent.get(groupId) ?? [])]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const nodeId = queue.shift()
    if (!nodeId || visited.has(nodeId)) continue
    visited.add(nodeId)
    const node = nodeById.get(nodeId)
    if (!node) continue
    descendants.push(node)
    queue.push(...(childIdsByParent.get(nodeId) ?? []))
  }

  const triggerIds = descendants.flatMap((node) => {
    const data = dataRecord(node.data)
    const matches = node.type === 'taskNode'
      && data.kind === 'workflowTrigger'
      && data.adminWorkflow === true
      && readString(data, 'workflowKey').length > 0
      && (!workflowKey || data.workflowKey === workflowKey)
      && readString(data, 'workflowInstanceId') === workflowInstanceId
    return matches ? [node.id] : []
  })
  if (triggerIds.length !== 1) {
    throw new Error(`工作流组必须包含唯一触发器，当前为 ${triggerIds.length} 个`)
  }
  return triggerIds[0] ?? null
}

/**
 * Keep the canvas entry aligned with the server capability descriptor contract.
 * A selected group can represent the saved Flow only when every workflow node in
 * that Flow belongs to the group, with one trigger and at least one stage.
 */
export function validateWorkflowCapabilitySelection(
  groupId: string,
  nodes: readonly WorkflowGroupNode[],
): WorkflowCapabilitySelectionValidation {
  const group = nodes.find((node) => node.id === groupId)
  if (!group || group.type !== 'groupNode') {
    return { eligible: false, reason: '只有包含完整步骤的工作流组才能添加到 Agent 配置' }
  }

  const childrenByParent = new Map<string, string[]>()
  for (const node of nodes) {
    const parentId = typeof node.parentId === 'string' ? node.parentId.trim() : ''
    if (!parentId) continue
    const children = childrenByParent.get(parentId) ?? []
    children.push(node.id)
    childrenByParent.set(parentId, children)
  }
  const descendantIds = new Set<string>()
  const queue = [...(childrenByParent.get(groupId) ?? [])]
  while (queue.length > 0) {
    const nodeId = queue.shift()
    if (!nodeId || descendantIds.has(nodeId)) continue
    descendantIds.add(nodeId)
    queue.push(...(childrenByParent.get(nodeId) ?? []))
  }

  const workflowNodes = nodes.filter((node) => {
    const kind = readString(dataRecord(node.data), 'kind')
    return kind === 'workflowTrigger' || kind === 'workflowStage'
  })
  const outsideWorkflowNodes = workflowNodes.filter((node) => !descendantIds.has(node.id))
  if (outsideWorkflowNodes.length > 0) {
    return {
      eligible: false,
      reason: '画布中还有不属于当前组的工作流节点；Agent 配置会添加整张已保存工作流，请先拆成独立工作流',
    }
  }

  const triggerCount = workflowNodes.filter(
    (node) => readString(dataRecord(node.data), 'kind') === 'workflowTrigger',
  ).length
  if (triggerCount !== 1) {
    return {
      eligible: false,
      reason: `整张 Flow 必须且只能包含一个工作流触发器，当前为 ${triggerCount} 个`,
    }
  }
  const stageCount = workflowNodes.filter(
    (node) => readString(dataRecord(node.data), 'kind') === 'workflowStage',
  ).length
  if (stageCount === 0) {
    return { eligible: false, reason: '空工作流不能添加到 Agent 配置' }
  }

  const triggerNodeId = workflowNodes.find(
    (node) => readString(dataRecord(node.data), 'kind') === 'workflowTrigger',
  )?.id
  if (!triggerNodeId) {
    return { eligible: false, reason: '工作流组缺少可运行触发器' }
  }

  return { eligible: true, triggerNodeId }
}
