export type EdgeDeleteVisibilityState = {
  edgeSelected: boolean
  selectedNodeCount: number
  selectedEdgeCount: number
  isBoxSelecting: boolean
}

export function shouldShowEdgeDeleteAction(state: EdgeDeleteVisibilityState): boolean {
  return (
    state.edgeSelected &&
    state.selectedNodeCount === 0 &&
    state.selectedEdgeCount === 1 &&
    !state.isBoxSelecting
  )
}
