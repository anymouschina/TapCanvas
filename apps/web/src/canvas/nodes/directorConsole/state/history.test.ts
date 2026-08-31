import { describe, it, expect } from 'vitest'
import {
  createHistory, pushHistory, undoHistory, redoHistory, snapshotOf,
  HISTORY_LIMIT, HISTORY_COALESCE_MS,
} from './history'
import type { DirectorScene } from '../types'

const sceneWith = (n: number): DirectorScene => ({
  characters: [{
    id: `c${n}`, name: `角色${n}`, modelId: 'male',
    position: [n, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], uniformScale: 1, colorHex: '#fff',
  }],
  cameras: [],
  aspect: 'auto',
})

describe('directorConsole history', () => {
  it('push 后 undo 回到变更前状态，redo 再回来', () => {
    let h = createHistory()
    const before = snapshotOf(sceneWith(1), 'c1')
    h = pushHistory(h, before, 1000)
    const current = snapshotOf(sceneWith(2), 'c2')

    const u = undoHistory(h, current, 2000)
    expect(u).not.toBeNull()
    expect(u!.snapshot.scene.characters[0].id).toBe('c1')
    expect(u!.snapshot.selectedObjectId).toBe('c1')
    expect(u!.history.undo).toHaveLength(0)
    expect(u!.history.redo).toHaveLength(1)

    const r = redoHistory(u!.history, u!.snapshot, 3000)
    expect(r).not.toBeNull()
    expect(r!.snapshot.scene.characters[0].id).toBe('c2')
    expect(r!.history.redo).toHaveLength(0)
    expect(r!.history.undo).toHaveLength(1)
  })

  it('空栈 undo/redo 返回 null', () => {
    const h = createHistory()
    const cur = snapshotOf(sceneWith(1))
    expect(undoHistory(h, cur, 0)).toBeNull()
    expect(redoHistory(h, cur, 0)).toBeNull()
  })

  it('时间窗内的连续变更合并成一条(拖拽 burst)', () => {
    let h = createHistory()
    // 模拟拖拽：每 50ms 一次 patch，快照分别是拖拽起点、中间态…
    h = pushHistory(h, snapshotOf(sceneWith(0)), 1000)
    h = pushHistory(h, snapshotOf(sceneWith(1)), 1050)
    h = pushHistory(h, snapshotOf(sceneWith(2)), 1100)
    expect(h.undo).toHaveLength(1)
    // undo 一步直接回到 burst 起点
    const u = undoHistory(h, snapshotOf(sceneWith(3)), 1200)
    expect(u!.snapshot.scene.characters[0].id).toBe('c0')
  })

  it('超过时间窗则各自成条', () => {
    let h = createHistory()
    h = pushHistory(h, snapshotOf(sceneWith(0)), 1000)
    h = pushHistory(h, snapshotOf(sceneWith(1)), 1000 + HISTORY_COALESCE_MS + 1)
    expect(h.undo).toHaveLength(2)
  })

  it('新变更清空 redo 栈', () => {
    let h = createHistory()
    h = pushHistory(h, snapshotOf(sceneWith(0)), 1000)
    const u = undoHistory(h, snapshotOf(sceneWith(1)), 2000)!
    expect(u.history.redo).toHaveLength(1)
    const afterNew = pushHistory(u.history, snapshotOf(sceneWith(5)), 3000)
    expect(afterNew.redo).toHaveLength(0)
  })

  it('undo 栈封顶不超过上限', () => {
    let h = createHistory()
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      h = pushHistory(h, snapshotOf(sceneWith(i)), i * (HISTORY_COALESCE_MS + 1))
    }
    expect(h.undo).toHaveLength(HISTORY_LIMIT)
    // 最老的被挤掉，栈底应是第 10 条
    expect(h.undo[0].snapshot.scene.characters[0].id).toBe('c10')
  })

  it('快照是深拷贝：改原 scene 不影响栈内条目', () => {
    let h = createHistory()
    const scene = sceneWith(1)
    h = pushHistory(h, snapshotOf(scene), 1000)
    scene.characters[0].position[0] = 999
    const u = undoHistory(h, snapshotOf(sceneWith(2)), 2000)!
    expect(u.snapshot.scene.characters[0].position[0]).toBe(1)
  })
})
