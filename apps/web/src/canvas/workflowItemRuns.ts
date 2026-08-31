export type WorkflowItemRunView = Readonly<{
  itemId: string
  index: number
  status: 'queued' | 'running' | 'success' | 'waiting_external' | 'failed'
  runtimeNodeId: string
  errorMessage: string | null
  failureReason: string | null
  recoveryReasonCode: string | null
  recoveryWindowsWithoutProgress: number | null
  recoveryWindowLimit: number | null
  artifactCount: number
  videoUrl: string | null
  textOutput: string | null
  canvasNodeId: string | null
  output: Record<string, unknown>
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

function videoUrlFromArtifacts(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  for (const artifact of value) {
    if (!isRecord(artifact) || artifact.type !== 'tapcanvas.video/v1') continue
    const url = remoteUrl(artifact.value)
    if (url) return url
  }
  return null
}

function textFromPorts(ports: Record<string, unknown>): string | null {
  for (const value of Object.values(ports)) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (isRecord(value) && typeof value.text === 'string' && value.text.trim()) return value.text.trim()
  }
  return null
}

function textFromArtifacts(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  for (const artifact of value) {
    if (!isRecord(artifact) || typeof artifact.value !== 'string' || !artifact.value.trim()) continue
    if (artifact.type === 'tapcanvas.video/v1') continue
    return artifact.value.trim()
  }
  return null
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function readAgentFailureFacts(ports: Record<string, unknown>): Readonly<{
  failureReason: string | null
  recoveryReasonCode: string | null
  recoveryWindowsWithoutProgress: number | null
  recoveryWindowLimit: number | null
}> {
  const result = isRecord(ports.result) ? ports.result : {}
  const terminal = isRecord(result.requestTerminal) ? result.requestTerminal : {}
  const deliveryEvidence = isRecord(result.deliveryEvidence) ? result.deliveryEvidence : {}
  const recoveryCheckpoint = isRecord(deliveryEvidence.recoveryCheckpoint) ? deliveryEvidence.recoveryCheckpoint : {}
  const recoveryWindow = isRecord(deliveryEvidence.recoveryWindow) ? deliveryEvidence.recoveryWindow : {}
  return {
    failureReason: readTrimmedString(terminal.reason),
    recoveryReasonCode: readTrimmedString(recoveryCheckpoint.reasonCode),
    recoveryWindowsWithoutProgress: readNonNegativeInteger(recoveryWindow.windowsWithoutProgress),
    recoveryWindowLimit: readNonNegativeInteger(recoveryWindow.limit),
  }
}

export function workflowItemRunErrorSummary(item: WorkflowItemRunView): string | null {
  return item.errorMessage
}

export function readWorkflowItemRuns(value: unknown): readonly WorkflowItemRunView[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const itemId = typeof item.itemId === 'string' ? item.itemId.trim() : ''
    const runtimeNodeId = typeof item.runtimeNodeId === 'string' ? item.runtimeNodeId.trim() : ''
    const index = typeof item.index === 'number' && Number.isInteger(item.index) && item.index >= 0
      ? item.index
      : null
    const status: WorkflowItemRunView['status'] | null = item.status === 'queued'
      || item.status === 'running'
      || item.status === 'success'
      || item.status === 'waiting_external'
      || item.status === 'failed'
      ? item.status
      : null
    if (!itemId || !runtimeNodeId || index === null || !status) return []
    const artifacts = Array.isArray(item.artifacts) ? item.artifacts : []
    const ports = isRecord(item.ports) ? item.ports : {}
    const evidence = isRecord(item.evidence) ? item.evidence : {}
    const failureFacts = readAgentFailureFacts(ports)
    return [{
      itemId,
      index,
      status,
      runtimeNodeId,
      errorMessage: typeof item.errorMessage === 'string' && item.errorMessage.trim() ? item.errorMessage.trim() : null,
      ...failureFacts,
      artifactCount: artifacts.length,
      videoUrl: videoUrlFromArtifacts(artifacts),
      textOutput: textFromPorts(ports) ?? textFromArtifacts(artifacts),
      canvasNodeId: typeof evidence.canvasNodeId === 'string' && evidence.canvasNodeId.trim() ? evidence.canvasNodeId.trim() : null,
      output: ports,
    }]
  }).sort((left, right) => left.index - right.index)
}
