import { beforeEach, describe, expect, it } from 'vitest'
import { useRFStore } from './store'

describe('workflow media canvas display', () => {
  beforeEach(() => useRFStore.getState().reset())

  it('updates data, measured geometry and persisted style as one node state change', () => {
    useRFStore.setState({
      nodes: [{
        id: 'image-generator',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        initialWidth: 56,
        initialHeight: 56,
        measured: { width: 56, height: 56 },
        style: { width: 56, height: 56 },
        data: {
          kind: 'workflowStage',
          workflowAtomicSpec: { operation: 'image_generate' },
          workflowOutputArtifacts: [{
            type: 'tapcanvas.image/v1',
            identity: 'image-1',
            value: 'https://cdn.example.com/image-1.webp',
          }],
        },
      }],
      edges: [],
    })

    useRFStore.getState().updateNodeData('image-generator', {
      workflowCanvasDisplayMode: 'result',
    })
    expect(useRFStore.getState().nodes[0]).toMatchObject({
      initialWidth: 240,
      initialHeight: 135,
      measured: { width: 240, height: 135 },
      style: { width: 240, height: 135 },
      data: { workflowCanvasDisplayMode: 'result' },
    })

    useRFStore.getState().updateNodeData('image-generator', {
      workflowCanvasDisplayMode: 'icon',
    })
    expect(useRFStore.getState().nodes[0]).toMatchObject({
      initialWidth: 56,
      initialHeight: 56,
      measured: { width: 56, height: 56 },
      style: { width: 56, height: 56 },
      data: { workflowCanvasDisplayMode: 'icon' },
    })
  })
})
