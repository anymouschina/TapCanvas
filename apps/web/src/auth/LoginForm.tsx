import React from 'react'
import { Anchor, Button, Group, PasswordInput, Stack, Text, TextInput } from '@mantine/core'
import { loginWithCredentials } from '../api/server'
import { toast } from '../ui/toast'
import { DEFAULT_PLATFORM_CREDENTIALS } from './defaultCredentials'
import type { User } from './store'

const GUIDE_URL = 'https://ai.feishu.cn/wiki/YZWhw4w2FiO02LkqYosc4NY5nSh'

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export interface LoginFormProps {
  /** Called after the server establishes the HttpOnly session cookie. */
  onLoginSuccess: (user: User) => void
  /** Whether to show the form's own heading. Set false when a parent modal provides its own title. Default: true */
  showTitle?: boolean
}

export function LoginForm({ onLoginSuccess, showTitle = true }: LoginFormProps): JSX.Element {
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  const handleLogin = React.useCallback(async () => {
    const normalizedUsername = username.trim()
    if (!normalizedUsername) { toast('请输入账号', 'error'); return }
    if (!password) { toast('请输入密码', 'error'); return }
    if (loading) return
    setLoading(true)
    try {
      const { user } = await loginWithCredentials(normalizedUsername, password)
      onLoginSuccess(user)
    } catch (error) {
      console.error('Credential login failed', error)
      toast(getErrorMessage(error, '账号密码登录失败，请稍后再试'), 'error')
    } finally {
      setLoading(false)
    }
  }, [loading, onLoginSuccess, password, username])

  return (
    <Stack className="tc-login-form" gap="md">
      {showTitle ? (
        <Stack className="tc-login-form__heading" gap={2}>
          <Text className="tc-login-form__title" fw={600} size="md" ta="center">登录 TapCanvas</Text>
          <Text className="tc-login-form__subtitle" c="dimmed" size="sm" ta="center">使用管理员账号登录</Text>
          <Group className="tc-login-form__guide" justify="center" gap={6}>
            <Text className="tc-login-form__guide-label" size="xs" c="dimmed">不知道怎么用？</Text>
            <Anchor className="tc-login-form__guide-link" size="xs" href={GUIDE_URL} target="_blank" rel="noreferrer">查看使用指引</Anchor>
          </Group>
        </Stack>
      ) : null}

      <div className="tc-login-form__default-credentials">
        <Text className="tc-login-form__default-credentials-title" size="xs" fw={650}>
          本地默认登录账号
        </Text>
        <div className="tc-login-form__default-credentials-list">
          {DEFAULT_PLATFORM_CREDENTIALS.map((credential) => (
            <div className="tc-login-form__default-credential" key={credential.platform}>
              <span className="tc-login-form__default-credential-platform">{credential.platform}</span>
              <code className="tc-login-form__default-credential-value">
                {credential.username} / {credential.password}
              </code>
            </div>
          ))}
        </div>
        <Text className="tc-login-form__default-credentials-note" size="xs" c="dimmed">
          仅适用于未覆盖部署变量的首次启动；生产环境请立即修改默认密码。
        </Text>
      </div>

      <Stack className="tc-login-form__credentials" gap="sm">
        <TextInput
          className="tc-login-form__username-input"
          label="账号"
          placeholder="请输入管理员账号"
          value={username}
          onChange={(event) => setUsername(event.currentTarget.value)}
          autoComplete="username"
          autoFocus
        />
        <PasswordInput
          className="tc-login-form__password-input"
          label="密码"
          placeholder="请输入管理员密码"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          autoComplete="current-password"
          onKeyDown={(event) => { if (event.key === 'Enter') void handleLogin() }}
        />
        <Button
          className="tc-login-form__submit"
          color="blue"
          fullWidth
          loading={loading}
          disabled={!username.trim() || !password || loading}
          onClick={() => void handleLogin()}
        >
          登录
        </Button>
      </Stack>
    </Stack>
  )
}
