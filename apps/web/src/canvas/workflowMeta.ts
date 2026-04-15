import type { Edge, Node } from '@xyflow/react'

export const WORKFLOW_STAGE_VALUES = [
  'material_ingest',
  'script_breakdown',
  'storyboard_generation',
  'shot_planning',
  'image_generation',
  'video_generation',
  'qc_publish',
] as const

export type WorkflowStage = (typeof WORKFLOW_STAGE_VALUES)[number]

const WORKFLOW_STAGE_SET = new Set<string>(WORKFLOW_STAGE_VALUES)

export type WorkflowNodeMeta = {
  experimentGroupId?: string
  workflowStage?: WorkflowStage
  iterationKey?: string
}

export type WorkflowEdgeMeta = {
  branchGroupId?: string
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function validateWorkflowNodeMeta(node: Node): string | null {
  const data = (node.data || {}) as Record<string, unknown>
  const stageRaw = readTrimmedString(data.workflowStage)
  if (!stageRaw) return null
  if (!WORKFLOW_STAGE_SET.has(stageRaw)) {
    return `节点 ${node.id} 的 workflowStage 非法: ${stageRaw}`
  }
  return null
}

export function validateWorkflowEdgeMeta(edge: Edge): string | null {
  const data = (edge.data || {}) as Record<string, unknown>
  const branchGroupId = data.branchGroupId
  if (typeof branchGroupId === 'undefined' || branchGroupId === null) return null
  if (typeof branchGroupId === 'string' && branchGroupId.trim()) return null
  return `连线 ${edge.id} 的 branchGroupId 非法，必须是非空字符串`
}

export function normalizeWorkflowNodeMeta(node: Node): Node {
  const data = (node.data || {}) as Record<string, unknown>
  const stageRaw = readTrimmedString(data.workflowStage)
  const experimentGroupId = readTrimmedString(data.experimentGroupId)
  const iterationKey = readTrimmedString(data.iterationKey)
  const normalizedStage =
    stageRaw && WORKFLOW_STAGE_SET.has(stageRaw) ? (stageRaw as WorkflowStage) : undefined

  return {
    ...node,
    data: {
      ...data,
      ...(experimentGroupId ? { experimentGroupId } : { experimentGroupId: undefined }),
      ...(iterationKey ? { iterationKey } : { iterationKey: undefined }),
      ...(normalizedStage ? { workflowStage: normalizedStage } : { workflowStage: undefined }),
    },
  }
}

export function normalizeWorkflowEdgeMeta(edge: Edge): Edge {
  const data = ((edge.data || {}) as Record<string, unknown>)
  const branchGroupId = readTrimmedString(data.branchGroupId)
  return {
    ...edge,
    data: {
      ...data,
      ...(branchGroupId ? { branchGroupId } : { branchGroupId: undefined }),
    },
  }
}
