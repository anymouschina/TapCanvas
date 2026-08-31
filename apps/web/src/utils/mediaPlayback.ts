export type MediaPlaybackResult =
  | { status: 'started' }
  | { status: 'cancelled' }
  | { status: 'failed'; error: unknown }

export type PlayableMedia = Pick<HTMLMediaElement, 'play'>

export type MediaPlaybackRequestController = {
  cancelPending: () => void
  play: (media: PlayableMedia) => Promise<MediaPlaybackResult>
}

const pendingRequestCancellations = new WeakMap<object, Set<() => void>>()

function registerPendingRequest(media: PlayableMedia, cancel: () => void): () => void {
  const mediaKey = media as object
  const cancellations = pendingRequestCancellations.get(mediaKey) || new Set<() => void>()
  cancellations.add(cancel)
  pendingRequestCancellations.set(mediaKey, cancellations)

  return () => {
    cancellations.delete(cancel)
    if (cancellations.size === 0) pendingRequestCancellations.delete(mediaKey)
  }
}

function cancelPendingRequestsFor(media: HTMLMediaElement): void {
  const cancellations = pendingRequestCancellations.get(media)
  if (!cancellations) return
  Array.from(cancellations).forEach((cancel) => cancel())
}

export function pauseDocumentMedia(root: ParentNode, preserveManualPlayback = false): void {
  root.querySelectorAll<HTMLMediaElement>('video, audio').forEach((media) => {
    if (
      preserveManualPlayback
      && typeof HTMLVideoElement !== 'undefined'
      && media instanceof HTMLVideoElement
      && media.dataset.tcManualPlayback === '1'
    ) return
    cancelPendingRequestsFor(media)
    media.pause()
  })
}

export function installPageMediaLifecycle(
  onRouteChange: () => void,
  browserWindow: Window = window,
  browserDocument: Document = document,
): () => void {
  let activePathname = browserWindow.location.pathname

  const handleRouteChange = (): void => {
    const nextPathname = browserWindow.location.pathname
    if (nextPathname !== activePathname) {
      pauseDocumentMedia(browserDocument)
      activePathname = nextPathname
    }
    onRouteChange()
  }

  const handleVisibilityChange = (): void => {
    if (browserDocument.hidden) pauseDocumentMedia(browserDocument, true)
  }

  const handlePageHide = (): void => pauseDocumentMedia(browserDocument, true)

  browserWindow.addEventListener('popstate', handleRouteChange)
  browserWindow.addEventListener('pagehide', handlePageHide)
  browserDocument.addEventListener('visibilitychange', handleVisibilityChange)

  return () => {
    browserWindow.removeEventListener('popstate', handleRouteChange)
    browserWindow.removeEventListener('pagehide', handlePageHide)
    browserDocument.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}

export function isMediaPlaybackInterruption(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) return error.name === 'AbortError'
  return error instanceof Error && error.name === 'AbortError'
}

export function createMediaPlaybackRequestController(): MediaPlaybackRequestController {
  let operationVersion = 0

  return {
    cancelPending: () => {
      operationVersion += 1
    },
    play: async (media) => {
      const requestVersion = ++operationVersion
      const unregister = registerPendingRequest(media, () => {
        if (requestVersion === operationVersion) operationVersion += 1
      })
      try {
        await media.play()
        return requestVersion === operationVersion
          ? { status: 'started' }
          : { status: 'cancelled' }
      } catch (error: unknown) {
        if (requestVersion !== operationVersion && isMediaPlaybackInterruption(error)) {
          return { status: 'cancelled' }
        }
        return { status: 'failed', error }
      } finally {
        unregister()
      }
    },
  }
}
