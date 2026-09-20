/** Canvas membership is independent of durable execution and media ownership. */
export const CANVAS_LIFECYCLE_KEY = '__tapcanvasCanvasLifecycle'

export type CanvasMembershipChanges = Readonly<{
  deletedNodeIds?: readonly string[]
  restoredNodeIds?: readonly string[]
}>

export type CanvasMembershipState = Readonly<{
  deletedNodeIds: string[]
  detachedExecutionIds: string[]
}>

export function readCanvasMembership(value: unknown): CanvasMembershipState {
  const membership = record(record(value).canvasMembership)
  const strings = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string') : []
  return { deletedNodeIds: strings(membership.deletedNodeIds), detachedExecutionIds: strings(membership.detachedExecutionIds) }
}

type GraphRecord = Record<string, unknown>
type CanvasLifecycle = {
  deletedNodeIds: string[]
  detachedExecutionIds: string[]
  retainedNodeIds: string[]
}

function record(value: unknown): GraphRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as GraphRecord : {}
}

function records(value: unknown): GraphRecord[] {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readLifecycle(graph: GraphRecord): CanvasLifecycle {
  const value = graph[CANVAS_LIFECYCLE_KEY]
  if (value === undefined) return { deletedNodeIds: [], detachedExecutionIds: [], retainedNodeIds: [] }
  const data = record(value)
  const strings = (key: string): string[] => {
    const list = data[key]
    if (!Array.isArray(list) || !list.every((id): id is string => typeof id === 'string' && id.length > 0)) {
      throw new Error(`Invalid canvas lifecycle field: ${key}`)
    }
    return list
  }
  return {
    deletedNodeIds: strings('deletedNodeIds'),
    detachedExecutionIds: strings('detachedExecutionIds'),
    retainedNodeIds: strings('retainedNodeIds'),
  }
}

export function isDetachedCanvasNode(value: unknown): boolean {
  return record(value).canvasDetached === true
}

/**
 * Only explicit membership changes can alter the ledger. Graph-only writers
 * cannot clear it by omitting metadata or replaying an older envelope.
 * Deleted media nodes remain available to paid-task settlement internally.
 */
export function reconcileCanvasMembership(
  currentValue: unknown,
  nextValue: unknown,
  changes: CanvasMembershipChanges = {},
): GraphRecord {
  const current = record(currentValue)
  const next = record(nextValue)
  if (!Array.isArray(next.nodes)) {
    const result = { ...next }
    delete result[CANVAS_LIFECYCLE_KEY]
    delete result.canvasMembership
    if (current[CANVAS_LIFECYCLE_KEY] !== undefined) result[CANVAS_LIFECYCLE_KEY] = current[CANVAS_LIFECYCLE_KEY]
    return result
  }
  if (!(CANVAS_LIFECYCLE_KEY in current) && !(CANVAS_LIFECYCLE_KEY in next) && !('canvasMembership' in next)
    && !changes.deletedNodeIds?.length && !changes.restoredNodeIds?.length
    && !next.nodes.some((node) => 'canvasDetached' in record(node))
    && !(Array.isArray(next.edges) && next.edges.some((edge) => 'canvasDetached' in record(edge)))) return next
  const previous = readLifecycle(current)
  const deleted = new Set(previous.deletedNodeIds)
  const detachedExecutions = new Set(previous.detachedExecutionIds)
  const retained = new Set(previous.retainedNodeIds)
  const currentNodes = records(current.nodes)
  const nextNodes = records(next.nodes)
  const nextIds = new Set(nextNodes.map((node) => text(node.id)))
  const currentById = new Map(currentNodes.map((node) => [text(node.id), node]))
  const nextById = new Map(nextNodes.map((node) => [text(node.id), node]))
  const removed = new Set(changes.deletedNodeIds ?? [])
  for (const id of removed) {
    deleted.add(id)
  }
  for (const node of currentNodes) {
    const id = text(node.id)
    const data = record(node.data)
    const executionId = text(data.workflowExecutionId)
    if (!removed.has(id) || !executionId || data.managedProjection !== 'workflow_execution') continue
    detachedExecutions.add(executionId)
    const familyId = text(data.workflowExecutionFamilyId)
    if (familyId) detachedExecutions.add(familyId)
    // Existing outputs are independent user content. Detaching the execution
    // prevents future additions; it does not cascade-delete existing results.
    for (const candidate of currentNodes) {
      const candidateData = record(candidate.data)
      const sameExecution = text(candidateData.workflowExecutionId) === executionId
        || Boolean(familyId && text(candidateData.workflowExecutionFamilyId) === familyId)
      if (sameExecution && !removed.has(text(candidate.id)) && !isDetachedCanvasNode(candidate)) {
        retained.add(text(candidate.id))
      }
    }
  }
  // Restore is a membership change against the persisted ledger, not against the
  // caller's snapshot: a node hidden by deletedNodeIds / a detached execution is by
  // construction absent from the graph the caller was allowed to read, so requiring
  // it in `next` made those nodes permanently unrecoverable. Restore now works from
  // the persisted node itself and re-attaches it to the output graph.
  for (const id of changes.restoredNodeIds ?? []) {
    const persistedNode = currentById.get(id)
    const nextNode = nextById.get(id)
    if (!persistedNode && !nextNode) continue
    const persistedData = record(persistedNode?.data)
    const wasHidden = deleted.has(id)
      || Boolean(persistedNode && isDetachedCanvasNode(persistedNode))
      || Boolean(persistedNode && !retained.has(id)
        && [persistedData.workflowExecutionId, persistedData.workflowExecutionFamilyId]
          .some((executionId) => typeof executionId === 'string' && detachedExecutions.has(executionId)))
    if (!wasHidden && nextNode) continue
    deleted.delete(id)
    retained.add(id)
    const data = record(nextNode?.data ?? persistedData)
    if (data.managedProjection === 'workflow_execution') {
      detachedExecutions.delete(text(data.workflowExecutionId))
      detachedExecutions.delete(text(data.workflowExecutionFamilyId))
    }
    if (!nextNode && persistedNode) {
      nextNodes.push(persistedNode)
      nextIds.add(id)
      nextById.set(id, persistedNode)
    }
  }
  const isDetached = (node: GraphRecord): boolean => deleted.has(text(node.id))
    || ([record(node.data).workflowExecutionId, record(node.data).workflowExecutionFamilyId].some((id) => detachedExecutions.has(text(id))) && !retained.has(text(node.id)))
  const nodes = [...nextNodes]
  for (const node of currentNodes) {
    const data = record(node.data)
    const id = text(node.id)
    if (nextIds.has(id)) continue
    // Retained nodes are explicit user content: a viewer snapshot that cannot see them
    // (because the projection hid them) must never be able to drop them from storage.
    if (retained.has(id) || (isDetached(node)
      && (text(data.workflowEffectId) || text(data.taskId) || text(data.videoTaskId) || data.managedProjection === 'workflow_execution'))) nodes.push(node)
  }
  const result: GraphRecord = { ...next }
  delete result[CANVAS_LIFECYCLE_KEY]
  delete result.canvasMembership
  if (deleted.size || detachedExecutions.size || retained.size) {
    result[CANVAS_LIFECYCLE_KEY] = {
      deletedNodeIds: [...deleted], detachedExecutionIds: [...detachedExecutions], retainedNodeIds: [...retained],
    } satisfies CanvasLifecycle
  }
  result.nodes = nodes.map((node) => {
    const clean = { ...node }
    delete clean.canvasDetached
    return isDetached(node) ? { ...clean, canvasDetached: true } : clean
  })
  const hiddenIds = new Set(nodes.filter(isDetached).map((node) => text(node.id)))
  if (Array.isArray(next.edges)) result.edges = records(next.edges).map((edge) => {
    const clean = { ...edge }
    delete clean.canvasDetached
    return hiddenIds.has(text(edge.source)) || hiddenIds.has(text(edge.target))
      ? { ...clean, canvasDetached: true } : clean
  })
  return result
}

/** Strip detached runtime records before graph content reaches a canvas. */
export function projectCanvasMembership(value: unknown): unknown {
  const graph = record(value)
  if (!Array.isArray(graph.nodes)) return value
  const lifecycle = readLifecycle(graph)
  const publicMembership = readCanvasMembership(graph)
  const deleted = new Set([...lifecycle.deletedNodeIds, ...publicMembership.deletedNodeIds])
  // Public projections omit retainedNodeIds; they have already applied family
  // detachment. Reapplying that partial ledger would hide retained user outputs.
  const detached = new Set(lifecycle.detachedExecutionIds)
  const retained = new Set(lifecycle.retainedNodeIds)
  const hidden = new Set(records(graph.nodes).filter((node) => {
    const data = record(node.data)
    return isDetachedCanvasNode(node) || deleted.has(text(node.id))
      || (!retained.has(text(node.id)) && [data.workflowExecutionId, data.workflowExecutionFamilyId]
        .some((id) => typeof id === 'string' && detached.has(id)))
  }).map((node) => text(node.id)))
  if (!hidden.size && !(CANVAS_LIFECYCLE_KEY in graph)) return value
  const result = { ...graph }
  delete result[CANVAS_LIFECYCLE_KEY]
  result.canvasMembership = { deletedNodeIds: [...deleted], detachedExecutionIds: [...new Set([...detached, ...publicMembership.detachedExecutionIds])] } satisfies CanvasMembershipState
  result.nodes = records(graph.nodes).filter((node) => !hidden.has(text(node.id)))
  result.edges = records(graph.edges).filter((edge) => !hidden.has(text(edge.source)) && !hidden.has(text(edge.target)))
  return result
}
