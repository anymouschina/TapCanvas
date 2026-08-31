import { normalizeShotTable } from '@tapcanvas/shot-table-protocol'

export type VideoAnalysisHistoryResult = {
  entries: Record<string, unknown>[]
  error: string
}

const RUN_DELIVERIES = new Set([
  'analysis_failed',
  'created_and_connected',
  'created_connection_failed',
  'created_postprocess_failed',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const readText = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

const isIsoDate = (value: unknown): boolean => {
  const text = readText(value)
  return Boolean(text) && Number.isFinite(Date.parse(text))
}

const isHttpUrl = (value: unknown): boolean => {
  const text = readText(value)
  if (!text) return false
  try {
    const parsed = new URL(text)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const isFps = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0.2 && value <= 5

export const readVideoAnalysisRuns = (value: unknown): VideoAnalysisHistoryResult => {
  if (value === undefined) return { entries: [], error: '' }
  if (!Array.isArray(value)) return { entries: [], error: 'videoAnalysisRuns 必须是数组。' }
  const entries: Record<string, unknown>[] = []
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index]
    if (!isRecord(entry)) return { entries: [], error: `videoAnalysisRuns 第 ${index + 1} 项不是对象。` }
    const delivery = readText(entry.delivery)
    if (!RUN_DELIVERIES.has(delivery)) {
      return { entries: [], error: `videoAnalysisRuns 第 ${index + 1} 项的 delivery 无效。` }
    }
    if (!isIsoDate(entry.startedAt) || !isIsoDate(entry.completedAt)) {
      return { entries: [], error: `videoAnalysisRuns 第 ${index + 1} 项缺少有效 startedAt 或 completedAt。` }
    }
    if (!readText(entry.model) || !isFps(entry.fps) || !readText(entry.sourceVideoNodeId) || !isHttpUrl(entry.sourceVideoUrl)) {
      return { entries: [], error: `videoAnalysisRuns 第 ${index + 1} 项缺少合法模型、帧率或视频来源。` }
    }
    const createdOutput = delivery !== 'analysis_failed'
    if (createdOutput && (!readText(entry.outputNodeId) || !readText(entry.deliveryId))) {
      return { entries: [], error: `videoAnalysisRuns 第 ${index + 1} 项缺少 outputNodeId 或 deliveryId。` }
    }
    if (!createdOutput && entry.outputNodeId !== null) {
      return { entries: [], error: `videoAnalysisRuns 第 ${index + 1} 项的失败记录必须明确使用空 outputNodeId。` }
    }
    const hasRawOutput = entry.rawOutput !== undefined || entry.responseReceivedAt !== undefined
    if (hasRawOutput && (!readText(entry.rawOutput) || !isIsoDate(entry.responseReceivedAt))) {
      return { entries: [], error: `videoAnalysisRuns 第 ${index + 1} 项的原始模型输出诊断不完整。` }
    }
    if (delivery !== 'created_and_connected' && !readText(entry.error)) {
      return { entries: [], error: `videoAnalysisRuns 第 ${index + 1} 项缺少失败原因。` }
    }
    entries.push(entry)
  }
  return { entries, error: '' }
}

export const readVideoAnalysisUndeliveredResults = (value: unknown): VideoAnalysisHistoryResult => {
  if (value === undefined) return { entries: [], error: '' }
  if (!Array.isArray(value)) return { entries: [], error: 'videoAnalysisUndeliveredResults 必须是数组。' }
  const entries: Record<string, unknown>[] = []
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index]
    if (!isRecord(entry)) {
      return { entries: [], error: `videoAnalysisUndeliveredResults 第 ${index + 1} 项不是对象。` }
    }
    const table = normalizeShotTable(entry.table)
    if (!table.ok) {
      return {
        entries: [],
        error: `videoAnalysisUndeliveredResults 第 ${index + 1} 项的分镜表无效：${table.issues.join('；')}`,
      }
    }
    if (
      !readText(entry.rawText)
      || !readText(entry.model)
      || !isIsoDate(entry.startedAt)
      || !isIsoDate(entry.completedAt)
      || !isFps(entry.fps)
      || !readText(entry.sourceVideoNodeId)
      || !isHttpUrl(entry.sourceVideoUrl)
      || !readText(entry.deliveryError)
    ) {
      return { entries: [], error: `videoAnalysisUndeliveredResults 第 ${index + 1} 项缺少可追溯的分析或交付事实。` }
    }
    if (entry.deliveryId !== null && !readText(entry.deliveryId)) {
      return { entries: [], error: `videoAnalysisUndeliveredResults 第 ${index + 1} 项的 deliveryId 无效。` }
    }
    entries.push(entry)
  }
  return { entries, error: '' }
}
