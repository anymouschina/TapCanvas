import { useEffect } from 'react'

const BROWSER_ZOOM_KEYS: ReadonlySet<string> = new Set(['+', '=', '-', '_', '0'])
const SAFARI_GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const
const ACTIVE_CAPTURE_OPTIONS: AddEventListenerOptions = { capture: true, passive: false }

type BrowserZoomKeyboardEvent = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey'>

export function isBrowserZoomKeyboardEvent(event: BrowserZoomKeyboardEvent): boolean {
  const modifierPressed = event.ctrlKey || event.metaKey
  return modifierPressed && !event.altKey && BROWSER_ZOOM_KEYS.has(event.key)
}

export function installBrowserZoomLock(target: Window): () => void {
  // Capture is deliberate: React 18 delegates wheel events through passive
  // root listeners. Cancel the browser default before that boundary, but do
  // not stop propagation so React Flow can still own its viewport gestures.
  const preventWheelZoom = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
    }
  }

  const preventKeyboardZoom = (event: KeyboardEvent) => {
    if (isBrowserZoomKeyboardEvent(event)) {
      event.preventDefault()
    }
  }

  const preventSafariGestureZoom: EventListener = (event) => {
    event.preventDefault()
  }

  target.addEventListener('wheel', preventWheelZoom, ACTIVE_CAPTURE_OPTIONS)
  target.addEventListener('keydown', preventKeyboardZoom, ACTIVE_CAPTURE_OPTIONS)
  for (const eventName of SAFARI_GESTURE_EVENTS) {
    target.addEventListener(eventName, preventSafariGestureZoom, ACTIVE_CAPTURE_OPTIONS)
  }

  return () => {
    target.removeEventListener('wheel', preventWheelZoom, true)
    target.removeEventListener('keydown', preventKeyboardZoom, true)
    for (const eventName of SAFARI_GESTURE_EVENTS) {
      target.removeEventListener(eventName, preventSafariGestureZoom, true)
    }
  }
}

export function BrowserZoomLock(): null {
  useEffect(() => installBrowserZoomLock(window), [])
  return null
}
