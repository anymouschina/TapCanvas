import { describe, expect, it } from 'vitest'

import { resolveAiChatReloadAutoRunPlan } from './canvasMutation'

describe('resolveAiChatReloadAutoRunPlan', () => {
  it('continues persisted executable nodes even when the terminal chat claim failed', () => {
    expect(resolveAiChatReloadAutoRunPlan({
      newNodeIds: ['audio-1', 'text-1'],
      failedTurn: true,
      traceCanvasMutation: {
        createdNodeIds: ['audio-1', 'text-1'],
        patchedNodeIds: ['image-1'],
        executableNodeIds: ['audio-1', 'image-1'],
      },
    })).toEqual({
      focusNodeIds: ['audio-1', 'text-1'],
      autoRunNewNodeIds: ['audio-1'],
      autoRunPatchedNodeIds: ['image-1'],
    })
  })

  it('does not infer execution from failed-turn node creation without trace evidence', () => {
    expect(resolveAiChatReloadAutoRunPlan({
      newNodeIds: ['audio-1'],
      failedTurn: true,
      traceCanvasMutation: null,
    })).toEqual({
      focusNodeIds: ['audio-1'],
      autoRunNewNodeIds: [],
      autoRunPatchedNodeIds: [],
    })
  })
})
