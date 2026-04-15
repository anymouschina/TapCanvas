import React from 'react'
import { Anchor, Button, Divider, Group, Title, Text, Stack, Tooltip, TextInput, PasswordInput } from '@mantine/core'
import { loginWithPhonePassword, exchangeGithub, requestPhoneLoginCode, verifyPhoneLogin } from '../api/server'
import { toast } from '../ui/toast'
import { markPasswordSetupGuidePending } from './passwordSetupGuide'
import { useAuth, type User } from './store'
import { GITHUB_OAUTH_CALLBACK_PATH, STUDIO_PATH } from '../utils/appRoutes'
import { PanelCard } from '../ui/PanelCard'

type ViteEnvShape = ImportMeta & {
  env?: {
    VITE_GITHUB_CLIENT_ID?: string
    VITE_GITHUB_REDIRECT_URI?: string
  }
}

const viteEnv = (import.meta as ViteEnvShape).env
const CLIENT_ID = viteEnv?.VITE_GITHUB_CLIENT_ID || ''
const REDIRECT_URI = viteEnv?.VITE_GITHUB_REDIRECT_URI || ''
const REDIRECT_STORAGE_KEY = 'tapcanvas_login_redirect'

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

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
    const parsed = JSON.parse(atob(state)) as { redirect?: string }
    if (typeof parsed.redirect === 'string') {
      return normalizeRedirect(parsed.redirect)
    }
  } catch {
    return null
  }
  return null
}

function readCurrentPageRedirect(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    if (url.pathname === GITHUB_OAUTH_CALLBACK_PATH) return null
    url.searchParams.delete('tap_token')
    url.searchParams.delete('tap_user')
    return normalizeRedirect(url.toString())
  } catch {
    return null
  }
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
    url.searchParams.delete('tap_token')
    url.searchParams.delete('tap_user')
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    const isSameOrigin = Boolean(currentOrigin) && url.origin === currentOrigin
    if (!isSameOrigin) {
      url.searchParams.set('tap_token', token)
      if (user) {
        url.searchParams.set('tap_user', JSON.stringify(user))
      }
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

function buildGuideUrl() {
  return 'https://ai.feishu.cn/wiki/YZWhw4w2FiO02LkqYosc4NY5nSh'
}

export default function GithubGate({ children, className }: { children: React.ReactNode; className?: string }) {
  const token = useAuth((state) => state.token)
  const user = useAuth((state) => state.user)
  const setAuth = useAuth((state) => state.setAuth)
  const [otpSendLoading, setOtpSendLoading] = React.useState(false)
  const [otpCooldownSeconds, setOtpCooldownSeconds] = React.useState(0)
  const [otpVerifyLoading, setOtpVerifyLoading] = React.useState(false)
  const [passwordLoginLoading, setPasswordLoginLoading] = React.useState(false)
  const [phone, setPhone] = React.useState('')
  const [otpCode, setOtpCode] = React.useState('')
  const [password, setPassword] = React.useState('')
  const phoneInputRef = React.useRef<HTMLInputElement | null>(null)
  const otpInputRef = React.useRef<HTMLInputElement | null>(null)
  const githubEnabled = Boolean(String(CLIENT_ID || '').trim() && String(REDIRECT_URI || '').trim())
  const redirectingRef = React.useRef(false)
  const [hasRedirect, setHasRedirect] = React.useState(() => !!readStoredRedirect())

  const completeLogin = React.useCallback((authToken: string, authUser: User) => {
    setAuth(authToken, authUser)
    if (authUser.phone && authUser.hasPassword === false) {
      markPasswordSetupGuidePending(authUser.phone)
    }
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
  }, [setAuth])

  React.useEffect(() => {
    const stored = captureRedirectFromLocation()
    if (stored) {
      setHasRedirect(true)
    }
  }, [])

  React.useEffect(() => {
    const url = new URL(window.location.href)
    if (url.pathname === GITHUB_OAUTH_CALLBACK_PATH && url.searchParams.get('code')) {
      if (!githubEnabled) {
        toast('当前环境未配置 GitHub OAuth，请使用手机号登录', 'error')
        return
      }
      const stored = captureRedirectFromLocation()
      if (stored) {
        setHasRedirect(true)
      }
      const code = url.searchParams.get('code')
      if (!code) return
      window.history.replaceState({}, '', STUDIO_PATH)
      exchangeGithub(code)
        .then(({ token: authToken, user: authUser }) => {
          completeLogin(authToken, authUser)
        })
        .catch((error: unknown) => {
          console.error('GitHub exchange failed', error)
          toast('GitHub 登录失败，请改用手机号登录或检查后端 GitHub 配置', 'error')
        })
    }
  }, [completeLogin, githubEnabled])

  React.useEffect(() => {
    if (!token || !hasRedirect || !user) return
    const target = readStoredRedirect()
    if (!target) {
      setHasRedirect(false)
      return
    }
    const next = appendAuthToRedirect(target, token, user)
    if (!next) {
      clearStoredRedirect()
      setHasRedirect(false)
      return
    }
    redirectingRef.current = true
    clearStoredRedirect()
    window.location.href = next
  }, [hasRedirect, token, user])

  React.useEffect(() => {
    if (otpCooldownSeconds <= 0) return
    const timer = window.setInterval(() => {
      setOtpCooldownSeconds((current) => (current > 0 ? current - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [otpCooldownSeconds])

  const handleOtpSendCode = React.useCallback(async () => {
    const latestPhone = phoneInputRef.current?.value ?? phone
    const normalizedPhone = String(latestPhone || '').trim()

    if (!normalizedPhone) {
      toast('请输入手机号', 'error')
      return
    }
    if (otpCooldownSeconds > 0) {
      toast(`请在 ${otpCooldownSeconds}s 后重试`, 'info')
      return
    }
    if (otpSendLoading) return

    setOtpSendLoading(true)
    try {
      const result = await requestPhoneLoginCode(normalizedPhone)
      setOtpCooldownSeconds(60)
      if (result.delivery === 'debug' && result.devCode) {
        toast(`开发环境验证码：${result.devCode}`, 'info')
      } else {
        toast('验证码已发送，请查收短信', 'success')
      }
    } catch (error) {
      console.error('OTP code request failed', error)
      toast(getErrorMessage(error, '验证码发送失败，请稍后再试'), 'error')
    } finally {
      setOtpSendLoading(false)
    }
  }, [otpCooldownSeconds, otpSendLoading, phone])

  const handleOtpLogin = React.useCallback(async () => {
    const latestPhone = phoneInputRef.current?.value ?? phone
    const latestCode = otpInputRef.current?.value ?? otpCode
    const normalizedPhone = String(latestPhone || '').trim()
    const normalizedCode = String(latestCode || '').trim()

    if (!normalizedPhone) {
      toast('请输入手机号', 'error')
      return
    }
    if (!normalizedCode) {
      toast('请输入验证码', 'error')
      return
    }
    if (otpVerifyLoading) return

    setOtpVerifyLoading(true)
    try {
      const { token: authToken, user: authUser } = await verifyPhoneLogin(normalizedPhone, normalizedCode)
      completeLogin(authToken, authUser)
    } catch (error) {
      console.error('OTP login failed', error)
      toast(getErrorMessage(error, '验证码登录失败，请稍后再试'), 'error')
    } finally {
      setOtpVerifyLoading(false)
    }
  }, [completeLogin, otpCode, otpVerifyLoading, phone])

  const handlePhonePasswordLogin = React.useCallback(async () => {
    const normalizedPhone = String(phoneInputRef.current?.value ?? phone).trim()
    const normalizedPassword = String(password || '').trim()

    if (!normalizedPhone) {
      toast('请输入手机号', 'error')
      return
    }
    if (!normalizedPassword) {
      toast('请输入密码', 'error')
      return
    }
    if (passwordLoginLoading) return

    setPasswordLoginLoading(true)
    try {
      const { token: authToken, user: authUser } = await loginWithPhonePassword(normalizedPhone, normalizedPassword)
      completeLogin(authToken, authUser)
    } catch (error) {
      console.error('Phone password login failed', error)
      toast(getErrorMessage(error, '手机号密码登录失败，请稍后再试'), 'error')
    } finally {
      setPasswordLoginLoading(false)
    }
  }, [completeLogin, password, passwordLoginLoading, phone])

  const handleGithubLogin = React.useCallback(() => {
    if (!githubEnabled) {
      toast('当前环境未配置 GitHub OAuth（缺少 VITE_GITHUB_CLIENT_ID）', 'error')
      return
    }
    const redirectTarget = readStoredRedirect() || captureRedirectFromLocation() || readCurrentPageRedirect()
    if (redirectTarget) {
      sessionStorage.setItem(REDIRECT_STORAGE_KEY, redirectTarget)
      setHasRedirect(true)
    }
    const state = buildAuthState(redirectTarget || null)
    window.location.href = buildAuthUrl(state)
  }, [githubEnabled])

  const gateClassName = ['github-gate', className].filter(Boolean).join(' ')
  const normalizedPhone = String(phone || '').trim()
  const normalizedCode = String(otpCode || '').trim()
  const normalizedPassword = String(password || '').trim()

  if (token) {
    return (
      <div className={gateClassName} style={{ height: '100%', width: '100%' }}>
        {children}
      </div>
    )
  }

  return (
    <div className={gateClassName} style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <PanelCard className="github-gate-card" padding="comfortable" style={{ width: 'min(460px, calc(100vw - 32px))' }}>
        <Stack className="github-gate-content" gap="md">
          <Stack className="github-gate-heading" gap={2}>
            <Title className="github-gate-title" order={4} ta="center">登录 TapCanvas</Title>
            <Text className="github-gate-subtitle" c="dimmed" size="sm" ta="center">
              使用 GitHub / 手机验证码 / 手机号密码 登录后方可使用
            </Text>
            <Group className="github-gate-guide-row" justify="center" gap={6}>
              <Text className="github-gate-guide-prefix" size="xs" c="dimmed">不知道怎么用？</Text>
              <Anchor className="github-gate-guide-link" size="xs" href={buildGuideUrl()} target="_blank" rel="noreferrer">
                查看使用指引
              </Anchor>
            </Group>
          </Stack>

          <Tooltip className="github-gate-github-tooltip" label={githubEnabled ? '' : '未配置 VITE_GITHUB_CLIENT_ID / VITE_GITHUB_REDIRECT_URI，已禁用 GitHub 登录'} disabled={githubEnabled}>
            <Button className="github-gate-github" fullWidth onClick={handleGithubLogin} disabled={!githubEnabled}>
              使用 GitHub 登录
            </Button>
          </Tooltip>

          <Divider className="github-gate-divider" label="或使用手机号" labelPosition="center" />

          <Stack className="github-gate-phone-auth" gap="sm">
            <TextInput
              className="github-gate-phone-input"
              ref={phoneInputRef}
              label="手机号"
              placeholder="+86 13800000000"
              value={phone}
              onChange={(event) => setPhone(event.currentTarget.value)}
              autoComplete="tel"
              type="tel"
              inputMode="tel"
              rightSection={(
                <Button
                  className="github-gate-otp-send"
                  size="xs"
                  variant="subtle"
                  loading={otpSendLoading}
                  disabled={!normalizedPhone || otpSendLoading || otpCooldownSeconds > 0}
                  onClick={() => void handleOtpSendCode()}
                >
                  {otpCooldownSeconds > 0 ? `${otpCooldownSeconds}s` : '获取验证码'}
                </Button>
              )}
              rightSectionWidth={110}
              rightSectionPointerEvents="all"
            />

            <TextInput
              className="github-gate-otp-code"
              ref={otpInputRef}
              label="验证码登录"
              placeholder="6 位验证码"
              value={otpCode}
              onChange={(event) => setOtpCode(event.currentTarget.value)}
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleOtpLogin()
                }
              }}
            />

            <Button
              className="github-gate-otp-login"
              fullWidth
              loading={otpVerifyLoading}
              disabled={!normalizedPhone || !normalizedCode || otpVerifyLoading}
              onClick={() => void handleOtpLogin()}
            >
              手机验证码登录
            </Button>
            <Text className="github-gate-otp-hint" size="xs" c="dimmed">验证码 10 分钟内有效。若未设置密码，登录后会引导你完成设置。</Text>
          </Stack>

          <Divider className="github-gate-divider github-gate-divider--password" label="或使用密码" labelPosition="center" />

          <Stack className="github-gate-password-auth" gap="sm">
            <PasswordInput
              className="github-gate-password-input"
              label="密码登录"
              placeholder="输入登录密码"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              autoComplete="current-password"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handlePhonePasswordLogin()
                }
              }}
            />
            <Button
              className="github-gate-password-login"
              fullWidth
              loading={passwordLoginLoading}
              disabled={!normalizedPhone || !normalizedPassword || passwordLoginLoading}
              onClick={() => void handlePhonePasswordLogin()}
            >
              手机号 + 密码登录
            </Button>
            <Text className="github-gate-password-hint" size="xs" c="dimmed">首次没有密码时，请先使用验证码登录一次。</Text>
          </Stack>
        </Stack>
      </PanelCard>
    </div>
  )
}
