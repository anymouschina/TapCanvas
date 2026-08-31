import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useRouteNavigationLease } from './useRouteNavigationLease'

describe('useRouteNavigationLease', () => {
  it('revokes an async navigation after the route changes', () => {
    window.history.replaceState(null, '', '/neotv')
    const { result } = renderHook(() => useRouteNavigationLease())
    const lease = result.current()

    window.history.pushState(null, '', '/studio?projectId=another-project')

    expect(lease.isCurrent()).toBe(false)
  })

  it('lets only the latest action navigate', () => {
    window.history.replaceState(null, '', '/projects')
    const { result } = renderHook(() => useRouteNavigationLease())
    const firstLease = result.current()
    const secondLease = result.current()

    expect(firstLease.isCurrent()).toBe(false)
    expect(secondLease.isCurrent()).toBe(true)
  })

  it('revokes an async navigation after unmount', () => {
    window.history.replaceState(null, '', '/share')
    const { result, unmount } = renderHook(() => useRouteNavigationLease())
    const lease = result.current()

    act(() => unmount())

    expect(lease.isCurrent()).toBe(false)
  })
})
