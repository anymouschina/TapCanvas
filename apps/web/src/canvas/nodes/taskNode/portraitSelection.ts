import type { ObjectDetector } from '@mediapipe/tasks-vision'

export type NormalizedRect = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

export type NormalizedPoint = Readonly<{
  x: number
  y: number
}>

export type PixelBoundingBox = readonly [number, number, number, number]

const MEDIAPIPE_VERSION = '1.0.1'
const MEDIAPIPE_WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
const PERSON_DETECTION_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite'

let detectorPromise: Promise<ObjectDetector> | null = null

export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function normalizedRectFromPoints(start: NormalizedPoint, end: NormalizedPoint): NormalizedRect {
  const x = clampUnit(Math.min(start.x, end.x))
  const y = clampUnit(Math.min(start.y, end.y))
  const right = clampUnit(Math.max(start.x, end.x))
  const bottom = clampUnit(Math.max(start.y, end.y))
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  }
}

export function normalizePixelRect(input: {
  originX: number
  originY: number
  width: number
  height: number
  imageWidth: number
  imageHeight: number
}): NormalizedRect | null {
  if (input.imageWidth <= 0 || input.imageHeight <= 0) return null
  const rect = normalizedRectFromPoints(
    {
      x: input.originX / input.imageWidth,
      y: input.originY / input.imageHeight,
    },
    {
      x: (input.originX + input.width) / input.imageWidth,
      y: (input.originY + input.height) / input.imageHeight,
    },
  )
  return rect.width > 0.005 && rect.height > 0.005 ? rect : null
}

export function normalizedRectToPixelBoundingBox(input: {
  rect: NormalizedRect
  imageWidth: number
  imageHeight: number
}): PixelBoundingBox {
  if (input.imageWidth <= 0 || input.imageHeight <= 0) {
    throw new Error('人物区域像素尺寸无效')
  }
  const left = Math.max(0, Math.min(input.imageWidth - 1, Math.round(input.rect.x * input.imageWidth)))
  const top = Math.max(0, Math.min(input.imageHeight - 1, Math.round(input.rect.y * input.imageHeight)))
  const right = Math.max(left + 1, Math.min(input.imageWidth, Math.round((input.rect.x + input.rect.width) * input.imageWidth)))
  const bottom = Math.max(top + 1, Math.min(input.imageHeight, Math.round((input.rect.y + input.rect.height) * input.imageHeight)))
  return [left, top, right, bottom]
}

export async function cropImageBlobToNormalizedRect(input: {
  imageBlob: Blob
  rect: NormalizedRect
}): Promise<Blob> {
  const source = await createImageBitmap(input.imageBlob)
  try {
    const box = normalizedRectToPixelBoundingBox({
      rect: input.rect,
      imageWidth: source.width,
      imageHeight: source.height,
    })
    const width = box[2] - box[0]
    const height = box[3] - box[1]
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建人物参考裁图')
    context.drawImage(source, box[0], box[1], width, height, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('人物参考裁图导出失败'))
      }, 'image/png')
    })
  } finally {
    source.close()
  }
}

export function normalizedPointerPosition(
  event: Pick<PointerEvent, 'clientX' | 'clientY'>,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): NormalizedPoint {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 }
  return {
    x: clampUnit((event.clientX - bounds.left) / bounds.width),
    y: clampUnit((event.clientY - bounds.top) / bounds.height),
  }
}

async function resolvePersonDetector(): Promise<ObjectDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FilesetResolver, ObjectDetector: MediaPipeObjectDetector } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT)
      return await MediaPipeObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: PERSON_DETECTION_MODEL_URL },
        runningMode: 'IMAGE',
        categoryAllowlist: ['person'],
        maxResults: 20,
        scoreThreshold: 0.32,
      })
    })().catch((error: unknown) => {
      detectorPromise = null
      throw error
    })
  }
  return await detectorPromise
}

export async function detectPeopleInImage(image: HTMLImageElement): Promise<NormalizedRect[]> {
  if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error('人物识别需要等待原图加载完成')
  }
  const detector = await resolvePersonDetector()
  const result = detector.detect(image)
  return result.detections
    .map((detection) => {
      const box = detection.boundingBox
      if (!box) return null
      return normalizePixelRect({
        originX: box.originX,
        originY: box.originY,
        width: box.width,
        height: box.height,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
      })
    })
    .filter((rect): rect is NormalizedRect => rect !== null)
    .sort((left, right) => left.x - right.x || left.y - right.y)
}

export async function createPortraitEditMask(input: {
  foregroundMaskBlob: Blob
  width: number
  height: number
}): Promise<Blob> {
  if (input.width <= 0 || input.height <= 0) throw new Error('人物区域蒙版尺寸无效')
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(input.width)
  canvas.height = Math.round(input.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建人物区域蒙版')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const foregroundBitmap = await createImageBitmap(input.foregroundMaskBlob)
  try {
    context.globalCompositeOperation = 'destination-out'
    context.drawImage(foregroundBitmap, 0, 0, canvas.width, canvas.height)
  } finally {
    foregroundBitmap.close()
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('人物区域蒙版导出失败'))
    }, 'image/png')
  })
}
