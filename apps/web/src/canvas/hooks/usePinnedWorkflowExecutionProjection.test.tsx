/** @vitest-environment jsdom */

import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNodeRunDto } from '../../api/server'
import * as apiServer from '../../api/server'
import { useRFStore } from '../store'
import { usePinnedWorkflowExecutionProjection } from './usePinnedWorkflowExecutionProjection'

describe('usePinnedWorkflowExecutionProjection', () => {
  beforeEach(() => {
    useRFStore.getState().reset()
    useRFStore.setState({
      graphProvenanceKey: 'chapter:chapter-1',
      nodes: [{
        id: 'workflow-execution-status',
        type: 'workflowExecutionNode',
        position: { x: 0, y: 0 },
        data: {
          kind: 'workflowExecution',
          managedProjection: 'workflow_execution',
          workflowRuntimeReference: false,
          workflowExecutionId: 'execution-pinned',
          workflowStatus: 'running',
          workflowCompletedUnits: 9,
          workflowTotalUnits: 19,
        },
      }],
      edges: [],
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useRFStore.getState().reset()
  })

  it('replaces a stale running card with the exact durable terminal state', async () => {
    const runs: WorkflowNodeRunDto[] = [{
      id: 'run-failed',
      executionId: 'execution-pinned',
      nodeId: 'cost-estimate',
      status: 'failed',
      attempt: 3,
      errorMessage: 'missing live model parameters',
      createdAt: '2026-08-28T01:46:23.000Z',
      startedAt: '2026-08-28T01:53:07.000Z',
      finishedAt: '2026-08-28T01:53:07.033Z',
      outputRefs: {},
    }]
    vi.spyOn(apiServer, 'getWorkflowExecutionFamily').mockResolvedValue({
      executionFamilyId: 'execution-pinned',
      rootExecutionId: 'execution-pinned',
      latestExecutionId: 'execution-pinned',
      latestExecutionStatus: 'failed',
      activeExecutionIds: [],
      activeExecutionCount: 0,
      activeExecutionIdsTruncated: false,
      executionCount: 1,
      successfulExecutionCount: 0,
      nodeAttemptCount: 1,
      createdAt: '2026-08-28T01:46:23.000Z',
      updatedAt: '2026-08-28T01:53:07.033Z',
      executions: [],
      nextCursor: null,
    })
    vi.spyOn(apiServer, 'listWorkflowNodeRuns').mockResolvedValue(runs)

    renderHook(() => usePinnedWorkflowExecutionProjection('chapter:chapter-1'))

    await waitFor(() => {
      const data = useRFStore.getState().nodes[0]?.data
      expect(data).toMatchObject({
        workflowExecutionId: 'execution-pinned',
        workflowStatus: 'failed',
        workflowCompletedUnits: 0,
        workflowTotalUnits: 1,
        workflowErrorCount: 1,
      })
    })
    expect(apiServer.listWorkflowNodeRuns).toHaveBeenCalledWith('execution-pinned')
  })
})
