import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewApiModelDto } from '../../api/server'
import { notifyModelOptionsRefresh, useModelOptionsState } from '../../config/useModelOptions'
import { loadSelectedChatModel } from './chatModelSelection'

const { listModels } = vi.hoisted(() => ({ listModels: vi.fn() }))
vi.mock('../../api/server', () => ({ listNewApiModels: listModels }))

const row: NewApiModelDto = {
  id: 1, modelName: 'deepseek-v4.1-flash', requestModelKey: 'deepseek-v4.1-flash',
  displayLabel: 'DeepSeek V4.1 Flash', kind: 'text', description: null,
  icon: null, tags: [], vendorId: 1, endpoints: [], runtimeEndpoints: [],
  routingAliases: [], enabled: true, syncOfficial: false, nameRule: 0,
  createdTime: 1, updatedTime: 1, meta: null,
}

beforeEach(() => {
  notifyModelOptionsRefresh()
  listModels.mockReset()
})

describe('programmatic chat model admission', () => {
  it('waits for a cold catalog even while the hidden dialog reports loading=false', async () => {
    let complete: (rows: NewApiModelDto[]) => void = () => { throw new Error('request not started') }
    listModels.mockImplementation(() => new Promise<NewApiModelDto[]>(resolve => { complete = resolve }))
    const { result, rerender } = renderHook(({ enabled }) => useModelOptionsState('text', { enabled }), {
      initialProps: { enabled: false },
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.options).toEqual([])
    let settled = false
    const admission = loadSelectedChatModel(row.modelName).then(value => { settled = true; return value })
    rerender({ enabled: true })
    await act(async () => { await Promise.resolve() })
    expect(settled).toBe(false)
    expect(listModels).toHaveBeenCalledTimes(1)
    await act(async () => { complete([row]); await admission })
    expect((await admission).request).toEqual({ field: 'modelKey', model: row.modelName })
    await waitFor(() => expect(result.current.options[0]?.value).toBe(row.modelName))
  })

  it('reports a real catalog failure without claiming the model is unavailable', async () => {
    listModels.mockRejectedValue(Object.assign(new Error('catalog forbidden'), { status: 403 }))
    await expect(loadSelectedChatModel(row.modelName)).rejects.toThrow('对话模型目录加载失败：catalog forbidden')
    expect(listModels).toHaveBeenCalledTimes(1)
  })

  it('preserves the configured catalog-order selection policy before sending', async () => {
    listModels.mockResolvedValue([{ ...row, modelName: 'other', requestModelKey: 'other' }])
    expect((await loadSelectedChatModel(row.modelName)).request).toEqual({ field: 'modelKey', model: 'other' })
  })
})
