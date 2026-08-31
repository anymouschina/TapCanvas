import * as THREE from 'three'

// 关节角色（覆盖 liblib「逐关节调节」的主要可控关节）
export type JointRole =
  | 'spine' | 'neck'
  | 'shoulderL' | 'elbowL' | 'shoulderR' | 'elbowR'
  | 'hipL' | 'kneeL' | 'hipR' | 'kneeR'

export type Euler3 = [number, number, number] // 弧度
export type PoseMap = Partial<Record<JointRole, Euler3>>

const DEG = Math.PI / 180
export const deg = (d: number): number => d * DEG
export const toDeg = (r: number): number => Math.round((r / DEG) * 10) / 10

// —— 骨骼映射 ——
// 优先：Mixamo 标准命名精确映射（默认素体 xbot.glb）；兜底：region+side 模糊匹配（上传模型）。
const MIXAMO_ROLE_NAMES: Record<JointRole, string[]> = {
  spine: ['spine1', 'spine'],
  neck: ['neck'],
  shoulderL: ['leftarm'],
  elbowL: ['leftforearm'],
  shoulderR: ['rightarm'],
  elbowR: ['rightforearm'],
  hipL: ['leftupleg'],
  kneeL: ['leftleg'],
  hipR: ['rightupleg'],
  kneeR: ['rightleg'],
}

function normName(name: string): string {
  return name.toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/[\s._-]/g, '')
}

function side(name: string): 'L' | 'R' | null {
  const n = name.toLowerCase()
  if (/(_l(_|$|\d)|l_|left)/.test(n)) return 'L'
  if (/(_r(_|$|\d)|r_|right)/.test(n)) return 'R'
  return null
}
function region(name: string): 'arm' | 'leg' | 'torso' | 'neck' | null {
  const n = name.toLowerCase()
  if (n.includes('arm')) return 'arm'
  if (n.includes('leg')) return 'leg'
  if (n.includes('torso') || n.includes('spine')) return 'torso'
  if (n.includes('neck') || n.includes('head')) return 'neck'
  return null
}
function depth(o: THREE.Object3D): number {
  let d = 0, p = o.parent
  while (p) { d++; p = p.parent }
  return d
}

export function mapBones(root: THREE.Object3D): Partial<Record<JointRole, THREE.Object3D>> {
  const bones: THREE.Object3D[] = []
  root.traverse((o) => {
    if ((o as any).isBone || o.type === 'Bone') bones.push(o)
  })
  // 1) Mixamo 精确映射
  const exact: Partial<Record<JointRole, THREE.Object3D>> = {}
  const byName = new Map(bones.map((b) => [normName(b.name), b]))
  for (const role of Object.keys(MIXAMO_ROLE_NAMES) as JointRole[]) {
    for (const cand of MIXAMO_ROLE_NAMES[role]) {
      const hit = byName.get(cand)
      if (hit) { exact[role] = hit; break }
    }
  }
  if (Object.keys(exact).length >= 8) return exact
  // 2) 模糊匹配：按 region+side 分组、再按层级深度排序，定位肩→肘、髋→膝
  const groups: Record<string, THREE.Object3D[]> = {}
  for (const o of bones) {
    const r = region(o.name); if (!r) continue
    const s = side(o.name)
    const key = r === 'torso' || r === 'neck' ? r : `${r}${s ?? ''}`
    ;(groups[key] ||= []).push(o)
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => depth(a) - depth(b))
  const map: Partial<Record<JointRole, THREE.Object3D>> = {}
  const armL = groups['armL'] || [], armR = groups['armR'] || []
  const legL = groups['legL'] || [], legR = groups['legR'] || []
  const torso = groups['torso'] || [], neck = groups['neck'] || []
  if (armL[0]) map.shoulderL = armL[0]; if (armL[1]) map.elbowL = armL[1]
  if (armR[0]) map.shoulderR = armR[0]; if (armR[1]) map.elbowR = armR[1]
  if (legL[0]) map.hipL = legL[0]; if (legL[1]) map.kneeL = legL[1]
  if (legR[0]) map.hipR = legR[0]; if (legR[1]) map.kneeR = legR[1]
  if (torso[Math.floor(torso.length / 2)]) map.spine = torso[Math.floor(torso.length / 2)]
  if (neck[0]) map.neck = neck[0]
  return { ...map, ...exact }
}

// —— 姿势标定与应用（解剖学规范坐标系，骨骼局部轴无关）——
//
// 规范坐标系（角色空间）：X=角色左、Y=上、Z=面朝方向。由肩线推导（左肩-右肩 → left 轴）。
// 预设/滑块中的欧拉角（'XYZ'，z 先转）一律按此坐标系解释：
//   spine/neck: x+前倾(低头) y+左转 z+右倾
//   shoulderL:  z+抬起 z-放下 x-前摆 x+后摆；shoulderR: z 取反
//   elbowL:     y-弯曲；elbowR: y+弯曲（绕 y 轴！）
//   hip:        x-前抬腿 x+后摆；hipL z+外展，hipR z-外展
//   knee:       x+弯曲（小腿向后折）
//
// 应用公式：local = P⁻¹ · Ĉ · P · local0，其中 P=该骨父级绑定姿态世界四元数（根相对）、
// Ĉ=basis·Euler·basis⁻¹（规范系→根系）。祖先关节的增量在推导中相消，链式解剖跟随天然成立，
// 对任意绑定局部轴（含上传模型）都给出同样的世界空间效果。

type JointCalib = { bone: THREE.Object3D; baseQuat: THREE.Quaternion; parentBind: THREE.Quaternion; parentBindInv: THREE.Quaternion }

export type RigState = {
  roles: Partial<Record<JointRole, THREE.Object3D>>
  joints: Partial<Record<JointRole, JointCalib>>
  basis: THREE.Quaternion
  basisInv: THREE.Quaternion
  allBones: THREE.Object3D[]
  bindMinY: number   // 绑定姿态下全骨骼最低点（根内容空间）
  bindPosY: number   // 标定时根节点 position.y（归一化落地后）
  scaleY: number     // 根 y 缩放（内容空间 → 父级空间）
}

/** 在根节点尚未挂入场景树时调用（useMemo 内），以根内容空间完成标定 */
export function calibrateRig(root: THREE.Object3D): RigState {
  root.updateMatrixWorld(true)
  const roles = mapBones(root)
  const rootInv = root.matrixWorld.clone().invert()
  const localPos = (o: THREE.Object3D) =>
    new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld))

  // 规范系 basis：left 来自肩线，up=+Y，forward=left×up
  let basis = new THREE.Quaternion()
  if (roles.shoulderL && roles.shoulderR) {
    const left = localPos(roles.shoulderL).sub(localPos(roles.shoulderR))
    left.y = 0
    if (left.lengthSq() > 1e-8) {
      left.normalize()
      const up = new THREE.Vector3(0, 1, 0)
      const forward = new THREE.Vector3().crossVectors(left, up).normalize()
      const left2 = new THREE.Vector3().crossVectors(up, forward).normalize()
      basis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(left2, up, forward))
    }
  }

  const rootWorldQuatInv = root.getWorldQuaternion(new THREE.Quaternion()).invert()
  const joints: Partial<Record<JointRole, JointCalib>> = {}
  for (const [role, bone] of Object.entries(roles) as [JointRole, THREE.Object3D][]) {
    if (!bone) continue
    const parentBind = bone.parent
      ? rootWorldQuatInv.clone().multiply(bone.parent.getWorldQuaternion(new THREE.Quaternion()))
      : new THREE.Quaternion()
    joints[role] = { bone, baseQuat: bone.quaternion.clone(), parentBind, parentBindInv: parentBind.clone().invert() }
  }

  const allBones: THREE.Object3D[] = []
  root.traverse((o) => { if ((o as any).isBone || o.type === 'Bone') allBones.push(o) })
  let bindMinY = Infinity
  for (const b of allBones) bindMinY = Math.min(bindMinY, localPos(b).y)
  if (!Number.isFinite(bindMinY)) bindMinY = 0

  return {
    roles, joints, basis, basisInv: basis.clone().invert(), allBones,
    bindMinY, bindPosY: root.position.y, scaleY: root.scale.y,
  }
}

const _e = new THREE.Euler()
const _c = new THREE.Quaternion()
const _q = new THREE.Quaternion()
const _m = new THREE.Matrix4()
const _v = new THREE.Vector3()

/** 应用姿势：复位到绑定姿态 → 叠加规范系旋转 → 自动落地（最低骨点回到绑定高度，跪/坐不悬空） */
export function applyPoseToRig(root: THREE.Object3D, rig: RigState, pose: PoseMap | undefined): void {
  for (const j of Object.values(rig.joints)) j?.bone.quaternion.copy(j.baseQuat)
  if (pose) {
    for (const [role, eul] of Object.entries(pose) as [JointRole, Euler3][]) {
      const j = rig.joints[role]
      if (!j || !eul) continue
      _c.setFromEuler(_e.set(eul[0], eul[1], eul[2], 'XYZ'))
      // Ĉ = basis · C · basis⁻¹ ；local = P⁻¹ · Ĉ · P · local0
      _q.copy(j.parentBindInv).multiply(rig.basis).multiply(_c).multiply(rig.basisInv).multiply(j.parentBind)
      j.bone.quaternion.copy(_q.multiply(j.baseQuat))
    }
  }
  // 自动落地
  root.position.y = rig.bindPosY
  root.updateMatrixWorld(true)
  const rootInv = _m.copy(root.matrixWorld).invert()
  let minY = Infinity
  for (const b of rig.allBones) {
    _v.setFromMatrixPosition(b.matrixWorld).applyMatrix4(rootInv)
    if (_v.y < minY) minY = _v.y
  }
  if (Number.isFinite(minY)) root.position.y = rig.bindPosY + (rig.bindMinY - minY) * rig.scaleY
}

/**
 * applyPoseToRig 的蒙版变体（轻量动画分层用）：
 * - 只复位/写 `roles` 内的关节；roles 外关节**保持调用前的值**（让 baked mixer 驱动的腿不被覆盖）。
 * - opts.autoLand 默认 false：有 locomotion 时地面归位交给 baked + 根路径，跳过逐帧脚高扫描避免打架。
 * roles=ALL_JOINT_ROLES + autoLand:true 时与 applyPoseToRig 逐骨等价。
 */
export function applyPosePartialToRig(
  root: THREE.Object3D,
  rig: RigState,
  pose: PoseMap | undefined,
  roles: JointRole[],
  opts?: { autoLand?: boolean },
): void {
  const roleSet = new Set(roles)
  // 1) 只复位蒙版内关节到绑定姿态
  for (const role of roles) {
    const j = rig.joints[role]
    if (j) j.bone.quaternion.copy(j.baseQuat)
  }
  // 2) 叠加蒙版内、且 pose 提供了的关节
  if (pose) {
    for (const [role, eul] of Object.entries(pose) as [JointRole, [number, number, number]][]) {
      if (!roleSet.has(role)) continue
      const j = rig.joints[role]
      if (!j || !eul) continue
      _c.setFromEuler(_e.set(eul[0], eul[1], eul[2], 'XYZ'))
      _q.copy(j.parentBindInv).multiply(rig.basis).multiply(_c).multiply(rig.basisInv).multiply(j.parentBind)
      j.bone.quaternion.copy(_q.multiply(j.baseQuat))
    }
  }
  // 3) 自动落地（可选）：与 applyPoseToRig 一致
  if (opts?.autoLand) {
    root.position.y = rig.bindPosY
    root.updateMatrixWorld(true)
    const rootInv = _m.copy(root.matrixWorld).invert()
    let minY = Infinity
    for (const b of rig.allBones) {
      _v.setFromMatrixPosition(b.matrixWorld).applyMatrix4(rootInv)
      if (_v.y < minY) minY = _v.y
    }
    if (Number.isFinite(minY)) root.position.y = rig.bindPosY + (rig.bindMinY - minY) * rig.scaleY
  }
}

/**
 * 从骨骼当前局部四元数反解规范系欧拉角（applyPoseToRig 的精确逆），供视口直接拖拽
 * 骨骼的 rotate gizmo 在松手时回写 pose：
 *   local = P⁻¹·B·C·B⁻¹·P·local0  →  C = B⁻¹·P·local·local0⁻¹·P⁻¹·B
 * 反解出的欧拉角再经 applyPoseToRig 重放，必定还原出相同的局部四元数（所见即所得）。
 */
export function poseEulerFromRig(rig: RigState, role: JointRole): Euler3 | null {
  const j = rig.joints[role]
  if (!j) return null
  const q = rig.basisInv.clone()
    .multiply(j.parentBind)
    .multiply(j.bone.quaternion)
    .multiply(j.baseQuat.clone().invert())
    .multiply(j.parentBindInv)
    .multiply(rig.basis)
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
  return [e.x, e.y, e.z]
}

// 逐关节滑块定义（UI 用，单位度，控制单一旋转轴）
// part：分部位 tab 分组（对齐竞品「头部/躯干/左臂/右臂/左腿/右腿」）
export type PartKey = '头部' | '躯干' | '左臂' | '右臂' | '左腿' | '右腿'
export const JOINT_PARTS: PartKey[] = ['头部', '躯干', '左臂', '右臂', '左腿', '右腿']
export type JointSlider = { role: JointRole; axis: 0 | 1 | 2; label: string; min: number; max: number; part: PartKey }
export const JOINT_SLIDERS: JointSlider[] = [
  { role: 'spine', axis: 0, label: '躯干前倾', min: -45, max: 45, part: '躯干' },
  { role: 'spine', axis: 1, label: '躯干转身', min: -60, max: 60, part: '躯干' },
  { role: 'spine', axis: 2, label: '躯干侧倾', min: -30, max: 30, part: '躯干' },
  { role: 'neck', axis: 0, label: '头部俯仰', min: -40, max: 40, part: '头部' },
  { role: 'neck', axis: 1, label: '头部转动', min: -60, max: 60, part: '头部' },
  { role: 'shoulderL', axis: 2, label: '左肩抬降（+抬）', min: -90, max: 135, part: '左臂' },
  { role: 'shoulderL', axis: 0, label: '左臂前后（-前）', min: -120, max: 45, part: '左臂' },
  { role: 'elbowL', axis: 1, label: '左肘弯曲（-弯）', min: -140, max: 5, part: '左臂' },
  { role: 'shoulderR', axis: 2, label: '右肩抬降（-抬）', min: -135, max: 90, part: '右臂' },
  { role: 'shoulderR', axis: 0, label: '右臂前后（-前）', min: -120, max: 45, part: '右臂' },
  { role: 'elbowR', axis: 1, label: '右肘弯曲（+弯）', min: -5, max: 140, part: '右臂' },
  { role: 'hipL', axis: 0, label: '左髋抬腿（-前）', min: -100, max: 45, part: '左腿' },
  { role: 'kneeL', axis: 0, label: '左膝弯曲（+弯）', min: -5, max: 140, part: '左腿' },
  { role: 'hipR', axis: 0, label: '右髋抬腿（-前）', min: -100, max: 45, part: '右腿' },
  { role: 'kneeR', axis: 0, label: '右膝弯曲（+弯）', min: -5, max: 140, part: '右腿' },
]

// 姿势预设（弧度，规范坐标系，见上方注释）。基于标准 Mixamo T-pose 骨架（xbot.glb）校准。
// 镜像规则：左右对称姿势 R = L 的 y、z 取反，x 同号。
export type PosePreset = { id: string; name: string; category: string; pose: PoseMap }
export const POSE_PRESETS: PosePreset[] = [
  // —— 基础 ——
  { id: 'stand', name: '站立', category: '基础', pose: { shoulderL: [0, 0, deg(-72)], elbowL: [0, deg(-6), 0], shoulderR: [0, 0, deg(72)], elbowR: [0, deg(6), 0] } },
  { id: 'tpose', name: 'T型', category: '基础', pose: {} },
  { id: 'arms-down', name: '立正', category: '基础', pose: { shoulderL: [0, 0, deg(-78)], shoulderR: [0, 0, deg(78)] } },
  { id: 'akimbo', name: '叉腰', category: '基础', pose: { shoulderL: [deg(25), 0, deg(-50)], elbowL: [0, deg(-105), 0], shoulderR: [deg(25), 0, deg(50)], elbowR: [0, deg(105), 0] } },
  { id: 'crossed', name: '抱臂', category: '基础', pose: { shoulderL: [deg(-40), 0, deg(-60)], elbowL: [0, deg(-120), 0], shoulderR: [deg(-40), 0, deg(60)], elbowR: [0, deg(120), 0], spine: [deg(5), 0, 0] } },
  { id: 'hands-behind', name: '负手而立', category: '基础', pose: { shoulderL: [deg(32), 0, deg(-70)], elbowL: [0, deg(-75), 0], shoulderR: [deg(32), 0, deg(70)], elbowR: [0, deg(75), 0], spine: [deg(-4), 0, 0], neck: [deg(-6), 0, 0] } },
  { id: 'pockets', name: '插兜', category: '基础', pose: { shoulderL: [deg(12), 0, deg(-68)], elbowL: [0, deg(-30), 0], shoulderR: [deg(12), 0, deg(68)], elbowR: [0, deg(30), 0], spine: [deg(-3), 0, 0] } },
  // —— 坐跪 ——
  { id: 'sit', name: '坐姿', category: '坐跪', pose: { hipL: [deg(-85), 0, 0], kneeL: [deg(85), 0, 0], hipR: [deg(-85), 0, 0], kneeR: [deg(85), 0, 0], shoulderL: [0, 0, deg(-70)], elbowL: [0, deg(-15), 0], shoulderR: [0, 0, deg(70)], elbowR: [0, deg(15), 0] } },
  { id: 'squat', name: '蹲下', category: '坐跪', pose: { hipL: [deg(-100), 0, 0], kneeL: [deg(120), 0, 0], hipR: [deg(-100), 0, 0], kneeR: [deg(120), 0, 0], spine: [deg(18), 0, 0], shoulderL: [deg(-35), 0, deg(-45)], elbowL: [0, deg(-35), 0], shoulderR: [deg(-35), 0, deg(45)], elbowR: [0, deg(35), 0] } },
  { id: 'kneel', name: '单膝跪', category: '坐跪', pose: { hipR: [deg(10), 0, 0], kneeR: [deg(105), 0, 0], hipL: [deg(-80), 0, 0], kneeL: [deg(90), 0, 0], spine: [deg(5), 0, 0], shoulderL: [0, 0, deg(-68)], shoulderR: [0, 0, deg(68)] } },
  { id: 'seiza', name: '跪坐', category: '坐跪', pose: { hipL: [deg(5), 0, 0], kneeL: [deg(140), 0, 0], hipR: [deg(5), 0, 0], kneeR: [deg(140), 0, 0], spine: [deg(2), 0, 0], shoulderL: [deg(-15), 0, deg(-65)], elbowL: [0, deg(-30), 0], shoulderR: [deg(-15), 0, deg(65)], elbowR: [0, deg(30), 0] } },
  { id: 'cross-legged', name: '盘腿坐', category: '坐跪', pose: { hipL: [deg(-75), 0, deg(45)], kneeL: [deg(130), 0, 0], hipR: [deg(-75), 0, deg(-45)], kneeR: [deg(130), 0, 0], spine: [deg(8), 0, 0], shoulderL: [deg(-20), 0, deg(-60)], elbowL: [0, deg(-50), 0], shoulderR: [deg(-20), 0, deg(60)], elbowR: [0, deg(50), 0] } },
  { id: 'beg', name: '跪地哀求', category: '坐跪', pose: { hipL: [deg(8), 0, 0], kneeL: [deg(130), 0, 0], hipR: [deg(8), 0, 0], kneeR: [deg(130), 0, 0], spine: [deg(20), 0, 0], neck: [deg(15), 0, 0], shoulderL: [deg(-60), 0, deg(-35)], elbowL: [0, deg(-45), 0], shoulderR: [deg(-60), 0, deg(35)], elbowR: [0, deg(45), 0] } },
  // —— 行动 ——
  { id: 'walk', name: '行走', category: '行动', pose: { hipL: [deg(-25), 0, 0], hipR: [deg(18), 0, 0], kneeR: [deg(25), 0, 0], shoulderL: [deg(22), 0, deg(-70)], elbowL: [0, deg(-20), 0], shoulderR: [deg(-22), 0, deg(70)], elbowR: [0, deg(25), 0] } },
  { id: 'run', name: '奔跑', category: '行动', pose: { spine: [deg(12), 0, 0], neck: [deg(-5), 0, 0], hipL: [deg(-50), 0, 0], kneeL: [deg(60), 0, 0], hipR: [deg(30), 0, 0], kneeR: [deg(70), 0, 0], shoulderL: [deg(25), 0, deg(-65)], elbowL: [0, deg(-95), 0], shoulderR: [deg(-30), 0, deg(65)], elbowR: [0, deg(90), 0] } },
  { id: 'jump', name: '跳跃', category: '行动', pose: { spine: [deg(-6), 0, 0], hipL: [deg(-40), 0, 0], kneeL: [deg(75), 0, 0], hipR: [deg(-40), 0, 0], kneeR: [deg(75), 0, 0], shoulderL: [deg(-20), 0, deg(-30)], elbowL: [0, deg(-20), 0], shoulderR: [deg(-20), 0, deg(30)], elbowR: [0, deg(20), 0] } },
  { id: 'sprint', name: '冲刺起跑', category: '行动', pose: { spine: [deg(30), 0, 0], neck: [deg(-15), 0, 0], hipL: [deg(-60), 0, 0], kneeL: [deg(80), 0, 0], hipR: [deg(25), 0, 0], kneeR: [deg(25), 0, 0], shoulderL: [deg(30), 0, deg(-60)], elbowL: [0, deg(-90), 0], shoulderR: [deg(-35), 0, deg(60)], elbowR: [0, deg(90), 0] } },
  { id: 'push', name: '用力推', category: '行动', pose: { shoulderL: [deg(-75), 0, deg(-12)], elbowL: [0, deg(-10), 0], shoulderR: [deg(-75), 0, deg(12)], elbowR: [0, deg(10), 0], spine: [deg(14), 0, 0], hipL: [deg(-30), 0, 0], kneeL: [deg(35), 0, 0], hipR: [deg(20), 0, 0], kneeR: [deg(10), 0, 0] } },
  { id: 'carry', name: '搬重物', category: '行动', pose: { shoulderL: [deg(-30), 0, deg(-55)], elbowL: [0, deg(-100), 0], shoulderR: [deg(-30), 0, deg(55)], elbowR: [0, deg(100), 0], spine: [deg(-8), 0, 0], hipL: [deg(-20), 0, 0], kneeL: [deg(30), 0, 0], hipR: [deg(-20), 0, 0], kneeR: [deg(30), 0, 0] } },
  { id: 'climb', name: '攀爬', category: '行动', pose: { shoulderL: [deg(-20), 0, deg(80)], elbowL: [0, deg(-25), 0], shoulderR: [deg(-45), 0, deg(40)], elbowR: [0, deg(55), 0], hipL: [deg(-70), 0, 0], kneeL: [deg(95), 0, 0], hipR: [deg(10), 0, 0], spine: [deg(10), 0, 0], neck: [deg(-18), 0, 0] } },
  { id: 'stretch', name: '伸懒腰', category: '行动', pose: { shoulderL: [0, 0, deg(85)], elbowL: [0, deg(-10), 0], shoulderR: [0, 0, deg(-85)], elbowR: [0, deg(10), 0], spine: [deg(-12), 0, 0], neck: [deg(-15), 0, 0] } },
  { id: 'dance', name: '舞姿', category: '行动', pose: { shoulderL: [0, 0, deg(55)], elbowL: [0, deg(-20), 0], shoulderR: [0, 0, deg(20)], elbowR: [0, deg(30), 0], spine: [0, deg(8), deg(-10)], hipR: [deg(-25), 0, deg(-20)], kneeR: [deg(50), 0, 0], neck: [0, deg(-10), deg(5)] } },
  // —— 武戏 ——
  { id: 'salute-fist', name: '抱拳行礼', category: '武戏', pose: { shoulderL: [deg(-55), 0, deg(-35)], elbowL: [0, deg(-110), 0], shoulderR: [deg(-55), 0, deg(35)], elbowR: [0, deg(110), 0], neck: [deg(10), 0, 0], spine: [deg(8), 0, 0] } },
  { id: 'punch', name: '出拳', category: '武戏', pose: { shoulderR: [deg(-80), 0, deg(15)], elbowR: [0, deg(8), 0], shoulderL: [deg(-45), 0, deg(-35)], elbowL: [0, deg(-115), 0], spine: [deg(5), deg(25), 0], neck: [0, deg(-18), 0], hipL: [deg(-15), 0, 0], hipR: [deg(12), 0, 0], kneeR: [deg(25), 0, 0] } },
  { id: 'block', name: '格挡', category: '武戏', pose: { shoulderL: [deg(-55), 0, deg(-30)], elbowL: [0, deg(-105), 0], shoulderR: [deg(-55), 0, deg(30)], elbowR: [0, deg(105), 0], spine: [deg(8), 0, 0], hipL: [deg(-12), 0, 0], kneeL: [deg(18), 0, 0], hipR: [deg(6), 0, 0], kneeR: [deg(12), 0, 0] } },
  { id: 'kick', name: '踢腿', category: '武戏', pose: { hipR: [deg(-95), 0, 0], kneeR: [deg(20), 0, 0], spine: [deg(-10), 0, 0], hipL: [deg(5), 0, 0], shoulderL: [0, 0, deg(-30)], elbowL: [0, deg(-15), 0], shoulderR: [deg(15), 0, deg(50)], elbowR: [0, deg(20), 0] } },
  { id: 'horse-stance', name: '马步', category: '武戏', pose: { hipL: [deg(-35), 0, deg(30)], kneeL: [deg(70), 0, 0], hipR: [deg(-35), 0, deg(-30)], kneeR: [deg(70), 0, 0], shoulderL: [deg(20), 0, deg(-60)], elbowL: [0, deg(-110), 0], shoulderR: [deg(20), 0, deg(60)], elbowR: [0, deg(110), 0], spine: [deg(5), 0, 0] } },
  { id: 'lunge', name: '弓步', category: '武戏', pose: { hipL: [deg(-55), 0, deg(8)], kneeL: [deg(65), 0, 0], hipR: [deg(20), 0, deg(-8)], kneeR: [deg(8), 0, 0], spine: [deg(6), deg(-20), 0], shoulderL: [deg(-75), 0, deg(-15)], elbowL: [0, deg(-10), 0], shoulderR: [deg(20), 0, deg(60)], elbowR: [0, deg(115), 0] } },
  { id: 'sword', name: '持剑式', category: '武戏', pose: { shoulderR: [deg(-65), 0, deg(25)], elbowR: [0, deg(20), 0], shoulderL: [deg(10), 0, deg(30)], elbowL: [0, deg(-25), 0], spine: [deg(5), deg(-25), 0], neck: [0, deg(22), 0], hipL: [deg(-25), 0, 0], kneeL: [deg(30), 0, 0], hipR: [deg(15), 0, 0], kneeR: [deg(10), 0, 0] } },
  { id: 'aim', name: '持枪瞄准', category: '武戏', pose: { shoulderR: [deg(-78), 0, deg(10)], elbowR: [0, deg(6), 0], shoulderL: [deg(-70), 0, deg(-15)], elbowL: [0, deg(-40), 0], spine: [deg(3), deg(-10), 0], neck: [deg(4), deg(-6), 0], hipL: [deg(-6), 0, 0], kneeL: [deg(8), 0, 0] } },
  { id: 'archery', name: '拉弓', category: '武戏', pose: { shoulderL: [deg(-75), 0, deg(-5)], elbowL: [0, deg(-5), 0], shoulderR: [deg(15), 0, deg(-5)], elbowR: [0, deg(125), 0], spine: [0, deg(-30), 0], neck: [0, deg(28), 0], hipL: [deg(-8), 0, deg(10)], hipR: [deg(6), 0, deg(-10)] } },
  { id: 'throw', name: '投掷', category: '武戏', pose: { shoulderR: [deg(25), 0, deg(-75)], elbowR: [0, deg(80), 0], shoulderL: [deg(-55), 0, deg(-25)], elbowL: [0, deg(-15), 0], spine: [deg(-8), deg(-20), 0], hipL: [deg(-25), 0, 0], kneeL: [deg(20), 0, 0], hipR: [deg(10), 0, 0], kneeR: [deg(15), 0, 0] } },
  { id: 'taichi', name: '太极云手', category: '武戏', pose: { shoulderL: [deg(-45), 0, deg(-35)], elbowL: [0, deg(-60), 0], shoulderR: [deg(-40), 0, deg(40)], elbowR: [0, deg(70), 0], spine: [deg(4), deg(18), 0], hipL: [deg(-18), 0, deg(12)], kneeL: [deg(35), 0, 0], hipR: [deg(-18), 0, deg(-12)], kneeR: [deg(35), 0, 0] } },
  // —— 交流 ——
  { id: 'wave', name: '招手', category: '交流', pose: { shoulderR: [0, 0, deg(-70)], elbowR: [0, deg(45), 0], shoulderL: [0, 0, deg(-72)], elbowL: [0, deg(-5), 0] } },
  { id: 'reach', name: '伸手', category: '交流', pose: { shoulderR: [deg(-75), 0, deg(70)], elbowR: [0, deg(10), 0], shoulderL: [0, 0, deg(-72)] } },
  { id: 'point', name: '指斥', category: '交流', pose: { shoulderR: [deg(-75), 0, deg(20)], elbowR: [0, deg(5), 0], shoulderL: [deg(5), 0, deg(-70)], spine: [deg(4), deg(10), 0], neck: [0, deg(-5), 0] } },
  { id: 'bow', name: '鞠躬', category: '交流', pose: { spine: [deg(45), 0, 0], neck: [deg(12), 0, 0], shoulderL: [0, 0, deg(-75)], shoulderR: [0, 0, deg(75)] } },
  { id: 'assist', name: '搀扶', category: '交流', pose: { spine: [deg(12), 0, deg(-6)], shoulderL: [deg(-50), 0, deg(-35)], elbowL: [0, deg(-55), 0], shoulderR: [deg(-30), 0, deg(40)], elbowR: [0, deg(75), 0], hipL: [deg(-12), 0, 0], kneeL: [deg(18), 0, 0] } },
  { id: 'clap', name: '鼓掌', category: '交流', pose: { shoulderL: [deg(-50), 0, deg(-38)], elbowL: [0, deg(-80), 0], shoulderR: [deg(-50), 0, deg(38)], elbowR: [0, deg(80), 0], neck: [deg(-4), 0, 0] } },
  { id: 'cheer', name: '欢呼', category: '交流', pose: { shoulderL: [0, 0, deg(75)], elbowL: [0, deg(-15), 0], shoulderR: [0, 0, deg(-75)], elbowR: [0, deg(15), 0], spine: [deg(-8), 0, 0], neck: [deg(-15), 0, 0] } },
  { id: 'pray', name: '双手合十', category: '交流', pose: { shoulderL: [deg(-40), 0, deg(-45)], elbowL: [0, deg(-115), 0], shoulderR: [deg(-40), 0, deg(45)], elbowR: [0, deg(115), 0], neck: [deg(14), 0, 0], spine: [deg(6), 0, 0] } },
  { id: 'salute', name: '敬礼', category: '交流', pose: { shoulderR: [deg(-30), 0, deg(10)], elbowR: [0, deg(135), 0], shoulderL: [0, 0, deg(-75)], spine: [deg(-3), 0, 0] } },
  { id: 'phone', name: '打电话', category: '交流', pose: { shoulderR: [deg(-15), 0, deg(55)], elbowR: [0, deg(140), 0], neck: [deg(3), deg(-8), deg(10)], shoulderL: [0, 0, deg(-72)], elbowL: [0, deg(-10), 0] } },
  { id: 'offer', name: '双手呈递', category: '交流', pose: { shoulderL: [deg(-55), 0, deg(-45)], elbowL: [0, deg(-55), 0], shoulderR: [deg(-55), 0, deg(45)], elbowR: [0, deg(55), 0], spine: [deg(10), 0, 0], neck: [deg(8), 0, 0] } },
  { id: 'hug', name: '张臂相拥', category: '交流', pose: { shoulderL: [deg(-65), 0, deg(-25)], elbowL: [0, deg(-35), 0], shoulderR: [deg(-65), 0, deg(25)], elbowR: [0, deg(35), 0], spine: [deg(3), 0, 0] } },
  // —— 情绪 ——
  { id: 'think', name: '思考', category: '情绪', pose: { shoulderR: [deg(-25), 0, deg(50)], elbowR: [0, deg(135), 0], shoulderL: [0, 0, deg(-65)], elbowL: [0, deg(-90), 0], neck: [deg(12), 0, deg(-6)], spine: [deg(8), 0, 0] } },
  { id: 'roar', name: '怒吼', category: '情绪', pose: { spine: [deg(-10), 0, 0], neck: [deg(-18), 0, 0], shoulderL: [deg(10), 0, deg(-45)], elbowL: [0, deg(-70), 0], shoulderR: [deg(10), 0, deg(45)], elbowR: [0, deg(70), 0] } },
  { id: 'clutch-belly', name: '捂腹受伤', category: '情绪', pose: { spine: [deg(28), 0, 0], neck: [deg(15), 0, 0], shoulderL: [deg(-30), 0, deg(-55)], elbowL: [0, deg(-105), 0], shoulderR: [deg(-30), 0, deg(55)], elbowR: [0, deg(105), 0], hipL: [deg(-15), 0, 0], kneeL: [deg(20), 0, 0], hipR: [deg(-15), 0, 0], kneeR: [deg(20), 0, 0] } },
  { id: 'stagger', name: '踉跄后仰', category: '情绪', pose: { spine: [deg(-20), 0, deg(6)], neck: [deg(-15), 0, 0], shoulderL: [deg(-35), 0, deg(-30)], elbowL: [0, deg(-25), 0], shoulderR: [deg(20), 0, deg(40)], elbowR: [0, deg(35), 0], hipL: [deg(-22), 0, 0], kneeL: [deg(15), 0, 0], hipR: [deg(12), 0, 0], kneeR: [deg(20), 0, 0] } },
  { id: 'cover-head', name: '抱头畏缩', category: '情绪', pose: { spine: [deg(22), 0, 0], neck: [deg(22), 0, 0], shoulderL: [deg(-65), 0, deg(-10)], elbowL: [0, deg(-135), 0], shoulderR: [deg(-65), 0, deg(10)], elbowR: [0, deg(135), 0], hipL: [deg(-25), 0, 0], kneeL: [deg(40), 0, 0], hipR: [deg(-25), 0, 0], kneeR: [deg(40), 0, 0] } },
  { id: 'dejected', name: '低头沮丧', category: '情绪', pose: { spine: [deg(12), 0, 0], neck: [deg(25), 0, 0], shoulderL: [deg(6), 0, deg(-74)], elbowL: [0, deg(-6), 0], shoulderR: [deg(6), 0, deg(74)], elbowR: [0, deg(6), 0] } },
  { id: 'look-up', name: '仰望', category: '情绪', pose: { neck: [deg(-28), 0, 0], spine: [deg(-8), 0, 0], shoulderL: [0, 0, deg(-72)], shoulderR: [0, 0, deg(72)] } },
  { id: 'cover-face', name: '掩面而泣', category: '情绪', pose: { shoulderL: [deg(-45), 0, deg(-30)], elbowL: [0, deg(-135), 0], shoulderR: [deg(-45), 0, deg(30)], elbowR: [0, deg(135), 0], neck: [deg(14), 0, 0], spine: [deg(8), 0, 0] } },
  { id: 'shocked', name: '惊愕后仰', category: '情绪', pose: { spine: [deg(-12), 0, 0], neck: [deg(-8), 0, 0], shoulderL: [deg(-40), 0, deg(-40)], elbowL: [0, deg(-65), 0], shoulderR: [deg(-40), 0, deg(40)], elbowR: [0, deg(65), 0], hipR: [deg(15), 0, 0], kneeR: [deg(10), 0, 0] } },
  { id: 'listen', name: '侧耳倾听', category: '情绪', pose: { neck: [deg(2), deg(25), deg(8)], spine: [deg(2), deg(15), 0], shoulderR: [deg(-10), 0, deg(55)], elbowR: [0, deg(130), 0], shoulderL: [0, 0, deg(-72)] } },
  { id: 'shield-eyes', name: '手搭凉棚', category: '情绪', pose: { shoulderR: [deg(-40), 0, deg(18)], elbowR: [0, deg(135), 0], neck: [deg(-12), 0, 0], spine: [deg(-4), 0, 0], shoulderL: [0, 0, deg(-72)], elbowL: [0, deg(-5), 0] } },
]

// 预设分类的顺序与文案（chip 行用；'收藏'/'自定义' 为动态类）
export const POSE_CATEGORIES = ['基础', '坐跪', '行动', '武戏', '交流', '情绪'] as const

// 每个预设的 emoji 图标（对齐竞品的图标网格）。缺省按 category 兜底。
const CATEGORY_ICON: Record<string, string> = {
  基础: '🧍', 坐跪: '🧎', 行动: '🏃', 武戏: '⚔️', 交流: '💬', 情绪: '🎭', 自定义: '⭐', 收藏: '⭐',
}
export const POSE_ICONS: Record<string, string> = {
  // 基础
  stand: '🧍', tpose: '➕', 'arms-down': '🧍', akimbo: '💁', crossed: '🙅', 'hands-behind': '🕴️', pockets: '🧥',
  // 坐跪
  sit: '🪑', squat: '🧎', kneel: '🧎', seiza: '🙇', 'cross-legged': '🧘', beg: '🙏',
  // 行动
  walk: '🚶', run: '🏃', jump: '🤸', sprint: '🏃', push: '🫷', carry: '📦', climb: '🧗', stretch: '🙆', dance: '💃',
  // 武戏
  'salute-fist': '🙇', punch: '👊', block: '🛡️', kick: '🦵', 'horse-stance': '🐴', lunge: '🤺', sword: '⚔️', aim: '🔫', archery: '🏹', throw: '🤾', taichi: '☯️',
  // 交流
  wave: '👋', reach: '🫳', point: '👉', bow: '🙇', assist: '🤝', clap: '👏', cheer: '🙌', pray: '🙏', salute: '🫡', phone: '📞', offer: '🤲', hug: '🫂',
  // 情绪
  think: '🤔', roar: '😤', 'clutch-belly': '🤕', stagger: '😵', 'cover-head': '🫣', dejected: '😔', 'look-up': '👀', 'cover-face': '😭', shocked: '😱', listen: '👂', 'shield-eyes': '🔭',
}
export function getPoseIcon(preset: { id: string; category: string }): string {
  return POSE_ICONS[preset.id] ?? CATEGORY_ICON[preset.category] ?? '🧍'
}

// —— 关节集合（轻量动画分层用）——
/** 全部可控关节（顺序固定，供整身动画/遍历）。 */
export const ALL_JOINT_ROLES: JointRole[] = [
  'spine', 'neck', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR',
  'hipL', 'kneeL', 'hipR', 'kneeR',
]
/** 上半身关节（混合动画默认蒙版：姿势关键帧只盖这些，腿留给 baked 位移）。 */
export const UPPER_BODY_ROLES: JointRole[] = ['spine', 'neck', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR']
