import type { Edge, Node } from '@xyflow/react'

export type CopyGraphTransformOptions = Readonly<{
  createNodeId: (source: Node, index: number) => string
  offset?: Readonly<{ x: number; y: number }>
  selected?: boolean
  animated?: boolean
}>

export type CopiedGraph = Readonly<{
  nodes: Node[]
  edges: Edge[]
  idMap: ReadonlyMap<string, string>
}>

const EXECUTION_IDENTITY_KEYS = new Set([
  'workflowExecutionId',
  'workflowExecutionFamilyId',
  'workflowRuntimeNodeId',
  'workflowEffectId',
  'workflowTaskId',
  'workflowResumeOnly',
  'workflowSubmissionAcceptedAt',
  'workflowVideoSubmissionInput',
  'workflowEffectFingerprint',
  'workflowEffectSourceSnapshot',
  'workflowEstimateIdentity',
  'workflowLogicalTaskId',
  'workflowPhysicalRunId',
  'workflowNodeRunId',
  'workflowRequestedAt',
  'workflowExecutionStartedAt',
  'workflowExecutionFinishedAt',
  'workflowExecutionCreatedAt',
  'workflowSubmissionState',
  'workflowSubmissionClaimedAt',
  'workflowPreparedOnly',
  'workflowMediaRetry',
  'workflowAttemptIndex',
  'workflowItemRuns',
  'workflowExecutionEvidence',
  'workflowOutputArtifactIds',
  'workflowOutputArtifacts',
  'workflowCompletedUnits',
  'workflowTotalUnits',
  'workflowErrorCount',
  'workflowErrorDetail',
  'workflowExecutionReused',
  'workflowResolvedOutputReuse',
  'workflowPinnedOutputSource',
  'workflowRuntimeExpanded',
  'workflowMaterializedAt',
  'triggerStatus',
  'workflowStatus',
  'workflowLocalTestStatus',
  'workflowLocalTestOutput',
  'workflowTraceId',
  'workflowTraceStatus',
  'workflowTraceUpdatedAt',
  'previousWorkflowTraceId',
  'providerAcceptedAt',
  'canceled',
  'lastError',
  'errorMessage',
  'error',
  'logs',
  'mediaTaskExecutionOwner',
  'managedProjection',
  'readOnly',
  'skipDagRun',
  'taskId',
  'imageTaskId',
  'imageTaskKind',
  'videoTaskId',
  'remoteTaskId',
  'storyboardTaskId',
  'sourcePrevTaskId',
  'runId',
  'runToken',
  'clipRunId',
  'videoRetrySourceNodeId',
  'videoRetryIndex',
])

const SINGLE_NODE_REFERENCE_KEYS = new Set([
  'firstFrameFromNodeId',
  'lastFrameFromNodeId',
  'sourcePrevVideoNodeId',
  'sourceVideoNodeId',
  'sourceImageNodeId',
  'sourceNodeId',
  'firstFrameImageNodeId',
  'lastFrameImageNodeId',
  'videoRetrySourceNodeId',
])

const NODE_REFERENCE_LIST_KEYS = new Set([
  'referenceImageNodeIds',
  'videoReferenceNodeIds',
  'bundleSourceNodeIds',
  'upstreamReferenceOrder',
])

const NODE_REFERENCE_BINDING_KEYS = new Set([
  'referenceImageBindings',
  'workflowReferenceBindings',
  'referenceAssetBindings',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function remapNodeReference(value: unknown, idMap: ReadonlyMap<string, string>): string | undefined {
  if (typeof value !== 'string') return undefined
  return idMap.get(value)
}

function remapReferenceBindings(value: unknown, idMap: ReadonlyMap<string, string>): unknown {
  if (!Array.isArray(value)) return value
  return value.flatMap((item) => {
    if (!isRecord(item)) return [item]
    const reference: Record<string, unknown> = { ...item }
    for (const key of ['nodeId', 'sourceNodeId']) {
      const sourceId = reference[key]
      if (typeof sourceId !== 'string') continue
      const mappedId = remapNodeReference(sourceId, idMap)
      if (mappedId) reference[key] = mappedId
      else delete reference[key]
    }
    return [reference]
  })
}

function remapImageOperationSpec(value: unknown, idMap: ReadonlyMap<string, string>): unknown {
  if (!isRecord(value)) return value
  const spec: Record<string, unknown> = { ...value }
  if (typeof spec.sourceNodeId === 'string') {
    const mappedId = remapNodeReference(spec.sourceNodeId, idMap)
    if (mappedId) spec.sourceNodeId = mappedId
    else delete spec.sourceNodeId
  }
  if (Array.isArray(spec.inputs)) {
    spec.inputs = spec.inputs.map((item) => {
      if (!isRecord(item) || typeof item.nodeId !== 'string') return item
      const mappedId = remapNodeReference(item.nodeId, idMap)
      if (mappedId) return { ...item, nodeId: mappedId }
      const { nodeId: _nodeId, ...input } = item
      return input
    })
  }
  return spec
}

function remapNodeReferences(data: Record<string, unknown>, idMap: ReadonlyMap<string, string>): Record<string, unknown> {
  const next = { ...data }
  // A workflow may intentionally use a source group outside the selection.
  // When both groups are copied, bind the new workflow to the new source.
  if (typeof next.sourceGroupId === 'string') {
    const copiedSourceGroupId = idMap.get(next.sourceGroupId)
    if (copiedSourceGroupId) next.sourceGroupId = copiedSourceGroupId
  }
  for (const key of SINGLE_NODE_REFERENCE_KEYS) {
    const value = next[key]
    if (typeof value !== 'string') continue
    const mappedId = remapNodeReference(value, idMap)
    if (mappedId) next[key] = mappedId
    else delete next[key]
  }
  for (const key of NODE_REFERENCE_LIST_KEYS) {
    const value = next[key]
    if (!Array.isArray(value)) continue
    next[key] = value.flatMap((item) => {
      const mappedId = remapNodeReference(item, idMap)
      return mappedId ? [mappedId] : []
    })
  }
  for (const key of NODE_REFERENCE_BINDING_KEYS) {
    if (key in next) next[key] = remapReferenceBindings(next[key], idMap)
  }
  if ('imageOperationSpec' in next) {
    next.imageOperationSpec = remapImageOperationSpec(next.imageOperationSpec, idMap)
  }
  return next
}

function getNodeData(node: Node): Record<string, unknown> {
  return isRecord(node.data) ? node.data : {}
}

function getParentId(node: Node): string | undefined {
  return typeof node.parentId === 'string' && node.parentId ? node.parentId : undefined
}

function hasAssetUrl(value: unknown): boolean {
  return isRecord(value) && typeof value.url === 'string' && value.url.trim().length > 0
}

function createCopySourceTrace(node: Node, data: Record<string, unknown>): Record<string, unknown> {
  const sourceExecution: Record<string, unknown> = {}
  for (const key of [
    'workflowExecutionId',
    'workflowExecutionFamilyId',
    'workflowRuntimeNodeId',
    'workflowEffectId',
    'workflowTaskId',
    'taskId',
    'imageTaskId',
    'storyboardTaskId',
    'videoTaskId',
    'remoteTaskId',
    'runId',
    'runToken',
    'workflowSubmissionAcceptedAt',
    'workflowEffectFingerprint',
  ]) {
    if (typeof data[key] === 'string' && data[key]) sourceExecution[key] = data[key]
  }
  if (typeof data.status === 'string') sourceExecution.status = data.status
  if (typeof data.lastError === 'string' && data.lastError) sourceExecution.lastError = data.lastError
  return {
    nodeId: node.id,
    ...(Object.keys(sourceExecution).length ? { execution: sourceExecution } : {}),
  }
}

function copiedNodeData(node: Node, idMap: ReadonlyMap<string, string>): Record<string, unknown> {
  const sourceData = getNodeData(node)
  const data = remapNodeReferences(sourceData, idMap)
  const copySource = createCopySourceTrace(node, sourceData)
  const cleaned = Object.fromEntries(
    Object.entries(data).filter(([key]) => !EXECUTION_IDENTITY_KEYS.has(key)),
  )
  const kind = sourceData.kind
  const isMediaNode = kind === 'image' || kind === 'imageEdit' || kind === 'video'
  const videoAsset = kind === 'video'
    && (typeof sourceData.videoUrl === 'string' && sourceData.videoUrl.trim().length > 0
      || (Array.isArray(sourceData.videoResults) && sourceData.videoResults.some(hasAssetUrl)))
  const imageAsset = (kind === 'image' || kind === 'imageEdit')
    && (typeof sourceData.imageUrl === 'string' && sourceData.imageUrl.trim().length > 0
      || (Array.isArray(sourceData.imageResults) && sourceData.imageResults.some(hasAssetUrl)))
  const hasAsset = videoAsset || imageAsset
  const status = sourceData.status
  return {
    ...cleaned,
    ...(isMediaNode
      ? { status: hasAsset ? 'success' : 'idle', progress: hasAsset ? 100 : 0 }
      : status === 'running' || status === 'queued' || status === 'failed' || status === 'canceled'
        ? { status: 'idle', progress: 0 }
        : {}),
    copySource,
  }
}

export function transformCopiedGraph(
  sourceNodes: readonly Node[],
  sourceEdges: readonly Edge[],
  options: CopyGraphTransformOptions,
): CopiedGraph {
  const idMap = new Map<string, string>()
  sourceNodes.forEach((node, index) => idMap.set(node.id, options.createNodeId(node, index)))

  const workflowInstanceIds = new Map<string, string>()
  for (const node of sourceNodes) {
    const instanceId = getNodeData(node).workflowInstanceId
    if (typeof instanceId !== 'string' || !instanceId.trim() || workflowInstanceIds.has(instanceId.trim())) continue
    const mappedNodeId = idMap.get(node.id)
    if (mappedNodeId) workflowInstanceIds.set(instanceId.trim(), `workflow-${mappedNodeId}`)
  }

  const offset = options.offset ?? { x: 0, y: 0 }
  const copiedNodes = sourceNodes.map((node) => {
    const id = idMap.get(node.id)
    if (!id) return null
    const parentId = getParentId(node)
    const mappedParentId = parentId ? idMap.get(parentId) : undefined
    const data = copiedNodeData(node, idMap)
    const workflowInstanceId = typeof data.workflowInstanceId === 'string'
      ? workflowInstanceIds.get(data.workflowInstanceId.trim())
      : undefined
    const nextData = workflowInstanceId ? { ...data, workflowInstanceId } : data
    const { parentId: _parentId, extent, ...nodeWithoutParent } = node
    return {
      ...nodeWithoutParent,
      id,
      ...(mappedParentId
        ? { parentId: mappedParentId, ...(extent !== undefined ? { extent } : {}) }
        : {}),
      selected: options.selected ?? false,
      dragging: false,
      position: mappedParentId
        ? { ...node.position }
        : { x: node.position.x + offset.x, y: node.position.y + offset.y },
      data: nextData,
    } as Node
  }).filter((node): node is Node => Boolean(node))

  const copiedEdges = sourceEdges.flatMap((edge, index) => {
    const source = idMap.get(edge.source)
    const target = idMap.get(edge.target)
    if (!source || !target || source === target) return []
    return [{
      ...edge,
      id: `${source}-${target}-copy-${index}`,
      source,
      target,
      selected: options.selected ?? false,
      animated: options.animated ?? false,
    }]
  })

  return { nodes: copiedNodes, edges: copiedEdges, idMap }
}
