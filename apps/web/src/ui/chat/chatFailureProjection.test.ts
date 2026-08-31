import { describe, expect, it } from 'vitest'
import {
  isDeferredChatToolStep,
  replaceDeferredToolStep,
  resolveDeferredToolSteps,
} from './chatFailureProjection'

type Step = { callId: string; status: string }

describe('chat failure projection', () => {
  it('defers recoverable failures and warnings without using tool names', () => {
    expect(isDeferredChatToolStep({ status: 'failed', severity: 'error' })).toBe(true)
    expect(isDeferredChatToolStep({ status: 'succeeded', severity: 'warning' })).toBe(true)
    expect(isDeferredChatToolStep({ status: 'succeeded', severity: undefined })).toBe(false)

    const result = replaceDeferredToolStep({
      visible: [{ callId: 'call-1', status: 'running' }],
      deferred: [],
      step: { callId: 'call-1', status: 'failed' },
    })
    expect(result.visible).toEqual([])
    expect(result.deferred.map((item) => item.step)).toEqual([{ callId: 'call-1', status: 'failed' }])
  })

  it('drops deferred failures after a non-failed terminal outcome', () => {
    const deferred = [{ step: { callId: 'call-1', status: 'failed' }, reason: 'recoverable_until_terminal' as const }]
    expect(resolveDeferredToolSteps({ visible: [], deferred, terminalStatus: 'succeeded' })).toEqual([])
    expect(resolveDeferredToolSteps({ visible: [], deferred, terminalStatus: 'waiting_external' })).toEqual([])
    expect(resolveDeferredToolSteps({ visible: [], deferred, terminalStatus: 'waiting_input' })).toEqual([])
  })

  it('promotes deferred failures only for a final failed terminal outcome', () => {
    const deferred = [{ step: { callId: 'call-1', status: 'failed' }, reason: 'recoverable_until_terminal' as const }]
    expect(resolveDeferredToolSteps({ visible: [{ callId: 'call-2', status: 'succeeded' }], deferred, terminalStatus: 'failed' }))
      .toEqual([
        { callId: 'call-2', status: 'succeeded' },
        { callId: 'call-1', status: 'failed' },
      ])
  })
})
