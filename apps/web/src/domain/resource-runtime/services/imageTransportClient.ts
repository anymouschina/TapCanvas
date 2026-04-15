import type { ImageWorkerResponseMessage } from './imageTransport.protocol'

type WorkerLoadSuccess = {
  blob: Blob
}

type InflightRequest = {
  resolve: (value: WorkerLoadSuccess) => void
  reject: (reason?: unknown) => void
}

function createAbortError(): Error {
  const error = new Error('worker image fetch aborted')
  error.name = 'AbortError'
  return error
}

class ImageTransportClient {
  private worker: Worker | null = null
  private inflight = new Map<string, InflightRequest>()
  private nextRequestId = 0

  private ensureWorker(): Worker {
    if (typeof Worker === 'undefined') {
      throw new Error('web worker is not available for image transport')
    }
    if (!this.worker) {
      this.worker = new Worker(new URL('./imageTransport.worker.ts', import.meta.url), { type: 'module' })
      this.worker.addEventListener('message', this.handleMessage)
      this.worker.addEventListener('error', this.handleWorkerError)
    }
    return this.worker
  }

  private readonly handleMessage = (event: MessageEvent<ImageWorkerResponseMessage>): void => {
    const message = event.data
    const inflight = this.inflight.get(message.requestId)
    if (!inflight) return
    this.inflight.delete(message.requestId)
    if (message.type === 'loaded') {
      inflight.resolve({ blob: message.blob })
      return
    }
    if (message.type === 'aborted') {
      inflight.reject(createAbortError())
      return
    }
    inflight.reject(new Error(message.error))
  }

  private readonly handleWorkerError = (): void => {
    const error = new Error('image transport worker crashed')
    const inflightEntries = [...this.inflight.values()]
    this.inflight.clear()
    for (const inflight of inflightEntries) {
      inflight.reject(error)
    }
    if (this.worker) {
      this.worker.removeEventListener('message', this.handleMessage)
      this.worker.removeEventListener('error', this.handleWorkerError)
      this.worker.terminate()
      this.worker = null
    }
  }

  load(url: string): { promise: Promise<WorkerLoadSuccess>; abort: () => void } {
    const worker = this.ensureWorker()
    const requestId = `image-worker:${this.nextRequestId}`
    this.nextRequestId += 1

    const promise = new Promise<WorkerLoadSuccess>((resolve, reject) => {
      this.inflight.set(requestId, { resolve, reject })
      worker.postMessage({
        type: 'load',
        requestId,
        url,
      })
    })

    return {
      promise,
      abort: () => {
        const inflight = this.inflight.get(requestId)
        if (!inflight) return
        this.inflight.delete(requestId)
        inflight.reject(createAbortError())
        worker.postMessage({
          type: 'abort',
          requestId,
        })
      },
    }
  }
}

export const imageTransportClient = new ImageTransportClient()
