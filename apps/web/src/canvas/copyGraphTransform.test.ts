import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { transformCopiedGraph } from './copyGraphTransform'

function node(id: string, data: Record<string, unknown>, extra: Partial<Node> = {}): Node {
  return {
    id,
    type: 'taskNode',
    position: { x: 10, y: 20 },
    data,
    ...extra,
  }
}

function copy(nodes: Node[], edges: Edge[] = []) {
  let nextId = 0
  return transformCopiedGraph(nodes, edges, {
    createNodeId: () => `copy-${++nextId}`,
    offset: { x: 5, y: 7 },
  })
}

describe('transformCopiedGraph', () => {
  it('rebinds a copied workflow to its copied source group and preserves external source bindings', () => {
    const source = node('source', { label: 'Script' }, { type: 'groupNode' })
    const workflow = node('workflow', { adminWorkflow: true, workflowInstanceId: 'production', sourceGroupId: 'source' }, { type: 'groupNode' })
    const trigger = node('trigger', { kind: 'workflowTrigger', workflowInstanceId: 'production', sourceGroupId: 'source' }, { parentId: 'workflow' })
    const reader = node('reader', { kind: 'workflowStage', workflowSourceMode: 'canvas_group', sourceGroupId: 'source' }, { parentId: 'workflow' })
    const together = copy([source, workflow, trigger, reader])
    for (const copied of together.nodes.slice(1)) expect(copied.data.sourceGroupId).toBe(together.idMap.get('source'))
    expect(together.nodes[2].parentId).toBe(together.idMap.get('workflow'))
    const workflowOnly = copy([workflow, trigger, reader])
    for (const copied of workflowOnly.nodes) expect(copied.data.sourceGroupId).toBe('source')
    expect(trigger.data.sourceGroupId).toBe('source')
  })

  it('copies assets and authoring data while detaching execution identity and remapping the copied graph', () => {
    const group = node('group', { adminWorkflow: true, workflowInstanceId: 'workflow-source', kind: 'workflowGroup' }, {
      type: 'groupNode', position: { x: 100, y: 200 },
    })
    const image = node('image', {
      kind: 'image', workflowInstanceId: 'workflow-source', workflowExecutionId: 'execution-1',
      workflowExecutionFamilyId: 'family-1', workflowRuntimeNodeId: 'runtime-image', workflowEffectId: 'effect-1',
      workflowTaskId: 'workflow-task-1', taskId: 'task-1', imageTaskId: 'image-task-1', runToken: 'token-1',
      workflowEstimateIdentity: 'estimate-1',
      imageUrl: 'https://assets.example/image.png', imageResults: [{ url: 'https://assets.example/image.png' }],
      prompt: 'Keep this prompt', imageModel: 'model-x', status: 'success', progress: 100,
      sourceNodeId: 'outside-source', workflowSourcePrompt: 'Preserve authoring data',
    }, { parentId: 'group', position: { x: 8, y: 12 }, extent: 'parent' })
    const video = node('video', {
      kind: 'video', workflowInstanceId: 'workflow-source', status: 'running', progress: 41,
      videoUrl: 'https://assets.example/video.mp4', videoResults: [{ url: 'https://assets.example/video.mp4' }],
      prompt: 'Keep video prompt', referenceImageNodeIds: ['image', 'outside-reference'],
      upstreamReferenceOrder: ['image', 'outside-reference'],
      firstFrameFromNodeId: 'image', lastFrameImageNodeId: 'outside-reference',
      sourcePrevVideoNodeId: 'video', bundleSourceNodeIds: ['image', 'outside-reference'],
      referenceImageBindings: [{ nodeId: 'image', name: 'copied image' }, { sourceNodeId: 'outside-reference', name: 'external' }],
      workflowReferenceBindings: [{ nodeId: 'image', name: 'internal reference' }, { nodeId: 'outside-reference', name: 'external reference' }],
      referenceAssetBindings: [{ nodeId: 'image', assetId: 'asset-1' }],
      imageOperationSpec: { sourceNodeId: 'image', inputs: [{ role: 'source', nodeId: 'image', url: 'https://assets.example/image.png' }] },
      workflowSourcePrompt: 'Keep workflow prompt',
    })
    const edges: Edge[] = [
      { id: 'inside', source: 'image', target: 'video' },
      { id: 'outside', source: 'outside-source', target: 'video' },
    ]

    const result = copy([group, image, video], edges)
    const copiedImage = result.nodes[1]
    const copiedVideo = result.nodes[2]

    expect(result.idMap).toEqual(new Map([['group', 'copy-1'], ['image', 'copy-2'], ['video', 'copy-3']]))
    expect(copiedImage.parentId).toBe('copy-1')
    expect(copiedImage.data).toMatchObject({
      workflowInstanceId: 'workflow-copy-1',
      imageUrl: 'https://assets.example/image.png',
      imageResults: [{ url: 'https://assets.example/image.png' }],
      prompt: 'Keep this prompt',
      imageModel: 'model-x',
      workflowSourcePrompt: 'Preserve authoring data',
      status: 'success',
      copySource: { nodeId: 'image', execution: { workflowExecutionId: 'execution-1', taskId: 'task-1' } },
    })
    for (const field of ['workflowExecutionId', 'workflowExecutionFamilyId', 'workflowRuntimeNodeId', 'workflowEffectId', 'workflowTaskId', 'taskId', 'imageTaskId', 'runToken', 'workflowEstimateIdentity']) {
      expect(copiedImage.data).not.toHaveProperty(field)
    }
    expect(copiedVideo.data).toMatchObject({
      workflowInstanceId: 'workflow-copy-1',
      status: 'success',
      progress: 100,
      videoUrl: 'https://assets.example/video.mp4',
      videoResults: [{ url: 'https://assets.example/video.mp4' }],
      referenceImageNodeIds: ['copy-2'],
      upstreamReferenceOrder: ['copy-2'],
      firstFrameFromNodeId: 'copy-2',
      bundleSourceNodeIds: ['copy-2'],
      referenceImageBindings: [{ nodeId: 'copy-2', name: 'copied image' }, { name: 'external' }],
      workflowReferenceBindings: [{ nodeId: 'copy-2', name: 'internal reference' }, { name: 'external reference' }],
      referenceAssetBindings: [{ nodeId: 'copy-2', assetId: 'asset-1' }],
      imageOperationSpec: { sourceNodeId: 'copy-2', inputs: [{ role: 'source', nodeId: 'copy-2', url: 'https://assets.example/image.png' }] },
      workflowSourcePrompt: 'Keep workflow prompt',
    })
    expect(copiedVideo.data).not.toHaveProperty('lastFrameImageNodeId')
    expect(copiedVideo.data).toHaveProperty('sourcePrevVideoNodeId', 'copy-3')
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]).toMatchObject({ source: 'copy-2', target: 'copy-3', animated: false })
  })

  it('detaches a copied child whose parent is outside the copied graph and clears parent extent', () => {
    const child = node('child', { kind: 'text' }, {
      parentId: 'source-group', extent: 'parent', position: { x: 4, y: 9 },
    })
    const result = copy([child])
    expect(result.nodes[0].parentId).toBeUndefined()
    expect(result.nodes[0]).not.toHaveProperty('extent')
    expect(result.nodes[0].position).toEqual({ x: 9, y: 16 })
  })

  it('resets active and failed media states without inventing success from unrelated asset URLs', () => {
    const failed = node('failed', { kind: 'image', status: 'failed', progress: 42, canceled: true, lastError: 'provider failure' })
    const video = node('video', { kind: 'video', status: 'canceled', imageUrl: 'https://assets.example/reference.png', videoResults: [{ status: 'failed' }] })
    const image = node('image', { kind: 'image', status: 'running', imageResults: [{ url: 'https://assets.example/result.png' }] })
    const result = copy([failed, video, image])

    expect(result.nodes[0].data).toMatchObject({ status: 'idle', progress: 0, copySource: { execution: { status: 'failed', lastError: 'provider failure' } } })
    expect(result.nodes[0].data).not.toHaveProperty('canceled')
    expect(result.nodes[0].data).not.toHaveProperty('lastError')
    expect(result.nodes[1].data).toMatchObject({ status: 'idle', progress: 0 })
    expect(result.nodes[2].data).toMatchObject({ status: 'success', progress: 100 })
  })
})
