import React from 'react'
import { ActionIcon, Badge, Code, Collapse, Group, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core'
import { IconChevronDown, IconChevronRight, IconCopy } from '@tabler/icons-react'
import type { AdminTaskLogBundleDto } from '../../api/server'

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toLocaleString() : iso
}

function statusColor(status: string): string {
  if (status === 'succeeded') return 'green'
  if (status === 'failed') return 'red'
  return 'blue'
}

async function copyJson(value: unknown): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2))
  } catch {
    // ignore
  }
}

function VendorCallRow({ call }: { call: AdminTaskLogBundleDto['vendorCalls'][number] }): JSX.Element {
  const [open, setOpen] = React.useState(false)
  return (
    <Stack gap={4} p="xs" style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 6 }}>
      <Group gap={6} align="center" wrap="wrap">
        <Badge size="xs" variant="light" color={statusColor(call.status)}>{call.status}</Badge>
        <Text size="xs" c="dimmed">{call.vendor}</Text>
        <Text size="xs" c="dimmed">{formatTime(call.startedAt)} → {formatTime(call.finishedAt)}</Text>
        {typeof call.durationMs === 'number' ? <Text size="xs" c="dimmed">{call.durationMs} ms</Text> : null}
      </Group>
      {call.errorMessage ? <Text size="xs" c="red">{call.errorMessage}</Text> : null}
      <UnstyledButton onClick={() => setOpen((v) => !v)}>
        <Group gap={2}>
          {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          <Text size="xs" c="dimmed">request / response</Text>
        </Group>
      </UnstyledButton>
      <Collapse in={open}>
        <Stack gap={6}>
          <Group gap={4} align="center">
            <Text size="xs" c="dimmed">request</Text>
            <Tooltip label="复制" withArrow>
              <ActionIcon size="xs" variant="subtle" onClick={() => void copyJson(call.requestJson)}>
                <IconCopy size={12} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Code block style={{ maxHeight: 180, overflow: 'auto', fontSize: 11 }}>
            {JSON.stringify(call.requestJson, null, 2)}
          </Code>
          <Group gap={4} align="center">
            <Text size="xs" c="dimmed">response</Text>
            <Tooltip label="复制" withArrow>
              <ActionIcon size="xs" variant="subtle" onClick={() => void copyJson(call.responseJson)}>
                <IconCopy size={12} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Code block style={{ maxHeight: 220, overflow: 'auto', fontSize: 11 }}>
            {JSON.stringify(call.responseJson, null, 2)}
          </Code>
        </Stack>
      </Collapse>
    </Stack>
  )
}

export default function TaskLogVendorCalls({ bundle }: { bundle: AdminTaskLogBundleDto }): JSX.Element {
  if (bundle.vendorCalls.length === 0) {
    return <Text size="sm" c="dimmed">该任务无原始厂商调用记录</Text>
  }
  return (
    <Stack gap="xs">
      {bundle.vendorCalls.map((c, i) => <VendorCallRow key={c.rowId ?? `${c.vendor}-${i}`} call={c} />)}
    </Stack>
  )
}
