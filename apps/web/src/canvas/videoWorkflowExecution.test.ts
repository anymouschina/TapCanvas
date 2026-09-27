import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { useRFStore } from './store'
import {
  VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
  VIDEO_ATOMIC_WORKFLOW_EDGES,
  VIDEO_ATOMIC_WORKFLOW_NODES,
  VIDEO_PROMPT_ONLY_WORKFLOW_EDGES,
  VIDEO_PROMPT_ONLY_WORKFLOW_NODES,
  createVideoWorkflowCanvasTemplate,
} from './videoWorkflowCanvasTemplate'
import { compileVideoWorkflow, runVideoWorkflow } from './videoWorkflowExecution'

const workflowExecutionMocks = vi.hoisted(() => ({
  requestWorkflowExecution: vi.fn(),
}))

vi.mock('./workflowExecutionRequest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workflowExecutionRequest')>()),
  requestWorkflowExecution: workflowExecutionMocks.requestWorkflowExecution,
}))

const sourceGroup: Node = {
  id: 'source-group',
  type: 'groupNode',
  position: { x: 100, y: 100 },
  selected: true,
  data: {
    label: '第一章来源',
    sourceRecipeId: 'recipe-1',
    targetDurationSeconds: 72,
    videoAspect: '16:9',
    videoModel: 'seedance-2',
  },
}

function resetStore(nodes: readonly Node[] = []): void {
  useRFStore.getState().reset()
  useRFStore.setState({ nodes: [...nodes], edges: [], nextGroupId: 1 })
}

function workflowNodeId(workflowInstanceId: string, nodeId: string): string {
  return `${workflowInstanceId}:${nodeId}`
}

describe('v114 one-click film workflow execution', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'video-execution-test-id' })
    workflowExecutionMocks.requestWorkflowExecution.mockClear()
    resetStore()
  })

  it('compiles the canonical v114 graph with typed ports and project context', () => {
    const result = createVideoWorkflowCanvasTemplate()

    const compiled = compileVideoWorkflow(workflowNodeId(result.workflowInstanceId, 'manual-trigger'))

    expect(compiled.canvasDefinitionVersion).toBe(114)
    expect(compiled.canvasDefinitionFingerprint).toBe(VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT)
    expect(compiled.executionScope).toBe('media_delivery')
    expect(compiled.executionVariant).toBe('full_video')
    expect(compiled.source).toEqual({ kind: 'project_context' })
    expect(compiled.nodes).toHaveLength(VIDEO_ATOMIC_WORKFLOW_NODES.length)
    expect(compiled.edges).toHaveLength(VIDEO_ATOMIC_WORKFLOW_EDGES.length)
    expect(new Set(compiled.nodes.map((node) => node.workflowNodeId))).toEqual(
      new Set(VIDEO_ATOMIC_WORKFLOW_NODES.map((node) => node.nodeId)),
    )
    expect(compiled.nodes.find((node) => node.workflowNodeId === 'clip-production-pipeline')).toMatchObject({
      executorRef: 'workflow.pipeline.run/v1',
      inputPorts: ['delivery-contract', 'source-segments', 'clip-sequences', 'chapter-assets'],
      outputPorts: ['node-plan', 'prompt-package', 'media-items', 'prepared-nodes'],
    })
    expect(compiled.edges).toContainEqual(expect.objectContaining({
      sourcePort: 'clip-sequences',
      targetPort: 'clip-sequences',
    }))
  })

  it('compiles an explicitly bound source group without changing its factual inputs', () => {
    resetStore([sourceGroup])
    const result = createVideoWorkflowCanvasTemplate()
    useRFStore.getState().updateNodeData(workflowNodeId(result.workflowInstanceId, 'canvas-source'), {
      workflowSourceMode: 'canvas_group',
      sourceGroupId: sourceGroup.id,
    })

    expect(compileVideoWorkflow(workflowNodeId(result.workflowInstanceId, 'manual-trigger')).source).toEqual({
      kind: 'canvas_group',
      groupId: sourceGroup.id,
      sourceRecipeId: 'recipe-1',
      targetDurationSeconds: 72,
      videoAspect: '16:9',
      videoModel: 'seedance-2',
      videoProfileId: null,
    })
  })

  it('rejects a workflow node whose persisted typed-port contract differs from v114', () => {
    const result = createVideoWorkflowCanvasTemplate()
    const nodeId = workflowNodeId(result.workflowInstanceId, 'chapter-sequence-agent')
    useRFStore.getState().updateNodeData(nodeId, { workflowInputPorts: ['invented-port'] })

    expect(() => compileVideoWorkflow(workflowNodeId(result.workflowInstanceId, 'manual-trigger')))
      .toThrow(/typed-port 合同不一致/)
  })

  it('rejects a graph edge that targets an undeclared typed port', () => {
    const result = createVideoWorkflowCanvasTemplate()
    useRFStore.setState((state) => ({
      edges: state.edges.map((edge) => edge.target === workflowNodeId(result.workflowInstanceId, 'clip-production-pipeline')
        && edge.source.endsWith(':chapter-sequence-project')
        ? { ...edge, targetHandle: 'in-workflow:unknown-port' }
        : edge),
    }))

    expect(() => compileVideoWorkflow(workflowNodeId(result.workflowInstanceId, 'manual-trigger')))
      .toThrow(/不存在输入端口 unknown-port/)
  })

  it('rejects a missing required connection based on the graph’s actual typed inputs', () => {
    const result = createVideoWorkflowCanvasTemplate()
    useRFStore.setState((state) => ({
      edges: state.edges.filter((edge) => !(
        edge.target === workflowNodeId(result.workflowInstanceId, 'clip-production-pipeline')
        && edge.source.endsWith(':chapter-sequence-project')
      )),
    }))

    expect(() => compileVideoWorkflow(workflowNodeId(result.workflowInstanceId, 'manual-trigger')))
      .toThrow(/缺少输入端口 clip-sequences 的连线/)
  })

  it('rejects an out-of-date fingerprint and immutable scope mismatch', () => {
    const result = createVideoWorkflowCanvasTemplate()
    const triggerNodeId = workflowNodeId(result.workflowInstanceId, 'manual-trigger')
    useRFStore.getState().updateNodeData(triggerNodeId, { workflowCanvasDefinitionFingerprint: 'sha256:stale' })
    expect(() => compileVideoWorkflow(triggerNodeId)).toThrow(/画布定义已过期/)

    useRFStore.getState().updateNodeData(triggerNodeId, {
      workflowCanvasDefinitionFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
      workflowExecutionScope: 'prompt_only',
    })
    expect(() => compileVideoWorkflow(triggerNodeId)).toThrow(/身份或执行范围不一致/)
  })

  it('compiles the prompt-only graph using its immutable scope and exact topology', () => {
    const result = createVideoWorkflowCanvasTemplate({ executionScope: 'prompt_only' })

    const compiled = compileVideoWorkflow(workflowNodeId(result.workflowInstanceId, 'manual-trigger'))

    expect(compiled.executionScope).toBe('prompt_only')
    expect(compiled.nodes).toHaveLength(VIDEO_PROMPT_ONLY_WORKFLOW_NODES.length)
    expect(compiled.edges).toHaveLength(VIDEO_PROMPT_ONLY_WORKFLOW_EDGES.length)
    expect(compiled.nodes.some((node) => node.workflowNodeId === 'clip-media-pipeline')).toBe(false)
    expect(compiled.nodes.some((node) => node.workflowNodeId === 'delivery-verify')).toBe(false)
  })

  it('requests durable workflow execution and marks the trigger as requested', () => {
    const result = createVideoWorkflowCanvasTemplate()
    const triggerNodeId = workflowNodeId(result.workflowInstanceId, 'manual-trigger')

    runVideoWorkflow(triggerNodeId)

    expect(workflowExecutionMocks.requestWorkflowExecution).toHaveBeenCalledWith(triggerNodeId)
    expect(useRFStore.getState().nodes.find((node) => node.id === triggerNodeId)?.data).toMatchObject({
      workflowExecutionMode: 'media_delivery',
      triggerStatus: 'requested',
    })
  })
})
