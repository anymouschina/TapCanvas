import React from 'react'
import {
  Stack,
  Switch,
  TextInput,
  Textarea,
  NumberInput,
  Group,
  Button,
  Title,
  Text,
  SimpleGrid,
  Loader,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { ManagedImage } from '../domain/resource-runtime'
import {
  adminGetReferralConfig,
  adminUpdateReferralConfig,
  adminRegenerateReferralImage,
  type AdminReferralConfigDto,
} from '../api/server'

export default function ReferralCampaignAdmin(): React.ReactElement {
  const [config, setConfig] = React.useState<AdminReferralConfigDto | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [regenerating, setRegenerating] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setConfig(await adminGetReferralConfig())
    } catch (err) {
      notifications.show({ message: `加载失败：${(err as Error).message}`, color: 'red' })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  if (loading || !config) return <Loader />

  const update = (patch: Partial<AdminReferralConfigDto>) =>
    setConfig({ ...config, ...patch })

  const save = async () => {
    setSaving(true)
    try {
      const next = await adminUpdateReferralConfig(config)
      setConfig(next)
      notifications.show({ message: '已保存', color: 'green' })
    } catch (err) {
      notifications.show({ message: `保存失败：${(err as Error).message}`, color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const regenerate = async () => {
    setRegenerating(true)
    try {
      const next = await adminRegenerateReferralImage()
      setConfig(next)
      notifications.show({ message: '封面已重新生成', color: 'green' })
    } catch (err) {
      notifications.show({ message: `生图失败：${(err as Error).message}`, color: 'red' })
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <Stack gap="md">
      <Title order={4}>邀请活动配置</Title>

      <Switch
        label="开启活动"
        checked={!!config.enabled}
        onChange={(e) => update({ enabled: e.currentTarget.checked ? 1 : 0 })}
      />

      <TextInput
        label="标题"
        value={config.title}
        onChange={(e) => update({ title: e.currentTarget.value })}
      />
      <Textarea
        label="副文案"
        value={config.body}
        onChange={(e) => update({ body: e.currentTarget.value })}
        autosize
        minRows={2}
      />
      <TextInput
        label="CTA 按钮文字"
        value={config.cta_text}
        onChange={(e) => update({ cta_text: e.currentTarget.value })}
      />

      <Stack gap="xs">
        <Text fw={500} size="sm">活动封面</Text>
        <Text size="xs" c="dimmed">
          封面由系统统一调用 gpt-image-2（4K）生成并托管在 TOS，运营无需手动配置；如需更换风格，点击「重新生成封面」即可。
        </Text>
        {config.image_url ? (
          <ManagedImage
            className="referral-admin-current-image"
            src={config.image_url}
            alt="campaign"
            priority="visible"
            style={{ maxWidth: 360, borderRadius: 8 }}
          />
        ) : (
          <Text size="sm" c="dimmed">
            尚未生成封面 —— 开启活动后系统将自动生成；也可点击下方按钮立即生成。
          </Text>
        )}
        <Group>
          <Button onClick={regenerate} loading={regenerating} variant="light">
            重新生成封面
          </Button>
        </Group>
      </Stack>

      <SimpleGrid cols={2} spacing="md">
        <NumberInput
          label="受邀注册奖励（积分）"
          value={config.invitee_welcome_credits}
          onChange={(v) => update({ invitee_welcome_credits: Number(v) || 0 })}
        />
        <Switch
          label="启用防自邀检测"
          checked={!!config.anti_self_check}
          onChange={(e) => update({ anti_self_check: e.currentTarget.checked ? 1 : 0 })}
        />
        <NumberInput
          label="同 IP/设备去重窗口（天）"
          value={config.anti_self_window_days}
          onChange={(v) => update({ anti_self_window_days: Number(v) || 30 })}
        />
      </SimpleGrid>

      <Group justify="flex-end">
        <Button onClick={save} loading={saving}>保存</Button>
      </Group>
    </Stack>
  )
}
