import React from 'react'

import { buildClickBurstSparks } from '../../globalClickFeedback.logic'

type PreviewInteractionBoundaryProps = {
  children: React.ReactNode
  className: string
}

export function PreviewInteractionBoundary({
  children,
  className,
}: PreviewInteractionBoundaryProps): JSX.Element {
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  const createClickFeedback = React.useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.detail <= 0) return
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const burst = document.createElement('span')
    burst.className = 'stats-homepage-preview__click-burst'
    burst.style.left = `${event.clientX - rect.left}px`
    burst.style.top = `${event.clientY - rect.top}px`

    const ring = document.createElement('span')
    ring.className = 'global-click-feedback__ring'
    burst.append(ring)
    for (const sparkConfig of buildClickBurstSparks()) {
      const spark = document.createElement('span')
      spark.className = 'global-click-feedback__spark'
      spark.style.setProperty('--tc-click-spark-angle', `${sparkConfig.angle}deg`)
      spark.style.setProperty('--tc-click-spark-distance', `${sparkConfig.distance}px`)
      spark.style.setProperty('--tc-click-spark-delay', `${sparkConfig.delay}ms`)
      burst.append(spark)
    }
    burst.addEventListener('animationend', (animationEvent) => {
      if (animationEvent.target === burst) burst.remove()
    })
    root.append(burst)
  }, [])

  return (
    <div
      ref={rootRef}
      className={className}
      data-click-feedback-scope="local"
      onClickCapture={createClickFeedback}
    >
      {children}
    </div>
  )
}
