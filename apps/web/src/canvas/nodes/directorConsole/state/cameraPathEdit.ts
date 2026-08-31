// 相机路径编辑纯函数（镜像 motionEdit 的角色路径）。输入旧 CameraPath → 输出新，无 IO、可单测。
import type { CameraPath, Vec2, Vec3 } from '../types'

const EMPTY: CameraPath = { waypoints: [], mode: 'linear', height: 1.6 }

export function ensureCamPath(p: CameraPath | undefined | null): CameraPath {
  return p && Array.isArray(p.waypoints) ? p : EMPTY
}

export function addCamWaypoint(p: CameraPath | undefined | null, xz: Vec2): CameraPath {
  const base = ensureCamPath(p)
  return { ...base, waypoints: [...base.waypoints, [xz[0], xz[1]]] }
}

export function moveCamWaypoint(p: CameraPath | undefined | null, i: number, xz: Vec2): CameraPath {
  const base = ensureCamPath(p)
  if (i < 0 || i >= base.waypoints.length) return base
  const wps = base.waypoints.slice()
  wps[i] = [xz[0], xz[1]]
  return { ...base, waypoints: wps }
}

export function removeCamWaypoint(p: CameraPath | undefined | null, i: number): CameraPath {
  const base = ensureCamPath(p)
  return { ...base, waypoints: base.waypoints.filter((_, idx) => idx !== i) }
}

export function setCamPathMode(p: CameraPath | undefined | null, mode: 'linear' | 'curve'): CameraPath {
  return { ...ensureCamPath(p), mode }
}

export function setCamPathHeight(p: CameraPath | undefined | null, height: number): CameraPath {
  return { ...ensureCamPath(p), height: Math.max(0, height) }
}

export function setCamPathLookAt(
  p: CameraPath | undefined | null,
  lookAt: { characterId?: string; point?: Vec3 },
): CameraPath {
  const base = ensureCamPath(p)
  return {
    ...base,
    lookAtCharacterId: lookAt.characterId,
    lookAt: lookAt.point,
  }
}

/** 清空路径（返回空 waypoints，保留 mode/height 设置）。 */
export function clearCamPath(p: CameraPath | undefined | null): CameraPath {
  return { ...ensureCamPath(p), waypoints: [] }
}
