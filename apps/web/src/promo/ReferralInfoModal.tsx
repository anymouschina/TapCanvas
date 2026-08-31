import React from 'react'
import { ActionIcon, Badge, Button, CopyButton, Group, Modal, Stack, Text, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconCopy, IconQrcode } from '@tabler/icons-react'
import { ManagedImage } from '../domain/resource-runtime'
import { useMyInviteCode } from './useMyInviteCode'
import { useReferralCampaign } from './useReferralCampaign'
import { useReferralStats } from './useReferralStats'
import InvitePosterModal from './InvitePosterModal'

type Props = {
  opened: boolean
  onClose: () => void
}

export default function ReferralInfoModal({ opened, onClose }: Props): React.ReactElement {
  const { data: campaign } = useReferralCampaign()
  const { data: my } = useMyInviteCode()
  const { data: stats } = useReferralStats()
  const [posterOpened, setPosterOpened] = React.useState(false)

  const ruleText = campaign
    ? `受邀好友注册后获得 ${campaign.inviteeWelcomeCredits} 积分`
    : ''

  const handleCopy = (copy: () => void, label: string) => {
    copy()
    notifications.show({ message: `${label}已复制`, color: 'green' })
  }

  return (
    <>
    <Modal opened={opened} onClose={onClose} centered size="md" radius="md" title="我的邀请">
      <Stack gap="md">
        {campaign?.imageUrl ? (
          <ManagedImage
            className="referral-info-modal-image"
            src={campaign.imageUrl}
            alt={campaign.title}
            priority="visible"
            style={{ width: '100%', borderRadius: 8 }}
          />
        ) : null}
        {campaign && !campaign.enabled ? (
          <Badge color="gray" variant="light">活动暂停中（仍可分享，恢复后即可结算）</Badge>
        ) : null}
        {!my ? (
          <Text size="sm" c="dimmed">加载中…</Text>
        ) : (
          <>
            <Group gap={8} wrap="nowrap">
              <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>邀请码</Text>
              <Text fw={600}>{my.inviteCode}</Text>
              <CopyButton value={my.inviteCode}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? '已复制' : '复制'}>
                    <ActionIcon variant="subtle" onClick={() => handleCopy(copy, '邀请码')}>
                      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
            <Group gap={8} wrap="nowrap" align="flex-start">
              <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>邀请链接</Text>
              <Text size="sm" style={{ flex: 1, wordBreak: 'break-all' }}>{my.inviteUrl}</Text>
              <CopyButton value={my.inviteUrl}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? '已复制' : '复制'}>
                    <ActionIcon variant="subtle" onClick={() => handleCopy(copy, '邀请链接')}>
                      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
            <Group gap={8} grow>
              <CopyButton value={my.inviteUrl}>
                {({ copy }) => (
                  <Button onClick={() => handleCopy(copy, '邀请链接')}>
                    复制邀请链接
                  </Button>
                )}
              </CopyButton>
              <Button
                variant="light"
                leftSection={<IconQrcode size={14} />}
                onClick={() => setPosterOpened(true)}
              >
                邀请海报
              </Button>
            </Group>
          </>
        )}
        {stats ? (
          <Group gap="lg">
            <Group gap={6}>
              <Text size="sm" c="dimmed">已邀请人数</Text>
              <Text fw={600}>{stats.inviteeCount}</Text>
            </Group>
            <Group gap={6}>
              <Text size="sm" c="dimmed">累计奖励</Text>
              <Text fw={600}>{stats.totalGrantedCredits}</Text>
            </Group>
          </Group>
        ) : null}
        {ruleText ? <Text size="xs" c="dimmed">{ruleText}</Text> : null}
      </Stack>
    </Modal>
    {my?.inviteUrl ? (
      <InvitePosterModal
        opened={posterOpened}
        onClose={() => setPosterOpened(false)}
        inviteUrl={my.inviteUrl}
      />
    ) : null}
    </>
  )
}
