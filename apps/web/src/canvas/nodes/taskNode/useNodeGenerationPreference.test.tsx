import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserGenerationPrefsDto } from '../../../api/server'

const state = vi.hoisted(() => ({ prefs: null as UserGenerationPrefsDto | null, listeners: new Set<() => void>(), save: vi.fn() }))
vi.mock('../../../config/generationPrefs', () => ({
  getCachedGenerationPrefs: () => state.prefs,
  subscribeGenerationPrefs: (listener: () => void) => { state.listeners.add(listener); return () => state.listeners.delete(listener) },
  updateRecentGenerationPrefs: state.save,
}))
import { useNodeGenerationPreference } from './useNodeGenerationPreference'

const selection = { imageModel: 'model-a', imageSize: '2K', imageAspect: '16:9', imageQuality: 'max', imageCount: 1 }
function publish(prefs: UserGenerationPrefsDto) {
  state.prefs = prefs
  state.listeners.forEach((listener) => listener())
}
beforeEach(() => { state.prefs = null; state.save.mockReset() })
afterEach(() => { state.listeners.clear() })

describe('node preference switch', () => {
  it('keeps local edits local while switched off, then saves an explicit snapshot', async () => {
    state.save.mockImplementation(async (patch: UserGenerationPrefsDto) => { publish(patch); return patch })
    const { result } = renderHook(() => useNodeGenerationPreference('node-a', 'image', selection))
    act(() => result.current.markEdited())
    expect(state.save).not.toHaveBeenCalled()
    await act(async () => result.current.setting.onChange(true))
    expect(state.save).toHaveBeenCalledWith({ ...selection, imagePreferenceEnabled: true }, 'node-a')
    expect(result.current.setting.checked).toBe(true)
    await act(async () => result.current.setting.onChange(false))
    expect(state.save).toHaveBeenLastCalledWith({ imagePreferenceEnabled: false }, 'node-a')
    expect(result.current.setting.checked).toBe(false)
  })
  it('synchronizes subsequent explicit edits, without saving passive rerenders', async () => {
    state.prefs = { ...selection, imagePreferenceEnabled: true }
    state.save.mockImplementation(async (patch: UserGenerationPrefsDto) => { publish(patch); return patch })
    const { result, rerender } = renderHook(({ quality }) => useNodeGenerationPreference('node-a', 'image', { ...selection, imageQuality: quality }), { initialProps: { quality: 'max' } })
    rerender({ quality: 'high' })
    expect(state.save).not.toHaveBeenCalled()
    act(() => result.current.markEdited())
    await waitFor(() => expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ imageQuality: 'high', imagePreferenceEnabled: true }), 'node-a'))
  })
  it('keeps the switch off and exposes a failed save', async () => {
    state.save.mockRejectedValueOnce(new Error('服务端未保存所选生成偏好'))
    const { result } = renderHook(() => useNodeGenerationPreference('node-a', 'image', selection))
    await act(async () => result.current.setting.onChange(true))
    expect(result.current.setting.checked).toBe(false)
    expect(result.current.setting.error).toContain('未保存')
  })
  it('does not submit an incomplete enabled snapshot', () => {
    const { result } = renderHook(() => useNodeGenerationPreference('node-a', 'image', null))
    act(() => result.current.setting.onChange(true))
    expect(state.save).not.toHaveBeenCalled()
    expect(result.current.setting.error).toContain('不完整')
  })
})
