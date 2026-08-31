import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { calibrateRig, applyPoseToRig, poseEulerFromRig, deg, POSE_PRESETS, type JointRole, type PoseMap } from './pose'

/**
 * 构造 T-pose 人形骨架（世界空间布局与 xbot 一致：面朝 +Z、+X=角色左、双臂沿 ±X）。
 * twist=true 时给若干骨骼塞入"怪异"的绑定局部旋转（子级反向补偿，世界绑定姿态不变），
 * 模拟任意上传模型的非对齐局部轴——姿势数学必须给出与对齐骨架完全一致的世界空间结果。
 */
function buildRig(twist: boolean): THREE.Object3D {
  const mk = (name: string, worldPos: [number, number, number], parent: THREE.Object3D, twistQ?: THREE.Quaternion) => {
    const b = new THREE.Bone()
    b.name = name
    parent.add(b)
    // 先按世界位置摆好（父级当前无旋转时 local=world-parentWorld）
    parent.updateMatrixWorld(true)
    const pw = new THREE.Vector3().setFromMatrixPosition(parent.matrixWorld)
    b.position.set(worldPos[0] - pw.x, worldPos[1] - pw.y, worldPos[2] - pw.z)
    if (twistQ) b.quaternion.copy(twistQ)
    return b
  }
  const root = new THREE.Object3D()
  root.name = 'Armature'
  const tw = twist ? new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(31), deg(-47), deg(13))) : undefined
  const twInv = tw ? tw.clone().invert() : undefined

  const hips = mk('mixamorig:Hips', [0, 1.0, 0], root)
  const spine = mk('mixamorig:Spine', [0, 1.15, 0], hips)
  const spine1 = mk('mixamorig:Spine1', [0, 1.25, 0], spine, tw)
  // spine1 带 twist 后，其子级位置需在 spine1 局部系下表达：用补偿使世界位置仍正确
  const addUnder = (name: string, worldPos: [number, number, number], parent: THREE.Object3D, twistQ?: THREE.Quaternion) => {
    const b = new THREE.Bone()
    b.name = name
    parent.add(b)
    parent.updateMatrixWorld(true)
    const inv = parent.matrixWorld.clone().invert()
    b.position.copy(new THREE.Vector3(...worldPos).applyMatrix4(inv))
    if (twistQ) {
      // 局部旋转 twistQ，同时位置不变（位置已是该父系下的正确值）
      b.quaternion.copy(twistQ)
    }
    return b
  }
  const spine2 = addUnder('mixamorig:Spine2', [0, 1.35, 0], spine1, twInv) // 反向补偿回正
  addUnder('mixamorig:Neck', [0, 1.5, 0], spine2)
  const headParent = spine2.children.find((c) => c.name === 'mixamorig:Neck') as THREE.Bone
  addUnder('mixamorig:Head', [0, 1.6, 0], headParent)

  const shL = addUnder('mixamorig:LeftArm', [0.15, 1.45, 0], spine2, tw)
  const elL = addUnder('mixamorig:LeftForeArm', [0.45, 1.45, 0], shL, twInv)
  addUnder('mixamorig:LeftHand', [0.75, 1.45, 0], elL)
  const shR = addUnder('mixamorig:RightArm', [-0.15, 1.45, 0], spine2)
  const elR = addUnder('mixamorig:RightForeArm', [-0.45, 1.45, 0], shR)
  addUnder('mixamorig:RightHand', [-0.75, 1.45, 0], elR)

  const hipL = addUnder('mixamorig:LeftUpLeg', [0.1, 0.95, 0], hips, tw)
  const kneeL = addUnder('mixamorig:LeftLeg', [0.1, 0.5, 0], hipL, twInv)
  addUnder('mixamorig:LeftFoot', [0.1, 0.05, 0], kneeL)
  const hipR = addUnder('mixamorig:RightUpLeg', [-0.1, 0.95, 0], hips)
  const kneeR = addUnder('mixamorig:RightLeg', [-0.1, 0.5, 0], hipR)
  addUnder('mixamorig:RightFoot', [-0.1, 0.05, 0], kneeR)

  root.updateMatrixWorld(true)
  return root
}

function bonePos(root: THREE.Object3D, name: string): THREE.Vector3 {
  let found: THREE.Object3D | null = null
  root.traverse((o) => { if (o.name === `mixamorig:${name}`) found = o })
  if (!found) throw new Error(`bone not found: ${name}`)
  root.updateMatrixWorld(true)
  return new THREE.Vector3().setFromMatrixPosition((found as THREE.Object3D).matrixWorld)
}

function applyOn(root: THREE.Object3D, pose: PoseMap) {
  const rig = calibrateRig(root)
  applyPoseToRig(root, rig, pose)
  root.updateMatrixWorld(true)
  return rig
}

describe('applyPoseToRig 解剖学语义（对齐骨架）', () => {
  it('立正：双手落到肩下方体侧', () => {
    const r = buildRig(false)
    applyOn(r, { shoulderL: [0, 0, deg(-78)], shoulderR: [0, 0, deg(78)] })
    const hl = bonePos(r, 'LeftHand'); const hr = bonePos(r, 'RightHand')
    expect(hl.y).toBeLessThan(1.0); expect(hr.y).toBeLessThan(1.0)
    expect(Math.abs(hl.x)).toBeLessThan(0.45); expect(Math.abs(hr.x)).toBeLessThan(0.45)
    // 镜像对称
    expect(hl.x).toBeCloseTo(-hr.x, 5); expect(hl.y).toBeCloseTo(hr.y, 5)
  })

  it('伸手（右臂前伸）：右手在身体前方', () => {
    const r = buildRig(false)
    applyOn(r, { shoulderR: [deg(-75), 0, deg(70)] })
    const h = bonePos(r, 'RightHand')
    expect(h.z).toBeGreaterThan(0.4) // 前方 = +Z
  })

  it('欢呼（双臂上举）：双手高于头', () => {
    const r = buildRig(false)
    applyOn(r, { shoulderL: [0, 0, deg(75)], shoulderR: [0, 0, deg(-75)] })
    expect(bonePos(r, 'LeftHand').y).toBeGreaterThan(1.6)
    expect(bonePos(r, 'RightHand').y).toBeGreaterThan(1.6)
  })

  it('肘弯曲随肩姿态解剖跟随：垂臂弯肘 → 手朝前', () => {
    const r = buildRig(false)
    applyOn(r, { shoulderR: [0, 0, deg(78)], elbowR: [0, deg(90), 0] })
    const h = bonePos(r, 'RightHand')
    expect(h.z).toBeGreaterThan(0.2) // 前臂折向身前
    expect(h.y).toBeLessThan(1.45)
  })

  it('坐姿：大腿水平向前、小腿下垂', () => {
    const r = buildRig(false)
    applyOn(r, { hipL: [deg(-85), 0, 0], kneeL: [deg(85), 0, 0], hipR: [deg(-85), 0, 0], kneeR: [deg(85), 0, 0] })
    const knee = bonePos(r, 'LeftLeg'); const foot = bonePos(r, 'LeftFoot')
    expect(knee.z).toBeGreaterThan(0.3)            // 膝在前
    expect(foot.y).toBeLessThan(knee.y - 0.3)      // 脚在膝下方
  })

  it('前倾（spine x+）：头部向前下', () => {
    const r = buildRig(false)
    applyOn(r, { spine: [deg(40), 0, 0] })
    const head = bonePos(r, 'Head')
    expect(head.z).toBeGreaterThan(0.15)
    expect(head.y).toBeLessThan(1.55)
  })

  it('自动落地：跪姿（双膝折叠）整体下沉、最低骨点回到绑定高度', () => {
    const r = buildRig(false)
    const rig = applyOn(r, { hipL: [deg(8), 0, 0], kneeL: [deg(130), 0, 0], hipR: [deg(8), 0, 0], kneeR: [deg(130), 0, 0] })
    expect(r.position.y).toBeLessThan(-0.3) // 根节点下沉
    // 最低骨点回到绑定时的最低高度
    r.updateMatrixWorld(true)
    let minY = Infinity
    for (const b of rig.allBones) {
      const v = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld)
      minY = Math.min(minY, v.y)
    }
    expect(minY).toBeCloseTo(rig.bindMinY + rig.bindPosY, 3)
  })
})

describe('applyPoseToRig 骨骼局部轴无关（扭曲绑定骨架 = 对齐骨架同结果）', () => {
  const PROBES: { name: string; pose: PoseMap }[] = [
    { name: '立正', pose: { shoulderL: [0, 0, deg(-78)], shoulderR: [0, 0, deg(78)] } },
    { name: '伸手', pose: { shoulderR: [deg(-75), 0, deg(70)], elbowR: [0, deg(10), 0] } },
    { name: '坐姿', pose: { hipL: [deg(-85), 0, 0], kneeL: [deg(85), 0, 0] } },
    { name: '前倾+弯肘', pose: { spine: [deg(30), 0, 0], shoulderL: [0, 0, deg(-60)], elbowL: [0, deg(-90), 0] } },
  ]
  for (const probe of PROBES) {
    it(probe.name, () => {
      const aligned = buildRig(false)
      const twisted = buildRig(true)
      applyOn(aligned, probe.pose)
      applyOn(twisted, probe.pose)
      for (const bone of ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'Head']) {
        const a = bonePos(aligned, bone)
        const t = bonePos(twisted, bone)
        expect(t.x).toBeCloseTo(a.x, 4)
        expect(t.y).toBeCloseTo(a.y, 4)
        expect(t.z).toBeCloseTo(a.z, 4)
      }
    })
  }
})

describe('poseEulerFromRig 反解（视口直掰骨骼 → 规范系欧拉角）', () => {
  const PROBES: { name: string; pose: PoseMap }[] = [
    { name: '立正', pose: { shoulderL: [0, 0, deg(-78)], shoulderR: [0, 0, deg(78)] } },
    { name: '伸手', pose: { shoulderR: [deg(-75), 0, deg(70)], elbowR: [0, deg(10), 0] } },
    { name: '坐姿', pose: { hipL: [deg(-85), 0, 0], kneeL: [deg(85), 0, 0] } },
    { name: '前倾+弯肘', pose: { spine: [deg(30), 0, 0], shoulderL: [0, 0, deg(-60)], elbowL: [0, deg(-90), 0] } },
  ]
  for (const twist of [false, true]) {
    it(`应用→反解→重放 世界坐标一致（${twist ? '扭曲' : '对齐'}骨架）`, () => {
      for (const probe of PROBES) {
        const r1 = buildRig(twist)
        const rig1 = calibrateRig(r1)
        applyPoseToRig(r1, rig1, probe.pose)
        r1.updateMatrixWorld(true)
        // 反解出 pose（模拟 gizmo 松手回写）→ 应用到另一具同构骨架
        const readBack: PoseMap = {}
        for (const role of Object.keys(probe.pose) as JointRole[]) {
          const eul = poseEulerFromRig(rig1, role)
          expect(eul, `${probe.name}/${role}`).not.toBeNull()
          readBack[role] = eul!
        }
        const r2 = buildRig(twist)
        applyOn(r2, readBack)
        for (const bone of ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'Head']) {
          const a = bonePos(r1, bone)
          const b = bonePos(r2, bone)
          expect(b.x, `${probe.name}/${bone}`).toBeCloseTo(a.x, 4)
          expect(b.y, `${probe.name}/${bone}`).toBeCloseTo(a.y, 4)
          expect(b.z, `${probe.name}/${bone}`).toBeCloseTo(a.z, 4)
        }
      }
    })
  }

  it('自由拖拽往返：任意局部旋转 → 反解 → 重放还原同一姿态', () => {
    const r = buildRig(false)
    const rig = calibrateRig(r)
    applyPoseToRig(r, rig, { shoulderR: [0, 0, deg(40)] })
    // 模拟 rotate gizmo 拖拽：在当前局部四元数上叠加任意旋转（不经规范系）
    const j = rig.joints.shoulderR!
    j.bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(23), deg(-37), deg(55))))
    r.updateMatrixWorld(true)
    const dragged = j.bone.quaternion.clone()
    // 反解 → 重放（applyPoseToRig 会先复位再应用），局部四元数必须还原
    const eul = poseEulerFromRig(rig, 'shoulderR')!
    applyPoseToRig(r, rig, { shoulderR: eul })
    const replayed = j.bone.quaternion
    expect(Math.abs(dragged.dot(replayed))).toBeCloseTo(1, 6) // q 与 -q 等价
  })
})

describe('POSE_PRESETS 与 hono 工具契约同步', () => {
  it('DIRECTOR_POSE_IDS（agent 工具 enum）与 POSE_PRESETS id 完全一致', async () => {
    const { DIRECTOR_POSE_IDS } = await import(
      '../../../../../../hono-api/src/modules/task/director-capture.shared'
    )
    expect([...DIRECTOR_POSE_IDS].sort()).toEqual(POSE_PRESETS.map((p) => p.id).sort())
  })
})

describe('POSE_PRESETS 健全性', () => {
  it('所有预设可应用且不产生 NaN / 异常下沉', () => {
    for (const p of POSE_PRESETS) {
      const r = buildRig(false)
      applyOn(r, p.pose)
      for (const bone of ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'Head']) {
        const v = bonePos(r, bone)
        expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z), `${p.id}/${bone}`).toBe(true)
      }
      expect(Number.isFinite(r.position.y), p.id).toBe(true)
    }
  })

  it('对称类预设左右镜像（x 对称）', () => {
    const SYMMETRIC = ['arms-down', 'akimbo', 'sit', 'squat', 'cheer', 'pray', 'bow', 'clap', 'offer', 'hug', 'beg']
    for (const id of SYMMETRIC) {
      const p = POSE_PRESETS.find((x) => x.id === id)!
      const r = buildRig(false)
      applyOn(r, p.pose)
      const hl = bonePos(r, 'LeftHand'); const hr = bonePos(r, 'RightHand')
      expect(hl.x, id).toBeCloseTo(-hr.x, 4)
      expect(hl.y, id).toBeCloseTo(hr.y, 4)
      expect(hl.z, id).toBeCloseTo(hr.z, 4)
    }
  })
})
