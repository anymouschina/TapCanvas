import { create } from 'zustand'
import {
  isTerminalVideoRunState,
  type VideoRunStatusEvent,
} from '@tapcanvas/video-orchestrator-protocol'

export type VideoRunStatus = VideoRunStatusEvent

// 子片均已落到画布后，全局逐段生产进度已经结束；后续合成状态由 compose 节点展示，
// 不能同时占用全局“视频生产中”指示器。
const USER_COMPOSITION_STATES = new Set(['video_success'])
const TERMINAL_TTL_MS = 60_000
export const VIDEO_RUN_STALL_DISPLAY_MS = 10 * 60 * 1000

export const isTerminalRunState = isTerminalVideoRunState

type VideoRunState = {
  runsById: Record<string, VideoRunStatus>
  snapshotAppliedAt: number | null
}

export const useVideoRunStore = create<VideoRunState>(() => ({
  runsById: {},
  snapshotAppliedAt: null,
}))

const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

function clearCleanupTimers(): void {
  for (const timer of cleanupTimers.values()) clearTimeout(timer)
  cleanupTimers.clear()
}

/** 合并一条 run 状态；终态 run 安排 TTL 后清理，避免 chip 永久残留。 */
export function upsertVideoRun(payload: VideoRunStatus): void {
  const prev = useVideoRunStore.getState().runsById[payload.runId]
  // 增量事件只允许按服务端持久化 updatedAt 单调前进；SSE 重连快照与实时广播可能交错，
  // 晚到的旧事件不得把 concatenated/failed 等新事实覆盖回 scheduled/video_running。
  if (prev && payload.updatedAt <= prev.updatedAt) return
  useVideoRunStore.setState((s) => ({
    runsById: { ...s.runsById, [payload.runId]: payload },
  }))

  const existing = cleanupTimers.get(payload.runId)
  if (existing) {
    clearTimeout(existing)
    cleanupTimers.delete(payload.runId)
  }
  if (isTerminalRunState(payload.state)) {
    const t = setTimeout(() => {
      cleanupTimers.delete(payload.runId)
      useVideoRunStore.setState((s) => {
        const { [payload.runId]: _removed, ...rest } = s.runsById
        return { runsById: rest }
      })
    }, TERMINAL_TTL_MS)
    cleanupTimers.set(payload.runId, t)
  }
}

/** SSE 建连权威快照：原子替换当前作用域的 run 状态，不依赖历史终态补发或时间窗口。 */
export function replaceVideoRunSnapshot(runs: readonly VideoRunStatus[]): void {
  clearCleanupTimers()
  const runsById: Record<string, VideoRunStatus> = {}
  for (const run of runs) {
    const current = runsById[run.runId]
    if (!current || run.updatedAt > current.updatedAt) runsById[run.runId] = run
  }
  useVideoRunStore.setState({ runsById, snapshotAppliedAt: Date.now() })
}

/** Connection boundary: prior active-set facts are no longer authoritative until the handshake snapshot arrives. */
export function beginVideoRunSnapshot(): void {
  clearCleanupTimers()
  useVideoRunStore.setState({ runsById: {}, snapshotAppliedAt: null })
}

/** Keep only connection-buffered events committed after the snapshot's persisted DB watermark. */
export function selectRunStatusEventsAfterWatermark(
  events: readonly VideoRunStatus[],
  watermarkUpdatedAt: string | null,
): VideoRunStatus[] {
  return events
    .filter((run) => watermarkUpdatedAt === null || run.updatedAt > watermarkUpdatedAt)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
}

/** 清空所有 run（切换项目时调用，避免上个项目的 run 串台到新项目的指示器）。 */
export function resetVideoRuns(): void {
  beginVideoRunSnapshot()
}

export function selectActiveRuns(s: VideoRunState): VideoRunStatus[] {
  return Object.values(s.runsById).filter(
    (run) => !isTerminalRunState(run.state) && !USER_COMPOSITION_STATES.has(run.state),
  )
}

/**
 * A non-terminal state is not sufficient evidence that production is healthy.
 * The server persists updatedAt on every real drive/progress transition; when
 * that watermark stops moving, the UI must stop claiming that work is simply
 * continuing in the background.
 */
export function isVideoRunDisplayStalled(
  run: Pick<VideoRunStatus, 'state' | 'updatedAt'>,
  nowMs = Date.now(),
): boolean {
  if (isTerminalRunState(run.state)) return false
  const updatedAtMs = Date.parse(run.updatedAt)
  return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs >= VIDEO_RUN_STALL_DISPLAY_MS
}

export function selectRunAggregate(s: VideoRunState): {
  activeCount: number
  clipsDone: number
  totalClips: number
} {
  const active = selectActiveRuns(s)
  return {
    activeCount: active.length,
    clipsDone: active.reduce((n, r) => n + (r.clipsDone || 0), 0),
    totalClips: active.reduce((n, r) => n + (r.totalClips || 0), 0),
  }
}

export type VideoRunDisplayedProgress = {
  clipsDone: number
  totalClips: number
}

/** 编排和生产共用一条展示进度轴，但绝不共用计数水位。 */
export function resolveVideoRunDisplayedProgress(run: VideoRunStatus): VideoRunDisplayedProgress {
  const isAuthoring = run.state === 'collecting'
    && Boolean(run.authoringState)
    && run.authoringState !== 'authoring_done'
    && run.authoringState !== 'authoring_failed'
  if (isAuthoring) {
    return {
      clipsDone: Math.max(0, run.authoringClipsReady ?? 0),
      totalClips: Math.max(0, run.authoringTotalClips),
    }
  }
  return {
    clipsDone: Math.max(0, run.clipsDone),
    totalClips: Math.max(0, run.totalClips),
  }
}

/**
 * 进度 chip 文案（纯函数，可测）：基础「视频生产中 · x/y 段」，并在有「不属于当前章节」的活跃 run 时
 * 标出归属章节名——这样在项目主画布或别的章节看到进度时，知道是哪一章的任务。
 * currentChapterId 为 null（项目主画布）时，任何带 chapterId 的 run 都视为跨上下文。
 */
export function buildVideoRunChipLabel(
  active: VideoRunStatus[],
  currentChapterId: string | null,
  nowMs = Date.now(),
): string {
  const activeCount = active.length
  const progress = active.map(resolveVideoRunDisplayedProgress)
  const clipsDone = progress.reduce((n, item) => n + item.clipsDone, 0)
  const totalClips = progress.reduce((n, item) => n + item.totalClips, 0)
  const stalledCount = active.filter((run) => isVideoRunDisplayStalled(run, nowMs)).length
  const base = stalledCount > 0
    ? `视频生产停滞 · ${stalledCount}/${activeCount} 个任务无进展`
    : activeCount > 1
    ? `视频生产中 · ${activeCount} 个任务 · ${clipsDone}/${totalClips} 段`
    : `视频生产中 · ${clipsDone}/${totalClips} 段`
  const crossTitles = [
    ...new Set(
      active
        .filter((r) => r.chapterId && r.chapterId !== currentChapterId && r.chapterTitle)
        .map((r) => r.chapterTitle as string),
    ),
  ]
  if (crossTitles.length === 0) return base
  if (crossTitles.length === 1) return `${base} · 章节《${crossTitles[0]}》`
  return `${base} · ${crossTitles.length} 个章节（${crossTitles.slice(0, 2).join('、')}…）`
}
