import { describe, expect, it } from 'vitest'
import { readWorkflowItemRuns, workflowItemRunErrorSummary } from './workflowItemRuns'

describe('workflow item run diagnostics', () => {
  it('keeps an executor error unchanged when no structured failure reason exists', () => {
    const [item] = readWorkflowItemRuns([{
      itemId: 'chapter-2',
      index: 1,
      status: 'failed',
      runtimeNodeId: 'agent::item::chapter-2',
      errorMessage: '模型目录不可用',
      ports: {},
    }])

    expect(workflowItemRunErrorSummary(item!)).toBe('模型目录不可用')
  })
})
