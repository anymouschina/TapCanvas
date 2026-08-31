// 自定义动作 = 关键帧化的「姿势」（复用 pose.ts 规范关节空间，小T 用同一套语汇即可产出）。
// 播放 = 在关键帧间逐关节逐轴线性插值 → applyPoseToRig（对任意骨骼局部轴都正确，无裸四元数坑）。
import type { PoseMap, JointRole, Euler3 } from './pose'

export type PoseKeyframe = { t: number; pose: PoseMap }
export type PoseClip = {
  id: string
  name: string
  durationSeconds: number
  loop?: boolean
  keyframes: PoseKeyframe[]
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

/** 采样 t 时刻的插值姿势。loop 时把 t 折进 [0,duration]；区间内逐关节逐轴线性插值，缺失关节按 rest(0)。 */
export function samplePoseClipAt(clip: PoseClip, t: number): PoseMap {
  const kfs = clip.keyframes
  if (!kfs || kfs.length === 0) return {}
  let tt = t
  if (clip.loop && clip.durationSeconds > 0) {
    tt = ((t % clip.durationSeconds) + clip.durationSeconds) % clip.durationSeconds
  }
  if (tt <= kfs[0].t) return kfs[0].pose ?? {}
  if (tt >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1].pose ?? {}
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]
    const b = kfs[i + 1]
    if (tt >= a.t && tt <= b.t) {
      const kRaw = b.t === a.t ? 0 : (tt - a.t) / (b.t - a.t)
      // smoothstep ease-in-out：关键帧处速度归零，姿势"落帧"更自然，去掉线性插值的匀速机械感
      // （跳舞/动作戏的关键帧动画尤其受益）。中点 k=0.5 → 0.5 不变，故既有中点用例不破。
      const k = kRaw * kRaw * (3 - 2 * kRaw)
      const roles = new Set<JointRole>([
        ...(a.pose ? (Object.keys(a.pose) as JointRole[]) : []),
        ...(b.pose ? (Object.keys(b.pose) as JointRole[]) : []),
      ])
      const out: PoseMap = {}
      const zero: Euler3 = [0, 0, 0]
      for (const role of roles) {
        const av = a.pose?.[role] ?? zero
        const bv = b.pose?.[role] ?? zero
        out[role] = [lerp(av[0], bv[0], k), lerp(av[1], bv[1], k), lerp(av[2], bv[2], k)]
      }
      return out
    }
  }
  return kfs[kfs.length - 1].pose ?? {}
}
