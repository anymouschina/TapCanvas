type Identified = Readonly<{ id: string }>

/** A render/drag snapshot can lag a server acknowledgement. Only the store's
 * explicit deletion ledger authorizes removal; absence alone never does. */
export function prepareCanvasMembershipSave<
  N extends Identified, E extends Identified & { source: string; target: string },
  G extends { nodes: N[]; edges: E[] },
>(base: G, local: G, deletedNodeIds: readonly string[]): {
  snapshot: G
  adjusted: boolean
  changes: { deletedNodeIds: string[]; restoredNodeIds: string[] }
} {
  const present = new Set(local.nodes.map((node) => node.id))
  const deleted = new Set(deletedNodeIds.filter((id) => !present.has(id)))
  const retained = base.nodes.filter((node) => !present.has(node.id) && !deleted.has(node.id))
  const nodes = [...local.nodes, ...retained]
  const ids = new Set(nodes.map((node) => node.id))
  const retainedIds = new Set(retained.map((node) => node.id))
  const edgeIds = new Set(local.edges.map((edge) => edge.id))
  const edges = [...local.edges, ...base.edges.filter((edge) => !edgeIds.has(edge.id)
    && (retainedIds.has(edge.source) || retainedIds.has(edge.target))
    && ids.has(edge.source) && ids.has(edge.target))]
  return {
    snapshot: { ...local, nodes, edges } as G,
    adjusted: retained.length > 0,
    changes: { deletedNodeIds: [...deleted], restoredNodeIds: canvasMembershipChanges(base.nodes, local.nodes).restoredNodeIds },
  }
}

/** Only local edits relative to the acknowledged graph constitute intent. */
export function canvasMembershipChanges(base: readonly Identified[], local: readonly Identified[]) {
  const baseIds = new Set(base.map((node) => node.id))
  const localIds = new Set(local.map((node) => node.id))
  return {
    deletedNodeIds: [...baseIds].filter((id) => !localIds.has(id)),
    restoredNodeIds: [...localIds].filter((id) => !baseIds.has(id)),
  }
}

export function updateLocalCanvasDeletions(
  deletedIds: readonly string[], before: readonly Identified[], after: readonly Identified[],
): string[] {
  const changes = canvasMembershipChanges(before, after)
  const restored = new Set(changes.restoredNodeIds)
  return [...new Set([...deletedIds, ...changes.deletedNodeIds])].filter((id) => !restored.has(id))
}

/**
 * Remote (SSE) patches carry removals the server already persisted — run teardown,
 * execution detach, projection cleanup. They are authoritative results, NOT user intent,
 * so they must never enter the local deletion ledger. Recording them turned the next
 * whole-graph PUT into a permanent `__tapcanvasCanvasLifecycle.deletedNodeIds` tombstone,
 * which hides those nodes from every later projection with no restore path — the
 * "章节画布只剩几个视频节点" ratchet. Only an explicit restore clears entries here.
 */
export function applyRemotePatchToDeletionLedger(
  locallyDeletedNodeIds: readonly string[],
  restoredNodeIds: readonly string[],
): string[] {
  const restored = new Set(restoredNodeIds)
  return locallyDeletedNodeIds.filter((id) => !restored.has(id))
}

export function updateDetachedExecutions(
  detachedIds: readonly string[],
  before: readonly (Identified & { data?: unknown })[],
  after: readonly (Identified & { data?: unknown })[],
): string[] {
  const changes = canvasMembershipChanges(before, after)
  const detached = new Set(detachedIds)
  const executionId = (node: { data?: unknown }): string | null => {
    const data = node.data as Record<string, unknown> | undefined
    return (data?.managedProjection === 'workflow_execution' || data?.kind === 'workflowExecution') && typeof data.workflowExecutionId === 'string'
      ? data.workflowExecutionId : null
  }
  const deleted = new Set(changes.deletedNodeIds)
  for (const node of before) {
    const id = executionId(node)
    if (id && deleted.has(node.id)) {
      detached.add(id)
      const familyId = (node.data as Record<string, unknown>).workflowExecutionFamilyId
      if (typeof familyId === 'string') detached.add(familyId)
    }
  }
  const restored = new Set(changes.restoredNodeIds)
  for (const node of after) {
    const id = executionId(node)
    if (id && restored.has(node.id)) {
      detached.delete(id)
      const familyId = (node.data as Record<string, unknown>).workflowExecutionFamilyId
      if (typeof familyId === 'string') detached.delete(familyId)
    }
  }
  return [...detached]
}

export function filterCanvasMembershipPatch<
  N extends Identified & { data?: unknown }, E extends Identified & { source: string; target: string },
  P extends { upsertNodes?: N[]; upsertEdges?: E[]; restoredNodeIds?: string[] },
>(state: { nodes: readonly Identified[]; locallyDeletedNodeIds: readonly string[]; detachedWorkflowExecutionIds: readonly string[] }, patch: P): P {
  const restored = new Set(patch.restoredNodeIds ?? [])
  const deleted = new Set(state.locallyDeletedNodeIds.filter((id) => !restored.has(id)))
  const detached = new Set(state.detachedWorkflowExecutionIds)
  const present = new Set(state.nodes.map((node) => node.id))
  for (const node of patch.upsertNodes ?? []) {
    const data = node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {}
    if (!present.has(node.id) && !restored.has(node.id)
      && [data.workflowExecutionId, data.workflowExecutionFamilyId].some((id) => typeof id === 'string' && detached.has(id))) deleted.add(node.id)
  }
  return {
    ...patch,
    upsertNodes: patch.upsertNodes?.filter((node) => !deleted.has(node.id)),
    upsertEdges: patch.upsertEdges?.filter((edge) => !deleted.has(edge.source) && !deleted.has(edge.target)),
  }
}
