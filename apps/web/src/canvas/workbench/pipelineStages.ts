import type { WorkbenchCategory, WorkbenchItem } from './workbenchModel'

export type PipelineStageId = 'script' | 'assets' | 'storyboard' | 'clips' | 'delivery'

export type PipelineStage = Readonly<{
  id: PipelineStageId
  label: string
  description: string
  categories: readonly WorkbenchCategory[]
}>

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  { id: 'script', label: '故事剧本', description: '正文、故事与剧本内容', categories: ['script'] },
  { id: 'assets', label: '角色与场景', description: '角色、场景、道具与其他参考内容', categories: ['character', 'scene', 'prop', 'other'] },
  { id: 'storyboard', label: '分镜设计', description: '每段的镜头拆解与站位', categories: ['storyboard'] },
  { id: 'clips', label: '视频片段', description: '视频片段、配音、音乐与音效', categories: ['video', 'audio'] },
  { id: 'delivery', label: '最终成片', description: '剪辑合成与成片结果', categories: ['final'] },
]

const STAGE_BY_CATEGORY: Readonly<Record<WorkbenchCategory, PipelineStageId>> = {
  script: 'script',
  character: 'assets',
  scene: 'assets',
  prop: 'assets',
  other: 'assets',
  storyboard: 'storyboard',
  video: 'clips',
  audio: 'clips',
  final: 'delivery',
}

export type PipelineStageProjection = PipelineStage & Readonly<{
  items: readonly WorkbenchItem[]
  readyCount: number
  busyCount: number
  issueCount: number
  statusLabel: string
}>

/** Existing content, current execution and reported errors are independent facts. */
export function projectPipelineStages(items: readonly WorkbenchItem[]): PipelineStageProjection[] {
  return PIPELINE_STAGES.map((stage) => {
    const stageItems = items.filter((item) => STAGE_BY_CATEGORY[item.category] === stage.id)
    const readyCount = stageItems.filter((item) => item.hasResult).length
    const busyCount = stageItems.filter((item) => item.busy).length
    const issueCount = stageItems.filter((item) => Boolean(item.error) || item.status === 'error' || item.status === 'failed').length
    return {
      ...stage,
      items: stageItems,
      readyCount,
      busyCount,
      issueCount,
      statusLabel: busyCount > 0 ? `${busyCount} 生成中`
        : stageItems.length > 0 ? `${readyCount}/${stageItems.length} 已有内容`
          : '暂无内容',
    }
  })
}

export type PipelineStageRelation = Readonly<{
  source: PipelineStageId
  target: PipelineStageId
  count: number
}>

/** Summarize persisted references without assuming the five stages form a dependency chain. */
export function buildPipelineStageRelations(items: readonly WorkbenchItem[]): PipelineStageRelation[] {
  const itemById = new Map(items.map((item) => [item.id, item]))
  const counts = new Map<PipelineStageId, Map<PipelineStageId, number>>()
  for (const item of items) {
    const target = STAGE_BY_CATEGORY[item.category]
    for (const upstreamId of new Set(item.upstreamIds)) {
      const upstream = itemById.get(upstreamId)
      if (!upstream) continue
      const source = STAGE_BY_CATEGORY[upstream.category]
      if (source === target) continue
      const targets = counts.get(source) ?? new Map<PipelineStageId, number>()
      targets.set(target, (targets.get(target) ?? 0) + 1)
      counts.set(source, targets)
    }
  }
  return PIPELINE_STAGES.flatMap(({ id: source }) => PIPELINE_STAGES.flatMap(({ id: target }) => {
    const count = counts.get(source)?.get(target)
    return count ? [{ source, target, count }] : []
  }))
}

export type PipelineStageState = 'done' | 'running' | 'partial' | 'issue' | 'waiting'

/** Visual state of a stage: running wins, then reported issues, then completeness. */
export function pipelineStageState(stage: PipelineStageProjection): PipelineStageState {
  if (stage.busyCount > 0) return 'running'
  if (stage.issueCount > 0) return 'issue'
  if (stage.items.length === 0) return 'waiting'
  return stage.readyCount === stage.items.length ? 'done' : 'partial'
}

/** The stage that most needs attention: running, then the first unfinished one, then the latest with content. */
export function pickFocusStage(stages: readonly PipelineStageProjection[]): PipelineStageId {
  const running = stages.find((stage) => stage.busyCount > 0)
  if (running) return running.id
  const unfinished = stages.find((stage) => stage.items.length > 0 && stage.readyCount < stage.items.length)
  if (unfinished) return unfinished.id
  const latest = [...stages].reverse().find((stage) => stage.items.length > 0)
  return latest?.id ?? 'script'
}
