import React from 'react'
import { ActionIcon, Button, Group, Loader, Text, Tooltip } from '@mantine/core'
import { IconArrowLeft, IconLayoutGrid, IconPhoto, IconZoomIn, IconZoomOut } from '@tabler/icons-react'
import type { SlicedGridFrame } from '../../../../utils/imageGridSlicer'

type GridSplitViewProps = {
  layout: { cols: number; rows: number }
  frames: SlicedGridFrame[]
  selected: Set<number>
  loading: boolean
  zoom: number
  isDarkUi: boolean
  inlineDividerColor: string
  onToggleSelect: (index: number, shift: boolean) => void
  onSelectAll: () => void
  onBack: () => void
  onCreateNodes: () => void
  onGenerateHD: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  creatingNodes?: boolean
}

function GridSplitView({
  layout,
  frames,
  selected,
  loading,
  zoom,
  isDarkUi,
  inlineDividerColor,
  onToggleSelect,
  onBack,
  onCreateNodes,
  onGenerateHD,
  onZoomIn,
  onZoomOut,
  creatingNodes,
}: GridSplitViewProps) {
  const { cols, rows } = layout
  const totalCells = cols * rows
  const allSelected = frames.length > 0 && selected.size === frames.length

  const barBg = isDarkUi ? 'rgba(18,24,38,0.92)' : 'rgba(248,250,255,0.95)'
  const barBorder = `1px solid ${inlineDividerColor}`
  const cellBorderSelected = '#969ca6'
  const cellBorderIdle = isDarkUi ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  return (
    <div
      className="grid-split-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
        gap: 0,
      }}
    >
      {/* Action bar */}
      <div
        className="grid-split-view__bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          background: barBg,
          borderBottom: barBorder,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <Tooltip label="返回" position="bottom">
          <ActionIcon
            className="grid-split-view__back"
            size="sm"
            variant="subtle"
            onClick={onBack}
          >
            <IconArrowLeft size={14} />
          </ActionIcon>
        </Tooltip>

        <ActionIcon size="sm" variant="subtle" onClick={allSelected ? onBack : onToggleSelect.bind(null, -1, false)} style={{ pointerEvents: 'none', cursor: 'default' }}>
          <IconLayoutGrid size={14} />
        </ActionIcon>

        <Text
          className="grid-split-view__hint"
          size="xs"
          c="dimmed"
          style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {selected.size > 0
            ? `已选 ${selected.size} / ${totalCells} 格`
            : '请选择宫格进行操作'}
        </Text>

        <Button
          className="grid-split-view__create"
          size="compact-xs"
          variant="subtle"
          leftSection={<IconPhoto size={12} />}
          disabled={selected.size === 0 || creatingNodes}
          loading={creatingNodes}
          onClick={onCreateNodes}
        >
          创建生图节点
        </Button>

        <Button
          className="grid-split-view__hd"
          size="compact-xs"
          variant="subtle"
          leftSection={<IconPhoto size={12} />}
          disabled={selected.size === 0 || creatingNodes}
          onClick={onGenerateHD}
        >
          生成高清图片
        </Button>

        <Group gap={4}>
          <Tooltip label="缩小" position="bottom">
            <ActionIcon size="sm" variant="subtle" onClick={onZoomOut} disabled={zoom <= 1}>
              <IconZoomOut size={13} />
            </ActionIcon>
          </Tooltip>
          <Text size="xs" c="dimmed" style={{ minWidth: 28, textAlign: 'center' }}>
            {zoom}倍
          </Text>
          <Tooltip label="放大" position="bottom">
            <ActionIcon size="sm" variant="subtle" onClick={onZoomIn} disabled={zoom >= 4}>
              <IconZoomIn size={13} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>

      {/* Grid area */}
      <div
        className="grid-split-view__grid-container"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: 4,
        }}
      >
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Loader size="sm" />
          </div>
        ) : (
          <div
            className="grid-split-view__grid"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, 1fr)`,
              gap: 3,
              width: '100%',
              height: `${zoom * 100}%`,
              minHeight: `${zoom * 100}%`,
            }}
          >
            {Array.from({ length: totalCells }, (_, i) => {
              const frame = frames[i]
              const isSelected = selected.has(i)
              const col = i % cols
              const row = Math.floor(i / cols)
              const label = `${row + 1}-${col + 1}`

              return (
                <div
                  key={i}
                  className="grid-split-view__cell nodrag nopan"
                  onClick={(e) => onToggleSelect(i, e.shiftKey)}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    position: 'relative',
                    border: `2px solid ${isSelected ? cellBorderSelected : cellBorderIdle}`,
                    borderRadius: 6,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    boxShadow: isSelected ? `0 0 0 1px ${cellBorderSelected}` : 'none',
                    transition: 'border-color 0.12s, box-shadow 0.12s',
                    aspectRatio: frame ? `${frame.width} / ${frame.height}` : '1 / 1',
                    background: isDarkUi ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                  }}
                >
                  {frame ? (
                    <img
                      src={frame.objectUrl}
                      alt={label}
                      draggable={false}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                        pointerEvents: 'none',
                      }}
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Loader size="xs" />
                    </div>
                  )}

                  {isSelected && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'rgba(150,156,166,0.18)',
                        pointerEvents: 'none',
                      }}
                    />
                  )}

                  <Text
                    size="xs"
                    style={{
                      position: 'absolute',
                      bottom: 4,
                      left: 6,
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 600,
                      textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                      pointerEvents: 'none',
                      userSelect: 'none',
                    }}
                  >
                    {label}
                  </Text>
                </div>
              )
            })}
          </div>
        )}

        {!loading && frames.length > 0 && (
          <Text size="xs" c="dimmed" ta="center" mt={6} style={{ fontSize: 10 }}>
            按住 Shift 键可批量选择
          </Text>
        )}
      </div>
    </div>
  )
}

const _GridSplitView = React.memo(GridSplitView)
export { _GridSplitView as GridSplitView }

type GridCustomPickerProps = {
  maxCols?: number
  maxRows?: number
  onSelect: (cols: number, rows: number) => void
  isDarkUi: boolean
}

function GridCustomPicker({ maxCols = 5, maxRows = 5, onSelect, isDarkUi }: GridCustomPickerProps) {
  const [hover, setHover] = React.useState<{ col: number; row: number } | null>(null)

  const activeCols = hover ? hover.col + 1 : 0
  const activeRows = hover ? hover.row + 1 : 0

  const cellBg = isDarkUi ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
  const cellBgActive = '#969ca6'
  const cellBgHover = 'rgba(150,156,166,0.5)'

  return (
    <div className="grid-custom-picker" style={{ padding: 12, minWidth: 180 }}>
      <Group justify="space-between" mb={8}>
        <Text size="xs" c="dimmed">自定义宫格</Text>
        {hover && (
          <Text size="xs" fw={600}>{activeCols} × {activeRows}</Text>
        )}
      </Group>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${maxCols}, 28px)`,
          gridTemplateRows: `repeat(${maxRows}, 28px)`,
          gap: 4,
        }}
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: maxRows }, (_, rowIdx) =>
          Array.from({ length: maxCols }, (_, colIdx) => {
            const isActive = hover ? colIdx <= hover.col && rowIdx <= hover.row : false
            return (
              <div
                key={`${rowIdx}-${colIdx}`}
                onMouseEnter={() => setHover({ col: colIdx, row: rowIdx })}
                onClick={() => onSelect(colIdx + 1, rowIdx + 1)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: isActive ? cellBgActive : cellBg,
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
              />
            )
          }),
        )}
      </div>
    </div>
  )
}

const _GridCustomPicker = React.memo(GridCustomPicker)
export { _GridCustomPicker as GridCustomPicker }
