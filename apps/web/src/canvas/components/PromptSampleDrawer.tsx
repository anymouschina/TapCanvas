import React from 'react'
import { Badge, Button, Drawer, Group, Loader, Paper, ScrollArea, Stack, Text, TextInput } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
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

export function PromptSampleDrawer({ opened, nodeKind, onClose, onApplySample }: PromptSampleDrawerProps) {
  const effectiveKind = React.useMemo(() => normalizeKindForRequest(nodeKind), [nodeKind])
  const [queryInput, setQueryInput] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [samples, setSamples] = React.useState<PromptSampleDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

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

  React.useEffect(() => {
    if (!opened) {
      setQueryInput('')
      setQuery('')
    }
  }, [opened])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setQuery(queryInput.trim())
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
          <ScrollArea h="75vh" type="scroll">
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
      </Stack>
    </Drawer>
  )
}
