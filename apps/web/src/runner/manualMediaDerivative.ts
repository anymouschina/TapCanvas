import type { Node, Edge } from '@xyflow/react'

export function isWorkflowMediaOutput(node: Node): boolean {
  return ['image', 'imageEdit', 'video'].includes(String(node.data.kind))
    && typeof node.data.workflowExecutionId === 'string'
    && Boolean(node.data.workflowExecutionId.trim())
}

export function manualMediaDerivativeData(node: Node): Record<string, unknown> {
  const data = { ...node.data }
  const receiptFields = new Set(['taskId', 'imageTaskId', 'imageTaskKind', 'videoTaskId', 'remoteTaskId', 'runId', 'runToken', 'lastError', 'error', 'errorMessage', 'logs', 'managedProjection', 'skipDagRun', 'readOnly'])
  for (const key of Object.keys(data)) {
    if (key.startsWith('workflow') || receiptFields.has(key)) delete data[key]
  }
  return {
    ...data, status: 'idle', progress: 0, canceled: false,
    mediaTaskExecutionOwner: 'manual',
    sourceWorkflowOutput: {
      nodeId: node.id,
      executionId: node.data.workflowExecutionId,
      effectId: node.data.workflowEffectId,
      runtimeNodeId: node.data.workflowRuntimeNodeId,
    },
  }
}

export function createManualMediaDerivative(node: Node, edges: Edge[], id: string): { node: Node; edges: Edge[] } {
  return {
    node: { ...node, id, selected: true, data: manualMediaDerivativeData(node), position: { x: node.position.x + (node.measured?.width ?? node.width ?? 480) + 60, y: node.position.y } },
    edges: edges.filter(edge => edge.target === node.id && edge.source !== node.id)
      .map(edge => ({ ...edge, id: `${edge.id}:${id}`, target: id, selected: false })),
  }
}
