import { describe, expect, it } from 'vitest'
import { mergeExecutionPromptSequence } from './promptAssembly'

describe('mergeExecutionPromptSequence', () => {
  it('keeps a linked text prompt when compiling a video request', () => {
    expect(mergeExecutionPromptSequence({
      kind: 'video',
      ownPrompt: '',
      upstreamPrompts: ['15 秒日式动画电影感视频提示词'],
      cameraRefPrompts: [],
    })).toEqual(['15 秒日式动画电影感视频提示词'])
  })

  it('appends linked text after the video node prompt', () => {
    expect(mergeExecutionPromptSequence({
      kind: 'composeVideo',
      ownPrompt: '保持上一镜退出态接续',
      upstreamPrompts: ['人物动作与对白细节'],
      cameraRefPrompts: [],
    })).toEqual(['保持上一镜退出态接续', '人物动作与对白细节'])
  })
})
