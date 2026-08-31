import React from 'react'
import { ActionIcon, Modal, SegmentedControl, Tooltip } from '@mantine/core'
import {
  IconArrowsDiff,
  IconLayoutColumns,
  IconLayoutRows,
  IconX,
} from '@tabler/icons-react'
import { VideoCompareTimeline } from './VideoCompareTimeline'
import { useVideoComparePlayback, type VideoCompareSlot } from './useVideoComparePlayback'
import { useVideoCompareStore } from './videoCompareStore'
import type { VideoCompareSource } from './videoCompareSource'
import './videoCompare.css'

type VideoCompareLayout = 'side-by-side' | 'stacked'
const VIDEO_COMPARE_MODAL_TITLE = '视频还原度对比'

type VideoPanelProps = {
  className?: string
  marker: 'A' | 'B'
  slot: VideoCompareSlot
  source: VideoCompareSource
  videoRef: React.RefObject<HTMLVideoElement>
  muted: boolean
  loadError?: string
  onLoadedMetadata: (slot: VideoCompareSlot, element: HTMLVideoElement) => void
  onMediaError: (slot: VideoCompareSlot, element: HTMLVideoElement) => void
  onTogglePlayback: () => void
}

function VideoPanel({
  className,
  marker,
  slot,
  source,
  videoRef,
  muted,
  loadError,
  onLoadedMetadata,
  onMediaError,
  onTogglePlayback,
}: VideoPanelProps): JSX.Element {
  return (
    <section className={`tc-video-compare__panel tc-video-compare__panel--${marker.toLowerCase()}${className ? ` ${className}` : ''}`} aria-label={`视频 ${marker}：${source.label}`}>
      <header className="tc-video-compare__panel-header">
        <span className="tc-video-compare__panel-marker">{marker}</span>
        <span className="tc-video-compare__panel-title" title={source.label}>{source.label}</span>
      </header>
      <div className="tc-video-compare__media-frame">
        <video
          ref={videoRef}
          className="tc-video-compare__video"
          src={source.url}
          preload="metadata"
          playsInline
          muted={muted}
          controls={false}
          aria-label={`视频 ${marker} 播放画面`}
          data-video-node-id={source.nodeId}
          onLoadedMetadata={(event) => onLoadedMetadata(slot, event.currentTarget)}
          onError={(event) => onMediaError(slot, event.currentTarget)}
          onClick={onTogglePlayback}
        />
        {loadError ? (
          <div className="tc-video-compare__media-error" role="alert">
            <span className="tc-video-compare__media-error-title">{marker} 加载失败</span>
            <span className="tc-video-compare__media-error-message">{loadError}</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function OpenVideoCompareModal({
  className,
  source,
  target,
}: {
  className?: string
  source: VideoCompareSource
  target: VideoCompareSource
}): JSX.Element {
  const [layout, setLayout] = React.useState<VideoCompareLayout>('side-by-side')
  const playback = useVideoComparePlayback({ source, target })
  const close = useVideoCompareStore((state) => state.close)

  return (
    <Modal
      className={`tc-video-compare-modal${className ? ` ${className}` : ''}`}
      opened
      onClose={close}
      centered
      size="calc(100vw - 64px)"
      padding={0}
      withCloseButton={false}
      closeOnClickOutside={false}
      zIndex={8400}
      transitionProps={{ duration: 120 }}
    >
      <div className="tc-video-compare">
        <header className="tc-video-compare__header">
          <div className="tc-video-compare__heading">
            <IconArrowsDiff className="tc-video-compare__heading-icon" size={18} aria-hidden="true" />
            <div className="tc-video-compare__heading-copy">
              <h2 className="tc-video-compare__title">{VIDEO_COMPARE_MODAL_TITLE}</h2>
              <p className="tc-video-compare__subtitle">共享时间码 · 同步播放 · 不修改原视频</p>
            </div>
          </div>
          <div className="tc-video-compare__header-actions">
            <SegmentedControl
              className="tc-video-compare__layout-switch"
              aria-label="视频对比布局"
              value={layout}
              onChange={(value) => {
                if (value === 'side-by-side' || value === 'stacked') setLayout(value)
              }}
              data={[
                {
                  value: 'side-by-side',
                  label: (
                    <span className="tc-video-compare__layout-option">
                      <IconLayoutColumns className="tc-video-compare__layout-option-icon" size={14} aria-hidden="true" />
                      <span className="tc-video-compare__layout-option-label">左右</span>
                    </span>
                  ),
                },
                {
                  value: 'stacked',
                  label: (
                    <span className="tc-video-compare__layout-option">
                      <IconLayoutRows className="tc-video-compare__layout-option-icon" size={14} aria-hidden="true" />
                      <span className="tc-video-compare__layout-option-label">上下</span>
                    </span>
                  ),
                },
              ]}
            />
            <Tooltip className="tc-video-compare__close-tooltip" label="关闭对比">
              <ActionIcon
                className="tc-video-compare__close"
                aria-label="关闭视频对比"
                variant="subtle"
                size={32}
                onClick={close}
              >
                <IconX className="tc-video-compare__close-icon" size={17} />
              </ActionIcon>
            </Tooltip>
          </div>
        </header>

        <main className={`tc-video-compare__stage tc-video-compare__stage--${layout}`} data-layout={layout}>
          <VideoPanel
            className="tc-video-compare__panel-component"
            marker="A"
            slot="source"
            source={source}
            videoRef={playback.sourceVideoRef}
            muted={playback.muted}
            loadError={playback.loadErrors.source}
            onLoadedMetadata={playback.handleLoadedMetadata}
            onMediaError={playback.handleMediaError}
            onTogglePlayback={playback.togglePlayback}
          />
          <VideoPanel
            className="tc-video-compare__panel-component"
            marker="B"
            slot="target"
            source={target}
            videoRef={playback.targetVideoRef}
            muted={playback.muted}
            loadError={playback.loadErrors.target}
            onLoadedMetadata={playback.handleLoadedMetadata}
            onMediaError={playback.handleMediaError}
            onTogglePlayback={playback.togglePlayback}
          />
        </main>

        {playback.playbackError ? (
          <div className="tc-video-compare__playback-error" role="alert">
            {playback.playbackError}
          </div>
        ) : null}

        <VideoCompareTimeline
          className="tc-video-compare__timeline-component"
          source={source}
          target={target}
          sourceDuration={playback.durations.source}
          targetDuration={playback.durations.target}
          totalDuration={playback.totalDuration}
          currentTime={playback.currentTime}
          playing={playback.playing}
          muted={playback.muted}
          disabled={playback.durations.source <= 0 || playback.durations.target <= 0}
          onTogglePlayback={playback.togglePlayback}
          onMutedChange={playback.setMuted}
          onSeek={playback.seek}
          onScrubStart={playback.beginScrub}
          onScrubEnd={playback.endScrub}
        />
      </div>
    </Modal>
  )
}

type VideoCompareModalProps = {
  className?: string
}

export function VideoCompareModal({ className }: VideoCompareModalProps): JSX.Element | null {
  const session = useVideoCompareStore((state) => state.session)
  if (session.phase !== 'open') return null
  return (
    <OpenVideoCompareModal
      className={className}
      source={session.source}
      target={session.target}
    />
  )
}
