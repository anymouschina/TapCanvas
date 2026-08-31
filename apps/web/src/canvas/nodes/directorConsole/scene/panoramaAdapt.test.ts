import { describe, it, expect } from 'vitest'
import {
  isPanoramaRatio, panoramaCanvasSize, seamBlendWidth, poleBlendHeight,
  findLowestEnergySeamColumn, relocatePanoramaSeamPixels, blendPanoramaSeamPixels,
  softenPanoramaPolePixels,
} from './panoramaAdapt'
import { fitAspectFrame, aspectFrameRect, FRAME_PADDING } from '../state/aspect'

/** 构造 width×height 的 RGBA 像素，fill(x,y) 给出灰度 */
function makePixels(width: number, height: number, fill: (x: number, y: number) => number) {
  const p = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = fill(x, y)
      const i = (y * width + x) * 4
      p[i] = v; p[i + 1] = v; p[i + 2] = v; p[i + 3] = 255
    }
  }
  return p
}

describe('panoramaAdapt', () => {
  it('2:1 判定带容差', () => {
    expect(isPanoramaRatio(4096, 2048)).toBe(true)
    expect(isPanoramaRatio(2040, 1024)).toBe(true) // 1.99 在 2% 容差内
    expect(isPanoramaRatio(1920, 1080)).toBe(false)
    expect(isPanoramaRatio(100, 0)).toBe(false)
  })

  it('目标画布固定 2:1、宽度夹在 [2048,4096] 且为偶数', () => {
    expect(panoramaCanvasSize(1024, 768)).toEqual({ width: 2048, height: 1024 })
    expect(panoramaCanvasSize(9999, 100)).toEqual({ width: 4096, height: 2048 })
    const { width, height } = panoramaCanvasSize(3001, 100)
    expect(width % 2).toBe(0)
    expect(width / height).toBe(2)
  })

  it('接缝/极点混合带宽随尺寸缩放且有上下限', () => {
    expect(seamBlendWidth(100)).toBe(32)
    expect(seamBlendWidth(4096)).toBe(143)
    expect(seamBlendWidth(100000)).toBe(192)
    expect(poleBlendHeight(100)).toBe(48)
    expect(poleBlendHeight(2048)).toBe(220)
  })

  it('找到像素跳变最小的列作接缝', () => {
    // 左半黑右半白 → 突变发生在 x=32(0→255) 和回绕处；平滑列应在两片内部
    const w = 64, h = 16
    const pixels = makePixels(w, h, (x) => (x < 32 ? 0 : 255))
    const seam = findLowestEnergySeamColumn(pixels, w, h)
    // 内部任意平滑列能量为 0，不应选到 32(边界)
    expect(seam).not.toBe(32)
  })

  it('seam 重定位是横向循环平移，不丢像素', () => {
    const w = 8, h = 2
    const pixels = makePixels(w, h, (x) => x * 10)
    const moved = relocatePanoramaSeamPixels(pixels, w, h, 3)
    // x=0 处应是原 x=3 的值
    expect(moved[0]).toBe(30)
    // 原样保留全部像素值(集合相等)
    const vals = (arr: Uint8ClampedArray) => Array.from({ length: w }, (_, x) => arr[x * 4]).sort((a, b) => a - b)
    expect(vals(moved)).toEqual(vals(pixels))
    // seam=0 等价拷贝
    expect(Array.from(relocatePanoramaSeamPixels(pixels, w, h, 0))).toEqual(Array.from(pixels))
  })

  it('接缝混合后左右边缘像素相互靠拢', () => {
    const w = 64, h = 4
    // 左边缘黑、右边缘白 → 环绕接缝硬跳变
    const pixels = makePixels(w, h, (x) => (x < 32 ? 0 : 255))
    const blended = blendPanoramaSeamPixels(pixels, w, h, 8)
    // 最边缘两列(distance=0)应被拉到均值 128 附近
    expect(Math.abs(blended[0] - 128)).toBeLessThanOrEqual(1)
    expect(Math.abs(blended[(w - 1) * 4] - 128)).toBeLessThanOrEqual(1)
    // 远离接缝的列不动
    expect(blended[(w / 2) * 4]).toBe(255)
  })

  it('极点软化：顶行收敛到区域平均色，远处不动', () => {
    const w = 16, h = 64
    // 顶部亮、往下渐暗
    const pixels = makePixels(w, h, (_x, y) => Math.min(255, y * 4))
    const soft = softenPanoramaPolePixels(pixels, w, h, 8)
    // y=0 行(blend=0)应完全等于参考行(y=8)的平均色 32
    expect(soft[0]).toBe(32)
    // 中部不受影响
    const mid = (32 * w) * 4
    expect(soft[mid]).toBe(pixels[mid])
  })
})

describe('aspect frame', () => {
  it('宽视口装 16:9：高度顶满安全区，水平居中', () => {
    const r = fitAspectFrame(1000, 400, 16 / 9)!
    expect(r.height).toBeCloseTo(400 - FRAME_PADDING * 2)
    expect(r.width).toBeCloseTo(r.height * (16 / 9))
    expect(r.left).toBeCloseTo((1000 - r.width) / 2)
    expect(r.top).toBe(FRAME_PADDING)
  })

  it('窄视口装 9:16：宽度顶满安全区，垂直居中', () => {
    const r = aspectFrameRect('9:16', 300, 800)!
    expect(r.width).toBeCloseTo(300 - FRAME_PADDING * 2)
    expect(r.height).toBeCloseTo(r.width / (9 / 16))
  })

  it('auto 不画框；视口过小返回 null', () => {
    expect(aspectFrameRect('auto', 800, 600)).toBeNull()
    expect(fitAspectFrame(10, 10, 1)).toBeNull()
  })
})
