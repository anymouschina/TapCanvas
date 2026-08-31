import { API_BASE } from '../api/server'
import { notifyAuthExpired } from './AuthExpiredNotice'
import { requestSessionRefresh, startAuthSessionKeepAlive } from './authSessionRefresh'
import { hasAuthSession, useAuth } from './store'

const FETCH_INTERCEPTOR_FLAG = '__tapcanvas_fetch401_installed__'
const SAVED_ACCOUNT_PROBE_HEADER = 'X-TapCanvas-Source'
const SAVED_ACCOUNT_PROBE_VALUE = 'saved-account-candidate'
let lastUnauthorizedNotice = 0

type FetchInterceptorWindow = Window & typeof globalThis & {
  [FETCH_INTERCEPTOR_FLAG]?: boolean
}

function generateTraceId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `fe_${crypto.randomUUID().replace(/-/g, '')}`
    }
  } catch { /* ignore */ }
  return `fe_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`
}

function getRequestUrl(input: Parameters<typeof window.fetch>[0]): string {
  if (typeof input === 'string') return input
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString()
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url
  return ''
}

const normalizedApiBase = typeof API_BASE === 'string' ? API_BASE.replace(/\/+$/, '') : ''
const apiOrigin = (() => {
  if (!normalizedApiBase) return ''
  try {
    return new URL(normalizedApiBase).origin
  } catch {
    return ''
  }
})()

function isInternalApiRequest(input: Parameters<typeof window.fetch>[0]): boolean {
  const url = getRequestUrl(input)
  if (!url) return false
  if (url.startsWith('/')) return true
  if (normalizedApiBase && url.startsWith(normalizedApiBase)) return true
  if (apiOrigin && url.startsWith(apiOrigin)) return true
  if (typeof window !== 'undefined') {
    try {
      const origin = window.location.origin
      if (origin && url.startsWith(origin)) return true
    } catch {
      // ignore
    }
  }
  return false
}

function isPublicApiRequest(input: Parameters<typeof window.fetch>[0]): boolean {
  const raw = getRequestUrl(input)
  if (!raw) return false
  if (raw.startsWith('/public/')) return true
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : undefined
    const parsed = new URL(raw, base)
    return parsed.pathname.startsWith('/public/')
  } catch {
    return false
  }
}

function isAuthCredentialRequest(input: Parameters<typeof window.fetch>[0]): boolean {
  const raw = getRequestUrl(input)
  if (!raw) return false
  let pathname = raw
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : undefined
    pathname = new URL(raw, base).pathname
  } catch {
    // Keep the raw relative path for the exact suffix checks below.
  }
  const exactSuffixes = [
    '/auth/session',
    '/auth/refresh',
    '/auth/github/exchange',
    '/auth/guest',
    '/auth/email/request',
    '/auth/email/verify',
		'/auth/login',
  ]
  return (
    exactSuffixes.some((suffix) => pathname.endsWith(suffix))
    || pathname.includes('/auth/agents-cli/')
  )
}

function isSavedAccountProbe(input: Parameters<typeof window.fetch>[0], init?: RequestInit): boolean {
  const headers = input instanceof Request ? input.headers : new Headers(init?.headers)
  return headers.get(SAVED_ACCOUNT_PROBE_HEADER) === SAVED_ACCOUNT_PROBE_VALUE
}

function handleUnauthorized() {
  const { token, clear } = useAuth.getState()
  if (!token) return
  clear()
  const now = Date.now()
  if (now - lastUnauthorizedNotice > 2000) {
    lastUnauthorizedNotice = now
    notifyAuthExpired()
  }
}

export function installAuth401Interceptor() {
  if (typeof window === 'undefined') return
  const interceptorWindow = window as FetchInterceptorWindow
  if (interceptorWindow[FETCH_INTERCEPTOR_FLAG]) return
  const originalFetch = window.fetch.bind(window)
  interceptorWindow[FETCH_INTERCEPTOR_FLAG] = true
  startAuthSessionKeepAlive(originalFetch)
  window.fetch = (async (...args: Parameters<typeof window.fetch>): Promise<Response> => {
    let [input, init] = args

    // Inject X-Trace-ID for all internal API requests so every log line carries the same ID
    if (isInternalApiRequest(input)) {
      const traceId = generateTraceId()
      if (input instanceof Request) {
        const headers = new Headers(input.headers)
        if (!headers.has('x-trace-id')) {
          headers.set('X-Trace-ID', traceId)
          input = new Request(input, { ...(init || {}), headers })
          init = undefined
        }
      } else {
        const headers = new Headers((init?.headers || {}) as HeadersInit)
        if (!headers.has('x-trace-id')) {
          headers.set('X-Trace-ID', traceId)
          init = { ...(init || {}), headers }
        }
      }
    }

    let retryInput: RequestInfo | URL = input as RequestInfo | URL
    let retryInit = init
    if (input instanceof Request) {
      try {
        retryInput = input.clone()
        retryInit = init
      } catch {
        // A consumed streaming request cannot be replayed; the original response remains authoritative.
      }
    }

    const response = await originalFetch(input as RequestInfo | URL, init)
    // /public/* may fail with upstream vendor auth (not user session expiry).
    // Do not clear current canvas login for those errors.
    if (
      response.status === 401
      && isInternalApiRequest(args[0])
      && !isPublicApiRequest(args[0])
      && !isSavedAccountProbe(args[0], args[1])
      && !isAuthCredentialRequest(args[0])
      && hasAuthSession()
    ) {
      const refreshResult = await requestSessionRefresh(originalFetch)
      if (refreshResult === 'refreshed') {
        try {
          const retried = await originalFetch(retryInput, retryInit)
          if (retried.status === 401) handleUnauthorized()
          return retried
        } catch (error: unknown) {
          console.error('[auth] request replay after refresh failed', {
            message: error instanceof Error ? error.message : String(error),
          })
          return response
        }
      }
      if (refreshResult === 'unauthorized') handleUnauthorized()
    }
    return response
  }) as typeof window.fetch
}
