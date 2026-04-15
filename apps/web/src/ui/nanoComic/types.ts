export type NanoComicWorkspaceTab = 'overview' | 'storyboard' | 'review'

export type NanoComicTone = 'sky' | 'amber' | 'rose' | 'mint' | 'slate'

export type NanoComicMetricCard = {
  id: string
  title: string
  value: string
  detail: string
  tone: NanoComicTone
}

export type NanoComicEpisodeItem = {
  id: string
  chapterNo: number
  code: string
  title: string
  stage: string
  storyboardProgress: number
  videoProgress: number
  reviewCount: number
  ownerName: string
  runtimeStatus?: 'running' | 'success' | 'error'
  runtimeText?: string
  runtimeUpdatedAtLabel?: string
  isCurrentChapter?: boolean
}

export type NanoComicRiskItem = {
  id: string
  title: string
  level: 'warning' | 'blocked' | 'stale'
  detail: string
  impact: string
}

export type NanoComicActivityItem = {
  id: string
  actorName: string
  action: string
  target: string
  timeLabel: string
}

export type NanoComicConversationArtifactItem = {
  id: string
  sessionKey: string
  sessionLabel: string
  promptPreview: string
  responsePreview: string
  assetCountLabel: string
  updatedAtLabel: string
  previewImageUrl?: string
}

export type NanoComicShotItem = {
  id: string
  chapterNo: number
  shotNo: number
  sceneCode: string
  shotCode: string
  title: string
  script: string
  productionStatus: string
  reviewStatus: string
  riskLabel: string
  continuityHint: string
  prevShotCode: string
  nextShotCode: string
  castNames: string[]
  locationName: string
  propNames: string[]
  note: string
  commentPreview: string
  previewImageUrl: string
  promptJson: string
  referenceImageUrls: string[]
  anchorImageUrls: string[]
  videoReady?: boolean
  videoBlockReason?: string
  isActionRequired: boolean
  isHighRisk: boolean
  chapterRunStatus?: 'running' | 'success' | 'error'
  chapterRunText?: string
}

export type NanoComicStoryboardChunkItem = {
  id: string
  chunkIndex: number
  groupSize: 1 | 4 | 9 | 25
  shotStart: number
  shotEnd: number
  frameCount: number
  previewImageUrl: string
  tailFrameUrl: string
  updatedAtLabel: string
}

export type NanoComicStoryboardProductionItem = {
  chapterNo: number
  groupSize: 1 | 4 | 9 | 25
  totalShots: number
  totalChunks: number
  generatedChunks: number
  generatedShots: number
  nextChunkIndex: number
  nextShotStart: number
  nextShotEnd: number
  isComplete: boolean
  latestTailFrameUrl: string
}

export type NanoComicReviewItem = {
  id: string
  entityType: 'shot' | 'asset' | 'video_segment'
  title: string
  summary: string
  riskLevel: 'pending' | 'blocked' | 'warning'
  projectLabel: string
  episodeLabel: string
  assigneeName: string
  reviewerName: string
  updatedAtLabel: string
  impactLabel: string
  canvasKind: 'image' | 'text' | 'video'
  previewImageUrl?: string
  isConfirmed?: boolean
  isActionRequired: boolean
  isHighRisk: boolean
}

export type NanoComicCanvasInsertPayload = {
  entityKey: string
  entityType: 'shot' | 'asset' | 'video_segment'
  entityId: string
  label: string
  kind: 'image' | 'imageEdit' | 'text' | 'video'
  summary: string
  imageUrl?: string
  videoUrl?: string
  statusLabel: string
}

export function getNanoComicEntityKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`
}
