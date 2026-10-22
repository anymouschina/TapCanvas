import type { Edge, Node } from '@xyflow/react'
import { normalizeTaskNodeKind } from '../nodes/taskNodeSchema'
import type { CreationStage, ProductionLayer } from '../productionMeta'
import { projectWorkflowMediaAttempts } from '../workflowMediaAttemptProjection'

export type WorkbenchCategory = 'script' | 'character' | 'scene' | 'prop' | 'storyboard' | 'video' | 'final' | 'audio' | 'other'

export const WORKBENCH_CATEGORIES: readonly Readonly<{
  id: WorkbenchCategory
  label: string
  description: string
}>[] = [
  { id: 'script', label: '剧本', description: '正文、剧本与文字内容' },
  { id: 'character', label: '角色', description: '角色身份、造型与群演资产' },
  { id: 'scene', label: '场景', description: '空间参考与场景状态资产' },
  { id: 'prop', label: '道具', description: '物件参考与道具状态资产' },
  { id: 'storyboard', label: '分镜', description: '每段的镜头拆解与站位' },
  { id: 'video', label: '视频', description: '视频片段与生成结果' },
  { id: 'final', label: '成片', description: '剪辑合成与成片结果' },
  { id: 'audio', label: '音频', description: '配音、音乐与音效' },
  { id: 'other', label: '其他', description: '其他画布内容与任务' },
]

export type WorkbenchItem = {
  id: string
  label: string
  category: WorkbenchCategory
  kind: string
  status: string
  busy: boolean
  imageUrl: string | null
  videoUrl: string | null
  audioUrl: string | null
  text: string
  error: string | null
  hasResult: boolean
  canGenerate: boolean
  upstreamIds: string[]
  /** Workflow clip this node belongs to; a staging diagram may cover several consecutive clips. */
  clipIds: string[]
  clipIndex: number | null
  /** The clip script as persisted on the workflow video node, without rewriting its text. */
  shotScript: string
  durationSeconds: number | null
  /** Scene references bound to a workflow clip, in binding order (first is the clip's main scene). */
  sceneRefs: SceneRef[]
}

export type SceneRef = Readonly<{ nodeId: string; name: string }>

const BUSY_STATUSES = new Set(['queued', 'running', 'pending', 'submitting', 'submitted', 'processing', 'waiting_external'])
const STORYBOARD_IMAGE_KINDS = new Set(['storyboardImage', 'novelStoryboard', 'storyboardShot'])
const STORYBOARD_LAYERS: ReadonlySet<string> = new Set([
  'blocking_diagram', 'keyframe', 'design_board', 'master_board', 'preview',
] satisfies readonly ProductionLayer[])
const STORYBOARD_STAGES: ReadonlySet<string> = new Set([
  'spatial_blocking', 'storyboard_stills', 'approved_keyframe_selection',
  'intent_generate_shot_design_board', 'story_preview', 'beat_keyframe',
] satisfies readonly CreationStage[])
const GENERATABLE_KINDS = new Set(['image', 'imageEdit', 'storyboard', 'video', 'videoCompose', 'audio'])

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function originalText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : ''
}

function mediaAssetUrl(value: unknown, media: 'image' | 'video' | 'audio'): string | null {
  const raw = text(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol === 'https:' || url.protocol === 'http:') return raw
    // Local uploads and browser video composition persist URL.createObjectURL results.
    // Parsing the embedded source rejects arbitrary strings such as `blob:planned.png`.
    if (url.protocol === 'blob:') {
      const source = new URL(url.pathname)
      return (source.protocol === 'https:' || source.protocol === 'http:')
        && source.pathname.length > 1 && !source.search && !source.hash ? raw : null
    }
    // The image runner can retain an inline result when hosting has not completed.
    if (url.protocol === 'data:' && media === 'image') {
      const separator = url.pathname.indexOf(',')
      if (separator < 0) return null
      const header = url.pathname.slice(0, separator)
      if (!/^image\/[a-z0-9.+-]+;base64$/i.test(header)) return null
      const encoded = url.pathname.slice(separator + 1)
      const decoded = atob(encoded)
      return decoded.length > 0 && btoa(decoded) === encoded ? raw : null
    }
    return null
  } catch {
    return null
  }
}

function resultUrl(data: Record<string, unknown>, media: 'image' | 'video' | 'audio'): string | null {
  const values = data[`${media}Results`]
  const results = Array.isArray(values) ? values : []
  const index = data[`${media}PrimaryIndex`]
  const primary = typeof index === 'number' && Number.isInteger(index) && index >= 0 ? results[index] : results[0]
  return mediaAssetUrl(record(primary)?.url, media)
    ?? mediaAssetUrl(data[`${media}Url`], media)
    ?? results.map((result) => mediaAssetUrl(record(result)?.url, media)).find((url) => url !== null)
    ?? null
}

function storyboardCellUrl(data: Record<string, unknown>): string | null {
  if (!Array.isArray(data.storyboardEditorCells)) return null
  for (const cell of data.storyboardEditorCells) {
    const url = mediaAssetUrl(record(cell)?.imageUrl, 'image')
    if (url) return url
  }
  return null
}

function clipIdsOf(data: Record<string, unknown>): string[] {
  const listed = Array.isArray(data.clipIds) ? data.clipIds.map(text).filter(Boolean) : []
  const own = text(data.workflowClipId) || text(data.clipId)
  return [...new Set(own ? [own, ...listed] : listed)]
}

/** Reads the persisted reference bindings; palettes and other reference types are not scenes. */
function sceneRefsOf(data: Record<string, unknown>): SceneRef[] {
  if (!Array.isArray(data.workflowReferenceBindings)) return []
  return data.workflowReferenceBindings.flatMap((value): SceneRef[] => {
    const binding = record(value)
    const nodeId = text(binding?.nodeId)
    return binding?.referenceType === 'scene' && nodeId ? [{ nodeId, name: text(binding.name) || nodeId }] : []
  })
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function assetCategory(value: unknown): WorkbenchCategory | null {
  if (value === 'character' || value === 'ensemble') return 'character'
  if (value === 'scene') return 'scene'
  if (value === 'prop') return 'prop'
  return null
}

/** Category follows persisted type contracts; reference bindings do not change an asset's own type. */
function categoryFor(data: Record<string, unknown>, kind: string): WorkbenchCategory {
  const normalized = normalizeTaskNodeKind(kind)
  if (normalized === 'videoCompose') return 'final'
  if (normalized === 'video') return 'video'
  if (normalized === 'audio') return 'audio'
  const referenceCategory = assetCategory(data.referenceType) ?? assetCategory(data.materialKind) ?? assetCategory(kind)
  if (referenceCategory) return referenceCategory
  if (text(data.characterProfileVersion)) return 'character'
  if (text(data.sceneProfileVersion)) return 'scene'
  if (text(data.propProfileVersion)) return 'prop'
  if (normalized === 'storyboard' || normalized === 'shotTable' || kind === 'storyboardScript'
    || STORYBOARD_IMAGE_KINDS.has(kind)
    || STORYBOARD_LAYERS.has(text(data.productionLayer)) || STORYBOARD_STAGES.has(text(data.creationStage))
    || Array.isArray(data.storyboardEditorCells) || record(data.storyboardPlan)
    || text(data.storyboardChunkId)) return 'storyboard'
  if (normalized === 'text') return 'script'
  return 'other'
}

function outputText(data: Record<string, unknown>): string {
  if (Array.isArray(data.textResults)) {
    for (let index = data.textResults.length - 1; index >= 0; index -= 1) {
      const result = data.textResults[index]
      const value = originalText(typeof result === 'string' ? result : record(result)?.text)
      if (value) return value
    }
  }
  for (const field of ['text', 'content', 'scriptText', 'scriptContent', 'scriptDoc', 'script', 'markdown', 'chapterText', 'storyboardScript']) {
    const value = originalText(data[field])
    if (value) return value
  }
  const preview = record(record(data.lastResult)?.preview)
  return preview?.type === 'text' ? originalText(preview.value) : ''
}

function hasStructuredTextResult(data: Record<string, unknown>): boolean {
  return ['scriptDoc', 'script', 'shotTable'].some((field) => {
    const value = data[field]
    return record(value) !== null || (Array.isArray(value) && value.length > 0)
  })
}

/** A read-only projection: the graph and every physical execution receipt remain untouched. */
export function projectWorkbench(nodes: readonly Node[], edges: readonly Edge[]): WorkbenchItem[] {
  const projection = projectWorkflowMediaAttempts(nodes, edges)
  const upstreamById = new Map<string, Set<string>>()
  for (const edge of projection.edges) {
    if (edge.source === edge.target) continue
    const upstream = upstreamById.get(edge.target) ?? new Set<string>()
    upstream.add(edge.source)
    upstreamById.set(edge.target, upstream)
  }
  return projection.nodes.flatMap((node): WorkbenchItem[] => {
    const data = record(node.data) ?? {}
    const kind = text(data.kind)
    const normalized = normalizeTaskNodeKind(kind)
    if (node.type === 'groupNode' || node.type === 'group'
      || normalized === 'workflowStage' || normalized === 'workflowTrigger') return []

    const category = categoryFor(data, kind)
    const status = text(data.status) || 'idle'
    const busy = BUSY_STATUSES.has(status)
    const imageUrl = resultUrl(data, 'image') ?? (category === 'storyboard' ? storyboardCellUrl(data) : null)
    const videoUrl = resultUrl(data, 'video')
    const audioUrl = resultUrl(data, 'audio')
    const resultText = outputText(data)
    const prompt = originalText(data.prompt)
    const hasMediaResult = Boolean(imageUrl || videoUrl || audioUrl)
    const mediaTask = normalized === 'image' || normalized === 'imageEdit' || normalized === 'storyboard'
      || normalized === 'video' || normalized === 'videoCompose' || normalized === 'audio'
      || category === 'character' || category === 'scene' || category === 'prop'
    const hasResult = normalized === 'video' || normalized === 'videoCompose' ? Boolean(videoUrl)
      : normalized === 'audio' ? Boolean(audioUrl)
        : mediaTask ? Boolean(imageUrl)
          : Boolean(hasMediaResult || resultText || hasStructuredTextResult(data) || (normalized === 'text' && prompt))
    return [{
      id: node.id,
      label: text(data.label) || text(data.title) || node.id,
      category,
      kind,
      status,
      busy,
      imageUrl,
      videoUrl,
      audioUrl,
      text: resultText || prompt,
      error: text(data.lastError) || text(data.errorMessage) || text(data.error) || null,
      hasResult,
      canGenerate: node.type === 'taskNode' && normalized !== undefined && GENERATABLE_KINDS.has(normalized)
        && !busy && data.readOnly !== true,
      upstreamIds: [...(upstreamById.get(node.id) ?? [])],
      clipIds: clipIdsOf(data),
      clipIndex: typeof data.clipIndex === 'number' && Number.isInteger(data.clipIndex) ? data.clipIndex : null,
      shotScript: originalText(data.workflowSourcePrompt),
      durationSeconds: positiveNumber(data.videoDurationSeconds),
      sceneRefs: sceneRefsOf(data),
    }]
  })
}
