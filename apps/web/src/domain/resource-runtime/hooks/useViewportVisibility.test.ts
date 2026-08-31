import React from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isCanvasMediaMoving,
  isCanvasViewportMoving,
  setCanvasNodeDragging,
  setCanvasViewportMoving,
  subscribeCanvasMediaMotion,
  subscribeCanvasViewportMotion,
  useViewportVisibility,
} from './useViewportVisibility'

describe('shared canvas viewport movement state', () => {
  afterEach(() => {
    cleanup()
    setCanvasViewportMoving(false)
    setCanvasNodeDragging(false)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('tracks movement without mutating the document root', () => {
    setCanvasViewportMoving(true)

    expect(isCanvasViewportMoving()).toBe(true)
    expect(document.documentElement.hasAttribute('data-canvas-viewport-moving')).toBe(false)

    setCanvasViewportMoving(false)
    expect(isCanvasViewportMoving()).toBe(false)
  })

  it('notifies media owners only when the movement state changes', () => {
    const states: boolean[] = []
    const unsubscribe = subscribeCanvasViewportMotion((moving) => states.push(moving))

    setCanvasViewportMoving(true)
    setCanvasViewportMoving(true)
    setCanvasViewportMoving(false)
    unsubscribe()
    setCanvasViewportMoving(true)

    expect(states).toEqual([true, false])
  })

  it('keeps media paused until both viewport motion and node dragging have settled', () => {
    const states: boolean[] = []
    const unsubscribe = subscribeCanvasMediaMotion((moving) => states.push(moving))

    setCanvasViewportMoving(true)
    setCanvasNodeDragging(true)
    setCanvasViewportMoving(false)
    expect(isCanvasMediaMoving()).toBe(true)
    setCanvasNodeDragging(false)

    expect(isCanvasMediaMoving()).toBe(false)
    expect(states).toEqual([true, false])
    unsubscribe()
  })

  it('does not strand a visible virtualized image when movement settles between effects', async () => {
    class SilentIntersectionObserver {
      disconnect(): void {}
      observe(): void {}
      takeRecords(): IntersectionObserverEntry[] { return [] }
      unobserve(): void {}
      readonly root = null
      readonly rootMargin = '0px'
      readonly thresholds = [0]
    }
    vi.stubGlobal('IntersectionObserver', SilentIntersectionObserver)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      top: 100,
      left: 100,
      right: 300,
      bottom: 300,
      width: 200,
      height: 200,
      toJSON: () => ({}),
    })
    setCanvasViewportMoving(true)

    function Harness() {
      const visibility = useViewportVisibility<HTMLDivElement>({ enabled: true })
      React.useLayoutEffect(() => {
        setCanvasViewportMoving(false)
      }, [])
      return React.createElement('div', {
        ref: visibility.ref,
        className: 'viewport-visibility-race-harness',
        'data-visible': visibility.isVisible ? 'true' : 'false',
      })
    }

    const view = render(React.createElement(Harness))

    await waitFor(() => {
      expect(view.container.firstElementChild?.getAttribute('data-visible')).toBe('true')
    })

    act(() => setCanvasViewportMoving(false))
  })

  it('measures the final rect instead of replaying a stale intersection from mid-pan', async () => {
    let callback: IntersectionObserverCallback | null = null
    let observer: IntersectionObserver | null = null
    class ControlledIntersectionObserver implements IntersectionObserver {
      constructor(nextCallback: IntersectionObserverCallback) {
        callback = nextCallback
        observer = this
      }
      disconnect(): void {}
      observe(): void {}
      takeRecords(): IntersectionObserverEntry[] { return [] }
      unobserve(): void {}
      readonly root = null
      readonly rootMargin = '0px'
      readonly thresholds = [0]
    }
    vi.stubGlobal('IntersectionObserver', ControlledIntersectionObserver)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      top: 100,
      left: 100,
      right: 300,
      bottom: 300,
      width: 200,
      height: 200,
      toJSON: () => ({}),
    })
    setCanvasViewportMoving(true)

    function Harness() {
      const visibility = useViewportVisibility<HTMLDivElement>({ enabled: true })
      return React.createElement('div', {
        ref: visibility.ref,
        className: 'viewport-visibility-stale-entry-harness',
        'data-visible': visibility.isVisible ? 'true' : 'false',
      })
    }

    const view = render(React.createElement(Harness))
    const staleEntry = {
      isIntersecting: false,
      intersectionRatio: 0,
    } as IntersectionObserverEntry

    act(() => {
      callback?.([staleEntry], observer as IntersectionObserver)
      setCanvasViewportMoving(false)
    })

    await waitFor(() => {
      expect(view.container.firstElementChild?.getAttribute('data-visible')).toBe('true')
    })
  })
})
