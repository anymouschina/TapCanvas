import { describe, expect, it } from 'vitest'
import { readImageLayerAssets } from './imageLayerDecomposition'

describe('readImageLayerAssets', () => {
  it('keeps every hosted image layer and its server identity', () => {
    expect(readImageLayerAssets({
      id: 'layer-task',
      kind: 'image_edit',
      status: 'succeeded',
      assets: [
        { type: 'image', url: ' https://oss.example/layer-1.png ', assetId: 'asset-1' },
        { type: 'video', url: 'https://oss.example/not-a-layer.mp4' },
        { type: 'image', url: 'https://oss.example/layer-2.png', assetRefId: 'ref-2' },
      ],
      raw: {},
    })).toEqual([
      {
        url: 'https://oss.example/layer-1.png',
        assetId: 'asset-1',
        assetRefId: null,
        assetName: null,
      },
      {
        url: 'https://oss.example/layer-2.png',
        assetId: null,
        assetRefId: 'ref-2',
        assetName: null,
      },
    ])
  })
})
