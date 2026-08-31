import React from 'react'
import { useRFStore } from '../../canvas/store'
import { readAgentCanvasDeepLink } from './agentTaskExecutionLinks'

type AgentCanvasDeepLinkScope = {
  projectId: string | null
  chapterId?: string | null
  flowId?: string | null
  routeKey: string
  onOpenExecutionWorkbench: () => void
}

type CanvasFocusWindow = Window & {
  __tcFocusNode?: (nodeId: string) => void
}

export function useAgentCanvasDeepLink(scope: AgentCanvasDeepLinkScope): void {
  const handledWorkbenchKeyRef = React.useRef('')
  const handledNodeKeyRef = React.useRef('')
  const openWorkbenchRef = React.useRef(scope.onOpenExecutionWorkbench)
  openWorkbenchRef.current = scope.onOpenExecutionWorkbench
  const { projectId, chapterId = null, flowId = null, routeKey } = scope

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const link = readAgentCanvasDeepLink(window.location.search)
    if (!link.openExecutionWorkbench) return
    if (link.projectId && link.projectId !== projectId) return
    if (link.chapterId && link.chapterId !== chapterId) return
    if (link.flowId && flowId && link.flowId !== flowId) return
    const key = `${routeKey}:${link.traceId ?? ''}`
    if (handledWorkbenchKeyRef.current === key) return
    handledWorkbenchKeyRef.current = key
    openWorkbenchRef.current()
  }, [chapterId, flowId, projectId, routeKey])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const link = readAgentCanvasDeepLink(window.location.search)
    if (!link.nodeId) return
    if (link.projectId && link.projectId !== projectId) return
    if (link.chapterId && link.chapterId !== chapterId) return
    if (link.flowId && flowId && link.flowId !== flowId) return
    const key = `${routeKey}:${link.nodeId}`
    if (handledNodeKeyRef.current === key) return

    const focusWhenReady = (): boolean => {
      const nodeExists = useRFStore.getState().nodes.some((node) => node.id === link.nodeId)
      const focusNode = (window as CanvasFocusWindow).__tcFocusNode
      if (!nodeExists || !focusNode || !link.nodeId) return false
      focusNode(link.nodeId)
      handledNodeKeyRef.current = key
      return true
    }

    if (focusWhenReady()) return
    const unsubscribe = useRFStore.subscribe(() => {
      if (focusWhenReady()) unsubscribe()
    })
    const retryTimer = window.setInterval(() => {
      if (focusWhenReady()) window.clearInterval(retryTimer)
    }, 250)
    const timeout = window.setTimeout(() => window.clearInterval(retryTimer), 10_000)
    return () => {
      unsubscribe()
      window.clearInterval(retryTimer)
      window.clearTimeout(timeout)
    }
  }, [chapterId, flowId, projectId, routeKey])
}
