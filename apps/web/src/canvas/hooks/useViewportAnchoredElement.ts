import React from 'react'
import { type Edge, type Node, useStoreApi } from '@xyflow/react'

export type ViewportTransform = readonly [translateX: number, translateY: number, zoom: number]

export type ViewportAnchorPlacement =
  | {
      kind: 'point'
      x: number
      y: number
    }
  | {
      kind: 'center-above'
      x: number
      y: number
      offsetY: number
      minimumY: number
    }
  | {
      kind: 'right-center'
      x: number
      y: number
      offsetX: number
    }

function resolveScreenPoint(
  transform: ViewportTransform,
  placement: ViewportAnchorPlacement,
): { x: number; y: number } {
  const [translateX, translateY, zoom] = transform
  const x = placement.x * zoom + translateX
  const y = placement.y * zoom + translateY
  if (placement.kind === 'center-above') {
    return { x, y: Math.max(placement.minimumY, y - placement.offsetY) }
  }
  if (placement.kind === 'right-center') {
    return { x: x + placement.offsetX, y }
  }
  return { x, y }
}

export function resolveViewportAnchorTransform(
  transform: ViewportTransform,
  placement: ViewportAnchorPlacement,
): string {
  const point = resolveScreenPoint(transform, placement)
  const alignment = placement.kind === 'center-above'
    ? ' translateX(-50%)'
    : placement.kind === 'right-center'
      ? ' translateY(-50%)'
      : ''
  return `translate3d(${point.x}px, ${point.y}px, 0)${alignment}`
}

export function positionViewportAnchoredElement(
  element: HTMLElement,
  transform: ViewportTransform,
  placement: ViewportAnchorPlacement,
): void {
  element.style.transform = resolveViewportAnchorTransform(transform, placement)
}

/**
 * Keeps an overlay attached to a flow-space point without subscribing React to
 * the per-frame viewport transform. Only the element's compositor transform is
 * updated while panning or zooming; its React subtree remains untouched.
 */
export function useViewportAnchoredElement(
  elementRef: React.RefObject<HTMLElement | null>,
  placement: ViewportAnchorPlacement,
): void {
  const store = useStoreApi<Node, Edge>()
  const placementRef = React.useRef(placement)
  placementRef.current = placement

  React.useLayoutEffect(() => {
    const position = (): void => {
      const element = elementRef.current
      if (!element) return
      positionViewportAnchoredElement(element, store.getState().transform, placementRef.current)
    }

    position()
    let previousTransform = store.getState().transform
    return store.subscribe((state) => {
      if (state.transform === previousTransform) return
      previousTransform = state.transform
      position()
    })
  }, [
    elementRef,
    placement.kind,
    placement.x,
    placement.y,
    placement.kind === 'center-above' ? placement.minimumY : null,
    placement.kind === 'center-above' ? placement.offsetY : null,
    placement.kind === 'right-center' ? placement.offsetX : null,
    store,
  ])
}
