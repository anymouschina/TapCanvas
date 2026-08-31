import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestSessionRefresh } from './authSessionRefresh'
import { installAuth401Interceptor } from './fetch401Interceptor'
import { useAuth } from './store'

const refreshedUser = {
  sub: 'user-1',
  login: 'user1',
  name: 'User One',
}

const FETCH_INTERCEPTOR_FLAG = '__tapcanvas_fetch401_installed__'
type FetchInterceptorTestWindow = Window & typeof globalThis & {
  [FETCH_INTERCEPTOR_FLAG]?: boolean
}

describe('browser auth session refresh', () => {
  const initialFetch = window.fetch

  beforeEach(() => {
    delete (window as FetchInterceptorTestWindow)[FETCH_INTERCEPTOR_FLAG]
  })

  afterEach(() => {
    window.fetch = initialFetch
    delete (window as FetchInterceptorTestWindow)[FETCH_INTERCEPTOR_FLAG]
    useAuth.getState().clear()
    vi.restoreAllMocks()
  })

  it('coalesces concurrent refresh attempts into one request', async () => {
    const rawFetch = vi.fn(async () => new Response(JSON.stringify({
      authenticated: true,
      user: refreshedUser,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof window.fetch

    const first = requestSessionRefresh(rawFetch)
    const second = requestSessionRefresh(rawFetch)

    expect(first).toBe(second)
    await expect(first).resolves.toBe('refreshed')
    expect(rawFetch).toHaveBeenCalledTimes(1)
    expect(useAuth.getState().user).toMatchObject(refreshedUser)
  })

  it('refreshes once and replays the original internal request after a 401', async () => {
    useAuth.getState().setAuth(refreshedUser)
    let protectedAttempts = 0
    const rawFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/auth/refresh')) {
        return new Response(JSON.stringify({ authenticated: true, user: refreshedUser }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      protectedAttempts += 1
      return new Response(null, { status: protectedAttempts === 1 ? 401 : 200 })
    }) as unknown as typeof window.fetch
    window.fetch = rawFetch

    installAuth401Interceptor()
    const response = await window.fetch('/protected-resource')

    expect(response.status).toBe(200)
    expect(protectedAttempts).toBe(2)
    expect(rawFetch).toHaveBeenCalledTimes(3)
    expect(useAuth.getState().token).not.toBeNull()
  })

  it('does not recursively intercept a rejected refresh request', async () => {
    useAuth.getState().setAuth(refreshedUser)
    const rawFetch = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof window.fetch
    window.fetch = rawFetch

    installAuth401Interceptor()
    const result = await requestSessionRefresh(window.fetch)

    expect(result).toBe('unauthorized')
    expect(rawFetch).toHaveBeenCalledTimes(1)
  })
})
