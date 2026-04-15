import {
  getStoryboardEditorGridConfig,
  resolveStoryboardEditorCellAspect,
  type StoryboardEditorAspect,
  type StoryboardEditorCell,
  type StoryboardEditorGrid,
} from './storyboardEditor'

const DEFAULT_TARGET_CELL_WIDTH = 480

const loadImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    image.src = src
  })

const loadComposableImage = async (url: string): Promise<HTMLImageElement> => {
  try {
    return await loadImageElement(url)
  } catch {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`加载图片失败: ${response.status}`)
    }
    const blob = await response.blob()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : ''
        if (!result) {
          reject(new Error('图片编码失败'))
          return
        }
        resolve(result)
      }
      reader.onerror = () => reject(new Error('图片编码失败'))
      reader.readAsDataURL(blob)
    })
    return loadImageElement(dataUrl)
  }
}

export const storyboardAspectRatioToNumber = (value: StoryboardEditorAspect): number => {
  const [w, h] = value.split(':').map((part) => Number(part))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 4 / 3
  return w / h
}

export const resolveStoryboardFrameRect = (input: {
  containerWidth: number
  containerHeight: number
  aspect: StoryboardEditorAspect
}): { x: number; y: number; width: number; height: number } => {
  const targetRatio = storyboardAspectRatioToNumber(input.aspect)
  const containerRatio = input.containerWidth / input.containerHeight
  if (!Number.isFinite(targetRatio) || targetRatio <= 0) {
    return { x: 0, y: 0, width: input.containerWidth, height: input.containerHeight }
  }

  if (containerRatio > targetRatio) {
    const height = input.containerHeight
    const width = height * targetRatio
    return {
      x: (input.containerWidth - width) / 2,
      y: 0,
      width,
      height,
    }
  }

  const width = input.containerWidth
  const height = width / targetRatio
  return {
    x: 0,
    y: (input.containerHeight - height) / 2,
    width,
    height,
  }
}

export async function buildStoryboardComposeCanvas(input: {
  cells: StoryboardEditorCell[]
  aspect: StoryboardEditorAspect
  grid: StoryboardEditorGrid
  targetCellWidth?: number
}): Promise<HTMLCanvasElement> {
  const { cells, aspect, grid } = input
  const gridConfig = getStoryboardEditorGridConfig(grid)
  const targetCellWidth = Math.max(120, Math.round(input.targetCellWidth ?? DEFAULT_TARGET_CELL_WIDTH))
  const targetCellHeight = Math.max(120, Math.round(targetCellWidth / storyboardAspectRatioToNumber(aspect)))

  const canvas = document.createElement('canvas')
  canvas.width = targetCellWidth * gridConfig.columns
  canvas.height = targetCellHeight * gridConfig.rows

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('浏览器无法创建画布上下文')
  }

  const loadedImages = await Promise.all(
    cells.map(async (cell) => {
      const url = typeof cell.imageUrl === 'string' ? cell.imageUrl.trim() : ''
      if (!url) return null
      return loadComposableImage(url)
    }),
  )

  loadedImages.forEach((image, index) => {
    const col = index % gridConfig.columns
    const row = Math.floor(index / gridConfig.columns)
    const x = col * targetCellWidth
    const y = row * targetCellHeight
    const cellAspect = resolveStoryboardEditorCellAspect(cells[index], aspect)
    const frame = resolveStoryboardFrameRect({
      containerWidth: targetCellWidth,
      containerHeight: targetCellHeight,
      aspect: cellAspect,
    })

    if (!image) return
    const drawBoxX = x + frame.x
    const drawBoxY = y + frame.y
    const scale = Math.max(frame.width / image.width, frame.height / image.height)
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    const drawX = drawBoxX + (frame.width - drawWidth) / 2
    const drawY = drawBoxY + (frame.height - drawHeight) / 2
    context.save()
    context.beginPath()
    context.rect(drawBoxX, drawBoxY, frame.width, frame.height)
    context.clip()
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight)
    context.restore()
  })

  return canvas
}

export const canvasToPngBlob = async (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob)
          return
        }
        reject(new Error('合成图片编码失败'))
      }, 'image/png')
    } catch (error) {
      reject(error)
    }
  })
