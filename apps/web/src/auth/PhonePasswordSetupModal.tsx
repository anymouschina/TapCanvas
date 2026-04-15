import React from 'react'
import { Button, Group, Modal, PasswordInput, Stack, Text } from '@mantine/core'
import { setAccountPassword } from '../api/server'
import { useAuth } from './store'
import { clearPasswordSetupGuidePending, readPasswordSetupGuidePending } from './passwordSetupGuide'
import { toast } from '../ui/toast'

export default function PhonePasswordSetupModal({ className }: { className?: string }): JSX.Element | null {
  const user = useAuth((state) => state.user)
  const setAuth = useAuth((state) => state.setAuth)
  const [opened, setOpened] = React.useState(false)
  const [password, setPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    const pending = readPasswordSetupGuidePending()
    const normalizedPhone = typeof user?.phone === 'string' ? user.phone.trim() : ''
    const shouldOpen = Boolean(
      pending &&
      normalizedPhone &&
      pending.phone === normalizedPhone &&
      user?.hasPassword === false,
    )
    setOpened(shouldOpen)
    if (!shouldOpen && user?.hasPassword) {
      clearPasswordSetupGuidePending()
    }
  }, [user?.phone, user?.hasPassword])

  const closeModal = React.useCallback(() => {
    clearPasswordSetupGuidePending()
    setOpened(false)
  }, [])

  const handleSubmit = React.useCallback(async () => {
    const normalizedPassword = password.trim()
    const normalizedConfirmPassword = confirmPassword.trim()

    if (normalizedPassword.length < 8) {
      toast('密码至少需要 8 位', 'error')
      return
    }
    if (normalizedPassword !== normalizedConfirmPassword) {
      toast('两次输入的密码不一致', 'error')
      return
    }
    if (submitting) return

    setSubmitting(true)
    try {
      const { token, user: refreshedUser } = await setAccountPassword(normalizedPassword)
      setAuth(token, refreshedUser)
      clearPasswordSetupGuidePending()
      setOpened(false)
      setPassword('')
      setConfirmPassword('')
      toast('登录密码设置成功，下次可直接用手机号 + 密码登录', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '密码设置失败，请稍后再试'
      toast(message, 'error')
    } finally {
      setSubmitting(false)
    }
  }, [confirmPassword, password, setAuth, submitting])

  if (!user) return null

  return (
    <Modal
      className={['phone-password-setup-modal', className].filter(Boolean).join(' ')}
      opened={opened}
      onClose={closeModal}
      title="设置登录密码"
      centered
      closeOnClickOutside={!submitting}
      closeOnEscape={!submitting}
      withCloseButton={!submitting}
      radius="md"
    >
      <Stack className="phone-password-setup-modal__content" gap="md">
        <Text className="phone-password-setup-modal__desc" size="sm" c="dimmed">
          你刚刚通过验证码完成登录。为了下次更快进入首页，建议现在就为手机号设置登录密码。
        </Text>
        <PasswordInput
          className="phone-password-setup-modal__password"
          label="登录密码"
          placeholder="至少 8 位"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          autoComplete="new-password"
        />
        <PasswordInput
          className="phone-password-setup-modal__confirm-password"
          label="确认密码"
          placeholder="再次输入登录密码"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.currentTarget.value)}
          autoComplete="new-password"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void handleSubmit()
            }
          }}
        />
        <Group className="phone-password-setup-modal__actions" justify="flex-end">
          <Button
            className="phone-password-setup-modal__later"
            variant="default"
            onClick={closeModal}
            disabled={submitting}
          >
            稍后设置
          </Button>
          <Button
            className="phone-password-setup-modal__submit"
            onClick={() => void handleSubmit()}
            loading={submitting}
          >
            立即设置
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
