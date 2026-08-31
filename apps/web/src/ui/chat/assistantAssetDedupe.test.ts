import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import { collectCanvasMediaUrlKeys, isMediaUrlOnCanvas } from './assistantAssetDedupe'

function node(id: string, data: Record<string, unknown>): Node {
  return { id, type: 'taskNode', position: { x: 0, y: 0 }, data } as Node
}

describe('assistantAssetDedupe', () => {
  it('画布节点 imageUrl 完全相同 → 判定已存在', () => {
    const keys = collectCanvasMediaUrlKeys([
      node('a', { kind: 'image', imageUrl: 'https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/assets/char-1.png' }),
    ])
    expect(isMediaUrlOnCanvas('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/assets/char-1.png', keys)).toBe(true)
  })

  it('仅 hash 不同 → 仍判定已存在', () => {
    const keys = collectCanvasMediaUrlKeys([
      node('a', { kind: 'image', imageUrl: 'https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/assets/char-1.png#frag' }),
    ])
    expect(isMediaUrlOnCanvas('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/assets/char-1.png', keys)).toBe(true)
  })

  it('仅 query 不同（签名/缓存参数）→ 按 origin+pathname 判定已存在', () => {
    const keys = collectCanvasMediaUrlKeys([
      node('a', { kind: 'image', imageUrl: 'https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/assets/char-1.png?sig=abc' }),
    ])
    expect(isMediaUrlOnCanvas('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/assets/char-1.png?sig=def', keys)).toBe(true)
  })

  it('不同对象路径 → 判定为新图', () => {
    const keys = collectCanvasMediaUrlKeys([
      node('a', { kind: 'image', imageUrl: 'https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/assets/char-1.png' }),
    ])
    expect(isMediaUrlOnCanvas('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/assets/char-2.png', keys)).toBe(false)
  })

  it('覆盖 videoUrl / videoResults / imageResults / assets / outputs 等字段', () => {
    const keys = collectCanvasMediaUrlKeys([
      node('v', {
        kind: 'video',
        videoUrl: 'https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/videos/clip-1.mp4',
        videoResults: [{ url: 'https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/videos/clip-1.mp4', thumbnailUrl: 'https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/videos/clip-1-thumb.jpg' }],
      }),
      node('i', {
        kind: 'image',
        imageResults: [{ url: 'https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/assets/gen-1.png' }],
        assets: [{ url: 'https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/assets/gen-2.png' }],
        outputs: [{ url: 'https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/assets/gen-3.png' }],
      }),
    ])
    expect(isMediaUrlOnCanvas('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/videos/clip-1.mp4', keys)).toBe(true)
    expect(isMediaUrlOnCanvas('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/videos/clip-1-thumb.jpg', keys)).toBe(true)
    expect(isMediaUrlOnCanvas('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/assets/gen-1.png', keys)).toBe(true)
    expect(isMediaUrlOnCanvas('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/assets/gen-2.png', keys)).toBe(true)
    expect(isMediaUrlOnCanvas('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/assets/gen-3.png', keys)).toBe(true)
  })

  it('非 http(s) 值与空值一律忽略', () => {
    const keys = collectCanvasMediaUrlKeys([
      node('a', { kind: 'image', imageUrl: 'asset://local-1' }),
      node('b', { kind: 'image', imageUrl: '' }),
      node('c', { kind: 'image' }),
    ])
    expect(keys.size).toBe(0)
    expect(isMediaUrlOnCanvas('', keys)).toBe(false)
    expect(isMediaUrlOnCanvas('asset://local-1', keys)).toBe(false)
  })
})
