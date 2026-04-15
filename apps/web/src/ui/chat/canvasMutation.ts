import type { AgentsChatResponseDto } from '../../api/server'

type TraceCanvasMutation = NonNullable<NonNullable<AgentsChatResponseDto['trace']>['canvasMutation']>

export function dedupeNodeIds(nodeIds: readonly string[]): string[] {
  return Array.from(new Set(nodeIds.map((nodeId) => String(nodeId || '').trim()).filter(Boolean)))
}

export function collectTracePatchedNodeIds(
  traceCanvasMutation?: TraceCanvasMutation | null,
): string[] {
  return dedupeNodeIds([
    ...(Array.isArray(traceCanvasMutation?.patchedNodeIds) ? traceCanvasMutation.patchedNodeIds : []),
    ...(Array.isArray(traceCanvasMutation?.executableNodeIds) ? traceCanvasMutation.executableNodeIds : []),
  ])
}

export function resolveAiChatReloadAutoRunPlan(input: {
  newNodeIds: readonly string[]
  traceCanvasMutation?: TraceCanvasMutation | null
  failedTurn: boolean
}): {
  focusNodeIds: string[]
  autoRunNewNodeIds: string[]
  autoRunPatchedNodeIds: string[]
} {
  const focusNodeIds = dedupeNodeIds(input.newNodeIds)
  if (input.failedTurn) {
    return {
      focusNodeIds,
      autoRunNewNodeIds: [],
      autoRunPatchedNodeIds: [],
    }
  }

  return {
    focusNodeIds,
    autoRunNewNodeIds: focusNodeIds,
    autoRunPatchedNodeIds: collectTracePatchedNodeIds(input.traceCanvasMutation),
  }
}
