import React from 'react'
import { Button, Paper, Group, Title, Text } from '@mantine/core'
import { useAuth } from './store'
import { exchangeGithub } from '../api/server'

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

  if (token) return <>{children}</>

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Paper withBorder shadow="md" p="lg" radius="md" style={{ width: 420, textAlign: 'center' }}>
        <Title order={4} mb="sm">登录 TapCanvas</Title>
        <Text c="dimmed" size="sm" mb="md">使用 GitHub 账号登录后方可使用</Text>
        <Group justify="center">
          <Button onClick={() => { window.location.href = buildGuideUrl() }}>使用指引</Button>
          <Button onClick={() => { window.location.href = buildAuthUrl() }}>使用 GitHub 登录</Button>
        </Group>
      </Paper>
    </div>
  )
}
