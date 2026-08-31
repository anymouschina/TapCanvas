// 【内置动画预设库】把 pose.ts 的静态姿势语汇编成「关键帧动画」(PoseClip)，让导演台有一批开箱即用的
// 骨骼动作动画——招手/鞠躬/出拳连击/踉跄/太极…——而不必逐帧手搓。
//
// 复用既有 motionClip 解析链路：character.motionClip = 预设 id → CharacterObject.applyMotion 解析成
// PoseClip 插值播放（实时视口 + 出片 capture 同一条路径）。人(MotionPanel 选择器)与小T(直接写
// motionClip:'<id>') 共用同一套 id，**小T 不必再自定义关键帧**。
//
// 关键帧姿势尽量直接取 POSE_PRESETS（解剖学已校准），镜像帧用 mirror() 生成左右对称动作。

import type { PoseClip, PoseKeyframe } from './poseClip'
import { POSE_PRESETS, deg, type PoseMap, type Euler3, type JointRole } from './pose'

/** 取某静态姿势预设的 pose map（找不到返回空 = rest pose）。 */
const P = (id: string): PoseMap => POSE_PRESETS.find((p) => p.id === id)?.pose ?? {}

/** 浅合并多个 pose map（后者覆盖前者）——在基础姿势上局部改几关节。 */
const m = (...maps: PoseMap[]): PoseMap => Object.assign({}, ...maps)

/** 矢状面镜像：左右关节互换 + 绕 Y/Z 的欧拉角取反，从「右手动作」生成对称的「左手动作」。 */
function mirror(p: PoseMap): PoseMap {
  const swap: Partial<Record<JointRole, JointRole>> = {
    shoulderL: 'shoulderR', shoulderR: 'shoulderL', elbowL: 'elbowR', elbowR: 'elbowL',
    hipL: 'hipR', hipR: 'hipL', kneeL: 'kneeR', kneeR: 'kneeL',
  }
  const out: PoseMap = {}
  for (const [k, v] of Object.entries(p) as [JointRole, Euler3][]) {
    const nk = swap[k] ?? k
    out[nk] = [v[0], -v[1], -v[2]]
  }
  return out
}

const NEUTRAL = P('stand') // 自然站姿（肩臂微垂）作为「回到中立」的落帧

export type MotionPreset = PoseClip & { category: string }

/** 内置动画预设。category 用于 UI 分组；loop=true 的在时间窗内循环，false 的一次性播完冻结末帧。 */
export const MOTION_PRESETS: MotionPreset[] = [
  // ── 待机 ───────────────────────────────────────────────
  {
    id: 'idle-breathe', name: '待机·呼吸', category: '待机', durationSeconds: 3, loop: true,
    keyframes: [
      { t: 0, pose: m(NEUTRAL) },
      { t: 1.5, pose: m(NEUTRAL, { spine: [deg(-3), 0, 0], neck: [deg(-2), 0, 0] }) },
      { t: 3, pose: m(NEUTRAL) },
    ],
  },
  {
    id: 'look-around', name: '待机·张望', category: '待机', durationSeconds: 4.5, loop: true,
    keyframes: [
      { t: 0, pose: m(NEUTRAL) },
      { t: 1.2, pose: m(NEUTRAL, { neck: [0, deg(-35), 0], spine: [0, deg(-8), 0] }) },
      { t: 2.2, pose: m(NEUTRAL) },
      { t: 3.4, pose: m(NEUTRAL, { neck: [0, deg(35), 0], spine: [0, deg(8), 0] }) },
      { t: 4.5, pose: m(NEUTRAL) },
    ],
  },
  {
    id: 'impatient', name: '待机·不耐烦', category: '待机', durationSeconds: 2.5, loop: true,
    keyframes: [
      { t: 0, pose: P('akimbo') },
      { t: 1.25, pose: m(P('akimbo'), { spine: [0, deg(8), 0], neck: [deg(4), deg(8), 0] }) },
      { t: 2.5, pose: P('akimbo') },
    ],
  },

  // ── 交流 ───────────────────────────────────────────────
  {
    id: 'wave-loop', name: '招手（循环）', category: '交流', durationSeconds: 1.2, loop: true,
    keyframes: [
      { t: 0, pose: m(NEUTRAL, { shoulderR: [0, 0, deg(-98)], elbowR: [0, deg(35), 0] }) },
      { t: 0.6, pose: m(NEUTRAL, { shoulderR: [0, 0, deg(-112)], elbowR: [0, deg(75), 0] }) },
      { t: 1.2, pose: m(NEUTRAL, { shoulderR: [0, 0, deg(-98)], elbowR: [0, deg(35), 0] }) },
    ],
  },
  {
    id: 'nod', name: '点头', category: '交流', durationSeconds: 1.2, loop: true,
    keyframes: [
      { t: 0, pose: m(NEUTRAL) },
      { t: 0.6, pose: m(NEUTRAL, { neck: [deg(20), 0, 0] }) },
      { t: 1.2, pose: m(NEUTRAL) },
    ],
  },
  {
    id: 'shake-head', name: '摇头', category: '交流', durationSeconds: 1.4, loop: true,
    keyframes: [
      { t: 0, pose: m(NEUTRAL) },
      { t: 0.45, pose: m(NEUTRAL, { neck: [0, deg(-25), 0] }) },
      { t: 0.95, pose: m(NEUTRAL, { neck: [0, deg(25), 0] }) },
      { t: 1.4, pose: m(NEUTRAL) },
    ],
  },
  {
    id: 'bow-once', name: '鞠躬', category: '交流', durationSeconds: 2.2, loop: false,
    keyframes: [
      { t: 0, pose: m(NEUTRAL) },
      { t: 0.8, pose: P('bow') },
      { t: 1.5, pose: P('bow') },
      { t: 2.2, pose: m(NEUTRAL) },
    ],
  },
  {
    id: 'clap-loop', name: '鼓掌（循环）', category: '交流', durationSeconds: 0.7, loop: true,
    keyframes: [
      { t: 0, pose: m(P('clap'), { elbowL: [0, deg(-55), 0], elbowR: [0, deg(55), 0] }) },
      { t: 0.35, pose: P('clap') },
      { t: 0.7, pose: m(P('clap'), { elbowL: [0, deg(-55), 0], elbowR: [0, deg(55), 0] }) },
    ],
  },
  {
    id: 'salute-once', name: '敬礼', category: '交流', durationSeconds: 1.6, loop: false,
    keyframes: [
      { t: 0, pose: m(NEUTRAL) },
      { t: 0.5, pose: P('salute') },
      { t: 1.6, pose: P('salute') },
    ],
  },
  {
    id: 'cheer-loop', name: '欢呼（循环）', category: '交流', durationSeconds: 1.0, loop: true,
    keyframes: [
      { t: 0, pose: P('cheer') },
      { t: 0.5, pose: m(P('cheer'), { spine: [deg(-14), 0, 0], neck: [deg(-20), 0, 0], hipL: [deg(-10), 0, 0], kneeL: [deg(18), 0, 0], hipR: [deg(-10), 0, 0], kneeR: [deg(18), 0, 0] }) },
      { t: 1.0, pose: P('cheer') },
    ],
  },
  {
    id: 'point-forward', name: '抬手指向', category: '交流', durationSeconds: 1.0, loop: false,
    keyframes: [
      { t: 0, pose: m(NEUTRAL) },
      { t: 0.5, pose: P('point') },
      { t: 1.0, pose: P('point') },
    ],
  },

  // ── 武戏 ───────────────────────────────────────────────
  {
    id: 'punch-combo', name: '出拳连击', category: '武戏', durationSeconds: 1.8, loop: false,
    keyframes: [
      { t: 0, pose: P('block') },
      { t: 0.35, pose: P('punch') },
      { t: 0.7, pose: P('block') },
      { t: 1.1, pose: mirror(P('punch')) },
      { t: 1.45, pose: P('block') },
      { t: 1.8, pose: P('block') },
    ],
  },
  {
    id: 'kick-once', name: '踢腿', category: '武戏', durationSeconds: 1.2, loop: false,
    keyframes: [
      { t: 0, pose: P('block') },
      { t: 0.5, pose: P('kick') },
      { t: 1.0, pose: P('block') },
      { t: 1.2, pose: P('block') },
    ],
  },
  {
    id: 'block-recoil', name: '格挡受击', category: '武戏', durationSeconds: 1.0, loop: false,
    keyframes: [
      { t: 0, pose: P('block') },
      { t: 0.3, pose: m(P('block'), { spine: [deg(14), 0, 0], neck: [deg(8), 0, 0] }) },
      { t: 0.7, pose: m(P('block'), { spine: [deg(-6), 0, 0] }) },
      { t: 1.0, pose: P('block') },
    ],
  },
  {
    id: 'sword-draw', name: '拔剑起手', category: '武戏', durationSeconds: 1.8, loop: false,
    keyframes: [
      { t: 0, pose: m(NEUTRAL) },
      { t: 0.5, pose: P('salute-fist') },
      { t: 1.1, pose: P('sword') },
      { t: 1.8, pose: P('sword') },
    ],
  },
  {
    id: 'taichi-flow', name: '太极云手（循环）', category: '武戏', durationSeconds: 4, loop: true,
    keyframes: [
      { t: 0, pose: P('taichi') },
      { t: 2, pose: mirror(P('taichi')) },
      { t: 4, pose: P('taichi') },
    ],
  },

  // ── 情绪 ───────────────────────────────────────────────
  {
    id: 'stagger-hit', name: '中拳踉跄', category: '情绪', durationSeconds: 1.4, loop: false,
    keyframes: [
      { t: 0, pose: m(NEUTRAL) },
      { t: 0.25, pose: P('stagger') },
      { t: 0.8, pose: m(P('stagger'), { spine: [deg(-10), 0, deg(3)] }) },
      { t: 1.4, pose: m(NEUTRAL) },
    ],
  },
  {
    id: 'clutch-fall', name: '捂腹跪倒', category: '情绪', durationSeconds: 2.4, loop: false,
    keyframes: [
      { t: 0, pose: m(NEUTRAL) },
      { t: 0.5, pose: P('clutch-belly') },
      { t: 1.3, pose: m(P('clutch-belly'), { spine: [deg(34), 0, 0] }) },
      { t: 2.4, pose: P('beg') },
    ],
  },
  {
    id: 'flinch-loop', name: '抱头颤缩（循环）', category: '情绪', durationSeconds: 0.8, loop: true,
    keyframes: [
      { t: 0, pose: P('cover-head') },
      { t: 0.4, pose: m(P('cover-head'), { spine: [deg(26), 0, deg(3)], neck: [deg(26), 0, 0] }) },
      { t: 0.8, pose: P('cover-head') },
    ],
  },
  {
    id: 'dejected-sink', name: '低头沮丧', category: '情绪', durationSeconds: 1.6, loop: false,
    keyframes: [
      { t: 0, pose: m(NEUTRAL) },
      { t: 0.8, pose: P('dejected') },
      { t: 1.6, pose: P('dejected') },
    ],
  },
]

/** 预设分类顺序（UI 分组用）。 */
export const MOTION_PRESET_CATEGORIES = ['待机', '交流', '武戏', '情绪'] as const

/** 按 id 找内置动画预设。 */
export function findMotionPreset(id: string | undefined): MotionPreset | undefined {
  if (!id) return undefined
  return MOTION_PRESETS.find((p) => p.id === id)
}

/**
 * 【连招合成】把多个动作预设首尾相接，合成一条连续的「连招」PoseClip。
 * 每段按累计时长偏移；第 2 段起丢掉它的 t=0「预备/起手」帧，让上一段末帧 smoothstep 平滑过渡到下一段动作
 * （不硬切）。整条 loop=true（在时间窗内循环整套连招）。单个 id == 单动作。无有效预设返回 null。
 * 解析链路完全复用 motionClip：把它写进 character.motionClip 引用的 customMotions / 或由 CharacterObject 合成。
 */
export function concatMotionPresets(ids: string[] | undefined): PoseClip | null {
  const presets = (ids ?? []).map(findMotionPreset).filter((p): p is MotionPreset => !!p)
  if (presets.length === 0) return null
  const keyframes: PoseKeyframe[] = []
  let offset = 0
  for (let i = 0; i < presets.length; i++) {
    const p = presets[i]
    for (const kf of p.keyframes) {
      if (i > 0 && kf.t <= 1e-6) continue // 丢预备帧 → 跨段平滑过渡，不在切点硬跳
      keyframes.push({ t: offset + kf.t, pose: kf.pose })
    }
    offset += Math.max(0.1, p.durationSeconds)
  }
  if (keyframes.length === 0) return null
  return {
    id: 'seq:' + presets.map((p) => p.id).join('+'),
    name: presets.length === 1 ? presets[0].name : `连招 ×${presets.length}`,
    durationSeconds: Math.max(0.1, offset),
    loop: true,
    keyframes,
  }
}
