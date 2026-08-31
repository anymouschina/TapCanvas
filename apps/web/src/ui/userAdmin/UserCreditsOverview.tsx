import React from 'react'
import { Badge, Group, Paper, Stack, Table, Text, Title } from '@mantine/core'
import type { AdminUserCreditsOverviewDto } from '../../api/server'

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return Math.max(0, Math.trunc(n)).toLocaleString()
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }): JSX.Element {
  return (
    <Paper className="user-credits-stat" p="sm" radius="md" withBorder style={{ flex: 1, minWidth: 110 }}>
      <Stack gap={2}>
        <Text size="xs" c="dimmed">{label}</Text>
        <Text size="lg" fw={700} c={color}>{formatNumber(value)}</Text>
      </Stack>
    </Paper>
  )
}

export default function UserCreditsOverview({
  data,
  loading,
}: {
  data: AdminUserCreditsOverviewDto | null
  loading: boolean
}): JSX.Element {
  if (loading && !data) {
    return <Text size="sm" c="dimmed">加载中…</Text>
  }
  if (!data) {
    return <Text size="sm" c="dimmed">暂无数据</Text>
  }
  return (
    <Stack gap="sm">
      <Group gap="sm" wrap="wrap">
        <StatCard label="累计消耗" value={data.totals.deductTotal} color="gray" />
        <StatCard label="本月消耗" value={data.totals.deductMonth} />
        <StatCard label="今日消耗" value={data.totals.deductToday} />
        <StatCard label="冻结中" value={data.totals.frozenNow} color="yellow" />
      </Group>

      <Stack gap={4}>
        <Group gap={6} align="center">
          <Title order={6}>按任务类型分组</Title>
          <Badge size="xs" variant="light" color="gray">仅 deduct · {formatNumber(data.totals.countTotal)} 笔</Badge>
        </Group>
        {data.byTaskKind.length === 0 ? (
          <Text size="xs" c="dimmed">无消耗记录</Text>
        ) : (
          <Table withTableBorder withColumnBorders striped style={{ minWidth: 320 }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>任务类型</Table.Th>
                <Table.Th>次数</Table.Th>
                <Table.Th>合计积分</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.byTaskKind.map((r) => (
                <Table.Tr key={r.taskKind || '__empty__'}>
                  <Table.Td>{r.taskKind || <Text c="dimmed" size="xs">未标记</Text>}</Table.Td>
                  <Table.Td>{formatNumber(r.count)}</Table.Td>
                  <Table.Td>{formatNumber(r.amount)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Stack>
  )
}
