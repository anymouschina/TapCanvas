import { useEffect, useState } from 'react'
import { ActionIcon, Badge, Group, Loader, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useVideoRunStore, selectActiveRuns, buildVideoRunChipLabel, isVideoRunDisplayStalled } from '../../runner/videoRunStore'
import { useUIStore } from '../../ui/uiStore'
import { cancelProjectVideoRuns } from '../../api/server'

/** 画布常驻的视频 run 指示器：只显示仍在生产的真实进度与终止入口。
 * 子片齐备后的合成状态由成片节点展示，不在此处重复展示。
 *  当 run 不属于当前正在看的章节（或在项目主画布）时，文案追加归属章节名。
 *  projectId/currentChapterId 可显式传入（章节画布页用，避免依赖可能滞后的 uiStore）；
 *  不传则回退到 uiStore（项目主画布用）。 */
export function VideoRunIndicator({
  projectId: projectIdProp,
  currentChapterId: currentChapterIdProp,
}: {
  projectId?: string | null
  currentChapterId?: string | null
} = {}) {
  const active = useVideoRunStore(selectActiveRuns)
  const aiChatOpen = useUIStore((s) => s.aiChatOpen)
  const projectIdFromStore = useUIStore((s) => s.currentProject?.id)
  const currentChapterIdFromStore = useUIStore((s) => s.currentChapter?.chapterId ?? null)
  const projectId = projectIdProp ?? projectIdFromStore
  const currentChapterId = currentChapterIdProp ?? currentChapterIdFromStore
  const [cancelling, setCancelling] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  if (active.length <= 0 || aiChatOpen) return null

  const stalled = active.some((run) => isVideoRunDisplayStalled(run, nowMs))
  const label = buildVideoRunChipLabel(active, currentChapterId, nowMs)

  async function onCancel() {
    if (!projectId || cancelling) return
    setCancelling(true)
    try {
      const n = await cancelProjectVideoRuns(projectId)
      notifications.show({
        title: '已请求终止',
        message: n > 0 ? `已停止 ${n} 个视频生产任务，画布将不再自动更新` : '没有正在运行的视频生产任务',
        color: 'gray',
        autoClose: 4000,
      })
    } catch {
      notifications.show({ title: '终止失败', message: '请重试或刷新页面', color: 'red', autoClose: 5000 })
    } finally {
      setCancelling(false)
    }
  }

  // 外层 wrapper 是 pointerEvents:none —— 这里显式开 auto，让终止按钮可点。
  return (
    <Group gap={6} align="center" style={{ pointerEvents: 'auto' }}>
      <Badge
        size="lg"
        radius="sm"
        variant="light"
        color={stalled ? 'orange' : 'gray'}
        leftSection={<Loader className="tc-video-run-indicator__loader" size={12} color={stalled ? 'orange' : 'gray'} />}
        styles={{ root: { textTransform: 'none' } }}
      >
        {label}
      </Badge>
      <Tooltip label={stalled ? '任务长时间没有状态进展；可终止后依据错误证据恢复' : '终止视频生产（停止画布自动更新；已提交的单段可能仍渲染完）'} withArrow>
        <ActionIcon
          className="tc-video-run-indicator__cancel"
          size="md"
          radius="sm"
          variant="light"
          color="red"
          loading={cancelling}
          onClick={onCancel}
          aria-label="终止视频生产"
        >
          ✕
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}
