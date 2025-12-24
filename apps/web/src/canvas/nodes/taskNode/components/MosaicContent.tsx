import React from 'react'
import { Button, Group, Paper, Text } from '@mantine/core'
import { IconLayoutGrid } from '@tabler/icons-react'

type MosaicContentProps = {
  imageResults: { url: string }[]
  imagePrimaryIndex: number
  placeholderColor: string
  mosaicGrid: number
  onOpenModal: () => void
  onSave: () => void
}

export function MosaicContent({
  imageResults,
  imagePrimaryIndex,
  placeholderColor,
  mosaicGrid,
  onOpenModal,
  onSave,
}: MosaicContentProps) {
  const mediaSize = 300
  return (
    <div className="mosaic-content" style={{ position: 'relative', marginTop: 6, padding: '0 6px' }}>
      {imageResults.length ? (
        <div className="mosaic-content-frame" style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
          <div className="mosaic-content-media" style={{ position: 'relative', width: mediaSize, height: mediaSize }}>
          <div
            className="mosaic-content-media-shell"
            style={{
              position: 'relative',
              borderRadius: 10,
              overflow: 'hidden',
              boxShadow: '0 18px 36px rgba(0, 0, 0, 0.35)',
              background: 'rgba(0,0,0,0.12)',
              width: '100%',
              height: '100%',
            }}
          >
            <img
              className="mosaic-content-image"
              src={imageResults[imagePrimaryIndex]?.url || imageResults[0]?.url || ''}
              alt="拼图结果"
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                objectFit: 'contain',
              }}
            />
          </div>
          <Group className="mosaic-content-actions" gap={6} mt={6} justify="flex-end" style={{ width: '100%' }}>
            <Button className="mosaic-content-action" size="xs" variant="light" onClick={onOpenModal}>
              重新拼图
            </Button>
            <Button className="mosaic-content-action" size="xs" variant="subtle" onClick={onSave}>
              保存当前选择
            </Button>
          </Group>
          </div>
        </div>
      ) : (
        <Paper
          className="mosaic-content-empty"
          radius="md"
          p="md"
          style={{
            width: '100%',
            minHeight: 140,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            textAlign: 'center',
          }}
        >
          <IconLayoutGrid className="mosaic-content-empty-icon" size={28} style={{ color: placeholderColor }} />
          <Text className="mosaic-content-empty-text" size="sm" c="dimmed">
            选择画布内的图片并拼成 {mosaicGrid}x{mosaicGrid} 网格。
          </Text>
          <Button className="mosaic-content-empty-action" size="xs" variant="light" onClick={onOpenModal}>
            打开拼图设置
          </Button>
        </Paper>
      )}
    </div>
  )
}
