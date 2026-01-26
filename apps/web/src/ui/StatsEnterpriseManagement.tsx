import React from 'react'
import { ActionIcon, Badge, Button, CopyButton, Divider, Group, Loader, Modal, NumberInput, Paper, Select, Stack, Table, Text, TextInput, Tooltip, Title } from '@mantine/core'
import { IconCheck, IconCopy, IconPlus, IconRefresh, IconSettings } from '@tabler/icons-react'
import { addTeamMember, createTeam, createTeamInvite, listTeamInvites, listTeamMembers, listTeams, topUpTeamCredits, type TeamInviteDto, type TeamListItemDto, type TeamMemberDto, type TeamRole } from '../api/server'
import { toast } from './toast'
import StatsPlanManagement from './StatsPlanManagement'

function formatCredits(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
  return String(Math.round(value))
}

export default function StatsEnterpriseManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-enterprise', className].filter(Boolean).join(' ')

  const [teams, setTeams] = React.useState<TeamListItemDto[]>([])
  const [teamsLoading, setTeamsLoading] = React.useState(false)

  const [createName, setCreateName] = React.useState('')
  const [createOwnerLogin, setCreateOwnerLogin] = React.useState('')
  const [createSubmitting, setCreateSubmitting] = React.useState(false)

  const [manageOpen, setManageOpen] = React.useState(false)
  const [manageTeam, setManageTeam] = React.useState<TeamListItemDto | null>(null)

  const [members, setMembers] = React.useState<TeamMemberDto[]>([])
  const [membersLoading, setMembersLoading] = React.useState(false)

  const [invites, setInvites] = React.useState<TeamInviteDto[]>([])
  const [invitesLoading, setInvitesLoading] = React.useState(false)

  const [addLogin, setAddLogin] = React.useState('')
  const [addRole, setAddRole] = React.useState<TeamRole>('member')
  const [addSubmitting, setAddSubmitting] = React.useState(false)

  const [topupAmount, setTopupAmount] = React.useState<number | ''>(100)
  const [topupNote, setTopupNote] = React.useState('')
  const [topupSubmitting, setTopupSubmitting] = React.useState(false)

  const [inviteLogin, setInviteLogin] = React.useState('')
  const [inviteEmail, setInviteEmail] = React.useState('')
  const [inviteExpiresDays, setInviteExpiresDays] = React.useState<number | ''>(7)
  const [inviteSubmitting, setInviteSubmitting] = React.useState(false)

  const reloadTeams = React.useCallback(async () => {
    setTeamsLoading(true)
    try {
      const data = await listTeams()
      setTeams(Array.isArray(data) ? data : [])
    } catch (err: any) {
      console.error('list teams failed', err)
      setTeams([])
      toast(err?.message || '加载团队列表失败', 'error')
    } finally {
      setTeamsLoading(false)
    }
  }, [])

  const reloadMembersAndInvites = React.useCallback(async (teamId: string) => {
    setMembersLoading(true)
    setInvitesLoading(true)
    try {
      const [m, i] = await Promise.allSettled([
        listTeamMembers(teamId),
        listTeamInvites(teamId),
      ])

      if (m.status === 'fulfilled') {
        setMembers(Array.isArray(m.value) ? m.value : [])
      } else {
        setMembers([])
        toast((m.reason as any)?.message || '加载成员失败', 'error')
      }

      if (i.status === 'fulfilled') {
        setInvites(Array.isArray(i.value) ? i.value : [])
      } else {
        setInvites([])
        toast((i.reason as any)?.message || '加载邀请码失败', 'error')
      }
    } finally {
      setMembersLoading(false)
      setInvitesLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reloadTeams()
  }, [reloadTeams])

  const openManage = React.useCallback((team: TeamListItemDto) => {
    setManageTeam(team)
    setManageOpen(true)
    void reloadMembersAndInvites(team.id)
  }, [reloadMembersAndInvites])

  const submitCreate = React.useCallback(async () => {
    const name = createName.trim()
    if (!name) {
      toast('请输入团队名称', 'error')
      return
    }
    setCreateSubmitting(true)
    try {
      const ownerLogin = createOwnerLogin.trim()
      await createTeam(ownerLogin ? { name, ownerLogin } : { name })
      toast('团队创建成功', 'success')
      setCreateName('')
      setCreateOwnerLogin('')
      await reloadTeams()
    } catch (err: any) {
      console.error('create team failed', err)
      toast(err?.message || '创建团队失败', 'error')
    } finally {
      setCreateSubmitting(false)
    }
  }, [createName, createOwnerLogin, reloadTeams])

  const submitAddMember = React.useCallback(async () => {
    const teamId = manageTeam?.id
    if (!teamId) return
    const login = addLogin.trim()
    if (!login) {
      toast('请输入成员 GitHub 登录名', 'error')
      return
    }
    setAddSubmitting(true)
    try {
      await addTeamMember(teamId, { login, role: addRole })
      toast('成员已加入团队', 'success')
      setAddLogin('')
      setAddRole('member')
      await reloadMembersAndInvites(teamId)
      await reloadTeams()
    } catch (err: any) {
      console.error('add team member failed', err)
      toast(err?.message || '添加成员失败', 'error')
    } finally {
      setAddSubmitting(false)
    }
  }, [addLogin, addRole, manageTeam?.id, reloadMembersAndInvites, reloadTeams])

  const submitTopup = React.useCallback(async () => {
    const teamId = manageTeam?.id
    if (!teamId) return
    const amount = typeof topupAmount === 'number' ? Math.floor(topupAmount) : NaN
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('请输入有效充值金额', 'error')
      return
    }
    setTopupSubmitting(true)
    try {
      await topUpTeamCredits(teamId, { amount, note: topupNote.trim() || undefined })
      toast('充值成功', 'success')
      setTopupNote('')
      setTopupAmount(100)
      await reloadTeams()
      await reloadMembersAndInvites(teamId)
    } catch (err: any) {
      console.error('top up failed', err)
      toast(err?.message || '充值失败', 'error')
    } finally {
      setTopupSubmitting(false)
    }
  }, [manageTeam?.id, reloadMembersAndInvites, reloadTeams, topupAmount, topupNote])

  const submitCreateInvite = React.useCallback(async () => {
    const teamId = manageTeam?.id
    if (!teamId) return
    const login = inviteLogin.trim()
    const email = inviteEmail.trim()
    if (!login && !email) {
      toast('请输入登录名或邮箱（至少一个）', 'error')
      return
    }
    const expiresInDays = typeof inviteExpiresDays === 'number' ? Math.floor(inviteExpiresDays) : undefined
    setInviteSubmitting(true)
    try {
      await createTeamInvite(teamId, {
        ...(login ? { login } : {}),
        ...(email ? { email } : {}),
        ...(expiresInDays && Number.isFinite(expiresInDays) ? { expiresInDays } : {}),
      })
      toast('邀请码已生成', 'success')
      setInviteLogin('')
      setInviteEmail('')
      setInviteExpiresDays(7)
      await reloadMembersAndInvites(teamId)
    } catch (err: any) {
      console.error('create invite failed', err)
      toast(err?.message || '生成邀请码失败', 'error')
    } finally {
      setInviteSubmitting(false)
    }
  }, [inviteEmail, inviteExpiresDays, inviteLogin, manageTeam?.id, reloadMembersAndInvites])

  return (
    <Stack className={rootClassName} gap="md">
      <StatsPlanManagement className="stats-enterprise-plan-management" />
      <Paper className="stats-enterprise-card glass" withBorder radius="lg" p="md">
        <Group className="stats-enterprise-card-header" justify="space-between" align="flex-start" gap="md" wrap="wrap">
          <div className="stats-enterprise-card-header-left">
            <Title className="stats-enterprise-title" order={3}>企业管理</Title>
            <Text className="stats-enterprise-subtitle" size="sm" c="dimmed">
              创建团队、邀请成员、为团队充值积分；团队成员在图片/视频生成成功后扣减积分，积分不足将无法发起生成。
            </Text>
          </div>
          <Group className="stats-enterprise-card-header-actions" gap={6}>
            <Tooltip className="stats-enterprise-reload-tooltip" label="刷新" withArrow>
              <ActionIcon
                className="stats-enterprise-reload"
                size="sm"
                variant="subtle"
                aria-label="刷新"
                onClick={() => void reloadTeams()}
                loading={teamsLoading}
              >
                <IconRefresh className="stats-enterprise-reload-icon" size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <Divider className="stats-enterprise-divider" my="md" label="创建团队" labelPosition="left" />
        <Group className="stats-enterprise-create" gap="sm" align="flex-end" wrap="wrap">
          <TextInput
            className="stats-enterprise-create-name"
            label="团队名称"
            placeholder="例如：XX 科技"
            value={createName}
            onChange={(e) => setCreateName(e.currentTarget.value)}
            maw={320}
          />
          <TextInput
            className="stats-enterprise-create-owner"
            label="负责人 GitHub 登录名（可选）"
            placeholder="owner_login"
            value={createOwnerLogin}
            onChange={(e) => setCreateOwnerLogin(e.currentTarget.value)}
            maw={260}
          />
          <Button
            className="stats-enterprise-create-submit"
            leftSection={<IconPlus className="stats-enterprise-create-submit-icon" size={16} />}
            onClick={() => void submitCreate()}
            loading={createSubmitting}
          >
            创建
          </Button>
        </Group>

        <Divider className="stats-enterprise-divider" my="md" label="团队列表" labelPosition="left" />
        {teamsLoading && !teams.length ? (
          <Group className="stats-enterprise-loading" gap="xs" align="center">
            <Loader className="stats-enterprise-loading-icon" size="sm" />
            <Text className="stats-enterprise-loading-text" size="sm" c="dimmed">
              加载中…
            </Text>
          </Group>
        ) : !teams.length ? (
          <Text className="stats-enterprise-empty" size="sm" c="dimmed">
            暂无团队
          </Text>
        ) : (
          <Table className="stats-enterprise-table" striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead className="stats-enterprise-table-head">
              <Table.Tr className="stats-enterprise-table-head-row">
                <Table.Th className="stats-enterprise-table-head-cell">团队</Table.Th>
                <Table.Th className="stats-enterprise-table-head-cell">积分</Table.Th>
                <Table.Th className="stats-enterprise-table-head-cell">成员</Table.Th>
                <Table.Th className="stats-enterprise-table-head-cell">ID</Table.Th>
                <Table.Th className="stats-enterprise-table-head-cell">操作</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody className="stats-enterprise-table-body">
              {teams.map((t) => (
                <Table.Tr className="stats-enterprise-table-row" key={t.id}>
                  <Table.Td className="stats-enterprise-table-cell">
                    <Text className="stats-enterprise-team-name" size="sm" fw={600}>{t.name}</Text>
                  </Table.Td>
                  <Table.Td className="stats-enterprise-table-cell">
                    <Badge className="stats-enterprise-team-credits" variant="light" color={t.credits > 0 ? 'grape' : 'gray'}>
                      {formatCredits(t.credits)}
                    </Badge>
                  </Table.Td>
                  <Table.Td className="stats-enterprise-table-cell">
                    <Text className="stats-enterprise-team-members" size="sm">{t.memberCount}</Text>
                  </Table.Td>
                  <Table.Td className="stats-enterprise-table-cell">
                    <Text className="stats-enterprise-team-id" size="xs" c="dimmed">
                      {t.id.slice(0, 8)}…
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-enterprise-table-cell">
                    <Button
                      className="stats-enterprise-team-manage"
                      size="xs"
                      variant="light"
                      leftSection={<IconSettings className="stats-enterprise-team-manage-icon" size={14} />}
                      onClick={() => openManage(t)}
                    >
                      管理
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>

      <Modal
        className="stats-enterprise-manage-modal"
        opened={manageOpen}
        onClose={() => setManageOpen(false)}
        title={manageTeam ? `团队管理：${manageTeam.name}` : '团队管理'}
        size="lg"
        radius="lg"
        centered
      >
        <Stack className="stats-enterprise-manage" gap="md">
          {!manageTeam ? (
            <Text className="stats-enterprise-manage-empty" size="sm" c="dimmed">
              未选择团队
            </Text>
          ) : (
            <>
              <Group className="stats-enterprise-manage-meta" gap="xs" wrap="wrap">
                <Badge className="stats-enterprise-manage-meta-badge" variant="light" color="gray">ID</Badge>
                <Text className="stats-enterprise-manage-meta-id" size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>{manageTeam.id}</Text>
                <Badge className="stats-enterprise-manage-meta-badge" variant="light" color="grape">积分</Badge>
                <Text className="stats-enterprise-manage-meta-credits" size="sm" fw={600}>{formatCredits(manageTeam.credits)}</Text>
              </Group>

              <Divider className="stats-enterprise-manage-divider" label="充值积分（仅管理员）" labelPosition="left" />
              <Group className="stats-enterprise-topup" gap="sm" align="flex-end" wrap="wrap">
                <NumberInput
                  className="stats-enterprise-topup-amount"
                  label="充值数量"
                  value={topupAmount}
                  onChange={setTopupAmount}
                  min={1}
                  step={10}
                  maw={180}
                />
                <TextInput
                  className="stats-enterprise-topup-note"
                  label="备注（可选）"
                  placeholder="例如：月度充值"
                  value={topupNote}
                  onChange={(e) => setTopupNote(e.currentTarget.value)}
                  maw={320}
                />
                <Button
                  className="stats-enterprise-topup-submit"
                  onClick={() => void submitTopup()}
                  loading={topupSubmitting}
                >
                  充值
                </Button>
              </Group>

              <Divider className="stats-enterprise-manage-divider" label="邀请/添加成员" labelPosition="left" />
              <Group className="stats-enterprise-add-member" gap="sm" align="flex-end" wrap="wrap">
                <TextInput
                  className="stats-enterprise-add-member-login"
                  label="GitHub 登录名"
                  placeholder="member_login"
                  value={addLogin}
                  onChange={(e) => setAddLogin(e.currentTarget.value)}
                  maw={240}
                />
                <Select
                  className="stats-enterprise-add-member-role"
                  label="角色"
                  value={addRole}
                  onChange={(v) => setAddRole((v as TeamRole) || 'member')}
                  data={[
                    { value: 'member', label: '成员' },
                    { value: 'admin', label: '管理员' },
                    { value: 'owner', label: 'Owner' },
                  ]}
                  maw={180}
                />
                <Button
                  className="stats-enterprise-add-member-submit"
                  onClick={() => void submitAddMember()}
                  loading={addSubmitting}
                >
                  添加
                </Button>
              </Group>

              <Divider className="stats-enterprise-manage-divider" label="生成邀请码（成员自助加入）" labelPosition="left" />
              <Group className="stats-enterprise-invite" gap="sm" align="flex-end" wrap="wrap">
                <TextInput
                  className="stats-enterprise-invite-login"
                  label="限制登录名（可选）"
                  placeholder="仅允许该登录名使用"
                  value={inviteLogin}
                  onChange={(e) => setInviteLogin(e.currentTarget.value)}
                  maw={220}
                />
                <TextInput
                  className="stats-enterprise-invite-email"
                  label="限制邮箱（可选）"
                  placeholder="仅允许该邮箱使用"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.currentTarget.value)}
                  maw={260}
                />
                <NumberInput
                  className="stats-enterprise-invite-expire"
                  label="有效期（天）"
                  value={inviteExpiresDays}
                  onChange={setInviteExpiresDays}
                  min={1}
                  max={30}
                  maw={140}
                />
                <Button
                  className="stats-enterprise-invite-submit"
                  onClick={() => void submitCreateInvite()}
                  loading={inviteSubmitting}
                >
                  生成
                </Button>
              </Group>

              <Stack className="stats-enterprise-manage-lists" gap="md">
                <Stack className="stats-enterprise-members" gap="xs">
                  <Group className="stats-enterprise-members-header" justify="space-between" align="center">
                    <Text className="stats-enterprise-members-title" size="sm" fw={600}>成员</Text>
                    <Button
                      className="stats-enterprise-members-refresh"
                      size="xs"
                      variant="subtle"
                      onClick={() => void reloadMembersAndInvites(manageTeam.id)}
                      loading={membersLoading || invitesLoading}
                    >
                      刷新
                    </Button>
                  </Group>

                  {membersLoading && !members.length ? (
                    <Group className="stats-enterprise-members-loading" gap="xs" align="center">
                      <Loader className="stats-enterprise-members-loading-icon" size="sm" />
                      <Text className="stats-enterprise-members-loading-text" size="sm" c="dimmed">加载中…</Text>
                    </Group>
                  ) : !members.length ? (
                    <Text className="stats-enterprise-members-empty" size="sm" c="dimmed">暂无成员</Text>
                  ) : (
                    <Table className="stats-enterprise-members-table" striped highlightOnHover withTableBorder withColumnBorders>
                      <Table.Thead className="stats-enterprise-members-table-head">
                        <Table.Tr className="stats-enterprise-members-table-head-row">
                          <Table.Th className="stats-enterprise-members-table-head-cell">登录名</Table.Th>
                          <Table.Th className="stats-enterprise-members-table-head-cell">角色</Table.Th>
                          <Table.Th className="stats-enterprise-members-table-head-cell">用户</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody className="stats-enterprise-members-table-body">
                        {members.map((m) => (
                          <Table.Tr className="stats-enterprise-members-table-row" key={m.userId}>
                            <Table.Td className="stats-enterprise-members-table-cell">
                              <Text className="stats-enterprise-member-login" size="sm" fw={600}>{m.login}</Text>
                            </Table.Td>
                            <Table.Td className="stats-enterprise-members-table-cell">
                              <Badge className="stats-enterprise-member-role" variant="light" color={m.role === 'owner' ? 'blue' : m.role === 'admin' ? 'teal' : 'gray'}>
                                {m.role}
                              </Badge>
                            </Table.Td>
                            <Table.Td className="stats-enterprise-members-table-cell">
                              <Text className="stats-enterprise-member-id" size="xs" c="dimmed">
                                {m.userId.slice(0, 8)}…
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Stack>

                <Stack className="stats-enterprise-invites" gap="xs">
                  <Text className="stats-enterprise-invites-title" size="sm" fw={600}>邀请码</Text>
                  {invitesLoading && !invites.length ? (
                    <Group className="stats-enterprise-invites-loading" gap="xs" align="center">
                      <Loader className="stats-enterprise-invites-loading-icon" size="sm" />
                      <Text className="stats-enterprise-invites-loading-text" size="sm" c="dimmed">加载中…</Text>
                    </Group>
                  ) : !invites.length ? (
                    <Text className="stats-enterprise-invites-empty" size="sm" c="dimmed">暂无邀请码</Text>
                  ) : (
                    <Table className="stats-enterprise-invites-table" striped highlightOnHover withTableBorder withColumnBorders>
                      <Table.Thead className="stats-enterprise-invites-table-head">
                        <Table.Tr className="stats-enterprise-invites-table-head-row">
                          <Table.Th className="stats-enterprise-invites-table-head-cell">邀请码</Table.Th>
                          <Table.Th className="stats-enterprise-invites-table-head-cell">限制</Table.Th>
                          <Table.Th className="stats-enterprise-invites-table-head-cell">状态</Table.Th>
                          <Table.Th className="stats-enterprise-invites-table-head-cell">复制</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody className="stats-enterprise-invites-table-body">
                        {invites.map((it) => (
                          <Table.Tr className="stats-enterprise-invites-table-row" key={it.id}>
                            <Table.Td className="stats-enterprise-invites-table-cell">
                              <Text className="stats-enterprise-invite-code" size="xs" style={{ wordBreak: 'break-all' }}>{it.code}</Text>
                            </Table.Td>
                            <Table.Td className="stats-enterprise-invites-table-cell">
                              <Text className="stats-enterprise-invite-limit" size="xs" c="dimmed">
                                {(it.login ? `@${it.login}` : '') || (it.email || '—')}
                              </Text>
                            </Table.Td>
                            <Table.Td className="stats-enterprise-invites-table-cell">
                              <Badge className="stats-enterprise-invite-status" variant="light" color={it.status === 'pending' ? 'blue' : it.status === 'accepted' ? 'green' : 'gray'}>
                                {it.status}
                              </Badge>
                            </Table.Td>
                            <Table.Td className="stats-enterprise-invites-table-cell">
                              <CopyButton value={it.code} timeout={1200}>
                                {({ copied, copy }) => (
                                  <Tooltip className="stats-enterprise-invite-copy-tooltip" label={copied ? '已复制' : '复制'} withArrow>
                                    <ActionIcon className="stats-enterprise-invite-copy" variant="light" onClick={copy} aria-label="copy-invite">
                                      {copied ? <IconCheck className="stats-enterprise-invite-copy-icon" size={16} /> : <IconCopy className="stats-enterprise-invite-copy-icon" size={16} />}
                                    </ActionIcon>
                                  </Tooltip>
                                )}
                              </CopyButton>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Stack>
              </Stack>
            </>
          )}
        </Stack>
      </Modal>
    </Stack>
  )
}
