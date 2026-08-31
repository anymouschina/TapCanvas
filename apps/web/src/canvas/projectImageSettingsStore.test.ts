import { describe, it, expect, vi, beforeEach } from 'vitest'

// 隔离服务端持久化：只验证本地状态与派生，不打网络。
vi.mock('../api/server', () => ({
  getProjectStyleImages: vi.fn(async () => ({ styleImages: [], styleLock: null })),
  setProjectStyleImages: vi.fn(async () => ({ styleImages: [], styleLock: null })),
}))

import {
  useProjectImageSettingsStore,
  getProjectImageSettings,
  deriveStyleBibleFromLockedStyle,
  type LockedStyle,
} from './projectImageSettingsStore'

const PID = 'proj-test'

describe('projectImageSettingsStore lockedStyle', () => {
  beforeEach(() => {
    useProjectImageSettingsStore.getState().reset(PID)
  })

  it('setLockedStyle 落本地并镜像 styleImages', () => {
    const lock: LockedStyle = {
      styleId: 'preset-1',
      styleName: '复古科幻原子朋克',
      referenceImageUrl: 'https://cdn/style.webp',
      stylePrompt: '',
    }
    useProjectImageSettingsStore.getState().setLockedStyle(PID, lock)
    const s = getProjectImageSettings(PID)
    expect(s.lockedStyle).toEqual(lock)
    expect(s.styleImages).toEqual(['https://cdn/style.webp'])
  })

  it('自定义文字风格无图：styleImages 为空但 lockedStyle 保留 stylePrompt', () => {
    const lock: LockedStyle = {
      styleId: 'custom',
      styleName: '自定义风格',
      referenceImageUrl: null,
      stylePrompt: '低饱和胶片质感，颗粒感',
    }
    useProjectImageSettingsStore.getState().setLockedStyle(PID, lock)
    const s = getProjectImageSettings(PID)
    expect(s.lockedStyle?.stylePrompt).toBe('低饱和胶片质感，颗粒感')
    expect(s.styleImages).toEqual([])
  })

  it('清除：setLockedStyle(null) 同时清 lockedStyle 与 styleImages', () => {
    useProjectImageSettingsStore.getState().setLockedStyle(PID, {
      styleId: 'preset-1',
      styleName: 'x',
      referenceImageUrl: 'https://cdn/a.webp',
      stylePrompt: '',
    })
    useProjectImageSettingsStore.getState().setLockedStyle(PID, null)
    const s = getProjectImageSettings(PID)
    expect(s.lockedStyle).toBeNull()
    expect(s.styleImages).toEqual([])
  })
})

describe('deriveStyleBibleFromLockedStyle', () => {
  it('有图风格派生单元素 referenceImages', () => {
    expect(
      deriveStyleBibleFromLockedStyle({
        styleId: 'p1',
        styleName: '名字',
        referenceImageUrl: 'https://cdn/a.webp',
        stylePrompt: '',
      }),
    ).toEqual({ styleName: '名字', referenceImages: ['https://cdn/a.webp'] })
  })

  it('自定义文字风格无图派生空 referenceImages', () => {
    expect(
      deriveStyleBibleFromLockedStyle({
        styleId: 'custom',
        styleName: '自定义风格',
        referenceImageUrl: null,
        stylePrompt: '文字',
      }),
    ).toEqual({ styleName: '自定义风格', referenceImages: [] })
  })

  it('null → null', () => {
    expect(deriveStyleBibleFromLockedStyle(null)).toBeNull()
  })
})
