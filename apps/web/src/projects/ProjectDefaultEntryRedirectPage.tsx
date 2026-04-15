import React from 'react'
import { Alert, AppShell, Button, Group, Loader, Stack, Text, Title } from '@mantine/core'
import GithubGate from '../auth/GithubGate'
import { useAuth } from '../auth/store'
import { getChapterWorkbench, getProjectDefaultEntry, listProjectChapters } from '../api/server'
import { buildStudioUrl } from '../utils/appRoutes'
import { spaNavigate } from '../utils/spaNavigate'
import { ensureProjectHasAutoBoundFirstChapter } from './projectChapterBootstrap'

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return fallback
}

export default function ProjectDefaultEntryRedirectPage({ projectId }: { projectId: string }): JSX.Element {
  const auth = useAuth()
  const [state, setState] = React.useState<'loading' | 'waiting' | 'failed'>('loading')
  const [message, setMessage] = React.useState('正在打开最近编辑章节…')

  const waitForChapterWorkbenchReady = React.useCallback(async (targetChapterId: string) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await getChapterWorkbench(targetChapterId)
        return true
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 1200))
      }
    }
    return false
  }, [])

  const tryResolveEntry = React.useCallback(async () => {
    if (!auth.user || !projectId) return false
    setState('loading')
    setMessage('正在准备最近编辑章节…')
    try {
      await ensureProjectHasAutoBoundFirstChapter(projectId).catch(() => null)
      const entry = await getProjectDefaultEntry(projectId)
      const chapters = await listProjectChapters(projectId).catch(() => [])
      const matchedChapter = chapters.find((chapter) => chapter.id === entry.chapterId) || null
      setMessage('章节已找到，正在准备工作台…')
      const ready = await waitForChapterWorkbenchReady(entry.chapterId)
      if (!ready) {
        setState('waiting')
        setMessage('章节已找到，但工作台还在准备中，稍后会自动进入。')
        return false
      }
      spaNavigate(buildStudioUrl({
        projectId: entry.projectId,
        ownerType: 'chapter',
        ownerId: entry.chapterId,
        panel: 'nanoComic',
        chapter: matchedChapter?.index ?? null,
      }))
      return true
    } catch (error) {
      console.error('加载项目默认章节失败', error)
      try {
        const chapters = await listProjectChapters(projectId)
        if (chapters[0]) {
          setMessage('章节目录已就绪，正在准备第一章…')
          const ready = await waitForChapterWorkbenchReady(chapters[0].id)
          if (!ready) {
            setState('waiting')
            setMessage('第一章已经创建，但工作台还在准备中，稍后会自动进入。')
            return false
          }
          spaNavigate(buildStudioUrl({
            projectId,
            ownerType: 'chapter',
            ownerId: chapters[0].id,
            panel: 'nanoComic',
            chapter: chapters[0].index,
          }))
          return true
        }
        setState('waiting')
        setMessage('项目已创建成功，正在等待章节目录就绪，准备自动进入第一章。')
        return false
      } catch (listError) {
        console.error('加载项目章节列表失败', listError)
        setState('failed')
        setMessage(resolveErrorMessage(listError, '暂时无法进入画布工作台，请稍后重试。'))
        return false
      }
    }
  }, [auth.user, projectId, waitForChapterWorkbenchReady])

  React.useEffect(() => {
    if (!auth.user || !projectId) return
    let cancelled = false
    let retryTimer: number | null = null
    const run = async () => {
      const resolved = await tryResolveEntry()
      if (cancelled || resolved) return
      retryTimer = window.setTimeout(() => {
        void run()
      }, 4000)
    }
    void run()
    return () => {
      cancelled = true
      if (retryTimer != null) window.clearTimeout(retryTimer)
    }
  }, [auth.user?.sub, projectId, tryResolveEntry])

  if (!auth.user) return <GithubGate><></></GithubGate>
  return (
    <AppShell padding="md">
      <AppShell.Main>
        <Stack align="center" justify="center" h="100vh" maw={560} mx="auto">
          {state === 'loading' ? <Loader size="sm" /> : null}
          <Title order={3}>项目启动中</Title>
          <Text size="sm" c="dimmed" ta="center">{message}</Text>
          {state !== 'loading' ? (
            <Alert variant="light" color={state === 'failed' ? 'red' : 'blue'} title={state === 'failed' ? '启动失败' : '等待章节就绪'} w="100%">
              {state === 'failed'
                ? '你可以先回到项目管理，稍后再进入；如果是新建项目，优先确认原文是否已成功上传。'
                : '项目已经创建成功，接下来会继续自动补齐章节并自动重试进入。'}
            </Alert>
          ) : null}
          <Group>
            <Button variant="light" onClick={() => void tryResolveEntry()}>立即重试</Button>
            <Button variant="subtle" onClick={() => spaNavigate('/projects')}>回到项目管理</Button>
          </Group>
        </Stack>
      </AppShell.Main>
    </AppShell>
  )
}
