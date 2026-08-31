import { afterEach, describe, expect, it, vi } from 'vitest'
import { installBrowserZoomLock, isBrowserZoomKeyboardEvent } from './BrowserZoomLock'

const mountedElements: HTMLElement[] = []

function mountEventTarget(): HTMLElement {
  const target = document.createElement('div')
  document.body.appendChild(target)
  mountedElements.push(target)
  return target
}

afterEach(() => {
  for (const element of mountedElements.splice(0)) {
    element.remove()
  }
})

describe('BrowserZoomLock', () => {
  it.each([
    { key: '+', ctrlKey: true, metaKey: false },
    { key: '=', ctrlKey: true, metaKey: false },
    { key: '-', ctrlKey: false, metaKey: true },
    { key: '0', ctrlKey: false, metaKey: true },
  ])('recognizes browser zoom shortcut $key', ({ key, ctrlKey, metaKey }) => {
    expect(isBrowserZoomKeyboardEvent({ altKey: false, ctrlKey, key, metaKey })).toBe(true)
  })

  it('does not treat regular or AltGr-like input as browser zoom', () => {
    expect(isBrowserZoomKeyboardEvent({ altKey: false, ctrlKey: false, key: '+', metaKey: false })).toBe(false)
    expect(isBrowserZoomKeyboardEvent({ altKey: true, ctrlKey: true, key: '=', metaKey: false })).toBe(false)
  })

  it('cancels modified wheel zoom without stopping downstream event handling', () => {
    const removeLock = installBrowserZoomLock(window)
    const target = mountEventTarget()
    const downstreamListener = vi.fn()
    target.addEventListener('wheel', downstreamListener)

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -10,
    })
    target.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(downstreamListener).toHaveBeenCalledOnce()
    removeLock()
  })

  it('leaves regular wheel scrolling unchanged', () => {
    const removeLock = installBrowserZoomLock(window)
    const target = mountEventTarget()
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 10,
    })

    target.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    removeLock()
  })

  it.each([
    { key: '+', ctrlKey: true, metaKey: false },
    { key: '-', ctrlKey: false, metaKey: true },
    { key: '0', ctrlKey: true, metaKey: false },
  ])('cancels keyboard zoom shortcut $key', ({ key, ctrlKey, metaKey }) => {
    const removeLock = installBrowserZoomLock(window)
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey,
      key,
      metaKey,
    })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    removeLock()
  })

  it('cancels Safari gesture zoom and removes the lock on cleanup', () => {
    const removeLock = installBrowserZoomLock(window)
    const target = mountEventTarget()
    const activeEvent = new Event('gesturestart', { bubbles: true, cancelable: true })

    target.dispatchEvent(activeEvent)
    expect(activeEvent.defaultPrevented).toBe(true)

    removeLock()

    const cleanedUpEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    })
    target.dispatchEvent(cleanedUpEvent)
    expect(cleanedUpEvent.defaultPrevented).toBe(false)
  })
})
