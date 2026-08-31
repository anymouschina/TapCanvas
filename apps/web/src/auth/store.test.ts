// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBrowserSession } from '../api/server'
import { requestSessionRefresh } from './authSessionRefresh'
import { useAuth } from './store'

vi.mock('../api/server', () => ({
  getBrowserSession: vi.fn(),
}))

vi.mock('./authSessionRefresh', () => ({
  requestSessionRefresh: vi.fn(),
}))

const cachedUser = {
  sub: 'user-1',
  login: 'user1',
  name: 'User One',
}

const mockedGetBrowserSession = vi.mocked(getBrowserSession)
const mockedRequestSessionRefresh = vi.mocked(requestSessionRefresh)

describe('auth store hydration', () => {
  beforeEach(() => {
    useAuth.getState().setAuth(cachedUser)
    mockedGetBrowserSession.mockReset()
    mockedRequestSessionRefresh.mockReset()
  })

  afterEach(() => {
    useAuth.getState().clear()
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('keeps the persisted identity when the API is temporarily unavailable during restart', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedGetBrowserSession.mockRejectedValue(new TypeError('Failed to fetch'))
    mockedRequestSessionRefresh.mockResolvedValue('failed')

    await useAuth.getState().hydrate()

    expect(useAuth.getState().token).not.toBeNull()
    expect(useAuth.getState().user).toEqual(cachedUser)
    expect(window.localStorage.getItem('tap_user')).toBe(JSON.stringify(cachedUser))
    expect(consoleError).toHaveBeenCalledWith(
      '[auth] browser session hydration is temporarily unavailable',
      { message: 'Failed to fetch' },
    )
  })

  it('restores the browser identity through the HttpOnly refresh cookie', async () => {
    useAuth.getState().clear()
    mockedGetBrowserSession.mockRejectedValue(new Error('session failed: 401'))
    mockedRequestSessionRefresh.mockImplementation(async () => {
      useAuth.getState().setAuth(cachedUser)
      return 'refreshed'
    })

    await useAuth.getState().hydrate()

    expect(useAuth.getState().token).not.toBeNull()
    expect(useAuth.getState().user).toEqual(cachedUser)
    expect(window.localStorage.getItem('tap_user')).toBe(JSON.stringify(cachedUser))
  })

  it('clears persisted identity only when refresh credentials are explicitly rejected', async () => {
    mockedGetBrowserSession.mockRejectedValue(new Error('session failed: 401'))
    mockedRequestSessionRefresh.mockResolvedValue('unauthorized')

    await useAuth.getState().hydrate()

    expect(useAuth.getState().token).toBeNull()
    expect(useAuth.getState().user).toBeNull()
    expect(window.localStorage.getItem('tap_user')).toBeNull()
  })
})
