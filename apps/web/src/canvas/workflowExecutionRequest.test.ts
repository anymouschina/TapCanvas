/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'
import {
  requestWorkflowExecutionSnapshot,
  WORKFLOW_EXECUTION_SNAPSHOT_REQUEST_EVENT,
  type WorkflowExecutionSnapshotRequestDetail,
} from './workflowExecutionRequest'

describe('workflow execution snapshot request', () => {
  it('notifies the mounted snapshot host with the exact durable execution id', () => {
    const listener = vi.fn<(event: Event) => void>()
    window.addEventListener(WORKFLOW_EXECUTION_SNAPSHOT_REQUEST_EVENT, listener)
    requestWorkflowExecutionSnapshot(' workflow-execution-1 ')

    expect(listener).toHaveBeenCalledOnce()
    const event = listener.mock.calls[0]?.[0] as CustomEvent<WorkflowExecutionSnapshotRequestDetail>
    expect(event.detail).toEqual({ executionId: 'workflow-execution-1' })
    window.removeEventListener(WORKFLOW_EXECUTION_SNAPSHOT_REQUEST_EVENT, listener)
  })

  it('rejects an empty execution identity', () => {
    expect(() => requestWorkflowExecutionSnapshot('  ')).toThrow('工作流执行快照请求缺少执行身份')
  })
})
