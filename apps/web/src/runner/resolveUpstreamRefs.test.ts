// resolveUpstreamRefs.test.ts
import { describe, it, expect } from 'vitest'
import { resolveUpstreamRefs } from './resolveUpstreamRefs'
import { buildVideoUpstreamRefPatch } from './dag'

const img = (id: string, url?: string) => ({ id, data: { kind: 'image', imageUrl: url } })
const vid = (id: string, url?: string, taskId?: string, durationSeconds?: number) => ({
  id,
  data: { kind: 'video', videoUrl: url, ...(taskId ? { taskId } : {}), ...(durationSeconds ? { videoDurationSeconds: durationSeconds } : {}) },
})

describe('resolveUpstreamRefs', () => {
  it('解析首帧(从 firstFrameFromNodeId 的 imageUrl)', () => {
    const node = { id: 'v0', data: { kind: 'video', firstFrameFromNodeId: 'sb0' } }
    const r = resolveUpstreamRefs(node as any, [img('sb0', 'https://x/a.png')] as any)
    expect(r.firstFrameUrl).toBe('https://x/a.png')
    expect(r.sourceVideoUrl).toBeUndefined()
  })
  it('解析续写源(从 sourcePrevVideoNodeId 的 videoUrl)', () => {
    const node = { id: 'v1', data: { kind: 'video', firstFrameFromNodeId: 'sb1', sourcePrevVideoNodeId: 'v0' } }
    const r = resolveUpstreamRefs(node as any, [img('sb1', 'https://x/b.png'), vid('v0', 'https://x/v0.mp4')] as any)
    expect(r.firstFrameUrl).toBe('https://x/b.png')
    expect(r.sourceVideoUrl).toBe('https://x/v0.mp4')
  })
  it('i=0 无续写源', () => {
    const node = { id: 'v0', data: { kind: 'video', firstFrameFromNodeId: 'sb0' } }
    const r = resolveUpstreamRefs(node as any, [img('sb0', 'https://x/a.png')] as any)
    expect(r.sourceVideoUrl).toBeUndefined()
  })
  it('上游缺 URL → 字段 undefined，不抛', () => {
    const node = { id: 'v0', data: { kind: 'video', firstFrameFromNodeId: 'missing' } }
    expect(() => resolveUpstreamRefs(node as any, [] as any)).not.toThrow()
  })
})

describe('buildVideoUpstreamRefPatch', () => {
  it('无引用字段 → 返回 null', () => {
    const node = { id: 'v0', data: { kind: 'video' } }
    expect(buildVideoUpstreamRefPatch(node, [])).toBeNull()
  })

  it('firstFrameFromNodeId → patch.firstFrameUrl', () => {
    const node = { id: 'v0', data: { kind: 'video', firstFrameFromNodeId: 'sb0' } }
    const patch = buildVideoUpstreamRefPatch(node, [img('sb0', 'https://r2.example.com/a.png')])
    expect(patch?.firstFrameUrl).toBe('https://r2.example.com/a.png')
    expect(patch?.sourceVideoUrl).toBeUndefined()
    expect(patch?.sourcePrevTaskId).toBeUndefined()
  })

  it('sourcePrevVideoNodeId → patch.sourceVideoUrl + patch.sourcePrevTaskId', () => {
    const node = {
      id: 'v1',
      data: { kind: 'video', firstFrameFromNodeId: 'sb0', sourcePrevVideoNodeId: 'v0' },
    }
    const nodes = [
      img('sb0', 'https://r2.example.com/b.png'),
      vid('v0', 'https://r2.example.com/v0.mp4', 'task-abc-123', 7),
    ]
    const patch = buildVideoUpstreamRefPatch(node, nodes)
    expect(patch?.firstFrameUrl).toBe('https://r2.example.com/b.png')
    expect(patch?.sourceVideoUrl).toBe('https://r2.example.com/v0.mp4')
    expect(patch?.sourcePrevTaskId).toBe('task-abc-123')
    expect(patch?.referenceVideoDurationSeconds).toBe(7)
  })

  it('data 中已显式设置的字段不被覆盖', () => {
    const node = {
      id: 'v0',
      data: {
        kind: 'video',
        firstFrameFromNodeId: 'sb0',
        firstFrameUrl: 'https://r2.example.com/existing.png',
      },
    }
    const patch = buildVideoUpstreamRefPatch(node, [img('sb0', 'https://r2.example.com/new.png')])
    // firstFrameUrl 已存在，不应出现在 patch 里
    expect(patch?.firstFrameUrl).toBeUndefined()
  })

  it('上游节点不存在 → 返回 null（无可注入字段）', () => {
    const node = { id: 'v0', data: { kind: 'video', firstFrameFromNodeId: 'missing' } }
    expect(buildVideoUpstreamRefPatch(node, [])).toBeNull()
  })
})
