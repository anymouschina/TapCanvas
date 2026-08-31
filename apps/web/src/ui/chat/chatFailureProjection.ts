export type ChatFailureProjectionStatus = 'failed' | 'denied' | 'blocked'

export type DeferredChatToolStep<T> = {
  step: T
  reason: 'recoverable_until_terminal'
}

export function isDeferredChatToolStep(input: {
  status: string | undefined
  severity: string | undefined
}): boolean {
  return input.severity === 'warning' ||
    input.status === 'failed' ||
    input.status === 'denied' ||
    input.status === 'blocked'
}

export function replaceDeferredToolStep<T extends { callId: string }>(input: {
  visible: readonly T[]
  deferred: readonly DeferredChatToolStep<T>[]
  step: T
}): { visible: T[]; deferred: DeferredChatToolStep<T>[] } {
  return {
    visible: input.visible.filter((item) => item.callId !== input.step.callId),
    deferred: [
      ...input.deferred.filter((item) => item.step.callId !== input.step.callId),
      { step: input.step, reason: 'recoverable_until_terminal' },
    ],
  }
}

export function resolveDeferredToolSteps<T>(input: {
  visible: readonly T[]
  deferred: readonly DeferredChatToolStep<T>[]
  terminalStatus: 'active' | 'waiting_input' | 'waiting_external' | 'succeeded' | 'failed' | 'cancelled'
}): T[] {
  if (input.terminalStatus !== 'failed') return [...input.visible]
  return [
    ...input.visible,
    ...input.deferred.map((item) => item.step),
  ]
}
