export type ScreenPoint = {
  x: number
  y: number
}

export type ScreenRect = {
  left: number
  top: number
  right: number
  bottom: number
}

export type MeasurablePath = Pick<SVGPathElement, 'getTotalLength' | 'getPointAtLength'>

const EPSILON = 1e-6

function toScreenRect(rect: ScreenRect | DOMRect): ScreenRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  }
}

function isPointInsideRect(point: ScreenPoint, rect: ScreenRect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  )
}

function isPointOnSegment(point: ScreenPoint, start: ScreenPoint, end: ScreenPoint): boolean {
  return (
    point.x >= Math.min(start.x, end.x) - EPSILON &&
    point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.y >= Math.min(start.y, end.y) - EPSILON &&
    point.y <= Math.max(start.y, end.y) + EPSILON
  )
}

function getOrientation(start: ScreenPoint, end: ScreenPoint, point: ScreenPoint): number {
  const cross = (end.y - start.y) * (point.x - end.x) - (end.x - start.x) * (point.y - end.y)
  if (Math.abs(cross) <= EPSILON) return 0
  return cross > 0 ? 1 : 2
}

function segmentsIntersect(
  startA: ScreenPoint,
  endA: ScreenPoint,
  startB: ScreenPoint,
  endB: ScreenPoint,
): boolean {
  const orientation1 = getOrientation(startA, endA, startB)
  const orientation2 = getOrientation(startA, endA, endB)
  const orientation3 = getOrientation(startB, endB, startA)
  const orientation4 = getOrientation(startB, endB, endA)

  if (orientation1 !== orientation2 && orientation3 !== orientation4) return true
  if (orientation1 === 0 && isPointOnSegment(startB, startA, endA)) return true
  if (orientation2 === 0 && isPointOnSegment(endB, startA, endA)) return true
  if (orientation3 === 0 && isPointOnSegment(startA, startB, endB)) return true
  if (orientation4 === 0 && isPointOnSegment(endA, startB, endB)) return true

  return false
}

function segmentIntersectsRect(start: ScreenPoint, end: ScreenPoint, rect: ScreenRect): boolean {
  if (isPointInsideRect(start, rect) || isPointInsideRect(end, rect)) return true

  const topLeft = { x: rect.left, y: rect.top }
  const topRight = { x: rect.right, y: rect.top }
  const bottomRight = { x: rect.right, y: rect.bottom }
  const bottomLeft = { x: rect.left, y: rect.bottom }

  return (
    segmentsIntersect(start, end, topLeft, topRight) ||
    segmentsIntersect(start, end, topRight, bottomRight) ||
    segmentsIntersect(start, end, bottomRight, bottomLeft) ||
    segmentsIntersect(start, end, bottomLeft, topLeft)
  )
}

export function getPointToRectDistance(point: ScreenPoint, rectInput: ScreenRect | DOMRect): number {
  const rect = toScreenRect(rectInput)
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.right)
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom)
  return Math.hypot(dx, dy)
}

export function screenPathIntersectsRect(
  path: MeasurablePath,
  rectInput: ScreenRect | DOMRect,
  sampleStep: number = 16,
): boolean {
  const rect = toScreenRect(rectInput)
  const totalLength = path.getTotalLength()
  if (!Number.isFinite(totalLength) || totalLength < 0) return false

  const startPoint = path.getPointAtLength(0)
  let previousPoint: ScreenPoint = { x: startPoint.x, y: startPoint.y }
  if (isPointInsideRect(previousPoint, rect)) return true
  if (totalLength === 0) return false

  const safeStep = Math.max(1, sampleStep)
  for (let currentLength = safeStep; currentLength <= totalLength + safeStep; currentLength += safeStep) {
    const pointAtLength = path.getPointAtLength(Math.min(currentLength, totalLength))
    const currentPoint: ScreenPoint = { x: pointAtLength.x, y: pointAtLength.y }
    if (segmentIntersectsRect(previousPoint, currentPoint, rect)) return true
    previousPoint = currentPoint
  }

  return false
}
