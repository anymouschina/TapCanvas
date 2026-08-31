import { createWorkflowCollection } from '@tapcanvas/workflow-kernel-protocol'
import { executeWorkflowJavascriptSandbox, parseWorkflowTestInput, type WorkflowJsonValue } from './workflowJavascriptSandbox'
import { dataRecord, nodeOperation, readString, resolveConnectedInput } from './components/workflowNodeInspectorShared'

export type WorkflowNodeLocalTestResult = Readonly<{
  output: WorkflowJsonValue
  durationMs: number
  evidence: Readonly<Record<string, WorkflowJsonValue>>
}>

export const WORKFLOW_LOCAL_TEST_OPERATIONS = [
  'workflow_input',
  'text_input',
  'javascript',
  'collection_split',
] as const

export function supportsWorkflowNodeLocalTest(operation: string): boolean {
  return WORKFLOW_LOCAL_TEST_OPERATIONS.some((candidate) => candidate === operation)
}

function isWorkflowJsonArray(value: WorkflowJsonValue): value is readonly WorkflowJsonValue[] {
  return Array.isArray(value)
}

function isWorkflowJsonObject(
  value: WorkflowJsonValue,
): value is Readonly<Record<string, WorkflowJsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function valueAtPath(value: WorkflowJsonValue, path: string): WorkflowJsonValue {
  if (!path) return value
  let current: WorkflowJsonValue = value
  for (const segment of path.split('.')) {
    const normalizedSegment = segment.trim()
    if (!normalizedSegment) throw new Error('集合路径包含空路径段')
    if (isWorkflowJsonArray(current)) {
      const index = Number(normalizedSegment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error(`集合路径索引 ${normalizedSegment} 不存在`)
      }
      current = current[index] ?? null
      continue
    }
    if (!isWorkflowJsonObject(current) || !Object.prototype.hasOwnProperty.call(current, normalizedSegment)) {
      throw new Error(`集合路径字段 ${normalizedSegment} 不存在`)
    }
    current = current[normalizedSegment] ?? null
  }
  return current
}

function parseCollectionSource(data: Record<string, unknown>, input: WorkflowJsonValue): WorkflowJsonValue {
  const selected = valueAtPath(input, readString(data, 'workflowCollectionPath').trim())
  if (data.workflowCollectionParseJson !== true) return selected
  if (typeof selected !== 'string') throw new Error('当前集合配置要求上游值是 JSON 文本')
  return parseWorkflowTestInput(selected)
}

function readCollectionItemIds(values: readonly WorkflowJsonValue[], itemIdField: string): readonly string[] | undefined {
  if (!itemIdField) return undefined
  return values.map((value, index) => {
    if (!isWorkflowJsonObject(value)) {
      throw new Error(`第 ${index + 1} 个数据项必须是对象，才能读取身份字段 ${itemIdField}`)
    }
    const itemId = value[itemIdField]
    if (typeof itemId !== 'string' || !itemId.trim()) {
      throw new Error(`第 ${index + 1} 个数据项缺少非空身份字段 ${itemIdField}`)
    }
    return itemId.trim()
  })
}

function resolveNodeTestInput(nodeId: string, data: Record<string, unknown>): WorkflowJsonValue {
  const connected = resolveConnectedInput(nodeId)
  if (connected !== null) return connected
  return parseWorkflowTestInput(readString(data, 'workflowNodeTestInput'))
}

export async function executeWorkflowNodeLocalTest(input: Readonly<{
  nodeId: string
  data: Record<string, unknown>
}>): Promise<WorkflowNodeLocalTestResult> {
  const operation = nodeOperation(input.data)
  if (!supportsWorkflowNodeLocalTest(operation)) {
    throw new Error('该节点依赖持久执行器，不能伪造本地结果；请从触发器运行工作流')
  }
  const startedAt = performance.now()

  if (operation === 'workflow_input') {
    const facts = readString(input.data, 'workflowInputDescription').trim()
    if (!facts) throw new Error('输入来源节点还没有填写输入范围')
    return {
      output: { 'input-facts': facts },
      durationMs: Math.round(performance.now() - startedAt),
      evidence: { executorCompleted: true, localPreview: true },
    }
  }

  if (operation === 'text_input') {
    const text = readString(input.data, 'workflowTextInput')
    if (!text.trim()) throw new Error('文本输入不能为空')
    return {
      output: { text },
      durationMs: Math.round(performance.now() - startedAt),
      evidence: { executorCompleted: true, localPreview: true, characterCount: text.length },
    }
  }

  if (operation === 'javascript') {
    const result = await executeWorkflowJavascriptSandbox({
      code: readString(input.data, 'workflowJavascriptCode'),
      value: resolveNodeTestInput(input.nodeId, input.data),
    })
    return {
      output: { result: result.output },
      durationMs: result.durationMs,
      evidence: { executorCompleted: true, localPreview: true, isolation: 'browser-sandbox-worker' },
    }
  }

  const source = parseCollectionSource(input.data, resolveNodeTestInput(input.nodeId, input.data))
  if (!Array.isArray(source)) throw new Error('拆分节点在当前数组路径没有得到数组')
  const itemIdField = readString(input.data, 'workflowCollectionItemIdField').trim()
  const itemIds = readCollectionItemIds(source, itemIdField)
  const collection = createWorkflowCollection({
    collectionId: `local-test:${input.nodeId}:items`,
    producerNodeId: input.nodeId,
    producerPortId: 'items',
    values: source,
    ...(itemIds ? { itemIds } : {}),
  })
  return {
    output: { items: collection },
    durationMs: Math.round(performance.now() - startedAt),
    evidence: { executorCompleted: true, localPreview: true, itemCount: collection.items.length },
  }
}
