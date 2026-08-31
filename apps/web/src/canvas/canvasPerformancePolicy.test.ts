import { describe, expect, it } from 'vitest'
import {
  CANVAS_LOD_OVERVIEW_ENTER_ZOOM,
  CANVAS_LOD_OVERVIEW_EXIT_ZOOM,
  CANVAS_MIN_ZOOM,
  CANVAS_OVERVIEW_IMAGE_WIDTH,
  CANVAS_SHELL_IMAGE_WIDTH,
  CANVAS_VIRTUALIZATION_NODE_THRESHOLD,
  shouldUseCanvasOverviewLod,
  shouldVirtualizeCanvas,
} from './canvasPerformancePolicy'

describe('canvas performance policy', () => {
  it('keeps small canvases resident through the threshold', () => {
    expect(CANVAS_VIRTUALIZATION_NODE_THRESHOLD).toBe(24)
    expect(shouldVirtualizeCanvas(0)).toBe(false)
    expect(shouldVirtualizeCanvas(24)).toBe(false)
  })

  it('enables visible-node virtualization above the threshold', () => {
    expect(shouldVirtualizeCanvas(25)).toBe(true)
    expect(shouldVirtualizeCanvas(1000)).toBe(true)
  })

  it('uses bounded image widths for normal and overview shells', () => {
    expect(CANVAS_OVERVIEW_IMAGE_WIDTH).toBe(512)
    expect(CANVAS_SHELL_IMAGE_WIDTH).toBe(750)
    expect(CANVAS_OVERVIEW_IMAGE_WIDTH).toBeLessThan(CANVAS_SHELL_IMAGE_WIDTH)
  })

  it('keeps overview LOD reachable and gives it hysteresis', () => {
    expect(CANVAS_MIN_ZOOM).toBeLessThan(CANVAS_LOD_OVERVIEW_ENTER_ZOOM)
    expect(CANVAS_LOD_OVERVIEW_ENTER_ZOOM).toBeLessThan(CANVAS_LOD_OVERVIEW_EXIT_ZOOM)
    expect(shouldUseCanvasOverviewLod({ heavyCanvas: true, zoom: 0.3, currentlyOverview: false })).toBe(true)
    expect(shouldUseCanvasOverviewLod({ heavyCanvas: true, zoom: 0.35, currentlyOverview: true })).toBe(true)
    expect(shouldUseCanvasOverviewLod({ heavyCanvas: true, zoom: 0.39, currentlyOverview: true })).toBe(false)
    expect(shouldUseCanvasOverviewLod({ heavyCanvas: false, zoom: 0.1, currentlyOverview: true })).toBe(false)
  })
})
