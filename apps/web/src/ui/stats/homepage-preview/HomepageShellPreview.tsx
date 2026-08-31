import React from 'react'

import type { PublicAssetDto } from '../../../api/server'
import { NeoHomePageSurface } from '../../../portal/NeoHomePage'

const PREVIEW_DIMENSIONS = {
  desktop: { width: 1440, viewportHeight: 900 },
  mobile: { width: 390, viewportHeight: 844 },
} as const

export type HomepagePreviewViewport = keyof typeof PREVIEW_DIMENSIONS

type HomepageShellPreviewProps = {
  viewport: HomepagePreviewViewport
  showcase: PublicAssetDto[]
  showcaseLoading: boolean
  showcaseError: string
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  onNavigate: (href: string) => void
  onRequestLogin: () => void
}

type ScaledSurfaceMetrics = {
  scale: number
  height: number
}

export function HomepageShellPreview({
  viewport,
  showcase,
  showcaseLoading,
  showcaseError,
  scrollContainerRef,
  onNavigate,
  onRequestLogin,
}: HomepageShellPreviewProps): JSX.Element {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const surfaceRef = React.useRef<HTMLDivElement | null>(null)
  const dimensions = PREVIEW_DIMENSIONS[viewport]
  const [metrics, setMetrics] = React.useState<ScaledSurfaceMetrics>({ scale: 1, height: dimensions.viewportHeight })
  const surfaceStyle: React.CSSProperties & { '--neo-home-configured-viewport-height': string } = {
    '--neo-home-configured-viewport-height': `${dimensions.viewportHeight}px`,
    width: dimensions.width,
    minHeight: dimensions.viewportHeight,
    transform: `scale(${metrics.scale})`,
  }

  React.useLayoutEffect(() => {
    const host = hostRef.current
    const surface = surfaceRef.current
    if (!host || !surface) return

    const updateMetrics = (): void => {
      const hostWidth = host.clientWidth
      const scale = hostWidth > 0 ? Math.min(1, hostWidth / dimensions.width) : 1
      const surfaceHeight = Math.max(surface.scrollHeight, dimensions.viewportHeight)
      setMetrics((current) => {
        const height = surfaceHeight * scale
        if (Math.abs(current.scale - scale) < 0.001 && Math.abs(current.height - height) < 1) return current
        return { scale, height }
      })
    }

    updateMetrics()
    const resizeObserver = new ResizeObserver(updateMetrics)
    resizeObserver.observe(host)
    resizeObserver.observe(surface)
    return () => resizeObserver.disconnect()
  }, [dimensions])

  return (
    <div
      ref={hostRef}
      className={`stats-homepage-shell-preview is-${viewport}`}
      style={{ height: metrics.height }}
    >
      <div
        ref={surfaceRef}
        className="stats-homepage-shell-preview__surface"
        style={surfaceStyle}
      >
        <NeoHomePageSurface
          showcase={showcase}
          showcaseLoading={showcaseLoading}
          showcaseError={showcaseError}
          onNavigate={onNavigate}
          onRequestLogin={onRequestLogin}
          scrollContainerRef={scrollContainerRef}
        />
      </div>
    </div>
  )
}
