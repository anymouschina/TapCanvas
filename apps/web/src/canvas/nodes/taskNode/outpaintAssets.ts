import { fetchProxiedImageBlob } from '../../../api/server'

export type OutpaintAssets = Readonly<{
  expandedSourceBlob: Blob
  maskBlob: Blob
  sourceWidth: number
  sourceHeight: number
  targetWidth: number
  targetHeight: number
  offsetX: number
  offsetY: number
}>

function canvasToPng(canvas: HTMLCanvasElement, errorMessage: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error(errorMessage))
    }, 'image/png')
  })
}

function boundedTargetDimension(source: number, scale: number): number {
  return Math.max(source, Math.min(3840, Math.round(source * scale / 16) * 16))
}

export async function createCenteredOutpaintAssets(
  sourceImageUrl: string,
  scale: number,
): Promise<OutpaintAssets> {
  if (!Number.isFinite(scale) || scale <= 1 || scale > 2) {
    throw new Error('扩图倍率必须大于 1 且不超过 2')
  }
  const sourceBlob = await fetchProxiedImageBlob(sourceImageUrl)
  const bitmap = await createImageBitmap(sourceBlob)
  try {
    let targetWidth = boundedTargetDimension(bitmap.width, scale)
    let targetHeight = boundedTargetDimension(bitmap.height, scale)
    const targetPixels = targetWidth * targetHeight
    if (targetPixels < 655_360) {
      const providerScale = Math.sqrt(655_360 / targetPixels)
      targetWidth = boundedTargetDimension(targetWidth, providerScale)
      targetHeight = boundedTargetDimension(targetHeight, providerScale)
    }
    if (targetWidth === bitmap.width && targetHeight === bitmap.height) {
      throw new Error('源图片已达到扩图尺寸上限，无法继续等比扩图')
    }
    const offsetX = Math.floor((targetWidth - bitmap.width) / 2)
    const offsetY = Math.floor((targetHeight - bitmap.height) / 2)

    const expanded = document.createElement('canvas')
    expanded.width = targetWidth
    expanded.height = targetHeight
    const expandedContext = expanded.getContext('2d')
    if (!expandedContext) throw new Error('扩图底图画布初始化失败')
    expandedContext.clearRect(0, 0, targetWidth, targetHeight)
    expandedContext.drawImage(bitmap, offsetX, offsetY, bitmap.width, bitmap.height)

    const mask = document.createElement('canvas')
    mask.width = targetWidth
    mask.height = targetHeight
    const maskContext = mask.getContext('2d')
    if (!maskContext) throw new Error('扩图蒙版画布初始化失败')
    maskContext.clearRect(0, 0, targetWidth, targetHeight)
    maskContext.fillStyle = '#ffffff'
    maskContext.fillRect(offsetX, offsetY, bitmap.width, bitmap.height)

    const [expandedSourceBlob, maskBlob] = await Promise.all([
      canvasToPng(expanded, '扩图底图导出失败'),
      canvasToPng(mask, '扩图蒙版导出失败'),
    ])
    return {
      expandedSourceBlob,
      maskBlob,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      targetWidth,
      targetHeight,
      offsetX,
      offsetY,
    }
  } finally {
    bitmap.close()
  }
}
