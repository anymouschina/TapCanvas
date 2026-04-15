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

export function useViewportVisibility<T extends Element>(
  options?: UseViewportVisibilityOptions,
): UseViewportVisibilityResult<T> {
  const enabled = options?.enabled !== false
  const rootMargin = options?.rootMargin ?? '240px'
  const freezeOnceVisible = options?.freezeOnceVisible === true
  const ref = React.useRef<T | null>(null)
  const [isVisible, setIsVisible] = React.useState(false)
  const [hasEverBeenVisible, setHasEverBeenVisible] = React.useState(false)

  React.useEffect(() => {
    setIsVisible(false)
    setHasEverBeenVisible(false)
  }, [enabled, rootMargin])

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
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        const nextVisible = Boolean(entry?.isIntersecting || (entry?.intersectionRatio ?? 0) > 0)
        if (nextVisible) {
          setHasEverBeenVisible(true)
        }
        setIsVisible(nextVisible)
      },
      { root: null, rootMargin, threshold: 0 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled, freezeOnceVisible, rootMargin])

  return { ref, isVisible: freezeOnceVisible && hasEverBeenVisible ? true : isVisible, hasEverBeenVisible }
}
