import React from 'react'
import { ActionIcon, Badge, Button, Divider, Group, Stack, Text, TextInput, Textarea, Tooltip } from '@mantine/core'
import { IconRefresh, IconSparkles } from '@tabler/icons-react'
import { getMemoryContext, type MemoryContextResponseDto, type MemoryEntryDto } from '../../../api/server'
import { toast } from '../../toast'
import { PanelCard } from '../../PanelCard'
import { InlinePanel } from '../../InlinePanel'

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

function EntryList({ title, items }: { title: string; items: MemoryEntryDto[] }): JSX.Element {
  return (
    <Stack className="stats-memory-context-debugger__section" gap="xs">
      <Group className="stats-memory-context-debugger__section-header" justify="space-between" align="center">
        <Text className="stats-memory-context-debugger__section-title" size="sm" fw={600}>{title}</Text>
        <Badge className="stats-memory-context-debugger__section-badge" size="xs" variant="light">{items.length}</Badge>
      </Group>
      {items.length === 0 ? (
        <Text className="stats-memory-context-debugger__section-empty" size="xs" c="dimmed">暂无</Text>
      ) : (
        items.map((item) => (
          <InlinePanel className="stats-memory-context-debugger__entry" key={item.id} padding="compact">
            <Text className="stats-memory-context-debugger__entry-title" size="sm" fw={500}>{item.title || item.summaryText || item.id}</Text>
            <Text className="stats-memory-context-debugger__entry-meta" size="xs" c="dimmed">
              {item.scopeType}:{item.scopeId} · {item.memoryType} · {formatTime(item.updatedAt)}
            </Text>
            <Textarea
              className="stats-memory-context-debugger__entry-content"
              value={prettyJson(item.content)}
              readOnly
              autosize
              minRows={2}
              mt={6}
            />
          </InlinePanel>
        ))
      )}
    </Stack>
  )
}

export default function StatsMemoryContextDebugger({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-memory-context-debugger', className].filter(Boolean).join(' ')
  const [sessionKey, setSessionKey] = React.useState('')
  const [projectId, setProjectId] = React.useState('')
  const [bookId, setBookId] = React.useState('')
  const [chapterId, setChapterId] = React.useState('')
  const [limitPerScope, setLimitPerScope] = React.useState('8')
  const [recentConversationLimit, setRecentConversationLimit] = React.useState('10')
  const [loading, setLoading] = React.useState(false)
  const [context, setContext] = React.useState<MemoryContextResponseDto['context'] | null>(null)
  const [responseText, setResponseText] = React.useState('')

  const runLoad = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await getMemoryContext({
        ...(sessionKey.trim() ? { sessionKey: sessionKey.trim() } : {}),
        ...(projectId.trim() ? { projectId: projectId.trim() } : {}),
        ...(bookId.trim() ? { bookId: bookId.trim() } : {}),
        ...(chapterId.trim() ? { chapterId: chapterId.trim() } : {}),
        ...(Number.isFinite(Number(limitPerScope)) ? { limitPerScope: Number(limitPerScope) } : {}),
        ...(Number.isFinite(Number(recentConversationLimit)) ? { recentConversationLimit: Number(recentConversationLimit) } : {}),
      })
      setContext(result.context)
      setResponseText(prettyJson(result))
      toast('记忆上下文已加载', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载记忆上下文失败'
      setContext(null)
      setResponseText(message)
      toast(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [bookId, chapterId, limitPerScope, projectId, recentConversationLimit, sessionKey])

  return (
    <PanelCard className={rootClassName}>
      <Group className="stats-memory-context-debugger__header" justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group className="stats-memory-context-debugger__header-left" gap={8} align="center">
          <Text className="stats-memory-context-debugger__title" fw={700} size="sm">记忆上下文调试</Text>
          <Badge className="stats-memory-context-debugger__badge" size="xs" variant="light">/memory/context</Badge>
        </Group>
        <Tooltip className="stats-memory-context-debugger__refresh-tooltip" label="加载" withArrow>
          <ActionIcon className="stats-memory-context-debugger__refresh" variant="light" onClick={() => void runLoad()} loading={loading}>
            <IconRefresh className="stats-memory-context-debugger__refresh-icon" size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Divider className="stats-memory-context-debugger__divider" my="sm" />

      <Stack className="stats-memory-context-debugger__body" gap="sm">
        <Group className="stats-memory-context-debugger__filters" align="flex-end" wrap="wrap" gap="sm">
          <TextInput className="stats-memory-context-debugger__session-key" label="Session Key" value={sessionKey} onChange={(e) => setSessionKey(e.currentTarget.value)} w={220} />
          <TextInput className="stats-memory-context-debugger__project-id" label="Project Id" value={projectId} onChange={(e) => setProjectId(e.currentTarget.value)} w={180} />
          <TextInput className="stats-memory-context-debugger__book-id" label="Book Id" value={bookId} onChange={(e) => setBookId(e.currentTarget.value)} w={180} />
          <TextInput className="stats-memory-context-debugger__chapter-id" label="Chapter Id" value={chapterId} onChange={(e) => setChapterId(e.currentTarget.value)} w={160} />
          <TextInput className="stats-memory-context-debugger__limit" label="Limit / Scope" value={limitPerScope} onChange={(e) => setLimitPerScope(e.currentTarget.value)} w={100} />
          <TextInput className="stats-memory-context-debugger__recent-limit" label="Recent Conv" value={recentConversationLimit} onChange={(e) => setRecentConversationLimit(e.currentTarget.value)} w={100} />
          <Button className="stats-memory-context-debugger__submit" leftSection={<IconSparkles className="stats-memory-context-debugger__submit-icon" size={14} />} onClick={() => void runLoad()} loading={loading}>加载上下文</Button>
        </Group>

        {context ? (
          <Stack className="stats-memory-context-debugger__content" gap="sm">
            <EntryList title="Session Rollups" items={context.rollups.session} />
            <EntryList title="Chapter Rollups" items={context.rollups.chapter} />
            <EntryList title="Book Rollups" items={context.rollups.book} />
            <EntryList title="Project Rollups" items={context.rollups.project} />
            <EntryList title="User Preferences" items={context.userPreferences} />
            <EntryList title="Project Facts" items={context.projectFacts} />
            <EntryList title="Book Facts" items={context.bookFacts} />
            <EntryList title="Chapter Facts" items={context.chapterFacts} />
            <EntryList title="Artifact Refs" items={context.artifactRefs} />
            <Stack className="stats-memory-context-debugger__recent" gap="xs">
              <Group className="stats-memory-context-debugger__recent-header" justify="space-between" align="center">
                <Text className="stats-memory-context-debugger__recent-title" size="sm" fw={600}>Recent Conversation</Text>
                <Badge className="stats-memory-context-debugger__recent-badge" size="xs" variant="light">{context.recentConversation.length}</Badge>
              </Group>
              {context.recentConversation.length === 0 ? (
                <Text className="stats-memory-context-debugger__recent-empty" size="xs" c="dimmed">暂无</Text>
              ) : context.recentConversation.map((item, index) => (
                <InlinePanel className="stats-memory-context-debugger__recent-item" key={`${item.createdAt}-${index}`} padding="compact">
                  <Text className="stats-memory-context-debugger__recent-role" size="xs" fw={600}>{item.role}</Text>
                  <Text className="stats-memory-context-debugger__recent-content" size="sm">{item.content}</Text>
                  <Text className="stats-memory-context-debugger__recent-time" size="xs" c="dimmed">{formatTime(item.createdAt)}</Text>
                </InlinePanel>
              ))}
            </Stack>
          </Stack>
        ) : (
          <Text className="stats-memory-context-debugger__empty" size="sm" c="dimmed">输入 scope 后点击“加载上下文”，查看 agents bridge 实际拿到的记忆。</Text>
        )}

        <Textarea className="stats-memory-context-debugger__response" label="Raw Response" value={responseText} readOnly autosize minRows={8} />
      </Stack>
    </PanelCard>
  )
}
