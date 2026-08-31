import React from 'react'
import { Avatar, Drawer, Group, Stack, Text, Title } from '@mantine/core'
import {
  fetchAdminUserCredits,
  fetchAdminUserCreditsLedger,
  type AdminLedgerEntryDto,
  type AdminLedgerListResponseDto,
  type AdminUserCreditsOverviewDto,
  type AdminUserDto,
} from '../../api/server'
import UserCreditsOverview from './UserCreditsOverview'
import UserCreditsLedgerToolbar, { type LedgerFilters } from './UserCreditsLedgerToolbar'
import UserCreditsLedgerTable from './UserCreditsLedgerTable'
import TaskLogDrawer from './TaskLogDrawer'

const DEFAULT_FILTERS: LedgerFilters = {
  entryTypes: ['deduct'],
  taskIdLike: '',
  since: '',
  until: '',
}

const PAGE_SIZE = 20

export default function UserCreditsDrawer({
  opened,
  user,
  onClose,
}: {
  opened: boolean
  user: AdminUserDto | null
  onClose: () => void
}): JSX.Element {
  const userId = user?.id ?? null

  const [overview, setOverview] = React.useState<AdminUserCreditsOverviewDto | null>(null)
  const [overviewLoading, setOverviewLoading] = React.useState(false)
  const [ledger, setLedger] = React.useState<AdminLedgerListResponseDto | null>(null)
  const [ledgerLoading, setLedgerLoading] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [filters, setFilters] = React.useState<LedgerFilters>(DEFAULT_FILTERS)

  const [taskLogOpen, setTaskLogOpen] = React.useState(false)
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null)

  const reloadOverview = React.useCallback(async (uid: string) => {
    setOverviewLoading(true)
    try {
      const data = await fetchAdminUserCredits(uid)
      setOverview(data)
    } catch (err) {
      console.error('fetch credits overview failed', err)
      setOverview(null)
    } finally {
      setOverviewLoading(false)
    }
  }, [])

  const reloadLedger = React.useCallback(async (uid: string, f: LedgerFilters) => {
    setLedgerLoading(true)
    try {
      const data = await fetchAdminUserCreditsLedger(uid, {
        entryTypes: f.entryTypes,
        taskIdLike: f.taskIdLike,
        since: f.since,
        until: f.until,
        limit: PAGE_SIZE,
      })
      setLedger(data)
    } catch (err) {
      console.error('fetch ledger failed', err)
      setLedger({ items: [], nextCursor: null })
    } finally {
      setLedgerLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!opened || !userId) return
    setFilters(DEFAULT_FILTERS)
    void reloadOverview(userId)
    void reloadLedger(userId, DEFAULT_FILTERS)
  }, [opened, userId, reloadOverview, reloadLedger])

  const onFiltersChange = (next: LedgerFilters) => {
    setFilters(next)
    if (userId) void reloadLedger(userId, next)
  }

  const onLoadMore = async () => {
    if (!userId || !ledger?.nextCursor) return
    setLoadingMore(true)
    try {
      const more = await fetchAdminUserCreditsLedger(userId, {
        entryTypes: filters.entryTypes,
        taskIdLike: filters.taskIdLike,
        since: filters.since,
        until: filters.until,
        cursor: ledger.nextCursor.id,
        cursorAt: ledger.nextCursor.createdAt,
        limit: PAGE_SIZE,
      })
      setLedger({
        items: [...ledger.items, ...more.items],
        nextCursor: more.nextCursor,
      })
    } catch (err) {
      console.error('load more ledger failed', err)
    } finally {
      setLoadingMore(false)
    }
  }

  const onRowClick = (entry: AdminLedgerEntryDto) => {
    if (!entry.taskId) return
    setSelectedTaskId(entry.taskId)
    setTaskLogOpen(true)
  }

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={560}
      title={
        user ? (
          <Group gap={10} align="center">
            <Avatar src={user.avatarUrl || undefined} size={28} radius="md">
              {(user.login || '?').slice(0, 1).toUpperCase()}
            </Avatar>
            <Stack gap={0}>
              <Title order={5}>{user.login}</Title>
              <Text className="user-credits-drawer__account" size="xs" c="dimmed">{user.accountName || user.accountId || '—'}</Text>
            </Stack>
          </Group>
        ) : (
          <Title order={5}>用户积分日志</Title>
        )
      }
    >
      <Stack gap="md">
        <UserCreditsOverview data={overview} loading={overviewLoading} />
        <UserCreditsLedgerToolbar
          filters={filters}
          onChange={onFiltersChange}
          onReload={() => userId && reloadLedger(userId, filters)}
          loading={ledgerLoading}
        />
        <UserCreditsLedgerTable
          data={ledger}
          loading={ledgerLoading}
          loadingMore={loadingMore}
          onLoadMore={onLoadMore}
          onRowClick={onRowClick}
        />
      </Stack>

      <TaskLogDrawer
        opened={taskLogOpen}
        userId={userId}
        taskId={selectedTaskId}
        onClose={() => setTaskLogOpen(false)}
      />
    </Drawer>
  )
}
