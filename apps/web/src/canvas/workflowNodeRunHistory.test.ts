import { describe, expect, it } from 'vitest'
import type { WorkflowNodeRunHistoryDto } from '../api/server'
import {
  toWorkflowNodeRunHistoryView,
  workflowNodeEmptyOutputMessage,
  workflowNodeRunStatusLabel,
} from './workflowNodeRunHistory'

describe('workflowNodeRunHistory', () => {
  it('projects two persisted video items from one historical node run', () => {
    const run: WorkflowNodeRunHistoryDto = {
      id: 'node-run-1',
      executionId: 'execution-1',
      nodeId: 'video-node',
      status: 'success',
      executionStatus: 'success',
      attempt: 1,
      createdAt: '2026-08-11T08:00:01.000Z',
      executionCreatedAt: '2026-08-11T08:00:00.000Z',
      executionFinishedAt: '2026-08-11T08:01:00.000Z',
      outputRefs: {
        evidence: { completedItems: 2, settledItems: 2, totalItems: 36 },
        itemRuns: [
          {
            itemId: 'segment-1',
            index: 0,
            runtimeNodeId: 'video-node::segment-1',
            status: 'success',
            ports: { videoUrl: 'https://assets.example/1.mp4' },
            artifacts: [{ type: 'tapcanvas.video/v1', value: 'https://assets.example/1.mp4' }],
            evidence: { canvasNodeId: 'canvas-video-1' },
          },
          {
            itemId: 'segment-2',
            index: 1,
            runtimeNodeId: 'video-node::segment-2',
            status: 'success',
            ports: { videoUrl: 'https://assets.example/2.mp4' },
            artifacts: [{ type: 'tapcanvas.video/v1', value: 'https://assets.example/2.mp4' }],
            evidence: { canvasNodeId: 'canvas-video-2' },
          },
        ],
      },
    }

    const view = toWorkflowNodeRunHistoryView(run)

    expect(view.completedItems).toBe(2)
    expect(view.totalItems).toBe(36)
    expect(view.videoItems.map((item) => item.videoUrl)).toEqual([
      'https://assets.example/1.mp4',
      'https://assets.example/2.mp4',
    ])
    expect(view.itemRunPayload).toHaveLength(2)
    expect(workflowNodeRunStatusLabel(run.status)).toBe('完成')
  })

  it('keeps a waiting provider run visible instead of treating it as failed', () => {
    const run: WorkflowNodeRunHistoryDto = {
      id: 'node-run-waiting',
      executionId: 'execution-waiting',
      nodeId: 'video-node',
      status: 'waiting_external',
      executionStatus: 'running',
      attempt: 1,
      createdAt: '2026-08-11T08:00:01.000Z',
      executionCreatedAt: '2026-08-11T08:00:00.000Z',
      outputRefs: {
        itemRuns: [{
          itemId: 'segment-1',
          index: 0,
          runtimeNodeId: 'video-node::segment-1',
          status: 'waiting_external',
          ports: {},
          artifacts: [],
          evidence: { taskId: 'provider-task-1' },
        }],
      },
    }

    const view = toWorkflowNodeRunHistoryView(run)

    expect(view.waitingItems).toBe(1)
    expect(view.failedItems).toBe(0)
    expect(workflowNodeRunStatusLabel(run.status)).toBe('等待外部结果')
  })

  it('uses an agreed structured balance reason in persisted run history', () => {
    expect(workflowNodeRunStatusLabel('waiting_external', {
      evidence: {
        continuationReason: 'provider_balance_required',
        requestTerminal: { reason: 'provider_balance_required' },
      },
    })).toBe('等待余额恢复')
  })

  it('projects dynamic Agent text items for later canvas materialization', () => {
    const run: WorkflowNodeRunHistoryDto = {
      id: 'node-run-text',
      executionId: 'execution-text',
      nodeId: 'prompt-agent',
      status: 'success',
      executionStatus: 'success',
      attempt: 1,
      createdAt: '2026-08-11T08:00:01.000Z',
      executionCreatedAt: '2026-08-11T08:00:00.000Z',
      outputRefs: {
        itemRuns: [{
          itemId: 'clip-1',
          index: 0,
          runtimeNodeId: 'prompt-agent::item::clip-1',
          status: 'success',
          ports: { result: { text: '15 秒视频提示词' } },
          artifacts: [{ type: 'tapcanvas.video-prompt/v1', value: '15 秒视频提示词' }],
          evidence: {},
        }],
      },
    }

    const view = toWorkflowNodeRunHistoryView(run)
    expect(view.textItems.map((item) => item.textOutput)).toEqual(['15 秒视频提示词'])
    expect(view.videoItems).toHaveLength(0)
  })

  it('keeps ordinary once-node ports, evidence and artifact identities inspectable', () => {
    const run: WorkflowNodeRunHistoryDto = {
      id: 'node-run-once',
      executionId: 'execution-once',
      nodeId: 'javascript-node',
      status: 'success',
      executionStatus: 'success',
      attempt: 1,
      createdAt: '2026-08-11T10:00:01.000Z',
      executionCreatedAt: '2026-08-11T10:00:00.000Z',
      outputRefs: {
        ports: { result: { paragraphCount: 53 } },
        evidence: {
          executorCompleted: true,
          durationMs: 26,
          workflowProvenance: {
            protocolVersion: 'workflow.node-provenance/v1',
            executionId: 'execution-once',
            nodeRunId: 'node-run-once',
            attempt: 1,
            flowId: 'flow-1',
            flowVersionId: 'version-1',
            nodeId: 'javascript-node',
            executorRef: 'workflow.script.javascript/v1',
            createdAt: '2026-08-11T10:00:01.000Z',
            inputBindings: [],
          },
        },
        artifacts: [{
          type: 'tapcanvas.json/v1',
          identity: 'artifact-1',
          value: '{}',
          media: {
            protocolVersion: 'workflow.media-asset/v1',
            kind: 'video',
            url: 'https://assets.example/result.mp4',
            mimeType: 'video/mp4',
          },
        }],
        itemRuns: [],
      },
    }

    const view = toWorkflowNodeRunHistoryView(run)

    expect(view.output).toEqual({ result: { paragraphCount: 53 } })
    expect(view.evidence).toMatchObject({ executorCompleted: true, durationMs: 26 })
    expect(view.artifactIds).toEqual(['artifact-1'])
    expect(view.mediaAssets).toEqual([{
      protocolVersion: 'workflow.media-asset/v1',
      kind: 'video',
      url: 'https://assets.example/result.mp4',
      mimeType: 'video/mp4',
    }])
    expect(view.provenance).toMatchObject({ nodeRunId: 'node-run-once', inputBindings: [] })
  })

  it('explains an empty failed output as a failure instead of an undeclared output port', () => {
    const run: WorkflowNodeRunHistoryDto = {
      id: 'node-run-failed',
      executionId: 'execution-failed',
      nodeId: 'agent-node',
      status: 'failed',
      executionStatus: 'failed',
      attempt: 1,
      createdAt: '2026-08-12T01:34:42.000Z',
      executionCreatedAt: '2026-08-12T01:34:41.000Z',
      errorMessage: 'Agents bridge 流在返回终态结果前中断',
      outputRefs: null,
    }

    expect(workflowNodeEmptyOutputMessage(toWorkflowNodeRunHistoryView(run), false)).toBe(
      '本次运行未产生输出；请查看下方运行错误。',
    )
  })
})
