import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Group, Loader, Popover, ScrollArea, Stack, Text } from '@mantine/core'
import { IconFileDownload } from '@tabler/icons-react'
import { downloadChapterScripts, fetchChapterScriptPlans, type ChapterScriptPlanSummary } from '../../api/chapterScripts'
import { MAX_SCRIPT_EXPORT_CHAPTERS } from '../../../../../packages/schemas/chapter-script-export'
import { toast } from '../../ui/toast'

/** Initial selection follows chapter order; exporting never generates new prompts. */
export const DEFAULT_SCRIPT_EXPORT_EPISODES = 10

function planMeta(plan: ChapterScriptPlanSummary): string {
  return `${plan.clipCount} 个片段 · ${plan.durationSeconds}s · 提示词已保存`
}

/** Exports the per-Clip video prompts of chapters as one TXT script, one episode per chapter. */
export function ScriptExportPopover({ projectId }: Readonly<{ projectId: string }>): JSX.Element {
  return <ScriptExportContent className="tc-script-export-content" key={projectId} projectId={projectId} />
}

function ScriptExportContent({ projectId, className }: Readonly<{ projectId: string; className: string }>): JSX.Element {
  const [opened, setOpened] = useState(false)
  const [plans, setPlans] = useState<ChapterScriptPlanSummary[] | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  const generation = useRef(0)
  const mounted = useRef(true)
  const exportInFlight = useRef(false)
  const openedRef = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current += 1 }
  }, [])

  const changeOpened = (nextOpened: boolean) => {
    const request = ++generation.current
    openedRef.current = nextOpened
    setOpened(nextOpened)
    setPlans(null)
    setSelected(new Set())
    setError('')
    if (!nextOpened) return
    fetchChapterScriptPlans(projectId).then((items) => {
      if (!mounted.current || request !== generation.current) return
      setPlans(items)
      setSelected(new Set(items.slice(0, DEFAULT_SCRIPT_EXPORT_EPISODES).map((item) => item.chapterId)))
    }).catch((failure: unknown) => {
      if (mounted.current && request === generation.current) {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    })
  }

  const toggle = (chapterId: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current)
    if (checked) next.add(chapterId)
    else next.delete(chapterId)
    return next
  })
  const selectFirst = (count: number) => setSelected(new Set((plans ?? []).slice(0, count).map((item) => item.chapterId)))
  const chosen = (plans ?? []).filter((item) => selected.has(item.chapterId))

  const exportScripts = async () => {
    if (exportInFlight.current) return
    exportInFlight.current = true
    const request = generation.current
    const chapterIds = chosen.map(item => item.chapterId)
    setExporting(true)
    setError('')
    try {
      const fileName = await downloadChapterScripts(projectId, chapterIds)
      if (!mounted.current || request !== generation.current) return
      toast(`已导出 ${chapterIds.length} 集剧本：${fileName}`, 'success')
      changeOpened(false)
    } catch (failure: unknown) {
      if (mounted.current && request === generation.current) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      exportInFlight.current = false
      if (mounted.current) setExporting(false)
    }
  }

  return <Popover className={className} classNames={{ dropdown: 'tc-script-export' }} opened={opened} onChange={changeOpened}
    position="right-start" width={320} withinPortal>
    <Popover.Target className="tc-script-export__target">
      <Button className="tc-pipeline-production__export" variant="subtle" size="sm" onClick={() => changeOpened(!openedRef.current)}
        leftSection={<IconFileDownload className="tc-pipeline-production__export-icon" size={16} />}>
        导出剧本
      </Button>
    </Popover.Target>
    <Popover.Dropdown className="tc-script-export__dropdown">
      <Stack className="tc-script-export__body" gap="sm">
        <div className="tc-script-export__head">
          <Text className="tc-script-export__title" fw={600} size="sm">导出剧本 TXT</Text>
          <Text className="tc-script-export__hint" size="xs" c="dimmed">每章各片段的视频提示词作为一集，按章节顺序合成一个文件。</Text>
        </div>
        {error && <Alert className="tc-script-export__error" color="red" variant="light">{error}</Alert>}
        {!plans && !error && <Group className="tc-script-export__loading" gap="xs"><Loader className="tc-script-export__spinner" size={12} /><Text className="tc-script-export__loading-label" size="xs" c="dimmed">正在读取已出提示词的章节…</Text></Group>}
        {plans && plans.length === 0 && <Text className="tc-script-export__empty" size="xs" c="dimmed">还没有生成出视频提示词的章节。先对章节点击「一键成片」，片段提示词生成后即可导出。</Text>}
        {plans && plans.length > 0 && <React.Fragment key="exportable-chapters">
          <Group className="tc-script-export__quick" gap={6}>
            <Button className="tc-script-export__quick-action" size="compact-xs" disabled={exporting} variant="subtle" color="gray" onClick={() => selectFirst(DEFAULT_SCRIPT_EXPORT_EPISODES)}>前 {DEFAULT_SCRIPT_EXPORT_EPISODES} 集</Button>
            <Button className="tc-script-export__quick-action" size="compact-xs" disabled={exporting} variant="subtle" color="gray" onClick={() => selectFirst(plans.length)}>全选</Button>
            <Button className="tc-script-export__quick-action" size="compact-xs" disabled={exporting} variant="subtle" color="gray" onClick={() => setSelected(new Set())}>清空</Button>
          </Group>
          <ScrollArea.Autosize className="tc-script-export__list" mah={280}>
            <Stack className="tc-script-export__chapters" gap={8}>
              {plans.map((plan) => <Checkbox key={plan.chapterId} className="tc-script-export__chapter" size="xs"
                disabled={exporting} checked={selected.has(plan.chapterId)} onChange={(event) => toggle(plan.chapterId, event.currentTarget.checked)}
                label={plan.title} description={planMeta(plan)} />)}
            </Stack>
          </ScrollArea.Autosize>
          {chosen.length > MAX_SCRIPT_EXPORT_CHAPTERS && <Text className="tc-script-export__selection-limit" size="xs" c="red">每次最多导出 {MAX_SCRIPT_EXPORT_CHAPTERS} 集，请减少选择。</Text>}
          <Button className="tc-script-export__confirm" size="xs" loading={exporting} disabled={!chosen.length || chosen.length > MAX_SCRIPT_EXPORT_CHAPTERS} onClick={() => { void exportScripts() }}>
            导出 {chosen.length} 集
          </Button>
        </React.Fragment>}
      </Stack>
    </Popover.Dropdown>
  </Popover>
}
