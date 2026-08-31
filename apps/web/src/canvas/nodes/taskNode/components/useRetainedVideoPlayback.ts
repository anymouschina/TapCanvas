import React from 'react'
import {
  isCanvasMediaMoving,
  subscribeCanvasMediaMotion,
} from '../../../../domain/resource-runtime/hooks/useViewportVisibility'
import { readVideoPlayback, saveVideoPlayback } from '../../videoPlaybackStore'
import {
  acquireRetainedVideoSurface,
  bindRetainedVideoSource,
  buildRetainedVideoSurfaceKey,
  claimRetainedVideoDecoder,
  readRetainedVideoSurfaceFrame,
  setRetainedVideoSurfaceFocused,
  setRetainedVideoSurfaceFrame,
  touchRetainedVideoDecoder,
  updateRetainedVideoSurfaceDimensions,
  type RetainedVideoPlaybackHandoff,
} from './retainedVideoSurface'

const MIN_RESTORED_FRAME_TIME = 0.001
const VIDEO_END_GUARD_SECONDS = 0.05

type UseRetainedVideoPlaybackInput = {
  src: string
  nodeId?: string
  focused: boolean
  onNaturalSize?: (width: number, height: number) => void
}

type UseRetainedVideoPlaybackResult = {
  videoHostRef: React.RefObject<HTMLDivElement>
  videoRef: React.RefObject<HTMLVideoElement>
  surfaceRequested: boolean
  hovering: boolean
  manualPlayback: boolean
  hoverPlaybackFrameVisible: boolean
  handleEnter: (event: React.PointerEvent<HTMLDivElement>) => void
  handleLeave: () => void
  handleManualPlayback: (playing: boolean) => void
}

function isVideoElement(target: EventTarget | null): target is HTMLVideoElement {
  return target instanceof HTMLVideoElement
}

function readCurrentTime(element: HTMLVideoElement): number {
  return Number.isFinite(element.currentTime) && element.currentTime > 0 ? element.currentTime : 0
}

function resolveRestoredTime(element: HTMLVideoElement, savedTime: number): number {
  const requestedTime = Number.isFinite(savedTime) && savedTime > 0
    ? savedTime
    : MIN_RESTORED_FRAME_TIME
  if (!Number.isFinite(element.duration) || element.duration <= VIDEO_END_GUARD_SECONDS) {
    return requestedTime
  }
  return Math.min(requestedTime, Math.max(MIN_RESTORED_FRAME_TIME, element.duration - VIDEO_END_GUARD_SECONDS))
}

/** Owns the retained video element, decoder lease, playback state and canvas-motion lifecycle. */
export function useRetainedVideoPlayback({
  src,
  nodeId,
  focused,
  onNaturalSize,
}: UseRetainedVideoPlaybackInput): UseRetainedVideoPlaybackResult {
  const surfaceKey = React.useMemo(
    () => buildRetainedVideoSurfaceKey(nodeId, src),
    [nodeId, src],
  )
  const videoHostRef = React.useRef<HTMLDivElement | null>(null)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const onNaturalSizeRef = React.useRef(onNaturalSize)
  const pendingFrameCallbackRef = React.useRef<number | null>(null)
  const playbackRequestVersionRef = React.useRef(0)
  const resumeAfterCanvasMotionRef = React.useRef(false)
  const hoveringRef = React.useRef(false)
  const hoverStartTimeRef = React.useRef(0)
  const handoffPlaybackRef = React.useRef<RetainedVideoPlaybackHandoff | null>(null)
  const initialPlayback = readVideoPlayback(surfaceKey)
  const manualPlaybackRef = React.useRef(initialPlayback?.manualPlayback === true)
  const hasDecodedFrameRef = React.useRef(readRetainedVideoSurfaceFrame(surfaceKey))
  const frameVisibleRef = React.useRef(hasDecodedFrameRef.current)
  const [surfaceRequested, setSurfaceRequested] = React.useState(
    () => focused || hasDecodedFrameRef.current || initialPlayback?.hasFrame === true,
  )
  const [hovering, setHovering] = React.useState(false)
  const [manualPlayback, setManualPlayback] = React.useState(manualPlaybackRef.current)
  const [frameVisible, setFrameVisible] = React.useState(frameVisibleRef.current)
  const [hoverPlaybackFrameVisible, setHoverPlaybackFrameVisible] = React.useState(false)

  React.useEffect(() => {
    onNaturalSizeRef.current = onNaturalSize
  }, [onNaturalSize])

  React.useEffect(() => {
    frameVisibleRef.current = frameVisible
  }, [frameVisible])

  const saveCurrentPlayback = React.useCallback((
    element: HTMLVideoElement,
    isPlaying: boolean,
  ): void => {
    saveVideoPlayback(surfaceKey, {
      time: readCurrentTime(element),
      playing: isPlaying,
      hasFrame: hasDecodedFrameRef.current,
      manualPlayback: manualPlaybackRef.current,
    })
  }, [surfaceKey])

  const cancelPendingFrame = React.useCallback((): void => {
    const video = videoRef.current
    if (
      video
      && pendingFrameCallbackRef.current !== null
      && typeof video.cancelVideoFrameCallback === 'function'
    ) {
      video.cancelVideoFrameCallback(pendingFrameCallbackRef.current)
    }
    pendingFrameCallbackRef.current = null
  }, [])

  const cancelPendingPlayback = React.useCallback((): void => {
    playbackRequestVersionRef.current += 1
  }, [])

  const requestPlayback = React.useCallback((element: HTMLVideoElement): void => {
    const requestVersion = ++playbackRequestVersionRef.current
    void element.play().catch(() => {
      // A focus change, pointer leave, canvas motion, eviction or unmount can
      // invalidate this request while the browser is still deciding autoplay.
      // Never let that stale rejection start a background decoder again.
      if (playbackRequestVersionRef.current !== requestVersion) return
      element.muted = true
      void element.play().catch(() => undefined)
    })
  }, [])

  const revealDecodedFrame = React.useCallback((
    video: HTMLVideoElement,
    revealHoverPlayback: boolean,
  ): void => {
    setRetainedVideoSurfaceFrame(video, true)
    hasDecodedFrameRef.current = true
    if (revealHoverPlayback && hoveringRef.current) {
      setHoverPlaybackFrameVisible(true)
    }
    if (isCanvasMediaMoving()) return
    frameVisibleRef.current = true
    setFrameVisible(true)
  }, [])

  const requestFrameReveal = React.useCallback((video: HTMLVideoElement): void => {
    cancelPendingFrame()
    if (typeof video.requestVideoFrameCallback === 'function') {
      pendingFrameCallbackRef.current = video.requestVideoFrameCallback(() => {
        pendingFrameCallbackRef.current = null
        revealDecodedFrame(video, true)
      })
      return
    }
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      window.requestAnimationFrame(() => revealDecodedFrame(video, true))
    }
  }, [cancelPendingFrame, revealDecodedFrame])

  const handleSurfaceEvicted = React.useCallback((): void => {
    cancelPendingPlayback()
    const video = videoRef.current
    manualPlaybackRef.current = false
    setManualPlayback(false)
    hasDecodedFrameRef.current = false
    frameVisibleRef.current = false
    setFrameVisible(false)
    setHoverPlaybackFrameVisible(false)
    if (video) {
      saveVideoPlayback(surfaceKey, {
        time: readCurrentTime(video),
        playing: false,
        hasFrame: false,
        manualPlayback: false,
      })
    }
  }, [cancelPendingPlayback, surfaceKey])

  React.useLayoutEffect(() => {
    if (!surfaceRequested) return
    const host = videoHostRef.current
    if (!host) return

    const lease = acquireRetainedVideoSurface(surfaceKey, host, handleSurfaceEvicted)
    const video = lease.element
    videoRef.current = video
    handoffPlaybackRef.current = lease.handoff
    hasDecodedFrameRef.current = lease.hasFrame
    frameVisibleRef.current = lease.hasFrame
    // A retained frame is decoder state, not permission to cover the static
    // poster. A playback interaction reveals the native video surface only
    // after it has produced a fresh playback frame (or when manual playback
    // has explicitly been kept alive by the user).
    video.style.opacity = '0'
    setFrameVisible(lease.hasFrame)

    return () => {
      cancelPendingFrame()
      cancelPendingPlayback()
      resumeAfterCanvasMotionRef.current = false
      saveCurrentPlayback(video, !video.paused)
      videoRef.current = null
      lease.release()
    }
  }, [cancelPendingFrame, cancelPendingPlayback, handleSurfaceEvicted, saveCurrentPlayback, surfaceKey, surfaceRequested])

  React.useLayoutEffect(() => {
    const video = videoRef.current
    if (!video) return
    setRetainedVideoSurfaceFocused(video, focused)
    video.dataset.tcFocused = focused ? '1' : ''
    // Losing node focus keeps the playback checkpoint, but it must not leave an
    // off-focus decoder playing forever.
    // Hover still wins: a pointer that genuinely remains over the surface keeps
    // TapNow-style hover playback alive until handleLeave pauses it.
    if (!focused && !hovering && !manualPlaybackRef.current && !video.paused) {
      cancelPendingPlayback()
      try {
        video.pause()
      } catch {
        // A decoder-budget eviction may have released the source first.
      }
      saveCurrentPlayback(video, false)
    }
  }, [cancelPendingPlayback, focused, hovering, manualPlayback, saveCurrentPlayback, surfaceRequested])

  React.useLayoutEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.style.opacity = manualPlayback || (hovering && hoverPlaybackFrameVisible) ? '1' : '0'
  }, [hoverPlaybackFrameVisible, hovering, manualPlayback, surfaceRequested])

  React.useEffect(() => {
    if (focused) setSurfaceRequested(true)
  }, [focused])

  const handlePlaying = React.useCallback((event: Event): void => {
    if (!isVideoElement(event.currentTarget)) return
    const video = event.currentTarget
    claimRetainedVideoDecoder(video)
    saveCurrentPlayback(video, true)
    requestFrameReveal(video)
  }, [requestFrameReveal, saveCurrentPlayback])

  const handlePause = React.useCallback((event: Event): void => {
    if (!isVideoElement(event.currentTarget)) return
    saveCurrentPlayback(event.currentTarget, false)
  }, [saveCurrentPlayback])

  const handleLoadedData = React.useCallback((event: Event): void => {
    if (!isVideoElement(event.currentTarget)) return
    // Loading/restoring a retained source is not proof that this hover has a
    // playable frame yet. Only requestVideoFrameCallback from playing/seeked
    // may remove the poster for the current preview interaction.
    revealDecodedFrame(event.currentTarget, false)
  }, [revealDecodedFrame])

  const handleSeeked = React.useCallback((event: Event): void => {
    if (!isVideoElement(event.currentTarget)) return
    requestFrameReveal(event.currentTarget)
  }, [requestFrameReveal])

  const handleEmptied = React.useCallback((event: Event): void => {
    if (!isVideoElement(event.currentTarget)) return
    setRetainedVideoSurfaceFrame(event.currentTarget, false)
    hasDecodedFrameRef.current = false
    frameVisibleRef.current = false
    setFrameVisible(false)
    setHoverPlaybackFrameVisible(false)
  }, [])

  const handleTimeUpdate = React.useCallback((event: Event): void => {
    if (!isVideoElement(event.currentTarget)) return
    const video = event.currentTarget
    if (
      hoveringRef.current
      && Math.abs(readCurrentTime(video) - hoverStartTimeRef.current) > 0.01
    ) {
      // requestVideoFrameCallback is preferred, but some embedded Chromium
      // surfaces do not deliver it reliably while promoting a native video
      // layer. Timeline advancement is the deterministic fallback signal that
      // this hover has moved beyond its retained frame.
      setHoverPlaybackFrameVisible(true)
    }
    touchRetainedVideoDecoder(video)
    saveCurrentPlayback(video, !video.paused)
  }, [saveCurrentPlayback])

  const handleLoadedMetadata = React.useCallback((event: Event): void => {
    if (!isVideoElement(event.currentTarget)) return
    const video = event.currentTarget
    updateRetainedVideoSurfaceDimensions(video, video.videoWidth, video.videoHeight)
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      onNaturalSizeRef.current?.(video.videoWidth, video.videoHeight)
    }
  }, [])

  React.useEffect(() => {
    if (!surfaceRequested) return
    const video = videoRef.current
    if (!video) return
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('pause', handlePause)
    video.addEventListener('loadeddata', handleLoadedData)
    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('emptied', handleEmptied)
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    return () => {
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('loadeddata', handleLoadedData)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('emptied', handleEmptied)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
    }
  }, [
    handleEmptied,
    handleLoadedData,
    handleLoadedMetadata,
    handlePause,
    handlePlaying,
    handleSeeked,
    handleTimeUpdate,
    surfaceRequested,
  ])

  const bindSource = React.useCallback((video: HTMLVideoElement): boolean => {
    const changed = bindRetainedVideoSource(video, src)
    claimRetainedVideoDecoder(video)
    if (changed) {
      hasDecodedFrameRef.current = false
      frameVisibleRef.current = false
      setFrameVisible(false)
    }
    return changed
  }, [src])

  React.useEffect(() => {
    if (!surfaceRequested) return
    const video = videoRef.current
    if (!video) return
    const saved = readVideoPlayback(surfaceKey)
    const handoff = handoffPlaybackRef.current
    handoffPlaybackRef.current = null
    if (!focused && saved?.hasFrame !== true && !handoff) return

    bindSource(video)
    if (!video.dataset.tcUnmuted) video.muted = true

    const restoredManualPlayback = saved?.manualPlayback === true || handoff?.manualPlayback === true
    manualPlaybackRef.current = restoredManualPlayback
    setManualPlayback(restoredManualPlayback)
    if (restoredManualPlayback) video.dataset.tcManualPlayback = '1'
    else delete video.dataset.tcManualPlayback
    const shouldResumePlayback = (focused || restoredManualPlayback)
      && (saved?.playing === true || handoff?.playing === true)
    let metadataListener: (() => void) | null = null
    const restoreFrame = (): void => {
      if (saved?.hasFrame !== true && !handoff) return
      const restoredTime = resolveRestoredTime(video, handoff?.currentTime ?? saved?.time ?? 0)
      if (Math.abs(video.currentTime - restoredTime) <= 0.01 && hasDecodedFrameRef.current) return
      try {
        video.currentTime = restoredTime
      } catch {
        // The loadedmetadata listener retries once the timeline becomes seekable.
      }
    }

    if (saved?.hasFrame || handoff) {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) restoreFrame()
      else {
        metadataListener = () => {
          restoreFrame()
          if (shouldResumePlayback) requestPlayback(video)
        }
        video.addEventListener('loadedmetadata', metadataListener, { once: true })
      }
    }
    // A playing focused surface resumes after its playback state is handed to
    // the full editor. An unfocused shell only resumes when playback was
    // explicitly started by the user; hover previews never create background
    // players after selection changes.
    if (shouldResumePlayback && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      requestPlayback(video)
    }

    return () => {
      if (metadataListener) video.removeEventListener('loadedmetadata', metadataListener)
    }
  }, [bindSource, focused, requestPlayback, surfaceKey, surfaceRequested])

  React.useEffect(() => {
    if (!surfaceRequested || !hovering) return
    const video = videoRef.current
    if (!video) return
    bindSource(video)
    if (!video.dataset.tcUnmuted) video.muted = true
    requestPlayback(video)
  }, [bindSource, hovering, requestPlayback, surfaceRequested])

  const handleManualPlayback = React.useCallback((playing: boolean): void => {
    manualPlaybackRef.current = playing
    setManualPlayback(playing)
    const video = videoRef.current
    if (!video) return
    if (playing) video.dataset.tcManualPlayback = '1'
    else delete video.dataset.tcManualPlayback
    saveCurrentPlayback(video, playing && !video.paused)
  }, [saveCurrentPlayback])

  React.useEffect(() => {
    if (!surfaceRequested) return
    return subscribeCanvasMediaMotion((moving) => {
      const video = videoRef.current
      if (!video) return
      if (moving) {
        cancelPendingFrame()
        cancelPendingPlayback()
        resumeAfterCanvasMotionRef.current = !video.paused
        if (!video.paused) video.pause()
        return
      }

      const shouldResume = resumeAfterCanvasMotionRef.current && (focused || hovering)
      resumeAfterCanvasMotionRef.current = false
      // loadeddata may arrive while the canvas is moving. The decoded frame is
      // already safe to reveal once the viewport settles; no seek or source
      // replacement is required. Existing visible frames never leave the
      // compositor, matching the stable paused-frame lifecycle used by TapNow.
      if (hasDecodedFrameRef.current && !frameVisibleRef.current) {
        frameVisibleRef.current = true
        setFrameVisible(true)
      }
      if (shouldResume) {
        claimRetainedVideoDecoder(video)
        requestPlayback(video)
      }
    })
  }, [cancelPendingFrame, cancelPendingPlayback, focused, hovering, requestPlayback, surfaceRequested])

  const handleEnter = React.useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch' || isCanvasMediaMoving()) return
    hoveringRef.current = true
    hoverStartTimeRef.current = videoRef.current ? readCurrentTime(videoRef.current) : 0
    setHoverPlaybackFrameVisible(false)
    setSurfaceRequested(true)
    setHovering(true)
  }, [])

  const handleLeave = React.useCallback((): void => {
    hoveringRef.current = false
    setHoverPlaybackFrameVisible(false)
    setHovering(false)
    const video = videoRef.current
    if (!video) return
    if (manualPlaybackRef.current) {
      saveCurrentPlayback(video, !video.paused)
      return
    }
    cancelPendingPlayback()
    try {
      video.pause()
    } catch {
      // A decoder-budget eviction may have released the source first.
    }
    saveCurrentPlayback(video, false)
  }, [cancelPendingPlayback, saveCurrentPlayback])

  return {
    videoHostRef,
    videoRef,
    surfaceRequested,
    hovering,
    manualPlayback,
    hoverPlaybackFrameVisible,
    handleEnter,
    handleLeave,
    handleManualPlayback,
  }
}
