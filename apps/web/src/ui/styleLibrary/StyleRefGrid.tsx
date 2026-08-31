import React from 'react'
import type { LlmNodePresetDto } from '../../api/server'
import { StyleRefCard } from './StyleRefCard'

// 风格库虚拟网格：行虚拟化避免一次渲染数百张 ManagedImage。cols 可配，selectedId 高亮锁定卡。
const ITEM_HEIGHT = 150
const ROW_GAP = 10
const ROW_HEIGHT = ITEM_HEIGHT + ROW_GAP
const OVERSCAN = 3

export function StyleRefGrid({
  assets,
  selectedId,
  onSelect,
  cols = 4,
  containerHeight = 420,
}: {
  assets: LlmNodePresetDto[]
  selectedId: string | null
  onSelect: (p: LlmNodePresetDto) => void
  cols?: number
  containerHeight?: number
}) {
  const [scrollTop, setScrollTop] = React.useState(0)

  const rows = React.useMemo<LlmNodePresetDto[][]>(() => {
    const out: LlmNodePresetDto[][] = []
    for (let i = 0; i < assets.length; i += cols) {
      out.push(assets.slice(i, i + cols))
    }
    return out
  }, [assets, cols])

  const totalHeight = rows.length * ROW_HEIGHT
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const endRow = Math.min(
    rows.length - 1,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN,
  )

  return (
    <div
      className="style-library-grid"
      style={{ height: containerHeight, overflowY: 'auto' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="style-library-grid-spacer" style={{ height: totalHeight, position: 'relative' }}>
        <div
          className="style-library-grid-window"
          style={{ position: 'absolute', top: startRow * ROW_HEIGHT, left: 0, right: 0 }}
        >
          {rows.slice(startRow, endRow + 1).map((row, i) => (
            <div
              className="style-library-grid-row"
              key={startRow + i}
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap: ROW_GAP,
                marginBottom: ROW_GAP,
              }}
            >
              {row.map((preset) => (
                <StyleRefCard
                  key={preset.id}
                  preset={preset}
                  selected={selectedId === preset.id}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
