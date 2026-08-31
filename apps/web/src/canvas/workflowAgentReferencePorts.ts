export type WorkflowAgentReferencePortKind = 'skill' | 'knowledge'

export function workflowAgentReferenceSourceHandleId(kind: WorkflowAgentReferencePortKind): string {
  return `out-workflow-reference:${kind}`
}

export function workflowAgentReferenceTargetHandleId(kind: WorkflowAgentReferencePortKind): string {
  return `in-workflow-reference:${kind}`
}
