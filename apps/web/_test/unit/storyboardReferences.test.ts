import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import {
  collectOrderedUpstreamReferenceItems,
  extractNodePrimaryAssetReference,
  pickPrimaryImageFromNode,
} from '../../src/canvas/nodes/taskNode/upstreamReferences'

describe('storyboard upstream references', () => {
  it('uses the first storyboard cell image as primary preview when no node-level image exists', () => {
    const storyboardNode = {
      id: 'storyboard-1',
      type: 'taskNode',
      position: { x: 0, y: 0 },
      data: {
        kind: 'storyboard',
        storyboardEditorCells: [
          { id: 'cell-1', imageUrl: 'https://example.com/shot-1.png' },
          { id: 'cell-2', imageUrl: 'https://example.com/shot-2.png' },
        ],
      },
    } as unknown as Node

    expect(pickPrimaryImageFromNode(storyboardNode)).toBe('https://example.com/shot-1.png')
  })

  it('treats storyboard nodes as valid upstream image references', () => {
    const nodes = [
      {
        id: 'storyboard-1',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          kind: 'storyboard',
          label: '第一章九宫格分镜',
          storyboardEditorCells: [
            { id: 'cell-1', imageUrl: 'https://example.com/shot-1.png' },
          ],
        },
      },
      {
        id: 'video-1',
        type: 'taskNode',
        position: { x: 480, y: 0 },
        data: {
          kind: 'video',
          label: '第一章视频提示',
        },
      },
    ] as unknown as Node[]
    const edges = [
      {
        id: 'edge-1',
        source: 'storyboard-1',
        target: 'video-1',
      },
    ] as unknown as Edge[]

    expect(collectOrderedUpstreamReferenceItems(nodes, edges, 'video-1')).toEqual([
      expect.objectContaining({
        sourceNodeId: 'storyboard-1',
        sourceKind: 'image',
        previewUrl: 'https://example.com/shot-1.png',
      }),
    ])
  })

  it('derives a runtime alias from upstream image metadata when no explicit assetRefId exists', () => {
    const imageNode = {
      id: 'image-1',
      type: 'taskNode',
      position: { x: 0, y: 0 },
      data: {
        kind: 'image',
        label: '上一张海报',
        imageResults: [
          {
            url: 'https://example.com/poster.png',
            title: '海报主图',
          },
        ],
      },
    } as unknown as Node

    expect(extractNodePrimaryAssetReference(imageNode)).toEqual({
      url: 'https://example.com/poster.png',
      assetId: null,
      assetRefId: '海报主图',
      displayName: '海报主图',
    })
  })
})
