import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'

vi.mock('../projects/chapterCanvasFlow', () => ({
  getChapterCanvasFlow: vi.fn(),
}))

import { getChapterCanvasFlow } from '../projects/chapterCanvasFlow'
import { useRFStore } from './store'
import { findImportedChapterIds, loadChaptersAsGroups, type ChapterLike } from './chapterGroupImport'

const mockGetFlow = vi.mocked(getChapterCanvasFlow)

function chapterLike(id: string, index: number, title: string): ChapterLike {
  return { id, index, title, sortOrder: index, createdAt: `2026-06-0${index + 1}T00:00:00Z` }
}

function taskNode(id: string, x: number, y: number, extra?: Record<string, unknown>) {
  return {
    id,
    type: 'taskNode',
    position: { x, y },
    data: { kind: 'text', label: id, ...(extra || {}) },
  }
}

function flowResponse(chapterId: string, nodes: unknown[], edges: unknown[] = []) {
  return { chapterId, revision: 1, flow: { nodes, edges } } as any
}

function rectOf(node: Node): { x: number; y: number; w: number; h: number } {
  const style = (node.style || {}) as any
  return {
    x: node.position.x,
    y: node.position.y,
    w: Number(style.width || 0),
    h: Number(style.height || 0),
  }
}

function overlaps(a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

describe('loadChaptersAsGroups', () => {
  beforeEach(() => {
    useRFStore.setState({ nodes: [], edges: [] })
    mockGetFlow.mockReset()
  })

  it('每个章节打成一个组，组之间紧凑排列不重叠', async () => {
    // 三个章节的节点坐标全部从 (0,0) 开始 —— 模拟叠在一起的源数据
    mockGetFlow.mockImplementation(async (chapterId: string) =>
      flowResponse(chapterId, [
        taskNode('n1', 0, 0),
        taskNode('n2', 400, 0),
      ], [{ id: 'e1', source: 'n1', target: 'n2' }]),
    )

    const summary = await loadChaptersAsGroups([
      chapterLike('aaaa1111-0000-0000-0000-000000000001', 0, '第一章'),
      chapterLike('bbbb2222-0000-0000-0000-000000000002', 1, '第二章'),
      chapterLike('cccc3333-0000-0000-0000-000000000003', 2, '第三章'),
    ])
    expect(summary).toMatchObject({ imported: 3, skippedExisting: 0, skippedEmpty: 0, failed: 0 })

    const { nodes, edges } = useRFStore.getState()
    const groups = nodes.filter((n) => n.type === 'groupNode')
    expect(groups).toHaveLength(3)
    expect(findImportedChapterIds(nodes).size).toBe(3)

    // 组与组互不重叠
    const rects = groups.map(rectOf)
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(overlaps(rects[i], rects[j])).toBe(false)
      }
    }

    // 每个组下挂 2 个子节点，且子节点 id 全局唯一
    for (const group of groups) {
      const children = nodes.filter((n) => (n as any).parentId === group.id)
      expect(children).toHaveLength(2)
    }
    const ids = nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)

    // 章节内部边被保留且端点已重映射
    expect(edges).toHaveLength(3)
    for (const edge of edges) {
      expect(ids).toContain(edge.source)
      expect(ids).toContain(edge.target)
    }
  })

  it('重复执行幂等：已装载章节跳过，不产生重复组', async () => {
    const chapter = chapterLike('aaaa1111-0000-0000-0000-000000000001', 0, '第一章')
    mockGetFlow.mockImplementation(async (chapterId: string) =>
      flowResponse(chapterId, [taskNode('n1', 0, 0)]),
    )

    const first = await loadChaptersAsGroups([chapter])
    expect(first.imported).toBe(1)
    const second = await loadChaptersAsGroups([chapter])
    expect(second).toMatchObject({ imported: 0, skippedExisting: 1 })
    expect(useRFStore.getState().nodes.filter((n) => n.type === 'groupNode')).toHaveLength(1)
    expect(mockGetFlow).toHaveBeenCalledTimes(1)
  })

  it('章节组被解组后再次载入仍跳过（子节点带来源标记）', async () => {
    const chapter = chapterLike('aaaa1111-0000-0000-0000-000000000001', 0, '第一章')
    mockGetFlow.mockImplementation(async (chapterId: string) =>
      flowResponse(chapterId, [taskNode('n1', 0, 0)]),
    )

    await loadChaptersAsGroups([chapter])
    // 模拟解组：删掉组节点，子节点提升为根级
    useRFStore.setState((s) => ({
      nodes: s.nodes
        .filter((n) => n.type !== 'groupNode')
        .map((n) => {
          const { parentId: _pid, ...rest } = n as any
          return rest
        }),
    }))

    const second = await loadChaptersAsGroups([chapter])
    expect(second).toMatchObject({ imported: 0, skippedExisting: 1 })
    expect(useRFStore.getState().nodes.filter((n) => n.type === 'groupNode')).toHaveLength(0)
  })

  it('空章节跳过、单章失败不拖垮整体', async () => {
    mockGetFlow.mockImplementation(async (chapterId: string) => {
      if (chapterId.startsWith('aaaa')) return flowResponse(chapterId, [taskNode('n1', 0, 0)])
      if (chapterId.startsWith('bbbb')) return flowResponse(chapterId, [])
      throw new Error('boom')
    })

    const summary = await loadChaptersAsGroups([
      chapterLike('aaaa1111-0000-0000-0000-000000000001', 0, '有内容'),
      chapterLike('bbbb2222-0000-0000-0000-000000000002', 1, '空章节'),
      chapterLike('cccc3333-0000-0000-0000-000000000003', 2, '加载失败'),
    ])
    expect(summary).toMatchObject({ imported: 1, skippedEmpty: 1, failed: 1 })
    expect(useRFStore.getState().nodes.filter((n) => n.type === 'groupNode')).toHaveLength(1)
  })

  it('逐章装载：新组排在既有内容下方，且章节种子卡解锁', async () => {
    useRFStore.setState({
      nodes: [taskNode('existing-1', 100, 100) as any],
      edges: [],
    })
    const chapterId = 'aaaa1111-0000-0000-0000-000000000001'
    mockGetFlow.mockResolvedValue(
      flowResponse(chapterId, [
        taskNode(`chapter-seed-${chapterId}`, 0, 0, { locked: true, readOnly: true }),
        taskNode('n1', 420, 0),
      ]),
    )

    await loadChaptersAsGroups([chapterLike(chapterId, 0, '第一章')])
    const { nodes } = useRFStore.getState()
    const group = nodes.find((n) => n.type === 'groupNode')!
    const existing = nodes.find((n) => n.id === 'existing-1')!
    expect(group.position.y).toBeGreaterThan(existing.position.y)

    const seed = nodes.find((n) => String(n.id).includes('chapter-seed-'))!
    expect((seed.data as any).locked).toBe(false)
    expect((seed.data as any).readOnly).toBe(true)
    expect((seed.data as any).importedFromChapterId).toBe(chapterId)
    expect((seed as any).parentId).toBe(group.id)
  })
})
