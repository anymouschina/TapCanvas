import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildWaveClip } from './waveClip'

describe('buildWaveClip', () => {
  it('从骨架解析真实运行时骨骼名（GLTFLoader 把 mixamorig:RightArm 净化成 mixamorigRightArm）', () => {
    const root = new THREE.Object3D()
    const arm = new THREE.Object3D(); arm.name = 'mixamorigRightArm'
    const fore = new THREE.Object3D(); fore.name = 'mixamorigRightForeArm'
    root.add(arm); arm.add(fore)
    const names = buildWaveClip(root).tracks.map((t) => t.name)
    expect(names).toContain('mixamorigRightArm.quaternion')
    expect(names).toContain('mixamorigRightForeArm.quaternion')
  })

  it('关键回归：track 名禁含冒号（: 是 PropertyBinding 保留字，会被当目录分隔→绑定失败→骨骼不动）', () => {
    // 用真实素体的原始命名喂进去（带冒号），仍须产出无冒号的运行时名
    const root = new THREE.Object3D()
    const arm = new THREE.Object3D(); arm.name = 'mixamorigRightArm'
    const fore = new THREE.Object3D(); fore.name = 'mixamorigRightForeArm'
    root.add(arm, fore)
    const namesWithRoot = buildWaveClip(root).tracks.map((t) => t.name)
    const namesNoRoot = buildWaveClip().tracks.map((t) => t.name)
    expect(namesWithRoot.every((n) => !n.includes(':'))).toBe(true)
    expect(namesNoRoot.every((n) => !n.includes(':'))).toBe(true)
  })

  it('无 root 时回退到净化常量名', () => {
    const names = buildWaveClip().tracks.map((t) => t.name)
    expect(names).toContain('mixamorigRightArm.quaternion')
    expect(names).toContain('mixamorigRightForeArm.quaternion')
  })

  it('产出名为 wave 的 2s clip', () => {
    const clip = buildWaveClip()
    expect(clip.name).toBe('wave')
    expect(clip.duration).toBe(2)
  })
})
