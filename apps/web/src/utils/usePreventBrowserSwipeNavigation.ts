import { useEffect } from 'react'
import type React from 'react'

type Options = {
  enabled?: boolean
  rootRef: React.RefObject<HTMLElement | null>
  withinSelector: string
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA') return true
  if (target.getAttribute('contenteditable') === 'true') return true
  if (target.closest('input') || target.closest('textarea')) return true
  if (target.closest('[contenteditable="true"]')) return true
  return false
}

/**
 * Prevents browser "back/forward" navigation triggered by trackpad 2-finger swipe
 * while the pointer is over a given canvas/flow area.
 */
export function usePreventBrowserSwipeNavigation({
  enabled = true,
  rootRef,
  withinSelector,
}: Options): void {
  useEffect(() => {
    if (!enabled) return
    const root = rootRef.current
    if (!root) return

    const onWheelCapture = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (isTextInput(target) || isTextInput(document.activeElement)) return
      if (!target.closest(withinSelector)) return

      // Trackpad history navigation is typically triggered by horizontal wheel gestures.
      const dx = Math.abs(e.deltaX)
      const dy = Math.abs(e.deltaY)
      const isHorizontal = dx > 0 && dx >= dy
      if (isHorizontal) e.preventDefault()
    }

    root.addEventListener('wheel', onWheelCapture, { capture: true, passive: false })
    return () => {
      root.removeEventListener('wheel', onWheelCapture, true)
    }
  }, [enabled, rootRef, withinSelector])
}

