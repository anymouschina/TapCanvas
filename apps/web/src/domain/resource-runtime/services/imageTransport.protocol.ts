export type ImageWorkerLoadMessage = {
  type: 'load'
  requestId: string
  url: string
}

export type ImageWorkerAbortMessage = {
  type: 'abort'
  requestId: string
}

export type ImageWorkerRequestMessage = ImageWorkerLoadMessage | ImageWorkerAbortMessage

export type ImageWorkerLoadedMessage = {
  type: 'loaded'
  requestId: string
  blob: Blob
}

export type ImageWorkerFailedMessage = {
  type: 'failed'
  requestId: string
  error: string
}

export type ImageWorkerAbortedMessage = {
  type: 'aborted'
  requestId: string
}

export type ImageWorkerResponseMessage =
  | ImageWorkerLoadedMessage
  | ImageWorkerFailedMessage
  | ImageWorkerAbortedMessage
