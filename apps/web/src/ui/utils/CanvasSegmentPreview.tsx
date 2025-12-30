import React from 'react'

export type WebCutSegmentRange = { start: number; end: number }

type SegmentTimeline = {
  segments: WebCutSegmentRange[]
  cumulativeStarts: number[]
  totalDuration: number
}

function buildTimeline(segments: WebCutSegmentRange[]): SegmentTimeline {
  const normalized = (segments || [])
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0 }))
    .map((s) => (s.end >= s.start ? s : ({ start: s.end, end: s.start })))
    .map((s) => ({ start: Math.max(0, s.start), end: Math.max(0, s.end) }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end))
    .filter((s) => s.end - s.start > 0.02)

  const cumulativeStarts: number[] = []
  let acc = 0
  for (const s of normalized) {
    cumulativeStarts.push(acc)
    acc += Math.max(0, s.end - s.start)
  }
  return { segments: normalized, cumulativeStarts, totalDuration: acc }
}

function mapOutputTimeToSourceTime(timeline: SegmentTimeline, outputTime: number): { sourceTime: number; segmentIndex: number } | null {
  const t = Math.max(0, Number.isFinite(outputTime) ? outputTime : 0)
  if (!timeline.segments.length || timeline.totalDuration <= 0) return null
  const clamped = Math.min(t, Math.max(0, timeline.totalDuration - 0.0001))
  for (let i = 0; i < timeline.segments.length; i += 1) {
    const seg = timeline.segments[i]
    const segStart = timeline.cumulativeStarts[i]
    const segDur = Math.max(0, seg.end - seg.start)
    if (clamped >= segStart && clamped < segStart + segDur) {
      return { sourceTime: seg.start + (clamped - segStart), segmentIndex: i }
    }
  }
  const last = timeline.segments.length - 1
  return { sourceTime: timeline.segments[last].start, segmentIndex: last }
}

export type CanvasSegmentPreviewProps = {
  className?: string
  src: string
  segments: WebCutSegmentRange[]
  playing: boolean
  outputTime: number
  onOutputTimeChange: (t: number) => void
  onDurationResolved?: (duration: number) => void
  height?: number
}

export function CanvasSegmentPreview(props: CanvasSegmentPreviewProps): JSX.Element {
  const { className, src, segments, playing, outputTime, onOutputTimeChange, onDurationResolved, height = 260 } = props
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const rafRef = React.useRef<number | null>(null)
  const frameReqRef = React.useRef<number | null>(null)
  const lastFrameTsRef = React.useRef<number | null>(null)
  const playingRef = React.useRef(false)
  const outputTimeRef = React.useRef(0)
  const timelineRef = React.useRef<SegmentTimeline>(buildTimeline(segments))

  React.useEffect(() => {
    timelineRef.current = buildTimeline(segments)
  }, [segments])

  React.useEffect(() => {
    outputTimeRef.current = outputTime
  }, [outputTime])

  const stopLoops = React.useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (frameReqRef.current != null && videoRef.current && 'cancelVideoFrameCallback' in videoRef.current) {
      try {
        ;(videoRef.current as any).cancelVideoFrameCallback(frameReqRef.current)
      } catch {
        // ignore
      }
    }
    frameReqRef.current = null
    lastFrameTsRef.current = null
  }, [])

  const drawOnce = React.useCallback(() => {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    try {
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.drawImage(v, 0, 0, c.width, c.height)
    } catch {
      // ignore draw errors (e.g. CORS-tainted source)
    }
  }, [])

  const syncSeekToOutputTime = React.useCallback(async (t: number) => {
    const v = videoRef.current
    if (!v) return
    const timeline = timelineRef.current
    const mapped = mapOutputTimeToSourceTime(timeline, t)
    if (!mapped) return
    const next = Math.max(0, mapped.sourceTime)
    if (!Number.isFinite(next)) return
    try {
      v.currentTime = next
    } catch {
      // ignore
    }
  }, [])

  const tick = React.useCallback((ts: number) => {
    const v = videoRef.current
    const timeline = timelineRef.current
    if (!v) return

    const now = typeof ts === 'number' ? ts : performance.now()
    const last = lastFrameTsRef.current
    lastFrameTsRef.current = now

    if (playingRef.current && last != null) {
      const dt = Math.max(0, Math.min(0.25, (now - last) / 1000))
      const nextOutput = outputTimeRef.current + dt
      const total = timeline.totalDuration
      if (total > 0 && nextOutput >= total) {
        outputTimeRef.current = total
        onOutputTimeChange(total)
        v.pause()
        playingRef.current = false
      } else {
        outputTimeRef.current = nextOutput
        onOutputTimeChange(nextOutput)
      }
    }

    const desired = mapOutputTimeToSourceTime(timeline, outputTimeRef.current)
    if (desired) {
      const wanted = desired.sourceTime
      const curr = v.currentTime || 0
      // Only seek when the underlying source time is far away (e.g. segment jumps / reorder).
      if (Math.abs(curr - wanted) > 0.18) {
        try {
          v.currentTime = Math.max(0, wanted)
        } catch {
          // ignore
        }
      }
    }

    drawOnce()

    if (playingRef.current) {
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [drawOnce, onOutputTimeChange])

  React.useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onLoaded = () => {
      const w = v.videoWidth || 0
      const h = v.videoHeight || 0
      const c = canvasRef.current
      if (c && w > 0 && h > 0) {
        c.width = w
        c.height = h
      }
      const d = Number.isFinite(v.duration) ? v.duration : 0
      if (d > 0) onDurationResolved?.(d)
      drawOnce()
    }
    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('loadeddata', onLoaded)
    return () => {
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('loadeddata', onLoaded)
    }
  }, [drawOnce, onDurationResolved])

  React.useEffect(() => {
    if (!playing) {
      playingRef.current = false
      const v = videoRef.current
      if (v) v.pause()
      stopLoops()
      return
    }

    const v = videoRef.current
    if (!v) return
    playingRef.current = true

    void syncSeekToOutputTime(outputTimeRef.current).finally(() => {
      v.play().catch(() => {})
      stopLoops()
      rafRef.current = requestAnimationFrame(tick)
    })

    return () => {
      playingRef.current = false
      stopLoops()
    }
  }, [playing, stopLoops, syncSeekToOutputTime, tick])

  React.useEffect(() => {
    if (playingRef.current) return
    stopLoops()
    void syncSeekToOutputTime(outputTime).finally(() => {
      drawOnce()
    })
  }, [drawOnce, outputTime, stopLoops, syncSeekToOutputTime])

  React.useEffect(() => () => stopLoops(), [stopLoops])

  const containerClassName = ['canvas-segment-preview', className].filter(Boolean).join(' ')

  return (
    <div className={containerClassName} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: 'rgba(127,127,127,.12)', height }}>
      <canvas className="canvas-segment-preview__canvas" ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <video
        className="canvas-segment-preview__video"
        ref={videoRef}
        src={src}
        muted
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
    </div>
  )
}
