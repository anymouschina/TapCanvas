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
  if (kind === 'image' || kind === 'textToImage' || kind === 'storyboardImage' || kind === 'imageFission') return 'image'
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
    <Badge className="prompt-sample-drawer__kind-badge" variant="light" color="blue" size="sm">
      {nodeKindLabel[effectiveKind]}
    </Badge>
  ) : null

  return (
    <Drawer
      className="prompt-sample-drawer"
      opened={opened}
      onClose={onClose}
      title="提示词支持共享配置"
      position="right"
      size="lg"
      overlayProps={{ opacity: 0.55, blur: 2 }}
      withinPortal
    >
      <Stack className="prompt-sample-drawer__stack" gap="sm">
        <form className="prompt-sample-drawer__search-form" onSubmit={handleSubmit}>
          <Group className="prompt-sample-drawer__search-group" align="flex-end" gap="xs">
            <TextInput
              className="prompt-sample-drawer__search-input"
              label="搜索场景或关键字"
              placeholder="例如：水墨风、海报、文字修改"
              value={queryInput}
              onChange={(e) => setQueryInput(e.currentTarget.value)}
              leftSection={<IconSearch size={14} />}
              style={{ flex: 1 }}
            />
            <Button className="prompt-sample-drawer__search-submit" type="submit" variant="light">
              搜索
            </Button>
            <Button
              className="prompt-sample-drawer__search-reset"
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

        <Tabs
          className="prompt-sample-drawer__tabs"
          value={activeTab}
          onChange={(value) => setActiveTab((value as 'official' | 'custom') || 'official')}
        >
          <Tabs.List className="prompt-sample-drawer__tabs-list">
            <Tabs.Tab className="prompt-sample-drawer__tabs-tab" value="official">
              公共案例
            </Tabs.Tab>
            <Tabs.Tab className="prompt-sample-drawer__tabs-tab" value="custom">
              自定义案例
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel className="prompt-sample-drawer__tabs-panel" value="official" pt="sm">
            {officialLoading && (
              <Group className="prompt-sample-drawer__loading" justify="center" py="md">
                <Loader className="prompt-sample-drawer__loading-spinner" size="sm" />
                <Text className="prompt-sample-drawer__loading-text" size="sm" c="dimmed">
                  正在加载案例...
                </Text>
              </Group>
            )}

            {!officialLoading && officialError && (
              <Paper className="prompt-sample-drawer__error" withBorder p="md">
                <Text className="prompt-sample-drawer__error-text" size="sm" c="red.5">
                  {officialError}
                </Text>
              </Paper>
            )}

            {!officialLoading && !officialError && (
              <ScrollArea className="prompt-sample-drawer__scroll" h="70vh" type="always">
                <Stack className="prompt-sample-drawer__list" gap="sm">
                  {officialSamples.length === 0 && (
                    <Paper className="prompt-sample-drawer__empty" withBorder p="md">
                      <Text className="prompt-sample-drawer__empty-text" size="sm" c="dimmed">
                        暂无匹配的案例，可以尝试其他关键字。
                      </Text>
                    </Paper>
                  )}
                  {officialSamples.map((sample) => (
                    <Paper
                      className="prompt-sample-drawer__sample-card"
                      key={sample.id}
                      withBorder
                      radius="md"
                      p="md"
                      shadow="xs"
                    >
                      <Stack className="prompt-sample-drawer__sample-stack" gap={4}>
                        <Group className="prompt-sample-drawer__sample-header" justify="space-between" align="flex-start">
                          <div className="prompt-sample-drawer__sample-meta">
                            <Text className="prompt-sample-drawer__sample-title" fw={600} size="sm">
                              {sample.title}
                            </Text>
                            <Text className="prompt-sample-drawer__sample-meta-text" size="xs" c="dimmed">
                              {sample.scene} ｜ {sample.commandType}
                            </Text>
                          </div>
                          <Badge className="prompt-sample-drawer__sample-kind" color="gray" variant="light">
                            {nodeKindLabel[sample.nodeKind]}
                          </Badge>
                        </Group>
                        {sample.description && (
                          <Text className="prompt-sample-drawer__sample-description" size="sm" c="dimmed">
                            {sample.description}
                          </Text>
                        )}
                        <Text className="prompt-sample-drawer__sample-prompt" size="sm" style={{ whiteSpace: 'pre-line' }}>
                          {sample.prompt}
                        </Text>
                        {sample.outputNote && (
                          <Text className="prompt-sample-drawer__sample-output" size="xs" c="dimmed">
                            效果：{sample.outputNote}
                          </Text>
                        )}
                        {sample.inputHint && (
                          <Text className="prompt-sample-drawer__sample-input-hint" size="xs" c="dimmed">
                            输入建议：{sample.inputHint}
                          </Text>
                        )}
                        <Group className="prompt-sample-drawer__sample-actions" justify="space-between" mt="sm">
                          <Group className="prompt-sample-drawer__sample-keywords" gap={4}>
                            {sample.keywords.slice(0, 3).map((keyword) => (
                              <Badge
                                className="prompt-sample-drawer__sample-keyword"
                                key={keyword}
                                size="xs"
                                color="dark"
                                variant="outline"
                              >
                                {keyword}
                              </Badge>
                            ))}
                          </Group>
                          <Button
                            className="prompt-sample-drawer__sample-apply"
                            size="xs"
                            onClick={() => onApplySample(sample)}
                          >
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

          <Tabs.Panel className="prompt-sample-drawer__tabs-panel" value="custom" pt="sm">
            <ScrollArea className="prompt-sample-drawer__scroll" h="70vh" type="always">
              <Stack className="prompt-sample-drawer__list" gap="sm">
                <Paper className="prompt-sample-drawer__custom-form" withBorder p="md" radius="md" shadow="xs">
                  <Stack className="prompt-sample-drawer__custom-form-stack" gap="xs">
                    <Group className="prompt-sample-drawer__custom-form-header" justify="space-between" align="center">
                      <Text className="prompt-sample-drawer__custom-form-title" fw={600}>
                        自定义案例
                      </Text>
                      <Text className="prompt-sample-drawer__custom-form-desc" size="xs" c="dimmed">
                        存储在服务器，可跨设备复用
                      </Text>
                    </Group>
                    <Textarea
                      className="prompt-sample-drawer__custom-raw"
                      label="原始提示词"
                      placeholder="粘贴长提示词，AI 将自动提取字段"
                      minRows={4}
                      value={rawPrompt}
                      onChange={(e) => setRawPrompt(e.currentTarget.value)}
                    />
                    <Group className="prompt-sample-drawer__custom-parse" justify="flex-end">
                      <Button
                        className="prompt-sample-drawer__custom-parse-btn"
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
                      className="prompt-sample-drawer__custom-node-kind"
                      label="节点类型"
                      data={nodeKindOptions}
                      value={customForm.nodeKind}
                      onChange={(value) => handleCustomFieldChange('nodeKind', value || 'composeVideo')}
                      allowDeselect={false}
                    />
                    <Group className="prompt-sample-drawer__custom-row" grow>
                      <TextInput
                        className="prompt-sample-drawer__custom-title"
                        label="标题"
                        placeholder="例如：山雨破庙开场"
                        value={customForm.title}
                        onChange={(e) => handleCustomFieldChange('title', e.currentTarget.value)}
                      />
                      <TextInput
                        className="prompt-sample-drawer__custom-scene"
                        label="场景"
                        placeholder="用于分类，如“视频真实感”"
                        value={customForm.scene}
                        onChange={(e) => handleCustomFieldChange('scene', e.currentTarget.value)}
                      />
                    </Group>
                    <TextInput
                      className="prompt-sample-drawer__custom-command-type"
                      label="指令类型（可选）"
                      placeholder="例如：微剧情、风格改写"
                      value={customForm.commandType}
                      onChange={(e) => handleCustomFieldChange('commandType', e.currentTarget.value)}
                    />
                    <Textarea
                      className="prompt-sample-drawer__custom-prompt"
                      label="提示词"
                      minRows={4}
                      placeholder="完整英文/中文提示词"
                      value={customForm.prompt}
                      onChange={(e) => handleCustomFieldChange('prompt', e.currentTarget.value)}
                    />
                    <Textarea
                      className="prompt-sample-drawer__custom-description"
                      label="描述（可选）"
                      minRows={2}
                      value={customForm.description}
                      onChange={(e) => handleCustomFieldChange('description', e.currentTarget.value)}
                    />
                    <Group className="prompt-sample-drawer__custom-row" grow>
                      <TextInput
                        className="prompt-sample-drawer__custom-input-hint"
                        label="输入建议（可选）"
                        value={customForm.inputHint}
                        onChange={(e) => handleCustomFieldChange('inputHint', e.currentTarget.value)}
                      />
                      <TextInput
                        className="prompt-sample-drawer__custom-output-note"
                        label="预期效果（可选）"
                        value={customForm.outputNote}
                        onChange={(e) => handleCustomFieldChange('outputNote', e.currentTarget.value)}
                      />
                    </Group>
                    <TextInput
                      className="prompt-sample-drawer__custom-keywords"
                      label="关键词（逗号分隔，可选）"
                      value={customForm.keywords}
                      onChange={(e) => handleCustomFieldChange('keywords', e.currentTarget.value)}
                    />
                    {formError && (
                      <Text className="prompt-sample-drawer__custom-error" size="xs" c="red.6">
                        {formError}
                      </Text>
                    )}
                    {formSuccess && (
                      <Text className="prompt-sample-drawer__custom-success" size="xs" c="teal.6">
                        {formSuccess}
                      </Text>
                    )}
                    <Group className="prompt-sample-drawer__custom-actions" justify="flex-end">
                      <Button className="prompt-sample-drawer__custom-reset" size="xs" variant="subtle" onClick={resetForm}>
                        重置表单
                      </Button>
                      <Button className="prompt-sample-drawer__custom-save" size="xs" onClick={handleSave} loading={saving}>
                        保存案例
                      </Button>
                    </Group>
                  </Stack>
                </Paper>

                {customLoading && (
                  <Group className="prompt-sample-drawer__custom-loading" justify="center" py="md">
                    <Loader className="prompt-sample-drawer__custom-loading-spinner" size="sm" />
                    <Text className="prompt-sample-drawer__custom-loading-text" size="sm" c="dimmed">
                      正在加载自定义案例...
                    </Text>
                  </Group>
                )}

                {!customLoading && customError && (
                  <Paper className="prompt-sample-drawer__custom-error-card" withBorder p="md">
                    <Text className="prompt-sample-drawer__custom-error-text" size="sm" c="red.5">
                      {customError}
                    </Text>
                  </Paper>
                )}

                {!customLoading && !customError && customSamples.length === 0 && (
                  <Paper className="prompt-sample-drawer__custom-empty" withBorder p="md" radius="md">
                    <Text className="prompt-sample-drawer__custom-empty-text" size="sm" c="dimmed">
                      暂无自定义案例，填写上方表单即可创建。
                    </Text>
                  </Paper>
                )}

                {!customLoading && !customError && customSamples.map((sample) => (
                  <Paper
                    className="prompt-sample-drawer__custom-card"
                    key={sample.id}
                    withBorder
                    radius="md"
                    p="md"
                    shadow="xs"
                  >
                    <Stack className="prompt-sample-drawer__custom-card-stack" gap={4}>
                      <Group className="prompt-sample-drawer__custom-card-header" justify="space-between" align="flex-start">
                        <div className="prompt-sample-drawer__custom-card-meta">
                          <Group className="prompt-sample-drawer__custom-card-title-group" gap={6}>
                            <Text className="prompt-sample-drawer__custom-card-title" fw={600} size="sm">
                              {sample.title}
                            </Text>
                            <Badge className="prompt-sample-drawer__custom-card-tag" color="orange" variant="light">
                              自定义
                            </Badge>
                          </Group>
                          <Text className="prompt-sample-drawer__custom-card-meta-text" size="xs" c="dimmed">
                            {sample.scene} ｜ {sample.commandType}
                          </Text>
                        </div>
                        <Group className="prompt-sample-drawer__custom-card-actions" gap={6}>
                          <Badge className="prompt-sample-drawer__custom-card-kind" color="gray" variant="light">
                            {nodeKindLabel[sample.nodeKind]}
                          </Badge>
                          <ActionIcon
                            className="prompt-sample-drawer__custom-card-delete"
                            size="sm"
                            variant="subtle"
                            color="red"
                            onClick={() => handleDelete(sample.id)}
                            disabled={deletingId === sample.id}
                          >
                            {deletingId === sample.id ? (
                              <Loader className="prompt-sample-drawer__custom-card-delete-spinner" size="xs" color="red" />
                            ) : (
                              <IconTrash size={14} />
                            )}
                          </ActionIcon>
                        </Group>
                      </Group>
                      {sample.description && (
                        <Text className="prompt-sample-drawer__custom-card-description" size="sm" c="dimmed">
                          {sample.description}
                        </Text>
                      )}
                      <Text className="prompt-sample-drawer__custom-card-prompt" size="sm" style={{ whiteSpace: 'pre-line' }}>
                        {sample.prompt}
                      </Text>
                      {sample.outputNote && (
                        <Text className="prompt-sample-drawer__custom-card-output" size="xs" c="dimmed">
                          效果：{sample.outputNote}
                        </Text>
                      )}
                      {sample.inputHint && (
                        <Text className="prompt-sample-drawer__custom-card-input-hint" size="xs" c="dimmed">
                          输入建议：{sample.inputHint}
                        </Text>
                      )}
                      <Group className="prompt-sample-drawer__custom-card-footer" justify="space-between" mt="sm">
                        <Group className="prompt-sample-drawer__custom-card-keywords" gap={4}>
                          {sample.keywords.slice(0, 3).map((keyword) => (
                            <Badge
                              className="prompt-sample-drawer__custom-card-keyword"
                              key={keyword}
                              size="xs"
                              color="dark"
                              variant="outline"
                            >
                              {keyword}
                            </Badge>
                          ))}
                        </Group>
                        <Button
                          className="prompt-sample-drawer__custom-card-apply"
                          size="xs"
                          onClick={() => onApplySample(sample)}
                        >
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
