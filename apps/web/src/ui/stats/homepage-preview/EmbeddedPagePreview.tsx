import React from 'react'

import {
  HOMEPAGE_PREVIEW_QUERY_KEY,
  type HomepagePreviewSnapshot,
  postHomepagePreviewSnapshot,
} from '../../../portal/homepagePreviewSnapshot'
import type { HomepagePreviewViewport } from './HomepageShellPreview'

const PREVIEW_WIDTHS: Record<HomepagePreviewViewport, number> = {
  desktop: 1440,
  mobile: 390,
}

type EmbeddedPagePreviewProps = {
  href: string
  viewport: HomepagePreviewViewport
  onLocationChange: (href: string) => void
  snapshot: HomepagePreviewSnapshot
}

type EmbeddedFrameMetrics = {
  scale: number
  height: number
}

function readFrameLocation(frame: HTMLIFrameElement): string | null {
  try {
    const location = frame.contentWindow?.location
    if (!location) return null
    const searchParams = new URLSearchParams(location.search)
    searchParams.delete(HOMEPAGE_PREVIEW_QUERY_KEY)
    const search = searchParams.toString()
    return `${location.pathname}${search ? `?${search}` : ''}${location.hash}`
  } catch {
    return null
  }
}

export function EmbeddedPagePreview({
  href,
  viewport,
  onLocationChange,
  snapshot,
}: EmbeddedPagePreviewProps): JSX.Element {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const frameRef = React.useRef<HTMLIFrameElement | null>(null)
  const width = PREVIEW_WIDTHS[viewport]
  const [metrics, setMetrics] = React.useState<EmbeddedFrameMetrics>({ scale: 1, height: 1 })

  React.useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return

    const updateMetrics = (): void => {
      const scale = host.clientWidth > 0 ? Math.min(1, host.clientWidth / width) : 1
      const height = Math.max(1, host.clientHeight / scale)
      setMetrics((current) => {
        if (Math.abs(current.scale - scale) < 0.001 && Math.abs(current.height - height) < 1) return current
        return { scale, height }
      })
    }

    updateMetrics()
    const resizeObserver = new ResizeObserver(updateMetrics)
    resizeObserver.observe(host)
    return () => resizeObserver.disconnect()
  }, [width])

  const syncLocation = React.useCallback((): void => {
    const frame = frameRef.current
    if (!frame) return
    const nextLocation = readFrameLocation(frame)
    if (nextLocation) onLocationChange(nextLocation)
  }, [onLocationChange])

  const sendSnapshot = React.useCallback((): void => {
    const frameWindow = frameRef.current?.contentWindow
    if (frameWindow) postHomepagePreviewSnapshot(frameWindow, snapshot)
  }, [snapshot])

  const frameHref = React.useMemo(() => {
    const url = new URL(href, window.location.origin)
    url.searchParams.set(HOMEPAGE_PREVIEW_QUERY_KEY, '1')
    return `${url.pathname}${url.search}${url.hash}`
  }, [href])

  React.useEffect(() => {
    sendSnapshot()
  }, [sendSnapshot])

  React.useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow
    if (!frameWindow) return
    frameWindow.addEventListener('popstate', syncLocation)
    return () => frameWindow.removeEventListener('popstate', syncLocation)
  }, [syncLocation])

  return (
    <div ref={hostRef} className={`stats-homepage-embedded-preview is-${viewport}`}>
      <div
        className="stats-homepage-embedded-preview__surface"
        style={{
          width,
          height: metrics.height,
          transform: `scale(${metrics.scale})`,
        }}
      >
        <iframe
          ref={frameRef}
          className="stats-homepage-embedded-preview__frame"
          src={frameHref}
          title={`TapCanvas ${href} 页面预览`}
          onLoad={() => {
            syncLocation()
            sendSnapshot()
          }}
        />
      </div>
    </div>
  )
}
