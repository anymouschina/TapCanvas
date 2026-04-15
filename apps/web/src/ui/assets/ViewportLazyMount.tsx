import React from 'react'

type ViewportLazyMountProps = {
  children: React.ReactNode
  className: string
  placeholderClassName: string
  rootRef: React.RefObject<HTMLElement | null>
  minHeight: number
  rootMargin?: string
}

export function ViewportLazyMount({
  children,
  className,
  placeholderClassName,
  rootRef,
  minHeight,
  rootMargin = '240px 0px',
}: ViewportLazyMountProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const [isMounted, setIsMounted] = React.useState(false)

  React.useEffect(() => {
    if (isMounted) return
    const host = hostRef.current
    if (!host) return
    if (typeof IntersectionObserver === 'undefined') {
      setIsMounted(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        if (!entry.isIntersecting && entry.intersectionRatio <= 0) return
        setIsMounted(true)
        observer.disconnect()
      },
      {
        root: rootRef.current,
        rootMargin,
        threshold: 0.01,
      },
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [isMounted, rootMargin, rootRef])

  return (
    <div className={className} ref={hostRef}>
      {isMounted ? (
        children
      ) : (
        <div
          className={placeholderClassName}
          aria-hidden="true"
          style={{ minHeight }}
        />
      )}
    </div>
  )
}
