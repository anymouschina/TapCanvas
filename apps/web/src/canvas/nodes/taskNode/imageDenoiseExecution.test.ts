import { describe, expect, it, vi } from 'vitest'
import { executeImageDenoise, type ImageDenoiseNodeOptions } from './imageDenoiseExecution'

function createExecution() {
  return {
    mode: 'clean' as const,
    source: {
      primaryImageUrl: 'https://assets.example/current-selected-image.png' as string | null,
      imageModel: ' selected-image-model ',
      imageEditSize: '720x1280',
      size: '720x1280',
      naturalSize: { w: 720, h: 1280 },
    },
    running: { current: false },
    setLoading: vi.fn((_loading: boolean) => {}),
    notify: vi.fn((_message: string, _level: 'error' | 'info') => {}),
    createNode: vi.fn((_options: ImageDenoiseNodeOptions): string | null => 'denoise-result-node'),
    submitNode: vi.fn(async (_nodeId: string, _options: { concurrency: number }): Promise<void> => {}),
  }
}

describe('manual image denoise execution', () => {
  it.each(['clean', 'enhance'] as const)('creates and submits the %s edit using only the current primary image', async (mode) => {
    const execution = createExecution()

    await executeImageDenoise({ ...execution, mode })

    expect(execution.createNode).toHaveBeenCalledTimes(1)
    expect(execution.createNode).toHaveBeenCalledWith({
      label: mode === 'clean' ? '轻度去噪' : '去噪与清晰度增强',
      prompt: expect.stringContaining(mode === 'clean' ? '轻度去噪' : '适度提升现有细节的清晰度'),
      referenceImages: ['https://assets.example/current-selected-image.png'],
      referenceImageStrategy: 'visible_composite_only',
      model: 'selected-image-model',
      imageEditSize: '720x1280',
    })
    expect(execution.submitNode.mock.calls).toEqual([['denoise-result-node', { concurrency: 1 }]])
    expect(execution.createNode.mock.invocationCallOrder[0]).toBeLessThan(execution.submitNode.mock.invocationCallOrder[0])
    expect(execution.setLoading.mock.calls).toEqual([[true], [false]])
    expect(execution.running.current).toBe(false)
    expect(execution.notify).not.toHaveBeenCalled()
  })

  it('blocks synchronous repeated clicks until the accepted submission settles', async () => {
    const execution = createExecution()
    let completeSubmission: (() => void) | undefined
    execution.submitNode.mockImplementation(() => new Promise<void>((resolve) => { completeSubmission = resolve }))

    const firstClick = executeImageDenoise(execution)
    const secondClick = executeImageDenoise({ ...execution, mode: 'enhance' })

    expect(execution.running.current).toBe(true)
    expect(execution.createNode).toHaveBeenCalledTimes(1)
    expect(execution.submitNode).toHaveBeenCalledTimes(1)
    expect(execution.setLoading.mock.calls).toEqual([[true]])
    completeSubmission?.()
    await Promise.all([firstClick, secondClick])
    expect(execution.running.current).toBe(false)
    expect(execution.setLoading.mock.calls).toEqual([[true], [false]])
  })

  it('reports a failed submission, releases its lock and lets a new click use the newly selected image', async () => {
    const execution = createExecution()
    execution.createNode.mockReturnValueOnce('failed-result-node').mockReturnValueOnce('retry-result-node')
    execution.submitNode.mockRejectedValueOnce(new Error('supplier rejected the request'))

    await executeImageDenoise(execution)

    expect(execution.notify.mock.calls).toEqual([['supplier rejected the request', 'error']])
    expect(execution.running.current).toBe(false)
    execution.source.primaryImageUrl = 'https://assets.example/new-primary-image.png'
    await executeImageDenoise(execution)

    expect(execution.createNode).toHaveBeenCalledTimes(2)
    expect(execution.createNode.mock.calls[1][0].referenceImages).toEqual(['https://assets.example/new-primary-image.png'])
    expect(execution.submitNode.mock.calls).toEqual([
      ['failed-result-node', { concurrency: 1 }],
      ['retry-result-node', { concurrency: 1 }],
    ])
    expect(execution.setLoading.mock.calls).toEqual([[true], [false], [true], [false]])
  })

  it('does not create or submit an edit when the source has no real primary image', async () => {
    const execution = createExecution()
    execution.source.primaryImageUrl = null

    await executeImageDenoise(execution)

    expect(execution.notify.mock.calls).toEqual([['当前节点没有可增强的真实图片资产', 'error']])
    expect(execution.createNode).not.toHaveBeenCalled()
    expect(execution.submitNode).not.toHaveBeenCalled()
    expect(execution.setLoading).not.toHaveBeenCalled()
    expect(execution.running.current).toBe(false)
  })

  it('does not submit a missing new node and permits retrying creation', async () => {
    const execution = createExecution()
    execution.createNode.mockReturnValueOnce(null)

    await executeImageDenoise(execution)

    expect(execution.submitNode).not.toHaveBeenCalled()
    expect(execution.running.current).toBe(false)
    await executeImageDenoise(execution)
    expect(execution.createNode).toHaveBeenCalledTimes(2)
    expect(execution.submitNode.mock.calls).toEqual([['denoise-result-node', { concurrency: 1 }]])
  })

  it('reports creation errors and releases the same lock used by subsequent clicks', async () => {
    const execution = createExecution()
    execution.createNode.mockImplementationOnce(() => { throw new Error('node creation failed') })

    await executeImageDenoise(execution)

    expect(execution.notify.mock.calls).toEqual([['node creation failed', 'error']])
    expect(execution.submitNode).not.toHaveBeenCalled()
    expect(execution.running.current).toBe(false)
    await executeImageDenoise(execution)
    expect(execution.submitNode).toHaveBeenCalledTimes(1)
  })

  it('preserves the default edit specification and warns when its frame differs from the source', async () => {
    const execution = createExecution()
    execution.source.imageEditSize = ''
    execution.source.size = ''

    await executeImageDenoise(execution)

    expect(execution.createNode.mock.calls[0][0]).not.toHaveProperty('imageEditSize')
    expect(execution.notify.mock.calls).toEqual([['去噪按当前图片编辑输出规格生成，画幅可能变化', 'info']])
    expect(execution.submitNode).toHaveBeenCalledTimes(1)
  })
})
