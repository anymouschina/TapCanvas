import React from 'react'
import { buildVirtualGridWindow } from './virtualGridModel'

type VirtualizedGridProps<Item> = {
  items: readonly Item[]
  getItemKey: (item: Item) => string
  renderItem: (item: Item) => React.ReactNode
  resolveColumnCount: (containerWidth: number) => number
  rowHeight: number
  rowGap: number
  columnGap: number
  emptyLabel: string
  ariaLabel: string
  className?: string
  overscanRows?: number
}

export function VirtualizedGrid<Item>({
  items,
  getItemKey,
  renderItem,
  resolveColumnCount,
  rowHeight,
  rowGap,
  columnGap,
  emptyLabel,
  ariaLabel,
  className,
  overscanRows = 2,
}: VirtualizedGridProps<Item>): JSX.Element {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = React.useState(0)
  const [viewportSize, setViewportSize] = React.useState({ width: 0, height: 0 })
  const itemIdentity = React.useMemo(
    () => items.map((item) => getItemKey(item)).join('\u0000'),
    [getItemKey, items],
  )

  React.useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const updateViewportSize = (): void => {
      setViewportSize({ width: container.clientWidth, height: container.clientHeight })
    }
    updateViewportSize()
    const resizeObserver = new ResizeObserver(updateViewportSize)
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [])

  React.useEffect(() => {
    const container = containerRef.current
    if (container) container.scrollTop = 0
    setScrollTop(0)
  }, [itemIdentity])

  const columnCount = Math.max(1, resolveColumnCount(viewportSize.width))
  const virtualWindow = buildVirtualGridWindow({
    itemCount: items.length,
    columnCount,
    scrollTop,
    viewportHeight: viewportSize.height,
    rowHeight,
    rowGap,
    overscanRows,
  })
  const visibleRows = virtualWindow.endRow < virtualWindow.startRow
    ? []
    : Array.from(
      { length: virtualWindow.endRow - virtualWindow.startRow + 1 },
      (_, index) => virtualWindow.startRow + index,
    )
  const renderedItemCount = visibleRows.reduce((count, rowIndex) => {
    const rowStart = rowIndex * columnCount
    return count + Math.min(columnCount, Math.max(0, items.length - rowStart))
  }, 0)
  const rootClassName = ['tc-virtualized-grid', className].filter(Boolean).join(' ')

  return (
    <div
      ref={containerRef}
      className={rootClassName}
      role="feed"
      aria-label={ariaLabel}
      data-total-count={items.length}
      data-rendered-count={renderedItemCount}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {items.length === 0 ? (
        <div className="tc-virtualized-grid__empty">{emptyLabel}</div>
      ) : (
        <div
          className="tc-virtualized-grid__spacer"
          style={{ height: virtualWindow.totalHeight }}
        >
          {visibleRows.map((rowIndex) => {
            const rowStart = rowIndex * columnCount
            const rowItems = items.slice(rowStart, rowStart + columnCount)
            return (
              <div
                className="tc-virtualized-grid__row"
                key={rowIndex}
                style={{
                  height: rowHeight,
                  columnGap,
                  gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                  transform: `translateY(${rowIndex * (rowHeight + rowGap)}px)`,
                }}
              >
                {rowItems.map((item) => (
                  <React.Fragment key={getItemKey(item)}>{renderItem(item)}</React.Fragment>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
