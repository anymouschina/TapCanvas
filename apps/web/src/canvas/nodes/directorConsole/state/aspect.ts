import type { AspectKey } from '../types'

const RATIOS: Record<Exclude<AspectKey, 'auto'>, number> = {
  '21:9': 21 / 9,
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '3:4': 3 / 4,
  '9:16': 9 / 16,
}

/** 返回画幅宽高比（auto 时用传入的视口比值） */
export function aspectRatio(key: AspectKey, viewportRatio: number): number {
  return key === 'auto' ? viewportRatio : RATIOS[key]
}

const LONG_EDGE = 1280

/** 按画幅算截图像素尺寸，长边固定 1280 */
export function captureSize(key: AspectKey, viewportRatio: number): { width: number; height: number } {
  const r = aspectRatio(key, viewportRatio)
  if (r >= 1) return { width: LONG_EDGE, height: Math.round(LONG_EDGE / r) }
  return { width: Math.round(LONG_EDGE * r), height: LONG_EDGE }
}

// ── 画幅取景框（吸收 storyai-3d-director-desk 的 viewportAspectFrame）──
// 视口内按画幅比例内切一个居中框，框外遮罩、框内可叠九宫格；auto 时整个视口即取景框。

export type AspectFrameRect = { width: number; height: number; left: number; top: number }

/** 框到视口边缘的安全留白(px) */
export const FRAME_PADDING = 24

/** 在 width×height 的视口里内切一个 ratio 比例的居中框；视口过小时返回 null */
export function fitAspectFrame(width: number, height: number, ratio: number, padding = FRAME_PADDING): AspectFrameRect | null {
  const safeW = width - padding * 2
  const safeH = height - padding * 2
  if (safeW <= 0 || safeH <= 0 || !Number.isFinite(ratio) || ratio <= 0) return null
  const safeRatio = safeW / safeH
  const w = ratio >= safeRatio ? safeW : safeH * ratio
  const h = ratio >= safeRatio ? safeW / ratio : safeH
  return {
    width: w,
    height: h,
    left: padding + (safeW - w) / 2,
    top: padding + (safeH - h) / 2,
  }
}

/** 画幅框：auto 返回 null（不画框，整视口即画幅） */
export function aspectFrameRect(key: AspectKey, width: number, height: number, padding = FRAME_PADDING): AspectFrameRect | null {
  if (key === 'auto') return null
  return fitAspectFrame(width, height, RATIOS[key], padding)
}
