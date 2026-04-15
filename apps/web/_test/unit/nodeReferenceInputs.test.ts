import { describe, expect, it } from 'vitest'
import {
  collectNodeReferenceImageUrls,
  readNodeFirstFrameUrl,
  readNodeLastFrameUrl,
} from '../../src/runner/nodeReferenceInputs'

describe('nodeReferenceInputs', () => {
  it('collects executable reference urls from referenceImages, anchorBindings, roleCardReferenceImages, and assetInputs', () => {
    expect(
      collectNodeReferenceImageUrls({
        referenceImages: [
          'https://example.com/ref-a.png',
          'https://example.com/ref-a.png',
          'not-a-url',
        ],
        anchorBindings: [
          {
            kind: 'character',
            label: '方源',
            imageUrl: 'https://example.com/ref-d.png',
          },
        ],
        roleCardReferenceImages: [
          'https://example.com/ref-c.png',
          'https://example.com/ref-c.png',
        ],
        assetInputs: [
          { url: 'https://example.com/ref-b.png', role: 'reference' },
          { url: 'https://example.com/ref-a.png', role: 'character' },
          { url: '' },
        ],
      }),
    ).toEqual([
      'https://example.com/ref-a.png',
      'https://example.com/ref-d.png',
      'https://example.com/ref-c.png',
      'https://example.com/ref-b.png',
    ])
  })

  it('reads generic and vendor-specific frame urls', () => {
    expect(
      readNodeFirstFrameUrl({
        firstFrameUrl: 'https://example.com/first.png',
        veoFirstFrameUrl: 'https://example.com/ignored.png',
      }),
    ).toBe('https://example.com/first.png')

    expect(
      readNodeLastFrameUrl({
        veoLastFrameUrl: 'https://example.com/last.png',
      }),
    ).toBe('https://example.com/last.png')
  })
})
