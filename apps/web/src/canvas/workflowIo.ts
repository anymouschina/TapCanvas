import type { Edge, Node } from '@xyflow/react'
import { validateWorkflowEdgeMeta, validateWorkflowNodeMeta } from './workflowMeta'

export const WORKFLOW_INPUT_KIND = 'workflowInput'
export const WORKFLOW_OUTPUT_KIND = 'workflowOutput'

type WorkflowIoStats = {
  inputCount: number
  outputCount: number
}

type WorkflowIoValidation = WorkflowIoStats & {
  ok: boolean
  message: string | null
}

type ValidateWorkflowIoParams = {
  nodes: Node[]
  edges?: Edge[]
  scopeNodeIds?: Set<string>
}

function inScope(nodeId: string, scopeNodeIds?: Set<string>): boolean {
  if (!scopeNodeIds) return true
  return scopeNodeIds.has(nodeId)
}

export function getWorkflowIoStats(nodes: Node[], scopeNodeIds?: Set<string>): WorkflowIoStats {
  let inputCount = 0
  let outputCount = 0
  for (const node of nodes) {
    if (!node || node.type !== 'taskNode') continue
    if (!inScope(String(node.id || ''), scopeNodeIds)) continue
    const kind = String((node.data as Record<string, unknown> | undefined)?.kind || '').trim()
    if (kind === WORKFLOW_INPUT_KIND) inputCount += 1
    if (kind === WORKFLOW_OUTPUT_KIND) outputCount += 1
  }
  return { inputCount, outputCount }
}

export function validateWorkflowIoForRun(params: ValidateWorkflowIoParams): WorkflowIoValidation {
  const stats = getWorkflowIoStats(params.nodes, params.scopeNodeIds)
  if (stats.outputCount < 1) {
    return {
      ...stats,
      ok: false,
      message: '当前工作流必须至少包含 1 个「工作流输出」节点',
    }
  }
  for (const node of params.nodes) {
    if (!node || node.type !== 'taskNode') continue
    if (!inScope(String(node.id || ''), params.scopeNodeIds)) continue
    const nodeMetaError = validateWorkflowNodeMeta(node)
    if (nodeMetaError) {
      return {
        ...stats,
        ok: false,
        message: nodeMetaError,
      }
    }
  }
  for (const edge of params.edges || []) {
    if (!edge) continue
    const edgeMetaError = validateWorkflowEdgeMeta(edge)
    if (edgeMetaError) {
      return {
        ...stats,
        ok: false,
        message: edgeMetaError,
      }
    }
  }
  return {
    ...stats,
    ok: true,
    message: null,
  }
}
