import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { calibrateRig, applyPoseToRig, applyPosePartialToRig, deg, ALL_JOINT_ROLES, UPPER_BODY_ROLES, type PoseMap } from './pose'

// 与 pose.test.ts 一致的 T-pose 骨架（面朝 +Z，+X=左，双臂沿 ±X）
function buildRig(): THREE.Object3D {
  const addUnder = (name: string, worldPos: [number, number, number], parent: THREE.Object3D) => {
    const b = new THREE.Bone(); b.name = name; parent.add(b)
    parent.updateMatrixWorld(true)
    const inv = parent.matrixWorld.clone().invert()
    b.position.copy(new THREE.Vector3(...worldPos).applyMatrix4(inv))
    return b
  }
  const root = new THREE.Object3D(); root.name = 'Armature'
  const hips = addUnder('mixamorig:Hips', [0, 1.0, 0], root)
  const spine = addUnder('mixamorig:Spine', [0, 1.15, 0], hips)
  const spine1 = addUnder('mixamorig:Spine1', [0, 1.25, 0], spine)
  const spine2 = addUnder('mixamorig:Spine2', [0, 1.35, 0], spine1)
  const neck = addUnder('mixamorig:Neck', [0, 1.5, 0], spine2)
  addUnder('mixamorig:Head', [0, 1.6, 0], neck)
  const shL = addUnder('mixamorig:LeftArm', [0.15, 1.45, 0], spine2)
  const elL = addUnder('mixamorig:LeftForeArm', [0.45, 1.45, 0], shL)
  addUnder('mixamorig:LeftHand', [0.75, 1.45, 0], elL)
  const shR = addUnder('mixamorig:RightArm', [-0.15, 1.45, 0], spine2)
  const elR = addUnder('mixamorig:RightForeArm', [-0.45, 1.45, 0], shR)
  addUnder('mixamorig:RightHand', [-0.75, 1.45, 0], elR)
  const hipL = addUnder('mixamorig:LeftUpLeg', [0.1, 0.95, 0], hips)
  const kneeL = addUnder('mixamorig:LeftLeg', [0.1, 0.5, 0], hipL)
  addUnder('mixamorig:LeftFoot', [0.1, 0.05, 0], kneeL)
  const hipR = addUnder('mixamorig:RightUpLeg', [-0.1, 0.95, 0], hips)
  const kneeR = addUnder('mixamorig:RightLeg', [-0.1, 0.5, 0], hipR)
  addUnder('mixamorig:RightFoot', [-0.1, 0.05, 0], kneeR)
  root.updateMatrixWorld(true)
  return root
}

function boneQuat(root: THREE.Object3D, name: string): THREE.Quaternion {
  let f: THREE.Object3D | null = null
  root.traverse((o) => { if (o.name === `mixamorig:${name}`) f = o })
  if (!f) throw new Error(name)
  return (f as THREE.Object3D).quaternion.clone()
}

describe('applyPosePartialToRig', () => {
  it('只动蒙版内关节，蒙版外保持调用前的值', () => {
    const root = buildRig()
    const rig = calibrateRig(root)
    // 先给腿一个非绑定姿态（模拟 baked 已驱动腿）
    const legBent: PoseMap = { kneeL: [deg(40), 0, 0], hipR: [deg(-20), 0, 0] }
    applyPoseToRig(root, rig, legBent)
    const kneeLBefore = boneQuat(root, 'LeftLeg')
    const hipRBefore = boneQuat(root, 'RightUpLeg')
    // partial 只盖上半身
    applyPosePartialToRig(root, rig, { shoulderL: [0, 0, deg(40)] }, UPPER_BODY_ROLES, { autoLand: false })
    // 腿（蒙版外）不变
    expect(boneQuat(root, 'LeftLeg').angleTo(kneeLBefore)).toBeLessThan(1e-6)
    expect(boneQuat(root, 'RightUpLeg').angleTo(hipRBefore)).toBeLessThan(1e-6)
    // 肩（蒙版内）被改动
    const shoulderRest = new THREE.Quaternion()
    expect(boneQuat(root, 'LeftArm').angleTo(shoulderRest)).toBeGreaterThan(0.1)
  })

  it('roles=ALL + autoLand:true 与 applyPoseToRig 等价', () => {
    const pose: PoseMap = { shoulderR: [0, 0, deg(-50)], spine: [deg(10), 0, 0], kneeR: [deg(30), 0, 0] }
    const a = buildRig(); const rigA = calibrateRig(a); applyPoseToRig(a, rigA, pose)
    const b = buildRig(); const rigB = calibrateRig(b); applyPosePartialToRig(b, rigB, pose, ALL_JOINT_ROLES, { autoLand: true })
    for (const name of ['LeftArm', 'RightArm', 'Spine1', 'RightLeg', 'LeftUpLeg']) {
      expect(boneQuat(a, name).angleTo(boneQuat(b, name))).toBeLessThan(1e-6)
    }
    expect(Math.abs(a.position.y - b.position.y)).toBeLessThan(1e-6)
  })

  it('autoLand:false 不改 root.position.y', () => {
    const root = buildRig(); const rig = calibrateRig(root)
    const y0 = root.position.y
    applyPosePartialToRig(root, rig, { kneeL: [deg(120), 0, 0] }, ['kneeL'], { autoLand: false })
    expect(root.position.y).toBe(y0)
  })

  it('pose=undefined 时把蒙版关节复位到绑定姿态', () => {
    const root = buildRig(); const rig = calibrateRig(root)
    applyPoseToRig(root, rig, { shoulderL: [0, 0, deg(60)] })
    applyPosePartialToRig(root, rig, undefined, ['shoulderL'], { autoLand: false })
    expect(boneQuat(root, 'LeftArm').angleTo(new THREE.Quaternion())).toBeLessThan(1e-6)
  })
})
