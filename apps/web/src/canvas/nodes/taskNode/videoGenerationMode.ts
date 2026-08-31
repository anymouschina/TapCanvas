export type VideoGenerationMode = 'text' | 'image' | 'first-frame' | 'first-last-frame'

export type VideoGenerationModeFacts = {
  firstFrameUrl: string
  lastFrameUrl: string
  referenceCount: number
}

export function resolveVideoGenerationMode(facts: VideoGenerationModeFacts): VideoGenerationMode {
  if (facts.firstFrameUrl.trim()) {
    return facts.lastFrameUrl.trim() ? 'first-last-frame' : 'first-frame'
  }
  return facts.referenceCount > 0 ? 'image' : 'text'
}

export function videoGenerationModeLabel(mode: VideoGenerationMode): string {
  switch (mode) {
    case 'image':
      return '图生视频'
    case 'first-frame':
      return '首帧视频'
    case 'first-last-frame':
      return '首尾帧视频'
    case 'text':
      return '文生视频'
  }
}
