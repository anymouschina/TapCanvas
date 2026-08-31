import React from 'react'
import GithubGate from '../auth/GithubGate'
import { useAuth } from '../auth/store'
import { buildProjectChapterCanvasUrl } from '../utils/appRoutes'
import { spaNavigate } from '../utils/spaNavigate'

type ProjectChapterRouteRedirectPageProps = {
  projectId: string
  chapterId: string
  shotId?: string
}

export default function ProjectChapterRouteRedirectPage({
  projectId,
  chapterId,
}: ProjectChapterRouteRedirectPageProps): JSX.Element {
  const auth = useAuth()
  React.useEffect(() => {
    if (!auth.user || !projectId || !chapterId) return
    spaNavigate(buildProjectChapterCanvasUrl(projectId, chapterId))
  }, [auth.user, projectId, chapterId])
  if (!auth.user) return <GithubGate><></></GithubGate>
  return <></>
}
