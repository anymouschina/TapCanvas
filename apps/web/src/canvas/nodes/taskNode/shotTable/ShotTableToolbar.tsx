import React from 'react'
import { ActionIcon, Group, Tooltip } from '@mantine/core'
import {
  IconAt,
  IconColumns,
  IconCopy,
  IconDownload,
  IconPlus,
  IconRowInsertBottom,
  IconScissors,
  IconSparkles,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'

export type ShotTableToolbarProps = {
  className: string
  readOnly: boolean
  hasSelectedRow: boolean
  hasSelectedColumn: boolean
  hasActiveCell: boolean
  canDeleteRow: boolean
  assetBindingsValid: boolean
  columnsOpen: boolean
  scriptOpen: boolean
  assetPickerOpen: boolean
  splitDisabled: boolean
  splitTooltip: string
  onAddTimeline: () => void
  onAddShot: () => void
  onDuplicateRow: () => void
  onDeleteRow: () => void
  onToggleColumns: () => void
  onToggleAssets: () => void
  onSplit: () => void
  onToggleScript: () => void
  onExport: () => void
  onImport: (file: File | null) => void
}

export const ShotTableToolbar = React.memo(function ShotTableToolbar({
  className,
  readOnly,
  hasSelectedRow,
  hasSelectedColumn,
  hasActiveCell,
  canDeleteRow,
  assetBindingsValid,
  columnsOpen,
  scriptOpen,
  assetPickerOpen,
  splitDisabled,
  splitTooltip,
  onAddTimeline,
  onAddShot,
  onDuplicateRow,
  onDeleteRow,
  onToggleColumns,
  onToggleAssets,
  onSplit,
  onToggleScript,
  onExport,
  onImport,
}: ShotTableToolbarProps): JSX.Element {
  const importInputRef = React.useRef<HTMLInputElement>(null)
  return (
    <div className={`tc-shot-table__toolbar ${className}`}>
      <Group className="tc-shot-table__toolbar-group" gap={2} wrap="nowrap">
        <Tooltip className="tc-shot-table__tooltip" label="同镜头增加时序行">
          <ActionIcon className="tc-shot-table__icon-button" variant="subtle" size="sm" disabled={readOnly || !hasSelectedRow} onClick={onAddTimeline} aria-label="同镜头增加时序行">
            <IconRowInsertBottom className="tc-shot-table__icon" size={15} />
          </ActionIcon>
        </Tooltip>
        <Tooltip className="tc-shot-table__tooltip" label="增加新镜头">
          <ActionIcon className="tc-shot-table__icon-button" variant="subtle" size="sm" disabled={readOnly} onClick={onAddShot} aria-label="增加新镜头">
            <IconPlus className="tc-shot-table__icon" size={15} />
          </ActionIcon>
        </Tooltip>
        <Tooltip className="tc-shot-table__tooltip" label="复制当前时序行">
          <ActionIcon className="tc-shot-table__icon-button" variant="subtle" size="sm" disabled={readOnly || !hasSelectedRow} onClick={onDuplicateRow} aria-label="复制当前时序行">
            <IconCopy className="tc-shot-table__icon" size={15} />
          </ActionIcon>
        </Tooltip>
        <Tooltip className="tc-shot-table__tooltip" label="删除当前时序行">
          <ActionIcon className="tc-shot-table__icon-button" color="red" variant="subtle" size="sm" disabled={readOnly || !hasSelectedRow || !canDeleteRow} onClick={onDeleteRow} aria-label="删除当前时序行">
            <IconTrash className="tc-shot-table__icon" size={15} />
          </ActionIcon>
        </Tooltip>
        <Tooltip className="tc-shot-table__tooltip" label="列设置">
          <ActionIcon className="tc-shot-table__icon-button" variant={columnsOpen ? 'light' : 'subtle'} size="sm" onClick={onToggleColumns} aria-label="列设置">
            <IconColumns className="tc-shot-table__icon" size={15} />
          </ActionIcon>
        </Tooltip>
        <Tooltip className="tc-shot-table__tooltip" label="在当前单元格插入真实素材引用">
          <ActionIcon
            className="tc-shot-table__icon-button"
            variant={assetPickerOpen ? 'light' : 'subtle'}
            size="sm"
            disabled={readOnly || !hasSelectedRow || !hasSelectedColumn || !hasActiveCell || !assetBindingsValid}
            onClick={onToggleAssets}
            aria-label="插入素材引用"
          >
            <IconAt className="tc-shot-table__icon" size={15} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Group className="tc-shot-table__toolbar-group" gap={2} wrap="nowrap">
        <Tooltip className="tc-shot-table__tooltip" label={splitTooltip}>
          <span className="tc-shot-table__tooltip-target">
            <ActionIcon
              className="tc-shot-table__icon-button"
              variant="subtle"
              size="sm"
              disabled={splitDisabled}
              onClick={onSplit}
              aria-label="均匀拆分为不超过 15 秒的独立分镜表"
            >
              <IconScissors className="tc-shot-table__icon" size={15} />
            </ActionIcon>
          </span>
        </Tooltip>
        <Tooltip className="tc-shot-table__tooltip" label="剧本转分镜">
          <ActionIcon className="tc-shot-table__icon-button" variant={scriptOpen ? 'light' : 'subtle'} size="sm" disabled={readOnly} onClick={onToggleScript} aria-label="剧本转分镜">
            <IconSparkles className="tc-shot-table__icon" size={15} />
          </ActionIcon>
        </Tooltip>
        <Tooltip className="tc-shot-table__tooltip" label="导出 Excel">
          <ActionIcon className="tc-shot-table__icon-button" variant="subtle" size="sm" onClick={onExport} aria-label="导出 Excel">
            <IconDownload className="tc-shot-table__icon" size={15} />
          </ActionIcon>
        </Tooltip>
        <Tooltip className="tc-shot-table__tooltip" label="导入 Excel 并保留当前版本">
          <ActionIcon className="tc-shot-table__icon-button" variant="subtle" size="sm" disabled={readOnly} onClick={() => importInputRef.current?.click()} aria-label="导入 Excel">
            <IconUpload className="tc-shot-table__icon" size={15} />
          </ActionIcon>
        </Tooltip>
        <input
          className="tc-shot-table__file-input"
          ref={importInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => {
            onImport(event.currentTarget.files?.[0] ?? null)
            event.currentTarget.value = ''
          }}
        />
      </Group>
    </div>
  )
})
