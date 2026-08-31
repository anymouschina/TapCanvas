// 导演台动作库的用户级持久化（自定义预设 + 收藏），落 localStorage。
// 自定义预设 = 用户在某角色上保存的当前 pose map；收藏 = 预设 id 集合（含内置与自定义）。
import type { PosePreset, PoseMap } from './pose'

const CUSTOM_KEY = 'tc:director:customPoses'
const FAV_KEY = 'tc:director:favPoses'

export type CustomPosePreset = PosePreset & { custom: true; createdAt: number }

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const v = JSON.parse(raw)
    return v ?? fallback
  } catch {
    return fallback
  }
}
function writeJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 配额/隐私模式：静默降级，不阻塞 UI */ }
}

export function loadCustomPoses(): CustomPosePreset[] {
  const list = readJSON<CustomPosePreset[]>(CUSTOM_KEY, [])
  return Array.isArray(list) ? list.filter((p) => p && p.id && p.pose) : []
}

/** 保存一条自定义预设；返回更新后的全量列表。id 以 custom- 前缀避免与内置撞车。 */
export function saveCustomPose(name: string, pose: PoseMap): CustomPosePreset[] {
  const trimmed = name.trim() || '自定义动作'
  const preset: CustomPosePreset = {
    id: `custom-${Date.now()}-${Math.floor(performance.now())}`,
    name: trimmed,
    category: '自定义',
    pose: { ...pose },
    custom: true,
    createdAt: Date.now(),
  }
  const next = [...loadCustomPoses(), preset]
  writeJSON(CUSTOM_KEY, next)
  return next
}

export function deleteCustomPose(id: string): CustomPosePreset[] {
  const next = loadCustomPoses().filter((p) => p.id !== id)
  writeJSON(CUSTOM_KEY, next)
  // 顺带从收藏里摘掉
  const favs = loadFavorites()
  if (favs.includes(id)) saveFavorites(favs.filter((f) => f !== id))
  return next
}

export function loadFavorites(): string[] {
  const list = readJSON<string[]>(FAV_KEY, [])
  return Array.isArray(list) ? list.filter((s) => typeof s === 'string') : []
}
function saveFavorites(ids: string[]): void { writeJSON(FAV_KEY, ids) }

export function toggleFavorite(id: string): string[] {
  const favs = loadFavorites()
  const next = favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id]
  saveFavorites(next)
  return next
}
