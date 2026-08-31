// waveClip.ts —— 程序化挥手动画（mixamorig 骨架通用），无外部资产
import * as THREE from 'three'

/** 欧拉角(度, XYZ 序)→四元数数组 [x,y,z,w] */
function eulerQuat(xDeg: number, yDeg: number, zDeg: number): [number, number, number, number] {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler((xDeg * Math.PI) / 180, (yDeg * Math.PI) / 180, (zDeg * Math.PI) / 180, 'XYZ'),
  )
  return [q.x, q.y, q.z, q.w]
}

/**
 * 解析骨架里真实的运行时骨骼名。
 * ⚠️ GLTFLoader 用 PropertyBinding.sanitizeNodeName 净化节点名——冒号 ':' 是保留字会被剥掉，
 * 所以 glTF 里的 `mixamorig:RightArm` 运行时其实叫 `mixamorigRightArm`。track 名若写带冒号的原始名，
 * 绑定时 ':' 被当目录分隔符 → 解析成不存在的节点 `RightArm` → 静默绑定失败 → 骨骼不动。
 * 故从实际骨架按后缀解析真实名，回退到净化常量。
 */
function resolveBoneName(root: THREE.Object3D | undefined, suffix: string, fallback: string): string {
  let found = ''
  root?.traverse((o) => { if (!found && o.name && o.name.endsWith(suffix)) found = o.name })
  return found || fallback
}

/**
 * 2s 循环挥手：右上臂抬到头侧并左右摆动（可见的挥手），右前臂弯起把手举到头侧。
 * 角度经导演台离屏渲染目视调校（base z=-72±13 摆动、x=8 前送；前臂 bend x=-78）。
 * track 名取自实际骨架（无冒号），保证绑定成功。
 */
export function buildWaveClip(root?: THREE.Object3D): THREE.AnimationClip {
  const upperBone = resolveBoneName(root, 'RightArm', 'mixamorigRightArm')
  const foreBone = resolveBoneName(root, 'RightForeArm', 'mixamorigRightForeArm')
  // 右上臂：抬到头侧（z≈-72、略前送 x=8），左右摆 ±13° 形成挥手节奏
  const upA = eulerQuat(8, 0, -85)
  const upB = eulerQuat(8, 0, -59)
  const upperTrack = new THREE.QuaternionKeyframeTrack(
    `${upperBone}.quaternion`,
    [0, 0.5, 1, 1.5, 2],
    [...upA, ...upB, ...upA, ...upB, ...upA],
  )
  // 右前臂：弯起把手举到头侧（常量）
  const foreBent = eulerQuat(-78, 0, 0)
  const foreTrack = new THREE.QuaternionKeyframeTrack(
    `${foreBone}.quaternion`,
    [0, 2],
    [...foreBent, ...foreBent],
  )
  return new THREE.AnimationClip('wave', 2, [upperTrack, foreTrack])
}
