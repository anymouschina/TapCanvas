// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { navigateBackOr, spaNavigate, spaReplace } from './spaNavigate'

describe('spa navigation history', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/chapter/current')
  })

  it('returns to the fallback route when the current page has no app route history', () => {
    const back = vi.spyOn(window.history, 'back')

    navigateBackOr('/')

    expect(back).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/')
  })

  it('uses browser back after an in-app route was pushed', () => {
    spaNavigate('/chapter/next')
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)

    navigateBackOr('/')

    expect(back).toHaveBeenCalledOnce()
    expect(window.location.pathname).toBe('/chapter/next')
  })

  it('does not create a back entry when replacing an app route', () => {
    spaReplace('/chapter/replaced')
    const back = vi.spyOn(window.history, 'back')

    navigateBackOr('/')

    expect(back).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/')
  })
})
