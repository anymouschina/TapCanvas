import React from 'react'
import { Badge, Button, Group, Loader, Stack, Table, Text } from '@mantine/core'
import type { AdminLedgerEntryDto, AdminLedgerListResponseDto } from '../../api/server'

const SIGN_BY_TYPE: Record<string, '+' | '-'> = {
  deduct: '-',
  reserve: '-',
  release: '+',
  topup: '+',
}

const COLOR_BY_TYPE: Record<string, string> = {
  deduct: 'red',
  reserve: 'orange',
  release: 'teal',
  topup: 'grape',
}

function shortenId(id: string | null): string {
  if (!id) return '—'
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

function formatTime(iso: string): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toLocaleString() : iso
}

export default function UserCreditsLedgerTable({
  data,
  loading,
  loadingMore,
  onLoadMore,
  onRowClick,
}: {
  data: AdminLedgerListResponseDto | null
  loading: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onRowClick: (entry: AdminLedgerEntryDto) => void
}): JSX.Element {
  if (loading && !data) {
    return (
      <Group justify="center" py="md">
        <Loader size="sm" />
      </Group>
    )
  }
  if (!data || data.items.length === 0) {
    return <Text size="sm" c="dimmed">该用户暂无积分流水</Text>
  }
  return (
    <Stack gap="sm">
      <Table withTableBorder withColumnBorders highlightOnHover striped style={{ minWidth: 720 }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>时间</Table.Th>
            <Table.Th>类型</Table.Th>
            <Table.Th>积分</Table.Th>
            <Table.Th>task_kind</Table.Th>
            <Table.Th>task_id</Table.Th>
            <Table.Th>备注</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.items.map((r) => {
            const sign = SIGN_BY_TYPE[r.entryType] ?? ''
            const color = COLOR_BY_TYPE[r.entryType] ?? 'gray'
            const clickable = Boolean(r.taskId)
            return (
              <Table.Tr
                key={r.id}
                style={{ cursor: clickable ? 'pointer' : 'default' }}
                onClick={() => clickable && onRowClick(r)}
                title={clickable ? '查看任务日志' : '该流水未关联任务'}
              >
                <Table.Td>{formatTime(r.createdAt)}</Table.Td>
                <Table.Td>
                  <Badge color={color} variant="light" size="xs">{r.entryType}</Badge>
                </Table.Td>
                <Table.Td>
                  <Text fw={600} c={color}>{sign}{r.amount}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">{r.taskKind || '—'}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{shortenId(r.taskId)}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" lineClamp={1} title={r.note ?? ''}>{r.note || '—'}</Text>
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
      {data.nextCursor ? (
        <Group justify="center">
          <Button size="xs" variant="subtle" onClick={onLoadMore} loading={loadingMore}>加载更多</Button>
        </Group>
      ) : (
        <Text size="xs" c="dimmed" ta="center">已到底</Text>
      )}
    </Stack>
  )
}
