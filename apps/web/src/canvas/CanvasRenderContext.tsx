import React from 'react'

export type CanvasRenderContextValue = {
  heavySelectionActive: boolean
  heavySelectionDragging: boolean
  selectedNodeCount: number
}

const DEFAULT_CANVAS_RENDER_CONTEXT: CanvasRenderContextValue = {
  heavySelectionActive: false,
  heavySelectionDragging: false,
  selectedNodeCount: 0,
}

export const CanvasRenderContext = React.createContext<CanvasRenderContextValue>(
  DEFAULT_CANVAS_RENDER_CONTEXT,
)

export function useCanvasRenderContext(): CanvasRenderContextValue {
  return React.useContext(CanvasRenderContext)
}
