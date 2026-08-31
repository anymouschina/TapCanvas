import type { Vec3 } from '../types'
import { sampleCharacterMotionAt, type CharacterMotion } from '../state/characterMotion'

/** 可选骨骼动画 clip（xbot.glb 内嵌 7 段 + 程序化 wave）。增删须与 CharacterObject 实际挂载的 actions 对齐。 */
export const MOTION_CLIP_OPTIONS: { id: string; label: string }[] = [
  { id: '', label: '无（静态姿势）' },
  { id: 'idle', label: '待机呼吸' },
  { id: 'walk', label: '走路' },
  { id: 'run', label: '跑步' },
  { id: 'wave', label: '挥手打招呼' },
  { id: 'agree', label: '点头' },
  { id: 'headShake', label: '摇头' },
  { id: 'sad_pose', label: '低落' },
  { id: 'sneak_pose', label: '潜行' },
]

export type Keyframe<T extends number[]> = { t: number; value: T }
export type CameraTracks = {
  position: Keyframe<Vec3>[]
  lookAt: Keyframe<Vec3>[]
  fovDeg: Keyframe<[number]>[]
}
export type CharacterTracks = {
  position?: Keyframe<Vec3>[]
  rotation?: Keyframe<Vec3>[]
  /** 骨骼动画 clip 名（idle|walk|run|agree|headShake|sad_pose|sneak_pose|wave）；整段常量 */
  motionClip?: string
  /** 播放速率，默认 1 */
  motionSpeed?: number
  /** 轻量动画：混合分层动作。设了则覆盖 motionClip/position/rotation（由合成器逐帧算）。 */
  motion?: CharacterMotion
}
/** 相机环绕/弧线运镜：绕 center 以 radius 在 XZ 平面扫 degrees 度，注视锁定中心。比手摆关键帧更平滑。 */
export type CameraOrbit = {
  center?: Vec3      // 环绕中心，默认 [0,0,0]
  radius?: number    // 半径（米），默认 6
  height?: number    // 相机世界高度，默认 1.6
  startDeg?: number  // 起始角（度，0=正前 +Z），默认 0
  degrees?: number   // 扫掠角度（360=整圈，180=半弧），默认 360
  fovDeg?: number    // 默认 40
  lookAtHeight?: number // 注视点高度（中心之上），默认 1.3（胸口）
}
export type ClipAnimation = {
  durationSeconds: number
  fps: number
  cameras: Record<string, CameraTracks>
  characters: Record<string, CharacterTracks>
  /** 可选：相机环绕运镜。给定时覆盖 capture-cam 机位（每帧算精确圆周，平滑无折线）。 */
  cameraOrbit?: CameraOrbit
}
export type SampledCamera = { position: Vec3; lookAt: Vec3; fovDeg: number }
export type SampledCharacter = {
  position?: Vec3; rotation?: Vec3; motionClip?: string; motionTimeSec?: number
  /** 透传给渲染层做分层合成；motionAbsTime=该帧绝对时间(秒) */
  motion?: CharacterMotion; motionAbsTime?: number
}
export type SampledFrame = {
  cameras: Record<string, SampledCamera>
  characters: Record<string, SampledCharacter>
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

export function sampleTrack<T extends number[]>(track: Keyframe<T>[] | undefined, t: number): T | undefined {
  if (!track || track.length === 0) return undefined
  if (t <= track[0].t) return track[0].value
  if (t >= track[track.length - 1].t) return track[track.length - 1].value
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i]
    const b = track[i + 1]
    if (t >= a.t && t <= b.t) {
      const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
      return a.value.map((av, idx) => lerp(av, b.value[idx], k)) as T
    }
  }
  return track[track.length - 1].value
}

/** 环绕运镜：t∈[0,duration] 线性映射到 [startDeg, startDeg+degrees]，算 XZ 圆周机位，注视锁中心。 */
export function sampleOrbitCamera(orbit: CameraOrbit, t: number, duration: number): SampledCamera {
  const center = orbit.center ?? [0, 0, 0]
  const radius = orbit.radius ?? 6
  const height = orbit.height ?? 1.6
  const startDeg = orbit.startDeg ?? 0
  const degrees = orbit.degrees ?? 360
  const k = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0
  const ang = ((startDeg + degrees * k) * Math.PI) / 180
  return {
    position: [center[0] + radius * Math.sin(ang), height, center[2] + radius * Math.cos(ang)],
    lookAt: [center[0], center[1] + (orbit.lookAtHeight ?? 1.3), center[2]],
    fovDeg: orbit.fovDeg ?? 40,
  }
}

export function sampleAnimationAt(anim: ClipAnimation, t: number): SampledFrame {
  const cameras: Record<string, SampledCamera> = {}
  for (const [id, tracks] of Object.entries(anim.cameras)) {
    cameras[id] = {
      position: (sampleTrack(tracks.position, t) ?? [0, 2, 10]) as Vec3,
      lookAt: (sampleTrack(tracks.lookAt, t) ?? [0, 1, 0]) as Vec3,
      fovDeg: (sampleTrack(tracks.fovDeg, t) ?? [45])[0],
    }
  }
  // 环绕运镜：覆盖/注入 capture-cam（director clip 管线统一用该机位 id）
  if (anim.cameraOrbit) {
    cameras['capture-cam'] = sampleOrbitCamera(anim.cameraOrbit, t, anim.durationSeconds)
  }
  const characters: Record<string, SampledCharacter> = {}
  for (const [id, tracks] of Object.entries(anim.characters)) {
    const out: SampledCharacter = {
      position: sampleTrack(tracks.position, t) as Vec3 | undefined,
      rotation: sampleTrack(tracks.rotation, t) as Vec3 | undefined,
    }
    if (tracks.motion) {
      // 混合动画：根 transform 由路径覆盖，逐帧合成在渲染层用 motion+绝对时间完成
      const m = sampleCharacterMotionAt(tracks.motion, t)
      out.motion = tracks.motion
      out.motionAbsTime = t
      if (m.rootXZ) out.position = [m.rootXZ[0], 0, m.rootXZ[1]]
      if (m.rootHeadingY != null) out.rotation = [0, m.rootHeadingY, 0]
    } else if (tracks.motionClip) {
      out.motionClip = tracks.motionClip
      out.motionTimeSec = t * (tracks.motionSpeed ?? 1)
    }
    characters[id] = out
  }
  return { cameras, characters }
}

/** 帧索引序列：每帧的时间戳（秒），共 round(duration*fps)+1 帧含首尾 */
export function frameTimestamps(anim: ClipAnimation): number[] {
  const n = Math.max(1, Math.round(anim.durationSeconds * anim.fps))
  return Array.from({ length: n + 1 }, (_, i) => Math.min(anim.durationSeconds, i / anim.fps))
}
