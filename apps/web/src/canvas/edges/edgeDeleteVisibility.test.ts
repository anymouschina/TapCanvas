import { describe, expect, it } from 'vitest'
import { shouldShowEdgeDeleteAction } from './edgeDeleteVisibility'

describe('shouldShowEdgeDeleteAction', () => {
  it('shows the action only for the sole selected edge', () => {
    expect(shouldShowEdgeDeleteAction({
      edgeSelected: true,
      selectedNodeCount: 0,
      selectedEdgeCount: 1,
      isBoxSelecting: false,
    })).toBe(true)
  })

  it('hides the action for hover and multi-selection states', () => {
    const hiddenStates = [
      { edgeSelected: false, selectedNodeCount: 0, selectedEdgeCount: 0, isBoxSelecting: false },
      { edgeSelected: true, selectedNodeCount: 1, selectedEdgeCount: 1, isBoxSelecting: false },
      { edgeSelected: true, selectedNodeCount: 0, selectedEdgeCount: 2, isBoxSelecting: false },
      { edgeSelected: true, selectedNodeCount: 0, selectedEdgeCount: 1, isBoxSelecting: true },
    ]

    hiddenStates.forEach((state) => {
      expect(shouldShowEdgeDeleteAction(state)).toBe(false)
    })
  })
})
