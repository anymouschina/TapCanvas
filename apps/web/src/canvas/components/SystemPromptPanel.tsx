import React from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core'
import { IconEdit, IconPlus, IconSettings, IconTrash } from '@tabler/icons-react'
import { useSystemPromptPresets, type SystemPromptScope } from '../systemPromptPresets'

type PanelProps = {
  target: 'image' | 'video'
  enabled: boolean
  value: string
  onEnabledChange: (value: boolean) => void
  onChange: (value: string) => void
}

const scopeOptions: Array<{ value: SystemPromptScope; label: string }> = [
  { value: 'image', label: '图像' },
  { value: 'video', label: '视频' },
  { value: 'both', label: '通用' },
]

const scopeLabelMap: Record<SystemPromptScope, string> = {
  image: '图像',
  video: '视频',
  both: '通用',
}

export function SystemPromptPanel({ target, enabled, value, onEnabledChange, onChange }: PanelProps) {
  const presets = useSystemPromptPresets((state) => state.presets)
  const addPreset = useSystemPromptPresets((state) => state.addPreset)
  const updatePreset = useSystemPromptPresets((state) => state.updatePreset)
  const deletePreset = useSystemPromptPresets((state) => state.deletePreset)

  const [managerOpen, setManagerOpen] = React.useState(false)
  const [editorId, setEditorId] = React.useState<string | null>(null)
  const [filterScope, setFilterScope] = React.useState<'all' | SystemPromptScope>('all')
  const [formError, setFormError] = React.useState<string | null>(null)
  const [formValue, setFormValue] = React.useState({
    title: '',
    description: '',
    scope: target as SystemPromptScope,
    content: '',
  })
  const [selectedPresetId, setSelectedPresetId] = React.useState<string | null>(null)

  const availablePresets = React.useMemo(
    () => presets.filter((preset) => preset.scope === 'both' || preset.scope === target),
    [presets, target],
  )

  const selectData = React.useMemo(
    () =>
      availablePresets.map((preset) => ({
        value: preset.id,
        label: preset.title,
      })),
    [availablePresets],
  )

  const matchedPresetId = React.useMemo(() => {
    const trimmed = value.trim()
    if (!trimmed) return null
    const preset = availablePresets.find((item) => item.content.trim() === trimmed)
    return preset?.id ?? null
  }, [availablePresets, value])

  React.useEffect(() => {
    setSelectedPresetId(matchedPresetId)
  }, [matchedPresetId])

  const resetForm = React.useCallback(
    (scope?: SystemPromptScope) => {
      setEditorId(null)
      setFormError(null)
      setFormValue({
        title: '',
        description: '',
        scope: scope || (target as SystemPromptScope),
        content: '',
      })
    },
    [target],
  )

  const openManager = React.useCallback(() => {
    resetForm()
    setFilterScope('all')
    setManagerOpen(true)
  }, [resetForm])

  const handleSavePreset = React.useCallback(() => {
    const title = formValue.title.trim()
    const content = formValue.content.trim()
    if (!title || !content) {
      setFormError('请填写标题和提示词内容')
      return
    }
    if (editorId) {
      updatePreset(editorId, {
        title,
        description: formValue.description,
        content,
        scope: formValue.scope,
      })
    } else {
      addPreset({
        title,
        description: formValue.description,
        content,
        scope: formValue.scope,
      })
    }
    resetForm(formValue.scope)
  }, [addPreset, editorId, formValue, resetForm, updatePreset])

  const filteredPresets = React.useMemo(() => {
    if (filterScope === 'all') return presets
    return presets.filter((preset) => preset.scope === filterScope || preset.scope === 'both')
  }, [filterScope, presets])

  const handleSelectPreset = React.useCallback(
    (id: string | null) => {
      setSelectedPresetId(id)
      if (!id) return
      const preset = availablePresets.find((item) => item.id === id)
      if (!preset) return
      onChange(preset.content)
    },
    [availablePresets, onChange],
  )

  return (
    <Paper withBorder radius="md" p="sm" mt="sm">
      <Group justify="space-between" align="center">
        <div>
          <Text size="sm" fw={600}>
            系统提示词
          </Text>
          <Text size="xs" c="dimmed">
            为 {target === 'video' ? '视频' : '图像'} 模型提供稳定的风格约束。
          </Text>
        </div>
        <Group gap={6} align="center">
          <Switch
            size="xs"
            label="启用"
            checked={enabled}
            onChange={(event) => onEnabledChange(event.currentTarget.checked)}
          />
          <Tooltip label="管理提示词库" withArrow>
            <ActionIcon variant="subtle" onClick={openManager}>
              <IconSettings size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {enabled ? (
        <Stack gap="xs" mt="sm">
          {availablePresets.length > 0 && (
            <Select
              label="从列表快速应用"
              placeholder="选择一个系统提示词"
              data={selectData}
              value={selectedPresetId}
              onChange={(next) => handleSelectPreset(next)}
              size="xs"
              clearable
              searchable
              nothingFound="暂无匹配的提示词"
            />
          )}
          <Textarea
            autosize
            minRows={3}
            maxRows={6}
            placeholder="编写系统提示词，指导模型如何组织语言、镜头与风格…"
            value={value}
            onChange={(event) => {
              if (selectedPresetId) {
                setSelectedPresetId(null)
              }
              onChange(event.currentTarget.value)
            }}
          />
          <Text size="xs" c="dimmed">
            建议使用英文向模型描述镜头语法、色彩与约束；内容会在生成提示词前注入。
          </Text>
        </Stack>
      ) : (
        <Text size="xs" c="dimmed" mt="sm">
          当前节点不会注入系统提示词，直接使用输入的提示文案。
        </Text>
      )}

      <Modal
        opened={managerOpen}
        onClose={() => {
          setManagerOpen(false)
          resetForm()
        }}
        title="系统提示词库"
        size="lg"
        centered
        withinPortal
      >
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Select
              label="显示范围"
              size="xs"
              data={['all', 'image', 'video', 'both'].map((value) => ({
                value,
                label:
                  value === 'all'
                    ? '全部'
                    : value === 'image'
                      ? '仅图像'
                      : value === 'video'
                        ? '仅视频'
                        : '通用',
              }))}
              value={filterScope}
              onChange={(value) => setFilterScope((value as 'all' | SystemPromptScope) || 'all')}
            />
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => resetForm(target as SystemPromptScope)}>
              新建提示词
            </Button>
          </Group>
          <ScrollArea.Autosize mah={260} type="hover">
            <Stack gap="sm">
              {filteredPresets.map((preset) => (
                <Paper key={preset.id} withBorder radius="md" p="sm">
                  <Group justify="space-between" align="flex-start">
                    <div>
                      <Group gap={6} align="center">
                        <Text fw={600}>{preset.title}</Text>
                        <Badge size="xs" variant="light" color={preset.scope === 'video' ? 'grape' : preset.scope === 'image' ? 'blue' : 'gray'}>
                          {scopeLabelMap[preset.scope]}
                        </Badge>
                        {preset.builtIn && (
                          <Badge size="xs" variant="light" color="green">
                            内置
                          </Badge>
                        )}
                      </Group>
                      {preset.description && (
                        <Text size="xs" c="dimmed">
                          {preset.description}
                        </Text>
                      )}
                    </div>
                    <Group gap={4} align="center">
                      {!preset.builtIn && (
                        <Tooltip label="编辑">
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            onClick={() => {
                              setEditorId(preset.id)
                              setFormError(null)
                              setFormValue({
                                title: preset.title,
                                description: preset.description || '',
                                scope: preset.scope,
                                content: preset.content,
                              })
                            }}
                          >
                            <IconEdit size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {!preset.builtIn && (
                        <Tooltip label="删除">
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="red"
                            onClick={() => {
                              if (confirm('确定删除该提示词？')) {
                                deletePreset(preset.id)
                              }
                            }}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  </Group>
                  <Text size="xs" c="dimmed" mt={6} style={{ whiteSpace: 'pre-wrap' }}>
                    {preset.content}
                  </Text>
                </Paper>
              ))}
              {filteredPresets.length === 0 && (
                <Text size="xs" c="dimmed">
                  当前筛选下暂无提示词，试试添加一条吧。
                </Text>
              )}
            </Stack>
          </ScrollArea.Autosize>

          <Stack gap="xs">
            <Group align="flex-end" gap="sm">
              <TextInput
                style={{ flex: 1 }}
                label={editorId ? '编辑提示词名称' : '添加新的提示词'}
                placeholder="例如：电影摄影导演"
                value={formValue.title}
                onChange={(event) => setFormValue((prev) => ({ ...prev, title: event.currentTarget.value }))}
              />
              <Select
                label="适用节点"
                data={scopeOptions}
                value={formValue.scope}
                onChange={(value) => setFormValue((prev) => ({ ...prev, scope: (value as SystemPromptScope) || prev.scope }))}
              />
            </Group>
            <TextInput
              label="说明（可选）"
              placeholder="用于快速辨识的备注"
              value={formValue.description}
              onChange={(event) => setFormValue((prev) => ({ ...prev, description: event.currentTarget.value }))}
            />
            <Textarea
              label="系统提示词"
              placeholder="描述生成提示词时需要遵循的镜头、风格或语言要求"
              autosize
              minRows={3}
              value={formValue.content}
              onChange={(event) => setFormValue((prev) => ({ ...prev, content: event.currentTarget.value }))}
            />
            {formError && (
              <Text size="xs" c="red">
                {formError}
              </Text>
            )}
            <Group justify="flex-end">
              <Button size="xs" variant="light" onClick={resetForm}>
                清空
              </Button>
              <Button size="xs" leftSection={<IconPlus size={14} />} onClick={handleSavePreset}>
                {editorId ? '保存修改' : '添加到列表'}
              </Button>
            </Group>
          </Stack>
        </Stack>
      </Modal>
    </Paper>
  )
}
