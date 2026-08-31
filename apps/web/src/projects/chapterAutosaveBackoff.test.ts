import { describe, it, expect } from 'vitest'
import { conflictBackoffMs } from './chapterAutosaveBackoff'

// 整图 autosave 的冲突退避曲线。修复点:退避必须按「连续冲突次数」升级,
// 才能让两个写者(双页签/双挂载)在几轮内错峰收敛,而不是全速 409 乒乓。
describe('conflictBackoffMs', () => {
  it('无冲突不退避', () => {
    expect(conflictBackoffMs(0)).toBe(0)
    expect(conflictBackoffMs(-1)).toBe(0)
  })

  it('随连续冲突指数升级', () => {
    expect(conflictBackoffMs(1)).toBe(600)
    expect(conflictBackoffMs(2)).toBe(1200)
    expect(conflictBackoffMs(3)).toBe(2400)
    expect(conflictBackoffMs(4)).toBe(4800)
  })

  it('封顶 30s,防止永久卡死自动保存', () => {
    expect(conflictBackoffMs(100)).toBe(30_000)
    expect(conflictBackoffMs(7)).toBeLessThanOrEqual(30_000)
  })

  it('单调不减', () => {
    let prev = -1
    for (let s = 0; s <= 12; s++) {
      const v = conflictBackoffMs(s)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
})
