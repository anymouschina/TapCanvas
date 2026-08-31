import React from 'react'

type UseViewportVisibilityOptions = {
  enabled?: boolean
  rootMargin?: string
  freezeOnceVisible?: boolean
}

type UseViewportVisibilityResult<T extends Element> = {
  ref: React.RefObject<T | null>
  isVisible: boolean
  hasEverBeenVisible: boolean
}

let canvasViewportMoving = false
let canvasNodeDragging = false
let canvasMediaMoving = false
const viewportSettledListeners = new Set<() => void>()
const viewportMotionListeners = new Set<(moving: boolean) => void>()
const mediaMotionListeners = new Set<(moving: boolean) => void>()

function notifyMediaMotionIfChanged(): void {
  const nextMediaMoving = canvasViewportMoving || canvasNodeDragging
  if (nextMediaMoving === canvasMediaMoving) return
  canvasMediaMoving = nextMediaMoving
  mediaMotionListeners.forEach((listener) => listener(nextMediaMoving))
}

export function isCanvasViewportMoving(): boolean {
  return canvasViewportMoving
}

export function setCanvasViewportMoving(moving: boolean): void {
  if (canvasViewportMoving === moving) return
  canvasViewportMoving = moving
  viewportMotionListeners.forEach((listener) => listener(moving))
  notifyMediaMotionIfChanged()
  if (moving) return
  viewportSettledListeners.forEach((listener) => listener())
}

export function isCanvasMediaMoving(): boolean {
  return canvasMediaMoving
}

export function setCanvasNodeDragging(dragging: boolean): void {
  if (canvasNodeDragging === dragging) return
  canvasNodeDragging = dragging
  notifyMediaMotionIfChanged()
}

export function subscribeCanvasMediaMotion(listener: (moving: boolean) => void): () => void {
  mediaMotionListeners.add(listener)
  return () => {
    mediaMotionListeners.delete(listener)
  }
}

export function subscribeCanvasViewportMotion(listener: (moving: boolean) => void): () => void {
  viewportMotionListeners.add(listener)
  return () => {
    viewportMotionListeners.delete(listener)
  }
}

export function subscribeCanvasViewportSettled(listener: () => void): () => void {
  viewportSettledListeners.add(listener)
  return () => {
    viewportSettledListeners.delete(listener)
  }
}

function parseMarginPx(margin: string): number {
  const m = parseInt(margin, 10)
  return Number.isFinite(m) ? m : 240
}

function isElementInExtendedViewport(el: Element, marginPx: number): boolean {
  try {
    const rect = el.getBoundingClientRect()
    return (
      rect.bottom > -marginPx &&
      rect.top < window.innerHeight + marginPx &&
      rect.right > -marginPx &&
      rect.left < window.innerWidth + marginPx
    )
  } catch {
    return false
  }
}

export function useViewportVisibility<T extends Element>(
  options?: UseViewportVisibilityOptions,
): UseViewportVisibilityResult<T> {
  const enabled = options?.enabled !== false
  const rootMargin = options?.rootMargin ?? '240px'
  const freezeOnceVisible = options?.freezeOnceVisible === true
  const ref = React.useRef<T | null>(null)
  const [isVisible, setIsVisible] = React.useState(false)
  const [hasEverBeenVisible, setHasEverBeenVisible] = React.useState(false)

  // Synchronously check visibility before first paint so already-visible elements
  // don't show a blank frame while waiting for the IntersectionObserver callback.
  React.useLayoutEffect(() => {
    if (!enabled) return
    // Nodes entering the React Flow viewport during pan/zoom must not force a
    // synchronous layout read. Their IntersectionObserver result is queued and
    // applied once the viewport settles.
    if (isCanvasViewportMoving()) return
    const node = ref.current
    if (!node) return
    const marginPx = parseMarginPx(rootMargin)
    if (isElementInExtendedViewport(node, marginPx)) {
      setIsVisible(true)
      setHasEverBeenVisible(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    if (enabled) return
    setIsVisible(false)
    setHasEverBeenVisible(false)
  }, [enabled])

  React.useEffect(() => {
    if (!enabled) {
      setIsVisible(false)
      return
    }
    const node = ref.current
    if (!node) {
      setIsVisible(false)
      return
    }
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      setHasEverBeenVisible(true)
      return
    }
    // Drop IO entries during canvas pan/zoom to avoid per-frame re-renders.
    // A transformed entry captured mid-move is stale by definition and must not
    // be replayed after the viewport reaches its final position.
    const applyEntry = (entry: IntersectionObserverEntry) => {
      const nextVisible = Boolean(entry.isIntersecting || (entry.intersectionRatio ?? 0) > 0)
      if (nextVisible) setHasEverBeenVisible(true)
      setIsVisible(nextVisible)
    }
    const applyMeasuredVisibility = () => {
      const el = ref.current
      if (!el) return
      const marginPx = parseMarginPx(rootMargin)
      const nextVisible = isElementInExtendedViewport(el, marginPx)
      if (nextVisible) setHasEverBeenVisible(true)
      setIsVisible(nextVisible)
    }

    // A virtualized node can commit while the viewport is moving and therefore
    // skip the layout-effect read above. If the move settles before this passive
    // effect subscribes, there is no pending IO entry or settled notification to
    // replay. Measure once at subscription time so that race cannot strand a
    // visible image on its transparent placeholder. This remains off the
    // per-frame pan/zoom path: it runs once for each newly mounted image.
    if (!isCanvasViewportMoving()) applyMeasuredVisibility()

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (!entry) return
        if (isCanvasViewportMoving()) return
        applyEntry(entry)
      },
      { root: null, rootMargin, threshold: 0 },
    )
    observer.observe(node)
    const handleViewportSettled = () => {
      // Always measure the final transformed rect. Replaying an IO entry from
      // mid-pan can mark a now-visible virtualized node as hidden forever.
      applyMeasuredVisibility()
    }
    const unsubscribeViewportSettled = subscribeCanvasViewportSettled(handleViewportSettled)
    return () => {
      observer.disconnect()
      unsubscribeViewportSettled()
    }
  }, [enabled, freezeOnceVisible, rootMargin])

  return { ref, isVisible: freezeOnceVisible && hasEverBeenVisible ? true : isVisible, hasEverBeenVisible }
}
