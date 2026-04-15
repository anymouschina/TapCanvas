import React from 'react'
import { Button, Group, Modal, Select, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core'
import {
  deleteOpenClawAdminAuthorization,
  listAdminUsers,
  listOpenClawAdminAuthorizations,
  resetAllOpenClawAdminAuthorizationUsages,
  resetOpenClawAdminAuthorizationUsage,
  resyncOpenClawAdminAuthorization,
  type AdminUserDto,
  type OpenClawAdminAuthorizationDto,
} from '../../../api/server'
import { PanelCard } from '../../PanelCard'
import { toast } from '../../toast'

type PanelProps = {
  className?: string
}

type EditState = {
  item: OpenClawAdminAuthorizationDto
  quotaLimit: string
  descriptionText: string
  desiredStatus: 'active' | 'inactive'
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return value
  return new Date(ts).toLocaleString()
}

function formatBindingValue(value: string | null): string {
  const text = String(value || '').trim()
  return text || '—'
}

export default function StatsCommerceOpenClawPanel({ className }: PanelProps): JSX.Element {
  const rootClassName = ['stats-commerce-openclaw', className].filter(Boolean).join(' ')
  const [items, setItems] = React.useState<OpenClawAdminAuthorizationDto[]>([])
  const [users, setUsers] = React.useState<AdminUserDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [q, setQ] = React.useState('')
  const [status, setStatus] = React.useState<string>('')
  const [editState, setEditState] = React.useState<EditState | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [resettingId, setResettingId] = React.useState<string | null>(null)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const [resettingAll, setResettingAll] = React.useState(false)

  const userById = React.useMemo(() => new Map(users.map((user) => [user.id, user])), [users])

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const [authResp, usersResp] = await Promise.all([
        listOpenClawAdminAuthorizations({ q: q.trim() || undefined, status: status || undefined, limit: 300 }),
        listAdminUsers({ page: 1, pageSize: 500 }),
      ])
      setItems(Array.isArray(authResp.items) ? authResp.items : [])
      setUsers(Array.isArray(usersResp.items) ? usersResp.items : [])
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '加载 OpenClaw 授权失败'
      toast(message, 'error')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [q, status])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const openEdit = React.useCallback((item: OpenClawAdminAuthorizationDto) => {
    setEditState({
      item,
      quotaLimit: String(item.quotaLimit || ''),
      descriptionText: String(item.descriptionText || ''),
      desiredStatus: item.status === 'inactive' ? 'inactive' : 'active',
    })
  }, [])

  const handleResetAllUsage = React.useCallback(async () => {
    setResettingAll(true)
    try {
      const result = await resetAllOpenClawAdminAuthorizationUsages()
      await reload()
      toast(`已重置 ${result.succeeded}/${result.total} 个密钥今日用量`, result.failed > 0 ? 'error' : 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '批量重置今日用量失败', 'error')
    } finally {
      setResettingAll(false)
    }
  }, [reload])

  const handleResetUsage = React.useCallback(async (item: OpenClawAdminAuthorizationDto) => {
    setResettingId(item.id)
    try {
      const updated = await resetOpenClawAdminAuthorizationUsage(item.id)
      setItems((prev) => prev.map((row) => row.id === updated.id ? updated : row))
      toast('已重置今日用量', 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '重置今日用量失败', 'error')
    } finally {
      setResettingId(null)
    }
  }, [])

  const handleDelete = React.useCallback(async (item: OpenClawAdminAuthorizationDto) => {
    const userLabel = userById.get(item.ownerId)?.login || item.ownerId
    const shouldDelete = window.confirm(`确认删除用户 ${userLabel} 绑定的 OpenClaw 密钥吗？该操作会删除上游 key，且不可恢复。`)
    if (!shouldDelete) return
    setDeletingId(item.id)
    try {
      await deleteOpenClawAdminAuthorization(item.id)
      setItems((prev) => prev.filter((row) => row.id !== item.id))
      if (editState?.item.id === item.id) {
        setEditState(null)
      }
      toast('OpenClaw 密钥已删除', 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '删除 OpenClaw 密钥失败', 'error')
    } finally {
      setDeletingId(null)
    }
  }, [editState?.item.id, userById])

  const save = React.useCallback(async () => {
    if (!editState) return
    const quotaLimit = Math.max(1, Math.trunc(Number(editState.quotaLimit || 0)))
    if (!Number.isFinite(quotaLimit) || quotaLimit <= 0) {
      toast('请输入有效额度', 'error')
      return
    }
    setSaving(true)
    try {
      const updated = await resyncOpenClawAdminAuthorization(editState.item.id, {
        quotaLimit,
        descriptionText: editState.descriptionText.trim() || null,
        desiredStatus: editState.desiredStatus,
      })
      setItems((prev) => prev.map((item) => item.id === updated.id ? updated : item))
      toast('OpenClaw 授权已同步', 'success')
      setEditState(null)
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '同步 OpenClaw 授权失败', 'error')
    } finally {
      setSaving(false)
    }
  }, [editState])

  return (
    <PanelCard className={rootClassName}>
      <Stack className="stats-commerce-openclaw__stack" gap="sm">
        <Group className="stats-commerce-openclaw__header" justify="space-between" align="center" wrap="wrap">
          <div className="stats-commerce-openclaw__title-wrap">
            <Title className="stats-commerce-openclaw__title" order={5}>OpenClaw 授权维护</Title>
            <Text className="stats-commerce-openclaw__subtitle" size="xs" c="dimmed">查看用户与 OpenClaw 密钥绑定关系，支持手动同步额度、描述文案和启停状态，并支持删除密钥。</Text>
          </div>
          <Group className="stats-commerce-openclaw__header-actions" gap={8} wrap="wrap">
            <Button className="stats-commerce-openclaw__reset-all" variant="subtle" color="orange" onClick={() => void handleResetAllUsage()} loading={resettingAll}>重置全部今日用量</Button>
            <Button className="stats-commerce-openclaw__refresh" variant="light" onClick={() => void reload()} loading={loading}>刷新</Button>
          </Group>
        </Group>

        <Group className="stats-commerce-openclaw__filters" align="end" grow>
          <TextInput className="stats-commerce-openclaw__query" label="搜索" placeholder="用户 / key / 描述" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
          <Select className="stats-commerce-openclaw__status" label="状态" placeholder="全部" clearable value={status} onChange={(value) => setStatus(value || '')} data={[
            { value: 'pending', label: 'pending' },
            { value: 'active', label: 'active' },
            { value: 'inactive', label: 'inactive' },
            { value: 'error', label: 'error' },
          ]} />
          <Button className="stats-commerce-openclaw__search" variant="light" onClick={() => void reload()} loading={loading}>查询</Button>
        </Group>

        <div className="stats-commerce-openclaw__table-wrap" style={{ overflowX: 'auto' }}>
          <Table className="stats-commerce-openclaw__table" striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead className="stats-commerce-openclaw__thead">
              <Table.Tr className="stats-commerce-openclaw__thead-row">
                <Table.Th className="stats-commerce-openclaw__th">用户</Table.Th>
                <Table.Th className="stats-commerce-openclaw__th">密钥</Table.Th>
                <Table.Th className="stats-commerce-openclaw__th">绑定关系</Table.Th>
                <Table.Th className="stats-commerce-openclaw__th">额度</Table.Th>
                <Table.Th className="stats-commerce-openclaw__th">到期时间</Table.Th>
                <Table.Th className="stats-commerce-openclaw__th">状态</Table.Th>
                <Table.Th className="stats-commerce-openclaw__th">描述</Table.Th>
                <Table.Th className="stats-commerce-openclaw__th">操作</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody className="stats-commerce-openclaw__tbody">
              {loading ? (
                <Table.Tr className="stats-commerce-openclaw__loading-row">
                  <Table.Td className="stats-commerce-openclaw__loading-cell" colSpan={8}>加载中...</Table.Td>
                </Table.Tr>
              ) : items.length === 0 ? (
                <Table.Tr className="stats-commerce-openclaw__empty-row">
                  <Table.Td className="stats-commerce-openclaw__empty-cell" colSpan={8}>暂无 OpenClaw 授权</Table.Td>
                </Table.Tr>
              ) : items.map((item) => {
                const user = userById.get(item.ownerId)
                return (
                  <Table.Tr className="stats-commerce-openclaw__row" key={item.id}>
                    <Table.Td className="stats-commerce-openclaw__cell">
                      <Stack className="stats-commerce-openclaw__user" gap={0}>
                        <Text className="stats-commerce-openclaw__user-login" size="sm" fw={600}>{user?.login || item.ownerId}</Text>
                        <Text className="stats-commerce-openclaw__user-email" size="xs" c="dimmed">{user?.email || item.ownerId}</Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td className="stats-commerce-openclaw__cell">
                      <Stack className="stats-commerce-openclaw__key" gap={0}>
                        <Text className="stats-commerce-openclaw__key-name" size="sm" fw={600}>{item.externalName}</Text>
                        <Text className="stats-commerce-openclaw__key-value" size="xs" c="dimmed">{item.externalKeyMasked || '—'}</Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td className="stats-commerce-openclaw__cell">
                      <Stack className="stats-commerce-openclaw__binding" gap={0}>
                        <Text className="stats-commerce-openclaw__binding-item" size="xs">订阅：{formatBindingValue(item.subscriptionId)}</Text>
                        <Text className="stats-commerce-openclaw__binding-item" size="xs">订单：{formatBindingValue(item.sourceOrderId)}</Text>
                        <Text className="stats-commerce-openclaw__binding-item" size="xs">商品：{formatBindingValue(item.productId)}</Text>
                        <Text className="stats-commerce-openclaw__binding-item" size="xs">SKU：{formatBindingValue(item.skuId)}</Text>
                        <Text className="stats-commerce-openclaw__binding-item" size="xs" c="dimmed">上游 Key ID：{formatBindingValue(item.upstreamKeyId)}</Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td className="stats-commerce-openclaw__cell">{item.quotaLimit}</Table.Td>
                    <Table.Td className="stats-commerce-openclaw__cell">{formatTime(item.expiredAt)}</Table.Td>
                    <Table.Td className="stats-commerce-openclaw__cell">{item.status}</Table.Td>
                    <Table.Td className="stats-commerce-openclaw__cell">
                      <Text className="stats-commerce-openclaw__description" size="xs" c="dimmed">{item.descriptionText || '—'}</Text>
                      {item.lastError ? <Text className="stats-commerce-openclaw__error" size="xs" c="red">{item.lastError}</Text> : null}
                    </Table.Td>
                    <Table.Td className="stats-commerce-openclaw__cell">
                      <Group className="stats-commerce-openclaw__cell-actions" gap={6} wrap="wrap">
                        <Button className="stats-commerce-openclaw__reset" size="xs" variant="subtle" loading={resettingId === item.id} onClick={() => void handleResetUsage(item)}>重置用量</Button>
                        <Button className="stats-commerce-openclaw__edit" size="xs" variant="light" onClick={() => openEdit(item)}>维护</Button>
                        <Button className="stats-commerce-openclaw__delete" size="xs" color="red" variant="light" loading={deletingId === item.id} onClick={() => void handleDelete(item)}>删除密钥</Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </div>
      </Stack>

      <Modal
        className="stats-commerce-openclaw__modal"
        opened={Boolean(editState)}
        onClose={() => setEditState(null)}
        title="维护 OpenClaw 授权"
        centered
        lockScroll={false}
      >
        {editState ? (
          <Stack className="stats-commerce-openclaw__modal-stack" gap="sm">
            <TextInput className="stats-commerce-openclaw__modal-user" label="用户" value={userById.get(editState.item.ownerId)?.login || editState.item.ownerId} readOnly />
            <TextInput className="stats-commerce-openclaw__modal-subscription" label="订阅 ID" value={formatBindingValue(editState.item.subscriptionId)} readOnly />
            <TextInput className="stats-commerce-openclaw__modal-upstream" label="上游 Key ID" value={formatBindingValue(editState.item.upstreamKeyId)} readOnly />
            <TextInput className="stats-commerce-openclaw__modal-quota" label="额度" value={editState.quotaLimit} onChange={(e) => setEditState((prev) => prev ? { ...prev, quotaLimit: e.currentTarget.value } : prev)} />
            <Select className="stats-commerce-openclaw__modal-status" label="目标状态" value={editState.desiredStatus} onChange={(value) => setEditState((prev) => prev ? { ...prev, desiredStatus: value === 'inactive' ? 'inactive' : 'active' } : prev)} data={[{ value: 'active', label: 'active' }, { value: 'inactive', label: 'inactive' }]} />
            <Textarea className="stats-commerce-openclaw__modal-description" label="描述文案" minRows={3} value={editState.descriptionText} onChange={(e) => setEditState((prev) => prev ? { ...prev, descriptionText: e.currentTarget.value } : prev)} />
            <Group className="stats-commerce-openclaw__modal-actions" justify="space-between">
              <Button className="stats-commerce-openclaw__modal-delete" color="red" variant="light" loading={deletingId === editState.item.id} onClick={() => void handleDelete(editState.item)}>删除密钥</Button>
              <Group className="stats-commerce-openclaw__modal-actions-right" gap={8}>
                <Button className="stats-commerce-openclaw__modal-cancel" variant="subtle" onClick={() => setEditState(null)}>取消</Button>
                <Button className="stats-commerce-openclaw__modal-save" onClick={() => void save()} loading={saving}>同步</Button>
              </Group>
            </Group>
          </Stack>
        ) : null}
      </Modal>
    </PanelCard>
  )
}
