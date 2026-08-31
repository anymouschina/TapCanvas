import React from 'react'
import type { ShotTableData } from '@tapcanvas/shot-table-protocol'

export type ShotTableGridProps = {
  className: string
  table: ShotTableData
  selectedRowId: string | null
  selectedColumnKey: string | null
  readOnly: boolean
  onSelectRow: (rowId: string) => void
  onSelectColumn: (columnKey: string) => void
  onCellChange: (rowId: string, columnKey: string, value: string) => void
  onCellBlur: () => void
  onActiveCellChange: (cell: ShotTableGridActiveCell) => void
}

export type ShotTableGridActiveCell = {
  rowId: string
  columnKey: string
  value: string
  selectionStart: number
  selectionEnd: number
  element: HTMLTextAreaElement
}

type ShotGroupPosition = { first: boolean; size: number }

const buildShotGroupPositions = (table: ShotTableData): Map<string, ShotGroupPosition> => {
  const positions = new Map<string, ShotGroupPosition>()
  let index = 0
  while (index < table.rows.length) {
    const shotId = table.rows[index]?.shotId
    if (!shotId) {
      index += 1
      continue
    }
    let end = index + 1
    while (table.rows[end]?.shotId === shotId) end += 1
    for (let rowIndex = index; rowIndex < end; rowIndex += 1) {
      const rowId = table.rows[rowIndex]?.id
      if (rowId) positions.set(rowId, { first: rowIndex === index, size: end - index })
    }
    index = end
  }
  return positions
}

export const ShotTableGrid = React.memo(function ShotTableGrid({
  className,
  table,
  selectedRowId,
  selectedColumnKey,
  readOnly,
  onSelectRow,
  onSelectColumn,
  onCellChange,
  onCellBlur,
  onActiveCellChange,
}: ShotTableGridProps): JSX.Element {
  const groupPositions = React.useMemo(() => buildShotGroupPositions(table), [table])
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = React.useState({ left: 0, max: 0 })
  const syncScroll = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    setScroll({ left: viewport.scrollLeft, max: Math.max(0, viewport.scrollWidth - viewport.clientWidth) })
  }, [])

  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(syncScroll)
    observer.observe(viewport)
    syncScroll()
    return () => observer.disconnect()
  }, [syncScroll, table.columns.length, table.rows.length])

  const setScrollLeft = (left: number): void => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollLeft = Math.max(0, Math.min(scroll.max, left))
    syncScroll()
  }

  const reportActiveCell = (
    element: HTMLTextAreaElement,
    rowId: string,
    columnKey: string,
  ): void => onActiveCellChange({
    rowId,
    columnKey,
    value: element.value,
    selectionStart: element.selectionStart ?? element.value.length,
    selectionEnd: element.selectionEnd ?? element.value.length,
    element,
  })

  return (
    <div className={`tc-shot-table-grid nodrag nopan nowheel ${className}`}>
      <div
        className="tc-shot-table-grid__viewport nodrag nopan nowheel"
        ref={viewportRef}
        onScroll={syncScroll}
        onWheel={(event) => {
          if (!event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
          event.preventDefault()
          setScrollLeft((viewportRef.current?.scrollLeft ?? 0) + event.deltaY)
        }}
      >
        <table className="tc-shot-table-grid__table">
        <thead className="tc-shot-table-grid__head">
          <tr className="tc-shot-table-grid__head-row">
            <th className="tc-shot-table-grid__row-index-heading">#</th>
            {table.columns.map((column) => (
              <th
                className={`tc-shot-table-grid__heading${selectedColumnKey === column.key ? ' is-selected' : ''}`}
                key={column.key}
                scope="col"
                onClick={() => onSelectColumn(column.key)}
              >
                <span className="tc-shot-table-grid__heading-label">{column.label}</span>
                <span className="tc-shot-table-grid__scope-label">
                  {column.scope === 'shot' ? '镜头' : '时序'}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tc-shot-table-grid__body">
          {table.rows.map((row, rowIndex) => {
            const group = groupPositions.get(row.id) ?? { first: true, size: 1 }
            const selected = selectedRowId === row.id
            return (
              <tr
                className={`tc-shot-table-grid__row${selected ? ' is-selected' : ''}${group.first ? ' is-shot-start' : ''}`}
                key={row.id}
                onClick={() => onSelectRow(row.id)}
              >
                <th className="tc-shot-table-grid__row-index" scope="row">
                  {rowIndex + 1}
                </th>
                {table.columns.map((column) => {
                  if (column.scope === 'shot' && !group.first) return null
                  return (
                    <td
                      className={`tc-shot-table-grid__cell tc-shot-table-grid__cell--${column.scope}`}
                      key={column.key}
                      rowSpan={column.scope === 'shot' ? group.size : undefined}
                      onClick={() => onSelectColumn(column.key)}
                    >
                      <textarea
                        className="tc-shot-table-grid__input nodrag nopan nowheel"
                        aria-label={`${column.label}，第 ${rowIndex + 1} 行`}
                        value={row.values[column.key] ?? ''}
                        readOnly={readOnly}
                        rows={2}
                        onFocus={(event) => {
                          onSelectRow(row.id)
                          onSelectColumn(column.key)
                          reportActiveCell(event.currentTarget, row.id, column.key)
                        }}
                        onSelect={(event) => reportActiveCell(event.currentTarget, row.id, column.key)}
                        onChange={(event) => {
                          onCellChange(row.id, column.key, event.currentTarget.value)
                          reportActiveCell(event.currentTarget, row.id, column.key)
                        }}
                        onBlur={onCellBlur}
                      />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
        </table>
      </div>
      <div className="tc-shot-table-grid__scroll-controls">
        <button
          className="tc-shot-table-grid__scroll-button"
          type="button"
          disabled={scroll.left <= 0}
          onClick={() => setScrollLeft(scroll.left - 240)}
          aria-label="分镜表向左滚动"
        >
          ‹
        </button>
        <input
          className="tc-shot-table-grid__scroll-range"
          type="range"
          min={0}
          max={Math.max(1, scroll.max)}
          value={Math.min(scroll.left, Math.max(1, scroll.max))}
          disabled={scroll.max <= 0}
          onChange={(event) => setScrollLeft(Number(event.currentTarget.value))}
          aria-label="分镜表横向滚动位置"
        />
        <button
          className="tc-shot-table-grid__scroll-button"
          type="button"
          disabled={scroll.left >= scroll.max}
          onClick={() => setScrollLeft(scroll.left + 240)}
          aria-label="分镜表向右滚动"
        >
          ›
        </button>
      </div>
    </div>
  )
})
