import { describe, expect, it } from 'vitest'
import {
  isWorkflowOwnedMediaNodeData,
  resolveProviderTaskFailure,
} from './mediaTaskRuntime'

describe('media task runtime ownership', () => {
  it('keeps workflow-owned media under the durable workflow reconciler', () => {
    expect(isWorkflowOwnedMediaNodeData({ workflowExecutionId: 'execution-1' })).toBe(true)
    expect(isWorkflowOwnedMediaNodeData({ workflowEffectId: 'effect-1' })).toBe(true)
    expect(isWorkflowOwnedMediaNodeData({ workflowRuntimeNodeId: 'node-1' })).toBe(true)
    expect(isWorkflowOwnedMediaNodeData({ workflowExecutionId: '  ' })).toBe(false)
    expect(isWorkflowOwnedMediaNodeData({ videoTaskId: 'manual-task-1' })).toBe(false)
  })

  it('preserves nested provider message and code', () => {
    expect(resolveProviderTaskFailure({
      response: {
        error: {
          code: 'OutputVideoSensitiveContentDetected.PolicyViolation',
          message: 'The output video may be related to copyright restrictions.',
        },
      },
    }, 'newapi 视频任务失败')).toEqual({
      message: 'The output video may be related to copyright restrictions.',
      code: 'OutputVideoSensitiveContentDetected.PolicyViolation',
    })
  })

  it('uses a factual fallback when the provider returns no explanation', () => {
    expect(resolveProviderTaskFailure({}, 'newapi 视频任务失败')).toEqual({
      message: 'newapi 视频任务失败',
      code: null,
    })
  })
})
