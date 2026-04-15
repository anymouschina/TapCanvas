import React from 'react'
import { Alert, AppShell, Button, Group, Loader, Stack, Text, Title } from '@mantine/core'
import GithubGate from '../auth/GithubGate'
import { useAuth } from '../auth/store'
import { listProjectChapters } from '../api/server'
import { buildStudioUrl } from '../utils/appRoutes'
import { spaNavigate } from '../utils/spaNavigate'

type ProjectChapterRouteRedirectPageProps = {
  projectId: string
  chapterId: string
  shotId?: string
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return fallback
}

export default function ProjectChapterRouteRedirectPage({
  projectId,
  chapterId,
  shotId,
}: ProjectChapterRouteRedirectPageProps): JSX.Element {
  const auth = useAuth()
  const [status, setStatus] = React.useState<'loading' | 'failed'>('loading')
  const [message, setMessage] = React.useState('正在切换到画布内分镜工作台…')

  const redirectToStudioWorkbench = React.useCallback(async () => {
    if (!auth.user || !projectId || !chapterId) return
    setStatus('loading')
    setMessage('正在切换到画布内分镜工作台…')
    try {
      const chapters = await listProjectChapters(projectId)
      const matchedChapter = chapters.find((chapter) => chapter.id === chapterId) || null
      const nextUrl = buildStudioUrl({
        projectId,
        ownerType: shotId ? 'shot' : 'chapter',
        ownerId: shotId || chapterId,
        panel: 'nanoComic',
        chapter: matchedChapter?.index ?? null,
        shotId: shotId || null,
      })
      spaNavigate(nextUrl)
    } catch (error) {
      setStatus('failed')
      setMessage(resolveErrorMessage(error, '无法切换到画布工作台，请稍后重试。'))
    }
  }, [auth.user, chapterId, projectId, shotId])

  React.useEffect(() => {
    void redirectToStudioWorkbench()
  }, [redirectToStudioWorkbench])

  if (!auth.user) return <GithubGate><></></GithubGate>

  return (
    <AppShell padding="md">
      <AppShell.Main>
        <Stack align="center" justify="center" h="100vh" maw={560} mx="auto">
          {status === 'loading' ? <Loader size="sm" /> : null}
          <Title order={3}>分镜工作台已迁入画布</Title>
          <Text size="sm" c="dimmed" ta="center">{message}</Text>
          {status === 'failed' ? (
            <Alert variant="light" color="red" title="跳转失败" w="100%">
              当前独立章节页已经废弃。请改从画布内的“漫剧工作台”抽屉进入。
            </Alert>
          ) : null}
          <Group>
            <Button variant="light" onClick={() => void redirectToStudioWorkbench()}>重试进入画布</Button>
            <Button
              variant="subtle"
              onClick={() => spaNavigate(buildStudioUrl({ projectId, panel: 'nanoComic' }))}
            >
              打开项目画布
            </Button>
          </Group>
        </Stack>
      </AppShell.Main>
    </AppShell>
  )
}
