/// <reference lib="webworker" />

import { FilesetResolver, InteractiveSegmenter } from '@mediapipe/tasks-vision'
import type { BrushMode } from '@mediapipe/tasks-vision'
import type {
  ElementRecognitionWorkerRequest,
  ElementRecognitionWorkerResponse,
} from './elementRecognitionWorkerProtocol'

const MEDIAPIPE_VERSION = '1.0.1'
const MEDIAPIPE_WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
const INTERACTIVE_SEGMENTATION_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task'
const POSITIVE_BRUSH_MODE = 1 as BrushMode

const scope = self as unknown as DedicatedWorkerGlobalScope
let segmenterPromise: Promise<InteractiveSegmenter> | null = null

function post(response: ElementRecognitionWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(response, transfer)
}

async function resolveSegmenter(): Promise<InteractiveSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT, true)
      return await InteractiveSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: INTERACTIVE_SEGMENTATION_MODEL_URL },
        canvas: new OffscreenCanvas(1, 1),
      })
    })().catch((error: unknown) => {
      segmenterPromise = null
      throw error
    })
  }
  return await segmenterPromise
}

scope.onmessage = async (event: MessageEvent<ElementRecognitionWorkerRequest>) => {
  const request = event.data
  if (!request) return
  if (request.type === 'preload') {
    try {
      await resolveSegmenter()
      post({ type: 'preload-result', requestId: request.requestId })
    } catch (error: unknown) {
      post({
        type: 'preload-error',
        requestId: request.requestId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    return
  }
  try {
    const segmenter = await resolveSegmenter()
    segmenter.setImage(request.image)
    const mask = segmenter.segment([{
      brushMode: POSITIVE_BRUSH_MODE,
      point: [request.point],
      isCompleted: true,
    }])
    try {
      const values = new Float32Array(mask.getAsFloat32Array())
      post({
        type: 'segment-result',
        requestId: request.requestId,
        width: mask.width,
        height: mask.height,
        values: values.buffer,
      }, [values.buffer])
    } finally {
      mask.close()
    }
  } catch (error: unknown) {
    post({
      type: 'segment-error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    request.image.close()
  }
}
