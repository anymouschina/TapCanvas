import { describe, expect, it } from 'vitest'
import { mergeReferenceAssetInputs } from '../../src/runner/assetReference'

describe('assetReference runtime inputs', () => {
  it('builds dynamic reference aliases from upstream metadata when node data has no explicit assetInputs', () => {
    expect(
      mergeReferenceAssetInputs({
        referenceImages: ['https://example.com/upstream.png'],
        dynamicEntries: [
          {
            url: 'https://example.com/upstream.png',
            label: '上一张主图',
            name: '上一张主图',
          },
        ],
      }),
    ).toEqual([
      {
        url: 'https://example.com/upstream.png',
        assetId: null,
        assetRefId: '上一张主图',
        role: 'reference',
        note: null,
        name: '上一张主图',
      },
    ])
  })

  it('preserves explicit assetInputs ahead of dynamic aliases for the same reference url', () => {
    expect(
      mergeReferenceAssetInputs({
        referenceImages: ['https://example.com/upstream.png'],
        assetInputs: [
          {
            url: 'https://example.com/upstream.png',
            assetRefId: 'locked_alias',
            name: '锁定别名',
          },
        ],
        dynamicEntries: [
          {
            url: 'https://example.com/upstream.png',
            label: '上一张主图',
            name: '上一张主图',
          },
        ],
      }),
    ).toEqual([
      {
        url: 'https://example.com/upstream.png',
        assetId: null,
        assetRefId: 'locked_alias',
        role: 'reference',
        note: null,
        name: '锁定别名',
      },
    ])
  })
})
