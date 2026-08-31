const WORKFLOW_EXECUTION_PROJECTION_DATA_KEYS = new Set([
  'triggerStatus',
  'workflowRequestedAt',
  'workflowExecutionId',
  'workflowExecutionCreatedAt',
  'workflowStatus',
  'workflowLocalTestStatus',
  'workflowLocalTestOutput',
  'workflowExecutionEvidence',
  'workflowOutputArtifactIds',
  'workflowOutputArtifacts',
  'workflowItemRuns',
  'workflowCompletedUnits',
  'workflowTotalUnits',
  'workflowErrorCount',
  'workflowErrorDetail',
  'workflowExecutionStartedAt',
  'workflowExecutionFinishedAt',
  'workflowRuntimeExpanded',
  'previousWorkflowTraceId',
  'workflowTraceId',
  'workflowTraceStatus',
  'workflowTraceUpdatedAt',
  'workflowLogicalTaskId',
  'workflowPhysicalRunId',
  'workflowNodeRunId',
  'workflowResolvedOutputReuse',
])

let projectionDepth = 0

export const workflowExecutionProjectionGuard = {
  get active(): boolean {
    return projectionDepth > 0
  },
  run<T>(project: () => T): T {
    projectionDepth += 1
    try {
      return project()
    } finally {
      projectionDepth = Math.max(0, projectionDepth - 1)
    }
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isExecutionDoWorkflowNodeData(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || value.adminWorkflow !== true) return false
  return value.kind === 'workflowTrigger' || value.kind === 'workflowStage'
}

type WorkflowRuntimeReferenceNodeData = Record<string, unknown> & {
  workflowRuntimeReference: true
}

type WorkflowRuntimeReferenceEdgeData = Record<string, unknown> & {
  executionRole: 'reference_only'
  relationKind: 'agent_skill_reference' | 'agent_knowledge_reference'
}

export function isWorkflowRuntimeReferenceNodeData(
  value: unknown,
): value is WorkflowRuntimeReferenceNodeData {
  return isRecord(value) && value.workflowRuntimeReference === true
}

export function isWorkflowRuntimeReferenceEdgeData(
  value: unknown,
): value is WorkflowRuntimeReferenceEdgeData {
  if (!isRecord(value) || value.executionRole !== 'reference_only') return false
  return value.relationKind === 'agent_skill_reference'
    || value.relationKind === 'agent_knowledge_reference'
}

/**
 * The flow graph is the immutable authoring definition. ExecutionDO rows own
 * runtime status, outputs, evidence and timestamps, so browser sync must never
 * echo a transient projection back into the graph snapshot.
 */
export function withoutWorkflowExecutionProjectionData(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !WORKFLOW_EXECUTION_PROJECTION_DATA_KEYS.has(key)),
  )
}

export function withoutWorkflowExecutionProjectionNodes<
  TNode extends Readonly<{ data?: unknown }>,
>(nodes: readonly TNode[]): TNode[] {
  return nodes.flatMap((node) => {
    if (isWorkflowRuntimeReferenceNodeData(node.data)) return []
    if (!isExecutionDoWorkflowNodeData(node.data)) return node
    return [{
      ...node,
      data: withoutWorkflowExecutionProjectionData(node.data),
    }]
  })
}


export function withoutWorkflowExecutionProjectionEdges<
  TEdge extends Readonly<{ data?: unknown }>,
>(edges: readonly TEdge[]): TEdge[] {
  return edges.filter((edge) => !isWorkflowRuntimeReferenceEdgeData(edge.data))
}
