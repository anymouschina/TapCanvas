import type { Edge, Node } from '@xyflow/react'

type JsonRecord = Record<string, unknown>

export type WorkflowInvocationContract = {
  sourceMode: 'inline_text' | 'canvas_group' | 'project_context' | 'none'
  requiredTriggerPayloadFields: string[]
}

export type WorkflowDescriptionContext = {
  name: string
  nodeCount: number
  edgeCount: number
  invocation: WorkflowInvocationContract
  stages: Array<{
    label: string
    description: string
    operation: string
    executorRef: string
    outputArtifactType: string
  }>
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nodeData(node: Node): JsonRecord {
  return asRecord(node.data) ?? {}
}

function atomicSpec(node: Node): JsonRecord {
  return asRecord(nodeData(node).workflowAtomicSpec) ?? {}
}

export function deriveWorkflowInvocationContract(nodes: readonly Node[]): WorkflowInvocationContract {
  const sourceNode = nodes.find((node) => {
    const data = nodeData(node)
    const spec = atomicSpec(node)
    return readString(spec.executorRef) === 'tapcanvas.canvas.group.read/v1'
      || readString(data.workflowExecutorRef) === 'tapcanvas.canvas.group.read/v1'
  })
  if (!sourceNode) return { sourceMode: 'none', requiredTriggerPayloadFields: [] }
  const sourceMode = readString(nodeData(sourceNode).workflowSourceMode) || 'canvas_group'
  if (sourceMode === 'inline_text') {
    return { sourceMode: 'inline_text', requiredTriggerPayloadFields: ['source'] }
  }
  if (sourceMode === 'canvas_group') {
    return { sourceMode: 'canvas_group', requiredTriggerPayloadFields: ['sourceGroupId'] }
  }
	if (sourceMode === 'project_context') {
		return { sourceMode: 'project_context', requiredTriggerPayloadFields: [] }
	}
  throw new Error(`不支持的工作流来源模式：${sourceMode}`)
}

export function buildWorkflowDescriptionContext(input: {
  name: string
  nodes: readonly Node[]
  edges: readonly Edge[]
}): WorkflowDescriptionContext {
  const stages = input.nodes
    .filter((node) => readString(nodeData(node).kind) === 'workflowStage')
    .slice(0, 64)
    .map((node) => {
      const data = nodeData(node)
      const spec = atomicSpec(node)
      return {
        label: readString(data.label) || node.id,
        description: readString(data.description) || readString(spec.description),
        operation: readString(spec.operation) || readString(data.workflowNodeKind),
        executorRef: readString(spec.executorRef) || readString(data.workflowExecutorRef),
        outputArtifactType: readString(data.outputArtifactType)
          || readString(data.agentOutputArtifactType)
          || readString(spec.outputArtifactType),
      }
    })
  return {
    name: input.name.trim(),
    nodeCount: input.nodes.length,
    edgeCount: input.edges.length,
    invocation: deriveWorkflowInvocationContract(input.nodes),
    stages,
  }
}

export function buildWorkflowDescriptionPrompt(context: WorkflowDescriptionContext): string {
  return [
    '请根据下方真实工作流结构，生成一段供小T进行能力选择的中文 description。',
    'description 必须简洁、具体地说明：适用场景、需要的本次输入、主要处理过程、最终交付物；不得虚构节点、工具、模型或产物，不要写操作教程。',
    '当输入契约是 inline_text 时明确说明由小T传入本次源文本；当输入契约是 canvas_group 时明确说明绑定当前画布项目内的源组；当输入契约是 project_context 时明确说明每次运行动态读取当前项目选择与唯一文本来源，不要求小T编造来源组。',
    '只返回一个 JSON 对象，唯一字段为 description；不要添加 Markdown 围栏、解释或其它字段。',
    `WorkflowFacts=${JSON.stringify(context)}`,
  ].join('\n')
}

export function parseWorkflowDescriptionResponse(value: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error: unknown) {
    throw new Error(`智能生成 description 返回的不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
  const description = readString(asRecord(parsed)?.description)
  if (!description) throw new Error('智能生成 description 未返回有效内容')
  if (description.length > 1000) throw new Error('智能生成 description 超过 1000 字限制')
  return description
}
