import { API_BASE } from '../api/server'
import { hasAuthSession, type User, useAuth } from './store'

const KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000

export type AuthRefreshResult = 'refreshed' | 'unauthorized' | 'failed'

type RefreshResponse = {
  authenticated: true
  user: User
}

let refreshInFlight: Promise<AuthRefreshResult> | null = null
let keepAliveStarted = false
let lastKeepAliveAttemptAt = 0

function isRefreshResponse(value: unknown): value is RefreshResponse {
  if (!value || typeof value !== 'object') return false
  const response = value as Partial<RefreshResponse>
  if (response.authenticated !== true || !response.user || typeof response.user !== 'object') return false
  const user = response.user as Partial<User>
  return (
    (typeof user.sub === 'string' || typeof user.sub === 'number')
    && typeof user.login === 'string'
  )
}

async function performSessionRefresh(
  rawFetch: typeof window.fetch,
): Promise<AuthRefreshResult> {
  try {
    const response = await rawFetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (response.status === 401 || response.status === 403) return 'unauthorized'
    if (!response.ok) {
      console.error('[auth] session refresh failed', { status: response.status })
      return 'failed'
    }
    const body: unknown = await response.json().catch(() => null)
    if (!isRefreshResponse(body)) {
      console.error('[auth] session refresh returned an invalid response')
      return 'failed'
    }
    useAuth.getState().setAuth(body.user)
    return 'refreshed'
  } catch (error: unknown) {
    console.error('[auth] session refresh request failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    return 'failed'
  }
}

export function requestSessionRefresh(
  rawFetch: typeof window.fetch,
): Promise<AuthRefreshResult> {
  if (!refreshInFlight) {
    refreshInFlight = performSessionRefresh(rawFetch).finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

function requestKeepAlive(rawFetch: typeof window.fetch): void {
  if (!hasAuthSession()) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  const now = Date.now()
  if (now - lastKeepAliveAttemptAt < KEEP_ALIVE_INTERVAL_MS) return
  lastKeepAliveAttemptAt = now
  void requestSessionRefresh(rawFetch).then((result) => {
    if (result === 'unauthorized') useAuth.getState().clear()
  })
}

export function startAuthSessionKeepAlive(rawFetch: typeof window.fetch): void {
  if (keepAliveStarted || typeof window === 'undefined') return
  keepAliveStarted = true
  window.setInterval(() => requestKeepAlive(rawFetch), KEEP_ALIVE_INTERVAL_MS)
  window.addEventListener('focus', () => requestKeepAlive(rawFetch))
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') requestKeepAlive(rawFetch)
    })
  }
}
