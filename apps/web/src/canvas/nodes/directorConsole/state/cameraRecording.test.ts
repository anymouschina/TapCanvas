import { describe, it, expect } from 'vitest'
import { buildRecordedCamera, type FlySample } from './cameraRecording'

const mk = (t: number, x: number): FlySample => ({ t, position: [x, 1, 0], lookAt: [x, 1, -5], fovDeg: 45 })

describe('buildRecordedCamera', () => {
  it('少于2帧返回 null', () => {
    expect(buildRecordedCamera([mk(0, 0)])).toBeNull()
    expect(buildRecordedCamera([])).toBeNull()
  })
  it('归一化时间到 [0,duration] 并生成三条轨道', () => {
    const r = buildRecordedCamera([mk(10, 0), mk(11, 1), mk(12, 2)])!
    expect(r).toBeTruthy()
    expect(r.durationSeconds).toBeCloseTo(2)
    expect(r.tracks.position[0]).toEqual({ t: 0, value: [0, 1, 0] })
    expect(r.tracks.position[2]).toEqual({ t: 2, value: [2, 1, 0] })
    expect(r.tracks.fovDeg[0].value).toEqual([45])
    expect(r.points.length).toBe(3)
  })
  it('超过 maxKeyframes 抽样且保首尾', () => {
    const samples = Array.from({ length: 200 }, (_, i) => mk(i * 0.1, i))
    const r = buildRecordedCamera(samples, 60)!
    expect(r.tracks.position.length).toBeLessThanOrEqual(61)
    expect(r.tracks.position[0].t).toBeCloseTo(0)
    expect(r.tracks.position[r.tracks.position.length - 1].t).toBeCloseTo(samples[199].t - samples[0].t)
    expect(r.points.length).toBe(200)
  })
  it('零时长(全同 t)返回 null', () => {
    expect(buildRecordedCamera([mk(5, 0), mk(5, 1)])).toBeNull()
  })
})
