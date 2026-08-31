import type { Edge, Node } from '@xyflow/react'

export type WorkflowCanvasPorts = Readonly<{
  inputs: readonly string[]
  optionalInputs: readonly string[]
  outputs: readonly string[]
}>

export type CompiledWorkflowEdge = Readonly<{
  id: string
  source: string
  sourcePort: string
  target: string
  targetPort: string
}>

type WorkflowHandleDirection = 'input' | 'output'

function nodeData(node: Node): Record<string, unknown> {
  return node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {}
}

function readPorts(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((port): port is string => typeof port === 'string')
    .map((port) => port.trim())
    .filter(Boolean)
}

export function readWorkflowCanvasPorts(data: Record<string, unknown>): WorkflowCanvasPorts | null {
  if (data.kind === 'workflowTrigger') {
    const outputs = readPorts(data.workflowOutputPorts)
    return { inputs: [], optionalInputs: [], outputs: outputs.length > 0 ? outputs : ['trigger'] }
  }
  if (data.kind !== 'workflowStage') return null
  return {
    inputs: readPorts(data.workflowInputPorts),
    optionalInputs: readPorts(data.workflowOptionalInputPorts),
    outputs: readPorts(data.workflowOutputPorts),
  }
}

export function workflowPortHandleId(direction: WorkflowHandleDirection, portId: string): string {
  const normalizedPortId = portId.trim()
  if (!normalizedPortId) throw new Error('工作流端口身份不能为空')
  const prefix = direction === 'input' ? 'in-workflow:' : 'out-workflow:'
  return `${prefix}${encodeURIComponent(normalizedPortId)}`
}

export function workflowPortFromHandle(handleId: string | null | undefined, direction: WorkflowHandleDirection): string | null {
  if (typeof handleId !== 'string') return null
  const prefix = direction === 'input' ? 'in-workflow:' : 'out-workflow:'
  if (!handleId.startsWith(prefix)) return null
  const encoded = handleId.slice(prefix.length)
  if (!encoded) return null
  try {
    const decoded = decodeURIComponent(encoded).trim()
    return decoded || null
  } catch {
    return null
  }
}

function nodeLabel(node: Node): string {
  const label = nodeData(node).label
  return typeof label === 'string' && label.trim() ? label.trim() : node.id
}

/**
 * Compile React Flow handles into explicit artifact-port edges. Every declared input is required:
 * optionality belongs in a future port contract and must never be guessed from a missing edge.
 */
export function compileWorkflowPortEdges(nodes: readonly Node[], edges: readonly Edge[]): readonly CompiledWorkflowEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  const portsById = new Map(nodes.map((node) => [node.id, readWorkflowCanvasPorts(nodeData(node))] as const))
  const compiled = edges.map((edge): CompiledWorkflowEdge => {
    const sourceNode = nodeById.get(edge.source)
    const targetNode = nodeById.get(edge.target)
    if (!sourceNode || !targetNode) throw new Error(`工作流边 ${edge.id} 指向不存在的节点`)
    const sourcePorts = portsById.get(edge.source)
    const targetPorts = portsById.get(edge.target)
    if (!sourcePorts || !targetPorts) throw new Error(`工作流边 ${edge.id} 连接了非原子节点`)
    const sourcePort = workflowPortFromHandle(edge.sourceHandle, 'output')
    const targetPort = workflowPortFromHandle(edge.targetHandle, 'input')
    if (!sourcePort || !targetPort) throw new Error(`工作流边 ${edge.id} 缺少明确的输入/输出端口`)
    if (!sourcePorts.outputs.includes(sourcePort)) {
      throw new Error(`节点“${nodeLabel(sourceNode)}”不存在输出端口 ${sourcePort}`)
    }
    if (!targetPorts.inputs.includes(targetPort)) {
      throw new Error(`节点“${nodeLabel(targetNode)}”不存在输入端口 ${targetPort}`)
    }
    return { id: edge.id, source: edge.source, sourcePort, target: edge.target, targetPort }
  })

  for (const node of nodes) {
    const ports = portsById.get(node.id)
    if (!ports) continue
    for (const inputPort of ports.inputs) {
      if (ports.optionalInputs.includes(inputPort)) continue
      const hasInput = compiled.some((edge) => edge.target === node.id && edge.targetPort === inputPort)
      if (!hasInput) throw new Error(`节点“${nodeLabel(node)}”缺少输入端口 ${inputPort} 的连线`)
    }
  }
  return compiled
}
