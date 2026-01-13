export type GridLayout = { cols: number; rows: number }

export type SlicedGridFrame = {
  index: number
  blob: Blob
  objectUrl: string
  width: number
  height: number
}

const DEFAULT_MAX_SOURCE_BYTES = 30 * 1024 * 1024

const clampInt = (value: unknown, fallback: number) => {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.floor(num)
}

export function computeGridLayoutFromCount(
  count: number,
  options?: { minCols?: number; maxCols?: number },
): GridLayout {
  const safeCount = Math.max(1, clampInt(count, 1))
  const minCols = Math.max(1, clampInt(options?.minCols, 2))
  const maxCols = Math.max(minCols, clampInt(options?.maxCols, 4))
  const suggestedCols = Math.ceil(Math.sqrt(safeCount))
  const cols = Math.min(maxCols, Math.max(minCols, suggestedCols))
  const rows = Math.max(1, Math.ceil(safeCount / cols))
  return { cols, rows }
}

export function gridCellBounds(params: {
  index: number
  cols: number
  rows: number
  width: number
  height: number
}): { x: number; y: number; width: number; height: number } | null {
  const { index, cols, rows, width, height } = params
  if (!Number.isFinite(index) || index < 0) return null
  if (!Number.isFinite(cols) || cols <= 0) return null
  if (!Number.isFinite(rows) || rows <= 0) return null
  if (!Number.isFinite(width) || width <= 0) return null
  if (!Number.isFinite(height) || height <= 0) return null

  const col = Math.floor(index % cols)
  const row = Math.floor(index / cols)
  if (row >= rows) return null

  const x0 = Math.round((col * width) / cols)
  const x1 = Math.round(((col + 1) * width) / cols)
  const y0 = Math.round((row * height) / rows)
  const y1 = Math.round(((row + 1) * height) / rows)

  return {
    x: Math.max(0, Math.min(width, x0)),
    y: Math.max(0, Math.min(height, y0)),
    width: Math.max(1, Math.min(width, x1) - Math.max(0, Math.min(width, x0))),
    height: Math.max(1, Math.min(height, y1) - Math.max(0, Math.min(height, y0))),
  }
}

const canvasToBlob = async (
  canvas: HTMLCanvasElement,
  options?: { mimeType?: string; quality?: number },
): Promise<Blob> => {
  const mimeType = typeof options?.mimeType === 'string' && options.mimeType.trim() ? options.mimeType.trim() : 'image/png'
  const quality = typeof options?.quality === 'number' && Number.isFinite(options.quality)
    ? Math.max(0, Math.min(1, options.quality))
    : undefined

  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to encode image blob'))
          return
        }
        resolve(blob)
      }, mimeType, quality)
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Failed to encode image blob'))
    }
  })
}

const loadImageElement = async (objectUrl: string): Promise<HTMLImageElement> => {
  const url = (objectUrl || '').trim()
  if (!url) throw new Error('Missing image url')
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = url
  })
}

export async function sliceImageGridToObjectUrls(
  srcUrl: string,
  layout: GridLayout,
  count: number,
  options?: { mimeType?: string; quality?: number; maxSourceBytes?: number },
): Promise<{ frames: SlicedGridFrame[]; revoke: () => void }> {
  const url = (srcUrl || '').trim()
  if (!url) throw new Error('Missing source image')

  const cols = clampInt(layout?.cols, 0)
  const rows = clampInt(layout?.rows, 0)
  if (cols <= 0 || rows <= 0) throw new Error('Invalid grid layout')

  const total = Math.max(1, clampInt(count, 1))

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`)
  const blob = await res.blob()

  const maxBytes = typeof options?.maxSourceBytes === 'number' && Number.isFinite(options.maxSourceBytes)
    ? Math.max(1, Math.floor(options.maxSourceBytes))
    : DEFAULT_MAX_SOURCE_BYTES
  const byteSize = typeof (blob as any)?.size === 'number' ? (blob as any).size : 0
  if (byteSize > maxBytes) {
    throw new Error(`Image too large (${Math.round(byteSize / (1024 * 1024))}MB)`)
  }

  let source: CanvasImageSource | null = null
  let sourceWidth = 0
  let sourceHeight = 0
  let sourceObjectUrl: string | null = null
  let sourceBitmap: ImageBitmap | null = null

  try {
    if (typeof createImageBitmap === 'function') {
      try {
        sourceBitmap = await createImageBitmap(blob)
        source = sourceBitmap
        sourceWidth = sourceBitmap.width
        sourceHeight = sourceBitmap.height
      } catch {
        sourceBitmap = null
      }
    }

    if (!source) {
      sourceObjectUrl = URL.createObjectURL(blob)
      const img = await loadImageElement(sourceObjectUrl)
      source = img
      sourceWidth = img.naturalWidth
      sourceHeight = img.naturalHeight
    }

    if (!sourceWidth || !sourceHeight) {
      throw new Error('Invalid image size')
    }

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas context unavailable')

    const frames: SlicedGridFrame[] = []
    const objectUrls: string[] = []

    for (let index = 0; index < total; index += 1) {
      const rect = gridCellBounds({ index, cols, rows, width: sourceWidth, height: sourceHeight })
      if (!rect) continue
      canvas.width = rect.width
      canvas.height = rect.height
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(
        source,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        rect.width,
        rect.height,
      )
      const frameBlob = await canvasToBlob(canvas, options)
      const frameObjectUrl = URL.createObjectURL(frameBlob)
      objectUrls.push(frameObjectUrl)
      frames.push({
        index,
        blob: frameBlob,
        objectUrl: frameObjectUrl,
        width: rect.width,
        height: rect.height,
      })
    }

    if (sourceObjectUrl) {
      URL.revokeObjectURL(sourceObjectUrl)
      sourceObjectUrl = null
    }
    if (sourceBitmap) {
      try {
        sourceBitmap.close()
      } catch {
        // ignore
      }
      sourceBitmap = null
    }

    const revoke = () => {
      objectUrls.forEach((u) => {
        try {
          URL.revokeObjectURL(u)
        } catch {
          // ignore
        }
      })
    }

    return { frames, revoke }
  } catch (error) {
    if (sourceObjectUrl) {
      try {
        URL.revokeObjectURL(sourceObjectUrl)
      } catch {
        // ignore
      }
    }
    if (sourceBitmap) {
      try {
        sourceBitmap.close()
      } catch {
        // ignore
      }
    }
    throw error
  }
}

