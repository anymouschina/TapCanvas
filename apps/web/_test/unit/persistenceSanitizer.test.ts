import { describe, expect, it } from 'vitest'

import { sanitizeFlowValueForPersistence } from '../../src/canvas/utils/persistenceSanitizer'

describe('sanitizeFlowValueForPersistence', () => {
  it('removes node logs and lastResult.preview while keeping other result fields', () => {
    const input = {
      nodes: [
        {
          id: 'n1',
          data: {
            label: 'node',
            logs: ['a', 'b'],
            lastResult: {
              id: 'result-1',
              kind: 'image',
              at: 123,
              preview: {
                type: 'image',
                src: 'https://example.com/preview.png',
              },
            },
          },
        },
      ],
      edges: [],
    }

    const output = sanitizeFlowValueForPersistence(input)

    expect(output).toEqual({
      nodes: [
        {
          id: 'n1',
          data: {
            label: 'node',
            lastResult: {
              id: 'result-1',
              kind: 'image',
              at: 123,
            },
          },
        },
      ],
      edges: [],
    })
  })

  it('removes base64 and blob urls when binary stripping is enabled', () => {
    const input = {
      imageUrl: 'data:image/png;base64,abc',
      blobUrl: 'blob:https://example.com/123',
      plainUrl: 'https://example.com/image.png',
    }

    const output = sanitizeFlowValueForPersistence(input, { stripBinaryUrls: true })

    expect(output).toEqual({
      plainUrl: 'https://example.com/image.png',
    })
  })
})
