// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUIStore } from './uiStore'

// 锁定全局「选择风格素材」请求信号的契约：缺画风的角色卡/故事板入口靠它唤起统一选择器、
// 选完回调 onResolved 自动续跑原操作。回归点：token 递增可重复唤起、resolve 携带最新参考图、
// cancel/resolve 都清空请求且 onResolved 只在 resolve 时触发一次。
describe('styleReference global request signal', () => {
  beforeEach(() => {
    useUIStore.setState({ styleReferenceRequest: null })
  })

  it('requestStyleReference 记录 reason 并从 1 起递增 token', () => {
    useUIStore.getState().requestStyleReference({ reason: '生成角色卡' })
    const first = useUIStore.getState().styleReferenceRequest
    expect(first?.reason).toBe('生成角色卡')
    expect(first?.token).toBe(1)
    // 同 reason 再次请求也要换新 token，保证已关闭过的选择器能被重复唤起
    useUIStore.getState().requestStyleReference({ reason: '生成角色卡' })
    expect(useUIStore.getState().styleReferenceRequest?.token).toBe(2)
  })

  it('resolve 携带参考图回调 onResolved 并清空请求', () => {
    const onResolved = vi.fn()
    useUIStore.getState().requestStyleReference({ reason: '生成故事板', onResolved })
    useUIStore.getState().resolveStyleReferenceRequest(['https://cdn/x.webp'])
    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(onResolved).toHaveBeenCalledWith(['https://cdn/x.webp'])
    expect(useUIStore.getState().styleReferenceRequest).toBeNull()
  })

  it('cancel 清空请求且不触发 onResolved', () => {
    const onResolved = vi.fn()
    useUIStore.getState().requestStyleReference({ reason: '生成角色卡', onResolved })
    useUIStore.getState().cancelStyleReferenceRequest()
    expect(onResolved).not.toHaveBeenCalled()
    expect(useUIStore.getState().styleReferenceRequest).toBeNull()
  })

  it('无挂起请求时 resolve 安全无副作用（普通面板内选图也会调用）', () => {
    expect(() => useUIStore.getState().resolveStyleReferenceRequest(['u'])).not.toThrow()
    expect(useUIStore.getState().styleReferenceRequest).toBeNull()
  })
})
