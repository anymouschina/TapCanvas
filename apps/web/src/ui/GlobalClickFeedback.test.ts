import { describe, expect, it } from 'vitest'
import { buildClickBurstSparks, shouldCreateClickBurst } from './globalClickFeedback.logic'

describe('GlobalClickFeedback', () => {
  it('creates an evenly distributed gray firework burst', () => {
    const sparks = buildClickBurstSparks()

    expect(sparks).toHaveLength(12)
    expect(sparks.map((spark) => spark.angle)).toEqual([
      0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330,
    ])
    expect(sparks.every((spark) => spark.distance >= 20 && spark.distance <= 30)).toBe(true)
  })

  it('only responds to a real main-button click', () => {
    expect(shouldCreateClickBurst({ button: 0, detail: 1 })).toBe(true)
    expect(shouldCreateClickBurst({ button: 2, detail: 1 })).toBe(false)
    expect(shouldCreateClickBurst({ button: 0, detail: 0 })).toBe(false)
  })

  it('leaves locally scoped preview clicks to their own feedback layer', () => {
    const preview = document.createElement('div')
    preview.dataset.clickFeedbackScope = 'local'
    const button = document.createElement('button')
    preview.append(button)

    expect(shouldCreateClickBurst({ button: 0, detail: 1, target: button })).toBe(false)
  })
})
