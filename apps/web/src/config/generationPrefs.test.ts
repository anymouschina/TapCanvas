import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ putGenerationPreferences: vi.fn(), getGenerationPreferences: vi.fn() }))
vi.mock('../api/server', () => mocks)
beforeEach(() => { vi.clearAllMocks() })

import { saveGenerationPrefs } from './generationPrefs'
import { readNodeModelPrefs } from '../canvas/nodeModelPrefs'

describe('saving image quality preferences', () => {
  it('updates the node preference cache only after the server confirms the quality', async () => {
    const prefs = { imagePreferenceEnabled: true, imageModel: 'quality-model', imageSize: '1K', imageQuality: 'max' }
    mocks.putGenerationPreferences.mockResolvedValueOnce(prefs)
    await expect(saveGenerationPrefs(prefs)).resolves.toEqual(prefs)
    expect(readNodeModelPrefs()).toMatchObject({ imageModel: prefs.imageModel, imageQuality: prefs.imageQuality })
    mocks.putGenerationPreferences.mockResolvedValueOnce({ ...prefs, imageQuality: 'high' })
    await expect(saveGenerationPrefs(prefs)).rejects.toThrow('服务端未保存所选生成偏好')
    expect(readNodeModelPrefs().imageQuality).toBe('max')
    mocks.putGenerationPreferences.mockResolvedValueOnce({ imagePreferenceEnabled: false })
    await saveGenerationPrefs({ imagePreferenceEnabled: false })
    expect(readNodeModelPrefs().imageQuality).toBeUndefined()
  })
})

describe('user preference operation ordering', () => {
  it('does not publish a stale read after a newer save', async () => {
    const { loadGenerationPrefs, getCachedGenerationPrefs } = await import('./generationPrefs')
    const oldPrefs = { videoPreferenceEnabled: true, videoModel: 'old-model' }
    const newPrefs = { videoPreferenceEnabled: true, videoModel: 'selected-model' }
    let finishRead!: (value: typeof oldPrefs) => void
    mocks.getGenerationPreferences.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
    const reading = loadGenerationPrefs(true)
    await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'))
    mocks.putGenerationPreferences.mockResolvedValueOnce(newPrefs)
    await saveGenerationPrefs(newPrefs, 'selected-node')
    mocks.getGenerationPreferences.mockResolvedValueOnce(newPrefs)
    finishRead(oldPrefs)
    await expect(reading).resolves.toEqual(newPrefs)
    expect(getCachedGenerationPrefs()).toEqual(newPrefs)
  })

  it('serializes direct saves and snapshots each user operation', async () => {
    let finishSave!: (value: { videoModel: string }) => void
    mocks.putGenerationPreferences.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve }))
    const first = saveGenerationPrefs({ videoModel: 'first' })
    await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'))
    const prefs = { videoModel: 'second' }
    mocks.putGenerationPreferences.mockResolvedValueOnce({ videoModel: 'second' })
    const second = saveGenerationPrefs(prefs)
    prefs.videoModel = 'mutated-after-click'
    expect(mocks.putGenerationPreferences).toHaveBeenCalledTimes(1)
    finishSave({ videoModel: 'first' })
    await first
    await expect(second).resolves.toEqual({ videoModel: 'second' })
    expect(mocks.putGenerationPreferences).toHaveBeenLastCalledWith({ videoModel: 'second' })
  })
})
