/** Structural ownership contract shared by full saves and browser collaboration. */
type Data = Record<string, unknown>
function record(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function isCanvasExecutionOutputData(value: unknown): value is Data {
  return record(value) && ['workflowExecutionId', 'workflowRuntimeNodeId', 'workflowEffectId']
    .every(key => typeof value[key] === 'string' && value[key].trim().length > 0)
}
export function isCanvasServerProjectionData(value: unknown): boolean {
  return record(value) && (value.managedProjection === 'video_run_status' || value.managedProjection === 'workflow_execution')
}
const OUTPUT_FACT_FIELDS = new Set([
  'status', 'progress', 'taskId', 'videoTaskId', 'videoUrl', 'videoResults',
  'videoThumbnailUrl', 'videoTitle', 'imageUrl', 'imageResults', 'thumbnailUrl',
  'posterInline', 'assetId', 'serverAssetId', 'generatedAssetId', 'productionState',
  'errorCode', 'errorMessage', 'lastError',
  'videoReceiptRecovery', 'videoReceiptReconciliation', 'videoReceiptHistory',
])
// Structured references are authoring inputs: users must be able to rebind a
// prepared clip to a newly generated image. Other workflow-prefixed values stay
// server-owned by default, including frozen headers and submission history.
const OUTPUT_AUTHORING_FIELDS = new Set([
  'workflowReferenceBindings',
])
const TERMINAL_MEDIA_ATTEMPT_STATUSES = new Set([
  'success', 'succeeded', 'error', 'failed', 'canceled', 'cancelled',
])
const UNRESOLVED_MEDIA_SUBMISSION_STATES = new Set(['submitting', 'accepted', 'uncertain'])
const CONFIRMED_TERMINAL_MEDIA_SUBMISSION_STATES = new Set([
  'failed', 'rejected_by_provider', 'rejected_pre_upstream', 'materialized',
])
const MANUAL_MEDIA_ATTEMPT_FACT_FIELDS = new Set([
  ...OUTPUT_FACT_FIELDS,
  'error', 'logs',
  'runToken', 'mediaTaskAttemptId', 'manualMediaAttemptId', 'manualMediaAttemptTargetId',
  'imageTaskId', 'imageTaskKind', 'videoTaskId', 'videoTaskKind', 'remoteTaskId', 'providerTaskId',
  'mediaTaskReceiptStatus', 'httpStatus', 'isQuotaExceeded', 'providerAcceptedAt', 'providerStatus',
  'workflowSubmissionState', 'workflowSubmissionClaimedAt', 'workflowSubmissionAcceptedAt',
  'manualMediaAttemptHistory', 'manualMediaSupersededNodeIds', 'mediaTaskExecutionOwner', 'sourceWorkflowOutput',
])
const RECEIPT_FIELDS = ['taskId', 'imageTaskId', 'videoTaskId', 'remoteTaskId', 'providerTaskId'] as const
const WORKFLOW_ATTEMPT_IDENTITY_FIELDS = [
  'workflowExecutionId', 'workflowExecutionFamilyId', 'workflowRuntimeNodeId', 'workflowTaskId',
  'workflowEffectId', 'workflowEffectOperation', 'workflowEffectSourceSnapshot', 'workflowObjectId',
  'workflowClipId', 'workflowVideoSubmissionInput', 'workflowNodeRunId', 'workflowMediaRetry', 'workflowOutputAttempts',
  'workflowOutputActiveAttempt', 'workflowMediaAttempts', 'workflowMediaAttemptProjection',
] as const
function isOutputFact(key: string): boolean {
  return OUTPUT_FACT_FIELDS.has(key)
    || (key.startsWith('workflow') && !OUTPUT_AUTHORING_FIELDS.has(key))
}
export function isManualMediaAttemptData(nodeId: string, value: unknown): value is Data {
  return record(value)
    && value.mediaTaskExecutionOwner === 'manual'
    && value.manualMediaAttemptTargetId === nodeId
    && typeof value.manualMediaAttemptId === 'string'
    && value.manualMediaAttemptId.trim().length > 0
}
function isManualMediaExecutionData(value: unknown): value is Data {
  return record(value)
    && value.mediaTaskExecutionOwner === 'manual'
    && (text(value.runToken).length > 0 || record(value.sourceWorkflowOutput))
}
function isTerminalMediaAttemptStatus(value: unknown): boolean {
  return typeof value === 'string' && TERMINAL_MEDIA_ATTEMPT_STATUSES.has(value.trim().toLowerCase())
}
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
function currentReceiptIds(data: Data): Set<string> {
  return new Set(RECEIPT_FIELDS.map(field => text(data[field])).filter(Boolean))
}
function hasMediaResult(data: Data): boolean {
  return ['imageUrl', 'videoUrl'].some(key => /^https?:\/\//i.test(text(data[key])))
    || ['imageResults', 'videoResults'].some(key => Array.isArray(data[key])
      && data[key].some(item => record(item) && /^https?:\/\//i.test(text(item.url))))
}
function hasConfirmedTerminalMediaAttempt(data: unknown): data is Data {
  if (!record(data) || !isTerminalMediaAttemptStatus(data.status)) return false
  const submissionState = text(data.workflowSubmissionState).toLowerCase()
  if (UNRESOLVED_MEDIA_SUBMISSION_STATES.has(submissionState)) return false
  const hasUnresolvedClaim = Boolean(text(data.workflowSubmissionClaimedAt) || text(data.providerAcceptedAt))
  const receiptFailed = text(data.mediaTaskReceiptStatus).toLowerCase() === 'failed'
    || text(data.providerStatus).toLowerCase() === 'failed'
  if (receiptFailed || CONFIRMED_TERMINAL_MEDIA_SUBMISSION_STATES.has(submissionState)) return true
  if (text(data.status).toLowerCase() === 'success' || text(data.status).toLowerCase() === 'succeeded') {
    return hasMediaResult(data)
  }
  // A terminal error tied to a receipt is also stable against same-attempt
  // stale snapshots. A real later asset can still upgrade it, and a fresh
  // manualMediaAttemptId bypasses this same-attempt guard entirely.
  return !hasUnresolvedClaim
}
function currentManualMediaAttemptId(data: Data): string {
  return text(data.manualMediaAttemptId) || text(data.runToken)
}
function normalizeHistory(value: unknown, nodeId?: string): Data[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const history: Data[] = []
  for (const item of value) {
    if (!record(item)) continue
    const attemptId = text(item.attemptId)
    const itemNodeId = text(item.canvasNodeId)
    if (!attemptId || seen.has(attemptId)) continue
    if (nodeId && itemNodeId !== nodeId) continue
    seen.add(attemptId)
    history.push(item)
  }
  return history
}
function uniqueStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.flatMap(value => {
    const normalized = text(value)
    return normalized ? [normalized] : []
  }))]
}
function hasManualMediaAttemptEvidence(data: Readonly<Data>): boolean {
  const status = text(data.status).toLowerCase()
  return Boolean(
    currentManualMediaAttemptId(data)
    || WORKFLOW_ATTEMPT_IDENTITY_FIELDS.some(field => text(data[field]))
    || currentReceiptIds(data).size > 0
    || hasMediaResult(data)
    || (status && status !== 'idle')
    || text(data.lastError) || text(data.errorMessage) || text(data.error) || text(data.errorCode)
    || text(data.workflowSubmissionState) || text(data.mediaTaskReceiptStatus)
    || text(data.providerStatus) || text(data.workflowSubmissionClaimedAt)
    || text(data.providerAcceptedAt)
    || (Array.isArray(data.logs) && data.logs.length > 0)
  )
}
export function buildManualMediaAttemptHistoryEntry(
  nodeId: string,
  data: Readonly<Data>,
  historyIndex: number,
): Data | null {
  if (!hasManualMediaAttemptEvidence(data)) return null
  const receiptIds = uniqueStrings(RECEIPT_FIELDS.map(field => data[field]))
  const existingAttemptId = currentManualMediaAttemptId(data)
  const workflowExecutionId = text(data.workflowExecutionId)
  const workflowEffectId = text(data.workflowEffectId)
  const receiptId = receiptIds[0] ?? ''
  const attemptId = existingAttemptId || receiptId
    || `workflow:${workflowExecutionId}:${workflowEffectId}:${historyIndex}`
  const priorWorkflowIdentity = Object.fromEntries([
    'workflowExecutionId', 'workflowExecutionFamilyId', 'workflowRuntimeNodeId', 'workflowTaskId',
    'workflowEffectId', 'workflowEffectOperation', 'workflowObjectId', 'workflowClipId',
  ].map(field => [field, text(data[field]) || null]))
  const results = Object.fromEntries([
    'imageUrl', 'videoUrl', 'imageResults', 'videoResults', 'imagePrimaryIndex', 'videoPrimaryIndex',
    'thumbnailUrl', 'videoThumbnailUrl', 'posterUrl', 'assetUrl', 'mediaUrl', 'outputUrl',
  ].flatMap(field => Object.prototype.hasOwnProperty.call(data, field) && data[field] !== undefined
    ? [[field, data[field]]] : []))
  const assetUrls = uniqueStrings([
    data.imageUrl, data.videoUrl, data.assetUrl, data.mediaUrl, data.outputUrl,
    ...(Array.isArray(data.imageResults) ? data.imageResults.map(item => record(item) ? item.url : undefined) : []),
    ...(Array.isArray(data.videoResults) ? data.videoResults.map(item => record(item) ? item.url : undefined) : []),
  ])
  const logs = Array.isArray(data.logs) ? data.logs.filter((line): line is string => typeof line === 'string') : []
  return {
    attemptId,
    canvasNodeId: nodeId,
    priorWorkflowIdentity,
    status: text(data.status) || 'idle',
    receiptIds,
    submissionState: text(data.workflowSubmissionState) || null,
    mediaTaskReceiptStatus: text(data.mediaTaskReceiptStatus) || null,
    errorMessage: text(data.lastError) || text(data.errorMessage) || text(data.error) || null,
    assetUrls,
    results,
    ...(Object.prototype.hasOwnProperty.call(data, 'workflowVideoSubmissionInput')
      ? { submissionInput: data.workflowVideoSubmissionInput }
      : {}),
    logs,
  }
}
export function appendManualMediaAttemptHistory(nodeId: string, data: Readonly<Data>): Data[] {
  const history = normalizeHistory(data.manualMediaAttemptHistory, nodeId)
  const entry = buildManualMediaAttemptHistoryEntry(nodeId, data, history.length)
  if (!entry) return history
  if (history.some(item => item.attemptId === entry.attemptId)) return history
  return [...history, entry]
}
function clearPriorWorkflowAttemptIdentity(data: Data): Data {
  const cleared = { ...data }
  for (const field of WORKFLOW_ATTEMPT_IDENTITY_FIELDS) delete cleared[field]
  return cleared
}
function mergeAttemptHistory(
  nodeId: string,
  persisted: Data,
  incoming: Data,
  archivePersistedCurrent: boolean,
): Data[] {
  const merged: Data[] = []
  const indexByAttemptId = new Map<string, number>()
  const add = (entry: Data, authoritative: boolean) => {
    const attemptId = text(entry.attemptId)
    if (!attemptId || text(entry.canvasNodeId) !== nodeId) return
    const existingIndex = indexByAttemptId.get(attemptId)
    if (existingIndex === undefined) {
      indexByAttemptId.set(attemptId, merged.length)
      merged.push(entry)
    } else if (authoritative) {
      merged[existingIndex] = entry
    }
  }
  for (const entry of normalizeHistory(persisted.manualMediaAttemptHistory, nodeId)) add(entry, true)
  if (archivePersistedCurrent) {
    const entry = buildManualMediaAttemptHistoryEntry(nodeId, persisted, merged.length)
    if (entry) add(entry, true)
  }
  // The browser may have completed a prior retry that has not reached the
  // server's full-save path yet. Keep those distinct entries, while entries
  // already persisted by the server above remain authoritative by attemptId.
  for (const entry of normalizeHistory(incoming.manualMediaAttemptHistory, nodeId)) add(entry, false)
  return merged
}
function mergedSupersededNodeIds(persisted: Data, incoming: Data): string[] {
  const persistedSuperseded = Array.isArray(persisted.manualMediaSupersededNodeIds)
    ? persisted.manualMediaSupersededNodeIds : []
  const incomingSuperseded = Array.isArray(incoming.manualMediaSupersededNodeIds)
    ? incoming.manualMediaSupersededNodeIds : []
  return uniqueStrings([...persistedSuperseded, ...incomingSuperseded])
}
function resultEntries(value: unknown): Data[] {
  return Array.isArray(value) ? value.filter(record) : []
}
function mergeSuccessfulMediaAssets(persisted: Data, incoming: Data, merged: Data): void {
  const collections = [
    { key: 'imageResults', primary: 'imageUrl' },
    { key: 'videoResults', primary: 'videoUrl' },
  ] as const
  for (const { key, primary } of collections) {
    const oldEntries = resultEntries(persisted[key])
    const newEntries = resultEntries(incoming[key])
    const oldPrimary = text(persisted[primary])
    const newPrimary = text(incoming[primary])
    const hasEarlierAsset = oldEntries.length > 0 || Boolean(oldPrimary)
    if (!hasEarlierAsset) continue
    const entries: Data[] = []
    const seenUrls = new Set<string>()
    for (const item of [...oldEntries, ...newEntries]) {
      const url = text(item.url)
      if (url && seenUrls.has(url)) continue
      if (url) seenUrls.add(url)
      entries.push(item)
    }
    for (const url of [oldPrimary, newPrimary]) {
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url)
        entries.push({ url })
      }
    }
    if (entries.length) merged[key] = entries
    if (oldPrimary && !newPrimary) merged[primary] = persisted[primary]
  }
  for (const key of ['thumbnailUrl', 'videoThumbnailUrl', 'posterUrl'] as const) {
    if (text(persisted[key]) && !text(incoming[key])) merged[key] = persisted[key]
  }
}
function manualAttemptAuthoringData(persisted: Data, incoming: Data, nodeId: string): Data {
  const authoring = Object.fromEntries(Object.entries(incoming).filter(([key]) =>
    !MANUAL_MEDIA_ATTEMPT_FACT_FIELDS.has(key) && !isOutputFact(key)))
  const facts = Object.fromEntries(Object.entries(persisted).filter(([key]) =>
    MANUAL_MEDIA_ATTEMPT_FACT_FIELDS.has(key) || isOutputFact(key)))
  const result = { ...authoring, ...facts }
  const history = mergeAttemptHistory(nodeId, persisted, incoming, false)
  const superseded = mergedSupersededNodeIds(persisted, incoming)
  if (history.length || Object.prototype.hasOwnProperty.call(persisted, 'manualMediaAttemptHistory')
    || Object.prototype.hasOwnProperty.call(incoming, 'manualMediaAttemptHistory')) {
    result.manualMediaAttemptHistory = history
  } else {
    delete result.manualMediaAttemptHistory
  }
  if (superseded.length || Object.prototype.hasOwnProperty.call(persisted, 'manualMediaSupersededNodeIds')
    || Object.prototype.hasOwnProperty.call(incoming, 'manualMediaSupersededNodeIds')) {
    result.manualMediaSupersededNodeIds = superseded
  } else {
    delete result.manualMediaSupersededNodeIds
  }
  return result
}
export function canvasOutputAuthoringData(value: Data): Data {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isOutputFact(key)))
}
export function mergeCanvasAuthoringData(persisted: unknown, incoming: unknown): Data {
  const facts = record(persisted) ? Object.fromEntries(Object.entries(persisted).filter(([key]) => isOutputFact(key))) : {}
  return { ...(record(incoming) ? canvasOutputAuthoringData(incoming) : {}), ...facts }
}
/**
 * Merge same-node manual media snapshots. A fresh manualMediaAttemptId is the
 * explicit retry identity; runToken remains the runner's cancellation epoch.
 * Existing workflow evidence is archived from the server's persisted snapshot
 * before its old effect identity is removed from the current node.
 */
export function mergeCanvasManualMediaAttemptData(
  persisted: unknown,
  incoming: unknown,
  nodeId: string,
): unknown {
  if (!record(incoming)) return incoming
  const incomingIsManualAttempt = isManualMediaAttemptData(nodeId, incoming)
  const persistedIsManualAttempt = isManualMediaAttemptData(nodeId, persisted)
  if (!record(persisted)) return incoming

  const persistedIsManualExecution = isManualMediaExecutionData(persisted)
  const incomingIsManualExecution = isManualMediaExecutionData(incoming)
  const persistedAttemptId = currentManualMediaAttemptId(persisted)
  const incomingAttemptId = currentManualMediaAttemptId(incoming)
  const persistedHistory = normalizeHistory(persisted.manualMediaAttemptHistory, nodeId)

  if (incomingIsManualAttempt) {
    if (persistedIsManualAttempt && incomingAttemptId === persistedAttemptId) {
      return mergeSameManualAttempt(persisted, incoming, nodeId, true)
    }

    // A snapshot for an attempt already archived by a later retry is stale.
    if (persistedHistory.some(entry => text(entry.attemptId) === incomingAttemptId)) {
      return manualAttemptAuthoringData(persisted, incoming, nodeId)
    }

    const manualMediaAttemptHistory = mergeAttemptHistory(nodeId, persisted, incoming, true)
    return {
      ...clearPriorWorkflowAttemptIdentity(incoming),
      manualMediaAttemptTargetId: nodeId,
      manualMediaAttemptHistory,
      manualMediaSupersededNodeIds: mergedSupersededNodeIds(persisted, incoming),
    }
  }

  if (persistedIsManualAttempt && !incomingIsManualAttempt) {
    return manualAttemptAuthoringData(persisted, incoming, nodeId)
  }

  if (!persistedIsManualExecution && !incomingIsManualExecution) return incoming

  // The stable attempt id is the new contract. Old in-flight manual snapshots
  // still use runToken as their only identity and retain same-run stale guards.
  if (persistedIsManualExecution && incomingIsManualExecution
    && persistedAttemptId && incomingAttemptId === persistedAttemptId) {
    return mergeSameManualAttempt(persisted, incoming, nodeId, false)
  }

  // A changed runToken from a pre-contract manual execution represents the
  // existing runner's new execution. New retries use the explicit marker above.
  if (persistedIsManualExecution && incomingIsManualExecution
    && incomingAttemptId && incomingAttemptId !== persistedAttemptId) return incoming

  if (persistedIsManualExecution) return manualAttemptAuthoringData(persisted, incoming, nodeId)
  return incoming
}

function mergeSameManualAttempt(
  persisted: Data,
  incoming: Data,
  nodeId: string,
  explicitAttempt: boolean,
): Data {
  const merged = explicitAttempt
    ? clearPriorWorkflowAttemptIdentity({ ...persisted, ...incoming })
    : { ...persisted, ...incoming }
  if (explicitAttempt) merged.manualMediaAttemptTargetId = nodeId
  const history = mergeAttemptHistory(nodeId, persisted, incoming, false)
  const superseded = mergedSupersededNodeIds(persisted, incoming)
  if (history.length || Object.prototype.hasOwnProperty.call(persisted, 'manualMediaAttemptHistory')
    || Object.prototype.hasOwnProperty.call(incoming, 'manualMediaAttemptHistory')) merged.manualMediaAttemptHistory = history
  else delete merged.manualMediaAttemptHistory
  if (superseded.length || Object.prototype.hasOwnProperty.call(persisted, 'manualMediaSupersededNodeIds')
    || Object.prototype.hasOwnProperty.call(incoming, 'manualMediaSupersededNodeIds')) merged.manualMediaSupersededNodeIds = superseded
  else delete merged.manualMediaSupersededNodeIds

  // Within one attempt, the first accepted provider receipt is immutable.
  // Restore all receipt keys together so changing field aliases cannot bypass it.
  const persistedReceipts = currentReceiptIds(persisted)
  if (persistedReceipts.size > 0) {
    for (const field of RECEIPT_FIELDS) delete merged[field]
    for (const field of RECEIPT_FIELDS) {
      if (text(persisted[field])) merged[field] = persisted[field]
    }
  }
  const persistedRunToken = text(persisted.runToken)
  const incomingRunToken = text(incoming.runToken)
  if (persistedRunToken && incomingRunToken !== persistedRunToken) merged.runToken = persisted.runToken

  const hasNewReceipt = persistedReceipts.size === 0 && currentReceiptIds(merged).size > 0
  const incomingSuccessWithAsset = ['success', 'succeeded'].includes(text(incoming.status).toLowerCase())
    && hasMediaResult(incoming)
  if (incomingSuccessWithAsset) mergeSuccessfulMediaAssets(persisted, incoming, merged)
  if (hasConfirmedTerminalMediaAttempt(persisted) && !hasNewReceipt && !incomingSuccessWithAsset) {
    return manualAttemptAuthoringData(persisted, merged, nodeId)
  }

  const persistedProgress = typeof persisted.progress === 'number' ? persisted.progress : null
  const incomingProgress = typeof incoming.progress === 'number' ? incoming.progress : null
  if (persistedProgress !== null && (incomingProgress === null || incomingProgress < persistedProgress)) {
    merged.progress = persistedProgress
  }
  const statusOrder: Readonly<Record<string, number>> = {
    idle: 0, queued: 1, submitted: 2, running: 3, waiting_external: 3,
    success: 4, succeeded: 4, error: 4, failed: 4, canceled: 4, cancelled: 4,
  }
  const persistedStatus = text(persisted.status).toLowerCase()
  const incomingStatus = text(incoming.status).toLowerCase()
  const persistedRank = hasConfirmedTerminalMediaAttempt(persisted) ? 4
    : isTerminalMediaAttemptStatus(persistedStatus) ? 2 : (statusOrder[persistedStatus] ?? 0)
  const incomingRank = statusOrder[incomingStatus] ?? 0
  if (!hasNewReceipt && incomingRank < persistedRank) merged.status = persisted.status
  return merged
}
export type CanvasNodeDataMode = 'authoring' | 'manual_attempt_snapshot'
export function mergeCanvasSyncedNodeData(
  persisted: unknown,
  incoming: unknown,
  nodeId: string,
  mode?: CanvasNodeDataMode,
): unknown {
  if (isManualMediaAttemptData(nodeId, persisted) || isManualMediaAttemptData(nodeId, incoming)
    || isManualMediaExecutionData(persisted) || isManualMediaExecutionData(incoming)
    || mode === 'manual_attempt_snapshot') {
    return mergeCanvasManualMediaAttemptData(persisted, incoming, nodeId)
  }
  if (mode === 'authoring') return mergeCanvasAuthoringData(persisted, incoming)
  return incoming
}
export type BrowserCanvasNodePatch = {
  id: string
  data?: unknown
  dataMode?: CanvasNodeDataMode
}
/** Browser callers can submit authoring changes, never server execution facts. */
export function sanitizeBrowserCanvasPatch<T extends { upsertNodes: BrowserCanvasNodePatch[] }>(patch: T): Omit<T, 'upsertNodes'> & { upsertNodes: BrowserCanvasNodePatch[] }
export function sanitizeBrowserCanvasPatch<T extends { upsertNodes?: BrowserCanvasNodePatch[] }>(patch: T): Omit<T, 'upsertNodes'> & { upsertNodes?: BrowserCanvasNodePatch[] }
export function sanitizeBrowserCanvasPatch(patch: { upsertNodes?: BrowserCanvasNodePatch[] }): { upsertNodes?: BrowserCanvasNodePatch[] } {
  if (!patch.upsertNodes) return patch
  return { ...patch, upsertNodes: patch.upsertNodes.map(node => {
    if (isCanvasServerProjectionData(node.data)) {
      const { data: _data, dataMode: _mode, ...layout } = node
      return layout
    }
    if (isManualMediaAttemptData(node.id, node.data)) {
      return { ...node, dataMode: 'manual_attempt_snapshot' as const }
    }
    if (isManualMediaExecutionData(node.data)) {
      return { ...node, dataMode: 'manual_attempt_snapshot' as const }
    }
    if (node.dataMode === 'authoring' || isCanvasExecutionOutputData(node.data)) {
      return { ...node, dataMode: 'authoring' as const, data: record(node.data) ? canvasOutputAuthoringData(node.data) : {} }
    }
    return node
  }) }
}
