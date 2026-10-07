import { beforeEach, describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { useRFStore } from './store'
import { sanitizeBrowserCanvasPatch } from '@tapcanvas/video-orchestrator-protocol'
import { preserveManagedFlowProjections } from '../../../hono-api/src/modules/flow/flow.managed-projections'

const assetUrl = 'https://assets.example.com/existing-result.png'
const source = (): Node => ({
  id: 'source-output', type: 'taskNode', position: { x: 40, y: 50 },
  data: {
    kind: 'image', label: 'Existing image', prompt: 'Original creative prompt',
    imageUrl: assetUrl, imageResults: [{ url: assetUrl }], status: 'success',
    workflowExecutionId: 'original-execution', workflowRuntimeNodeId: 'original-runtime',
    workflowEffectId: 'original-effect', workflowTaskId: 'original-task',
    taskId: 'original-task', imageTaskId: 'original-task',
  },
})

describe('copied media survives the real flow persistence ownership boundary', () => {
  beforeEach(() => useRFStore.getState().reset())

  it.each(['import', 'paste', 'pasteAt', 'duplicate'] as const)('%s persists assets without claiming the original execution', (action) => {
    const original = source()
    if (action === 'duplicate') {
      useRFStore.setState({ nodes: [original], edges: [] })
      useRFStore.getState().duplicateNode(original.id)
    } else if (action === 'import') {
      useRFStore.getState().importWorkflow({ nodes: [original], edges: [] }, { x: 100, y: 100 })
    } else {
      useRFStore.setState({ clipboard: { nodes: [original], edges: [] } })
      if (action === 'paste') useRFStore.getState().pasteFromClipboard()
      else useRFStore.getState().pasteFromClipboardAt({ x: 100, y: 100 })
    }
    const copies = useRFStore.getState().nodes.filter(node => node.id !== original.id)
    expect(copies).toHaveLength(1)
    const saved = preserveManagedFlowProjections({ existing: { nodes: [], edges: [] }, incoming: { nodes: copies, edges: [] } })
    expect(saved.nodes).toHaveLength(1)
    const [copy] = copies
    expect(copy.data.imageUrl).toBe(assetUrl)
    expect(copy.data.imageResults).toEqual(original.data.imageResults)
    expect(copy.data.prompt).toBe(original.data.prompt)
    const collaborationPatch = sanitizeBrowserCanvasPatch({ upsertNodes: copies })
    expect(collaborationPatch.upsertNodes[0].data).toMatchObject({ imageUrl: assetUrl, imageResults: [{ url: assetUrl }] })
    expect(collaborationPatch.upsertNodes[0].dataMode).toBeUndefined()
    for (const field of ['workflowExecutionId', 'workflowRuntimeNodeId', 'workflowEffectId', 'taskId', 'imageTaskId']) {
      expect(copy.data).not.toHaveProperty(field)
    }
    expect(original.data.workflowExecutionId).toBe('original-execution')
    useRFStore.getState().load(JSON.parse(JSON.stringify(saved)))
    expect(useRFStore.getState().nodes[0].data.imageUrl).toBe(assetUrl)
  })

  it('duplicates a child in its existing group while detaching its media execution', () => {
    const group: Node = {
      id: 'group', type: 'groupNode', position: { x: 100, y: 100 },
      data: { workflowInstanceId: 'instance' },
    }
    const original = source()
    original.parentId = group.id
    original.extent = 'parent'
    original.data.workflowInstanceId = 'instance'
    useRFStore.setState({ nodes: [group, original], edges: [] })

    useRFStore.getState().duplicateNode(original.id)

    const duplicate = useRFStore.getState().nodes.find(node => node.id !== group.id && node.id !== original.id)
    expect(duplicate).toMatchObject({
      parentId: group.id, extent: 'parent', position: { x: 64, y: 74 },
      data: { workflowInstanceId: 'instance', imageUrl: assetUrl },
    })
    expect(duplicate?.data).not.toHaveProperty('workflowExecutionId')
  })

  it('imports a child before its parent with remapped references and relative coordinates', () => {
    const group: Node = {
      id: 'group', type: 'groupNode', position: { x: 100, y: 100 },
      style: { width: 300, height: 300 }, data: { workflowInstanceId: 'instance' },
    }
    const original = source()
    original.parentId = group.id
    original.data.workflowInstanceId = 'instance'
    const video: Node = {
      id: 'video', type: 'taskNode', position: { x: 160, y: 20 }, parentId: group.id,
      data: { kind: 'video', workflowInstanceId: 'instance', referenceImageNodeIds: [original.id] },
    }

    useRFStore.getState().importWorkflow({ nodes: [original, video, group], edges: [
      { id: 'reference', source: original.id, target: video.id },
    ] }, { x: 500, y: 500 })

    const { nodes, edges } = useRFStore.getState()
    const copiedGroup = nodes.find(node => node.type === 'groupNode')!
    const copiedImage = nodes.find(node => node.data.kind === 'image')!
    const copiedVideo = nodes.find(node => node.data.kind === 'video')!
    expect(nodes[0].id).toBe(copiedGroup.id)
    expect(copiedGroup.position).toEqual({ x: 500, y: 500 })
    expect(copiedImage.parentId).toBe(copiedGroup.id)
    expect(copiedImage.position).toEqual(original.position)
    expect(copiedVideo.data.referenceImageNodeIds).toEqual([copiedImage.id])
    expect(copiedVideo.data.workflowInstanceId).toBe(copiedGroup.data.workflowInstanceId)
    expect(edges).toMatchObject([{ source: copiedImage.id, target: copiedVideo.id }])
  })
})
