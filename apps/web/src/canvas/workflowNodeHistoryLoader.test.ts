import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VIDEO_PRODUCTION_WORKFLOW_KEY } from '@tapcanvas/video-orchestrator-protocol'
import {
  fetchAdminVideoAtomicNodeRunHistory,
  listWorkflowNodeRunHistory,
} from '../api/server'
import { loadWorkflowNodeRunHistory } from './workflowNodeHistoryLoader'

vi.mock('../api/server', () => ({
  fetchAdminVideoAtomicNodeRunHistory: vi.fn(),
  listWorkflowNodeRunHistory: vi.fn(),
}))

describe('workflow node history runtime routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads one-click atomic history from the durable video runtime', async () => {
    vi.mocked(fetchAdminVideoAtomicNodeRunHistory).mockResolvedValue([])
    await loadWorkflowNodeRunHistory({
      flowId: 'flow-1',
      nodeId: 'workflow-1:clip-writer-agent',
      data: {
        workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
        workflowRunId: 'run-1',
        workflowNodeId: 'clip-writer-agent',
      },
    })
    expect(fetchAdminVideoAtomicNodeRunHistory).toHaveBeenCalledWith({
      workflowRunId: 'run-1',
      atomicNodeId: 'clip-writer-agent',
    })
    expect(listWorkflowNodeRunHistory).not.toHaveBeenCalled()
  })

  it('keeps generic workflow history on workflow_node_runs', async () => {
    vi.mocked(listWorkflowNodeRunHistory).mockResolvedValue([])
    await loadWorkflowNodeRunHistory({
      flowId: 'flow-1',
      nodeId: 'workflow-1:javascript',
      data: { workflowKey: 'custom-workflow/v1' },
      limit: 12,
    })
    expect(listWorkflowNodeRunHistory).toHaveBeenCalledWith({
      flowId: 'flow-1',
      nodeId: 'workflow-1:javascript',
      limit: 12,
    })
  })
})
