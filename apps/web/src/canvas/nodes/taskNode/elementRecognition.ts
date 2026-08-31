import type { ObjectDetector } from '@mediapipe/tasks-vision'
import type {
  ElementRecognitionWorkerRequest,
  ElementRecognitionWorkerResponse,
  ElementRecognitionWorkerSuccess,
} from './elementRecognitionWorkerProtocol'

export type RecognitionPoint = Readonly<{ x: number; y: number }>

export type RecognizedObject = Readonly<{
  label: string
  score: number
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>
}>

export type RecognizedElementMask = Readonly<{
  point: RecognitionPoint
  label: string
  score: number
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>
  foregroundMaskBlob: Blob
  overlayBlob: Blob
}>

const MEDIAPIPE_VERSION = '1.0.1'
const MEDIAPIPE_WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
const OBJECT_DETECTION_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite'
const ELEMENT_RECOGNITION_TIMEOUT_MS = 45_000
let detectorPromise: Promise<ObjectDetector> | null = null
let segmentWorker: Worker | null = null
let segmenterPreloadPromise: Promise<void> | null = null
let nextSegmentRequestId = 1
const pendingSegments = new Map<number, {
  resolve: (result: ElementRecognitionWorkerSuccess) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof globalThis.setTimeout>
}>()
const pendingPreloads = new Map<number, {
  resolve: () => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof globalThis.setTimeout>
}>()

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('元素识别蒙版导出失败'))),
      'image/png',
    )
  })
}

async function resolveObjectDetector(): Promise<ObjectDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FilesetResolver, ObjectDetector: MediaPipeObjectDetector } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT)
      return await MediaPipeObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: OBJECT_DETECTION_MODEL_URL },
        runningMode: 'IMAGE',
        maxResults: 30,
        scoreThreshold: 0.2,
      })
    })().catch((error: unknown) => {
      detectorPromise = null
      throw error
    })
  }
  return await detectorPromise
}

function rejectPendingRequests(message: string): void {
  const error = new Error(message)
  for (const pending of pendingSegments.values()) {
    globalThis.clearTimeout(pending.timeoutId)
    pending.reject(error)
  }
  pendingSegments.clear()
  for (const pending of pendingPreloads.values()) {
    globalThis.clearTimeout(pending.timeoutId)
    pending.reject(error)
  }
  pendingPreloads.clear()
}

function resolveSegmentWorker(): Worker {
  if (segmentWorker) return segmentWorker
  const worker = new Worker(new URL('./elementRecognition.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<ElementRecognitionWorkerResponse>) => {
    const response = event.data
    if (response.type === 'preload-result' || response.type === 'preload-error') {
      const pending = pendingPreloads.get(response.requestId)
      if (!pending) return
      pendingPreloads.delete(response.requestId)
      globalThis.clearTimeout(pending.timeoutId)
      if (response.type === 'preload-error') {
        pending.reject(new Error(response.message))
        return
      }
      pending.resolve()
      return
    }
    const pending = pendingSegments.get(response.requestId)
    if (!pending) return
    pendingSegments.delete(response.requestId)
    globalThis.clearTimeout(pending.timeoutId)
    if (response.type === 'segment-result') {
      pending.resolve(response)
      return
    }
    pending.reject(new Error(response.message))
  }
  worker.onerror = (event: ErrorEvent) => {
    rejectPendingRequests(event.message || '元素分割 Worker 加载失败')
    worker.terminate()
    if (segmentWorker === worker) segmentWorker = null
    segmenterPreloadPromise = null
  }
  worker.onmessageerror = () => {
    rejectPendingRequests('元素分割 Worker 返回了无法解析的数据')
    worker.terminate()
    if (segmentWorker === worker) segmentWorker = null
    segmenterPreloadPromise = null
  }
  segmentWorker = worker
  return worker
}

export function preloadElementSegmentation(): Promise<void> {
  if (!segmenterPreloadPromise) {
    segmenterPreloadPromise = new Promise<void>((resolve, reject) => {
      const worker = resolveSegmentWorker()
      const requestId = nextSegmentRequestId
      nextSegmentRequestId += 1
      const timeoutId = globalThis.setTimeout(() => {
        pendingPreloads.delete(requestId)
        reject(new Error('元素分割模型加载超时，请检查模型资源网络后重试'))
      }, ELEMENT_RECOGNITION_TIMEOUT_MS)
      pendingPreloads.set(requestId, { resolve, reject, timeoutId })
      try {
        worker.postMessage({ type: 'preload', requestId } satisfies ElementRecognitionWorkerRequest)
      } catch (error: unknown) {
        pendingPreloads.delete(requestId)
        globalThis.clearTimeout(timeoutId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }).catch((error: unknown) => {
      segmenterPreloadPromise = null
      throw error
    })
  }
  return segmenterPreloadPromise
}

async function segmentImageAtPoint(image: HTMLImageElement, point: RecognitionPoint): Promise<ElementRecognitionWorkerSuccess> {
  const worker = resolveSegmentWorker()
  const imageBitmap = await createImageBitmap(image)
  const requestId = nextSegmentRequestId
  nextSegmentRequestId += 1
  return await new Promise<ElementRecognitionWorkerSuccess>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      pendingSegments.delete(requestId)
      imageBitmap.close()
      reject(new Error('元素点选识别超时，请重试或改用框选/画笔'))
    }, ELEMENT_RECOGNITION_TIMEOUT_MS)
    pendingSegments.set(requestId, { resolve, reject, timeoutId })
    const request: ElementRecognitionWorkerRequest = {
      type: 'segment',
      requestId,
      image: imageBitmap,
      point,
    }
    try {
      worker.postMessage(request, [imageBitmap])
    } catch (error: unknown) {
      pendingSegments.delete(requestId)
      globalThis.clearTimeout(timeoutId)
      imageBitmap.close()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function normalizedBounds(input: {
  originX: number
  originY: number
  width: number
  height: number
  imageWidth: number
  imageHeight: number
}): RecognizedObject['bounds'] | null {
  if (input.imageWidth <= 0 || input.imageHeight <= 0 || input.width <= 0 || input.height <= 0) return null
  const x = clampUnit(input.originX / input.imageWidth)
  const y = clampUnit(input.originY / input.imageHeight)
  const right = clampUnit((input.originX + input.width) / input.imageWidth)
  const bottom = clampUnit((input.originY + input.height) / input.imageHeight)
  const width = right - x
  const height = bottom - y
  return width > 0 && height > 0 ? { x, y, width, height } : null
}

export function findRecognizedObjectAtPoint(
  objects: readonly RecognizedObject[],
  point: RecognitionPoint,
): RecognizedObject | null {
  return objects
    .filter((object) => {
      const { x, y, width, height } = object.bounds
      return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height
    })
    .sort((left, right) => {
      const leftArea = left.bounds.width * left.bounds.height
      const rightArea = right.bounds.width * right.bounds.height
      return right.score - left.score || leftArea - rightArea
    })[0] ?? null
}

export async function detectObjectsInImage(image: HTMLImageElement): Promise<RecognizedObject[]> {
  if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error('元素识别需要等待原图加载完成')
  }
  const detector = await resolveObjectDetector()
  const result = detector.detect(image)
  return result.detections
    .map((detection): RecognizedObject | null => {
      const boundingBox = detection.boundingBox
      const category = detection.categories[0]
      if (!boundingBox || !category) return null
      const bounds = normalizedBounds({
        originX: boundingBox.originX,
        originY: boundingBox.originY,
        width: boundingBox.width,
        height: boundingBox.height,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
      })
      if (!bounds) return null
      const label = category.displayName.trim() || category.categoryName.trim() || '已选对象'
      return { label, score: category.score, bounds }
    })
    .filter((object): object is RecognizedObject => object !== null)
}

async function blobsFromConfidenceMask(mask: {
  width: number
  height: number
  values: Float32Array
}): Promise<{
  foregroundMaskBlob: Blob
  overlayBlob: Blob
  bounds: RecognizedElementMask['bounds']
}> {
  const values = mask.values
  const foregroundCanvas = document.createElement('canvas')
  const overlayCanvas = document.createElement('canvas')
  foregroundCanvas.width = overlayCanvas.width = mask.width
  foregroundCanvas.height = overlayCanvas.height = mask.height
  const foregroundContext = foregroundCanvas.getContext('2d')
  const overlayContext = overlayCanvas.getContext('2d')
  if (!foregroundContext || !overlayContext) throw new Error('浏览器无法创建元素识别蒙版')

  const foregroundImage = foregroundContext.createImageData(mask.width, mask.height)
  const overlayImage = overlayContext.createImageData(mask.width, mask.height)
  let minX = mask.width
  let minY = mask.height
  let maxX = -1
  let maxY = -1
  let selectedPixelCount = 0

  for (let index = 0; index < values.length; index += 1) {
    const confidence = values[index] ?? 0
    if (confidence < 0.5) continue
    const x = index % mask.width
    const y = Math.floor(index / mask.width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    selectedPixelCount += 1
    const pixelIndex = index * 4
    foregroundImage.data[pixelIndex] = 255
    foregroundImage.data[pixelIndex + 1] = 255
    foregroundImage.data[pixelIndex + 2] = 255
    foregroundImage.data[pixelIndex + 3] = 255
    overlayImage.data[pixelIndex] = 39
    overlayImage.data[pixelIndex + 1] = 215
    overlayImage.data[pixelIndex + 2] = 255
    overlayImage.data[pixelIndex + 3] = Math.round(90 + confidence * 90)
  }

  if (selectedPixelCount === 0 || maxX < minX || maxY < minY) {
    throw new Error('未能从点击位置分割出可编辑元素')
  }

  foregroundContext.putImageData(foregroundImage, 0, 0)
  overlayContext.putImageData(overlayImage, 0, 0)
  const [foregroundMaskBlob, overlayBlob] = await Promise.all([
    canvasToBlob(foregroundCanvas),
    canvasToBlob(overlayCanvas),
  ])
  return {
    foregroundMaskBlob,
    overlayBlob,
    bounds: {
      x: minX / mask.width,
      y: minY / mask.height,
      width: (maxX - minX + 1) / mask.width,
      height: (maxY - minY + 1) / mask.height,
    },
  }
}

export async function recognizeElementAtPoint(input: {
  image: HTMLImageElement
  point: RecognitionPoint
  detectedObjects: readonly RecognizedObject[]
}): Promise<RecognizedElementMask> {
  if (!input.image.complete || input.image.naturalWidth <= 0 || input.image.naturalHeight <= 0) {
    throw new Error('元素识别需要等待原图加载完成')
  }
  const segmentation = await segmentImageAtPoint(input.image, input.point)
  const blobs = await blobsFromConfidenceMask({
    width: segmentation.width,
    height: segmentation.height,
    values: new Float32Array(segmentation.values),
  })
  const detectedObject = findRecognizedObjectAtPoint(input.detectedObjects, input.point)
  return {
    point: input.point,
    label: detectedObject?.label || '已选对象',
    score: detectedObject?.score ?? 0,
    bounds: blobs.bounds,
    foregroundMaskBlob: blobs.foregroundMaskBlob,
    overlayBlob: blobs.overlayBlob,
  }
}
