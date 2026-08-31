import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { collectRecomposableLayerAssets } from './imageLayerActions'

describe('collectRecomposableLayerAssets', () => {
  it('keeps only real assets from the requested operation and orders them by layer index', () => {
    const nodes: Node[] = [
      { id: 'second', position: { x: 0, y: 0 }, data: { isImageLayer: true, layerOperationNodeId: 'op', layerIndex: 2, imageUrl: 'https://assets/second.png', serverAssetId: 'asset-2' } },
      { id: 'other', position: { x: 0, y: 0 }, data: { isImageLayer: true, layerOperationNodeId: 'other-op', layerIndex: 0, imageUrl: 'https://assets/other.png' } },
      { id: 'empty', position: { x: 0, y: 0 }, data: { isImageLayer: true, layerOperationNodeId: 'op', layerIndex: 0, imageUrl: '' } },
      { id: 'first', position: { x: 0, y: 0 }, data: { isImageLayer: true, layerOperationNodeId: 'op', layerIndex: 1, imageUrl: 'https://assets/first.png' } },
    ]

    expect(collectRecomposableLayerAssets(nodes, 'op')).toEqual([
      { nodeId: 'first', url: 'https://assets/first.png', assetId: null },
      { nodeId: 'second', url: 'https://assets/second.png', assetId: 'asset-2' },
    ])
  })
})
