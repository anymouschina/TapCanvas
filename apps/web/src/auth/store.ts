import { create } from 'zustand'
import { taskHubRuntime } from '../runner/taskHub'

export type User = {
  sub: string | number
  login: string
  name?: string
  avatarUrl?: string
  email?: string
  phone?: string
  hasPassword?: boolean
  role?: string | null
  guest?: boolean
}

export type SavedAccount = {
  id: string
  user: User
  lastUsedAt: string
  current: boolean
}

const SESSION_MARKER = 'cookie-session'
const SESSION_COOKIE_NAME = 'tap_session_present'
const USER_CACHE_KEY = 'tap_user'

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${name}=`
  const entry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null
}

function clearReadableSessionMarker(): void {
  if (typeof document !== 'undefined') {
    document.cookie = `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`
  }
}

function readCachedUser(): User | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const user = parsed as Partial<User>
    if ((typeof user.sub !== 'string' && typeof user.sub !== 'number') || typeof user.login !== 'string') return null
    return user as User
  } catch {
    return null
  }
}

function cacheUser(user: User | null): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem('tap_token')
    localStorage.removeItem('tapcanvas_saved_accounts_v1')
    if (user) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_CACHE_KEY)
  } catch {
    // Storage is optional; the server cookie remains the session authority.
  }
}

function savedAccountFor(user: User | null): SavedAccount[] {
  if (!user) return []
  return [{
    id: String(user.sub),
    user,
    lastUsedAt: new Date().toISOString(),
    current: true,
  }]
}

const markerPresent = readCookie(SESSION_COOKIE_NAME) === '1'
const cachedUser = markerPresent ? readCachedUser() : null

type AuthState = {
  /** A non-secret UI marker. The real session token only exists in the HttpOnly cookie. */
  token: string | null
  user: User | null
  loading: boolean
  savedAccounts: SavedAccount[]
  hydrate: () => Promise<void>
  login: (code: string, state?: string) => Promise<void>
  setAuth: (user: User) => void
  clear: () => void
  removeSavedAccount: (id: string) => void
  switchAccount: (id: string) => Promise<void>
}

export const useAuth = create<AuthState>((set, get) => ({
  token: markerPresent ? SESSION_MARKER : null,
  user: cachedUser,
  loading: true,
  savedAccounts: savedAccountFor(cachedUser),
  hydrate: async () => {
    set({ loading: true })
    try {
      const { getBrowserSession } = await import('../api/server')
      const session = await getBrowserSession()
      cacheUser(session.user)
      set({
        token: SESSION_MARKER,
        user: session.user,
        savedAccounts: savedAccountFor(session.user),
      })
    } catch (sessionError: unknown) {
      const { requestSessionRefresh } = await import('./authSessionRefresh')
      const refreshResult = await requestSessionRefresh(window.fetch.bind(window))
      if (refreshResult === 'unauthorized') {
        get().clear()
      } else if (refreshResult === 'failed') {
        console.error('[auth] browser session hydration is temporarily unavailable', {
          message: sessionError instanceof Error ? sessionError.message : String(sessionError),
        })
      }
    } finally {
      set({ loading: false })
    }
  },
  login: async (code: string) => {
    set({ loading: true })
    try {
      const { exchangeGithub } = await import('../api/server')
      const response = await exchangeGithub(code)
      get().setAuth(response.user)
    } finally {
      set({ loading: false })
    }
  },
  setAuth: (user) => {
    cacheUser(user)
    set({ token: SESSION_MARKER, user, loading: false, savedAccounts: savedAccountFor(user) })
  },
  clear: () => {
    cacheUser(null)
    clearReadableSessionMarker()
    set({ token: null, user: null, savedAccounts: [] })
    taskHubRuntime.clear()
  },
  removeSavedAccount: (id) => {
    if (String(get().user?.sub ?? '') === id) get().clear()
  },
  switchAccount: async (id) => {
    if (String(get().user?.sub ?? '') === id) return
    throw new Error('安全会话模式不在浏览器保存其他账号凭据，请退出后重新登录')
  },
}))

export function hasAuthSession(): boolean {
  return useAuth.getState().token === SESSION_MARKER
}
