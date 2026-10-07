import { isCanvasExecutionOutputData } from './canvas-output-ownership'

type Data = Readonly<Record<string, unknown>>

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function record(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function httpUrl(value: unknown): boolean {
  const raw = text(value)
  if (!raw) return false
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The direct recovery field belongs to this execution output's current receipt,
 * written under the same task-identity CAS. Historical/aggregate evidence cannot
 * change a newer attempt. A manual attempt has a separate ownership contract.
 */
export function canvasVideoReceiptIsWaiting(data: Data): boolean {
  const status = text(data.status)
  if (data.kind !== 'video' || data.mediaTaskExecutionOwner === 'manual'
    || !isCanvasExecutionOutputData(data)) return false
  const taskId = text(data.taskId)
  const videoTaskId = text(data.videoTaskId)
  if ((!taskId && !videoTaskId) || (taskId && videoTaskId && taskId !== videoTaskId)) return false
  const recovery = data.videoReceiptRecovery
  if (!record(recovery) || (recovery.disposition !== 'pending' && recovery.disposition !== 'awaiting_late_result')) return false
  // A delivered current result remains success even while historical receipts wait.
  if ((status === 'success' || status === 'succeeded') && (httpUrl(data.videoUrl)
    || (Array.isArray(data.videoResults) && data.videoResults.some(item => record(item) && httpUrl(item.url))))) return false
  return true
}

export function canvasVideoEffectiveStatus(data: Data): string {
  return canvasVideoReceiptIsWaiting(data) ? 'running' : text(data.status)
}
