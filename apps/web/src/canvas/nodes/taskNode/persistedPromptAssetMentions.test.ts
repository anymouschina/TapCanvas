import { describe, expect, it } from 'vitest'
import { buildPersistedPromptAssetMentionRefs } from './persistedPromptAssetMentions'

describe('buildPersistedPromptAssetMentionRefs', () => {
  it('reconstructs an asset mention from persisted node assetInputs', () => {
    expect(buildPersistedPromptAssetMentionRefs('image-node-1', [{
      url: 'https://assets.example.com/reference.png',
      assetId: 'asset-1',
      assetRefId: 'image',
      name: '参考图',
      role: 'style',
    }])).toEqual([{
      nodeId: 'persisted-asset-input:image-node-1:image',
      username: 'image',
      displayName: '参考图',
      rawLabel: '参考图',
      source: 'asset',
      assetUrl: 'https://assets.example.com/reference.png',
      assetId: 'asset-1',
      assetRefId: 'image',
      assetName: '参考图',
      assetRole: 'style',
      isConnected: true,
    }])
  })

  it('rejects incomplete bindings instead of inventing a mention', () => {
    expect(buildPersistedPromptAssetMentionRefs('image-node-1', [
      { assetRefId: 'missing-url' },
      { url: 'https://assets.example.com/missing-id.png' },
    ])).toEqual([])
  })
})
