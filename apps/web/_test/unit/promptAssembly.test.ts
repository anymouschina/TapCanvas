import { describe, expect, it } from 'vitest'
import { mergeExecutionPromptSequence } from '../../src/runner/promptAssembly'

describe('prompt assembly', () => {
  it('prioritizes composeVideo own prompt before upstream context', () => {
    const result = mergeExecutionPromptSequence({
      kind: 'composeVideo',
      ownPrompt: '视频节点自己的 prompt，包含对白约束。',
      upstreamPrompts: ['上游分镜脚本', '人物台词：方源：青山落日'],
      cameraRefPrompts: ['镜头约束：低角度轻推'],
    })

    expect(result).toEqual([
      '视频节点自己的 prompt，包含对白约束。',
      '上游分镜脚本',
      '人物台词：方源：青山落日',
      '镜头约束：低角度轻推',
    ])
  })

  it('keeps non-video node ordering as upstream first', () => {
    const result = mergeExecutionPromptSequence({
      kind: 'image',
      ownPrompt: '当前节点 prompt',
      upstreamPrompts: ['上游文本依据'],
      cameraRefPrompts: ['镜头约束'],
    })

    expect(result).toEqual(['上游文本依据', '当前节点 prompt', '镜头约束'])
  })
})
