import type {
  VideoAuthoringState,
  VideoRunState,
  VideoRunStatusEvent,
} from '@tapcanvas/video-orchestrator-protocol'

export type VideoClipContinuityMode = 'editorial_cut' | 'bridge_frames' | 'reference_video'

export type VideoClipDisplayState =
  | 'idle'
  | 'planned'
  | 'scheduled'
  | 'queued'
  | 'running'
  | 'success'
  | 'error'
  | 'canceled'
  | 'concatenating'
  | 'unknown'

export type VideoClipAssetContractFacts = {
  kind: string
  name: string
  referenceRole: string | null
  referenceImageNodeIds: string[]
  forbiddenTransfer: string | null
  identityInvariant: string | null
  startState: string | null
  spatialRelation: string | null
  scale: string | null
  driver: string | null
  stateChange: string | null
  endState: string | null
}

export type VideoClipReferenceBindingFacts = {
  nodeId: string | null
  name: string | null
  referenceRole: string | null
  source: string | null
}

export type VideoClipCanvasFacts = {
  nodeId: string
  label: string | null
  isOrchestrated: boolean
  runId: string | null
  clipIndex: number | null
  status: VideoClipDisplayState
  statusLabel: string
  statusTone: 'neutral' | 'info' | 'warning' | 'success' | 'error'
  durationSeconds: number | null
  videoModel: string | null
  generationContract: Record<string, unknown> | null
  sceneName: string | null
  characterRoleNames: string[]
  characterStates: unknown
  propNames: string[]
  vfxNames: string[]
  continuityMode: VideoClipContinuityMode | null
  expectedPrevClipIndex: number | null
  timeJumpNote: string | null
  exitState: string | null
  storyboardImageNodeId: string | null
  lastFrameImageNodeId: string | null
  firstFrameUrl: string | null
  lastFrameUrl: string | null
  videoReferenceNodeIds: string[]
  referenceImageBindings: VideoClipReferenceBindingFacts[]
  assetObjectContracts: VideoClipAssetContractFacts[]
  referenceDeliveryContract: Record<string, unknown> | null
  assetBinding: Record<string, unknown> | null
  assetBindingDiagnostics: string[]
  prompt: string | null
  promptRevision: string | null
  taskId: string | null
  videoTaskId: string | null
  videoUrl: string | null
  concatVideoUrl: string | null
  lastError: string | null
  authoringState: VideoAuthoringState | null
  productionState: VideoRunState | null
  updatedAt: string | null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function readNonNegativeInteger(value: unknown): number | null {
  const number = readNumber(value)
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function readObject(value: unknown): Record<string, unknown> | null {
  return readRecord(value)
}

function readContinuityMode(value: unknown): VideoClipContinuityMode | null {
  return value === 'editorial_cut' || value === 'bridge_frames' || value === 'reference_video'
    ? value
    : null
}

function readAssetObjectContracts(value: unknown): VideoClipAssetContractFacts[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = readRecord(item)
    if (!record) return []
    const kind = readString(record.kind)
    const name = readString(record.name)
    if (!kind || !name) return []
    return [{
      kind,
      name,
      referenceRole: readString(record.referenceRole),
      referenceImageNodeIds: readStringArray(record.referenceImageNodeIds),
      forbiddenTransfer: readString(record.forbiddenTransfer),
      identityInvariant: readString(record.identityInvariant),
      startState: readString(record.startState),
      spatialRelation: readString(record.spatialRelation),
      scale: readString(record.scale),
      driver: readString(record.driver),
      stateChange: readString(record.stateChange),
      endState: readString(record.endState),
    }]
  })
}

function readReferenceBindings(value: unknown): VideoClipReferenceBindingFacts[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = readRecord(item)
    if (!record) return []
    return [{
      nodeId: readString(record.nodeId) || readString(record.sourceNodeId),
      name: readString(record.name) || readString(record.assetName),
      referenceRole: readString(record.referenceRole) || readString(record.role),
      source: readString(record.source),
    }]
  })
}

function readDiagnostics(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string') return item.trim() ? [item.trim()] : []
    const record = readRecord(item)
    if (!record) return []
    const message = readString(record.message) || readString(record.reason) || readString(record.code)
    return message ? [message] : []
  })
}

function readNodeStatus(value: unknown): VideoClipDisplayState {
  switch (value) {
    case 'planned':
    case 'scheduled':
    case 'queued':
    case 'running':
    case 'success':
    case 'error':
    case 'canceled':
    case 'concatenating':
      return value
    case 'idle':
      return 'idle'
    default:
      return 'unknown'
  }
}

function readRunStatus(value: VideoRunState): VideoClipDisplayState {
  switch (value) {
    case 'planned': return 'planned'
    case 'scheduled': return 'scheduled'
    case 'video_running': return 'running'
    case 'video_success': return 'success'
    case 'concatenating': return 'concatenating'
    case 'concatenated': return 'success'
    case 'failed': return 'error'
    case 'cancelled': return 'canceled'
    case 'collecting': return 'planned'
    default: return 'unknown'
  }
}

export function getVideoClipStatusLabel(status: VideoClipDisplayState): string {
  switch (status) {
    case 'planned': return '已规划'
    case 'scheduled': return '已排程'
    case 'queued': return '排队中'
    case 'running': return '生成中'
    case 'success': return '片段完成'
    case 'error': return '生成失败'
    case 'canceled': return '已取消'
    case 'concatenating': return '合成中'
    case 'idle': return '待执行'
    default: return '状态未知'
  }
}

export function getVideoClipStatusTone(status: VideoClipDisplayState): VideoClipCanvasFacts['statusTone'] {
  switch (status) {
    case 'success': return 'success'
    case 'error':
    case 'canceled': return 'error'
    case 'running':
    case 'queued': return 'info'
    case 'planned':
    case 'scheduled':
    case 'concatenating': return 'warning'
    default: return 'neutral'
  }
}

function resolveStatus(
  data: Record<string, unknown>,
  run: VideoRunStatusEvent | null,
): VideoClipDisplayState {
  const nodeStatus = readNodeStatus(data.status)
  if (nodeStatus !== 'unknown' && nodeStatus !== 'idle') return nodeStatus
  return run ? readRunStatus(run.state) : nodeStatus
}

function resolveRun(
  data: Record<string, unknown>,
  run: VideoRunStatusEvent | null,
): VideoRunStatusEvent | null {
  const runId = readString(data.clipRunId) || readString(data.runId)
  return run && runId && run.runId === runId ? run : null
}

export function resolveVideoClipCanvasFacts(
  nodeId: string,
  value: unknown,
  run: VideoRunStatusEvent | null = null,
): VideoClipCanvasFacts {
  const data = readRecord(value) ?? {}
  const matchedRun = resolveRun(data, run)
  const status = resolveStatus(data, matchedRun)
  const clipRunId = readString(data.clipRunId) || readString(data.runId)
  return {
    nodeId,
    label: readString(data.label),
    isOrchestrated: Boolean(clipRunId),
    runId: clipRunId,
    clipIndex: readNonNegativeInteger(data.clipIndex),
    status,
    statusLabel: getVideoClipStatusLabel(status),
    statusTone: getVideoClipStatusTone(status),
    durationSeconds: readNumber(data.durationSeconds),
    videoModel: readString(data.videoModel),
    generationContract: readObject(data.generationContract),
    sceneName: readString(data.sceneName),
    characterRoleNames: readStringArray(data.characterRoleNames),
    characterStates: data.characterStates ?? null,
    propNames: readStringArray(data.propNames),
    vfxNames: readStringArray(data.vfxNames),
    continuityMode: readContinuityMode(data.continuityMode),
    expectedPrevClipIndex: readNonNegativeInteger(data.expectedPrevClipIndex),
    timeJumpNote: readString(data.timeJumpNote),
    exitState: readString(data.exitState),
    storyboardImageNodeId: readString(data.storyboardImageNodeId),
    lastFrameImageNodeId: readString(data.lastFrameImageNodeId),
    firstFrameUrl: readString(data.firstFrameUrl),
    lastFrameUrl: readString(data.lastFrameUrl),
    videoReferenceNodeIds: readStringArray(data.videoReferenceNodeIds),
    referenceImageBindings: readReferenceBindings(data.referenceImageBindings),
    assetObjectContracts: readAssetObjectContracts(data.assetObjectContracts),
    referenceDeliveryContract: readObject(data.referenceDeliveryContract),
    assetBinding: readObject(data.assetBinding),
    assetBindingDiagnostics: readDiagnostics(data.assetBindingDiagnostics),
    prompt: readString(data.prompt),
    promptRevision: readString(data.promptRevision) || readString(data.promptHash),
    taskId: readString(data.taskId),
    videoTaskId: readString(data.videoTaskId),
    videoUrl: readString(data.videoUrl),
    concatVideoUrl: readString(data.concatVideoUrl),
    lastError: readString(data.lastError) || matchedRun?.errorMessage || null,
    authoringState: matchedRun?.authoringState ?? null,
    productionState: matchedRun?.state ?? null,
    updatedAt: matchedRun?.updatedAt || readString(data.updatedAt),
  }
}

export function readVideoClipRunId(value: unknown): string | null {
  const data = readRecord(value)
  return data ? readString(data.clipRunId) || readString(data.runId) : null
}

export function readVideoClipIndex(value: unknown): number | null {
  const data = readRecord(value)
  return data ? readNonNegativeInteger(data.clipIndex) : null
}

export function formatVideoClipFact(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value.map((item) => formatVideoClipFact(item)).filter(Boolean).join('、')
  }
  const record = readRecord(value)
  if (record) {
    try {
      return JSON.stringify(record)
    } catch {
      return ''
    }
  }
  return ''
}
