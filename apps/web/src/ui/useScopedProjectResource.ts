import React from 'react'

export type ScopedProjectResourceStatus = 'idle' | 'loading' | 'ready' | 'error'

type ScopedProjectResourceState<T> = {
  projectId: string | null
  status: ScopedProjectResourceStatus
  items: T[]
  error: string | null
}

type ScopedProjectResourceOptions<T> = {
  enabled: boolean
  projectId: string | null | undefined
  load: (projectId: string) => Promise<readonly T[]>
  invalidResponseMessage: string
}

type ScopedItemsUpdater<T> = T[] | ((current: T[]) => T[])

export type ScopedProjectResource<T> = {
  items: T[]
  status: ScopedProjectResourceStatus
  loading: boolean
  error: string | null
  reload: () => Promise<T[]>
  setItems: (updater: ScopedItemsUpdater<T>) => void
}

const createIdleState = <T,>(): ScopedProjectResourceState<T> => ({
  projectId: null,
  status: 'idle',
  items: [],
  error: null,
})

const resolveErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return String(error || '未知错误')
}

export function useScopedProjectResource<T>({
  enabled,
  projectId,
  load,
  invalidResponseMessage,
}: ScopedProjectResourceOptions<T>): ScopedProjectResource<T> {
  const normalizedProjectId = String(projectId || '').trim() || null
  const [state, setState] = React.useState<ScopedProjectResourceState<T>>(createIdleState)
  const requestRevisionRef = React.useRef(0)
  const inFlightRequestRef = React.useRef<{
    projectId: string
    load: ScopedProjectResourceOptions<T>['load']
    promise: Promise<readonly T[]>
  } | null>(null)

  const reload = React.useCallback(async (): Promise<T[]> => {
    const requestRevision = requestRevisionRef.current + 1
    requestRevisionRef.current = requestRevision

    if (!enabled || !normalizedProjectId) {
      setState(createIdleState)
      return []
    }

    setState((current) => ({
      projectId: normalizedProjectId,
      status: 'loading',
      items: current.projectId === normalizedProjectId ? current.items : [],
      error: null,
    }))

    try {
      const activeRequest = inFlightRequestRef.current
      const request = activeRequest?.projectId === normalizedProjectId && activeRequest.load === load
        ? activeRequest.promise
        : Promise.resolve().then(() => load(normalizedProjectId))
      if (request !== activeRequest?.promise) {
        inFlightRequestRef.current = {
          projectId: normalizedProjectId,
          load,
          promise: request,
        }
      }
      const response = await request.finally(() => {
        if (inFlightRequestRef.current?.promise === request) {
          inFlightRequestRef.current = null
        }
      })
      if (!Array.isArray(response)) throw new Error(invalidResponseMessage)
      const items = [...response]
      if (requestRevisionRef.current === requestRevision) {
        setState({
          projectId: normalizedProjectId,
          status: 'ready',
          items,
          error: null,
        })
      }
      return items
    } catch (error: unknown) {
      if (requestRevisionRef.current === requestRevision) {
        setState((current) => ({
          projectId: normalizedProjectId,
          status: 'error',
          items: current.projectId === normalizedProjectId ? current.items : [],
          error: resolveErrorMessage(error),
        }))
      }
      throw error
    }
  }, [enabled, invalidResponseMessage, load, normalizedProjectId])

  React.useEffect(() => {
    void reload().catch(() => undefined)
    return () => {
      requestRevisionRef.current += 1
    }
  }, [reload])

  const setItems = React.useCallback((updater: ScopedItemsUpdater<T>): void => {
    requestRevisionRef.current += 1
    if (!enabled || !normalizedProjectId) return
    setState((current) => {
      const currentItems = current.projectId === normalizedProjectId ? current.items : []
      const items = typeof updater === 'function' ? updater(currentItems) : updater
      return {
        projectId: normalizedProjectId,
        status: 'ready',
        items: [...items],
        error: null,
      }
    })
  }, [enabled, normalizedProjectId])

  const activeState = state.projectId === normalizedProjectId
    ? state
    : {
        projectId: normalizedProjectId,
        status: enabled && normalizedProjectId ? 'loading' as const : 'idle' as const,
        items: [],
        error: null,
      }

  return {
    items: activeState.items,
    status: activeState.status,
    loading: activeState.status === 'loading',
    error: activeState.error,
    reload,
    setItems,
  }
}
