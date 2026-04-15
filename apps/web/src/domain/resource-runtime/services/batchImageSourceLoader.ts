import { resourceManager } from './resourceManager'
import { useResourceRuntimeStore } from '../store/resourceRuntimeStore'
import type { ImageResourceId, ResourcePriority } from '../model/resourceTypes'

export type BatchImageSource = {
  resourceId: ImageResourceId
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('image element load failed'))
    image.src = src
  })
}

function waitForResourceReady(resourceId: ImageResourceId): Promise<{ renderUrl: string; width: number; height: number; source: HTMLImageElement }> {
  const current = useResourceRuntimeStore.getState().imageEntries[resourceId]
  if (current?.state === 'ready' && current.decoded?.renderUrl) {
    return loadImageElement(current.decoded.renderUrl).then((image) => ({
      renderUrl: current.decoded?.renderUrl as string,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      source: image,
    }))
  }

  return new Promise((resolve, reject) => {
    const unsubscribe = useResourceRuntimeStore.subscribe((state) => {
      const entry = state.imageEntries[resourceId]
      if (!entry) {
        unsubscribe()
        reject(new Error('resource entry missing before ready'))
        return
      }
      if (entry.state === 'failed') {
        unsubscribe()
        reject(new Error(entry.failureReason || 'resource load failed'))
        return
      }
      if (entry.state !== 'ready' || !entry.decoded?.renderUrl) return
      unsubscribe()
      void loadImageElement(entry.decoded.renderUrl)
        .then((image) => {
          resolve({
            renderUrl: entry.decoded?.renderUrl as string,
            width: image.naturalWidth || image.width,
            height: image.naturalHeight || image.height,
            source: image,
          })
        })
        .catch(reject)
    })
  })
}

type LoadBatchImageSourceOptions = {
  priority?: ResourcePriority
}

export async function loadBatchImageSource(
  url: string,
  options?: LoadBatchImageSourceOptions,
): Promise<BatchImageSource> {
  const resourceId = resourceManager.acquireImage({
    url,
    priority: options?.priority ?? 'visible',
    owner: {
      ownerSurface: 'mosaic-runner',
      ownerRequestKey: `batch:${url}`,
    },
  })
  if (!resourceId) {
    throw new Error('batch image source url is empty')
  }

  let released = false
  try {
    const ready = await waitForResourceReady(resourceId)
    return {
      resourceId,
      source: ready.source,
      width: ready.width,
      height: ready.height,
      release: () => {
        if (released) return
        released = true
        resourceManager.releaseImage(resourceId, `batch:${url}`)
      },
    }
  } catch (error) {
    if (!released) {
      released = true
      resourceManager.releaseImage(resourceId, `batch:${url}`)
    }
    throw error
  }
}
