import React from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core'
import { IconRefresh, IconSearch } from '@tabler/icons-react'
import { searchMemoryEntries, type MemoryEntryDto, type MemoryScopeType, type MemoryEntryType } from '../../../api/server'
import { toast } from '../../toast'
import { PanelCard } from '../../PanelCard'
import { InlinePanel } from '../../InlinePanel'

const scopeOptions: Array<{ value: MemoryScopeType; label: string }> = [
  { value: 'user', label: 'user' },
  { value: 'project', label: 'project' },
  { value: 'book', label: 'book' },
  { value: 'chapter', label: 'chapter' },
  { value: 'session', label: 'session' },
  { value: 'task', label: 'task' },
]

const memoryTypeOptions: Array<{ value: MemoryEntryType; label: string }> = [
  { value: 'preference', label: 'preference' },
  { value: 'domain_fact', label: 'domain_fact' },
  { value: 'artifact_ref', label: 'artifact_ref' },
]

function prettyJson(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input ?? '')
  }
}

function formatTime(value: string): string {
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return value
  return new Date(ts).toLocaleString()
}

export default function StatsMemoryDebugger({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-memory-debugger', className].filter(Boolean).join(' ')
  const [query, setQuery] = React.useState('storyboard continuity tailFrameUrl')
  const [scopeType, setScopeType] = React.useState<MemoryScopeType>('book')
  const [scopeId, setScopeId] = React.useState('')
  const [memoryType, setMemoryType] = React.useState<MemoryEntryType | ''>('artifact_ref')
  const [tagsInput, setTagsInput] = React.useState('storyboard,continuity')
  const [limit, setLimit] = React.useState('20')
  const [loading, setLoading] = React.useState(false)
  const [items, setItems] = React.useState<MemoryEntryDto[]>([])
  const [responseText, setResponseText] = React.useState('')

  const runSearch = React.useCallback(async () => {
    setLoading(true)
    try {
      const tags = tagsInput
        .split(/[\n,]+/g)
        .map((item) => item.trim())
        .filter(Boolean)
      const parsedLimit = Number(limit)
      const result = await searchMemoryEntries({
        ...(query.trim() ? { query: query.trim() } : {}),
        ...(scopeId.trim()
          ? { scopes: [{ scopeType, scopeId: scopeId.trim() }] }
          : {}),
        ...(memoryType ? { memoryTypes: [memoryType] } : {}),
        ...(tags.length ? { tags } : {}),
        ...(Number.isFinite(parsedLimit) && parsedLimit > 0 ? { limit: parsedLimit } : {}),
      })
      setItems(result.items)
      setResponseText(prettyJson(result))
      toast(`查询完成：${result.items.length} 条`, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'memory 查询失败'
      setItems([])
      setResponseText(message)
      toast(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [limit, memoryType, query, scopeId, scopeType, tagsInput])

  return (
    <PanelCard className={rootClassName}>
      <Group className="stats-memory-debugger__header" justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group className="stats-memory-debugger__header-left" gap={8} align="center">
          <Text className="stats-memory-debugger__title" fw={700} size="sm">用户记忆调试</Text>
          <Badge className="stats-memory-debugger__badge" size="xs" variant="light">/memory/search</Badge>
        </Group>
        <Tooltip className="stats-memory-debugger__refresh-tooltip" label="查询" withArrow>
          <ActionIcon className="stats-memory-debugger__refresh" variant="light" onClick={() => void runSearch()} loading={loading}>
            <IconRefresh className="stats-memory-debugger__refresh-icon" size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Divider className="stats-memory-debugger__divider" my="sm" />

      <Stack className="stats-memory-debugger__body" gap="sm">
        <Group className="stats-memory-debugger__filters" align="flex-end" wrap="wrap" gap="sm">
          <TextInput
            className="stats-memory-debugger__query"
            label="Query"
            placeholder="输入关键词..."
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            w={300}
            leftSection={<IconSearch className="stats-memory-debugger__query-icon" size={14} />}
          />
          <Select
            className="stats-memory-debugger__scope-type"
            label="Scope Type"
            data={scopeOptions}
            value={scopeType}
            onChange={(value) => setScopeType((value as MemoryScopeType) || 'book')}
            w={140}
          />
          <TextInput
            className="stats-memory-debugger__scope-id"
            label="Scope Id"
            placeholder="book_demo_01 / chapter_03"
            value={scopeId}
            onChange={(e) => setScopeId(e.currentTarget.value)}
            w={220}
          />
          <Select
            className="stats-memory-debugger__memory-type"
            label="Memory Type"
            clearable
            data={memoryTypeOptions}
            value={memoryType || null}
            onChange={(value) => setMemoryType((value as MemoryEntryType | null) || '')}
            w={160}
          />
          <TextInput
            className="stats-memory-debugger__limit"
            label="Limit"
            value={limit}
            onChange={(e) => setLimit(e.currentTarget.value)}
            w={100}
          />
          <Button
            className="stats-memory-debugger__submit"
            leftSection={<IconSearch className="stats-memory-debugger__submit-icon" size={14} />}
            onClick={() => void runSearch()}
            loading={loading}
          >
            搜索
          </Button>
        </Group>

        <Textarea
          className="stats-memory-debugger__tags"
          label="Tags"
          placeholder="storyboard,continuity"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.currentTarget.value)}
          minRows={2}
        />

        <Stack className="stats-memory-debugger__results" gap="xs">
          {items.length === 0 ? (
            <Text className="stats-memory-debugger__empty" size="sm" c="dimmed">暂无结果</Text>
          ) : (
            items.map((item) => (
              <InlinePanel className="stats-memory-debugger__item" key={item.id}>
                <Group className="stats-memory-debugger__item-header" justify="space-between" align="flex-start" gap="sm" wrap="wrap">
                  <Stack className="stats-memory-debugger__item-title-block" gap={2}>
                    <Text className="stats-memory-debugger__item-title" size="sm" fw={600}>{item.title || item.summaryText || item.id}</Text>
                    <Text className="stats-memory-debugger__item-meta" size="xs" c="dimmed">
                      {item.scopeType}:{item.scopeId} · {item.memoryType} · importance={item.importance}
                    </Text>
                  </Stack>
                  <Text className="stats-memory-debugger__item-time" size="xs" c="dimmed">{formatTime(item.updatedAt)}</Text>
                </Group>
                {item.tags.length > 0 ? (
                  <Group className="stats-memory-debugger__item-tags" gap={6} mt={8}>
                    {item.tags.map((tag) => (
                      <Badge className="stats-memory-debugger__item-tag" key={`${item.id}-${tag}`} size="xs" variant="light">{tag}</Badge>
                    ))}
                  </Group>
                ) : null}
                <Textarea
                  className="stats-memory-debugger__item-content"
                  value={prettyJson(item.content)}
                  readOnly
                  autosize
                  minRows={3}
                  mt={8}
                />
              </InlinePanel>
            ))
          )}
        </Stack>

        <Textarea
          className="stats-memory-debugger__response"
          label="Raw Response"
          value={responseText}
          readOnly
          autosize
          minRows={8}
        />
      </Stack>
    </PanelCard>
  )
}
