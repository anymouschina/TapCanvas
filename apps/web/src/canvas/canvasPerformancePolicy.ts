export const CANVAS_VIRTUALIZATION_NODE_THRESHOLD = 24
export const CANVAS_MIN_ZOOM = 0.08
export const CANVAS_LOD_OVERVIEW_ENTER_ZOOM = 0.32
export const CANVAS_LOD_OVERVIEW_EXIT_ZOOM = 0.38
export const CANVAS_SHELL_IMAGE_WIDTH = 750
export const CANVAS_OVERVIEW_IMAGE_WIDTH = 512

export function shouldVirtualizeCanvas(nodeCount: number): boolean {
  return nodeCount > CANVAS_VIRTUALIZATION_NODE_THRESHOLD
}

export function shouldUseCanvasOverviewLod(input: Readonly<{
  heavyCanvas: boolean
  zoom: number
  currentlyOverview: boolean
}>): boolean {
  if (!input.heavyCanvas) return false
  return input.currentlyOverview
    ? input.zoom < CANVAS_LOD_OVERVIEW_EXIT_ZOOM
    : input.zoom <= CANVAS_LOD_OVERVIEW_ENTER_ZOOM
}
