import React from 'react'
import { Button, Group, Text } from '@mantine/core'
import { IconClock, IconPhotoSearch, IconScissors } from '@tabler/icons-react'
import { setTapImageDragData } from '../../../dnd/setTapImageDragData'

type FrameSample = {
  url: string
  time: number
}

type VideoResult = {
  url: string
  thumbnailUrl?: string
  title?: string
  duration?: number
}

type VideoContentProps = {
  videoResults: VideoResult[]
  videoPrimaryIndex: number
  videoUrl: string | null
  videoThumbnailUrl?: string | null
  videoTitle?: string | null
  videoSurface: string
  mediaOverlayBackground: string
  mediaOverlayText: string
  mediaFallbackText: string
  mediaFallbackSurface: string
  inlineDividerColor: string
  accentPrimary: string
  rgba: (color: string, alpha: number) => string
  frameSamples: FrameSample[]
  frameCaptureLoading: boolean
  handleCaptureVideoFrames: () => void
  cleanupFrameSamples: () => void
  onOpenVideoModal: () => void
  onOpenWebCut?: () => void
}

export function VideoContent({
  videoResults,
  videoPrimaryIndex,
  videoUrl,
  videoThumbnailUrl,
  videoTitle,
  videoSurface,
  mediaOverlayBackground,
  mediaOverlayText,
  mediaFallbackText,
  mediaFallbackSurface,
  inlineDividerColor,
  accentPrimary,
  rgba,
  frameSamples,
  frameCaptureLoading,
  handleCaptureVideoFrames,
  cleanupFrameSamples,
  onOpenVideoModal,
  onOpenWebCut,
}: VideoContentProps) {
  const didDragFrameRef = React.useRef(false)
  const canClip = Boolean(videoResults[videoPrimaryIndex]?.url || videoUrl)
  return (
    <div
      className="video-content"
      style={{
        marginTop: 6,
        width: '100%',
        minHeight: 160,
        borderRadius: 10,
        background: mediaOverlayBackground,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        color: mediaOverlayText,
      }}
    >
      <Group className="video-content-header" justify="space-between" gap={4}>
        <Text className="video-content-header-text" size="xs" c="dimmed">
          {videoResults.length > 0
            ? `共 ${videoResults.length} 个视频${videoPrimaryIndex >= 0 ? ` (主视频: 第 ${videoPrimaryIndex + 1} 个)` : ''}`
            : '视频生成中...'}
        </Text>
        <Group className="video-content-header-actions" gap={2}>
          <Button
            className="video-content-clip-button"
            size="compact-xs"
            variant="subtle"
            disabled={!canClip || !onOpenWebCut}
            onClick={onOpenWebCut}
            leftSection={<IconScissors className="video-content-clip-icon" size={12} />}
          >
            剪辑
          </Button>
          <Button
            className="video-content-history-button"
            size="compact-xs"
            variant="subtle"
            onClick={onOpenVideoModal}
            leftSection={<IconClock className="video-content-history-icon" size={12} />}
          >
            {videoResults.length > 0 ? '选择主视频' : '查看历史'}
          </Button>
        </Group>
      </Group>

      <Group className="video-content-actions-row" gap={6} justify="space-between">
        <Group className="video-content-actions-left" gap={6}>
          <Button
            className="video-content-capture-button"
            size="compact-xs"
            variant="light"
            leftSection={<IconPhotoSearch className="video-content-capture-icon" size={12} />}
            loading={frameCaptureLoading}
            onClick={handleCaptureVideoFrames}
          >
            抽帧预览
          </Button>
        </Group>
        {frameSamples.length > 0 && (
          <Button className="video-content-clear-frames" size="compact-xs" variant="subtle" onClick={cleanupFrameSamples}>
            清空帧
          </Button>
        )}
      </Group>

      {videoUrl ? (
        <video
          className="video-content-player"
          src={videoResults[videoPrimaryIndex]?.url || videoUrl}
          poster={videoResults[videoPrimaryIndex]?.thumbnailUrl || videoThumbnailUrl || undefined}
          controls
          loop
          muted
          playsInline
          style={{
            borderRadius: 8,
            width: '100%',
            height: 160,
            objectFit: 'cover',
            backgroundColor: videoSurface,
          }}
        />
      ) : (
        <div
          className="video-content-placeholder"
          style={{
            height: 160,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: mediaFallbackText,
            fontSize: 12,
          }}
        >
          等待 Sora 视频生成完成…
        </div>
      )}

      {videoTitle && (
        <Text className="video-content-title" size="xs" lineClamp={1} c="dimmed">
          {videoTitle}
        </Text>
      )}

      {frameSamples.length > 0 && (
        <div className="video-content-frames" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 6 }}>
          {frameSamples.map((frame) => (
            <div
              className="video-content-frame-card nodrag nopan"
              key={`${frame.url}-${frame.time}`}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, cursor: 'grab' }}
              title="拖拽到画布生成图片节点"
              draggable
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onDragStart={(evt) => {
                didDragFrameRef.current = true
                evt.dataTransfer.effectAllowed = 'copy'
                evt.dataTransfer.setData(
                  'application/tap-frame-sample',
                  JSON.stringify({ url: frame.url, remoteUrl: null, time: frame.time }),
                )
                setTapImageDragData(evt, frame.url)
              }}
              onDragEnd={() => {
                didDragFrameRef.current = false
              }}
            >
              <div
                className="video-content-frame-thumb nodrag nopan"
                style={{
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: mediaFallbackSurface,
                  border: `1px solid ${inlineDividerColor}`,
                  width: '100%',
                  aspectRatio: '4 / 3',
                  boxShadow: `0 0 0 2px ${rgba(accentPrimary, 0.0)}`,
                }}
              >
                <img
                  className="video-content-frame-img nodrag nopan"
                  src={frame.url}
                  alt={`frame-${frame.time.toFixed(2)}s`}
                  draggable
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDragStart={(evt) => {
                    didDragFrameRef.current = true
                    evt.dataTransfer.effectAllowed = 'copy'
                    evt.dataTransfer.setData(
                      'application/tap-frame-sample',
                      JSON.stringify({ url: frame.url, remoteUrl: null, time: frame.time }),
                    )
                    setTapImageDragData(evt, frame.url)
                  }}
                  onDragEnd={() => {
                    didDragFrameRef.current = false
                  }}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </div>
              <Text className="video-content-frame-time" size="xs" c="dimmed">
                {frame.time.toFixed(2)}s
              </Text>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
