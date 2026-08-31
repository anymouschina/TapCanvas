import React from 'react'
import { ActionIcon, Badge, Group, Loader, Pagination, Select, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { IconRefresh, IconRestore, IconSearch } from '@tabler/icons-react'
import { listAdminCreditGrants, type AdminCreditGrantQuery, type AdminCreditGrantRecordDto } from '../../api/server'
import { toast } from '../toast'
import { assertAdminRecordTimeRange, formatAdminRecordTime, localDateTimeToIso } from './adminRecordFormatters'
import './AdminUserRecordTables.css'

type GrantType = NonNullable<AdminCreditGrantQuery['grantType']>
type GrantFilters = { q: string; grantType: GrantType | null; from: string; to: string }

const EMPTY_FILTERS: GrantFilters = { q: '', grantType: null, from: '', to: '' }
const PAGE_SIZE = 20
const GRANT_TYPE_OPTIONS = [
  { value: 'monthly', label: '月度额度' },
  { value: 'daily', label: '每日赠送' },
] satisfies Array<{ value: GrantType; label: string }>

function isGrantType(value: string | null): value is GrantType {
  return GRANT_TYPE_OPTIONS.some((option) => option.value === value)
}

function grantTypeLabel(value: GrantType): string {
  return GRANT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value
}

function expirationLabel(item: AdminCreditGrantRecordDto): { label: string; color: string } {
  if (!item.expiresAt) return { label: '长期有效', color: 'gray' }
  if (item.expiredAmount >= item.amount) return { label: '已过期', color: 'gray' }
  if (item.expiredAmount > 0) return { label: '部分过期', color: 'orange' }
  return { label: '有效期内', color: 'green' }
}

function subscriptionLabel(item: AdminCreditGrantRecordDto): string {
  if (!item.subscriptionId) return '非订阅发放'
  if (item.subscriptionStatus === 'expired') return `已到期 · ${item.subscriptionId}`
  if (item.subscriptionStatus === 'canceled') return `已取消 · ${item.subscriptionId}`
  return `生效中 · ${item.subscriptionId}`
}

function CreditGrantRow({ item }: { item: AdminCreditGrantRecordDto }): JSX.Element {
  const expiration = expirationLabel(item)
  const subscription = subscriptionLabel(item)
  const badgeColor = item.grantType === 'monthly' ? 'blue' : 'teal'
  return (
    <Table.Tr className="admin-records-table__row">
      <Table.Td className="admin-records-table__cell admin-records-table__cell--user">
        <Text className="admin-records-table__primary" size="xs" fw={600} truncate title={item.userLogin}>{item.userLogin}</Text>
        <Text className="admin-records-table__secondary" size="xs" c="dimmed" truncate title={item.userEmail ?? item.ownerId}>{item.userEmail ?? item.ownerId}</Text>
      </Table.Td>
      <Table.Td className="admin-records-table__cell admin-records-table__cell--plan">
		<Text className="admin-records-table__primary" size="xs" fw={600} truncate title={item.planCode ?? '会员额度'}>{item.planCode ?? '会员额度'}</Text>
		<Text className="admin-records-table__secondary admin-records-table__mono" size="xs" c="dimmed" truncate title={subscription}>{subscription}</Text>
      </Table.Td>
      <Table.Td className="admin-records-table__cell admin-records-table__cell--status">
        <Badge className="admin-records-table__badge" size="xs" variant="light" color={badgeColor}>{grantTypeLabel(item.grantType)}</Badge>
      </Table.Td>
      <Table.Td className="admin-records-table__cell admin-records-table__cell--number">
        <Text className="admin-records-table__amount" size="xs" fw={600}>+{item.amount}</Text>
      </Table.Td>
      <Table.Td className="admin-records-table__cell admin-records-table__cell--time">
        <Text className="admin-records-table__time" size="xs">{formatAdminRecordTime(item.grantedAt)}</Text>
      </Table.Td>
      <Table.Td className="admin-records-table__cell admin-records-table__cell--time">
        <Text className="admin-records-table__time" size="xs">{formatAdminRecordTime(item.expiresAt)}</Text>
      </Table.Td>
      <Table.Td className="admin-records-table__cell admin-records-table__cell--status">
        <Badge className="admin-records-table__badge" size="xs" variant="light" color={expiration.color}>{expiration.label}</Badge>
        {item.expiredAmount > 0 ? <Text className="admin-records-table__secondary" size="xs" c="dimmed">{item.expiredAmount} 积分</Text> : null}
      </Table.Td>
      <Table.Td className="admin-records-table__cell admin-records-table__cell--order">
        <Text className="admin-records-table__mono" size="xs" truncate title={item.grantKey}>{item.grantKey}</Text>
      </Table.Td>
    </Table.Tr>
  )
}

export default function AdminCreditGrantRecords(): JSX.Element {
  const [filters, setFilters] = React.useState<GrantFilters>(EMPTY_FILTERS)
  const [query, setQuery] = React.useState<AdminCreditGrantQuery>({})
  const [page, setPage] = React.useState(1)
  const [items, setItems] = React.useState<AdminCreditGrantRecordDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const reload = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const response = await listAdminCreditGrants({ ...query, page, pageSize: PAGE_SIZE })
      setItems(response.items)
      setTotal(response.total)
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : '加载积分发放记录失败'
      setItems([])
      setTotal(0)
      setError(message)
      toast(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [page, query])

  React.useEffect(() => { void reload() }, [reload])

  const applyFilters = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    try {
      const from = localDateTimeToIso(filters.from)
      const to = localDateTimeToIso(filters.to)
      assertAdminRecordTimeRange(from, to)
      setPage(1)
      setQuery({
        ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
        ...(filters.grantType ? { grantType: filters.grantType } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      })
    } catch (reason: unknown) {
      toast(reason instanceof Error ? reason.message : '查询条件不正确', 'error')
    }
  }

  const resetFilters = (): void => {
    setFilters(EMPTY_FILTERS)
    setPage(1)
    setQuery({})
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const start = total ? (page - 1) * PAGE_SIZE + 1 : 0
  const end = total ? Math.min(total, page * PAGE_SIZE) : 0

  return (
    <Stack className="admin-records" gap={8}>
      <form className="admin-records-filter admin-records-filter--grants" onSubmit={applyFilters}>
        <TextInput className="admin-records-filter__keyword" size="xs" value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.currentTarget.value }))} placeholder="用户 / 套餐 / 发放编号" leftSection={<IconSearch className="admin-records-filter__search-icon" size={13} />} />
        <Select className="admin-records-filter__select" size="xs" clearable value={filters.grantType} data={GRANT_TYPE_OPTIONS} onChange={(value) => setFilters((current) => ({ ...current, grantType: isGrantType(value) ? value : null }))} placeholder="发放类型" />
        <TextInput className="admin-records-filter__date" size="xs" type="datetime-local" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.currentTarget.value }))} aria-label="发放开始时间" />
        <Text className="admin-records-filter__range-separator" size="xs" c="dimmed">至</Text>
        <TextInput className="admin-records-filter__date" size="xs" type="datetime-local" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.currentTarget.value }))} aria-label="发放结束时间" />
        <Group className="admin-records-filter__actions" gap={2} wrap="nowrap">
          <Tooltip className="admin-records-filter__tooltip" label="查询" withArrow><ActionIcon className="admin-records-filter__action" type="submit" size="sm" variant="light" aria-label="查询积分发放记录"><IconSearch className="admin-records-filter__action-icon" size={14} /></ActionIcon></Tooltip>
          <Tooltip className="admin-records-filter__tooltip" label="清空条件" withArrow><ActionIcon className="admin-records-filter__action" type="button" size="sm" variant="subtle" aria-label="清空查询条件" onClick={resetFilters}><IconRestore className="admin-records-filter__action-icon" size={14} /></ActionIcon></Tooltip>
          <Tooltip className="admin-records-filter__tooltip" label="刷新" withArrow><ActionIcon className="admin-records-filter__action" type="button" size="sm" variant="subtle" aria-label="刷新积分发放记录" loading={loading} onClick={() => void reload()}><IconRefresh className="admin-records-filter__action-icon" size={14} /></ActionIcon></Tooltip>
        </Group>
      </form>

      <div className="admin-records-table-wrap">
        <Table className="admin-records-table" stickyHeader striped highlightOnHover verticalSpacing={0} horizontalSpacing="xs">
          <Table.Thead className="admin-records-table__head"><Table.Tr className="admin-records-table__head-row">
            <Table.Th className="admin-records-table__head-cell admin-records-table__head-cell--user">用户</Table.Th><Table.Th className="admin-records-table__head-cell admin-records-table__head-cell--plan">套餐 / 订阅</Table.Th><Table.Th className="admin-records-table__head-cell admin-records-table__head-cell--status">类型</Table.Th><Table.Th className="admin-records-table__head-cell admin-records-table__head-cell--number">积分</Table.Th><Table.Th className="admin-records-table__head-cell admin-records-table__head-cell--time">发放时间</Table.Th><Table.Th className="admin-records-table__head-cell admin-records-table__head-cell--time">失效时间</Table.Th><Table.Th className="admin-records-table__head-cell admin-records-table__head-cell--status">有效状态</Table.Th><Table.Th className="admin-records-table__head-cell admin-records-table__head-cell--order">来源</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody className="admin-records-table__body">
            {loading && !items.length ? <Table.Tr className="admin-records-table__state-row"><Table.Td className="admin-records-table__state-cell" colSpan={8}><Group className="admin-records-table__state" justify="center" gap={6}><Loader className="admin-records-table__loader" size="xs" /><Text className="admin-records-table__state-text" size="xs" c="dimmed">正在加载发放记录</Text></Group></Table.Td></Table.Tr> : null}
            {!loading && !items.length ? <Table.Tr className="admin-records-table__state-row"><Table.Td className="admin-records-table__state-cell" colSpan={8}><Text className="admin-records-table__state-text" size="xs" c={error ? 'red' : 'dimmed'} ta="center">{error ?? '没有符合条件的积分发放记录'}</Text></Table.Td></Table.Tr> : null}
            {items.map((item) => <CreditGrantRow key={item.id} item={item} />)}
          </Table.Tbody>
        </Table>
      </div>

      <Group className="admin-records-footer" justify="space-between" align="center" wrap="nowrap">
        <Text className="admin-records-footer__summary" size="xs" c="dimmed">{total ? `${start}-${end} / ${total} 条` : '0 条记录'}</Text>
        {totalPages > 1 ? <Pagination className="admin-records-footer__pagination" size="xs" value={page} total={totalPages} onChange={setPage} withEdges /> : <span className="admin-records-footer__spacer" />}
      </Group>
    </Stack>
  )
}
