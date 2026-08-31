import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import { shouldAutoRunAiChatNode } from './autoRunCanvasNodes'

function audioNode(data: Record<string, unknown>): Node {
  return {
    id: 'audio-1',
    type: 'taskNode',
    position: { x: 0, y: 0 },
    data: { kind: 'audio', ...data },
  }
}

describe('shouldAutoRunAiChatNode audio execution', () => {
  it('accepts a persisted audio node only when text and an exact model are present', () => {
    expect(shouldAutoRunAiChatNode(audioNode({
      text: '旁白正文',
      audioModel: 'runtime-audio-model',
      aiChatAutoRun: true,
    }))).toBe(true)

    expect(shouldAutoRunAiChatNode(audioNode({ text: '旁白正文' }))).toBe(false)
    expect(shouldAutoRunAiChatNode(audioNode({ audioModel: 'runtime-audio-model' }))).toBe(false)
  })

  it('does not resubmit active or completed audio work', () => {
    expect(shouldAutoRunAiChatNode(audioNode({
      text: '旁白正文',
      audioModel: 'runtime-audio-model',
      status: 'running',
    }))).toBe(false)
    expect(shouldAutoRunAiChatNode(audioNode({
      text: '旁白正文',
      audioModel: 'runtime-audio-model',
      audioUrl: 'https://assets.example/audio.mp3',
    }))).toBe(false)
  })
})
