import { describe, expect, it } from 'vitest'
import type { VideoRunStatus } from '../../runner/videoRunStore'
import { VIDEO_RUN_STATUS_PROTOCOL_VERSION, type VideoRunState } from '@tapcanvas/video-orchestrator-protocol'
import {
  formatProductionElapsedSummary,
  isAsyncProductionProgressDismissible,
  resolveAsyncArtifactProgress,
  resolveAsyncProductionProgress,
  resolvePhysicalExecutionProgress,
  resolveVideoProductionWorkflowNode,
  shouldAutoDismissAsyncProductionProgress,
  shouldAwaitFirstVideoRunStatus,
} from './AsyncProductionProgress'

describe('formatProductionElapsedSummary', () => {
  it('同时展示逻辑任务总耗时与当前阶段耗时', () => {
    expect(formatProductionElapsedSummary({
      taskElapsedMs: 2_664_000,
      stageElapsedMs: 2_351_000,
    })).toBe('总计 44:24 · 当前阶段 39:11')
  })
})

function run(state: VideoRunState, clipsDone: number, totalClips: number): VideoRunStatus {
  return {
    protocolVersion: VIDEO_RUN_STATUS_PROTOCOL_VERSION,
    runId: `run-${state}`,
    flowId: null,
    state,
    clipsDone,
    totalClips,
    errorMessage: null,
    completedAt: null,
    chapterId: 'chapter-1',
    chapterTitle: '第一章',
    authoringState: null,
    authoringClipsReady: 0,
    authoringTotalClips: 0,
    updatedAt: '2026-08-03T05:00:00.000Z',
  }
}

describe('resolveAsyncProductionProgress', () => {
  it('异步已受理但尚未收到 run-status 时显示等待真实状态，而不是假完成', () => {
    expect(resolveAsyncProductionProgress([], true)).toEqual({
      label: '后台任务已受理',
      detail: '正在等待第一个真实运行状态事件',
      percent: null,
      tone: 'active',
      workflowNodeId: 'production-contract',
    })
  })

  it('按真实 clipsDone/totalClips 展示生成进度', () => {
    expect(resolveAsyncProductionProgress([run('video_running', 2, 6)], true)).toEqual({
      label: '正在生成视频',
      detail: '2/6 完成',
      percent: 33,
      tone: 'active',
      workflowNodeId: 'media-production',
      stageStartedAtMs: Date.parse('2026-08-03T05:00:00.000Z'),
    })
  })

  it('展示 collecting 阶段的真实 authoring 进度，不再停在等待首事件', () => {
    expect(resolveAsyncProductionProgress([{
      ...run('collecting', 0, 0),
      authoringState: 'writing_dispatched',
      authoringClipsReady: 1,
      authoringTotalClips: 5,
    }], true)).toEqual({
      label: '正在编写并校验镜头提示词',
      detail: '1/5 段提示词已冻结',
      percent: 20,
      tone: 'active',
      workflowNodeId: 'clip-contracts',
      stageStartedAtMs: Date.parse('2026-08-03T05:00:00.000Z'),
    })
  })

  it('资产修复阶段不伪称正在编写提示词，也不把 clip 总数当作已冻结提示词进度', () => {
    expect(resolveAsyncProductionProgress([{
      ...run('collecting', 0, 0),
      authoringState: 'asset_repair_required',
      authoringClipsReady: 0,
      authoringTotalClips: 12,
      errorMessage: 'asset_repair_required:authoring-asset-repair:run-1',
    }], true)).toEqual({
      label: '等待补齐前置视觉资产',
      detail: '镜头规划已保留；当前等待同一执行链完成真实角色与场景图片修复',
      percent: null,
      tone: 'paused',
      workflowNodeId: 'asset-preparation',
      stageStartedAtMs: Date.parse('2026-08-03T05:00:00.000Z'),
    })
  })

  it('子片齐备不显示为对话完成态，失败仍保留真实状态', () => {
    expect(resolveAsyncProductionProgress([run('video_success', 6, 6)], false)).toBeNull()
    const failed = { ...run('failed', 2, 6), errorMessage: '上游审核拒绝' }
    expect(resolveAsyncProductionProgress([failed], false)).toMatchObject({
      label: '后台成片失败',
      detail: '上游审核拒绝',
      tone: 'failed',
    })
  })
})

describe('shouldAwaitFirstVideoRunStatus', () => {
  it('does not keep an old suspended turn spinning after a newer authoritative empty snapshot', () => {
    expect(shouldAwaitFirstVideoRunStatus({
      liveRunStatus: 'waiting_external',
      liveRunReason: 'async_execution_suspended_until_delivery_verified',
      liveRunId: 'chat-run-old',
      observedLiveRunId: '',
      liveRunFinishedAt: 100,
      snapshotAppliedAt: 200,
    })).toBe(false)
  })

  it('waits for a run submitted after the latest snapshot until its first status event', () => {
    expect(shouldAwaitFirstVideoRunStatus({
      liveRunStatus: 'waiting_external',
      liveRunReason: 'async_execution_suspended_until_delivery_verified',
      liveRunId: 'chat-run-new',
      observedLiveRunId: '',
      liveRunFinishedAt: 300,
      snapshotAppliedAt: 200,
    })).toBe(true)
  })

  it('does not call a physical budget checkpoint an accepted background media task', () => {
    expect(shouldAwaitFirstVideoRunStatus({
      liveRunStatus: 'active',
      liveRunReason: 'root_physical_execution_budget_exhausted',
      liveRunId: 'chat-run-physical-window',
      observedLiveRunId: '',
      liveRunFinishedAt: 300,
      snapshotAppliedAt: 200,
    })).toBe(false)
  })
})

describe('resolvePhysicalExecutionProgress', () => {
  const assetRepairView = resolveAsyncProductionProgress([{
    ...run('collecting', 0, 0),
    authoringState: 'asset_repair_required',
    authoringTotalClips: 12,
  }], true)

  it('stops the spinner when the physical run is suspended and no continuation is active', () => {
    expect(resolvePhysicalExecutionProgress(assetRepairView, {
      liveRunStatus: 'waiting_external',
      hasActiveExecutionEvidence: false,
      requiresAgentContinuation: true,
    })).toEqual({
      label: '当前执行已挂起',
      detail: '等待补齐前置视觉资产尚未完成；当前没有续跑执行器的活跃证据',
      percent: null,
      tone: 'paused',
      workflowNodeId: 'asset-preparation',
      stageStartedAtMs: Date.parse('2026-08-03T05:00:00.000Z'),
    })
  })

  it('keeps the active state while an automatic continuation has live evidence', () => {
    expect(resolvePhysicalExecutionProgress(assetRepairView, {
      liveRunStatus: 'waiting_external',
      hasActiveExecutionEvidence: true,
      requiresAgentContinuation: true,
    })).toEqual(assetRepairView)
  })

  it('shows the physical turn failure instead of keeping a collecting run spinning', () => {
    expect(resolvePhysicalExecutionProgress(assetRepairView, {
      liveRunStatus: 'failed',
      hasActiveExecutionEvidence: false,
      requiresAgentContinuation: true,
      failureMessage: '远程工具回调不可达',
    })).toEqual({
      label: '当前执行已失败',
      detail: '远程工具回调不可达',
      percent: null,
      tone: 'failed',
      workflowNodeId: 'asset-preparation',
      stageStartedAtMs: Date.parse('2026-08-03T05:00:00.000Z'),
    })
  })

  it('lets the root terminal state close an accepted placeholder without an agent continuation', () => {
    const acceptedView = resolveAsyncProductionProgress([], true)
    expect(resolvePhysicalExecutionProgress(acceptedView, {
      liveRunStatus: 'failed',
      hasActiveExecutionEvidence: false,
      requiresAgentContinuation: false,
      failureMessage: '异步依赖已失败或取消',
    })).toEqual({
      label: '当前执行已失败',
      detail: '异步依赖已失败或取消',
      percent: null,
      tone: 'failed',
      workflowNodeId: 'production-contract',
    })
  })

  it('keeps independently active artifact evidence visible after the root turn settles', () => {
    const activeArtifactView = resolveAsyncArtifactProgress([{
      toolCallId: 'tool-1',
      nodeId: 'node-1',
      assetType: 'image',
      taskId: 'task-1',
      runId: 'run-1',
      status: 'running',
      failureReason: '',
    }])
    expect(resolvePhysicalExecutionProgress(activeArtifactView, {
      liveRunStatus: 'failed',
      hasActiveExecutionEvidence: true,
      requiresAgentContinuation: false,
      failureMessage: '根工作流已失败',
    })).toEqual(activeArtifactView)
  })
})

describe('resolveAsyncArtifactProgress', () => {
  it('uses persisted node evidence to distinguish accepted, running and completed assets', () => {
    const base = {
      toolCallId: 'tool-1',
      assetType: 'image' as const,
      taskId: 'task-1',
      runId: '',
      failureReason: '',
    }
    expect(resolveAsyncArtifactProgress([
      { ...base, nodeId: 'node-1', status: 'running' },
      { ...base, nodeId: 'node-2', status: 'succeeded' },
      { ...base, nodeId: 'node-3', status: 'queued' },
    ])).toEqual({
      label: '后台素材正在生成',
      detail: '1/3 项已完成，1 项生成中',
      percent: 33,
      tone: 'active',
      workflowNodeId: null,
    })

    expect(resolveAsyncArtifactProgress([
      { ...base, nodeId: 'node-1', status: 'succeeded' },
      { ...base, nodeId: 'node-2', status: 'succeeded' },
      { ...base, nodeId: 'node-3', status: 'succeeded' },
    ])?.label).toBe('后台素材已全部生成')
  })
})

describe('isAsyncProductionProgressDismissible', () => {
  it('只允许关闭已经结束的状态，运行中必须保留停止入口', () => {
    expect(isAsyncProductionProgressDismissible({
      label: '正在生成视频',
      detail: '1/2 完成',
      percent: 50,
      tone: 'active',
      workflowNodeId: 'media-production',
    })).toBe(false)
    expect(isAsyncProductionProgressDismissible({
      label: '后台生成已结束，存在失败',
      detail: '1/2 项成功，1 项失败',
      percent: 100,
      tone: 'failed',
      workflowNodeId: null,
    })).toBe(true)
    expect(isAsyncProductionProgressDismissible({
      label: '后台素材已全部生成',
      detail: '2/2 项已回填画布',
      percent: 100,
      tone: 'ready',
      workflowNodeId: null,
    })).toBe(true)
  })
})

describe('shouldAutoDismissAsyncProductionProgress', () => {
  it('成功和失败终态自动收起，运行、暂停与等待处理状态继续保留', () => {
    const view = (tone: 'active' | 'paused' | 'ready' | 'failed') => ({
      label: tone,
      detail: tone,
      percent: tone === 'active' ? 50 : 100,
      tone,
      workflowNodeId: null,
    })
    expect(shouldAutoDismissAsyncProductionProgress(view('ready'))).toBe(true)
    expect(shouldAutoDismissAsyncProductionProgress(view('failed'))).toBe(true)
    expect(shouldAutoDismissAsyncProductionProgress(view('active'))).toBe(false)
    expect(shouldAutoDismissAsyncProductionProgress(view('paused'))).toBe(false)
    expect(shouldAutoDismissAsyncProductionProgress(null)).toBe(false)
  })
})

describe('resolveVideoProductionWorkflowNode', () => {
  it('projects canonical run enums onto the bounded seven-stage workflow', () => {
    expect(resolveVideoProductionWorkflowNode([], true)).toBe('production-contract')
    expect(resolveVideoProductionWorkflowNode([run('planned', 0, 8)], false)).toBe('story-adaptation')
    expect(resolveVideoProductionWorkflowNode([{
      ...run('collecting', 0, 8),
      authoringState: 'writing_dispatched',
    }], false)).toBe('clip-contracts')
    expect(resolveVideoProductionWorkflowNode([{
      ...run('collecting', 0, 8),
      authoringState: 'deriving_assets',
    }], false)).toBe('asset-preparation')
    expect(resolveVideoProductionWorkflowNode([run('video_running', 3, 8)], false)).toBe('media-production')
    expect(resolveVideoProductionWorkflowNode([run('video_success', 8, 8)], false)).toBe('composition')
    expect(resolveVideoProductionWorkflowNode([run('concatenated', 8, 8)], false)).toBe('delivery')
  })
})
