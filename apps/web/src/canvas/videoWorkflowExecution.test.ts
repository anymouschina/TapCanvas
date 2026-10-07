import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { parseWorkflowPipelineRunSpec } from '@tapcanvas/workflow-kernel-protocol'
import { useRFStore } from './store'
import {
  VIDEO_ATOMIC_WORKFLOW_EDGES,
  VIDEO_ATOMIC_WORKFLOW_NODES,
  VIDEO_PROMPT_ONLY_WORKFLOW_EDGES,
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

type ConfigurableWorkflowNode = Readonly<{ id: string; type?: string; kind?: string; data: unknown }>

function configureNodeTree(node: ConfigurableWorkflowNode): Readonly<ConfigurableWorkflowNode & { data: Record<string, unknown> }> {
  const data = node.data && typeof node.data === 'object' && !Array.isArray(node.data)
    ? { ...node.data as Record<string, unknown> }
    : {}
  const atomicSpec = data.workflowAtomicSpec && typeof data.workflowAtomicSpec === 'object' && !Array.isArray(data.workflowAtomicSpec)
    ? data.workflowAtomicSpec as Record<string, unknown>
    : {}
  const operation = typeof atomicSpec.operation === 'string' ? atomicSpec.operation : ''
  if (atomicSpec.executorRef === 'agents.logical-task/v2') data.workflowAgentModelKey = 'text-model-request-key'
  if (operation === 'estimate') {
    data.workflowVideoModelKey = 'video-model-request-key'
    data.workflowVideoResolution = '1080p'
    data.workflowVideoAspectRatio = '16:9'
  }
  if (operation === 'image_generate') {
    data.workflowImageModelKey = 'gpt-image-2'
    data.workflowImageAspectRatio = '16:9'
    data.workflowImageSize = '2K'
  }
  if (data.workflowPipeline !== undefined) {
    const pipeline = parseWorkflowPipelineRunSpec(data.workflowPipeline)
    data.workflowPipeline = {
      ...pipeline,
      steps: pipeline.steps.map((step) => ({
        ...step,
        node: configureNodeTree(step.node),
      })),
    }
  }
  return { ...node, data }
}

function configureAgentModels(nodeIds: readonly string[]): void {
  for (const nodeId of nodeIds) {
    const node = useRFStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    if (!node) continue
    const configured = configureNodeTree(node)
    useRFStore.getState().updateNodeData(nodeId, configured.data)
  }
  const deliveryContractNodeId = nodeIds.find((id) => id.endsWith(':delivery-contract'))
  if (deliveryContractNodeId) {
    useRFStore.getState().updateNodeData(deliveryContractNodeId, {
      workflowVideoModelKey: 'video-model-request-key',
      workflowTargetDurationSeconds: 72,
    })
  }
}

function updateInlineStep(
  workflowInstanceId: string,
  stepId: string,
  update: (data: Record<string, unknown>) => Record<string, unknown>,
): void {
  const pipelineNodes = useRFStore.getState().nodes.filter((node) => (
    node.data.workflowInstanceId === workflowInstanceId && node.data.workflowPipeline !== undefined
  ))
  for (const pipelineNode of pipelineNodes) {
    const pipeline = parseWorkflowPipelineRunSpec(pipelineNode.data.workflowPipeline)
    let matched = false
    const steps = pipeline.steps.map((step) => {
      if (step.stepId !== stepId) return step
      matched = true
      return { ...step, node: { ...step.node, data: update({ ...step.node.data }) } }
    })
    if (!matched) continue
    useRFStore.getState().updateNodeData(pipelineNode.id, {
      workflowPipeline: { ...pipeline, steps },
    })
    return
  }
  throw new Error(`template did not create inline step ${stepId}`)
}

function inlineStepData(workflowInstanceId: string, pipelineNodeId: string, stepId: string): Record<string, unknown> {
  const node = useRFStore.getState().nodes.find((candidate) => candidate.id === `${workflowInstanceId}:${pipelineNodeId}`)
  if (!node || !node.data.workflowPipeline) throw new Error(`template did not create ${pipelineNodeId}`)
  const pipeline = parseWorkflowPipelineRunSpec(node.data.workflowPipeline)
  const step = pipeline.steps.find((candidate) => candidate.stepId === stepId)
  if (!step) throw new Error(`template did not create inline step ${stepId}`)
  return step.node.data
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
    expect(compiled.nodes.find((node) => node.workflowNodeId === 'clip-production-pipeline')).toMatchObject({
      category: 'subworkflow',
      operation: 'inline_pipeline',
      executorRef: 'workflow.pipeline.run/v1',
    })
    expect(compiled.edges).toHaveLength(VIDEO_ATOMIC_WORKFLOW_EDGES.length)
    expect(compiled.edges).toContainEqual(expect.objectContaining({
      sourcePort: 'media-items',
      targetPort: 'media-items',
    }))
    expect(compiled.edges).toContainEqual(expect.objectContaining({
      sourcePort: 'estimate',
      targetPort: 'estimates',
    }))
    expect(compiled.edges).toContainEqual(expect.objectContaining({
      source: expect.stringContaining(':clip-media-pipeline'),
      target: expect.stringContaining(':clip-production-aggregate'),
    }))
    expect(compiled.nodes.some((node) => node.workflowNodeId === 'cost-estimate')).toBe(false)
    expect(inlineStepData(result.workflowInstanceId, 'clip-media-pipeline', 'cost-estimate')).toMatchObject({
      workflowAtomicSpec: { operation: 'estimate' },
      workflowVideoModelKey: 'video-model-request-key',
      workflowVideoResolution: '1080p',
      workflowVideoAspectRatio: '16:9',
    })
    expect(inlineStepData(result.workflowInstanceId, 'clip-production-pipeline', 'clip-production-agent')).toMatchObject({
      workflowAtomicSpec: { category: 'agent', executorRef: 'agents.logical-task/v2' },
      workflowAgentModelKey: 'text-model-request-key',
    })
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

		expect(nodeByWorkflowId.get('chapter-sequence-agent')?.data.workflowAtomicSpec).toMatchObject({
			category: 'agent',
			executorRef: 'agents.logical-task/v2',
		})
		expect(nodeByWorkflowId.get('chapter-sequence-agent')?.data.workflowAgentDefinitionId).toBe('writer')
		expect(inlineStepData(result.workflowInstanceId, 'clip-production-pipeline', 'clip-production-agent'))
			.toMatchObject({ workflowAgentDefinitionId: 'video-prompt-writer' })
		expect(nodeByWorkflowId.get('clip-writer-agent')).toBeUndefined()
		expect(nodeByWorkflowId.get('voice-plan-agent')).toBeUndefined()
    expect([...nodeByWorkflowId.values()].some((node) => node.data.workflowAgentDefinitionId === 'orchestrator')).toBe(false)
  })

  it('treats edited graph dependencies as authoritative instead of running the old fixed UI chain', () => {
    useRFStore.setState({ nodes: [sourceGroup], edges: [], nextGroupId: 1 })
    const result = createVideoWorkflowCanvasTemplate()
    configureAgentModels(result.nodeIds)
    useRFStore.setState((state) => ({
      edges: state.edges.filter((edge) => !(
        edge.source.endsWith(':chapter-sequence-project')
        && edge.target.endsWith(':clip-production-pipeline')
        && edge.targetHandle?.endsWith('clip-sequences')
      )),
    }))

    expect(() => compileVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)).toThrow(/clip-sequences.*连线/)
  })

  it('rejects a connection that feeds the wrong artifact port', () => {
    useRFStore.setState({ nodes: [sourceGroup], edges: [], nextGroupId: 1 })
    const result = createVideoWorkflowCanvasTemplate()
    configureAgentModels(result.nodeIds)
    useRFStore.setState((state) => ({
      edges: state.edges.map((edge) => {
        if (!edge.target.endsWith(':clip-production-pipeline')) return edge
        if (edge.targetHandle?.endsWith('clip-sequences')) return { ...edge, targetHandle: 'in-workflow:undeclared-port' }
        return edge
      }),
    }))

    expect(() => compileVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)).toThrow(
      '不存在输入端口 undeclared-port',
    )
  })

  it('rejects a partially configured paid media request instead of silently filling parameters', () => {
    const result = createVideoWorkflowCanvasTemplate()
    configureAgentModels(result.nodeIds)
    updateInlineStep(result.workflowInstanceId, 'cost-estimate', (data) => {
      delete data.workflowVideoResolution
      return { ...data, workflowVideoModelKey: 'video-model-request-key' }
    })

    expect(() => compileVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)).toThrow(
      '显式模型、分辨率和比例必须同时完整',
    )
  })

  it('requires an explicit configuration for inline image generation before dispatch', () => {
    const result = createVideoWorkflowCanvasTemplate()
    configureAgentModels(result.nodeIds)
    updateInlineStep(result.workflowInstanceId, 'clip-asset-image-generate', (data) => {
      delete data.workflowImageModelKey
      delete data.workflowImageAspectRatio
      delete data.workflowImageSize
      return data
    })

    expect(() => runVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)).toThrow(/clip-asset-image-generate.*模型与规格配置/)
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
    expect(compiled.nodes.some((node) => node.workflowNodeId === 'clip-media-pipeline')).toBe(true)
    expect(inlineStepData(result.workflowInstanceId, 'clip-media-pipeline', 'clip-asset-image-generate')).toMatchObject({
      workflowAtomicSpec: { operation: 'image_generate' },
    })
    expect(inlineStepData(result.workflowInstanceId, 'clip-media-pipeline', 'video-submit')).toMatchObject({
      workflowAtomicSpec: { operation: 'video_submission' },
    })
  })

  it('builds a prompt-only canvas with design images but no video submission', () => {
    useRFStore.setState({ nodes: [sourceGroup], edges: [], nextGroupId: 1 })
    const result = createVideoWorkflowCanvasTemplate({ executionScope: 'prompt_only' })
    configureAgentModels(result.nodeIds)
    const triggerNodeId = `${result.workflowInstanceId}:manual-trigger`

    const compiled = compileVideoWorkflow(triggerNodeId)
    expect(compiled.executionScope).toBe('prompt_only')
    expect(compiled.nodes.map((node) => node.workflowNodeId)).toEqual([
      'canvas-source',
      'delivery-contract',
      'chapter-assets-agent',
      'source-units-agent',
      'background-fan-out',
      'beat-sheet-agent',
      'background-image-generate',
      'clip-design-fan-out',
      'clip-design-agent',
      'beat-sheet-assemble',
      'beat-sheet-format',
      'blocking-diagrams',
      'clip-fan-out',
      'clip-writer-agent',
      'prompt-package',
    ])
    expect(compiled.nodes.find((node) => node.workflowNodeId === 'delivery-contract')?.inputPorts).toEqual(['canvas-facts'])
    expect(compiled.edges).toHaveLength(VIDEO_PROMPT_ONLY_WORKFLOW_EDGES.length)
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
    const result = createVideoWorkflowCanvasTemplate()
    configureAgentModels(result.nodeIds)
    updateInlineStep(result.workflowInstanceId, 'clip-production-agent', (data) => {
      delete data.workflowAgentModelKey
      return data
    })

    expect(() => runVideoWorkflow(`${result.workflowInstanceId}:manual-trigger`)).toThrow(
			'Agent 节点“clip-production-agent”还没有从实时目录选择文本模型',
    )
  })
})
