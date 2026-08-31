export type VirtualGridWindow = {
  rowCount: number
  totalHeight: number
  startRow: number
  endRow: number
}

type BuildVirtualGridWindowInput = {
  itemCount: number
  columnCount: number
  scrollTop: number
  viewportHeight: number
  rowHeight: number
  rowGap: number
  overscanRows: number
}

export function buildVirtualGridWindow(input: BuildVirtualGridWindowInput): VirtualGridWindow {
  const columnCount = Math.max(1, Math.floor(input.columnCount))
  const itemCount = Math.max(0, Math.floor(input.itemCount))
  const rowCount = Math.ceil(itemCount / columnCount)
  const rowStride = input.rowHeight + input.rowGap
  const totalHeight = rowCount === 0 ? 0 : rowCount * rowStride - input.rowGap
  if (rowCount === 0) return { rowCount, totalHeight, startRow: 0, endRow: -1 }

  const firstVisibleRow = Math.floor(Math.max(0, input.scrollTop) / rowStride)
  const lastVisibleRow = Math.floor(
    Math.max(0, input.scrollTop + Math.max(0, input.viewportHeight) - 1) / rowStride,
  )
  return {
    rowCount,
    totalHeight,
    startRow: Math.max(0, firstVisibleRow - input.overscanRows),
    endRow: Math.min(rowCount - 1, lastVisibleRow + input.overscanRows),
  }
}

export function shouldLoadNextVirtualGridBatch(input: {
  scrollTop: number
  viewportHeight: number
  totalHeight: number
  rowStride: number
  remainingItemCount: number
}): boolean {
  if (input.remainingItemCount <= 0 || input.totalHeight <= 0) return false
  return input.scrollTop + input.viewportHeight >= input.totalHeight - input.rowStride * 2
}
