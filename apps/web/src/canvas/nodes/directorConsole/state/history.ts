// 导演台撤销/重做（吸收 storyai-3d-director-desk 的 undo 栈设计，补上 redo）。
// 快照 = scene + selectedObjectId 的深拷贝；仅 scene 变更才入栈（纯选中/视角切换不记）。
// 连续高频变更（gizmo 拖拽、方向键连按）按时间窗合并成一条：窗内只保留 burst 起点前的状态。
import type { DirectorScene } from '../types'

export type HistorySnapshot = {
  scene: DirectorScene
  selectedObjectId?: string
}

type HistoryEntry = {
  snapshot: HistorySnapshot
  /** 该条目最后一次吸收变更的时刻(ms)，用于时间窗合并 */
  at: number
}

export type SceneHistory = {
  undo: HistoryEntry[]
  redo: HistoryEntry[]
}

export const HISTORY_LIMIT = 80
/** 两次变更间隔小于该值(ms)视为同一次连续操作，合并进栈顶条目 */
export const HISTORY_COALESCE_MS = 500

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export function createHistory(): SceneHistory {
  return { undo: [], redo: [] }
}

export function snapshotOf(scene: DirectorScene, selectedObjectId?: string): HistorySnapshot {
  return clone({ scene, selectedObjectId })
}

/** 变更落盘前调用：before 为变更前状态。返回新 history（redo 被清空）。 */
export function pushHistory(h: SceneHistory, before: HistorySnapshot, now: number): SceneHistory {
  const top = h.undo[h.undo.length - 1]
  if (top && now - top.at < HISTORY_COALESCE_MS) {
    // 同一 burst：保留 burst 起点快照，只推进时间戳，redo 照样失效
    const undo = [...h.undo.slice(0, -1), { snapshot: top.snapshot, at: now }]
    return { undo, redo: [] }
  }
  const undo = [...h.undo, { snapshot: clone(before), at: now }]
  if (undo.length > HISTORY_LIMIT) undo.shift()
  return { undo, redo: [] }
}

export type HistoryStep = { history: SceneHistory; snapshot: HistorySnapshot }

/** 撤销：弹出 undo 栈顶，当前状态压入 redo。无可撤销时返回 null。 */
export function undoHistory(h: SceneHistory, current: HistorySnapshot, now: number): HistoryStep | null {
  const top = h.undo[h.undo.length - 1]
  if (!top) return null
  return {
    history: {
      undo: h.undo.slice(0, -1),
      redo: [...h.redo, { snapshot: clone(current), at: now }],
    },
    snapshot: clone(top.snapshot),
  }
}

/** 重做：弹出 redo 栈顶，当前状态压回 undo（不合并）。无可重做时返回 null。 */
export function redoHistory(h: SceneHistory, current: HistorySnapshot, now: number): HistoryStep | null {
  const top = h.redo[h.redo.length - 1]
  if (!top) return null
  return {
    history: {
      undo: [...h.undo, { snapshot: clone(current), at: now }],
      redo: h.redo.slice(0, -1),
    },
    snapshot: clone(top.snapshot),
  }
}
