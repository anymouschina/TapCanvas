import React from 'react'
import { Button, Paper, Group, Title, Text, Stack, Tooltip } from '@mantine/core'
import { useAuth, type User } from './store'
import { exchangeGithub, createGuestSession } from '../api/server'
import { toast } from '../ui/toast'

const CLIENT_ID =
  (import.meta as any).env?.VITE_GITHUB_CLIENT_ID || ''
const REDIRECT_URI =
  (import.meta as any).env?.VITE_GITHUB_REDIRECT_URI ||
  'http://localhost:5173/oauth/github'

const REDIRECT_STORAGE_KEY = 'tapcanvas_login_redirect'

function normalizeRedirect(raw: string | null): string | null {
  if (!raw || typeof window === 'undefined') return null
  try {
    const url = new URL(raw, window.location.origin)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString()
    }
    return null
  } catch {
    return null
  }
}

function parseStateRedirect(state: string | null): string | null {
  if (!state) return null
  try {
    const parsed = JSON.parse(atob(state))
    if (parsed && typeof parsed.redirect === 'string') {
      return normalizeRedirect(parsed.redirect)
    }
  } catch {
    return null
  }
  return null
}

function captureRedirectFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    const redirectFromQuery = normalizeRedirect(url.searchParams.get('redirect'))
    const redirectFromState = parseStateRedirect(url.searchParams.get('state'))
    const next = redirectFromQuery || redirectFromState
    if (next) {
      sessionStorage.setItem(REDIRECT_STORAGE_KEY, next)
    }
    if (redirectFromQuery) {
      url.searchParams.delete('redirect')
      window.history.replaceState({}, '', url.toString())
    }
    return sessionStorage.getItem(REDIRECT_STORAGE_KEY)
  } catch {
    return null
  }
}

function readStoredRedirect(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(REDIRECT_STORAGE_KEY)
}

function clearStoredRedirect() {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(REDIRECT_STORAGE_KEY)
}

function buildAuthState(target: string | null): string | undefined {
  if (!target) return undefined
  try {
    return btoa(JSON.stringify({ redirect: target }))
  } catch {
    return undefined
  }
}

function appendAuthToRedirect(target: string, token: string, user: User | null | undefined): string | null {
  try {
    const url = new URL(target)
    url.searchParams.set('tap_token', token)
    if (user) {
      url.searchParams.set('tap_user', JSON.stringify(user))
    }
    return url.toString()
  } catch {
    return null
  }
}

function buildAuthUrl(state?: string) {
  const params = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'read:user user:email' })
  if (state) params.set('state', state)
  return `https://github.com/login/oauth/authorize?${params.toString()}`
}
function buildGuideUrl(){
   return `https://ai.feishu.cn/wiki/YZWhw4w2FiO02LkqYosc4NY5nSh`
}

export default function GithubGate({ children, className }: { children: React.ReactNode; className?: string }) {
  const token = useAuth(s => s.token)
  const user = useAuth(s => s.user)
  const setAuth = useAuth(s => s.setAuth)
  const [guestLoading, setGuestLoading] = React.useState(false)
  const githubEnabled = Boolean(String(CLIENT_ID || '').trim())
  const redirectingRef = React.useRef(false)
  const [hasRedirect, setHasRedirect] = React.useState(() => !!readStoredRedirect())

  React.useEffect(() => {
    const stored = captureRedirectFromLocation()
    if (stored) {
      setHasRedirect(true)
    }
  }, [])

  const redirectIfNeeded = React.useCallback((authToken: string, authUser: User | null | undefined) => {
    if (redirectingRef.current) return
    const target = readStoredRedirect()
    if (!target) {
      setHasRedirect(false)
      return
    }
    const next = appendAuthToRedirect(target, authToken, authUser)
    if (!next) {
      clearStoredRedirect()
      setHasRedirect(false)
      return
    }
    redirectingRef.current = true
    clearStoredRedirect()
    window.location.href = next
  }, [setHasRedirect])

  React.useEffect(() => {
    const u = new URL(window.location.href)
    if (u.pathname === '/oauth/github' && u.searchParams.get('code')) {
      if (!githubEnabled) {
        toast('当前环境未配置 GitHub OAuth，建议使用游客模式登录', 'error')
        return
      }
      const stored = captureRedirectFromLocation()
      if (stored) {
        setHasRedirect(true)
      }
      const code = u.searchParams.get('code')!
      // clean url
      window.history.replaceState({}, '', '/')
      // exchange
      exchangeGithub(code)
        .then(({ token: t, user: uinfo }) => {
          setAuth(t, uinfo)
          redirectIfNeeded(t, uinfo)
        })
        .catch((error) => {
          console.error('GitHub exchange failed', error)
          toast('GitHub 登录失败，请改用游客模式或检查后端 GitHub 配置', 'error')
        })
    }
  }, [setAuth, redirectIfNeeded, githubEnabled])

  React.useEffect(() => {
    if (token && hasRedirect) {
      redirectIfNeeded(token, user)
    }
  }, [token, user, hasRedirect, redirectIfNeeded])

  const handleGuestLogin = React.useCallback(async () => {
    if (guestLoading) return
    setGuestLoading(true)
    try {
      const { token: t, user } = await createGuestSession()
      setAuth(t, user)
      redirectIfNeeded(t, user)
    } catch (error) {
      console.error('Guest login failed', error)
      toast('游客模式登录失败，请稍后再试', 'error')
    } finally {
      setGuestLoading(false)
    }
  }, [guestLoading, setAuth, redirectIfNeeded])

  const handleGithubLogin = React.useCallback(() => {
    if (!githubEnabled) {
      toast('当前环境未配置 GitHub OAuth（缺少 VITE_GITHUB_CLIENT_ID）', 'error')
      return
    }
    const redirectTarget = readStoredRedirect() || captureRedirectFromLocation()
    if (redirectTarget) {
      setHasRedirect(true)
    }
    const state = buildAuthState(redirectTarget || null)
    window.location.href = buildAuthUrl(state)
  }, [setHasRedirect, githubEnabled])

  const gateClassName = ['github-gate', className].filter(Boolean).join(' ')

  if (token) return <div className={gateClassName}>{children}</div>

  return (
    <div className={gateClassName} style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Paper className="github-gate-card" withBorder shadow="md" p="lg" radius="md" style={{ width: 420, textAlign: 'center' }}>
        <Title className="github-gate-title" order={4} mb="sm">登录 TapCanvas</Title>
        <Text className="github-gate-subtitle" c="dimmed" size="sm" mb="md">使用 GitHub 账号登录后方可使用</Text>
        <Stack className="github-gate-actions" gap="sm">
          <Group className="github-gate-actions-row" justify="center" gap="sm">
            <Button className="github-gate-guide" onClick={() => { window.location.href = buildGuideUrl() }}>使用指引</Button>
            <Tooltip className="github-gate-github-tooltip" label={githubEnabled ? '' : '未配置 VITE_GITHUB_CLIENT_ID，已禁用 GitHub 登录'} disabled={githubEnabled}>
              <Button className="github-gate-github" onClick={handleGithubLogin} disabled={!githubEnabled}>使用 GitHub 登录</Button>
            </Tooltip>
          </Group>
          <Button className="github-gate-guest" variant="default" loading={guestLoading} onClick={handleGuestLogin}>游客模式体验</Button>
          <Text className="github-gate-hint" size="xs" c="dimmed">无需 GitHub，系统会自动创建临时账号，数据仅保存在当前浏览器。</Text>
        </Stack>
      </Paper>
    </div>
  )
}
