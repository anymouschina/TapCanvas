import React from 'react'
import { Drawer, Group, Loader, Stack, Text, Title } from '@mantine/core'
import { fetchAdminTaskLog, type AdminTaskLogBundleDto } from '../../api/server'
import TaskLogOverview from './TaskLogOverview'
import TaskLogStatusTimeline from './TaskLogStatusTimeline'
import TaskLogVendorCalls from './TaskLogVendorCalls'

export default function TaskLogDrawer({
  opened,
  userId,
  taskId,
  onClose,
}: {
  opened: boolean
  userId: string | null
  taskId: string | null
  onClose: () => void
}): JSX.Element {
  const [bundle, setBundle] = React.useState<AdminTaskLogBundleDto | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!opened || !userId || !taskId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setBundle(null)
    fetchAdminTaskLog(userId, taskId)
      .then((data) => { if (!cancelled) setBundle(data) })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [opened, userId, taskId])

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={640}
      lockScroll={false}
      title={
        <Title order={5}>
          任务日志 {taskId ? <Text span c="dimmed" size="xs">{taskId}</Text> : null}
        </Title>
      }
      styles={{ inner: { zIndex: 1200 } }}
    >
      {loading && !bundle ? (
        <Group justify="center" py="lg"><Loader size="sm" /></Group>
      ) : error ? (
        <Text c="red" size="sm">{error}</Text>
      ) : bundle ? (
        <Stack gap="md">
          <TaskLogOverview bundle={bundle} />
          <Stack gap={4}>
            <Title order={6}>状态时间轴</Title>
            <TaskLogStatusTimeline bundle={bundle} />
          </Stack>
          <Stack gap={4}>
            <Title order={6}>原始厂商调用</Title>
            <TaskLogVendorCalls bundle={bundle} />
          </Stack>
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">未选中任务</Text>
      )}
    </Drawer>
  )
}
