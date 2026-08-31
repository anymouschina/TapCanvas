import React from 'react'
import { ActionIcon, Slider, Tooltip } from '@mantine/core'
import {
  IconArrowsMaximize,
  IconPlayerPause,
  IconPlayerPlay,
  IconVolume,
  IconVolumeOff,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react'
import type { VideoCompareSource } from './videoCompareSource'
import {
  clampComparisonTime,
  formatVideoCompareTime,
  resolveTimelineTickStep,
} from './videoCompareTime'

type VideoCompareTimelineProps = {
  className?: string
  source: VideoCompareSource
  target: VideoCompareSource
  sourceDuration: number
  targetDuration: number
  totalDuration: number
  currentTime: number
  playing: boolean
  muted: boolean
  disabled: boolean
  onTogglePlayback: () => void
  onMutedChange: (muted: boolean) => void
  onSeek: (timeSeconds: number) => void
  onScrubStart: () => void
  onScrubEnd: () => void
}

const BASE_PX_PER_SECOND = 64
const MIN_TIMELINE_WIDTH = 720

export function VideoCompareTimeline({
  className,
  source,
  target,
  sourceDuration,
  targetDuration,
  totalDuration,
  currentTime,
  playing,
  muted,
  disabled,
  onTogglePlayback,
  onMutedChange,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: VideoCompareTimelineProps): JSX.Element {
  const [zoom, setZoom] = React.useState(1)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const pointerActiveRef = React.useRef(false)
  const pxPerSecond = BASE_PX_PER_SECOND * zoom
  const contentWidth = Math.max(MIN_TIMELINE_WIDTH, totalDuration * pxPerSecond)
  const renderedPxPerSecond = totalDuration > 0 ? contentWidth / totalDuration : pxPerSecond
  const playheadLeft = totalDuration > 0 ? currentTime * renderedPxPerSecond : 0
  const tickStep = resolveTimelineTickStep(renderedPxPerSecond)
  const ticks = totalDuration > 0
    ? Array.from({ length: Math.floor(totalDuration / tickStep) + 1 }, (_, index) => index * tickStep)
    : []

  const seekFromPointer = React.useCallback((clientX: number): void => {
    const content = contentRef.current
    if (!content || totalDuration <= 0) return
    const rect = content.getBoundingClientRect()
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0
    onSeek(clampComparisonTime(ratio * totalDuration, totalDuration))
  }, [onSeek, totalDuration])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerActiveRef.current = true
    onScrubStart()
    seekFromPointer(event.clientX)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!pointerActiveRef.current) return
    seekFromPointer(event.clientX)
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!pointerActiveRef.current) return
    pointerActiveRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onScrubEnd()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (disabled || totalDuration <= 0) return
    const step = event.shiftKey ? 1 : 0.1
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    onScrubStart()
    onSeek(currentTime + (event.key === 'ArrowRight' ? step : -step))
    onScrubEnd()
  }

  const lane = (
    marker: 'A' | 'B',
    item: VideoCompareSource,
    duration: number,
  ): JSX.Element => (
    <div className={`tc-video-compare-timeline__lane tc-video-compare-timeline__lane--${marker.toLowerCase()}`}>
      <div
        className="tc-video-compare-timeline__lane-segment"
        style={{ width: `${Math.max(0, duration * renderedPxPerSecond)}px` }}
      >
        <span className="tc-video-compare-timeline__lane-marker">{marker}</span>
        <span className="tc-video-compare-timeline__lane-label">{item.label}</span>
        <span className="tc-video-compare-timeline__lane-duration">{formatVideoCompareTime(duration)}</span>
      </div>
    </div>
  )

  return (
    <section className={`tc-video-compare-timeline${className ? ` ${className}` : ''}`} aria-label="双视频同步时间轴">
      <div className="tc-video-compare-timeline__controls">
        <div className="tc-video-compare-timeline__playback-controls">
          <span className="tc-video-compare-timeline__timecode tc-video-compare-timeline__timecode--current">
            {formatVideoCompareTime(currentTime)}
          </span>
          <Tooltip className="tc-video-compare-timeline__tooltip" label={playing ? '暂停两个视频' : '同步播放两个视频'}>
            <ActionIcon
              className="tc-video-compare-timeline__action"
              aria-label={playing ? '暂停两个视频' : '同步播放两个视频'}
              variant="subtle"
              size={32}
              disabled={disabled}
              onClick={onTogglePlayback}
            >
              {playing
                ? <IconPlayerPause className="tc-video-compare-timeline__action-icon" size={16} />
                : <IconPlayerPlay className="tc-video-compare-timeline__action-icon" size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip className="tc-video-compare-timeline__tooltip" label={muted ? '开启两段视频声音' : '同时静音'}>
            <ActionIcon
              className="tc-video-compare-timeline__action"
              aria-label={muted ? '开启两段视频声音' : '同时静音'}
              variant="subtle"
              size={32}
              onClick={() => onMutedChange(!muted)}
            >
              {muted
                ? <IconVolumeOff className="tc-video-compare-timeline__action-icon" size={16} />
                : <IconVolume className="tc-video-compare-timeline__action-icon" size={16} />}
            </ActionIcon>
          </Tooltip>
          <span className="tc-video-compare-timeline__timecode tc-video-compare-timeline__timecode--total">
            {formatVideoCompareTime(totalDuration)}
          </span>
        </div>
        <span className="tc-video-compare-timeline__sync-hint">拖动任一位置，同时定位 A / B</span>
        <div className="tc-video-compare-timeline__zoom-controls">
          <Tooltip className="tc-video-compare-timeline__tooltip" label="缩小时间轴">
            <ActionIcon
              className="tc-video-compare-timeline__action"
              aria-label="缩小时间轴"
              variant="subtle"
              size={28}
              onClick={() => setZoom((current) => Math.max(0.5, current - 0.5))}
            >
              <IconZoomOut className="tc-video-compare-timeline__action-icon" size={15} />
            </ActionIcon>
          </Tooltip>
          <Slider
            className="tc-video-compare-timeline__zoom-slider"
            aria-label="时间轴缩放"
            value={zoom}
            min={0.5}
            max={4}
            step={0.5}
            onChange={setZoom}
            size="xs"
          />
          <Tooltip className="tc-video-compare-timeline__tooltip" label="放大时间轴">
            <ActionIcon
              className="tc-video-compare-timeline__action"
              aria-label="放大时间轴"
              variant="subtle"
              size={28}
              onClick={() => setZoom((current) => Math.min(4, current + 0.5))}
            >
              <IconZoomIn className="tc-video-compare-timeline__action-icon" size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip className="tc-video-compare-timeline__tooltip" label="适配时间轴">
            <ActionIcon
              className="tc-video-compare-timeline__action"
              aria-label="适配时间轴"
              variant="subtle"
              size={28}
              onClick={() => setZoom(1)}
            >
              <IconArrowsMaximize className="tc-video-compare-timeline__action-icon" size={15} />
            </ActionIcon>
          </Tooltip>
        </div>
      </div>

      <div className="tc-video-compare-timeline__scroll">
        <div
          ref={contentRef}
          className="tc-video-compare-timeline__content"
          style={{ width: `${contentWidth}px` }}
          role="slider"
          aria-label="同步播放进度"
          aria-valuemin={0}
          aria-valuemax={totalDuration}
          aria-valuenow={currentTime}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <div className="tc-video-compare-timeline__ruler">
            {ticks.map((tick) => (
              <div
                className="tc-video-compare-timeline__tick"
                key={tick}
                style={{ left: `${tick * renderedPxPerSecond}px` }}
              >
                <span className="tc-video-compare-timeline__tick-line" />
                <span className="tc-video-compare-timeline__tick-label">{formatVideoCompareTime(tick)}</span>
              </div>
            ))}
          </div>
          <div className="tc-video-compare-timeline__lanes">
            {lane('A', source, sourceDuration)}
            {lane('B', target, targetDuration)}
          </div>
          <div
            className="tc-video-compare-timeline__playhead"
            style={{ left: `${playheadLeft}px` }}
            aria-hidden="true"
          >
            <span className="tc-video-compare-timeline__playhead-handle" />
          </div>
        </div>
      </div>
    </section>
  )
}
