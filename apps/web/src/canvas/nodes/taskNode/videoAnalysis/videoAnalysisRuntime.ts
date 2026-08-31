import type { ModelOption } from '../../../../config/models'
import { selectNodesById, useRFStore } from '../../../store'

export const VIDEO_ANALYSIS_CAPABILITY_TAG = 'tapcanvas:capability=video-analysis'
export const VIDEO_ANALYSIS_DEFAULT_TAG = 'tapcanvas:default-for=video-analysis'

const activeVideoAnalysisNodeIds = new Set<string>()

export const markVideoAnalysisActive = (nodeId: string): void => {
  if (activeVideoAnalysisNodeIds.has(nodeId)) throw new Error('该视频分析节点已有一个真实请求正在执行。')
  activeVideoAnalysisNodeIds.add(nodeId)
}

export const markVideoAnalysisSettled = (nodeId: string): void => {
  activeVideoAnalysisNodeIds.delete(nodeId)
}

export const isVideoAnalysisActive = (nodeId: string): boolean => activeVideoAnalysisNodeIds.has(nodeId)

export const videoAnalysisRunButtonLabel = (status: string): string => {
  if (status === 'running') return '视频观察校验中'
  if (status === 'error') return '重新提取视频观察表'
  return '提取视频观察表'
}

export type VideoAnalysisAutoStartFacts = {
  requested: boolean
  readOnly: boolean
  running: boolean
  modelLoading: boolean
  blockingError: string
  hasSelectedModel: boolean
  hasQuotedCredits: boolean
  hasSourceNode: boolean
  hasFps: boolean
}

export const shouldAutoStartVideoAnalysis = (facts: VideoAnalysisAutoStartFacts): boolean =>
  facts.requested
  && !facts.readOnly
  && !facts.running
  && !facts.modelLoading
  && !facts.blockingError
  && facts.hasSelectedModel
  && facts.hasQuotedCredits
  && facts.hasSourceNode
  && facts.hasFps

export const createVideoAnalysisDeliveryId = (): string => {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('当前浏览器不支持安全 UUID，无法创建视频分析交付标识。')
  }
  return `video-analysis-delivery-${crypto.randomUUID()}`
}

export const readVideoAnalysisText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const readTags = (option: ModelOption): string[] => {
  const meta = option.meta
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return []
  const tags = (meta as Record<string, unknown>).tags
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : []
}

export const videoAnalysisModelHasTag = (option: ModelOption, expected: string): boolean =>
  readTags(option).some((tag) => tag.trim().toLowerCase() === expected)

export const readVideoAnalysisModelDescription = (option: ModelOption | null): string => {
  const meta = option?.meta
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return ''
  return readVideoAnalysisText((meta as Record<string, unknown>).description)
}

export const readVideoUrl = (nodeData: unknown): string => {
  if (!nodeData || typeof nodeData !== 'object' || Array.isArray(nodeData)) return ''
  const record = nodeData as Record<string, unknown>
  const results = Array.isArray(record.videoResults) ? record.videoResults : []
  const rawIndex = typeof record.videoPrimaryIndex === 'number' ? record.videoPrimaryIndex : 0
  const index = Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : 0
  const primary = results[index]
  if (primary && typeof primary === 'object' && !Array.isArray(primary)) {
    const url = readVideoAnalysisText((primary as Record<string, unknown>).url)
    if (url) return url
  }
  return readVideoAnalysisText(record.videoUrl)
}

const requireRemoteVideoUrl = (value: string): string => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('已连接视频没有可供服务端读取的有效 URL。')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('视频分析要求真实的 http/https 资产 URL；本地 blob 或临时路径不可执行。')
  }
  return parsed.toString()
}

export const resolveConnectedVideo = (nodeId: string): { sourceNodeId: string; videoUrl: string } => {
  const state = useRFStore.getState()
  const inputEdges = state.edges.filter((candidate) => candidate.target === nodeId && candidate.targetHandle === 'in-video')
  if (inputEdges.length === 0) throw new Error('请先把一个已生成或已上传的视频节点连接到“视频分析”的视频输入。')
  if (inputEdges.length > 1) throw new Error('视频分析只允许一个视频输入；请移除多余连线后重试。')
  const edge = inputEdges[0]
  if (!edge) throw new Error('视频分析输入连线状态无效。')
  const source = selectNodesById(state).get(edge.source)
  if (!source) throw new Error(`视频输入连线指向不存在的节点：${edge.source}`)
  return { sourceNodeId: source.id, videoUrl: requireRemoteVideoUrl(readVideoUrl(source.data)) }
}

export const findDeliveredShotTableNodeId = (deliveryId: string): string | null => {
  const node = useRFStore.getState().nodes.find((candidate) => {
    const data = candidate.data
    return data && typeof data === 'object' && !Array.isArray(data)
      && (data as Record<string, unknown>).videoAnalysisDeliveryId === deliveryId
  })
  return node?.id ?? null
}

export const createVideoAnalysisOutputTitle = (): string => {
  const now = new Date()
  return `分镜表 · ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

export const videoAnalysisErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim() ? error.message.trim() : '视频分析失败。'

export const videoAnalysisErrorDetails = (error: unknown): unknown =>
  error && typeof error === 'object' && !Array.isArray(error) && 'details' in error
    ? error.details
    : undefined
