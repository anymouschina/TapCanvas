import React from 'react'
import { ActionIcon, Badge, Button, Group, Loader, Modal, NumberInput, ScrollArea, Select, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { IconArrowDown, IconArrowUp, IconTrash } from '@tabler/icons-react'
import { setTapImageDragData } from '../../../dnd/setTapImageDragData'
import { InlinePanel } from '../../../../ui/InlinePanel'

const MOSAIC_LAYOUT_OPTIONS = [
  { value: 'square', label: '方阵拼图' },
  { value: 'columns', label: '多列拼接' },
]

const MOSAIC_GRID_OPTIONS = [
  { value: '1', label: '1x1' },
  { value: '2', label: '2x2' },
  { value: '3', label: '3x3' },
]

type MosaicLayoutMode = 'square' | 'columns'

type MosaicModalProps = {
  opened: boolean
  mosaicLayoutMode: MosaicLayoutMode
  mosaicGrid: number
  mosaicColumns: number
  mosaicLimit: number
  mosaicSelected: string[]
  mosaicCellSize: number
  mosaicDividerWidth: number
  mosaicDividerColor: string
  mosaicBackgroundColor: string
  mosaicTitle: string
  mosaicSubtitle: string
  mosaicTitleColor: string
  mosaicSubtitleColor: string
  mosaicPreviewLoading: boolean
  mosaicPreviewUrl: string | null
  mosaicPreviewError: string | null
  availableImages: string[]
  darkCardShadow: string
  mediaFallbackSurface: string
  inlineDividerColor: string
  accentPrimary: string
  rgba: (color: string, alpha: number) => string
  title?: string
  libraryTitle?: string
  saveLabel?: string
  onClose: () => void
  onLayoutModeChange: (mode: MosaicLayoutMode) => void
  onGridChange: (grid: number) => void
  onColumnsChange: (columns: number) => void
  onMoveItem: (url: string, delta: number) => void
  onToggleImage: (url: string, next?: boolean) => void
  onCellSizeChange: (value: number) => void
  onDividerWidthChange: (value: number) => void
  onDividerColorChange: (value: string) => void
  onBackgroundColorChange: (value: string) => void
  onTitleChange: (value: string) => void
  onSubtitleChange: (value: string) => void
  onTitleColorChange: (value: string) => void
  onSubtitleColorChange: (value: string) => void
  onSave: () => void
}

export function MosaicModal({
  opened,
  mosaicLayoutMode,
  mosaicGrid,
  mosaicColumns,
  mosaicLimit,
  mosaicSelected,
  mosaicCellSize,
  mosaicDividerWidth,
  mosaicDividerColor,
  mosaicBackgroundColor,
  mosaicTitle,
  mosaicSubtitle,
  mosaicTitleColor,
  mosaicSubtitleColor,
  mosaicPreviewLoading,
  mosaicPreviewUrl,
  mosaicPreviewError,
  availableImages,
  darkCardShadow,
  mediaFallbackSurface,
  inlineDividerColor,
  accentPrimary,
  rgba,
  title,
  libraryTitle,
  saveLabel,
  onClose,
  onLayoutModeChange,
  onGridChange,
  onColumnsChange,
  onMoveItem,
  onToggleImage,
  onCellSizeChange,
  onDividerWidthChange,
  onDividerColorChange,
  onBackgroundColorChange,
  onTitleChange,
  onSubtitleChange,
  onTitleColorChange,
  onSubtitleColorChange,
  onSave,
}: MosaicModalProps) {
  return (
    <Modal className="mosaic-modal" opened={opened} onClose={onClose} title={title || '拼图配置'} size="xl" centered>
      <Stack className="mosaic-modal-body" gap="sm">
        <Group className="mosaic-modal-header" justify="space-between" align="flex-end">
          <Text className="mosaic-modal-title" size="sm" fw={600}>选择拼图图片</Text>
          <Group className="mosaic-modal-layout-controls" gap="sm" align="flex-end">
            <Select
              className="mosaic-modal-layout-select"
              label="布局"
              data={MOSAIC_LAYOUT_OPTIONS}
              value={mosaicLayoutMode}
              onChange={(value) => onLayoutModeChange((value as MosaicLayoutMode) || 'square')}
              withinPortal
              w={160}
              allowDeselect={false}
            />
            {mosaicLayoutMode === 'square' ? (
              <Select
                className="mosaic-modal-grid-select"
                label="网格"
                data={MOSAIC_GRID_OPTIONS}
                value={String(mosaicGrid)}
                onChange={(value) => {
                  const parsed = Number(value || 2)
                  onGridChange(Math.max(1, Math.min(3, Number.isFinite(parsed) ? parsed : 2)))
                }}
                withinPortal
                w={120}
                allowDeselect={false}
              />
            ) : (
              <NumberInput
                className="mosaic-modal-columns-input"
                label="列数"
                min={1}
                max={6}
                step={1}
                value={mosaicColumns}
                onChange={(value) => {
                  const parsed = Number(value || 3)
                  onColumnsChange(Math.max(1, Math.min(6, Number.isFinite(parsed) ? Math.trunc(parsed) : 3)))
                }}
                w={120}
              />
            )}
          </Group>
        </Group>
        <Group className="mosaic-modal-meta" justify="space-between">
          <Text className="mosaic-modal-meta-text" size="xs" c="dimmed">
            {mosaicLayoutMode === 'columns'
              ? `按 ${mosaicColumns} 列从左到右、从上到下自动排布，可附加标题与说明文案。`
              : `最多 ${mosaicLimit} 张，按顺序填充从左到右、从上到下。`}
          </Text>
          <Badge className="mosaic-modal-count-badge" size="xs" variant="light" color="blue">
            已选 {mosaicSelected.length}/{mosaicLimit}
          </Badge>
        </Group>
        <Group className="mosaic-modal-render-settings" grow align="flex-start">
          <NumberInput
            className="mosaic-modal-cell-size"
            label="单格尺寸(px)"
            min={256}
            max={2048}
            step={32}
            value={mosaicCellSize}
            onChange={(value) => {
              const parsed = Number(value || 480)
              onCellSizeChange(Math.max(256, Math.min(2048, Number.isFinite(parsed) ? Math.trunc(parsed) : 480)))
            }}
          />
          <NumberInput
            className="mosaic-modal-divider-width"
            label="分割线宽(px)"
            min={0}
            max={24}
            step={1}
            value={mosaicDividerWidth}
            onChange={(value) => {
              const parsed = Number(value || 0)
              onDividerWidthChange(Math.max(0, Math.min(24, Number.isFinite(parsed) ? parsed : 0)))
            }}
          />
          <TextInput
            className="mosaic-modal-divider-color"
            label="分割线颜色"
            value={mosaicDividerColor}
            onChange={(event) => onDividerColorChange(event.currentTarget.value)}
            placeholder="#ffffff"
          />
          <TextInput
            className="mosaic-modal-background-color"
            label="背景色"
            value={mosaicBackgroundColor}
            onChange={(event) => onBackgroundColorChange(event.currentTarget.value)}
            placeholder="#0b1224"
          />
        </Group>
        <Group className="mosaic-modal-copy-settings" grow align="flex-start">
          <TextInput
            className="mosaic-modal-title-input"
            label="标题文案"
            value={mosaicTitle}
            onChange={(event) => onTitleChange(event.currentTarget.value)}
            placeholder="例如：春季灵感图集"
          />
          <TextInput
            className="mosaic-modal-title-color"
            label="标题颜色"
            value={mosaicTitleColor}
            onChange={(event) => onTitleColorChange(event.currentTarget.value)}
            placeholder="#f8fafc"
          />
        </Group>
        <Group className="mosaic-modal-copy-sub-settings" grow align="flex-start">
          <Textarea
            className="mosaic-modal-subtitle-input"
            label="说明文案"
            minRows={2}
            autosize
            value={mosaicSubtitle}
            onChange={(event) => onSubtitleChange(event.currentTarget.value)}
            placeholder="可以添加系列说明、时间地点、活动文案等"
          />
          <TextInput
            className="mosaic-modal-subtitle-color"
            label="说明颜色"
            value={mosaicSubtitleColor}
            onChange={(event) => onSubtitleColorChange(event.currentTarget.value)}
            placeholder="#cbd5e1"
          />
        </Group>
        <Stack className="mosaic-modal-preview" gap={6}>
          <Group className="mosaic-modal-preview-header" justify="space-between" align="center">
            <Text className="mosaic-modal-preview-title" size="xs" c="dimmed">预览 & 调整顺序</Text>
            {mosaicSelected.length > 0 && (
              <Text className="mosaic-modal-preview-hint" size="xs" c="dimmed">点击下方缩略图可调整顺序或移除</Text>
            )}
          </Group>
          <InlinePanel className="mosaic-modal-preview-frame" padding="compact" style={{ minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', position: 'relative' }}>
            {mosaicPreviewLoading && <Loader className="mosaic-modal-preview-loader" size="sm" />}
            {!mosaicPreviewLoading && mosaicPreviewUrl && (
              <img className="mosaic-modal-preview-image" src={mosaicPreviewUrl} alt="mosaic preview" style={{ width: '100%', display: 'block', borderRadius: 6, boxShadow: darkCardShadow }} />
            )}
            {!mosaicPreviewLoading && !mosaicPreviewUrl && (
              <Text className="mosaic-modal-preview-empty" size="xs" c="dimmed">
                {mosaicPreviewError || '选择图片后将显示拼图预览'}
              </Text>
            )}
          </InlinePanel>
          {mosaicSelected.length > 0 && (
            <ScrollArea className="mosaic-modal-order-scroll" h={140} type="auto" offsetScrollbars>
              <Group className="mosaic-modal-order-grid" gap={10} wrap="wrap">
                {mosaicSelected.map((url, idx) => (
                  <InlinePanel
                    className="mosaic-modal-order-card"
                    key={`order-${url}`}
                    padding="compact"
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
                        onDragStart={(event) => setTapImageDragData(event, url)}
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
                  </InlinePanel>
                ))}
              </Group>
            </ScrollArea>
          )}
        </Stack>
        <Text className="mosaic-modal-library-title" size="xs" fw={600}>{libraryTitle || '从图库选择'}</Text>
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
                <InlinePanel
                  className="mosaic-modal-library-card"
                  key={`avail-${url}`}
                  padding="compact"
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
                      onDragStart={(event) => setTapImageDragData(event, url)}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </div>
                </InlinePanel>
              )
            })}
          </div>
          {availableImages.length === 0 && <Text className="mosaic-modal-library-empty" size="xs" c="dimmed" mt="xs">暂无可用图片，请先上传或生成。</Text>}
        </ScrollArea>
        <Group className="mosaic-modal-actions" justify="flex-end">
          <Button className="mosaic-modal-cancel" variant="subtle" onClick={onClose}>取消</Button>
          <Button className="mosaic-modal-save" onClick={onSave}>{saveLabel || '保存并生成'}</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
