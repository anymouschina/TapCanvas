import { describe, expect, it } from 'vitest'
import {
  LIBTV_IMAGE_GRID_SPLIT_ACTIONS,
  LIBTV_IMAGE_HD_ACTIONS,
  LIBTV_IMAGE_PORTRAIT_ACTIONS,
} from './libTvImageToolbar'

describe('LibTV image toolbar contracts', () => {
  it('matches the portrait and HD submenu labels and order', () => {
    expect(LIBTV_IMAGE_PORTRAIT_ACTIONS.map((item) => item.label)).toEqual([
      '人像调节',
      '情绪调节',
    ])
    expect(LIBTV_IMAGE_HD_ACTIONS.map((item) => item.label)).toEqual([
      '高清',
      '扩图',
      '重绘',
      '擦除',
      '抠图',
      '裁剪',
    ])
  })

  it('matches every fixed grid split size and order', () => {
    expect(LIBTV_IMAGE_GRID_SPLIT_ACTIONS).toEqual([
      { key: '2x2', label: '4宫格 (2×2)', rows: 2, cols: 2 },
      { key: '3x3', label: '9宫格 (3×3)', rows: 3, cols: 3 },
      { key: '4x4', label: '16宫格 (4×4)', rows: 4, cols: 4 },
      { key: '5x5', label: '25宫格 (5×5)', rows: 5, cols: 5 },
    ])
  })
})
