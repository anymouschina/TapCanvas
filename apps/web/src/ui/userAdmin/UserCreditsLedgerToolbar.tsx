import React from 'react'
import { ActionIcon, Group, MultiSelect, TextInput, Tooltip } from '@mantine/core'
import { IconRefresh, IconSearch } from '@tabler/icons-react'

export type LedgerFilters = {
  entryTypes: string[]
  taskIdLike: string
  since: string
  until: string
}

const ENTRY_TYPE_OPTIONS = [
  { value: 'deduct', label: '消耗 deduct' },
  { value: 'reserve', label: '预冻 reserve' },
  { value: 'release', label: '释放 release' },
  { value: 'topup', label: '管理员分配 topup' },
]

export default function UserCreditsLedgerToolbar({
  filters,
  onChange,
  onReload,
  loading,
}: {
  filters: LedgerFilters
  onChange: (next: LedgerFilters) => void
  onReload: () => void
  loading: boolean
}): JSX.Element {
  return (
    <Group gap={8} align="end" wrap="wrap">
      <MultiSelect
        label="类型"
        data={ENTRY_TYPE_OPTIONS}
        value={filters.entryTypes}
        onChange={(v) => onChange({ ...filters, entryTypes: v })}
        size="xs"
        clearable
        w={260}
      />
      <TextInput
        label="task_id 包含"
        value={filters.taskIdLike}
        onChange={(e) => onChange({ ...filters, taskIdLike: e.currentTarget.value })}
        size="xs"
        leftSection={<IconSearch size={12} />}
        w={200}
      />
      <TextInput
        label="起始 (ISO)"
        value={filters.since}
        onChange={(e) => onChange({ ...filters, since: e.currentTarget.value })}
        placeholder="2026-05-01T00:00:00Z"
        size="xs"
        w={200}
      />
      <TextInput
        label="结束 (ISO)"
        value={filters.until}
        onChange={(e) => onChange({ ...filters, until: e.currentTarget.value })}
        placeholder="2026-05-31T23:59:59Z"
        size="xs"
        w={200}
      />
      <Tooltip label="刷新" withArrow>
        <ActionIcon size="lg" variant="subtle" onClick={onReload} loading={loading} aria-label="刷新">
          <IconRefresh size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}
