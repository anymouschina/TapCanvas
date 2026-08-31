import { describe, expect, it, beforeEach } from 'vitest'
import {
  useVideoRunStore,
  upsertVideoRun,
  replaceVideoRunSnapshot,
  selectRunStatusEventsAfterWatermark,
  selectActiveRuns,
  selectRunAggregate,
  isTerminalRunState,
  buildVideoRunChipLabel,
  resolveVideoRunDisplayedProgress,
  isVideoRunDisplayStalled,
  type VideoRunStatus,
} from './videoRunStore'
import { useChatCommandStore } from '../ui/chat/chatCommandStore'
import { VIDEO_RUN_STATUS_PROTOCOL_VERSION, type VideoRunState } from '@tapcanvas/video-orchestrator-protocol'

const makeRun = (over: Partial<VideoRunStatus> & { runId: string; state: VideoRunState }): VideoRunStatus => ({
  protocolVersion: VIDEO_RUN_STATUS_PROTOCOL_VERSION,
  flowId: null,
  totalClips: 1,
  clipsDone: 0,
  errorMessage: null,
  completedAt: null,
  authoringState: null,
  authoringClipsReady: 0,
  authoringTotalClips: 0,
  chapterId: null,
  chapterTitle: null,
  updatedAt: new Date().toISOString(),
  ...over,
})

describe('videoRunStore', () => {
  beforeEach(() => {
    useVideoRunStore.setState({ runsById: {}, snapshotAppliedAt: null })
    useChatCommandStore.setState({ pending: null, busy: false })
  })

  it('upsert 写入并可读回', () => {
    upsertVideoRun(makeRun({
      runId: 'r1', flowId: 'f1', state: 'video_running',
      totalClips: 8, clipsDone: 3, errorMessage: null, completedAt: null,
    }))
    const active = selectActiveRuns(useVideoRunStore.getState())
    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({ runId: 'r1', clipsDone: 3, totalClips: 8 })
  })

  it('终态 run 不计入活跃，但仍在 runsById', () => {
    upsertVideoRun(makeRun({ runId: 'r2', flowId: 'f1', state: 'concatenated', totalClips: 5, clipsDone: 5, errorMessage: null, completedAt: '2026-06-07T00:00:00Z' }))
    expect(selectActiveRuns(useVideoRunStore.getState())).toHaveLength(0)
    expect(useVideoRunStore.getState().runsById['r2']).toBeDefined()
  })

  it('终态 SSE 只更新 UI 投影，不从浏览器触发新的 agent 工作流', () => {
    upsertVideoRun(makeRun({
      runId: 'learning-run', flowId: 'f1', state: 'video_running',
      totalClips: 5, clipsDone: 4, errorMessage: null, completedAt: null,
    }))
    upsertVideoRun(makeRun({
      runId: 'learning-run', flowId: 'f1', state: 'concatenated',
      totalClips: 5, clipsDone: 5, errorMessage: null, completedAt: '2026-07-24T08:00:00Z',
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    }))

    expect(useChatCommandStore.getState().pending).toBeNull()
    expect(useVideoRunStore.getState().runsById['learning-run']?.state).toBe('concatenated')
  })

  it('aggregate 汇总活跃 run 的进度', () => {
    upsertVideoRun(makeRun({ runId: 'a', flowId: 'f', state: 'video_running', totalClips: 8, clipsDone: 2, errorMessage: null, completedAt: null }))
    upsertVideoRun(makeRun({ runId: 'b', flowId: 'f', state: 'scheduled', totalClips: 4, clipsDone: 0, errorMessage: null, completedAt: null }))
    const agg = selectRunAggregate(useVideoRunStore.getState())
    expect(agg.activeCount).toBe(2)
    expect(agg.clipsDone).toBe(2)
    expect(agg.totalClips).toBe(12)
  })

  it('isTerminalRunState 识别终态', () => {
    expect(isTerminalRunState('concatenated')).toBe(true)
    expect(isTerminalRunState('failed')).toBe(true)
    expect(isTerminalRunState('video_running')).toBe(false)
    expect(isTerminalRunState('scheduled')).toBe(false)
  })

  it('拒绝 updatedAt 更旧或相同的乱序增量', () => {
    const terminal = makeRun({
      runId: 'ordered',
      state: 'concatenated',
      clipsDone: 1,
      completedAt: '2026-08-03T05:02:00.000Z',
      updatedAt: '2026-08-03T05:02:00.000Z',
    })
    upsertVideoRun(terminal)
    upsertVideoRun(makeRun({
      runId: 'ordered',
      state: 'video_running',
      updatedAt: '2026-08-03T05:01:00.000Z',
    }))
    expect(useVideoRunStore.getState().runsById.ordered).toBe(terminal)
  })

  it('权威快照原子删除未出现在 active set 中的旧 run', () => {
    upsertVideoRun(makeRun({ runId: 'stale', state: 'video_running' }))
    replaceVideoRunSnapshot([])
    expect(useVideoRunStore.getState().runsById).toEqual({})
    expect(useVideoRunStore.getState().snapshotAppliedAt).not.toBeNull()
  })

  it('只重放数据库快照水位之后到达的连接缓冲事件', () => {
    const before = makeRun({ runId: 'before', state: 'scheduled', updatedAt: '2026-08-03T05:00:00.000Z' })
    const after = makeRun({ runId: 'after', state: 'video_running', updatedAt: '2026-08-03T05:02:00.000Z' })
    expect(selectRunStatusEventsAfterWatermark(
      [after, before],
      '2026-08-03T05:01:00.000Z',
    )).toEqual([after])
  })
})

describe('buildVideoRunChipLabel', () => {
  const run = (over: Partial<VideoRunStatus>): VideoRunStatus => makeRun({
    runId: 'r', state: 'video_running', totalClips: 5, clipsDone: 3, ...over,
  })

  it('单 run · 当前就在该章节 → 不标章节', () => {
    const label = buildVideoRunChipLabel([run({ chapterId: 'ch1', chapterTitle: '第二十五节' })], 'ch1')
    expect(label).toBe('视频生产中 · 3/5 段')
  })

  it('编排阶段展示 clip writer 的真实完成量', () => {
    const authoringRun = run({ state: 'collecting', clipsDone: 0, authoringState: 'writing_dispatched', authoringClipsReady: 4, authoringTotalClips: 5 })
    expect(resolveVideoRunDisplayedProgress(authoringRun)).toEqual({ clipsDone: 4, totalClips: 5 })
    expect(buildVideoRunChipLabel([authoringRun], null)).toBe('视频生产中 · 4/5 段')
  })

  it('交棒到生产态后忽略残留 authoring 计数', () => {
    const productionRun = run({ state: 'scheduled', clipsDone: 0, authoringState: 'authoring_done', authoringClipsReady: 5, authoringTotalClips: 5 })
    expect(resolveVideoRunDisplayedProgress(productionRun)).toEqual({ clipsDone: 0, totalClips: 5 })
    expect(buildVideoRunChipLabel([productionRun], null)).toBe('视频生产中 · 0/5 段')
  })

  it('单 run · 项目主画布(currentChapterId=null) → 标出归属章节', () => {
    const label = buildVideoRunChipLabel([run({ chapterId: 'ch1', chapterTitle: '第二十五节：东海追逃战（上）' })], null)
    expect(label).toBe('视频生产中 · 3/5 段 · 章节《第二十五节：东海追逃战（上）》')
  })

  it('单 run · 在别的章节看 → 标出归属章节', () => {
    const label = buildVideoRunChipLabel([run({ chapterId: 'ch1', chapterTitle: '第二十五节' })], 'ch2')
    expect(label).toContain('· 章节《第二十五节》')
  })

  it('run 无 chapterId → 不标章节', () => {
    expect(buildVideoRunChipLabel([run({ chapterId: null, chapterTitle: null })], null)).toBe('视频生产中 · 3/5 段')
  })

  it('全部子片成功后不再占用全局逐段进度，合成状态交给成片节点', () => {
    upsertVideoRun(run({ state: 'video_success', clipsDone: 12, totalClips: 12 }))
    expect(selectActiveRuns(useVideoRunStore.getState())).toEqual([])
  })

  it('多 run 跨多章 → 标 N 个章节', () => {
    const label = buildVideoRunChipLabel([
      run({ runId: 'a', chapterId: 'ch1', chapterTitle: '第一节', clipsDone: 2, totalClips: 5 }),
      run({ runId: 'b', chapterId: 'ch2', chapterTitle: '第二节', clipsDone: 1, totalClips: 4 }),
    ], null)
    expect(label).toContain('2 个任务 · 3/9 段')
    expect(label).toContain('2 个章节')
  })
})

describe('video run stall display', () => {
  it('does not present an old non-terminal watermark as healthy background work', () => {
    const run = makeRun({
      runId: 'stalled',
      state: 'video_running',
      updatedAt: '2026-08-03T05:00:00.000Z',
    })
    const now = Date.parse('2026-08-03T05:11:00.000Z')
    expect(isVideoRunDisplayStalled(run, now)).toBe(true)
    expect(buildVideoRunChipLabel([run], null, now)).toContain('视频生产停滞')
  })

  it('keeps recently updated runs in the normal production state', () => {
    const run = makeRun({
      runId: 'fresh',
      state: 'video_running',
      updatedAt: '2026-08-03T05:09:00.000Z',
    })
    const now = Date.parse('2026-08-03T05:11:00.000Z')
    expect(isVideoRunDisplayStalled(run, now)).toBe(false)
    expect(buildVideoRunChipLabel([run], null, now)).toBe('视频生产中 · 0/1 段')
  })
})
