import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../../config/models'
import {
  readVideoAnalysisModelDescription,
  readVideoUrl,
  shouldAutoStartVideoAnalysis,
  VIDEO_ANALYSIS_CAPABILITY_TAG,
  videoAnalysisModelHasTag,
  videoAnalysisRunButtonLabel,
} from './videoAnalysisRuntime'

const option: ModelOption = {
  value: 'video-analysis-model',
  label: 'Video Analysis Model',
  meta: {
    description: '逐镜视频理解',
    tags: ['TAPCANVAS:CAPABILITY=VIDEO-ANALYSIS'],
  },
}

describe('video analysis runtime facts', () => {
  it('reads capability tags and descriptions from catalog metadata', () => {
    expect(videoAnalysisModelHasTag(option, VIDEO_ANALYSIS_CAPABILITY_TAG)).toBe(true)
    expect(readVideoAnalysisModelDescription(option)).toBe('逐镜视频理解')
  })

  it('uses the explicitly selected video result before the node-level URL', () => {
    expect(readVideoUrl({
      videoUrl: 'https://example.com/fallback.mp4',
      videoPrimaryIndex: 1,
      videoResults: [
        { url: 'https://example.com/first.mp4' },
        { url: 'https://example.com/selected.mp4' },
      ],
    })).toBe('https://example.com/selected.mp4')
  })

  it('exposes an explicit retry action after analysis failure', () => {
    expect(videoAnalysisRunButtonLabel('error')).toBe('重新提取视频观察表')
    expect(videoAnalysisRunButtonLabel('running')).toBe('视频观察校验中')
    expect(videoAnalysisRunButtonLabel('idle')).toBe('提取视频观察表')
  })

  it('starts a requested analysis only after every priced execution fact is ready', () => {
    const ready = {
      requested: true,
      readOnly: false,
      running: false,
      modelLoading: false,
      blockingError: '',
      hasSelectedModel: true,
      hasQuotedCredits: true,
      hasSourceNode: true,
      hasFps: true,
    }

    expect(shouldAutoStartVideoAnalysis(ready)).toBe(true)
    expect(shouldAutoStartVideoAnalysis({ ...ready, hasQuotedCredits: false })).toBe(false)
    expect(shouldAutoStartVideoAnalysis({ ...ready, blockingError: '模型目录不可执行' })).toBe(false)
    expect(shouldAutoStartVideoAnalysis({ ...ready, requested: false })).toBe(false)
  })
})
