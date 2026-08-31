import React from 'react'
import { listProjectChapters, type ChapterDto } from '../api/server'

type PublishProjectChaptersState = {
  projectId: string
  items: ChapterDto[]
  loading: boolean
  error: string
}

const EMPTY_STATE: PublishProjectChaptersState = {
  projectId: '',
  items: [],
  loading: false,
  error: '',
}

function readChapterLoadError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : '章节加载失败'
}

export function usePublishProjectChapters(input: {
  enabled: boolean
  projectId: string
  reloadKey: number
}): PublishProjectChaptersState {
  const { enabled, projectId, reloadKey } = input
  const [state, setState] = React.useState<PublishProjectChaptersState>(EMPTY_STATE)

  React.useEffect(() => {
    if (!enabled || !projectId) {
      setState(EMPTY_STATE)
      return
    }

    let active = true
    setState({ projectId, items: [], loading: true, error: '' })
    void listProjectChapters(projectId)
      .then((items) => {
        if (!active) return
        setState({ projectId, items, loading: false, error: '' })
      })
      .catch((error: unknown) => {
        if (!active) return
        setState({ projectId, items: [], loading: false, error: readChapterLoadError(error) })
      })

    return () => {
      active = false
    }
  }, [enabled, projectId, reloadKey])

  return state
}
