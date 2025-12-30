import React from 'react'
import { ActionIcon, Badge, Button, Group, Loader, Modal, Paper, ScrollArea, Select, Stack, Text } from '@mantine/core'
import { IconArrowDown, IconArrowUp, IconTrash } from '@tabler/icons-react'
import { setTapImageDragData } from '../../../dnd/setTapImageDragData'

const MOSAIC_GRID_OPTIONS = [
  { value: '1', label: '1x1' },
  { value: '2', label: '2x2' },
  { value: '3', label: '3x3' },
]

type MosaicModalProps = {
  opened: boolean
  mosaicGrid: number
  mosaicLimit: number
  mosaicSelected: string[]
  mosaicPreviewLoading: boolean
  mosaicPreviewUrl: string | null
  mosaicPreviewError: string | null
  availableImages: string[]
  darkCardShadow: string
  mediaFallbackSurface: string
  inlineDividerColor: string
  accentPrimary: string
  rgba: (color: string, alpha: number) => string
  onClose: () => void
  onGridChange: (grid: number) => void
  onMoveItem: (url: string, delta: number) => void
  onToggleImage: (url: string, next?: boolean) => void
  onSave: () => void
}

export function MosaicModal({
  opened,
  mosaicGrid,
  mosaicLimit,
  mosaicSelected,
  mosaicPreviewLoading,
  mosaicPreviewUrl,
  mosaicPreviewError,
  availableImages,
  darkCardShadow,
  mediaFallbackSurface,
  inlineDividerColor,
  accentPrimary,
  rgba,
  onClose,
  onGridChange,
  onMoveItem,
  onToggleImage,
  onSave,
}: MosaicModalProps) {
  return (
    <Modal className="mosaic-modal" opened={opened} onClose={onClose} title="拼图配置" size="lg" centered>
      <Stack className="mosaic-modal-body" gap="sm">
        <Group className="mosaic-modal-header" justify="space-between">
          <Text className="mosaic-modal-title" size="sm" fw={600}>选择拼图图片</Text>
          <Select
            className="mosaic-modal-grid-select"
            label="网格"
            data={MOSAIC_GRID_OPTIONS}
            value={String(mosaicGrid)}
            onChange={(v) => {
              const n = Number(v || 2)
              onGridChange(Math.max(1, Math.min(3, Number.isFinite(n) ? n : 2)))
            }}
            withinPortal
            w={140}
          />
        </Group>
        <Group className="mosaic-modal-meta" justify="space-between">
          <Text className="mosaic-modal-meta-text" size="xs" c="dimmed">最多 {mosaicLimit} 张，按顺序填充从左到右、从上到下。</Text>
          <Badge className="mosaic-modal-count-badge" size="xs" variant="light" color="blue">
            已选 {mosaicSelected.length}/{mosaicLimit}
          </Badge>
        </Group>
        <Stack className="mosaic-modal-preview" gap={6}>
          <Group className="mosaic-modal-preview-header" justify="space-between" align="center">
            <Text className="mosaic-modal-preview-title" size="xs" c="dimmed">预览 & 调整顺序</Text>
            {mosaicSelected.length > 0 && (
              <Text className="mosaic-modal-preview-hint" size="xs" c="dimmed">点击下方缩略图可调整顺序或移除</Text>
            )}
          </Group>
          <Paper className="mosaic-modal-preview-frame" withBorder p={8} radius="sm" style={{ minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', position: 'relative' }}>
            {mosaicPreviewLoading && <Loader className="mosaic-modal-preview-loader" size="sm" />}
            {!mosaicPreviewLoading && mosaicPreviewUrl && (
              <img className="mosaic-modal-preview-image" src={mosaicPreviewUrl} alt="mosaic preview" style={{ width: '100%', display: 'block', borderRadius: 6, boxShadow: darkCardShadow }} />
            )}
            {!mosaicPreviewLoading && !mosaicPreviewUrl && (
              <Text className="mosaic-modal-preview-empty" size="xs" c="dimmed">
                {mosaicPreviewError || '选择图片后将显示拼图预览'}
              </Text>
            )}
          </Paper>
          {mosaicSelected.length > 0 && (
            <ScrollArea className="mosaic-modal-order-scroll" h={140} type="auto" offsetScrollbars>
              <Group className="mosaic-modal-order-grid" gap={10} wrap="wrap">
                {mosaicSelected.map((url, idx) => (
                  <Paper
                    className="mosaic-modal-order-card"
                    key={`order-${url}`}
                    withBorder
                    radius="md"
                    p={6}
                    style={{ width: 120, position: 'relative', background: mediaFallbackSurface }}
                  >
                    <Badge className="mosaic-modal-order-index" size="xs" variant="filled" style={{ position: 'absolute', top: 6, left: 6, zIndex: 2 }}>
                      {idx + 1}
                    </Badge>
                    <div className="mosaic-modal-order-thumb" style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', border: `1px solid ${inlineDividerColor}` }}>
                      <img
                        className="mosaic-modal-order-thumb-img"
                        src={url}
                        alt={`order-${idx + 1}`}
                        draggable
                        onDragStart={(evt) => setTapImageDragData(evt, url)}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    </div>
                    <Group className="mosaic-modal-order-actions" gap={4} mt={6} justify="space-between">
                      <ActionIcon className="mosaic-modal-order-move-up" variant="subtle" size="xs" onClick={() => onMoveItem(url, -1)} disabled={idx === 0}>
                        <IconArrowUp className="mosaic-modal-order-move-up-icon" size={12} />
                      </ActionIcon>
                      <ActionIcon className="mosaic-modal-order-remove" variant="subtle" size="xs" onClick={() => onToggleImage(url, false)}>
                        <IconTrash className="mosaic-modal-order-remove-icon" size={12} />
                      </ActionIcon>
                      <ActionIcon className="mosaic-modal-order-move-down" variant="subtle" size="xs" onClick={() => onMoveItem(url, 1)} disabled={idx === mosaicSelected.length - 1}>
                        <IconArrowDown className="mosaic-modal-order-move-down-icon" size={12} />
                      </ActionIcon>
                    </Group>
                  </Paper>
                ))}
              </Group>
            </ScrollArea>
          )}
        </Stack>
        <Text className="mosaic-modal-library-title" size="xs" fw={600}>从图库选择</Text>
        <ScrollArea className="mosaic-modal-library-scroll" h={260} type="auto" offsetScrollbars>
          <div
            className="mosaic-modal-library-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 10,
            }}
          >
            {availableImages.map((url) => {
              const checked = mosaicSelected.includes(url)
              const disabled = !checked && mosaicSelected.length >= mosaicLimit
              return (
                <Paper
                  className="mosaic-modal-library-card"
                  key={`avail-${url}`}
                  withBorder
                  radius="md"
                  p={6}
                  style={{
                    position: 'relative',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.5 : 1,
                    background: mediaFallbackSurface,
                    borderColor: checked ? accentPrimary : undefined,
                    boxShadow: checked ? `0 0 0 2px ${rgba(accentPrimary, 0.18)}` : undefined,
                  }}
                  onClick={() => onToggleImage(url, !checked)}
                >
                  {checked && (
                    <Badge
                      className="mosaic-modal-library-selected"
                      size="xs"
                      variant="filled"
                      color="blue"
                      style={{ position: 'absolute', top: 6, left: 6, zIndex: 2 }}
                    >
                      已选
                    </Badge>
                  )}
                  <div className="mosaic-modal-library-thumb" style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', border: `1px solid ${inlineDividerColor}` }}>
                    <img
                      className="mosaic-modal-library-thumb-img"
                      src={url}
                      alt="候选图片"
                      draggable
                      onDragStart={(evt) => setTapImageDragData(evt, url)}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </div>
                </Paper>
              )
            })}
          </div>
          {availableImages.length === 0 && <Text className="mosaic-modal-library-empty" size="xs" c="dimmed" mt="xs">暂无可用图片，请先上传或生成。</Text>}
        </ScrollArea>
        <Group className="mosaic-modal-actions" justify="flex-end">
          <Button className="mosaic-modal-cancel" variant="subtle" onClick={onClose}>取消</Button>
          <Button className="mosaic-modal-save" onClick={onSave}>保存并生成</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
