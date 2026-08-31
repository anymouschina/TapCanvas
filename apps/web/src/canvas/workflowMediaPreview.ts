export type WorkflowMediaKind = 'image' | 'video'
export type WorkflowMediaDisplayMode = 'icon' | 'result'

export type WorkflowMediaAsset = Readonly<{
  kind: WorkflowMediaKind
  url: string
  thumbnailUrl: string | null
}>

export type WorkflowMediaPreview = Readonly<{
  kind: WorkflowMediaKind | null
  displayMode: WorkflowMediaDisplayMode
  assets: readonly WorkflowMediaAsset[]
  primaryAsset: WorkflowMediaAsset | null
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function remoteUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

export function workflowMediaKind(data: Record<string, unknown>): WorkflowMediaKind | null {
  if (!isRecord(data.workflowAtomicSpec)) return null
  if (data.workflowAtomicSpec.operation === 'image_generate') return 'image'
  if (data.workflowAtomicSpec.operation === 'video_generate') return 'video'
  return null
}

export function workflowMediaDisplayMode(data: Record<string, unknown>): WorkflowMediaDisplayMode {
  return data.workflowCanvasDisplayMode === 'result' ? 'result' : 'icon'
}

function collectArtifacts(
  value: unknown,
  kind: WorkflowMediaKind,
  push: (asset: WorkflowMediaAsset) => void,
): void {
  if (!Array.isArray(value)) return
  const expectedType = kind === 'image' ? 'tapcanvas.image/v1' : 'tapcanvas.video/v1'
  for (const artifact of value) {
    if (!isRecord(artifact) || artifact.type !== expectedType) continue
    const url = remoteUrl(artifact.value)
    if (!url) continue
    push({ kind, url, thumbnailUrl: null })
  }
}

function collectTypedMediaValues(
  value: unknown,
  kind: WorkflowMediaKind,
  push: (asset: WorkflowMediaAsset) => void,
  depth = 0,
): void {
  if (depth > 8) return
  if (Array.isArray(value)) {
    value.forEach((item) => collectTypedMediaValues(item, kind, push, depth + 1))
    return
  }
  if (!isRecord(value)) return
  const mediaUrl = remoteUrl(kind === 'image' ? value.imageUrl : value.videoUrl)
  if (mediaUrl) {
    push({
      kind,
      url: mediaUrl,
      thumbnailUrl: kind === 'video' ? remoteUrl(value.thumbnailUrl) : null,
    })
  }
  for (const nestedValue of Object.values(value)) {
    collectTypedMediaValues(nestedValue, kind, push, depth + 1)
  }
}

function collectItemRuns(
  value: unknown,
  kind: WorkflowMediaKind,
  push: (asset: WorkflowMediaAsset) => void,
): void {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (!isRecord(item)) continue
    collectArtifacts(item.artifacts, kind, push)
    const evidence = isRecord(item.evidence) ? item.evidence : {}
    const evidenceUrl = remoteUrl(kind === 'image' ? evidence.imageUrl : evidence.videoUrl)
    if (!evidenceUrl) continue
    push({
      kind,
      url: evidenceUrl,
      thumbnailUrl: kind === 'video' ? remoteUrl(evidence.thumbnailUrl) : null,
    })
  }
}

export function resolveWorkflowMediaPreview(data: Record<string, unknown>): WorkflowMediaPreview {
  const kind = workflowMediaKind(data)
  const displayMode = workflowMediaDisplayMode(data)
  if (!kind) return { kind: null, displayMode, assets: [], primaryAsset: null }

  const assets: WorkflowMediaAsset[] = []
  const indexByUrl = new Map<string, number>()
  const push = (asset: WorkflowMediaAsset): void => {
    const existingIndex = indexByUrl.get(asset.url)
    if (existingIndex === undefined) {
      indexByUrl.set(asset.url, assets.length)
      assets.push(asset)
      return
    }
    const existing = assets[existingIndex]
    if (existing && !existing.thumbnailUrl && asset.thumbnailUrl) assets[existingIndex] = asset
  }

  collectArtifacts(data.workflowOutputArtifacts, kind, push)
  collectItemRuns(data.workflowItemRuns, kind, push)
  collectTypedMediaValues(data.workflowLocalTestOutput, kind, push)
  collectTypedMediaValues(data.workflowExecutionEvidence, kind, push)

  return {
    kind,
    displayMode,
    assets,
    primaryAsset: assets[assets.length - 1] ?? null,
  }
}
