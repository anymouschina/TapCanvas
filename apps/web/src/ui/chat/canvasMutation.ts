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
    const executableNodeIds = dedupeNodeIds(
      Array.isArray(input.traceCanvasMutation?.executableNodeIds)
        ? input.traceCanvasMutation.executableNodeIds
        : [],
    )
    const executableNodeIdSet = new Set(executableNodeIds)
    const autoRunNewNodeIds = focusNodeIds.filter((nodeId) => executableNodeIdSet.has(nodeId))
    const newNodeIdSet = new Set(autoRunNewNodeIds)
    return {
      focusNodeIds,
      // A failed terminal claim does not invalidate already-persisted, structurally
      // executable canvas work. Resume only IDs backed by successful flow-patch
      // evidence; node-level readiness checks still guard the actual execution.
      autoRunNewNodeIds,
      autoRunPatchedNodeIds: executableNodeIds.filter((nodeId) => !newNodeIdSet.has(nodeId)),
    }
  }

  return {
    focusNodeIds,
    autoRunNewNodeIds: focusNodeIds,
    autoRunPatchedNodeIds: collectTracePatchedNodeIds(input.traceCanvasMutation),
  }
}
