import { describe, it, expect } from 'vitest'
import { sampleCharacterMotionAt, type CharacterMotion } from './characterMotion'
import { UPPER_BODY_ROLES, ALL_JOINT_ROLES, deg } from './pose'

describe('sampleCharacterMotionAt', () => {
  it('仅 locomotion：baked 驱动全身，根沿路径，蒙版=上半身但无 pose', () => {
    const m: CharacterMotion = {
      durationSeconds: 4,
      locomotion: { clip: 'walk', path: { waypoints: [[0, 0], [4, 0]], mode: 'linear' }, speed: 1 },
    }
    const s = sampleCharacterMotionAt(m, 2) // 半程
    expect(s.bakedClip).toBe('walk')
    expect(s.bakedTimeSec).toBeCloseTo(2, 5)
    expect(s.rootXZ![0]).toBeCloseTo(2, 3) // 4 米路 / 4s，t=2 → x≈2
    expect(s.pose).toBeUndefined()
    expect(s.poseMask).toEqual(UPPER_BODY_ROLES)
    // 朝 +X 行进 → heading 绕 y 使 +Z 面转向 +X：atan2(tx, tz)=atan2(1,0)=π/2
    expect(s.rootHeadingY!).toBeCloseTo(Math.PI / 2, 3)
  })

  it('locomotion + poseTrack：上半身盖姿势，仍带 baked 腿', () => {
    const m: CharacterMotion = {
      durationSeconds: 2,
      locomotion: { clip: 'run' },
      poseTrack: [
        { t: 0, pose: { shoulderR: [0, 0, deg(-80)] } },
        { t: 2, pose: { shoulderR: [0, 0, deg(0)] } },
      ],
    }
    const s = sampleCharacterMotionAt(m, 1)
    expect(s.bakedClip).toBe('run')
    expect(s.pose!.shoulderR![2]).toBeCloseTo(deg(-40), 3) // 线性插值中点
    expect(s.poseMask).toEqual(UPPER_BODY_ROLES)
  })

  it('仅 poseTrack（无 locomotion）：整身蒙版 + 无 baked + 无根位移', () => {
    const m: CharacterMotion = {
      durationSeconds: 1,
      poseTrack: [{ t: 0, pose: { spine: [deg(20), 0, 0] } }],
    }
    const s = sampleCharacterMotionAt(m, 0.5)
    expect(s.bakedClip).toBeUndefined()
    expect(s.rootXZ).toBeUndefined()
    expect(s.poseMask).toEqual(ALL_JOINT_ROLES)
    expect(s.pose!.spine![0]).toBeCloseTo(deg(20), 5)
  })

  it('poseMask 显式覆盖默认', () => {
    const m: CharacterMotion = {
      durationSeconds: 1,
      poseMask: ['neck'],
      locomotion: { clip: 'idle' },
      poseTrack: [{ t: 0, pose: { neck: [deg(15), 0, 0] } }],
    }
    expect(sampleCharacterMotionAt(m, 0).poseMask).toEqual(['neck'])
  })

  it('无 path 的 locomotion：原地循环，无根位移', () => {
    const m: CharacterMotion = { durationSeconds: 3, locomotion: { clip: 'walk' } }
    const s = sampleCharacterMotionAt(m, 1)
    expect(s.bakedClip).toBe('walk')
    expect(s.rootXZ).toBeUndefined()
    expect(s.rootHeadingY).toBeUndefined()
  })

  it('speed 缩放 baked 时间', () => {
    const m: CharacterMotion = { durationSeconds: 4, locomotion: { clip: 'walk', speed: 2 } }
    expect(sampleCharacterMotionAt(m, 1).bakedTimeSec).toBeCloseTo(2, 5)
  })
})
