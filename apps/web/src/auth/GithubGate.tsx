import React from 'react'
import { exchangeGithub } from '../api/server'
import { toast } from '../ui/toast'
import { useAuth, type User } from './store'
import { GITHUB_OAUTH_CALLBACK_PATH, STUDIO_PATH } from '../utils/appRoutes'
import { PanelCard } from '../ui/PanelCard'
import { LoginForm } from './LoginForm'

type ViteEnvShape = ImportMeta & { env?: { VITE_GITHUB_CLIENT_ID?: string; VITE_GITHUB_REDIRECT_URI?: string } }
const viteEnv = (import.meta as ViteEnvShape).env
const CLIENT_ID = viteEnv?.VITE_GITHUB_CLIENT_ID || ''
const REDIRECT_URI = viteEnv?.VITE_GITHUB_REDIRECT_URI || ''
const REDIRECT_STORAGE_KEY = 'tapcanvas_login_redirect'

function normalizeRedirect(raw: string | null): string | null {
  if (!raw || typeof window === 'undefined') return null
  try {
    const url = new URL(raw, window.location.origin)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === window.location.origin) return url.toString()
    return null
  } catch { return null }
}

function parseStateRedirect(state: string | null): string | null {
  if (!state) return null
  try {
    const parsed = JSON.parse(atob(state)) as { redirect?: string }
    if (typeof parsed.redirect === 'string') return normalizeRedirect(parsed.redirect)
  } catch { return null }
  return null
}

function captureRedirectFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    const redirectFromQuery = normalizeRedirect(url.searchParams.get('redirect'))
    const redirectFromState = parseStateRedirect(url.searchParams.get('state'))
    const next = redirectFromQuery || redirectFromState
    if (next) sessionStorage.setItem(REDIRECT_STORAGE_KEY, next)
    if (redirectFromQuery) { url.searchParams.delete('redirect'); window.history.replaceState({}, '', url.toString()) }
    return sessionStorage.getItem(REDIRECT_STORAGE_KEY)
  } catch { return null }
}

function readStoredRedirect(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(REDIRECT_STORAGE_KEY)
}

function clearStoredRedirect() {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(REDIRECT_STORAGE_KEY)
}

function hasGithubCallbackCode(): boolean {
  if (typeof window === 'undefined') return false
  const url = new URL(window.location.href)
  return url.pathname === GITHUB_OAUTH_CALLBACK_PATH && Boolean(url.searchParams.get('code'))
}

function safeRedirectTarget(target: string): string | null {
  try {
    const url = new URL(target)
    url.searchParams.delete('tap_token')
    url.searchParams.delete('tap_user')
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    return currentOrigin && url.origin === currentOrigin ? url.toString() : null
  } catch { return null }
}

export default function GithubGate({ children, className }: { children: React.ReactNode; className?: string }) {
  const token = useAuth((s) => s.token)
  const user = useAuth((s) => s.user)
  const loading = useAuth((s) => s.loading)
  const hydrate = useAuth((s) => s.hydrate)
  const setAuth = useAuth((s) => s.setAuth)
  const githubEnabled = Boolean(String(CLIENT_ID || '').trim() && String(REDIRECT_URI || '').trim())
  const redirectingRef = React.useRef(false)
  const [hasRedirect, setHasRedirect] = React.useState(() => !!readStoredRedirect())

  const completeLogin = React.useCallback((authUser: User) => {
    setAuth(authUser)
    if (redirectingRef.current) return
    const target = readStoredRedirect()
    if (!target) { setHasRedirect(false); return }
    const next = safeRedirectTarget(target)
    if (!next) { clearStoredRedirect(); setHasRedirect(false); return }
    redirectingRef.current = true
    clearStoredRedirect()
    window.location.href = next
  }, [setAuth])

  React.useEffect(() => {
    if (hasGithubCallbackCode()) return
    void hydrate()
  }, [hydrate])

  React.useEffect(() => {
    const stored = captureRedirectFromLocation()
    if (stored) setHasRedirect(true)
  }, [])

  React.useEffect(() => {
    const url = new URL(window.location.href)
    if (url.pathname === GITHUB_OAUTH_CALLBACK_PATH && url.searchParams.get('code')) {
      if (!githubEnabled) { toast('当前环境未配置 GitHub OAuth，请使用邮箱或账号密码登录', 'error'); return }
      const stored = captureRedirectFromLocation()
      if (stored) setHasRedirect(true)
      const code = url.searchParams.get('code')
      if (!code) return
      window.history.replaceState({}, '', STUDIO_PATH)
      exchangeGithub(code)
        .then(({ user: authUser }) => completeLogin(authUser))
        .catch((error: unknown) => {
          console.error('GitHub exchange failed', error)
          toast('GitHub 登录失败，请改用邮箱或账号密码登录，或检查后端 GitHub 配置', 'error')
        })
    }
  }, [completeLogin, githubEnabled])

  React.useEffect(() => {
    if (!token || !hasRedirect || !user) return
    const target = readStoredRedirect()
    if (!target) { setHasRedirect(false); return }
    const next = safeRedirectTarget(target)
    if (!next) { clearStoredRedirect(); setHasRedirect(false); return }
    redirectingRef.current = true
    clearStoredRedirect()
    window.location.href = next
  }, [hasRedirect, token, user])

  const gateClassName = ['github-gate', className].filter(Boolean).join(' ')

  if (loading) {
    return <div className={gateClassName} aria-busy="true" />
  }

  if (token) {
    return <div className={gateClassName} style={{ height: '100%', width: '100%' }}>{children}</div>
  }

  return (
    <div className={gateClassName} style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <PanelCard className="github-gate-card" padding="comfortable" style={{ width: 'min(460px, calc(100vw - 32px))' }}>
        <LoginForm
          onLoginSuccess={completeLogin}
        />
      </PanelCard>
    </div>
  )
}
