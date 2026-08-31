import React from 'react'
import { Text } from '@mantine/core'
import { resolveVideoPosterUrl } from '../videoPosterUrl'
import { SkeletonVideoFrame } from './SkeletonVideoFrame'
import { MediaEmptyState, type MediaEmptyAction } from './MediaEmptyState'

type VideoResult = {
  url: string
  thumbnailUrl?: string | null
  title?: string | null
  duration?: number
}

type VideoContentProps = {
  nodeId: string
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
  onOpenVideoModal: () => void
  onMediaNaturalSize?: (size: { width: number; height: number; url: string }) => void
  onUpload?: (files: File[]) => void
  uploading?: boolean
  onEmptyAction?: (action: MediaEmptyAction) => void
  /**
   * 节点是否处于聚焦（单选）态。未聚焦时整块内容 pointer-events: none，
   * 让事件穿透到外层节点容器以保证拖动优先；聚焦后才允许操作视频内容。
   */
  interactive?: boolean
}

function VideoContent({
  nodeId,
  videoResults,
  videoPrimaryIndex,
  videoUrl,
  videoThumbnailUrl,
  videoTitle,
  videoSurface,
  mediaOverlayBackground,
  mediaOverlayText,
  accentPrimary,
  onMediaNaturalSize,
  onUpload,
  uploading = false,
  onEmptyAction,
  interactive = true,
}: VideoContentProps) {
  const uploadInputRef = React.useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = React.useState(false)
  const activeVideoUrl = videoResults[videoPrimaryIndex]?.url || videoUrl || ''

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    if (!onUpload) return
    const items = Array.from(e.dataTransfer.items || [])
    if (items.some((item) => item.kind === 'file' && item.type.startsWith('video/'))) {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(true)
    }
  }, [onUpload])

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = React.useCallback((e: React.DragEvent) => {
    setIsDragOver(false)
    if (!onUpload) return
    const videos = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('video/'))
    if (!videos.length) return
    e.preventDefault()
    e.stopPropagation()
    onUpload(videos)
  }, [onUpload])

  return (
    <div
      className="video-content"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        borderRadius: 10,
        background: mediaOverlayBackground,
        // 媒体贴边（对齐 Neowow，2026-07-14）：零内边距、header 改为顶部悬浮层，
        // 视频撑满整卡——与未聚焦壳（TaskNodeCard video 分支）同布局，聚焦不跳帧。
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        overflow: 'hidden',
        color: mediaOverlayText,
        position: 'relative',
        outline: isDragOver ? `2px dashed ${accentPrimary}` : undefined,
        outlineOffset: isDragOver ? -2 : undefined,
        // 未聚焦：穿透事件给外层节点容器，保证拖动优先；聚焦后才可操作内容
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    >
      {/* 顶部信息区已移除（2026-07-14 用户拍板）：下载在节点顶部工具条；单节点单视频
          无需"选择主视频"；上传保留拖放路径（handleDrop）。聚焦媒体区与壳完全一致。 */}
      {videoUrl ? (
        // 聚焦媒体区与壳共用 retained playback：自绘迷你控件条/hover 播放；焦点树切换时
        // 移交 currentTime 与播放状态，同时重建原生画面层，避免浏览器迁移 DOM 后只剩音频。
        <div
          className="video-content-player"
          style={{ position: 'relative', width: '100%', flex: 1, minHeight: 120, backgroundColor: videoSurface }}
        >
          <SkeletonVideoFrame
            key={activeVideoUrl}
            src={activeVideoUrl}
            poster={resolveVideoPosterUrl(videoResults[videoPrimaryIndex], videoThumbnailUrl)}
            nodeId={nodeId}
            focused
            onNaturalSize={(w, h) => onMediaNaturalSize?.({ width: w, height: h, url: activeVideoUrl })}
          />
        </div>
      ) : (
        <div
          className="video-content-placeholder"
          style={{
            flex: 1,
            minHeight: 120,
            position: 'relative',
            borderRadius: 10,
          }}
        >
          <MediaEmptyState
            kind="video"
            disabled={uploading}
            onAction={onEmptyAction}
          />
        </div>
      )}

      {videoTitle && (
        <Text className="video-content-title" size="xs" lineClamp={1} c="dimmed">
          {videoTitle}
        </Text>
      )}

      {isDragOver && (
        <div
          className="video-content-drop-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            fontSize: 12,
            color: accentPrimary,
            fontWeight: 500,
          }}
        >
          松开以上传视频
        </div>
      )}

      <input
        ref={uploadInputRef}
        type="file"
        accept="video/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          if (files.length && onUpload) onUpload(files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

const _VideoContent = React.memo(VideoContent)
export { _VideoContent as VideoContent }
