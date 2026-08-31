import type { Canvas as FabricCanvas } from 'fabric'
import { loadEditableImageSource } from '../../utils/editableImageSource'

/**
 * Renders the Fabric canvas drawing onto the source image at full source resolution.
 * Drawing layer is scaled (non-uniform if needed) from display space to naturalWidth × naturalHeight.
 */
export async function exportAtSourceResolution(
  fc: FabricCanvas,
  sourceImageUrl: string,
): Promise<Blob> {
  const source = await loadEditableImageSource(sourceImageUrl)
  let drawing: Awaited<ReturnType<typeof loadEditableImageSource>> | null = null
  try {
    // Rasterise the Fabric canvas at its internal DPR-scaled resolution.
    const drawingDataUrl = fc.toDataURL({ format: 'png', multiplier: 1 })
    drawing = await loadEditableImageSource(drawingDataUrl)

    const naturalW = source.image.naturalWidth
    const naturalH = source.image.naturalHeight
    const merged = document.createElement('canvas')
    merged.width = naturalW
    merged.height = naturalH
    const ctx = merged.getContext('2d')
    if (!ctx) throw new Error('图片编辑画布初始化失败')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source.image, 0, 0, naturalW, naturalH)
    ctx.drawImage(drawing.image, 0, 0, naturalW, naturalH)

    return await new Promise<Blob>((resolve, reject) =>
      merged.toBlob(blob => (blob ? resolve(blob) : reject(new Error('图片编辑导出失败'))), 'image/png'),
    )
  } finally {
    drawing?.release()
    source.release()
  }
}

/**
 * Exports only the Fabric drawing layer as a provider-native RGBA mask at the
 * source image resolution. Opaque pixels are protected and transparent pixels
 * are the requested edit area, matching the GPT Image edits contract.
 */
export async function exportMaskAtSourceResolution(
  fc: FabricCanvas,
  sourceImageUrl: string,
): Promise<Blob> {
  const source = await loadEditableImageSource(sourceImageUrl)
  let drawing: Awaited<ReturnType<typeof loadEditableImageSource>> | null = null
  try {
    drawing = await loadEditableImageSource(fc.toDataURL({ format: 'png', multiplier: 1 }))
    const naturalW = source.image.naturalWidth
    const naturalH = source.image.naturalHeight
    const canvas = document.createElement('canvas')
    canvas.width = naturalW
    canvas.height = naturalH
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('图片蒙版画布初始化失败')
    context.clearRect(0, 0, naturalW, naturalH)
    context.drawImage(drawing.image, 0, 0, naturalW, naturalH)
    const pixels = context.getImageData(0, 0, naturalW, naturalH)
    for (let index = 0; index < pixels.data.length; index += 4) {
      const drawingAlpha = pixels.data[index + 3] ?? 0
      pixels.data[index] = 255
      pixels.data[index + 1] = 255
      pixels.data[index + 2] = 255
      pixels.data[index + 3] = 255 - drawingAlpha
    }
    context.putImageData(pixels, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('图片蒙版导出失败'))),
        'image/png',
      )
    })
  } finally {
    drawing?.release()
    source.release()
  }
}
