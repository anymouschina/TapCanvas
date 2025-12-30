import React from 'react'
import { Button, Group, Modal, Paper, Stack, Text } from '@mantine/core'
import { setTapImageDragData } from '../../dnd/setTapImageDragData'

type ImageResult = { url: string }

type ImageResultModalProps = {
  opened: boolean
  onClose: () => void
  images: ImageResult[]
  primaryIndex: number
  onSelectPrimary: (index: number, url: string) => void
  onPreview: (url: string) => void
  galleryCardBackground: string
  mediaFallbackSurface: string
  title?: string
}

export function ImageResultModal({
  opened,
  onClose,
  images,
  primaryIndex,
  onSelectPrimary,
  onPreview,
  galleryCardBackground,
  mediaFallbackSurface,
  title = '选择主图',
}: ImageResultModalProps) {
  if (!images.length) return null

  return (
    <Modal
      className="image-result-modal"
      opened={opened}
      onClose={onClose}
      title={title}
      centered
      size="xl"
      withinPortal
      zIndex={300}
    >
      <Stack className="image-result-modal-body" gap="sm">
        <Text className="image-result-modal-hint" size="xs" c="dimmed">
          当前共有 {images.length} 张图片。点击「设为主图」可更新本节点主图，点击「全屏预览」可放大查看。
        </Text>
        <div
          className="image-result-modal-scroll"
          style={{
            maxHeight: '60vh',
            overflowY: 'auto',
          }}
        >
          <div
            className="image-result-modal-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 12,
            }}
          >
            {images.map((img, idx) => {
              const isPrimary = idx === primaryIndex
              return (
                <Paper
                  className="image-result-modal-card"
                  key={`${idx}-${img.url}`}
                  radius="md"
                  p="xs"
                  style={{
                    background: galleryCardBackground,
                  }}
                >
                  <div
                    className="image-result-modal-thumb"
                    style={{
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: 'none',
                      marginBottom: 6,
                      background: mediaFallbackSurface,
                    }}
                  >
                    <img
                      className="image-result-modal-img"
                      src={img.url}
                      alt={`结果 ${idx + 1}`}
                      draggable
                      onDragStart={(evt) => setTapImageDragData(evt, img.url)}
                      style={{
                        width: '100%',
                        height: 180,
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  </div>
                  <Group className="image-result-modal-actions" justify="space-between">
                    <Text className="image-result-modal-label" size="xs" c="dimmed">
                      {isPrimary ? `主图 · 第 ${idx + 1} 张` : `第 ${idx + 1} 张`}
                    </Text>
                    <Group className="image-result-modal-buttons" gap={4}>
                      <Button
                        className="image-result-modal-preview"
                        size="xs"
                        variant="subtle"
                        onClick={() => onPreview(img.url)}
                      >
                        预览
                      </Button>
                      {!isPrimary && (
                        <Button
                          className="image-result-modal-set-primary"
                          size="xs"
                          variant="subtle"
                          onClick={() => {
                            onSelectPrimary(idx, img.url)
                            onClose()
                          }}
                        >
                          设为主图
                        </Button>
                      )}
                    </Group>
                  </Group>
                </Paper>
              )
            })}
          </div>
        </div>
      </Stack>
    </Modal>
  )
}
