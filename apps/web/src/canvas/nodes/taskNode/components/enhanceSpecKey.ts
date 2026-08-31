import type { EnhanceParams } from './VideoEnhancePanel'

/**
 * 计算视频超分计费规格 key，格式：`{version}:{tier}:{band}`
 * 示例：standard:1080p:lte30、professional:4k:gt30
 *
 * 规则：
 * - version: standard | professional
 * - tier（预设）: 直接用 resolution 字段；（短边像素）≤720→720p, ≤1080→1080p, ≤1440→2k, 否则 4k；默认 1080p
 * - band: fps > 30 → gt30；否则 lte30（含 undefined）
 */
export function computeEnhanceSpecKey(p: EnhanceParams): string {
  const v = p.tool_version === 'professional' ? 'professional' : 'standard'
  let tier: string
  if (p.resolution) {
    tier = p.resolution.toLowerCase()
  } else if (p.resolution_limit && p.resolution_limit > 0) {
    const l = Math.min(2160, Math.max(64, p.resolution_limit))
    tier = l <= 720 ? '720p' : l <= 1080 ? '1080p' : l <= 1440 ? '2k' : '4k'
  } else {
    tier = '1080p'
  }
  const band = (p.fps ?? 0) > 30 ? 'gt30' : 'lte30'
  return `${v}:${tier}:${band}`
}
