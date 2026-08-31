import React from 'react'
import { Button } from '@mantine/core'

export type ShotTableRawEditorProps = {
  className: string
  value: string
  dirty: boolean
  readOnly: boolean
  onChange: (value: string) => void
  onApply: () => void
}

export const ShotTableRawEditor = React.memo(function ShotTableRawEditor({
  className,
  value,
  dirty,
  readOnly,
  onChange,
  onApply,
}: ShotTableRawEditorProps): JSX.Element {
  return (
    <div className={`tc-shot-table__raw ${className}`}>
      <textarea
        className="tc-shot-table__raw-input nodrag nopan nowheel"
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-label="分镜表原文"
      />
      {!readOnly ? (
        <Button
          className="tc-shot-table__raw-apply"
          size="compact-sm"
          variant="light"
          disabled={!dirty}
          onClick={onApply}
        >
          严格解析并保留当前版本
        </Button>
      ) : null}
    </div>
  )
})
