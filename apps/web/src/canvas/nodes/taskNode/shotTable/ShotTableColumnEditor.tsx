import React from 'react'
import { ActionIcon, Button, Group, Select, Text, TextInput, Tooltip } from '@mantine/core'
import { IconColumnInsertRight, IconTrash, IconX } from '@tabler/icons-react'
import type { ShotTableColumn, ShotTableColumnScope } from '@tapcanvas/shot-table-protocol'

export type ShotTableColumnEditorProps = {
  className: string
  selectedColumn: ShotTableColumn | null
  readOnly: boolean
  onClose: () => void
  onAdd: (label: string, scope: ShotTableColumnScope) => void
  onRename: (columnKey: string, label: string) => void
  onScopeChange: (columnKey: string, scope: ShotTableColumnScope) => void
  onDelete: (columnKey: string) => void
}

const SCOPE_OPTIONS = [
  { value: 'shot', label: '镜头列' },
  { value: 'timeline', label: '时序列' },
] as const

export function ShotTableColumnEditor({
  className,
  selectedColumn,
  readOnly,
  onClose,
  onAdd,
  onRename,
  onScopeChange,
  onDelete,
}: ShotTableColumnEditorProps): JSX.Element {
  const [newLabel, setNewLabel] = React.useState('')
  const [newScope, setNewScope] = React.useState<ShotTableColumnScope>('shot')
  const [renameDraft, setRenameDraft] = React.useState(selectedColumn?.label ?? '')

  React.useEffect(() => setRenameDraft(selectedColumn?.label ?? ''), [selectedColumn?.key, selectedColumn?.label])

  return (
    <section className={`tc-shot-table-columns nodrag nopan nowheel ${className}`} aria-label="分镜表列设置">
      <div className="tc-shot-table-columns__header">
        <Text className="tc-shot-table-columns__title" size="xs" fw={650}>列设置</Text>
        <Tooltip className="tc-shot-table-columns__tooltip" label="关闭">
          <ActionIcon className="tc-shot-table-columns__icon-button" variant="subtle" size="xs" onClick={onClose} aria-label="关闭列设置">
            <IconX className="tc-shot-table-columns__icon" size={14} />
          </ActionIcon>
        </Tooltip>
      </div>
      <Group className="tc-shot-table-columns__row" gap={6} wrap="nowrap">
        <TextInput
          className="tc-shot-table-columns__input"
          size="xs"
          value={newLabel}
          disabled={readOnly}
          onChange={(event) => setNewLabel(event.currentTarget.value)}
          placeholder="新列名"
          aria-label="新列名"
        />
        <Select
          className="tc-shot-table-columns__scope-select"
          size="xs"
          value={newScope}
          data={SCOPE_OPTIONS.map((option) => ({ ...option }))}
          disabled={readOnly}
          allowDeselect={false}
          onChange={(value) => {
            if (value === 'shot' || value === 'timeline') setNewScope(value)
          }}
          aria-label="新列作用域"
        />
        <Tooltip className="tc-shot-table-columns__tooltip" label="添加列">
          <ActionIcon
            className="tc-shot-table-columns__icon-button"
            variant="light"
            size="sm"
            disabled={readOnly || !newLabel.trim()}
            onClick={() => {
              onAdd(newLabel, newScope)
              setNewLabel('')
            }}
            aria-label="添加列"
          >
            <IconColumnInsertRight className="tc-shot-table-columns__icon" size={15} />
          </ActionIcon>
        </Tooltip>
      </Group>
      {selectedColumn ? (
        <Group className="tc-shot-table-columns__row tc-shot-table-columns__row--selected" gap={6} wrap="nowrap">
          <TextInput
            className="tc-shot-table-columns__input"
            size="xs"
            value={renameDraft}
            disabled={readOnly}
            onChange={(event) => setRenameDraft(event.currentTarget.value)}
            onBlur={() => {
              if (renameDraft.trim() && renameDraft.trim() !== selectedColumn.label) {
                onRename(selectedColumn.key, renameDraft)
              }
            }}
            aria-label="当前列名称"
          />
          <Select
            className="tc-shot-table-columns__scope-select"
            size="xs"
            value={selectedColumn.scope}
            data={SCOPE_OPTIONS.map((option) => ({ ...option }))}
            disabled={readOnly}
            allowDeselect={false}
            onChange={(value) => {
              if (value === 'shot' || value === 'timeline') onScopeChange(selectedColumn.key, value)
            }}
            aria-label="当前列作用域"
          />
          <Tooltip className="tc-shot-table-columns__tooltip" label="删除当前列">
            <ActionIcon
              className="tc-shot-table-columns__icon-button"
              color="red"
              variant="subtle"
              size="sm"
              disabled={readOnly}
              onClick={() => onDelete(selectedColumn.key)}
              aria-label="删除当前列"
            >
              <IconTrash className="tc-shot-table-columns__icon" size={15} />
            </ActionIcon>
          </Tooltip>
        </Group>
      ) : (
        <Button className="tc-shot-table-columns__empty" variant="subtle" size="compact-xs" disabled>
          点击表头后可编辑该列
        </Button>
      )}
    </section>
  )
}
