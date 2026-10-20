import { describe, expect, it } from 'vitest'
import { resolveImageCompareInputs, resolveImageCompareSelection } from './imageCompareSelection'

const imageNode = (id: string, x: number, data: Record<string, unknown>) => ({
  id,
  position: { x, y: 0 },
  data: { kind: 'image', label: id, ...data },
})

describe('resolveImageCompareSelection', () => {
  it('orders the pair left-to-right and picks the primary image', () => {
    const resolution = resolveImageCompareSelection([
      imageNode('right', 400, { imageUrl: 'https://a.example/r.png' }),
      imageNode('left', 0, {
        imageResults: [{ url: 'https://a.example/l0.png' }, { url: 'https://a.example/l1.png' }],
        imagePrimaryIndex: 1,
      }),
    ])
    expect(resolution).toEqual({
      kind: 'ready',
      before: { nodeId: 'left', label: 'left', url: 'https://a.example/l1.png' },
      after: { nodeId: 'right', label: 'right', url: 'https://a.example/r.png' },
    })
  })

  it('reports nodes without images', () => {
    const resolution = resolveImageCompareSelection([
      imageNode('a', 0, { imageUrl: 'https://a.example/a.png' }),
      imageNode('b', 400, {}),
    ])
    expect(resolution).toEqual({ kind: 'missing-assets', nodeIds: ['b'] })
  })

  it('ignores non-image pairs', () => {
    expect(resolveImageCompareSelection([
      imageNode('a', 0, { imageUrl: 'x' }),
      { id: 'v', position: { x: 1, y: 0 }, data: { kind: 'video' } },
    ])).toEqual({ kind: 'not-image-pair' })
  })
})

describe('resolveImageCompareInputs', () => {
  it('orders upstream images by canvas position and skips nodes still without an image', () => {
    expect(resolveImageCompareInputs([
      imageNode('c', 800, { imageUrl: 'https://a.example/c.png' }),
      imageNode('pending', 400, {}),
      imageNode('a', 0, { imageUrl: 'https://a.example/a.png' }),
    ])).toEqual([
      { nodeId: 'a', label: 'a', url: 'https://a.example/a.png' },
      { nodeId: 'c', label: 'c', url: 'https://a.example/c.png' },
    ])
  })
})
