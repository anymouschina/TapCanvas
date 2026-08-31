import React from 'react'
import { TextInput } from '@mantine/core'
import type { ShotTableData } from '@tapcanvas/shot-table-protocol'

export type ShotTableOverviewProps = {
  className: string
  table: ShotTableData
  readOnly: boolean
  onChange: (key: string, value: string) => void
  onCommit: () => void
}

export const ShotTableOverview = React.memo(function ShotTableOverview({
  className,
  table,
  readOnly,
  onChange,
  onCommit,
}: ShotTableOverviewProps): JSX.Element {
  return (
    <div className={`tc-shot-table__overview ${className}`}>
      {Object.entries(table.overview).map(([key, value]) => (
        <label className="tc-shot-table__overview-field" key={key}>
          <span className="tc-shot-table__overview-label">{key}</span>
          <TextInput
            className="tc-shot-table__overview-input nodrag nopan nowheel"
            size="xs"
            value={value}
            readOnly={readOnly || key === '总镜数'}
            onChange={(event) => onChange(key, event.currentTarget.value)}
            onBlur={onCommit}
            aria-label={`镜头总览：${key}`}
          />
        </label>
      ))}
    </div>
  )
})
