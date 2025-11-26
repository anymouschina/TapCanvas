import { API_BASE } from '../api/server'
import { toast } from '../ui/toast'
import { useAuth } from './store'

const FETCH_INTERCEPTOR_FLAG = '__tapcanvas_fetch401_installed__'
let lastUnauthorizedNotice = 0

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

function handleUnauthorized() {
  const { token, clear } = useAuth.getState()
  if (!token) return
  clear()
  const now = Date.now()
  if (now - lastUnauthorizedNotice > 2000) {
    lastUnauthorizedNotice = now
    toast('登录状态已过期，请重新登录', 'error')
  }
}

export function installAuth401Interceptor() {
  if (typeof window === 'undefined') return
  if ((window as any)[FETCH_INTERCEPTOR_FLAG]) return
  const originalFetch = window.fetch.bind(window)
  ;(window as any)[FETCH_INTERCEPTOR_FLAG] = true
  window.fetch = (async (...args: Parameters<typeof window.fetch>): Promise<Response> => {
    const response = await originalFetch(...args)
    if (response.status === 401 && isInternalApiRequest(args[0])) {
      handleUnauthorized()
    }
    return response
  }) as typeof window.fetch
}
