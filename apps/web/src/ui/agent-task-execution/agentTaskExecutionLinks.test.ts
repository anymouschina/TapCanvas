import { describe, expect, it } from 'vitest'
import { buildAgentObservabilityUrl, readAgentCanvasDeepLink } from './agentTaskExecutionLinks'

describe('agent task execution deep links', () => {
  it('opens the observability console with structured scope facts', () => {
    const url = new URL(buildAgentObservabilityUrl({
      traceId: 'trace-1',
      projectId: 'project-1',
      chapterId: 'chapter-1',
      flowId: 'flow-1',
      nodeId: 'node-1',
    }, {
      dashboardUrl: 'http://127.0.0.1:8798',
      canvasBaseUrl: 'http://127.0.0.1:5175',
    }))

    expect(url.origin).toBe('http://127.0.0.1:8798')
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      view: 'traces',
      traceId: 'trace-1',
      projectId: 'project-1',
      chapterId: 'chapter-1',
      flowId: 'flow-1',
      nodeId: 'node-1',
      canvasBaseUrl: 'http://127.0.0.1:5175',
    })
  })

  it('reads only explicit execution-workbench and scope query values', () => {
    expect(readAgentCanvasDeepLink(
      '?agentWorkbench=execution&traceId=trace-1&projectId=project-1&flowId=flow-1&nodeId=node-1',
    )).toEqual({
      openExecutionWorkbench: true,
      traceId: 'trace-1',
      projectId: 'project-1',
      bookId: null,
      chapterId: null,
      flowId: 'flow-1',
      nodeId: 'node-1',
    })
  })
})
