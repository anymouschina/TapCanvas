import { describe, it, expect } from 'vitest'
import { buildShotClip, buildTimelineClips } from './previewClip'
import type { CameraObj, CharacterObj, DirectorScene } from '../types'
import type { Shot } from './timeline'

function cam(id: string, pos: [number, number, number]): CameraObj {
  return { id, name: id, position: pos, lookAtMode: 'manual', lookAt: [0, 1, 0], fovDeg: 50 }
}
function character(id: string, withMotion = true): CharacterObj {
  return {
    id, name: id, modelId: 'xbot', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    uniformScale: 1, colorHex: '#fff',
    ...(withMotion ? { motion: { durationSeconds: 4, locomotion: { clip: 'run' as const } } } : { motionClip: 'walk' }),
  }
}

const scene: DirectorScene = {
  characters: [character('c1', true), character('c2', false)],
  cameras: [cam('camA', [0, 2, 10])],
  aspect: '16:9',
  activeCameraId: 'camA',
}

describe('buildShotClip', () => {
  it('static shot → single-key capture-cam track from the scene camera', () => {
    const shot: Shot = { id: 's', name: 's', durationSeconds: 4, cameraId: 'camA', cameraMove: { kind: 'static' } }
    const clip = buildShotClip(scene, shot)
    expect(clip.cameras['capture-cam'].position[0].value).toEqual([0, 2, 10])
    expect(clip.cameraOrbit).toBeUndefined()
  })
  it('orbit shot → cameraOrbit passthrough', () => {
    const shot: Shot = { id: 's', name: 's', durationSeconds: 5, cameraMove: { kind: 'orbit', orbit: { radius: 8, degrees: 180 } } }
    const clip = buildShotClip(scene, shot)
    expect(clip.cameraOrbit).toEqual({ radius: 8, degrees: 180 })
    expect(clip.durationSeconds).toBe(5)
  })
  it('recorded shot → capture-cam tracks passthrough', () => {
    const tracks = { position: [{ t: 0, value: [0, 0, 0] as [number, number, number] }], lookAt: [{ t: 0, value: [0, 0, 0] as [number, number, number] }], fovDeg: [{ t: 0, value: [40] as [number] }] }
    const shot: Shot = { id: 's', name: 's', durationSeconds: 3, cameraMove: { kind: 'recorded', tracks } }
    const clip = buildShotClip(scene, shot)
    expect(clip.cameras['capture-cam']).toBe(tracks)
  })
  it('carries character motion (motion preferred over motionClip)', () => {
    const clip = buildShotClip(scene, { id: 's', name: 's', durationSeconds: 4 })
    expect(clip.characters.c1.motion).toBeTruthy()
    expect(clip.characters.c2.motionClip).toBe('walk')
  })
  it('clamps non-positive duration', () => {
    const clip = buildShotClip(scene, { id: 's', name: 's', durationSeconds: 0 })
    expect(clip.durationSeconds).toBeGreaterThan(0)
  })
})

describe('buildTimelineClips', () => {
  it('maps each shot to a clip', () => {
    const out = buildTimelineClips(scene, {
      shots: [
        { id: 'a', name: 'a', durationSeconds: 4, cameraMove: { kind: 'static' } },
        { id: 'b', name: 'b', durationSeconds: 6, cameraMove: { kind: 'orbit', orbit: { radius: 5 } } },
      ],
    })
    expect(out).toHaveLength(2)
    expect(out[1].clip.cameraOrbit).toEqual({ radius: 5 })
  })
  it('empty/undefined timeline → []', () => {
    expect(buildTimelineClips(scene, undefined)).toEqual([])
  })
})
