import { buildImageDenoiseAction, type ImageDenoiseMode } from './imageDenoiseAction'
import { DEFAULT_IMAGE_EDIT_SIZE, IMAGE_EDIT_SIZE_OPTIONS, parseImageEditSizeDimensions } from './imageEditSize'

export type ImageDenoiseNodeOptions = ReturnType<typeof buildImageDenoiseAction> & {
  referenceImages: string[]
  model: string | undefined
  imageEditSize?: string
}

type ImageDenoiseExecution = {
  mode: ImageDenoiseMode
  source: {
    primaryImageUrl: string | null
    imageModel: unknown
    imageEditSize: unknown
    size: unknown
    naturalSize: { w: number; h: number } | null
  }
  running: { current: boolean }
  setLoading: (loading: boolean) => void
  notify: (message: string, level: 'error' | 'info') => void
  createNode: (options: ImageDenoiseNodeOptions) => string | null
  submitNode: (nodeId: string, options: { concurrency: number }) => Promise<void>
}

export async function executeImageDenoise(input: ImageDenoiseExecution): Promise<void> {
  if (input.running.current) return
  const { primaryImageUrl, imageModel, imageEditSize, size, naturalSize } = input.source
  if (!primaryImageUrl) {
    input.notify('当前节点没有可增强的真实图片资产', 'error')
    return
  }
  input.running.current = true
  input.setLoading(true)
  try {
    const selectedEditSize = IMAGE_EDIT_SIZE_OPTIONS.find((option) =>
      option.value === imageEditSize || option.value === size,
    )
    const outputDimensions = parseImageEditSizeDimensions(selectedEditSize?.value ?? DEFAULT_IMAGE_EDIT_SIZE)
    if (naturalSize && outputDimensions.width * naturalSize.h !== outputDimensions.height * naturalSize.w) {
      input.notify('去噪按当前图片编辑输出规格生成，画幅可能变化', 'info')
    }
    const newNodeId = input.createNode({
      ...buildImageDenoiseAction(input.mode),
      referenceImages: [primaryImageUrl],
      model: String(imageModel || '').trim() || undefined,
      ...(selectedEditSize ? { imageEditSize: selectedEditSize.value } : {}),
    })
    if (!newNodeId) return
    await input.submitNode(newNodeId, { concurrency: 1 })
  } catch (error: unknown) {
    input.notify(error instanceof Error ? error.message : '去噪生成失败', 'error')
  } finally {
    input.running.current = false
    input.setLoading(false)
  }
}
