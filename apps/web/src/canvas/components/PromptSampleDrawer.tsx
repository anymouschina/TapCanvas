import React from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Drawer,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core'
import { IconPlus, IconSearch, IconTrash, IconWand } from '@tabler/icons-react'
import {
  createPromptSample,
  deletePromptSample,
  fetchPromptSamples,
  parsePromptSample,
  type PromptSampleDto,
  type PromptSampleInput,
} from '../../api/server'

export type PromptSampleDrawerProps = {
  opened: boolean
  nodeKind?: string
  onClose: () => void
  onApplySample: (sample: PromptSampleDto) => void
}

const nodeKindLabel: Record<PromptSampleDto['nodeKind'], string> = {
  image: '图像节点',
  composeVideo: '视频节点',
  storyboard: '分镜节点',
}

const normalizeKindForRequest = (kind?: string) => {
  if (!kind) return undefined
  if (kind === 'image' || kind === 'textToImage') return 'image'
  if (kind === 'composeVideo' || kind === 'video') return 'composeVideo'
  if (kind === 'storyboard') return 'storyboard'
  return undefined
}

const nodeKindOptions = [
  { value: 'composeVideo', label: '视频节点' },
  { value: 'image', label: '图像节点' },
  { value: 'storyboard', label: '分镜节点' },
]

export function PromptSampleDrawer({ opened, nodeKind, onClose, onApplySample }: PromptSampleDrawerProps) {
  const effectiveKind = React.useMemo(() => normalizeKindForRequest(nodeKind), [nodeKind])
  const [queryInput, setQueryInput] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [officialSamples, setOfficialSamples] = React.useState<PromptSampleDto[]>([])
  const [customSamples, setCustomSamples] = React.useState<PromptSampleDto[]>([])
  const [officialLoading, setOfficialLoading] = React.useState(false)
  const [customLoading, setCustomLoading] = React.useState(false)
  const [officialError, setOfficialError] = React.useState<string | null>(null)
  const [customError, setCustomError] = React.useState<string | null>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [formSuccess, setFormSuccess] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<'official' | 'custom'>('official')
  const [saving, setSaving] = React.useState(false)
  const [parsing, setParsing] = React.useState(false)
  const [rawPrompt, setRawPrompt] = React.useState('')
  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const [customForm, setCustomForm] = React.useState({
    title: '',
    scene: '',
    commandType: '',
    prompt: '',
    keywords: '',
    description: '',
    inputHint: '',
    outputNote: '',
    nodeKind: (effectiveKind as PromptSampleDto['nodeKind']) || 'composeVideo',
  })

  const resetForm = React.useCallback(() => {
    setCustomForm((prev) => ({
      ...prev,
      title: '',
      scene: '',
      commandType: '',
      prompt: '',
      keywords: '',
      description: '',
      inputHint: '',
      outputNote: '',
      nodeKind: (effectiveKind as PromptSampleDto['nodeKind']) || 'composeVideo',
    }))
    setRawPrompt('')
    setFormError(null)
    setFormSuccess(null)
  }, [effectiveKind])

  React.useEffect(() => {
    if (!opened) {
      setQueryInput('')
      setQuery('')
      resetForm()
      setActiveTab('official')
    }
  }, [opened, resetForm])

  const loadOfficialSamples = React.useCallback(() => {
    if (!opened) return
    setOfficialLoading(true)
    setOfficialError(null)
    fetchPromptSamples({ query: query || undefined, nodeKind: effectiveKind, source: 'official' })
      .then((res) => setOfficialSamples(res.samples || []))
      .catch((err: any) => {
        console.error('fetch official prompt samples failed', err)
        setOfficialError(err?.message || '加载提示词案例失败')
      })
      .finally(() => setOfficialLoading(false))
  }, [opened, query, effectiveKind])

  const loadCustomSamples = React.useCallback(() => {
    if (!opened) return
    setCustomLoading(true)
    setCustomError(null)
    fetchPromptSamples({ query: query || undefined, nodeKind: effectiveKind, source: 'custom' })
      .then((res) => setCustomSamples(res.samples || []))
      .catch((err: any) => {
        console.error('fetch custom prompt samples failed', err)
        setCustomError(err?.message || '加载自定义案例失败')
      })
      .finally(() => setCustomLoading(false))
  }, [opened, query, effectiveKind])

  React.useEffect(() => {
    if (!opened) return
    loadOfficialSamples()
    loadCustomSamples()
  }, [opened, loadOfficialSamples, loadCustomSamples])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = queryInput.trim()
    setQuery(trimmed)
  }

  const handleCustomFieldChange = (field: keyof typeof customForm, value: string) => {
    setCustomForm((prev) => ({ ...prev, [field]: value }))
  }

  const applyParsedResult = (result: PromptSampleInput) => {
    setCustomForm((prev) => ({
      ...prev,
      nodeKind: result.nodeKind,
      scene: result.scene || '',
      commandType: result.commandType || '',
      title: result.title || '',
      prompt: result.prompt || '',
      description: result.description || '',
      inputHint: result.inputHint || '',
      outputNote: result.outputNote || '',
      keywords: (result.keywords || []).join(', '),
    }))
  }

  const handleParse = async () => {
    if (!rawPrompt.trim()) {
      setFormError('请先粘贴原始提示词')
      setFormSuccess(null)
      return
    }
    setParsing(true)
    setFormError(null)
    setFormSuccess(null)
    try {
      const parsed = await parsePromptSample({ rawPrompt: rawPrompt.trim(), nodeKind: customForm.nodeKind })
      applyParsedResult(parsed)
      setFormSuccess('已自动提取字段，可根据需要修改后保存')
    } catch (err: any) {
      setFormError(err?.message || '解析失败，请稍后再试')
    } finally {
      setParsing(false)
    }
  }

  const handleSave = async () => {
    if (!customForm.title.trim() || !customForm.prompt.trim() || !customForm.scene.trim()) {
      setFormError('标题、场景和提示词不能为空')
      setFormSuccess(null)
      return
    }
    setSaving(true)
    setFormError(null)
    setFormSuccess(null)
    const keywords = customForm.keywords
      .split(',')
      .map((word) => word.trim())
      .filter(Boolean)
    const payload: PromptSampleInput = {
      title: customForm.title.trim(),
      scene: customForm.scene.trim(),
      commandType: customForm.commandType.trim() || '自定义模块',
      nodeKind: (customForm.nodeKind as PromptSampleDto['nodeKind']) || 'composeVideo',
      prompt: customForm.prompt.trim(),
      description: customForm.description.trim() || undefined,
      inputHint: customForm.inputHint.trim() || undefined,
      outputNote: customForm.outputNote.trim() || undefined,
      keywords,
    }
    try {
      await createPromptSample(payload)
      setFormSuccess('已保存到支持共享配置')
      setFormError(null)
      loadCustomSamples()
    } catch (err: any) {
      setFormError(err?.message || '保存失败，请稍后再试')
      setFormSuccess(null)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除该案例？')) return
    setDeletingId(id)
    try {
      await deletePromptSample(id)
      loadCustomSamples()
    } catch (err: any) {
      setCustomError(err?.message || '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  const kindBadge = effectiveKind ? (
    <Badge variant="light" color="blue" size="sm">
      {nodeKindLabel[effectiveKind]}
    </Badge>
  ) : null

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title="提示词支持共享配置"
      position="right"
      size="lg"
      overlayProps={{ opacity: 0.55, blur: 2 }}
      withinPortal
    >
      <Stack gap="sm">
        <form onSubmit={handleSubmit}>
          <Group align="flex-end" gap="xs">
            <TextInput
              label="搜索场景或关键字"
              placeholder="例如：水墨风、海报、文字修改"
              value={queryInput}
              onChange={(e) => setQueryInput(e.currentTarget.value)}
              leftSection={<IconSearch size={14} />}
              style={{ flex: 1 }}
            />
            <Button type="submit" variant="light">
              搜索
            </Button>
            <Button
              type="button"
              variant="subtle"
              onClick={() => {
                setQueryInput('')
                setQuery('')
              }}
            >
              重置
            </Button>
          </Group>
        </form>

        {kindBadge}

        <Tabs value={activeTab} onChange={(value) => setActiveTab((value as 'official' | 'custom') || 'official')}>
          <Tabs.List>
            <Tabs.Tab value="official">公共案例</Tabs.Tab>
            <Tabs.Tab value="custom">自定义案例</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="official" pt="sm">
            {officialLoading && (
              <Group justify="center" py="md">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">
                  正在加载案例...
                </Text>
              </Group>
            )}

            {!officialLoading && officialError && (
              <Paper withBorder p="md">
                <Text size="sm" c="red.5">
                  {officialError}
                </Text>
              </Paper>
            )}

            {!officialLoading && !officialError && (
              <ScrollArea h="70vh" type="always">
                <Stack gap="sm">
                  {officialSamples.length === 0 && (
                    <Paper withBorder p="md">
                      <Text size="sm" c="dimmed">
                        暂无匹配的案例，可以尝试其他关键字。
                      </Text>
                    </Paper>
                  )}
                  {officialSamples.map((sample) => (
                    <Paper key={sample.id} withBorder radius="md" p="md" shadow="xs">
                      <Stack gap={4}>
                        <Group justify="space-between" align="flex-start">
                          <div>
                            <Text fw={600} size="sm">
                              {sample.title}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {sample.scene} ｜ {sample.commandType}
                            </Text>
                          </div>
                          <Badge color="gray" variant="light">
                            {nodeKindLabel[sample.nodeKind]}
                          </Badge>
                        </Group>
                        {sample.description && (
                          <Text size="sm" c="dimmed">
                            {sample.description}
                          </Text>
                        )}
                        <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
                          {sample.prompt}
                        </Text>
                        {sample.outputNote && (
                          <Text size="xs" c="dimmed">
                            效果：{sample.outputNote}
                          </Text>
                        )}
                        {sample.inputHint && (
                          <Text size="xs" c="dimmed">
                            输入建议：{sample.inputHint}
                          </Text>
                        )}
                        <Group justify="space-between" mt="sm">
                          <Group gap={4}>
                            {sample.keywords.slice(0, 3).map((keyword) => (
                              <Badge key={keyword} size="xs" color="dark" variant="outline">
                                {keyword}
                              </Badge>
                            ))}
                          </Group>
                          <Button size="xs" onClick={() => onApplySample(sample)}>
                            应用
                          </Button>
                        </Group>
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              </ScrollArea>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="custom" pt="sm">
            <ScrollArea h="70vh" type="always">
              <Stack gap="sm">
                <Paper withBorder p="md" radius="md" shadow="xs">
                  <Stack gap="xs">
                    <Group justify="space-between" align="center">
                      <Text fw={600}>自定义案例</Text>
                      <Text size="xs" c="dimmed">
                        存储在服务器，可跨设备复用
                      </Text>
                    </Group>
                    <Textarea
                      label="原始提示词"
                      placeholder="粘贴长提示词，AI 将自动提取字段"
                      minRows={4}
                      value={rawPrompt}
                      onChange={(e) => setRawPrompt(e.currentTarget.value)}
                    />
                    <Group justify="flex-end">
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconWand size={14} />}
                        onClick={handleParse}
                        loading={parsing}
                      >
                        AI 自动提取
                      </Button>
                    </Group>
                    <Select
                      label="节点类型"
                      data={nodeKindOptions}
                      value={customForm.nodeKind}
                      onChange={(value) => handleCustomFieldChange('nodeKind', value || 'composeVideo')}
                      allowDeselect={false}
                    />
                    <Group grow>
                      <TextInput
                        label="标题"
                        placeholder="例如：山雨破庙开场"
                        value={customForm.title}
                        onChange={(e) => handleCustomFieldChange('title', e.currentTarget.value)}
                      />
                      <TextInput
                        label="场景"
                        placeholder="用于分类，如“视频真实感”"
                        value={customForm.scene}
                        onChange={(e) => handleCustomFieldChange('scene', e.currentTarget.value)}
                      />
                    </Group>
                    <TextInput
                      label="指令类型（可选）"
                      placeholder="例如：微剧情、风格改写"
                      value={customForm.commandType}
                      onChange={(e) => handleCustomFieldChange('commandType', e.currentTarget.value)}
                    />
                    <Textarea
                      label="提示词"
                      minRows={4}
                      placeholder="完整英文/中文提示词"
                      value={customForm.prompt}
                      onChange={(e) => handleCustomFieldChange('prompt', e.currentTarget.value)}
                    />
                    <Textarea
                      label="描述（可选）"
                      minRows={2}
                      value={customForm.description}
                      onChange={(e) => handleCustomFieldChange('description', e.currentTarget.value)}
                    />
                    <Group grow>
                      <TextInput
                        label="输入建议（可选）"
                        value={customForm.inputHint}
                        onChange={(e) => handleCustomFieldChange('inputHint', e.currentTarget.value)}
                      />
                      <TextInput
                        label="预期效果（可选）"
                        value={customForm.outputNote}
                        onChange={(e) => handleCustomFieldChange('outputNote', e.currentTarget.value)}
                      />
                    </Group>
                    <TextInput
                      label="关键词（逗号分隔，可选）"
                      value={customForm.keywords}
                      onChange={(e) => handleCustomFieldChange('keywords', e.currentTarget.value)}
                    />
                    {formError && (
                      <Text size="xs" c="red.6">
                        {formError}
                      </Text>
                    )}
                    {formSuccess && (
                      <Text size="xs" c="teal.6">
                        {formSuccess}
                      </Text>
                    )}
                    <Group justify="flex-end">
                      <Button size="xs" variant="subtle" onClick={resetForm}>
                        重置表单
                      </Button>
                      <Button size="xs" onClick={handleSave} loading={saving}>
                        保存案例
                      </Button>
                    </Group>
                  </Stack>
                </Paper>

                {customLoading && (
                  <Group justify="center" py="md">
                    <Loader size="sm" />
                    <Text size="sm" c="dimmed">
                      正在加载自定义案例...
                    </Text>
                  </Group>
                )}

                {!customLoading && customError && (
                  <Paper withBorder p="md">
                    <Text size="sm" c="red.5">
                      {customError}
                    </Text>
                  </Paper>
                )}

                {!customLoading && !customError && customSamples.length === 0 && (
                  <Paper withBorder p="md" radius="md">
                    <Text size="sm" c="dimmed">
                      暂无自定义案例，填写上方表单即可创建。
                    </Text>
                  </Paper>
                )}

                {!customLoading && !customError && customSamples.map((sample) => (
                  <Paper key={sample.id} withBorder radius="md" p="md" shadow="xs">
                    <Stack gap={4}>
                      <Group justify="space-between" align="flex-start">
                        <div>
                          <Group gap={6}>
                            <Text fw={600} size="sm">
                              {sample.title}
                            </Text>
                            <Badge color="orange" variant="light">
                              自定义
                            </Badge>
                          </Group>
                          <Text size="xs" c="dimmed">
                            {sample.scene} ｜ {sample.commandType}
                          </Text>
                        </div>
                        <Group gap={6}>
                          <Badge color="gray" variant="light">
                            {nodeKindLabel[sample.nodeKind]}
                          </Badge>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="red"
                            onClick={() => handleDelete(sample.id)}
                            disabled={deletingId === sample.id}
                          >
                            {deletingId === sample.id ? <Loader size="xs" color="red" /> : <IconTrash size={14} />}
                          </ActionIcon>
                        </Group>
                      </Group>
                      {sample.description && (
                        <Text size="sm" c="dimmed">
                          {sample.description}
                        </Text>
                      )}
                      <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
                        {sample.prompt}
                      </Text>
                      {sample.outputNote && (
                        <Text size="xs" c="dimmed">
                          效果：{sample.outputNote}
                        </Text>
                      )}
                      {sample.inputHint && (
                        <Text size="xs" c="dimmed">
                          输入建议：{sample.inputHint}
                        </Text>
                      )}
                      <Group justify="space-between" mt="sm">
                        <Group gap={4}>
                          {sample.keywords.slice(0, 3).map((keyword) => (
                            <Badge key={keyword} size="xs" color="dark" variant="outline">
                              {keyword}
                            </Badge>
                          ))}
                        </Group>
                        <Button size="xs" onClick={() => onApplySample(sample)}>
                          应用
                        </Button>
                      </Group>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </ScrollArea>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Drawer>
  )
}
