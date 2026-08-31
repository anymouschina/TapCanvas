import type { VideoRunStatus } from '../../runner/videoRunStore'
import type { VideoRunState } from '@tapcanvas/video-orchestrator-protocol'
import type { DirectorPetAnimationState } from './directorPetAnimation'

export type DirectorPetProductionActivity = {
  animationState: DirectorPetAnimationState
  bubbleText: string
  phase: 'planning' | 'rendering' | 'finishing'
}

const PLANNING_STATES = new Set<VideoRunState>(['collecting', 'planned'])
const FINISHING_STATES = new Set<VideoRunState>(['concatenating'])

function sumClipProgress(runs: VideoRunStatus[]): { clipsDone: number; totalClips: number } {
  return runs.reduce(
    (progress, run) => ({
      clipsDone: progress.clipsDone + Math.max(0, run.clipsDone),
      totalClips: progress.totalClips + Math.max(0, run.totalClips),
    }),
    { clipsDone: 0, totalClips: 0 },
  )
}

export function resolveDirectorPetProductionActivity(
  activeRuns: VideoRunStatus[],
): DirectorPetProductionActivity | null {
  const backgroundRuns = activeRuns.filter((run) => run.state !== 'video_success')
  if (backgroundRuns.length === 0) return null

  const progress = sumClipProgress(backgroundRuns)
  const hasRenderingRun = backgroundRuns.some((run) => run.state === 'scheduled' || run.state === 'video_running')
  if (hasRenderingRun) {
    const progressLabel = progress.totalClips > 0
      ? ` · ${progress.clipsDone}/${progress.totalClips} 段`
      : ''
    return {
      animationState: 'working',
      bubbleText: `正在出片${progressLabel}`,
      phase: 'rendering',
    }
  }

  if (backgroundRuns.some((run) => FINISHING_STATES.has(run.state))) {
    return {
      animationState: 'working',
      bubbleText: '正在完成后台收尾',
      phase: 'finishing',
    }
  }

  if (backgroundRuns.some((run) => PLANNING_STATES.has(run.state))) {
    return {
      animationState: 'idea',
      bubbleText: '正在拆解镜头',
      phase: 'planning',
    }
  }

  return {
    animationState: 'working',
    bubbleText: '正在推进后台任务',
    phase: 'rendering',
  }
}
