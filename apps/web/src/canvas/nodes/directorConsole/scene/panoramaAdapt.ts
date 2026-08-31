// 全景图自适应（吸收 storyai-3d-director-desk 的 panoramaImport 像素算法）。
// 等距全景要求 2:1；非 2:1 的普通图（生图产物/剧照）直接当 equirect 会严重拉伸。
// 处理管线：cover 铺满 2:1 画布 → 找最低能量列当接缝(seam relocation) → 接缝两侧对称混合 → 极点行软化。
// 处理后贴到 BackSide 穹顶(backdrop)，比裸 equirect 自然得多。纯像素函数可单测；canvas/加载放 Viewport。

export const PANORAMA_RATIO = 2
export const PANORAMA_RATIO_TOLERANCE = 0.02
export const PANORAMA_MIN_WIDTH = 2048
export const PANORAMA_MAX_WIDTH = 4096
const SEAM_BLEND_RATIO = 0.035
const SEAM_MIN_WIDTH = 32
const SEAM_MAX_WIDTH = 192
const POLE_BLEND_RATIO = 0.16
const POLE_MIN_HEIGHT = 48
const POLE_MAX_HEIGHT = 220

export function isPanoramaRatio(width: number, height: number): boolean {
  return height > 0 && Math.abs(width / height - PANORAMA_RATIO) <= PANORAMA_RATIO_TOLERANCE
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

function roundToEven(value: number) {
  const rounded = Math.round(value)
  return rounded % 2 === 0 ? rounded : rounded + 1
}

/** 目标 2:1 画布尺寸：不小于源图宽、限制在 [2048, 4096] */
export function panoramaCanvasSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const desired = Math.max(sourceWidth, sourceHeight * PANORAMA_RATIO, PANORAMA_MIN_WIDTH)
  const width = roundToEven(clamp(desired, PANORAMA_MIN_WIDTH, PANORAMA_MAX_WIDTH))
  return { width, height: width / PANORAMA_RATIO }
}

export function seamBlendWidth(width: number): number {
  return clamp(Math.round(width * SEAM_BLEND_RATIO), SEAM_MIN_WIDTH, SEAM_MAX_WIDTH)
}

export function poleBlendHeight(height: number): number {
  return clamp(Math.round(height * POLE_BLEND_RATIO), POLE_MIN_HEIGHT, POLE_MAX_HEIGHT)
}

/** 某列与其左邻列的像素跳变能量（上下 8% 极点区不计入） */
function columnTransitionScore(pixels: Uint8ClampedArray, width: number, height: number, seamColumn: number) {
  const topGuard = Math.max(0, Math.min(height - 1, Math.round(height * 0.08)))
  const bottomGuard = Math.max(topGuard + 1, height - topGuard)
  let score = 0
  for (let y = topGuard; y < bottomGuard; y += 1) {
    const left = (y * width + (seamColumn - 1)) * 4
    const right = (y * width + seamColumn) * 4
    score += Math.abs((pixels[left] ?? 0) - (pixels[right] ?? 0))
    score += Math.abs((pixels[left + 1] ?? 0) - (pixels[right + 1] ?? 0))
    score += Math.abs((pixels[left + 2] ?? 0) - (pixels[right + 2] ?? 0))
    score += Math.abs((pixels[left + 3] ?? 255) - (pixels[right + 3] ?? 255))
  }
  return score
}

/** 找像素跳变最小的列作为环绕接缝落点 */
export function findLowestEnergySeamColumn(pixels: Uint8ClampedArray, width: number, height: number): number {
  if (width <= 1) return 0
  let bestColumn = 1
  let bestScore = Number.POSITIVE_INFINITY
  for (let col = 1; col < width; col += 1) {
    const score = columnTransitionScore(pixels, width, height, col)
    if (score < bestScore) {
      bestScore = score
      bestColumn = col
    }
  }
  return bestColumn
}

/** 横向循环平移，把最低能量列挪到 x=0（环绕接缝落在最不显眼处） */
export function relocatePanoramaSeamPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seamColumn = findLowestEnergySeamColumn(pixels, width, height),
): Uint8ClampedArray {
  const seam = width > 0 ? ((Math.round(seamColumn) % width) + width) % width : 0
  if (seam === 0) return new Uint8ClampedArray(pixels)
  const next = new Uint8ClampedArray(pixels.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + ((x + seam) % width)) * 4
      const dst = (y * width + x) * 4
      next[dst] = pixels[src] ?? 0
      next[dst + 1] = pixels[src + 1] ?? 0
      next[dst + 2] = pixels[src + 2] ?? 0
      next[dst + 3] = pixels[src + 3] ?? 255
    }
  }
  return next
}

/** 左右边缘对称混合，消掉环绕接缝的硬跳变 */
export function blendPanoramaSeamPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seamWidth: number,
): Uint8ClampedArray {
  const next = new Uint8ClampedArray(pixels)
  const maxDistance = Math.max(1, seamWidth - 1)
  for (let y = 0; y < height; y += 1) {
    for (let distance = 0; distance < seamWidth; distance += 1) {
      const left = (y * width + distance) * 4
      const right = (y * width + (width - 1 - distance)) * 4
      const blend = distance / maxDistance
      for (let ch = 0; ch < 4; ch += 1) {
        const l = pixels[left + ch] ?? 0
        const r = pixels[right + ch] ?? 0
        const avg = Math.round((l + r) / 2)
        next[left + ch] = Math.round(avg + (l - avg) * blend)
        next[right + ch] = Math.round(avg + (r - avg) * blend)
      }
    }
  }
  return next
}

function averageRowColor(pixels: Uint8ClampedArray, width: number, row: number) {
  let r = 0, g = 0, b = 0, a = 0
  for (let x = 0; x < width; x += 1) {
    const i = (row * width + x) * 4
    r += pixels[i] ?? 0
    g += pixels[i + 1] ?? 0
    b += pixels[i + 2] ?? 0
    a += pixels[i + 3] ?? 0
  }
  return [Math.round(r / width), Math.round(g / width), Math.round(b / width), Math.round(a / width)] as const
}

/** 顶/底若干行向该区平均色渐变收敛，压掉穹顶极点的收束畸变 */
export function softenPanoramaPolePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  blendHeight: number,
): Uint8ClampedArray {
  const next = new Uint8ClampedArray(pixels)
  const topRef = Math.min(height - 1, blendHeight)
  const bottomRef = Math.max(0, height - 1 - blendHeight)
  const topColor = averageRowColor(pixels, width, topRef)
  const bottomColor = averageRowColor(pixels, width, bottomRef)
  const maxDistance = Math.max(1, blendHeight - 1)
  for (let y = 0; y < blendHeight; y += 1) {
    const blend = Math.pow(y / maxDistance, 1.35)
    for (let x = 0; x < width; x += 1) {
      const top = (y * width + x) * 4
      const bottom = ((height - 1 - y) * width + x) * 4
      for (let ch = 0; ch < 4; ch += 1) {
        const t = pixels[top + ch] ?? 0
        const b = pixels[bottom + ch] ?? 0
        next[top + ch] = Math.round(topColor[ch] + (t - topColor[ch]) * blend)
        next[bottom + ch] = Math.round(bottomColor[ch] + (b - bottomColor[ch]) * blend)
      }
    }
  }
  return next
}

/** 完整管线：seam 重定位 → 接缝混合 → 极点软化（就地作用于 ImageData 像素数组的拷贝） */
export function adaptPanoramaPixels(pixels: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const relocated = relocatePanoramaSeamPixels(pixels, width, height)
  const seamSafe = blendPanoramaSeamPixels(relocated, width, height, seamBlendWidth(width))
  return softenPanoramaPolePixels(seamSafe, width, height, poleBlendHeight(height))
}
