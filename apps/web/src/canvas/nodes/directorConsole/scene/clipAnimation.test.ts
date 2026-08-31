import { describe, it, expect } from 'vitest'
import { sampleAnimationAt, sampleOrbitCamera, type ClipAnimation } from './clipAnimation'
import type { CharacterMotion } from '../state/characterMotion'


const anim: ClipAnimation = {
  durationSeconds: 4,
  fps: 24,
  cameras: {
    cam1: {
      position: [{ t: 0, value: [0, 2, 10] }, { t: 4, value: [6, 2, 10] }],
      lookAt: [{ t: 0, value: [0, 1, 0] }],
      fovDeg: [{ t: 0, value: [45] }],
    },
  },
  characters: {},
}

describe('sampleAnimationAt', () => {
  it('插值相机 position 到中点', () => {
    const s = sampleAnimationAt(anim, 2)
    expect(s.cameras.cam1.position).toEqual([3, 2, 10])
  })
  it('单关键帧通道保持常量', () => {
    const s = sampleAnimationAt(anim, 3.5)
    expect(s.cameras.cam1.lookAt).toEqual([0, 1, 0])
    expect(s.cameras.cam1.fovDeg).toBe(45)
  })
  it('t 超范围 clamp 到尾帧', () => {
    const s = sampleAnimationAt(anim, 99)
    expect(s.cameras.cam1.position).toEqual([6, 2, 10])
  })
})

describe('sampleAnimationAt motion', () => {
  const anim: ClipAnimation = {
    durationSeconds: 4, fps: 24,
    cameras: {},
    characters: {
      hero: { motionClip: 'walk' },
      npc: { motionClip: 'wave', motionSpeed: 2 },
      still: {},
    },
  }
  it('透传 motionClip 并按 speed=1 算 motionTimeSec', () => {
    const s = sampleAnimationAt(anim, 1.5)
    expect(s.characters.hero.motionClip).toBe('walk')
    expect(s.characters.hero.motionTimeSec).toBeCloseTo(1.5)
  })
  it('motionSpeed 缩放 motionTimeSec', () => {
    const s = sampleAnimationAt(anim, 1.5)
    expect(s.characters.npc.motionTimeSec).toBeCloseTo(3.0)
  })
  it('无 motionClip 不输出 motion 字段', () => {
    const s = sampleAnimationAt(anim, 1.5)
    expect(s.characters.still.motionClip).toBeUndefined()
    expect(s.characters.still.motionTimeSec).toBeUndefined()
  })
})

describe('sampleOrbitCamera / cameraOrbit', () => {
  it('t=0 在起始角(startDeg=0 → +Z 方向)', () => {
    const c = sampleOrbitCamera({ radius: 6, height: 2 }, 0, 4)
    expect(c.position[0]).toBeCloseTo(0)
    expect(c.position[2]).toBeCloseTo(6)
    expect(c.position[1]).toBeCloseTo(2)
  })
  it('360° 半程(t=duration/2) 转到对面 -Z', () => {
    const c = sampleOrbitCamera({ radius: 6 }, 2, 4)
    expect(c.position[0]).toBeCloseTo(0, 5)
    expect(c.position[2]).toBeCloseTo(-6)
  })
  it('360° 四分之一(t=duration/4) 在 +X 侧', () => {
    const c = sampleOrbitCamera({ radius: 6 }, 1, 4)
    expect(c.position[0]).toBeCloseTo(6)
    expect(c.position[2]).toBeCloseTo(0, 5)
  })
  it('lookAt 锁中心 + 抬高', () => {
    const c = sampleOrbitCamera({ center: [1, 0, 2], lookAtHeight: 1.3 }, 0, 4)
    expect(c.lookAt).toEqual([1, 1.3, 2])
  })
  it('sampleAnimationAt 注入 capture-cam 环绕机位（覆盖轨道）', () => {
    const a: ClipAnimation = { durationSeconds: 4, fps: 24, cameras: {}, characters: {}, cameraOrbit: { radius: 5 } }
    const s = sampleAnimationAt(a, 0)
    expect(s.cameras['capture-cam']).toBeTruthy()
    expect(s.cameras['capture-cam'].position[2]).toBeCloseTo(5)
  })
})

describe('sampleAnimationAt with motion', () => {
  it('motion.locomotion.path → 角色 position/rotation 来自路径，并透传 motion+绝对时间', () => {
    const motion: CharacterMotion = {
      durationSeconds: 4,
      locomotion: { clip: 'walk', path: { waypoints: [[0, 0], [8, 0]], mode: 'linear' } },
    }
    const anim: ClipAnimation = {
      durationSeconds: 4, fps: 24, cameras: {},
      characters: { hero: { motion } },
    }
    const f = sampleAnimationAt(anim, 2)
    const c = f.characters.hero
    expect(c.position![0]).toBeCloseTo(4, 2)   // 半程
    expect(c.position![1]).toBe(0)
    expect(c.rotation![1]).toBeCloseTo(Math.PI / 2, 3)
    expect(c.motion).toBe(motion)
    expect(c.motionAbsTime).toBeCloseTo(2, 5)
  })

  it('无 motion 的角色行为不变（仅 motionClip）', () => {
    const anim: ClipAnimation = {
      durationSeconds: 2, fps: 24, cameras: {},
      characters: { hero: { motionClip: 'wave' } },
    }
    const c = sampleAnimationAt(anim, 1).characters.hero
    expect(c.motionClip).toBe('wave')
    expect(c.motion).toBeUndefined()
  })
})
