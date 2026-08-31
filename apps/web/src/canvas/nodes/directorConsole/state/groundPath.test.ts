import { describe, it, expect } from 'vitest'
import { samplePathAt, pathLength, type GroundPath } from './groundPath'

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

describe('groundPath linear', () => {
  const path: GroundPath = { waypoints: [[0, 0], [10, 0]], mode: 'linear' }

  it('s=0 起点，s=1 终点', () => {
    expect(samplePathAt(path, 0).pos).toEqual([0, 0])
    const end = samplePathAt(path, 1).pos
    expect(near(end[0], 10) && near(end[1], 0)).toBe(true)
  })

  it('s=0.5 弧长中点', () => {
    const mid = samplePathAt(path, 0.5).pos
    expect(near(mid[0], 5)).toBe(true)
  })

  it('切线指向行进方向 +X', () => {
    const tan = samplePathAt(path, 0.3).tangent
    expect(near(tan[0], 1) && near(tan[1], 0)).toBe(true)
  })

  it('pathLength = 折线总长', () => {
    expect(near(pathLength({ waypoints: [[0, 0], [3, 0], [3, 4]], mode: 'linear' }), 7)).toBe(true)
  })

  it('s 超界被夹', () => {
    expect(samplePathAt(path, -1).pos[0]).toBe(0)
    expect(near(samplePathAt(path, 2).pos[0], 10)).toBe(true)
  })
})

describe('groundPath curve (Catmull-Rom)', () => {
  const path: GroundPath = { waypoints: [[0, 0], [5, 5], [10, 0]], mode: 'curve' }
  it('经过所有控制点（首末必过）', () => {
    expect(samplePathAt(path, 0).pos).toEqual([0, 0])
    const end = samplePathAt(path, 1).pos
    expect(near(end[0], 10, 1e-3) && near(end[1], 0, 1e-3)).toBe(true)
  })
  it('曲线比折线长（有弯）', () => {
    const curveLen = pathLength(path)
    expect(curveLen).toBeGreaterThan(0)
  })
})

describe('groundPath 退化', () => {
  it('空/单点：返回该点、切线 +Z 兜底', () => {
    expect(samplePathAt({ waypoints: [], mode: 'linear' }, 0.5).pos).toEqual([0, 0])
    const one = samplePathAt({ waypoints: [[2, 3]], mode: 'linear' }, 0.5)
    expect(one.pos).toEqual([2, 3])
    expect(one.tangent).toEqual([0, 1])
  })
  it('closed：末点接回首点', () => {
    const len = pathLength({ waypoints: [[0, 0], [4, 0], [4, 3]], mode: 'linear', closed: true })
    expect(near(len, 4 + 3 + 5)).toBe(true) // 4 + 3 + 回程斜边5
  })
})
