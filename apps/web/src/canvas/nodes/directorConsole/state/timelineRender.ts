// 【整条时间线 → 逐帧渲染数据】把多镜头时间线烘焙成 ClipFrame[]，供 Viewport.captureClipFrames 出片。
// 相机：按全局时间定位当前镜头、取该镜头机位(含运镜路径)；镜头边界=硬切。
// 角色：按全局时间采样、钳到各自片段时长（与实时预览一致：超出冻结末帧）。纯函数、可单测。

import type { DirectorScene, Vec3 } from '../types'
import type { SceneTimeline } from './timeline'
import { activeShotAt, sampleShotCamera, timelineDuration } from './timeline'
import { sampleCharacterMotionAt, type CharacterMotion } from './characterMotion'
import { concatMotionPresets } from './motionPresets'

export type TimelineFrame = {
  position: Vec3
  lookAt: Vec3
  fovDeg: number
  characters: Record<string, {
    position?: Vec3
    rotation?: Vec3
    motionClip?: string
    motionTimeSec?: number
    motion?: CharacterMotion
    motionAbsTime?: number
  }>
}

const FALLBACK_CAM = { position: [0, 1.6, 8] as Vec3, lookAt: [0, 1.3, 0] as Vec3, fovDeg: 40 }

/** 单个全局时刻 t 的逐帧数据：当前镜头机位 + 各角色（钳到片段长）。 */
export function timelineFrameAt(scene: DirectorScene, timeline: SceneTimeline, t: number): TimelineFrame {
  const total = timelineDuration(timeline)
  const tt = Math.max(0, Math.min(total, t))
  const active = activeShotAt(timeline, tt)
  const cam = active ? sampleShotCamera(scene, active.shot, active.localT).camera : null
  const camera = cam ?? FALLBACK_CAM
  const characters: TimelineFrame['characters'] = {}
  for (const ch of scene.characters) {
    if (ch.motion) {
      const dur = Math.max(0.5, ch.motion.durationSeconds)
      const at = Math.min(tt, dur) // 钳到片段时长：超出冻结末帧
      const m = sampleCharacterMotionAt(ch.motion, at)
      characters[ch.id] = {
        position: m.rootXZ ? [m.rootXZ[0], 0, m.rootXZ[1]] : undefined,
        rotation: m.rootHeadingY != null ? [0, m.rootHeadingY, 0] : undefined,
        motion: ch.motion,
        motionAbsTime: at,
      }
    } else {
      // 连招序列 > 单 motionClip：合成 clip id 与 CharacterObject 同源，出片时由角色 effectiveCustomMotions 解析。
      const mc = ch.motionSequence?.length ? concatMotionPresets(ch.motionSequence)?.id : ch.motionClip
      if (mc) characters[ch.id] = { motionClip: mc, motionTimeSec: tt }
    }
  }
  return { position: camera.position, lookAt: camera.lookAt, fovDeg: camera.fovDeg, characters }
}

/** 烘焙整条时间线为逐帧数据（帧数 = round(total*fps)+1，含首尾）。 */
export function buildTimelineFrames(scene: DirectorScene, timeline: SceneTimeline, fps: number): TimelineFrame[] {
  const total = timelineDuration(timeline)
  if (total <= 0) return []
  const N = Math.max(1, Math.round(total * Math.max(1, fps)))
  const out: TimelineFrame[] = []
  for (let i = 0; i <= N; i++) out.push(timelineFrameAt(scene, timeline, i / fps))
  return out
}

/**
 * 烘焙时间线某时间窗 [startSec, endSec] 为逐帧数据。
 * 用于把超过出片上限的长片均分成多段、各自独立出片（窗口边界钳到时间线总长）。
 */
export function buildTimelineFramesRange(scene: DirectorScene, timeline: SceneTimeline, fps: number, startSec: number, endSec: number): TimelineFrame[] {
  const total = timelineDuration(timeline)
  const a = Math.max(0, Math.min(total, startSec))
  const b = Math.max(a, Math.min(total, endSec))
  const span = b - a
  if (span <= 0) return []
  const N = Math.max(1, Math.round(span * Math.max(1, fps)))
  const out: TimelineFrame[] = []
  for (let i = 0; i <= N; i++) out.push(timelineFrameAt(scene, timeline, a + i / fps))
  return out
}
