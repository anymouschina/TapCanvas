import { describe, it, expect } from 'vitest'
import { samplePoseClipAt, type PoseClip } from './poseClip'

const clip: PoseClip = {
  id: 'c', name: '挥手', durationSeconds: 2, loop: true,
  keyframes: [
    { t: 0, pose: { shoulderR: [0, 0, 0] } },
    { t: 1, pose: { shoulderR: [0, 0, 1] } },
    { t: 2, pose: { shoulderR: [0, 0, 0] } },
  ],
}

describe('samplePoseClipAt', () => {
  it('插值到关键帧中点', () => {
    expect(samplePoseClipAt(clip, 0.5).shoulderR![2]).toBeCloseTo(0.5)
  })
  it('命中关键帧返回该值', () => {
    expect(samplePoseClipAt(clip, 1).shoulderR![2]).toBeCloseTo(1)
  })
  it('loop 把超长 t 折进时长', () => {
    expect(samplePoseClipAt(clip, 2.5).shoulderR![2]).toBeCloseTo(0.5)
  })
  it('缺关节按 rest(0) 插值', () => {
    const c2: PoseClip = { id: 'c2', name: 'x', durationSeconds: 1, keyframes: [{ t: 0, pose: {} }, { t: 1, pose: { elbowR: [0, 1, 0] } }] }
    expect(samplePoseClipAt(c2, 0.5).elbowR![1]).toBeCloseTo(0.5)
  })
  it('空 keyframes 返回空 pose', () => {
    expect(samplePoseClipAt({ id: 'e', name: 'e', durationSeconds: 1, keyframes: [] }, 0.5)).toEqual({})
  })
})

describe('samplePoseClipAt easing (smoothstep 去线性机械感)', () => {
  const c: PoseClip = {
    id: 'e', name: 'e', durationSeconds: 2,
    keyframes: [{ t: 0, pose: { spine: [0, 0, 0] } }, { t: 2, pose: { spine: [1, 0, 0] } }],
  }
  it('中点(k=0.5)等价线性 → 既有中点用例不破', () => {
    expect(samplePoseClipAt(c, 1).spine![0]).toBeCloseTo(0.5, 6)
  })
  it('1/4 处被缓动拉低(< 线性 0.25)：关键帧处速度归零', () => {
    // t=0.5 → kRaw=0.25 → smoothstep=0.25²·(3-2·0.25)=0.15625
    const v = samplePoseClipAt(c, 0.5).spine![0]
    expect(v).toBeLessThan(0.25)
    expect(v).toBeCloseTo(0.25 * 0.25 * (3 - 2 * 0.25), 6)
  })
  it('3/4 处对称地被拉高(> 线性 0.75)', () => {
    expect(samplePoseClipAt(c, 1.5).spine![0]).toBeGreaterThan(0.75)
  })
})
