import React, { useCallback, useMemo, useState } from 'react'
import { Alert, Button, Loader } from '@mantine/core'
import { IconAlertTriangle, IconCheck, IconPlayerStop, IconSparkles } from '@tabler/icons-react'
import type { Edge, Node } from '@xyflow/react'
import { useRFStore } from '../store'
import { useUIStore } from '../../ui/uiStore'
import { projectWorkbench, WORKBENCH_CATEGORIES, type WorkbenchItem } from './workbenchModel'
import {
  pickFocusStage, pipelineStageState, projectPipelineStages,
  type PipelineStageId, type PipelineStageProjection,
} from './pipelineStages'
import { useWorkbenchExecution } from './useWorkbenchExecution'
import { PipelineProductionControls } from './PipelineProductionControls'
import { WorkbenchCard, workbenchMedia } from './WorkbenchCard'
import { StageNavigator } from './StageNavigator'
import { ShotDesignCard } from './ShotDesignCard'
import { isShotDesign, withShotDesigns } from './shotDesign'
import { groupClipsByScene } from './clipScenes'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import { EMPTY_STAGE_FILTER, filterStageItems, STAGE_NAVIGATOR_MIN_ITEMS, type StageFilter } from './stageFilters'
import './workbench.css'

const EMPTY_NODES: Node[] = []
const EMPTY_EDGES: Edge[] = []

/** Items with no output and nothing to run (bookkeeping nodes) are canvas detail, not pipeline output. */
function isPipelineOutput(item: WorkbenchItem): boolean {
  return item.hasResult || item.canGenerate || item.busy || Boolean(item.error)
}

type StageGroup = { label: string | null; scene?: WorkbenchItem | null; items: readonly WorkbenchItem[] }

/** Assets read better grouped by kind, clips and their shot designs by the scene they play in; other stages are one continuous sequence. */
function groupItems(stageId: PipelineStageId, items: readonly WorkbenchItem[], byId: ReadonlyMap<string, WorkbenchItem>): StageGroup[] {
  if (stageId === 'clips' || stageId === 'storyboard') return groupClipsByScene(items, byId)
  if (stageId !== 'assets') return [{ label: null, items }]
  return WORKBENCH_CATEGORIES.flatMap((category) => {
    const grouped = items.filter((item) => item.category === category.id)
    return grouped.length ? [{ label: category.label, items: grouped }] : []
  })
}

/** The clip video an item plays: itself in the clips step, the designed video in the storyboard step. */
function clipVideo(item: WorkbenchItem, byId: ReadonlyMap<string, WorkbenchItem>): WorkbenchItem | null {
  const video = isShotDesign(item) ? byId.get(item.shotDesign.videoId) : item
  return video?.videoUrl ? video : null
}

/** Screen time of a scene: its clips' durations (a clip's audio carries none). */
function sceneSeconds(items: readonly WorkbenchItem[]): number {
  return Math.round(items.reduce((sum, item) => sum + (item.category === 'audio' ? 0 : item.durationSeconds ?? 0), 0))
}

function StepMarker({ stage, index }: { stage: PipelineStageProjection; index: number }): JSX.Element {
  const state = pipelineStageState(stage)
  const progress = stage.items.length ? Math.round((stage.readyCount / stage.items.length) * 100) : 0
  return <span className="tc-pipeline-step__marker" data-state={state} style={{ '--tc-step-progress': `${progress}%` } as React.CSSProperties}>
    {state === 'done' ? <IconCheck className="tc-pipeline-step__marker-icon" size={14} stroke={2.6} />
      : state === 'running' ? <Loader className="tc-pipeline-step__marker-loader" size={12} />
        : state === 'issue' ? <IconAlertTriangle className="tc-pipeline-step__marker-icon" size={13} />
          : <span className="tc-pipeline-step__marker-number">{index + 1}</span>}
  </span>
}

function stageSummary(stage: PipelineStageProjection): string {
  const state = pipelineStageState(stage)
  if (state === 'waiting') return '等待'
  if (state === 'running') return `${stage.busyCount} 项生成中`
  if (state === 'done') return `已产出 · ${stage.items.length}`
  const summary = `${stage.readyCount}/${stage.items.length}`
  return stage.issueCount ? `${summary} · ${stage.issueCount} 项异常` : summary
}

export default function CanvasWorkbench({ active }: { active: boolean }): JSX.Element {
  const nodes = useRFStore((state) => active ? state.nodes : EMPTY_NODES)
  const edges = useRFStore((state) => active ? state.edges : EMPTY_EDGES)
  const readOnly = useUIStore((state) => state.viewOnly)
  const items = useMemo(() => projectWorkbench(nodes, edges), [nodes, edges])
  // 分镜一步按 Clip 展示镜头拆解，站位图挂在对应 Clip 上。
  const stages = useMemo(() => projectPipelineStages(withShotDesigns(items).filter(isPipelineOutput)), [items])
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const { notice, error, pendingIds, stopping, setNotice, setError, run, stop } = useWorkbenchExecution()
  // Until the user picks a stage, follow the one that needs attention.
  const [chosenStage, setChosenStage] = useState<PipelineStageId | null>(null)
  const stageId = chosenStage ?? pickFocusStage(stages)
  const stageIndex = Math.max(0, stages.findIndex((stage) => stage.id === stageId))
  const stage = stages[stageIndex]
  const references = (item: WorkbenchItem): WorkbenchItem[] => item.upstreamIds.flatMap((id) => {
    const reference = byId.get(id)
    return reference ? [reference] : []
  })
  // 筛选只影响显示；「生成未完成素材」仍按整个阶段计算。切换阶段时清空。
  const [filterState, setFilterState] = useState<{ stageId: PipelineStageId; filter: StageFilter }>({ stageId, filter: EMPTY_STAGE_FILTER })
  const filter = filterState.stageId === stage.id ? filterState.filter : EMPTY_STAGE_FILTER
  const setFilter = useCallback((next: StageFilter) => setFilterState({ stageId: stage.id, filter: next }), [stage.id])
  const showNavigator = stage.items.length > STAGE_NAVIGATOR_MIN_ITEMS
  const visibleItems = useMemo(() => showNavigator ? filterStageItems(stage.items, filter, pendingIds) : stage.items,
    [showNavigator, stage.items, filter, pendingIds])
  const missing = stage.items.filter((item) => item.canGenerate && !item.hasResult && !item.busy && !pendingIds.has(item.id))
  const isScript = stage.id === 'script'
  const groups = useMemo(() => groupItems(stage.id, visibleItems, byId), [stage.id, visibleItems, byId])
  // Scenes are self-contained blocks sized by their clip count, so one-clip scenes sit side by side.
  const sceneBlocks = (stage.id === 'clips' || stage.id === 'storyboard') && groups.some((group) => group.label)
  const openPreview = useCallback((target: WorkbenchItem) => {
    const media = workbenchMedia(target)
    if (media) useUIStore.getState().openPreview({ ...media, name: target.label })
  }, [])

  return (
    <section className="tc-workbench" hidden={!active} aria-label="创作流水线" data-ux-panel>
      <aside className="tc-pipeline-rail" aria-label="流水线控制">
        <PipelineProductionControls active={active} />
        <nav className="tc-pipeline-steps" aria-label="制作阶段">
          {stages.map((entry, index) => (
            <button key={entry.id} className="tc-pipeline-step" type="button" data-state={pipelineStageState(entry)}
              aria-current={entry.id === stage.id ? 'step' : undefined} onClick={() => setChosenStage(entry.id)}>
              <StepMarker stage={entry} index={index} />
              <span className="tc-pipeline-step__body">
                <strong className="tc-pipeline-step__name">{entry.label}</strong>
                <span className="tc-pipeline-step__status">{stageSummary(entry)}</span>
              </span>
            </button>
          ))}
        </nav>
        {pendingIds.size > 0 && <div className="tc-pipeline-rail__execution">
          <span className="tc-pipeline-rail__progress" role="status"><Loader className="tc-pipeline-rail__loader" size={12} />本次生成 · {pendingIds.size} 项素材</span>
          <Button className="tc-pipeline-rail__stop" size="compact-xs" variant="subtle" color="gray" disabled={stopping} onClick={stop}
            leftSection={<IconPlayerStop className="tc-pipeline-rail__stop-icon" size={13} />}>
            {stopping ? '已停止后续派发' : '停止后续生成'}
          </Button>
        </div>}
      </aside>

      <section className="tc-pipeline-stage" key={stage.id} data-stage={stage.id} aria-label={stage.label}>
        <header className="tc-pipeline-stage__header">
          <div className="tc-pipeline-stage__heading">
            <span className="tc-pipeline-stage__eyebrow">第 {stageIndex + 1} 步 · 共 {stages.length} 步</span>
            <h2 className="tc-pipeline-stage__title">{stage.label}</h2>
            <p className="tc-pipeline-stage__description">{stage.description}</p>
          </div>
          <div className="tc-pipeline-stage__meta">
            {stage.items.length > 0 && <span className="tc-pipeline-stage__count"><b className="tc-pipeline-stage__count-ready">{stage.readyCount}</b>/{stage.items.length} 已产出</span>}
            {!readOnly && missing.length > 0 && <Button className="tc-pipeline-stage__generate" size="xs" disabled={pendingIds.size > 0}
              leftSection={<IconSparkles className="tc-pipeline-stage__generate-icon" size={14} />}
              onClick={() => { void run(missing.map((item) => item.id)) }}>
              生成未完成素材 · {missing.length}
            </Button>}
          </div>
        </header>
        {notice && <Alert className="tc-workbench-notice" variant="light" withCloseButton onClose={() => setNotice('')}>{notice}</Alert>}
        {error && <Alert className="tc-workbench-error" color="red" title="本次操作未完成" withCloseButton onClose={() => setError('')}>{error}</Alert>}
        {showNavigator && <StageNavigator items={stage.items} pending={pendingIds} filter={filter}
          showCategories={stage.id === 'assets'} onChange={setFilter} />}
        <div className="tc-pipeline-stage__content" data-layout={isScript ? 'reading' : stage.id === 'delivery' ? 'hero' : stage.id === 'storyboard' ? 'shots' : 'grid'}
          data-scenes={sceneBlocks || undefined}>
          {stage.items.length && !visibleItems.length ? <div className="tc-pipeline-stage__no-match">
            没有匹配的素材
            <button className="tc-pipeline-stage__no-match-reset" type="button" onClick={() => setFilter(EMPTY_STAGE_FILTER)}>清除筛选</button>
          </div> : stage.items.length ? groups.map((group) => {
            const play = (item: WorkbenchItem): (() => void) | undefined => {
              const video = clipVideo(item, byId)
              return video ? () => openPreview(video) : undefined
            }
            const content = <>
            {group.label && <h3 className="tc-pipeline-stage__group">
              {group.scene?.imageUrl && <button className="tc-pipeline-stage__group-scene" type="button" title={group.scene.label}
                aria-label={`预览${group.scene.label}`} onClick={() => group.scene && openPreview(group.scene)}>
                <ManagedImage className="tc-pipeline-stage__group-scene-image" src={group.scene.imageUrl} alt={group.scene.label} ownerNodeId={group.scene.id} priority="visible" />
              </button>}
              {group.label}<span className="tc-pipeline-stage__group-count">{group.items.length}</span>
              {sceneBlocks && sceneSeconds(group.items) > 0 && <span className="tc-pipeline-stage__group-count">· {sceneSeconds(group.items)}s</span>}

            </h3>}
            {group.items.map((item) => isShotDesign(item)
              ? <ShotDesignCard key={item.id} item={item} onPreview={openPreview} onPlay={play(item)} />
              : (
              <WorkbenchCard key={item.id} item={item} pending={pendingIds.has(item.id)} readOnly={readOnly}
                upstream={isScript ? [] : references(item).filter((reference) => reference.id !== group.scene?.id)} onGenerate={() => { void run([item.id]) }}
                onPreview={openPreview} hero={stage.id === 'delivery'} />
            ))}
            </>
            return sceneBlocks
              ? <section className="tc-pipeline-scene" key={group.label ?? 'all'} aria-label={group.label ?? undefined}
                style={{ '--tc-scene-clips': group.items.length } as React.CSSProperties}>{content}</section>
              : <React.Fragment key={group.label ?? 'all'}>{content}</React.Fragment>
          }) : <div className="tc-pipeline-stage__empty">
            <span className="tc-pipeline-stage__empty-title">这一步还没有产出</span>
            <p className="tc-pipeline-stage__empty-description">在左侧选择章节并点击「一键成片」，{stage.label}会自动出现在这里。</p>
          </div>}
        </div>
      </section>
    </section>
  )
}
