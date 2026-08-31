import type { Viewport, XYPosition } from '@xyflow/react'

export type CanvasPerformanceApi = {
  getViewport: () => Viewport
  getViewportSize: () => { width: number; height: number }
  beginViewportMove: () => void
  setViewport: (viewport: Viewport) => void
  endViewportMove: (viewport: Viewport) => void
  getNodePosition: (nodeId: string) => XYPosition | null
  beginNodeDrag: (nodeId: string) => boolean
  setNodeDragPosition: (nodeId: string, position: XYPosition) => void
  endNodeDrag: (nodeId: string, position: XYPosition) => void
}
