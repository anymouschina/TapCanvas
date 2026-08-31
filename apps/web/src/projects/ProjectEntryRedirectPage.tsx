import React from 'react'
import { AppShell, Button } from '@mantine/core'
import { listProjectChapters } from '../api/server'
import { buildProjectChapterCanvasUrl, buildStudioUrl } from '../utils/appRoutes'
import { spaReplace } from '../utils/spaNavigate'
import { CanvasLoadingScreen } from '../ui/CanvasLoadingScreen'
import { StatePanel } from '../ui/StatePanel'
import { pickMostRecentChapter } from './recentProjectChapter'

type ProjectEntryRedirectPageProps = {
  projectId: string
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return '无法读取项目章节记录。'
}

export default function ProjectEntryRedirectPage({ projectId }: ProjectEntryRedirectPageProps): JSX.Element {
  const [retryRevision, setRetryRevision] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    setError(null)

    void listProjectChapters(projectId)
      .then((chapters) => {
        if (!active) return
        const recentChapter = pickMostRecentChapter(chapters)
        const target = recentChapter
          ? buildProjectChapterCanvasUrl(projectId, recentChapter.id)
          : buildStudioUrl({ projectId, ownerType: 'project', ownerId: projectId })
        spaReplace(target)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(resolveErrorMessage(reason))
      })

    return () => {
      active = false
    }
  }, [projectId, retryRevision])

  if (!error) return <CanvasLoadingScreen fixed />

  return (
    <AppShell className="project-entry-redirect" padding="md">
      <AppShell.Main className="project-entry-redirect__main">
        <StatePanel
          className="project-entry-redirect__error"
          title="无法恢复最近编辑的章节"
          description={error}
          tone="error"
        >
          <Button
            className="project-entry-redirect__retry"
            size="xs"
            variant="subtle"
            onClick={() => setRetryRevision((current) => current + 1)}
          >
            重试
          </Button>
        </StatePanel>
      </AppShell.Main>
    </AppShell>
  )
}
