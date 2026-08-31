import React from 'react'
import { ActionIcon, Badge, Button, CopyButton, Divider, Group, Loader, Modal, NumberInput, Select, Stack, Table, Text, TextInput, Tooltip, Title } from '@mantine/core'
import { IconCheck, IconCopy, IconCrown, IconPlus, IconRefresh, IconSettings } from '@tabler/icons-react'
import { addTeamMember, createTeam, createTeamInvite, listTeamCreditLedger, listTeamInvites, listTeamMembers, listTeams, topUpTeamCredits, type TeamCreditLedgerEntryDto, type TeamInviteDto, type TeamListItemDto, type TeamMemberDto, type TeamRole } from '../../../api/server'
import { PanelCard } from '../../PanelCard'
import { toast } from '../../toast'
import StatsTeamPlansManagement from '../commerce/StatsTeamPlansManagement'

function formatCredits(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
  return String(Math.round(value))
}

function formatTime(value: string): string {
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return value
  return new Date(t).toLocaleString()
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

function describeLedgerEntryType(entryType: TeamCreditLedgerEntryDto['entryType']): { label: string; color: string } {
  if (entryType === 'topup') return { label: '管理员分配', color: 'green' }
  if (entryType === 'reserve') return { label: '冻结', color: 'yellow' }
  if (entryType === 'release') return { label: '解冻', color: 'gray' }
  if (entryType === 'referral_bonus') return { label: '邀请返佣', color: 'green' }
  if (entryType === 'referral_welcome') return { label: '邀请注册赠送', color: 'green' }
  return { label: '扣减', color: 'red' }
}

function formatLedgerAmount(entry: TeamCreditLedgerEntryDto): string {
  const amount = formatCredits(entry.amount)
  if (entry.entryType === 'topup' || entry.entryType === 'release' || entry.entryType === 'referral_bonus' || entry.entryType === 'referral_welcome') return `+${amount}`
  return `-${amount}`
}

export default function StatsTeamManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-team', className].filter(Boolean).join(' ')

  const [teams, setTeams] = React.useState<TeamListItemDto[]>([])
  const [teamsLoading, setTeamsLoading] = React.useState(false)

  const [createName, setCreateName] = React.useState('')
  const [createOwnerLogin, setCreateOwnerLogin] = React.useState('')
  const [createSubmitting, setCreateSubmitting] = React.useState(false)

  const [manageOpen, setManageOpen] = React.useState(false)
  const [manageTeam, setManageTeam] = React.useState<TeamListItemDto | null>(null)
  const [activationTeam, setActivationTeam] = React.useState<TeamListItemDto | null>(null)

  const [members, setMembers] = React.useState<TeamMemberDto[]>([])
  const [membersLoading, setMembersLoading] = React.useState(false)

  const [invites, setInvites] = React.useState<TeamInviteDto[]>([])
  const [invitesLoading, setInvitesLoading] = React.useState(false)

  const [ledger, setLedger] = React.useState<TeamCreditLedgerEntryDto[]>([])
  const [ledgerLoading, setLedgerLoading] = React.useState(false)

  const [addLogin, setAddLogin] = React.useState('')
  const [addRole, setAddRole] = React.useState<TeamRole>('member')
  const [addSubmitting, setAddSubmitting] = React.useState(false)

  const [topupAmount, setTopupAmount] = React.useState<number | ''>(100)
  const [topupNote, setTopupNote] = React.useState('')
  const [topupSubmitting, setTopupSubmitting] = React.useState(false)

  const [inviteLogin, setInviteLogin] = React.useState('')
  const [inviteEmail, setInviteEmail] = React.useState('')
  const [invitePhone, setInvitePhone] = React.useState('')
  const [inviteExpiresDays, setInviteExpiresDays] = React.useState<number | ''>(7)
  const [inviteSubmitting, setInviteSubmitting] = React.useState(false)

  const reloadTeams = React.useCallback(async () => {
    setTeamsLoading(true)
    try {
      const data = await listTeams()
      setTeams(Array.isArray(data) ? data.filter((team) => !team.personal) : [])
    } catch (error: unknown) {
      console.error('list teams failed', error)
      setTeams([])
      toast(errorMessage(error, '加载团队列表失败'), 'error')
    } finally {
      setTeamsLoading(false)
    }
  }, [])

  const reloadManageData = React.useCallback(async (teamId: string) => {
    setMembersLoading(true)
    setInvitesLoading(true)
    setLedgerLoading(true)
    try {
      const [m, i, l] = await Promise.allSettled([
        listTeamMembers(teamId),
        listTeamInvites(teamId),
        listTeamCreditLedger(teamId),
      ])

      if (m.status === 'fulfilled') {
        setMembers(Array.isArray(m.value) ? m.value : [])
      } else {
        setMembers([])
        toast(errorMessage(m.reason, '加载协作席位失败'), 'error')
      }

      if (i.status === 'fulfilled') {
        setInvites(Array.isArray(i.value) ? i.value : [])
      } else {
        setInvites([])
        toast(errorMessage(i.reason, '加载邀请码失败'), 'error')
      }

      if (l.status === 'fulfilled') {
        setLedger(Array.isArray(l.value?.items) ? l.value.items : [])
      } else {
        setLedger([])
        toast(errorMessage(l.reason, '加载积分流水失败'), 'error')
      }
    } finally {
      setMembersLoading(false)
      setInvitesLoading(false)
      setLedgerLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reloadTeams()
  }, [reloadTeams])

  const openManage = React.useCallback((team: TeamListItemDto) => {
    setManageTeam(team)
    setManageOpen(true)
    void reloadManageData(team.id)
  }, [reloadManageData])

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
    } catch (error: unknown) {
      console.error('create team failed', error)
      toast(errorMessage(error, '创建团队失败'), 'error')
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
      await reloadManageData(teamId)
      await reloadTeams()
    } catch (error: unknown) {
      console.error('add team member failed', error)
      toast(errorMessage(error, '添加协作席位失败'), 'error')
    } finally {
      setAddSubmitting(false)
    }
  }, [addLogin, addRole, manageTeam?.id, reloadManageData, reloadTeams])

  const submitTopup = React.useCallback(async () => {
    const teamId = manageTeam?.id
    if (!teamId) return
    const amount = typeof topupAmount === 'number' ? Math.floor(topupAmount) : NaN
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('请输入有效额度', 'error')
      return
    }
    setTopupSubmitting(true)
    try {
      await topUpTeamCredits(teamId, { amount, note: topupNote.trim() || undefined })
      toast('额度分配成功', 'success')
      setTopupNote('')
      setTopupAmount(100)
      await reloadTeams()
      await reloadManageData(teamId)
    } catch (error: unknown) {
      console.error('top up failed', error)
      toast(errorMessage(error, '额度分配失败'), 'error')
    } finally {
      setTopupSubmitting(false)
    }
  }, [manageTeam?.id, reloadManageData, reloadTeams, topupAmount, topupNote])

  const submitCreateInvite = React.useCallback(async () => {
    const teamId = manageTeam?.id
    if (!teamId) return
    const login = inviteLogin.trim()
    const email = inviteEmail.trim()
    const phone = invitePhone.trim()
    if (!login && !email && !phone) {
      toast('请输入登录名/邮箱/手机号（至少一个）', 'error')
      return
    }
    const expiresInDays = typeof inviteExpiresDays === 'number' ? Math.floor(inviteExpiresDays) : undefined
    setInviteSubmitting(true)
    try {
      await createTeamInvite(teamId, {
        ...(login ? { login } : {}),
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(expiresInDays && Number.isFinite(expiresInDays) ? { expiresInDays } : {}),
      })
      toast('邀请码已生成', 'success')
      setInviteLogin('')
      setInviteEmail('')
      setInvitePhone('')
      setInviteExpiresDays(7)
      await reloadManageData(teamId)
    } catch (error: unknown) {
      console.error('create invite failed', error)
      toast(errorMessage(error, '生成邀请码失败'), 'error')
    } finally {
      setInviteSubmitting(false)
    }
  }, [inviteEmail, inviteExpiresDays, inviteLogin, invitePhone, manageTeam?.id, reloadManageData])

  return (
    <Stack className={rootClassName} gap="md">
      <PanelCard className="stats-team-card glass">
        <Group className="stats-team-card-header" justify="space-between" align="flex-start" gap="md" wrap="wrap">
          <div className="stats-team-card-header-left">
            <Title className="stats-team-title" order={3}>团队管理</Title>
            <Text className="stats-team-subtitle" size="sm" c="dimmed">
              团队是多人共用的共享账号，协作成员占用席位并共享团队积分、项目与资产。
            </Text>
          </div>
          <Group className="stats-team-card-header-actions" gap={6}>
            <Tooltip className="stats-team-reload-tooltip" label="刷新" withArrow>
              <ActionIcon
                className="stats-team-reload"
                size="sm"
                variant="subtle"
                aria-label="刷新"
                onClick={() => void reloadTeams()}
                loading={teamsLoading}
              >
                <IconRefresh className="stats-team-reload-icon" size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <Divider className="stats-team-divider" my="md" label="创建团队" labelPosition="left" />
        <Group className="stats-team-create" gap="sm" align="flex-end" wrap="wrap">
          <TextInput
            className="stats-team-create-name"
            label="团队名称"
            placeholder="例如：XX 科技"
            value={createName}
            onChange={(e) => setCreateName(e.currentTarget.value)}
            maw={320}
          />
          <TextInput
            className="stats-team-create-owner"
            label="负责人 GitHub 登录名（可选）"
            placeholder="owner_login"
            value={createOwnerLogin}
            onChange={(e) => setCreateOwnerLogin(e.currentTarget.value)}
            maw={260}
          />
          <Button
            className="stats-team-create-submit"
            leftSection={<IconPlus className="stats-team-create-submit-icon" size={16} />}
            onClick={() => void submitCreate()}
            loading={createSubmitting}
          >
            创建
          </Button>
        </Group>

        <Divider className="stats-team-divider" my="md" label="团队列表" labelPosition="left" />
        {teamsLoading && !teams.length ? (
          <Group className="stats-team-loading" gap="xs" align="center">
            <Loader className="stats-team-loading-icon" size="sm" />
            <Text className="stats-team-loading-text" size="sm" c="dimmed">
              加载中…
            </Text>
          </Group>
        ) : !teams.length ? (
          <Text className="stats-team-empty" size="sm" c="dimmed">
            暂无团队
          </Text>
        ) : (
          <Table className="stats-team-table" striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead className="stats-team-table-head">
              <Table.Tr className="stats-team-table-head-row">
                <Table.Th className="stats-team-table-head-cell">团队</Table.Th>
                <Table.Th className="stats-team-table-head-cell">积分</Table.Th>
                <Table.Th className="stats-team-table-head-cell">协作席位</Table.Th>
                <Table.Th className="stats-team-table-head-cell">ID</Table.Th>
                <Table.Th className="stats-team-table-head-cell">操作</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody className="stats-team-table-body">
              {teams.map((t) => (
                <Table.Tr className="stats-team-table-row" key={t.id}>
                  <Table.Td className="stats-team-table-cell">
                    <Text className="stats-team-team-name" size="sm" fw={600}>{t.name}</Text>
                  </Table.Td>
                  <Table.Td className="stats-team-table-cell">
                    <Group className="stats-team-team-credits" gap={6} wrap="wrap">
                      <Badge
                        className="stats-team-team-credits-available"
                        variant="light"
                        color={t.creditsAvailable > 0 ? 'grape' : 'gray'}
                      >
                        可用 {formatCredits(t.creditsAvailable)}
                      </Badge>
                      {t.creditsFrozen > 0 ? (
                        <Badge className="stats-team-team-credits-frozen" variant="light" color="yellow">
                          冻结 {formatCredits(t.creditsFrozen)}
                        </Badge>
                      ) : null}
                      <Badge className="stats-team-team-credits-total" variant="light" color="gray">
                        总 {formatCredits(t.credits)}
                      </Badge>
                    </Group>
                  </Table.Td>
                  <Table.Td className="stats-team-table-cell">
                    <Text className="stats-team-team-members" size="sm">{t.memberCount}/{t.maxMembers}</Text>
                  </Table.Td>
                  <Table.Td className="stats-team-table-cell">
                    <Text className="stats-team-team-id" size="xs" c="dimmed">
                      {t.id.slice(0, 8)}…
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-team-table-cell">
                    <Group className="stats-team-team-actions" gap={6} wrap="nowrap">
                      <Button
                        className="stats-team-team-manage"
                        size="xs"
                        variant="light"
                        leftSection={<IconSettings className="stats-team-team-manage-icon" size={14} />}
                        onClick={() => openManage(t)}
                      >
                        管理
                      </Button>
                      <Button
                        className="stats-team-team-activate-plan"
                        size="xs"
                        variant="subtle"
                        leftSection={<IconCrown className="stats-team-team-activate-plan-icon" size={14} />}
                        onClick={() => setActivationTeam(t)}
                      >
                        套餐
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </PanelCard>

      <StatsTeamPlansManagement
        activationTeam={activationTeam}
        className="stats-team-plans-management"
        onActivationClose={() => setActivationTeam(null)}
        onTeamActivated={reloadTeams}
        teams={teams}
      />

      <Modal
        className="stats-team-manage-modal"
        opened={manageOpen}
        onClose={() => setManageOpen(false)}
        title={manageTeam ? `团队管理：${manageTeam.name}` : '团队管理'}
        size="lg"
        radius="md"
        centered
        lockScroll={false}
      >
        <Stack className="stats-team-manage" gap="md">
          {!manageTeam ? (
            <Text className="stats-team-manage-empty" size="sm" c="dimmed">
              未选择团队
            </Text>
          ) : (
            <>
              <Group className="stats-team-manage-meta" gap="xs" wrap="wrap">
                <Badge className="stats-team-manage-meta-badge" variant="light" color="gray">ID</Badge>
                <Text className="stats-team-manage-meta-id" size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>{manageTeam.id}</Text>
                <Badge className="stats-team-manage-meta-badge" variant="light" color="gray">可用</Badge>
                <Text className="stats-team-manage-meta-credits-available" size="sm" fw={600}>{formatCredits(manageTeam.creditsAvailable)}</Text>
                <Badge className="stats-team-manage-meta-badge" variant="light" color="yellow">冻结</Badge>
                <Text className="stats-team-manage-meta-credits-frozen" size="sm" fw={600}>{formatCredits(manageTeam.creditsFrozen)}</Text>
                <Badge className="stats-team-manage-meta-badge" variant="light" color="gray">总额</Badge>
                <Text className="stats-team-manage-meta-credits-total" size="sm" fw={600}>{formatCredits(manageTeam.credits)}</Text>
              </Group>

              <Divider className="stats-team-manage-divider" label="分配额度（仅管理员）" labelPosition="left" />
              <Group className="stats-team-topup" gap="sm" align="flex-end" wrap="wrap">
                <NumberInput
                  className="stats-team-topup-amount"
                  label="额度数量"
                  value={topupAmount}
                  onChange={(value) => setTopupAmount(typeof value === 'number' && Number.isFinite(value) ? value : '')}
                  min={1}
                  step={10}
                  maw={180}
                />
                <TextInput
                  className="stats-team-topup-note"
                  label="备注（可选）"
                  placeholder="例如：月度额度分配"
                  value={topupNote}
                  onChange={(e) => setTopupNote(e.currentTarget.value)}
                  maw={320}
                />
                <Button
                  className="stats-team-topup-submit"
                  onClick={() => void submitTopup()}
                  loading={topupSubmitting}
                >
                  分配额度
                </Button>
              </Group>

              <Divider className="stats-team-manage-divider" label="积分流水（最近 200 条）" labelPosition="left" />
              <Stack className="stats-team-ledger" gap="xs">
                {ledgerLoading && !ledger.length ? (
                  <Group className="stats-team-ledger-loading" gap="xs" align="center">
                    <Loader className="stats-team-ledger-loading-icon" size="sm" />
                    <Text className="stats-team-ledger-loading-text" size="sm" c="dimmed">加载中…</Text>
                  </Group>
                ) : !ledger.length ? (
                  <Text className="stats-team-ledger-empty" size="sm" c="dimmed">暂无流水</Text>
                ) : (
                  <Table className="stats-team-ledger-table" striped highlightOnHover withTableBorder withColumnBorders>
                    <Table.Thead className="stats-team-ledger-table-head">
                      <Table.Tr className="stats-team-ledger-table-head-row">
                        <Table.Th className="stats-team-ledger-table-head-cell">时间</Table.Th>
                        <Table.Th className="stats-team-ledger-table-head-cell">类型</Table.Th>
                        <Table.Th className="stats-team-ledger-table-head-cell">数量</Table.Th>
                        <Table.Th className="stats-team-ledger-table-head-cell">任务</Table.Th>
                        <Table.Th className="stats-team-ledger-table-head-cell">备注</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody className="stats-team-ledger-table-body">
                      {ledger.map((it) => {
                        const typeMeta = describeLedgerEntryType(it.entryType)
                        return (
                          <Table.Tr className="stats-team-ledger-table-row" key={it.id}>
                            <Table.Td className="stats-team-ledger-table-cell">
                              <Text className="stats-team-ledger-created-at" size="xs" c="dimmed">
                                {formatTime(it.createdAt)}
                              </Text>
                            </Table.Td>
                            <Table.Td className="stats-team-ledger-table-cell">
                              <Badge className="stats-team-ledger-entry-type" variant="light" color={typeMeta.color}>
                                {typeMeta.label}
                              </Badge>
                            </Table.Td>
                            <Table.Td className="stats-team-ledger-table-cell">
                              <Text
                                className="stats-team-ledger-amount"
                                size="sm"
                                fw={600}
                                c={it.entryType === 'topup' || it.entryType === 'release' ? 'green' : it.entryType === 'deduct' ? 'red' : 'yellow'}
                              >
                                {formatLedgerAmount(it)}
                              </Text>
                            </Table.Td>
                            <Table.Td className="stats-team-ledger-table-cell">
                              {it.taskId ? (
                                <Group className="stats-team-ledger-task" gap={6} wrap="nowrap">
                                  <Text className="stats-team-ledger-task-id" size="xs" c="dimmed">
                                    {it.taskId.slice(0, 10)}…
                                  </Text>
                                  <CopyButton value={it.taskId} timeout={1200}>
                                    {({ copied, copy }) => (
                                      <Tooltip className="stats-team-ledger-task-copy-tooltip" label={copied ? '已复制' : '复制'} withArrow>
                                        <ActionIcon className="stats-team-ledger-task-copy" variant="subtle" onClick={copy} aria-label="copy-task-id">
                                          {copied ? <IconCheck className="stats-team-ledger-task-copy-icon" size={14} /> : <IconCopy className="stats-team-ledger-task-copy-icon" size={14} />}
                                        </ActionIcon>
                                      </Tooltip>
                                    )}
                                  </CopyButton>
                                </Group>
                              ) : (
                                <Text className="stats-team-ledger-task-empty" size="xs" c="dimmed">—</Text>
                              )}
                            </Table.Td>
                            <Table.Td className="stats-team-ledger-table-cell">
                              <Text className="stats-team-ledger-note" size="xs" c="dimmed" style={{ wordBreak: 'break-word' }}>
                                {it.note || '—'}
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        )
                      })}
                    </Table.Tbody>
                  </Table>
                )}
              </Stack>

              <Divider className="stats-team-manage-divider" label="分配协作席位" labelPosition="left" />
              <Group className="stats-team-add-member" gap="sm" align="flex-end" wrap="wrap">
                <TextInput
                  className="stats-team-add-member-login"
                  label="GitHub 登录名"
                  placeholder="member_login"
                  value={addLogin}
                  onChange={(e) => setAddLogin(e.currentTarget.value)}
                  maw={240}
                />
                <Select
                  className="stats-team-add-member-role"
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
                  className="stats-team-add-member-submit"
                  onClick={() => void submitAddMember()}
                  loading={addSubmitting}
                >
                  添加
                </Button>
              </Group>

              <Divider className="stats-team-manage-divider" label="生成邀请码（成员自助加入）" labelPosition="left" />
              <Group className="stats-team-invite" gap="sm" align="flex-end" wrap="wrap">
                <TextInput
                  className="stats-team-invite-login"
                  label="限制登录名（可选）"
                  placeholder="仅允许该登录名使用"
                  value={inviteLogin}
                  onChange={(e) => setInviteLogin(e.currentTarget.value)}
                  maw={220}
                />
                <TextInput
                  className="stats-team-invite-email"
                  label="限制邮箱（可选）"
                  placeholder="仅允许该邮箱使用"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.currentTarget.value)}
                  maw={260}
                />
                <TextInput
                  className="stats-team-invite-phone"
                  label="限制手机号（可选）"
                  placeholder="仅允许该手机号使用（建议 +86...）"
                  value={invitePhone}
                  onChange={(e) => setInvitePhone(e.currentTarget.value)}
                  maw={240}
                />
                <NumberInput
                  className="stats-team-invite-expire"
                  label="有效期（天）"
                  value={inviteExpiresDays}
                  onChange={(value) => setInviteExpiresDays(typeof value === 'number' && Number.isFinite(value) ? value : '')}
                  min={1}
                  max={30}
                  maw={140}
                />
                <Button
                  className="stats-team-invite-submit"
                  onClick={() => void submitCreateInvite()}
                  loading={inviteSubmitting}
                >
                  生成
                </Button>
              </Group>

              <Stack className="stats-team-manage-lists" gap="md">
                <Stack className="stats-team-members" gap="xs">
                  <Group className="stats-team-members-header" justify="space-between" align="center">
                  <Text className="stats-team-members-title" size="sm" fw={600}>协作席位 {members.length}/{manageTeam.maxMembers}</Text>
                    <Button
                      className="stats-team-members-refresh"
                      size="xs"
                      variant="subtle"
                      onClick={() => void reloadManageData(manageTeam.id)}
                      loading={membersLoading || invitesLoading}
                    >
                      刷新
                    </Button>
                  </Group>

                  {membersLoading && !members.length ? (
                    <Group className="stats-team-members-loading" gap="xs" align="center">
                      <Loader className="stats-team-members-loading-icon" size="sm" />
                      <Text className="stats-team-members-loading-text" size="sm" c="dimmed">加载中…</Text>
                    </Group>
                  ) : !members.length ? (
                    <Text className="stats-team-members-empty" size="sm" c="dimmed">暂无成员</Text>
                  ) : (
                    <Table className="stats-team-members-table" striped highlightOnHover withTableBorder withColumnBorders>
                      <Table.Thead className="stats-team-members-table-head">
                        <Table.Tr className="stats-team-members-table-head-row">
                          <Table.Th className="stats-team-members-table-head-cell">登录名</Table.Th>
                          <Table.Th className="stats-team-members-table-head-cell">角色</Table.Th>
                          <Table.Th className="stats-team-members-table-head-cell">用户</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody className="stats-team-members-table-body">
                        {members.map((m) => (
                          <Table.Tr className="stats-team-members-table-row" key={m.userId}>
                            <Table.Td className="stats-team-members-table-cell">
                              <Text className="stats-team-member-login" size="sm" fw={600}>{m.login}</Text>
                            </Table.Td>
                            <Table.Td className="stats-team-members-table-cell">
                              <Badge className="stats-team-member-role" variant="light" color={m.role === 'owner' ? 'blue' : m.role === 'admin' ? 'teal' : 'gray'}>
                                {m.role}
                              </Badge>
                            </Table.Td>
                            <Table.Td className="stats-team-members-table-cell">
                              <Text className="stats-team-member-id" size="xs" c="dimmed">
                                {m.userId.slice(0, 8)}…
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Stack>

                <Stack className="stats-team-invites" gap="xs">
                  <Text className="stats-team-invites-title" size="sm" fw={600}>邀请码</Text>
                  {invitesLoading && !invites.length ? (
                    <Group className="stats-team-invites-loading" gap="xs" align="center">
                      <Loader className="stats-team-invites-loading-icon" size="sm" />
                      <Text className="stats-team-invites-loading-text" size="sm" c="dimmed">加载中…</Text>
                    </Group>
                  ) : !invites.length ? (
                    <Text className="stats-team-invites-empty" size="sm" c="dimmed">暂无邀请码</Text>
                  ) : (
                    <Table className="stats-team-invites-table" striped highlightOnHover withTableBorder withColumnBorders>
                      <Table.Thead className="stats-team-invites-table-head">
                        <Table.Tr className="stats-team-invites-table-head-row">
                          <Table.Th className="stats-team-invites-table-head-cell">邀请码</Table.Th>
                          <Table.Th className="stats-team-invites-table-head-cell">限制</Table.Th>
                          <Table.Th className="stats-team-invites-table-head-cell">状态</Table.Th>
                          <Table.Th className="stats-team-invites-table-head-cell">复制</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody className="stats-team-invites-table-body">
                        {invites.map((it) => (
                          <Table.Tr className="stats-team-invites-table-row" key={it.id}>
                            <Table.Td className="stats-team-invites-table-cell">
                              <Text className="stats-team-invite-code" size="xs" style={{ wordBreak: 'break-all' }}>{it.code}</Text>
                            </Table.Td>
                            <Table.Td className="stats-team-invites-table-cell">
                              <Text className="stats-team-invite-limit" size="xs" c="dimmed">
                                {(it.login ? `@${it.login}` : '') || (it.email || '—')}
                              </Text>
                            </Table.Td>
                            <Table.Td className="stats-team-invites-table-cell">
                              <Badge className="stats-team-invite-status" variant="light" color={it.status === 'pending' ? 'blue' : it.status === 'accepted' ? 'green' : 'gray'}>
                                {it.status}
                              </Badge>
                            </Table.Td>
                            <Table.Td className="stats-team-invites-table-cell">
                              <CopyButton value={it.code} timeout={1200}>
                                {({ copied, copy }) => (
                                  <Tooltip className="stats-team-invite-copy-tooltip" label={copied ? '已复制' : '复制'} withArrow>
                                    <ActionIcon className="stats-team-invite-copy" variant="light" onClick={copy} aria-label="copy-invite">
                                      {copied ? <IconCheck className="stats-team-invite-copy-icon" size={16} /> : <IconCopy className="stats-team-invite-copy-icon" size={16} />}
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
