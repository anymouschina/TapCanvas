import { describe, expect, it } from 'vitest'

import type { ExecutionToolInvocation } from './executionGraph.types'
import {
  createExecutionTiming,
  formatElapsedDuration,
  invocationElapsedMs,
  timingFromInvocations,
} from './executionTiming'

function invocation(input: Partial<ExecutionToolInvocation> = {}): ExecutionToolInvocation {
  return {
    toolCallId: 'call-1',
    toolName: 'tapcanvas_video_orchestrate',
    transportToolName: 'tapcanvas_call_tool',
    operation: 'mode=preflight_begin',
    status: 'succeeded',
    startedAt: '2026-08-10T06:27:00.000Z',
    finishedAt: '2026-08-10T06:27:00.120Z',
    durationMs: 120,
    input: '',
    output: '',
    errorCode: '',
    errorMessage: '',
    issues: [],
    ...input,
  }
}

describe('execution timing', () => {
  it('uses wall-clock span for a stage instead of summing parallel tool durations', () => {
    const timing = timingFromInvocations([
      invocation({ toolCallId: 'a', startedAt: '2026-08-10T06:27:00.000Z', finishedAt: '2026-08-10T06:27:01.000Z', durationMs: 1_000 }),
      invocation({ toolCallId: 'b', startedAt: '2026-08-10T06:27:00.000Z', finishedAt: '2026-08-10T06:27:01.000Z', durationMs: 1_000 }),
    ], Date.parse('2026-08-10T06:27:02.000Z'))

    expect(timing).toMatchObject({ elapsedMs: 1_000, live: false })
  })

  it('updates a running tool and run against the observed clock', () => {
    const observedAtMs = Date.parse('2026-08-10T06:27:05.000Z')
    const running = invocation({ status: 'running', finishedAt: '', durationMs: null })

    expect(invocationElapsedMs(running, observedAtMs)).toBe(5_000)
    expect(createExecutionTiming({
      startedAt: running.startedAt,
      updatedAt: running.startedAt,
      live: true,
      observedAtMs,
    })).toMatchObject({ elapsedMs: 5_000, live: true })
  })

  it('formats millisecond, minute and hour durations compactly', () => {
    expect(formatElapsedDuration(120)).toBe('120 ms')
    expect(formatElapsedDuration(65_000)).toBe('1:05')
    expect(formatElapsedDuration(3_665_000)).toBe('1:01:05')
  })
})
