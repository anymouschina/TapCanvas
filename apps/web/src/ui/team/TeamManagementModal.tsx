import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  ActionIcon, Avatar, Badge, Button, CopyButton, Divider,
  Group, Modal, Progress, ScrollArea, Stack, Table, Text,
  TextInput, Tooltip, UnstyledButton,
} from '@mantine/core'
import {
  IconCheck, IconChevronRight, IconCopy, IconCrown, IconEdit, IconLink,
  IconPlus, IconRefresh, IconTrash, IconUsersGroup, IconX,
} from '@tabler/icons-react'
import {
  acceptTeamInvite,
  cancelTeamSubscriptionById,
  createTeam,
  createTeamInvite,
  disbandTeam,
  getMyTeam,
  listMyTeams,
  listTeamActiveSubscriptions,
  listTeamMembers,
  removeMember,
  renameTeam,
  type TeamDto,
  type TeamMemberDto,
  type TeamPlanSubscriptionDto,
  type TeamRole,
} from '../../api/server'
import { useAuth } from '../../auth/store'
import { toast } from '../toast'
import { getActiveTeamId, setActiveTeamId } from './activeTeam'

export { getActiveTeamId, getActiveTeamName, setActiveTeamId, useActiveTeamId } from './activeTeam'

type View = 'switcher' | 'team-mgmt'
type TeamTab = 'members' | 'subscription' | 'join'

function roleLabel(role: TeamRole): string {
  if (role === 'owner') return '所有者'
  if (role === 'admin') return '管理员'
  return '成员'
}

function resolveErrMsg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() ? err.message.trim() : fallback
}

type Props = {
  opened: boolean
  onClose: () => void
  onTeamChanged?: (team: TeamDto | null) => void
}

export default function TeamManagementModal({ opened, onClose, onTeamChanged }: Props): JSX.Element {
  const auth = useAuth()

  const [view, setView] = useState<View>('switcher')
  const [allTeams, setAllTeams] = useState<TeamDto[]>([])
  const [activeTeamId, setLocalActiveTeamId] = useState<string | null>(() => getActiveTeamId())
  const [personalTeam, setPersonalTeam] = useState<TeamDto | null>(null)
  const [tab, setTab] = useState<TeamTab>('members')
  const [myRole, setMyRole] = useState<TeamRole>('member')
  const [members, setMembers] = useState<TeamMemberDto[]>([])
  const [loading, setLoading] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [acceptCode, setAcceptCode] = useState('')
  const [acceptBusy, setAcceptBusy] = useState(false)

  // Rename
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)

  // Remove member confirm
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  // Disband confirm
  const [disbandConfirmOpen, setDisbandConfirmOpen] = useState(false)
  const [disbandBusy, setDisbandBusy] = useState(false)

  // Subscription
  const [subscriptions, setSubscriptions] = useState<TeamPlanSubscriptionDto[]>([])
	const [cancelSubBusy, setCancelSubBusy] = useState<string | null>(null)

  const activeTeam = allTeams.find(t => t.id === activeTeamId) ?? null
  const isPersonalActive = !activeTeamId || activeTeamId === 'personal' || activeTeamId.startsWith('personal_')

  const loadPersonalTeam = useCallback(async () => {
    try {
      const mine = await getMyTeam('personal')
      const pt = mine?.team ?? null
      setPersonalTeam(pt)
      return pt
    } catch {
      setPersonalTeam(null)
      return null
    }
  }, [])

  const loadSubscription = useCallback(async (teamId: string) => {
    try {
      const subs = await listTeamActiveSubscriptions(teamId)
      setSubscriptions(subs)
    } catch {
      setSubscriptions([])
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const teams = await listMyTeams()
      const realTeams = teams.filter(t => !t.personal)
      setAllTeams(teams)

      const storedId = getActiveTeamId()
      const storedIsPersonal = !storedId || storedId === 'personal' || storedId.startsWith('personal_')
      if (storedId && !storedIsPersonal) {
        const found = realTeams.find(t => t.id === storedId)
        if (found) {
          setLocalActiveTeamId(found.id)
          const mine = await getMyTeam(found.id)
          setMyRole(mine?.role ?? 'member')
          setMembers(await listTeamMembers(found.id))
          await loadSubscription(found.id)
          onTeamChanged?.(found)
          return
        }
        // Stored a real team the user is no longer a member of: drop it.
        setActiveTeamId(null)
      }
      setMyRole('member')
      setMembers([])
      setSubscriptions([])
      const pt = await loadPersonalTeam()
      // Keep (or establish) an explicit personal identifier in storage + state so the
      // arg-less top-bar credit refresh still sends X-Team-Id for the personal account.
      const personalId = pt?.id ?? 'personal'
      setLocalActiveTeamId(personalId)
      if (storedIsPersonal && getActiveTeamId() !== personalId) {
        setActiveTeamId(personalId, pt?.name ?? '个人账户')
      }
      onTeamChanged?.(null)
      void pt
    } catch (err) {
      toast(resolveErrMsg(err, '加载团队失败'), 'error')
    } finally {
      setLoading(false)
    }
  }, [onTeamChanged, loadPersonalTeam, loadSubscription])

  const switchToPersonal = useCallback(async () => {
    setMyRole('member')
    setMembers([])
    setSubscriptions([])
    const pt = await loadPersonalTeam()
    // Store the REAL personal team id (personal_<uid>) so every subsequent request
    // — including the arg-less top-bar credit refresh — carries X-Team-Id pointing
    // at the personal account. This keeps display, billing and visibility consistent
    // (the backend resolves personal_<uid> via isPersonalTeamId). Falling back to the
    // "personal" sentinel keeps it working even if the personal team fails to load.
    const personalId = pt?.id ?? 'personal'
    setLocalActiveTeamId(personalId)
    setActiveTeamId(personalId, pt?.name ?? '个人账户')
    onTeamChanged?.(null)
    void pt
  }, [onTeamChanged, loadPersonalTeam])

  const switchToTeam = useCallback(async (team: TeamDto) => {
    setLocalActiveTeamId(team.id)
    setActiveTeamId(team.id, team.name)
    setLoading(true)
    try {
      const mine = await getMyTeam(team.id)
      setMyRole(mine?.role ?? 'member')
      setMembers(await listTeamMembers(team.id))
      await loadSubscription(team.id)
      onTeamChanged?.(team)
    } catch (err) {
      toast(resolveErrMsg(err, '切换团队失败'), 'error')
    } finally {
      setLoading(false)
    }
  }, [onTeamChanged, loadSubscription])

  useEffect(() => {
    if (!opened) return
    void refresh()
    setView('switcher')
    setShowCreate(false)
    setTab('members')
    setIsRenaming(false)
    setDisbandConfirmOpen(false)
  }, [opened, refresh])

  const handleCreate = async () => {
    const name = createName.trim()
    if (!name) { toast('请输入团队名称', 'error'); return }
    setCreateBusy(true)
    try {
      await createTeam({ name })
      setCreateName('')
      setShowCreate(false)
      toast('团队已创建', 'success')
      await refresh()
    } catch (err) {
      toast(resolveErrMsg(err, '创建团队失败'), 'error')
    } finally {
      setCreateBusy(false)
    }
  }

  const openInvite = async () => {
    if (!activeTeam) return
    setInviteCode(null)
    setInviteOpen(true)
    setInviteBusy(true)
    try {
      const inv = await createTeamInvite(activeTeam.id, { expiresInDays: 7 })
      setInviteCode(inv.code)
    } catch (err) {
      toast(resolveErrMsg(err, '生成邀请码失败'), 'error')
    } finally {
      setInviteBusy(false)
    }
  }

  const handleAccept = async () => {
    const code = acceptCode.trim()
    if (!code) { toast('请输入邀请码', 'error'); return }
    setAcceptBusy(true)
    try {
      await acceptTeamInvite({ code })
      setAcceptCode('')
      toast('已加入团队', 'success')
      await refresh()
      setTab('members')
    } catch (err) {
      toast(resolveErrMsg(err, '加入失败，请检查邀请码'), 'error')
    } finally {
      setAcceptBusy(false)
    }
  }

  const handleRenameSubmit = async () => {
    if (!activeTeam || !renameValue.trim()) return
    setRenameBusy(true)
    try {
      await renameTeam(activeTeam.id, renameValue.trim())
      toast('已重命名', 'success')
      setIsRenaming(false)
      await refresh()
    } catch (err) {
      toast(resolveErrMsg(err, '重命名失败'), 'error')
    } finally {
      setRenameBusy(false)
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    if (!activeTeam) return
    setRemoveBusy(true)
    try {
      await removeMember(activeTeam.id, memberId)
      toast('已移除成员', 'success')
      setRemovingMemberId(null)
      setMembers(prev => prev.filter(m => m.userId !== memberId))
    } catch (err) {
      toast(resolveErrMsg(err, '移除失败'), 'error')
    } finally {
      setRemoveBusy(false)
    }
  }

  const handleDisband = async () => {
    if (!activeTeam) return
    setDisbandBusy(true)
    try {
      await disbandTeam(activeTeam.id)
      toast('团队已解散', 'success')
      setDisbandConfirmOpen(false)
      setActiveTeamId(null)
      setLocalActiveTeamId(null)
      onTeamChanged?.(null)
      await refresh()
      setView('switcher')
    } catch (err) {
      toast(resolveErrMsg(err, '解散失败'), 'error')
    } finally {
      setDisbandBusy(false)
    }
  }

  const handleCancelSub = async (subId: string) => {
    if (!activeTeam) return
    setCancelSubBusy(subId)
    try {
      await cancelTeamSubscriptionById(activeTeam.id, subId)
      setSubscriptions(prev => prev.filter(s => s.id !== subId))
      toast('订阅已取消', 'success')
      await refresh()
    } catch (err) {
      toast(resolveErrMsg(err, '取消失败'), 'error')
    } finally {
      setCancelSubBusy(null)
    }
  }

  const realTeams = allTeams.filter(t => !t.personal)
  const memberCount = activeTeam?.memberCount ?? 0
  const maxMembers = activeTeam?.maxMembers ?? 1
  const emptySlots = Math.max(0, maxMembers - memberCount)
  const canManage = myRole === 'owner' || myRole === 'admin'

  const userName = auth.user?.name || auth.user?.login || auth.user?.phone || '用户'
  const userInitial = userName.charAt(0).toUpperCase()

  const inviteLink = inviteCode ? `${window.location.origin}/?inviteCode=${inviteCode}` : ''

  const sidebarStyle: React.CSSProperties = {
    width: 140, borderRight: '1px solid var(--mantine-color-dark-5)',
    flexShrink: 0, padding: 12,
  }
  const statBarStyle: React.CSSProperties = {
    background: 'var(--mantine-color-dark-7)', borderRadius: 8,
    border: '1px solid var(--mantine-color-dark-5)', display: 'flex', overflow: 'hidden',
  }
  const statItemStyle = (last: boolean): React.CSSProperties => ({
    flex: 1, padding: '10px 16px',
    borderRight: last ? undefined : '1px solid var(--mantine-color-dark-5)',
  })

  // 多套餐叠加：优先展示最高积分/周期的套餐名；到期时间取最晚
  const primarySub = subscriptions.length > 0
    ? subscriptions.reduce((a, b) => a.creditsPerRenewal >= b.creditsPerRenewal ? a : b)
    : null
  const currentPlanName = subscriptions.length > 1
    ? `${primarySub?.plan?.name ?? '套餐'}等${subscriptions.length}个`
    : (primarySub?.plan?.name ?? (primarySub ? primarySub.planId : null))
  const periodEnd = subscriptions.length > 0
    ? subscriptions.reduce((latest, s) => s.currentPeriodEnd > latest ? s.currentPeriodEnd : latest, '')
        .slice(0, 10).replace(/-/g, '/') || '——'
    : '——'

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        withCloseButton={false}
        padding={0}
        size={view === 'switcher' ? 700 : 960}
        centered
        zIndex={450}
        styles={{
          body: {
            display: 'flex', flexDirection: 'column',
            height: view === 'switcher' ? 480 : 620,
          },
        }}
      >
        {view === 'switcher' && (
          <div style={{ display: 'flex', flex: 1 }}>
            {/* Left panel: team list */}
            <div style={{
              width: 220, borderRight: '1px solid var(--mantine-color-dark-5)',
              padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              <div>
                <Text size="xs" c="dimmed" fw={500} mb={6}>个人账号</Text>
                <UnstyledButton
                  onClick={() => void switchToPersonal()}
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 8,
                    background: isPersonalActive ? 'var(--mantine-color-dark-5)' : 'transparent',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}
                >
                  <Avatar size="sm" radius={999} color="gray">{userInitial}</Avatar>
                  <Text size="sm" fw={isPersonalActive ? 600 : 400}>{userName}</Text>
                  {isPersonalActive && <IconCheck size={14} color="var(--mantine-color-teal-5)" style={{ marginLeft: 'auto' }} />}
                </UnstyledButton>
              </div>

              <div>
                <Text size="xs" c="dimmed" fw={500} mb={6}>团队账号</Text>
                {realTeams.map(team => (
                  <UnstyledButton
                    key={team.id}
                    onClick={() => void switchToTeam(team)}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      background: activeTeamId === team.id ? 'var(--mantine-color-dark-5)' : 'transparent',
                      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2,
                    }}
                  >
                    <Avatar size="sm" radius={6} color="teal">{team.name.charAt(0).toUpperCase()}</Avatar>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={activeTeamId === team.id ? 600 : 400} lineClamp={1}>{team.name}</Text>
                    </div>
                    {activeTeamId === team.id && <IconCheck size={14} color="var(--mantine-color-teal-5)" />}
                  </UnstyledButton>
                ))}

                {!showCreate ? (
                  <UnstyledButton
                    onClick={() => setShowCreate(true)}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      display: 'flex', alignItems: 'center', gap: 8, marginTop: realTeams.length ? 4 : 0,
                    }}
                  >
                    <IconPlus size={14} color="var(--mantine-color-dimmed)" />
                    <Text size="sm" c="dimmed">创建团队</Text>
                  </UnstyledButton>
                ) : (
                  <Stack gap={6} mt={4}>
                    <TextInput
                      size="xs" placeholder="团队名称" value={createName}
                      onChange={e => setCreateName(e.currentTarget.value)}
                      onKeyDown={e => e.key === 'Enter' && void handleCreate()}
                      autoFocus
                    />
                    <Group gap={6}>
                      <Button size="xs" loading={createBusy} onClick={() => void handleCreate()} style={{ flex: 1 }}>
                        创建
                      </Button>
                      <Button size="xs" variant="subtle" onClick={() => { setShowCreate(false); setCreateName('') }}>
                        取消
                      </Button>
                    </Group>
                    <Text size="xs" c="dimmed">新建团队固定 2 席位起</Text>
                  </Stack>
                )}
              </div>
            </div>

            {/* Right panel */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <Group justify="flex-end" p="12px 16px 0" gap={6}>
                <ActionIcon variant="subtle" size="md" onClick={() => void refresh()} loading={loading} aria-label="刷新">
                  <IconRefresh size={15} />
                </ActionIcon>
                <ActionIcon variant="subtle" size="md" onClick={onClose} aria-label="关闭">
                  <IconX size={15} />
                </ActionIcon>
              </Group>

              <div style={{ padding: '12px 20px 20px', flex: 1 }}>
                {isPersonalActive ? (
                  <Stack gap="md">
                    <Group gap={12} align="center">
                      <Avatar size={48} radius={999} color="gray">{userInitial}</Avatar>
                      <div>
                        <Text fw={600} size="md">{userName}</Text>
                        <Text size="xs" c="dimmed">个人账号</Text>
                      </div>
                    </Group>
                    {personalTeam && (
                      <Group justify="space-between" align="center">
                        <Group gap={6}>
                          <Text size="sm" fw={600}>{personalTeam.creditsAvailable}</Text>
                          <Text size="sm" c="dimmed">积分余额</Text>
                        </Group>
                      </Group>
                    )}
                    {realTeams.length === 0 && (
                      <Stack gap={6} mt={8}>
                        <Text size="sm" c="dimmed">暂无协作团队</Text>
                        <Button
                          leftSection={<IconUsersGroup size={14} />}
                          variant="light"
                          onClick={() => setShowCreate(true)}
                          style={{ alignSelf: 'flex-start' }}
                        >
                          创建协作团队
                        </Button>
                      </Stack>
                    )}
                    <Divider />
                    <Stack gap={2}>
                      <UnstyledButton onClick={() => { auth.clear(); onClose() }} style={{ padding: '10px 12px', borderRadius: 8 }}>
                        <Text size="sm" c="red">退出登录</Text>
                      </UnstyledButton>
                    </Stack>
                  </Stack>
                ) : activeTeam ? (
                  <Stack gap="md">
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <Group gap={12} align="center">
                        <Avatar size={48} radius={8} color="teal" fw={700}>
                          {activeTeam.name.charAt(0).toUpperCase()}
                        </Avatar>
                        <div>
                          <Group gap={8} align="center">
                            <Text fw={700} size="md" lh={1.2}>{activeTeam.name}</Text>
                            <Badge variant="light" color="gray" size="sm" radius={4}>团队</Badge>
                            {currentPlanName && <Badge variant="light" color="gray" size="sm" radius={4}>{currentPlanName}</Badge>}
                          </Group>
                          <Button size="xs" variant="subtle" mt={2} p={0} h="auto" onClick={() => void switchToPersonal()}>
                            切换个人账户
                          </Button>
                        </div>
                      </Group>
                    </Group>

                    <Group gap={4} align="center">
                      <Text size="xs" c="dimmed">团队ID：{activeTeam.id}</Text>
                      <CopyButton value={activeTeam.id}>
                        {({ copied, copy }) => (
                          <ActionIcon size="xs" variant="subtle" onClick={copy}>
                            {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
                          </ActionIcon>
                        )}
                      </CopyButton>
                    </Group>

                    <div style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid var(--mantine-color-dark-5)', background: 'var(--mantine-color-dark-7)' }}>
                      <Group justify="space-between" align="center">
                        <div>
                          <Text size="xs" c="dimmed" mb={2}>{currentPlanName ?? '免费版'}</Text>
                          <Text size="sm" fw={600}>团队版会员</Text>
                          {subscriptions.length > 0 && <Text size="xs" c="dimmed">到期：{periodEnd}</Text>}
                        </div>
                        <Button size="xs" variant="outline" onClick={() => { setView('team-mgmt'); setTab('subscription') }}>
                          查看配置
                        </Button>
                      </Group>
                    </div>

                    <Group justify="space-between" align="center">
                      <Group gap={6}>
                        <Text size="sm" fw={600}>{activeTeam.creditsAvailable}</Text>
                        <Text size="sm" c="dimmed">积分余额</Text>
                      </Group>
                    </Group>

                    <Group gap={16}>
                      <Text size="sm" c="dimmed">席位：<Text span fw={600}>{memberCount}/{maxMembers}</Text></Text>
                    </Group>

                    <Divider />

                    <Stack gap={2}>
                      <UnstyledButton onClick={() => setView('team-mgmt')} style={{ padding: '10px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text size="sm">团队设置</Text>
                        <IconChevronRight size={14} color="var(--mantine-color-dimmed)" />
                      </UnstyledButton>
                      {canManage && (
                        <UnstyledButton onClick={() => void openInvite()} style={{ padding: '10px 12px', borderRadius: 8 }}>
                          <Text size="sm">邀请成员</Text>
                        </UnstyledButton>
                      )}
                      <UnstyledButton onClick={() => { auth.clear(); onClose() }} style={{ padding: '10px 12px', borderRadius: 8 }}>
                        <Text size="sm" c="red">退出登录</Text>
                      </UnstyledButton>
                    </Stack>
                  </Stack>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {view === 'team-mgmt' && activeTeam && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ padding: '16px 20px 0', borderBottom: '1px solid var(--mantine-color-dark-5)' }}>
              <Group justify="space-between" align="flex-start" wrap="nowrap" mb={12}>
                <Group gap={12} align="center" wrap="nowrap">
                  <Avatar size={42} radius={8} color="teal" fw={700}>{activeTeam.name.charAt(0).toUpperCase()}</Avatar>
                  <div>
                    {isRenaming ? (
                      <Group gap={6} align="center">
                        <TextInput
                          size="xs" value={renameValue}
                          onChange={e => setRenameValue(e.currentTarget.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void handleRenameSubmit(); if (e.key === 'Escape') setIsRenaming(false) }}
                          autoFocus style={{ width: 160 }}
                        />
                        <Button size="xs" loading={renameBusy} onClick={() => void handleRenameSubmit()}>保存</Button>
                        <Button size="xs" variant="subtle" onClick={() => setIsRenaming(false)}>取消</Button>
                      </Group>
                    ) : (
                      <Group gap={8} align="center">
                        <Text fw={700} size="lg" lh={1.2}>{activeTeam.name}</Text>
                        {canManage && (
                          <ActionIcon size="xs" variant="subtle" onClick={() => { setRenameValue(activeTeam.name); setIsRenaming(true) }}>
                            <IconEdit size={13} />
                          </ActionIcon>
                        )}
                        <Badge variant="light" color="gray" size="sm" radius={4}>{currentPlanName ?? '免费版'}</Badge>
                      </Group>
                    )}
                    <Group gap={4} align="center" mt={2}>
                      <Text size="xs" c="dimmed">团队ID：{activeTeam.id}</Text>
                      <CopyButton value={activeTeam.id}>
                        {({ copied, copy }) => (
                          <ActionIcon size="xs" variant="subtle" onClick={copy}>
                            {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
                          </ActionIcon>
                        )}
                      </CopyButton>
                    </Group>
                  </div>
                </Group>
                <Group gap={8} align="center" wrap="nowrap">
                  {myRole === 'owner' && (
                    <Button size="xs" variant="subtle" color="red" onClick={() => setDisbandConfirmOpen(true)}>解散团队</Button>
                  )}
                  <Button size="xs" variant="outline" onClick={() => setTab('subscription')}>套餐配置</Button>
                  {canManage && (
                    <Button size="xs" leftSection={<IconPlus size={13} />} onClick={() => void openInvite()}>邀请成员</Button>
                  )}
                  <ActionIcon variant="subtle" size="md" onClick={() => void refresh()} loading={loading}><IconRefresh size={15} /></ActionIcon>
                  <ActionIcon variant="subtle" size="md" onClick={() => setView('switcher')}><IconChevronRight size={15} style={{ transform: 'rotate(180deg)' }} /></ActionIcon>
                </Group>
              </Group>

              <div style={statBarStyle}>
                {[
					{ label: '剩余积分', value: String(activeTeam.creditsAvailable) },
                  { label: '席位数量', value: `${memberCount}/${maxMembers}` },
                  { label: '当前套餐', value: currentPlanName ?? '免费版' },
                  { label: '到期时间', value: periodEnd },
                ].map((item, i, arr) => (
                  <div key={item.label} style={statItemStyle(i === arr.length - 1)}>
                    <Text size="xs" c="dimmed" mb={2}>{item.label}</Text>
					<Group gap={8} align="center">
						<Text fw={700} size="sm">{item.value}</Text>
					</Group>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <div style={sidebarStyle}>
                {(['members', 'subscription', 'join'] as TeamTab[]).map(t => {
                  const labels: Record<TeamTab, string> = { members: '成员管理', subscription: '套餐配置', join: '加入申请' }
                  return (
                    <UnstyledButton key={t} onClick={() => setTab(t)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, background: tab === t ? 'var(--mantine-color-dark-5)' : 'transparent', fontSize: 13, fontWeight: tab === t ? 600 : 400, marginBottom: 2 }}>
                      {labels[t]}
                    </UnstyledButton>
                  )
                })}
              </div>

              <ScrollArea style={{ flex: 1 }}>
                <div style={{ padding: '20px 24px' }}>
                  {tab === 'members' && (
                    <Stack gap="sm">
                      <Text size="sm" fw={600} c="dimmed">成员 {memberCount}/{maxMembers}</Text>
                      <Table highlightOnHover>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>成员</Table.Th>
                            <Table.Th>角色</Table.Th>
                            {canManage && <Table.Th style={{ width: 80 }}>操作</Table.Th>}
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {members.map(m => (
                            <Table.Tr key={m.userId}>
                              <Table.Td>
                                <Group gap={8} wrap="nowrap">
                                  <Avatar size="sm" radius={999} color="gray">{(m.name || m.login || '?').charAt(0).toUpperCase()}</Avatar>
                                  <Text size="sm">{m.name || m.login}</Text>
                                </Group>
                              </Table.Td>
                              <Table.Td>
                                <Group gap={6} align="center">
                                  {m.role === 'owner' && <IconCrown size={12} color="var(--mantine-color-yellow-5)" />}
                                  <Text size="sm">{roleLabel(m.role)}</Text>
                                </Group>
                              </Table.Td>
                              {canManage && (
                                <Table.Td>
                                  {m.role !== 'owner' && (
                                    removingMemberId === m.userId ? (
                                      <Group gap={4}>
                                        <Button size="xs" color="red" loading={removeBusy} onClick={() => void handleRemoveMember(m.userId)}>确认移除</Button>
                                        <Button size="xs" variant="subtle" onClick={() => setRemovingMemberId(null)}>取消</Button>
                                      </Group>
                                    ) : (
                                      <ActionIcon size="sm" variant="subtle" color="red" onClick={() => setRemovingMemberId(m.userId)}>
                                        <IconTrash size={13} />
                                      </ActionIcon>
                                    )
                                  )}
                                </Table.Td>
                              )}
                            </Table.Tr>
                          ))}
                          {Array.from({ length: emptySlots }).map((_, i) => (
                            <Table.Tr key={`slot-${i}`} style={{ opacity: 0.35 }}>
                              <Table.Td><Group gap={8} wrap="nowrap"><Avatar size="sm" radius={999} color="gray" /><Text size="sm" c="dimmed">预留席位</Text></Group></Table.Td>
                              <Table.Td><Text size="sm" c="dimmed">——</Text></Table.Td>
                              {canManage && <Table.Td />}
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Stack>
                  )}

                  {tab === 'subscription' && (
                    <Stack gap="lg">
                      {/* 已激活的订阅列表（各自独立周期）*/}
                      {subscriptions.length > 0 && (
                        <Stack gap={8}>
                          <Text size="sm" fw={600}>已激活的套餐</Text>
                          {subscriptions.map(sub => (
                            <div key={sub.id} style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid var(--mantine-color-blue-8)', background: 'var(--mantine-color-dark-7)' }}>
                              <Group justify="space-between" align="center" wrap="nowrap">
                                <div>
                                  <Text fw={700} size="sm">{sub.plan?.name ?? sub.planId}</Text>
                                  <Text size="xs" c="dimmed">
                                    {sub.seatCount} 席 · 年度分配 · 到账 {sub.creditsPerRenewal.toLocaleString()} 积分
                                  </Text>
                                  <Text size="xs" c="dimmed">到期：{new Date(sub.currentPeriodEnd).toLocaleDateString('zh-CN')}</Text>
                                </div>
                              </Group>
                            </div>
                          ))}
                        </Stack>
                      )}


                    </Stack>
                  )}

                  {tab === 'join' && (
                    <Stack gap="lg">
                      <Group gap="xs" align="end">
                        <TextInput flex={1} label="邀请码" placeholder="粘贴邀请码" value={acceptCode} onChange={e => setAcceptCode(e.currentTarget.value)} onKeyDown={e => e.key === 'Enter' && void handleAccept()} />
                        <Button variant="light" loading={acceptBusy} onClick={() => void handleAccept()}>加入</Button>
                      </Group>
                      <Text size="xs" c="dimmed">暂无待审核申请</Text>
                    </Stack>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </Modal>

      {/* Invite modal */}
      <Modal opened={inviteOpen} onClose={() => setInviteOpen(false)} title="邀请成员" size="460px" zIndex={460} centered>
        <Stack gap="lg">
          <div>
            <Group justify="space-between" mb={8}>
              <Text size="sm">当前可邀请 <Text span fw={700}>{emptySlots}个</Text> 席位</Text>
              <Text size="sm" c="dimmed">已开通 {maxMembers} 个席位</Text>
            </Group>
            <Progress value={maxMembers > 0 ? (memberCount / maxMembers) * 100 : 0} radius="xl" />
          </div>
          <Stack gap="xs">
            <Text size="sm" fw={600}>邀请链接</Text>
            {inviteBusy ? (
              <Text size="sm" c="dimmed">生成中…</Text>
            ) : inviteCode ? (
              <>
                <Group gap={0}>
                  <TextInput flex={1} value={inviteLink} readOnly styles={{ input: { borderTopRightRadius: 0, borderBottomRightRadius: 0 } }} />
                  <CopyButton value={inviteLink}>
                    {({ copied, copy }) => (
                      <Button onClick={copy} leftSection={copied ? <IconCheck size={14} /> : <IconLink size={14} />} style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }} color={copied ? 'teal' : undefined}>
                        {copied ? '已复制' : '复制链接'}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
                <Text size="xs" c="dimmed">成员点击链接后可直接加入团队。</Text>
              </>
            ) : null}
          </Stack>
          {emptySlots === 0 && (
			<Text size="sm" c="orange">席位已满，请联系管理员调整。</Text>
          )}
        </Stack>
      </Modal>

      {/* Disband confirm */}
      <Modal opened={disbandConfirmOpen} onClose={() => setDisbandConfirmOpen(false)} title="解散团队" size="400px" zIndex={460} centered>
        <Stack gap="lg">
          <Text size="sm">确认解散团队 <Text span fw={700}>{activeTeam?.name}</Text>？此操作不可恢复，团队积分、成员数据将被清除。</Text>
          <Group justify="flex-end" gap={8}>
            <Button variant="subtle" onClick={() => setDisbandConfirmOpen(false)}>取消</Button>
            <Button color="red" loading={disbandBusy} onClick={() => void handleDisband()}>确认解散</Button>
          </Group>
        </Stack>
      </Modal>

    </>
  )
}
