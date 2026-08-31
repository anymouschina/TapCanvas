export type ElementRecognitionWorkerPoint = Readonly<{ x: number; y: number }>

export type ElementRecognitionWorkerPreloadRequest = Readonly<{
  type: 'preload'
  requestId: number
}>

export type ElementRecognitionWorkerSegmentRequest = Readonly<{
  type: 'segment'
  requestId: number
  image: ImageBitmap
  point: ElementRecognitionWorkerPoint
}>

export type ElementRecognitionWorkerRequest =
  | ElementRecognitionWorkerPreloadRequest
  | ElementRecognitionWorkerSegmentRequest

export type ElementRecognitionWorkerPreloadSuccess = Readonly<{
  type: 'preload-result'
  requestId: number
}>

export type ElementRecognitionWorkerSuccess = Readonly<{
  type: 'segment-result'
  requestId: number
  width: number
  height: number
  values: ArrayBuffer
}>

export type ElementRecognitionWorkerFailure = Readonly<{
  type: 'preload-error' | 'segment-error'
  requestId: number
  message: string
}>

export type ElementRecognitionWorkerResponse =
  | ElementRecognitionWorkerPreloadSuccess
  | ElementRecognitionWorkerSuccess
  | ElementRecognitionWorkerFailure
