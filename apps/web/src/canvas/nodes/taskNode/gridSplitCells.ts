export type GridSplitCell = {
  row: number
  col: number
}

export function compareGridSplitCells(left: GridSplitCell, right: GridSplitCell): number {
  if (left.row !== right.row) return left.row - right.row
  if (left.col !== right.col) return left.col - right.col
  return 0
}

export function sortGridSplitCells(cells: readonly GridSplitCell[]): GridSplitCell[] {
  return [...cells].sort(compareGridSplitCells)
}

export function parseGridSplitCellKey(key: string): GridSplitCell | null {
  const [rowRaw, colRaw, extra] = key.split('-')
  if (extra !== undefined) return null
  const row = Number(rowRaw)
  const col = Number(colRaw)
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null
  if (row < 0 || col < 0) return null
  return { row, col }
}

export function parseGridSplitSelectedCells(keys: Iterable<string>): GridSplitCell[] {
  const cells: GridSplitCell[] = []
  for (const key of keys) {
    const cell = parseGridSplitCellKey(key)
    if (cell) cells.push(cell)
  }
  return sortGridSplitCells(cells)
}
