import React from 'react'
import {
  Button,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core'
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import type { AdminAgentSkillDto, AdminAgentSkillUpsertInput } from '../../../../api/server'
import { IconActionButton } from '../../../IconActionButton'
import { PanelCard } from '../../../PanelCard'
import { StatePanel } from '../../../StatePanel'
import { StatusBadge } from '../../../StatusBadge'
import {
  createSkillEditor,
  parseSkillEditor,
  type SkillEditorState,
} from './adminAgentManagement.models'

type AdminAgentSkillsPanelProps = {
  className?: string
  skills: AdminAgentSkillDto[]
  onSave: (payload: AdminAgentSkillUpsertInput) => Promise<void>
  onRequestDelete: (skill: AdminAgentSkillDto) => void
}

function getErrorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

export function AdminAgentSkillsPanel({
  className,
  skills,
  onSave,
  onRequestDelete,
}: AdminAgentSkillsPanelProps): JSX.Element {
  const rootClassName = ['stats-agent-skills', className].filter(Boolean).join(' ')
  const [editor, setEditor] = React.useState<SkillEditorState | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [editorError, setEditorError] = React.useState<string | null>(null)

  const openEditor = React.useCallback((skill?: AdminAgentSkillDto) => {
    setEditor(createSkillEditor(skill))
    setEditorError(null)
  }, [])

  const closeEditor = React.useCallback(() => {
    if (submitting) return
    setEditor(null)
    setEditorError(null)
  }, [submitting])

  const save = React.useCallback(async () => {
    if (!editor || submitting) return
    const parsed = parseSkillEditor(editor)
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
      setEditorError(getErrorMessage(reason, '保存官方 Agent Skill 失败'))
    } finally {
      setSubmitting(false)
    }
  }, [editor, onSave, submitting])

  return (
    <PanelCard className={rootClassName} padding="compact">
      <Stack className="stats-agent-skills__stack" gap="sm">
        <Group className="stats-agent-skills__header" justify="space-between" align="flex-start" wrap="wrap">
          <Stack className="stats-agent-skills__heading" gap={2}>
            <Group className="stats-agent-skills__title-row" gap={8}>
              <Text className="stats-agent-skills__title" fw={700}>官方 Agent Skills</Text>
              <StatusBadge className="stats-agent-skills__count" tone="neutral">{skills.length}</StatusBadge>
            </Group>
            <Text className="stats-agent-skills__description" size="xs" c="dimmed">
              管理 agents-cli 运行时可见的官方 Skill 内容。key 创建后不可修改。
            </Text>
          </Stack>
          <Tooltip className="stats-agent-skills__create-tooltip" label="新建官方 Skill" withinPortal>
            <IconActionButton
              className="stats-agent-skills__create"
              aria-label="新建官方 Agent Skill"
              icon={<IconPlus className="stats-agent-skills__create-icon" size={16} />}
              onClick={() => openEditor()}
            />
          </Tooltip>
        </Group>

        {skills.length === 0 ? (
          <StatePanel
            className="stats-agent-skills__empty"
            title="暂无官方 Agent Skill"
            description="后端已返回空列表。可使用右上角按钮创建第一条记录。"
          />
        ) : (
          <ScrollArea className="stats-agent-skills__scroll" type="auto">
            <Table className="stats-agent-skills__table" verticalSpacing="xs" horizontalSpacing="sm">
              <Table.Thead className="stats-agent-skills__table-head">
                <Table.Tr className="stats-agent-skills__header-row">
                  <Table.Th className="stats-agent-skills__header-cell">Skill</Table.Th>
                  <Table.Th className="stats-agent-skills__header-cell">分类</Table.Th>
                  <Table.Th className="stats-agent-skills__header-cell">状态</Table.Th>
                  <Table.Th className="stats-agent-skills__header-cell">内容</Table.Th>
                  <Table.Th className="stats-agent-skills__header-cell">更新时间</Table.Th>
                  <Table.Th className="stats-agent-skills__header-cell stats-agent-skills__header-cell--actions">操作</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="stats-agent-skills__table-body">
                {skills.map((skill) => (
                  <Table.Tr className="stats-agent-skills__row" key={skill.id}>
                    <Table.Td className="stats-agent-skills__cell stats-agent-skills__cell--identity">
                      <Stack className="stats-agent-skills__identity" gap={1}>
                        <Text className="stats-agent-skills__name" size="sm" fw={600}>{skill.name}</Text>
                        <Text className="stats-agent-skills__key" size="xs" c="dimmed">{skill.key}</Text>
                        {skill.description ? (
                          <Text className="stats-agent-skills__summary" size="xs" c="dimmed" lineClamp={1}>
                            {skill.description}
                          </Text>
                        ) : null}
                      </Stack>
                    </Table.Td>
                    <Table.Td className="stats-agent-skills__cell">
                      <StatusBadge className="stats-agent-skills__category" tone="neutral">{skill.category}</StatusBadge>
                    </Table.Td>
                    <Table.Td className="stats-agent-skills__cell">
                      <Group className="stats-agent-skills__states" gap={4} wrap="nowrap">
                        <StatusBadge className="stats-agent-skills__enabled" tone={skill.enabled ? 'success' : 'danger'}>
                          {skill.enabled ? '启用' : '停用'}
                        </StatusBadge>
                        <StatusBadge className="stats-agent-skills__visible" tone={skill.visible ? 'info' : 'neutral'}>
                          {skill.visible ? '公开' : '隐藏'}
                        </StatusBadge>
                      </Group>
                    </Table.Td>
                    <Table.Td className="stats-agent-skills__cell">
                      <Text className="stats-agent-skills__content-size" size="xs" c="dimmed">
                        {skill.content.length.toLocaleString('zh-CN')} 字符
                      </Text>
                    </Table.Td>
                    <Table.Td className="stats-agent-skills__cell">
                      <Text className="stats-agent-skills__updated-at" size="xs" c="dimmed">
                        {formatUpdatedAt(skill.updatedAt)}
                      </Text>
                    </Table.Td>
                    <Table.Td className="stats-agent-skills__cell stats-agent-skills__cell--actions">
                      <Group className="stats-agent-skills__actions" gap={2} wrap="nowrap" justify="flex-end">
                        <Tooltip className="stats-agent-skills__edit-tooltip" label="编辑 Skill" withinPortal>
                          <IconActionButton
                            className="stats-agent-skills__edit"
                            aria-label={`编辑 ${skill.name}`}
                            icon={<IconPencil className="stats-agent-skills__edit-icon" size={15} />}
                            onClick={() => openEditor(skill)}
                          />
                        </Tooltip>
                        <Tooltip className="stats-agent-skills__delete-tooltip" label="删除 Skill" withinPortal>
                          <IconActionButton
                            className="stats-agent-skills__delete"
                            aria-label={`删除 ${skill.name}`}
                            color="red"
                            icon={<IconTrash className="stats-agent-skills__delete-icon" size={15} />}
                            onClick={() => onRequestDelete(skill)}
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
        className="stats-agent-skills__editor-modal"
        opened={editor !== null}
        onClose={closeEditor}
        title={editor?.id ? '编辑官方 Agent Skill' : '新建官方 Agent Skill'}
        centered
        size="lg"
        closeOnClickOutside={!submitting}
        closeOnEscape={!submitting}
      >
        {editor ? (
          <Stack className="stats-agent-skills__editor" gap="sm">
            {editorError ? (
              <StatePanel className="stats-agent-skills__editor-error" title="无法保存" description={editorError} tone="error" />
            ) : null}
            <Group className="stats-agent-skills__editor-row" grow align="flex-start">
              <TextInput
                className="stats-agent-skills__key-input"
                label="Key"
                description={editor.id ? '已有 Skill 的 key 不允许修改' : '必填；由运营明确指定，不会自动生成'}
                value={editor.key}
                disabled={Boolean(editor.id)}
                onChange={(event) => setEditor({ ...editor, key: event.currentTarget.value })}
                required
              />
              <TextInput
                className="stats-agent-skills__name-input"
                label="名称"
                value={editor.name}
                onChange={(event) => setEditor({ ...editor, name: event.currentTarget.value })}
                required
              />
            </Group>
            <Group className="stats-agent-skills__editor-row" grow align="flex-start">
              <TextInput
                className="stats-agent-skills__category-input"
                label="分类"
                value={editor.category}
                onChange={(event) => setEditor({ ...editor, category: event.currentTarget.value })}
                required
              />
              <TextInput
                className="stats-agent-skills__sort-input"
                label="排序值"
                description="可留空；仅接受整数"
                type="number"
                step={1}
                value={editor.sortOrder}
                onChange={(event) => setEditor({ ...editor, sortOrder: event.currentTarget.value })}
              />
            </Group>
            <TextInput
              className="stats-agent-skills__logo-input"
              label="Logo URL"
              description="可留空；必须是已托管的 HTTP(S) 资产 URL"
              value={editor.logoUrl}
              onChange={(event) => setEditor({ ...editor, logoUrl: event.currentTarget.value })}
            />
            <Textarea
              className="stats-agent-skills__description-input"
              label="说明"
              autosize
              minRows={2}
              maxRows={4}
              value={editor.description}
              onChange={(event) => setEditor({ ...editor, description: event.currentTarget.value })}
            />
            <Textarea
              className="stats-agent-skills__content-input"
              label="Skill 内容"
              description="必填；这里保存可直接注入 agents-cli 的真实运行时内容"
              autosize
              minRows={10}
              maxRows={20}
              value={editor.content}
              onChange={(event) => setEditor({ ...editor, content: event.currentTarget.value })}
              required
            />
            <Group className="stats-agent-skills__toggles" gap="lg">
              <Checkbox
                className="stats-agent-skills__enabled-input"
                label="启用"
                checked={editor.enabled}
                onChange={(event) => setEditor({ ...editor, enabled: event.currentTarget.checked })}
              />
              <Checkbox
                className="stats-agent-skills__visible-input"
                label="对用户可见"
                checked={editor.visible}
                onChange={(event) => setEditor({ ...editor, visible: event.currentTarget.checked })}
              />
            </Group>
            <Group className="stats-agent-skills__editor-actions" justify="flex-end" gap="xs">
              <Button className="stats-agent-skills__cancel" variant="subtle" onClick={closeEditor} disabled={submitting}>
                取消
              </Button>
              <Button className="stats-agent-skills__save" onClick={() => void save()} loading={submitting}>
                保存
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>
    </PanelCard>
  )
}
