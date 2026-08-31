import React from 'react'
import { Button, Group, Select } from '@mantine/core'
import { IconHistory } from '@tabler/icons-react'
import type { ShotTableSnapshot } from './shotTableHistory'

export type ShotTableHistoryBarProps = {
  className: string
  snapshots: readonly ShotTableSnapshot[]
  selectedSnapshotId: string | null
  readOnly: boolean
  onSelect: (snapshotId: string | null) => void
  onRestore: () => void
}

export const ShotTableHistoryBar = React.memo(function ShotTableHistoryBar({
  className,
  snapshots,
  selectedSnapshotId,
  readOnly,
  onSelect,
  onRestore,
}: ShotTableHistoryBarProps): JSX.Element | null {
  if (snapshots.length === 0) return null
  return (
    <Group className={`tc-shot-table__history ${className}`} gap={6} wrap="nowrap">
      <IconHistory className="tc-shot-table__history-icon" size={14} />
      <Select
        className="tc-shot-table__history-select"
        size="xs"
        value={selectedSnapshotId}
        onChange={onSelect}
        data={snapshots.map((snapshot, index) => ({
          value: snapshot.id,
          label: `${index + 1}. ${snapshot.source} · ${new Date(snapshot.createdAt).toLocaleString()}`,
        }))}
        placeholder={`${snapshots.length} 个保留版本`}
        aria-label="选择历史版本"
      />
      <Button
        className="tc-shot-table__history-restore"
        size="compact-xs"
        variant="subtle"
        disabled={readOnly || !selectedSnapshotId}
        onClick={onRestore}
      >
        恢复并保留当前
      </Button>
    </Group>
  )
})
