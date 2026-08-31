import { describe, it, expect } from 'vitest'
import {
  ensureMotion, setDuration, setLocomotionClip, setSpeed, clearLocomotion,
  setPathMode, addWaypoint, moveWaypoint, removeWaypoint, clearWaypoints,
  putPoseKeyframe, removePoseKeyframeAt, clearMotion,
} from './motionEdit'
import { deg } from './pose'

describe('motionEdit', () => {
  it('ensureMotion 从 undefined 建默认(2s,无 loco/pose)', () => {
    const m = ensureMotion(undefined)
    expect(m.durationSeconds).toBe(2)
    expect(m.locomotion).toBeUndefined()
    expect(m.poseTrack).toBeUndefined()
  })
  it('setDuration 夹到 >=0.5', () => {
    expect(setDuration(undefined, 5).durationSeconds).toBe(5)
    expect(setDuration(undefined, 0.1).durationSeconds).toBe(0.5)
  })
  it('setLocomotionClip 设/换 clip 保留 path', () => {
    let m = setLocomotionClip(undefined, 'walk')
    expect(m.locomotion!.clip).toBe('walk')
    m = addWaypoint(m, [1, 2])
    m = setLocomotionClip(m, 'run')
    expect(m.locomotion!.clip).toBe('run')
    expect(m.locomotion!.path!.waypoints).toEqual([[1, 2]])
  })
  it('setSpeed / clearLocomotion', () => {
    let m = setLocomotionClip(undefined, 'walk')
    m = setSpeed(m, 1.5)
    expect(m.locomotion!.speed).toBe(1.5)
    m = clearLocomotion(m)
    expect(m.locomotion).toBeUndefined()
  })
  it('addWaypoint 自动开 locomotion(默认 walk,linear)并追加点', () => {
    let m = addWaypoint(undefined, [0, 0])
    expect(m.locomotion!.clip).toBe('walk')
    expect(m.locomotion!.path!.mode).toBe('linear')
    m = addWaypoint(m, [3, 4])
    expect(m.locomotion!.path!.waypoints).toEqual([[0, 0], [3, 4]])
  })
  it('moveWaypoint / removeWaypoint / clearWaypoints', () => {
    let m = addWaypoint(addWaypoint(undefined, [0, 0]), [1, 1])
    m = moveWaypoint(m, 1, [5, 5])
    expect(m.locomotion!.path!.waypoints[1]).toEqual([5, 5])
    m = removeWaypoint(m, 0)
    expect(m.locomotion!.path!.waypoints).toEqual([[5, 5]])
    m = clearWaypoints(m)
    expect(m.locomotion!.path).toBeUndefined()
  })
  it('setPathMode 切折线/曲线（无 path 时空操作不崩）', () => {
    let m = addWaypoint(undefined, [0, 0])
    m = setPathMode(m, 'curve')
    expect(m.locomotion!.path!.mode).toBe('curve')
    expect(() => setPathMode(setLocomotionClip(undefined, 'idle'), 'curve')).not.toThrow()
  })
  it('putPoseKeyframe 按 t 插入并排序，同 t 覆盖', () => {
    let m = putPoseKeyframe(undefined, 1, { spine: [deg(10), 0, 0] })
    m = putPoseKeyframe(m, 0, { neck: [deg(5), 0, 0] })
    expect(m.poseTrack!.map((k) => k.t)).toEqual([0, 1])
    m = putPoseKeyframe(m, 1, { spine: [deg(20), 0, 0] })
    expect(m.poseTrack!.filter((k) => k.t === 1).length).toBe(1)
    expect(m.poseTrack!.find((k) => k.t === 1)!.pose.spine![0]).toBeCloseTo(deg(20), 5)
  })
  it('removePoseKeyframeAt 删指定 t；删空则 poseTrack=undefined', () => {
    let m = putPoseKeyframe(undefined, 0, { neck: [deg(5), 0, 0] })
    m = removePoseKeyframeAt(m, 0)
    expect(m.poseTrack).toBeUndefined()
  })
  it('clearMotion → undefined', () => {
    expect(clearMotion()).toBeUndefined()
  })
})
