import React from 'react'
import { useUIStore } from '../ui/uiStore'

export function useChapterProjectRouteBinding(projectId: string): void {
  const setCurrentProject = useUIStore((state) => state.setCurrentProject)

  React.useLayoutEffect(() => {
    const currentProject = useUIStore.getState().currentProject
    setCurrentProject(currentProject?.id === projectId
      ? currentProject
      : { id: projectId, name: '(未命名)', teamId: null })

    return () => {
      if (useUIStore.getState().currentProject?.id === projectId) {
        setCurrentProject(null)
      }
    }
  }, [projectId, setCurrentProject])
}

export function applyChapterProjectRouteMetadata(input: {
  projectId: string
  projectName: string
  teamId: string | null
}): void {
  const currentProject = useUIStore.getState().currentProject
  useUIStore.getState().setCurrentProject({
    ...(currentProject?.id === input.projectId ? currentProject : {}),
    id: input.projectId,
    name: input.projectName || '(未命名)',
    teamId: input.teamId,
  })
}
