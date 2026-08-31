import React from 'react'
import { Badge, Code, Collapse, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import type { AdminTaskLogBundleDto } from '../../api/server'

function formatTime(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toLocaleString() : iso
}

function statusColor(status: string): string {
  if (status === 'succeeded') return 'green'
  if (status === 'failed') return 'red'
  return 'blue'
}

function StatusRow({ s }: { s: AdminTaskLogBundleDto['statuses'][number] }): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const hasData = s.data !== null && s.data !== undefined
  return (
    <Stack gap={2} pl="xs" style={{ borderLeft: '2px solid var(--mantine-color-gray-3)' }}>
      <Group gap={6} align="center">
        <Badge size="xs" variant="light" color={statusColor(s.status)}>{s.status}</Badge>
        <Text size="xs" c="dimmed">{s.provider}</Text>
        <Text size="xs" c="dimmed">{formatTime(s.createdAt)}</Text>
        {hasData ? (
          <UnstyledButton onClick={() => setOpen((v) => !v)}>
            <Group gap={2}>
              {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              <Text size="xs" c="dimmed">data</Text>
            </Group>
          </UnstyledButton>
        ) : null}
      </Group>
      {hasData ? (
        <Collapse in={open}>
          <Code block style={{ maxHeight: 220, overflow: 'auto', fontSize: 11 }}>
            {JSON.stringify(s.data, null, 2)}
          </Code>
        </Collapse>
      ) : null}
    </Stack>
  )
}

export default function TaskLogStatusTimeline({ bundle }: { bundle: AdminTaskLogBundleDto }): JSX.Element {
  if (bundle.statuses.length === 0) {
    return <Text size="sm" c="dimmed">无状态记录</Text>
  }
  return (
    <Stack gap="xs">
      {bundle.statuses.map((s) => <StatusRow key={s.id} s={s} />)}
    </Stack>
  )
}
