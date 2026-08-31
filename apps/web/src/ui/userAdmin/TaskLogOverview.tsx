import React from 'react'
import { Badge, Group, Paper, Stack, Text, Title } from '@mantine/core'
import type { AdminTaskLogBundleDto } from '../../api/server'

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toLocaleString() : iso
}

function diffMs(a: string | null, b: string | null): string {
  if (!a || !b) return '—'
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return '—'
  return `${Math.max(0, tb - ta)} ms`
}

function statusColor(status: string | null): string {
  if (status === 'succeeded') return 'green'
  if (status === 'failed') return 'red'
  return 'blue'
}

export default function TaskLogOverview({ bundle }: { bundle: AdminTaskLogBundleDto }): JSX.Element {
  const r = bundle.result
  return (
    <Paper p="sm" radius="md" withBorder>
      <Stack gap="xs">
        <Group gap={6} align="center" wrap="wrap">
          <Title order={6}>任务概览</Title>
          {r?.status ? (
            <Badge size="xs" variant="light" color={statusColor(r.status)}>{r.status}</Badge>
          ) : (
            <Badge size="xs" color="gray" variant="light">无最终结果</Badge>
          )}
          {r?.vendor ? <Badge size="xs" variant="light" color="gray">{r.vendor}</Badge> : null}
          {r?.kind ? <Badge size="xs" variant="light" color="gray">{r.kind}</Badge> : null}
        </Group>
        <Group gap="lg" wrap="wrap">
          <Stack gap={2}><Text size="xs" c="dimmed">实际计费</Text><Text fw={700}>{bundle.credits.deducted}</Text></Stack>
          <Stack gap={2}><Text size="xs" c="dimmed">预冻</Text><Text>{bundle.credits.reserved}</Text></Stack>
          <Stack gap={2}><Text size="xs" c="dimmed">已释放</Text><Text>{bundle.credits.released}</Text></Stack>
          <Stack gap={2}><Text size="xs" c="dimmed">未结算</Text><Text c={bundle.credits.pending > 0 ? 'orange' : undefined}>{bundle.credits.pending}</Text></Stack>
        </Group>
        <Group gap="lg" wrap="wrap">
          <Text size="xs" c="dimmed">完成于 {formatTime(r?.completedAt ?? null)}</Text>
          <Text size="xs" c="dimmed">更新于 {formatTime(r?.updatedAt ?? null)}</Text>
          <Text size="xs" c="dimmed">total {diffMs(r?.completedAt ?? null, r?.updatedAt ?? null)}</Text>
        </Group>
      </Stack>
    </Paper>
  )
}
