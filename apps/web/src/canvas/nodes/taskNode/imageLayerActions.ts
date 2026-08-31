import { createImageOperationState } from '@tapcanvas/image-operation-protocol'
import {
  fetchPublicTaskResultWithAuth,
  runTaskByVendor,
  type TaskResultDto,
} from '../../../api/server'
import { notifyAssetRefresh } from '../../../ui/assetEvents'
import { toast } from '../../../ui/toast'
import { withCanvasGenerationContext } from '../../../runner/generationAssetContext'
import { useRFStore } from '../../store'
import { useUIStore } from '../../../ui/uiStore'
import {
  IMAGE_LAYER_DECOMPOSITION_DEFAULTS,
  IMAGE_LAYER_DECOMPOSITION_MODEL_KEY,
  readImageLayerAssets,
} from './imageLayerDecomposition'
import {
  createImageOperationForSource,
  readImageOperationSourceRevision,
} from './imageOperationFactory'
import { recomposeImageLayerUrls } from './imageLayerRecompose'

type HostedEditedImageAsset = Readonly<{
  url: string
  assetId: string
}>

type UploadEditedImageBlob = (input: Readonly<{
  blob: Blob
  label: string
  filePrefix: string
}>) => Promise<HostedEditedImageAsset>

type ResolveImageEditModel = (requestedModel?: string | null) => string | null

type RunImageLayerSplitInput = Readonly<{
  data: Record<string, unknown>
  nodeId: string
  nodeWidth: number
  primaryImageUrl: string
  resolveImageEditModel: ResolveImageEditModel
  sleep: (milliseconds: number) => Promise<void>
}>

type RunImageLayerRecomposeInput = Readonly<{
  data: Record<string, unknown>
  nodeId: string
  nodeWidth: number
  uploadEditedImageBlob: UploadEditedImageBlob
}>

export function collectRecomposableLayerAssets(
  nodes: ReturnType<typeof useRFStore.getState>['nodes'],
  operationNodeId: string,
): Array<{ nodeId: string; url: string; assetId: string | null }> {
  return nodes
    .filter((node) => {
      const record = (node.data ?? {}) as Record<string, unknown>
      return record.isImageLayer === true && record.layerOperationNodeId === operationNodeId
    })
    .sort((left, right) => {
      const leftIndex = Number(((left.data ?? {}) as Record<string, unknown>).layerIndex ?? 0)
      const rightIndex = Number(((right.data ?? {}) as Record<string, unknown>).layerIndex ?? 0)
      return leftIndex - rightIndex
    })
    .map((node) => {
      const record = (node.data ?? {}) as Record<string, unknown>
      const url = typeof record.imageUrl === 'string' ? record.imageUrl.trim() : ''
      const assetId = typeof record.serverAssetId === 'string' ? record.serverAssetId : null
      return { nodeId: node.id, url, assetId }
    })
    .filter((asset) => asset.url)
}

export async function runImageLayerSplit({
  data,
  nodeId,
  nodeWidth,
  primaryImageUrl,
  resolveImageEditModel,
  sleep,
}: RunImageLayerSplitInput): Promise<void> {
  const layerModel = resolveImageEditModel(IMAGE_LAYER_DECOMPOSITION_MODEL_KEY)
  if (!layerModel) return
  const imageOperationSpec = createImageOperationForSource({
    kind: 'layer_decompose',
    execution: 'layer-decompose',
    sourceNodeId: nodeId,
    sourceUrl: primaryImageUrl,
    sourceRevision: readImageOperationSourceRevision(data.imageOperationRevision),
    parameters: {
      ...IMAGE_LAYER_DECOMPOSITION_DEFAULTS,
      alphaMode: 'rgba',
      preserveRecomposition: true,
    },
    output: {
      mediaType: 'image',
      count: IMAGE_LAYER_DECOMPOSITION_DEFAULTS.numLayers,
      format: 'png',
      transparent: true,
    },
  })
  const store = useRFStore.getState()
  const beforeIds = new Set(store.nodes.map((node) => node.id))
  store.addNode('taskNode', '图层分离', {
    kind: 'image',
    status: 'running',
    imageModel: layerModel,
    imageLayerDecomposition: {
      modelKey: IMAGE_LAYER_DECOMPOSITION_MODEL_KEY,
      ...IMAGE_LAYER_DECOMPOSITION_DEFAULTS,
    },
    imageOperationSpec,
    imageOperationState: {
      ...createImageOperationState(imageOperationSpec, 'running'),
      attempt: 1,
      progress: 5,
      startedAt: new Date().toISOString(),
    },
    imageOperationRevision: 1,
    libTvImageOperationKey: 'layer-decompose',
  })
  const createdStore = useRFStore.getState()
  const operationNode = createdStore.nodes.find((node) => !beforeIds.has(node.id))
  if (!operationNode) {
    toast('图层分离任务节点创建失败', 'error')
    return
  }
  const sourceNode = createdStore.nodes.find((node) => node.id === nodeId)
  createdStore.onNodesChange([{
    id: operationNode.id,
    type: 'position' as const,
    position: {
      x: (sourceNode?.position.x ?? 0) + nodeWidth + 80,
      y: sourceNode?.position.y ?? 0,
    },
    dragging: false,
  }])
  createdStore.onConnect({
    source: nodeId,
    sourceHandle: 'out-image',
    target: operationNode.id,
    targetHandle: 'in-image',
  })

  try {
    const layerPrompt = 'Decompose the source image into independently editable RGBA layers. Preserve the exact original composition and make the stacked layers reconstruct the source image.'
    let result: TaskResultDto = await runTaskByVendor('auto', withCanvasGenerationContext({
      kind: 'image_edit',
      prompt: layerPrompt,
      extras: {
        modelKey: layerModel,
        referenceImages: [primaryImageUrl],
        imageOperation: 'layer_decompose',
        imageOperationSpec,
        ...IMAGE_LAYER_DECOMPOSITION_DEFAULTS,
      },
    }, useUIStore.getState(), operationNode.id))

    let layers = readImageLayerAssets(result)
    if (layers.length === 0 && result.id) {
      const deadline = Date.now() + 8 * 60 * 1000
      while (result.status !== 'succeeded' && result.status !== 'failed' && Date.now() < deadline) {
        await sleep(2000)
        result = (await fetchPublicTaskResultWithAuth({
          taskId: result.id,
          taskKind: 'image_edit',
          prompt: layerPrompt,
        })).result
      }
      if (result.status === 'failed') throw new Error('图层分离模型执行失败')
      if (result.status !== 'succeeded') throw new Error('图层分离超时，请稍后查看任务状态')
      layers = readImageLayerAssets(result)
    }
    if (layers.length === 0) throw new Error('图层分离完成，但模型未返回任何 RGBA 图层')

    const operationResults = layers.map((layer, index) => ({
      url: layer.url,
      title: `图层 ${index + 1}`,
      assetId: layer.assetId,
      assetRefId: layer.assetRefId,
      assetName: layer.assetName,
    }))
    useRFStore.getState().updateNodeData(operationNode.id, {
      imageUrl: layers[0]?.url,
      imageResults: operationResults,
      imagePrimaryIndex: 0,
      serverAssetId: layers[0]?.assetId ?? null,
      status: 'done',
      label: `图层分离 · ${layers.length}层`,
      layerTaskId: result.id,
      imageOperationState: {
        ...createImageOperationState(imageOperationSpec, 'succeeded'),
        attempt: 1,
        progress: 100,
        startedAt: imageOperationSpec.createdAt,
        finishedAt: new Date().toISOString(),
        resultAssets: layers.map((layer) => ({
          role: 'layer' as const,
          url: layer.url,
          assetId: layer.assetId,
          mimeType: 'image/png',
        })),
      },
    })

    const layerNodeIds: string[] = []
    for (const [index, layer] of layers.entries()) {
      const layerLabel = `图层 ${index + 1}`
      const beforeLayerIds = new Set(useRFStore.getState().nodes.map((node) => node.id))
      useRFStore.getState().addNode('taskNode', layerLabel, {
        kind: 'image',
        imageUrl: layer.url,
        imageResults: [operationResults[index]],
        imagePrimaryIndex: 0,
        serverAssetId: layer.assetId,
        status: 'done',
        isImageLayer: true,
        layerIndex: index,
        layerSourceNodeId: nodeId,
        layerOperationNodeId: operationNode.id,
        imageOperationSpec,
        imageOperationRevision: index + 1,
      })
      const afterLayer = useRFStore.getState()
      const layerNode = afterLayer.nodes.find((node) => !beforeLayerIds.has(node.id))
      if (!layerNode) continue
      layerNodeIds.push(layerNode.id)
      afterLayer.onNodesChange([{
        id: layerNode.id,
        type: 'position' as const,
        position: {
          x: (sourceNode?.position.x ?? 0) + (nodeWidth + 80) * 2 + (index % 2) * (nodeWidth + 32),
          y: (sourceNode?.position.y ?? 0) + Math.floor(index / 2) * 260,
        },
        dragging: false,
      }])
    }

    if (layerNodeIds.length === 0) throw new Error('图层资产已生成，但画布图层节点创建失败')
    const groupId = useRFStore.getState().createGroupForNodeIds(
      layerNodeIds,
      `RGBA 图层组 (${layerNodeIds.length}层)`,
      { preserveLayout: true },
    )
    if (groupId) {
      useRFStore.getState().onConnect({
        source: operationNode.id,
        sourceHandle: 'out-image',
        target: groupId,
        targetHandle: null,
      })
    }
    notifyAssetRefresh()
    toast(`已分离为 ${layers.length} 个可独立编辑的 RGBA 图层`, 'success')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '图层分离失败'
    useRFStore.getState().updateNodeData(operationNode.id, {
      status: 'error',
      error: message,
      imageOperationState: {
        ...createImageOperationState(imageOperationSpec, 'failed'),
        attempt: 1,
        progress: 0,
        finishedAt: new Date().toISOString(),
        error: { code: 'layer_decompose_failed', message, retryable: true },
      },
    })
    toast(message, 'error')
  }
}

export async function runImageLayerRecompose({
  data,
  nodeId,
  nodeWidth,
  uploadEditedImageBlob,
}: RunImageLayerRecomposeInput): Promise<void> {
  const operationNodeId = typeof data.layerOperationNodeId === 'string'
    ? data.layerOperationNodeId.trim()
    : ''
  if (!operationNodeId) {
    toast('当前图片不是可重新合成的 RGBA 图层', 'error')
    return
  }
  const layerAssets = collectRecomposableLayerAssets(useRFStore.getState().nodes, operationNodeId)
  if (layerAssets.length === 0) {
    toast('图层组没有可合成的真实 RGBA 资产', 'error')
    return
  }
  try {
    const recomposedBlob = await recomposeImageLayerUrls(layerAssets.map((asset) => asset.url))
    const hosted = await uploadEditedImageBlob({
      blob: recomposedBlob,
      label: '图层重新合成',
      filePrefix: 'layer-recompose',
    })
    const firstLayer = layerAssets[0]
    if (!firstLayer) throw new Error('图层组没有可合成的真实 RGBA 资产')
    const imageOperationSpec = createImageOperationForSource({
      kind: 'layer_recompose',
      execution: 'local-transform',
      sourceNodeId: nodeId,
      sourceUrl: firstLayer.url,
      sourceAssetId: firstLayer.assetId,
      sourceRevision: readImageOperationSourceRevision(data.imageOperationRevision),
      parameters: {
        layerOrder: layerAssets.map((asset, index) => ({ index, nodeId: asset.nodeId })),
        blendMode: 'source-over',
        preserveAlpha: true,
      },
      additionalInputs: layerAssets.slice(1).map((asset) => ({
        role: 'layer' as const,
        url: asset.url,
        assetId: asset.assetId,
        nodeId: asset.nodeId,
        mimeType: 'image/png',
      })),
      output: { mediaType: 'image', count: 1, format: 'png', transparent: true },
    })
    const store = useRFStore.getState()
    const beforeIds = new Set(store.nodes.map((node) => node.id))
    store.addNode('taskNode', '图层重新合成', {
      kind: 'image',
      imageUrl: hosted.url,
      imageResults: [{ url: hosted.url, title: '图层重新合成', assetId: hosted.assetId }],
      imagePrimaryIndex: 0,
      serverAssetId: hosted.assetId,
      status: 'done',
      imageOperationSpec,
      imageOperationState: {
        ...createImageOperationState(imageOperationSpec, 'succeeded'),
        attempt: 1,
        progress: 100,
        startedAt: imageOperationSpec.createdAt,
        finishedAt: new Date().toISOString(),
        resultAssets: [{ role: 'result' as const, url: hosted.url, assetId: hosted.assetId }],
      },
      imageOperationRevision: imageOperationSpec.sourceRevision + 1,
      layerOperationNodeId: operationNodeId,
      layerSourceNodeIds: layerAssets.map((asset) => asset.nodeId),
    })
    const afterAdd = useRFStore.getState()
    const outputNode = afterAdd.nodes.find((node) => !beforeIds.has(node.id))
    if (!outputNode) throw new Error('图层合成结果节点创建失败')
    const sourceNode = afterAdd.nodes.find((node) => node.id === nodeId)
    afterAdd.onNodesChange([{
      id: outputNode.id,
      type: 'position' as const,
      position: {
        x: (sourceNode?.position.x ?? 0) + nodeWidth + 80,
        y: sourceNode?.position.y ?? 0,
      },
      dragging: false,
    }])
    afterAdd.onConnect({
      source: nodeId,
      sourceHandle: 'out-image',
      target: outputNode.id,
      targetHandle: 'in-image',
    })
    notifyAssetRefresh()
    toast(`已按当前顺序合成 ${layerAssets.length} 个图层`, 'success')
  } catch (error: unknown) {
    toast(error instanceof Error ? error.message : '图层重新合成失败', 'error')
  }
}
