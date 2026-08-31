import { describe, it, expect } from 'vitest'
import { advancePlayhead } from './playback'
import { shotCameraPathPoints } from './cameraPath'
import type { CameraObj, CharacterObj, DirectorScene } from '../types'
import type { Shot } from './timeline'

describe('advancePlayhead', () => {
  it('advances by dt*speed', () => {
    expect(advancePlayhead(0, 0.1, 1, 10, true).t).toBeCloseTo(0.1, 5)
    expect(advancePlayhead(0, 0.1, 4, 10, true).t).toBeCloseTo(0.4, 5)
  })
  it('loops past the end', () => {
    const r = advancePlayhead(9.95, 0.1, 1, 10, true)
    expect(r.ended).toBe(false)
    expect(r.t).toBeCloseTo(0.05, 5)
  })
  it('clamps and ends without loop', () => {
    const r = advancePlayhead(9.95, 0.1, 1, 10, false)
    expect(r.ended).toBe(true)
    expect(r.t).toBe(10)
  })
  it('zero duration → ended at 0', () => {
    expect(advancePlayhead(5, 0.1, 1, 0, true)).toEqual({ t: 0, ended: true })
  })
})

const scene: DirectorScene = {
  characters: [{ id: 'c', name: 'c', modelId: 'x', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], uniformScale: 1, colorHex: '#fff' } as CharacterObj],
  cameras: [{ id: 'cam', name: 'cam', position: [0, 2, 8], lookAtMode: 'manual', lookAt: [0, 1, 0], fovDeg: 40 } as CameraObj],
  aspect: '16:9',
  activeCameraId: 'cam',
}

describe('shotCameraPathPoints', () => {
  it('static shot → no path', () => {
    expect(shotCameraPathPoints(scene, { id: 's', name: 's', durationSeconds: 4, cameraMove: { kind: 'static' } })).toEqual([])
  })
  it('orbit shot → sampled polyline points', () => {
    const shot: Shot = { id: 's', name: 's', durationSeconds: 4, cameraMove: { kind: 'orbit', orbit: { radius: 8, degrees: 90 } } }
    const pts = shotCameraPathPoints(scene, shot, 16)
    expect(pts.length).toBe(17)
    // first near +Z (0deg), last near +X (90deg)
    expect(pts[0][2]).toBeCloseTo(8, 1)
    expect(pts[pts.length - 1][0]).toBeCloseTo(8, 1)
  })
})
