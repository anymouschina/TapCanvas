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
])
function isOutputFact(key: string): boolean {
  return OUTPUT_FACT_FIELDS.has(key) || key.startsWith('workflow')
}
export function canvasOutputAuthoringData(value: Data): Data {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isOutputFact(key)))
}
export function mergeCanvasAuthoringData(persisted: unknown, incoming: unknown): Data {
  const facts = record(persisted) ? Object.fromEntries(Object.entries(persisted).filter(([key]) => isOutputFact(key))) : {}
  return { ...(record(incoming) ? canvasOutputAuthoringData(incoming) : {}), ...facts }
}
export type BrowserCanvasNodePatch = {
  id: string
  data?: unknown
  dataMode?: 'authoring'
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
    if (node.dataMode === 'authoring' || isCanvasExecutionOutputData(node.data)) {
      return { ...node, dataMode: 'authoring' as const, data: record(node.data) ? canvasOutputAuthoringData(node.data) : {} }
    }
    return node
  }) }
}
