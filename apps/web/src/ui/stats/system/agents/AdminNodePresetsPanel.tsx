import React from 'react'
import {
  Button,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core'
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import type {
  AdminLlmNodePresetDto,
  AdminLlmNodePresetUpsertInput,
  LlmNodePresetType,
} from '../../../../api/server'
import { IconActionButton } from '../../../IconActionButton'
import { PanelCard } from '../../../PanelCard'
import { StatePanel } from '../../../StatePanel'
import { StatusBadge } from '../../../StatusBadge'
import {
  createNodePresetEditor,
  parseNodePresetEditor,
  type NodePresetEditorState,
} from './adminAgentManagement.models'

type PresetFilter = 'all' | LlmNodePresetType

type AdminNodePresetsPanelProps = {
  className?: string
  presets: AdminLlmNodePresetDto[]
  onSave: (payload: AdminLlmNodePresetUpsertInput) => Promise<void>
  onRequestDelete: (preset: AdminLlmNodePresetDto) => void
}

const PRESET_TYPE_OPTIONS: Array<{ value: LlmNodePresetType; label: string }> = [
  { value: 'text', label: '文本节点' },
  { value: 'image', label: '图片节点' },
  { value: 'video', label: '视频节点' },
]

const PRESET_FILTER_OPTIONS: Array<{ value: PresetFilter; label: string }> = [
  { value: 'all', label: '全部类型' },
  ...PRESET_TYPE_OPTIONS,
]

function isPresetFilter(value: string | null): value is PresetFilter {
  return value === 'all' || value === 'text' || value === 'image' || value === 'video'
}

function isPresetType(value: string | null): value is LlmNodePresetType {
  return value === 'text' || value === 'image' || value === 'video'
}

function getErrorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

export function AdminNodePresetsPanel({
  className,
  presets,
  onSave,
  onRequestDelete,
}: AdminNodePresetsPanelProps): JSX.Element {
  const rootClassName = ['stats-node-presets', className].filter(Boolean).join(' ')
  const [filter, setFilter] = React.useState<PresetFilter>('all')
  const [editor, setEditor] = React.useState<NodePresetEditorState | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [editorError, setEditorError] = React.useState<string | null>(null)

  const visiblePresets = React.useMemo(
    () => (filter === 'all' ? presets : presets.filter((preset) => preset.type === filter)),
    [filter, presets],
  )

  const openEditor = React.useCallback((preset?: AdminLlmNodePresetDto) => {
    setEditor(createNodePresetEditor(preset))
    setEditorError(null)
  }, [])

  const closeEditor = React.useCallback(() => {
    if (submitting) return
    setEditor(null)
    setEditorError(null)
  }, [submitting])

  const save = React.useCallback(async () => {
    if (!editor || submitting) return
    const parsed = parseNodePresetEditor(editor)
    if (!parsed.ok) {
      setEditorError(parsed.message)
      return
    }

    setSubmitting(true)
    setEditorError(null)
    try {
      await onSave(parsed.value)
      setEditor(null)
    } catch (reason: unknown) {
      setEditorError(getErrorMessage(reason, '保存基础节点预设失败'))
    } finally {
      setSubmitting(false)
    }
  }, [editor, onSave, submitting])

  return (
    <PanelCard className={rootClassName} padding="compact">
      <Stack className="stats-node-presets__stack" gap="sm">
        <Group className="stats-node-presets__header" justify="space-between" align="flex-start" wrap="wrap">
          <Stack className="stats-node-presets__heading" gap={2}>
            <Group className="stats-node-presets__title-row" gap={8}>
              <Text className="stats-node-presets__title" fw={700}>基础节点预设</Text>
              <StatusBadge className="stats-node-presets__count" tone="neutral">{presets.length}</StatusBadge>
            </Group>
            <Text className="stats-node-presets__description" size="xs" c="dimmed">
              管理文本、图片和视频节点可直接选择的系统级提示词预设。
            </Text>
          </Stack>
          <Group className="stats-node-presets__controls" gap={6} align="flex-end">
            <Select
              className="stats-node-presets__filter"
              aria-label="筛选节点预设类型"
              size="xs"
              value={filter}
              data={PRESET_FILTER_OPTIONS}
              allowDeselect={false}
              onChange={(value) => {
                if (isPresetFilter(value)) setFilter(value)
              }}
            />
            <Tooltip className="stats-node-presets__create-tooltip" label="新建基础预设" withinPortal>
              <IconActionButton
                className="stats-node-presets__create"
                aria-label="新建基础节点预设"
                icon={<IconPlus className="stats-node-presets__create-icon" size={16} />}
                onClick={() => openEditor()}
              />
            </Tooltip>
          </Group>
        </Group>

        {visiblePresets.length === 0 ? (
          <StatePanel
            className="stats-node-presets__empty"
            title={presets.length === 0 ? '暂无基础节点预设' : '当前类型没有预设'}
            description={presets.length === 0 ? '后端已返回空列表。可使用右上角按钮创建第一条记录。' : '请选择其他类型或创建一条新预设。'}
          />
        ) : (
          <ScrollArea className="stats-node-presets__scroll" type="auto">
            <Table className="stats-node-presets__table" verticalSpacing="xs" horizontalSpacing="sm">
              <Table.Thead className="stats-node-presets__table-head">
                <Table.Tr className="stats-node-presets__header-row">
                  <Table.Th className="stats-node-presets__header-cell">预设</Table.Th>
                  <Table.Th className="stats-node-presets__header-cell">类型</Table.Th>
                  <Table.Th className="stats-node-presets__header-cell">状态</Table.Th>
                  <Table.Th className="stats-node-presets__header-cell">排序</Table.Th>
                  <Table.Th className="stats-node-presets__header-cell stats-node-presets__header-cell--actions">操作</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="stats-node-presets__table-body">
                {visiblePresets.map((preset) => (
                  <Table.Tr className="stats-node-presets__row" key={preset.id}>
                    <Table.Td className="stats-node-presets__cell stats-node-presets__cell--identity">
                      <Stack className="stats-node-presets__identity" gap={1}>
                        <Text className="stats-node-presets__name" size="sm" fw={600}>{preset.title}</Text>
                        <Text className="stats-node-presets__prompt" size="xs" c="dimmed" lineClamp={2}>
                          {preset.prompt}
                        </Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td className="stats-node-presets__cell">
                      <StatusBadge className="stats-node-presets__type" tone="info">{preset.type}</StatusBadge>
                    </Table.Td>
                    <Table.Td className="stats-node-presets__cell">
                      <StatusBadge className="stats-node-presets__enabled" tone={preset.enabled ? 'success' : 'danger'}>
                        {preset.enabled ? '启用' : '停用'}
                      </StatusBadge>
                    </Table.Td>
                    <Table.Td className="stats-node-presets__cell">
                      <Text className="stats-node-presets__sort-order" size="xs" c="dimmed">
                        {preset.sortOrder == null ? '未设置' : preset.sortOrder}
                      </Text>
                    </Table.Td>
                    <Table.Td className="stats-node-presets__cell stats-node-presets__cell--actions">
                      <Group className="stats-node-presets__actions" gap={2} wrap="nowrap" justify="flex-end">
                        <Tooltip className="stats-node-presets__edit-tooltip" label="编辑预设" withinPortal>
                          <IconActionButton
                            className="stats-node-presets__edit"
                            aria-label={`编辑 ${preset.title}`}
                            icon={<IconPencil className="stats-node-presets__edit-icon" size={15} />}
                            onClick={() => openEditor(preset)}
                          />
                        </Tooltip>
                        <Tooltip className="stats-node-presets__delete-tooltip" label="删除预设" withinPortal>
                          <IconActionButton
                            className="stats-node-presets__delete"
                            aria-label={`删除 ${preset.title}`}
                            color="red"
                            icon={<IconTrash className="stats-node-presets__delete-icon" size={15} />}
                            onClick={() => onRequestDelete(preset)}
                          />
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Stack>

      <Modal
        className="stats-node-presets__editor-modal"
        opened={editor !== null}
        onClose={closeEditor}
        title={editor?.id ? '编辑基础节点预设' : '新建基础节点预设'}
        centered
        size="lg"
        closeOnClickOutside={!submitting}
        closeOnEscape={!submitting}
      >
        {editor ? (
          <Stack className="stats-node-presets__editor" gap="sm">
            {editorError ? (
              <StatePanel className="stats-node-presets__editor-error" title="无法保存" description={editorError} tone="error" />
            ) : null}
            <Group className="stats-node-presets__editor-row" grow align="flex-start">
              <TextInput
                className="stats-node-presets__title-input"
                label="名称"
                value={editor.title}
                onChange={(event) => setEditor({ ...editor, title: event.currentTarget.value })}
                required
              />
              <Select
                className="stats-node-presets__type-input"
                label="节点类型"
                description="必选；系统不会替你推断类型"
                value={editor.type}
                data={PRESET_TYPE_OPTIONS}
                allowDeselect
                onChange={(value) => setEditor({ ...editor, type: isPresetType(value) ? value : null })}
                required
              />
            </Group>
            <TextInput
              className="stats-node-presets__reference-input"
              label="参考图 URL"
              description="可留空；必须是已托管的 HTTP(S) 资产 URL"
              value={editor.referenceImageUrl}
              onChange={(event) => setEditor({ ...editor, referenceImageUrl: event.currentTarget.value })}
            />
            <Textarea
              className="stats-node-presets__description-input"
              label="说明"
              autosize
              minRows={2}
              maxRows={4}
              value={editor.description}
              onChange={(event) => setEditor({ ...editor, description: event.currentTarget.value })}
            />
            <Textarea
              className="stats-node-presets__prompt-input"
              label="提示词"
              autosize
              minRows={8}
              maxRows={18}
              value={editor.prompt}
              onChange={(event) => setEditor({ ...editor, prompt: event.currentTarget.value })}
              required
            />
            <Group className="stats-node-presets__settings" align="flex-end" grow>
              <TextInput
                className="stats-node-presets__sort-input"
                label="排序值"
                description="可留空；仅接受整数"
                type="number"
                step={1}
                value={editor.sortOrder}
                onChange={(event) => setEditor({ ...editor, sortOrder: event.currentTarget.value })}
              />
              <Checkbox
                className="stats-node-presets__enabled-input"
                label="启用"
                checked={editor.enabled}
                onChange={(event) => setEditor({ ...editor, enabled: event.currentTarget.checked })}
              />
            </Group>
            {editor.styleReference ? (
              <Text className="stats-node-presets__style-reference-note" size="xs" c="dimmed">
                当前记录包含结构化风格元数据；本次保存会原样保留。
              </Text>
            ) : null}
            <Group className="stats-node-presets__editor-actions" justify="flex-end" gap="xs">
              <Button className="stats-node-presets__cancel" variant="subtle" onClick={closeEditor} disabled={submitting}>
                取消
              </Button>
              <Button className="stats-node-presets__save" onClick={() => void save()} loading={submitting}>
                保存
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>
    </PanelCard>
  )
}
