import { ActionIcon, Loader, Progress, Text, Tooltip } from '@mantine/core'
import { IconPlayerStop, IconX } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import type { VideoRunStatus } from '../../runner/videoRunStore'
import type {
  VideoAuthoringState,
  VideoProductionWorkflowNodeId,
  VideoRunState,
} from '@tapcanvas/video-orchestrator-protocol'
import type { LiveChatAsyncArtifact } from './liveChatRunStore'

export type AsyncProductionProgressView = {
  label: string
  detail: string
  percent: number | null
  tone: 'active' | 'paused' | 'ready' | 'failed'
  workflowNodeId: VideoProductionWorkflowNodeId | null
  stageStartedAtMs?: number
}

export const TERMINAL_PRODUCTION_PROGRESS_AUTO_DISMISS_MS = 2_500

export function shouldAutoDismissAsyncProductionProgress(
  view: AsyncProductionProgressView | null,
): boolean {
  return view?.tone === 'ready' || view?.tone === 'failed'
}

function readStageStartedAtMs(runs: readonly VideoRunStatus[]): number | undefined {
  const timestamps = runs
    .map((run) => Date.parse(run.updatedAt))
    .filter((timestamp) => Number.isFinite(timestamp))
  return timestamps.length > 0 ? Math.min(...timestamps) : undefined
}

function formatStageElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return minutes > 0 ? `${minutes}:${String(remainingSeconds).padStart(2, '0')}` : `${seconds}s`
}

export function formatProductionElapsedSummary(input: {
  taskElapsedMs: number | null
  stageElapsedMs: number | null
}): string {
  const taskElapsed = input.taskElapsedMs === null ? '' : `总计 ${formatStageElapsed(input.taskElapsedMs)}`
  const stageElapsed = input.stageElapsedMs === null ? '' : `当前阶段 ${formatStageElapsed(input.stageElapsedMs)}`
  return [taskElapsed, stageElapsed].filter(Boolean).join(' · ')
}

export function isAsyncProductionProgressDismissible(view: AsyncProductionProgressView): boolean {
  return view.tone !== 'active'
}

export function resolvePhysicalExecutionProgress(
  view: AsyncProductionProgressView | null,
  input: {
    liveRunStatus: string | null
    hasActiveExecutionEvidence: boolean
    requiresAgentContinuation: boolean
    failureMessage?: string
  },
): AsyncProductionProgressView | null {
  if (!view) return null
  // A real active executor or persisted running/queued artifact remains the
  // strongest evidence for the production card. Without that evidence, the
  // root logical-task terminal state must close an older accepted placeholder
  // even when no further agent continuation was expected for this stage.
  if (input.hasActiveExecutionEvidence) return view
  const stageTiming = view.stageStartedAtMs === undefined
    ? {}
    : { stageStartedAtMs: view.stageStartedAtMs }
  if (input.liveRunStatus === 'failed') {
    return {
      label: '当前执行已失败',
      detail: input.failureMessage?.trim() || `${view.label}尚未完成；当前没有可继续执行的活跃进程`,
      percent: view.percent,
      tone: 'failed',
      workflowNodeId: view.workflowNodeId,
      ...stageTiming,
    }
  }
  if (input.liveRunStatus === 'cancelled') {
    return {
      label: '当前执行已取消',
      detail: `${view.label}尚未完成；持久运行结果与已生成资产仍保留`,
      percent: view.percent,
      tone: 'paused',
      workflowNodeId: view.workflowNodeId,
      ...stageTiming,
    }
  }
  if (input.liveRunStatus === 'waiting_input') {
    return {
      label: '当前执行正在等待输入',
      detail: `${view.label}尚未完成；需要先处理当前任务提出的问题`,
      percent: view.percent,
      tone: 'paused',
      workflowNodeId: view.workflowNodeId,
      ...stageTiming,
    }
  }
  if (input.liveRunStatus === 'succeeded') {
    return {
      label: '当前执行已结束，生产未完成',
      detail: `${view.label}仍有未满足的持久状态；当前没有活跃执行器`,
      percent: view.percent,
      tone: 'paused',
      workflowNodeId: view.workflowNodeId,
      ...stageTiming,
    }
  }
  if (!input.requiresAgentContinuation) return view
  if (input.liveRunStatus !== 'waiting_external' && input.liveRunStatus !== 'active') return view
  return {
    label: '当前执行已挂起',
    detail: `${view.label}尚未完成；当前没有续跑执行器的活跃证据`,
    percent: view.percent,
    tone: 'paused',
    workflowNodeId: view.workflowNodeId,
    ...stageTiming,
  }
}

const PLANNING_STATES = new Set<VideoRunState>(['collecting', 'planned'])

const ASSET_AUTHORING_STATES: ReadonlySet<VideoAuthoringState> = new Set([
  'deriving_assets',
  'asset_repair_required',
  'assets_ready',
])

const MEDIA_AUTHORING_STATES: ReadonlySet<VideoAuthoringState> = new Set([
  'estimate_ready',
  'authoring_done',
])

/**
 * Coarse live projection used before the durable seven-node workflow snapshot
 * reaches diagnostics. It reads only canonical run/authoring enums and never
 * infers progress from prompt text or tool names.
 */
export function resolveVideoProductionWorkflowNode(
  runs: readonly VideoRunStatus[],
  acceptedAsync: boolean,
): VideoProductionWorkflowNodeId | null {
  if (runs.some((run) => run.state === 'concatenated')) return 'delivery'
  if (runs.some((run) => run.state === 'concatenating' || run.state === 'video_success')) return 'composition'
  if (runs.some((run) => run.state === 'scheduled' || run.state === 'video_running')) return 'media-production'

  const authoringRuns = runs.filter((run) => run.state === 'collecting' && run.authoringState)
  if (authoringRuns.some((run) => run.authoringState && MEDIA_AUTHORING_STATES.has(run.authoringState))) return 'media-production'
  if (authoringRuns.some((run) => run.authoringState && ASSET_AUTHORING_STATES.has(run.authoringState))) return 'asset-preparation'
  if (authoringRuns.length > 0) return 'clip-contracts'
  if (runs.some((run) => PLANNING_STATES.has(run.state))) return 'story-adaptation'
  if (runs.length === 0 && acceptedAsync) return 'production-contract'
  return null
}

export function shouldAwaitFirstVideoRunStatus(input: {
  liveRunStatus: string | null
  liveRunReason: string | null
  liveRunId: string
  observedLiveRunId: string
  liveRunFinishedAt: number | null
  snapshotAppliedAt: number | null
}): boolean {
  if (
    input.liveRunStatus !== 'waiting_external'
    || !input.liveRunId
    || input.observedLiveRunId === input.liveRunId
  ) {
    return false
  }
  // A required active-set snapshot applied after this physical turn ended is newer evidence:
  // an empty snapshot means there is no current run, so the old accepted_async card must not spin forever.
  return input.snapshotAppliedAt === null
    || input.liveRunFinishedAt === null
    || input.liveRunFinishedAt > input.snapshotAppliedAt
}

export function resolveAsyncProductionProgress(
  runs: VideoRunStatus[],
  acceptedAsync: boolean,
): AsyncProductionProgressView | null {
  if (runs.length === 0) {
    return acceptedAsync
      ? {
          label: '后台任务已受理',
          detail: '正在等待第一个真实运行状态事件',
          percent: null,
          tone: 'active',
          workflowNodeId: 'production-contract',
        }
      : null
  }

  const totalClips = runs.reduce((sum, run) => sum + Math.max(0, run.totalClips), 0)
  const clipsDone = runs.reduce((sum, run) => sum + Math.max(0, run.clipsDone), 0)
  const percent = totalClips > 0 ? Math.min(100, Math.round((clipsDone / totalClips) * 100)) : null
  const failedRun = runs.find((run) => run.state === 'failed' || run.state === 'cancelled')
  if (failedRun) {
    return {
      label: failedRun.state === 'cancelled' ? '后台成片已取消' : '后台成片失败',
      detail: failedRun.errorMessage || `${clipsDone}/${totalClips} 段完成`,
      percent,
      tone: 'failed',
      workflowNodeId: resolveVideoProductionWorkflowNode(runs, acceptedAsync),
    }
  }
  const authoringRuns = runs.filter((run) => run.state === 'collecting' && run.authoringState)
  if (authoringRuns.length > 0) {
    const assetRepairRun = authoringRuns.find((run) => run.authoringState === 'asset_repair_required')
    if (assetRepairRun) {
      return {
        label: '等待补齐前置视觉资产',
        detail: '镜头规划已保留；当前等待同一执行链完成真实角色与场景图片修复',
        percent: null,
        tone: 'paused',
        workflowNodeId: 'asset-preparation',
        stageStartedAtMs: readStageStartedAtMs([assetRepairRun]),
      }
    }
    const authoringTotal = authoringRuns.reduce(
      (sum, run) => sum + Math.max(0, run.authoringTotalClips ?? run.totalClips),
      0,
    )
    const authoringReady = authoringRuns.reduce(
      (sum, run) => sum + Math.max(0, run.authoringClipsReady ?? 0),
      0,
    )
    const authoringPercent = authoringTotal > 0
      ? Math.min(100, Math.round((authoringReady / authoringTotal) * 100))
      : null
    const repairing = authoringRuns.some((run) => run.authoringState === 'authoring_failed')
    const estimating = authoringRuns.some((run) => run.authoringState === 'estimate_ready')
    return {
      label: estimating ? '剧本已就绪，正在启动成片' : repairing ? '正在修复未通过的镜头提示词' : '正在编写并校验镜头提示词',
      detail: authoringTotal > 0
        ? `${authoringReady}/${authoringTotal} 段提示词已冻结`
        : `当前创作阶段：${authoringRuns[0]?.authoringState ?? 'unknown'}`,
      percent: authoringPercent,
      tone: 'active',
      workflowNodeId: resolveVideoProductionWorkflowNode(runs, acceptedAsync),
      stageStartedAtMs: readStageStartedAtMs(authoringRuns),
    }
  }
  if (runs.every((run) => run.state === 'concatenated')) {
    return {
      label: '整片已完成',
      detail: `${clipsDone}/${totalClips} 段已完成并合成`,
      percent: 100,
      tone: 'ready',
      workflowNodeId: 'delivery',
    }
  }
  if (runs.some((run) => run.state === 'concatenating')) {
    return { label: '正在合成整片', detail: `${clipsDone}/${totalClips} 段已就绪`, percent, tone: 'active', workflowNodeId: 'composition', stageStartedAtMs: readStageStartedAtMs(runs) }
  }
  // All clips being ready is an actionable canvas state, not a terminal chat delivery.
  // The compose node owns the user-triggered merge and final durable videoUrl evidence.
  if (runs.every((run) => run.state === 'video_success')) return null
  if (runs.some((run) => run.state === 'scheduled' || run.state === 'video_running')) {
    return { label: '正在生成视频', detail: `${clipsDone}/${totalClips} 完成`, percent, tone: 'active', workflowNodeId: 'media-production', stageStartedAtMs: readStageStartedAtMs(runs) }
  }
  if (runs.some((run) => PLANNING_STATES.has(run.state))) {
    return {
      label: '正在拆解与准备镜头',
      detail: totalClips > 0 ? `计划 ${totalClips} 段，尚未完成视频段` : '正在建立可执行分段计划',
      percent,
      tone: 'active',
      workflowNodeId: 'story-adaptation',
      stageStartedAtMs: readStageStartedAtMs(runs),
    }
  }
  return {
    label: '后台成片正在推进',
    detail: totalClips > 0 ? `${clipsDone}/${totalClips} 段已完成` : `当前状态：${runs[0]?.state ?? 'unknown'}`,
    percent,
    tone: 'active',
    workflowNodeId: resolveVideoProductionWorkflowNode(runs, acceptedAsync),
    stageStartedAtMs: readStageStartedAtMs(runs),
  }
}

export function resolveAsyncArtifactProgress(
  artifacts: readonly LiveChatAsyncArtifact[],
): AsyncProductionProgressView | null {
  if (artifacts.length === 0) return null
  const succeeded = artifacts.filter((artifact) => artifact.status === 'succeeded').length
  const failed = artifacts.filter((artifact) => artifact.status === 'failed')
  const running = artifacts.filter((artifact) => artifact.status === 'running').length
  const queued = artifacts.filter((artifact) => artifact.status === 'queued').length
  const settled = succeeded + failed.length
  const percent = Math.round((settled / artifacts.length) * 100)
  if (failed.length > 0) {
    return {
      label: settled === artifacts.length ? '后台生成已结束，存在失败' : '后台生成部分失败',
      detail: `${succeeded}/${artifacts.length} 项成功，${failed.length} 项失败${failed[0]?.failureReason ? `：${failed[0].failureReason}` : ''}`,
      percent,
      tone: 'failed',
      workflowNodeId: null,
    }
  }
  if (succeeded === artifacts.length) {
    return {
      label: '后台素材已全部生成',
      detail: `${succeeded}/${artifacts.length} 项已回填画布`,
      percent: 100,
      tone: 'ready',
      workflowNodeId: null,
    }
  }
  if (running > 0 || queued > 0) {
    return {
      label: running > 0 ? '后台素材正在生成' : '后台素材正在排队',
      detail: `${succeeded}/${artifacts.length} 项已完成${running > 0 ? `，${running} 项生成中` : `，${queued} 项排队中`}`,
      percent,
      tone: 'active',
      workflowNodeId: null,
    }
  }
  return {
    label: '后台任务已受理',
    detail: `已关联 ${artifacts.length} 个画布任务，等待真实运行状态事件`,
    percent,
    tone: 'active',
    workflowNodeId: null,
  }
}

export function AsyncProductionProgress({
  view,
  taskStartedAtMs,
  taskFinishedAtMs,
  cancelling = false,
  onCancel,
  onDismiss,
}: {
  view: AsyncProductionProgressView
  taskStartedAtMs?: number
  taskFinishedAtMs?: number | null
  cancelling?: boolean
  onCancel?: () => void
  onDismiss?: () => void
}): JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  const terminalObservedAtMs = useRef<number | null>(view.tone === 'active' ? null : Date.now())
  useEffect(() => {
    if (view.tone === 'active') {
      terminalObservedAtMs.current = null
    } else if (terminalObservedAtMs.current === null) {
      terminalObservedAtMs.current = Date.now()
    }
    const taskStillRunning = view.tone === 'active' && taskStartedAtMs !== undefined && taskFinishedAtMs == null
    const stageStillRunning = view.tone === 'active' && view.stageStartedAtMs !== undefined && taskFinishedAtMs == null
    if (!taskStillRunning && !stageStillRunning) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [taskFinishedAtMs, taskStartedAtMs, view.stageStartedAtMs, view.tone])
  const elapsedEndAtMs = taskFinishedAtMs ?? terminalObservedAtMs.current ?? now
  const elapsedSummary = formatProductionElapsedSummary({
    taskElapsedMs: taskStartedAtMs === undefined ? null : elapsedEndAtMs - taskStartedAtMs,
    stageElapsedMs: view.stageStartedAtMs === undefined ? null : elapsedEndAtMs - view.stageStartedAtMs,
  })
  return (
    <div className={`tc-ai-chat__async-progress tc-ai-chat__async-progress--${view.tone}`} role="status" aria-live="polite">
      <div className="tc-ai-chat__async-progress-copy">
        <span className="tc-ai-chat__async-progress-status" aria-hidden="true">
          {view.tone === 'active' ? <Loader className="tc-ai-chat__async-progress-loader" size={12} /> : view.tone === 'ready' ? '✓' : view.tone === 'paused' ? '‖' : '!'}
        </span>
        <Text className="tc-ai-chat__async-progress-label" size="xs" fw={600}>{view.label}</Text>
        <Text className="tc-ai-chat__async-progress-detail" size="xs" c="dimmed">{view.detail}</Text>
        {elapsedSummary ? (
          <Text className="tc-ai-chat__async-progress-elapsed" size="xs" c="dimmed">{elapsedSummary}</Text>
        ) : null}
        {view.tone === 'active' && onCancel ? (
          <Tooltip className="tc-ai-chat__async-progress-cancel-tooltip" label="停止视频生产；已提交的片段仍会保留" withArrow>
            <ActionIcon
              className="tc-ai-chat__async-progress-cancel"
              variant="subtle"
              color="gray"
              size="sm"
              loading={cancelling}
              onClick={onCancel}
              aria-label="停止视频生产"
            >
              <IconPlayerStop className="tc-ai-chat__async-progress-cancel-icon" size={14} />
            </ActionIcon>
          </Tooltip>
        ) : isAsyncProductionProgressDismissible(view) && onDismiss ? (
          <Tooltip className="tc-ai-chat__async-progress-dismiss-tooltip" label="关闭已结束的后台任务提示" withArrow>
            <ActionIcon
              className="tc-ai-chat__async-progress-cancel tc-ai-chat__async-progress-dismiss"
              variant="subtle"
              color="gray"
              size="sm"
              onClick={onDismiss}
              aria-label="关闭已结束的后台任务提示"
            >
              <IconX className="tc-ai-chat__async-progress-dismiss-icon" size={14} />
            </ActionIcon>
          </Tooltip>
        ) : null}
      </div>
      {view.percent !== null ? (
        <Progress
          className="tc-ai-chat__async-progress-bar"
          value={view.percent}
          size={4}
          radius={0}
          color={view.tone === 'failed' ? 'red' : view.tone === 'paused' ? 'gray' : 'blue'}
          aria-label={`后台成片进度 ${view.percent}%`}
        />
      ) : null}
    </div>
  )
}
