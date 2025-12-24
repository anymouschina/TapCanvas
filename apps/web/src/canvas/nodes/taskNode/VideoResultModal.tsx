import React from 'react'
import { Button, Group, Modal, Paper, Stack, Text } from '@mantine/core'
import { IconMovie, IconVideo } from '@tabler/icons-react'

type VideoResult = {
  url: string
  thumbnailUrl?: string
  title?: string
  duration?: number
}

type VideoResultModalProps = {
  opened: boolean
  onClose: () => void
  videos: VideoResult[]
  primaryIndex: number
  onSelectPrimary: (index: number, url: string) => void
  onPreview: (video: VideoResult) => void
  galleryCardBackground: string
  mediaFallbackSurface: string
  mediaFallbackText: string
  isStoryboardNode?: boolean
  title?: string
}

export function VideoResultModal({
  opened,
  onClose,
  videos,
  primaryIndex,
  onSelectPrimary,
  onPreview,
  galleryCardBackground,
  mediaFallbackSurface,
  mediaFallbackText,
  isStoryboardNode = false,
  title = '选择主视频',
}: VideoResultModalProps) {
  return (
    <Modal
      className="video-result-modal"
      opened={opened}
      onClose={onClose}
      title={videos.length > 0 ? title : '视频历史记录'}
      centered
      size="xl"
      withinPortal
      zIndex={300}
    >
      <Stack className="video-result-modal-body" gap="sm">
        {videos.length === 0 ? (
          (() => {
            const VideoHistoryIcon = isStoryboardNode ? IconMovie : IconVideo
            return (
              <div
                className="video-result-modal-empty"
                style={{
                  padding: '40px 20px',
                  textAlign: 'center',
                  color: mediaFallbackText,
                }}
              >
                <VideoHistoryIcon className="video-result-modal-empty-icon" size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
                <Text className="video-result-modal-empty-title" size="sm" c="dimmed">
                  暂无视频生成历史
                </Text>
                <Text className="video-result-modal-empty-desc" size="xs" c="dimmed" mt={4}>
                  生成视频后，这里将显示所有历史记录，你可以选择效果最好的作为主视频
                </Text>
              </div>
            )
          })()
        ) : (
          <>
            <Text className="video-result-modal-hint" size="xs" c="dimmed">
              当前共有 {videos.length} 个视频。点击「设为主视频」可更新本节点主视频，点击「全屏预览」可放大查看。
            </Text>
            <div
              className="video-result-modal-scroll"
              style={{
                maxHeight: '60vh',
                overflowY: 'auto',
              }}
            >
              <div
                className="video-result-modal-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 12,
                }}
              >
                {videos.map((video, idx) => {
                  const isPrimary = idx === primaryIndex
                  return (
                    <Paper
                      className="video-result-modal-card"
                      key={`${idx}-${video.url}`}
                      radius="md"
                      p="xs"
                      style={{
                        background: galleryCardBackground,
                      }}
                    >
                      <div
                        className="video-result-modal-thumb"
                        style={{
                          borderRadius: 8,
                          overflow: 'hidden',
                          border: 'none',
                          marginBottom: 6,
                          background: mediaFallbackSurface,
                          position: 'relative',
                        }}
                      >
                        <video
                          className="video-result-modal-video"
                          src={video.url}
                          poster={video.thumbnailUrl || undefined}
                          muted
                          loop
                          playsInline
                          style={{
                            width: '100%',
                            height: 180,
                            objectFit: 'cover',
                            display: 'block',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.play().catch(() => {})
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.pause()
                            e.currentTarget.currentTime = 0
                          }}
                        />
                        {video.duration && (
                          <div
                            className="video-result-modal-duration"
                            style={{
                              position: 'absolute',
                              bottom: 4,
                              right: 4,
                              background: 'rgba(0,0,0,0.7)',
                              color: 'white',
                              fontSize: '10px',
                              padding: '2px 6px',
                              borderRadius: 4,
                            }}
                          >
                            {Math.round(video.duration)}s
                          </div>
                        )}
                      </div>
                      <Group className="video-result-modal-actions" justify="space-between">
                        <Text className="video-result-modal-label" size="xs" c="dimmed">
                          {isPrimary ? `主视频 · 第 ${idx + 1} 个` : `第 ${idx + 1} 个`}
                        </Text>
                        <Group className="video-result-modal-buttons" gap={4}>
                          <Button
                            className="video-result-modal-preview"
                            size="xs"
                            variant="subtle"
                            onClick={() => onPreview(video)}
                          >
                            全屏预览
                          </Button>
                          {!isPrimary && (
                            <Button
                              className="video-result-modal-set-primary"
                              size="xs"
                              variant="subtle"
                              onClick={() => {
                                onSelectPrimary(idx, video.url)
                                onClose()
                              }}
                            >
                              设为主视频
                            </Button>
                          )}
                        </Group>
                      </Group>
                    </Paper>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </Stack>
    </Modal>
  )
}
