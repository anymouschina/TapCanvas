import { describe, it, expect } from 'vitest'
import { sampleShotCamera } from './timeline'
import { buildShotClip } from './previewClip'
import { addCamWaypoint, moveCamWaypoint, setCamPathMode, setCamPathHeight, setCamPathLookAt, clearCamPath } from './cameraPathEdit'
import type { CameraObj, CharacterObj, DirectorScene } from '../types'
import type { Shot } from './timeline'

function character(id: string, x: number, z: number): CharacterObj {
  return { id, name: id, modelId: 'x', position: [x, 0, z], rotation: [0, 0, 0], scale: [1, 1, 1], uniformScale: 1, colorHex: '#fff' }
}

const camWithPath: CameraObj = {
  id: 'cam', name: 'cam', position: [0, 2, 8], lookAtMode: 'manual', lookAt: [0, 1, 0], fovDeg: 50,
  path: { waypoints: [[0, 8], [8, 0]], mode: 'linear', height: 2 },
}

const scene: DirectorScene = {
  characters: [character('c1', 0, 0)],
  cameras: [camWithPath],
  aspect: '16:9',
  activeCameraId: 'cam',
}

const pathShot: Shot = { id: 's', name: 's', durationSeconds: 4, cameraId: 'cam', cameraMove: { kind: 'path' } }

describe('sampleShotCamera — path', () => {
  it('flies along the drawn waypoints at the set height', () => {
    const start = sampleShotCamera(scene, pathShot, 0).camera!
    const end = sampleShotCamera(scene, pathShot, 4).camera!
    expect(start.position).toEqual([0, 2, 8])      // 第一个 waypoint, height=2
    expect(end.position[0]).toBeCloseTo(8, 5)       // 末 waypoint x
    expect(end.position[1]).toBe(2)                  // 恒定高度
  })
  it('looks at scene center by default', () => {
    const c = sampleShotCamera(scene, pathShot, 1).camera!
    expect(c.lookAt).toEqual([0, 1.2, 0]) // 单角色质心
  })
  it('looks at a chosen character when set', () => {
    const sc = { ...scene, characters: [character('c1', 5, 5)], cameras: [{ ...camWithPath, path: { ...camWithPath.path!, lookAtCharacterId: 'c1' } }] }
    const c = sampleShotCamera(sc, pathShot, 1).camera!
    expect(c.lookAt).toEqual([5, 1.2, 5])
  })
  it('falls back to static when camera has no path', () => {
    const sc = { ...scene, cameras: [{ ...camWithPath, path: undefined }] }
    const c = sampleShotCamera(sc, pathShot, 1).camera!
    expect(c.position).toEqual([0, 2, 8]) // 静态机位
  })
})

describe('buildShotClip — path bakes to capture-cam track', () => {
  it('produces a multi-key capture-cam track', () => {
    const clip = buildShotClip(scene, pathShot)
    const track = clip.cameras['capture-cam']
    expect(track).toBeTruthy()
    expect(track.position.length).toBeGreaterThan(2)
    expect(track.position[0].value).toEqual([0, 2, 8])
  })
})

describe('cameraPathEdit helpers', () => {
  it('add/move/remove waypoints immutably', () => {
    let p = addCamWaypoint(null, [1, 2])
    p = addCamWaypoint(p, [3, 4])
    expect(p.waypoints).toEqual([[1, 2], [3, 4]])
    p = moveCamWaypoint(p, 0, [9, 9])
    expect(p.waypoints[0]).toEqual([9, 9])
  })
  it('mode/height/lookAt/clear', () => {
    let p = setCamPathMode({ waypoints: [[0, 0]], mode: 'linear' }, 'curve')
    expect(p.mode).toBe('curve')
    p = setCamPathHeight(p, 3)
    expect(p.height).toBe(3)
    p = setCamPathLookAt(p, { characterId: 'c1' })
    expect(p.lookAtCharacterId).toBe('c1')
    p = clearCamPath(p)
    expect(p.waypoints).toEqual([])
    expect(p.height).toBe(3) // 设置保留
  })
})
