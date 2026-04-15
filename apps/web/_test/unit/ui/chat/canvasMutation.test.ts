import { describe, expect, it } from 'vitest'
import { collectTracePatchedNodeIds, dedupeNodeIds, resolveAiChatReloadAutoRunPlan } from '../../../../src/ui/chat/canvasMutation'

describe('chat canvas mutation helpers', () => {
  it('dedupes and trims node ids', () => {
    expect(dedupeNodeIds([' node-1 ', '', 'node-1', 'node-2'])).toEqual(['node-1', 'node-2'])
  })

  it('merges patched and executable node ids from trace', () => {
    expect(
      collectTracePatchedNodeIds({
        createdNodeIds: ['new-1'],
        patchedNodeIds: ['patched-1', 'shared-1'],
        executableNodeIds: ['shared-1', 'exec-1'],
      }),
    ).toEqual(['patched-1', 'shared-1', 'exec-1'])
  })

  it('builds reload auto-run plan for successful turns', () => {
    expect(
      resolveAiChatReloadAutoRunPlan({
        newNodeIds: ['new-1', 'new-1', 'new-2'],
        traceCanvasMutation: {
          createdNodeIds: ['new-1'],
          patchedNodeIds: ['patched-1'],
          executableNodeIds: ['patched-1', 'exec-1'],
        },
        failedTurn: false,
      }),
    ).toEqual({
      focusNodeIds: ['new-1', 'new-2'],
      autoRunNewNodeIds: ['new-1', 'new-2'],
      autoRunPatchedNodeIds: ['patched-1', 'exec-1'],
    })
  })

  it('suppresses auto-run while still keeping focus ids for failed turns', () => {
    expect(
      resolveAiChatReloadAutoRunPlan({
        newNodeIds: ['new-1', 'new-2'],
        traceCanvasMutation: {
          createdNodeIds: ['new-1'],
          patchedNodeIds: ['patched-1'],
          executableNodeIds: ['exec-1'],
        },
        failedTurn: true,
      }),
    ).toEqual({
      focusNodeIds: ['new-1', 'new-2'],
      autoRunNewNodeIds: [],
      autoRunPatchedNodeIds: [],
    })
  })
})
