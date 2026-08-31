import { describe, it, expect } from 'vitest'
import {
  saveChapterSnapshot,
  getChapterSnapshotSync,
  type ChapterSnapshot,
} from './canvasSnapshotCache'

// 切章闪一帧旧内容的根因是「换图晚一拍」：IndexedDB 读取异步 + load() 跑在绘制后的
// useEffect 里。修复引入同步内存层，让切章的 useLayoutEffect 能在【绘制前】同步拿到目标章的图。
// 本测试守护该同步契约：saveChapterSnapshot 后无需 await，getChapterSnapshotSync 立即可读。
function mkSnap(chapterId: string, revision = 1): ChapterSnapshot {
  return {
    chapterId,
    revision,
    nodes: [{ id: `n-${chapterId}` }],
    edges: [],
    updatedAt: revision,
  }
}

describe('canvasSnapshotCache 同步内存层', () => {
  it('未缓存的章节同步读取返回 null', () => {
    expect(getChapterSnapshotSync('unseen-chapter')).toBeNull()
  })

  it('saveChapterSnapshot 后【无需 await】即可同步读回——闪帧修复的核心契约', () => {
    const snap = mkSnap('sync-ch-1', 7)
    // 故意不 await：内存写入必须是同步的（memTouch 在任何 IndexedDB 访问之前）。
    void saveChapterSnapshot(snap)
    const got = getChapterSnapshotSync('sync-ch-1')
    expect(got).not.toBeNull()
    expect(got?.revision).toBe(7)
    expect(got?.nodes).toEqual([{ id: 'n-sync-ch-1' }])
  })

  it('LRU：超出上限时淘汰最久未用的章节，最近保存的保留', () => {
    // MEM_MAX_ENTRIES = 40。写 45 个，最早的应被淘汰、最新的仍在。
    for (let i = 0; i < 45; i += 1) {
      void saveChapterSnapshot(mkSnap(`lru-${i}`, i))
    }
    // 最早写入的若干个应已被淘汰。
    expect(getChapterSnapshotSync('lru-0')).toBeNull()
    expect(getChapterSnapshotSync('lru-4')).toBeNull()
    // 最近写入的仍在。
    expect(getChapterSnapshotSync('lru-44')).not.toBeNull()
    expect(getChapterSnapshotSync('lru-44')?.revision).toBe(44)
  })

  it('重复保存同章刷新为最新 revision（不产生重复项）', () => {
    void saveChapterSnapshot(mkSnap('dup-ch', 1))
    void saveChapterSnapshot(mkSnap('dup-ch', 2))
    expect(getChapterSnapshotSync('dup-ch')?.revision).toBe(2)
  })
})
