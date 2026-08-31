import React from 'react'
import { buildClickBurstSparks, shouldCreateClickBurst } from './globalClickFeedback.logic'

export function GlobalClickFeedback(): JSX.Element {
  const layerRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const createBurst = (event: MouseEvent): void => {
      const layer = layerRef.current
      if (!layer || !shouldCreateClickBurst(event)) return

      const burst = document.createElement('span')
      burst.className = 'global-click-feedback__burst'
      burst.style.left = `${event.clientX}px`
      burst.style.top = `${event.clientY}px`

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
      layer.append(burst)
    }

    document.addEventListener('click', createBurst, { capture: true, passive: true })
    return () => {
      document.removeEventListener('click', createBurst, { capture: true })
      layerRef.current?.replaceChildren()
    }
  }, [])

  return <div className="global-click-feedback" ref={layerRef} aria-hidden="true" />
}
