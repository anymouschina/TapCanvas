import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { deserializeCanvas, serializeCanvas } from './serialization'

describe('workflow node configuration persistence', () => {
  it('round-trips node data together with its position', () => {
    const node: Node = {
      id: 'workflow:video',
      type: 'taskNode',
      position: { x: 320, y: 48 },
      data: {
        kind: 'workflowStage',
        label: '视频生成',
        adminWorkflow: true,
        workflowVideoModelKey: 'doubao-seedance-2.5',
        workflowVideoResolution: '480p',
        workflowVideoAspectRatio: '16:9',
        workflowIconUrl: 'https://assets.example.com/video.png',
        workflowAtomicSpec: {
          version: 1,
          category: 'media',
          operation: 'video_generate',
          executorRef: 'tapcanvas.video.generate/v1',
          executionMode: 'each',
          itemConcurrency: 1,
          inputPorts: ['prompt'],
          outputPorts: ['video'],
        },
      },
    }

    const restored = deserializeCanvas(serializeCanvas([node], []))

    expect(restored.nodes[0]?.position).toEqual({ x: 320, y: 48 })
    expect(restored.nodes[0]?.data).toMatchObject({
      workflowVideoModelKey: 'doubao-seedance-2.5',
      workflowVideoResolution: '480p',
      workflowVideoAspectRatio: '16:9',
      workflowIconUrl: 'https://assets.example.com/video.png',
      workflowAtomicSpec: {
        executionMode: 'each',
        itemConcurrency: 1,
      },
    })
  })
})
