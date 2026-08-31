import React from 'react'

export type EdgeInteractionContextValue = {
  selectedNodeCount: number
  selectedEdgeCount: number
  isBoxSelecting: boolean
}

const DEFAULT_EDGE_INTERACTION_CONTEXT: EdgeInteractionContextValue = {
  selectedNodeCount: 0,
  selectedEdgeCount: 0,
  isBoxSelecting: false,
}

export const EdgeInteractionContext = React.createContext<EdgeInteractionContextValue>(
  DEFAULT_EDGE_INTERACTION_CONTEXT,
)

export function useEdgeInteractionContext(): EdgeInteractionContextValue {
  return React.useContext(EdgeInteractionContext)
}
