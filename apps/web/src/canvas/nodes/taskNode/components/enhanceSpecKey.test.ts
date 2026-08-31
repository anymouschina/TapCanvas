import { describe, expect, it } from 'vitest'
import { computeEnhanceSpecKey } from './enhanceSpecKey'
import type { EnhanceParams } from './VideoEnhancePanel'

describe('computeEnhanceSpecKey', () => {
  // ─── 预设档位 ──────────────────────────────────────────────────────────────
  it('预设 standard + 720p → standard:720p:lte30', () => {
    const p: EnhanceParams = { tool_version: 'standard', scene: 'aigc', resolution: '720p' }
    expect(computeEnhanceSpecKey(p)).toBe('standard:720p:lte30')
  })

  it('预设 standard + 1080p → standard:1080p:lte30', () => {
    const p: EnhanceParams = { tool_version: 'standard', scene: 'aigc', resolution: '1080p' }
    expect(computeEnhanceSpecKey(p)).toBe('standard:1080p:lte30')
  })

  it('预设 professional + 4k + fps 60 → professional:4k:gt30', () => {
    const p: EnhanceParams = { tool_version: 'professional', scene: 'aigc', resolution: '4k', fps: 60 }
    expect(computeEnhanceSpecKey(p)).toBe('professional:4k:gt30')
  })

  // ─── 短边像素边界 ──────────────────────────────────────────────────────────
  it('短边 720 → tier 720p', () => {
    const p: EnhanceParams = { tool_version: 'standard', scene: 'aigc', resolution_limit: 720 }
    expect(computeEnhanceSpecKey(p)).toBe('standard:720p:lte30')
  })

  it('短边 721 → tier 1080p（大于 720 进入下一档）', () => {
    const p: EnhanceParams = { tool_version: 'standard', scene: 'aigc', resolution_limit: 721 }
    expect(computeEnhanceSpecKey(p)).toBe('standard:1080p:lte30')
  })

  it('短边 1080 → tier 1080p', () => {
    const p: EnhanceParams = { tool_version: 'standard', scene: 'aigc', resolution_limit: 1080 }
    expect(computeEnhanceSpecKey(p)).toBe('standard:1080p:lte30')
  })

  it('短边 1440 → tier 2k', () => {
    const p: EnhanceParams = { tool_version: 'standard', scene: 'aigc', resolution_limit: 1440 }
    expect(computeEnhanceSpecKey(p)).toBe('standard:2k:lte30')
  })

  it('短边 1441 → tier 4k', () => {
    const p: EnhanceParams = { tool_version: 'standard', scene: 'aigc', resolution_limit: 1441 }
    expect(computeEnhanceSpecKey(p)).toBe('standard:4k:lte30')
  })

  // ─── fps band 边界 ─────────────────────────────────────────────────────────
  it('fps 30 → band lte30', () => {
    const p: EnhanceParams = { tool_version: 'standard', scene: 'aigc', resolution: '1080p', fps: 30 }
    expect(computeEnhanceSpecKey(p)).toBe('standard:1080p:lte30')
  })

  it('fps 31 → band gt30', () => {
    const p: EnhanceParams = { tool_version: 'standard', scene: 'aigc', resolution: '1080p', fps: 31 }
    expect(computeEnhanceSpecKey(p)).toBe('standard:1080p:gt30')
  })

  it('fps undefined → band lte30', () => {
    const p: EnhanceParams = { tool_version: 'standard', scene: 'aigc', resolution: '1080p' }
    expect(computeEnhanceSpecKey(p)).toBe('standard:1080p:lte30')
  })

  // ─── 无 resolution / resolution_limit 时默认 1080p ─────────────────────────
  it('都无 resolution/limit → tier 默认 1080p', () => {
    const p: EnhanceParams = { tool_version: 'standard', scene: 'aigc' }
    expect(computeEnhanceSpecKey(p)).toBe('standard:1080p:lte30')
  })

  // ─── 格式校验：全小写、冒号分隔 ────────────────────────────────────────────
  it('specKey 格式为全小写冒号分隔三段', () => {
    const p: EnhanceParams = { tool_version: 'professional', scene: 'short_series', resolution: '4k', fps: 60 }
    const key = computeEnhanceSpecKey(p)
    expect(key).toMatch(/^[a-z0-9_]+:[a-z0-9]+:[a-z0-9]+$/)
  })
})
