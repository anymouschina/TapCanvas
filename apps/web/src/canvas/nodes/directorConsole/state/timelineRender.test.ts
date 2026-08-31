import { describe, it, expect } from 'vitest'
import { buildTimelineFrames } from './timelineRender'
import type { CameraObj, CharacterObj, DirectorScene } from '../types'
import type { SceneTimeline } from './timeline'

function cam(id: string, pos: [number, number, number]): CameraObj {
  return { id, name: id, position: pos, lookAtMode: 'manual', lookAt: [0, 1, 0], fovDeg: 50 }
}
function character(id: string): CharacterObj {
  return {
    id, name: id, modelId: 'x', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], uniformScale: 1, colorHex: '#fff',
    motion: { durationSeconds: 2, locomotion: { clip: 'walk', path: { waypoints: [[0, 0], [4, 0]], mode: 'linear' } } },
  }
}

const scene: DirectorScene = {
  characters: [character('c1')],
  cameras: [cam('camA', [0, 2, 10]), cam('camB', [9, 2, 0])],
  aspect: '16:9',
  activeCameraId: 'camA',
}
const timeline: SceneTimeline = {
  shots: [
    { id: 's1', name: 's1', durationSeconds: 2, cameraId: 'camA', cameraMove: { kind: 'static' } },
    { id: 's2', name: 's2', durationSeconds: 2, cameraId: 'camB', cameraMove: { kind: 'static' } },
  ],
}

describe('buildTimelineFrames', () => {
  it('emits round(total*fps)+1 frames', () => {
    const frames = buildTimelineFrames(scene, timeline, 10) // total=4s
    expect(frames.length).toBe(41)
  })
  it('cuts camera at shot boundary', () => {
    const frames = buildTimelineFrames(scene, timeline, 10)
    expect(frames[0].position).toEqual([0, 2, 10])        // shot1 → camA
    expect(frames[frames.length - 1].position).toEqual([9, 2, 0]) // shot2 → camB
  })
  it('character motion clamps past its clip (frozen at end), not looping', () => {
    const frames = buildTimelineFrames(scene, timeline, 10)
    // char motion duration=2; at t=3 and t=4 the motionAbsTime should both be clamped to 2
    const f30 = frames[30] // t=3.0
    const f40 = frames[40] // t=4.0
    expect(f30.characters.c1.motionAbsTime).toBe(2)
    expect(f40.characters.c1.motionAbsTime).toBe(2)
  })
  it('empty timeline → []', () => {
    expect(buildTimelineFrames(scene, { shots: [] }, 10)).toEqual([])
  })
})
