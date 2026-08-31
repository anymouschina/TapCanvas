import { useRFStore } from './store'
import { getNodeAbsPosition } from './utils/nodeBounds'
import { readWorkflowItemRuns } from './workflowItemRuns'

export type WorkflowRuntimeMaterializationResult = Readonly<{
  created: number
  existing: number
  totalVideos: number
}>

export type WorkflowRuntimeTextMaterializationResult = Readonly<{
  created: number
  existing: number
  totalTexts: number
}>

function dataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function materializeWorkflowVideoItems(nodeId: string): WorkflowRuntimeMaterializationResult {
  const store = useRFStore.getState()
  const sourceNode = store.nodes.find((node) => node.id === nodeId)
  if (!sourceNode) throw new Error('逐项运行来源节点不存在')
  const itemRuns = readWorkflowItemRuns(sourceNode.data?.workflowItemRuns).filter((item) => item.videoUrl)
  if (itemRuns.length === 0) throw new Error('当前逐项运行没有可固化的真实视频 URL')
  const nodeMap = new Map(store.nodes.map((node) => [node.id, node] as const))
  const sourcePosition = getNodeAbsPosition(sourceNode, nodeMap)
  let created = 0
  let existing = 0
  itemRuns.forEach((item, index) => {
    const runtimeIdentity = item.runtimeNodeId
    const persistedVideoNode = item.canvasNodeId
      ? useRFStore.getState().nodes.find((node) => node.id === item.canvasNodeId)
      : null
    if (persistedVideoNode) {
      useRFStore.getState().updateNodeData(persistedVideoNode.id, {
        workflowMaterializedRuntimeNodeId: runtimeIdentity,
        workflowMaterializedFromNodeId: nodeId,
        workflowMaterializedItemId: item.itemId,
        workflowMaterializedItemIndex: item.index,
      })
      const connected = useRFStore.getState().edges.some((edge) => edge.source === nodeId && edge.target === persistedVideoNode.id)
      if (!connected) {
        useRFStore.getState().onConnect({ source: nodeId, target: persistedVideoNode.id, sourceHandle: null, targetHandle: null })
      }
      existing += 1
      return
    }
    const alreadyExists = useRFStore.getState().nodes.some((node) => (
      dataRecord(node.data).workflowMaterializedRuntimeNodeId === runtimeIdentity
    ))
    if (alreadyExists) {
      existing += 1
      return
    }
    const materializedNodeId = `${nodeId}:video:${encodeURIComponent(item.itemId)}`
    useRFStore.getState().addNode('taskNode', `视频 ${item.index + 1}`, {
      nodeId: materializedNodeId,
      autoLabel: false,
      position: {
        x: sourcePosition.x + 420,
        y: sourcePosition.y + index * 330,
      },
      kind: 'video',
      status: 'success',
      videoUrl: item.videoUrl,
      workflowMaterializedRuntimeNodeId: runtimeIdentity,
      workflowMaterializedFromNodeId: nodeId,
      workflowMaterializedItemId: item.itemId,
      workflowMaterializedItemIndex: item.index,
    })
    useRFStore.getState().onConnect({
      source: nodeId,
      target: materializedNodeId,
      sourceHandle: null,
      targetHandle: null,
    })
    created += 1
  })
  return { created, existing, totalVideos: itemRuns.length }
}

export function materializeWorkflowTextItems(nodeId: string): WorkflowRuntimeTextMaterializationResult {
  const store = useRFStore.getState()
  const sourceNode = store.nodes.find((node) => node.id === nodeId)
  if (!sourceNode) throw new Error('逐项运行来源节点不存在')
  const itemRuns = readWorkflowItemRuns(sourceNode.data?.workflowItemRuns).filter((item) => item.textOutput)
  if (itemRuns.length === 0) throw new Error('当前逐项运行没有可固化的文本结果')
  const nodeMap = new Map(store.nodes.map((node) => [node.id, node] as const))
  const sourcePosition = getNodeAbsPosition(sourceNode, nodeMap)
  const executionId = typeof sourceNode.data?.workflowExecutionId === 'string'
    ? sourceNode.data.workflowExecutionId.trim()
    : ''
  let created = 0
  let existing = 0
  itemRuns.forEach((item, index) => {
    const executionIdentity = executionId || item.runtimeNodeId
    const materializedNodeId = `${nodeId}:text:${encodeURIComponent(executionIdentity)}:${encodeURIComponent(item.itemId)}`
    const alreadyExists = useRFStore.getState().nodes.some((node) => (
      node.id === materializedNodeId
      || (dataRecord(node.data).kind === 'text'
        && dataRecord(node.data).workflowMaterializedItemId === item.itemId
        && (executionId
          ? dataRecord(node.data).workflowMaterializedFromExecutionId === executionId
          : dataRecord(node.data).workflowMaterializedRuntimeNodeId === item.runtimeNodeId))
    ))
    if (alreadyExists) {
      existing += 1
      return
    }
    useRFStore.getState().addNode('taskNode', `视频提示词 ${item.index + 1}`, {
      nodeId: materializedNodeId,
      autoLabel: false,
      position: {
        x: sourcePosition.x + 420,
        y: sourcePosition.y + index * 300,
      },
      kind: 'text',
      prompt: item.textOutput,
      nodeWidth: 420,
      workflowMaterializedRuntimeNodeId: item.runtimeNodeId,
      workflowMaterializedFromNodeId: nodeId,
      workflowMaterializedItemId: item.itemId,
      workflowMaterializedItemIndex: item.index,
      ...(executionId ? { workflowMaterializedFromExecutionId: executionId } : {}),
    })
    useRFStore.getState().onConnect({
      source: nodeId,
      target: materializedNodeId,
      sourceHandle: null,
      targetHandle: null,
    })
    created += 1
  })
  return { created, existing, totalTexts: itemRuns.length }
}
