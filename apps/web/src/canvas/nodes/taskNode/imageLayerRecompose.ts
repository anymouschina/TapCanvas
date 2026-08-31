import { fetchProxiedImageBlob } from '../../../api/server'

export async function recomposeImageLayerUrls(layerUrls: readonly string[]): Promise<Blob> {
  const urls = layerUrls.map((url) => url.trim()).filter(Boolean)
  if (urls.length < 1) throw new Error('图层合成至少需要一个真实图层资产')
  const bitmaps = await Promise.all(urls.map(async (url) => {
    const blob = await fetchProxiedImageBlob(url)
    return createImageBitmap(blob)
  }))
  try {
    const width = bitmaps[0]?.width ?? 0
    const height = bitmaps[0]?.height ?? 0
    if (!width || !height) throw new Error('图层尺寸无效')
    if (bitmaps.some((bitmap) => bitmap.width !== width || bitmap.height !== height)) {
      throw new Error('图层尺寸不一致，无法无损重新合成')
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('图层合成画布初始化失败')
    context.clearRect(0, 0, width, height)
    for (const bitmap of bitmaps) context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('图层合成导出失败'))),
        'image/png',
      )
    })
  } finally {
    bitmaps.forEach((bitmap) => bitmap.close())
  }
}

