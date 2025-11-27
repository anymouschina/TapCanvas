import React from 'react'
import { Button, Paper, Group, Title, Text, Stack } from '@mantine/core'
import { useAuth } from './store'
import { exchangeGithub, createGuestSession } from '../api/server'
import { toast } from '../ui/toast'

const CLIENT_ID =
  (import.meta as any).env?.VITE_GITHUB_CLIENT_ID ||
  'Ov23liMBjR33FzIBNbmD'
  // 加点注释
const REDIRECT_URI =
  (import.meta as any).env?.VITE_GITHUB_REDIRECT_URI ||
  'http://localhost:5173/oauth/github'

function buildAuthUrl() {
  const params = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'read:user user:email' })
  return `https://github.com/login/oauth/authorize?${params.toString()}`
}
function buildGuideUrl(){
   return `https://ai.feishu.cn/wiki/YZWhw4w2FiO02LkqYosc4NY5nSh`
}

export default function GithubGate({ children }: { children: React.ReactNode }) {
  const token = useAuth(s => s.token)
  const setAuth = useAuth(s => s.setAuth)
  const [guestLoading, setGuestLoading] = React.useState(false)

  React.useEffect(() => {
    const u = new URL(window.location.href)
    if (u.pathname === '/oauth/github' && u.searchParams.get('code')) {
      const code = u.searchParams.get('code')!
      // clean url
      window.history.replaceState({}, '', '/')
      // exchange
      exchangeGithub(code).then(({ token, user }) => setAuth(token, user)).catch(() => {})
    }
  }, [setAuth])

  const handleGuestLogin = React.useCallback(async () => {
    if (guestLoading) return
    setGuestLoading(true)
    try {
      const { token: t, user } = await createGuestSession()
      setAuth(t, user)
    } catch (error) {
      console.error('Guest login failed', error)
      toast('游客模式登录失败，请稍后再试', 'error')
    } finally {
      setGuestLoading(false)
    }
  }, [guestLoading, setAuth])

  if (token) return <>{children}</>

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Paper withBorder shadow="md" p="lg" radius="md" style={{ width: 420, textAlign: 'center' }}>
        <Title order={4} mb="sm">登录 TapCanvas</Title>
        <Text c="dimmed" size="sm" mb="md">使用 GitHub 账号登录后方可使用</Text>
        <Stack gap="sm">
          <Group justify="center" gap="sm">
            <Button onClick={() => { window.location.href = buildGuideUrl() }}>使用指引</Button>
            <Button onClick={() => { window.location.href = buildAuthUrl() }}>使用 GitHub 登录</Button>
          </Group>
          <Button variant="default" loading={guestLoading} onClick={handleGuestLogin}>游客模式体验</Button>
          <Text size="xs" c="dimmed">无需 GitHub，系统会自动创建临时账号，数据仅保存在当前浏览器。</Text>
        </Stack>
      </Paper>
    </div>
  )
}
