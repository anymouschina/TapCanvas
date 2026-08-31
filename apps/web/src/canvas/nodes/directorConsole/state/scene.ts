import type { DirectorConsoleData, CharacterObj, CameraObj, AspectKey, Vec3 } from '../types'
import { getLibraryItem } from '../assets'

const ALPHA = (i: number) => String.fromCharCode(65 + i) // 0 -> A

const clone = (d: DirectorConsoleData): DirectorConsoleData => ({
  ...d,
  scene: { ...d.scene, characters: [...d.scene.characters], cameras: [...d.scene.cameras] },
})

export function addCharacter(
  d: DirectorConsoleData,
  init: { id: string; modelId: string; name?: string; position?: Vec3 },
): DirectorConsoleData {
  const next = clone(d)
  const idx = next.scene.characters.length
  const item = getLibraryItem(init.modelId)
  // 道具按库名计数命名（桌子、桌子2…），角色按字母序且不被道具占位
  let name = init.name
  if (!name) {
    if (item?.kind === 'prop') {
      const same = next.scene.characters.filter((c) => c.modelId === init.modelId).length
      name = same > 0 ? `${item.name}${same + 1}` : item.name
    } else {
      const bodyCount = next.scene.characters.filter((c) => getLibraryItem(c.modelId)?.kind !== 'prop').length
      name = `角色${ALPHA(bodyCount)}`
    }
  }
  const ch: CharacterObj = {
    id: init.id,
    name,
    modelId: init.modelId,
    position: init.position ?? [idx * 0.9, 0, 0], // 错开生成，避免叠在一起

    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    uniformScale: 1,
    colorHex: (item?.kind === 'prop' && item.defaultColor) || '#4B8BFF',
  }
  next.scene.characters.push(ch)
  next.selectedObjectId = init.id
  return next
}

export function addCamera(
  d: DirectorConsoleData,
  init: { id: string; name?: string; position?: Vec3; lookAt?: Vec3; fovDeg?: number },
): DirectorConsoleData {
  const next = clone(d)
  const name = init.name ?? `机位${next.scene.cameras.length + 1}`
  const cam: CameraObj = {
    id: init.id,
    name,
    position: init.position ?? [0, 2.2, 10],
    lookAtMode: 'manual',
    lookAt: init.lookAt ?? [0, 1.2, 0],
    fovDeg: init.fovDeg ?? 50,
  }
  next.scene.cameras.push(cam)
  next.scene.activeCameraId = init.id
  next.selectedObjectId = init.id
  return next
}

export function selectObject(d: DirectorConsoleData, id?: string): DirectorConsoleData {
  return { ...d, selectedObjectId: id }
}

export function patchCharacter(d: DirectorConsoleData, id: string, patch: Partial<CharacterObj>): DirectorConsoleData {
  const next = clone(d)
  next.scene.characters = next.scene.characters.map((c) => (c.id === id ? { ...c, ...patch } : c))
  return next
}

export function patchCamera(d: DirectorConsoleData, id: string, patch: Partial<CameraObj>): DirectorConsoleData {
  const next = clone(d)
  next.scene.cameras = next.scene.cameras.map((c) => (c.id === id ? { ...c, ...patch } : c))
  return next
}

export function removeObject(d: DirectorConsoleData, id: string): DirectorConsoleData {
  const next = clone(d)
  next.scene.characters = next.scene.characters.filter((c) => c.id !== id)
  next.scene.cameras = next.scene.cameras.filter((c) => c.id !== id)
  if (next.selectedObjectId === id) next.selectedObjectId = undefined
  if (next.scene.activeCameraId === id) next.scene.activeCameraId = next.scene.cameras[0]?.id
  return next
}

export function setAspect(d: DirectorConsoleData, aspect: AspectKey): DirectorConsoleData {
  return { ...d, scene: { ...d.scene, aspect } }
}

export function setSkybox(d: DirectorConsoleData, skybox?: string): DirectorConsoleData {
  return { ...d, scene: { ...d.scene, skybox } }
}

export function setSkyboxYaw(d: DirectorConsoleData, yawDeg: number): DirectorConsoleData {
  const yaw = ((Math.round(yawDeg) % 360) + 360) % 360
  return { ...d, scene: { ...d.scene, skyboxYaw: yaw || undefined } }
}

export function setSkyboxPitch(d: DirectorConsoleData, pitchDeg: number): DirectorConsoleData {
  const pitch = Math.max(-45, Math.min(45, Math.round(pitchDeg)))
  return { ...d, scene: { ...d.scene, skyboxPitch: pitch || undefined } }
}

export function setViewpoint(d: DirectorConsoleData, vp: 'director' | 'camera'): DirectorConsoleData {
  return { ...d, activeViewpoint: vp }
}

export function setActiveCamera(d: DirectorConsoleData, id: string): DirectorConsoleData {
  return { ...d, scene: { ...d.scene, activeCameraId: id } }
}
