import { describe, expect, it } from 'vitest'
import type { VideoRunStatus } from '../../runner/videoRunStore'
import { VIDEO_RUN_STATUS_PROTOCOL_VERSION, type VideoRunState } from '@tapcanvas/video-orchestrator-protocol'
import { resolveDirectorPetProductionActivity } from './directorPetProductionActivity'

function run(state: VideoRunState, clipsDone = 0, totalClips = 0): VideoRunStatus {
  return {
    protocolVersion: VIDEO_RUN_STATUS_PROTOCOL_VERSION,
    runId: `run-${state}`,
    flowId: null,
    state,
    totalClips,
    clipsDone,
    errorMessage: null,
    completedAt: null,
    authoringState: null,
    authoringClipsReady: 0,
    authoringTotalClips: 0,
    chapterId: null,
    chapterTitle: null,
    updatedAt: '2026-08-03T05:00:00.000Z',
  }
}

describe('resolveDirectorPetProductionActivity', () => {
  it('returns no production activity without active runs', () => {
    expect(resolveDirectorPetProductionActivity([])).toBeNull()
  })

  it('maps collecting to a truthful planning presentation', () => {
    expect(resolveDirectorPetProductionActivity([run('collecting')])).toEqual({
      animationState: 'idea',
      bubbleText: '正在拆解镜头',
      phase: 'planning',
    })
  })

  it('aggregates real clip progress across rendering runs', () => {
    expect(resolveDirectorPetProductionActivity([
      run('video_running', 7, 12),
      run('scheduled', 1, 3),
    ])).toEqual({
      animationState: 'working',
      bubbleText: '正在出片 · 8/15 段',
      phase: 'rendering',
    })
  })

  it('does not present clips-ready as a background production phase', () => {
    expect(resolveDirectorPetProductionActivity([run('video_success', 12, 12)])).toBeNull()
  })
})
