import { describe, expect, it } from 'vitest'
import type { VideoRunStatusEvent } from '@tapcanvas/video-orchestrator-protocol'
import {
  getVideoClipStatusLabel,
  readVideoClipRunId,
  resolveVideoClipCanvasFacts,
} from './videoClipCanvasFacts'

const run: VideoRunStatusEvent = {
  protocolVersion: '2',
  runId: 'run-42',
  flowId: 'flow-42',
  state: 'video_running',
  totalClips: 4,
  clipsDone: 1,
  errorMessage: null,
  completedAt: null,
  authoringState: 'assets_ready',
  authoringClipsReady: 4,
  authoringTotalClips: 4,
  chapterId: 'chapter-1',
  chapterTitle: '第一章',
  updatedAt: '2026-08-07T12:00:00.000Z',
}

describe('resolveVideoClipCanvasFacts', () => {
  it('把结构化编排事实投影为画布可读的连续性与交付摘要', () => {
    const facts = resolveVideoClipCanvasFacts('clip-2', {
      label: '镜头 03',
      clipRunId: 'run-42',
      clipIndex: 2,
      status: 'planned',
      durationSeconds: 6,
      videoModel: 'seedance-2.0',
      generationContract: { aspect: '9:16', resolution: '1080p', contractVersion: 'v3' },
      sceneName: '雨夜车站',
      characterRoleNames: ['林默', '沈遥'],
      characterStates: { '林默': '湿透、警觉' },
      propNames: ['旧伞'],
      vfxNames: ['雨幕'],
      continuityMode: 'bridge_frames',
      expectedPrevClipIndex: 1,
      timeJumpNote: '紧接上一镜的十秒后',
      exitState: '两人同时看向站台出口',
      storyboardImageNodeId: 'storyboard-2',
      lastFrameImageNodeId: 'frame-2-last',
      firstFrameUrl: 'https://oss.example/first.png',
      lastFrameUrl: 'https://oss.example/last.png',
      videoReferenceNodeIds: ['character-lin', 'storyboard-2'],
      referenceImageBindings: [{ nodeId: 'character-lin', name: '林默', referenceRole: 'character', source: 'canvas' }],
      assetObjectContracts: [{
        kind: 'character',
        name: '林默',
        referenceRole: 'identity',
        referenceImageNodeIds: ['character-lin'],
        forbiddenTransfer: '不得迁移发型与外套颜色',
      }],
      assetBindingDiagnostics: ['storyboard-2 已绑定'],
      prompt: '只读执行 prompt',
      promptRevision: 'rev-3',
      videoTaskId: 'task-42',
      videoUrl: 'https://oss.example/clip.mp4',
    }, run)

    expect(facts.isOrchestrated).toBe(true)
    expect(facts.status).toBe('planned')
    expect(facts.statusLabel).toBe('已规划')
    expect(facts.clipIndex).toBe(2)
    expect(facts.sceneName).toBe('雨夜车站')
    expect(facts.characterRoleNames).toEqual(['林默', '沈遥'])
    expect(facts.continuityMode).toBe('bridge_frames')
    expect(facts.expectedPrevClipIndex).toBe(1)
    expect(facts.videoReferenceNodeIds).toEqual(['character-lin', 'storyboard-2'])
    expect(facts.assetObjectContracts[0]?.forbiddenTransfer).toBe('不得迁移发型与外套颜色')
    expect(facts.videoUrl).toBe('https://oss.example/clip.mp4')
    expect(facts.productionState).toBe('video_running')
    expect(facts.prompt).toBe('只读执行 prompt')
  })

  it('没有节点状态时使用同 run 的服务器状态，节点显式状态优先', () => {
    const fromRun = resolveVideoClipCanvasFacts('clip-1', { clipRunId: 'run-42' }, run)
    expect(fromRun.status).toBe('running')
    expect(getVideoClipStatusLabel(fromRun.status)).toBe('生成中')

    const explicit = resolveVideoClipCanvasFacts('clip-1', {
      clipRunId: 'run-42',
      status: 'success',
    }, run)
    expect(explicit.status).toBe('success')
  })

  it('没有真实 run 身份时不把普通视频节点误判为编排镜头', () => {
    const facts = resolveVideoClipCanvasFacts('plain-video', {
      kind: 'video',
      status: 'success',
      videoUrl: 'https://oss.example/plain.mp4',
    }, run)
    expect(facts.isOrchestrated).toBe(false)
    expect(facts.runId).toBeNull()
    expect(readVideoClipRunId({ clipRunId: '  ' })).toBeNull()
  })
})
