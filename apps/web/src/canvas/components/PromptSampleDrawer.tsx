import React from 'react'
import { ActionIcon, Badge, Button, Drawer, Group, Loader, Paper, ScrollArea, Select, Stack, Tabs, Text, TextInput, Textarea } from '@mantine/core'
import { IconPlus, IconSearch, IconTrash } from '@tabler/icons-react'
import { fetchPromptSamples, type PromptSampleDto } from '../../api/server'

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

const CUSTOM_STORAGE_KEY = 'tapcanvas.customPromptSamples'

const loadCustomSamples = (): PromptSampleDto[] => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CUSTOM_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PromptSampleDto => typeof item?.id === 'string' && typeof item?.prompt === 'string')
  } catch (error) {
    console.warn('failed to load custom prompt samples', error)
    return []
  }
}

const persistCustomSamples = (samples: PromptSampleDto[]) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(samples))
  } catch (error) {
    console.warn('failed to save custom prompt samples', error)
  }
}

const matchesQuery = (sample: PromptSampleDto, query: string) => {
  if (!query.trim()) return true
  const haystack = [
    sample.title,
    sample.scene,
    sample.commandType,
    sample.description,
    sample.prompt,
    sample.outputNote,
    sample.inputHint,
    ...(sample.keywords || [])
  ].join(' ').toLowerCase()
  return haystack.includes(query.trim().toLowerCase())
}

const nodeKindOptions = [
  { value: 'composeVideo', label: '视频节点' },
  { value: 'image', label: '图像节点' },
  { value: 'storyboard', label: '分镜节点' }
]

export function PromptSampleDrawer({ opened, nodeKind, onClose, onApplySample }: PromptSampleDrawerProps) {
  const effectiveKind = React.useMemo(() => normalizeKindForRequest(nodeKind), [nodeKind])
  const [queryInput, setQueryInput] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [samples, setSamples] = React.useState<PromptSampleDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [customSamples, setCustomSamples] = React.useState<PromptSampleDto[]>([])
  const [customError, setCustomError] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<'official' | 'custom'>('official')
  const [customForm, setCustomForm] = React.useState({
    title: '',
    scene: '',
    commandType: '',
    prompt: '',
    keywords: '',
    description: '',
    inputHint: '',
    outputNote: '',
    nodeKind: (effectiveKind as PromptSampleDto['nodeKind']) || 'composeVideo'
  })

  React.useEffect(() => {
    setCustomSamples(loadCustomSamples())
  }, [])

  React.useEffect(() => {
    if (!opened) {
      setQueryInput('')
      setQuery('')
      setCustomError(null)
      setCustomForm((prev) => ({ ...prev, title: '', scene: '', commandType: '', prompt: '', keywords: '', description: '', inputHint: '', outputNote: '' }))
    }
  }, [opened])

  React.useEffect(() => {
    if (!opened) return
    let canceled = false
    setLoading(true)
    setError(null)
    fetchPromptSamples({ query: query || undefined, nodeKind: effectiveKind })
      .then((res) => {
        if (canceled) return
        setSamples(res.samples || [])
      })
      .catch((err) => {
        if (canceled) return
        console.error('fetchPromptSamples failed', err)
        setError('加载提示词案例失败，请稍后再试')
      })
      .finally(() => {
        if (!canceled) setLoading(false)
      })
    return () => {
      canceled = true
    }
  }, [opened, query, effectiveKind])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setQuery(queryInput.trim())
  }

  const filteredCustomSamples = React.useMemo(() => {
    return customSamples.filter((sample) => {
      const kindMatches = effectiveKind ? sample.nodeKind === effectiveKind : true
      return kindMatches && matchesQuery(sample, query)
    })
  }, [customSamples, effectiveKind, query])

  const handleCustomFieldChange = (field: keyof typeof customForm, value: string) => {
    setCustomForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleAddCustomSample = () => {
    if (!customForm.title.trim() || !customForm.prompt.trim()) {
      setCustomError('标题和提示词不能为空')
      return
    }
    if (!customForm.scene.trim()) {
      setCustomError('请填写场景描述')
      return
    }
    setCustomError(null)
    const newSample: PromptSampleDto = {
      id: `custom-${Date.now()}`,
      scene: customForm.scene.trim(),
      commandType: customForm.commandType.trim() || '自定义模块',
      title: customForm.title.trim(),
      nodeKind: (customForm.nodeKind as PromptSampleDto['nodeKind']) || 'composeVideo',
      prompt: customForm.prompt.trim(),
      description: customForm.description.trim() || undefined,
      inputHint: customForm.inputHint.trim() || undefined,
      outputNote: customForm.outputNote.trim() || undefined,
      keywords: customForm.keywords
        .split(',')
        .map((word) => word.trim())
        .filter(Boolean)
    }
    const next = [newSample, ...customSamples]
    setCustomSamples(next)
    persistCustomSamples(next)
    setCustomForm((prev) => ({
      ...prev,
      title: '',
      scene: '',
      commandType: '',
      prompt: '',
      keywords: '',
      description: '',
      inputHint: '',
      outputNote: ''
    }))
  }

  const handleRemoveCustom = (id: string) => {
    const next = customSamples.filter((sample) => sample.id !== id)
    setCustomSamples(next)
    persistCustomSamples(next)
  }

  const kindBadge = effectiveKind ? <Badge variant="light" color="blue" size="sm">{nodeKindLabel[effectiveKind]}</Badge> : null

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title="提示词案例库"
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
            <Button type="button" variant="subtle" onClick={() => { setQueryInput(''); setQuery('') }}>
              重置
            </Button>
          </Group>
        </form>

        {kindBadge}

        <Tabs value={activeTab} onChange={(value) => setActiveTab((value as 'official' | 'custom') || 'official')}>
          <Tabs.List>
            <Tabs.Tab value="official">官方案例</Tabs.Tab>
            <Tabs.Tab value="custom">自定义案例</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="official" pt="sm">
            {loading && (
              <Group justify="center" py="md">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">
                  正在加载案例...
                </Text>
              </Group>
            )}

            {!loading && error && (
              <Paper withBorder p="md">
                <Text size="sm" c="red.5">
                  {error}
                </Text>
              </Paper>
            )}

            {!loading && !error && (
              <ScrollArea h="70vh" type="always">
                <Stack gap="sm">
                  {samples.length === 0 && (
                    <Paper withBorder p="md">
                      <Text size="sm" c="dimmed">
                        暂无匹配的案例，可以尝试其他关键字。
                      </Text>
                    </Paper>
                  )}
                  {samples.map((sample) => (
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
                        数据仅保存在当前浏览器
                      </Text>
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
                      placeholder="完整英文提示词"
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
                    {customError && (
                      <Text size="xs" c="red.6">
                        {customError}
                      </Text>
                    )}
                    <Group justify="flex-end">
                      <Button
                        size="xs"
                        variant="gradient"
                        leftSection={<IconPlus size={14} />}
                        onClick={handleAddCustomSample}
                      >
                        保存案例
                      </Button>
                    </Group>
                  </Stack>
                </Paper>

                {filteredCustomSamples.length === 0 ? (
                  <Paper withBorder p="md" radius="md">
                    <Text size="sm" c="dimmed">
                      暂无自定义案例，填写上方表单即可创建。
                    </Text>
                  </Paper>
                ) : (
                  filteredCustomSamples.map((sample) => (
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
                          <Group gap={6}>
                            <Badge color="orange" variant="light">
                              自定义
                            </Badge>
                            <Badge color="gray" variant="light">
                              {nodeKindLabel[sample.nodeKind]}
                            </Badge>
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color="red"
                              onClick={() => handleRemoveCustom(sample.id)}
                              aria-label="删除案例"
                            >
                              <IconTrash size={14} />
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
                  ))
                )}
              </Stack>
            </ScrollArea>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Drawer>
  )
}
