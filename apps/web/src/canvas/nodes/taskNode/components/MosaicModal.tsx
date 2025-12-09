import React from 'react'
import { ActionIcon, Badge, Button, Group, Loader, Modal, Paper, ScrollArea, Select, Stack, Text } from '@mantine/core'
import { IconArrowDown, IconArrowUp, IconTrash } from '@tabler/icons-react'

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
    <Modal opened={opened} onClose={onClose} title="拼图配置" size="lg" centered>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text size="sm" fw={600}>选择拼图图片</Text>
          <Select
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
        <Group justify="space-between">
          <Text size="xs" c="dimmed">最多 {mosaicLimit} 张，按顺序填充从左到右、从上到下。</Text>
          <Badge size="xs" variant="light" color="blue">
            已选 {mosaicSelected.length}/{mosaicLimit}
          </Badge>
        </Group>
        <Stack gap={6}>
          <Group justify="space-between" align="center">
            <Text size="xs" c="dimmed">预览 & 调整顺序</Text>
            {mosaicSelected.length > 0 && (
              <Text size="xs" c="dimmed">点击下方缩略图可调整顺序或移除</Text>
            )}
          </Group>
          <Paper withBorder p={8} radius="sm" style={{ minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', position: 'relative' }}>
            {mosaicPreviewLoading && <Loader size="sm" />}
            {!mosaicPreviewLoading && mosaicPreviewUrl && (
              <img src={mosaicPreviewUrl} alt="mosaic preview" style={{ width: '100%', display: 'block', borderRadius: 6, boxShadow: darkCardShadow }} />
            )}
            {!mosaicPreviewLoading && !mosaicPreviewUrl && (
              <Text size="xs" c="dimmed">
                {mosaicPreviewError || '选择图片后将显示拼图预览'}
              </Text>
            )}
          </Paper>
          {mosaicSelected.length > 0 && (
            <ScrollArea h={140} type="auto" offsetScrollbars>
              <Group gap={10} wrap="wrap">
                {mosaicSelected.map((url, idx) => (
                  <Paper
                    key={`order-${url}`}
                    withBorder
                    radius="md"
                    p={6}
                    style={{ width: 120, position: 'relative', background: mediaFallbackSurface }}
                  >
                    <Badge size="xs" variant="filled" style={{ position: 'absolute', top: 6, left: 6, zIndex: 2 }}>
                      {idx + 1}
                    </Badge>
                    <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', border: `1px solid ${inlineDividerColor}` }}>
                      <img src={url} alt={`order-${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </div>
                    <Group gap={4} mt={6} justify="space-between">
                      <ActionIcon variant="subtle" size="xs" onClick={() => onMoveItem(url, -1)} disabled={idx === 0}>
                        <IconArrowUp size={12} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" size="xs" onClick={() => onToggleImage(url, false)}>
                        <IconTrash size={12} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" size="xs" onClick={() => onMoveItem(url, 1)} disabled={idx === mosaicSelected.length - 1}>
                        <IconArrowDown size={12} />
                      </ActionIcon>
                    </Group>
                  </Paper>
                ))}
              </Group>
            </ScrollArea>
          )}
        </Stack>
        <Text size="xs" fw={600}>从图库选择</Text>
        <ScrollArea h={260} type="auto" offsetScrollbars>
          <div
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
                      size="xs"
                      variant="filled"
                      color="blue"
                      style={{ position: 'absolute', top: 6, left: 6, zIndex: 2 }}
                    >
                      已选
                    </Badge>
                  )}
                  <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', border: `1px solid ${inlineDividerColor}` }}>
                    <img src={url} alt="候选图片" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                </Paper>
              )
            })}
          </div>
          {availableImages.length === 0 && <Text size="xs" c="dimmed" mt="xs">暂无可用图片，请先上传或生成。</Text>}
        </ScrollArea>
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>取消</Button>
          <Button onClick={onSave}>保存并生成</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
