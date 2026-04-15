import { describe, expect, it } from 'vitest'
import { shouldPauseImageWork, type ResourceWorkPauseState } from '../../src/domain/resource-runtime/services/resourceManager'
import type { ResourcePriority } from '../../src/domain/resource-runtime/model/resourceTypes'

function buildPauseState(overrides: Partial<ResourceWorkPauseState> = {}): ResourceWorkPauseState {
  return {
    backgroundPaused: false,
    viewportMoving: false,
    nodeDragging: false,
    ...overrides,
  }
}

describe('resource manager interaction throttling', () => {
  const priorities: ResourcePriority[] = ['critical', 'visible', 'prefetch', 'background']

  it('keeps all priorities active when the canvas is idle', () => {
    for (const priority of priorities) {
      expect(shouldPauseImageWork(priority, buildPauseState())).toBe(false)
    }
  })

  it('pauses every non-critical resource while the viewport is moving', () => {
    expect(shouldPauseImageWork('critical', buildPauseState({ viewportMoving: true }))).toBe(false)
    expect(shouldPauseImageWork('visible', buildPauseState({ viewportMoving: true }))).toBe(true)
    expect(shouldPauseImageWork('prefetch', buildPauseState({ viewportMoving: true }))).toBe(true)
    expect(shouldPauseImageWork('background', buildPauseState({ viewportMoving: true }))).toBe(true)
  })

  it('keeps visible resources alive during node dragging and generic background pause', () => {
    expect(shouldPauseImageWork('visible', buildPauseState({ nodeDragging: true }))).toBe(false)
    expect(shouldPauseImageWork('visible', buildPauseState({ backgroundPaused: true }))).toBe(false)
    expect(shouldPauseImageWork('prefetch', buildPauseState({ nodeDragging: true }))).toBe(true)
    expect(shouldPauseImageWork('background', buildPauseState({ backgroundPaused: true }))).toBe(true)
  })
})
