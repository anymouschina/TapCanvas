import type { JointRole, PoseMap } from './pose'
import { UPPER_BODY_ROLES, ALL_JOINT_ROLES } from './pose'
import { samplePoseClipAt, type PoseKeyframe } from './poseClip'
import { samplePathAt, type GroundPath } from './groundPath'

export type LocomotionTrack = {
  clip: 'walk' | 'run' | 'idle' // 驱动腿/根的 baked 循环
  path?: GroundPath             // 根沿此走；无则原地循环
  speed?: number                // 默认 1
}

export type CharacterMotion = {
  durationSeconds: number
  poseTrack?: PoseKeyframe[]    // 上半身关键帧（规范关节语汇）
  poseMask?: JointRole[]        // 缺省：有 locomotion=上半身集，否则=全身
  locomotion?: LocomotionTrack
}

/** 一帧的合成描述（消费方按此应用到骨架与根 transform）。 */
export type SampledMotion = {
  pose?: PoseMap            // 要叠加的姿势（已按 t 插值）；无 poseTrack 时 undefined
  poseMask: JointRole[]     // pose 驱动哪些关节
  bakedClip?: string        // 要播的 baked 循环名（驱动腿）
  bakedTimeSec?: number     // baked 播放时间
  rootXZ?: [number, number] // 根世界 XZ（来自路径）；无 path 时 undefined
  rootHeadingY?: number     // 根 rotation.y（路径切线朝向）；无 path 时 undefined
}

export function sampleCharacterMotionAt(motion: CharacterMotion, t: number): SampledMotion {
  const hasLoco = !!motion.locomotion
  const mask = motion.poseMask ?? (hasLoco ? UPPER_BODY_ROLES : ALL_JOINT_ROLES)

  const pose = motion.poseTrack && motion.poseTrack.length > 0
    ? samplePoseClipAt({ id: '_', name: '_', durationSeconds: motion.durationSeconds, keyframes: motion.poseTrack }, t)
    : undefined

  const out: SampledMotion = { poseMask: mask }
  if (pose) out.pose = pose

  if (motion.locomotion) {
    const loco = motion.locomotion
    const speed = loco.speed ?? 1
    out.bakedClip = loco.clip
    out.bakedTimeSec = t * speed
    if (loco.path && loco.path.waypoints.length >= 2) {
      const s = motion.durationSeconds > 0 ? Math.max(0, Math.min(1, t / motion.durationSeconds)) : 0
      const sample = samplePathAt(loco.path, s)
      out.rootXZ = [sample.pos[0], sample.pos[1]]
      // +Z 面朝默认朝向；切线 (tx,tz) → 绕 y 转 atan2(tx, tz) 使面对准切线
      out.rootHeadingY = Math.atan2(sample.tangent[0], sample.tangent[1])
    }
  }
  return out
}
