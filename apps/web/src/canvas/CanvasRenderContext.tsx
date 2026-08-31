import React from 'react'

type ProjectSnapshot = {
  id?: string | null
  name: string
  owner?: string | null
  ownerId?: string | null
  ownerName?: string | null
  isPublic?: boolean | null
  teamId?: string | null
} | null

export type CanvasRenderContextValue = {
  heavySelectionActive: boolean
  heavySelectionDragging: boolean
  selectedNodeCount: number
  isBoxSelecting: boolean
  viewOnly: boolean
  edgeRoute: 'smooth' | 'orth'
  currentProject: ProjectSnapshot
}

const DEFAULT_CANVAS_RENDER_CONTEXT: CanvasRenderContextValue = {
  heavySelectionActive: false,
  heavySelectionDragging: false,
  selectedNodeCount: 0,
  isBoxSelecting: false,
  viewOnly: false,
  edgeRoute: 'smooth',
  currentProject: null,
}

export const CanvasRenderContext = React.createContext<CanvasRenderContextValue>(
  DEFAULT_CANVAS_RENDER_CONTEXT,
)

export function useCanvasRenderContext(): CanvasRenderContextValue {
  return React.useContext(CanvasRenderContext)
}
