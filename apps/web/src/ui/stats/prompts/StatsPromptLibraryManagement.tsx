import React from 'react'
import { Button, Group, Progress, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { IconPlayerPlay, IconRefresh, IconRestore } from '@tabler/icons-react'
import {
  getPromptLibrarySummary,
  listPromptLibraryCrawls,
  resumePromptLibraryCrawl,
  startPromptLibraryCrawl,
  type PromptLibraryCrawlRun,
  type PromptLibrarySummary,
} from '../../../api/promptLibrary'
import { InlinePanel } from '../../InlinePanel'
import { PanelCard } from '../../PanelCard'
import { StatePanel } from '../../StatePanel'
import { StatusBadge } from '../../StatusBadge'
import { toast } from '../../toast'

const STATUS_LABELS: Record<PromptLibraryCrawlRun['status'], string> = {
  queued: '排队中',
  running: '采集中',
  succeeded: '已完成',
  partial: '部分成功',
  failed: '失败',
}

function statusTone(status: PromptLibraryCrawlRun['status']): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'succeeded') return 'success'
  if (status === 'partial') return 'warning'
  if (status === 'failed') return 'danger'
  return 'neutral'
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(date)
}

export default function StatsPromptLibraryManagement({ className }: { className?: string }): JSX.Element {
  const [summary, setSummary] = React.useState<PromptLibrarySummary | null>(null)
  const [runs, setRuns] = React.useState<PromptLibraryCrawlRun[]>([])
  const [loading, setLoading] = React.useState(true)
  const [acting, setActing] = React.useState(false)
  const [error, setError] = React.useState('')
  const latestRun = runs[0] ?? null
  const hasActiveRun = latestRun?.status === 'queued' || latestRun?.status === 'running'

  const reload = React.useCallback(async (quiet = false): Promise<void> => {
    if (!quiet) setLoading(true)
    try {
      const [nextSummary, nextRuns] = await Promise.all([getPromptLibrarySummary(), listPromptLibraryCrawls()])
      setSummary(nextSummary)
      setRuns(nextRuns)
      setError('')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '加载提示词采集状态失败'
      setError(message)
      if (!quiet) toast(message, 'error')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  React.useEffect(() => { void reload() }, [reload])

  React.useEffect(() => {
    if (!hasActiveRun) return
    const timer = window.setInterval(() => void reload(true), 3_000)
    return () => window.clearInterval(timer)
  }, [hasActiveRun, reload])

  const start = async (): Promise<void> => {
    setActing(true)
    try {
      await startPromptLibraryCrawl()
      toast('全量采集任务已启动', 'success')
      await reload(true)
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : '启动采集失败', 'error')
    } finally {
      setActing(false)
    }
  }

  const resume = async (): Promise<void> => {
    if (!latestRun) return
    setActing(true)
    try {
      await resumePromptLibraryCrawl(latestRun.id)
      toast('失败条目已重新加入采集队列', 'success')
      await reload(true)
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : '继续采集失败', 'error')
    } finally {
      setActing(false)
    }
  }

  if (loading && !summary) {
    return <StatePanel className={`${className ?? ''} stats-prompt-library__loading`.trim()} title="加载提示词采集状态…" tone="loading" />
  }

  if (error && !summary) {
    return <StatePanel className={`${className ?? ''} stats-prompt-library__error`.trim()} title="无法加载提示词采集后台" description={error} tone="error" />
  }

  const progress = latestRun && latestRun.discoveredCount > 0
    ? Math.min(100, Math.round((latestRun.processedCount / latestRun.discoveredCount) * 100))
    : 0

  return (
    <Stack className={`${className ?? ''} stats-prompt-library`.trim()} gap="md">
      <PanelCard className="stats-prompt-library__header-card">
        <Group className="stats-prompt-library__header" justify="space-between" align="flex-start" wrap="wrap">
          <Stack className="stats-prompt-library__heading" gap={4}>
            <Title className="stats-prompt-library__title" order={4}>提示词采集</Title>
            <Text className="stats-prompt-library__description" size="xs" c="dimmed">
              从 YouMind 公开 sitemap 全量采集 8 个目标模型；按提示词正文去重，多张输出媒体归入同一条目。
            </Text>
          </Stack>
          <Group className="stats-prompt-library__actions" gap={8}>
            <Button className="stats-prompt-library__refresh" size="xs" variant="subtle" leftSection={<IconRefresh className="stats-prompt-library__refresh-icon" size={14} />} onClick={() => void reload()} disabled={acting}>刷新</Button>
            {latestRun && (latestRun.status === 'partial' || latestRun.status === 'failed') ? (
              <Button className="stats-prompt-library__resume" size="xs" variant="light" leftSection={<IconRestore className="stats-prompt-library__resume-icon" size={14} />} onClick={() => void resume()} loading={acting}>重试失败项</Button>
            ) : null}
            <Button className="stats-prompt-library__start" size="xs" leftSection={<IconPlayerPlay className="stats-prompt-library__start-icon" size={14} />} onClick={() => void start()} loading={acting} disabled={hasActiveRun}>开始全量采集</Button>
          </Group>
        </Group>
      </PanelCard>

      <SimpleGrid className="stats-prompt-library__summary" cols={{ base: 2, md: 4 }} spacing="sm">
        <InlinePanel className="stats-prompt-library__summary-item"><Text className="stats-prompt-library__summary-label" size="xs" c="dimmed">去重提示词</Text><Text className="stats-prompt-library__summary-value" fw={750}>{summary?.entryCount.toLocaleString('zh-CN') ?? 0}</Text></InlinePanel>
        <InlinePanel className="stats-prompt-library__summary-item"><Text className="stats-prompt-library__summary-label" size="xs" c="dimmed">输出媒体</Text><Text className="stats-prompt-library__summary-value" fw={750}>{summary?.mediaCount.toLocaleString('zh-CN') ?? 0}</Text></InlinePanel>
        <InlinePanel className="stats-prompt-library__summary-item"><Text className="stats-prompt-library__summary-label" size="xs" c="dimmed">来源记录</Text><Text className="stats-prompt-library__summary-value" fw={750}>{summary?.sourceCount.toLocaleString('zh-CN') ?? 0}</Text></InlinePanel>
        <InlinePanel className="stats-prompt-library__summary-item"><Text className="stats-prompt-library__summary-label" size="xs" c="dimmed">已覆盖模型</Text><Text className="stats-prompt-library__summary-value" fw={750}>{summary?.modelCount ?? 0} / 8</Text></InlinePanel>
      </SimpleGrid>

      <PanelCard className="stats-prompt-library__runs-card">
        <Stack className="stats-prompt-library__runs" gap="sm">
          <Group className="stats-prompt-library__runs-header" justify="space-between">
            <Text className="stats-prompt-library__runs-title" size="sm" fw={650}>采集记录</Text>
            {latestRun ? <StatusBadge className="stats-prompt-library__latest-status" tone={statusTone(latestRun.status)} variant="light">{STATUS_LABELS[latestRun.status]}</StatusBadge> : null}
          </Group>
          {latestRun ? (
            <Stack className="stats-prompt-library__latest" gap={8}>
              <Progress className="stats-prompt-library__progress" value={progress} size="sm" color={latestRun.status === 'failed' ? 'red' : latestRun.status === 'partial' ? 'yellow' : 'gray'} animated={hasActiveRun} />
              <SimpleGrid className="stats-prompt-library__run-metrics" cols={{ base: 2, sm: 3, lg: 6 }} spacing="xs">
                <Text className="stats-prompt-library__run-metric" size="xs">发现 {latestRun.discoveredCount}</Text>
                <Text className="stats-prompt-library__run-metric" size="xs">处理 {latestRun.processedCount}</Text>
                <Text className="stats-prompt-library__run-metric" size="xs">新增 {latestRun.importedCount}</Text>
                <Text className="stats-prompt-library__run-metric" size="xs">去重 {latestRun.deduplicatedCount}</Text>
                <Text className="stats-prompt-library__run-metric" size="xs">跳过 {latestRun.skippedCount}</Text>
                <Text className="stats-prompt-library__run-metric" size="xs" c={latestRun.failedCount > 0 ? 'red' : undefined}>失败 {latestRun.failedCount}</Text>
              </SimpleGrid>
              {latestRun.currentUrl ? <Text className="stats-prompt-library__current-url" size="xs" c="dimmed" lineClamp={1}>当前：{latestRun.currentUrl}</Text> : null}
              {latestRun.errorMessage ? <Text className="stats-prompt-library__run-error" size="xs" c="red">{latestRun.errorMessage}</Text> : null}
              <Text className="stats-prompt-library__run-time" size="xs" c="dimmed">开始 {formatDate(latestRun.startedAt)} · 结束 {formatDate(latestRun.finishedAt)}</Text>
            </Stack>
          ) : (
            <Text className="stats-prompt-library__empty" size="xs" c="dimmed">尚未执行全量采集。</Text>
          )}
        </Stack>
      </PanelCard>
    </Stack>
  )
}
