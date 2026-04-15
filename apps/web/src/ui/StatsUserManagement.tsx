import React from 'react'
import { ActionIcon, Avatar, Badge, Button, Divider, Group, Loader, Modal, NumberInput, Pagination, Paper, Select, Stack, Switch, Table, Text, TextInput, Tooltip, Title } from '@mantine/core'
import { IconRefresh, IconSearch, IconSettings, IconTrash } from '@tabler/icons-react'
import { adjustAdminUserTeamCredits, deleteAdminUser, listAdminUsers, updateAdminUser, type AdminUserDto } from '../api/server'
import { useAuth } from '../auth/store'
import { PanelCard } from './PanelCard'
import { toast } from './toast'

const PAGE_SIZE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '20', label: '20 / 页' },
  { value: '50', label: '50 / 页' },
  { value: '100', label: '100 / 页' },
]

function formatTime(value?: string | null): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '—'
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return raw
  return new Date(t).toLocaleString()
}

function normalizeLoginFilter(value: string): string {
  return String(value || '').trim().slice(0, 128)
}

function formatCredits(value?: number | null): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0
  return String(Math.max(0, n))
}

export default function StatsUserManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-users', className].filter(Boolean).join(' ')
  const currentUserId = useAuth((s) => (s.user?.sub ? String(s.user.sub) : ''))

  const [q, setQ] = React.useState('')
  const [includeDeleted, setIncludeDeleted] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [loading, setLoading] = React.useState(false)
  const [total, setTotal] = React.useState(0)
  const [items, setItems] = React.useState<AdminUserDto[]>([])
  const [updatingIds, setUpdatingIds] = React.useState(() => new Set<string>())

  const [creditsOpen, setCreditsOpen] = React.useState(false)
  const [creditsUser, setCreditsUser] = React.useState<AdminUserDto | null>(null)
  const [creditsDelta, setCreditsDelta] = React.useState<number | ''>(100)
  const [creditsNote, setCreditsNote] = React.useState('')
  const [creditsSubmitting, setCreditsSubmitting] = React.useState(false)

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const next = await listAdminUsers({ q: normalizeLoginFilter(q), includeDeleted, page, pageSize })
      setItems(Array.isArray(next.items) ? next.items : [])
      setTotal(next.total)
    } catch (err: unknown) {
      console.error('list admin users failed', err)
      setItems([])
      setTotal(0)
      toast(err instanceof Error ? err.message : '加载用户列表失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [includeDeleted, page, pageSize, q])

  React.useEffect(() => {
    void reload()
  }, [reload])

  React.useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, pageSize, total])

  const markUpdating = (userId: string, next: boolean) => {
    setUpdatingIds((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(userId); else copy.delete(userId)
      return copy
    })
  }

  const openCreditsEditor = (u: AdminUserDto) => {
    if (!u?.id) return
    if (u.deletedAt) return
    if (u.guest) {
      toast('游客账号没有可调整积分（请先注册/登录）', 'error')
      return
    }
    if (!u.teamId) {
      toast('该用户暂无可调整的团队积分账户', 'error')
      return
    }
    setCreditsUser(u)
    setCreditsDelta(100)
    setCreditsNote('')
    setCreditsOpen(true)
  }

  const submitCredits = async () => {
    const u = creditsUser
    if (!u?.id) return
    if (!u.teamId) return

    const delta = typeof creditsDelta === 'number' && Number.isFinite(creditsDelta) ? Math.trunc(creditsDelta) : 0
    if (!delta) {
      toast('请填写非 0 的调整值', 'error')
      return
    }

    setCreditsSubmitting(true)
    markUpdating(u.id, true)
    try {
      const updated = await adjustAdminUserTeamCredits(u.id, { delta, ...(creditsNote.trim() ? { note: creditsNote.trim() } : {}) })
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      setCreditsUser(updated)
      setCreditsOpen(false)
      toast('已保存', 'success')
    } catch (err: unknown) {
      console.error('adjust team credits failed', err)
      toast(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setCreditsSubmitting(false)
      markUpdating(u.id, false)
    }
  }

  const onToggleAdmin = async (u: AdminUserDto) => {
    if (!u?.id) return
    if (u.deletedAt) return
    const nextAdmin = u.role !== 'admin'
    if (!window.confirm(nextAdmin ? `确定将「${u.login}」设为管理员？` : `确定取消「${u.login}」的管理员权限？`)) return
    markUpdating(u.id, true)
    try {
      const updated = await updateAdminUser(u.id, { role: nextAdmin ? 'admin' : null })
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      toast('已保存', 'success')
    } catch (err: unknown) {
      console.error('toggle admin failed', err)
      toast(err instanceof Error ? err.message : '更新失败', 'error')
    } finally {
      markUpdating(u.id, false)
    }
  }

  const onToggleDisabled = async (u: AdminUserDto) => {
    if (!u?.id) return
    if (u.deletedAt) return
    if (u.id === currentUserId) {
      toast('不能禁用自己', 'error')
      return
    }
    const nextDisabled = !u.disabled
    if (!window.confirm(nextDisabled ? `确定禁用「${u.login}」？禁用后将无法登录/调用接口。` : `确定启用「${u.login}」？`)) return
    markUpdating(u.id, true)
    try {
      const updated = await updateAdminUser(u.id, { disabled: nextDisabled })
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      toast('已保存', 'success')
    } catch (err: unknown) {
      console.error('toggle disabled failed', err)
      toast(err instanceof Error ? err.message : '更新失败', 'error')
    } finally {
      markUpdating(u.id, false)
    }
  }

  const onDeleteUser = async (u: AdminUserDto) => {
    if (!u?.id) return
    if (u.deletedAt) return
    if (u.id === currentUserId) {
      toast('不能删除自己', 'error')
      return
    }
    if (!window.confirm(`确定删除用户「${u.login}」？删除后将无法登录/调用接口（不可恢复）。`)) return
    markUpdating(u.id, true)
    try {
      await deleteAdminUser(u.id)
      toast('已删除', 'success')
      await reload()
    } catch (err: unknown) {
      console.error('delete user failed', err)
      toast(err instanceof Error ? err.message : '删除失败', 'error')
    } finally {
      markUpdating(u.id, false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageStart = total > 0 ? (page - 1) * pageSize + 1 : 0
  const pageEnd = total > 0 ? Math.min(total, page * pageSize) : 0

  return (
    <PanelCard className={rootClassName} style={{ width: '100%', minWidth: 0 }}>
      <Group className="stats-users-header" justify="space-between" align="center">
        <Stack className="stats-users-header-left" gap={2}>
          <Title className="stats-users-title" order={4}>用户管理</Title>
          <Text className="stats-users-subtitle" size="xs" c="dimmed">设置管理员 / 禁用 / 删除账号 / 调整积分（个人账户或团队共享；删除=逻辑删除；设置管理员后用户需重新登录）</Text>
        </Stack>
        <Group className="stats-users-header-right" gap={8} align="center">
          <TextInput
            className="stats-users-search"
            value={q}
            onChange={(e) => {
              setQ(e.currentTarget.value)
              setPage(1)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void reload()
            }}
            placeholder="搜索 login / email / id"
            size="xs"
            leftSection={<IconSearch className="stats-users-search-icon" size={14} />}
          />
          <Switch
            className="stats-users-include-deleted"
            size="xs"
            checked={includeDeleted}
            onChange={(e) => {
              setIncludeDeleted(e.currentTarget.checked)
              setPage(1)
            }}
            label="显示已删除"
          />
          <Tooltip className="stats-users-refresh-tooltip" label="刷新" withArrow>
            <ActionIcon className="stats-users-refresh" size="sm" variant="subtle" aria-label="刷新" onClick={() => void reload()} loading={loading}>
              <IconRefresh className="stats-users-refresh-icon" size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Divider className="stats-users-divider" my="sm" />

      {loading ? (
        <Group className="stats-users-loading" justify="center" py="xl">
          <Loader className="stats-users-loading-icon" size="sm" />
          <Text className="stats-users-loading-text" size="sm" c="dimmed">加载中…</Text>
        </Group>
      ) : (
        <Stack className="stats-users-body" gap="sm">
          <Group className="stats-users-meta" justify="space-between" align="center">
            <Text className="stats-users-count" size="xs" c="dimmed">
              {total > 0 ? `第 ${pageStart}-${pageEnd} / 共 ${total} 个用户` : '共 0 个用户'}
            </Text>
            <Group className="stats-users-meta-actions" gap={8} align="center">
              <Select
                className="stats-users-page-size"
                value={String(pageSize)}
                data={PAGE_SIZE_OPTIONS}
                onChange={(value) => {
                  const nextPageSize = Number.parseInt(String(value || pageSize), 10)
                  if (!Number.isFinite(nextPageSize) || nextPageSize <= 0) return
                  setPageSize(nextPageSize)
                  setPage(1)
                }}
                allowDeselect={false}
                size="xs"
                w={100}
              />
              <Button className="stats-users-reload" size="xs" variant="light" onClick={() => void reload()}>重新加载</Button>
            </Group>
          </Group>

          <div className="stats-users-table-wrap" style={{ width: '100%', minWidth: 0, overflowX: 'auto' }}>
            <Table className="stats-users-table" striped highlightOnHover withTableBorder withColumnBorders style={{ minWidth: 1160 }}>
              <Table.Thead className="stats-users-table-head">
                <Table.Tr className="stats-users-table-head-row">
                  <Table.Th className="stats-users-table-head-cell">用户</Table.Th>
                  <Table.Th className="stats-users-table-head-cell">邮箱</Table.Th>
                  <Table.Th className="stats-users-table-head-cell">手机号</Table.Th>
                  <Table.Th className="stats-users-table-head-cell">状态</Table.Th>
                  <Table.Th className="stats-users-table-head-cell">积分</Table.Th>
                  <Table.Th className="stats-users-table-head-cell">最近在线</Table.Th>
                  <Table.Th className="stats-users-table-head-cell">创建时间</Table.Th>
                  <Table.Th className="stats-users-table-head-cell">ID</Table.Th>
                  <Table.Th className="stats-users-table-head-cell">操作</Table.Th>
                </Table.Tr>
              </Table.Thead>

              <Table.Tbody className="stats-users-table-body">
                {items.length === 0 ? (
                  <Table.Tr className="stats-users-table-row-empty">
                    <Table.Td className="stats-users-table-cell-empty" colSpan={9}>
                      <Text className="stats-users-empty" size="sm" c="dimmed">暂无用户</Text>
                    </Table.Td>
                  </Table.Tr>
                ) : items.map((u) => {
                  const updating = updatingIds.has(u.id)
                  const isSelf = u.id === currentUserId
                  const deleted = Boolean(u.deletedAt)
                  return (
                    <Table.Tr className="stats-users-table-row" key={u.id}>
                      <Table.Td className="stats-users-table-cell">
                        <Group className="stats-users-user-cell" gap={10} align="center">
                          <Avatar className="stats-users-avatar" radius="md" size={28} src={u.avatarUrl || undefined}>
                            {(u.login || '?').slice(0, 1).toUpperCase()}
                          </Avatar>
                          <Stack className="stats-users-user-meta" gap={1}>
                            <Group className="stats-users-user-line" gap={8} align="center">
                              <Text className="stats-users-login" size="sm" fw={600}>{u.login || '—'}</Text>
                              {u.role === 'admin' && (<Badge className="stats-users-admin-badge" size="xs" variant="light" color="gray">admin</Badge>)}
                              {u.guest && (<Badge className="stats-users-guest-badge" size="xs" variant="light" color="blue">guest</Badge>)}
                              {isSelf && (<Badge className="stats-users-self-badge" size="xs" variant="light" color="teal">me</Badge>)}
                            </Group>
                            <Text className="stats-users-name" size="xs" c="dimmed">{u.name || '—'}</Text>
                          </Stack>
                        </Group>
                      </Table.Td>

                      <Table.Td className="stats-users-table-cell">
                        <Text className="stats-users-email" size="sm">{u.email || '—'}</Text>
                      </Table.Td>

                      <Table.Td className="stats-users-table-cell">
                        <Text className="stats-users-phone" size="sm">{u.phone || '—'}</Text>
                      </Table.Td>

                      <Table.Td className="stats-users-table-cell">
                        <Group className="stats-users-status" gap={6}>
                          {deleted ? (
                            <Badge className="stats-users-deleted-badge" size="xs" variant="light" color="red">deleted</Badge>
                          ) : u.disabled ? (
                            <Badge className="stats-users-disabled-badge" size="xs" variant="light" color="orange">disabled</Badge>
                          ) : (
                            <Badge className="stats-users-active-badge" size="xs" variant="light" color="green">active</Badge>
                          )}
                        </Group>
                      </Table.Td>

                      <Table.Td className="stats-users-table-cell">
                        {u.teamId ? (
                          <Stack className="stats-users-credits" gap={2}>
                            <Text className="stats-users-credits-team" size="xs" c="dimmed">
                              {u.teamName || u.teamId.slice(0, 8)}
                            </Text>
                            <Group className="stats-users-credits-badges" gap={6} wrap="wrap">
                              <Badge className="stats-users-credits-available" size="xs" variant="light" color={(u.teamCreditsAvailable || 0) > 0 ? 'grape' : 'gray'}>
                                可用 {formatCredits(u.teamCreditsAvailable)}
                              </Badge>
                              {(u.teamCreditsFrozen || 0) > 0 ? (
                                <Badge className="stats-users-credits-frozen" size="xs" variant="light" color="yellow">
                                  冻结 {formatCredits(u.teamCreditsFrozen)}
                                </Badge>
                              ) : null}
                              <Badge className="stats-users-credits-total" size="xs" variant="light" color="gray">
                                总 {formatCredits(u.teamCredits)}
                              </Badge>
                            </Group>
                          </Stack>
                        ) : (
                          <Text className="stats-users-credits-empty" size="sm" c="dimmed">—</Text>
                        )}
                      </Table.Td>

                      <Table.Td className="stats-users-table-cell">
                        <Text className="stats-users-last-seen" size="sm">{formatTime(u.lastSeenAt)}</Text>
                      </Table.Td>

                      <Table.Td className="stats-users-table-cell">
                        <Text className="stats-users-created-at" size="sm">{formatTime(u.createdAt)}</Text>
                      </Table.Td>

                      <Table.Td className="stats-users-table-cell">
                        <Text className="stats-users-id" size="xs" c="dimmed">{u.id}</Text>
                      </Table.Td>

                      <Table.Td className="stats-users-table-cell">
                        <Group className="stats-users-actions" gap={10} align="center">
                          <Switch
                            className="stats-users-admin-switch"
                            size="xs"
                            checked={u.role === 'admin'}
                            disabled={deleted || updating}
                            onChange={() => void onToggleAdmin(u)}
                            label="admin"
                          />
                          <Switch
                            className="stats-users-disabled-switch"
                            size="xs"
                            checked={u.disabled}
                            disabled={deleted || updating || isSelf}
                            onChange={() => void onToggleDisabled(u)}
                            label="禁用"
                          />
                          <Tooltip
                            className="stats-users-credits-edit-tooltip"
                            label={!u.teamId ? (u.guest ? '游客账号无团队积分' : '暂无团队积分账户') : '调整团队积分'}
                            withArrow
                          >
                            <ActionIcon
                              className="stats-users-credits-edit"
                              size="sm"
                              variant="subtle"
                              aria-label="积分"
                              disabled={deleted || updating || !u.teamId}
                              onClick={() => openCreditsEditor(u)}
                            >
                              <IconSettings className="stats-users-credits-edit-icon" size={14} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip className="stats-users-delete-tooltip" label={deleted ? '已删除' : isSelf ? '不能删除自己' : '删除'} withArrow>
                            <ActionIcon
                              className="stats-users-delete"
                              size="sm"
                              variant="subtle"
                              color="red"
                              aria-label="删除"
                              disabled={deleted || updating || isSelf}
                              onClick={() => void onDeleteUser(u)}
                            >
                              <IconTrash className="stats-users-delete-icon" size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </div>

          {total > 0 ? (
            <Group className="stats-users-pagination" justify="space-between" align="center" wrap="wrap" gap="sm">
              <Text className="stats-users-pagination-summary" size="xs" c="dimmed">
                共 {total} 条
              </Text>
              <Pagination
                className="stats-users-pagination-control"
                value={Math.min(page, totalPages)}
                onChange={setPage}
                total={totalPages}
                size="sm"
              />
            </Group>
          ) : null}
        </Stack>
      )}

      <Modal
        className="stats-users-credits-modal"
        opened={creditsOpen}
        onClose={() => setCreditsOpen(false)}
        title={creditsUser ? `积分调整：${creditsUser.login}` : '积分调整'}
        centered
        radius="md"
      >
        <Stack className="stats-users-credits-modal-stack" gap="md">
          <Text className="stats-users-credits-modal-hint" size="xs" c="dimmed">
            说明：若用户已加入团队，这里调整的是团队共享积分；若未加入团队，则调整其个人账户积分（personal_*）。
          </Text>

          <Group className="stats-users-credits-modal-meta" gap="xs" wrap="wrap">
            <Badge className="stats-users-credits-modal-meta-badge" variant="light" color="gray">{creditsUser?.teamRole ? '团队' : '个人账户'}</Badge>
            <Text className="stats-users-credits-modal-meta-team" size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
              {creditsUser?.teamName || creditsUser?.teamId || '—'}
            </Text>
            <Badge className="stats-users-credits-modal-meta-badge" variant="light" color="grape">可用</Badge>
            <Text className="stats-users-credits-modal-meta-available" size="sm" fw={600}>{formatCredits(creditsUser?.teamCreditsAvailable)}</Text>
            <Badge className="stats-users-credits-modal-meta-badge" variant="light" color="yellow">冻结</Badge>
            <Text className="stats-users-credits-modal-meta-frozen" size="sm" fw={600}>{formatCredits(creditsUser?.teamCreditsFrozen)}</Text>
            <Badge className="stats-users-credits-modal-meta-badge" variant="light" color="gray">总额</Badge>
            <Text className="stats-users-credits-modal-meta-total" size="sm" fw={600}>{formatCredits(creditsUser?.teamCredits)}</Text>
          </Group>

          <NumberInput
            className="stats-users-credits-modal-delta"
            label="调整值（可正可负）"
            description="正数=充值；负数=扣减。扣减时需保证扣减后积分 >= 冻结额度。"
            value={creditsDelta}
            onChange={(v) => setCreditsDelta(typeof v === 'number' && Number.isFinite(v) ? v : '')}
            min={-1_000_000}
            max={1_000_000}
            step={10}
          />

          <TextInput
            className="stats-users-credits-modal-note"
            label="备注（可选）"
            placeholder="例如：活动赠送 / 手动回收"
            value={creditsNote}
            onChange={(e) => setCreditsNote(e.currentTarget.value)}
            maxLength={200}
          />

          <Group className="stats-users-credits-modal-actions" justify="flex-end" gap={8}>
            <Button className="stats-users-credits-modal-cancel" variant="subtle" onClick={() => setCreditsOpen(false)} disabled={creditsSubmitting}>
              取消
            </Button>
            <Button className="stats-users-credits-modal-submit" onClick={() => void submitCredits()} loading={creditsSubmitting}>
              保存
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PanelCard>
  )
}
