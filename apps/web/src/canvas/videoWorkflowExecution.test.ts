import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { useRFStore } from './store'
import {
  VIDEO_ATOMIC_WORKFLOW_EDGES,
  VIDEO_ATOMIC_WORKFLOW_NODES,
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

function configureAgentModels(nodeIds: readonly string[]): void {
  for (const nodeId of nodeIds) {
    const node = useRFStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    const spec = node?.data.workflowAtomicSpec
    if (
      spec &&
      typeof spec === 'object' &&
      !Array.isArray(spec) &&
      (spec as Record<string, unknown>).executorRef === 'agents.logical-task/v2'
    ) useRFStore.getState().updateNodeData(nodeId, { workflowAgentModelKey: 'text-model-request-key' })
  }
  const deliveryContractNodeId = nodeIds.find((id) => id.endsWith(':delivery-contract'))
  if (deliveryContractNodeId) {
    useRFStore.getState().updateNodeData(deliveryContractNodeId, {
      workflowVideoModelKey: 'video-model-request-key',
      workflowTargetDurationSeconds: 72,
    })
  }
  for (const estimateNodeId of nodeIds.filter((id) => id.endsWith('cost-estimate'))) {
    useRFStore.getState().updateNodeData(estimateNodeId, {
      workflowVideoModelKey: 'video-model-request-key',
      workflowVideoResolution: '1080p',
      workflowVideoAspectRatio: '16:9',
    })
  }
  for (const assetImageNodeId of nodeIds.filter((id) => id.endsWith('asset-image-generate'))) {
    useRFStore.getState().updateNodeData(assetImageNodeId, {
      workflowImageModelKey: 'gpt-image-2',
      workflowImageAspectRatio: '16:9',
      workflowImageSize: '2K',
    })
  }
}

describe('one-click film atomic workflow execution', () => {
	beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'video-execution-test-id' })
		workflowExecutionMocks.requestWorkflowExecution.mockClear()
		useRFStore.getState().reset()
  })

	it('fails explicitly when the canvas-source node has not bound a real group', () => {
    const result = createVideoWorkflowCanvasTemplate()
    configureAgentModels(result.nodeIds)
		useRFStore.getState().updateNodeData(`${result.workflowInstanceId}:canvas-source`, {
			workflowSourceMode: 'canvas_group',
		})

    expect(() => compileVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)).toThrow(
      '请在“画布来源”节点中绑定来源组，或切换为“测试文本”',
    )
	})

	it('fails explicitly when a persisted trigger has no immutable execution scope', () => {
		const result = createVideoWorkflowCanvasTemplate({ executionScope: 'media_delivery' })
		useRFStore.getState().updateNodeData(`${result.workflowInstanceId}:manual-trigger`, {
			workflowExecutionScope: undefined,
		})

		expect(() => compileVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)).toThrow(
			'一键成片触发器缺少不可变执行范围',
		)
	})

  it('compiles all atomic operations, typed ports and the selected source facts', () => {
    useRFStore.setState({ nodes: [sourceGroup], edges: [], nextGroupId: 1 })
    const result = createVideoWorkflowCanvasTemplate()
    configureAgentModels(result.nodeIds)
		useRFStore.getState().updateNodeData(`${result.workflowInstanceId}:canvas-source`, {
			workflowSourceMode: 'canvas_group',
		})

    const compiled = compileVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)

    expect(compiled.source).toMatchObject({
      kind: 'canvas_group',
      groupId: sourceGroup.id,
      sourceRecipeId: 'recipe-1',
      targetDurationSeconds: 72,
      videoAspect: '16:9',
      videoModel: 'seedance-2',
    })
    expect(compiled.nodes).toHaveLength(VIDEO_ATOMIC_WORKFLOW_NODES.length)
    expect(compiled.nodes.find((node) => node.workflowNodeId === 'beat-sheet-format')).toMatchObject({
      operation: 'max_clip',
      maxClipCount: 24,
      executorRef: 'video.beat-sheet.take/v1',
    })
    expect(compiled.edges).toHaveLength(VIDEO_ATOMIC_WORKFLOW_EDGES.length)
    expect(compiled.edges).toContainEqual(expect.objectContaining({
      sourcePort: 'asset-bindings',
      targetPort: 'asset-bindings',
    }))
    expect(compiled.edges).toContainEqual(expect.objectContaining({
      sourcePort: 'estimate',
      targetPort: 'estimate',
    }))
    expect(compiled.edges).toContainEqual(expect.objectContaining({
      source: expect.stringContaining(':production-handoff'),
      target: expect.stringContaining(':video-submit'),
    }))
    expect(compiled.edges.some((edge) => (
      edge.source.includes(':asset-image-generate')
      && edge.target.includes(':production-handoff')
    ))).toBe(true)
  })

	it('compiles an unbound project-context source without asking SmallT for a group id', () => {
		const result = createVideoWorkflowCanvasTemplate()
		configureAgentModels(result.nodeIds)

		const compiled = compileVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)

		expect(compiled.source).toEqual({ kind: 'project_context' })
	})

  it('uses bounded authoring roles instead of nesting the root orchestrator', () => {
    const result = createVideoWorkflowCanvasTemplate()
    const nodeByWorkflowId = new Map(useRFStore.getState().nodes.flatMap((node) => {
      const workflowNodeId = typeof node.data.workflowNodeId === 'string' ? node.data.workflowNodeId : ''
      return workflowNodeId ? [[workflowNodeId, node] as const] : []
    }))

    expect(nodeByWorkflowId.get('beat-sheet-agent')?.data.workflowAtomicSpec).toMatchObject({
      category: 'agent',
      executorRef: 'agents.logical-task/v2',
    })
    expect(nodeByWorkflowId.get('beat-sheet-agent')?.data.workflowAgentDefinitionId).toBe('writer')
		expect(nodeByWorkflowId.get('asset-coverage')?.data.workflowAtomicSpec).toMatchObject({
			category: 'control',
			executorRef: 'video.asset-plans.project/v1',
		})
    expect(nodeByWorkflowId.get('clip-writer-agent')?.data.workflowAgentDefinitionId).toBe('video-prompt-writer')
		expect(nodeByWorkflowId.get('voice-plan-agent')).toBeUndefined()
    expect([...nodeByWorkflowId.values()].some((node) => node.data.workflowAgentDefinitionId === 'orchestrator')).toBe(false)
  })

  it('treats edited graph dependencies as authoritative instead of running the old fixed UI chain', () => {
    useRFStore.setState({ nodes: [sourceGroup], edges: [], nextGroupId: 1 })
    const result = createVideoWorkflowCanvasTemplate()
    configureAgentModels(result.nodeIds)
    useRFStore.setState((state) => ({
      edges: state.edges.filter((edge) => !(
        edge.source.endsWith(':beat-sheet-format') && edge.target.endsWith(':clip-fan-out')
      )),
    }))

    expect(() => compileVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)).toThrow(
      '节点“逐 Clip 展开”缺少输入端口 beat-sheet 的连线',
    )
  })

  it('rejects a connection that feeds the wrong artifact port', () => {
    useRFStore.setState({ nodes: [sourceGroup], edges: [], nextGroupId: 1 })
    const result = createVideoWorkflowCanvasTemplate()
    configureAgentModels(result.nodeIds)
    useRFStore.setState((state) => ({
      edges: state.edges.map((edge) => {
        if (!edge.target.endsWith(':clip-fan-out')) return edge
        if (edge.source.endsWith(':beat-sheet-format')) {
          return { ...edge, targetHandle: 'in-workflow:asset-items' }
        }
        return edge
      }),
    }))

    expect(() => compileVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)).toThrow(
      '节点“逐 Clip 展开”不存在输入端口 asset-items',
    )
  })

  it('rejects a partially configured paid media request instead of silently filling parameters', () => {
    useRFStore.setState({ nodes: [sourceGroup], edges: [], nextGroupId: 1 })
    const result = createVideoWorkflowCanvasTemplate()
    const estimateNodeId = result.nodeIds.find((id) => id.endsWith(':cost-estimate'))
    if (!estimateNodeId) throw new Error('test template did not create cost-estimate')
    useRFStore.getState().updateNodeData(estimateNodeId, {
      workflowVideoModelKey: 'video-model-request-key',
    })

    expect(() => compileVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)).toThrow(
      '显式模型、分辨率和比例必须同时完整',
    )
  })

  it('rejects an invalid Clip ceiling before any workflow execution is requested', () => {
    const result = createVideoWorkflowCanvasTemplate()
    configureAgentModels(result.nodeIds)
    useRFStore.getState().updateNodeData(`${result.workflowInstanceId}:beat-sheet-format`, {
      workflowBeatSheetTakeCount: 0,
    })

    expect(() => compileVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)).toThrow(
      'Clip 上限节点 beat-sheet-format 必须配置 1–1000 的正整数',
    )
    expect(workflowExecutionMocks.requestWorkflowExecution).not.toHaveBeenCalled()
  })

  it('starts media delivery through the durable workflow runtime without dispatching a SmallT chat command', () => {
    useRFStore.setState({ nodes: [sourceGroup], edges: [], nextGroupId: 1 })
    const result = createVideoWorkflowCanvasTemplate()
    configureAgentModels(result.nodeIds)
    const triggerNodeId = `${result.workflowInstanceId}:manual-trigger`
    useRFStore.getState().updateNodeData(`${result.workflowInstanceId}:beat-sheet-agent`, {
      workflowAgentDefinitionId: 'writer',
    })
    useRFStore.getState().updateNodeData(`${result.workflowInstanceId}:clip-writer-agent`, {
      workflowAgentDefinitionId: 'video-prompt-writer',
    })
		runVideoWorkflow(triggerNodeId)
		expect(workflowExecutionMocks.requestWorkflowExecution).toHaveBeenCalledWith(triggerNodeId)
		expect(useRFStore.getState().nodes.find((node) => node.id === triggerNodeId)?.data).toMatchObject({
			workflowExecutionMode: 'media_delivery',
			triggerStatus: 'requested',
		})
  })

  it('starts an immutable prompt-only template through the same durable workflow runtime', () => {
    const result = createVideoWorkflowCanvasTemplate({ executionScope: 'prompt_only' })
    configureAgentModels(result.nodeIds)
    const sourceNodeId = result.nodeIds.find((nodeId) => nodeId.endsWith(':canvas-source'))
    if (!sourceNodeId) throw new Error('test template did not create canvas-source')
    useRFStore.getState().updateNodeData(sourceNodeId, {
      workflowSourceMode: 'inline_text',
      workflowSourceText: '一只猫在雨夜寻找回家的路',
    })
    const triggerNodeId = result.workflowInstanceId + ':manual-trigger'
		runVideoWorkflow(triggerNodeId)
		expect(workflowExecutionMocks.requestWorkflowExecution).toHaveBeenCalledWith(triggerNodeId)
		expect(useRFStore.getState().nodes.find((node) => node.id === triggerNodeId)?.data).toMatchObject({
			workflowExecutionMode: 'prompt_only',
			triggerStatus: 'requested',
		})
  })

  it('does not expose a transient scope override that can disguise a media-delivery template', () => {
    useRFStore.setState({ nodes: [sourceGroup], edges: [], nextGroupId: 1 })
    const result = createVideoWorkflowCanvasTemplate({ executionScope: 'media_delivery' })
    configureAgentModels(result.nodeIds)

    const compiled = compileVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)

    expect(compiled.executionScope).toBe('media_delivery')
    expect(compiled.nodes.some((node) => node.workflowNodeId === 'asset-image-generate')).toBe(true)
    expect(compiled.nodes.some((node) => node.workflowNodeId === 'video-submit')).toBe(true)
  })

  it('builds a prompt-only canvas whose ordinary run action cannot include media nodes', () => {
    useRFStore.setState({ nodes: [sourceGroup], edges: [], nextGroupId: 1 })
    const result = createVideoWorkflowCanvasTemplate({ executionScope: 'prompt_only' })
    configureAgentModels(result.nodeIds)
    const triggerNodeId = `${result.workflowInstanceId}:manual-trigger`

    const compiled = compileVideoWorkflow(triggerNodeId)
    expect(compiled.executionScope).toBe('prompt_only')
    expect(compiled.nodes.map((node) => node.workflowNodeId)).toEqual([
      'canvas-source',
      'delivery-contract',
      'beat-sheet-agent',
      'beat-sheet-format',
      'clip-fan-out',
      'clip-writer-agent',
      'prompt-package',
    ])
    expect(compiled.edges).toHaveLength(10)
    expect(compiled.nodes.some((node) => node.workflowNodeId === 'asset-coverage')).toBe(false)
    expect(compiled.nodes.some((node) => node.workflowNodeId === 'video-submit')).toBe(false)
    expect(compiled.nodes.find((node) => node.workflowNodeId === 'clip-fan-out')?.inputPorts).toEqual(['delivery-contract', 'beat-sheet'])

		runVideoWorkflow(triggerNodeId)
		expect(workflowExecutionMocks.requestWorkflowExecution).toHaveBeenCalledWith(triggerNodeId)
		expect(useRFStore.getState().nodes.find((node) => node.id === triggerNodeId)?.data).toMatchObject({
			workflowExecutionMode: 'prompt_only',
			triggerStatus: 'requested',
		})
  })

  it('fails before creating an execution when an Agent node has no explicit model', () => {
    useRFStore.setState({ nodes: [sourceGroup], edges: [], nextGroupId: 1 })
    const result = createVideoWorkflowCanvasTemplate()
    configureAgentModels(result.nodeIds)
		const agentNodeId = result.nodeIds.find((id) => id.endsWith(':clip-writer-agent'))
		if (!agentNodeId) throw new Error('test template did not create clip-writer-agent')
    useRFStore.getState().updateNodeData(agentNodeId, { workflowAgentModelKey: undefined })

    expect(() => runVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)).toThrow(
			'Agent 节点“clip-writer-agent”还没有从实时目录选择文本模型',
    )
  })
})
