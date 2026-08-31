// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_WORKFLOW_KEY } from '@tapcanvas/workflow-kernel-protocol'
import {
  addScheduleWorkflowTrigger,
  createAgentWorkflowCanvasTemplate,
  restoreAgentWorkflowDefaultConnections,
} from './agentWorkflowCanvasTemplate'
import {
  DOCUMENT_SOURCE_STRUCTURE_SCRIPT,
  createDocumentToVideoPromptsWorkflowCanvasTemplate,
  createDocumentToDynamicVideosWorkflowCanvasTemplate,
} from './documentPromptWorkflowCanvasTemplate'
import { workflowPortFromHandle } from './workflowCanvasPorts'
import { compileAgentWorkflow, runAgentWorkflow } from './agentWorkflowExecution'
import { useRFStore } from './store'
import { WORKFLOW_EXECUTION_REQUEST_EVENT, type WorkflowExecutionRequestDetail } from './workflowExecutionRequest'

function nodeIdFor(workflowInstanceId: string, suffix: string): string {
  return `${workflowInstanceId}:${suffix}`
}

describe('agent workflow canvas execution', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'agent-workflow-test-id' })
    useRFStore.getState().reset()
  })

  it('creates a connected trigger, text input, agent, skill, tool and delivery graph', () => {
    const result = createAgentWorkflowCanvasTemplate()
    const state = useRFStore.getState()

    expect(result.nodeIds).toHaveLength(6)
    expect(state.edges).toHaveLength(7)
    expect(state.nodes.filter((node) => {
      const data = node.data as Record<string, unknown>
      return data.workflowInstanceId === result.workflowInstanceId && data.adminWorkflow === true
    })).toHaveLength(7)
  })

  it('reports the exact missing structural configuration instead of choosing a default route', () => {
    const result = createAgentWorkflowCanvasTemplate()

    expect(() => compileAgentWorkflow(nodeIdFor(result.workflowInstanceId, 'manual-trigger'))).toThrow(
      '还没有填写测试文本',
    )

    useRFStore.getState().updateNodeData(nodeIdFor(result.workflowInstanceId, 'textInput'), {
      workflowTextInput: '真实测试文本',
    })
    useRFStore.getState().updateNodeData(nodeIdFor(result.workflowInstanceId, 'agent'), {
      workflowInstruction: '生成可追踪结果',
    })
    expect(() => compileAgentWorkflow(nodeIdFor(result.workflowInstanceId, 'manual-trigger'))).toThrow(
      '还没有选择执行智能体',
    )
    useRFStore.getState().updateNodeData(nodeIdFor(result.workflowInstanceId, 'agent'), {
      workflowAgentDefinitionId: 'research',
    })
    expect(() => compileAgentWorkflow(nodeIdFor(result.workflowInstanceId, 'manual-trigger'))).toThrow(
      '还没有从实时目录选择文本模型',
    )
  })

  it('creates one dynamic document-to-videos graph with explicit once, each and collect semantics', () => {
    const result = createDocumentToDynamicVideosWorkflowCanvasTemplate()
    const state = useRFStore.getState()
    const stages = state.nodes.filter((node) => (
      (node.data as Record<string, unknown>).workflowInstanceId === result.workflowInstanceId
      && node.type === 'taskNode'
    ))
    const operationById = Object.fromEntries(stages.map((node) => {
      const spec = (node.data as Record<string, unknown>).workflowAtomicSpec
      const record = spec && typeof spec === 'object' && !Array.isArray(spec) ? spec as Record<string, unknown> : {}
      return [node.id, {
        operation: record.operation,
        executionMode: record.executionMode,
        itemConcurrency: record.itemConcurrency,
      }]
    }))

    expect(stages).toHaveLength(9)
    const workflowEdges = state.edges.filter((edge) => result.nodeIds.includes(edge.source) && result.nodeIds.includes(edge.target))
    expect(workflowEdges).toHaveLength(8)
    expect(workflowEdges.map((edge) => [
      edge.source.slice(edge.source.lastIndexOf(':') + 1),
      edge.target.slice(edge.target.lastIndexOf(':') + 1),
    ])).toEqual([
      ['manual-trigger', 'document'],
      ['document', 'source-structure'],
      ['source-structure', 'source-chunks'],
      ['source-chunks', 'clip-planner'],
      ['clip-planner', 'clips'],
      ['clips', 'prompt-agent'],
      ['prompt-agent', 'video'],
      ['video', 'delivery'],
    ])
    expect(result.nodeIds.filter((nodeId) => !workflowEdges.some((edge) => edge.target === nodeId))).toEqual([
      nodeIdFor(result.workflowInstanceId, 'manual-trigger'),
    ])
    expect(workflowEdges.some((edge) => edge.source.endsWith(':delivery'))).toBe(false)
    expect(operationById[nodeIdFor(result.workflowInstanceId, 'source-structure')]).toMatchObject({ operation: 'javascript', executionMode: 'once' })
    expect(operationById[nodeIdFor(result.workflowInstanceId, 'source-chunks')]).toMatchObject({ operation: 'collection_split', executionMode: 'once' })
    expect(operationById[nodeIdFor(result.workflowInstanceId, 'clip-planner')]).toMatchObject({ operation: 'agent_task', executionMode: 'each' })
    expect(operationById[nodeIdFor(result.workflowInstanceId, 'clips')]).toMatchObject({ operation: 'collection_split', executionMode: 'once' })
    expect(operationById[nodeIdFor(result.workflowInstanceId, 'prompt-agent')]).toEqual({ operation: 'agent_task', executionMode: 'each', itemConcurrency: 3 })
    expect(operationById[nodeIdFor(result.workflowInstanceId, 'video')]).toEqual({ operation: 'video_generate', executionMode: 'each', itemConcurrency: 1 })
    expect(operationById[nodeIdFor(result.workflowInstanceId, 'delivery')]).toMatchObject({ operation: 'delivery_verify', executionMode: 'collect' })

    expect(stages.find((node) => node.id.endsWith(':source-structure'))?.data).toMatchObject({
      workflowJavascriptCode: DOCUMENT_SOURCE_STRUCTURE_SCRIPT,
    })
    expect(stages.find((node) => node.id.endsWith(':source-chunks'))?.data).toMatchObject({
      workflowCollectionItemIdField: 'chunkId',
    })
    expect(stages.find((node) => node.id.endsWith(':clip-planner'))?.data).toMatchObject({
      workflowAgentDefinitionId: 'writer',
      workflowAgentOutputEncoding: 'json_array',
      workflowAgentJsonArrayContract: {
        itemRequiredStringFields: ['clipId', 'text'],
        itemRequiredNumberFields: ['durationSeconds'],
        itemExactNumberFields: { durationSeconds: 15 },
        itemAllowedFields: ['clipId', 'text', 'durationSeconds'],
      },
    })
    expect(stages.find((node) => node.id.endsWith(':clip-planner'))?.data.workflowRequiredSkills).toBeUndefined()
    expect((stages.find((node) => node.id.endsWith(':clip-planner'))?.data as Record<string, unknown>)
      .workflowAgentJsonArrayContract).not.toHaveProperty('expectedArrayLength')
    expect(stages.find((node) => node.id.endsWith(':clips'))?.data).toMatchObject({
      workflowCollectionPath: 'text',
      workflowCollectionParseJson: true,
      workflowCollectionItemIdField: 'clipId',
    })
    expect(stages.find((node) => node.id.endsWith(':prompt-agent'))?.data).toMatchObject({
      workflowAgentDefinitionId: 'video-prompt-writer',
      workflowAgentOutputEncoding: 'json_artifact',
      workflowPromptExampleMediaType: 'video',
    })
    expect(stages.find((node) => node.id.endsWith(':prompt-agent'))?.data.workflowRequiredSkills).toBeUndefined()

    useRFStore.getState().updateNodeData(nodeIdFor(result.workflowInstanceId, 'document'), {
      workflowTextInput: '第一章完整正文',
    })
    const prefix = compileAgentWorkflow(
      nodeIdFor(result.workflowInstanceId, 'manual-trigger'),
      nodeIdFor(result.workflowInstanceId, 'source-structure'),
    )
    expect(prefix.nodes.map((node) => node.id.slice(node.id.lastIndexOf(':') + 1))).toEqual([
      'document',
      'source-structure',
    ])
    useRFStore.getState().updateNodeData(nodeIdFor(result.workflowInstanceId, 'prompt-agent'), {
      workflowAgentModelKey: 'gemini-3.1-pro',
    })
    useRFStore.getState().updateNodeData(nodeIdFor(result.workflowInstanceId, 'clip-planner'), {
      workflowAgentModelKey: 'gemini-3.1-pro',
    })
    expect(() => compileAgentWorkflow(nodeIdFor(result.workflowInstanceId, 'manual-trigger'))).toThrow(/还没有从实时目录选择模型/u)
    useRFStore.getState().updateNodeData(nodeIdFor(result.workflowInstanceId, 'video'), {
      workflowVideoModelKey: 'video-model',
      workflowVideoDurationSeconds: 15,
      workflowVideoResolution: '1080p',
      workflowVideoAspectRatio: '16:9',
    })
    const compiled = compileAgentWorkflow(nodeIdFor(result.workflowInstanceId, 'manual-trigger'))
    expect(compiled.nodes).toHaveLength(8)
    expect(compiled.nodes.find((node) => node.id.endsWith(':prompt-agent'))).toMatchObject({
      executionMode: 'each',
      itemConcurrency: 3,
      outputArtifactType: 'tapcanvas.video-prompt/v1',
      outputEncoding: 'json_artifact',
    })
    expect(compiled.nodes.find((node) => node.id.endsWith(':source-structure'))).toMatchObject({
      operation: 'javascript',
      executionMode: 'once',
      javascriptCode: DOCUMENT_SOURCE_STRUCTURE_SCRIPT,
    })
    expect(compiled.nodes.find((node) => node.id.endsWith(':clip-planner'))).toMatchObject({
      operation: 'agent_task',
      executionMode: 'each',
      itemConcurrency: 3,
      agentDefinitionId: 'writer',
      outputEncoding: 'json_array',
    })
    expect(compiled.nodes.find((node) => node.id.endsWith(':video'))).toMatchObject({
      operation: 'video_generate',
      executionMode: 'each',
      itemConcurrency: 1,
      executorRef: 'tapcanvas.video.generate/v1',
    })
  })

  it('creates a durable prompt-only graph with no media executor and one visible terminal path', () => {
    const result = createDocumentToVideoPromptsWorkflowCanvasTemplate()
    const state = useRFStore.getState()
    const workflowNodes = state.nodes.filter((node) => (
      (node.data as Record<string, unknown>).workflowInstanceId === result.workflowInstanceId
      && node.type === 'taskNode'
    ))
    const workflowEdges = state.edges.filter((edge) => (
      result.nodeIds.includes(edge.source) && result.nodeIds.includes(edge.target)
    ))

    expect(workflowNodes).toHaveLength(8)
    expect(workflowEdges).toHaveLength(7)
    expect(workflowEdges.map((edge) => [
      edge.source.slice(edge.source.lastIndexOf(':') + 1),
      edge.target.slice(edge.target.lastIndexOf(':') + 1),
    ])).toEqual([
      ['manual-trigger', 'document'],
      ['document', 'source-structure'],
      ['source-structure', 'source-chunks'],
      ['source-chunks', 'clip-planner'],
      ['clip-planner', 'clips'],
      ['clips', 'prompt-agent'],
      ['prompt-agent', 'delivery'],
    ])
    const operations = workflowNodes.map((node) => {
      const spec = (node.data as Record<string, unknown>).workflowAtomicSpec
      return spec && typeof spec === 'object' && !Array.isArray(spec)
        ? (spec as Record<string, unknown>).operation
        : null
    })
    expect(operations).not.toContain('video_generate')
    expect(workflowNodes.find((node) => node.id.endsWith(':delivery'))?.data).toMatchObject({
      workflowDeliveryArtifactType: 'tapcanvas.video-prompt/v1',
    })
    expect(workflowNodes.find((node) => node.id.endsWith(':prompt-agent'))?.data).toMatchObject({
      workflowPromptExampleMediaType: 'video',
    })
    expect(workflowNodes.find((node) => node.id.endsWith(':prompt-agent'))?.data.workflowAllowedTools).toBeUndefined()

    useRFStore.getState().updateNodeData(nodeIdFor(result.workflowInstanceId, 'document'), {
      workflowTextInput: '第一章完整正文',
    })
    useRFStore.getState().updateNodeData(nodeIdFor(result.workflowInstanceId, 'clip-planner'), {
      workflowAgentModelKey: 'gemini-3.1-pro',
    })
    useRFStore.getState().updateNodeData(nodeIdFor(result.workflowInstanceId, 'prompt-agent'), {
      workflowAgentModelKey: 'gemini-3.1-pro',
    })
    const compiled = compileAgentWorkflow(nodeIdFor(result.workflowInstanceId, 'manual-trigger'))
    expect(compiled.nodes).toHaveLength(7)
    expect(compiled.nodes.some((node) => node.operation === 'video_generate')).toBe(false)
    expect(compiled.nodes[compiled.nodes.length - 1]).toMatchObject({
      operation: 'delivery_verify',
      deliveryRequirement: expect.stringContaining('15 秒视频提示词'),
    })
  })

  it('adds a disabled timezone-explicit schedule trigger to the selected workflow', () => {
    const result = createDocumentToDynamicVideosWorkflowCanvasTemplate()
    useRFStore.setState((state) => ({
      nodes: state.nodes.map((node) => ({
        ...node,
        selected: node.id === nodeIdFor(result.workflowInstanceId, 'document'),
      })),
    }))

    const triggerNodeId = addScheduleWorkflowTrigger()
    const trigger = useRFStore.getState().nodes.find((node) => node.id === triggerNodeId)

    expect(trigger?.data).toMatchObject({
      kind: 'workflowTrigger',
      workflowInstanceId: result.workflowInstanceId,
      workflowTriggerSpec: {
        version: 1,
        kind: 'schedule',
        cron: '0 9 * * *',
        enabled: false,
        misfirePolicy: 'skip',
        maxCatchUpRuns: 0,
      },
    })
    expect((trigger?.data.workflowTriggerSpec as Record<string, unknown>).timezone).toEqual(expect.any(String))
  })

  it('rebuilds an existing standard template with the current Agent configuration ports', () => {
    const result = createAgentWorkflowCanvasTemplate()
    const store = useRFStore.getState()
    store.updateNodeData(nodeIdFor(result.workflowInstanceId, 'agent'), {
      workflowInputPorts: ['input'],
      workflowOutputPorts: ['agent-result'],
    })

    expect(restoreAgentWorkflowDefaultConnections(result.workflowInstanceId)).toBe(7)

    const state = useRFStore.getState()
    const agentNodeId = nodeIdFor(result.workflowInstanceId, 'agent')
    const incomingPorts = state.edges
      .filter((edge) => edge.target === agentNodeId)
      .map((edge) => workflowPortFromHandle(edge.targetHandle, 'input'))
      .sort()
    expect(incomingPorts).toEqual(['input', 'skills', 'tools'])
    expect(state.edges.find((edge) => edge.source === agentNodeId)?.sourceHandle).toContain('result')
  })

  it('compiles the explicit workflow IR and requests its durable server execution', () => {
    const result = createAgentWorkflowCanvasTemplate()
    const store = useRFStore.getState()
    store.updateNodeData(nodeIdFor(result.workflowInstanceId, 'textInput'), {
      workflowTextInput: '检查本项目当前运行状态',
    })
    store.updateNodeData(nodeIdFor(result.workflowInstanceId, 'agent'), {
      workflowInstruction: '读取当前画布事实并生成一份可追溯的运营检查报告',
      workflowAgentDefinitionId: 'research',
      workflowAgentModelKey: 'gemini-3.1-pro',
      workflowAgentOutputArtifactType: 'tapcanvas.json/v1',
      workflowAgentDeliveryRequirement: '交付一个可追溯且可解析的 JSON 运营检查报告',
    })
    store.updateNodeData(nodeIdFor(result.workflowInstanceId, 'skill'), {
      workflowSkillId: 'tapcanvas-research',
    })
    store.updateNodeData(nodeIdFor(result.workflowInstanceId, 'tool'), {
      workflowToolId: 'tapcanvas_canvas_read',
    })
    store.updateNodeData(nodeIdFor(result.workflowInstanceId, 'delivery'), {
      workflowDeliveryRequirement: '把报告写回当前项目并提供持久化结果身份',
    })

    const triggerNodeId = nodeIdFor(result.workflowInstanceId, 'manual-trigger')
    const compiled = compileAgentWorkflow(triggerNodeId)
    expect(compiled.workflowKey).toBe(AGENT_WORKFLOW_KEY)
    expect(compiled.nodes.map((node) => node.category)).toEqual(['source', 'skill', 'tool', 'agent', 'delivery'])
    expect(compiled.nodes[0]?.textInput).toBe('检查本项目当前运行状态')

    let request: WorkflowExecutionRequestDetail | null = null
    window.addEventListener(WORKFLOW_EXECUTION_REQUEST_EVENT, (event) => {
      request = (event as CustomEvent<WorkflowExecutionRequestDetail>).detail
    }, { once: true })
    runAgentWorkflow(triggerNodeId)

    expect(request).toEqual({ triggerNodeId })

		let replayRequest: WorkflowExecutionRequestDetail | null = null
		window.addEventListener(WORKFLOW_EXECUTION_REQUEST_EVENT, (event) => {
			replayRequest = (event as CustomEvent<WorkflowExecutionRequestDetail>).detail
		}, { once: true })
		const agentNodeId = nodeIdFor(result.workflowInstanceId, 'agent')
		runAgentWorkflow(triggerNodeId, undefined, {
			sourceExecutionId: 'execution-source',
			startFromNodeId: agentNodeId,
		})

		expect(replayRequest).toEqual({
			triggerNodeId,
			replayFromExecutionId: 'execution-source',
			startFromNodeId: agentNodeId,
		})
  })

  it('requests a durable dependency-prefix execution when a node is the stop cursor', () => {
    const result = createAgentWorkflowCanvasTemplate()
    const triggerNodeId = nodeIdFor(result.workflowInstanceId, 'manual-trigger')
    const textInputNodeId = nodeIdFor(result.workflowInstanceId, 'textInput')
    useRFStore.getState().updateNodeData(textInputNodeId, {
      workflowTextInput: '只执行到这个输入节点',
    })

    let request: WorkflowExecutionRequestDetail | null = null
    window.addEventListener(WORKFLOW_EXECUTION_REQUEST_EVENT, (event) => {
      request = (event as CustomEvent<WorkflowExecutionRequestDetail>).detail
    }, { once: true })
    runAgentWorkflow(triggerNodeId, textInputNodeId)

    expect(request).toEqual({ triggerNodeId, stopAfterNodeId: textInputNodeId })
  })
})
