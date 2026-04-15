import { describe, expect, it } from 'vitest'

import {
  buildSelectedImageAssetInputs,
  resolveChatRequestExecution,
} from '../../src/ui/chat/chatRequestPayload'

describe('chat request payload helpers', () => {
  it('keeps selected image assets as reference inputs for generic chat turns', () => {
    expect(
      buildSelectedImageAssetInputs(
        [
          { assetId: 'asset-1', url: 'https://example.com/a.png' },
          { assetId: 'asset-2', url: 'https://example.com/b.png' },
        ],
      ),
    ).toEqual([
      {
        assetId: 'asset-1',
        url: 'https://example.com/a.png',
        role: 'reference',
      },
      {
        assetId: 'asset-2',
        url: 'https://example.com/b.png',
        role: 'reference',
      },
    ])
  })

  it('deduplicates selected image assets by reference url', () => {
    expect(
      buildSelectedImageAssetInputs(
        [
          { assetId: 'asset-1', url: 'https://example.com/a.png' },
          { assetId: 'asset-2', url: 'https://example.com/a.png' },
        ],
      ),
    ).toEqual([
      {
        assetId: 'asset-1',
        url: 'https://example.com/a.png',
        role: 'reference',
      },
    ])
  })

  it('always uses auto mode and leaves execution delivery to agents', () => {
    expect(resolveChatRequestExecution()).toEqual({
      mode: 'auto',
      forceAssetGeneration: false,
    })
  })
})
