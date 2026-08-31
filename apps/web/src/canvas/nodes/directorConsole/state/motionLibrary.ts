// 自定义动作（PoseClip）的用户级持久化，落 localStorage（仿 poseLibrary 套路）。
import type { PoseClip } from './poseClip'

const KEY = 'tc:director:customMotions'

function readJSON<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback } catch { return fallback }
}
function writeJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 配额/隐私模式：静默降级 */ }
}

export type CustomMotion = PoseClip & { custom: true; createdAt: number }

export function loadCustomMotions(): CustomMotion[] {
  const list = readJSON<CustomMotion[]>(KEY, [])
  return Array.isArray(list) ? list : []
}
export function saveCustomMotion(clip: PoseClip): CustomMotion[] {
  const rest = loadCustomMotions().filter((m) => m.id !== clip.id)
  const next = [...rest, { ...clip, custom: true as const, createdAt: Date.now() }]
  writeJSON(KEY, next)
  return next
}
export function deleteCustomMotion(id: string): CustomMotion[] {
  const next = loadCustomMotions().filter((m) => m.id !== id)
  writeJSON(KEY, next)
  return next
}
export function findCustomMotion(id: string): CustomMotion | undefined {
  return loadCustomMotions().find((m) => m.id === id)
}
