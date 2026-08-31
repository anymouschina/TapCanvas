// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { fetchAdminExecutionEvents } = vi.hoisted(() => ({
  fetchAdminExecutionEvents: vi.fn(async () => ({
    events: [{
      id: 'event-1',
      traceId: 'trace-1',
      seq: 1,
      producerEventId: 'producer-1',
      eventType: 'request.accepted',
      eventClass: 'lifecycle',
      eventKey: 'request.accepted',
      phase: null,
      status: null,
      logicalTaskId: 'logical-1',
      rootTraceId: 'trace-1',
      parentTraceId: null,
      physicalRunId: null,
      workflowRunId: null,
      workflowNodeId: null,
      agentId: null,
      parentAgentId: null,
      toolCallId: null,
      effectId: null,
      providerTaskId: null,
      spanId: null,
      parentSpanId: null,
      attempt: null,
      payload: { request: { prompt: '生成当前章节整片' } },
      payloadSizeBytes: 48,
      payloadTruncated: false,
      createdAt: '2026-08-10T00:00:00.000Z',
    }],
    nextAfterSeq: null,
    latestSeq: 1,
    traceStatus: 'succeeded' as const,
    serverObservedAt: '2026-08-10T00:00:01.000Z',
    hasMore: false,
    integrity: {
      status: 'consistent' as const,
      requestAcceptedCount: 1,
      terminalEventCount: 1,
      persistedEventCount: 1,
      latestPersistedSeq: 1,
      issues: [],
    },
  })),
}))

vi.mock('../../api/server', () => ({
  fetchAdminExecutionEvents,
  fetchAdminExecutionDiagnosticBundle: vi.fn(),
}))

import ExecutionEventLogInspector from './ExecutionEventLogInspector'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverMock,
  })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverMock,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ExecutionEventLogInspector', () => {
  it('loads the persisted ordered event stream for the selected execution', async () => {
    render(
      <MantineProvider>
        <ExecutionEventLogInspector traceId="trace-1" />
      </MantineProvider>,
    )

    await waitFor(() => expect(screen.getAllByText('request.accepted')).toHaveLength(2))
    expect(screen.getByText('本轮 AI 执行日志')).toBeTruthy()
    expect(screen.getByText('#1')).toBeTruthy()
    expect(fetchAdminExecutionEvents).toHaveBeenCalledWith({
      traceId: 'trace-1',
      afterSeq: null,
      limit: 100,
    })
  })
})
