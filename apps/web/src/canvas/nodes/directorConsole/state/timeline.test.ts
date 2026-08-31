import { describe, it, expect } from 'vitest'
import {
  timelineDuration,
  activeShotAt,
  sampleShotCamera,
  sampleTimelineAt,
  addShot,
  patchShot,
  removeShot,
  moveShot,
  type SceneTimeline,
} from './timeline'
import type { CameraObj, CharacterObj, DirectorScene } from '../types'

function cam(id: string, pos: [number, number, number]): CameraObj {
  return { id, name: id, position: pos, lookAtMode: 'manual', lookAt: [0, 1, 0], fovDeg: 40 }
}

function character(id: string): CharacterObj {
  return {
    id,
    name: id,
    modelId: 'xbot',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    uniformScale: 1,
    colorHex: '#fff',
    motion: { durationSeconds: 4, locomotion: { clip: 'walk', path: { waypoints: [[0, 0], [2, 0]], mode: 'linear' } } },
  }
}

const scene: DirectorScene = {
  characters: [character('c1')],
  cameras: [cam('camA', [0, 2, 10]), cam('camB', [5, 2, 0])],
  aspect: '16:9',
  activeCameraId: 'camA',
}

const tl: SceneTimeline = {
  shots: [
    { id: 's1', name: '镜头1', durationSeconds: 4, cameraId: 'camA', cameraMove: { kind: 'static' } },
    {
      id: 's2',
      name: '镜头2',
      durationSeconds: 6,
      cameraId: 'camB',
      cameraMove: { kind: 'orbit', orbit: { center: [0, 0, 0], radius: 8, startDeg: 0, degrees: 90 } },
    },
  ],
}

describe('timelineDuration', () => {
  it('sums shot durations', () => {
    expect(timelineDuration(tl)).toBe(10)
    expect(timelineDuration({ shots: [] })).toBe(0)
    expect(timelineDuration(undefined)).toBe(0)
  })
})

describe('activeShotAt', () => {
  it('locates the shot and local time across boundaries', () => {
    expect(activeShotAt(tl, 0)!.shot.id).toBe('s1')
    expect(activeShotAt(tl, 2)).toMatchObject({ index: 0, localT: 2 })
    // boundary: t=4 falls into s2 (clamped < acc+dur is exclusive at 4 for s1)
    expect(activeShotAt(tl, 4)!.shot.id).toBe('s2')
    expect(activeShotAt(tl, 7)).toMatchObject({ index: 1, localT: 3 })
    // beyond end clamps to last shot's end
    expect(activeShotAt(tl, 999)!.shot.id).toBe('s2')
  })
  it('returns null for empty timeline', () => {
    expect(activeShotAt({ shots: [] }, 1)).toBeNull()
  })
})

describe('sampleShotCamera', () => {
  it('static → uses the scene camera position', () => {
    const r = sampleShotCamera(scene, tl.shots[0], 1)
    expect(r.cameraId).toBe('camA')
    expect(r.camera!.position).toEqual([0, 2, 10])
  })
  it('orbit → interpolates around center over local time', () => {
    const shot = tl.shots[1]
    const start = sampleShotCamera(scene, shot, 0).camera!
    const end = sampleShotCamera(scene, shot, shot.durationSeconds).camera!
    // start at 0deg (+Z): position ~ [0,_,8]; end at 90deg: ~ [8,_,0]
    expect(start.position[2]).toBeCloseTo(8, 1)
    expect(end.position[0]).toBeCloseTo(8, 1)
    expect(start.position[0]).toBeCloseTo(0, 1)
  })
  it('recorded → interpolates the keyframe track', () => {
    const shot = {
      id: 'r',
      name: 'r',
      durationSeconds: 2,
      cameraId: 'camA',
      cameraMove: {
        kind: 'recorded' as const,
        tracks: {
          position: [{ t: 0, value: [0, 0, 0] as [number, number, number] }, { t: 2, value: [10, 0, 0] as [number, number, number] }],
          lookAt: [{ t: 0, value: [0, 0, 0] as [number, number, number] }, { t: 2, value: [0, 0, 0] as [number, number, number] }],
          fovDeg: [{ t: 0, value: [40] as [number] }, { t: 2, value: [40] as [number] }],
        },
      },
    }
    expect(sampleShotCamera(scene, shot, 1).camera!.position[0]).toBeCloseTo(5, 5)
  })
})

describe('sampleTimelineAt', () => {
  it('returns active shot, camera, and character states', () => {
    const f = sampleTimelineAt(tl, scene, 1)
    expect(f.shotId).toBe('s1')
    expect(f.camera).not.toBeNull()
    expect(f.characters.c1).toBeTruthy()
    expect(f.characters.c1.position).toBeDefined() // 角色沿路径有位移
  })
  it('switches camera when crossing into shot 2', () => {
    const f = sampleTimelineAt(tl, scene, 5)
    expect(f.shotId).toBe('s2')
    expect(f.cameraId).toBe('camB')
  })
  it('empty timeline → null camera, no shot', () => {
    const f = sampleTimelineAt({ shots: [] }, scene, 1)
    expect(f.shotId).toBeNull()
    expect(f.camera).toBeNull()
  })
})

describe('mutation helpers', () => {
  it('addShot appends with defaults', () => {
    const next = addShot({ shots: [] }, { cameraId: 'camA' })
    expect(next.shots).toHaveLength(1)
    expect(next.shots[0].durationSeconds).toBe(4)
    expect(next.shots[0].cameraId).toBe('camA')
  })
  it('patchShot updates fields but preserves id', () => {
    const next = patchShot(tl, 's1', { durationSeconds: 8, id: 'hacked' })
    expect(next.shots[0].durationSeconds).toBe(8)
    expect(next.shots[0].id).toBe('s1')
  })
  it('removeShot drops by id', () => {
    expect(removeShot(tl, 's1').shots.map((s) => s.id)).toEqual(['s2'])
  })
  it('moveShot reorders', () => {
    expect(moveShot(tl, 's2', 0).shots.map((s) => s.id)).toEqual(['s2', 's1'])
  })
})
