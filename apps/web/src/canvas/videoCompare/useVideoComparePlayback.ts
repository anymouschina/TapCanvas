import React from 'react'
import type { VideoCompareSource } from './videoCompareSource'
import {
  clampComparisonTime,
  resolveComparisonDuration,
  resolveCorrespondingVideoTime,
  sanitizeVideoDuration,
} from './videoCompareTime'

export type VideoCompareSlot = 'source' | 'target'

type VideoCompareDurations = Record<VideoCompareSlot, number>
type VideoCompareLoadErrors = Partial<Record<VideoCompareSlot, string>>

type UseVideoComparePlaybackInput = {
  source: VideoCompareSource
  target: VideoCompareSource
}

const DRIFT_CORRECTION_SECONDS = 0.14
const END_EPSILON_SECONDS = 0.03

function getPlaybackErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : '浏览器拒绝了媒体播放请求'
}

export function useVideoComparePlayback({ source, target }: UseVideoComparePlaybackInput) {
  const sourceVideoRef = React.useRef<HTMLVideoElement>(null)
  const targetVideoRef = React.useRef<HTMLVideoElement>(null)
  const currentTimeRef = React.useRef(0)
  const resumeAfterScrubRef = React.useRef(false)

  const [durations, setDurations] = React.useState<VideoCompareDurations>({
    source: sanitizeVideoDuration(source.durationSeconds),
    target: sanitizeVideoDuration(target.durationSeconds),
  })
  const [currentTime, setCurrentTime] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [muted, setMuted] = React.useState(true)
  const [playbackError, setPlaybackError] = React.useState<string | null>(null)
  const [loadErrors, setLoadErrors] = React.useState<VideoCompareLoadErrors>({})

  const totalDuration = React.useMemo(
    () => resolveComparisonDuration([durations.source, durations.target]),
    [durations.source, durations.target],
  )

  const pauseElements = React.useCallback((): void => {
    sourceVideoRef.current?.pause()
    targetVideoRef.current?.pause()
  }, [])

  const syncElement = React.useCallback((
    element: HTMLVideoElement | null,
    duration: number,
    sharedTime: number,
    force: boolean,
  ): void => {
    if (!element || element.readyState === HTMLMediaElement.HAVE_NOTHING) return
    const desiredTime = resolveCorrespondingVideoTime(sharedTime, duration)
    if (force || Math.abs(element.currentTime - desiredTime) > DRIFT_CORRECTION_SECONDS) {
      element.currentTime = desiredTime
    }
    element.muted = muted
  }, [muted])

  const syncElements = React.useCallback((sharedTime: number, force: boolean): void => {
    syncElement(sourceVideoRef.current, durations.source, sharedTime, force)
    syncElement(targetVideoRef.current, durations.target, sharedTime, force)
  }, [durations.source, durations.target, syncElement])

  const seek = React.useCallback((nextTime: number): void => {
    const clamped = clampComparisonTime(nextTime, totalDuration)
    currentTimeRef.current = clamped
    setCurrentTime(clamped)
    syncElements(clamped, true)
  }, [syncElements, totalDuration])

  const startPlayback = React.useCallback(async (): Promise<void> => {
    if (durations.source <= 0 || durations.target <= 0) {
      setPlaybackError('两段视频的时长元数据尚未全部加载，暂时不能同步播放。')
      return
    }

    const startTime = currentTimeRef.current >= totalDuration - END_EPSILON_SECONDS
      ? 0
      : currentTimeRef.current
    seek(startTime)
    setPlaybackError(null)

    const candidates = [
      { element: sourceVideoRef.current, duration: durations.source, label: source.label },
      { element: targetVideoRef.current, duration: durations.target, label: target.label },
    ].filter((candidate): candidate is { element: HTMLVideoElement; duration: number; label: string } => (
      candidate.element !== null && startTime < candidate.duration - END_EPSILON_SECONDS
    ))

    if (candidates.length === 0) {
      setPlaybackError('没有可从当前时间码继续播放的视频。')
      return
    }

    const attempts = await Promise.allSettled(candidates.map(({ element }) => {
      element.muted = muted
      return element.play()
    }))
    const rejectedIndex = attempts.findIndex((attempt) => attempt.status === 'rejected')
    if (rejectedIndex >= 0) {
      pauseElements()
      const rejected = attempts[rejectedIndex]
      const reason = rejected?.status === 'rejected' ? rejected.reason : null
      setPlaybackError(`${candidates[rejectedIndex]?.label || '视频'} 无法同步播放：${getPlaybackErrorMessage(reason)}`)
      return
    }

    setPlaying(true)
  }, [
    durations.source,
    durations.target,
    muted,
    pauseElements,
    seek,
    source.label,
    target.label,
    totalDuration,
  ])

  const togglePlayback = React.useCallback((): void => {
    if (playing) {
      setPlaying(false)
      return
    }
    void startPlayback()
  }, [playing, startPlayback])

  const beginScrub = React.useCallback((): void => {
    resumeAfterScrubRef.current = playing
    if (playing) setPlaying(false)
  }, [playing])

  const endScrub = React.useCallback((): void => {
    const shouldResume = resumeAfterScrubRef.current
    resumeAfterScrubRef.current = false
    if (shouldResume) void startPlayback()
  }, [startPlayback])

  const handleLoadedMetadata = React.useCallback((
    slot: VideoCompareSlot,
    element: HTMLVideoElement,
  ): void => {
    const duration = sanitizeVideoDuration(element.duration)
    if (duration <= 0) {
      setLoadErrors((current) => ({ ...current, [slot]: '视频已加载，但未返回有效时长。' }))
      return
    }
    setDurations((current) => current[slot] === duration ? current : { ...current, [slot]: duration })
    setLoadErrors((current) => {
      if (!current[slot]) return current
      const next = { ...current }
      delete next[slot]
      return next
    })
    element.muted = muted
    element.currentTime = resolveCorrespondingVideoTime(currentTimeRef.current, duration)
  }, [muted])

  const handleMediaError = React.useCallback((
    slot: VideoCompareSlot,
    element: HTMLVideoElement,
  ): void => {
    const code = element.error?.code
    const details = code ? `（媒体错误 ${code}）` : ''
    setLoadErrors((current) => ({ ...current, [slot]: `视频资源加载失败${details}` }))
    setPlaying(false)
  }, [])

  React.useEffect(() => {
    const sourceElement = sourceVideoRef.current
    const targetElement = targetVideoRef.current
    if (sourceElement) sourceElement.muted = muted
    if (targetElement) targetElement.muted = muted
  }, [muted])

  React.useEffect(() => {
    if (!playing) {
      pauseElements()
      return
    }

    const originTime = currentTimeRef.current
    const originWallTime = performance.now()
    let animationFrameId = 0
    const tick = (now: number): void => {
      const nextTime = Math.min(totalDuration, originTime + (now - originWallTime) / 1000)
      currentTimeRef.current = nextTime
      setCurrentTime(nextTime)
      syncElements(nextTime, false)
      if (nextTime >= totalDuration - END_EPSILON_SECONDS) {
        setPlaying(false)
        return
      }
      animationFrameId = window.requestAnimationFrame(tick)
    }
    animationFrameId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(animationFrameId)
  }, [pauseElements, playing, syncElements, totalDuration])

  React.useEffect(() => {
    if (currentTimeRef.current <= totalDuration) return
    seek(totalDuration)
  }, [seek, totalDuration])

  React.useEffect(() => () => pauseElements(), [pauseElements])

  return {
    sourceVideoRef,
    targetVideoRef,
    durations,
    totalDuration,
    currentTime,
    playing,
    muted,
    playbackError,
    loadErrors,
    setMuted,
    seek,
    togglePlayback,
    beginScrub,
    endScrub,
    handleLoadedMetadata,
    handleMediaError,
  }
}
