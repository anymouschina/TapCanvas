export type AgentObservabilityScope = {
  traceId?: string | null
  projectId?: string | null
  bookId?: string | null
  chapterId?: string | null
  flowId?: string | null
  nodeId?: string | null
}

export type AgentCanvasDeepLink = AgentObservabilityScope & {
  openExecutionWorkbench: boolean
}

const DEFAULT_OBSERVABILITY_URL = 'http://127.0.0.1:8798/'

function appendNonEmpty(search: URLSearchParams, key: string, value: string | null | undefined): void {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized) search.set(key, normalized)
}

export function buildAgentObservabilityUrl(
  scope: AgentObservabilityScope,
  options?: {
    dashboardUrl?: string
    canvasBaseUrl?: string | null
  },
): string {
  const configuredDashboardUrl = options?.dashboardUrl?.trim() || DEFAULT_OBSERVABILITY_URL
  const url = new URL(configuredDashboardUrl)
  url.searchParams.set('view', 'traces')
  appendNonEmpty(url.searchParams, 'traceId', scope.traceId)
  appendNonEmpty(url.searchParams, 'projectId', scope.projectId)
  appendNonEmpty(url.searchParams, 'bookId', scope.bookId)
  appendNonEmpty(url.searchParams, 'chapterId', scope.chapterId)
  appendNonEmpty(url.searchParams, 'flowId', scope.flowId)
  appendNonEmpty(url.searchParams, 'nodeId', scope.nodeId)
  appendNonEmpty(url.searchParams, 'canvasBaseUrl', options?.canvasBaseUrl)
  return url.toString()
}

export function readAgentCanvasDeepLink(search: string): AgentCanvasDeepLink {
  const params = new URLSearchParams(search)
  const read = (key: string): string | null => {
    const value = params.get(key)?.trim() ?? ''
    return value || null
  }
  return {
    openExecutionWorkbench: read('agentWorkbench') === 'execution',
    traceId: read('traceId'),
    projectId: read('projectId'),
    bookId: read('bookId'),
    chapterId: read('chapterId'),
    flowId: read('flowId'),
    nodeId: read('nodeId'),
  }
}

export function resolveAgentObservabilityDashboardUrl(): string {
  const configured = typeof import.meta.env.VITE_AGENT_EVAL_DASHBOARD_URL === 'string'
    ? import.meta.env.VITE_AGENT_EVAL_DASHBOARD_URL.trim()
    : ''
  return configured || DEFAULT_OBSERVABILITY_URL
}
