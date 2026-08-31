// 导演台复制/粘贴（对象级剪贴板，非系统剪贴板）。
// 复制选中的角色或机位；粘贴时深拷贝换新 id、按粘贴次数递增偏移落位并选中。
// 角色剥离 crowdId/crowdLabel（粘贴不扩编群组）；机位路径 waypoints 随位移一起平移。
import type { DirectorConsoleData, CharacterObj, CameraObj, Vec3 } from '../types'

export const PASTE_OFFSET_M = 0.6

export type DirectorClipboard =
  | { kind: 'character'; character: CharacterObj }
  | { kind: 'camera'; camera: CameraObj }

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const r3 = (v: number) => Math.round(v * 1000) / 1000

/** 复制当前选中对象；未选中/找不到时返回 null。 */
export function copySelection(d: DirectorConsoleData): DirectorClipboard | null {
  const id = d.selectedObjectId
  if (!id || !d.scene) return null
  const ch = d.scene.characters.find((c) => c.id === id)
  if (ch) return { kind: 'character', character: clone(ch) }
  const cam = d.scene.cameras.find((c) => c.id === id)
  if (cam) return { kind: 'camera', camera: clone(cam) }
  return null
}

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const name = `${base}${i}`
    if (!taken.has(name)) return name
  }
}

function offsetPos(p: Vec3, d: number): Vec3 {
  return [r3(p[0] + d), p[1], r3(p[2] + d)]
}

/** 粘贴剪贴板对象。pasteCount 从 1 起：第 n 次粘贴偏移 n*0.6m，避免叠在原件上。 */
export function pasteClipboard(
  d: DirectorConsoleData,
  clip: DirectorClipboard,
  newId: string,
  pasteCount: number,
): DirectorConsoleData {
  const offset = PASTE_OFFSET_M * Math.max(1, pasteCount)
  if (clip.kind === 'character') {
    const src = clone(clip.character)
    delete src.crowdId
    delete src.crowdLabel
    const taken = new Set(d.scene.characters.map((c) => c.name))
    const ch: CharacterObj = {
      ...src,
      id: newId,
      name: uniqueName(`${src.name}副本`, taken),
      position: offsetPos(src.position, offset),
      locked: false,
    }
    return {
      ...d,
      scene: { ...d.scene, characters: [...d.scene.characters, ch] },
      selectedObjectId: newId,
    }
  }
  const src = clone(clip.camera)
  const taken = new Set(d.scene.cameras.map((c) => c.name))
  const cam: CameraObj = {
    ...src,
    id: newId,
    name: uniqueName(`${src.name}副本`, taken),
    position: offsetPos(src.position, offset),
    lookAt: offsetPos(src.lookAt, offset),
    locked: false,
    ...(src.path
      ? { path: { ...src.path, waypoints: src.path.waypoints.map(([x, z]) => [r3(x + offset), r3(z + offset)] as [number, number]) } }
      : {}),
  }
  return {
    ...d,
    scene: { ...d.scene, cameras: [...d.scene.cameras, cam], activeCameraId: newId },
    selectedObjectId: newId,
  }
}
