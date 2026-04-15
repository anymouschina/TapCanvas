import type { Node } from '@xyflow/react'
import { getNodeSize } from './nodeBounds'

type XY = { x: number; y: number }

type ReflowTargetGroup = {
  id: string
  position: XY
  width: number
  height: number
}

function compareGroupsByPosition(left: ReflowTargetGroup, right: ReflowTargetGroup): number {
  if (Math.abs(left.position.y - right.position.y) > 1) return left.position.y - right.position.y
  if (Math.abs(left.position.x - right.position.x) > 1) return left.position.x - right.position.x
  return left.id.localeCompare(right.id)
}

function normalizePosition(value: Partial<XY> | undefined, fallback: XY): XY {
  const x = Number(value?.x)
  const y = Number(value?.y)
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
  }
}

export function buildTopLevelGroupReflowPositions(nodes: Node[], groupIds?: string[]): Map<string, XY> {
  const allowedGroupIds = Array.isArray(groupIds) && groupIds.length > 0 ? new Set(groupIds) : null
  const groups: ReflowTargetGroup[] = nodes
    .filter((node) => {
      if (node.type !== 'groupNode') return false
      const rawParentId = 'parentId' in node ? node.parentId : undefined
      if (typeof rawParentId === 'string' && rawParentId.trim()) return false
      if (allowedGroupIds && !allowedGroupIds.has(String(node.id))) return false
      return true
    })
    .map((node) => {
      const size = getNodeSize(node)
      return {
        id: String(node.id),
        position: normalizePosition(node.position, { x: 8, y: 8 }),
        width: size.w,
        height: size.h,
      }
    })
    .sort(compareGroupsByPosition)

  if (groups.length < 2) return new Map<string, XY>()

  const cols = Math.max(1, Math.ceil(Math.sqrt(groups.length)))
  const rows = Math.max(1, Math.ceil(groups.length / cols))
  const gapX = 32
  const gapY = 32
  const startX = Math.min(...groups.map((group) => group.position.x))
  const startY = Math.min(...groups.map((group) => group.position.y))
  const colWidths = Array.from({ length: cols }, () => 0)
  const rowHeights = Array.from({ length: rows }, () => 0)

  groups.forEach((group, index) => {
    const row = Math.floor(index / cols)
    const col = index % cols
    colWidths[col] = Math.max(colWidths[col] || 0, group.width)
    rowHeights[row] = Math.max(rowHeights[row] || 0, group.height)
  })

  const colOffsets = Array.from({ length: cols }, () => 0)
  const rowOffsets = Array.from({ length: rows }, () => 0)

  let cursorX = startX
  for (let col = 0; col < cols; col += 1) {
    colOffsets[col] = cursorX
    cursorX += (colWidths[col] || 0) + gapX
  }

  let cursorY = startY
  for (let row = 0; row < rows; row += 1) {
    rowOffsets[row] = cursorY
    cursorY += (rowHeights[row] || 0) + gapY
  }

  const nextPositionById = new Map<string, XY>()
  groups.forEach((group, index) => {
    const row = Math.floor(index / cols)
    const col = index % cols
    nextPositionById.set(group.id, {
      x: colOffsets[col] ?? startX,
      y: rowOffsets[row] ?? startY,
    })
  })

  return nextPositionById
}
