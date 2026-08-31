import { fetchProxiedImageBlob } from '../../../api/server'

export type MaskEditSourceAsset = Readonly<{
  blob: Blob
  width: number
  height: number
}>

export async function createMaskEditSourcePng(sourceImageUrl: string): Promise<MaskEditSourceAsset> {
  const normalizedUrl = sourceImageUrl.trim()
  if (!normalizedUrl) throw new Error('蒙版编辑缺少真实源图片')
  const sourceBlob = await fetchProxiedImageBlob(normalizedUrl)
  const bitmap = await createImageBitmap(sourceBlob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('蒙版编辑源图画布初始化失败')
    context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('蒙版编辑源图 PNG 导出失败'))),
        'image/png',
      )
    })
    return { blob, width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}
