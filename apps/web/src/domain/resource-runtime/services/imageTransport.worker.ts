/// <reference lib="webworker" />

import type {
  ImageWorkerRequestMessage,
  ImageWorkerResponseMessage,
} from './imageTransport.protocol'

const workerScope = self as DedicatedWorkerGlobalScope
const activeControllers = new Map<string, AbortController>()

function postResponse(message: ImageWorkerResponseMessage): void {
  workerScope.postMessage(message)
}

async function handleLoad(message: Extract<ImageWorkerRequestMessage, { type: 'load' }>): Promise<void> {
  const controller = new AbortController()
  activeControllers.set(message.requestId, controller)
  try {
    const response = await fetch(message.url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`fetch ${response.status}`)
    }
    const blob = await response.blob()
    postResponse({
      type: 'loaded',
      requestId: message.requestId,
      blob,
    })
  } catch (error) {
    if (controller.signal.aborted) {
      postResponse({
        type: 'aborted',
        requestId: message.requestId,
      })
      return
    }
    postResponse({
      type: 'failed',
      requestId: message.requestId,
      error: error instanceof Error ? error.message : 'worker image fetch failed',
    })
  } finally {
    activeControllers.delete(message.requestId)
  }
}

function handleAbort(message: Extract<ImageWorkerRequestMessage, { type: 'abort' }>): void {
  activeControllers.get(message.requestId)?.abort()
}

workerScope.addEventListener('message', (event: MessageEvent<ImageWorkerRequestMessage>) => {
  const message = event.data
  if (message.type === 'load') {
    void handleLoad(message)
    return
  }
  handleAbort(message)
})

export {}
